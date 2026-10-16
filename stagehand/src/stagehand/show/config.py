"""The `show:` section — show control's own config.

Shape (see show.example.yaml for a commented copy):

    show:
      mqtt:    { host, port?, username?, password?, client_id? }   # optional
      osc:     { targets: { name: { host, port } } }               # optional
      cues:    [ CueRule… ]
      sensors: [ SensorRule… ]
      catch_up: [ { path, cue, skip?, when? }… ]                 # optional

`catch_up:` is what the router replays on a (re)connect and after a
story restart (module.py `_catch_up`): each entry reads one world path
from `GET /api/state` and, unless the value is empty / in `skip:` / its
`when:` is false over the world, runs `cue <cue with {value}>` through
the cue map like a story `cue` line. Lights only, in order.

Cross-checks happen here so a bad map fails at boot, not mid-show:
sensor rules need the broker, MQTT cues need the broker, OSC cues need
targets, and an `osc.to:` name must exist.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..conditions import Condition, ConditionError
from ..module import ConfigError
from ..templating import coerce_scalar
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
class CatchUpRule:
    path: str                       # a world path, e.g. Night.lights
    cue: str                        # `cue` args with {value}, e.g. lights_{value}
    skip: tuple[str, ...] = ()      # values never replayed (e.g. alarm: its siren latch)
    when: Condition | None = None   # over the world entries (dotted paths, flat keys)

    def covers(self, args: Any) -> bool:
        """Could a live `cue` with these args be one this rule replays?
        (`lights_{value}` covers `lights_game`.)"""
        return str(args).strip().startswith(self.cue.split("{value}")[0].strip())

    def args_for(self, world: dict[str, Any]) -> str | None:
        """The `cue` args to replay for this world, or None to replay nothing."""
        value = world.get(self.path)
        if value is None or str(value).strip() in ("", "null") or str(value) in self.skip:
            return None
        # World values are display strings: coerce so `Night.x > 0` compares numbers.
        if self.when is not None and not self.when.evaluate({k: coerce_scalar(v) for k, v in world.items()}):
            return None
        return self.cue.replace("{value}", str(value))


@dataclass(frozen=True)
class ShowConfig:
    mqtt: MqttConfig | None
    osc_targets: dict[str, tuple[str, int]] = field(default_factory=dict)
    cues: list[CueRule] = field(default_factory=list)
    sensors: list[SensorRule] = field(default_factory=list)
    catch_up: list[CatchUpRule] = field(default_factory=list)

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


def parse_catch_up(raw: Any, idx: int) -> CatchUpRule:
    where = f"show.catch_up[{idx}]"
    if not isinstance(raw, dict):
        raise ConfigError(f"{where}: must be a mapping")
    cue = _require_str(raw, "cue", where)
    if "{value}" not in cue:
        raise ConfigError(f"{where}: 'cue' needs a {{value}} placeholder")
    skip = raw.get("skip") or []
    if not isinstance(skip, list):
        raise ConfigError(f"{where}: 'skip' must be a list")
    when: Condition | None = None
    if (src := raw.get("when")) is not None:
        try:
            when = Condition(str(src))
        except ConditionError as err:
            raise ConfigError(f"{where}: {err}") from err
    return CatchUpRule(path=_require_str(raw, "path", where), cue=cue, skip=tuple(str(v) for v in skip), when=when)


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
    raw_catch_up = doc.get("catch_up") or []
    if not isinstance(raw_catch_up, list):
        raise ConfigError("'catch_up:' must be a list")
    catch_up = [parse_catch_up(raw, i) for i, raw in enumerate(raw_catch_up)]

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

    return ShowConfig(mqtt=mqtt, osc_targets=osc_targets, cues=cues, sensors=sensors, catch_up=catch_up)
