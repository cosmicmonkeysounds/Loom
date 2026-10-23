"""A look → timed, safety-clamped commands: the mirror of `@loom/house`
`clampForSafety` + `planLook`, pinned by `house/test/fixtures/lights-plan.json`.

Per step, over its targets (the step's `to`, else the look's): **clamp
first** (a safety fixture is never OFF and never under `max(40, min)`), then
drop what the fixture's caps can't do (`color` without `caps.color`,
`color_temp` without `caps.ct`, `brightness` without `caps.dim`), and drop a
command left doing nothing. Sorted by `at`, then the fixtures' file order.
`period` = the look's, else the last step's `at` + 150 (a `then: "restore"`
look: + 1000); `repeat` 0 = a loop.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .routing import LightsDoc, resolve_targets

LIGHT_STEP_MIN_MS = 150
LIGHT_COLOR_STEP_MIN_MS = 400
LIGHT_RESTORE_MS = 1000
#: A safety fixture's hard floor (Z2M brightness 0–254): a `min` only raises it.
LIGHT_SAFETY_MIN = 40
STATE_KEYS = ("state", "brightness", "color", "color_temp", "effect", "transition")


@dataclass(frozen=True)
class Command:
    at: float
    fixture: str
    set: dict


@dataclass(frozen=True)
class Plan:
    commands: tuple[Command, ...]
    loop: bool
    period: float
    repeat: int
    restore: bool


def ordered(s: dict) -> dict:
    """A state's keys in the one canonical order (the fixtures compare it)."""
    return {k: s[k] for k in STATE_KEYS if k in s and s[k] is not None}


def safety_min(f: dict) -> int:
    m = f.get("min")
    valid = isinstance(m, int) and not isinstance(m, bool) and 1 <= m <= 254
    return max(LIGHT_SAFETY_MIN, m if valid else LIGHT_SAFETY_MIN)


def clamp_for_safety(f: dict, s: dict) -> dict:
    """`clampForSafety`: OFF → ON at the floor; a brightness under it → the floor."""
    out = dict(s)
    if f.get("safety") is not True:
        return out
    floor = safety_min(f)
    if out.get("state") == "OFF":
        out["state"] = "ON"
        out["brightness"] = floor
    b = out.get("brightness")
    if isinstance(b, (int, float)) and not isinstance(b, bool) and b < floor:
        out["brightness"] = floor
    return ordered(out)


def for_caps(f: dict, s: dict) -> dict:
    caps = f.get("caps") if isinstance(f.get("caps"), dict) else {}
    out = dict(s)
    if not caps.get("color"):
        out.pop("color", None)
    if not caps.get("ct"):
        out.pop("color_temp", None)
    if not caps.get("dim"):
        out.pop("brightness", None)
    return out


def state_does(s: dict) -> bool:
    """Does a state do something (not just a transition)?"""
    return any(s.get(k) is not None for k in ("state", "brightness", "color", "color_temp", "effect"))


def steps_of(look: dict) -> list[dict]:
    steps = look.get("steps")
    if isinstance(steps, list):
        return [s for s in steps if isinstance(s, dict)]
    if look.get("set") is not None:
        return [{"at": 0, "set": look["set"]}]
    return []


def plan_look(doc: LightsDoc, house: Any, name: str) -> Plan | None:
    """`planLook`, or None for an unknown look."""
    look = doc.look(name)
    if look is None:
        return None
    order = {f["id"]: i for i, f in enumerate(doc.fixtures)}
    raw: list[tuple[float, int, Command]] = []
    last = 0.0
    for step in steps_of(look):
        at = step.get("at", 0)
        last = max(last, at)
        to = step["to"] if isinstance(step.get("to"), list) else look.get("to") or []
        for fid in resolve_targets(doc, house, to):
            f = doc.fixture(fid)
            if f is None:
                continue
            s = for_caps(f, clamp_for_safety(f, step.get("set") or {}))
            if not state_does(s):
                continue
            raw.append((at, order[fid], Command(at=at, fixture=fid, set=ordered(s))))
    raw.sort(key=lambda r: (r[0], r[1]))
    restore = look.get("then") == "restore"
    loop = look.get("loop") is True
    period = look.get("period")
    if period is None:
        period = last + (LIGHT_RESTORE_MS if restore else LIGHT_STEP_MIN_MS)
    repeat = 0 if loop else int(look.get("repeat") or 1)
    return Plan(commands=tuple(c for _, _, c in raw), loop=loop, period=period, repeat=repeat, restore=restore)
