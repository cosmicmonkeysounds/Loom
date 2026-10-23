"""The `lights` module's mirrors of `@loom/house` `lights.ts`: target
resolution, the safety clamp, `planLook` and both payload builders, pinned by
the shared fixtures `house/test/fixtures/lights-{basic,house,resolve,plan}.json`.
Stagehand keeps byte-identical copies in `tests/fixtures/house-lights/`
(stagehand ships without the JS tree); when the house package sits beside
it, a test diffs the copies against it."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from stagehand.lights.plan import clamp_for_safety, plan_look, safety_min
from stagehand.lights.routing import LightsDocError, is_look_name, parse_lights, resolve_targets
from stagehand.lights.z2m import (
    bridge_online,
    caps_of,
    identify_payload,
    light_topic,
    payload_for,
    permit_join_payload,
    permit_join_topic,
    reduce_devices,
    wled_payload,
    z2m_payload,
)

HERE = Path(__file__).parent
COPY = HERE / "fixtures" / "house-lights"
HOME = HERE.parent.parent / "house" / "test" / "fixtures"
FILES = ("lights-basic.json", "lights-house.json", "lights-resolve.json", "lights-plan.json")


def _load(name: str):
    return json.loads((COPY / name).read_text())


RESOLVE = _load("lights-resolve.json")
PLAN = _load("lights-plan.json")
DOC = parse_lights(_load(RESOLVE["lights"]))
HOUSE = _load(RESOLVE["house"])


@pytest.mark.parametrize("name", FILES)
def test_the_shared_fixture_copies_match_the_house_package(name):
    home = HOME / name
    if not home.exists():
        pytest.skip("the @loom/house fixtures are not beside this stagehand tree")
    assert (COPY / name).read_bytes() == home.read_bytes(), f"re-copy house/test/fixtures/{name}"


@pytest.mark.parametrize("case", RESOLVE["cases"], ids=lambda c: ",".join(c["to"]) + ("/no-house" if c.get("house") is False else "") or "empty")
def test_resolve_matches_the_shared_house_fixture(case):
    house = None if case.get("house") is False else HOUSE
    assert resolve_targets(DOC, house, case["to"]) == case["fixtures"]


@pytest.mark.parametrize("case", PLAN["looks"], ids=lambda c: c["look"])
def test_plan_and_payloads_match_the_shared_house_fixture(case):
    plan = plan_look(DOC, HOUSE, case["look"])
    assert plan is not None
    assert plan.loop == case["loop"]
    assert plan.period == case["period"]
    assert plan.repeat == case["repeat"]
    assert plan.restore == case["restore"]
    got = [{"at": c.at, "fixture": c.fixture, "set": c.set} for c in plan.commands]
    assert got == [{"at": c["at"], "fixture": c["fixture"], "set": c["set"]} for c in case["commands"]]
    for c in case["commands"]:
        f = DOC.fixture(c["fixture"])
        assert light_topic(f) == c["topic"]
        assert payload_for(f, c["set"]) == c["payload"]
        # Key order too: the server's JSON and ours read the same.
        assert json.dumps(payload_for(f, c["set"])) == json.dumps(c["payload"])


@pytest.mark.parametrize("case", PLAN["clamp"], ids=lambda c: f"{c['fixture']}:{json.dumps(c['set'])}")
def test_the_safety_clamp_matches_the_shared_house_fixture(case):
    f = DOC.fixture(case["fixture"])
    assert clamp_for_safety(f, case["set"]) == case["out"]
    assert light_topic(f) == case["topic"]
    # The builders clamp too: the unclamped state never darkens a safety light.
    assert payload_for(f, case["set"]) == case["payload"]


def test_a_safety_floor_is_never_under_40_whatever_min_says():
    assert safety_min({"safety": True, "min": 20}) == 40
    assert safety_min({"safety": True, "min": 90}) == 90
    assert safety_min({"safety": True}) == 40
    f = {"safety": True, "min": 5, "caps": {"dim": False}}
    # Clamp first, then the caps: an OFF on a safety light that can't dim is just ON.
    from stagehand.lights.plan import for_caps

    assert for_caps(f, clamp_for_safety(f, {"state": "OFF"})) == {"state": "ON"}


def test_an_unknown_look_plans_nothing():
    assert plan_look(DOC, HOUSE, "nope") is None


def test_parse_refuses_what_the_module_cannot_play():
    for bad in (None, [], {"version": 2, "fixtures": [], "zones": [], "looks": {}}, {"version": 1, "fixtures": {}, "zones": [], "looks": {}}, {"version": 1, "fixtures": [{"id": "x"}], "zones": [], "looks": {}}):
        with pytest.raises(LightsDocError):
            parse_lights(bad)
    doc = parse_lights({"version": 1, "fixtures": [], "zones": [], "looks": {}, "boot": "nope"})
    assert doc.boot is None


def test_look_names_never_take_a_screens_family():
    assert is_look_name("heart_wake")
    assert not is_look_name("room_heart_wake") and not is_look_name("screens_flicker") and not is_look_name("Heart")


def test_the_mqtt_words_for_identify_and_pairing():
    rgb, strip = DOC.fixture("server-room-rgb"), DOC.fixture("server-strip")
    assert identify_payload(rgb) == {"effect": "okay"}
    # The bench strip is a safety light: a steady white flash, never a blink.
    assert strip.get("safety") and identify_payload(strip) == {"on": True, "bri": 255, "seg": [{"col": [[255, 255, 255]], "fx": 0}]}
    assert identify_payload({**strip, "safety": False}) == {"on": True, "seg": [{"fx": 1}]}
    assert permit_join_topic() == "zigbee2mqtt/bridge/request/permit_join"
    assert permit_join_payload(120) == {"time": 120}
    assert permit_join_payload(0) == {"time": 0}
    assert permit_join_payload(999) == {"time": 254}
    # Math.round, not banker's rounding: 0.25 s → 3 tenths, as in the TS.
    assert wled_payload(strip, {"transition": 0.25})["transition"] == 3
    assert z2m_payload(rgb, {"color": "#00E5FF"}) == {"color": {"hex": "#00E5FF"}}


Z2M_DEVICES = [
    {"ieee_address": "0x00124b0000000001", "type": "Coordinator", "friendly_name": "Coordinator", "definition": None},
    {
        "ieee_address": "0x0017880100000001",
        "type": "Router",
        "friendly_name": "server_room_rgb",
        "definition": {
            "model": "9290022166",
            "vendor": "Philips",
            "description": "Hue white and color ambiance E26/E27",
            "exposes": [
                {"type": "light", "features": [
                    {"name": "state", "property": "state"},
                    {"name": "brightness", "property": "brightness"},
                    {"name": "color_temp", "property": "color_temp"},
                    {"type": "composite", "name": "color_xy", "property": "color", "features": [{"name": "x"}, {"name": "y"}]},
                ]},
                {"type": "enum", "name": "effect"},
            ],
        },
    },
    {"ieee_address": "0x0017880100000002", "type": "Router", "friendly_name": "white_bulb", "definition": {"model": "LWA001", "vendor": "Philips", "description": "white", "exposes": [{"type": "light", "features": [{"name": "state"}, {"name": "brightness"}]}]}},
    {"ieee_address": "0x00158d0000000003", "type": "EndDevice", "friendly_name": "printer_button", "definition": {"model": "WXKG11LM", "vendor": "Aqara", "description": "button", "exposes": [{"type": "enum", "name": "action"}]}},
    {"ieee_address": "0x1", "type": "Router", "friendly_name": "  "},
]
Z2M_GROUPS = [{"id": 7, "friendly_name": "hall_lights", "members": [{"ieee_address": "0x0017880100000002", "endpoint": 11}, {"ieee_address": "0x0017880100000001", "endpoint": 11}]}]


def test_the_device_list_reduces_to_the_servers_shape():
    out = reduce_devices(Z2M_DEVICES, Z2M_GROUPS)
    by = {d["friendly"]: d for d in out}
    assert list(by) == ["Coordinator", "server_room_rgb", "white_bulb", "printer_button", "hall_lights"]
    assert by["Coordinator"]["caps"] is None and by["Coordinator"]["type"] == "Coordinator"
    assert by["server_room_rgb"] == {
        "friendly": "server_room_rgb", "ieee": "0x0017880100000001", "type": "Router",
        "model": "9290022166", "vendor": "Philips", "description": "Hue white and color ambiance E26/E27",
        "caps": {"color": True, "ct": True, "dim": True},
    }
    assert by["white_bulb"]["caps"] == {"color": False, "ct": False, "dim": True}
    assert by["printer_button"]["caps"] is None
    assert by["hall_lights"] == {
        "friendly": "hall_lights", "ieee": "7", "type": "Group", "model": None, "vendor": None, "description": None,
        "caps": {"color": True, "ct": True, "dim": True}, "members": ["white_bulb", "server_room_rgb"],
    }
    assert caps_of({"exposes": "junk"}) is None


def test_the_bridge_state_reads_both_majors():
    assert bridge_online(b'{"state":"online"}') is True
    assert bridge_online(b"offline") is False
    assert bridge_online(b"?") is None
