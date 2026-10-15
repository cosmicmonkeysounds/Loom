"""The server-room box's firmware (`hardware/server-room/server_room/`) against
`trapped.house.yaml`, the other end of its MQTT contract.

Nothing checks this at runtime: a topic typo in either file is a door that
never alarms or a patch bay nobody hears. So, from the source:

1. the firmware's hard-coded broker is the YAML's `show.mqtt.host`;
2. every `show/serverroom/*` topic the YAML publishes is one the firmware
   handles, with the payload words it matches (`locked`/`unlocked`, `on`/`off`,
   `seconds`);
3. every server-room / patch-bay sensor topic the YAML listens on is one the
   firmware publishes, retained exactly where the YAML expects it;
4. the payloads the firmware builds fire the right signals through the real
   sensor rules, and the combo strings its host tests pin are the YAML's.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

from stagehand.config import load_config
from stagehand.show.sensormap import Debouncer, evaluate_sensors

ROOT = Path(__file__).resolve().parents[1]
HOUSE = ROOT / "trapped.house.yaml"
FIRMWARE = ROOT.parent / "hardware/server-room/server_room"
HOST_TEST = ROOT.parent / "hardware/server-room/test/test_logic.cpp"


def _defines(name: str) -> dict[str, str]:
    text = (FIRMWARE / name).read_text(encoding="utf-8")
    return dict(re.findall(r'^#define\s+(\w+)\s+"([^"]*)"', text, re.M))


def _sketch() -> str:
    return (FIRMWARE / "server_room.ino").read_text(encoding="utf-8")


def _raw() -> dict:
    return yaml.safe_load(HOUSE.read_text(encoding="utf-8"))


def _published_topics() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for rule in _raw()["show"]["cues"]:
        mqtt = rule.get("mqtt")
        if mqtt:
            out.setdefault(mqtt["topic"], []).append(mqtt)
    return out


def _sensor_topics() -> set[str]:
    return {r.get("on", r.get(True))["topic"] for r in _raw()["show"]["sensors"]}


def _fire(topic: str, payload: dict, deb: Debouncer, now: float, retained: bool = False) -> list[str]:
    rules = load_config(HOUSE).modules["show"].cfg.sensors
    return [c.fields["name"] for c in evaluate_sensors(rules, topic, payload, deb, now=now, retained=retained)]


def test_the_firmware_dials_the_yamls_broker():
    cfg = _defines("config.h")
    assert cfg["SR_BROKER_IP"] == str(_raw()["show"]["mqtt"]["host"])
    # Its own address is static too, and on the broker's /24.
    assert cfg["SR_IP"].rsplit(".", 1)[0] == cfg["SR_BROKER_IP"].rsplit(".", 1)[0]
    assert cfg["SR_IP"] != cfg["SR_BROKER_IP"]


def test_every_show_serverroom_topic_the_yaml_publishes_is_handled():
    topics = _defines("topics.h")
    sketch = _sketch()
    handled = {topics[name] for name in re.findall(r"strcmp\(topic, (T_\w+)\) == 0", sketch)}
    published = {t for t in _published_topics() if t.startswith("show/serverroom/")}
    assert published, "the YAML publishes nothing to the server-room box"
    assert published <= handled, f"unhandled by the firmware: {sorted(published - handled)}"
    assert topics["T_SHOW_ALL"] == "show/serverroom/#" and "subscribe(T_SHOW_ALL" in sketch


def test_the_payload_words_the_yaml_sends_are_the_ones_the_firmware_matches():
    topics = _defines("topics.h")
    sketch = _sketch()
    published = _published_topics()
    for mqtt in published[topics["T_LOCK"]] + published[topics["T_ALARM"]]:
        state = mqtt["payload"]["state"]
        assert f'strcmp(val, "{state}") == 0' in sketch, f"firmware never matches state {state!r}"
    for mqtt in published[topics["T_ALARM"]]:
        if "seconds" in mqtt["payload"]:
            assert 'msg::number(body, "seconds"' in sketch


def test_every_sensor_topic_for_the_box_is_one_it_publishes():
    topics = _defines("topics.h")
    sketch = _sketch()
    ours = {t for t in _sensor_topics() if t.startswith(("sensors/serverroom/", "sensors/patchbay/"))}
    assert ours == {topics["T_DOOR"], topics["T_PATCH_STATE"]}
    # The door is retained (an edge rule primes on it, so a stagehand restart
    # with the door open fires nothing); the patch state is not (a replayed
    # wrong combo would fire patch_rejected).
    assert re.search(r"publish\(T_DOOR, \w+, true\)", sketch)
    assert re.search(r"publish\(T_PATCH_STATE, \w+, false\)", sketch)
    assert re.search(r'mqtt\.connect\(SR_CLIENT_ID, T_HEALTH, 1, true, "lost"\)', sketch)
    assert re.search(r'publish\(T_HEALTH, "online", true\)', sketch)


def _yaml_combos() -> tuple[str, str]:
    found = {}
    for rule in _raw()["show"]["sensors"]:
        name = rule.get("signal", {}).get("name")
        if name in ("patch_combo_a", "patch_combo_b"):
            found[name] = re.search(r"combo == '([^']+)'", rule.get("on", rule.get(True))["when"]).group(1)
    return found["patch_combo_a"], found["patch_combo_b"]


def test_the_host_tests_pin_the_yamls_combos():
    text = HOST_TEST.read_text(encoding="utf-8")
    pinned = dict(re.findall(r'static const char\* (kCombo[AB]) = "([^"]+)"', text))
    assert (pinned["kComboA"], pinned["kComboB"]) == _yaml_combos()


def test_the_firmwares_payloads_fire_the_right_signals():
    # Exactly what test_logic.cpp asserts stateJson builds for Combo A.
    state_a = json.loads(
        '{"pairs":[["V2","D5"],["V4","D1"],["V6","D8"],["V7","D3"]],'
        '"combo":"V2-D5,V4-D1,V6-D8,V7-D3","count":4,"complete":true}'
    )
    assert state_a["combo"] == _yaml_combos()[0]
    deb = Debouncer()
    assert _fire("sensors/patchbay/state", state_a, deb, 0.0) == ["patch_combo_a"]
    wrong = {"pairs": [["V1", "V3"]] * 4, "combo": "V1-V3,V2-D2,V4-D4,V5-D5", "count": 4, "complete": True}
    assert _fire("sensors/patchbay/state", wrong, deb, 100.0) == ["patch_rejected"]
    half = {"pairs": [["V2", "D5"]], "combo": "V2-D5", "count": 1, "complete": False}
    assert _fire("sensors/patchbay/state", half, deb, 200.0) == []

    # The door payload with its diagnostic fields: one opening, one signal;
    # the retained replay after a reconnect primes and fires nothing.
    deb = Debouncer()
    assert _fire("sensors/serverroom/door", {"open": True, "reed": True, "tape": True}, deb, 0.0, retained=True) == []
    _fire("sensors/serverroom/door", {"open": False, "reed": False, "tape": True}, deb, 10.0)
    assert _fire("sensors/serverroom/door", {"open": True, "reed": True, "tape": True}, deb, 20.0) == [
        "server_door_opened"
    ]
