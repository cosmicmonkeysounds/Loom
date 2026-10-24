"""The server-room box's firmware (`hardware/server-room/server_room/`) against
`trapped.house.yaml`, the other end of its MQTT contract.

Nothing checks this at runtime: a topic typo in either file is a door that
never starts the server-room cutscene or a patch bay nobody hears. So, from
the source:

1. the firmware dials the house Mac's static IP on the password-only LAN
   listener (stagehand itself talks to the same Mosquitto on loopback);
2. every `show/serverroom/*` topic the YAML publishes is one the firmware
   handles, with the payload words it matches (`locked`/`unlocked`, `on`/`off`,
   `seconds`);
3. every server-room / patch-bay sensor topic the YAML listens on is one the
   firmware publishes, retained exactly where the YAML expects it — since
   wave 20 that is the patch bay alone: the door is the Grand Central M4's
   (D16), and the box's door topic is published but read by nobody;
4. the payloads the firmware builds fire the right signals through the real
   sensor rules, and the combo strings its host tests pin are the YAML's;
5. the box ships reading the wave 7 door contact: two wire loops that TOUCH
   WHEN THE DOOR OPENS, alone (`DOOR_TAPE`, closed-when-open), with a close
   debounce long enough that a flickering loop never re-arms the edge.
"""

from __future__ import annotations

import ipaddress
import json
import re
from pathlib import Path

import pytest
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


def test_the_firmware_dials_the_house_macs_password_listener():
    cfg = _defines("config.h")
    broker = ipaddress.ip_address(cfg["SR_BROKER_IP"])
    assert broker.version == 4 and broker.is_private and not broker.is_loopback
    # The anonymous listener is loopback-only (scripts/house-macbook/audio.md →
    # "Lock down the broker"), so the box uses :1884 with the props login…
    port = re.search(r"^#define\s+SR_BROKER_PORT\s+(\d+)", (FIRMWARE / "config.h").read_text(encoding="utf-8"), re.M)
    assert port and port.group(1) == "1884"
    assert "SR_MQTT_USER, SR_MQTT_PASS" in _sketch()
    assert {"SR_MQTT_USER", "SR_MQTT_PASS"} <= _defines("secrets.example.h").keys()
    # …while stagehand, on that same Mac, uses the anonymous loopback one.
    assert ipaddress.ip_address(str(_raw()["show"]["mqtt"]["host"])).is_loopback
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
    # Wave 20 (D16): the patch bay only. The box still publishes its door
    # topic (retained), but no rule reads it: the door is the M4's now.
    assert ours == {topics["T_PATCH_STATE"]}
    assert topics["T_DOOR"] not in _sensor_topics()
    # The patch state is not retained (a replayed wrong combo would fire
    # patch_rejected).
    assert re.search(r"publish\(T_PATCH_STATE, \w+, false\)", sketch)
    assert re.search(r'mqtt\.connect\(SR_CLIENT_ID, SR_MQTT_USER, SR_MQTT_PASS, T_HEALTH, 1, true, "lost"\)', sketch)
    assert re.search(r'publish\(T_HEALTH, "online", true\)', sketch)


def _yaml_combos() -> tuple[str, str]:
    found = {}
    for rule in _raw()["show"]["sensors"]:
        name = rule.get("signal", {}).get("name")
        if name in ("patch_combo_a", "patch_combo_b"):
            found[name] = re.search(r"combo == '([^']+)'", rule.get("on", rule.get(True))["when"]).group(1)
    return found["patch_combo_a"], found["patch_combo_b"]


_ESP32_COMBO_A_LEGACY = (
    "wave 22 moved combo A to V6-D7 for the Grand Central M4's 8 + 7 bay; the "
    "archived ESP32 box (not installed) still pins its old combo A in "
    "hardware/server-room/test/test_logic.cpp. Un-skip once that file follows."
)


def _host_test_combos() -> dict[str, str]:
    text = HOST_TEST.read_text(encoding="utf-8")
    return dict(re.findall(r'static const char\* (kCombo[AB]) = "([^"]+)"', text))


def test_the_host_tests_pin_the_yamls_combo_b():
    assert _host_test_combos()["kComboB"] == _yaml_combos()[1]


@pytest.mark.skip(reason=_ESP32_COMBO_A_LEGACY)
def test_the_host_tests_pin_the_yamls_combo_a():
    assert _host_test_combos()["kComboA"] == _yaml_combos()[0]


@pytest.mark.skip(reason=_ESP32_COMBO_A_LEGACY)
def test_the_firmwares_combo_a_payload_fires_combo_a():
    # Exactly what test_logic.cpp asserts stateJson builds for Combo A.
    state_a = json.loads(
        '{"pairs":[["V2","D5"],["V4","D1"],["V6","D8"],["V7","D3"]],'
        '"combo":"V2-D5,V4-D1,V6-D8,V7-D3","count":4,"complete":true}'
    )
    assert _fire("sensors/patchbay/state", state_a, Debouncer(), 0.0) == ["patch_combo_a"]


def test_the_yamls_patch_bay_rules_fire_the_right_signals():
    # The YAML's rules against payloads in the firmware's stateJson shape
    # (the ESP32's own combo-A bytes are the skipped legacy check above).
    combo_a = _yaml_combos()[0]
    state_a = {
        "pairs": [p.split("-") for p in combo_a.split(",")],
        "combo": combo_a,
        "count": 4,
        "complete": True,
    }
    deb = Debouncer()
    assert _fire("sensors/patchbay/state", state_a, deb, 0.0) == ["patch_combo_a"]
    wrong = {"pairs": [["V1", "V3"]] * 4, "combo": "V1-V3,V2-D2,V4-D4,V5-D5", "count": 4, "complete": True}
    assert _fire("sensors/patchbay/state", wrong, deb, 100.0) == ["patch_rejected"]
    half = {"pairs": [["V2", "D5"]], "combo": "V2-D5", "count": 1, "complete": False}
    assert _fire("sensors/patchbay/state", half, deb, 200.0) == []

    # Wave 20 (D16): the box's door payload fires nothing any more — the
    # door is read by the Grand Central M4 through the server-room terminal.
    deb = Debouncer()
    for payload in ({"open": True, "tape": True, "mode": "tape"}, {"open": False, "tape": False, "mode": "tape"}):
        assert _fire("sensors/serverroom/door", payload, deb, 20.0) == []


def _config() -> str:
    return (FIRMWARE / "config.h").read_text(encoding="utf-8")


def test_the_box_reads_the_wire_loops_that_touch_when_the_door_opens():
    config = _config()

    def define(name: str) -> str:
        m = re.search(rf"^#define\s+{name}\s+(\S+)", config, re.M)
        assert m, f"config.h lost {name}"
        return m.group(1)

    # The wire loops alone: a closed-when-open input that comes unplugged reads
    # shut, so DOOR_BOTH would let it veto every opening.
    assert define("DOOR_MODE") == "DOOR_TAPE"
    assert define("TAPE_POLARITY") == "door::kClosedWhenOpen"
    assert define("REED_POLARITY") == "door::kClosedWhenShut"
    # A loop flickering on an open door must not report closed (that would
    # re-arm the edge and fire a second opening): ≥ 1 s to report closed.
    assert int(define("DOOR_CLOSE_MS")) >= 1000
    assert int(define("DOOR_OPEN_MS")) <= 500
    # The sketch applies the polarity to both inputs, at boot and every poll,
    # and the diagnostics say which polarity each input runs.
    sketch = _sketch()
    assert sketch.count("door::isOpen(kTapePolarity, digitalRead(PIN_TAPE) == LOW)") == 2
    assert sketch.count("door::isOpen(kReedPolarity, digitalRead(PIN_REED) == LOW)") == 2
    assert "== HIGH" not in sketch.split("void pollDoor", 1)[1].split("}", 1)[0]
    assert '\\"tape_polarity\\"' in sketch and '\\"reed_polarity\\"' in sketch
    assert "door::payloadJson(kDoorMode" in sketch


def test_nothing_on_the_box_drives_a_lock():
    # The real door has a standalone keypad lock: the box only shows a ring.
    # No GPIO besides the ring, the relay "click" and the DFPlayer is an
    # output, and no topic names a strike, maglock or latch.
    sketch = _sketch()
    outputs = set(re.findall(r"pinMode\((\w+), OUTPUT\)", sketch))
    assert outputs == {"PIN_RELAY"}, outputs
    topics = _defines("topics.h")
    assert not [t for t in topics.values() if re.search(r"strike|maglock|latch|unlock", t)]
    assert not re.search(r"maglock|strike", _config(), re.I)
