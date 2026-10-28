"""`audio.json` as the router reads it, and where a sound goes.

The event server owns the file (`@loom/house` `validateAudio`, the map
editor's Audio panel); this side only reads it. `parse_audio` is lenient on
everything routing can live without (labels, positions, notes) and strict on
what it can't (channel numbers, speaker outputs), so a doc the server
accepted always loads here.

`resolve_targets` mirrors `@loom/house` `resolveTargets` exactly and is
pinned to it by the shared fixture `house/test/fixtures/audio-resolve.json`
(stagehand keeps a byte-identical copy a test diffs against it). A target
`everywhere` reaches every speaker; any other target reaches the union of
everything it names:

    a speaker id            that speaker
    a zone id or name       the zone's speakers (member ids exact)
    a room id               the speakers whose `room` it is
    a room label            (with a house) that room's speakers
    a LOCATION              (with a house) every room whose `location` it is

Names fold like `foldTarget`: case, `_` / `-` and runs of spaces don't
matter (`The_Desktop` = `the desktop`, `start-bar` = `Start Bar`).
Speakers come back in the doc's order, outputs ascending, each once.
`unknown` (router only) lists the targets that name nothing at all.

Wave 38 (C1.1): an input may carry a `role` (the priority source it drives:
`trabolta`, `clippy`, …) and a `reach` (targets, read like a cue's `to`,
that source ducks; by default the outputs the input's `routes` feed, else
everywhere). `sidechain_sources` turns them into the mixer's sources. A
role that is malformed or reserved (`announce`, `takeover`: the mixer's
own) is ignored here with a warning (`AudioDoc.warnings`), never a refusal:
routing works without it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

EVERYWHERE = "everywhere"
#: The interface limits `validateAudio` enforces.
MAX_CHANNELS = 64
#: An input's `role` (C1.1). `announce` / `takeover` are the mixer's own sources.
ROLE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
RESERVED_ROLES = ("announce", "takeover")


class AudioDocError(ValueError):
    pass


def fold(name: str) -> str:
    """`@loom/house` `foldTarget`: `The_Desktop` / `THE-DESKTOP` → `the desktop`."""
    s = re.sub(r"[_-]+", " ", str(name).strip().lower())
    return re.sub(r"\s+", " ", s).strip()


@dataclass(frozen=True)
class Speaker:
    id: str
    name: str
    room: str
    out: tuple[int, ...]
    gain_db: float = 0.0


@dataclass(frozen=True)
class Input:
    ch: int
    label: str = ""
    kind: str = ""
    #: The priority source this input drives (None: it ducks nothing).
    role: str | None = None
    #: Targets the source ducks, as a cue's `to` (None: the default, C1.1).
    reach: tuple[str, ...] | None = None


@dataclass(frozen=True)
class Zone:
    id: str
    name: str
    speakers: tuple[str, ...]


@dataclass(frozen=True)
class Route:
    inp: int
    out: tuple[int, ...]
    gain_db: float = 0.0


@dataclass(frozen=True)
class Cue:
    to: tuple[str, ...]
    gain_db: float = 0.0
    #: `duck: false` on the cue (router-only, optional): never ducked.
    duck: bool = True


@dataclass(frozen=True)
class AudioDoc:
    device: str
    inputs: int
    outputs: int
    rate: int | None = None
    input_labels: dict[int, str] = field(default_factory=dict)
    #: The inputs as listed (wave 38: their `role` / `reach`).
    input_list: tuple[Input, ...] = ()
    output_labels: dict[int, str] = field(default_factory=dict)
    speakers: tuple[Speaker, ...] = ()
    zones: tuple[Zone, ...] = ()
    routes: tuple[Route, ...] = ()
    cues: dict[str, Cue] = field(default_factory=dict)
    announce_to: tuple[str, ...] = (EVERYWHERE,)
    announce_chime: bool = True
    #: `device.expect` (wave 18b): the (inputs, outputs) the device itself
    #: reports when its layout is as planned (the 828x + an ADAT expander:
    #: 32 / 30). Anything else means the layout moved (mirroring, 96 kHz,
    #: TOSLink) and every channel number after the move is wrong. None:
    #: nothing to compare. (`announce.terminals` is the tablets' list, never
    #: the router's: it is not read here.)
    expect: tuple[int, int] | None = None
    #: What was read but ignored (a malformed or reserved input role): for
    #: the router's log and `stagehand check`, never a refusal.
    warnings: tuple[str, ...] = ()

    def speaker(self, sid: str) -> Speaker | None:
        return next((s for s in self.speakers if s.id == sid), None)

    def cue(self, name: str) -> Cue | None:
        hit = self.cues.get(name)
        if hit is not None:
            return hit
        key = fold(name)
        return next((c for n, c in self.cues.items() if fold(n) == key), None)

    def output_label(self, ch: int) -> str:
        return self.output_labels.get(ch) or f"output {ch}"


def _num(raw: Any, where: str, lo: float, hi: float) -> float:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not lo <= raw <= hi:
        raise AudioDocError(f"{where}: a number from {lo:g} to {hi:g}")
    return float(raw)


def _ch(raw: Any, where: str, limit: int) -> int:
    if isinstance(raw, bool) or not isinstance(raw, int) or not 1 <= raw <= limit:
        raise AudioDocError(f"{where}: a channel from 1 to {limit}")
    return raw


def _list(doc: dict, key: str) -> list:
    value = doc.get(key) or []
    if not isinstance(value, list):
        raise AudioDocError(f"audio.{key}: must be a list")
    return value


def _names(raw: Any, where: str) -> tuple[str, ...]:
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list) or not all(isinstance(t, str) for t in raw):
        raise AudioDocError(f"{where}: a list of names")
    return tuple(t for t in raw if t.strip())


def parse_audio(doc: Any) -> AudioDoc:
    """The `audio` object of `GET /api/mod/audio` (or a local `audio.json`)."""
    if not isinstance(doc, dict):
        raise AudioDocError("audio: must be an object")
    if doc.get("version") != 1:
        raise AudioDocError(f"audio.version: 1 (got {doc.get('version')!r})")
    dev = doc.get("device")
    if not isinstance(dev, dict) or not isinstance(dev.get("name"), str):
        raise AudioDocError("audio.device: needs a name")
    n_in = int(_num(dev.get("inputs"), "audio.device.inputs", 1, MAX_CHANNELS))
    n_out = int(_num(dev.get("outputs"), "audio.device.outputs", 1, MAX_CHANNELS))
    rate = dev.get("rate")
    if rate is not None:
        rate = int(_num(rate, "audio.device.rate", 8000, 384000))
    expect = _expect(dev.get("expect"))

    input_labels: dict[int, str] = {}
    input_list: list[Input] = []
    warnings: list[str] = []
    for i, raw in enumerate(_list(doc, "inputs")):
        if isinstance(raw, dict):
            ch = _ch(raw.get("ch"), f"audio.inputs[{i}].ch", n_in)
            input_labels[ch] = str(raw.get("label") or "")
            input_list.append(_input(raw, ch, f"audio.inputs[{i}]", warnings))
    output_labels: dict[int, str] = {}
    for i, raw in enumerate(_list(doc, "outputs")):
        if isinstance(raw, dict):
            output_labels[_ch(raw.get("ch"), f"audio.outputs[{i}].ch", n_out)] = str(raw.get("label") or "")

    speakers: list[Speaker] = []
    for i, raw in enumerate(_list(doc, "speakers")):
        where = f"audio.speakers[{i}]"
        if not isinstance(raw, dict) or not isinstance(raw.get("id"), str) or not raw["id"]:
            raise AudioDocError(f"{where}: needs an id")
        outs = raw.get("out") or []
        if not isinstance(outs, list):
            raise AudioDocError(f"{where}.out: a list of output channels")
        gain = raw.get("gain")
        speakers.append(
            Speaker(
                id=raw["id"],
                name=str(raw.get("name") or raw["id"]),
                room=str(raw.get("room") or ""),
                out=tuple(dict.fromkeys(_ch(c, f"{where}.out", n_out) for c in outs)),
                gain_db=0.0 if gain is None else _num(gain, f"{where}.gain", -60, 12),
            )
        )

    zones: list[Zone] = []
    for i, raw in enumerate(_list(doc, "zones")):
        if not isinstance(raw, dict) or not isinstance(raw.get("id"), str):
            raise AudioDocError(f"audio.zones[{i}]: needs an id")
        zones.append(Zone(raw["id"], str(raw.get("name") or raw["id"]), _names(raw.get("speakers") or [], f"audio.zones[{i}].speakers")))

    routes: list[Route] = []
    for i, raw in enumerate(_list(doc, "routes")):
        where = f"audio.routes[{i}]"
        if not isinstance(raw, dict):
            raise AudioDocError(f"{where}: must be an object")
        outs = raw.get("out") or []
        if not isinstance(outs, list):
            raise AudioDocError(f"{where}.out: a list of output channels")
        gain = raw.get("gain")
        routes.append(
            Route(
                inp=_ch(raw.get("in"), f"{where}.in", n_in),
                out=tuple(dict.fromkeys(_ch(c, f"{where}.out", n_out) for c in outs)),
                gain_db=0.0 if gain is None else _num(gain, f"{where}.gain", -60, 12),
            )
        )

    cues: dict[str, Cue] = {}
    raw_cues = doc.get("cues") or {}
    if not isinstance(raw_cues, dict):
        raise AudioDocError("audio.cues: must be an object")
    for name, raw in raw_cues.items():
        if not isinstance(raw, dict):
            raise AudioDocError(f"audio.cues.{name}: must be an object")
        gain = raw.get("gain")
        cues[str(name)] = Cue(
            to=_names(raw.get("to") or [], f"audio.cues.{name}.to"),
            gain_db=0.0 if gain is None else _num(gain, f"audio.cues.{name}.gain", -60, 12),
            duck=raw.get("duck") is not False,
        )

    announce = doc.get("announce") or {}
    if not isinstance(announce, dict):
        raise AudioDocError("audio.announce: must be an object")
    announce_to = _names(announce.get("to") or [EVERYWHERE], "audio.announce.to") or (EVERYWHERE,)

    return AudioDoc(
        device=dev["name"],
        inputs=n_in,
        outputs=n_out,
        rate=rate,
        input_labels=input_labels,
        output_labels=output_labels,
        speakers=tuple(speakers),
        zones=tuple(zones),
        routes=tuple(routes),
        cues=cues,
        announce_to=announce_to,
        announce_chime=announce.get("chime") is not False,
        expect=expect,
        input_list=tuple(input_list),
        warnings=tuple(warnings),
    )


def _input(raw: dict, ch: int, where: str, warnings: list[str]) -> Input:
    """One input's `role` / `reach`, read leniently (C1.1)."""
    role = raw.get("role")
    if role is not None and (not isinstance(role, str) or not ROLE.match(role)):
        warnings.append(f"{where}.role {role!r}: not a role (a-z, 0-9, _ or -, ≤ 32) — ignored")
        role = None
    elif role in RESERVED_ROLES:
        warnings.append(f"{where}.role {role!r}: reserved for the router's own source — ignored")
        role = None
    reach = raw.get("reach")
    if reach is not None:
        try:
            reach = _names(reach, f"{where}.reach")
        except AudioDocError as err:
            warnings.append(f"{err} — the default reach")
            reach = None
    return Input(ch=ch, label=str(raw.get("label") or ""), kind=str(raw.get("kind") or ""), role=role, reach=reach)


def _expect(raw: Any) -> tuple[int, int] | None:
    """`device.expect` read leniently: routing never needs it, so a malformed
    one (the server refuses it anyway) is simply not compared."""
    if not isinstance(raw, dict):
        return None
    vals = [raw.get("inputs"), raw.get("outputs")]
    if not all(isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= MAX_CHANNELS for v in vals):
        return None
    return int(vals[0]), int(vals[1])


@dataclass(frozen=True)
class HouseRoom:
    id: str
    label: str
    location: str | None


def house_rooms(house: Any) -> tuple[HouseRoom, ...]:
    """house.json → its rooms (id, label, story LOCATION or None)."""
    rooms = house.get("rooms") if isinstance(house, dict) else None
    out: list[HouseRoom] = []
    for room in rooms if isinstance(rooms, list) else []:
        if isinstance(room, dict) and isinstance(room.get("id"), str):
            loc = room.get("location")
            label = room.get("label")
            out.append(HouseRoom(room["id"], label if isinstance(label, str) else "", loc if isinstance(loc, str) and loc else None))
    return tuple(out)


@dataclass(frozen=True)
class Resolved:
    speakers: tuple[str, ...] = ()
    outputs: tuple[int, ...] = ()
    #: Target names that name nothing at all (logged once by the router).
    unknown: tuple[str, ...] = ()


def _one(audio: AudioDoc, rooms: tuple[HouseRoom, ...], name: str) -> set[str] | None:
    """The speaker ids one target reaches, or None when it names nothing
    (a known room with no speaker in it reaches the empty set)."""
    t = fold(name)
    if t == EVERYWHERE:
        return {s.id for s in audio.speakers}
    known = False
    hit: set[str] = set()
    room_ids: set[str] = set()
    for s in audio.speakers:
        if fold(s.id) == t:
            hit.add(s.id)
            known = True
        if fold(s.room) == t:
            room_ids.add(s.room)
    for z in audio.zones:
        if fold(z.id) == t or fold(z.name) == t:
            hit.update(z.speakers)
            known = True
    for r in rooms:
        if fold(r.id) == t or fold(r.label) == t or (r.location is not None and fold(r.location) == t):
            room_ids.add(r.id)
    if room_ids:
        known = True
        hit.update(s.id for s in audio.speakers if s.room in room_ids)
    return hit if known else None


def resolve_targets(audio: AudioDoc, house: Any, to: list[str] | tuple[str, ...]) -> Resolved:
    """Target names → the speakers they reach and those speakers' outputs.
    `house` is the house.json object (or None: a LOCATION or a room label
    then reaches nothing; a room id still reaches the speakers placed in it)."""
    rooms = house_rooms(house) if house is not None else ()
    chosen: set[str] = set()
    unknown: list[str] = []
    for name in to:
        if not isinstance(name, str) or fold(name) == "":
            continue
        hits = _one(audio, rooms, name)
        if hits is None:
            unknown.append(name)
            continue
        chosen |= hits
    picked = [s for s in audio.speakers if s.id in chosen]
    speakers = tuple(s.id for s in picked)
    outputs = tuple(sorted({c for s in picked for c in s.out}))
    return Resolved(speakers=speakers, outputs=outputs, unknown=tuple(unknown))


def knows(audio: AudioDoc, house: Any, name: str) -> bool:
    return _one(audio, house_rooms(house) if house is not None else (), name) is not None


def split_targets(text: str, audio: AudioDoc, house: Any) -> list[str]:
    """A story's `rooms:` value → target names. `The Desktop` stays one name
    when it resolves as a whole; `desktop start-bar` and `a, b` split."""
    text = text.strip()
    if not text:
        return []
    if "," in text:
        return [p.strip() for p in text.split(",") if p.strip()]
    if knows(audio, house, text):
        return [text]
    parts = [p for p in re.split(r"\s+(?:and\s+)?|\s*\+\s*", text) if p and p.lower() != "and"]
    return parts or [text]


def output_gains(audio: AudioDoc, speakers: tuple[str, ...], gain_db: float = 0.0) -> dict[int, float]:
    """Output channel → dB for a sound on these speakers: the cue's gain on
    every output they use. The speakers' own trims are not in it (wave 38):
    they are the outputs' (`output_trims`, the mixer's `set_trim`), so a
    trim edit is heard at once on a sound already playing."""
    out: dict[int, float] = {}
    for sid in speakers:
        s = audio.speaker(sid)
        if s is None:
            continue
        for ch in s.out:
            out[ch] = gain_db
    return out


def output_trims(audio: AudioDoc) -> dict[int, float]:
    """Output channel → the trim (dB) of the speaker wired to it; two
    speakers on one output take the louder. Unwired outputs: none (0 dB)."""
    out: dict[int, float] = {}
    for s in audio.speakers:
        for ch in s.out:
            out[ch] = max(out.get(ch, -1e9), s.gain_db)
    return out


@dataclass(frozen=True)
class SourceSpec:
    """An input-driven priority source as the mixer takes it (C1.1/C2)."""

    name: str
    inputs: tuple[int, ...]
    reach: tuple[int, ...]


def input_reach(audio: AudioDoc, house: Any, inp: Input) -> tuple[tuple[int, ...], list[str]]:
    """(the outputs an input's source ducks, warnings). `reach` resolves
    like a cue's `to`; with none, the outputs its `routes` rows feed; with
    no route either, everywhere."""
    warnings: list[str] = []
    if inp.reach is not None:
        res = resolve_targets(audio, house, inp.reach)
        for name in res.unknown:
            warnings.append(f"input {inp.ch} ({inp.role}) reach {name!r} names no zone, room, LOCATION or speaker")
        for name in inp.reach:
            if name not in res.unknown and not resolve_targets(audio, house, [name]).outputs:
                warnings.append(f"input {inp.ch} ({inp.role}) reach {name!r} reaches no wired speaker")
        return res.outputs, warnings
    routed = sorted({o for r in audio.routes if r.inp == inp.ch for o in r.out})
    if routed:
        return tuple(routed), warnings
    return resolve_targets(audio, house, [EVERYWHERE]).outputs, warnings


def sidechain_sources(audio: AudioDoc, house: Any) -> tuple[list[SourceSpec], list[str]]:
    """Every input with a `role` → one mixer source each (two inputs may
    share a role: the mixer takes the louder), and the reach warnings."""
    out: list[SourceSpec] = []
    warnings: list[str] = []
    for inp in audio.input_list:
        if inp.role is None:
            continue
        reach, notes = input_reach(audio, house, inp)
        warnings.extend(notes)
        out.append(SourceSpec(inp.role, (inp.ch,), reach))
    return out, warnings


def speaker_layout(audio: AudioDoc, speakers: tuple[str, ...]) -> tuple[tuple[int, ...], ...]:
    """Each speaker's outputs in its own `out` order — the mixer lays a
    stereo file out per speaker (L → first, R → second; mono → a downmix)."""
    out: list[tuple[int, ...]] = []
    for sid in speakers:
        s = audio.speaker(sid)
        if s is not None and s.out:
            out.append(s.out)
    return tuple(out)
