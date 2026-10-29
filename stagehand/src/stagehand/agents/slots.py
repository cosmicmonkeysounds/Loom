"""The worker's generation slots, with a priority lane (wave 32).

A laptop GPU serves one generation at a time (`concurrency: 1`), so every
model call — a guest's line, a ruling, a quiet summary, a director's
Rewrite — waits its turn for a slot. An `asyncio.Semaphore` wakes its
waiters first come, first served; during a talk scene that put Trabolta's
PUBLIC answer to Clippy (the whole Desktop waiting on the TV) behind every
guest DM queued before it.

`Slots` is that semaphore with lanes: a waiter in a lower lane is served
before every waiter in a higher one, and waiters in the same lane keep
their order. `async with slots:` takes the ordinary lane (`NORMAL`);
`async with slots.lane(FIRST):` the front one (a stage request). A free
slot is still taken at once by whoever asks: the lane only orders the
queue. Nothing is ever preempted: a call that holds the slot finishes.

(wave 42) The worker asks two more things of its slots. `holding()` says
whether the calling task holds one, so the trace's server POST is never
awaited with a slot in hand (a slow VPS round trip must not stretch a
generation slot). `on_wait` is called when a call in a lane before
`BACKGROUND` finds no slot free and has to queue: the worker cancels a
running quiet summary then, so a summary may use a free slot while
another line is in flight (`concurrency` > 1) and still never makes a
line wait.

(wave 42b) The slots may belong to more than one **engine**: the primary
(`agents.llm`, `concurrency` slots) and each `agents.overflow` engine
(its `capacity`). `acquire` returns the engine whose slot it took: the
primary when one of its slots is free, else the first listed overflow
engine with one free; a waiter is handed the first slot an engine it may
use frees. `only=` keeps a call to some engines (a quiet summary, a
letter: the primary alone). An engine marked down (`mark_down`, after a
model error) is skipped for `down_s` seconds, unless every engine the
call may use is down (then trying one costs nothing). `switch` moves a
held slot to another engine (the one retry after an engine failed). With
one engine this is the semaphore with lanes it always was.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
import time
from collections.abc import AsyncIterator, Callable, Collection, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

log = logging.getLogger("stagehand.agents.slots")

#: The front lane: a stage request (Trabolta answering Clippy in front of the room).
FIRST = 0
#: Next: a guest talking to him at his heart (the night's other big scene).
HEART = 1
#: Every other call: a guest's line, a ruling, a director's call.
NORMAL = 2
#: Last: work nobody is waiting on (a quiet summary, a director's re-run).
BACKGROUND = 3

#: (wave 42b) The primary engine's name (`agents.llm`).
PRIMARY = "primary"
#: (wave 42b) How long an engine that failed is skipped.
ENGINE_DOWN_S = 30.0


@dataclass
class Hold:
    """(wave 42b) One slot held through `lane()`: the engine it is on
    (None for a moment while `switch` looks for another) and its lane."""

    engine: str | None
    lane: int = NORMAL


@dataclass
class _Waiter:
    lane: int
    arrival: int
    fut: asyncio.Future[str]
    only: frozenset[str] | None


class Slots:
    def __init__(self, n: int | None = None, *, engines: Sequence[tuple[str, int]] | None = None, clock: Callable[[], float] = time.monotonic) -> None:
        if engines is None:
            engines = [(PRIMARY, 1 if n is None else n)]
        if not engines:
            raise ValueError("Slots needs at least one engine")
        names = [name for name, _ in engines]
        if len(set(names)) != len(names):
            raise ValueError("Slots: engine names must be distinct")
        for name, cap in engines:
            if cap < 1:
                raise ValueError(f"Slots needs at least one slot ({name})")
        #: The engines in preference order (the primary first).
        self.names: tuple[str, ...] = tuple(names)
        self._cap: dict[str, int] = dict(engines)
        self._free: dict[str, int] = dict(engines)
        self._order = itertools.count()
        self._front = itertools.count(-1, -1)
        self._waiters: list[_Waiter] = []
        #: The tasks holding a slot, with the engine of each slot they hold (`holding()`).
        self._holders: dict[asyncio.Task[Any], list[str]] = {}
        #: (wave 42b) engine → the clock reading it is back at.
        self._down: dict[str, float] = {}
        self.clock = clock
        #: (wave 42b) How long `mark_down` skips an engine.
        self.down_s = ENGINE_DOWN_S
        #: (wave 42) Called with the lane when a call before `BACKGROUND`
        #: has to queue for a slot (the worker cancels a quiet summary).
        self.on_wait: Callable[[int], None] | None = None

    # -- what the worker asks ---------------------------------------------------------

    @property
    def capacity(self) -> int:
        """Every engine's slots together."""
        return sum(self._cap.values())

    def free(self, engine: str) -> int:
        return self._free[engine]

    def locked(self) -> bool:
        """No slot is free that an ordinary call may take (the next `acquire` waits)."""
        return self._pick(None) is None

    def waiting(self, before: int | None = None) -> int:
        """How many calls wait for a slot; with `before`, only those in a
        lane before it (`waiting(BACKGROUND)`: the lines and the rulings)."""
        return sum(1 for w in self._waiters if not w.fut.done() and (before is None or w.lane < before))

    def holding(self) -> bool:
        """The calling task holds a slot (wave 42: nothing slow is awaited then)."""
        task = asyncio.current_task()
        return task is not None and task in self._holders

    # -- engines up and down (wave 42b) -----------------------------------------------

    def is_down(self, engine: str) -> bool:
        until = self._down.get(engine)
        if until is None:
            return False
        if self.clock() >= until:
            del self._down[engine]
            return False
        return True

    def mark_down(self, engine: str) -> None:
        """Skip `engine` for `down_s` seconds; whoever waits is served by
        the others meanwhile, and its free slots are handed out again when
        it is back."""
        self._down[engine] = self.clock() + self.down_s
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.call_later(self.down_s + 0.01, self._pump)

    def up(self, exclude: Collection[str] = ()) -> list[str]:
        """The engines not down, in preference order, but those in `exclude`."""
        return [n for n in self.names if n not in exclude and not self.is_down(n)]

    def _usable(self, engine: str, only: frozenset[str] | None) -> bool:
        if only is not None and engine not in only:
            return False
        if not self.is_down(engine):
            return True
        # Every engine this call may use is down: trying one costs nothing.
        return all(self.is_down(n) for n in self.names if only is None or n in only)

    def _pick(self, only: frozenset[str] | None) -> str | None:
        for name in self.names:
            if self._free[name] > 0 and self._usable(name, only):
                return name
        return None

    # -- acquire / release -----------------------------------------------------------

    async def acquire(self, lane: int = NORMAL, *, only: Collection[str] | None = None, front: bool = False) -> str:
        """Take a slot; returns its engine. `only`: the engines this call
        may use (None = any). `front`: ahead of every waiter in its lane
        (a call that already waited its turn once)."""
        allowed = None if only is None else frozenset(only)
        if allowed is not None and not allowed & set(self.names):
            raise ValueError(f"no such engine: {', '.join(sorted(allowed))}")
        name = self._pick(allowed)
        if name is not None:
            self._free[name] -= 1
            self._held(name, +1)
            return name
        fut: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._waiters.append(_Waiter(lane, next(self._front) if front else next(self._order), fut, allowed))
        if lane < BACKGROUND and self.on_wait is not None:
            try:
                self.on_wait(lane)
            except Exception:  # noqa: BLE001 — a hook must never cost a caller its place
                log.exception("the slots' on_wait hook failed")
        try:
            name = await fut
        except asyncio.CancelledError:
            if fut.done() and not fut.cancelled():
                self._hand_on(fut.result())  # handed the slot as it was cancelled: pass it on
            raise
        finally:
            self._waiters = [w for w in self._waiters if w.fut is not fut]
        self._held(name, +1)
        return name

    def release(self, engine: str | None = None) -> None:
        """Hand the slot straight to the best waiter that may use it, else
        free it. With no `engine`, the calling task's newest slot."""
        if engine is None:
            engine = self._newest()
        self._held(engine, -1)
        self._hand_on(engine)

    async def switch(self, hold: Hold, exclude: Collection[str]) -> str:
        """(wave 42b) Give up the slot `hold` has and take one on another
        engine that is up (not in `exclude`), at the front of its lane:
        the one retry after an engine failed. Raises LookupError when no
        other engine is up."""
        targets = self.up(exclude)
        if not targets:
            raise LookupError("no other engine is up")
        if hold.engine is not None:
            old, hold.engine = hold.engine, None
            self.release(old)
        hold.engine = await self.acquire(hold.lane, only=targets, front=True)
        return hold.engine

    def _newest(self) -> str:
        task = asyncio.current_task()
        held = self._holders.get(task) if task is not None else None
        if held:
            return held[-1]
        # Released by a task that holds none (a test's bare acquire / release):
        # the first engine with a slot out.
        return next((n for n in self.names if self._free[n] < self._cap[n]), self.names[0])

    def _held(self, engine: str, step: int) -> None:
        task = asyncio.current_task()
        if task is None:
            return
        held = self._holders.setdefault(task, [])
        if step > 0:
            held.append(engine)
        elif engine in held:
            held.reverse()
            held.remove(engine)
            held.reverse()
        if not held:
            self._holders.pop(task, None)

    def _best(self, engine: str) -> _Waiter | None:
        best: _Waiter | None = None
        for w in self._waiters:
            if w.fut.done() or not self._usable(engine, w.only):
                continue
            if best is None or (w.lane, w.arrival) < (best.lane, best.arrival):
                best = w
        return best

    def _hand_on(self, engine: str) -> None:
        w = self._best(engine)
        if w is not None:
            w.fut.set_result(engine)
            return
        self._free[engine] = min(self._cap[engine], self._free[engine] + 1)

    def _pump(self) -> None:
        """Hand out free slots an engine coming back up can serve."""
        for name in self.names:
            while self._free[name] > 0:
                w = self._best(name)
                if w is None:
                    break
                self._free[name] -= 1
                w.fut.set_result(name)

    @asynccontextmanager
    async def lane(self, lane: int = NORMAL, *, only: Collection[str] | None = None) -> AsyncIterator[Hold]:
        hold = Hold(engine=await self.acquire(lane, only=only), lane=lane)
        try:
            yield hold
        finally:
            if hold.engine is not None:
                self.release(hold.engine)

    async def __aenter__(self) -> str:
        return await self.acquire(NORMAL)

    async def __aexit__(self, *exc: object) -> None:
        self.release()
