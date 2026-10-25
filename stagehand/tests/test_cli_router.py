"""The router by hand (wave 18b, Q1 / Q7): `stagehand announce` through the
router once `alexa:` is gone, and `stagehand sounds stop | play |
placeholders` — over MQTT, never the server, so they work with the uplink down."""

from __future__ import annotations

import json

import pytest

from stagehand import cli

SERVER = "server: {url: 'http://h', mod_passcode: x}\n"


def conf(tmp_path, audio: str, extra: str = "") -> str:
    p = tmp_path / "house.yaml"
    p.write_text(SERVER + f"audio: {{sounds_dir: '{tmp_path / 'sounds'}', {audio}}}\n" + extra)
    return str(p)


@pytest.fixture
def sent(monkeypatch):
    out: list[tuple] = []
    monkeypatch.setattr(cli, "PUBLISH", lambda topic, payload, **kw: out.append((topic, json.loads(payload), kw)))
    monkeypatch.setattr(cli, "READ_RETAINED", lambda topic, **kw: "online" if topic == "health/audio" else None)
    return out


BROKER = "announce: true, mqtt: {host: 127.0.0.1, port: 1883, client_id: stagehand-audio}"


def test_announce_goes_to_the_router_once_alexa_is_gone(tmp_path, sent, capsys):
    assert cli.main(["announce", "--config", conf(tmp_path, BROKER), "Five", " minutes."]) == 0
    topic, doc, kw = sent[0]
    assert topic == "show/announce" and doc == {"text": "Five minutes.", "chime": True}
    assert kw["hostname"] == "127.0.0.1" and kw["port"] == 1883 and kw["client_id"] == "stagehand-audio-cli"
    assert "sent to the router" in capsys.readouterr().out
    assert cli.main(["announce", "--config", conf(tmp_path, BROKER), "--no-chime", "Hi."]) == 0
    assert sent[1][1] == {"text": "Hi.", "chime": False}


def test_announce_needs_an_announcing_router_with_a_broker(tmp_path, sent, capsys):
    assert cli.main(["announce", "--config", conf(tmp_path, "announce: false, mqtt: {host: 127.0.0.1}"), "Hi."]) == 2
    assert "announce: false" in capsys.readouterr().err
    assert cli.main(["announce", "--config", conf(tmp_path, "announce: true"), "Hi."]) == 2
    assert "no mqtt: broker" in capsys.readouterr().err and sent == []


def test_a_refused_broker_exits_2(tmp_path, monkeypatch, capsys):
    def refuse(*a, **k):
        raise ConnectionRefusedError(61, "Connection refused")

    monkeypatch.setattr(cli, "PUBLISH", refuse)
    assert cli.main(["sounds", "stop", "--config", conf(tmp_path, BROKER)]) == 2
    assert "no broker at 127.0.0.1:1883" in capsys.readouterr().err


def test_sounds_stop_and_play_publish_to_the_router(tmp_path, sent):
    path = conf(tmp_path, BROKER)
    assert cli.main(["sounds", "stop", "--config", path]) == 0
    assert cli.main(["sounds", "stop", "--announce", "--config", path]) == 0
    assert cli.main(["sounds", "play", "zip", "--to", "living", "--to", "hall", "--config", path]) == 0
    assert cli.main(["sounds", "play", "zip", "--config", path]) == 0
    # The name after --to, and a comma list.
    assert cli.main(["sounds", "play", "--to", "living", "zip", "--config", path]) == 0
    assert cli.main(["sounds", "play", "zip", "--to", "living,hall", "--config", path]) == 0
    assert cli.main(["sounds", "play", "zip", "--gain", "-6", "--config", path]) == 0
    assert cli.main(["sounds", "play", "zip", "--gain", "40", "--config", path]) == 0
    assert [(t, d) for t, d, _ in sent] == [
        ("show/audio/stop", {"by": "cli"}),
        ("show/audio/stop", {"announce": True, "by": "cli"}),
        ("show/audio/play", {"name": "zip", "to": ["living", "hall"]}),
        ("show/audio/play", {"name": "zip"}),
        ("show/audio/play", {"name": "zip", "to": ["living"]}),
        ("show/audio/play", {"name": "zip", "to": ["living", "hall"]}),
        ("show/audio/play", {"name": "zip", "gain": -6.0}),
        ("show/audio/play", {"name": "zip", "gain": 12.0}),
    ]
    assert cli.main(["sounds", "play", "--config", path]) == 2


def test_sounds_placeholders_writes_into_the_routers_sounds_dir(tmp_path, capsys):
    path = conf(tmp_path, "play_sounds: true")
    assert cli.main(["sounds", "placeholders", "--no-say", "--only", "zip,rave", "--config", path]) == 0
    assert sorted(p.name for p in (tmp_path / "sounds").iterdir()) == ["rave.wav", "zip.wav"]
    assert "2 placeholder(s) written" in capsys.readouterr().out
    assert cli.main(["sounds", "placeholders", "--no-say", "--only", "zip", "--config", path]) == 0
    assert "skip  zip" in capsys.readouterr().out
    out = tmp_path / "elsewhere"
    assert cli.main(["sounds", "placeholders", "--no-say", "--out", str(out), "--config", path]) == 0
    assert len(list(out.iterdir())) == 19
    assert cli.main(["sounds", "placeholders", "--only", "kazoo", "--config", path]) == 2


def test_an_alexa_section_still_announces_through_alexa(tmp_path):
    assert cli._announcer(conf(tmp_path, BROKER)) == "audio"
    p = tmp_path / "old.yaml"
    p.write_text(SERVER + "alexa: {mqtt: {host: 127.0.0.1}}\n")
    assert cli._announcer(str(p)) == "alexa"


@pytest.mark.parametrize("state", ["offline", "lost", None])
def test_a_hand_command_with_no_router_listening_says_it_played_nothing(tmp_path, sent, monkeypatch, capsys, state):
    monkeypatch.setattr(cli, "READ_RETAINED", lambda topic, **kw: state)
    path = conf(tmp_path, BROKER)
    assert cli.main(["sounds", "stop", "--config", path]) == 1
    assert cli.main(["announce", "--config", path, "Hi."]) == 1
    err = capsys.readouterr().err
    assert "no router is listening" in err and f"health/audio: {state or 'nothing retained'}" in err
    assert [t for t, _, _ in sent] == ["show/audio/stop", "show/announce"]  # still sent


def test_the_retained_look_gives_up_quietly_with_no_broker():
    import socket

    with socket.socket() as s:  # a free port nobody listens on
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    assert cli._read_retained("health/audio", hostname="127.0.0.1", port=port, client_id="t", auth=None, timeout=0.3) is None
