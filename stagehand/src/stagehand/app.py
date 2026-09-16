"""Run every enabled module side by side on one shared server link.

A module that crashes is logged and restarted after a pause — one bad
cue map must not take the laptop's agents down with it (or vice versa).
Cancellation (Ctrl+C) stops them all.
"""

from __future__ import annotations

import asyncio
import logging

from .config import StagehandConfig
from .modapi import ModClient
from .module import Context, Module

log = logging.getLogger("stagehand")


async def _supervise(module: Module, ctx: Context, restart_after: float) -> None:
    while True:
        try:
            await module.run(ctx)
            log.warning("module %s returned — restarting in %.0fs", module.name, restart_after)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — supervise, don't die
            log.exception("module %s crashed — restarting in %.0fs", module.name, restart_after)
        await asyncio.sleep(restart_after)


async def run(cfg: StagehandConfig, base_dir: str = ".", restart_after: float = 5.0) -> None:
    mod = ModClient(
        cfg.server.url,
        event=cfg.server.event,
        token=cfg.server.mod_token,
        passcode=cfg.server.mod_passcode,
    )
    ctx = Context(server=cfg.server, mod=mod, base_dir=base_dir)
    tasks = [asyncio.ensure_future(_supervise(m, ctx, restart_after)) for m in cfg.modules.values()]
    try:
        await asyncio.gather(*tasks)
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await mod.aclose()
