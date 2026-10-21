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
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

EVERYWHERE = "everywhere"
#: The interface limits `validateAudio` enforces.
MAX_CHANNELS = 64


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
    output_labels: dict[int, str] = field(default_factory=dict)
    speakers: tuple[Speaker, ...] = ()
    zones: tuple[Zone, ...] = ()
    routes: tuple[Route, ...] = ()
    cues: dict[str, Cue] = field(default_factory=dict)
    announce_to: tuple[str, ...] = (EVERYWHERE,)
    announce_chime: bool = True

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

    input_labels: dict[int, str] = {}
    for i, raw in enumerate(_list(doc, "inputs")):
        if isinstance(raw, dict):
            input_labels[_ch(raw.get("ch"), f"audio.inputs[{i}].ch", n_in)] = str(raw.get("label") or "")
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
    )


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
    """Output channel → dB for a sound on these speakers: the speaker's own
    trim plus the cue's gain; two speakers on one output take the louder."""
    out: dict[int, float] = {}
    for sid in speakers:
        s = audio.speaker(sid)
        if s is None:
            continue
        for ch in s.out:
            db = s.gain_db + gain_db
            out[ch] = max(out.get(ch, -1e9), db)
    return out


def speaker_layout(audio: AudioDoc, speakers: tuple[str, ...]) -> tuple[tuple[int, ...], ...]:
    """Each speaker's outputs in its own `out` order — the mixer lays a
    stereo file out per speaker (L → first, R → second; mono → a downmix)."""
    out: list[tuple[int, ...]] = []
    for sid in speakers:
        s = audio.speaker(sid)
        if s is not None and s.out:
            out.append(s.out)
    return tuple(out)
