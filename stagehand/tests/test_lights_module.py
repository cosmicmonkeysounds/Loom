"""The `lights` module against a fake broker, a fake server and a virtual
clock: the step sequencer (timing, cancelling, `then: "restore"`, loops),
the safety clamp on the wire, tests / identify / pairing, the Z2M device list
→ the server, the D21 catch-up from the screen state, health, and the show
module's hand-off."""

from __future__ import annotations

import asyncio
import heapq
import json
from pathlib import Path

import pytest

from stagehand.config import parse_config
from stagehand.lights.config import parse_lights_section
from stagehand.lights.module import HouseLights, catch_up_look, cue_name
from stagehand.lights.routing import parse_lights
from stagehand.modapi import ModApiError
from stagehand.module import ConfigError

HERE = Path(__file__).parent
FIX = HERE / "fixtures" / "house-lights"
BASIC = json.loads((FIX / "lights-basic.json").read_text())
HOUSE = json.loads((FIX / "lights-house.json").read_text())
RGB = "zigbee2mqtt/server_room_rgb/set"


def _async(fn):
    """Run an async test on its own loop (the suite has no asyncio plugin)."""
    import functools

    @functools.wraps(fn)
    def run(*a, **k):
        return asyncio.run(fn(*a, **k))

    return run


class FakeTimer:
    def __init__(self) -> None:
        self.t = 0.0
        self._q: list = []
        self._n = 0

    def now(self) -> float:
        return self.t

    async def sleep_until(self, ms: float) -> None:
        if ms <= self.t:
            await asyncio.sleep(0)
            return
        fut = asyncio.get_running_loop().create_future()
        self._n += 1
        heapq.heappush(self._q, (ms, self._n, fut))
        await fut

    async def settle(self) -> None:
        for _ in range(20):
            await asyncio.sleep(0)

    async def advance(self, ms: float) -> None:
        end = self.t + ms
        await self.settle()
        while self._q and self._q[0][0] <= end:
            t, _, fut = heapq.heappop(self._q)
            self.t = t
            if not fut.done():
                fut.set_result(None)
            await self.settle()
        self.t = end
        await self.settle()


class FakeMqtt:
    def __init__(self, timer: FakeTimer) -> None:
        self.timer = timer
        self.log: list[tuple[float, str, dict]] = []
        self.retained: dict[str, str] = {}

    def publish(self, topic: str, payload: str, retain: bool = False, qos: int = 0) -> None:
        if retain:
            self.retained[topic] = payload
        self.log.append((self.timer.now(), topic, json.loads(payload)))


class FakeMod:
    def __init__(self, state=None, status: int | None = None) -> None:
        self.state = state
        self.status = status
        self.posts: list[tuple[str, dict]] = []
        self.gets: list[str] = []

    async def get(self, path, params=None, timeout=None):
        self.gets.append(path)
        if self.status is not None:
            raise ModApiError("nope", self.status)
        return self.state

    async def post(self, path, body):
        self.posts.append((path, body))
        return {"ok": True}


def _lights(timer: FakeTimer, doc=BASIC, mod=None) -> HouseLights:
    lights = HouseLights(parse_lights_section({}), timer=timer)
    lights.doc = parse_lights(doc)
    lights.house = HOUSE
    lights.mqtt = FakeMqtt(timer)
    lights.mod = mod
    return lights


def _on(log, topic=RGB):
    return [(t, p) for t, tp, p in log if tp == topic]


@_async
async def test_a_cue_plays_its_look_at_the_planned_offsets():
    timer = FakeTimer()
    lights = _lights(timer)
    assert lights.on_sim({"type": "directive", "verb": "cue", "args": "heart_wake"}) == "heart_wake"
    await timer.advance(5000)
    got = _on(lights.mqtt.log)
    assert [t for t, _ in got] == [0, 400, 800, 1200, 1600, 2400]
    assert got[0][1] == {"state": "ON", "brightness": 254, "color": {"hex": "#FF2A00"}, "transition": 0}
    assert got[-1][1] == {"brightness": 120, "color": {"hex": "#00E5FF"}, "transition": 3}
    # Unknown cues, screens cues and other verbs play nothing.
    assert lights.on_sim({"type": "directive", "verb": "cue", "args": "lights_y2k"}) is None
    assert lights.on_sim({"type": "directive", "verb": "sfx", "args": "heart_wake"}) is None
    assert cue_name("heart_wake, scene: x") == "heart_wake" and cue_name("  ") == ""


@_async
async def test_a_new_look_cancels_the_fixtures_running_steps():
    timer = FakeTimer()
    lights = _lights(timer)
    lights.play("heart_wake")
    await timer.advance(500)
    lights.play("heart_idle")
    await timer.advance(5000)
    got = _on(lights.mqtt.log)
    assert [t for t, _ in got] == [0, 400, 500]
    assert got[-1][1]["color"] == {"hex": "#00E5FF"} and got[-1][1]["brightness"] == 60


@_async
async def test_a_restore_look_gives_back_the_loop_it_interrupted():
    timer = FakeTimer()
    lights = _lights(timer)
    lights.play("heart_door_open")  # loop, period 2000: amber 254 at 0, 70 at 1000
    await timer.advance(2500)
    lights.play("heart_nag")  # 0: amber swell, then restore at 1500
    await timer.advance(1499)
    mark = len(lights.mqtt.log)
    await timer.advance(1)
    restarted = _on(lights.mqtt.log[mark:])
    assert restarted and restarted[0] == (4000, {"brightness": 254, "color": {"hex": "#FF6A00"}, "transition": 0.8})
    await timer.advance(1000)
    assert _on(lights.mqtt.log)[-1] == (5000, {"brightness": 70, "transition": 0.8})
    # The nag never became the settled state, nor did the loop.
    assert "server-room-rgb" not in lights.settled


@_async
async def test_a_restore_look_with_no_loop_gives_back_the_settled_state():
    timer = FakeTimer()
    lights = _lights(timer)
    lights.play("heart_idle")
    await timer.advance(100)
    lights.play("heart_warn")  # then restore, default period 1200 + 1000
    await timer.advance(2200)
    last = _on(lights.mqtt.log)[-1]
    # The give-back fades with heart_idle's own transition (3 s), never a snap.
    assert last == (2300, {"state": "ON", "brightness": 60, "color": {"hex": "#00E5FF"}, "transition": 3})
    assert lights.settled["server-room-rgb"] == {"state": "ON", "brightness": 60, "color": "#00E5FF", "transition": 3}


@_async
async def test_a_give_back_with_no_transition_fades_over_0_8_s():
    timer = FakeTimer()
    doc = json.loads(json.dumps(BASIC))
    del doc["looks"]["heart_idle"]["set"]["transition"]
    lights = _lights(timer, doc=doc)
    lights.play("heart_idle")
    await timer.advance(100)
    lights.play("heart_warn")
    await timer.advance(2200)
    assert _on(lights.mqtt.log)[-1] == (2300, {"state": "ON", "brightness": 60, "color": {"hex": "#00E5FF"}, "transition": 0.8})


@_async
async def test_a_new_look_over_a_restore_drops_its_restore():
    timer = FakeTimer()
    lights = _lights(timer)
    lights.play("heart_door_open")
    await timer.advance(100)
    lights.play("heart_nag")
    await timer.advance(200)
    lights.play("heart_idle")
    await timer.advance(10_000)
    assert [t for t, _ in _on(lights.mqtt.log)] == [0, 100, 300]


@_async
async def test_a_loop_repeats_until_another_look_and_a_repeat_stops():
    timer = FakeTimer()
    lights = _lights(timer)
    lights.play("heart_door_open")
    await timer.advance(6500)
    assert [t for t, _ in _on(lights.mqtt.log)] == [0, 1000, 2000, 3000, 4000, 5000, 6000]
    lights.play("tube_dim")  # repeat 3, period 2000, on hall-group only
    await timer.advance(10_000)
    assert [t for t, _ in _on(lights.mqtt.log, "zigbee2mqtt/hall_lights/set")] == [6500, 8500, 10500]
    # The door loop on the RGB bulb is untouched by a look on another fixture.
    assert _on(lights.mqtt.log)[-1][0] == 16000


@_async
async def test_the_safety_clamp_holds_on_the_wire():
    timer = FakeTimer()
    lights = _lights(timer)
    assert lights.run_test({"fixture": "server-room-rgb", "set": {"state": "OFF"}}) == "set server-room-rgb"
    assert lights.run_test({"fixture": "server-strip", "set": {"brightness": 1}}) == "set server-strip"
    assert lights.mqtt.log[0][1:] == (RGB, {"state": "ON", "brightness": 40})
    assert lights.mqtt.log[1][1:] == ("wled/server/api", {"bri": 50})


@_async
async def test_tests_identify_and_pairing():
    timer = FakeTimer()
    lights = _lights(timer)
    lights.play("heart_idle")
    await timer.advance(10)
    assert lights.run_test({"fixture": "server-room-rgb"}) == "identify server-room-rgb"
    assert lights.mqtt.log[-1][1:] == (RGB, {"effect": "okay"})
    lights.run_test({"fixture": "server-strip"})
    assert lights.mqtt.log[-1][1:] == ("wled/server/api", {"on": True, "seg": [{"fx": 1}]})
    await timer.advance(2000)
    assert lights.mqtt.log[-1][1:] == ("wled/server/api", {"seg": [{"fx": 0}]})
    assert lights.run_test({"look": "heart_nag"}) == "look heart_nag"
    assert lights.run_test({"look": "nope"}) == "no look nope"
    assert lights.run_test({"fixture": "nope"}) == "no fixture nope"
    lights.pair(120)
    assert lights.mqtt.log[-1][1:] == ("zigbee2mqtt/bridge/request/permit_join", {"time": 120})


def test_the_first_answer_primes_the_cursors_and_later_ones_are_new():
    lights = HouseLights(parse_lights_section({}), timer=FakeTimer())
    old = {"tests": [{"seq": 3, "at": 1000, "fixture": "x"}], "pair": {"seq": 2, "at": 900, "seconds": 120}}
    assert lights.take(old) == ([], None)
    assert lights.take(old) == ([], None)
    new = {"tests": [{"seq": 3, "at": 1000}, {"seq": 4, "at": 2000, "look": "heart_idle"}], "pair": {"seq": 3, "at": 2500, "seconds": 0}}
    tests, pair = lights.take(new)
    assert [t["seq"] for t in tests] == [4] and pair["seconds"] == 0
    # A restarted server answering at once with nothing: the cursors start over.
    assert lights.take({"tests": [], "pair": None}, immediate=True) == ([], None)
    assert lights.test_seq == 0 and lights.pair_seq == 0


@_async
async def test_the_device_list_goes_to_the_server_debounced():
    timer = FakeTimer()
    mod = FakeMod()
    lights = _lights(timer, mod=mod)
    lights.devices_debounce_s = 0.01
    devices = [{"ieee_address": "0x1", "type": "Router", "friendly_name": "server_room_rgb", "definition": {"model": "m", "vendor": "v", "description": "d", "exposes": [{"type": "light", "features": [{"name": "brightness"}]}]}}]
    lights.on_mqtt("zigbee2mqtt/bridge/devices", json.dumps(devices).encode())
    lights.on_mqtt("zigbee2mqtt/bridge/groups", b"[]")
    lights.on_mqtt("zigbee2mqtt/bridge/state", b'{"state":"online"}')
    await asyncio.sleep(0.05)
    assert len(mod.posts) == 1
    path, body = mod.posts[0]
    assert path == "/api/mod/lights/devices"
    assert body["devices"][0]["friendly"] == "server_room_rgb" and body["devices"][0]["caps"] == {"color": False, "ct": False, "dim": True}
    assert lights.stats()["z2m"] == "online" and lights.stats()["devices"] == 1


@pytest.mark.parametrize(
    ("night", "look"),
    [
        ({"alarm_on": True, "server_door": "open", "heart_stage": "talk", "heart_look": "heart_listen"}, "heart_alarm"),
        ({"alarm_on": False, "server_door": "open", "heart_stage": "scan", "heart_look": "heart_sealed"}, "heart_door_open"),
        ({"alarm_on": None, "server_door": "open", "heart_stage": "sealed", "heart_look": "heart_argue"}, "heart_argue"),
        ({"alarm_on": False, "server_door": "closed", "heart_stage": "talk", "heart_look": None}, "heart_idle"),
        ({"phase": "y2k"}, "heart_idle"),
    ],
)
def test_the_catch_up_reads_the_story(night, look):
    assert catch_up_look({"night": night}, parse_lights(BASIC))[0] == look
    assert catch_up_look(None, parse_lights(BASIC))[0] == "heart_idle"


@_async
async def test_the_catch_up_plays_the_storys_look_and_an_old_server_gets_boot():
    timer = FakeTimer()
    doc = json.loads(json.dumps(BASIC))
    doc["looks"]["heart_alarm"] = doc["looks"]["server_alarm"]
    lights = _lights(timer, doc=doc, mod=FakeMod({"night": {"alarm_on": True}}))
    assert await lights.catch_up("mqtt") == "heart_alarm"
    lights2 = _lights(timer, mod=FakeMod(status=404))
    assert await lights2.catch_up("start") == "heart_idle"


@_async
async def test_a_live_cue_during_the_catch_up_wins():
    timer = FakeTimer()

    class SlowMod(FakeMod):
        async def get(self, path, params=None, timeout=None):
            lights.on_sim({"type": "directive", "verb": "cue", "args": "heart_wake"})
            return {"night": {"heart_look": "heart_idle"}}

    lights = _lights(timer, mod=SlowMod())
    assert await lights.catch_up("feed") is None
    assert lights.last_look == "heart_wake"


@_async
async def test_a_story_restart_stops_every_look_and_catches_up():
    timer = FakeTimer()
    lights = _lights(timer, mod=FakeMod({"night": {"server_door": "closed", "heart_stage": "sealed", "heart_look": None, "alarm_on": False}}))
    lights.catch_up_delay_s = 0.01
    lights.play("heart_door_open")
    lights.play("heart_wake")
    await timer.advance(10)
    lights.on_lifecycle({"kind": "reset"})
    assert lights.running == {} and lights.settled == {}
    await asyncio.sleep(0.05)
    assert lights.last_look == "heart_idle"


def test_the_section_parses_and_refuses_typos(tmp_path):
    cfg = parse_lights_section({"mqtt": {"host": "127.0.0.1"}, "config_file": "x.json"}, str(tmp_path))
    assert cfg.mqtt.client_id == "stagehand-lights" and cfg.config_file == str(tmp_path / "x.json") and cfg.take_looks
    for bad in ({"take_look": True}, {"poll_wait": 99}, {"mqtt": {}}, {"take_looks": "yes"}, []):
        with pytest.raises(ConfigError):
            parse_lights_section(bad)


def test_the_show_hands_its_cue_rules_to_the_lights_module(tmp_path):
    (tmp_path / "lights.json").write_text(json.dumps({"version": 1, "fixtures": [], "zones": [], "looks": {"heart_idle": {"to": [], "set": {"state": "ON"}}}}))
    doc = {
        "server": {"url": "http://x", "mod_token": "t"},
        "show": {"mqtt": {"host": "h"}, "cues": [
            {"on": {"directive": "cue"}, "match": {"target": "heart_idle"}, "mqtt": {"topic": "a"}},
            {"on": {"directive": "cue"}, "match": {"target": "lights_y2k"}, "mqtt": {"topic": "b"}},
        ]},
        "lights": {"config_file": "lights.json"},
    }
    show = parse_config(doc, base_dir=str(tmp_path)).modules["show"]
    assert [r.match["target"] for r in show.cfg.cues] == ["lights_y2k"]
    assert show.ask_lights and show.looks_handed_off == {"heart_idle"}
    doc["lights"]["take_looks"] = False
    show = parse_config(doc, base_dir=str(tmp_path)).modules["show"]
    assert len(show.cfg.cues) == 2 and not show.ask_lights
    # The server's looks, later: the same drop.
    assert show.hand_looks_to_lights({"lights_y2k"}) == 1 and show.cfg.cues[0].match["target"] == "heart_idle"
