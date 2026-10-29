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
"""

from __future__ import annotations

import asyncio
import heapq
import itertools
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
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


class Slots:
    def __init__(self, n: int) -> None:
        if n < 1:
            raise ValueError("Slots needs at least one slot")
        self._free = n
        self._order = itertools.count()
        #: (lane, arrival, future) — a future that is done was served or gave up.
        self._waiters: list[tuple[int, int, asyncio.Future[None]]] = []
        #: The tasks holding a slot, with how many each holds (`holding()`).
        self._holders: dict[asyncio.Task[Any], int] = {}
        #: (wave 42) Called with the lane when a call before `BACKGROUND`
        #: has to queue for a slot (the worker cancels a quiet summary).
        self.on_wait: Callable[[int], None] | None = None

    def locked(self) -> bool:
        """No slot is free (the next `acquire` waits)."""
        return self._free <= 0

    def waiting(self, before: int | None = None) -> int:
        """How many calls wait for a slot; with `before`, only those in a
        lane before it (`waiting(BACKGROUND)`: the lines and the rulings)."""
        return sum(1 for lane, _, f in self._waiters if not f.done() and (before is None or lane < before))

    def holding(self) -> bool:
        """The calling task holds a slot (wave 42: nothing slow is awaited then)."""
        task = asyncio.current_task()
        return task is not None and task in self._holders

    async def acquire(self, lane: int = NORMAL) -> None:
        if self._free > 0:
            self._free -= 1
            self._held(+1)
            return
        fut: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        heapq.heappush(self._waiters, (lane, next(self._order), fut))
        if lane < BACKGROUND and self.on_wait is not None:
            try:
                self.on_wait(lane)
            except Exception:  # noqa: BLE001 — a hook must never cost a caller its place
                log.exception("the slots' on_wait hook failed")
        try:
            await fut
        except asyncio.CancelledError:
            if fut.done() and not fut.cancelled():
                self._hand_on()  # handed the slot as it was cancelled: pass it on
            raise
        self._held(+1)

    def release(self) -> None:
        """Hand the slot straight to the best waiter, else free it."""
        self._held(-1)
        self._hand_on()

    def _held(self, step: int) -> None:
        task = asyncio.current_task()
        if task is None:
            return
        n = self._holders.get(task, 0) + step
        if n > 0:
            self._holders[task] = n
        else:
            self._holders.pop(task, None)

    def _hand_on(self) -> None:
        while self._waiters:
            _, _, fut = heapq.heappop(self._waiters)
            if not fut.done():
                fut.set_result(None)
                return
        self._free += 1

    @asynccontextmanager
    async def lane(self, lane: int = NORMAL) -> AsyncIterator[None]:
        await self.acquire(lane)
        try:
            yield
        finally:
            self.release()

    async def __aenter__(self) -> None:
        await self.acquire(NORMAL)

    async def __aexit__(self, *exc: object) -> None:
        self.release()
