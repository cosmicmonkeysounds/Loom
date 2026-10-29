from pathlib import Path

import pytest
import yaml

from stagehand.config import ConfigError, load_config, parse_config
from stagehand.modapi import ModClient
from stagehand.show.module import ShowControl, _decode_payload

ROOT = Path(__file__).resolve().parents[1]
SHOW_EXAMPLE = ROOT / "show.example.yaml"
AGENTS_EXAMPLE = ROOT / "agents.example.yaml"


def minimal(**show_overrides):
    show = {
        "mqtt": {"host": "127.0.0.1"},
        "osc": {"targets": {"desktop": {"host": "10.0.0.1", "port": 9000}}},
        "cues": [],
        "sensors": [],
    }
    show.update(show_overrides)
    return {"server": {"url": "http://127.0.0.1:7000", "mod_passcode": "x"}, "show": show}


def show_of(doc) -> ShowControl:
    module = parse_config(doc).modules["show"]
    assert isinstance(module, ShowControl)
    return module


def test_example_show_config_loads():
    cfg = load_config(SHOW_EXAMPLE)
    assert cfg.server.url.startswith("http")
    show = cfg.modules["show"]
    assert isinstance(show, ShowControl)
    assert show.cfg.mqtt is not None
    assert len(show.cfg.cues) == 6
    assert len(show.cfg.sensors) == 4
    # one filter per distinct pattern; the two zone rules share one
    assert sorted(show.cfg.mqtt_filters) == sorted(
        ["sensors/crawlspace/proximity", "vision/+/tamper", "vision/+/zone"]
    )


def test_example_agents_config_loads():
    cfg = load_config(AGENTS_EXAMPLE)
    assert list(cfg.modules) == ["agents"]
    agents = cfg.modules["agents"]
    assert list(agents.cfg.personas) == ["Trabolta"]
    assert agents.cfg.models["Trabolta"].model == "gpt-oss:20b"
    # The voice's context is pinned (S1-01): Ollama's own default moves with
    # its version and the machine's memory.
    assert agents.cfg.models["Trabolta"].context_window == 32768
    assert agents.warnings() == []
    # The example shows the new mind with every wave 12 key at its default.
    assert agents.cfg.mind_mode == "new" and agents.cfg.orchestrator.enabled is False
    assert (agents.cfg.voice.memo, agents.cfg.voice.repeat_guard, agents.cfg.voice.dossier_on_close, agents.cfg.voice.layout) == (True, True, True, "lean")
    assert agents.cfg.voice.warm_head is True
    assert (agents.cfg.mind.stage_from_phase, agents.cfg.mind.phase_poll_s) == (True, 30.0)


def _agents(tmp_path, **section):
    from stagehand.agents.config import parse_agents

    (tmp_path / "t.persona.md").write_text("---\ncharacter: T\n---\nYou are T.\n", encoding="utf-8")
    return parse_agents({"characters": ["t.persona.md"], **section}, str(tmp_path))


def test_mind_mode_is_classic_when_absent_and_the_new_keys_default_on(tmp_path):
    cfg = _agents(tmp_path)
    assert cfg.mind_mode == "classic" and not cfg.new_mind
    new = _agents(tmp_path, mind_mode="NEW", voice={"memo": "off", "repeat_guard": False, "layout": "classic"}, mind={"stage_from_phase": "off", "phase_poll_s": 0})
    assert new.new_mind
    assert (new.voice.memo, new.voice.repeat_guard, new.voice.dossier_on_close, new.voice.layout) == (False, False, True, "classic")
    assert (new.mind.stage_from_phase, new.mind.phase_poll_s) == (False, 0.0)
    assert new.voice.warm_head is True and cfg.voice.warm_head is True
    assert _agents(tmp_path, mind_mode="new", voice={"warm_head": "off"}).voice.warm_head is False


@pytest.mark.parametrize(
    "section, match",
    [
        ({"mind_mode": "fancy"}, "mind_mode"),
        ({"voice": {"memos": True}}, "agents.voice: unknown key"),
        ({"voice": {"layout": "wide"}}, "agents.voice.layout"),
        ({"voice": {"memo": "maybe"}}, "agents.voice.memo: expected on or off"),
        ({"voice": "on"}, "agents.voice: must be a mapping"),
        ({"mind": {"poll": 3}}, "agents.mind: unknown key"),
        ({"mind": {"phase_poll_s": -1}}, "phase_poll_s"),
        ({"mind": {"phase_poll_s": "often"}}, "phase_poll_s"),
        ({"mind": {"stage_from_phase": 2}}, "stage_from_phase"),
    ],
)
def test_the_new_mind_keys_are_validated(tmp_path, section, match):
    with pytest.raises(ConfigError, match=match):
        _agents(tmp_path, **section)


def test_on_off_read_from_yaml_as_booleans(tmp_path):
    doc = yaml.safe_load("voice: {memo: off, repeat_guard: on}\nmind: {stage_from_phase: off}\n")
    cfg = _agents(tmp_path, mind_mode="new", **doc)
    assert cfg.voice.memo is False and cfg.voice.repeat_guard is True and cfg.mind.stage_from_phase is False


def test_missing_auth_rejected():
    doc = minimal()
    del doc["server"]["mod_passcode"]
    with pytest.raises(ConfigError, match="mod_token"):
        parse_config(doc)


def test_unknown_section_rejected():
    doc = minimal()
    doc["cues"] = []  # the pre-module layout: cues at the top level
    with pytest.raises(ConfigError, match="unknown section"):
        parse_config(doc)


def test_no_modules_rejected():
    with pytest.raises(ConfigError, match="nothing to run"):
        parse_config({"server": {"url": "http://h", "mod_passcode": "x"}})


def test_only_selects_modules(tmp_path):
    doc = minimal()
    doc["agents"] = {"characters": []}  # would fail to parse — but it isn't selected
    cfg = parse_config(doc, only=["show"])
    assert list(cfg.modules) == ["show"]
    with pytest.raises(ConfigError, match="no 'vision:'|no module named"):
        parse_config(doc, only=["vision"])


def test_osc_cue_without_targets_rejected():
    doc = minimal(cues=[{"on": {"directive": "cue"}, "osc": {"addr": "/x"}}])
    doc["show"].pop("osc")
    with pytest.raises(ConfigError, match="osc.targets"):
        parse_config(doc)


def test_unknown_osc_to_rejected():
    doc = minimal(cues=[{"on": {"directive": "cue"}, "osc": {"addr": "/x", "to": "mars"}}])
    with pytest.raises(ConfigError, match="mars"):
        parse_config(doc)


def test_mqtt_cue_without_broker_rejected():
    doc = minimal(cues=[{"on": {"directive": "p"}, "mqtt": {"topic": "t"}}])
    doc["show"].pop("mqtt")
    with pytest.raises(ConfigError, match="broker"):
        parse_config(doc)


def test_sensors_without_broker_rejected():
    doc = minimal(sensors=[{"on": {"topic": "a/b"}, "signal": {"name": "s"}}])
    doc["show"].pop("mqtt")
    with pytest.raises(ConfigError, match="broker"):
        parse_config(doc)


def test_bad_cue_rule_is_a_config_error():
    with pytest.raises(ConfigError, match="show"):
        show_of(minimal(cues=[{"on": {}}]))


def test_bad_yaml_rejected(tmp_path):
    p = tmp_path / "bad.yaml"
    p.write_text("server: [unclosed", encoding="utf-8")
    with pytest.raises(ConfigError, match="bad YAML"):
        load_config(p)


def test_example_yaml_is_valid_yaml():
    yaml.safe_load(SHOW_EXAMPLE.read_text(encoding="utf-8"))


# -- adjacent pure helpers --------------------------------------------------


def test_mod_client_paths():
    default = ModClient("http://h:7000", event="default")
    assert default.path("/api/mod/signal") == "/api/mod/signal"
    assert default.sse_url == "http://h:7000/events?role=mod&id=stagehand&lean=1"
    scoped = ModClient("http://h:7000/", event="ev_42")
    assert scoped.path("/api/mod/signal") == "/e/ev_42/api/mod/signal"
    assert scoped.sse_url == "http://h:7000/e/ev_42/events?role=mod&id=stagehand&lean=1"


def test_decode_payload():
    assert _decode_payload(b'{"near": true}') == {"near": True}
    assert _decode_payload(b"42") == {"value": 42}
    assert _decode_payload(b"on") == {"value": "on"}
    assert _decode_payload(b"true") == {"value": True}
    assert _decode_payload(b"\xff\xfe") == {"value": None}


# ── secrets out of git: the .local.yaml overlay + LOOM_* env ───────────────


def _house(tmp_path, server):
    doc = minimal()
    doc["server"] = server
    p = tmp_path / "trapped.house.yaml"
    p.write_text(yaml.safe_dump(doc), encoding="utf-8")
    return p


def test_local_overlay_fills_the_placeholders(tmp_path):
    from stagehand.config import placeholders

    p = _house(tmp_path, {"url": "https://x", "event": "CHANGE-ME-EVENT-ID", "mod_passcode": "CHANGE-ME"})
    assert placeholders(load_config(p, env={}).server) == ["event", "mod_passcode"]
    (tmp_path / "trapped.house.local.yaml").write_text("server: { event: ev-7, mod_passcode: 'real' }\n", encoding="utf-8")
    cfg = load_config(p, env={})
    assert (cfg.server.url, cfg.server.event, cfg.server.mod_passcode) == ("https://x", "ev-7", "real")
    assert placeholders(cfg.server) == []


def test_env_beats_the_overlay_and_a_token_drops_the_placeholder_passcode(tmp_path):
    p = _house(tmp_path, {"url": "https://x", "event": "CHANGE-ME-EVENT-ID", "mod_passcode": "CHANGE-ME"})
    (tmp_path / "trapped.house.local.yaml").write_text("server: { event: ev-7 }\n", encoding="utf-8")
    cfg = load_config(p, env={"LOOM_EVENT_ID": "ev-9", "LOOM_MOD_TOKEN": "tok", "LOOM_MOD_PASSCODE": ""})
    assert (cfg.server.event, cfg.server.mod_token, cfg.server.mod_passcode) == ("ev-9", "tok", None)


def test_local_overlay_may_only_hold_server(tmp_path):
    p = _house(tmp_path, {"url": "https://x", "mod_passcode": "x"})
    (tmp_path / "trapped.house.local.yaml").write_text("show: { cues: [] }\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="only hold a 'server:'"):
        load_config(p, env={})


def test_local_overlay_is_git_ignored():
    assert "*.local.yaml" in (ROOT / ".gitignore").read_text(encoding="utf-8").split()


def test_cache_folders_follow_the_platform():
    from stagehand.paths import user_cache

    assert user_cache("stagehand-audio", "darwin") == "~/Library/Caches/stagehand-audio"  # the Mac: unchanged
    win = user_cache("stagehand-lights", "win32", {"LOCALAPPDATA": r"C:\Users\john\AppData\Local"})
    assert win.replace("/", "\\").endswith(r"AppData\Local\stagehand\lights")


# ── extends: one machine's file builds on another's (the Desktop, the MacBook) ──


def test_merge_docs_merges_mappings_replaces_the_rest_and_null_deletes():
    from stagehand.config import merge_docs

    parent = {"a": {"x": 1, "y": [1, 2], "z": {"k": 1}}, "b": 2, "c": 3}
    child = {"a": {"y": [3], "z": {"j": 2}}, "b": None, "d": 4}
    assert merge_docs(parent, child) == {"a": {"x": 1, "y": [3], "z": {"k": 1, "j": 2}}, "c": 3, "d": 4}
    assert parent["a"]["y"] == [1, 2]  # never mutated


def _write(p: Path, doc) -> Path:
    p.write_text(yaml.safe_dump(doc, allow_unicode=True), encoding="utf-8")
    return p


def test_extends_builds_on_the_parent_and_its_secrets(tmp_path):
    house = minimal()
    house["server"] = {"url": "https://x", "event": "CHANGE-ME-EVENT-ID", "mod_passcode": "CHANGE-ME"}
    house["audio"] = {"announce": True, "mqtt": {"host": "127.0.0.1", "port": 1883}}
    _write(tmp_path / "trapped.house.yaml", house)
    (tmp_path / "trapped.house.local.yaml").write_text("server: { event: ev-7, mod_passcode: 'real' }\n", encoding="utf-8")
    _write(tmp_path / "trapped.macbook.yaml", {"extends": "trapped.house.yaml", "audio": {"mqtt": {"host": "192.168.8.10", "port": 1884, "username": "props"}}})
    (tmp_path / "trapped.macbook.local.yaml").write_text("server: {}\naudio: { mqtt: { password: s3cret }, device: '828x' }\n", encoding="utf-8")
    cfg = load_config(tmp_path / "trapped.macbook.yaml", env={})
    assert (cfg.server.event, cfg.server.mod_passcode) == ("ev-7", "real")  # the house's own overlay
    m = cfg.modules["audio"].cfg.mqtt
    assert (m.host, m.port, m.username, m.password) == ("192.168.8.10", 1884, "props", "s3cret")
    assert cfg.modules["audio"].cfg.device == "828x"
    assert set(cfg.modules) == {"show", "audio"}  # the parent's show rules came along


def test_extends_null_drops_a_parent_section(tmp_path):
    house = {**minimal(), "audio": {}}
    _write(tmp_path / "trapped.house.yaml", house)
    _write(tmp_path / "trapped.desktop.yaml", {"extends": "trapped.house.yaml", "audio": None, "lights": {}})
    cfg = load_config(tmp_path / "trapped.desktop.yaml", env={})
    assert set(cfg.modules) == {"show", "lights"}


def test_extends_refuses_a_circle_another_folder_and_a_missing_file(tmp_path):
    _write(tmp_path / "a.yaml", {"extends": "b.yaml", **minimal()})
    _write(tmp_path / "b.yaml", {"extends": "a.yaml"})
    with pytest.raises(ConfigError, match="circle"):
        load_config(tmp_path / "a.yaml", env={})
    (tmp_path / "sub").mkdir()
    _write(tmp_path / "sub" / "c.yaml", minimal())
    _write(tmp_path / "d.yaml", {"extends": "sub/c.yaml"})
    with pytest.raises(ConfigError, match="same folder"):
        load_config(tmp_path / "d.yaml", env={})
    _write(tmp_path / "e.yaml", {"extends": "nope.yaml"})
    with pytest.raises(ConfigError, match="no such file"):
        load_config(tmp_path / "e.yaml", env={})


def test_the_overlay_carries_credentials_but_never_rules_or_a_new_module(tmp_path):
    p = _house(tmp_path, {"url": "https://x", "mod_passcode": "x"})
    (tmp_path / "trapped.house.local.yaml").write_text("server: {}\nshow: { mqtt: { password: p } }\n", encoding="utf-8")
    assert load_config(p, env={}).modules["show"].cfg.mqtt.password == "p"
    (tmp_path / "trapped.house.local.yaml").write_text("server: {}\nlights: { mqtt: { password: p } }\n", encoding="utf-8")
    assert set(load_config(p, env={}).modules) == {"show"}  # never switches a module on
    for bad in ("server: {}\naudio: { play_sounds: true }\n", "server: {}\nshow: { mqtt: { topic: x } }\n", "server: {}\nnope: {}\n"):
        (tmp_path / "trapped.house.local.yaml").write_text(bad, encoding="utf-8")
        with pytest.raises(ConfigError, match="only hold a 'server:'"):
            load_config(p, env={})
