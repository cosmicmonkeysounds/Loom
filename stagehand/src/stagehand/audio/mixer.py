"""The router's mixer: what the audio callback runs once per block.

Pure numpy, no device: `Mixer.process(indata, outdata)` fills one block of
the interface's outputs from

  - the **voices** — each on its own outputs with per-output gains (the
    cue's gain; the speaker trims are the outputs', below), laid out per
    speaker (a stereo file: L → a pair's first output, R → its second; a
    one-output speaker gets the mono downmix), a fade-in, a live level
    (`level`, ramped), a fade-out when stopped (a story restart fades every
    sound out), and a bus (`sfx`, `music`, `announce`, `test`). A voice's
    source is an in-memory array (a story sound, a tone, an announcement)
    or a `stream.Stream` (wave 38: a music bed or a long track, decoded and
    resampled by its own worker; the callback only copies its buffer);
  - the **matrix** — the interface's inputs (mics, the TV, a line) passed
    through to outputs at `audio.json`'s `routes` gains, every change
    smoothed so a re-patch never clicks;
  - **priority ducking** (wave 38, C2) — every `sfx` and `music` voice is
    ducked per output by the loudest claim on that output: an input's
    sidechain (Trabolta's TV, Clippy's mic: `set_sources`), the
    `announce` source (an announcement playing, or `duck_for`'s hold for
    one another player speaks) and the `takeover` source (a voice played
    `takeover=True`: the beds on its outputs fall silent). The depth per
    source and bus is `set_priority`'s; a voice played `duck=False`, the
    `announce` and `test` buses and the matrix are never ducked;
  - the per-output **trim** (the speakers' `gain`, `set_trim`), ramped
    over 50 ms so a trim edit is heard at once, even on an hour-long bed;
  - the **master** gain, then a per-output peak **limiter** (instant attack,
    smooth release) and a hard clip as the last word.

Everything else talks to the mixer through a command queue drained at the
top of each block, so the control side never touches a live array: arrays
a command carries are built on the caller's thread, and the audio thread
only swaps them in. A voice's `done` callback runs on the audio thread:
keep it to a `loop.call_soon_threadsafe` (or an `Event.set`).

For the soundtrack's crossfades the mixer keeps a frame clock (`frames`,
blocks × block size since it was made, never reset), a voice can be
started on a given frame of that clock (`play(start_at=)`), and each
playing voice's source position is readable from any thread (`pos(vid)`).
"""

from __future__ import annotations

import itertools
import math
import queue
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

import numpy as np

BUSES = ("sfx", "music", "announce", "test")
#: The buses priority ducking acts on (in the depth vectors' order).
DUCKED = ("sfx", "music")
#: Voices beyond this fade out the oldest short sfx voice (a runaway cue
#: can't pile up). A music voice is never the one dropped, and a takeover or
#: streamed track (the show's songs) only when nothing else is left.
MAX_VOICES = 32
#: The fade a voice dropped by the cap gets (a cut would click).
CAP_FADE_S = 0.010
#: A trim change's ramp.
TRIM_S = 0.05

#: The built-in sources (an input role may not take these names).
ANNOUNCE = "announce"
TAKEOVER = "takeover"
RESERVED_SOURCES = (ANNOUNCE, TAKEOVER)
ANNOUNCE_ATTACK_S, ANNOUNCE_RELEASE_S = 0.3, 1.0
TAKEOVER_ATTACK_S, TAKEOVER_RELEASE_S = 0.5, 2.0
#: A takeover silences the beds on its outputs; never configurable.
TAKEOVER_MUSIC_DB = -120.0


def db_to_lin(db: float) -> float:
    return 0.0 if db <= -120 else float(10 ** (db / 20))


def lin_to_db(lin: float) -> float:
    return -120.0 if lin <= 1e-6 else 20 * math.log10(lin)


def source_map(outs: list[int], channels: int, layout: tuple[tuple[int, ...], ...] | None) -> list[int]:
    """The file channel each output plays. Index `channels` is the mono
    downmix ((L + R …) / n). Per speaker: one output → the downmix; two or
    more → the file's channels in the speaker's own output order (L R). A
    mono file plays channel 0 everywhere. An output two speakers share takes
    the first speaker's; one in no speaker gets the downmix."""
    if channels == 1:
        return [0] * len(outs)
    groups = layout if layout is not None else (tuple(outs),)
    pick: dict[int, int] = {}
    for group in groups:
        if len(group) == 1:
            pick.setdefault(group[0], channels)
            continue
        for k, o in enumerate(group):
            pick.setdefault(o, k % channels)
    return [pick.get(o, channels) for o in outs]


def _linear(cur: Any, to: Any, left: int, n: int) -> tuple[np.ndarray, Any, int]:
    """A linear ramp from `cur` to `to` with `left` frames to go, for the
    next `n` frames. → (the n values (n, …), the value after them, frames
    left). Works for scalars and vectors."""
    cur_a = np.asarray(cur, dtype=np.float32)
    to_a = np.asarray(to, dtype=np.float32)
    if left <= 0:
        return np.broadcast_to(to_a, (n, *to_a.shape)), to, 0
    steps = min(n, left)
    frac = (np.arange(1, steps + 1, dtype=np.float32) / left).reshape((steps,) + (1,) * to_a.ndim)
    head = cur_a + (to_a - cur_a) * frac
    if steps < n:
        vals = np.concatenate([head, np.broadcast_to(to_a, (n - steps, *to_a.shape))], axis=0)
    else:
        vals = head
    after = head[-1] if steps < left else to_a
    return vals, (float(after) if np.ndim(after) == 0 else after.astype(np.float32)), left - steps


@dataclass(frozen=True)
class Sidechain:
    """How an input's level opens its source (YAML `audio.sidechain`): a
    block peak over `threshold_db` opens it, it stays open `hold_s` after
    the last such block, and the activity rises to 1 over `attack_s` and
    falls to 0 over `release_s` (linearly). `roles` gives a role its own
    threshold ((role, dB) pairs: Clippy's open lav in the loudest room
    needs a higher one than the TV's clean line)."""

    threshold_db: float = -45.0
    attack_s: float = 0.04
    hold_s: float = 0.8
    release_s: float = 1.2
    roles: tuple[tuple[str, float], ...] = ()

    def threshold_for(self, role: str) -> float:
        return next((db for name, db in self.roles if name == role), self.threshold_db)


@dataclass(frozen=True)
class SidechainSource:
    """One input-driven priority source (`set_sources`): `name` is the
    input's audio.json `role` (the `priority` key), `inputs` its 1-based
    input channels, `reach` the 1-based outputs it ducks. Two entries may
    share a name (two inputs, one role): the source's activity is then the
    louder's."""

    name: str
    inputs: tuple[int, ...]
    reach: tuple[int, ...]


@dataclass
class _Source:
    """A priority source's state (the audio thread's)."""

    name: str
    kind: str  # input | announce | takeover | ghost (a dropped input's release)
    mask: np.ndarray  # bool per output: the reach
    inputs: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.intp))
    attack: int = 1
    release: int = 1
    hold: int = 0
    threshold: float = 0.0
    hold_left: int = 0
    a: float = 0.0


@dataclass
class Meters:
    """`take_meters`: peak per output since the last take, blocks limited /
    processed since then, the inputs' peaks (1-based ch → dBFS since the
    last take; empty when the stream is output-only), every source's
    activity now (0..1) and the streamed voices' underruns (ever)."""

    peak: np.ndarray
    limited: int
    blocks: int
    inputs: dict[int, float]
    sources: dict[str, float]
    underruns: int


@dataclass
class Voice:
    id: int
    samples: np.ndarray | None  # (frames, channels) float32 at the mixer's rate, or None (a stream)
    gains: dict[int, float]  # 0-based output → linear gain
    bus: str = "sfx"
    tag: str = ""
    fade_in: int = 0
    done: Callable[[], None] | None = None
    #: An sfx / music voice that ignores every duck (dance_song, rave, hand_jive, a track).
    duck: bool = True
    #: The `takeover` source: while this voice plays, the music on its outputs is silent.
    takeover: bool = False
    #: 0-based outputs per speaker, in the speaker's own order (None: all the
    #: outputs as one speaker, in channel order).
    layout: tuple[tuple[int, ...], ...] | None = None
    #: A `stream.Stream` instead of `samples` (the mixer closes it when done).
    stream: Any = None
    #: Start on this frame of the mixer's clock (None: the next block).
    start_at: int | None = None
    #: The live level (linear) and its ramp (`Mixer.level`).
    level: float = 1.0
    level_to: float = 1.0
    level_left: int = 0
    #: The block gets a mono downmix column (a one-output speaker, a stereo file).
    mix_mono: bool = False
    started: bool = False
    #: Source frames played (a stream's real frames, never underrun silence).
    pos: int = 0
    #: Frames since the voice started: the clock its fades and ramps run on.
    age: int = 0
    #: Set by `stop`: the age the fade-out started at and its length.
    stop_at: int | None = None
    stop_len: int = 0
    outs: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.intp))
    src: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.intp))
    gain_vec: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float32))
    mask: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=bool))

    def __post_init__(self) -> None:
        if self.samples is not None and self.samples.ndim == 1:
            self.samples = self.samples[:, None]
        channels = self.channels
        outs = sorted(self.gains)
        self.outs = np.asarray(outs, dtype=np.intp)
        self.src = np.asarray(source_map(outs, channels, self.layout), dtype=np.intp)
        self.mix_mono = channels > 1 and bool((self.src == channels).any())
        self.gain_vec = np.asarray([self.gains[o] for o in outs], dtype=np.float32)

    @property
    def channels(self) -> int:
        return int(self.stream.channels) if self.stream is not None else int(self.samples.shape[1])

    @property
    def finished(self) -> bool:
        if self.stop_at is not None and (not self.started or self.age >= self.stop_at + self.stop_len):
            return True
        if self.stream is not None:
            return bool(self.stream.finished)
        return self.pos >= len(self.samples)

    def read(self, n: int) -> tuple[np.ndarray, int]:
        """The next `n` frames of the source → (frames, how many are real)."""
        if self.stream is not None:
            return self.stream.read(n)
        part = self.samples[self.pos : self.pos + n]
        return part, len(part)

    def envelope(self, n: int) -> np.ndarray:
        """Fade-in × stop fade × live level for the next `n` frames."""
        idx = np.arange(self.age, self.age + n, dtype=np.float32)
        env = np.ones(n, dtype=np.float32)
        if self.fade_in > 0 and self.age < self.fade_in:
            env *= np.clip(idx / self.fade_in, 0.0, 1.0)
        if self.stop_at is not None:
            length = max(1, self.stop_len)
            env *= np.clip(1.0 - (idx - self.stop_at) / length, 0.0, 1.0)
        if self.level_left > 0:
            vals, self.level, self.level_left = _linear(self.level, self.level_to, self.level_left, n)
            env *= vals
        elif self.level != 1.0:
            env *= self.level
        return env


def _is_stream(source: Any) -> bool:
    return hasattr(source, "read") and hasattr(source, "ready") and hasattr(source, "channels")


class Mixer:
    def __init__(
        self,
        n_in: int,
        n_out: int,
        rate: int,
        *,
        master_db: float = 0.0,
        limit_db: float = -1.0,
        release_s: float = 0.25,
        smooth_s: float = 0.05,
        sidechain: Sidechain | None = None,
        priority: Mapping[str, Mapping[str, float]] | None = None,
    ) -> None:
        self.n_in, self.n_out, self.rate = n_in, n_out, rate
        self.master = db_to_lin(master_db)
        self.limit = db_to_lin(limit_db)
        self.release_frames = max(1, int(release_s * rate))
        self.smooth_frames = max(1, int(smooth_s * rate))
        self.trim_frames = max(1, int(TRIM_S * rate))
        self.sidechain = sidechain or Sidechain()
        #: Frames left of a timed announcement hold (`duck_for`).
        self.duck_hold = 0
        self.voices: list[Voice] = []
        #: Every voice queued and not yet done, by id (read from any thread).
        self._live: dict[int, Voice] = {}
        self.matrix = np.zeros((n_in, n_out), dtype=np.float32)
        self._matrix_target = np.zeros((n_in, n_out), dtype=np.float32)
        self._routes = np.zeros((n_in, n_out), dtype=np.float32)
        self.passthrough = True
        self.limiter = np.ones(n_out, dtype=np.float32)
        # The trim: per output, linear, ramped toward its target.
        self.trim = np.ones(n_out, dtype=np.float32)
        self._trim_to = np.ones(n_out, dtype=np.float32)
        self._trim_left = 0
        # Priority: depth per source per ducked bus (linear), the sources,
        # and the duck gain each bus ended the last block on, per output.
        self._depth: dict[str, np.ndarray] = {}
        self._inputs: list[_Source] = []
        #: Release-only copies of input sources a new source list dropped (or
        #: whose reach shrank) while they were ducking: the duck releases
        #: over `release_s` instead of snapping off in one block.
        self._ghosts: list[_Source] = []
        everywhere = np.ones(n_out, dtype=bool)
        self._announce = _Source(ANNOUNCE, "announce", everywhere.copy(), attack=max(1, int(ANNOUNCE_ATTACK_S * rate)), release=max(1, int(ANNOUNCE_RELEASE_S * rate)))
        self._takeover = _Source(TAKEOVER, "takeover", np.zeros(n_out, dtype=bool), attack=max(1, int(TAKEOVER_ATTACK_S * rate)), release=max(1, int(TAKEOVER_RELEASE_S * rate)))
        #: Where an external announcement (`duck_for`) is heard: audio.json `announce.to`.
        self._announce_reach = everywhere.copy()
        self._duck = np.ones((len(DUCKED), n_out), dtype=np.float32)
        self._duck_ex = np.ones((len(DUCKED), n_out), dtype=np.float32)
        self._ids = itertools.count(1)
        self._commands: queue.SimpleQueue = queue.SimpleQueue()
        self._ramps: dict[int, np.ndarray] = {}
        # Meters (read by the health line; reset by `take_meters`).
        self.peak = np.zeros(n_out, dtype=np.float32)
        self.in_peak = np.zeros(n_in, dtype=np.float32)
        self.metered = False
        self.limited_blocks = 0
        self.blocks = 0
        #: Blocks ever processed (never reset: the stall watchdog reads it).
        self.ticks = 0
        #: Frames ever processed: the clock `play(start_at=)` and the
        #: soundtrack's crossfades count on.
        self.frames = 0
        #: Blocks a streamed voice ran dry before its end (ever).
        self.underruns = 0
        #: `close`d: the stream that called `process` is gone for good.
        self.closed = False
        self.set_priority(priority or {})
        self._drain()

    # -- the control side (any thread) ---------------------------------------

    def play(
        self,
        source: Any,
        gains: dict[int, float],
        *,
        bus: str = "sfx",
        tag: str = "",
        fade_in_s: float = 0.005,
        done: Callable[[], None] | None = None,
        duck: bool = True,
        takeover: bool = False,
        layout: list[tuple[int, ...]] | tuple[tuple[int, ...], ...] | None = None,
        level_db: float = 0.0,
        start_at: int | None = None,
    ) -> int:
        """Queue a voice. → its id (for `stop`, `level`, `pos`).

        `source` is a (frames, channels) array at the mixer's rate, or a
        `stream.Stream` at the mixer's rate: the mixer then owns it (closes
        it when the voice ends) and starts the voice only once it is
        `ready()` (prefilled), so call `wait_ready` first for a prompt start.

        `gains` maps a 1-based output channel to dB (the cue's gain: the
        speaker trims are `set_trim`'s). Outputs past the device are
        dropped. `duck=False` exempts the voice from every duck (the dance
        tracks). `takeover=True` makes it the `takeover` source: the music
        on its outputs falls silent while it plays (and it is never ducked
        by its own claim). `layout` lists each speaker's 1-based outputs in
        its own order (`source_map`). `level_db` is the starting live level
        (`level` ramps it). `start_at` starts the voice on that frame of
        the mixer clock (`frames`): a gapless crossfade's second track."""
        if bus not in BUSES:
            raise ValueError(f"bus {bus!r}: {', '.join(BUSES)}")
        lin = {ch - 1: db_to_lin(db) for ch, db in gains.items() if 1 <= ch <= self.n_out}
        vid = next(self._ids)
        stream = source if _is_stream(source) else None
        level = db_to_lin(level_db)
        voice = Voice(
            id=vid,
            samples=None if stream is not None else np.asarray(source, dtype=np.float32),
            stream=stream,
            gains=lin,
            bus=bus,
            tag=tag,
            fade_in=int(fade_in_s * self.rate),
            done=done,
            duck=duck,
            takeover=takeover,
            start_at=start_at,
            level=level,
            level_to=level,
            layout=None
            if layout is None
            else tuple(t for t in (tuple(ch - 1 for ch in g if 1 <= ch <= self.n_out) for g in layout) if t),
        )
        mask = np.zeros(self.n_out, dtype=bool)
        mask[voice.outs] = True
        voice.mask = mask
        if self.closed:
            # Nothing will ever process this mixer again: never start a
            # worker that nobody reads (it would hold its file open forever).
            if stream is not None:
                stream.close(wait=False)
            return vid
        self._live[vid] = voice
        self._commands.put(("play", voice))
        return vid

    def stop(self, *, vid: int | None = None, tag: str | None = None, bus: str | None = None, fade_s: float = 0.5, at: int | None = None) -> None:
        """Fade out the matching voices (no filter = every voice). `at` starts
        the fade on that frame of the mixer clock (`frames`) instead of the
        next block: the outgoing half of a crossfade whose incoming voice
        was played `start_at` the same frame. A voice already fading keeps
        whichever fade ends first."""
        self._commands.put(("stop", (vid, tag, bus, int(fade_s * self.rate), at)))

    def level(self, *, vid: int | None = None, tag: str | None = None, db: float, ramp_s: float = 0.0) -> None:
        """Move the live level of a voice (by id) or of every voice with
        `tag` to `db`, linearly over `ramp_s` (from wherever it is now: a
        new ramp takes over a running one). The beds' scene fades."""
        if vid is None and tag is None:
            raise ValueError("level: a vid or a tag")
        self._commands.put(("level", (vid, tag, db_to_lin(db), max(0, int(ramp_s * self.rate)))))

    def close(self) -> None:
        """The audio stream stopped for good (`Engine.close`; call it from
        the control side once the callback no longer runs). Closes the
        stream of every voice, queued or playing: a streamed track (a
        takeover song) is otherwise closed only when `process` retires it,
        and a mixer nobody processes would leave its worker polling and its
        file open (on Windows, a file that can't be replaced). Idempotent;
        `Stream.close` is too, so a bed the soundtrack also closes is fine."""
        self.closed = True
        while True:
            try:
                kind, arg = self._commands.get_nowait()
            except queue.Empty:
                break
            if kind == "play":
                self.voices.append(arg)
        seen: set[int] = set()
        for v in [*self.voices, *list(self._live.values())]:
            if v.stream is not None and id(v.stream) not in seen:
                seen.add(id(v.stream))
                try:
                    v.stream.close(wait=False)
                except Exception:  # noqa: BLE001 — a dead worker must not stop the rest closing
                    pass
        self.voices.clear()
        self._live.clear()

    def pos(self, vid: int) -> int | None:
        """Source frames voice `vid` has played (0 while it waits to
        start); None once it is done (or never was)."""
        v = self._live.get(vid)
        return None if v is None else v.pos

    def playing(self, vid: int) -> bool:
        return vid in self._live

    def duck_for(self, seconds: float) -> None:
        """Hold the `announce` source open for `seconds` (an announcement the
        router does not speak itself: the `alexa` player's), on the
        `set_announce_reach` outputs. A new hold extends, never cuts."""
        self._commands.put(("duck_hold", max(0, int(seconds * self.rate))))

    def set_announce_reach(self, outputs: Iterable[int] | None) -> None:
        """Where `duck_for`'s announcement is heard (1-based outputs;
        None = everywhere). The router's own announcements duck their own
        outputs."""
        mask = np.ones(self.n_out, dtype=bool) if outputs is None else self._mask(outputs)
        self._commands.put(("announce_reach", mask))

    def set_sources(self, sources: Iterable[SidechainSource | Mapping[str, Any]]) -> None:
        """The input-driven sources (replaces them; a source that keeps its
        name keeps its activity). Each: `name` (the role), `inputs` (1-based
        input channels), `reach` (1-based outputs). Inputs past the device
        are dropped; a source with no input left is ignored. The reserved
        names (`announce`, `takeover`) are refused (ValueError)."""
        built: list[_Source] = []
        sc = self.sidechain
        for raw in sources:
            s = raw if isinstance(raw, SidechainSource) else SidechainSource(str(raw["name"]), tuple(raw["inputs"]), tuple(raw["reach"]))
            if s.name in RESERVED_SOURCES:
                raise ValueError(f"source {s.name!r} is reserved")
            ins = np.asarray(sorted({i - 1 for i in s.inputs if 1 <= i <= self.n_in}), dtype=np.intp)
            if not len(ins):
                continue
            src = _Source(s.name, "input", self._mask(s.reach), inputs=ins)
            self._tune(src, sc)
            built.append(src)
        self._commands.put(("sources", built))

    def set_sidechain(self, sidechain: Sidechain) -> None:
        """The input sources' threshold / attack / hold / release."""
        self._commands.put(("sidechain", sidechain))

    def set_priority(self, priority: Mapping[str, Mapping[str, float]]) -> None:
        """`{source: {bus: dB}}` at full activity (YAML `audio.priority`):
        a bus a source does not name is not ducked by it. Only `sfx` and
        `music` duck; `takeover → music` is always −120 dB (silence)."""
        depth: dict[str, np.ndarray] = {}
        for name, buses in priority.items():
            vec = np.ones(len(DUCKED), dtype=np.float32)
            for b, db in (buses or {}).items():
                if b in DUCKED:
                    vec[DUCKED.index(b)] = db_to_lin(float(db))
            depth[str(name)] = vec
        depth.setdefault(TAKEOVER, np.ones(len(DUCKED), dtype=np.float32))
        depth[TAKEOVER] = depth[TAKEOVER].copy()
        depth[TAKEOVER][DUCKED.index("music")] = db_to_lin(TAKEOVER_MUSIC_DB)
        self._commands.put(("priority", depth))

    def set_trim(self, trims: Mapping[int, float]) -> None:
        """Per-output trim: 1-based output → dB (an output not named: 0 dB).
        Applied after the mix (voices and the matrix alike), before the
        master, ramped over 50 ms."""
        vec = np.ones(self.n_out, dtype=np.float32)
        for ch, db in trims.items():
            if 1 <= ch <= self.n_out:
                vec[ch - 1] = db_to_lin(float(db))
        self._commands.put(("trim", vec))

    def set_routes(self, routes: dict[tuple[int, int], float]) -> None:
        """The input→output matrix: (1-based in, 1-based out) → dB. Replaces it."""
        m = np.zeros((self.n_in, self.n_out), dtype=np.float32)
        for (i, o), db in routes.items():
            if 1 <= i <= self.n_in and 1 <= o <= self.n_out:
                m[i - 1, o - 1] = db_to_lin(db)
        self._commands.put(("routes", m))

    def set_passthrough(self, on: bool) -> None:
        self._commands.put(("passthrough", bool(on)))

    def set_master_db(self, db: float) -> None:
        self._commands.put(("master", db_to_lin(db)))

    def activity(self, name: str) -> float:
        """A source's activity now (0..1; 0 for a name with no source)."""
        return self._activities().get(name, 0.0)

    def _activities(self) -> dict[str, float]:
        out = {ANNOUNCE: self._announce.a, TAKEOVER: self._takeover.a}
        for s in [*self._inputs, *self._ghosts]:
            out[s.name] = max(out.get(s.name, 0.0), s.a)
        return out

    def take_meters(self) -> Meters:
        """The meters since the last call (see `Meters`)."""
        peak, limited, blocks = self.peak.copy(), self.limited_blocks, self.blocks
        inputs = {i + 1: round(lin_to_db(float(p)), 1) for i, p in enumerate(self.in_peak)} if self.metered else {}
        self.peak[:] = 0
        self.in_peak[:] = 0
        self.metered = False
        self.limited_blocks = self.blocks = 0
        sources = {k: round(float(v), 3) for k, v in self._activities().items()}
        return Meters(peak, limited, blocks, inputs, sources, self.underruns)

    def active(self, bus: str | None = None) -> int:
        return sum(1 for v in self.voices if bus is None or v.bus == bus)

    def _mask(self, outputs: Iterable[int]) -> np.ndarray:
        mask = np.zeros(self.n_out, dtype=bool)
        for o in outputs:
            if 1 <= o <= self.n_out:
                mask[o - 1] = True
        return mask

    def _tune(self, src: _Source, sc: Sidechain) -> None:
        src.attack = max(1, int(sc.attack_s * self.rate))
        src.release = max(1, int(sc.release_s * self.rate))
        src.hold = max(0, int(sc.hold_s * self.rate))
        src.threshold = db_to_lin(sc.threshold_for(src.name))

    # -- the audio thread ----------------------------------------------------

    def _retire(self, v: Voice) -> None:
        """A voice is done: forget it, close its stream (no wait: the
        worker closes the file itself)."""
        self._live.pop(v.id, None)
        if v.stream is not None:
            v.stream.close(wait=False)

    def _drain(self) -> None:
        while True:
            try:
                kind, arg = self._commands.get_nowait()
            except queue.Empty:
                return
            if kind == "play":
                self.voices.append(arg)
                self._cap()
            elif kind == "stop":
                vid, tag, bus, length, at = arg
                for v in self.voices:
                    if (vid is None or v.id == vid) and (tag is None or v.tag == tag) and (bus is None or v.bus == bus):
                        start = v.age + max(0, at - self.frames) if at is not None and v.started else v.age
                        if v.stop_at is None:
                            v.stop_at, v.stop_len = start, length
                        elif start + length < v.stop_at + v.stop_len:
                            self._refade(v, start, length)
            elif kind == "level":
                vid, tag, lin, length = arg
                for v in self.voices:
                    if (vid is not None and v.id == vid) or (tag is not None and v.tag == tag):
                        v.level_to, v.level_left = lin, length
                        if length == 0:
                            v.level = lin
            elif kind == "routes":
                self._routes = arg
                self._matrix_target = arg if self.passthrough else np.zeros_like(arg)
            elif kind == "passthrough":
                self.passthrough = arg
                self._matrix_target = self._routes if arg else np.zeros_like(self._routes)
            elif kind == "master":
                self.master = arg
            elif kind == "duck_hold":
                self.duck_hold = max(self.duck_hold, arg)
            elif kind == "announce_reach":
                self._announce_reach = arg
            elif kind == "sources":
                old = {s.name: s for s in self._inputs}
                for s in arg:
                    prev = old.get(s.name)
                    if prev is not None:
                        s.a, s.hold_left = prev.a, prev.hold_left
                # A source still ducking that is dropped (its role removed or
                # renamed, its input past the device) or whose reach shrank
                # leaves a ghost on the outputs it no longer covers.
                for prev in self._inputs:
                    if prev.a <= 0.0:
                        continue
                    kept = np.zeros(self.n_out, dtype=bool)
                    for s in arg:
                        if s.name == prev.name:
                            kept |= s.mask
                    left = prev.mask & ~kept
                    if left.any():
                        self._ghosts.append(_Source(prev.name, "ghost", left, release=prev.release, a=prev.a))
                self._inputs = arg
            elif kind == "sidechain":
                self.sidechain = arg
                for s in self._inputs:
                    self._tune(s, arg)
            elif kind == "priority":
                self._depth = arg
            elif kind == "trim":
                if self.ticks == 0:  # a fresh stream starts at its trims: nothing to ramp from
                    self.trim, self._trim_to, self._trim_left = arg.copy(), arg, 0
                else:
                    self._trim_to, self._trim_left = arg, self.trim_frames

    @staticmethod
    def _refade(v: Voice, start: int, length: int) -> None:
        """A shorter fade over one already running: carry on from the gain
        the voice is at now (a jump back to full would click) and reach
        silence `length` frames after `start`."""
        assert v.stop_at is not None
        if v.age <= v.stop_at:  # not fading yet: the new fade simply replaces it
            v.stop_at, v.stop_len = start, length
            return
        g = max(0.0, 1.0 - (v.age - v.stop_at) / max(1, v.stop_len))
        if g <= 0.0:
            return
        span = max(1, int(round(max(1, start + length - v.age) / g)))
        v.stop_at, v.stop_len = int(round(v.age - (1.0 - g) * span)), span

    def _cap(self) -> None:
        """Over MAX_VOICES: fade out the oldest short sfx voice (else the
        oldest short one that isn't music) over CAP_FADE_S. A takeover or a
        streamed voice (a soundtrack track: dance_song, ceremony_bed) is
        nearly always the oldest, and is the worst one to lose: it goes only
        when every other candidate is a track too."""
        live = [v for v in self.voices if v.stop_at is None]
        if len(live) <= MAX_VOICES:
            return

        def short(v: Voice) -> bool:
            return not v.takeover and v.stream is None

        oldest = (
            next((v for v in live if v.bus == "sfx" and short(v)), None)
            or next((v for v in live if v.bus != "music" and short(v)), None)
            or next((v for v in live if v.bus == "sfx"), None)
            or next((v for v in live if v.bus != "music"), None)
        )
        if oldest is not None:
            oldest.stop_at, oldest.stop_len = oldest.age, max(1, int(CAP_FADE_S * self.rate))

    def _ramp(self, frames: int) -> np.ndarray:
        """(frames, 1): 1/frames … 1, the ramp a block-long change follows."""
        r = self._ramps.get(frames)
        if r is None:
            r = (np.arange(1, frames + 1, dtype=np.float32) / frames)[:, None]
            if len(self._ramps) < 8:
                self._ramps[frames] = r
        return r

    @staticmethod
    def _move(src: _Source, on: bool, frames: int) -> None:
        if on:
            src.a = min(1.0, src.a + frames / src.attack)
        else:
            src.a = max(0.0, src.a - frames / src.release)

    def _update_sources(self, frames: int, in_peak: np.ndarray | None) -> None:
        for s in self._inputs:
            if in_peak is not None:
                ins = s.inputs[s.inputs < len(in_peak)]
                loud = bool(len(ins)) and float(in_peak[ins].max()) > s.threshold
            else:
                loud = False
            if loud:
                s.hold_left = s.hold
                on = True
            else:
                on = s.hold_left > 0
                s.hold_left = max(0, s.hold_left - frames)
            self._move(s, on, frames)
        if self._ghosts:
            for g in self._ghosts:
                self._move(g, False, frames)
            self._ghosts = [g for g in self._ghosts if g.a > 0.0]
        # The built-ins: their reach is what is playing now (kept through
        # the release, so a duck never snaps back on the last block).
        ann = np.zeros(self.n_out, dtype=bool)
        take = np.zeros(self.n_out, dtype=bool)
        any_ann = any_take = False
        for v in self.voices:
            if not v.started or v.stop_at is not None and v.age >= v.stop_at + v.stop_len:
                continue
            if v.bus == "announce":
                ann |= v.mask
                any_ann = True
            if v.takeover:
                take |= v.mask
                any_take = True
        if self.duck_hold > 0:
            ann |= self._announce_reach
            any_ann = True
        self.duck_hold = max(0, self.duck_hold - frames)
        if any_ann:
            self._announce.mask = ann
        if any_take:
            self._takeover.mask = take
        self._move(self._announce, any_ann, frames)
        self._move(self._takeover, any_take, frames)

    def _duck_targets(self, exempt_takeover: bool) -> np.ndarray:
        """(len(DUCKED), n_out): min over the sources reaching each output
        of 1 − a·(1 − depth)."""
        g = np.ones((len(DUCKED), self.n_out), dtype=np.float32)
        for s in (*self._inputs, *self._ghosts, self._announce, self._takeover):
            if s.a <= 0.0 or (exempt_takeover and s.kind == "takeover"):
                continue
            depth = self._depth.get(s.name)
            if depth is None:
                continue
            f = 1.0 - s.a * (1.0 - depth)  # per bus
            if (f >= 1.0).all():
                continue
            g[:, s.mask] = np.minimum(g[:, s.mask], f[:, None])
        return g

    def _duck_block(self, frames: int, ramp: np.ndarray, exempt: bool) -> np.ndarray | None:
        """(len(DUCKED), frames, n_out) duck gains ramped across the block
        from where the last ended, or None when nothing ducks."""
        prev = self._duck_ex if exempt else self._duck
        new = self._duck_targets(exempt)
        if exempt:
            self._duck_ex = new
        else:
            self._duck = new
        if (prev >= 1.0).all() and (new >= 1.0).all():
            return None
        return prev[:, None, :] + (new - prev)[:, None, :] * ramp[None, :, :]

    def process(self, indata: np.ndarray | None, outdata: np.ndarray) -> None:
        """Fill `outdata` (frames × n_out) for one block."""
        self._drain()
        frames = outdata.shape[0]
        if frames == 0:
            return
        mix = np.zeros((frames, self.n_out), dtype=np.float32)
        ramp = self._ramp(frames)

        # The inputs: metered whenever the stream is duplex.
        in_peak = None
        if indata is not None:
            n = min(indata.shape[1], self.n_in)
            src = indata[:frames, :n].astype(np.float32, copy=False)
            if n:
                in_peak = np.abs(src).max(axis=0)
                np.maximum(self.in_peak[:n], in_peak, out=self.in_peak[:n])
                self.metered = True
            # The matrix: in @ current, crossfaded toward the target over the block.
            if self.matrix.any() or self._matrix_target.any():
                alpha = min(1.0, frames / self.smooth_frames)
                new = self.matrix + (self._matrix_target - self.matrix) * alpha
                lin = ramp - 1.0 / frames  # 0 … (frames − 1) / frames, as before
                mix += (src @ self.matrix[:n]) * (1.0 - lin) + (src @ new[:n]) * lin
                self.matrix = new if alpha < 1.0 else self._matrix_target.copy()

        # Priority: the sources follow this block's inputs and voices; the
        # duck gains ramp from the last block's to this one's.
        self._update_sources(frames, in_peak)
        duck = self._duck_block(frames, ramp, exempt=False)
        duck_ex: np.ndarray | None = None
        if any(v.takeover and v.duck for v in self.voices):
            duck_ex = self._duck_block(frames, ramp, exempt=True)
        else:
            self._duck_ex = self._duck.copy()

        finished: list[Voice] = []
        for v in self.voices:
            off = 0
            if not v.started:
                if v.stop_at is not None:
                    finished.append(v)
                    continue
                if v.start_at is not None:
                    off = v.start_at - self.frames
                    if off >= frames:
                        continue
                    off = max(0, off)
                if v.stream is not None and not v.stream.ready():
                    continue
                v.started = True
            n = frames - off
            under = v.stream.underruns if v.stream is not None else 0
            part, real = v.read(n)
            if v.stream is not None:
                self.underruns += v.stream.underruns - under
            if real > 0 and len(v.outs):
                part = part[:real]
                if v.mix_mono:
                    part = np.concatenate([part, part.mean(axis=1, keepdims=True)], axis=1)
                chunk = part[:, v.src] * v.gain_vec
                env = v.envelope(real)
                chunk *= env[:, None]
                if v.duck and v.bus in DUCKED:
                    d = duck_ex if v.takeover else duck
                    if d is not None:
                        chunk *= d[DUCKED.index(v.bus), off : off + real][:, v.outs]
                mix[off : off + real, v.outs] += chunk
            elif real > 0:
                v.envelope(real)
            v.pos += real
            # The fades run on the block clock: a starved stream still fades.
            if real < n and v.level_left > 0:
                _, v.level, v.level_left = _linear(v.level, v.level_to, v.level_left, n - real)
            v.age += n
            if v.finished:
                finished.append(v)
        for v in finished:
            self.voices.remove(v)
            self._retire(v)

        # The trim (per output, ramped), then the master.
        if self._trim_left > 0:
            vals, self.trim, self._trim_left = _linear(self.trim, self._trim_to, self._trim_left, frames)
            mix *= vals
        elif not (self.trim == 1.0).all():
            mix *= self.trim
        if self.master != 1.0:
            mix *= self.master

        # The limiter: per output, instant attack, smooth release.
        peak = np.abs(mix).max(axis=0)
        want = np.where(peak > self.limit, self.limit / np.maximum(peak, 1e-9), 1.0).astype(np.float32)
        rel = min(1.0, frames / self.release_frames)
        released = self.limiter + (1.0 - self.limiter) * rel
        new = np.minimum(want, released).astype(np.float32)
        down = new < self.limiter
        lin = ramp - 1.0 / frames
        gain = np.where(down, new, self.limiter + (new - self.limiter) * lin)
        mix *= gain
        if down.any() or (want < 1.0).any():
            self.limited_blocks += 1
        self.limiter = new
        np.clip(mix, -1.0, 1.0, out=mix)
        np.maximum(self.peak, np.abs(mix).max(axis=0), out=self.peak)
        self.blocks += 1
        self.ticks += 1
        self.frames += frames
        outdata[:] = mix
        for v in finished:
            if v.done is not None:
                v.done()
