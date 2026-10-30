"""launchd jobs: one per module, so `show` and `agents` on the one house Mac
restart independently. Nothing here touches the real launchd."""

from __future__ import annotations

import asyncio
import plistlib
import subprocess
from pathlib import Path

import httpx
import pytest

from stagehand.config import ConfigError
from stagehand.launchd import JOBS, Launchd, job_plist, label_for
from stagehand.modapi import STREAM_READ_TIMEOUT_S, ModClient

ROOT = Path(__file__).resolve().parents[1]
HOUSE = ROOT / "trapped.house.yaml"
AGENTS = ROOT / "agents.example.yaml"


class FakeLaunchctl:
    def __init__(self, fail: set[str] | None = None, printed: str = "") -> None:
        self.calls: list[list[str]] = []
        self.fail = fail or set()
        self.printed = printed

    def __call__(self, argv):
        self.calls.append(list(argv))
        code = 1 if argv[1] in self.fail else 0
        return subprocess.CompletedProcess(list(argv), code, stdout=self.printed, stderr="nope" if code else "")


def _ld(tmp_path: Path, runner: FakeLaunchctl) -> Launchd:
    return Launchd(stagehand_dir=ROOT, agents_dir=tmp_path / "LaunchAgents", log_dir=tmp_path / "logs", uid=501, sleep=lambda s: None, run=runner, uv="/opt/uv/bin/uv")


def test_each_module_is_its_own_job_with_its_own_log():
    plists = {
        job: job_plist(job, Path("/h/x.yaml"), stagehand_dir=ROOT, uv="/u/uv", log_dir=Path("/logs"), path_env="/u:/usr/bin")
        for job in JOBS
    }
    assert {p["Label"] for p in plists.values()} == {label_for("show"), label_for("agents"), label_for("audio"), label_for("lights")}
    for job, p in plists.items():
        args = p["ProgramArguments"]
        assert args[:2] == ["/u/uv", "run"] and args[-2:] == ["--only", job]
        assert p["StandardOutPath"] == f"/logs/{job}.log" == p["StandardErrorPath"]
        assert p["KeepAlive"] is True and p["RunAtLoad"] is True and p["ThrottleInterval"] >= 5
    with pytest.raises(ConfigError):
        job_plist("vision", Path("/x"), stagehand_dir=ROOT, uv="u", log_dir=Path("/l"), path_env="")


def test_install_validates_writes_and_bootstraps(tmp_path):
    runner = FakeLaunchctl()
    lines = _ld(tmp_path, runner).install("show", HOUSE)
    path = tmp_path / "LaunchAgents" / f"{label_for('show')}.plist"
    plist = plistlib.loads(path.read_bytes())
    assert plist["ProgramArguments"][-4:] == ["--config", str(HOUSE), "--only", "show"]
    assert "/opt/uv/bin" in plist["EnvironmentVariables"]["PATH"].split(":")
    assert runner.calls == [
        ["launchctl", "bootout", f"gui/501/{label_for('show')}"],
        ["launchctl", "bootstrap", "gui/501", str(path)],
    ]
    assert (tmp_path / "logs").is_dir() and "installed" in lines[0]


def test_install_refuses_a_config_without_that_module(tmp_path):
    runner = FakeLaunchctl()
    with pytest.raises(ConfigError):
        _ld(tmp_path, runner).install("agents", HOUSE)  # the house file has no agents: section
    assert runner.calls == [] and not (tmp_path / "LaunchAgents").exists()


def test_the_agents_job_runs_only_agents(tmp_path):
    plist = _ld(tmp_path, FakeLaunchctl()).render("agents", AGENTS)
    assert plist["ProgramArguments"][-2:] == ["--only", "agents"]


def test_restart_touches_one_job_only(tmp_path):
    runner = FakeLaunchctl()
    _ld(tmp_path, runner).restart("agents")
    assert runner.calls == [["launchctl", "kickstart", "-k", f"gui/501/{label_for('agents')}"]]
    with pytest.raises(ConfigError):
        _ld(tmp_path, FakeLaunchctl(fail={"kickstart"})).restart("show")


def test_install_waits_for_a_running_copy_to_stop(tmp_path):
    # `bootout` returns before the job is gone; a bootstrap until then is error 5.
    class Stopping(FakeLaunchctl):
        busy = 3

        def __call__(self, argv):
            done = super().__call__(argv)
            if argv[1] == "bootstrap" and self.busy:
                self.busy -= 1
                done.returncode = 5
            return done

    runner = Stopping()
    _ld(tmp_path, runner).install("show", HOUSE)
    assert sum(c[1] == "bootstrap" for c in runner.calls) == 4


def test_install_gives_up_on_a_job_that_never_loads(tmp_path):
    runner = FakeLaunchctl(fail={"bootstrap"})
    with pytest.raises(ConfigError, match="bootstrap failed"):
        _ld(tmp_path, runner).install("show", HOUSE)
    assert sum(c[1] == "bootstrap" for c in runner.calls) == 30


def test_status_and_uninstall(tmp_path):
    printed = f"gui/501/{label_for('show')} = {{\n\tactive count = 1\n\tstate = running\n\tpid = 4242\n\t\tnested = x\n}}\n"
    lines = _ld(tmp_path, FakeLaunchctl(printed=printed)).status(["show"])
    assert lines == ["show    running  pid 4242  last exit —"]
    assert _ld(tmp_path, FakeLaunchctl(fail={"print"})).status(["agents"]) == ["agents  not installed"]
    runner = FakeLaunchctl()
    ld = _ld(tmp_path, runner)
    ld.install("show", HOUSE)
    ld.uninstall("show")
    assert not ld.plist_path("show").exists()


def test_a_silent_stream_is_dropped_so_a_wan_outage_reconnects():
    # The server pings every 25 s; a minute of silence means the link is dead.
    assert ModClient("https://x").stream_read_timeout == STREAM_READ_TIMEOUT_S
    assert 25 * 2 <= STREAM_READ_TIMEOUT_S <= 90


def test_a_stream_that_goes_silent_raises_instead_of_hanging():
    """The WAN pull: headers arrived, then nothing (no FIN, no RST)."""

    async def scenario() -> None:
        async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n")
            frame = b"event: hello\ndata: {}\n\n"
            writer.write(b"%x\r\n%s\r\n" % (len(frame), frame))
            await writer.drain()
            await asyncio.sleep(30)  # the link is dead

        server = await asyncio.start_server(handler, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        client = ModClient(f"http://127.0.0.1:{port}", token="t", stream_read_timeout=0.3)
        frames = []
        try:
            with pytest.raises(httpx.ReadTimeout):
                async with asyncio.timeout(5):
                    async for frame in client.stream(f"http://127.0.0.1:{port}/events"):
                        frames.append(frame)
        finally:
            server.close()
            await client.aclose()
        assert frames == [("hello", "{}")]

    asyncio.run(scenario())
