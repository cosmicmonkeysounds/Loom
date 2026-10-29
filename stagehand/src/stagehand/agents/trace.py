"""The trace — every model call the worker makes, recorded for the debugger.

A character's night is a sequence of **thoughts**: the voice model
answering a line (`voice`, plus a `lookup` round when it asked the
session first), a stateless ruling on a near-miss 📝 filing for the
story's `judge:` (`judge`, wave 11b — the only thought whose messages
carry an answer key; the trace is never read back into any prompt), the
orchestrator reflecting on an exchange (`reflect`)
or surveying the house (`survey`), a director re-running a past call to
compare (`rerun`), the director's Rewrite brief (`brief`, wave 12), the
quiet-conversation summary (`summary`, wave 12), and markers with no model
behind them (`reset`, `control`, `error`). Each thought keeps the *whole* input (the messages
exactly as sent), the model's reasoning when the API hands it back
(gpt-oss `reasoning`, Ollama `thinking`, an inline `<think>` block), its
raw output, why it stopped, token counts, wall time, what the worker
parsed out of it, and — for the orchestrator — the diff it made to the
mind, keyed to the mind revision it produced.

Thoughts go three places: a bounded in-memory ring (what a fresh
director console is handed on connect), an append-only `.trace.jsonl`
next to the mind file (the durable record of the night), and the server
(`POST /api/agent/trace`, batched) so the editor's Mind page shows them
live. The trace never blocks a reply: a sink that fails is logged and
skipped.

**The static prompt part is stored once** (the wave 12 contract §C6.6). A
voice call's first message (the persona, the powers, the protocol) is the
same all night. When a thought's `messages[0]` is a system message of at
least `PREFIX_MIN` characters identical to one this process recorded for the
same character a little earlier, the jsonl line and the server copy carry
`"[same prefix as th-…]"` in its place, naming the thought that holds the
full text. The in-memory ring keeps the full text (a re-run needs it),
`load_recent` expands references from the file, and a reference it cannot
resolve stays the literal — a re-run of that thought is refused ("prefix not
found"). The first thought for a character after a worker start, or after a
reconnect (`restart_prefixes`), always carries the full text. The server copy
(`server_copy`) refers only to a full copy the server has taken
(`delivered`): a thought recorded while its holder's POST is still in flight,
or after that POST failed, goes whole.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
import uuid
from collections import OrderedDict, deque
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .llm import Completion, LlmConfig

log = logging.getLogger("stagehand.agents.trace")

#: Characters kept per message content in a recorded thought.
MAX_CONTENT = 24_000
#: Characters kept of the raw output / reasoning.
MAX_OUTPUT = 16_000
#: Thoughts kept in memory per character.
RING = 200

KINDS = ("voice", "lookup", "judge", "letter", "reflect", "survey", "rerun", "brief", "summary", "reset", "control", "error")

#: A system `messages[0]` at least this long is stored once (§C6.6).
PREFIX_MIN = 1_000
#: Distinct prefixes remembered per character (the voice's, the judge's, the
#: orchestrator's can take turns without each re-sending its full text).
PREFIX_KEEP = 4
#: A reference never reaches further back than this many of the character's
#: thoughts: past it the full copy may have left the server's ring (400) or
#: the window `load_recent` reads, so the text is sent in full again.
PREFIX_REACH = 150
#: Why a re-run of a thought whose prefix could not be read back is refused.
PREFIX_NOT_FOUND = "prefix not found"

_PREFIX_REF = re.compile(r"^\[same prefix as (th-[0-9a-f]{10})\]$")


def prefix_ref(thought_id: str) -> str:
    """The literal a stored thought carries in place of a repeated prefix."""
    return f"[same prefix as {thought_id}]"


def parse_prefix_ref(content: str) -> str | None:
    """The thought id a `[same prefix as th-…]` literal names, else None."""
    m = _PREFIX_REF.match(content)
    return m.group(1) if m else None


@dataclass
class Thought:
    id: str
    character: str
    at: float
    kind: str
    #: Why this call happened: `line` / `lookup` / `exchange` / `timer` /
    #: `hello` / `phase` / `director` / `restart` / `rerun:<id>`.
    trigger: str = ""
    model: dict[str, Any] = field(default_factory=dict)
    request_id: str | None = None
    thread: dict[str, Any] | None = None
    speaker: dict[str, Any] | None = None
    messages: list[dict[str, str]] = field(default_factory=list)
    thinking: str = ""
    output: str = ""
    finish: str = ""
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    ms: int = 0
    #: Ollama's prompt evaluation time (`prompt_eval_duration`), ms; None when
    #: the API does not say (the OpenAI dialect) — wave 12.
    prompt_ms: int | None = None
    #: What the worker made of the output (the reply / the mind update).
    result: dict[str, Any] | None = None
    #: The mind fields the update touched, and the before/after diff.
    touched: list[str] = field(default_factory=list)
    diff: dict[str, Any] = field(default_factory=dict)
    revision: int | None = None
    error: str | None = None
    #: Free text for markers (`control`: what the director did).
    note: str = ""

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def model_info(cfg: LlmConfig) -> dict[str, Any]:
    think = cfg.extra.get("think") if isinstance(cfg.extra, dict) else None
    return {
        "name": cfg.model,
        "api": cfg.api,
        "endpoint": cfg.endpoint,
        "temperature": cfg.temperature,
        "max_tokens": cfg.max_tokens,
        "reasoning_effort": cfg.reasoning_effort,
        "think": think,
    }


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + f"… [+{len(text) - limit} chars]"


def _whole_ms(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if value != value or value in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return int(round(value))


def new_thought(
    character: str,
    kind: str,
    *,
    trigger: str = "",
    model: LlmConfig | None = None,
    messages: list[dict[str, str]] | None = None,
    completion: Completion | None = None,
    request: dict[str, Any] | None = None,
    result: dict[str, Any] | None = None,
    error: str | None = None,
    note: str = "",
) -> Thought:
    """Build a thought from the pieces the pipeline has in hand."""
    t = Thought(id=f"th-{uuid.uuid4().hex[:10]}", character=character, at=time.time(), kind=kind, trigger=trigger, note=note)
    if model is not None:
        t.model = model_info(model)
    if messages:
        t.messages = [{"role": str(m.get("role", "")), "content": _clip(str(m.get("content", "")), MAX_CONTENT)} for m in messages]
    if completion is not None:
        t.thinking = _clip(completion.thinking, MAX_OUTPUT)
        t.output = _clip(completion.content, MAX_OUTPUT)
        t.finish = completion.finish
        t.prompt_tokens = completion.prompt_tokens
        t.completion_tokens = completion.completion_tokens
        t.ms = completion.ms
        t.prompt_ms = _whole_ms(getattr(completion, "prompt_ms", None))
    if request is not None:
        t.request_id = str(request.get("id")) if request.get("id") is not None else None
        thread = request.get("thread")
        t.thread = dict(thread) if isinstance(thread, dict) else None
        speaker = request.get("speaker")
        if isinstance(speaker, dict):
            t.speaker = {"id": str(speaker.get("id") or ""), "name": str(speaker.get("name") or ""), "kind": str(speaker.get("kind") or "guest")}
    t.result = result
    t.error = error
    return t


class Trace:
    """Per-character rings + the jsonl sink + a listener (the server mirror)."""

    def __init__(self, state_dir: Path | None = None, event: str = "", ring: int = RING) -> None:
        self.state_dir = state_dir
        self.event = event
        self.ring = ring
        self._rings: dict[str, deque[Thought]] = {}
        self._listeners: list[Any] = []  # Callable[[Thought], Awaitable[None] | None]
        self.recorded = 0
        #: Per character: prefix digest → (thought id holding it, its ordinal).
        self._prefixes: dict[str, OrderedDict[str, tuple[str, int]]] = {}
        #: Per character: how many thoughts this process has recorded.
        self._count: dict[str, int] = {}
        #: Thought id → the id of the thought holding its full prefix.
        self._refs: dict[str, str] = {}
        #: Thoughts read back with a prefix nobody holds any more.
        self._missing: set[str] = set()
        #: Thoughts whose server copy the server took (since the last restart_prefixes).
        self._delivered: set[str] = set()

    def listen(self, fn: Any) -> None:
        self._listeners.append(fn)

    def path(self, character: str) -> Path | None:
        if self.state_dir is None:
            return None
        safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in (self.event or "default"))
        who = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in character)
        return self.state_dir / safe / f"{who}.trace.jsonl"

    def recent(self, character: str, limit: int = 40) -> list[Thought]:
        ring = self._rings.get(character)
        if not ring:
            return []
        return list(ring)[-limit:]

    def all(self, character: str) -> list[Thought]:
        return list(self._rings.get(character, ()))

    def get(self, thought_id: str) -> Thought | None:
        """A held thought by id, whatever its prefix (never refused)."""
        for ring in self._rings.values():
            for t in ring:
                if t.id == thought_id:
                    return t
        return None

    def find(self, thought_id: str) -> Thought | None:
        """A thought to re-run. One whose prefix could not be read back from
        the file is refused (None): its first message is only a reference."""
        t = self.get(thought_id)
        if t is not None and t.id in self._missing:
            log.warning("re-run of %s refused: %s", t.id, PREFIX_NOT_FOUND)
            return None
        return t

    def refusal(self, thought_id: str) -> str | None:
        """Why `find` refuses this id (`PREFIX_NOT_FOUND`), else None."""
        return PREFIX_NOT_FOUND if thought_id in self._missing and self.get(thought_id) is not None else None

    # -- the static prefix, stored once ----------------------------------------------

    def ref_of(self, thought_id: str) -> str | None:
        """The thought holding this one's full prefix, when it is stored as a reference."""
        return self._refs.get(thought_id)

    def restart_prefixes(self) -> None:
        """A new connection: the server may hold none of the full copies, so
        the next thought for each character carries its prefix in full."""
        self._prefixes.clear()
        self._delivered.clear()

    def delivered(self, thought_id: str) -> None:
        """The server took this thought's server copy: later ones may refer to it."""
        self._delivered.add(thought_id)

    def forget_prefix(self, thought: Thought) -> None:
        """This thought's full copy did not reach the server: never refer to it."""
        table = self._prefixes.get(thought.character)
        if table is None:
            return
        for digest, (tid, _) in list(table.items()):
            if tid == thought.id:
                del table[digest]

    def _note_prefix(self, thought: Thought) -> None:
        n = self._count.get(thought.character, 0) + 1
        self._count[thought.character] = n
        if not thought.messages:
            return
        first = thought.messages[0]
        content = first.get("content", "")
        if first.get("role") != "system" or len(content) < PREFIX_MIN:
            return
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        table = self._prefixes.setdefault(thought.character, OrderedDict())
        held = table.get(digest)
        if held is not None and held[0] != thought.id and n - held[1] <= PREFIX_REACH:
            self._refs[thought.id] = held[0]
            table.move_to_end(digest)
            return
        table[digest] = (thought.id, n)
        table.move_to_end(digest)
        while len(table) > PREFIX_KEEP:
            table.popitem(last=False)

    def stored(self, thought: Thought) -> dict[str, Any]:
        """The thought as the jsonl and the server keep it: a repeated prefix
        is the `[same prefix as th-…]` literal."""
        doc = thought.to_json()
        ref = self._refs.get(thought.id)
        if ref is not None and doc.get("messages"):
            doc["messages"][0]["content"] = prefix_ref(ref)
        return doc

    def server_copy(self, thought: Thought) -> dict[str, Any]:
        """The thought as it is posted live: like `stored`, but a reference
        only to a holder the server has taken (`delivered`). One whose holder
        is still in flight, or never arrived, carries the full text."""
        doc = thought.to_json()
        ref = self._refs.get(thought.id)
        if ref is not None and ref in self._delivered and doc.get("messages"):
            doc["messages"][0]["content"] = prefix_ref(ref)
        return doc

    def _push_ring(self, ring: deque[Thought], thought: Thought) -> None:
        if ring.maxlen is not None and len(ring) >= ring.maxlen:
            gone = ring[0]
            self._refs.pop(gone.id, None)
            self._missing.discard(gone.id)
            self._delivered.discard(gone.id)
        ring.append(thought)

    # -- recording ------------------------------------------------------------------

    async def record(self, thought: Thought) -> Thought:
        ring = self._rings.get(thought.character)
        if ring is None:
            ring = deque(maxlen=self.ring)
            self._rings[thought.character] = ring
        self._push_ring(ring, thought)
        self.recorded += 1
        self._note_prefix(thought)
        self._append_file(thought)
        for fn in self._listeners:
            try:
                out = fn(thought)
                if hasattr(out, "__await__"):
                    await out
            except Exception as err:  # noqa: BLE001 — the trace must never break a reply
                log.warning("trace listener failed for %s: %s", thought.id, err)
        return thought

    def _append_file(self, thought: Thought) -> None:
        path = self.path(thought.character)
        if path is None:
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(self.stored(thought), ensure_ascii=False) + "\n")
        except OSError as err:
            log.warning("could not append %s's trace to %s: %s", thought.character, path, err)

    def load_recent(self, character: str, limit: int | None = None) -> int:
        """Warm the ring from the jsonl (a worker restart keeps the night's
        history). Returns how many thoughts were loaded. A `[same prefix as
        th-…]` reference is expanded from the thought it names — in the
        window, else further back in the file; one nobody holds stays the
        literal (and `find` refuses to re-run it)."""
        path = self.path(character)
        if path is None or not path.exists():
            return 0
        keep = limit if limit is not None else self.ring
        try:
            every = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return 0
        lines = every[-keep:] if keep > 0 else []
        earlier = every[: len(every) - len(lines)]
        docs: list[dict[str, Any]] = []
        for line in lines:
            try:
                doc = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(doc, dict) and doc.get("character") == character:
                docs.append(doc)
        full: dict[str, str] = {}
        wanted: set[str] = set()
        for doc in docs:
            head = _first_content(doc)
            if head is None:
                continue
            ref = parse_prefix_ref(head)
            if ref is None:
                full[str(doc.get("id"))] = head
            else:
                wanted.add(ref)
        wanted -= set(full)
        for line in reversed(earlier):
            if not wanted:
                break
            if not any(f'"id": "{rid}"' in line for rid in wanted):
                continue
            try:
                doc = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(doc, dict):
                continue
            head = _first_content(doc)
            rid = str(doc.get("id"))
            if head is not None and rid in wanted and parse_prefix_ref(head) is None:
                full[rid] = head
                wanted.discard(rid)
        ring = self._rings.setdefault(character, deque(maxlen=self.ring))
        n = 0
        for doc in docs:
            try:
                t = Thought(**{k: v for k, v in doc.items() if k in Thought.__dataclass_fields__})
            except TypeError:
                continue
            head = _first_content(doc)
            ref = parse_prefix_ref(head) if head is not None else None
            if ref is not None:
                self._refs[t.id] = ref
                if ref in full:
                    t.messages = [dict(m) for m in t.messages]
                    t.messages[0]["content"] = full[ref]
                else:
                    self._missing.add(t.id)
            self._push_ring(ring, t)
            n += 1
        return n


def _first_content(doc: dict[str, Any]) -> str | None:
    messages = doc.get("messages")
    if not isinstance(messages, list) or not messages or not isinstance(messages[0], dict):
        return None
    content = messages[0].get("content")
    return content if isinstance(content, str) else None
