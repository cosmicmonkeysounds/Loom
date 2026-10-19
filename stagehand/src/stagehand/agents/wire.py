"""The mind wire (wave 12, CONTRACTS.md §C6.5–C6.6): how the worker's mind
and trace reach the disk and the server without flooding either.

- **Saves** (`mind.json`) are trailing-debounced, at most one write every
  `DEBOUNCE_S` per character: the first change in a quiet spell writes at
  once, later ones fold into one write at the end of the window, which
  writes the mind as it is *then*. `save(…, now=True)` writes at once;
  `flush_saves()` writes everything pending (a reconnect, a shutdown). A
  pending write is never lost: if the event loop shuts down first, the
  timer writes as it is cancelled.
- **Mirrors** (`POST /api/agent/mind`) go only when the report's stable hash
  (everything but `updatedAt`, `status.inflight` and `status.thoughts`)
  differs from the last one the server took, and at most once every
  `DEBOUNCE_S`, trailing. The mirror right after `hello` is always posted.
- **A director's control or a reset** (a `control` / `reset` thought) is
  flushed at once — its save and the mirror that follows it skip the
  window (the director is watching the page). A reset also forgets the hash:
  the server dropped its copy of every mind when the story restarted.
- **The replay after `hello`** sends, per character, only the recent
  thoughts newer than the server's `traceAfter[character]` (all 40 when the
  server doesn't say), in batches of at most `REPLAY_BATCH`. A thought
  stored as `[same prefix as th-…]` whose full copy the server can't hold
  is sent with its full prefix, and later ones in the batch refer to it.

`module.py` reaches this through `wire_of(agents)` (created lazily, so the
worker's constructor is untouched); nothing here imports `module.py`.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
import math
import time
from collections.abc import Awaitable, Callable
from typing import Any

from ..modapi import ModApiError
from .mind import mind_path
from .trace import Thought, Trace, prefix_ref

log = logging.getLogger("stagehand.agents.wire")

#: The window for saves and mirrors, per character (seconds).
DEBOUNCE_S = 2.0
#: Thoughts replayed per character after `hello`, and per POST.
REPLAY_LIMIT = 40
REPLAY_BATCH = 40
#: Thought kinds that flush a character's save and mirror at once.
FLUSH_KINDS = ("control", "reset")

Fire = Callable[[], "Awaitable[None] | None"]


def _loop() -> asyncio.AbstractEventLoop | None:
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


class Throttle:
    """At most one run per key every `interval` seconds. The first request
    in a quiet spell runs at once; the rest fold into one trailing run at the
    window's end, which calls the newest `fire` it was handed. `fire` may
    be sync or async: an async one that runs now is returned for the caller
    to await. With no running loop a request always runs at once."""

    def __init__(self, interval: float = DEBOUNCE_S, clock: Callable[[], float] = time.monotonic) -> None:
        self.interval = interval
        self.clock = clock
        self._last: dict[str, float] = {}
        self._pending: dict[str, Fire] = {}
        self._timers: dict[str, asyncio.Task[None]] = {}
        #: How many runs happened (now + trailing), for tests and the log.
        self.runs = 0

    def pending(self, key: str) -> bool:
        return key in self._pending

    def due(self, key: str) -> bool:
        last = self._last.get(key)
        return last is None or self.clock() - last >= self.interval

    def request(self, key: str, fire: Fire, *, now: bool = False) -> Awaitable[None] | None:
        loop = _loop()
        if now or loop is None or self.due(key):
            self._cancel(key)
            self._pending.pop(key, None)
            return self._run(key, fire)
        self._pending[key] = fire
        timer = self._timers.get(key)
        if timer is None or timer.done() or timer.get_loop() is not loop:
            delay = max(0.0, self.interval - (self.clock() - self._last.get(key, self.clock())))
            self._timers[key] = loop.create_task(self._wait(key, delay))
        return None

    def flush(self, key: str | None = None) -> list[Awaitable[None]]:
        """Run what is pending now (one key, or every key). Returns the async
        runs for the caller to await (sync ones have already run)."""
        out: list[Awaitable[None]] = []
        for k in [key] if key is not None else list(self._pending):
            self._cancel(k)
            ran = self._take(k)
            if ran is not None:
                out.append(ran)
        return out

    def _cancel(self, key: str) -> None:
        timer = self._timers.pop(key, None)
        if timer is not None and not timer.done():
            timer.cancel()

    def _run(self, key: str, fire: Fire) -> Awaitable[None] | None:
        self._last[key] = self.clock()
        self.runs += 1
        out = fire()
        return out if inspect.isawaitable(out) else None

    def _take(self, key: str) -> Awaitable[None] | None:
        fire = self._pending.pop(key, None)
        return None if fire is None else self._run(key, fire)

    async def _wait(self, key: str, delay: float) -> None:
        me = asyncio.current_task()
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            # The loop is shutting down (a flush or a `now` took the pending
            # run before cancelling, so this finds nothing): never lose a write.
            if self._timers.get(key) is me:
                del self._timers[key]
                ran = self._take(key)
                if ran is not None:
                    await ran
            raise
        if self._timers.get(key) is me:
            del self._timers[key]
            ran = self._take(key)
            if ran is not None:
                await ran


def stable_hash(report: dict[str, Any]) -> str:
    """The report's hash, leaving out what moves without the mind changing."""
    doc = dict(report)
    doc.pop("updatedAt", None)
    status = doc.get("status")
    if isinstance(status, dict):
        status = dict(status)
        status.pop("inflight", None)
        status.pop("thoughts", None)
        doc["status"] = status
    text = json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def trace_after_of(hello: Any) -> dict[str, float] | None:
    """The `hello` frame's `traceAfter` (the newest thought stamp the server
    holds, per character), or None from a server that doesn't send it."""
    raw = hello.get("traceAfter") if isinstance(hello, dict) else None
    if not isinstance(raw, dict):
        return None
    out: dict[str, float] = {}
    for name, at in raw.items():
        if isinstance(at, (int, float)) and not isinstance(at, bool) and math.isfinite(at):
            out[str(name)] = float(at)
    return out


def replay_thoughts(trace: Trace, character: str, after: float | None, limit: int = REPLAY_LIMIT) -> list[dict[str, Any]]:
    """The thoughts to replay for one character, as the server keeps them.
    `after` = the newest stamp the server holds (None: it didn't say, so the
    last `limit` all go, as before wave 12). A prefix reference stays a
    reference only when its full copy is in this batch or older than
    `after`; otherwise this thought carries the full text and later ones in
    the batch refer to it."""
    thoughts = [t for t in trace.recent(character, limit) if after is None or t.at > after]
    sent: set[str] = set()
    moved: dict[str, str] = {}
    out: list[dict[str, Any]] = []
    for t in thoughts:
        doc = trace.stored(t)
        ref = trace.ref_of(t.id)
        if ref is not None and doc.get("messages"):
            target = moved.get(ref, ref)
            holder = trace.get(target)
            held = target in sent or (after is not None and holder is not None and holder.at <= after)
            if held:
                doc["messages"][0]["content"] = prefix_ref(target)
            elif trace.refusal(t.id) is None and t.messages:
                doc["messages"][0]["content"] = t.messages[0].get("content", "")
                moved[ref] = t.id
        out.append(doc)
        sent.add(t.id)
    return out


class Wire:
    """The save and mirror throttles plus the mirror's last posted hash,
    per character. Works on the `Agents` worker it is handed (duck-typed:
    `minds`, `mod`, `cfg`, `event`, `worker`, `status`, `trace`)."""

    def __init__(self, interval: float = DEBOUNCE_S, clock: Callable[[], float] = time.monotonic) -> None:
        self.saves = Throttle(interval, clock)
        self.mirrors = Throttle(interval, clock)
        self._hashes: dict[str, str] = {}
        self._mirror_now: set[str] = set()
        #: The `hello` frame's `traceAfter`, for the replay that follows it.
        self.trace_after: dict[str, float] | None = None
        self.posted = 0
        self.skipped = 0

    # -- saves --------------------------------------------------------------------

    def save(self, agents: Any, name: str, *, now: bool = False) -> None:
        def write() -> None:
            mind = agents.minds.get(name)
            if mind is not None:
                mind.event = agents.event
                mind.save(mind_path(agents.cfg.state_dir, agents.event, name))

        self.saves.request(name, write, now=now)

    def flush_saves(self, name: str | None = None) -> None:
        self.saves.flush(name)  # saves are sync: nothing to await

    # -- mirrors ------------------------------------------------------------------

    async def mirror(self, agents: Any, character: str, *, force: bool = False) -> None:
        """Mirror one mind. `force` (after `hello`): post now, no hash check."""
        mind = agents.minds.get(character)
        if mind is None or agents.cfg.dry_run or agents.mod is None:
            return
        now = force or character in self._mirror_now
        self._mirror_now.discard(character)
        if not now and self.mirrors.pending(character):
            return  # the trailing post will carry the newest state
        if not force and self._hashes.get(character) == stable_hash(self._report(agents, character)):
            self.skipped += 1
            return
        ran = self.mirrors.request(character, lambda: self._post(agents, character, force), now=now)
        if ran is not None:
            await ran

    def flush_now(self, thought: Thought) -> None:
        """A director's control or a reset: write its save at once and let
        the mirror that follows skip the window. A reset forgets the hash —
        the server dropped every mind's copy when the story restarted."""
        self.flush_saves(thought.character)
        self._mirror_now.add(thought.character)
        if thought.kind == "reset":
            self._hashes.pop(thought.character, None)

    def _report(self, agents: Any, character: str) -> dict[str, Any]:
        return agents.minds[character].report(agents.worker, agents.status(character))

    async def _post(self, agents: Any, character: str, force: bool) -> None:
        if agents.minds.get(character) is None or agents.mod is None:
            return
        report = self._report(agents, character)
        digest = stable_hash(report)
        if not force and self._hashes.get(character) == digest:
            self.skipped += 1
            return
        try:
            await agents.mod.post("/api/agent/mind", report)
        except ModApiError as err:
            log.warning("could not mirror %s's mind: %s", character, err)
            return
        except Exception as err:  # noqa: BLE001 — a mirror must never break the worker
            log.warning("could not mirror %s's mind: %s", character, err)
            return
        self._hashes[character] = digest
        self.posted += 1


def wire_of(agents: Any) -> Wire:
    """The worker's wire, made on first use."""
    wire = getattr(agents, "_wire", None)
    if wire is None:
        wire = Wire()
        agents._wire = wire
    return wire
