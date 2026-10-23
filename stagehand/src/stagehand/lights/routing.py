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
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from ..audio.routing import fold

EVERYWHERE = "everywhere"
LIGHTS_FILE = "lights.json"
#: A look name (and so a story `cue X`), never a screens cue family.
LOOK_RE = re.compile(r"^[a-z][a-z0-9_]*$")
RESERVED_PREFIXES = ("screens_", "terminals_", "tv_", "tablet_", "room_")


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

    def fixture(self, fid: str) -> dict | None:
        return next((f for f in self.fixtures if f.get("id") == fid), None)

    def look(self, name: str) -> dict | None:
        return self.looks.get(name)

    def as_json(self) -> dict:
        out: dict[str, Any] = {"version": 1, "fixtures": list(self.fixtures), "zones": list(self.zones), "looks": dict(self.looks)}
        if self.boot is not None:
            out["boot"] = self.boot
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
