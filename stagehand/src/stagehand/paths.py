"""Per-user cache folders: `~/Library/Caches/<name>` on the Mac (as every
module has always used), `%LOCALAPPDATA%\\stagehand\\<name>` on Windows —
where a Windows user looks, beside the tasks' logs (`tasks.py`)."""

from __future__ import annotations

import os
import sys


def user_cache(name: str, platform: str | None = None, env: dict | None = None) -> str:
    """The default `cache_dir` for `name` (e.g. `stagehand-audio`), still
    `~`-relative on the Mac (each config `expanduser`s it)."""
    if (platform or sys.platform) != "win32":
        return f"~/Library/Caches/{name}"
    env = os.environ if env is None else env
    base = env.get("LOCALAPPDATA") or os.path.join("~", "AppData", "Local")
    return os.path.join(base, "stagehand", name.removeprefix("stagehand-"))
