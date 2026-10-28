"""The `audio:` section — the house speaker router on the house Mac.

Shape (`audio.example.yaml` carries a commented copy):

    audio:
      sounds_dir: media/sounds     # <name>.wav|aiff|flac per story `sound <name>`
      play_sounds: false           # true: the router plays `sound X` (the show
                                   # module's OSC sound cues are then skipped)
      announce: false              # true: the router plays `do announce` too
                                   # (the `alexa:` section must be gone)
      passthrough: true            # duplex: the audio.json input→output matrix and
                                   # the input meters / sidechains; false opens an
                                   # output-only stream (no mic access, no sidechain)
      device: null                 # override audio.json's device.name (substring)
      host_api: null               # Windows: asio (the MOTU: one N-channel device;
                                   # sets SD_ENABLE_ASIO) | wasapi | wdm-ks | directsound | mme
      rate: null                   # override the rate (default: audio.json / the device's)
      blocksize: 512
      latency: high                # low | high | seconds
      master_db: 0
      limit_db: -1                 # the per-output limiter's ceiling
      priority:                    # dB at full activity, per bus (sfx, music), per
        announce: {music: -15, sfx: -12}   # source: an input `role` in audio.json, or the
        trabolta: {music: -18, sfx: -8}    # built-in `announce` / `takeover` (takeover →
                                   # music is always silence); a bus a source does not
                                   # name is not ducked by it. Absent: the announce row.
      sidechain: {threshold_db: -45, attack_s: 0.04, hold_s: 0.8, release_s: 1.2}
                                   # how an input with a `role` opens its source
      soundtrack: null             # media/soundtrack.yaml: the music beds per scene
                                   # (audio/soundtrack.py; loaded and checked at boot)
      duck_hold_s: 7               # announce: false — the announce source held for an
                                   # announcement the alexa player speaks
      no_duck: []                  # sounds that never duck (the show's
                                   # dance_song, rave, hand_jive)
      config_file: null            # a local audio.json, used until the server answers
      house_file: null             # a local house.json (LOCATION → rooms) likewise
      cache_dir: ~/Library/Caches/stagehand-audio   # the last good audio.json + house.json
      poll_wait: 25                # the long-poll's wait (s)
      health_s: 60                 # the health line's period
      # announce: true only —
      voice_engine: auto           # auto (sapi on Windows, say elsewhere) | say | sapi
      say_voice: Samantha          # the engine's voice (default: Samantha / Microsoft Zira Desktop)
      chime: synth                 # synth | off | a file
      announce_gain_db: 0
      test_gain_db: -12            # the speaker test's tone + label
      mqtt: { host, port?, … }     # optional: hand-fire + test topics, health/audio
      announce_topic: show/announce
      chime_topic: show/chime
      test_topic: show/audio/test
      stop_topic: show/audio/stop  # {} or {"announce": true}: stop every house sound
      play_topic: show/audio/play  # {"name": "zip", "to"?: ["living"]}: hand-play one
      music_topic: show/audio/music  # {"scene": "act_1"} | {"next": true} | {"stop": true}

Everything has a default, so `audio: {}` is a router that only passes the
matrix through and answers the map editor's Test buttons.

`duck_db` (one depth for everything under an announcement) is gone since
wave 38: a YAML that still sets it is refused, naming its new home,
`priority.announce.sfx`.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .. import localvoice
from ..alexa.config import DEFAULT_CACHE as ALEXA_CACHE
from ..module import ConfigError
from ..paths import user_cache
from ..show.config import MqttConfig
from .mixer import DUCKED, RESERVED_SOURCES, TAKEOVER, Sidechain
from .soundtrack import Soundtrack, load_soundtrack

DEFAULT_CACHE = user_cache("stagehand-audio")  # ~/Library/Caches/… ; %LOCALAPPDATA%\stagehand\… on Windows
#: With no `priority:` an announcement ducks as the show's does (C4's
#: announce row): the router with no YAML still sits under its own voice.
DEFAULT_PRIORITY: dict[str, dict[str, float]] = {"announce": {"music": -15.0, "sfx": -12.0}}
#: A priority source's name: an audio.json input `role`, or a built-in.
SOURCE_NAME = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")


@dataclass(frozen=True)
class AudioConfig:
    sounds_dir: str
    play_sounds: bool = False
    announce: bool = False
    passthrough: bool = True
    device: str | None = None
    #: PortAudio host API the device must be on (engine.HOST_APIS): `asio`
    #: on the Windows house PC; None (the Mac: Core Audio is the only one).
    host_api: str | None = None
    rate: int | None = None
    blocksize: int = 512
    latency: str | float = "high"
    master_db: float = 0.0
    limit_db: float = -1.0
    #: `{source: {bus: dB}}` (wave 38, C4): how deep each priority source
    #: ducks the sfx / music buses at full activity.
    priority: dict[str, dict[str, float]] = field(default_factory=lambda: dict(DEFAULT_PRIORITY))
    sidechain: Sidechain = Sidechain()
    #: The soundtrack (wave 38, C3), parsed at load: a bad file fails the boot.
    soundtrack: Soundtrack | None = None
    duck_hold_s: float = 7.0
    no_duck: tuple[str, ...] = ()
    config_file: str | None = None
    house_file: str | None = None
    cache_dir: str = DEFAULT_CACHE
    poll_wait: float = 25.0
    health_s: float = 60.0
    #: The announcements' + test labels' voice: `say` (macOS) or `sapi`
    #: (Windows, through PowerShell) — `voice_engine: auto` resolved at load.
    voice_engine: str = "say"
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
    #: The soundtrack by hand (wave 38): a scene, the next track, stop.
    music_topic: str = "show/audio/music"
    #: The `alexa` player's lock directory: an announcing router holds the
    #: same lock, so the two never both own the house's voice.
    announce_lock_dir: str = ALEXA_CACHE


def _bool(doc: dict, key: str, default: bool) -> bool:
    value = doc.get(key, default)
    if not isinstance(value, bool):
        raise ConfigError(f"audio.{key}: true or false")
    return value


def _num(doc: dict, key: str, default: float, lo: float, hi: float, prefix: str = "audio.") -> float:
    value = doc.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not lo <= value <= hi:
        raise ConfigError(f"{prefix}{key}: a number from {lo:g} to {hi:g}")
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


def _priority(doc: dict) -> dict[str, dict[str, float]]:
    raw = doc.get("priority")
    if raw is None:
        return {k: dict(v) for k, v in DEFAULT_PRIORITY.items()}
    if not isinstance(raw, dict):
        raise ConfigError("audio.priority: a mapping of source → {sfx: dB, music: dB}")
    out: dict[str, dict[str, float]] = {}
    for name, buses in raw.items():
        where = f"audio.priority.{name}"
        if not isinstance(name, str) or not SOURCE_NAME.match(name):
            raise ConfigError(f"{where}: a source is an input role (a-z, 0-9, _ or -, ≤ 32) or {' / '.join(RESERVED_SOURCES)}")
        if buses is None:
            buses = {}
        if not isinstance(buses, dict):
            raise ConfigError(f"{where}: a mapping of bus → dB ({', '.join(DUCKED)})")
        depths: dict[str, float] = {}
        for bus, db in buses.items():
            if bus not in DUCKED:
                raise ConfigError(f"{where}.{bus}: only {' and '.join(DUCKED)} duck (announce and test never do)")
            if name == TAKEOVER and bus == "music":
                raise ConfigError(f"{where}.music: fixed — a takeover always silences the music on its speakers")
            if isinstance(db, bool) or not isinstance(db, (int, float)) or not -120 <= db <= 0:
                raise ConfigError(f"{where}.{bus}: dB from -120 to 0")
            depths[bus] = float(db)
        out[name] = depths
    return out


def _sidechain(doc: dict) -> Sidechain:
    raw = doc.get("sidechain")
    if raw is None:
        return Sidechain()
    if not isinstance(raw, dict):
        raise ConfigError("audio.sidechain: a mapping (threshold_db, attack_s, hold_s, release_s, roles)")
    known = {"threshold_db", "attack_s", "hold_s", "release_s", "roles"}
    extra = sorted(set(raw) - known)
    if extra:
        raise ConfigError(f"audio.sidechain.{extra[0]}: unknown (threshold_db, attack_s, hold_s, release_s, roles)")
    d = Sidechain()
    threshold = _num(raw, "threshold_db", d.threshold_db, -100, 0, "audio.sidechain.")
    roles_raw = raw.get("roles") or {}
    if not isinstance(roles_raw, dict):
        raise ConfigError("audio.sidechain.roles: a mapping of role → {threshold_db}")
    roles: list[tuple[str, float]] = []
    for role, spec in roles_raw.items():
        where = f"audio.sidechain.roles.{role}"
        if not isinstance(role, str) or not role or role in RESERVED_SOURCES:
            raise ConfigError(f"{where}: an audio.json input role (not {' or '.join(RESERVED_SOURCES)})")
        if not isinstance(spec, dict):
            raise ConfigError(f"{where}: a mapping ({{threshold_db: N}})")
        bad = sorted(set(spec) - {"threshold_db"})
        if bad:
            raise ConfigError(f"{where}.{bad[0]}: unknown (threshold_db)")
        roles.append((role, _num(spec, "threshold_db", threshold, -100, 0, f"{where}.")))
    return Sidechain(
        threshold_db=threshold,
        attack_s=_num(raw, "attack_s", d.attack_s, 0.001, 10, "audio.sidechain."),
        hold_s=_num(raw, "hold_s", d.hold_s, 0, 30, "audio.sidechain."),
        release_s=_num(raw, "release_s", d.release_s, 0.001, 30, "audio.sidechain."),
        roles=tuple(roles),
    )


def _soundtrack(doc: dict, base_dir: str) -> Soundtrack | None:
    path = _path(doc, "soundtrack", base_dir, must_exist=True)
    return load_soundtrack(path) if path is not None else None


def parse_audio_section(doc: Any, base_dir: str = ".") -> AudioConfig:
    if doc is None:
        doc = {}
    if not isinstance(doc, dict):
        raise ConfigError("'audio:' must be a mapping")
    if "duck_db" in doc:
        raise ConfigError("audio.duck_db: removed (wave 38) — the announcement's depth is priority.announce.sfx (and priority.announce.music)")

    latency: str | float = doc.get("latency", "high")
    if latency not in ("low", "high"):
        if isinstance(latency, bool) or not isinstance(latency, (int, float)) or not 0 < latency <= 1:
            raise ConfigError("audio.latency: low | high | seconds (0–1)")
        latency = float(latency)

    host_api = _str(doc, "host_api", None)
    if host_api is not None:
        from .engine import HOST_APIS

        host_api = host_api.lower()
        if host_api not in HOST_APIS:
            raise ConfigError(f"audio.host_api: {' | '.join(HOST_APIS)} (got {doc.get('host_api')!r})")

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

    try:
        voice_engine = localvoice.resolve(doc.get("voice_engine", "auto"))
    except ValueError:
        raise ConfigError(f"audio.voice_engine: {' | '.join(localvoice.ENGINES)}") from None

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
        host_api=host_api,
        rate=rate,
        blocksize=blocksize,
        latency=latency,
        master_db=_num(doc, "master_db", 0.0, -60, 12),
        limit_db=_num(doc, "limit_db", -1.0, -30, 0),
        priority=_priority(doc),
        sidechain=_sidechain(doc),
        soundtrack=_soundtrack(doc, base_dir),
        duck_hold_s=_num(doc, "duck_hold_s", 7.0, 0, 60),
        no_duck=_names(doc, "no_duck"),
        config_file=_path(doc, "config_file", base_dir, must_exist=True),
        house_file=_path(doc, "house_file", base_dir, must_exist=True),
        cache_dir=os.path.expanduser(_str(doc, "cache_dir", DEFAULT_CACHE) or DEFAULT_CACHE),
        poll_wait=_num(doc, "poll_wait", 25.0, 0, 120),
        health_s=_num(doc, "health_s", 60.0, 5, 3600),
        voice_engine=voice_engine,
        say_voice=_str(doc, "say_voice", localvoice.default_voice(voice_engine)),
        chime=chime,
        announce_gain_db=_num(doc, "announce_gain_db", 0.0, -60, 12),
        test_gain_db=_num(doc, "test_gain_db", -12.0, -60, 0),
        mqtt=mqtt,
        announce_topic=_str(doc, "announce_topic", "show/announce") or "show/announce",
        chime_topic=_str(doc, "chime_topic", "show/chime") or "show/chime",
        test_topic=_str(doc, "test_topic", "show/audio/test") or "show/audio/test",
        stop_topic=_str(doc, "stop_topic", "show/audio/stop") or "show/audio/stop",
        play_topic=_str(doc, "play_topic", "show/audio/play") or "show/audio/play",
        music_topic=_str(doc, "music_topic", "show/audio/music") or "show/audio/music",
        announce_lock_dir=os.path.expanduser(_str(doc, "announce_lock_dir", ALEXA_CACHE) or ALEXA_CACHE),
    )


def plays_sounds(section: Any) -> bool:
    """Does this raw `audio:` section take `sound X` from an OSC cue player? (read by the
    config loader for the `show` module, which may run in another job)."""
    return isinstance(section, dict) and section.get("play_sounds") is True


def owns_announcements(section: Any) -> bool:
    return isinstance(section, dict) and section.get("announce") is True
