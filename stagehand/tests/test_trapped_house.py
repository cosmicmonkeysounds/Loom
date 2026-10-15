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
"""

from __future__ import annotations

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
    assert list(cfg.modules) == ["show"]
    show = cfg.modules["show"].cfg
    assert show.mqtt is not None and "qlab" in show.osc_targets
    assert show.cues and show.sensors


def test_no_payload_has_the_yaml_on_trap_and_nothing_is_retained():
    for rule in _show().cues:
        if rule.mqtt is None:
            continue
        assert rule.mqtt.retain is False, f"cues[{rule.id}] retains a command topic"
        payload = rule.mqtt.payload
        if isinstance(payload, dict):
            assert all(isinstance(k, str) for k in payload), f"cues[{rule.id}]: unquoted `on:` key in a payload"


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
        assert cues == [OscCue(addr=f"/cue/{name}/start", args=(), t_exec_offset_ms=None, to=("qlab",))], name


def test_every_room_trabolta_can_darken_goes_off_and_comes_back():
    trabolta = (STORY / "cast/trabolta.loom").read_text(encoding="utf-8")
    rooms = set(re.findall(r'room == "([^"]+)"', trabolta))
    assert rooms == {"The Cache", "The Desktop", "The Cloud", "The Registry"}
    for room in rooms:
        off = evaluate_cues(_show().cues, _directive("cue", f"lights, room: {room}, state: off"))
        on = evaluate_cues(_show().cues, _directive("cue", f"lights, room: {room}, state: on"))
        assert any(isinstance(c, MqttCue) and c.topic.startswith("zigbee2mqtt/") and '"OFF"' in c.payload for c in off), room
        assert any(isinstance(c, MqttCue) and c.topic.startswith("wled/") and '"on": false' in c.payload for c in off), room
        assert any(isinstance(c, MqttCue) and c.topic.startswith("zigbee2mqtt/") and '"ON"' in c.payload for c in on), room
        assert any(isinstance(c, MqttCue) and c.topic.startswith("wled/") and '"on": true' in c.payload for c in on), room
    # A room outside the allow-list reaches nothing, even if a director types it.
    assert evaluate_cues(_show().cues, _directive("cue", "lights, room: The Internet, state: off")) == []


def test_announce_and_the_server_room_door_are_mapped_when_the_story_uses_them():
    code = _code(_story_text())
    if re.search(r"^\s*do announce\b", code, re.M):
        cues = evaluate_cues(_show().cues, _directive("announce", '"Go to the living room."'))
        assert cues == [MqttCue(topic="show/announce", payload='{"text": "Go to the living room."}', retain=False, qos=0)]
    if re.search(r"^\s*do door server_room\b", code, re.M):
        cues = evaluate_cues(_show().cues, _directive("door", "server_room, state: unlocked"))
        assert len(cues) == 1 and cues[0].topic == "zigbee2mqtt/server_room_lock/set"


# -- 2. every sensor signal is a story rule -----------------------------------------


def _signals() -> list[str]:
    return [rule["signal"]["name"] for rule in _raw()["show"]["sensors"] if "signal" in rule]


def test_every_sensor_signal_is_a_when_rule_in_main_loom():
    main = _code((STORY / "main.loom").read_text(encoding="utf-8"))
    names = _signals()
    assert {"server_door_opened", "printer_button_pressed", "printer_opened", "patch_combo_a", "patch_combo_b", "patch_rejected"} <= set(names)
    missing = [n for n in names if not re.search(rf"^when\s+{re.escape(n)}\s*(?:for\s+\w+\s*)?:", main, re.M)]
    assert not missing, f"signals main.loom never handles (a typo is silent on the night): {missing}"


def test_the_door_printer_and_patch_bay_fire_the_right_signals():
    rules = _show().sensors
    deb = Debouncer()

    def fire(topic: str, payload: dict) -> list[str]:
        return [c.fields["name"] for c in evaluate_sensors(rules, topic, payload, deb, now=1000.0)]

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


@pytest.mark.parametrize("cue", ["lights_screensaver", "lights_blackout", "lights_dance"])
def test_scene_cues_hit_both_zigbee_and_wled(cue):
    cues = evaluate_cues(_show().cues, _directive("cue", cue))
    topics = {c.topic for c in cues if isinstance(c, MqttCue)}
    assert "zigbee2mqtt/house/set" in topics and "wled/all/api" in topics
