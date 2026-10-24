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
cannot darken The Cloud and only dims the kitchen, nothing drives a lock
(the server-room door has a standalone keypad lock and mechanical egress;
the YAML drives only its indicator ring), and — wave 20 — no rule reads
the door at all (the M4 at his heart's terminal does), the server room's
RGB bulb — the room's only light — is lights.json's and nothing here
touches it, and the server room has no WLED strip (Q6 / Q10).
"""

from __future__ import annotations

import ipaddress
import json
import re
from pathlib import Path

import pytest
import yaml

from stagehand.conditions import Condition
from stagehand.config import load_config
from stagehand.audio.placeholders import load_manifest
from stagehand.show.cuemap import MqttCue, evaluate_cues
from stagehand.show.sensormap import Debouncer, evaluate_sensors

ROOT = Path(__file__).resolve().parents[1]
HOUSE = ROOT / "trapped.house.yaml"
STORY = ROOT.parent / "core/examples/trapped-in-the-internet"
AUDIO_JSON = STORY / "audio.json"


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
    """wave 18b (Q1): the router plays the sounds AND the announcements;
    QLab (no OSC target at all) and the `alexa` player are gone."""
    cfg = load_config(HOUSE)
    assert list(cfg.modules) == ["show", "audio"]
    show = cfg.modules["show"].cfg
    assert show.mqtt is not None and show.osc_targets == {}
    assert show.cues and show.sensors
    audio = cfg.modules["audio"].cfg
    assert audio.play_sounds and audio.announce and audio.passthrough is False
    assert audio.mqtt is not None and ipaddress.ip_address(audio.mqtt.host).is_loopback
    assert set(audio.no_duck) == {n for n, s in load_manifest().items() if s.no_duck} == {"dance_song", "rave", "hand_jive"}
    # The uplink-down boot routes from the repo's files.
    assert audio.config_file == str(AUDIO_JSON.resolve()) and audio.house_file == str((STORY / "house.json").resolve())
    assert audio.sounds_dir == str((ROOT / "media" / "sounds").resolve())


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


def _story_sounds() -> set[str]:
    return set(re.findall(r"^\s*(?:sound|sfx)\s+([A-Za-z0-9_]+)\s*$", _code(_story_text()), re.M))


def test_every_sound_is_routed():
    """wave 18b (Q1): every story sound but the chime has an audio.json cue
    (where it plays) and a manifest entry (its placeholder); no sound rule
    goes to OSC; the chime rides show/chime to the announcing router."""
    used = _story_sounds()
    assert used, "the story plays no sounds?"
    cues = json.loads(AUDIO_JSON.read_text(encoding="utf-8"))["cues"]
    manifest = load_manifest()
    assert sorted(cues) == sorted(used - {"announce_chime"}), "audio.json cues != the story's sounds"
    assert sorted(manifest) == sorted(used - {"announce_chime"}), "media/sounds.yaml != the story's sounds"
    assert all(r.get("osc") is None for r in _rules("sfx")) and _targets("sfx") == {"announce_chime"}
    for name in used:
        out = evaluate_cues(_show().cues, _directive("sfx", name))
        if name == "announce_chime":  # the router rings it with the announcements (K-20)
            assert out == [MqttCue(topic="show/chime", payload="{}", retain=False, qos=0)]
            assert load_config(HOUSE).modules["audio"].cfg.chime_topic == "show/chime"
            continue
        assert out == [], name  # the router plays it off the feed


def test_the_ceremony_sounds_are_cued():
    """K-25: the ceremony beats (and the rule that opens them) play their own
    sounds; each is a `sound` line the story really emits, routed by the
    router (an audio.json cue + a placeholder)."""
    ceremony = _code((STORY / "beats/ceremony.loom").read_text(encoding="utf-8"))
    main = _code((STORY / "main.loom").read_text(encoding="utf-8"))
    opener = main[main.index("when start_the_ceremony:") :].split("\nwhen ", 1)[0]
    sounds = set(re.findall(r"^\s*(?:sound|sfx)\s+([A-Za-z0-9_]+)\s*$", ceremony + "\n" + opener, re.M))
    assert {"ceremony_bed", "award_fanfare"} <= sounds, sounds
    cues = json.loads(AUDIO_JSON.read_text(encoding="utf-8"))["cues"]
    manifest = load_manifest()
    for name in sounds:
        assert name in cues and cues[name]["to"] and name in manifest, name


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


def test_every_announcement_reaches_the_router():
    """SW-AUD-05 (wave 18b): every `do announce "…"` is one show/announce
    message to the router, which ducks its own sounds under it (no QLab
    `duck_music`)."""
    lines = re.findall(r'^\s*do announce ("[^"]+")', _code(_story_text()), re.M)
    assert lines, "the story no longer announces anything"
    audio = load_config(HOUSE).modules["audio"]
    assert audio.cfg.announce_topic == "show/announce" and not audio.announcements_from_feed()
    for line in lines:
        cues = evaluate_cues(_show().cues, _directive("announce", line))
        assert cues == [MqttCue(topic="show/announce", payload=json.dumps({"text": line.strip('"')}), retain=False, qos=0)], line


def _lights_values() -> set[str]:
    return set(re.findall(r'\bset\s+Night\.lights\s*=\s*"([a-z0-9_]+)"', _code(_story_text())))


def test_every_night_lights_mirror_has_a_rule_and_catches_up():
    """SW-SH-10: the catch-up replays `lights_{Night.lights}`, so every value
    the story mirrors must be a real scene rule (the mirror and the YAML stay
    in step), and every one but `alarm` replays."""
    values = _lights_values()
    assert {"screensaver", "game", "alarm", "restore"} <= values, values
    missing = sorted(v for v in values if f"lights_{v}" not in _targets("cue"))
    assert not missing, f"Night.lights values with no lights_<value> rule: {missing}"
    house, scene, room, back = _show().catch_up
    assert house.path == scene.path == "Night.lights" and room.path == back.path == "Night.dark_room"
    for value in values:
        # The house layer under the server room's look replays only for server_open.
        assert house.args_for({"Night.lights": value}) == ("lights_y2k" if value == "server_open" else None), value
        args = scene.args_for({"Night.lights": value})
        if value == "alarm":  # re-arms the server room's 120 s siren
            assert args is None
            continue
        assert args == f"lights_{value}" and evaluate_cues(_show().cues, _directive("cue", args)), value
    # Trabolta's cut replays only mid-cut, onto the look he cut, and only an allow-listed room.
    mid = {"Night.lights": "game", "Night.dark_scene": "game", "Night.lights_back_at": "300"}
    for dark in ("The Start Bar", "The Desktop", "The RAM"):
        args = room.args_for({**mid, "Night.dark_room": dark})
        assert args == f"lights, room: {dark}, state: off" and evaluate_cues(_show().cues, _directive("cue", args))
    assert room.args_for({**mid, "Night.dark_room": "none"}) is None
    assert room.args_for({**mid, "Night.dark_room": "The RAM", "Night.lights_back_at": "0"}) is None
    # A whole-house look since the cut re-lit the room: nothing to replay.
    for look in ("dance", "blackout", "restore", "y2k", "screensaver"):
        assert room.args_for({**mid, "Night.dark_room": "The RAM", "Night.lights": look}) is None, look
    # …and once the cut is over, the restore half (a lost restore relights the
    # room) — under the look the story restored it into (Night.lit_scene) or a
    # later look that never re-lit the room.
    done = {**mid, "Night.lights_back_at": "0", "Night.lit_scene": "game"}
    for dark in ("The Start Bar", "The Desktop", "The RAM"):
        args = back.args_for({**done, "Night.dark_room": dark})
        assert args == f"lights, room: {dark}, state: on" and evaluate_cues(_show().cues, _directive("cue", args))
        assert back.args_for({**mid, "Night.dark_room": dark}) is None  # mid-cut: stays dark
    assert back.args_for({**done, "Night.dark_room": "none"}) is None
    for look in ("dance", "blackout", "restore", "y2k", "screensaver"):
        assert back.args_for({**done, "Night.dark_room": "The RAM", "Night.lights": look}) is None, look
    for look in ("pong", "glitch", "server_open", "truth_time", "trust_chart"):
        assert back.args_for({**done, "Night.dark_room": "The RAM", "Night.lights": look}) == "lights, room: The RAM, state: on", look
    assert back.args_for({**done, "Night.dark_room": "The Desktop", "Night.lights": "truth_time"}) is None  # re-lit the Desktop
    # The paths the catch-up reads are the ones the story writes.
    code = _code(_story_text())
    for path in ("Night.dark_room", "Night.dark_scene", "Night.lights_back_at", "Night.lit_scene"):
        assert re.search(rf"\bset\s+{re.escape(path)}\s*=", code), path


#: The story's 90 s restore (main.loom, `when Night.lights_back_at > 0 and
#: Time.elapsed >= Night.lights_back_at`) turns the cut room back on only
#: under a look that never re-lit it — the catch-up's two dark_room rules
#: must agree with it look by look (T8-stagehand-01, wave 9).
_RESTORE = re.compile(r"when Night\.lights_back_at > 0 and Time\.elapsed >= Night\.lights_back_at:\n  if (?P<cond>[^\n]+):\n    <cue: lights, room: \{Night\.dark_room\}, state: on>")


def _restores(lights: str, dark_room: str, dark_scene: str) -> bool:
    """Evaluate the story's own restore condition (a tiny translation of its
    `or` / `and` / `==` / `!=` into a stagehand Condition)."""
    m = _RESTORE.search(_story_text())
    assert m, "the story's 90 s restore rule moved — update this test"
    expr = m.group("cond").replace(" or ", " || ").replace(" and ", " && ").replace('"', "'")
    return Condition(expr).evaluate({"Night.lights": lights, "Night.dark_room": dark_room, "Night.dark_scene": dark_scene})


def test_the_cut_catch_up_agrees_with_the_storys_90_s_restore():
    _, _, room, back = _show().catch_up
    looks = sorted(_lights_values() - {"alarm"})
    for dark in ("The Start Bar", "The Desktop", "The RAM"):
        for scene in ("game", "truth_time", "screensaver"):
            for look in looks:
                kept_dark = _restores(look, dark, scene)
                world = {"Night.lights": look, "Night.dark_room": dark, "Night.dark_scene": scene}
                mid = room.args_for({**world, "Night.lights_back_at": "300"})
                # What the story's restore leaves behind under this look.
                lit = look if kept_dark else "none"
                done = back.args_for({**world, "Night.lights_back_at": "0", "Night.lit_scene": lit})
                assert (mid == f"lights, room: {dark}, state: off") is kept_dark, (dark, scene, look)
                assert (done == f"lights, room: {dark}, state: on") is kept_dark, (dark, scene, look)
                assert room.args_for({**world, "Night.lights_back_at": "0"}) is None
                assert back.args_for({**world, "Night.lights_back_at": "300", "Night.lit_scene": lit}) is None
                # A later look ends the replay only if it re-lit the room: a
                # room-scoped one (the story's test minus "the look he cut")
                # keeps the story's restore as the last word on the room.
                for later in looks:
                    if later != look:
                        scoped = _restores(later, dark, "-")
                        again = back.args_for({**world, "Night.lights": later, "Night.lights_back_at": "0", "Night.lit_scene": lit})
                        assert (again == f"lights, room: {dark}, state: on") is (kept_dark and scoped), (dark, look, later)
    # The cases the story-rules lane named: pong after a RAM cut, the glitch
    # after a Desktop cut, a living-room look over a Desktop cut (re-lit).
    assert back.args_for({"Night.lights": "pong", "Night.dark_room": "The RAM", "Night.dark_scene": "game", "Night.lights_back_at": "0", "Night.lit_scene": "pong"}) == "lights, room: The RAM, state: on"
    assert back.args_for({"Night.lights": "glitch", "Night.dark_room": "The Desktop", "Night.dark_scene": "game", "Night.lights_back_at": "0", "Night.lit_scene": "glitch"}) == "lights, room: The Desktop, state: on"
    assert back.args_for({"Night.lights": "truth_time", "Night.dark_room": "The Desktop", "Night.dark_scene": "game", "Night.lights_back_at": "0", "Night.lit_scene": "none"}) is None


def test_a_long_finished_cut_is_never_replayed_under_a_later_look():
    """T8 recheck: a Start Bar cut restored under one look, then a later look
    (the alarm latch's end putting back server_open, 🕚's y2k then the
    majority's server_open): the catch-up never punches the kitchen to
    full. The story's `Night.lit_scene` says which look the room came back
    on under, and nothing else replays the room-on."""
    _, _, room, back = _show().catch_up
    stale = {"Night.lights": "server_open", "Night.dark_scene": "y2k", "Night.dark_room": "The Start Bar", "Night.lights_back_at": "0", "Night.lit_scene": "none"}
    assert room.args_for(stale) is None and back.args_for(stale) is None
    # Restored under trust_chart, then the house moved on to y2k (whole-house:
    # no replay even before the story clears the mark), then server_open —
    # the story cleared lit_scene at y2k, so nothing replays there either.
    w = {**stale, "Night.lights": "y2k", "Night.dark_scene": "trust_chart", "Night.lit_scene": "trust_chart"}
    assert room.args_for(w) is None and back.args_for(w) is None
    w = {**w, "Night.lights": "server_open", "Night.lit_scene": "none"}
    assert room.args_for(w) is None and back.args_for(w) is None
    # A restore the house missed under pong is still replayed under the Trust
    # Chart (a living-room look over a RAM cut), never under y2k.
    lost = {"Night.lights": "trust_chart", "Night.lit_scene": "pong", "Night.dark_room": "The RAM", "Night.dark_scene": "game", "Night.lights_back_at": "0"}
    assert back.args_for(lost) == "lights, room: The RAM, state: on"
    assert back.args_for({**lost, "Night.lights": "y2k"}) is None
    # Still on the look it was restored into: the lost restore is replayed.
    assert back.args_for({"Night.lights": "pong", "Night.lit_scene": "pong", "Night.dark_room": "The RAM", "Night.dark_scene": "game", "Night.lights_back_at": "0"}) == "lights, room: The RAM, state: on"
    # The story writes lit_scene where the catch-up needs it: at the restore,
    # when the restore is skipped, at the alarm latch's end and at Power On.
    code = _code(_story_text())
    assert re.search(r"<cue: lights, room: \{Night\.dark_room\}, state: on>\s+set Night\.lit_scene = Night\.lights\s+else:\s+set Night\.lit_scene = \"none\"", code), "the restore's lit_scene moved"
    assert re.search(r'Night\.lights == "alarm":\s+set Night\.lights_back_at = 0\s+set Night\.lit_scene = "none"', code), "the latch's lit_scene moved"
    assert re.search(r'^set Night\.lit_scene = "none"$', code, re.M), "Power On's lit_scene moved"
    # ...and the mark ends at a look that re-lit the room (review 2/3): a
    # restore under the glitch, then call_desktop (whole-house), pong, the
    # Trust Chart and the beans' glitch again — the story cleared lit_scene
    # at call_desktop, so the room-on stays off. The story's clear and this
    # rule agree on which looks are room-scoped.
    clear = re.search(r'^when Night\.lit_scene != "none" and Night\.lights != Night\.lit_scene and (?P<cond>[^\n]+):\s+set Night\.lit_scene = "none"$', code, re.M)
    assert clear, "the look-change clear of lit_scene moved"
    clears = Condition(clear.group("cond").replace(" or ", " || ").replace(" and ", " && ").replace('"', "'"))
    for later in sorted(_lights_values() - {"alarm"}):
        for dark in ("The Start Bar", "The Desktop", "The RAM"):
            assert bool(clears.evaluate({"Night.lights": later, "Night.dark_room": dark})) != bool(_restores(later, dark, "-")), (later, dark)
    beans = {"Night.lights": "glitch", "Night.dark_room": "The RAM", "Night.dark_scene": "glitch", "Night.lights_back_at": "0", "Night.lit_scene": "none"}
    assert room.args_for(beans) is None and back.args_for(beans) is None


#: Words that name something able to hold a door shut. The only "lock" a
#: rule may touch is the ESP32 ring's indicator topic. "lock" / "bolt" only
#: at a word start (`door_lock`, `unlock`, `bolt`), so a `y2k_clock` or
#: `thunderbolt` cue never trips it; the compounds are named outright.
LOCKISH = re.compile(r"(?<![a-z])(?:un)?lock|(?<![a-z])bolt|maglock|deadbolt|strike|latch|relay|solenoid", re.I)
INDICATOR = "show/serverroom/lock"


def test_the_door_drives_the_indicator_and_nothing_drives_a_lock():
    """The server-room door has a STANDALONE keypad lock (code set by hand,
    never networked; the inside handle always opens). The ring only ever
    tells the truth, so the story sends `locked` and never `unlocked` (a
    win or a majority leaves the keypad lock exactly as it was; wave 7
    removed every `unlocked` emit); nothing in the YAML may drive a lock,
    a strike or a relay on any door."""
    for word in ("show/x/lock", "door_lock", "unlock", "MagLock", "deadbolt", "strike", "latch", "relay", "solenoid"):
        assert LOCKISH.search(word), word
    for word in ("y2k_clock", "thunderbolt", "blocked"):
        assert not LOCKISH.search(word), word
    text = _story_text()
    code = _code(text)
    assert re.search(r"^\s*do door server_room, state: locked\b", code, re.M)
    # Not even in a comment: an `unlocked` anywhere in the .loom files is a
    # line someone will uncomment.
    assert not re.search(r"state:\s*unlocked\b", text), "the story must never send state: unlocked"
    for state in ("locked", "unlocked"):
        cues = evaluate_cues(_show().cues, _directive("door", f"server_room, state: {state}"))
        assert cues == [MqttCue(topic=INDICATOR, payload=json.dumps({"state": state}), retain=True, qos=0)]
    # Every action of every cue rule, raw (any action kind, any field): no
    # topic, address or payload names a lock-ish thing, bar the indicator.
    for i, rule in enumerate(_raw()["show"]["cues"]):
        for kind, action in rule.items():
            if kind in ("on", True, "match"):
                continue
            topic = action.get("topic") if isinstance(action, dict) else None
            if topic == INDICATOR:
                assert kind == "mqtt" and set(action["payload"]) == {"state"}, f"cues[{i}]"
                continue
            assert not LOCKISH.search(json.dumps(action)), f"cues[{i}] {kind} drives a lock: {action}"
    # Nor does any sensor rule publish or forward to one.
    for i, rule in enumerate(_raw()["show"]["sensors"]):
        for kind, action in rule.items():
            if kind in ("on", True, "edge", "accept_retained", "signal"):
                continue
            assert not LOCKISH.search(json.dumps(action)), f"sensors[{i}] {kind}: {action}"
    assert "server_room_lock" not in HOUSE.read_text(encoding="utf-8")
    assert not re.search(r"maglock|door_lock|strike", json.dumps(_raw()["show"]), re.I)


def test_the_server_rooms_bulb_is_lights_jsons_and_nothing_here_touches_the_room():
    """Wave 20 (D10 / D11, Q6 / Q10): the server room's only light is the RGB
    bulb `server_room_rgb` (no strip), the `server_room` group's only member,
    and it is lights.json's: no rule or catch-up here sends the group, the
    bulb or a server-room WLED topic anything, so no house look (y2k,
    flicker, blackout, dance, alarm, restore, …) fights the heart's looks.
    lights_alarm reaches WLED per device, never `wled/all`, and gives the
    tube strip a steady red; lights_server_open only stops the ESP32."""
    cfg = _show()
    room = re.compile(r"^(zigbee2mqtt/server_room(_rgb)?(/|$)|wled/server(/|$))")
    assert not [r.mqtt.topic for r in cfg.cues if r.mqtt is not None and room.search(r.mqtt.topic)]
    assert "wled/server" not in HOUSE.read_text(encoding="utf-8")
    for rule in cfg.catch_up:
        for value in ("server_open", "alarm", "y2k", "blackout", "restore", "dance"):
            arg = rule.args_for({"Night.lights": value, "Night.lights_back_at": "0", "Night.dark_room": "none", "Night.lit_scene": "none"})
            if arg is None:
                continue
            for c in evaluate_cues(cfg.cues, _directive("cue", arg)):
                assert not (hasattr(c, "topic") and room.search(c.topic)), (value, c.topic)
    alarm = _mqtt(evaluate_cues(cfg.cues, _directive("cue", "lights_alarm")))
    topics = [t for t, _ in alarm]
    assert "wled/all/api" not in topics
    for r in ("living", "kitchen", "backyard", "registry"):
        assert (f"wled/{r}/api", {"on": True, "ps": 12}) in alarm, r
    assert [p for t, p in alarm if t == "wled/tube/api"] == [{"on": True, "bri": 255, "seg": [{"col": [[255, 0, 0]], "fx": 0}]}]
    opened = _mqtt(evaluate_cues(cfg.cues, _directive("cue", "lights_server_open")))
    assert opened == [("show/serverroom/alarm", {"state": "off"})]


def test_the_server_room_bulb_is_its_safety_light_in_lights_json():
    """Q6: with no strip the bulb is the room's only light, so lights.json
    keeps it a safety fixture at 80 / 254, and every heart look stays on and
    at or above that floor (egress: the room is never near-dark)."""
    lights = json.loads((STORY / "lights.json").read_text(encoding="utf-8"))
    assert [(f["id"], f["device"], f.get("safety"), f.get("min")) for f in lights["fixtures"]] == [("server-room-rgb", "server_room_rgb", True, 80)]
    for name, look in lights["looks"].items():
        for s in [look.get("set")] + [st["set"] for st in look.get("steps", [])]:
            if s is None:
                continue
            assert s.get("state") != "OFF", name
            assert s.get("brightness", 254) >= 80, (name, s)


#: WLED presets that are effects going dark between frames (strobe, lightning,
#: pulse, audio-reactive, embers): never on `wled/all` or a safety strip.
WLED_EFFECT_PRESETS = {7, 10, 12, 14, 15, 17}
#: The presets still sent to `wled/all`, built solid on the tube controller.
WLED_ALL_SOLID = {1, 3, 6, 16, 18, 19, 20}


def test_no_safety_strip_ever_gets_a_strobe():
    """Wave 20 review (D11): every cue, not just the alarm. `wled/all` carries
    only the presets the YAML says are built solid there, and the tube
    strip never gets an effect preset (the server room has no strip)."""
    for rule in _show().cues:
        if rule.mqtt is None or not rule.mqtt.topic.startswith("wled/") or not isinstance(rule.mqtt.payload, dict):
            continue
        topic, ps = rule.mqtt.topic, rule.mqtt.payload.get("ps")
        if topic == "wled/all/api":
            assert ps in WLED_ALL_SOLID, f"cues[{rule.id}] sends wled/all ps {ps}"
        if topic == "wled/tube/api":
            assert ps not in WLED_EFFECT_PRESETS, f"cues[{rule.id}] strobes {topic} (ps {ps})"
            for seg in rule.mqtt.payload.get("seg", []):
                assert seg.get("fx", 0) == 0, f"cues[{rule.id}] runs an effect on {topic}"
    for cue, ps in (("lights_glitch", 7), ("lights_y2k", 10), ("lights_dance", 14), ("lights_final_reveal", 15), ("lights_rave", 17)):
        out = _mqtt(evaluate_cues(_show().cues, _directive("cue", cue)))
        for room in ("living", "kitchen", "backyard", "registry"):
            assert (f"wled/{room}/api", {"on": True, "ps": ps}) in out, (cue, room)
        assert out[-1] == ("wled/tube/api", {"on": True, "ps": 22}), cue
    text = HOUSE.read_text(encoding="utf-8")
    assert "Only ps 1, 3, 6, 16, 18, 19 and 20 still go to `wled/all`" in text


def test_the_lights_section_is_a_commented_example_until_z2m_runs():
    text = HOUSE.read_text(encoding="utf-8")
    assert "lights" not in _raw()
    assert re.search(r"^# lights:$", text, re.M) and "take_looks: true" in text


def test_the_alarm_reaches_the_server_room_box_and_stops_when_it_opens():
    alarm = _mqtt(evaluate_cues(_show().cues, _directive("cue", "lights_alarm")))
    assert ("show/serverroom/alarm", {"state": "on", "seconds": 120}) in alarm
    for cue in ("lights_server_open", "lights_restore"):
        assert ("show/serverroom/alarm", {"state": "off"}) in _mqtt(evaluate_cues(_show().cues, _directive("cue", cue))), cue


# -- safe lights (K-05 critic pass) -------------------------------------------------

#: Z2M groups that hold only safety bulbs (they are out of `house`), and the
#: WLED device that must never go dark: the Tube strip (hall + stair landing).
#: The server room's one light is its RGB bulb, lights.json's (Q6 / Q10).
SAFE_Z2M = ("bathroom", "tent", "server_room", "server_room_rgb", "stairs", "path")
SAFE_WLED = ("tube",)


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
    # Guests are in the server room: nothing here reaches its bulb (lights.json's).
    assert not any(t.startswith(("zigbee2mqtt/server_room", "wled/server")) for t in topics)


# -- 2. every sensor signal is a story rule -----------------------------------------


def _signals() -> list[str]:
    return [rule["signal"]["name"] for rule in _raw()["show"]["sensors"] if "signal" in rule]


def test_every_sensor_signal_is_a_when_rule_in_main_loom():
    main = _code((STORY / "main.loom").read_text(encoding="utf-8"))
    names = _signals()
    # Wave 20 (D16): the door is the M4's (the terminal posts it), never a YAML rule.
    assert "server_door_opened" not in names and "server_door_closed" not in names
    assert {"printer_button_pressed", "printer_opened", "patch_combo_a", "patch_combo_b", "patch_rejected"} <= set(names)
    missing = [n for n in names if not re.search(rf"^when\s+{re.escape(n)}\s*(?:for\s+\w+\s*)?:", main, re.M)]
    assert not missing, f"signals main.loom never handles (a typo is silent on the night): {missing}"


def test_the_door_printer_and_patch_bay_fire_the_right_signals():
    rules = _show().sensors
    deb = Debouncer()

    def fire(topic: str, payload: dict) -> list[str]:
        return [c.fields["name"] for c in evaluate_sensors(rules, topic, payload, deb, now=1000.0)]

    # Wave 20 (D16): neither old door sensor fires anything.
    for topic, payload in (("sensors/serverroom/door", {"open": True}), ("sensors/serverroom/door", {"open": False}), ("zigbee2mqtt/server_room_door", {"contact": False}), ("zigbee2mqtt/server_room_door", {"contact": True})):
        assert fire(topic, payload) == [], topic
    assert fire("zigbee2mqtt/printer_button", {"action": "single"}) == ["printer_button_pressed"]
    assert fire("zigbee2mqtt/printer_button", {"action": ""}) == []
    assert fire("zigbee2mqtt/printer_lid", {"contact": False}) == ["printer_opened"]
    combo_a, combo_b = _yaml_combos()
    assert fire("sensors/patchbay/state", {"complete": True, "combo": combo_a}) == ["patch_combo_a"]
    assert fire("sensors/patchbay/state", {"complete": True, "combo": combo_b}) == ["patch_combo_b"]
    assert fire("sensors/patchbay/state", {"complete": True, "combo": "V1-D1,V2-D2,V3-D3,V4-D4"}) == ["patch_rejected"]
    assert fire("sensors/patchbay/state", {"complete": False, "combo": "V1-D1"}) == []


def test_state_sensors_fire_once_per_change():
    rules = _show().sensors
    edged = {(r.topic.filter, r.actions[0].fields["name"]) for r in rules if r.edge}
    assert edged >= {
        ("zigbee2mqtt/printer_lid", "printer_opened"),
        ("sensors/patchbay/state", "patch_combo_a"),
        ("sensors/patchbay/state", "patch_combo_b"),
    }
    assert not any(r.accept_retained for r in rules)

    def fire(deb, topic, payload, now, retained=False):
        return [c.fields["name"] for c in evaluate_sensors(rules, topic, payload, deb, now=now, retained=retained)]

    # Each combo fires exactly once while it stays plugged in.
    combo_a, _ = _yaml_combos()
    deb = Debouncer()
    hits = [fire(deb, "sensors/patchbay/state", {"complete": True, "combo": combo_a}, t) for t in (0.0, 61.0, 200.0)]
    assert hits == [["patch_combo_a"], [], []]
    fire(deb, "sensors/patchbay/state", {"complete": False, "combo": "V1-D6"}, 300.0)
    assert fire(deb, "sensors/patchbay/state", {"complete": True, "combo": combo_a}, 400.0) == ["patch_combo_a"]


def test_no_rule_reads_the_server_room_door_any_more():
    """Wave 20 (D16, D19): the door is an LDR + LED read by the Grand Central
    M4 at his heart's terminal, which posts door_sensor_opened / _closed. A
    YAML rule posting server_door_opened would be a director's 🚪 override in
    the story and take the door off the sensor for the night."""
    topics = {r.get("on", r.get(True))["topic"] for r in _raw()["show"]["sensors"]}
    assert not topics & {"sensors/serverroom/door", "zigbee2mqtt/server_room_door"}
    assert not [r for r in _raw()["show"]["sensors"] if "door" in json.dumps(r.get("signal", {}))]


def test_the_story_owns_the_door_signals():
    """`server_door_closed` (the new 🚪) and the sensor's two edges are story
    rules (main.loom, the story lane's)."""
    main = _code((STORY / "main.loom").read_text(encoding="utf-8"))
    if "server_door_closed" not in main:
        pytest.skip("the wave 20 story (main.loom) is not merged into this tree yet")
    for name in ("server_door_closed", "door_sensor_opened", "door_sensor_closed"):
        assert re.search(rf"^when\s+{name}\s*(?:for\s+\w+\s*)?:", main, re.M), name


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
        # Wave 22: the M4 bay has 8 sources (V1–V8) and 7 inputs (D1–D7).
        assert all(1 <= int(v) <= 8 and 1 <= int(d) <= 7 for v, d in pairs), f"{combo} is not on the 8 + 7 bay"

    main = (STORY / "main.loom").read_text(encoding="utf-8")
    seeds = dict(re.findall(r'set\s+Kernel\.(combo_[ab])\s*=\s*"([^"]+)"', main))
    assert seeds.get("combo_a") == combo_a, f"Kernel.combo_a seed {seeds.get('combo_a')!r} != YAML {combo_a!r}"
    assert seeds.get("combo_b") == combo_b, f"Kernel.combo_b seed {seeds.get('combo_b')!r} != YAML {combo_b!r}"

    codex = _story_text()
    assert _codex_combo(codex, "A") == combo_a
    assert _codex_combo(codex, "B") == combo_b


@pytest.mark.parametrize("cue", ["lights_screensaver", "lights_song"])
def test_scene_cues_hit_both_zigbee_and_wled(cue):
    cues = evaluate_cues(_show().cues, _directive("cue", cue))
    topics = {c.topic for c in cues if isinstance(c, MqttCue)}
    assert "zigbee2mqtt/house/set" in topics and "wled/all/api" in topics


def test_the_router_speaks_with_the_macs_own_voice():
    """Decision 2026-10-15, kept by the router (wave 18b): the house speakers
    use the Mac's `say` voice, so an announcement never waits on (or needs)
    the VPS. No `alexa:` section: one owner of the house's voice."""
    raw = _raw()
    assert "alexa" not in raw
    audio = load_config(HOUSE).modules["audio"].cfg
    assert audio.say_voice and audio.chime == "synth"


def test_the_starter_audio_json_is_the_828x_with_its_expander():
    """wave 18b (Q2, D1): our channel numbers are the 828x's own — 24 in /
    22 out used, the device must report 32 / 30 (`device.expect`), the
    expander on Optical A (outputs 15–22, inputs 17–24), the placed speakers
    unmoved on 1, 2, 3, 4 and 8, and no tablet says the announcements by
    itself (`announce.terminals` empty)."""
    audio = json.loads(AUDIO_JSON.read_text(encoding="utf-8"))
    dev = audio["device"]
    assert (dev["name"], dev["inputs"], dev["outputs"], dev["rate"], dev["expect"]) == ("828x", 24, 22, 48000, {"inputs": 32, "outputs": 30})
    assert [c["ch"] for c in audio["inputs"]] == list(range(1, 25))
    assert [c["ch"] for c in audio["outputs"]] == [*range(1, 11), *range(15, 23)]
    assert all("ADAT A" in c["label"] for c in audio["outputs"] if c["ch"] >= 15)
    assert all("ADAT A" in c["label"] for c in audio["inputs"] if c["ch"] >= 17)
    assert {s["id"]: s["out"] for s in audio["speakers"]} == {"living-l": [1], "living-r": [2], "kitchen-l": [3], "kitchen-r": [4], "optical-drive": [8]}
    assert audio["routes"] == [] and audio["announce"] == {"to": ["everywhere"], "chime": True, "terminals": []}
    assert "QLab" not in json.dumps(audio)


def test_server_open_catches_up_the_y2k_house_look_underneath():
    """T8-stagehand-02: server_open (the majority, The Heart) touches only
    the server room, on top of the Y2K house look. A catch-up replays the
    house layer first, as the story's own alarm restore does, so a house
    left on the alarm's red strobe (or a bulb back at power-on white) is
    put right on every reconnect from step 14 to the reveal."""
    cfg = _show()
    world = {"Night.lights": "server_open", "Night.lights_back_at": "0", "Night.dark_room": "none"}
    args = [a for a in (rule.args_for(world) for rule in cfg.catch_up) if a is not None]
    assert args == ["lights_y2k", "lights_server_open"]
    topics = [c.topic for a in args for c in evaluate_cues(cfg.cues, _directive("cue", a)) if hasattr(c, "topic")]
    assert topics.index("zigbee2mqtt/house/set") < topics.index("show/serverroom/alarm"), topics
    assert "wled/living/api" in topics and "wled/all/api" not in topics, topics
    # Wave 20 (D10, Q6 / Q10): the RGB bulb is lights.json's; nothing here reaches it.
    assert not [t for t in topics if t.startswith(("zigbee2mqtt/server_room", "wled/server"))], topics
    # The story says so too: the latch's end restores server_open as y2k + server_open.
    assert re.search(r"cue lights_y2k\s+cue lights_server_open", _code(_story_text())), "the story's restore order moved"
    # Any other look replays once, no extra house layer.
    for value in ("y2k", "game", "glitch"):
        got = [a for a in (rule.args_for({**world, "Night.lights": value}) for rule in cfg.catch_up) if a is not None]
        assert got == [f"lights_{value}"], (value, got)


def test_the_flicker_never_changes_the_look_on_the_strips():
    """T8-stagehand-03: screens_flicker is an overlay that changes no mirror.
    The bulbs' `effect: blink` reverts by itself; a WLED preset would not (ps
    21's playlist ended on house normal), so the flicker sends the strips
    nothing and every look survives it, the beans' glitch included."""
    cues = _show().cues
    sent = [c for c in evaluate_cues(cues, _directive("cue", "screens_flicker")) if isinstance(c, MqttCue)]
    assert sent and not [c.topic for c in sent if c.topic.startswith("wled/")], [c.topic for c in sent]
    assert all(json.loads(c.payload) == {"effect": "blink"} for c in sent), [c.payload for c in sent]
    used = set(re.findall(r"\bcue\s+(lights_[a-z0-9_]+)\b", _code(_story_text())))
    for look in sorted(used):
        def last_wled(seq: list[str]) -> dict[str, str]:
            out: dict[str, str] = {}
            for cue in seq:
                for c in evaluate_cues(cues, _directive("cue", cue)):
                    if isinstance(c, MqttCue) and c.topic.startswith("wled/"):
                        out[c.topic] = c.payload
            return out
        assert last_wled([look, "screens_flicker"]) == last_wled([look]), look
