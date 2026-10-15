"""The `alexa:` section — the house Mac's announcement player.

Shape (trapped.house.yaml carries the real one):

    alexa:
      mqtt:     { host, port?, username?, password?, client_id? }   # required
      topic:    show/announce          # what the `show` cue publishes
      chime_topic: show/chime          # `sound alexa_chime` — the chime alone
      device:   "Alexa Zones"          # CoreAudio output (name or substring);
                                       # omit = the system default output
      channels: [1, 2, 3, 4]           # optional: the device's output channels
                                       # (1-based) — the file repeats across them
      voice:    af_sky                 # the server's (Kokoro) voice
      speed:    1.0                    # optional, 0.5–2.0
      say_voice: Samantha              # macOS `say` fallback voice
      chime:    synth                  # synth | off | a file (relative to the YAML)
      gain_db:  0
      tts_timeout: 4.0                 # seconds before falling back to `say`
      cache_dir: ~/Library/Caches/stagehand-alexa
      prewarm:  [ "Go to the living room.", … ]   # fetched + cached at boot

Everything but `mqtt` has a default, so a minimal section is just a broker.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..module import ConfigError
from ..show.config import MqttConfig

DEFAULT_CACHE = "~/Library/Caches/stagehand-alexa"


@dataclass(frozen=True)
class AlexaConfig:
    mqtt: MqttConfig
    topic: str = "show/announce"
    chime_topic: str | None = "show/chime"
    device: str | None = None
    channels: tuple[int, ...] | None = None
    voice: str | None = "af_sky"
    speed: float | None = None
    say_voice: str | None = "Samantha"
    #: "synth", "off", or an absolute path to a sound file.
    chime: str = "synth"
    gain_db: float = 0.0
    tts_timeout: float = 4.0
    cache_dir: str = DEFAULT_CACHE
    prewarm: tuple[str, ...] = field(default_factory=tuple)


def _opt_str(raw: dict, key: str, default: str | None = None) -> str | None:
    value = raw.get(key, default)
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ConfigError(f"alexa.{key}: must be a string")
    return value


def parse_alexa(doc: Any, base_dir: str = ".") -> AlexaConfig:
    if not isinstance(doc, dict):
        raise ConfigError("'alexa:' must be a mapping")
    raw_mqtt = doc.get("mqtt")
    if not isinstance(raw_mqtt, dict) or not isinstance(raw_mqtt.get("host"), str) or not raw_mqtt["host"]:
        raise ConfigError("alexa: needs 'mqtt: { host }' — announcements arrive on the broker")
    mqtt = MqttConfig(
        host=raw_mqtt["host"],
        port=int(raw_mqtt.get("port", 1883)),
        username=raw_mqtt.get("username") or None,
        password=raw_mqtt.get("password") or None,
        client_id=raw_mqtt.get("client_id") or "stagehand-alexa",
    )

    channels: tuple[int, ...] | None = None
    if (raw_ch := doc.get("channels")) is not None:
        if not isinstance(raw_ch, list) or not raw_ch or not all(isinstance(c, int) and c >= 1 for c in raw_ch):
            raise ConfigError("alexa.channels: a non-empty list of 1-based output channel numbers")
        if len(set(raw_ch)) != len(raw_ch):
            raise ConfigError("alexa.channels: a channel is listed twice")
        channels = tuple(raw_ch)

    chime = doc.get("chime", "synth")
    if chime is False or chime is None:
        chime = "off"
    if not isinstance(chime, str) or chime == "":
        raise ConfigError("alexa.chime: synth | off | a sound file")
    if chime not in ("synth", "off"):
        path = Path(os.path.expanduser(chime))
        if not path.is_absolute():
            path = Path(base_dir) / path
        if not path.is_file():
            raise ConfigError(f"alexa.chime: no such file {str(path)!r}")
        chime = str(path.resolve())

    speed = doc.get("speed")
    if speed is not None:
        if not isinstance(speed, (int, float)) or not 0.5 <= float(speed) <= 2.0:
            raise ConfigError("alexa.speed: a number from 0.5 to 2.0")
        speed = float(speed)

    prewarm = doc.get("prewarm") or []
    if not isinstance(prewarm, list) or not all(isinstance(t, str) and t.strip() for t in prewarm):
        raise ConfigError("alexa.prewarm: a list of announcement lines")

    timeout = doc.get("tts_timeout", 4.0)
    if not isinstance(timeout, (int, float)) or timeout <= 0:
        raise ConfigError("alexa.tts_timeout: seconds, > 0")

    return AlexaConfig(
        mqtt=mqtt,
        topic=_opt_str(doc, "topic", "show/announce") or "show/announce",
        chime_topic=_opt_str(doc, "chime_topic", "show/chime"),
        device=_opt_str(doc, "device"),
        channels=channels,
        voice=_opt_str(doc, "voice", "af_sky"),
        speed=speed,
        say_voice=_opt_str(doc, "say_voice", "Samantha"),
        chime=chime,
        gain_db=float(doc.get("gain_db", 0.0)),
        tts_timeout=float(timeout),
        cache_dir=os.path.expanduser(_opt_str(doc, "cache_dir", DEFAULT_CACHE) or DEFAULT_CACHE),
        prewarm=tuple(" ".join(t.split()) for t in prewarm),
    )
