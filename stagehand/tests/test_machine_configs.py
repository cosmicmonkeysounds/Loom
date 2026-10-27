"""The two machine files that build on trapped.house.yaml: John's Desktop
(Windows: show + lights + the router, its default home) and the MacBook
(the router fallback, on the Desktop's broker). They load, inherit every show rule, and keep
their secrets out of git."""

from __future__ import annotations

from pathlib import Path

import pytest

from stagehand import localvoice
from stagehand.config import load_config

ROOT = Path(__file__).resolve().parents[1]
HOUSE = ROOT / "trapped.house.yaml"
DESKTOP = ROOT / "trapped.desktop.yaml"
MACBOOK = ROOT / "trapped.macbook.yaml"


@pytest.fixture
def env():
    # No .local.yaml is read in CI (they're git-ignored); the env fills server:.
    return {"LOOM_EVENT_ID": "ev", "LOOM_MOD_PASSCODE": "pw"}


def test_the_desktop_runs_show_and_lights_from_the_house_rules(env):
    house = load_config(HOUSE, only=["show"], env=env).modules["show"]
    cfg = load_config(DESKTOP, only=["show", "lights"], env=env)
    show, lights = cfg.modules["show"], cfg.modules["lights"]
    assert show.cfg.mqtt.host == "127.0.0.1" and show.cfg.mqtt.port == 1883  # Mosquitto on this PC
    assert len(show.cfg.cues) == len(house.cfg.cues)  # every rule inherited, none copied
    assert lights.cfg.mqtt.host == "127.0.0.1" and lights.cfg.config_file.endswith("lights.json")
    assert show.ask_lights is True  # the heart_* looks go to the lights job


def test_the_desktop_keeps_audio_so_show_hands_the_sounds_over(env, monkeypatch):
    monkeypatch.setenv("SD_ENABLE_ASIO", "1")  # never set it for the other tests
    monkeypatch.setattr(localvoice.sys, "platform", "win32")
    cfg = load_config(DESKTOP, only=["audio"], env=env)
    audio = cfg.modules["audio"].cfg
    assert audio.host_api == "asio" and audio.voice_engine == "sapi"
    assert audio.say_voice == "Microsoft Zira Desktop"
    assert audio.mqtt.host == "127.0.0.1" and audio.play_sounds and audio.announce


def test_the_macbook_router_dials_the_desktops_password_listener(env, monkeypatch):
    monkeypatch.setattr(localvoice.sys, "platform", "darwin")
    cfg = load_config(MACBOOK, env=env)
    assert set(cfg.modules) == {"audio"}  # show: null — the Desktop's job
    audio = cfg.modules["audio"].cfg
    assert (audio.mqtt.host, audio.mqtt.port, audio.mqtt.username) == ("192.168.8.10", 1884, "props")
    assert audio.mqtt.password is None  # only ever in trapped.macbook.local.yaml
    assert (audio.voice_engine, audio.say_voice, audio.host_api) == ("say", "Samantha", None)  # the Mac as before


def test_no_secret_in_the_machine_files():
    for p in (DESKTOP, MACBOOK):
        live = [line.split("#", 1)[0] for line in p.read_text(encoding="utf-8").splitlines()]
        for key in ("password:", "mod_passcode:", "mod_token:", "event:"):
            assert not any(key in line for line in live), f"{p.name}: {key} belongs in the .local.yaml"
