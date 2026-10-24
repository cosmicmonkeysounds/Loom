"""The house PC runs Windows: every stagehand module must import there, and
the CLI's Windows path (`stagehand tasks`) must run. Simulated on the Mac:
no `os.getuid`, no `fcntl`, a fake `msvcrt`, then a fresh import of every
`stagehand.*` module. Catches any POSIX-only name looked up at import."""

from __future__ import annotations

import builtins
import importlib
import os
import pkgutil
import sys
from pathlib import Path

import stagehand

ROOT = Path(__file__).resolve().parents[1]


class _FakeMsvcrt:
    LK_NBLCK = 2

    def locking(self, fd: int, mode: int, nbytes: int) -> None:  # pragma: no cover - never locked here
        pass


def _as_windows(monkeypatch) -> None:
    monkeypatch.delattr(os, "getuid", raising=False)
    real_import = builtins.__import__

    def windows_import(name, *args, **kwargs):
        if name == "fcntl":
            raise ImportError("No module named 'fcntl'")
        if name == "msvcrt":
            return _FakeMsvcrt()
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", windows_import)


def _fresh_stagehand(monkeypatch) -> None:
    """Drop every loaded stagehand module (restored after the test), so each
    is imported again under the Windows simulation."""
    for name in [n for n in sys.modules if n == "stagehand" or n.startswith("stagehand.")]:
        monkeypatch.delitem(sys.modules, name)


def test_every_stagehand_module_imports_on_windows(monkeypatch):
    # `__main__` runs the CLI when imported; it holds only `from .cli import main`.
    names = [m.name for m in pkgutil.walk_packages(stagehand.__path__, "stagehand.") if m.name != "stagehand.__main__"]
    assert "stagehand.cli" in names and "stagehand.tasks" in names and "stagehand.launchd" in names
    _as_windows(monkeypatch)
    _fresh_stagehand(monkeypatch)
    failed = {}
    for name in names:
        try:
            importlib.import_module(name)
        except Exception as err:  # noqa: BLE001 - every failure is reported at once
            failed[name] = f"{type(err).__name__}: {err}"
    assert failed == {}


def test_the_tasks_cli_runs_on_windows(monkeypatch, capsys):
    _as_windows(monkeypatch)
    _fresh_stagehand(monkeypatch)
    cli = importlib.import_module("stagehand.cli")
    assert cli.main(["tasks", "print", "--job", "show", "--config", str(ROOT / "trapped.desktop.yaml")]) == 0
    out = capsys.readouterr().out
    assert "--only show" in out and "pythonw.exe" in out
