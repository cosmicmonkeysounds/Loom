"""The house mixer's levels as the router plays them (wave 40, C3).

The event server keeps one live balance of the house sound (`AudioMix
{seq, levels}`, moved from Run → House → 🎚 Mixer or a host's Desk window)
and hands it to the router on every `GET /api/mod/audio` answer. This module
turns those levels into the gains the mixer multiplies by; it is a mirror of
`core/src/house-mixer.ts` (`parseMixKey`, `mixLevelsOf`, `mixKeysFor`,
`effectiveDb`, `inputSourceId`), pinned by `tests/fixtures/house-mixer.json`
(copied byte for byte from `core/test/fixtures/`).

A level is `(db, mute)` under a key:

    master                     everything the mixer moves, everywhere
    src:<source>               one source everywhere
    room:<room>                everything in one room
    room:<room>/src:<source>   one source in one room
    spk:<speaker>              one speaker (the sub)

What a source plays on a speaker is the sum of the five that apply (absent =
0 dB); any mute, or any level at the floor (−60 dB), silences it. The
**sources**: the router's four strips (`music`, `tracks`, `sfx`,
`announce`; speaker tests are never mixed) and each input as `in:<role>`
(else `in:<ch>`).

`mix_gains` lays that out per output for the mixer: an output wired to
several speakers takes the loudest of them, an output no speaker uses reads
`master + src:<s>` only. The mix rides on top of audio.json (the speakers'
`gain` stays the install trim, `set_trim`) and never edits it.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any

from .routing import AudioDoc, Input

MIX_DB_MIN = -60.0
MIX_DB_MAX = 10.0
MIX_DB_STEP = 0.5
MIX_LEVELS_MAX = 256
#: The router's strips that the mix moves, in the mixer's order.
MIX_BUS_SOURCES = ("music", "tracks", "sfx", "announce")
MIX_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")

#: (db, mute)
Level = tuple[float, bool]
UNITY: Level = (0.0, False)


def _source_ok(s: str) -> bool:
    if s in MIX_BUS_SOURCES:
        return True
    return s.startswith("in:") and bool(MIX_ID_RE.match(s[3:]))


def parse_mix_key(key: Any) -> tuple[str, str | None, str | None] | None:
    """A key → (scope kind `all` | `room` | `speaker`, the room or speaker
    id, the source or None), or None for a key the grammar does not know
    (`parseMixKey`)."""
    if not isinstance(key, str):
        return None
    if key == "master":
        return ("all", None, None)
    if key.startswith("src:"):
        s = key[4:]
        return ("all", None, s) if _source_ok(s) else None
    if key.startswith("spk:"):
        sid = key[4:]
        return ("speaker", sid, None) if MIX_ID_RE.match(sid) else None
    if key.startswith("room:"):
        rest = key[5:]
        room, slash, tail = rest.partition("/")
        if not MIX_ID_RE.match(room):
            return None
        if not slash:
            return ("room", room, None)
        if not tail.startswith("src:") or not _source_ok(tail[4:]):
            return None
        return ("room", room, tail[4:])
    return None


def clamp_mix_db(db: Any) -> float:
    """A level's dB on the fader's grid (`clampMixDb`)."""
    if isinstance(db, bool) or not isinstance(db, (int, float)) or not math.isfinite(db):
        return 0.0
    c = min(MIX_DB_MAX, max(MIX_DB_MIN, float(db)))
    # JS Math.round rounds .5 up; Python's round() is to even.
    return math.floor(c / MIX_DB_STEP + 0.5) * MIX_DB_STEP


def mix_levels_of(raw: Any) -> dict[str, Level]:
    """A mix's `levels` as far as they are sound (`mixLevelsOf`): an unknown
    key or a level that is not an object is dropped, a level at unity is
    not kept."""
    out: dict[str, Level] = {}
    if not isinstance(raw, dict):
        return out
    for key, v in raw.items():
        if len(out) >= MIX_LEVELS_MAX:
            break
        if parse_mix_key(key) is None or not isinstance(v, dict):
            continue
        db = clamp_mix_db(v.get("db")) if isinstance(v.get("db"), (int, float)) else 0.0
        level = (db, v.get("mute") is True)
        if level != UNITY:
            out[key] = level
    return out


def level_of(levels: dict[str, Any], key: str) -> Level:
    """A level as the mix holds it (absent = unity). Takes the parsed
    `(db, mute)` pairs or the wire's `{db, mute}` objects alike."""
    raw = levels.get(key)
    if raw is None:
        return UNITY
    if isinstance(raw, dict):
        db = raw.get("db")
        return (float(db) if isinstance(db, (int, float)) and not isinstance(db, bool) else 0.0, raw.get("mute") is True)
    return (float(raw[0]), bool(raw[1]))


def mix_keys_for(source: str, room: str | None = None, speaker: str | None = None) -> list[str]:
    """The keys that apply to a source on a speaker, outermost first."""
    keys = ["master", f"src:{source}"]
    if room:
        keys += [f"room:{room}", f"room:{room}/src:{source}"]
    if speaker:
        keys.append(f"spk:{speaker}")
    return keys


def effective_db(levels: dict[str, Any], source: str, room: str | None = None, speaker: str | None = None) -> float | None:
    """The mix's gain (dB) for a source on a speaker, or None when silenced
    (any mute, any level at the floor). Unclamped: the router's limiter
    catches the top."""
    db = 0.0
    for key in mix_keys_for(source, room, speaker):
        l_db, mute = level_of(levels, key)
        if mute or l_db <= MIX_DB_MIN:
            return None
        db += l_db
    return db


def input_source_id(inp: Input) -> str:
    """An input's source id: `in:<role>`, else `in:<ch>`."""
    return f"in:{inp.role}" if inp.role else f"in:{inp.ch}"


def _lin(db: float | None) -> float:
    return 0.0 if db is None else float(10 ** (db / 20))


@dataclass(frozen=True)
class MixGains:
    """The mix laid out for the mixer (`Mixer.set_mix`): each strip's linear
    gain per 0-based output; each input channel's (1-based) linear gain per
    0-based output (it multiplies the matrix's `routes`); the input roles a
    mute at `master` or `src:in:<role>` silences everywhere (their sidechain
    ducks nothing)."""

    strips: dict[str, tuple[float, ...]] = field(default_factory=dict)
    inputs: dict[int, tuple[float, ...]] = field(default_factory=dict)
    silent: frozenset[str] = frozenset()

    def unity(self) -> bool:
        return all(g == 1.0 for row in (*self.strips.values(), *self.inputs.values()) for g in row) and not self.silent


def _per_output(levels: dict[str, Any], source: str, doc: AudioDoc, n_out: int) -> tuple[float, ...]:
    """One source's linear gain per 0-based output: the loudest of the
    speakers wired to it; `master + src` only where no speaker is."""
    best: list[float | None] = [None] * n_out
    wired = [False] * n_out
    for s in doc.speakers:
        g = _lin(effective_db(levels, source, s.room or None, s.id))
        for ch in s.out:
            o = ch - 1
            if 0 <= o < n_out:
                wired[o] = True
                cur = best[o]
                best[o] = g if cur is None else max(cur, g)
    bare = _lin(effective_db(levels, source))
    return tuple(best[o] if wired[o] and best[o] is not None else bare for o in range(n_out))


def mix_gains(levels: dict[str, Any], doc: AudioDoc, n_out: int | None = None) -> MixGains:
    """`levels` (the wire's `{db, mute}` objects or parsed pairs) on
    `doc`'s speakers → the mixer's gain table (see `MixGains`). `n_out`
    defaults to the doc's outputs (pass the open stream's)."""
    n = doc.outputs if n_out is None else int(n_out)
    strips = {s: _per_output(levels, s, doc, n) for s in MIX_BUS_SOURCES}
    inputs: dict[int, tuple[float, ...]] = {}
    silent: set[str] = set()
    for inp in doc.input_list:
        sid = input_source_id(inp)
        inputs[inp.ch] = _per_output(levels, sid, doc, n)
        if inp.role and effective_db(levels, sid) is None:
            silent.add(inp.role)
    return MixGains(strips=strips, inputs=inputs, silent=frozenset(silent))
