"""The house soundtrack (wave 38, C3): music all night, one set per act.

`media/soundtrack.yaml` (tracked; the MP3s it names live in the git-ignored
`media/music/` and `media/library/`) says what plays where:

  - **playlists**: a folder (`dir`: every audio file in it, not recursive,
    read again at each pass so a track dropped in mid-show joins the next
    pass) or a list of `files`; shuffled (Fisher–Yates, reshuffled at each
    pass, never the same track twice in a row across passes) unless
    `shuffle: false`; `level_db` on top of the top-level `level_db`. A
    playlist always cycles; `loop: true` on a one-file playlist makes it one
    seamless stream loop (the Fan Closet's dryer) instead of a crossfade
    back into itself.
  - **scenes**: an ordered list of `{to: targets, play: playlist | null}`.
    Each speaker takes the last entry that reaches it (`null`: silence), and
    the speakers that share a playlist are one **bed**: one stream laid out
    per speaker (a stereo file's L / R as a story sound's), crossfading
    between its tracks over `crossfade_s`.
  - **tracks**: story `sound X` names that play as a stream with
    `takeover: true` (the mixer's `takeover` source: the beds on their
    speakers fall silent while they play). The router reads this; the
    director never plays them.

The `Director` (owned by the router) plays the scenes on the mixer's `music`
bus. A scene change keeps a bed whose playlist and speakers are unchanged
untouched (the Fan Closet's loop runs on across acts), moves a bed whose
playlist stays but whose speakers changed (a second stream of the same
track, opened at the same point, crossfaded over `scene_fade_s`), fades
every other bed out over `scene_fade_s` and fades the new ones in. A change
to the current scene does nothing.

Crossfades count on the mixer's frame clock (`Mixer.frames`): the next
track is opened `PREPARE_S` before its crossfade (by the header's length)
so its worker has prefilled it, then played `start_at` the crossfade's first
frame while the current one is stopped `at` the same frame; the two linear
fades sum to the bed's level. An MP3's header length is an estimate: once
its stream has decoded the real end (`eof`, up to the ring buffer ahead) the
director uses that, and a track that ends before its crossfade was due (or
fails) has the next one started at once. At most the current and the next
track of each bed are open.

Everything the director touches is injectable: `stream_factory(path, rate,
loop=, offset=)` (default: a `stream.Stream`), `rng` (a `random.Random`),
and the clock is the mixer's own, so the tests drive it block by block.
"""

from __future__ import annotations

import logging
import random
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from ..module import ConfigError
from .routing import AudioDoc, fold, output_gains, resolve_targets, speaker_layout

log = logging.getLogger("stagehand.audio")

#: The scene that is silence (always valid, defined or not).
OFF = "off"
#: A live `cue music_<scene>`.
CUE_PREFIX = "music_"
NAME = re.compile(r"^[a-z][a-z0-9_]{0,47}$")
#: The files a playlist folder plays (lossless first, as the story sounds).
MUSIC_EXTENSIONS = (".wav", ".aiff", ".aif", ".flac", ".mp3", ".ogg")
#: The next track opens this long before its crossfade (its worker prefills).
PREPARE_S = 6.0
#: A crossfade is scheduled at least this far ahead of its first frame (the
#: director ticks every 0.1 s; the mixer drains commands once a block).
LEAD_S = 0.3
#: An empty playlist, or a file that won't open: look again this often.
RETRY_S = 10.0
#: A track that ended early (or failed): the next one's fade-in.
CUT_FADE_S = 0.05

_TOP = ("version", "level_db", "crossfade_s", "scene_fade_s", "playlists", "scenes", "tracks")
_PLAYLIST = ("dir", "files", "shuffle", "loop", "level_db")


@dataclass(frozen=True)
class Playlist:
    name: str
    #: An absolute folder (`dir`), or None for a `files` list.
    dir: str | None = None
    #: Absolute paths (`files`), in the YAML's order.
    files: tuple[str, ...] = ()
    shuffle: bool = True
    loop: bool = False
    level_db: float = 0.0

    def tracks(self) -> list[str]:
        """The files it plays now (a folder is listed again each call;
        a listed file that is gone is left out)."""
        if self.dir is not None:
            try:
                entries = sorted(p for p in Path(self.dir).iterdir() if p.suffix.lower() in MUSIC_EXTENSIONS and not p.name.startswith(".") and p.is_file())
            except OSError:
                return []
            return [str(p) for p in entries]
        return [f for f in self.files if Path(f).is_file()]

    def where(self) -> str:
        return self.dir if self.dir is not None else ", ".join(self.files)


@dataclass(frozen=True)
class Entry:
    to: tuple[str, ...]
    #: A playlist name, or None (silence on the speakers it reaches).
    play: str | None


@dataclass(frozen=True)
class Track:
    name: str
    takeover: bool = True


@dataclass(frozen=True)
class Soundtrack:
    path: str
    level_db: float = -10.0
    crossfade_s: float = 3.0
    scene_fade_s: float = 2.5
    playlists: dict[str, Playlist] = field(default_factory=dict)
    scenes: dict[str, tuple[Entry, ...]] = field(default_factory=dict)
    tracks: dict[str, Track] = field(default_factory=dict)

    def scene(self, name: str) -> tuple[Entry, ...] | None:
        """A scene's entries; `off` is silence even when the YAML leaves it out."""
        if name in self.scenes:
            return self.scenes[name]
        return () if name == OFF else None

    def has_scene(self, name: Any) -> bool:
        return isinstance(name, str) and self.scene(name) is not None

    def track(self, name: str) -> Track | None:
        """The `tracks:` entry of a story sound (names fold like `no_duck`)."""
        hit = self.tracks.get(name)
        if hit is not None:
            return hit
        key = fold(name)
        return next((t for n, t in self.tracks.items() if fold(n) == key), None)

    def missing(self) -> list[str]:
        """The playlists with no file to play (their beds are silent)."""
        return sorted(name for name, p in self.playlists.items() if not p.tracks())

    def bed_level(self, playlist: str) -> float:
        p = self.playlists.get(playlist)
        return self.level_db + (p.level_db if p is not None else 0.0)

    def describe(self) -> list[str]:
        lines = [
            f"music    : {self.path} — {len(self.scenes)} scene(s), {len(self.playlists)} playlist(s), {len(self.tracks)} track(s); "
            f"beds at {self.level_db:+g} dB, crossfade {self.crossfade_s:g}s, scene fade {self.scene_fade_s:g}s"
        ]
        for name, p in self.playlists.items():
            n = len(p.tracks())
            lines.append(f"  {name:<12} {n} file(s){' (loop)' if p.loop and n == 1 else ''} — {p.where()}")
        return lines

    def warnings(self, doc: AudioDoc | None, house: Any) -> list[str]:
        """`stagehand check` (C3): an empty playlist, a scene entry that
        reaches no speaker (the Fan Closet's until its speaker is placed)."""
        out = [f"music: playlist {name} has no file ({self.playlists[name].where()}) — its bed is silent" for name in self.missing()]
        if doc is not None:
            for scene in self.scenes:
                _, notes = scene_beds(self, scene, doc, house)
                out.extend(f"music: {n}" for n in notes)
        return out


# -- parsing -----------------------------------------------------------------


def _num(raw: Any, where: str, lo: float, hi: float) -> float:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not lo <= raw <= hi:
        raise ConfigError(f"{where}: a number from {lo:g} to {hi:g}")
    return float(raw)


def _bool(raw: Any, where: str) -> bool:
    if not isinstance(raw, bool):
        raise ConfigError(f"{where}: true or false")
    return raw


def _unknown(raw: dict, known: tuple[str, ...], where: str) -> None:
    extra = sorted(str(k) for k in raw if k not in known)
    if extra:
        raise ConfigError(f"{where}.{extra[0]}: unknown key ({', '.join(known)})")


def _resolve(base: Path, value: str) -> str:
    p = Path(value).expanduser()
    return str((p if p.is_absolute() else base / p).resolve())


def _playlist(name: Any, raw: Any, base: Path, where: str) -> Playlist:
    if not isinstance(name, str) or not NAME.match(name):
        raise ConfigError(f"{where}: a playlist name is a-z, 0-9 and _ (got {name!r})")
    where = f"{where}.{name}"
    if not isinstance(raw, dict):
        raise ConfigError(f"{where}: a mapping ({{dir: …}} or {{files: […]}})")
    _unknown(raw, _PLAYLIST, where)
    if ("dir" in raw) == ("files" in raw):
        raise ConfigError(f"{where}: exactly one of dir or files")
    folder: str | None = None
    files: tuple[str, ...] = ()
    if "dir" in raw:
        if not isinstance(raw["dir"], str) or not raw["dir"].strip():
            raise ConfigError(f"{where}.dir: a folder (relative to the soundtrack's own)")
        folder = _resolve(base, raw["dir"].strip())
    else:
        listed = raw["files"]
        if not isinstance(listed, list) or not listed or not all(isinstance(f, str) and f.strip() for f in listed):
            raise ConfigError(f"{where}.files: a non-empty list of file paths")
        files = tuple(_resolve(base, f.strip()) for f in listed)
    return Playlist(
        name=name,
        dir=folder,
        files=files,
        shuffle=_bool(raw.get("shuffle", True), f"{where}.shuffle"),
        loop=_bool(raw.get("loop", False), f"{where}.loop"),
        level_db=_num(raw.get("level_db", 0), f"{where}.level_db", -60, 12),
    )


def _targets(raw: Any, where: str) -> tuple[str, ...]:
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list) or not raw or not all(isinstance(t, str) and t.strip() for t in raw):
        raise ConfigError(f"{where}: a target (zone, room, LOCATION, speaker, everywhere) or a list of them")
    return tuple(t.strip() for t in raw)


def _scene(name: Any, raw: Any, playlists: dict[str, Playlist], where: str) -> tuple[Entry, ...]:
    if not isinstance(name, str) or not NAME.match(name):
        raise ConfigError(f"{where}: a scene name is a-z, 0-9 and _ (`cue music_<scene>`; got {name!r})")
    where = f"{where}.{name}"
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ConfigError(f"{where}: a list of {{to: targets, play: playlist | null}}")
    out: list[Entry] = []
    for i, e in enumerate(raw):
        at = f"{where}[{i}]"
        if not isinstance(e, dict):
            raise ConfigError(f"{at}: {{to: targets, play: playlist | null}}")
        _unknown(e, ("to", "play"), at)
        if "to" not in e or "play" not in e:
            raise ConfigError(f"{at}: needs both to and play (play: null is silence)")
        play = e["play"]
        if play is not None and (not isinstance(play, str) or play not in playlists):
            raise ConfigError(f"{at}.play: no playlist {play!r} (known: {', '.join(playlists) or 'none'})")
        out.append(Entry(to=_targets(e["to"], f"{at}.to"), play=play))
    return tuple(out)


def parse_soundtrack(doc: Any, base_dir: str | Path, path: str = "soundtrack.yaml") -> Soundtrack:
    """The YAML's mapping → a Soundtrack. Strict (a typo fails at boot, as
    every module's config does): unknown keys, a bad number, a scene that
    plays a playlist nobody defined are ConfigErrors naming the key. A
    playlist with no file is only a warning (`Soundtrack.warnings`)."""
    where = Path(path).name
    if not isinstance(doc, dict):
        raise ConfigError(f"{where}: a mapping (version, playlists, scenes, tracks)")
    _unknown(doc, _TOP, where)
    if doc.get("version", 1) != 1:
        raise ConfigError(f"{where}.version: only 1")
    base = Path(base_dir)
    raw_lists = doc.get("playlists") or {}
    if not isinstance(raw_lists, dict):
        raise ConfigError(f"{where}.playlists: a mapping of name → {{dir | files, shuffle?, loop?, level_db?}}")
    playlists = {str(n): _playlist(n, r, base, f"{where}.playlists") for n, r in raw_lists.items()}
    raw_scenes = doc.get("scenes") or {}
    if not isinstance(raw_scenes, dict):
        raise ConfigError(f"{where}.scenes: a mapping of name → [{{to, play}}, …]")
    scenes = {str(n): _scene(n, r, playlists, f"{where}.scenes") for n, r in raw_scenes.items()}
    raw_tracks = doc.get("tracks") or {}
    if not isinstance(raw_tracks, dict):
        raise ConfigError(f"{where}.tracks: a mapping of story sound → {{takeover: true}}")
    tracks: dict[str, Track] = {}
    for n, r in raw_tracks.items():
        at = f"{where}.tracks.{n}"
        if not isinstance(n, str) or not re.match(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,80}$", n):
            raise ConfigError(f"{at}: a story sound's name")
        r = {} if r is None else r
        if not isinstance(r, dict):
            raise ConfigError(f"{at}: {{takeover: true | false}}")
        _unknown(r, ("takeover",), at)
        tracks[n] = Track(name=n, takeover=_bool(r.get("takeover", True), f"{at}.takeover"))
    return Soundtrack(
        path=str(path),
        level_db=_num(doc.get("level_db", -10), f"{where}.level_db", -60, 0),
        crossfade_s=_num(doc.get("crossfade_s", 3), f"{where}.crossfade_s", 0, 30),
        scene_fade_s=_num(doc.get("scene_fade_s", 2.5), f"{where}.scene_fade_s", 0, 30),
        playlists=playlists,
        scenes=scenes,
        tracks=tracks,
    )


def load_soundtrack(path: str | Path) -> Soundtrack:
    """Read and parse a soundtrack YAML; paths in it are relative to its folder."""
    p = Path(path)
    try:
        doc = yaml.safe_load(p.read_text(encoding="utf-8"))
    except OSError as err:
        raise ConfigError(f"audio.soundtrack: can't read {p} ({err.strerror or err})") from None
    except yaml.YAMLError as err:
        raise ConfigError(f"audio.soundtrack: {p.name} is not valid YAML ({err})") from None
    return parse_soundtrack(doc, p.parent, str(p))


# -- scenes → beds ------------------------------------------------------------


def scene_beds(st: Soundtrack, scene: str, doc: AudioDoc, house: Any) -> tuple[dict[str, tuple[str, ...]], list[str]]:
    """(playlist → its bed's speakers in audio.json order, notes). Each
    speaker takes the last entry that reaches it; a speaker with no output
    plays nothing. An entry that reaches no speaker is a note (a warning in
    `check`, logged once live), never an error."""
    entries = st.scene(scene) or ()
    owner: dict[str, str | None] = {}
    notes: list[str] = []
    for i, e in enumerate(entries):
        res = resolve_targets(doc, house, list(e.to))
        for name in res.unknown:
            notes.append(f"scene {scene} entry {i + 1} ({e.play or 'silence'}): {name!r} names no zone, room, LOCATION or speaker")
        if not res.outputs and len(res.unknown) < len(e.to):
            notes.append(f"scene {scene} entry {i + 1} ({e.play or 'silence'}): {', '.join(e.to)} reaches no wired speaker")
        for sid in res.speakers:
            owner[sid] = e.play
    beds: dict[str, list[str]] = {}
    for s in doc.speakers:
        play = owner.get(s.id)
        if play is not None and s.out:
            beds.setdefault(play, []).append(s.id)
    return {p: tuple(v) for p, v in beds.items()}, notes


# -- the order of a playlist ----------------------------------------------------


def fisher_yates(items: list, rng: random.Random) -> list:
    """Shuffle in place (Durstenfeld's Fisher–Yates) with an injectable rng."""
    for i in range(len(items) - 1, 0, -1):
        j = rng.randrange(i + 1)
        items[i], items[j] = items[j], items[i]
    return items


class Deck:
    """One playlist's order: a pass over its files (shuffled, or in name
    order), then a new pass (the folder read again, reshuffled) whose first
    track is never the one just played. Kept per playlist by the director,
    so an act that comes back carries on rather than starting over."""

    def __init__(self, playlist: Playlist, rng: random.Random) -> None:
        self.playlist = playlist
        self.rng = rng
        self.order: list[str] = []
        self.i = 0
        self.last: str | None = None
        self.passes = 0

    def _new_pass(self) -> None:
        files = self.playlist.tracks()
        order = fisher_yates(list(files), self.rng) if self.playlist.shuffle else list(files)
        if len(order) > 1 and order[0] == self.last:
            j = self.rng.randrange(1, len(order))
            order[0], order[j] = order[j], order[0]
        self.order, self.i = order, 0
        self.passes += 1

    def next(self) -> str | None:
        if self.i >= len(self.order):
            self._new_pass()
            if not self.order:
                return None
        path = self.order[self.i]
        self.i += 1
        self.last = path
        return path

    def size(self) -> int:
        return len(self.order) if self.order else len(self.playlist.tracks())


# -- the director -----------------------------------------------------------------


def _default_stream(path: str, rate: int, *, loop: bool = False, offset: int = 0) -> Any:
    from .stream import Stream

    return Stream(path, rate, loop=loop, offset=offset, name=Path(path).stem)


@dataclass
class Playing:
    """One track of a bed handed to the mixer."""

    vid: int
    path: str
    stream: Any
    #: Mixer frame it was played to start on (None: as soon as it is prefilled).
    start: int | None
    looping: bool = False

    def here(self) -> int:
        """Output frames into the file now (its stream's position)."""
        return int(self.stream.position)

    def end(self) -> int | None:
        """The file's last output frame: exact once the stream has decoded
        it (`eof`), else the header's (an MP3's is an estimate)."""
        s = self.stream
        if getattr(s, "eof", False):
            return int(getattr(s, "offset", 0)) + int(s.produced)
        return int(s.length) if s.length else None


@dataclass
class Bed:
    playlist: str
    speakers: tuple[str, ...]
    gains: dict[int, float]
    layout: tuple[tuple[int, ...], ...]
    level_db: float
    cur: Playing | None = None
    #: The incoming track of a crossfade (played `start_at` a future frame).
    nxt: Playing | None = None
    #: The next track, opened ahead so its worker prefills it.
    pending: tuple[str, Any] | None = None
    #: Mixer frame before which a failed open / an empty playlist is not retried.
    retry_at: int = 0


class Director:
    """Plays a `Soundtrack`'s scenes on a mixer (see the module docstring).
    Not thread-safe: the router calls it from its event loop only."""

    def __init__(self, soundtrack: Soundtrack, *, stream_factory: Callable[..., Any] | None = None, rng: random.Random | None = None) -> None:
        self.st = soundtrack
        self._open_stream = stream_factory or _default_stream
        self.rng = rng or random.Random()
        self.mixer: Any = None
        self.doc: AudioDoc | None = None
        self.house: Any = None
        #: The scene in force (None: none yet, or stopped — any scene cue,
        #: even the last one, starts it again).
        self.scene: str | None = None
        self.beds: dict[str, Bed] = {}
        self._decks: dict[str, Deck] = {}
        self._logged: set[str] = set()

    # -- wiring ----------------------------------------------------------------

    def attach(self, mixer: Any, doc: AudioDoc, house: Any) -> None:
        """The mixer and audio.json (+ house.json) in force. A new mixer (the
        stream reopened) starts the scene's beds again; a new audio.json or
        house map re-reads the scene with the scene-change rules, so a bed
        whose speakers did not move is never touched."""
        if mixer is not self.mixer:
            for bed in self.beds.values():
                self._close_pending(bed)
            self.beds = {}
            self.mixer = mixer
        self.doc, self.house = doc, house
        if self.scene is not None:
            self._enter(self.scene)

    def _frames(self, seconds: float) -> int:
        return int(round(seconds * self.mixer.rate))

    def _note(self, text: str, level: int = logging.WARNING) -> None:
        if text not in self._logged:
            self._logged.add(text)
            log.log(level, "🎵 soundtrack: %s", text)

    # -- the control side --------------------------------------------------------

    def set_scene(self, name: str | None, why: str = "") -> bool:
        """Play scene `name` (None / `off`: silence). → False for a scene the
        soundtrack does not define (logged once; nothing changes). The
        current scene again is a no-op."""
        name = OFF if name is None else name
        if not self.st.has_scene(name):
            self._note(f"no scene {name!r} in {Path(self.st.path).name} ({why or 'asked'}) — ignored")
            return False
        if name == self.scene:
            return True
        log.info("🎵 soundtrack: scene %s%s", name, f" ({why})" if why else "")
        self.scene = name
        if self.mixer is not None and self.doc is not None:
            self._enter(name)
        return True

    def stop(self, fade_s: float, why: str = "") -> None:
        """Fade every bed out and forget the scene (Stop house sounds, a
        story restart): the next scene cue, even the same one, starts again."""
        if self.beds:
            log.info("🎵 soundtrack: every bed fades out over %gs%s", fade_s, f" ({why})" if why else "")
        for bed in self.beds.values():
            self._fade_out(bed, fade_s)
        self.beds = {}
        self.scene = None

    def next(self) -> int:
        """Skip to the next track on every bed (a crossfade). → beds moved on.
        A seamless loop has no next."""
        if self.mixer is None:
            return 0
        moved = 0
        now = self.mixer.frames
        for bed in self.beds.values():
            cur = bed.cur
            if cur is None or cur.looping:
                continue
            got = bed.pending or self._next_stream(bed)
            bed.pending = None
            if got is None:
                continue
            start = now + self._frames(LEAD_S)
            fade = self.st.crossfade_s
            for old in (cur, bed.nxt):
                if old is not None:
                    self.mixer.stop(vid=old.vid, fade_s=fade, at=start)
            bed.nxt = self._play(bed, got, fade_s=fade, start_at=start)
            moved += 1
        return moved

    # -- scene changes --------------------------------------------------------------

    def _enter(self, scene: str) -> None:
        assert self.doc is not None
        wanted, notes = scene_beds(self.st, scene, self.doc, self.house)
        for n in notes:
            self._note(n)
        fade = self.st.scene_fade_s
        beds: dict[str, Bed] = {}
        for playlist, bed in self.beds.items():
            speakers = wanted.get(playlist)
            if speakers is None:
                self._fade_out(bed, fade)
                continue
            if speakers == bed.speakers and speaker_layout(self.doc, speakers) == bed.layout:
                beds[playlist] = bed  # untouched: the same playlist on the same speakers
                continue
            beds[playlist] = self._move(bed, speakers)
        for playlist, speakers in wanted.items():
            if playlist not in beds:
                bed = self._bed(playlist, speakers)
                self._begin(bed, fade)
                beds[playlist] = bed
        self.beds = beds

    def _bed(self, playlist: str, speakers: tuple[str, ...]) -> Bed:
        assert self.doc is not None
        return Bed(
            playlist=playlist,
            speakers=speakers,
            gains=output_gains(self.doc, speakers),
            layout=speaker_layout(self.doc, speakers),
            level_db=self.st.bed_level(playlist),
        )

    def _move(self, bed: Bed, speakers: tuple[str, ...]) -> Bed:
        """The same playlist on other speakers: a second stream of the
        track playing, opened where the first will be when it starts, and
        crossfaded in over the scene fade while the first fades out."""
        new = self._bed(playlist=bed.playlist, speakers=speakers)
        new.pending = bed.pending
        now = self.mixer.frames
        # The voice heard now: a crossfade's incoming track once it has begun.
        cur = bed.nxt if bed.nxt is not None and (bed.nxt.start is None or now >= bed.nxt.start) else bed.cur
        fade = self.st.scene_fade_s
        if cur is None:
            self._begin(new, fade)
            return new
        lead = self._frames(LEAD_S)
        start = now + lead
        stream = None
        try:
            stream = self._open_stream(cur.path, self.mixer.rate, loop=cur.looping, offset=max(0, cur.here() + lead))
        except Exception as err:  # noqa: BLE001 — a vanished file: the next track instead
            self._note(f"{Path(cur.path).name}: can't reopen ({err}) — the bed starts its next track")
        for old in (bed.cur, bed.nxt):
            if old is not None:
                self.mixer.stop(vid=old.vid, fade_s=fade, at=start)
        if stream is None:
            self._begin(new, fade)
            return new
        new.cur = self._play(new, (cur.path, stream), fade_s=fade, start_at=start, looping=cur.looping)
        return new

    def _fade_out(self, bed: Bed, fade_s: float) -> None:
        for v in (bed.cur, bed.nxt):
            if v is not None and self.mixer is not None:
                self.mixer.stop(vid=v.vid, fade_s=fade_s)
        bed.cur = bed.nxt = None
        self._close_pending(bed)

    @staticmethod
    def _close_pending(bed: Bed) -> None:
        if bed.pending is not None:
            try:
                bed.pending[1].close(wait=False)
            except Exception:  # noqa: BLE001
                pass
            bed.pending = None

    # -- tracks ----------------------------------------------------------------------

    def _deck(self, playlist: str) -> Deck:
        deck = self._decks.get(playlist)
        if deck is None:
            deck = self._decks[playlist] = Deck(self.st.playlists[playlist], self.rng)
        return deck

    def _looping(self, playlist: str) -> bool:
        p = self.st.playlists[playlist]
        return p.loop and len(p.tracks()) == 1

    def _next_stream(self, bed: Bed) -> tuple[str, Any] | None:
        """Open the playlist's next track. A file that won't open is
        skipped (logged once); none at all → None (retried later)."""
        deck = self._deck(bed.playlist)
        loop = self._looping(bed.playlist)
        for _ in range(max(1, deck.size())):
            path = deck.next()
            if path is None:
                self._note(f"playlist {bed.playlist} has no file ({self.st.playlists[bed.playlist].where()}) — silent until one is there")
                break
            try:
                return path, self._open_stream(path, self.mixer.rate, loop=loop, offset=0)
            except Exception as err:  # noqa: BLE001 — libsndfile raises its own types
                self._note(f"{Path(path).name}: can't open ({err}) — skipped")
        bed.retry_at = self.mixer.frames + self._frames(RETRY_S)
        return None

    def _play(self, bed: Bed, got: tuple[str, Any], *, fade_s: float, start_at: int | None = None, looping: bool | None = None) -> Playing:
        path, stream = got
        vid = self.mixer.play(
            stream,
            bed.gains,
            bus="music",
            tag=f"music:{bed.playlist}",
            fade_in_s=fade_s,
            layout=bed.layout,
            level_db=bed.level_db,
            start_at=start_at,
        )
        loop = bool(getattr(stream, "loop", False)) if looping is None else looping
        log.info("🎵 %s → %s: %s", bed.playlist, ",".join(bed.speakers), Path(path).stem)
        return Playing(vid=vid, path=path, stream=stream, start=start_at, looping=loop)

    def _begin(self, bed: Bed, fade_s: float) -> None:
        """Start the bed's next track now (fading in over `fade_s`)."""
        got = bed.pending or self._next_stream(bed)
        bed.pending = None
        if got is not None:
            bed.cur = self._play(bed, got, fade_s=fade_s)

    # -- the clock ------------------------------------------------------------------

    def tick(self) -> None:
        """Run every ~0.1 s: promote a crossfade that has begun, open the
        next track ahead, schedule each bed's next crossfade on the mixer's
        clock, and start a track at once where one ended early."""
        if self.mixer is None:
            return
        for bed in self.beds.values():
            self._tick(bed, self.mixer.frames)

    def _tick(self, bed: Bed, now: int) -> None:
        mixer = self.mixer
        if bed.nxt is not None and (bed.nxt.start is None or now >= bed.nxt.start):
            bed.cur, bed.nxt = bed.nxt, None
        cur = bed.cur
        if cur is None:
            if now >= bed.retry_at:
                self._begin(bed, self.st.crossfade_s if bed.retry_at else self.st.scene_fade_s)
            return
        if not mixer.playing(cur.vid):
            # It ended before the crossfade was due (an MP3 shorter than its
            # header, a decode error): the next one now.
            bed.cur = None
            if bed.nxt is None and now >= bed.retry_at:
                self._begin(bed, CUT_FADE_S)
            return
        if cur.looping or bed.nxt is not None:
            return
        end = cur.end()
        if end is None:
            return  # no length in the header: wait for the decoder's end
        here = cur.here()
        remaining = end - here
        fade = min(self._frames(self.st.crossfade_s), max(0, end) // 3)
        if bed.pending is None and remaining <= fade + self._frames(PREPARE_S) and now >= bed.retry_at:
            bed.pending = self._next_stream(bed)
        if bed.pending is None or remaining > fade + self._frames(LEAD_S):
            return
        start = now + max(0, remaining - fade)
        got, bed.pending = bed.pending, None
        out_fade = max(1, min(fade, remaining))
        bed.nxt = self._play(bed, got, fade_s=fade / mixer.rate, start_at=start)
        mixer.stop(vid=cur.vid, fade_s=out_fade / mixer.rate, at=start)

    # -- health ------------------------------------------------------------------------

    def status(self) -> dict[str, Any]:
        """The health's `music` (C3): the scene, each bed's playlist,
        speakers, track and position, the playlists with no file."""
        rate = self.mixer.rate if self.mixer is not None else 0
        beds = []
        for bed in self.beds.values():
            cur = bed.cur
            beds.append(
                {
                    "playlist": bed.playlist,
                    "speakers": list(bed.speakers),
                    "track": Path(cur.path).stem if cur is not None else None,
                    "pos_s": round(cur.here() / rate, 1) if cur is not None and rate else 0.0,
                }
            )
        return {"scene": self.scene, "beds": beds, "missing": self.st.missing()}


def scene_of_cue(args: Any) -> str | None:
    """A `cue` directive's args → the scene its first word names
    (`music_act_1` → `act_1`), or None when it is not a music cue."""
    parts = re.split(r"[\s,]+", str(args or "").strip(), maxsplit=1)
    head = parts[0] if parts else ""
    return head[len(CUE_PREFIX) :] if head.startswith(CUE_PREFIX) and len(head) > len(CUE_PREFIX) else None
