"""The show's real house config (`trapped.house.yaml`) against the story it
serves (`core/examples/trapped-in-the-internet`).

Stagehand never validates names against the story: a cue nobody maps is a
dark room, and a sensor signal nobody handles is a silent no-op on the
night. So these tests read the `.loom` files and check, in both directions:

1. every `cue lights_*` / `cue screens_flicker` / `sound <name>` the story
   emits has a rule (and every allow-listed room of Trabolta's
   `cut_the_lights` has an off and an on rule);
2. every sensor signal is a `when <name>` story rule in `main.loom`;
3. the patch-bay combos agree three ways: the YAML, the `Kernel.combo_*`
   seeds in `main.loom`, and the four combo-half codex entries.

And it pins the Oct 31 safety edits (K-05): no cue darkens a safety room
(the stairs/Tube strip, bathroom, tent, server room), the blackout turns
WLED off per device and leaves the Tube on a dim static preset, Trabolta
cannot darken The Cloud and only dims the kitchen, there is no maglock
(the door has an indicator only), and the door sensors fire once per
real opening (edge + ignore retained).
"""

from __future__ import annotations

import ipaddress
import json
import re
from pathlib import Path

import pytest
import yaml

from stagehand.config import load_config
from stagehand.show.cuemap import MqttCue, OscCue, evaluate_cues
from stagehand.show.sensormap import Debouncer, evaluate_sensors

ROOT = Path(__file__).resolve().parents[1]
HOUSE = ROOT / "trapped.house.yaml"
STORY = ROOT.parent / "core/examples/trapped-in-the-internet"


def _raw() -> dict:
    return yaml.safe_load(HOUSE.read_text(encoding="utf-8"))


def _show():
    return load_config(HOUSE).modules["show"].cfg


def _story_text() -> str:
    files = sorted(STORY.rglob("*.loom"))
    assert files, f"no .loom files under {STORY}"
    return "\n".join(f.read_text(encoding="utf-8") for f in files)


def _code(text: str) -> str:
    """The story without `//` comments (a comment may mention a cue in passing)."""
    return "\n".join(line.split("//", 1)[0] for line in text.splitlines())


def _directive(verb: str, args: str) -> dict:
    return {"type": "directive", "verb": verb, "args": args}


def _rules(on_directive: str) -> list[dict]:
    out = []
    for rule in _raw()["show"]["cues"]:
        on = rule.get("on", rule.get(True))
        if on.get("directive") == on_directive:
            out.append(rule)
    return out


def _targets(on_directive: str) -> set[str]:
    return {str(r.get("match", {}).get("target")) for r in _rules(on_directive) if "target" in r.get("match", {})}


# -- the config loads -----------------------------------------------------------


def test_the_house_config_loads():
    cfg = load_config(HOUSE)
    assert list(cfg.modules) == ["show", "alexa"]
    show = cfg.modules["show"].cfg
    assert show.mqtt is not None and "qlab" in show.osc_targets
    assert show.cues and show.sensors


RETAINED_OK = {"show/serverroom/lock"}  # an indicator, not a command


def test_no_payload_has_the_yaml_on_trap_and_only_the_door_indicator_is_retained():
    for rule in _show().cues:
        if rule.mqtt is None:
            continue
        assert rule.mqtt.retain is (rule.mqtt.topic in RETAINED_OK), f"cues[{rule.id}] {rule.mqtt.topic}: wrong retain"
        payload = rule.mqtt.payload
        if isinstance(payload, dict):
            assert all(isinstance(k, str) for k in payload), f"cues[{rule.id}]: unquoted `on:` key in a payload"
            # …and the value-side trap: a bare `state: on` / `off` is YAML true / false.
            for k, val in payload.items():
                assert not isinstance(val, bool) or k == "on", f"cues[{rule.id}]: {k}: {val!r} (quote 'on'/'off')"


def test_the_broker_is_this_macs_loopback_listener_and_the_server_is_the_vps():
    cfg = load_config(HOUSE)
    assert cfg.server.url == "https://app.mapsandducks.com"
    # stagehand runs on the broker's Mac and uses the anonymous listener,
    # which is bound to 127.0.0.1; the LAN props use :1884 with a password.
    host = ipaddress.ip_address(cfg.modules["show"].cfg.mqtt.host)  # a literal, never a DHCP name
    assert host.is_loopback


# -- 1. every physical cue the story emits has a rule ------------------------------


def test_every_light_scene_and_flicker_cue_has_a_rule():
    used = set(re.findall(r"\bcue\s+(lights_[a-z0-9_]+|screens_flicker)\b", _code(_story_text())))
    assert used, "the story emits no light cues?"
    missing = sorted(used - _targets("cue"))
    assert not missing, f"cues with no rule in trapped.house.yaml: {missing}"
    # …and each one really produces output.
    for name in used:
        assert evaluate_cues(_show().cues, _directive("cue", name)), name


def test_every_sound_has_a_qlab_cue():
    used = set(re.findall(r"^\s*(?:sound|sfx)\s+([A-Za-z0-9_]+)\s*$", _code(_story_text()), re.M))
    assert used, "the story plays no sounds?"
    missing = sorted(used - _targets("sfx"))
    assert not missing, f"sounds with no rule in trapped.house.yaml: {missing}"
    for name in used:
        cues = evaluate_cues(_show().cues, _directive("sfx", name))
        if name == "alexa_chime":  # the alexa player's chime, not QLab (K-20)
            assert cues == [MqttCue(topic="show/chime", payload="{}", retain=False, qos=0)]
            assert load_config(HOUSE).modules["alexa"].cfg.chime_topic == "show/chime"
            continue
        assert cues == [OscCue(addr=f"/cue/{name}/start", args=(), t_exec_offset_ms=None, to=("qlab",))], name


def test_the_ceremony_sounds_are_cued():
    """K-25: the ceremony beats (and the rule that opens them) play their own
    sounds; each is a `sound` line the story really emits, with a QLab rule."""
    ceremony = _code((STORY / "beats/ceremony.loom").read_text(encoding="utf-8"))
    main = _code((STORY / "main.loom").read_text(encoding="utf-8"))
    opener = main[main.index("when start_the_ceremony:") :].split("\nwhen ", 1)[0]
    sounds = set(re.findall(r"^\s*(?:sound|sfx)\s+([A-Za-z0-9_]+)\s*$", ceremony + "\n" + opener, re.M))
    assert {"ceremony_bed", "award_fanfare"} <= sounds, sounds
    for name in sounds:
        assert evaluate_cues(_show().cues, _directive("sfx", name)) == [OscCue(addr=f"/cue/{name}/start", args=(), t_exec_offset_ms=None, to=("qlab",))], name


def _mqtt(cues) -> list[tuple[str, dict]]:
    return [(c.topic, json.loads(c.payload)) for c in cues if isinstance(c, MqttCue)]


def test_every_room_trabolta_can_darken_goes_off_and_comes_back():
    trabolta = (STORY / "cast/trabolta.loom").read_text(encoding="utf-8")
    rooms = set(re.findall(r'room == "([^"]+)"', trabolta))
    # Never The Cloud: the outdoor steps + the tent path, with captives walked through it.
    assert rooms == {"The Start Bar", "The Desktop", "The RAM"}
    for room in rooms:
        off = _mqtt(evaluate_cues(_show().cues, _directive("cue", f"lights, room: {room}, state: off")))
        on = _mqtt(evaluate_cues(_show().cues, _directive("cue", f"lights, room: {room}, state: on")))
        z_off = [p for t, p in off if t.startswith("zigbee2mqtt/")]
        w_off = [p for t, p in off if t.startswith("wled/")]
        assert len(z_off) == 1 and len(w_off) == 1, room
        if room == "The Start Bar":
            # The kitchen (knives, a stove) only drops to ~20%, never dark.
            assert z_off[0]["state"] == "ON" and 0 < z_off[0]["brightness"] <= 51
            # bri only — sending "on" would light a strip that was off in the current look.
            assert "on" not in w_off[0] and 0 < w_off[0]["bri"] <= 51
        else:
            assert z_off[0]["state"] == "OFF", room
            assert w_off[0]["on"] is False, room
        assert any(t.startswith("zigbee2mqtt/") and p["state"] == "ON" for t, p in on), room
        assert any(t.startswith("wled/") and p["on"] is True for t, p in on), room
    # The restore undoes the kitchen dim.
    back = dict(_mqtt(evaluate_cues(_show().cues, _directive("cue", "lights, room: The Start Bar, state: on"))))
    assert back["zigbee2mqtt/kitchen/set"]["brightness"] == 254 and back["wled/kitchen/api"]["bri"] == 255
    # A room outside the allow-list reaches nothing, even if a director types it.
    for room in ("The Internet", "The Cloud", "Disk Cleanup", "The Tube", "The Server Room", "The Optical Drive", "The CPU",
                 "The Steam Room", "The Fan Closet", "The Graphics Card", "The Hard Drive"):
        assert evaluate_cues(_show().cues, _directive("cue", f"lights, room: {room}, state: off")) == [], room


def test_announce_is_mapped_when_the_story_uses_it():
    code = _code(_story_text())
    if re.search(r"^\s*do announce\b", code, re.M):
        cues = evaluate_cues(_show().cues, _directive("announce", '"Go to the living room."'))
        assert cues == [MqttCue(topic="show/announce", payload='{"text": "Go to the living room."}', retain=False, qos=0)]


def test_the_door_drives_the_indicator_and_there_is_no_maglock():
    code = _code(_story_text())
    assert re.search(r"^\s*do door server_room, state: locked\b", code, re.M)
    assert re.search(r"^\s*do door server_room, state: unlocked\b", code, re.M)
    for state in ("locked", "unlocked"):
        cues = evaluate_cues(_show().cues, _directive("door", f"server_room, state: {state}"))
        assert cues == [MqttCue(topic="show/serverroom/lock", payload=json.dumps({"state": state}), retain=True, qos=0)]
    # Nothing anywhere can drive a lock: a stray relay must never lock people in.
    for rule in _show().cues:
        if rule.mqtt is not None:
            assert "lock" not in rule.mqtt.topic or rule.mqtt.topic == "show/serverroom/lock", rule.mqtt.topic
    assert "server_room_lock" not in HOUSE.read_text(encoding="utf-8")


def test_the_alarm_reaches_the_server_room_box_and_stops_when_it_opens():
    alarm = _mqtt(evaluate_cues(_show().cues, _directive("cue", "lights_alarm")))
    assert ("show/serverroom/alarm", {"state": "on", "seconds": 120}) in alarm
    for cue in ("lights_server_open", "lights_restore"):
        assert ("show/serverroom/alarm", {"state": "off"}) in _mqtt(evaluate_cues(_show().cues, _directive("cue", cue))), cue


# -- safe lights (K-05 critic pass) -------------------------------------------------

#: Z2M groups that hold only safety bulbs (they are out of `house`), and the
#: WLED devices that must never go dark: the Tube strip (hall + stair landing)
#: and the server room (guests are in there during the blackout).
SAFE_Z2M = ("bathroom", "tent", "server_room", "stairs", "path")
SAFE_WLED = ("tube", "server")


def _darkens(topic: str, payload: dict) -> bool:
    if topic.startswith("zigbee2mqtt/"):
        return payload.get("state") == "OFF" or payload.get("brightness") == 0
    if topic.startswith("wled/"):
        return payload.get("on") is False or payload.get("bri") == 0
    return False


def test_no_cue_ever_darkens_a_safety_room_or_all_of_wled():
    for rule in _show().cues:
        if rule.mqtt is None or not isinstance(rule.mqtt.payload, dict):
            continue
        topic, payload = rule.mqtt.topic, rule.mqtt.payload
        if not _darkens(topic, payload):
            continue
        device = topic.split("/")[1]
        assert device not in SAFE_Z2M or not topic.startswith("zigbee2mqtt/"), f"cues[{rule.id}] darkens {topic}"
        assert device not in SAFE_WLED or not topic.startswith("wled/"), f"cues[{rule.id}] darkens {topic}"
        assert topic != "wled/all/api", f"cues[{rule.id}] turns every WLED off (the Tube strip too)"


def test_the_blackout_goes_per_device_and_leaves_the_tube_dim():
    out = _mqtt(evaluate_cues(_show().cues, _directive("cue", "lights_blackout")))
    topics = [t for t, _ in out]
    assert ("zigbee2mqtt/house/set", {"state": "OFF", "transition": 0}) in out
    assert "wled/all/api" not in topics
    for room in ("living", "kitchen", "backyard", "registry"):
        assert (f"wled/{room}/api", {"on": False}) in out, room
    assert ("wled/tube/api", {"on": True, "ps": 22}) in out
    assert topics[-1] == "wled/tube/api"  # last, so a shared controller ends on the tube look
    assert not any(t.startswith("wled/server/") for t in topics)  # guests are in the server room


# -- 2. every sensor signal is a story rule -----------------------------------------


def _signals() -> list[str]:
    return [rule["signal"]["name"] for rule in _raw()["show"]["sensors"] if "signal" in rule]


def test_every_sensor_signal_is_a_when_rule_in_main_loom():
    main = _code((STORY / "main.loom").read_text(encoding="utf-8"))
    names = _signals()
    assert names.count("server_door_opened") == 2  # the reed (primary) and the optional Zigbee contact
    assert {"server_door_opened", "printer_button_pressed", "printer_opened", "patch_combo_a", "patch_combo_b", "patch_rejected"} <= set(names)
    missing = [n for n in names if not re.search(rf"^when\s+{re.escape(n)}\s*(?:for\s+\w+\s*)?:", main, re.M)]
    assert not missing, f"signals main.loom never handles (a typo is silent on the night): {missing}"


def test_the_door_printer_and_patch_bay_fire_the_right_signals():
    rules = _show().sensors
    deb = Debouncer()

    def fire(topic: str, payload: dict) -> list[str]:
        return [c.fields["name"] for c in evaluate_sensors(rules, topic, payload, deb, now=1000.0)]

    assert fire("sensors/serverroom/door", {"open": True}) == ["server_door_opened"]
    assert fire("sensors/serverroom/door", {"open": False}) == []
    assert fire("zigbee2mqtt/server_room_door", {"contact": False}) == ["server_door_opened"]
    assert fire("zigbee2mqtt/server_room_door", {"contact": True}) == []
    assert fire("zigbee2mqtt/printer_button", {"action": "single"}) == ["printer_button_pressed"]
    assert fire("zigbee2mqtt/printer_button", {"action": ""}) == []
    assert fire("zigbee2mqtt/printer_lid", {"contact": False}) == ["printer_opened"]
    combo_a, combo_b = _yaml_combos()
    assert fire("sensors/patchbay/state", {"complete": True, "combo": combo_a}) == ["patch_combo_a"]
    assert fire("sensors/patchbay/state", {"complete": True, "combo": combo_b}) == ["patch_combo_b"]
    assert fire("sensors/patchbay/state", {"complete": True, "combo": "V1-D1,V2-D2,V3-D3,V4-D4"}) == ["patch_rejected"]
    assert fire("sensors/patchbay/state", {"complete": False, "combo": "V1-D1"}) == []


def test_state_sensors_fire_once_per_change_and_a_restart_with_the_door_open_fires_nothing():
    rules = _show().sensors
    edged = {(r.topic.filter, r.actions[0].fields["name"]) for r in rules if r.edge}
    assert edged >= {
        ("sensors/serverroom/door", "server_door_opened"),
        ("zigbee2mqtt/server_room_door", "server_door_opened"),
        ("zigbee2mqtt/printer_lid", "printer_opened"),
        ("sensors/patchbay/state", "patch_combo_a"),
        ("sensors/patchbay/state", "patch_combo_b"),
    }
    assert not any(r.accept_retained for r in rules)

    def fire(deb, topic, payload, now, retained=False):
        return [c.fields["name"] for c in evaluate_sensors(rules, topic, payload, deb, now=now, retained=retained)]

    # A restart with the door propped open: the retained "open" primes, then
    # Z2M's battery reports keep saying "open" — nothing fires.
    deb = Debouncer()
    assert fire(deb, "sensors/serverroom/door", {"open": True}, 0.0, retained=True) == []
    assert fire(deb, "zigbee2mqtt/server_room_door", {"contact": False, "battery": 97}, 0.0, retained=True) == []
    assert fire(deb, "zigbee2mqtt/server_room_door", {"contact": False, "battery": 96}, 600.0) == []
    # Closed, then opened for real: one signal per sensor (the story latches).
    fire(deb, "sensors/serverroom/door", {"open": False}, 700.0)
    assert fire(deb, "sensors/serverroom/door", {"open": True}, 710.0) == ["server_door_opened"]
    assert fire(deb, "sensors/serverroom/door", {"open": True}, 720.0) == []

    # Each combo fires exactly once while it stays plugged in.
    combo_a, _ = _yaml_combos()
    deb = Debouncer()
    hits = [fire(deb, "sensors/patchbay/state", {"complete": True, "combo": combo_a}, t) for t in (0.0, 61.0, 200.0)]
    assert hits == [["patch_combo_a"], [], []]
    fire(deb, "sensors/patchbay/state", {"complete": False, "combo": "V1-D6"}, 300.0)
    assert fire(deb, "sensors/patchbay/state", {"complete": True, "combo": combo_a}, 400.0) == ["patch_combo_a"]


# -- 3. the combos agree three ways ----------------------------------------------------


def _yaml_combos() -> tuple[str, str]:
    found: dict[str, str] = {}
    for rule in _raw()["show"]["sensors"]:
        name = rule.get("signal", {}).get("name")
        if name in ("patch_combo_a", "patch_combo_b"):
            on = rule.get("on", rule.get(True))
            m = re.search(r"combo == '([^']+)'", on["when"])
            assert m, f"{name}: no `combo == '…'` in its when:"
            found[name] = m.group(1)
    return found["patch_combo_a"], found["patch_combo_b"]


def _canonical(pairs: list[tuple[str, str]]) -> str:
    return ",".join(f"V{v}-D{d}" for v, d in sorted(pairs, key=lambda p: int(p[0])))


def _codex_combo(text: str, letter: str) -> str:
    pairs: list[tuple[str, str]] = []
    for half in ("First Half", "Second Half"):
        m = re.search(rf"^CODEX Combo {letter} {half}\s*\n(.*?)(?=^\S|\Z)", text, re.M | re.S)
        assert m, f"no CODEX Combo {letter} {half}"
        pairs += re.findall(r"V(\d+)\s*(?:→|->)\s*D(\d+)", m.group(1))
    assert len(pairs) == 4, f"Combo {letter}: expected 4 cables, found {pairs}"
    return _canonical(pairs)


def test_the_patch_combos_agree_across_yaml_kernel_and_codex():
    combo_a, combo_b = _yaml_combos()
    for combo in (combo_a, combo_b):
        pairs = re.findall(r"V(\d+)-D(\d+)", combo)
        assert len(pairs) == 4 and combo == _canonical(pairs), f"{combo} is not canonical (sorted by V)"

    main = (STORY / "main.loom").read_text(encoding="utf-8")
    seeds = dict(re.findall(r'set\s+Kernel\.(combo_[ab])\s*=\s*"([^"]+)"', main))
    assert seeds.get("combo_a") == combo_a, f"Kernel.combo_a seed {seeds.get('combo_a')!r} != YAML {combo_a!r}"
    assert seeds.get("combo_b") == combo_b, f"Kernel.combo_b seed {seeds.get('combo_b')!r} != YAML {combo_b!r}"

    codex = _story_text()
    assert _codex_combo(codex, "A") == combo_a
    assert _codex_combo(codex, "B") == combo_b


@pytest.mark.parametrize("cue", ["lights_screensaver", "lights_dance"])
def test_scene_cues_hit_both_zigbee_and_wled(cue):
    cues = evaluate_cues(_show().cues, _directive("cue", cue))
    topics = {c.topic for c in cues if isinstance(c, MqttCue)}
    assert "zigbee2mqtt/house/set" in topics and "wled/all/api" in topics


def test_alexa_speaks_with_the_macs_own_voice():
    """Decision 2026-10-15: the house speakers use the Mac's `say` voice, so
    an announcement never waits on (or needs) the VPS."""
    alexa = load_config(HOUSE).modules["alexa"].cfg
    assert alexa.engine == "say"
    assert alexa.say_voice
    assert (alexa.device, alexa.channels) == ("MOTU", (1, 2, 3, 4))


def test_alexa_prewarms_every_scripted_announcement():
    """Every `do announce "…"` line is listed for the opt-in server voice
    (`engine: server` caches them on the house Mac at boot — a line missing
    here would cost the server round trip on the night)."""
    lines = set(re.findall(r'^\s*do announce "([^"]+)"', _code(_story_text()), re.M))
    alexa = load_config(HOUSE).modules["alexa"].cfg
    assert lines, "the story no longer announces anything — drop the alexa prewarm list"
    assert lines <= set(alexa.prewarm), f"add to alexa.prewarm: {sorted(lines - set(alexa.prewarm))}"
    assert alexa.topic == "show/announce" == _rules("announce")[0]["mqtt"]["topic"]
