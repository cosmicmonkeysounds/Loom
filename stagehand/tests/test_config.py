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
    assert len(show.cfg.cues) == 4
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
    assert default.sse_url == "http://h:7000/events?role=mod&id=stagehand"
    scoped = ModClient("http://h:7000/", event="ev_42")
    assert scoped.path("/api/mod/signal") == "/e/ev_42/api/mod/signal"
    assert scoped.sse_url == "http://h:7000/e/ev_42/events?role=mod&id=stagehand"


def test_decode_payload():
    assert _decode_payload(b'{"near": true}') == {"near": True}
    assert _decode_payload(b"42") == {"value": 42}
    assert _decode_payload(b"on") == {"value": "on"}
    assert _decode_payload(b"true") == {"value": True}
    assert _decode_payload(b"\xff\xfe") == {"value": None}
