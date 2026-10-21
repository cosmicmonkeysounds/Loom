"""`audio.json` as the router reads it, and where a sound goes.

The event server owns the file (`@loom/house` `validateAudio`, the map
editor's Audio panel); this side only reads it. `parse_audio` is lenient on
everything routing can live without (labels, positions, notes) and strict on
what it can't (channel numbers, speaker outputs), so a doc the server
accepted always loads here.

`resolve_targets` mirrors `@loom/house` `resolveTargets` and is pinned to it
by a shared fixture (`tests/fixtures/audio-resolve.json`). One target name
resolves by the first rule that knows it:

    everywhere      every speaker
    a zone id       the zone's speakers
    a room id       the speakers placed in that room
    a LOCATION      every room whose `location` is it (house.json) → its speakers
    a speaker id    that speaker

Names fold case, spaces, `_` and `-` (`The Desktop` = `the_desktop`).
Speakers come back in the doc's order, outputs ascending, each once.
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
    """`The Desktop` / `the_desktop` / `THE-DESKTOP` → `thedesktop`."""
    return re.sub(r"[\s_\-]+", "", str(name)).lower()


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


def house_locations(house: Any) -> dict[str, str | None]:
    """house.json → room id → its story LOCATION (None when it names none)."""
    rooms = house.get("rooms") if isinstance(house, dict) else None
    out: dict[str, str | None] = {}
    for room in rooms if isinstance(rooms, list) else []:
        if isinstance(room, dict) and isinstance(room.get("id"), str):
            loc = room.get("location")
            out[room["id"]] = loc if isinstance(loc, str) and loc else None
    return out


@dataclass(frozen=True)
class Resolved:
    speakers: tuple[str, ...] = ()
    outputs: tuple[int, ...] = ()
    #: Target names that matched nothing (logged once by the router).
    unknown: tuple[str, ...] = ()


def _one(audio: AudioDoc, rooms: dict[str, str | None], name: str) -> list[Speaker] | None:
    key = fold(name)
    if key == EVERYWHERE:
        return list(audio.speakers)
    zone = next((z for z in audio.zones if fold(z.id) == key), None)
    if zone is not None:
        ids = {fold(s) for s in zone.speakers}
        return [s for s in audio.speakers if fold(s.id) in ids]
    room_ids = {fold(r) for r in rooms} | {fold(s.room) for s in audio.speakers}
    if key in room_ids:
        return [s for s in audio.speakers if fold(s.room) == key]
    located = {fold(r) for r, loc in rooms.items() if loc is not None and fold(loc) == key}
    if located:
        return [s for s in audio.speakers if fold(s.room) in located]
    hit = next((s for s in audio.speakers if fold(s.id) == key), None)
    return [hit] if hit is not None else None


def resolve_targets(audio: AudioDoc, house: Any, to: list[str] | tuple[str, ...]) -> Resolved:
    """Target names → the speakers they reach and those speakers' outputs.
    `house` is the house.json object (or None: LOCATIONs then resolve only
    when a speaker's room id happens to fold to the same name)."""
    rooms = house_locations(house) if house is not None else {}
    chosen: dict[str, Speaker] = {}
    unknown: list[str] = []
    for name in to:
        hits = _one(audio, rooms, name)
        if hits is None:
            unknown.append(name)
            continue
        for s in hits:
            chosen.setdefault(s.id, s)
    speakers = tuple(s.id for s in audio.speakers if s.id in chosen)
    outputs = tuple(sorted({c for sid in speakers for c in chosen[sid].out}))
    return Resolved(speakers=speakers, outputs=outputs, unknown=tuple(unknown))


def knows(audio: AudioDoc, house: Any, name: str) -> bool:
    return _one(audio, house_locations(house) if house is not None else {}, name) is not None


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
