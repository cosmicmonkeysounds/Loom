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
"""

from __future__ import annotations

import asyncio
import heapq
import itertools
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

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

    def locked(self) -> bool:
        """No slot is free (the next `acquire` waits)."""
        return self._free <= 0

    def waiting(self) -> int:
        return sum(1 for _, _, f in self._waiters if not f.done())

    async def acquire(self, lane: int = NORMAL) -> None:
        if self._free > 0:
            self._free -= 1
            return
        fut: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        heapq.heappush(self._waiters, (lane, next(self._order), fut))
        try:
            await fut
        except asyncio.CancelledError:
            if fut.done() and not fut.cancelled():
                self.release()  # handed the slot as it was cancelled: pass it on
            raise

    def release(self) -> None:
        """Hand the slot straight to the best waiter, else free it."""
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
