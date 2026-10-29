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
from stagehand.lights.module import HouseLights, catch_up_house, catch_up_look, cue_name
from stagehand.lights.routing import parse_lights
from stagehand.modapi import ModApiError
from stagehand.module import ConfigError

HERE = Path(__file__).parent
FIX = HERE / "fixtures" / "house-lights"
BASIC = json.loads((FIX / "lights-basic.json").read_text(encoding="utf-8"))
HOUSE = json.loads((FIX / "lights-house.json").read_text(encoding="utf-8"))
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
    assert lights.mqtt.log[1][1:] == ("wled/bench/api", {"bri": 50})


@_async
async def test_tests_identify_and_pairing():
    timer = FakeTimer()
    lights = _lights(timer)
    lights.play("heart_idle")
    await timer.advance(10)
    assert lights.run_test({"fixture": "server-room-rgb"}) == "identify server-room-rgb"
    assert lights.mqtt.log[-1][1:] == (RGB, {"effect": "okay"})
    lights.run_test({"fixture": "server-strip"})
    assert lights.mqtt.log[-1][1:] == ("wled/bench/api", {"on": True, "bri": 255, "seg": [{"col": [[255, 255, 255]], "fx": 0}]})
    await timer.advance(2000)
    assert lights.mqtt.log[-1][1:] == ("wled/bench/api", {"seg": [{"fx": 0}]})
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


def _with_house_looks() -> dict:
    doc = json.loads(json.dumps(BASIC))
    doc["looks"]["lights_game"] = {"to": ["desk-lamp"], "set": {"state": "ON", "brightness": 200}}
    doc["looks"]["lights_y2k"] = {"to": ["desk-lamp"], "set": {"state": "ON", "color_temp": 450, "brightness": 90}}
    doc["looks"]["lights_tube_chase"] = {"to": ["desk-lamp"], "steps": [{"at": 0, "set": {"state": "ON", "brightness": 254}}], "then": "restore"}
    return doc


@pytest.mark.parametrize(
    ("value", "look"),
    [("game", "lights_game"), ("server_open", "lights_y2k"), ("none", None), (None, None), ("dance", None), ("tube_chase", None)],
)
def test_the_catch_up_reads_the_house_look(value, look):
    """Wave 31: `night.lights` → `lights_<value>` when lights.json has it (server_open is Y2K's house)."""
    night = {"lights": value} if value is not None else {}
    assert catch_up_house({"night": night}, parse_lights(_with_house_looks()))[0] == look
    assert catch_up_house(None, parse_lights(_with_house_looks()))[0] is None


@_async
async def test_the_catch_up_plays_the_house_look_then_the_heart_look():
    timer = FakeTimer()
    lights = _lights(timer, doc=_with_house_looks(), mod=FakeMod({"night": {"lights": "game", "heart_look": "heart_wake", "server_door": "closed", "alarm_on": False}}))
    assert await lights.catch_up("mqtt") == "heart_wake"
    assert lights.running["desk-lamp"].name == "lights_game"
    assert lights.running["server-room-rgb"].name == "heart_wake"


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


@pytest.mark.parametrize("kind", ["reset", "reload", "golive"])
def test_a_story_restart_stops_every_look_and_catches_up(kind):
    asyncio.run(_restart_catches_up(kind))


async def _restart_catches_up(kind):
    timer = FakeTimer()
    lights = _lights(timer, mod=FakeMod({"night": {"server_door": "closed", "heart_stage": "sealed", "heart_look": None, "alarm_on": False}}))
    lights.catch_up_delay_s = 0.01
    lights.play("heart_door_open")
    lights.play("heart_wake")
    await timer.advance(10)
    lights.on_lifecycle({"kind": kind})
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
    (tmp_path / "lights.json").write_text(json.dumps({"version": 1, "fixtures": [], "zones": [], "looks": {"heart_idle": {"to": [], "set": {"state": "ON"}}}}), encoding="utf-8")
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


def test_a_pause_is_no_restart():
    lights = _lights(FakeTimer())
    lights.settled["server-room-rgb"] = {"state": "ON"}
    lights.on_lifecycle({"kind": "pause"})
    assert lights.settled == {"server-room-rgb": {"state": "ON"}}


@_async
async def test_a_restore_after_a_restart_gives_back_the_boot_look():
    """Nothing settled since a restart: a nag / warn ends on `boot`, never on
    its own last step (a full red swell left on the bulb)."""
    timer = FakeTimer()
    lights = _lights(timer)
    lights.stop_all()
    lights.play("heart_warn")
    await timer.advance(2200)
    assert lights.last_look == "heart_idle"
    assert _on(lights.mqtt.log)[-1][1] == {"state": "ON", "brightness": 60, "color": {"hex": "#00E5FF"}, "transition": 3}
    assert lights.running["server-room-rgb"].name == "heart_idle"


def test_the_catch_up_never_lands_on_a_restore_look():
    doc = parse_lights(BASIC)
    for look in ("heart_nag", "heart_warn"):
        got, why = catch_up_look({"night": {"heart_look": look, "server_door": "closed", "alarm_on": False}}, doc)
        assert got == "heart_idle" and look in why


@_async
async def test_health_publishes_the_stats_retained():
    timer = FakeTimer()
    lights = _lights(timer)
    import dataclasses

    lights.cfg = dataclasses.replace(lights.cfg, health_s=0.01)
    lights.play("heart_idle")
    task = asyncio.ensure_future(lights._health_loop())
    await asyncio.sleep(0.05)
    task.cancel()
    stats = json.loads(lights.mqtt.retained["health/lights/stats"])
    assert set(stats) == {"fixtures", "looks", "devices", "last_look", "last_at", "z2m", "pulsed", "shown_posts"}
    assert stats["fixtures"] == 5 and stats["last_look"] == "heart_idle"


def test_the_broker_link_announces_health_lights_online_and_its_will_lost():
    from stagehand.show.mqtt import MqttBridge

    loop = asyncio.new_event_loop()
    try:
        bridge = MqttBridge("127.0.0.1", 1883, filters=["zigbee2mqtt/bridge/state"], loop=loop, client_id="t", health_topic="health/lights")
        will = bridge._client._will_topic
        assert (will.decode() if isinstance(will, bytes) else will) == "health/lights"
        assert bridge._client._will_payload == b"lost" and bridge._client._will_retain

        sent: list[tuple] = []

        class Client:
            def publish(self, topic, payload, retain=False):
                sent.append((topic, payload, retain))

            def subscribe(self, f):
                pass

        bridge._on_connect(Client(), None, None, 0, None)
        assert sent[0] == ("health/lights", "online", True)
    finally:
        loop.close()


@_async
async def test_a_broker_or_feed_reconnect_catches_the_lights_up(tmp_path, monkeypatch):
    """§1.5: the module's run() wires both reconnects to the catch-up."""
    import stagehand.lights.module as mod_module
    import stagehand.show.mqtt as mqtt_module

    bridges: list = []

    class FakeBridge:
        def __init__(self, *a, **k):
            self.kwargs = k
            self.queue: asyncio.Queue = asyncio.Queue()
            self.connected = asyncio.Event()
            self.connected.set()
            self.on_connected = None
            self.retained: dict = {}
            bridges.append(self)

        def publish(self, topic, payload, retain=False, qos=0):
            pass

        def start(self):
            pass

        def stop(self):
            pass

    feeds: list = []

    async def fake_stream(mod, url, on_frame, label="", on_connect=None):
        feeds.append(on_connect)
        await asyncio.Event().wait()

    monkeypatch.setattr(mqtt_module, "MqttBridge", FakeBridge)
    monkeypatch.setattr(mod_module, "run_stream", fake_stream)
    (tmp_path / "lights.json").write_text(json.dumps(BASIC), encoding="utf-8")

    class Mod(FakeMod):
        def feed_url(self, name):
            return "feed"

        async def get(self, path, params=None, timeout=None):
            self.gets.append(path)
            if path == "/api/screen/state":
                return {"night": {"heart_look": "heart_idle", "server_door": "closed", "alarm_on": False}}
            raise ModApiError("old server", 404)

    server = Mod()
    lights = HouseLights(parse_lights_section({"mqtt": {"host": "h"}, "config_file": "lights.json", "cache_dir": "cache"}, str(tmp_path)))

    class Ctx:
        mod = server

    task = asyncio.ensure_future(lights.run(Ctx()))
    await asyncio.sleep(0.05)
    assert bridges and bridges[0].kwargs["health_topic"] == "health/lights" and feeds
    start = server.gets.count("/api/screen/state")
    assert start == 1  # the start catch-up
    bridges[0].on_connected()
    await asyncio.sleep(0.05)
    assert server.gets.count("/api/screen/state") == 2 and lights.last_look == "heart_idle"
    feeds[0]()
    await asyncio.sleep(0.05)
    assert server.gets.count("/api/screen/state") == 3
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("kind", ["reset", "reload", "golive"])
def test_the_show_re_asks_the_looks_on_every_restart(tmp_path, kind):
    asyncio.run(_show_re_asks(tmp_path, kind))


async def _show_re_asks(tmp_path, kind):
    (tmp_path / "lights.json").write_text(json.dumps({"version": 1, "fixtures": [], "zones": [], "looks": {}}), encoding="utf-8")
    doc = {
        "server": {"url": "http://x", "mod_token": "t"},
        "show": {"mqtt": {"host": "h"}, "cues": [
            {"on": {"directive": "cue"}, "match": {"target": "heart_new"}, "mqtt": {"topic": "a"}},
            {"on": {"directive": "cue"}, "match": {"target": "lights_y2k"}, "mqtt": {"topic": "b"}},
        ]},
        "lights": {"config_file": "lights.json"},
    }
    show = parse_config(doc, base_dir=str(tmp_path)).modules["show"]
    show.catch_up_delay_s = 0.01
    show.mod = FakeMod({"version": 2, "lights": {"looks": {"heart_new": {}}}})
    show._on_lifecycle({"kind": kind})
    await asyncio.sleep(0.05)
    assert "/api/mod/lights" in show.mod.gets
    assert [r.match["target"] for r in show.cfg.cues] == ["lights_y2k"]


@_async
async def test_the_show_re_asks_the_looks_every_few_minutes(monkeypatch):
    import stagehand.show.module as show_module

    asked: list[int] = []

    class Show:
        async def _ask_lights(self):
            asked.append(1)

    monkeypatch.setattr(show_module, "LIGHTS_REASK_S", 0.01)
    task = asyncio.ensure_future(show_module.ShowControl._lights_loop(Show()))
    await asyncio.sleep(0.05)
    task.cancel()
    assert len(asked) >= 3


# -- wave 39: presence pulses and the shown report ------------------------------------

LAMP = "zigbee2mqtt/desk_lamp/set"
HALL = "zigbee2mqtt/hall_lights/set"
STRIP = "wled/desk/api"


def _presence_doc(presence=None, strip=True) -> dict:
    """lights-basic.json with a `presence` block and a non-safety WLED strip in the desktop."""
    doc = json.loads(json.dumps(BASIC))
    if presence is not None:
        doc["presence"] = presence
    if strip:
        doc["fixtures"].append({"id": "desk-strip", "name": "Desk strip", "room": "desktop", "pos": {"x": 1.5, "y": 0.8, "z": 1}, "kind": "wled", "device": "wled/desk", "caps": {"color": True, "ct": False, "dim": True}})
    doc["looks"]["lights_game"] = {"to": ["desk-lamp", "desk-strip"] if strip else ["desk-lamp"], "set": {"state": "ON", "brightness": 200, "transition": 1}}
    doc["looks"]["lights_dance"] = {"to": ["desk-strip"], "set": {"state": "ON", "color": "#FF00AA", "effect": "blink"}}
    doc["looks"]["lights_chase"] = {"to": ["desk-lamp"], "steps": [{"at": 0, "set": {"brightness": 254}}, {"at": 1000, "set": {"brightness": 60}}], "loop": True, "period": 2000}
    return doc


def _answer(seq: int, *fixtures: str) -> dict:
    return {"presence": {"seq": seq, "fixtures": [{"fixture": f, "since": 1000 + i} for i, f in enumerate(fixtures)]}}


@_async
async def test_a_program_under_a_bulb_pulses_it_every_12_s_until_it_leaves():
    timer = FakeTimer()
    lights = _lights(timer, doc=_presence_doc())
    assert lights.take_presence(_answer(1, "desk-lamp", "hall-group")) is True
    assert lights.presence_seq == 1
    await timer.advance(30_000)
    assert _on(lights.mqtt.log, LAMP) == [(0, {"effect": "breathe"}), (12_000, {"effect": "breathe"}), (24_000, {"effect": "breathe"})]
    assert [t for t, _ in _on(lights.mqtt.log, HALL)] == [0, 12_000, 24_000]  # a Z2M group: the same words
    assert lights.take_presence(_answer(2, "hall-group")) is True
    await timer.advance(30_000)
    lamp = _on(lights.mqtt.log, LAMP)
    assert lamp[-1] == (30_000, {"effect": "finish_effect"}) and len(lamp) == 4
    assert [t for t, _ in _on(lights.mqtt.log, HALL)] == [0, 12_000, 24_000, 36_000, 48_000, 60_000]
    # The same set again sends nothing new; an answer with no seq move says so.
    mark = len(lights.mqtt.log)
    assert lights.take_presence(_answer(2, "hall-group")) is False
    assert len(lights.mqtt.log) == mark
    assert lights.stats()["pulsed"] == ["hall-group"]


@_async
async def test_a_safety_fixture_or_one_outside_presence_to_never_pulses():
    timer = FakeTimer()
    lights = _lights(timer, doc=_presence_doc({"to": ["server-room", "upstairs"]}))
    # The server-room bulb and bench strip are safety lights; the strip in the desktop is not in `to`.
    lights.take_presence(_answer(1, "server-room-rgb", "server-strip", "desk-strip", "attic-bulb", "nope"))
    await timer.advance(13_000)
    assert {tp for _, tp, _ in lights.mqtt.log} == {"zigbee2mqtt/attic_bulb/set"}
    assert lights.pulses.keys() == {"attic-bulb"}


@_async
async def test_presence_off_in_the_doc_ends_every_pulse_and_starts_none():
    timer = FakeTimer()
    lights = _lights(timer, doc=_presence_doc({"effect": "blink"}))
    lights.take_presence(_answer(1, "desk-lamp"))
    assert _on(lights.mqtt.log, LAMP) == [(0, {"effect": "blink"})]
    await timer.advance(1000)
    assert lights.apply({"version": "v2", "lights": _presence_doc({"enabled": False})}, persist=False)
    lights.take_presence(_answer(1, "desk-lamp"))
    await timer.advance(30_000)
    assert _on(lights.mqtt.log, LAMP) == [(0, {"effect": "blink"}), (1000, {"effect": "finish_effect"})]
    assert lights.pulses == {}


@_async
async def test_a_location_in_presence_to_reaches_its_rooms_once_the_map_arrives():
    timer = FakeTimer()
    lights = _lights(timer, doc=_presence_doc({"to": ["The Tube"]}))
    lights.house = None
    lights.take_presence(_answer(1, "hall-group"))
    assert lights.mqtt.log == []
    lights.set_house(HOUSE, persist=False)
    lights.sync_pulses()
    assert _on(lights.mqtt.log, HALL) == [(0, {"effect": "breathe"})]


@_async
async def test_a_wled_strip_breathes_once_and_gets_its_looks_effect_back():
    timer = FakeTimer()
    lights = _lights(timer, doc=_presence_doc())
    lights.play("lights_dance")  # the strip blinks pink
    await timer.advance(10)
    lights.take_presence(_answer(1, "desk-strip"))
    await timer.advance(30_000)
    got = _on(lights.mqtt.log, STRIP)
    assert got == [(0, {"on": True, "seg": [{"col": [[255, 0, 170]], "fx": 1}]}), (10, {"seg": [{"fx": 2}]})]  # once: no repeat on WLED
    # A look on the strip while it pulses: its colour goes out, its effect waits.
    lights.play("lights_game")
    await timer.advance(10)
    lights.play("lights_dance")
    await timer.advance(10)
    assert _on(lights.mqtt.log, STRIP)[-2:] == [(30_010, {"on": True, "bri": 200, "transition": 10}), (30_020, {"on": True, "seg": [{"col": [[255, 0, 170]]}]})]
    lights.take_presence(_answer(2))
    assert _on(lights.mqtt.log, STRIP)[-1] == (30_030, {"seg": [{"fx": 1}]})  # the look's blink, never a full re-publish


@_async
async def test_a_wled_strip_with_no_effect_goes_back_to_solid_and_blink_is_fx_1():
    timer = FakeTimer()
    lights = _lights(timer, doc=_presence_doc({"effect": "blink"}))
    lights.play("lights_game")
    lights.take_presence(_answer(1, "desk-strip"))
    lights.take_presence(_answer(2))
    assert [p for _, p in _on(lights.mqtt.log, STRIP)][-2:] == [{"seg": [{"fx": 1}]}, {"seg": [{"fx": 0}]}]


@_async
async def test_a_pulse_never_takes_a_fixture_from_a_look_nor_a_look_stops_the_pulse():
    timer = FakeTimer()
    lights = _lights(timer, doc=_presence_doc())
    lights.play("lights_chase")
    run = lights.running["desk-lamp"]
    lights.take_presence(_answer(1, "desk-lamp"))
    await timer.advance(5000)
    assert lights.running["desk-lamp"] is run and not run.done
    lights.play("lights_game")  # a new look mid-pulse
    await timer.advance(20_000)
    lamp = _on(lights.mqtt.log, LAMP)
    assert [t for t, p in lamp if p == {"effect": "breathe"}] == [0, 12_000, 24_000]
    assert [t for t, p in lamp if "brightness" in p] == [0, 1000, 2000, 3000, 4000, 5000, 5000]
    assert lights.running["desk-lamp"].name == "lights_game"


@_async
async def test_an_identify_wins_for_its_2_s_then_the_pulse_comes_back():
    timer = FakeTimer()
    lights = _lights(timer, doc=_presence_doc())
    lights.take_presence(_answer(1, "desk-lamp", "desk-strip"))
    await timer.advance(11_000)
    lights.run_test({"fixture": "desk-lamp"})
    lights.run_test({"fixture": "desk-strip"})
    await timer.advance(1000)  # the 12 s repeat falls inside the identify: held
    assert _on(lights.mqtt.log, LAMP)[-1] == (11_000, {"effect": "okay"})
    await timer.advance(1000)
    assert _on(lights.mqtt.log, LAMP)[-1] == (13_000, {"effect": "breathe"})
    # The strip's identify blinked (nothing settled to give back: its pulse is the effect).
    assert _on(lights.mqtt.log, STRIP)[-2:] == [(11_000, {"on": True, "seg": [{"fx": 1}]}), (13_000, {"seg": [{"fx": 2}]})]
    # A program leaving during an identify: finished when the flash is over.
    lights.run_test({"fixture": "desk-lamp"})
    lights.take_presence(_answer(2, "desk-strip"))
    assert _on(lights.mqtt.log, LAMP)[-1] == (13_000, {"effect": "okay"})
    await timer.advance(2000)
    assert _on(lights.mqtt.log, LAMP)[-1] == (15_000, {"effect": "finish_effect"})
    await timer.advance(30_000)
    assert _on(lights.mqtt.log, LAMP)[-1][0] == 15_000


def test_a_broker_reconnect_sends_every_pulse_again():
    timer = FakeTimer()

    async def go():
        lights = _lights(timer, doc=_presence_doc())
        lights.take_presence(_answer(1, "desk-lamp", "desk-strip"))
        mark = len(lights.mqtt.log)
        lights.repulse()
        assert [(tp, p) for _, tp, p in lights.mqtt.log[mark:]] == [(LAMP, {"effect": "breathe"}), (STRIP, {"seg": [{"fx": 2}]})]

    asyncio.run(go())


def test_an_older_server_with_no_presence_pulses_nothing():
    async def go():
        lights = _lights(FakeTimer(), doc=_presence_doc())
        lights.take_presence(_answer(4, "desk-lamp"))
        assert lights.take_presence({"tests": []}) is False
        assert lights.pulses == {} and lights.mqtt.log[-1][1:] == (LAMP, {"effect": "finish_effect"})
        assert lights.presence_seq == 4

    asyncio.run(go())


@_async
async def test_the_long_poll_sends_the_presence_cursor():
    timer = FakeTimer()
    asked: list[dict] = []

    class Mod(FakeMod):
        async def get(self, path, params=None, timeout=None):
            if path != "/api/mod/lights":
                return {}
            asked.append(dict(params or {}))
            if len(asked) == 3:
                raise asyncio.CancelledError
            return {"version": "v1", "source": "server", "lights": _presence_doc(), **_answer(len(asked) + 6, "desk-lamp")}

    lights = _lights(timer, doc=_presence_doc(), mod=Mod())
    lights.apply = lambda answer, persist=True: HouseLights.apply(lights, answer, persist=False)  # no cache writes
    with pytest.raises(asyncio.CancelledError):
        await lights._config_loop(lights.mod)
    assert "presence" not in asked[0]
    assert asked[1]["presence"] == 7 and asked[2]["presence"] == 8
    assert lights.pulses.keys() == {"desk-lamp"}
    for t in list(lights._tasks):
        t.cancel()


@_async
async def test_shown_is_every_command_merged_and_posted_250_ms_after_a_change():
    timer = FakeTimer()
    mod = FakeMod()
    lights = _lights(timer, doc=_presence_doc(), mod=mod)
    lights.play("heart_wake")
    lights.run_test({"fixture": "desk-lamp", "set": {"state": "OFF"}})
    await timer.advance(249)
    assert mod.posts == []
    await timer.advance(1)
    assert len(mod.posts) == 1
    path, body = mod.posts[0]
    assert path == "/api/mod/lights/shown"
    assert body == {"fixtures": {"server-room-rgb": {"state": "ON", "brightness": 254, "color": "#FF2A00"}, "desk-lamp": {"state": "OFF"}}}
    # heart_wake's steps every 400 ms: one post per change, never more than 4 a second.
    await timer.advance(3000)
    assert 1 < len(mod.posts) <= 1 + 4 * 3
    assert mod.posts[-1][1]["fixtures"]["server-room-rgb"] == {"state": "ON", "brightness": 120, "color": "#00E5FF"}
    # A safety light is reported clamped, as the bulb got it.
    lights.run_test({"fixture": "server-room-rgb", "set": {"state": "OFF"}})
    await timer.advance(250)
    assert mod.posts[-1][1]["fixtures"]["server-room-rgb"] == {"state": "ON", "brightness": 40, "color": "#00E5FF"}


@_async
async def test_shown_posts_never_more_than_4_a_second_under_a_fast_loop():
    timer = FakeTimer()
    mod = FakeMod()
    doc = _presence_doc()
    doc["looks"]["lights_strobe"] = {"to": ["desk-lamp"], "steps": [{"at": 0, "set": {"brightness": 254}}, {"at": 150, "set": {"brightness": 10}}], "loop": True, "period": 300}
    lights = _lights(timer, doc=doc, mod=mod)
    stamps: list[float] = []
    real_post = mod.post

    async def post(path, body):
        stamps.append(timer.now())
        return await real_post(path, body)

    mod.post = post
    lights.play("lights_strobe")
    await timer.advance(5000)
    assert len(stamps) >= 15
    assert all(b - a >= 250 for a, b in zip(stamps, stamps[1:]))


@_async
async def test_shown_carries_the_pulses_and_identify_flashes_stay_out():
    timer = FakeTimer()
    mod = FakeMod()
    lights = _lights(timer, doc=_presence_doc(), mod=mod)
    lights.play("lights_game")
    lights.take_presence(_answer(1, "desk-lamp", "desk-strip"))
    await timer.advance(250)
    shown = mod.posts[-1][1]["fixtures"]
    assert shown["desk-lamp"] == {"state": "ON", "brightness": 200, "effect": "breathe"}
    assert shown["desk-strip"] == {"state": "ON", "brightness": 200, "effect": "breathe"}
    lights.run_test({"fixture": "desk-lamp"})  # identify: a 2 s flash, not a state
    lights.take_presence(_answer(2, "desk-strip"))
    await timer.advance(2250)
    shown = mod.posts[-1][1]["fixtures"]
    assert shown["desk-lamp"] == {"state": "ON", "brightness": 200}
    assert lights.base["desk-lamp"] == {"state": "ON", "brightness": 200}


@_async
async def test_shown_keeps_alive_every_20_s_and_a_404_stops_it_logged_once(caplog):
    timer = FakeTimer()
    mod = FakeMod()
    lights = _lights(timer, doc=_presence_doc(), mod=mod)
    loop = asyncio.ensure_future(lights._shown_loop())
    await timer.advance(30_000)
    assert mod.posts == []  # nothing commanded yet: nothing to report
    lights.play("lights_game")
    await timer.advance(250)
    assert [p for p, _ in mod.posts] == ["/api/mod/lights/shown"]
    await timer.advance(45_000)
    assert len(mod.posts) == 3  # 20 s and 40 s after the last post
    # An older server: one log line, then silence until a restart.
    mod.status = 404

    async def gone(path, body):
        raise ModApiError("no route", 404)

    mod.post = gone
    with caplog.at_level("WARNING", logger="stagehand.lights"):
        lights.play("lights_chase")
        await timer.advance(60_000)
    assert lights.shown_off and loop.done()
    assert sum("/api/mod/lights/shown" in r.getMessage() for r in caplog.records) == 1
    assert lights.shown_posts == 3
    for t in list(lights._tasks):
        t.cancel()


@_async
async def test_a_failing_shown_post_retries_on_the_next_change():
    timer = FakeTimer()
    calls: list[int] = []

    class Mod(FakeMod):
        async def post(self, path, body):
            calls.append(1)
            if len(calls) == 1:
                raise ModApiError("busy", 503)
            return await super().post(path, body)

    mod = Mod()
    lights = _lights(timer, doc=_presence_doc(), mod=mod)
    lights.play("lights_game")
    await timer.advance(250)
    assert lights.shown_posts == 0 and not lights.shown_off
    lights.play("heart_idle")
    await timer.advance(250)
    assert lights.shown_posts == 1 and len(mod.posts) == 1
