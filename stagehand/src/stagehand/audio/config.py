"""The `audio:` section — the house speaker router on the house Mac.

Shape (`audio.example.yaml` carries a commented copy):

    audio:
      sounds_dir: media/sounds     # <name>.wav|aiff|flac per story `sound <name>`
      play_sounds: false           # true: the router plays `sound X` (the show
                                   # module's QLab sound cues are then skipped)
      announce: false              # true: the router plays `do announce` too
                                   # (the `alexa:` section must be gone)
      passthrough: true            # the audio.json input→output matrix; false
                                   # opens an output-only stream (no mic access)
      device: null                 # override audio.json's device.name (substring)
      rate: null                   # override the rate (default: audio.json / the device's)
      blocksize: 512
      latency: high                # low | high | seconds
      master_db: 0
      limit_db: -1                 # the per-output limiter's ceiling
      duck_db: -12                 # sfx under an announcement
      duck_hold_s: 7               # announce: false — the duck held for an
                                   # announcement the alexa player speaks
      no_duck: []                  # sounds that never duck (the show's
                                   # dance_song, rave, hand_jive)
      config_file: null            # a local audio.json, used until the server answers
      house_file: null             # a local house.json (LOCATION → rooms) likewise
      cache_dir: ~/Library/Caches/stagehand-audio   # the last good audio.json + house.json
      poll_wait: 25                # the long-poll's wait (s)
      health_s: 60                 # the health line's period
      # announce: true only —
      say_voice: Samantha
      chime: synth                 # synth | off | a file
      announce_gain_db: 0
      test_gain_db: -12            # the speaker test's tone + label
      mqtt: { host, port?, … }     # optional: hand-fire + test topics, health/audio
      announce_topic: show/announce
      chime_topic: show/chime
      test_topic: show/audio/test
      stop_topic: show/audio/stop  # {} or {"announce": true}: stop every house sound
      play_topic: show/audio/play  # {"name": "zip", "to"?: ["living"]}: hand-play one

Everything has a default, so `audio: {}` is a router that only passes the
matrix through and answers the map editor's Test buttons.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..alexa.config import DEFAULT_CACHE as ALEXA_CACHE
from ..module import ConfigError
from ..show.config import MqttConfig

DEFAULT_CACHE = "~/Library/Caches/stagehand-audio"


@dataclass(frozen=True)
class AudioConfig:
    sounds_dir: str
    play_sounds: bool = False
    announce: bool = False
    passthrough: bool = True
    device: str | None = None
    rate: int | None = None
    blocksize: int = 512
    latency: str | float = "high"
    master_db: float = 0.0
    limit_db: float = -1.0
    duck_db: float = -12.0
    duck_hold_s: float = 7.0
    no_duck: tuple[str, ...] = ()
    config_file: str | None = None
    house_file: str | None = None
    cache_dir: str = DEFAULT_CACHE
    poll_wait: float = 25.0
    health_s: float = 60.0
    say_voice: str | None = "Samantha"
    chime: str = "synth"
    announce_gain_db: float = 0.0
    test_gain_db: float = -12.0
    mqtt: MqttConfig | None = None
    announce_topic: str = "show/announce"
    chime_topic: str = "show/chime"
    test_topic: str = "show/audio/test"
    #: wave 18b (Q7): the LAN's own "stop all house sounds" (the uplink down)
    #: and a hand-fired `sound X` (the router replaces QLab's hand-fire).
    stop_topic: str = "show/audio/stop"
    play_topic: str = "show/audio/play"
    #: The `alexa` player's lock directory: an announcing router holds the
    #: same lock, so the two never both own the house's voice.
    announce_lock_dir: str = ALEXA_CACHE


def _bool(doc: dict, key: str, default: bool) -> bool:
    value = doc.get(key, default)
    if not isinstance(value, bool):
        raise ConfigError(f"audio.{key}: true or false")
    return value


def _num(doc: dict, key: str, default: float, lo: float, hi: float) -> float:
    value = doc.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not lo <= value <= hi:
        raise ConfigError(f"audio.{key}: a number from {lo:g} to {hi:g}")
    return float(value)


def _path(doc: dict, key: str, base_dir: str, *, must_exist: bool = False) -> str | None:
    value = doc.get(key)
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ConfigError(f"audio.{key}: a path")
    p = Path(os.path.expanduser(value))
    if not p.is_absolute():
        p = Path(base_dir) / p
    if must_exist and not p.exists():
        raise ConfigError(f"audio.{key}: no such file {str(p)!r}")
    return str(p.resolve())


def _str(doc: dict, key: str, default: str | None) -> str | None:
    value = doc.get(key, default)
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ConfigError(f"audio.{key}: must be a string")
    return value


def _names(doc: dict, key: str) -> tuple[str, ...]:
    value = doc.get(key) or []
    if not isinstance(value, list) or not all(isinstance(v, str) and v for v in value):
        raise ConfigError(f"audio.{key}: a list of sound names")
    return tuple(value)


def parse_audio_section(doc: Any, base_dir: str = ".") -> AudioConfig:
    if doc is None:
        doc = {}
    if not isinstance(doc, dict):
        raise ConfigError("'audio:' must be a mapping")

    latency: str | float = doc.get("latency", "high")
    if latency not in ("low", "high"):
        if isinstance(latency, bool) or not isinstance(latency, (int, float)) or not 0 < latency <= 1:
            raise ConfigError("audio.latency: low | high | seconds (0–1)")
        latency = float(latency)

    rate = doc.get("rate")
    if rate is not None:
        rate = int(_num(doc, "rate", 0, 8000, 384000))
    blocksize = int(_num(doc, "blocksize", 512, 32, 8192))

    chime = doc.get("chime", "synth")
    if chime is False or chime is None:
        chime = "off"
    if not isinstance(chime, str) or chime == "":
        raise ConfigError("audio.chime: synth | off | a sound file")
    if chime not in ("synth", "off"):
        chime = _path({"chime": chime}, "chime", base_dir, must_exist=True) or "off"

    mqtt: MqttConfig | None = None
    if (raw := doc.get("mqtt")) is not None:
        if not isinstance(raw, dict) or not isinstance(raw.get("host"), str) or not raw["host"]:
            raise ConfigError("audio.mqtt: needs a 'host'")
        mqtt = MqttConfig(
            host=raw["host"],
            port=int(raw.get("port", 1883)),
            username=raw.get("username") or None,
            password=raw.get("password") or None,
            client_id=raw.get("client_id") or "stagehand-audio",
        )

    return AudioConfig(
        sounds_dir=_path(doc, "sounds_dir", base_dir) or str((Path(base_dir) / "media" / "sounds").resolve()),
        play_sounds=_bool(doc, "play_sounds", False),
        announce=_bool(doc, "announce", False),
        passthrough=_bool(doc, "passthrough", True),
        device=_str(doc, "device", None),
        rate=rate,
        blocksize=blocksize,
        latency=latency,
        master_db=_num(doc, "master_db", 0.0, -60, 12),
        limit_db=_num(doc, "limit_db", -1.0, -30, 0),
        duck_db=_num(doc, "duck_db", -12.0, -60, 0),
        duck_hold_s=_num(doc, "duck_hold_s", 7.0, 0, 60),
        no_duck=_names(doc, "no_duck"),
        config_file=_path(doc, "config_file", base_dir, must_exist=True),
        house_file=_path(doc, "house_file", base_dir, must_exist=True),
        cache_dir=os.path.expanduser(_str(doc, "cache_dir", DEFAULT_CACHE) or DEFAULT_CACHE),
        poll_wait=_num(doc, "poll_wait", 25.0, 0, 120),
        health_s=_num(doc, "health_s", 60.0, 5, 3600),
        say_voice=_str(doc, "say_voice", "Samantha"),
        chime=chime,
        announce_gain_db=_num(doc, "announce_gain_db", 0.0, -60, 12),
        test_gain_db=_num(doc, "test_gain_db", -12.0, -60, 0),
        mqtt=mqtt,
        announce_topic=_str(doc, "announce_topic", "show/announce") or "show/announce",
        chime_topic=_str(doc, "chime_topic", "show/chime") or "show/chime",
        test_topic=_str(doc, "test_topic", "show/audio/test") or "show/audio/test",
        stop_topic=_str(doc, "stop_topic", "show/audio/stop") or "show/audio/stop",
        play_topic=_str(doc, "play_topic", "show/audio/play") or "show/audio/play",
        announce_lock_dir=os.path.expanduser(_str(doc, "announce_lock_dir", ALEXA_CACHE) or ALEXA_CACHE),
    )


def plays_sounds(section: Any) -> bool:
    """Does this raw `audio:` section take `sound X` from QLab? (read by the
    config loader for the `show` module, which may run in another job)."""
    return isinstance(section, dict) and section.get("play_sounds") is True


def owns_announcements(section: Any) -> bool:
    return isinstance(section, dict) and section.get("announce") is True
