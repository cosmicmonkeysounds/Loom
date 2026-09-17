"""Everything the live session knows, as the worker can read it.

The server's `GET /api/agent/facts` is one document: every program (id,
name, group, location, variables, what they hold), every character, every
location with its occupants, the whole codex with its holders, the global
world (`Night.phase`), and the character's powers. This module wraps it
for two readers:

  - the **fast path**, which resolves a reply's `lookup` names (a program,
    a room, a piece of lore) into a short card the model answers from, and
    canonicalises act arguments (`room: "the kitchen"` → `The Cache`);
  - the **orchestrator**, which reads a digest + the delta since its last
    look ("Excel moved to The Registry", "3 programs now hold The Sandy
    File", "phase: hunt → free_roam") to evolve the character's brief.

Names fold the way the story folds them (case, spaces, `_`, `-`), so
"the cache", "The Cache (kitchen)" and "TheCache" all find the kitchen.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

_FOLD = re.compile(r"[^a-z0-9]+")


def fold(name: str) -> str:
    return _FOLD.sub("", str(name).lower())


@dataclass
class Hit:
    kind: str  # program | character | location | lore
    id: str
    data: dict[str, Any]


@dataclass
class Facts:
    raw: dict[str, Any]
    at: float = field(default_factory=time.time)

    # -- accessors ----------------------------------------------------------

    @property
    def world(self) -> dict[str, str]:
        w = self.raw.get("world")
        return w if isinstance(w, dict) else {}

    @property
    def programs(self) -> list[dict[str, Any]]:
        return [p for p in self.raw.get("programs", []) if isinstance(p, dict)]

    @property
    def characters(self) -> list[dict[str, Any]]:
        return [c for c in self.raw.get("characters", []) if isinstance(c, dict)]

    @property
    def locations(self) -> list[dict[str, Any]]:
        return [loc for loc in self.raw.get("locations", []) if isinstance(loc, dict)]

    @property
    def codex(self) -> list[dict[str, Any]]:
        return [e for e in self.raw.get("codex", []) if isinstance(e, dict)]

    @property
    def phase(self) -> str | None:
        for key, value in self.world.items():
            if key.endswith(".phase"):
                return str(value)
        return None

    # -- lookup -------------------------------------------------------------

    def find(self, name: str) -> Hit | None:
        """Resolve a name (id, display name, label, or title) to one thing.
        Programs win over characters, characters over rooms, rooms over lore
        — a guest asking about "Excel" means the person, not the entry."""
        key = fold(name)
        if key == "":
            return None
        for p in self.programs:
            if key in (fold(p.get("id", "")), fold(p.get("name", ""))):
                return Hit("program", str(p.get("id")), p)
        for c in self.characters:
            if key == fold(c.get("id", "")):
                return Hit("character", str(c.get("id")), c)
        for loc in self.locations:
            label = fold(loc.get("label", "") or "")
            if key in (fold(loc.get("id", "")), label) or (label.startswith(key) and len(key) >= 4):
                return Hit("location", str(loc.get("id")), loc)
        for e in self.codex:
            if key in (fold(e.get("title", "")), fold(e.get("id", ""))):
                return Hit("lore", str(e.get("id")), e)
        # A loose second pass: a program whose name *contains* the words.
        for p in self.programs:
            if len(key) >= 4 and key in fold(p.get("name", "")):
                return Hit("program", str(p.get("id")), p)
        for e in self.codex:
            if len(key) >= 5 and key in fold(e.get("title", "")):
                return Hit("lore", str(e.get("id")), e)
        return None

    def program_id(self, name: str) -> str | None:
        hit = self.find(name)
        return hit.id if hit is not None and hit.kind == "program" else None

    def location_id(self, name: str) -> str | None:
        key = fold(name)
        for loc in self.locations:
            label = fold(loc.get("label", "") or "")
            if key in (fold(loc.get("id", "")), label) or (len(key) >= 4 and (label.startswith(key) or key in label)):
                return str(loc.get("id"))
        return None

    def canonical_args(self, args: dict[str, Any]) -> dict[str, Any]:
        """Map a model's loose argument values onto story ids: `room` /
        `location` → a LOCATION id, `target` / `who` / `program` → a program
        id. Unknown values pass through — the story decides what to do."""
        out: dict[str, Any] = {}
        for k, v in args.items():
            if isinstance(v, str):
                if k in ("room", "location", "where"):
                    out[k] = self.location_id(v) or v
                    continue
                if k in ("target", "who", "program", "guest"):
                    out[k] = self.program_id(v) or v
                    continue
            out[k] = v
        return out

    def render(self, name: str) -> str:
        """A short card for a lookup, or a plain 'no record'."""
        hit = self.find(name)
        if hit is None:
            return f"{name}: no record in this system."
        d = hit.data
        if hit.kind == "program":
            bits = [f"{d.get('name')} (program id {hit.id})"]
            if d.get("location"):
                bits.append(f"currently in {d['location']}")
            if d.get("faction"):
                bits.append(f"group {d['faction']}")
            groups = [g for g in d.get("groups", []) if g != d.get("faction")]
            if groups:
                bits.append("also in " + ", ".join(groups))
            if d.get("captured"):
                bits.append("CAPTURED — inside the Internet")
            vars_ = d.get("vars") or {}
            nums = ", ".join(f"{k}={v}" for k, v in sorted(vars_.items()) if "." not in k and k not in ("name",))
            if nums:
                bits.append(nums)
            held = d.get("codex") or []
            bits.append("holds: " + ("; ".join(held) if held else "nothing"))
            return " · ".join(bits)
        if hit.kind == "character":
            bits = [f"{hit.id} (character)"]
            if d.get("faction"):
                bits.append(f"group {d['faction']}")
            bits.append("present" if d.get("online") else "not at their post")
            held = d.get("codex") or []
            if held:
                bits.append("knows: " + "; ".join(held))
            return " · ".join(bits)
        if hit.kind == "location":
            occ = d.get("occupants") or []
            who = ", ".join(occ) if occ else "nobody"
            return f"{d.get('label') or hit.id}: {who} there now ({len(occ)})."
        held = d.get("holders") or []
        text = " ".join(str(d.get("text", "")).split())
        holders = ", ".join(held) if held else "nobody yet"
        return f"{d.get('title')} (lore, about {d.get('about') or 'the world'}): {text} — held by {holders}."

    # -- for the orchestrator -------------------------------------------------

    def digest(self, max_programs: int = 40) -> str:
        lines = []
        phase = self.phase
        world = ", ".join(f"{k}={v}" for k, v in sorted(self.world.items()))
        lines.append(f"World: {world or '—'}")
        rooms = []
        for loc in self.locations:
            occ = loc.get("occupants") or []
            rooms.append(f"{loc.get('label') or loc.get('id')}: {len(occ)}" + (f" ({', '.join(occ[:6])}{'…' if len(occ) > 6 else ''})" if occ else ""))
        if rooms:
            lines.append("Rooms: " + " | ".join(rooms))
        progs = []
        for p in self.programs[:max_programs]:
            tag = f"{p.get('name')}"
            extras = []
            if p.get("faction"):
                extras.append(str(p["faction"]))
            if p.get("captured"):
                extras.append("captured")
            held = p.get("codex") or []
            if held:
                extras.append(f"holds {len(held)}")
            if extras:
                tag += f" [{', '.join(extras)}]"
            progs.append(tag)
        lines.append(f"Programs ({len(self.programs)}): " + (", ".join(progs) if progs else "none yet"))
        hot = sorted(self.codex, key=lambda e: -len(e.get("holders") or []))[:8]
        spread = [f"{e.get('title')}→{len(e.get('holders') or [])}" for e in hot if e.get("holders")]
        if spread:
            lines.append("Lore spread: " + ", ".join(spread))
        if phase:
            lines.append(f"Phase: {phase}")
        return "\n".join(lines)

    def delta(self, prev: "Facts | None") -> list[str]:
        """Human lines for what changed since `prev` (empty if nothing / no prev)."""
        if prev is None:
            return []
        out: list[str] = []
        if prev.phase != self.phase:
            out.append(f"phase: {prev.phase or '—'} → {self.phase or '—'}")
        before = {str(p.get("id")): p for p in prev.programs}
        for p in self.programs:
            pid = str(p.get("id"))
            old = before.get(pid)
            name = p.get("name")
            if old is None:
                out.append(f"{name} arrived")
                continue
            if old.get("location") != p.get("location") and p.get("location"):
                out.append(f"{name} moved to {p['location']}")
            if not old.get("captured") and p.get("captured"):
                out.append(f"{name} was captured (sent to the Internet)")
            if old.get("captured") and not p.get("captured"):
                out.append(f"{name} was released")
            if old.get("faction") != p.get("faction") and p.get("faction"):
                out.append(f"{name} joined {p['faction']}")
            new_lore = [t for t in (p.get("codex") or []) if t not in (old.get("codex") or [])]
            if new_lore:
                out.append(f"{name} learned {', '.join(new_lore[:3])}")
        for pid, old in before.items():
            if pid not in {str(p.get("id")) for p in self.programs}:
                out.append(f"{old.get('name')} left")
        for key, value in self.world.items():
            if key.endswith(".phase"):
                continue
            if prev.world.get(key) != value:
                out.append(f"{key} = {value}")
        return out[:24]


class FactsClient:
    """Fetch + cache the facts document (a few seconds — a party moves slowly)."""

    def __init__(self, mod: Any, ttl_s: float = 5.0) -> None:
        self.mod = mod
        self.ttl_s = ttl_s
        self.current: Facts | None = None

    async def get(self, force: bool = False) -> Facts | None:
        if not force and self.current is not None and time.time() - self.current.at < self.ttl_s:
            return self.current
        try:
            doc = await self.mod.get("/api/agent/facts")
        except Exception:  # noqa: BLE001 — a missing facts document must never block a reply
            return self.current
        if not isinstance(doc, dict) or not doc:
            return self.current
        self.current = Facts(doc)
        return self.current

    def forget(self) -> None:
        self.current = None
