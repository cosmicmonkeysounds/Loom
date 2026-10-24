"""Windows Task Scheduler jobs: launchd's twin for the house PC.

On the night John's Desktop (Windows) runs the house rig — `show` and
`lights`, and `audio` when the MOTU lives there — each module as its own
scheduled task, so one can be restarted, or can crash, without touching
the others (the property `launchd.py` gives the Mac):

    uv run stagehand tasks install --job show   --config trapped.desktop.yaml
    uv run stagehand tasks install --job lights --config trapped.desktop.yaml
    uv run stagehand tasks restart --job lights      # only the lights
    uv run stagehand tasks status                    # every job
    uv run stagehand tasks uninstall --job show
    uv run stagehand tasks print --job show --config trapped.desktop.yaml   # the XML, nothing installed

Each job is a task `\\Loom\\stagehand-<job>` started **at this user's logon**
in the interactive session (never a session-0 service: ASIO drivers and
the default audio device belong to the logged-in desktop), with no time
limit, normal priority (Task Scheduler's default 7 is below normal) and
never stopped on battery. launchd's KeepAlive is a second trigger that
fires every minute while the user is signed in: with
`MultipleInstancesPolicy IgnoreNew` it does nothing while the job runs and
starts it again within a minute of it dying (Task Scheduler's own
restart-on-failure is set too, but it misses a process that exits). So
`tasks stop` disables the task as well as ending it, and `restart`
enables it again. It runs the venv's own `pythonw.exe -m stagehand run
--config <file> --only <job> --log-file <log>` — no console window can
open on the TV, no `uv` or PowerShell wrapper sits between Task
Scheduler and the process (so End stops exactly the job), and the log is
`%LOCALAPPDATA%\\stagehand\\logs\\<job>.log`, written in UTF-8 by stagehand
itself (rotated at 10 MB). So `uv sync` must have made `.venv` first;
install says so when it hasn't.

The house PC must sign in automatically after a power cut (Sysinternals
Autologon / `netplwiz`) for the tasks to come back on their own —
scripts/house-desktop/README.md.

`task_xml` is pure; `Tasks` takes the command runner and directories as
arguments, so the tests never touch the real Task Scheduler (and run on
the Mac).
"""

from __future__ import annotations

import os
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from xml.sax.saxutils import escape

from .config import ConfigError, load_config
from .launchd import JOBS

FOLDER = "Loom"
#: Task Scheduler's restart-on-failure, and the keep-alive trigger's period:
#: every minute (its shortest).
RESTART_INTERVAL = "PT1M"
RESTART_COUNT = 999
#: Normal priority (0 realtime … 10 idle; Task Scheduler's own default is 7).
PRIORITY = 4


def task_name(job: str) -> str:
    return f"{FOLDER}\\stagehand-{job}"


def _quote(arg: str) -> str:
    """One Windows command-line argument (CommandLineToArgvW rules)."""
    if arg and not any(c in arg for c in ' \t"'):
        return arg
    out, slashes = ['"'], 0
    for c in arg:
        if c == "\\":
            slashes += 1
            continue
        if c == '"':
            out.append("\\" * (slashes * 2 + 1) + '"')
        else:
            out.append("\\" * slashes + c)
        slashes = 0
    out.append("\\" * (slashes * 2) + '"')
    return "".join(out)


def task_arguments(job: str, config: str, log_file: str) -> str:
    return " ".join(_quote(a) for a in ["-m", "stagehand", "run", "--config", config, "--only", job, "--log-file", log_file])


def task_xml(job: str, config: str, *, python: str, stagehand_dir: str, log_file: str, user: str) -> str:
    """The Task Scheduler XML (schema 1.2) for one module."""
    if job not in JOBS:
        raise ConfigError(f"tasks: unknown job {job!r} (jobs: {', '.join(JOBS)})")
    e = escape
    return f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>stagehand {e(job)} (Loom house rig): {e(config)}</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{e(user)}</UserId>
      <Delay>PT10S</Delay>
    </LogonTrigger>
    <TimeTrigger>
      <Repetition>
        <Interval>{RESTART_INTERVAL}</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{e(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>{PRIORITY}</Priority>
    <RestartOnFailure>
      <Interval>{RESTART_INTERVAL}</Interval>
      <Count>{RESTART_COUNT}</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{e(python)}</Command>
      <Arguments>{e(task_arguments(job, config, log_file))}</Arguments>
      <WorkingDirectory>{e(stagehand_dir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


Runner = Callable[[Sequence[str]], "subprocess.CompletedProcess[str]"]


def _run(argv: Sequence[str]) -> "subprocess.CompletedProcess[str]":
    return subprocess.run(list(argv), capture_output=True, text=True, check=False)


def _default_log_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(base) / "stagehand" / "logs"


def _default_user() -> str:
    user = os.environ.get("USERNAME") or os.environ.get("USER") or "user"
    domain = os.environ.get("USERDOMAIN")
    return f"{domain}\\{user}" if domain else user


@dataclass
class Tasks:
    stagehand_dir: Path
    log_dir: Path = field(default_factory=_default_log_dir)
    user: str = field(default_factory=_default_user)
    run: Runner = _run
    #: The venv's GUI-less interpreter (no console window on the TV).
    python: str | None = None
    #: Where the task XML is written before `schtasks /Create /XML` reads it.
    xml_dir: Path | None = None

    def interpreter(self) -> Path:
        return Path(self.python) if self.python else self.stagehand_dir / ".venv" / "Scripts" / "pythonw.exe"

    def log_file(self, job: str) -> Path:
        return self.log_dir / f"{job}.log"

    def render(self, job: str, config: str | Path) -> str:
        cfg = Path(config).expanduser().resolve()
        # Fail now, at install, not on the night: the file must load and hold
        # that module's section.
        load_config(cfg, only=[job])
        return task_xml(job, str(cfg), python=str(self.interpreter()), stagehand_dir=str(self.stagehand_dir), log_file=str(self.log_file(job)), user=self.user)

    def install(self, job: str, config: str | Path) -> list[str]:
        xml = self.render(job, config)
        python = self.interpreter()
        if not python.exists():
            raise ConfigError(f"tasks: no {python} — run `uv sync` in {self.stagehand_dir} first")
        self.log_dir.mkdir(parents=True, exist_ok=True)
        xml_dir = self.xml_dir or self.log_dir.parent
        xml_dir.mkdir(parents=True, exist_ok=True)
        path = xml_dir / f"stagehand-{job}.task.xml"
        # schtasks reads the XML as UTF-16 (a BOM + the declaration's encoding).
        path.write_text(xml, encoding="utf-16")
        res = self.run(["schtasks", "/Create", "/TN", task_name(job), "/XML", str(path), "/F"])
        if res.returncode != 0:
            raise ConfigError(f"schtasks /Create failed: {(res.stderr or res.stdout).strip() or res.returncode}")
        # Start it now, not at the next logon (an older copy is replaced: /F above).
        self.run(["schtasks", "/End", "/TN", task_name(job)])
        started = self.run(["schtasks", "/Run", "/TN", task_name(job)])
        lines = [f"installed {task_name(job)} (at logon) → {path}", f"log: {self.log_file(job)}"]
        if started.returncode != 0:
            lines.append(f"not started now: {(started.stderr or started.stdout).strip()} — it starts at the next logon")
        return lines

    def uninstall(self, job: str) -> list[str]:
        self.run(["schtasks", "/End", "/TN", task_name(job)])
        self.run(["schtasks", "/Delete", "/TN", task_name(job), "/F"])
        return [f"removed {task_name(job)}"]

    def restart(self, job: str) -> list[str]:
        """End and start ONE task (enabled again after a `stop`); the others keep running."""
        self.run(["schtasks", "/Change", "/TN", task_name(job), "/ENABLE"])
        self.run(["schtasks", "/End", "/TN", task_name(job)])
        res = self.run(["schtasks", "/Run", "/TN", task_name(job)])
        if res.returncode != 0:
            raise ConfigError(f"schtasks /Run failed (is {job} installed?): {(res.stderr or res.stdout).strip() or res.returncode}")
        return [f"restarted {task_name(job)}"]

    def stop(self, job: str) -> list[str]:
        """End the job and disable it (else the keep-alive trigger starts it
        again within a minute) until `tasks restart`."""
        res = self.run(["schtasks", "/Change", "/TN", task_name(job), "/DISABLE"])
        if res.returncode != 0:
            raise ConfigError(f"schtasks /Change failed (is {job} installed?): {(res.stderr or res.stdout).strip() or res.returncode}")
        self.run(["schtasks", "/End", "/TN", task_name(job)])
        return [f"stopped {task_name(job)} (disabled until `tasks restart`)"]

    def status(self, jobs: Sequence[str] = JOBS) -> list[str]:
        lines = []
        for job in jobs:
            res = self.run(["schtasks", "/Query", "/TN", task_name(job), "/V", "/FO", "LIST"])
            if res.returncode != 0:
                lines.append(f"{job:<7} not installed")
                continue
            info = _list_fields(res.stdout)
            lines.append(
                f"{job:<7} {info.get('status', '?')}  last run {info.get('last run time', '—')}  last result {info.get('last result', '—')}  log {self.log_file(job)}"
            )
        return lines


def _list_fields(text: str) -> dict[str, str]:
    """`schtasks /Query /V /FO LIST`'s `Key: value` lines, keys lower-cased."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        key, sep, value = line.partition(":")
        if sep and key.strip():
            out.setdefault(key.strip().lower(), value.strip())
    return out
