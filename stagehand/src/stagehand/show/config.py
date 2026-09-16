"""The `show:` section — show control's own config.

Shape (see show.example.yaml for a commented copy):

    show:
      mqtt:    { host, port?, username?, password?, client_id? }   # optional
      osc:     { targets: { name: { host, port } } }               # optional
      cues:    [ CueRule… ]
      sensors: [ SensorRule… ]

Cross-checks happen here so a bad map fails at boot, not mid-show:
sensor rules need the broker, MQTT cues need the broker, OSC cues need
targets, and an `osc.to:` name must exist.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..module import ConfigError
from .cuemap import CueRule, parse_cue_rule
from .sensormap import SensorRule, parse_sensor_rule


@dataclass(frozen=True)
class MqttConfig:
    host: str
    port: int = 1883
    username: str | None = None
    password: str | None = None
    client_id: str = "stagehand"


@dataclass(frozen=True)
class ShowConfig:
    mqtt: MqttConfig | None
    osc_targets: dict[str, tuple[str, int]] = field(default_factory=dict)
    cues: list[CueRule] = field(default_factory=list)
    sensors: list[SensorRule] = field(default_factory=list)

    @property
    def mqtt_filters(self) -> list[str]:
        seen: dict[str, None] = {}
        for rule in self.sensors:
            seen.setdefault(rule.topic.filter)
        return list(seen)


def _require_str(raw: dict, key: str, where: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or value == "":
        raise ConfigError(f"{where}: missing '{key}'")
    return value


def _opt_str(raw: dict, key: str) -> str | None:
    value = raw.get(key)
    return value if isinstance(value, str) and value != "" else None


def parse_show(doc: Any) -> ShowConfig:
    if not isinstance(doc, dict):
        raise ConfigError("'show:' must be a mapping")

    mqtt: MqttConfig | None = None
    if (raw_mqtt := doc.get("mqtt")) is not None:
        if not isinstance(raw_mqtt, dict):
            raise ConfigError("'mqtt:' must be a mapping")
        mqtt = MqttConfig(
            host=_require_str(raw_mqtt, "host", "mqtt"),
            port=int(raw_mqtt.get("port", 1883)),
            username=_opt_str(raw_mqtt, "username"),
            password=_opt_str(raw_mqtt, "password"),
            client_id=raw_mqtt.get("client_id") or "stagehand",
        )

    osc_targets: dict[str, tuple[str, int]] = {}
    if (raw_osc := doc.get("osc")) is not None:
        if not isinstance(raw_osc, dict) or not isinstance(raw_osc.get("targets"), dict):
            raise ConfigError("'osc:' must be a mapping with 'targets:'")
        for name, spec in raw_osc["targets"].items():
            if not isinstance(spec, dict):
                raise ConfigError(f"osc.targets.{name}: must be a mapping")
            osc_targets[str(name)] = (
                _require_str(spec, "host", f"osc.targets.{name}"),
                int(spec.get("port", 9000)),
            )

    cues = [parse_cue_rule(raw, i) for i, raw in enumerate(doc.get("cues") or [])]
    sensors = [parse_sensor_rule(raw, i) for i, raw in enumerate(doc.get("sensors") or [])]

    # Cross-checks — fail at boot, not mid-show.
    for rule in cues:
        if rule.osc is not None:
            if not osc_targets:
                raise ConfigError(f"show.cues[{rule.id}] has an 'osc:' output but no 'osc.targets' are configured")
            for name in rule.osc.to or ():
                if name not in osc_targets:
                    raise ConfigError(f"show.cues[{rule.id}]: unknown OSC target {name!r}")
        if rule.mqtt is not None and mqtt is None:
            raise ConfigError(f"show.cues[{rule.id}] has an 'mqtt:' output but no 'mqtt:' broker is configured")
    if sensors and mqtt is None:
        raise ConfigError("show.sensors rules need an 'mqtt:' broker")

    return ShowConfig(mqtt=mqtt, osc_targets=osc_targets, cues=cues, sensors=sensors)
