"""Zigbee flow control: a backlog can't form, however long a look loops or how
many bulbs stop answering (the night of 2026-10-29), and a stalled Zigbee2MQTT
is restarted and the look played again."""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path

import pytest

from stagehand.config import load_config
from stagehand.lights.config import parse_lights_section
from stagehand.lights.module import HouseLights
from stagehand.lights.pacer import ACK_MS, FAILS_TO_DARK, MAX_IN_FLIGHT, NO_ECHO_MS, PROBE_MS, Pacer, merge_pending
from stagehand.lights.routing import parse_lights
from stagehand.module import ConfigError

from test_lights_module import BASIC, HOUSE, FakeMod, FakeMqtt, FakeTimer, _async

Z2M = "zigbee2mqtt"
ROOT = Path(__file__).resolve().parents[1]


class Clock:
    def __init__(self) -> None:
        self.t = 0.0
        self.sent: list[tuple[float, str, dict]] = []
        self.dark: list[tuple[str, bool]] = []

    def pacer(self) -> Pacer:
        return Pacer(lambda topic, payload: self.sent.append((self.t, topic, payload)), lambda: self.t, on_dark=lambda d, on: self.dark.append((d, on)))


def _send(p: Pacer, device: str, payload: dict) -> None:
    p.send(device, f"{Z2M}/{device}/set", payload)


def test_an_idle_bulb_gets_a_cue_at_once_and_an_echo_frees_it_for_the_next():
    c = Clock()
    p = c.pacer()
    _send(p, "a", {"color": {"hex": "#112233"}})
    assert c.sent == [(0.0, f"{Z2M}/a/set", {"color": {"hex": "#112233"}})]
    _send(p, "a", {"brightness": 10})
    assert len(c.sent) == 1 and p.waiting() == 1
    c.t = 120
    p.acked("a")
    assert c.sent[-1] == (120, f"{Z2M}/a/set", {"brightness": 10}) and p.waiting() == 0


def test_a_bulb_never_holds_more_than_one_state_however_long_the_loop_runs():
    """The failure: a loop over a bulb that answers nothing, all night."""
    c = Clock()
    p = c.pacer()
    hours = 12
    for i in range(hours * 3600 // 5):
        c.t = i * 5000.0
        _send(p, "dead", {"color": {"hex": f"#{i % 256:02x}0000"}, "transition": 5})
        p.tick()
    assert p.waiting() <= 1 and p.superseded > 7000
    # ~one probe every 30 s after the first three, never the 8640 the look sent.
    assert len(c.sent) <= FAILS_TO_DARK + hours * 3600 * 1000 / PROBE_MS + 2
    assert p.dark() == ["dead"] and c.dark == [("dead", True)]


def test_the_house_never_has_more_than_the_cap_in_flight_and_the_rest_keep_their_turn():
    c = Clock()
    p = c.pacer()
    names = [f"b{i}" for i in range(MAX_IN_FLIGHT + 3)]
    for n in names:
        _send(p, n, {"brightness": 1})
    assert [t.split("/")[1] for _, t, _ in c.sent] == names[:MAX_IN_FLIGHT] and p.in_flight() == MAX_IN_FLIGHT
    p.acked("b0")
    assert c.sent[-1][1] == f"{Z2M}/{names[MAX_IN_FLIGHT]}/set"


def test_a_dead_bulb_goes_dark_and_comes_back_with_its_newest_state():
    c = Clock()
    p = c.pacer()
    for i in range(FAILS_TO_DARK):
        _send(p, "a", {"brightness": i})
        c.t += ACK_MS
        p.tick()
    assert p.is_dark("a")
    n = len(c.sent)
    _send(p, "a", {"brightness": 77})
    assert len(c.sent) == n  # the probe's 30 s are not up
    c.t += PROBE_MS
    p.tick()
    assert c.sent[-1][2] == {"brightness": 77} and len(c.sent) == n + 1
    _send(p, "a", {"brightness": 78})
    p.acked("a")
    assert not p.is_dark("a") and c.sent[-1][2] == {"brightness": 78} and c.dark == [("a", True), ("a", False)]


def test_z2m_saying_online_frees_a_dark_bulb_at_once():
    c = Clock()
    p = c.pacer()
    for i in range(FAILS_TO_DARK):
        _send(p, "a", {"brightness": i})
        c.t += ACK_MS
        p.tick()
    assert p.is_dark("a")
    _send(p, "a", {"brightness": 2})
    p.came_back("a")
    assert not p.is_dark("a") and c.sent[-1][2] == {"brightness": 2}


def test_an_effect_has_no_echo_so_it_frees_the_bulb_and_is_no_failure():
    c = Clock()
    p = c.pacer()
    for _ in range(FAILS_TO_DARK + 2):
        _send(p, "a", {"effect": "breathe"})
        c.t += NO_ECHO_MS
        p.tick()
    assert not p.is_dark("a") and len(c.sent) == FAILS_TO_DARK + 2


def test_paused_holds_the_newest_state_and_reset_forgets_what_z2m_lost():
    c = Clock()
    p = c.pacer()
    _send(p, "a", {"brightness": 1})
    p.paused = True
    p.reset()
    _send(p, "a", {"brightness": 2})
    assert len(c.sent) == 1 and p.in_flight() == 0
    p.paused = False
    p.pump()
    assert c.sent[-1][2] == {"brightness": 2}


def test_a_newer_command_replaces_what_it_contradicts():
    assert merge_pending({"color": {"hex": "#000000"}, "brightness": 5}, {"color_temp": 370}) == {"brightness": 5, "color_temp": 370}
    assert merge_pending({"color_temp": 370}, {"color": {"hex": "#000000"}}) == {"color": {"hex": "#000000"}}
    assert merge_pending({"brightness": 5, "color": {"hex": "#000000"}, "transition": 1}, {"state": "OFF"}) == {"transition": 1, "state": "OFF"}
    assert merge_pending({"state": "OFF"}, {"state": "ON", "brightness": 9}) == {"state": "ON", "brightness": 9}


# -- the module ----------------------------------------------------------------


def _paced(timer: FakeTimer, **section) -> HouseLights:
    lights = HouseLights(parse_lights_section(section), timer=timer)
    lights.doc = parse_lights(BASIC)
    lights.house = HOUSE
    lights.mqtt = FakeMqtt(timer)
    return lights


def _sets(lights: HouseLights, device: str) -> list[dict]:
    return [p for _, t, p in lights.mqtt.log if t == f"{Z2M}/{device}/set"]


@_async
async def test_the_module_holds_a_bulb_until_its_echo_and_merges_what_a_look_sent_meanwhile():
    timer = FakeTimer()
    lights = _paced(timer)
    lights.play("heart_wake")
    await timer.advance(1000)  # the look's steps at 0, 400, 800: only the first went out
    assert len(_sets(lights, "server_room_rgb")) == 1
    lights.on_mqtt(f"{Z2M}/server_room_rgb", b'{"state":"ON"}')
    got = _sets(lights, "server_room_rgb")
    assert len(got) == 2 and got[1].get("transition") is not None


@_async
async def test_a_fixture_z2m_does_not_know_is_not_sent_but_still_counts_as_shown():
    timer = FakeTimer()
    lights = _paced(timer)
    lights.device_names = {"something_else"}
    lights.play("heart_wake")
    await timer.advance(100)
    assert _sets(lights, "server_room_rgb") == [] and "server-room-rgb" in lights.shown
    lights.device_names = set()  # no list yet: Z2M hasn't told us, so send
    lights.play("heart_wake")
    await timer.advance(100)
    assert len(_sets(lights, "server_room_rgb")) == 1


@_async
async def test_pace_false_is_the_kill_switch():
    timer = FakeTimer()
    lights = _paced(timer, pace=False)
    lights.play("heart_wake")
    await timer.advance(1000)
    assert len(_sets(lights, "server_room_rgb")) == 3


@_async
async def test_a_stale_offline_never_holds_a_cue_back():
    """After a restart Z2M says offline for bulbs that are fine (the drill)."""
    timer = FakeTimer()
    lights = _paced(timer)
    lights.on_mqtt(f"{Z2M}/server_room_rgb/availability", b'{"state":"offline"}')
    assert lights.pacer.dark() == [] and lights.stats()["dark"] == []
    lights.play("heart_wake")
    await timer.advance(100)
    assert len(_sets(lights, "server_room_rgb")) == 1
    lights.on_mqtt(f"{Z2M}/bridge/availability", b'{"state":"offline"}')  # never a bulb
    assert "bridge" not in lights.pacer.slots


class Ran:
    def __init__(self, returncode: int = 0) -> None:
        self.calls: list[list[str]] = []
        self.returncode = returncode

    def __call__(self, argv):
        self.calls.append(argv)
        return subprocess.CompletedProcess(argv, self.returncode, "", "denied" if self.returncode else "")


def _watched(timer: FakeTimer, mod=None, ran: Ran | None = None) -> tuple[HouseLights, Ran]:
    lights = _paced(timer, z2m_task="Loom\\zigbee2mqtt")
    lights.mod = mod
    lights.run_cmd = ran = ran or Ran()
    lights.z2m_end_wait_s = 0
    return lights, ran


@_async
async def test_a_silent_z2m_is_restarted_once_and_a_healthy_one_never():
    timer = FakeTimer()
    lights, ran = _watched(timer)
    task = asyncio.ensure_future(lights._z2m_loop())
    await timer.advance(1)
    for _ in range(10):
        await timer.advance(15_000)
        lights.on_mqtt(f"{Z2M}/bridge/response/health_check", b'{"data":{"healthy":true},"status":"ok"}')
    assert ran.calls == [] and any(t.endswith("/bridge/request/health_check") for _, t, _ in lights.mqtt.log)
    await timer.advance(90_000)
    await asyncio.sleep(0.05)
    assert ran.calls == [["schtasks", "/End", "/TN", "Loom\\zigbee2mqtt"], ["schtasks", "/Run", "/TN", "Loom\\zigbee2mqtt"]]
    assert lights.z2m_restarts == 1
    await timer.advance(90_000)  # still inside the grace: Z2M gets its time to come back
    await asyncio.sleep(0.05)
    assert lights.z2m_restarts == 1
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


@_async
async def test_a_broker_that_is_down_is_not_z2ms_fault():
    timer = FakeTimer()
    lights, ran = _watched(timer)

    class Down:
        @staticmethod
        def is_set():
            return False

    lights.mqtt.connected = Down
    timer.t = 600_000
    assert await lights.check_z2m() is False and ran.calls == []


@_async
async def test_no_task_only_logs_and_a_failed_restart_is_no_crash(caplog):
    timer = FakeTimer()
    lights = _paced(timer)
    lights.run_cmd = ran = Ran()
    timer.t = 600_000
    assert await lights.check_z2m() is False and ran.calls == [] and "restart it by hand" in caplog.text
    lights, ran = _watched(timer, ran=Ran(returncode=1))
    timer.t += 600_000
    assert await lights.check_z2m() is False and "denied" in caplog.text


@_async
async def test_z2m_coming_back_flushes_what_waited_and_plays_the_look_again():
    timer = FakeTimer()
    mod = FakeMod({"night": {"heart_look": "heart_idle", "server_door": "closed", "alarm_on": False}})
    lights, _ = _watched(timer, mod=mod)
    online, offline = b'{"state":"online"}', b'{"state":"offline"}'
    lights.on_mqtt(f"{Z2M}/bridge/state", online)  # the first news: no catch-up
    await asyncio.sleep(0)
    assert mod.gets == []
    lights.on_mqtt(f"{Z2M}/bridge/state", offline)
    assert lights.pacer.paused
    lights._send("server-room-rgb", {"brightness": 90})
    assert _sets(lights, "server_room_rgb") == []
    lights.on_mqtt(f"{Z2M}/bridge/state", online)
    assert not lights.pacer.paused and _sets(lights, "server_room_rgb") == [{"brightness": 90}]
    await asyncio.sleep(0.01)
    assert mod.gets == ["/api/screen/state"] and lights.last_look == "heart_idle"


def test_the_section_validates():
    cfg = parse_lights_section({})
    assert cfg.pace is True and cfg.z2m_task is None and cfg.z2m_check_s == 15 and cfg.z2m_stall_s == 60
    for bad in ({"pace": "yes"}, {"z2m_task": ""}, {"z2m_stall_s": 0}, {"z2m_check_s": True}):
        with pytest.raises(ConfigError):
            parse_lights_section(bad)


def test_the_desktop_restarts_the_real_task():
    env = {"LOOM_SERVER_URL": "https://x.example.com", "LOOM_EVENT_ID": "e", "LOOM_MOD_PASSCODE": "p"}
    cfg = load_config(ROOT / "trapped.desktop.yaml", only=["lights"], env=env)
    assert cfg.modules["lights"].cfg.z2m_task == "Loom\\zigbee2mqtt" and cfg.modules["lights"].cfg.pace is True


def test_the_z2m_task_runs_the_real_node_so_ending_it_ends_z2m():
    script = (ROOT.parent / "scripts/house-desktop/zigbee2mqtt.ps1").read_text(encoding="utf-8")
    assert "process.execPath" in script and "New-ScheduledTaskAction -Execute $real" in script


def test_no_console_window_can_open_on_the_tv(monkeypatch):
    import stagehand.lights.module as m

    seen: dict = {}

    def fake(argv, **k):
        seen.update(k)
        return subprocess.CompletedProcess(argv, 0, "", "")

    monkeypatch.setattr(m.subprocess, "run", fake)
    monkeypatch.setattr(m.subprocess, "CREATE_NO_WINDOW", 0x08000000, raising=False)
    m.run_hidden(["schtasks"])
    assert seen["creationflags"] == 0x08000000 and seen["timeout"] > 0

