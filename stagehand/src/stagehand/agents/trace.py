"""The trace — every model call the worker makes, recorded for the debugger.

A character's night is a sequence of **thoughts**: the voice model
answering a line (`voice`, plus a `lookup` round when it asked the
session first), the orchestrator reflecting on an exchange (`reflect`)
or surveying the house (`survey`), a director re-running a past call to
compare (`rerun`), and markers with no model behind them (`reset`,
`control`, `error`). Each thought keeps the *whole* input (the messages
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
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections import deque
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

KINDS = ("voice", "lookup", "reflect", "survey", "rerun", "reset", "control", "error")


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

    def find(self, thought_id: str) -> Thought | None:
        for ring in self._rings.values():
            for t in ring:
                if t.id == thought_id:
                    return t
        return None

    async def record(self, thought: Thought) -> Thought:
        ring = self._rings.get(thought.character)
        if ring is None:
            ring = deque(maxlen=self.ring)
            self._rings[thought.character] = ring
        ring.append(thought)
        self.recorded += 1
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
                fh.write(json.dumps(thought.to_json(), ensure_ascii=False) + "\n")
        except OSError as err:
            log.warning("could not append %s's trace to %s: %s", thought.character, path, err)

    def load_recent(self, character: str, limit: int | None = None) -> int:
        """Warm the ring from the jsonl (a worker restart keeps the night's
        history). Returns how many thoughts were loaded."""
        path = self.path(character)
        if path is None or not path.exists():
            return 0
        keep = limit if limit is not None else self.ring
        try:
            lines = path.read_text(encoding="utf-8").splitlines()[-keep:]
        except OSError:
            return 0
        ring = self._rings.setdefault(character, deque(maxlen=self.ring))
        n = 0
        for line in lines:
            try:
                doc = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(doc, dict) or doc.get("character") != character:
                continue
            try:
                ring.append(Thought(**{k: v for k, v in doc.items() if k in Thought.__dataclass_fields__}))
                n += 1
            except TypeError:
                continue
        return n
