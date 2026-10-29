"""Windows Task Scheduler jobs (`stagehand tasks`): launchd's twin on the
house PC. Nothing here touches a real Task Scheduler (it runs on the Mac)."""

from __future__ import annotations

import argparse
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from stagehand import cli
from stagehand.config import ConfigError
from stagehand.launchd import JOBS
from stagehand.tasks import RESTART_INTERVAL, Tasks, _list_fields, _quote, task_arguments, task_name, task_xml

ROOT = Path(__file__).resolve().parents[1]
HOUSE = ROOT / "trapped.house.yaml"
NS = {"t": "http://schemas.microsoft.com/windows/2004/02/mit/task"}


class FakeSchtasks:
    def __init__(self, fail: set[str] | None = None, printed: str = "") -> None:
        self.calls: list[list[str]] = []
        self.fail = fail or set()
        self.printed = printed

    def __call__(self, argv):
        self.calls.append(list(argv))
        code = 1 if argv[1] in self.fail else 0
        return subprocess.CompletedProcess(list(argv), code, stdout=self.printed, stderr="ERROR: nope" if code else "")


def _tasks(tmp_path: Path, runner: FakeSchtasks, *, python: Path | None = None) -> Tasks:
    py = python or tmp_path / "venv" / "pythonw.exe"
    py.parent.mkdir(parents=True, exist_ok=True)
    py.write_text("", encoding="utf-8")
    return Tasks(stagehand_dir=ROOT, log_dir=tmp_path / "logs", user="DESKTOP\\john", run=runner, python=str(py))


def _xml(job: str = "show") -> ET.Element:
    text = task_xml(job, r"C:\loom\stagehand\trapped.desktop.yaml", python=r"C:\loom\stagehand\.venv\Scripts\pythonw.exe", stagehand_dir=r"C:\loom\stagehand", log_file=r"C:\Users\john\AppData\Local\stagehand\logs\show.log", user="DESKTOP\\john")
    return ET.fromstring(text.split("?>", 1)[1])


def test_each_module_is_its_own_task_with_its_own_log():
    assert {task_name(j) for j in JOBS} == {"Loom\\stagehand-show", "Loom\\stagehand-agents", "Loom\\stagehand-audio", "Loom\\stagehand-lights"}
    root = _xml("show")
    ex = root.find("t:Actions/t:Exec", NS)
    assert ex.find("t:Command", NS).text.endswith("pythonw.exe")  # no console window on the TV
    args = ex.find("t:Arguments", NS).text
    assert args.startswith("-m stagehand run --config C:\\loom\\stagehand\\trapped.desktop.yaml --only show --log-file ")
    assert ex.find("t:WorkingDirectory", NS).text == r"C:\loom\stagehand"
    with pytest.raises(ConfigError):
        task_xml("vision", "x", python="p", stagehand_dir="d", log_file="l", user="u")


def test_the_task_runs_at_logon_in_the_users_session_and_keeps_alive():
    root = _xml()
    assert root.find("t:Triggers/t:LogonTrigger/t:UserId", NS).text == "DESKTOP\\john"
    principal = root.find("t:Principals/t:Principal", NS)
    assert principal.find("t:LogonType", NS).text == "InteractiveToken"  # ASIO + the desktop's audio, never session 0
    settings = root.find("t:Settings", NS)
    assert settings.find("t:MultipleInstancesPolicy", NS).text == "IgnoreNew"
    assert settings.find("t:ExecutionTimeLimit", NS).text == "PT0S"  # no 72 h limit
    assert settings.find("t:DisallowStartIfOnBatteries", NS).text == "false"
    assert settings.find("t:StopIfGoingOnBatteries", NS).text == "false"
    assert int(settings.find("t:Priority", NS).text) < 7  # Task Scheduler's default is below normal
    # The keep-alive: a repeating trigger (ignored while it runs) + restart-on-failure.
    assert root.find("t:Triggers/t:TimeTrigger/t:Repetition/t:Interval", NS).text == RESTART_INTERVAL
    assert settings.find("t:RestartOnFailure/t:Count", NS).text == "999"


def test_arguments_quote_paths_with_spaces():
    assert _quote("plain") == "plain"
    assert _quote(r"C:\Program Files\x.yaml") == r'"C:\Program Files\x.yaml"'
    assert _quote('a "b"') == r'"a \"b\""'
    assert _quote("C:\\dir with space\\") == '"C:\\dir with space\\\\"'
    assert task_arguments("lights", r"C:\My Show\d.yaml", r"C:\l\lights.log").split(" --only ")[1] == r"lights --log-file C:\l\lights.log"


def test_install_validates_writes_utf16_and_starts(tmp_path):
    runner = FakeSchtasks()
    lines = _tasks(tmp_path, runner).install("show", HOUSE)
    xml = tmp_path / "stagehand-show.task.xml"
    raw = xml.read_bytes()
    assert raw[:2] in (b"\xff\xfe", b"\xfe\xff")  # schtasks reads UTF-16
    assert "--only show" in xml.read_text(encoding="utf-16")
    assert runner.calls == [
        ["schtasks", "/Create", "/TN", "Loom\\stagehand-show", "/XML", str(xml), "/F"],
        ["schtasks", "/End", "/TN", "Loom\\stagehand-show"],
        ["schtasks", "/Run", "/TN", "Loom\\stagehand-show"],
    ]
    assert (tmp_path / "logs").is_dir() and "installed" in lines[0]


def test_install_refuses_a_config_without_that_module_or_a_venv(tmp_path):
    runner = FakeSchtasks()
    with pytest.raises(ConfigError):
        _tasks(tmp_path, runner).install("agents", HOUSE)  # the house file has no agents: section
    ts = Tasks(stagehand_dir=ROOT, log_dir=tmp_path / "logs", user="u", run=runner, python=str(tmp_path / "missing" / "pythonw.exe"))
    with pytest.raises(ConfigError, match="uv sync"):
        ts.install("show", HOUSE)
    assert runner.calls == []


def test_restart_and_stop_touch_one_task_only(tmp_path):
    runner = FakeSchtasks()
    ts = _tasks(tmp_path, runner)
    ts.restart("lights")
    ts.stop("audio")
    assert runner.calls == [
        ["schtasks", "/Change", "/TN", "Loom\\stagehand-lights", "/ENABLE"],
        ["schtasks", "/End", "/TN", "Loom\\stagehand-lights"],
        ["schtasks", "/Run", "/TN", "Loom\\stagehand-lights"],
        # Disabled, or the keep-alive trigger would start it again within a minute.
        ["schtasks", "/Change", "/TN", "Loom\\stagehand-audio", "/DISABLE"],
        ["schtasks", "/End", "/TN", "Loom\\stagehand-audio"],
    ]
    with pytest.raises(ConfigError, match="is show installed"):
        _tasks(tmp_path, FakeSchtasks(fail={"/Run"})).restart("show")


def test_status_reads_schtasks_list_output(tmp_path):
    printed = "HostName:      DESKTOP\nTaskName:      \\Loom\\stagehand-show\nStatus:        Running\nLast Run Time: 10/31/2026 7:45:00 PM\nLast Result:   267009\n"
    lines = _tasks(tmp_path, FakeSchtasks(printed=printed)).status(["show"])
    assert lines[0].startswith("show    Running  last run 10/31/2026 7:45:00 PM  last result 267009")
    assert _tasks(tmp_path, FakeSchtasks(fail={"/Query"})).status(["lights"]) == ["lights  not installed"]
    assert _list_fields("Next Run Time: N/A")["next run time"] == "N/A"


def _ns(**kw) -> argparse.Namespace:
    return argparse.Namespace(**{"job": None, "config": None, **kw})


def test_the_cli_says_which_scheduler_this_platform_has(monkeypatch, capsys):
    monkeypatch.setattr(cli.sys, "platform", "darwin")
    assert cli._tasks(_ns(action="status")) == 2
    assert "Windows only" in capsys.readouterr().err
    monkeypatch.setattr(cli.sys, "platform", "win32")
    assert cli._launchd(_ns(action="restart", job="show")) == 2
    assert "stagehand tasks restart --job show" in capsys.readouterr().err


def test_the_cli_drives_an_injected_scheduler(tmp_path, capsys):
    runner = FakeSchtasks()
    ts = _tasks(tmp_path, runner)
    assert cli._tasks(_ns(action="restart"), ts) == 2  # needs --job
    assert cli._tasks(_ns(action="print", job="show", config=str(HOUSE)), ts) == 0
    assert "<LogonType>InteractiveToken</LogonType>" in capsys.readouterr().out
    assert cli._tasks(_ns(action="restart", job="show"), ts) == 0
    assert runner.calls[-1] == ["schtasks", "/Run", "/TN", "Loom\\stagehand-show"]


def test_log_file_logs_utf8_without_stderr(tmp_path, monkeypatch):
    """pythonw.exe has no stderr: the file is the task's only log, and
    the emoji in the log lines must not raise UnicodeEncodeError."""
    import logging

    root = logging.getLogger()
    saved = root.handlers[:]
    root.handlers.clear()
    monkeypatch.setattr(cli.sys, "stderr", None)
    try:
        log = tmp_path / "logs" / "audio.log"
        cli._logging(False, str(log))
        logging.getLogger("stagehand.audio").info("🔇 audio: stop — every sound")
        for h in root.handlers:
            h.flush()
        assert "🔇 audio: stop" in log.read_text(encoding="utf-8")
        assert all(not isinstance(h, logging.StreamHandler) or isinstance(h, logging.FileHandler) for h in root.handlers)
    finally:
        for h in root.handlers:
            h.close()
        root.handlers[:] = saved
