"""app.run: SIGTERM stops every module through its `finally` (wave 12).

A launchd restart sends SIGTERM; without a handler Python exits at once and
the agents' debounced mind saves (wire.py, up to 2 s) are lost.
"""

from __future__ import annotations

import asyncio
import os
import signal
import sys
from types import SimpleNamespace

import pytest

from stagehand import app


class Forever:
    name = "forever"

    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.finally_ran = False

    async def run(self, ctx) -> None:
        try:
            self.started.set()
            await asyncio.Event().wait()
        finally:
            self.finally_ran = True  # e.g. Agents.run -> abandon_all -> flush_saves


@pytest.mark.skipif(sys.platform == "win32", reason="os.kill(SIGTERM) is TerminateProcess on Windows: it would end the test run")
def test_sigterm_runs_every_modules_finally_and_returns():
    mod = Forever()
    cfg = SimpleNamespace(
        server=SimpleNamespace(url="http://127.0.0.1:1", event=None, mod_token=None, mod_passcode="x"),
        modules={"forever": mod},
    )

    async def go() -> None:
        run = asyncio.ensure_future(app.run(cfg, restart_after=0.01))
        await asyncio.wait_for(mod.started.wait(), 5)
        os.kill(os.getpid(), signal.SIGTERM)
        await asyncio.wait_for(run, 5)  # returns, never raises CancelledError

    # A safety net: should app.run not install its handler, the signal lands
    # here instead of killing the test run (and the test fails).
    stray: list[int] = []
    previous = signal.signal(signal.SIGTERM, lambda *_: stray.append(1))
    try:
        asyncio.run(go())
    finally:
        signal.signal(signal.SIGTERM, previous)
    assert stray == [] and mod.finally_ran
