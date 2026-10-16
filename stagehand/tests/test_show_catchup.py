"""SW-SH-10: the show router catches the lights up after an uplink blip or
a story restart. It reads the story's mirrors from `GET /api/state` and
replays the `catch_up:` cues through the same cue map a story `cue` line
uses — on every (re)connect, and a beat after a reset / reload / golive."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

import httpx
import pytest

from stagehand.config import load_config
from stagehand.modapi import ModApiError
from stagehand.module import ConfigError
from stagehand.show.config import parse_show
from stagehand.show.module import ShowControl

HOUSE = Path(__file__).resolve().parents[1] / "trapped.house.yaml"


def run(coro):
    return asyncio.run(coro)


class FakeMqtt:
    def __init__(self) -> None:
        self.sent: list[tuple[str, dict]] = []
        self.connected = asyncio.Event()
        self.connected.set()

    def publish(self, topic, payload, retain=False, qos=0):
        self.sent.append((topic, json.loads(payload) if payload else {}))


class FakeMod:
    def __init__(self, world: dict[str, str] | None = None, error: Exception | None = None) -> None:
        self.world = world or {}
        self.error = error
        self.calls: list[tuple[str, dict | None]] = []

    async def get(self, path, params=None):
        self.calls.append((path, params))
        if self.error is not None:
            raise self.error
        return {"world": [{"path": p, "value": v} for p, v in self.world.items()]}


def house_show(world=None, error=None) -> tuple[ShowControl, FakeMqtt, FakeMod]:
    show = load_config(HOUSE).modules["show"]
    assert isinstance(show, ShowControl)
    show.mqtt = FakeMqtt()  # type: ignore[assignment]
    show.osc = None
    show.mod = FakeMod(world, error)  # type: ignore[assignment]
    show.catch_up_delay_s = 0.01
    return show, show.mqtt, show.mod  # type: ignore[return-value]


MID_CUT = {
    "Night.lights": "game",
    "Night.dark_room": "The RAM",
    "Night.dark_scene": "game",
    "Night.lights_back_at": "412",
}


def test_catch_up_replays_the_scene_then_the_dark_room():
    show, mqtt, mod = house_show(MID_CUT)
    run(show._catch_up("connect"))
    assert mod.calls == [("/api/state", {"role": "mod"})]
    assert mqtt.sent == [
        ("zigbee2mqtt/living/set", {"scene_recall": 4, "transition": 2}),
        ("wled/living/api", {"on": True, "ps": 4}),
        ("zigbee2mqtt/registry/set", {"state": "OFF", "transition": 0}),
        ("wled/registry/api", {"on": False}),
    ]


def test_a_finished_cut_or_a_new_look_never_redarkens_the_room():
    # Night.dark_room is never cleared: after the 90 s the story zeroes
    # lights_back_at, and any later look changes Night.lights.
    for change in ({"Night.lights_back_at": "0"}, {"Night.lights": "pong"}):
        show, mqtt, _ = house_show({**MID_CUT, **change})
        run(show._catch_up("connect"))
        assert ("zigbee2mqtt/registry/set", {"state": "OFF", "transition": 0}) not in mqtt.sent, change
        assert ("wled/registry/api", {"on": False}) not in mqtt.sent, change


def test_a_lost_restore_relights_the_room_while_the_cut_look_is_still_on():
    # The uplink was down at the 90 s mark: the story zeroed lights_back_at
    # and sent `lights, room: The RAM, state: on`, which never arrived.
    show, mqtt, _ = house_show({**MID_CUT, "Night.lights_back_at": "0"})
    run(show._catch_up("connect"))
    assert mqtt.sent == [
        ("zigbee2mqtt/living/set", {"scene_recall": 4, "transition": 2}),
        ("wled/living/api", {"on": True, "ps": 4}),
        ("zigbee2mqtt/registry/set", {"state": "ON", "transition": 1}),
        ("wled/registry/api", {"on": True}),
    ]
    # A new look since the cut: that look's own cue owns the room.
    show, mqtt, _ = house_show({**MID_CUT, "Night.lights_back_at": "0", "Night.lights": "pong"})
    run(show._catch_up("connect"))
    assert not any(t.startswith(("zigbee2mqtt/registry", "wled/registry")) for t, _ in mqtt.sent)
    show, mqtt, _ = house_show({**MID_CUT, "Night.dark_room": "none", "Night.lights_back_at": "0"})
    run(show._catch_up("connect"))
    assert [t for t, _ in mqtt.sent] == ["zigbee2mqtt/living/set", "wled/living/api"]


def test_the_alarm_is_never_replayed():
    show, mqtt, _ = house_show({"Night.lights": "alarm"})
    run(show._catch_up("connect"))
    assert mqtt.sent == []


def test_a_fresh_night_before_power_on_replays_nothing():
    for world in ({}, {"Night.lights": ""}):
        show, mqtt, _ = house_show(world)
        run(show._catch_up("connect"))
        assert mqtt.sent == []


@pytest.mark.parametrize(
    "error", [ModApiError("GET /api/state → 502", 502), httpx.ConnectError("down"), OSError("no route")]
)
def test_a_failed_state_call_only_logs(error, caplog):
    show, mqtt, _ = house_show(error=error)
    with caplog.at_level(logging.WARNING, logger="stagehand.show"):
        run(show._catch_up("connect"))
    assert mqtt.sent == []
    assert "catch-up (connect) FAILED" in caplog.text


def test_restart_lifecycle_frames_schedule_a_delayed_catch_up_and_ended_does_not():
    async def scenario(kind: str) -> list:
        show, mqtt, _ = house_show({"Night.lights": "screensaver"})
        show._on_lifecycle({"kind": kind, "at": 0})
        assert mqtt.sent == []  # never inside the frame handler
        await asyncio.sleep(0.05)
        return mqtt.sent

    for kind in ("reset", "reload", "golive"):
        assert run(scenario(kind)) == [
            ("zigbee2mqtt/house/set", {"scene_recall": 1, "transition": 3}),
            ("wled/all/api", {"on": True, "ps": 1}),
        ], kind
    assert run(scenario("ended")) == []


def test_a_newer_catch_up_replaces_a_pending_one():
    async def scenario() -> list:
        show, mqtt, _ = house_show({"Night.lights": "screensaver"})
        show.catch_up_delay_s = 0.05
        show._on_lifecycle({"kind": "reset"})
        show._on_lifecycle({"kind": "reload"})
        await asyncio.sleep(0.15)
        return mqtt.sent

    assert len(run(scenario())) == 2  # one replay (two publishes), not two


def test_the_feed_schedules_a_catch_up_on_every_connect(monkeypatch):
    seen: dict = {}

    async def fake_run_stream(client, url, on_frame, *, label, on_connect=None, max_backoff=30.0):
        seen["on_connect"] = on_connect
        on_connect()
        on_frame("lifecycle", json.dumps({"kind": "ended"}))
        await asyncio.sleep(0.05)

    monkeypatch.setattr("stagehand.show.module.run_stream", fake_run_stream)

    async def scenario() -> list:
        show, mqtt, _ = house_show({"Night.lights": "dance"})
        show.mod.sse_url = "http://x/events"  # type: ignore[union-attr]
        await show._sse_loop()
        return mqtt.sent

    sent = run(scenario())
    assert seen["on_connect"] is not None
    assert ("zigbee2mqtt/house/set", {"scene_recall": 14, "transition": 0}) in sent


def test_a_live_lights_cue_during_the_state_read_wins():
    """The GET raced a newer lights cue on the feed: the snapshot is older
    than the cue, so it must not paint over it."""

    class RacingMod(FakeMod):
        def __init__(self, show_ref, world, live_args) -> None:
            super().__init__(world)
            self.show, self.live_args = show_ref, live_args

        async def get(self, path, params=None):
            self.show._on_feed_sim({"type": "directive", "verb": "cue", "args": self.live_args})
            return await super().get(path, params)

    show, mqtt, _ = house_show()
    show.mod = RacingMod(show, {"Night.lights": "game"}, "lights_call_desktop")  # type: ignore[assignment]
    run(show._catch_up("connect"))
    assert mqtt.sent == [
        ("zigbee2mqtt/house/set", {"scene_recall": 3, "transition": 1}),
        ("wled/all/api", {"on": True, "ps": 3}),
    ]  # the live cue only; no lights_game replay after it
    # A cue the catch-up never replays (the terminals, a sound) does not block it.
    show, mqtt, _ = house_show()
    show.mod = RacingMod(show, {"Night.lights": "game"}, "terminals_attract")  # type: ignore[assignment]
    run(show._catch_up("connect"))
    assert ("zigbee2mqtt/living/set", {"scene_recall": 4, "transition": 2}) in mqtt.sent


def test_a_catch_up_waits_for_the_broker_session_and_gives_up_without_it(caplog):
    async def scenario(up_after: float | None) -> list:
        show, mqtt, _ = house_show({"Night.lights": "game"})
        mqtt.connected.clear()
        show.mqtt_ready_timeout_s = 0.1
        task = asyncio.ensure_future(show._catch_up("connect"))
        await asyncio.sleep(0.02)
        assert mqtt.sent == []  # nothing queued for paho to drop
        if up_after is not None:
            await asyncio.sleep(up_after)
            mqtt.connected.set()
        await task
        return mqtt.sent

    assert run(scenario(0.01))[0] == ("zigbee2mqtt/living/set", {"scene_recall": 4, "transition": 2})
    with caplog.at_level(logging.WARNING, logger="stagehand.show"):
        assert run(scenario(None)) == []
    assert "broker is not connected" in caplog.text


def test_a_broker_reconnect_schedules_a_catch_up():
    from stagehand.show.mqtt import MqttBridge

    async def scenario() -> list:
        show, fake, _ = house_show({"Night.lights": "dance"})
        bridge = MqttBridge("127.0.0.1", 1, filters=[], loop=asyncio.get_running_loop())
        bridge.publish = fake.publish  # type: ignore[method-assign]
        bridge.on_connected = lambda: show._schedule_catch_up("mqtt")
        show.mqtt = bridge  # type: ignore[assignment]
        bridge._on_connect(bridge._client, None, None, 0, None)
        await asyncio.sleep(0.05)
        assert bridge.connected.is_set()
        bridge._on_disconnect(None, None, None, 0, None)
        await asyncio.sleep(0)
        assert not bridge.connected.is_set()
        return fake.sent

    assert ("zigbee2mqtt/house/set", {"scene_recall": 14, "transition": 0}) in run(scenario())


def test_run_stream_reports_the_connect_on_open_with_no_frame_at_all():
    """A lean mod feed sends nothing on connect (no snapshot, no history;
    only `:ping` comments, which the parser skips): the catch-up must not
    wait for the first story event."""
    from stagehand.modapi import run_stream

    class PingOnly:
        opens = 0

        async def stream(self, url, on_open=None):
            self.opens += 1
            if on_open is not None:
                on_open()
            await asyncio.sleep(3600)  # pings only
            yield ("never", "")

        def forget_token(self):
            pass

    async def scenario() -> int:
        connects: list[int] = []
        task = asyncio.ensure_future(run_stream(PingOnly(), "http://x/events?lean=1", lambda e, d: None, label="t", on_connect=lambda: connects.append(1)))
        await asyncio.sleep(0.02)
        task.cancel()
        return len(connects)

    assert run(scenario()) == 1


def test_no_catch_up_config_means_no_state_call():
    show = ShowControl(parse_show({"cues": []}))
    show.mod = FakeMod({"Night.lights": "game"})  # type: ignore[assignment]
    show._schedule_catch_up("connect")
    assert show._catch_up_task is None


@pytest.mark.parametrize(
    "entry",
    [
        {"path": "Night.lights"},
        {"cue": "lights_{value}"},
        {"path": "Night.lights", "cue": "lights_game"},
        {"path": "Night.lights", "cue": "lights_{value}", "skip": "alarm"},
        {"path": "Night.lights", "cue": "lights_{value}", "when": "Night.x >"},
    ],
)
def test_bad_catch_up_entries_fail_at_boot(entry):
    with pytest.raises(ConfigError):
        parse_show({"catch_up": [entry]})
