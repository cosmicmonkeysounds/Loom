"""launchd jobs: each stagehand module as its own supervised process.

On the night John's MacBook runs `agents` (Trabolta's worker), and `audio`
(the speaker router) only as the fallback; the Windows Desktop runs `show`,
`lights` and, by default, `audio` under Task Scheduler instead (`tasks.py`). Each module is a
**separate** launchd job, so either can be restarted, or can crash, without
touching the other, and nobody ever needs `pkill -f "stagehand run"`, which
kills every job:

    stagehand launchd install --job agents --config laptop.yaml
    stagehand launchd install --job audio  --config trapped.macbook.yaml  # the router fallback
    stagehand launchd restart --job agents        # only Trabolta's worker
    stagehand launchd status                      # every installed job
    stagehand launchd uninstall --job audio

Each job is a per-user LaunchAgent (`~/Library/LaunchAgents`), started at
login and kept alive (launchd relaunches it, throttled to once per 10 s),
running `uv run stagehand run --config <file> --only <job>` with its own
log under `~/Library/Logs/stagehand/<job>.log`. The MacBook must log in
automatically after a power cut for the jobs to come back on their own.

`job_plist` is pure; `Launchd` takes the command runner and directories
as arguments so the tests never touch the real launchd.
"""

from __future__ import annotations

import os
import plistlib
import shutil
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from .config import ConfigError, load_config

LABEL_PREFIX = "com.mapsandducks.stagehand"
JOBS = ("show", "agents", "audio", "lights")
#: Seconds launchd waits before relaunching a job that exited.
THROTTLE_S = 10


def label_for(job: str) -> str:
    return f"{LABEL_PREFIX}.{job}"


def job_plist(
    job: str,
    config: Path,
    *,
    stagehand_dir: Path,
    uv: str,
    log_dir: Path,
    path_env: str,
) -> dict:
    """The LaunchAgent property list for one module."""
    if job not in JOBS:
        raise ConfigError(f"launchd: unknown job {job!r} (jobs: {', '.join(JOBS)})")
    log = (log_dir / f"{job}.log").as_posix()  # a macOS plist, even printed on Windows
    return {
        "Label": label_for(job),
        "ProgramArguments": [
            uv,
            "run",
            "--project",
            str(stagehand_dir),
            # The Claude SDK: only this job may need it (wave 52).
            *(["--extra", "anthropic"] if job == "agents" else []),
            "stagehand",
            "run",
            "--config",
            str(config),
            "--only",
            job,
        ],
        "WorkingDirectory": str(stagehand_dir),
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": THROTTLE_S,
        # Not App-Napped or throttled like a background job: cues and replies
        # are latency-sensitive.
        "ProcessType": "Interactive",
        "StandardOutPath": log,
        "StandardErrorPath": log,
        "EnvironmentVariables": {"PATH": path_env, "PYTHONUNBUFFERED": "1"},
    }


Runner = Callable[[Sequence[str]], "subprocess.CompletedProcess[str]"]


def _run(argv: Sequence[str]) -> "subprocess.CompletedProcess[str]":
    return subprocess.run(list(argv), capture_output=True, text=True, check=False)


@dataclass
class Launchd:
    stagehand_dir: Path
    agents_dir: Path = field(default_factory=lambda: Path.home() / "Library/LaunchAgents")
    log_dir: Path = field(default_factory=lambda: Path.home() / "Library/Logs/stagehand")
    # A lambda, not `os.getuid` itself: a bare reference is looked up when the
    # class body runs (at import), and Windows has no `os.getuid`, so the whole
    # CLI (`tasks`, `check`, `run`) would die importing `JOBS` from here.
    uid: int = field(default_factory=lambda: os.getuid())
    run: Runner = _run
    uv: str | None = None

    @property
    def domain(self) -> str:
        return f"gui/{self.uid}"

    def plist_path(self, job: str) -> Path:
        return self.agents_dir / f"{label_for(job)}.plist"

    def render(self, job: str, config: str | Path) -> dict:
        cfg = Path(config).expanduser().resolve()
        # Fail now, at install, not on the night: the file must load and hold
        # that module's section.
        load_config(cfg, only=[job])
        uv = self.uv or shutil.which("uv")
        if uv is None:
            raise ConfigError("launchd: `uv` is not on PATH (install it, or pass its path)")
        dirs = [Path(uv).parent.as_posix(),"/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        path_env = ":".join(dict.fromkeys(dirs))
        return job_plist(job, cfg, stagehand_dir=self.stagehand_dir, uv=uv, log_dir=self.log_dir, path_env=path_env)

    def install(self, job: str, config: str | Path) -> list[str]:
        plist = self.render(job, config)
        self.agents_dir.mkdir(parents=True, exist_ok=True)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        path = self.plist_path(job)
        path.write_bytes(plistlib.dumps(plist))
        # Replace a running copy (bootout of a job that isn't loaded just fails).
        self.run(["launchctl", "bootout", f"{self.domain}/{label_for(job)}"])
        res = self.run(["launchctl", "bootstrap", self.domain, str(path)])
        if res.returncode != 0:
            raise ConfigError(f"launchctl bootstrap failed: {res.stderr.strip() or res.returncode}")
        return [f"installed {label_for(job)} → {path}", f"log: {plist['StandardOutPath']}"]

    def uninstall(self, job: str) -> list[str]:
        self.run(["launchctl", "bootout", f"{self.domain}/{label_for(job)}"])
        path = self.plist_path(job)
        if path.exists():
            path.unlink()
        return [f"removed {label_for(job)}"]

    def restart(self, job: str) -> list[str]:
        """Kill and relaunch ONE job (`kickstart -k`); the other keeps running."""
        res = self.run(["launchctl", "kickstart", "-k", f"{self.domain}/{label_for(job)}"])
        if res.returncode != 0:
            raise ConfigError(f"launchctl kickstart failed (is {job} installed?): {res.stderr.strip() or res.returncode}")
        return [f"restarted {label_for(job)}"]

    def status(self, jobs: Sequence[str] = JOBS) -> list[str]:
        lines = []
        for job in jobs:
            res = self.run(["launchctl", "print", f"{self.domain}/{label_for(job)}"])
            if res.returncode != 0:
                lines.append(f"{job:<7} not installed")
                continue
            info = _print_fields(res.stdout)
            lines.append(f"{job:<7} {info.get('state', '?')}  pid {info.get('pid', '—')}  last exit {info.get('last exit code', '—')}")
        return lines


def _print_fields(text: str) -> dict[str, str]:
    """The top-level `key = value` lines of `launchctl print`."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        if line.startswith("\t") and not line.startswith("\t\t") and " = " in line:
            key, _, value = line.strip().partition(" = ")
            out.setdefault(key, value)
    return out
