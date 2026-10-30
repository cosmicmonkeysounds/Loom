"""The `lights:` section — the house lights module on the house Mac.

Shape (`lights.example.yaml` carries a commented copy):

    lights:
      mqtt: { host: 127.0.0.1, port: 1883 }   # the anonymous loopback listener (Z2M's broker)
      z2m_base: zigbee2mqtt                    # Zigbee2MQTT's base topic
      config_file: null                        # a local lights.json, used until the server answers
      house_file: null                         # a local house.json (LOCATION → rooms) likewise
      cache_dir: ~/Library/Caches/stagehand-lights   # the last good lights.json + house.json
      poll_wait: 25                            # the long-poll's wait (s)
      health_s: 15                             # health/lights/stats period (s)
      take_looks: true                         # the show module drops its YAML `cue` rules
                                               # whose name lights.json defines
      pace: true                               # one Zigbee command per bulb in flight (pacer.py)
      z2m_task: null                           # Windows: the Task Scheduler task to restart when Z2M stalls
      z2m_check_s: 15                          # ask Z2M's health_check this often (s)
      z2m_stall_s: 60                          # silent this long = stalled (s)

Everything has a default, so `lights: {}` is a module on this Mac's broker
that plays whatever lights.json the event serves.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..module import ConfigError
from ..paths import user_cache
from ..show.config import MqttConfig

DEFAULT_CACHE = user_cache("stagehand-lights")  # ~/Library/Caches/… ; %LOCALAPPDATA%\stagehand\… on Windows
DEFAULT_MQTT = MqttConfig(host="127.0.0.1", port=1883, client_id="stagehand-lights")


@dataclass(frozen=True)
class LightsSectionConfig:
    mqtt: MqttConfig = DEFAULT_MQTT
    z2m_base: str = "zigbee2mqtt"
    config_file: str | None = None
    house_file: str | None = None
    cache_dir: str = DEFAULT_CACHE
    poll_wait: float = 25.0
    health_s: float = 15.0
    take_looks: bool = True
    pace: bool = True
    z2m_task: str | None = None
    z2m_check_s: float = 15.0
    z2m_stall_s: float = 60.0


_KEYS = {"mqtt", "z2m_base", "config_file", "house_file", "cache_dir", "poll_wait", "health_s", "take_looks", "pace", "z2m_task", "z2m_check_s", "z2m_stall_s"}


def _path(raw: Any, base_dir: str, key: str) -> str | None:
    if raw is None:
        return None
    if not isinstance(raw, str) or raw == "":
        raise ConfigError(f"lights.{key} must be a path")
    p = Path(os.path.expanduser(raw))
    return str(p if p.is_absolute() else (Path(base_dir) / p).resolve())


def _num(raw: Any, key: str, default: float, lo: float, hi: float) -> float:
    if raw is None:
        return default
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not lo <= raw <= hi:
        raise ConfigError(f"lights.{key} must be a number from {lo:g} to {hi:g}")
    return float(raw)


def parse_lights_section(raw: Any, base_dir: str = ".") -> LightsSectionConfig:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ConfigError("'lights:' must be a mapping")
    unknown = sorted(set(raw) - _KEYS)
    if unknown:
        raise ConfigError(f"lights: unknown key(s) {', '.join(unknown)}")
    mqtt = DEFAULT_MQTT
    if (m := raw.get("mqtt")) is not None:
        if not isinstance(m, dict) or not isinstance(m.get("host"), str) or m["host"] == "":
            raise ConfigError("lights.mqtt needs a 'host'")
        mqtt = MqttConfig(
            host=m["host"],
            port=int(m.get("port", 1883)),
            username=m.get("username") or None,
            password=m.get("password") or None,
            client_id=m.get("client_id") or "stagehand-lights",
        )
    base = raw.get("z2m_base", "zigbee2mqtt")
    if not isinstance(base, str) or base.strip("/") == "":
        raise ConfigError("lights.z2m_base must be a topic (zigbee2mqtt)")
    take = raw.get("take_looks", True)
    if not isinstance(take, bool):
        raise ConfigError("lights.take_looks must be true or false")
    pace = raw.get("pace", True)
    if not isinstance(pace, bool):
        raise ConfigError("lights.pace must be true or false")
    task = raw.get("z2m_task")
    if task is not None and (not isinstance(task, str) or task == ""):
        raise ConfigError("lights.z2m_task must be a task name (Loom\\zigbee2mqtt)")
    cache = raw.get("cache_dir", DEFAULT_CACHE)
    if not isinstance(cache, str) or cache == "":
        raise ConfigError("lights.cache_dir must be a path")
    return LightsSectionConfig(
        mqtt=mqtt,
        z2m_base=base.strip("/"),
        config_file=_path(raw.get("config_file"), base_dir, "config_file"),
        house_file=_path(raw.get("house_file"), base_dir, "house_file"),
        cache_dir=os.path.expanduser(cache),
        poll_wait=_num(raw.get("poll_wait"), "poll_wait", 25.0, 0, 30),
        health_s=_num(raw.get("health_s"), "health_s", 15.0, 1, 3600),
        take_looks=take,
        pace=pace,
        z2m_task=task,
        z2m_check_s=_num(raw.get("z2m_check_s"), "z2m_check_s", 15.0, 1, 3600),
        z2m_stall_s=_num(raw.get("z2m_stall_s"), "z2m_stall_s", 60.0, 5, 3600),
    )
