"""`lights.json` as the `lights` module reads it, and which fixtures a target reaches.

The event server owns the file (`@loom/house` `validateLights`, the map
editor's 💡 Lights tab); this side only reads it. `parse_lights` checks the
shape the module can't live without (version 1, the three collections) and
keeps every fixture, zone and look as the plain JSON dict it is, so the
planner reads the same fields `@loom/house` does.

`resolve_targets` mirrors `@loom/house` `resolveLightTargets` exactly and is
pinned to it by the shared fixture `house/test/fixtures/lights-resolve.json`
(stagehand keeps a byte-identical copy in `tests/fixtures/house-lights/`). A
target `everywhere` reaches every fixture; any other reaches the union of:

    a fixture id            that fixture
    a zone id or name       the zone's fixtures (member ids exact)
    a room id               the fixtures whose `room` it is
    a room label            (with a house) that room's fixtures
    a LOCATION              (with a house) every room whose `location` it is

Names fold like `foldTarget` (case, `_` / `-` and runs of spaces don't
matter). Fixtures come back in the file's order, each once.

Wave 39: `presence_settings` / `presence_fixtures` mirror `presenceSettings`
/ `presenceFixtures` (which fixtures a program in the reinstallation games
may pulse: `presence.to`, never a safety fixture, none when it is off) and
`merge_light_state` mirrors `mergeLightState` (a bulb's memory of commands,
the `shown` report). The shared fixture `lights-presence.json` pins all three.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any

from ..audio.routing import fold

EVERYWHERE = "everywhere"
LIGHTS_FILE = "lights.json"
#: A look name (and so a story `cue X`), never a screens cue family.
LOOK_RE = re.compile(r"^[a-z][a-z0-9_]*$")
RESERVED_PREFIXES = ("screens_", "terminals_", "tv_", "tablet_", "room_", "music_")
#: (wave 39) `LIGHT_PRESENCE_*` in `@loom/house` `lights.ts`.
PRESENCE_EFFECTS = ("breathe", "blink", "okay")
PRESENCE_RADIUS_M = 1.6
PRESENCE_RADIUS_MIN = 0.5
PRESENCE_RADIUS_MAX = 5
PRESENCE_REPEAT_MS = 12_000
#: Effects that end whatever effect a bulb runs (`mergeLightState` forgets the effect).
END_EFFECTS = ("stop_effect", "finish_effect")


class LightsDocError(ValueError):
    pass


def is_look_name(name: str) -> bool:
    return bool(LOOK_RE.match(name)) and not name.startswith(RESERVED_PREFIXES)


@dataclass(frozen=True)
class LightsDoc:
    fixtures: tuple[dict, ...] = ()
    zones: tuple[dict, ...] = ()
    looks: dict[str, dict] = field(default_factory=dict)
    boot: str | None = None
    #: (wave 39) The raw `presence` block (None: absent).
    presence: Any = None

    def fixture(self, fid: str) -> dict | None:
        return next((f for f in self.fixtures if f.get("id") == fid), None)

    def look(self, name: str) -> dict | None:
        return self.looks.get(name)

    def as_json(self) -> dict:
        out: dict[str, Any] = {"version": 1, "fixtures": list(self.fixtures), "zones": list(self.zones), "looks": dict(self.looks)}
        if self.boot is not None:
            out["boot"] = self.boot
        if self.presence is not None:
            out["presence"] = self.presence
        return out


def parse_lights(raw: Any) -> LightsDoc:
    """A `lights.json` (parsed JSON) → `LightsDoc`. Raises `LightsDocError` on
    a shape the module can't play (the server refuses those already)."""
    if not isinstance(raw, dict):
        raise LightsDocError("lights.json must be an object")
    if raw.get("version") != 1:
        raise LightsDocError("lights.json: version must be 1")
    fixtures = raw.get("fixtures")
    zones = raw.get("zones")
    looks = raw.get("looks")
    if not isinstance(fixtures, list) or not isinstance(zones, list):
        raise LightsDocError("lights.json: fixtures and zones must be lists")
    if not isinstance(looks, dict):
        raise LightsDocError("lights.json: looks must be an object")
    fx: list[dict] = []
    for i, f in enumerate(fixtures):
        if not isinstance(f, dict) or not isinstance(f.get("id"), str) or not isinstance(f.get("device"), str) or f.get("kind") not in ("zigbee", "zigbee-group", "wled"):
            raise LightsDocError(f"lights.json: fixtures[{i}] needs an id, a kind and a device")
        fx.append(f)
    boot = raw.get("boot")
    return LightsDoc(
        fixtures=tuple(fx),
        zones=tuple(z for z in zones if isinstance(z, dict)),
        looks={k: v for k, v in looks.items() if isinstance(v, dict)},
        boot=boot if isinstance(boot, str) and boot in looks else None,
        presence=raw.get("presence"),
    )


def _rooms(house: Any) -> list[dict]:
    if not isinstance(house, dict):
        return []
    rooms = house.get("rooms")
    return [r for r in rooms if isinstance(r, dict)] if isinstance(rooms, list) else []


def resolve_targets(doc: LightsDoc, house: Any, to: Any) -> list[str]:
    """`resolveLightTargets`: the fixture ids a target list reaches, file order."""
    hit: set[str] = set()
    rooms = _rooms(house)
    for raw in to if isinstance(to, (list, tuple)) else []:
        if not isinstance(raw, str):
            continue
        t = fold(raw)
        if t == "":
            continue
        if t == EVERYWHERE:
            hit.update(f["id"] for f in doc.fixtures)
            continue
        room_ids: set[str] = set()
        for f in doc.fixtures:
            if fold(f["id"]) == t:
                hit.add(f["id"])
            if isinstance(f.get("room"), str) and fold(f["room"]) == t:
                room_ids.add(f["room"])
        for z in doc.zones:
            if fold(str(z.get("id", ""))) == t or fold(str(z.get("name", ""))) == t:
                members = z.get("fixtures")
                hit.update(m for m in (members if isinstance(members, list) else []) if isinstance(m, str))
        for r in rooms:
            loc = r.get("location")
            if fold(str(r.get("id", ""))) == t or fold(str(r.get("label", ""))) == t or (isinstance(loc, str) and fold(loc) == t):
                room_ids.add(r.get("id"))
        for f in doc.fixtures:
            if f.get("room") in room_ids:
                hit.add(f["id"])
    out: list[str] = []
    for f in doc.fixtures:
        if f["id"] in hit and f["id"] not in out:
            out.append(f["id"])
    return out


@dataclass(frozen=True)
class PresenceSettings:
    """`LightPresenceSettings`: `presence` with every default filled in."""

    enabled: bool = True
    to: tuple[str, ...] = (EVERYWHERE,)
    radius: float = PRESENCE_RADIUS_M
    effect: str = "breathe"

    def as_json(self) -> dict:
        return {"enabled": self.enabled, "to": list(self.to), "radius": self.radius, "effect": self.effect}


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def presence_settings(doc: LightsDoc) -> PresenceSettings:
    """`presenceSettings`: a missing or malformed field takes its default."""
    p = doc.presence if isinstance(doc.presence, dict) else {}
    r = p.get("radius")
    radius = r if _is_num(r) and PRESENCE_RADIUS_MIN <= r <= PRESENCE_RADIUS_MAX else PRESENCE_RADIUS_M
    e = p.get("effect")
    effect = e if isinstance(e, str) and e in PRESENCE_EFFECTS else "breathe"
    to = p.get("to")
    targets = tuple(to) if isinstance(to, list) and all(isinstance(t, str) for t in to) else (EVERYWHERE,)
    return PresenceSettings(enabled=p.get("enabled") is not False, to=targets, radius=radius, effect=effect)


def presence_fixtures(doc: LightsDoc, house: Any) -> list[dict]:
    """`presenceFixtures`: the fixtures a program may pulse, file order —
    `presence.to`, never a safety fixture; [] when presence is off."""
    s = presence_settings(doc)
    if not s.enabled:
        return []
    hit = set(resolve_targets(doc, house, list(s.to)))
    return [f for f in doc.fixtures if f["id"] in hit and f.get("safety") is not True]


def merge_light_state(was: dict, set_: dict) -> dict:
    """`mergeLightState`: one command merged into a fixture's state the way a
    bulb keeps it (`color` and `color_temp` replace each other, an end effect
    forgets the effect, `transition` is dropped)."""
    out = dict(was)
    if set_.get("state") is not None:
        out["state"] = set_["state"]
    if set_.get("brightness") is not None:
        out["brightness"] = set_["brightness"]
    if set_.get("color") is not None:
        out["color"] = set_["color"]
        out.pop("color_temp", None)
    if set_.get("color_temp") is not None:
        out["color_temp"] = set_["color_temp"]
        out.pop("color", None)
    if set_.get("effect") is not None:
        if set_["effect"] in END_EFFECTS:
            out.pop("effect", None)
        else:
            out["effect"] = set_["effect"]
    return out
