"""`stagehand lights test | pair | devices` and `check --only lights`:
through the event server (the lights module acts on its next poll)."""

from __future__ import annotations

import pytest

from stagehand import cli, modapi
from stagehand.lights import module as lights_module


def conf(tmp_path, lights: str = "{}") -> str:
    p = tmp_path / "house.yaml"
    p.write_text(f"server: {{url: 'http://h', mod_passcode: x}}\nlights: {lights}\n", encoding="utf-8")
    return str(p)


@pytest.fixture
def server(monkeypatch):
    calls: list[tuple] = []
    answers: dict = {"post": {"ok": True, "seq": 4, "module": True, "until": 1}, "get": {}}

    class Fake:
        def __init__(self, *a, **k) -> None:
            pass

        async def post(self, path, body):
            calls.append(("POST", path, body))
            return answers["post"]

        async def get(self, path, params=None, timeout=None):
            calls.append(("GET", path, params))
            return answers["get"]

        async def aclose(self):
            pass

    monkeypatch.setattr(modapi, "ModClient", Fake)
    return calls, answers


def test_test_identifies_a_fixture_plays_a_look_or_sets_a_state(tmp_path, server, capsys):
    calls, _ = server
    c = conf(tmp_path)
    assert cli.main(["lights", "test", "server-room-rgb", "--config", c]) == 0
    assert cli.main(["lights", "test", "heart_wake", "--config", c]) == 0
    assert cli.main(["lights", "test", "server-room-rgb", "--color", "#FF0000", "--brightness", "90", "--config", c]) == 0
    assert [x[2] for x in calls] == [{"fixture": "server-room-rgb"}, {"look": "heart_wake"}, {"fixture": "server-room-rgb", "set": {"color": "#FF0000", "brightness": 90}}]
    assert all(x[1] == "/api/mod/lights/test" for x in calls)
    assert cli.main(["lights", "test", "--config", c]) == 2


def test_pair_and_a_module_that_isnt_listening(tmp_path, server, capsys):
    calls, answers = server
    assert cli.main(["lights", "pair", "--config", conf(tmp_path)]) == 0
    assert calls[-1] == ("POST", "/api/mod/lights/pair", {"seconds": 120})
    assert cli.main(["lights", "pair", "--seconds", "0", "--config", conf(tmp_path)]) == 0
    assert calls[-1][2] == {"seconds": 0}
    assert cli.main(["lights", "pair", "--seconds", "300", "--config", conf(tmp_path)]) == 2
    answers["post"] = {"ok": True, "seq": 5, "module": False}
    assert cli.main(["lights", "test", "heart_idle", "--config", conf(tmp_path)]) == 1
    assert "no lights module is listening" in capsys.readouterr().err


def test_devices_lists_zigbee2mqtt_and_the_module(tmp_path, server, capsys):
    _, answers = server
    answers["get"] = {
        "version": "abcd1234", "source": "project",
        "lights": {"fixtures": [{"id": "server-room-rgb", "device": "server_room_rgb"}]},
        "devices": [{"friendly": "server_room_rgb", "type": "Router", "model": "m", "vendor": "v", "caps": {"color": True, "ct": True, "dim": True}},
                    {"friendly": "printer_button", "type": "EndDevice", "model": None, "caps": None}],
        "devicesAt": 5, "module": {"name": "house-mac", "at": 1, "online": True}, "problems": [],
    }
    assert cli.main(["lights", "devices", "--config", conf(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "online · house-mac" in out and "💡 server_room_rgb" in out and "color+ct+dim" in out and "not a light" in out


def test_check_only_lights_reports_the_broker_z2m_and_unknown_devices(tmp_path, monkeypatch, capsys):
    lj = tmp_path / "lights.json"
    lj.write_text('{"version": 1, "fixtures": [{"id": "rgb", "kind": "zigbee", "device": "server_room_rgb"}], "zones": [], "looks": {}}', encoding="utf-8")
    c = conf(tmp_path, f"{{config_file: '{lj}', cache_dir: '{tmp_path / 'cache'}'}}")
    monkeypatch.setattr(lights_module, "probe_broker", lambda cfg: None)
    assert cli.main(["check", "--config", c, "--only", "lights"]) == 3
    assert "no MQTT broker" in capsys.readouterr().err
    monkeypatch.setattr(lights_module, "probe_broker", lambda cfg: (False, [{"friendly": "other"}]))
    assert cli.main(["check", "--config", c, "--only", "lights"]) == 3
    err = capsys.readouterr().err
    assert "check failed: Zigbee2MQTT is not online" in err and "no Zigbee2MQTT device or group named 'server_room_rgb'" in err
    # An unpaired bulb only warns: the job must install before pairing (pairing goes through it).
    monkeypatch.setattr(lights_module, "probe_broker", lambda cfg: (True, [{"friendly": "other"}]))
    assert cli.main(["check", "--config", c, "--only", "lights"]) == 0
    err = capsys.readouterr().err
    assert "warning: fixture rgb: no Zigbee2MQTT device or group named 'server_room_rgb'" in err and "check failed" not in err
    monkeypatch.setattr(lights_module, "probe_broker", lambda cfg: (True, [{"friendly": "server_room_rgb"}]))
    assert cli.main(["check", "--config", c, "--only", "lights"]) == 0
    assert "no Zigbee2MQTT device" not in capsys.readouterr().err
