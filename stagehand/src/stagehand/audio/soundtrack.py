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
    A playlist may be a **TIDAL** one (`tidal: <uuid>`, wave 52, `tidal.py`):
    the app plays it and the bed is the app's sound. Its `dir` / `files`
    are then the fallback, played when the app can't: it does not answer,
    the playlist won't start, or the cable carries nothing for `SILENT_S`.
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

One app plays one playlist, so a scene holds at most one TIDAL playlist, and
two of them never crossfade: both voices would hear the same cable, the
switch a hard cut under a level that never moves. The old bed fades out over
`scene_fade_s` first, then the app changes playlist and the new bed fades in
over `LIVE_FADE_S`, `LIVE_SWITCH_S` later. A TIDAL bed that leaves for no
other pauses the app when its fade ends.

A host can pick a playlist that no scene names (wave 58): `play_playlist` and
`play_tidal` build an ad-hoc scene from the one in force, the pick in place of
every entry that plays a non-looping playlist, so the Fan Closet's dryer runs
on. `pause` holds the app, on a live bed only: a file bed has no pause. A silent
cable is then no problem, and any change of scene lets go of it.

Everything the director touches is injectable: `stream_factory(path, rate,
loop=, offset=)` (default: a `stream.Stream`), `live` (a `tidal.Tidal`), `rng`
(a `random.Random`), and the clock is the mixer's own, so the tests drive it
block by block.
"""

from __future__ import annotations

import logging
import random
import re
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import yaml

from ..module import ConfigError
from .routing import AudioDoc, fold, output_gains, resolve_targets, speaker_layout

log = logging.getLogger("stagehand.audio")

#: The scene that is silence (always valid, defined or not).
OFF = "off"
#: An ad-hoc scene, a playlist picked by hand (wave 58): never in `status()`.
HAND_PREFIX = "hand_"
#: An ad-hoc playlist, one the YAML doesn't name, off the app's library.
TIDAL_PREFIX = "tidal_"
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
#: A track that ends having played less than this (a 0-frame render, a file
#: still being copied, a bad rip) counts as one that gave no audio: once a
#: whole pass of the playlist does that, the bed waits RETRY_S instead of
#: reopening the file every tick.
SHORT_S = 1.0
#: A live bed's cable carrying nothing this long: the fallback, if it has one.
SILENT_S = 20.0
#: The app's time from the Play click to the new playlist's first sound.
LIVE_SWITCH_S = 1.0
#: A live bed's fade-in after a playlist change.
LIVE_FADE_S = 1.5

_TOP = ("version", "level_db", "crossfade_s", "scene_fade_s", "playlists", "scenes", "tracks")
_PLAYLIST = ("dir", "files", "tidal", "shuffle", "loop", "level_db")
#: A TIDAL playlist's id: the last part of its share link.
TIDAL_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


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
    #: A TIDAL playlist's id (wave 52): `dir` / `files` are then its fallback.
    tidal: str | None = None

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
        folder = self.dir if self.dir is not None else ", ".join(self.files)
        if self.tidal is None:
            return folder
        return f"TIDAL {self.tidal}" + (f", else {folder}" if folder else "")


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

    def missing(self, live: bool = False) -> list[str]:
        """The playlists with nothing to play (their beds are silent). `live`:
        this machine has the TIDAL app, so a TIDAL playlist needs no file."""
        return sorted(name for name, p in self.playlists.items() if not p.tracks() and not (live and p.tidal))

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

    def warnings(self, doc: AudioDoc | None, house: Any, live: bool = False) -> list[str]:
        """`stagehand check` (C3): an empty playlist, a scene entry that
        reaches no speaker (the Fan Closet's until its speaker is placed)."""
        out = [f"music: playlist {name} has no file ({self.playlists[name].where()}) — its bed is silent" for name in self.missing(live)]
        if doc is not None:
            # One line per condition: every scene repeating the same entry
            # (the Fan Closet's, in all eight) is one warning, not eight.
            grouped: dict[str, list[str]] = {}
            first: dict[str, str] = {}
            for scene in self.scenes:
                _, notes = scene_beds(self, scene, doc, house)
                for n in notes:
                    m = _NOTE.match(n)
                    key = f"{m.group(2)}: {m.group(3)}" if m else n
                    grouped.setdefault(key, []).append(scene)
                    first.setdefault(key, n)
            for key, scenes in grouped.items():
                out.append(f"music: {first[key]}" if len(scenes) == 1 else f"music: {key} (in {len(scenes)} scenes: {', '.join(scenes)})")
        return out


_NOTE = re.compile(r"^scene (\S+) entry \d+ (\(.*?\)): (.*)$")


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
    tidal = raw.get("tidal")
    if tidal is not None and (not isinstance(tidal, str) or not TIDAL_ID.match(tidal)):
        raise ConfigError(f"{where}.tidal: a playlist id, the last part of its share link (got {tidal!r})")
    if ("dir" in raw and "files" in raw) or (tidal is None and "dir" not in raw and "files" not in raw):
        raise ConfigError(f"{where}: exactly one of dir or files" + (" (a tidal playlist's fallback)" if tidal else ""))
    folder: str | None = None
    files: tuple[str, ...] = ()
    if "dir" in raw:
        if not isinstance(raw["dir"], str) or not raw["dir"].strip():
            raise ConfigError(f"{where}.dir: a folder (relative to the soundtrack's own)")
        folder = _resolve(base, raw["dir"].strip())
    elif "files" in raw:
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
        tidal=tidal,
    )


def _targets(raw: Any, where: str) -> tuple[str, ...]:
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list) or not raw or not all(isinstance(t, str) and t.strip() for t in raw):
        raise ConfigError(f"{where}: a target (zone, room, LOCATION, speaker, everywhere) or a list of them")
    return tuple(t.strip() for t in raw)


def _key(name: Any) -> Any:
    """A scene's key: YAML 1.1 turns a bare `off` / `on` into a boolean."""
    return {False: OFF, True: "on"}[name] if isinstance(name, bool) else name


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
    on_app = sorted({e.play for e in out if e.play is not None and playlists[e.play].tidal})
    if len(on_app) > 1:
        raise ConfigError(f"{where}: one TIDAL app plays one playlist (got {', '.join(on_app)})")
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
    # YAML 1.1 reads a bare `off:` (or `on:`) as a boolean key.
    scenes = {_key(n): _scene(_key(n), r, playlists, f"{where}.scenes") for n, r in raw_scenes.items()}
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
    #: The outgoing track of a crossfade, until its fade ends (no third
    #: track opens while it is still open).
    out: Playing | None = None
    #: The next track, opened ahead so its worker prefills it.
    pending: tuple[str, Any] | None = None
    #: Mixer frame before which a failed open / an empty playlist is not retried.
    retry_at: int = 0
    #: Tracks in a row that ended with (almost) no audio (`SHORT_S`).
    short: int = 0
    #: The bed is the TIDAL app's sound, not its files (wave 52).
    live: bool = False
    #: Mixer frame a live bed begins on (the bed before it has faded out).
    live_at: int = 0
    #: Mixer frame the live bed asked the app to play.
    live_since: int = 0


class Director:
    """Plays a `Soundtrack`'s scenes on a mixer (see the module docstring).
    Not thread-safe: the router calls it from its event loop only."""

    def __init__(self, soundtrack: Soundtrack, *, stream_factory: Callable[..., Any] | None = None, rng: random.Random | None = None, live: Any = None) -> None:
        self.st = soundtrack
        self._open_stream = stream_factory or _default_stream
        #: The TIDAL app (`tidal.Tidal`, wave 52); None: its playlists play files.
        self.live = live
        #: Mixer frame to pause the app on (a live bed's fade-out ends).
        self._live_off_at: int | None = None
        self.rng = rng or random.Random()
        self.mixer: Any = None
        self.doc: AudioDoc | None = None
        self.house: Any = None
        #: The scene in force (None: none yet, or stopped — any scene cue,
        #: even the last one, starts it again).
        self.scene: str | None = None
        #: The app is held paused (wave 58).
        self.paused = False
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
            # The old mixer's voices died with its stream: close their
            # files (their workers would otherwise run on), then start over.
            for bed in self.beds.values():
                self._close_pending(bed)
                for v in (bed.cur, bed.nxt, bed.out):
                    if v is not None:
                        v.stream.close(wait=False)
            self.beds = {}
            self.mixer = mixer
            if self.live is not None:
                self.live.open(mixer.rate)
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
        self.pause(False)
        log.info("🎵 soundtrack: scene %s%s", name, f" ({why})" if why else "")
        self.scene = name
        if self.mixer is not None and self.doc is not None:
            self._enter(name)
        return True

    def stop(self, fade_s: float, why: str = "") -> None:
        """Fade every bed out and forget the scene (Stop house sounds, a
        story restart): the next scene cue, even the same one, starts again."""
        self.pause(False)
        if self.beds:
            log.info("🎵 soundtrack: every bed fades out over %gs%s", fade_s, f" ({why})" if why else "")
        if any(bed.live for bed in self.beds.values()):
            self._pause_app_after(fade_s)
        for bed in self.beds.values():
            self._fade_out(bed, fade_s)
        if self.mixer is not None:
            # The backstop: only the director plays on the music bus, so a
            # voice it lost track of still stops with Stop house sounds.
            self.mixer.stop(bus="music", fade_s=fade_s)
        self.beds = {}
        self.scene = None

    def next(self, playlist: str | None = None) -> int:
        """Skip to the next track (a crossfade) on every bed, or only on
        `playlist`'s (wave 40: the mixer's ⏭ per bed). → beds moved on. A
        seamless loop has no next; a playlist with no bed now moves none."""
        if self.mixer is None:
            return 0
        moved = 0
        now = self.mixer.frames
        for bed in self.beds.values():
            if playlist is not None and bed.playlist != playlist:
                continue
            if bed.live:
                self.live.next()
                moved += 1
                continue
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

    def previous(self) -> int:
        """The app's ⏮ (wave 58). A file bed has none. → beds moved."""
        if self.live is None or not any(bed.live for bed in self.beds.values()):
            return 0
        self.live.previous()
        return 1

    def pause(self, on: bool) -> bool:
        """Hold the app, or let it go (wave 58). Only a live bed can pause.
        Letting go restarts the silent cable's clock. → whether it did."""
        live = [bed for bed in self.beds.values() if bed.live]
        if on and (self.live is None or not live):
            return False
        if on == self.paused:
            return True
        self.paused = on
        self.live.pause(on)
        if not on and self.mixer is not None:
            for bed in live:
                bed.live_since = self.mixer.frames
        return True

    def play_playlist(self, name: str, why: str = "") -> bool:
        """A show playlist by hand. → False for one the YAML doesn't name."""
        playlist = self.st.playlists.get(name)
        return playlist is not None and self.set_scene(self._hand_scene(playlist), why or f"playlist {name}")

    def play_tidal(self, uuid: str, why: str = "") -> bool:
        """Any playlist on the app by hand. No fallback: it has no files. →
        False on a router with no app, or for something that is no playlist id."""
        if self.live is None or not TIDAL_ID.match(uuid):
            return False
        playlist = Playlist(name=f"{TIDAL_PREFIX}{uuid[:8]}", shuffle=False, tidal=uuid)
        return self.set_scene(self._hand_scene(playlist), why or f"TIDAL {uuid}")

    def _hand_scene(self, playlist: Playlist) -> str:
        """The scene in force with `playlist` where its music plays."""
        def music(e: Entry) -> bool:
            return e.play is not None and not self.st.playlists[e.play].loop

        base = self.st.scene(self.scene) if self.scene is not None else None
        entries = tuple(Entry(to=e.to, play=playlist.name) if music(e) else e for e in base or ())
        if not any(e.play == playlist.name for e in entries):
            # Nothing was playing: everywhere, under what the scene keeps (a
            # speaker takes the last entry that reaches it).
            entries = (Entry(to=("everywhere",), play=playlist.name), *entries)
        name = f"{HAND_PREFIX}{playlist.name}"
        self.st = replace(self.st, playlists={**self.st.playlists, playlist.name: playlist}, scenes={**self.st.scenes, name: entries})
        return name

    # -- scene changes --------------------------------------------------------------

    def _enter(self, scene: str) -> None:
        assert self.doc is not None
        wanted, notes = scene_beds(self.st, scene, self.doc, self.house)
        for n in notes:
            self._note(n)
        fade = self.st.scene_fade_s
        if self.live is not None and any(self.st.playlists[p].tidal for p in wanted):
            self.live.open(self.mixer.rate)  # a capture that failed: try again
        beds: dict[str, Bed] = {}
        left_app = False
        for playlist, bed in self.beds.items():
            speakers = wanted.get(playlist)
            if speakers is None:
                left_app = left_app or bed.live
                self._fade_out(bed, fade)
                continue
            if speakers == bed.speakers and speaker_layout(self.doc, speakers) == bed.layout:
                beds[playlist] = bed  # untouched: the same playlist on the same speakers
                continue
            beds[playlist] = self._move(bed, speakers)
        for playlist, speakers in wanted.items():
            if playlist not in beds:
                bed = self._bed(playlist, speakers)
                if not self._on_app(playlist):
                    self._begin(bed, fade)
                elif left_app:
                    bed.live = True
                    bed.live_at = self.mixer.frames + self._frames(fade)
                else:
                    bed.live = True
                    self._begin_live(bed, fade)
                beds[playlist] = bed
        self.beds = beds
        if any(bed.live for bed in beds.values()):
            self._live_off_at = None
        elif left_app:
            self._pause_app_after(fade)
        elif self.live is not None and self._live_off_at is None:
            self.live.want(None)  # a router restarted into a scene without the app

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
        if bed.live:
            new.live, new.live_at, new.live_since = True, bed.live_at, bed.live_since
            if bed.cur is not None:
                self.mixer.stop(vid=bed.cur.vid, fade_s=self.st.scene_fade_s)
                new.cur = self._play(new, (bed.cur.path, self.live.reader()), fade_s=self.st.scene_fade_s, looping=True)
            return new
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
        for v in (bed.cur, bed.nxt, bed.out):
            if v is not None and self.mixer is not None:
                self.mixer.stop(vid=v.vid, fade_s=fade_s)
        bed.cur = bed.nxt = bed.out = None
        self._close_pending(bed)

    @staticmethod
    def _close_pending(bed: Bed) -> None:
        if bed.pending is not None:
            try:
                bed.pending[1].close(wait=False)
            except Exception:  # noqa: BLE001
                pass
            bed.pending = None

    # -- the TIDAL app --------------------------------------------------------------

    def _on_app(self, playlist: str) -> bool:
        """Does this bed start on the app? With no fallback it always does:
        waiting for the app beats silence, and the app is put right by itself."""
        p = self.st.playlists[playlist]
        if p.tidal is None or self.live is None:
            return False
        return self.live.reachable() or not p.tracks()

    def _pause_app_after(self, fade_s: float) -> None:
        if self.mixer is None:
            self.live.want(None)
        else:
            self._live_off_at = self.mixer.frames + self._frames(fade_s)

    def _begin_live(self, bed: Bed, fade_s: float, start_at: int | None = None) -> None:
        p = self.st.playlists[bed.playlist]
        self.live.want(p.tidal, shuffle=p.shuffle)
        bed.live_since = self.mixer.frames
        try:
            reader = self.live.reader()
        except Exception as err:  # noqa: BLE001 — no capture: `_tick_live` retries or falls back
            self._note(f"playlist {bed.playlist}: {err}")
            return
        bed.cur = self._play(bed, (f"TIDAL {p.tidal}", reader), fade_s=fade_s, start_at=start_at, looping=True)

    def _tick_live(self, bed: Bed, now: int) -> None:
        mixer = self.mixer
        if bed.cur is not None and not mixer.playing(bed.cur.vid):
            bed.cur = None
        if bed.cur is None and now >= max(bed.live_at, bed.retry_at):
            bed.retry_at = now + self._frames(RETRY_S)
            self._begin_live(bed, LIVE_FADE_S, now + self._frames(LIVE_SWITCH_S))
        if bed.cur is None and now < bed.live_at:
            return  # the bed before it is still fading: the app was not asked yet
        problem = self.live.problem()
        if problem is None and not self.paused and bed.cur is not None and (now - bed.live_since) >= self._frames(SILENT_S) and self.live.silent_s() >= SILENT_S:
            problem = f"no sound on the cable for {SILENT_S:g}s"
        if problem is None:
            return
        if not self.st.playlists[bed.playlist].tracks():
            self._note(f"playlist {bed.playlist}: {problem} — silent, it has no fallback files")
            return
        log.warning("🎵 soundtrack: playlist %s falls back to its files: %s", bed.playlist, problem)
        if bed.cur is not None:
            mixer.stop(vid=bed.cur.vid, fade_s=self.st.crossfade_s)
            bed.cur = None
        bed.live = False
        bed.retry_at = 0
        self.live.want(None)
        self._begin(bed, self.st.crossfade_s)

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
        if self._live_off_at is not None and self.mixer.frames >= self._live_off_at:
            self._live_off_at = None
            self.live.want(None)
        for bed in self.beds.values():
            self._tick(bed, self.mixer.frames)

    def _tick(self, bed: Bed, now: int) -> None:
        if bed.live:
            self._tick_live(bed, now)
            return
        mixer = self.mixer
        if bed.nxt is not None and (bed.nxt.start is None or now >= bed.nxt.start):
            if bed.out is not None and mixer.playing(bed.out.vid):
                # Never drop a voice untracked (it would outlive every stop):
                # one still fading keeps its own, shorter fade.
                mixer.stop(vid=bed.out.vid, fade_s=self.st.crossfade_s)
            bed.out, bed.cur, bed.nxt = bed.cur, bed.nxt, None
        if bed.out is not None and not mixer.playing(bed.out.vid):
            bed.out = None
        cur = bed.cur
        if cur is None:
            # A crossfade already scheduled takes over when it starts: never
            # a third track beside it.
            if bed.nxt is None and now >= bed.retry_at:
                self._begin(bed, self.st.crossfade_s if bed.retry_at else self.st.scene_fade_s)
            return
        if not mixer.playing(cur.vid):
            # It ended before the crossfade was due (an MP3 shorter than its
            # header, a decode error): the next one now.
            bed.cur = None
            played = int(getattr(cur.stream, "played", 0) or 0)
            if played < self._frames(SHORT_S) or getattr(cur.stream, "error", None):
                # It gave (almost) no audio: once every file in the playlist
                # has, wait RETRY_S (as an empty playlist does) rather than
                # reopen it every tick all night.
                bed.short += 1
                if bed.short >= max(1, self._deck(bed.playlist).size()):
                    bed.short = 0
                    bed.retry_at = now + self._frames(RETRY_S)
                    self._note(f"playlist {bed.playlist}: {Path(cur.path).name} played no audio — the bed tries again every {RETRY_S:g}s")
            else:
                bed.short = 0
            # (A crossfade already set starts within LEAD_S: it is let be.)
            if bed.nxt is None and now >= bed.retry_at:
                self._begin(bed, CUT_FADE_S)
            return
        if bed.short and int(getattr(cur.stream, "played", 0) or 0) >= self._frames(SHORT_S):
            bed.short = 0
        if cur.looping or bed.nxt is not None:
            return
        end = cur.end()
        if end is None:
            return  # no length in the header: wait for the decoder's end
        here = cur.here()
        remaining = end - here
        fade = min(self._frames(self.st.crossfade_s), max(0, end) // 3)
        if bed.pending is None and bed.out is None and remaining <= fade + self._frames(PREPARE_S) and now >= bed.retry_at:
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
        speakers, track and position (+ `dur_s`, wave 40, when the stream
        knows its length; never for a seamless loop), the playlists with
        no file, and (wave 40, the mixer's picker) every scene (`off`
        included) and every playlist with its size and loop."""
        rate = self.mixer.rate if self.mixer is not None else 0
        beds = []
        for bed in self.beds.values():
            cur = bed.cur
            row: dict[str, Any] = {
                "playlist": bed.playlist,
                "speakers": list(bed.speakers),
                "track": Path(cur.path).stem if cur is not None else None,
                "pos_s": round(cur.here() / rate, 1) if cur is not None and rate else 0.0,
            }
            end = cur.end() if cur is not None and not cur.looping and rate else None
            if end is not None and end > 0:
                row["dur_s"] = round(end / rate, 1)
            if bed.live:
                row["live"] = True
                now = self.live.now()
                row["track"] = now.get("track") or None
                row["pos_s"] = now.get("pos_s") or 0.0
                if now.get("dur_s"):
                    row["dur_s"] = now["dur_s"]
            beds.append(row)
        lists = {name: p for name, p in self.st.playlists.items() if not name.startswith(TIDAL_PREFIX)}
        scenes = [s for s in self.st.scenes if not s.startswith(HAND_PREFIX)]
        out: dict[str, Any] = {
            "scene": self.scene,
            "beds": beds,
            "missing": self.st.missing(self.live is not None),
            "scenes": [*scenes, *([] if OFF in scenes else [OFF])],
            "playlists": [{"name": name, "tracks": len(p.tracks()), "loop": p.loop} for name, p in lists.items()],
        }
        if self.live is not None:
            out["tidal"] = self.live.report()
        return out


def stereo_of_cue(args: Any) -> dict[str, str] | None:
    """`<cue: music, action: skip>` (wave 58, Trabolta at the stereo): the
    args of a long-form music cue → `{"action": "skip"}`, else None. Never a
    scene: `music,` is not `music_`."""
    parts = [p.strip() for p in str(args or "").split(",")]
    if parts[0] != "music":
        return None
    out = {}
    for part in parts[1:]:
        key, _, value = part.partition(":")
        if key.strip() and value.strip():
            out[key.strip()] = value.strip()
    return out if out.get("action") else None


def scene_of_cue(args: Any) -> str | None:
    """A `cue` directive's args → the scene its first word names
    (`music_act_1` → `act_1`), or None when it is not a music cue."""
    parts = re.split(r"[\s,]+", str(args or "").strip(), maxsplit=1)
    head = parts[0] if parts else ""
    return head[len(CUE_PREFIX) :] if head.startswith(CUE_PREFIX) and len(head) > len(CUE_PREFIX) else None
