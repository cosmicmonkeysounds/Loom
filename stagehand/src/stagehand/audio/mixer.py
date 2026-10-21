"""The router's mixer: what the audio callback runs once per block.

Pure numpy, no device: `Mixer.process(indata, outdata)` fills one block of
the interface's outputs from

  - the **voices** — decoded sounds, each on its own outputs with per-output
    gains, a fade-in, a fade-out when stopped (a story restart fades every
    sound out), and a bus (`sfx`, `announce`, `test`);
  - the **matrix** — the interface's inputs (QLab, mics, the TV) passed
    through to outputs at `audio.json`'s `routes` gains, every change
    smoothed so a re-patch never clicks;
  - the **duck** — sfx voices drop `duck_db` while an announcement plays;
  - the **master** gain, then a per-output peak **limiter** (instant attack,
    smooth release) and a hard clip as the last word.

Everything else talks to the mixer through a command queue drained at the
top of each block, so the asyncio side never touches a live array. A
voice's `done` callback runs on the audio thread: keep it to a
`loop.call_soon_threadsafe`.
"""

from __future__ import annotations

import itertools
import math
import queue
from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np

BUSES = ("sfx", "announce", "test")
#: Voices beyond this drop the oldest sfx voice (a runaway cue can't pile up).
MAX_VOICES = 32


def db_to_lin(db: float) -> float:
    return 0.0 if db <= -120 else float(10 ** (db / 20))


def lin_to_db(lin: float) -> float:
    return -120.0 if lin <= 1e-6 else 20 * math.log10(lin)


@dataclass
class Voice:
    id: int
    samples: np.ndarray  # (frames, channels) float32 at the mixer's rate
    gains: dict[int, float]  # 0-based output → linear gain
    bus: str = "sfx"
    tag: str = ""
    fade_in: int = 0
    done: Callable[[], None] | None = None
    pos: int = 0
    #: Set by `stop`: the frame the fade-out started at and its length.
    stop_at: int | None = None
    stop_len: int = 0
    outs: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.intp))
    src: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.intp))
    gain_vec: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float32))

    def __post_init__(self) -> None:
        if self.samples.ndim == 1:
            self.samples = self.samples[:, None]
        outs = sorted(self.gains)
        self.outs = np.asarray(outs, dtype=np.intp)
        # The source channels repeat across the outputs in channel order
        # (mono → every output; stereo on a pair → L R).
        self.src = np.asarray([i % self.samples.shape[1] for i in range(len(outs))], dtype=np.intp)
        self.gain_vec = np.asarray([self.gains[o] for o in outs], dtype=np.float32)

    @property
    def finished(self) -> bool:
        if self.pos >= len(self.samples):
            return True
        return self.stop_at is not None and self.pos >= self.stop_at + self.stop_len

    def envelope(self, n: int) -> np.ndarray:
        idx = np.arange(self.pos, self.pos + n, dtype=np.float32)
        env = np.ones(n, dtype=np.float32)
        if self.fade_in > 0:
            env *= np.clip(idx / self.fade_in, 0.0, 1.0)
        if self.stop_at is not None:
            length = max(1, self.stop_len)
            env *= np.clip(1.0 - (idx - self.stop_at) / length, 0.0, 1.0)
        return env


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
        duck_db: float = -12.0,
        duck_s: float = 0.3,
        smooth_s: float = 0.05,
    ) -> None:
        self.n_in, self.n_out, self.rate = n_in, n_out, rate
        self.master = db_to_lin(master_db)
        self.limit = db_to_lin(limit_db)
        self.release_frames = max(1, int(release_s * rate))
        self.duck_target = db_to_lin(duck_db)
        self.duck_frames = max(1, int(duck_s * rate))
        self.smooth_frames = max(1, int(smooth_s * rate))
        self.voices: list[Voice] = []
        self.matrix = np.zeros((n_in, n_out), dtype=np.float32)
        self._matrix_target = np.zeros((n_in, n_out), dtype=np.float32)
        self._routes = np.zeros((n_in, n_out), dtype=np.float32)
        self.passthrough = True
        self.duck = 1.0
        self.limiter = np.ones(n_out, dtype=np.float32)
        self._ids = itertools.count(1)
        self._commands: queue.SimpleQueue = queue.SimpleQueue()
        # Meters (read by the health line; reset by `take_meters`).
        self.peak = np.zeros(n_out, dtype=np.float32)
        self.limited_blocks = 0
        self.blocks = 0
        #: Blocks ever processed (never reset: the stall watchdog reads it).
        self.ticks = 0

    # -- the control side (any thread) ---------------------------------------

    def play(
        self,
        samples: np.ndarray,
        gains: dict[int, float],
        *,
        bus: str = "sfx",
        tag: str = "",
        fade_in_s: float = 0.005,
        done: Callable[[], None] | None = None,
    ) -> int:
        """Queue a voice: `gains` maps a 1-based output channel to dB. Returns
        its id (for `stop`). Outputs past the device are dropped."""
        if bus not in BUSES:
            raise ValueError(f"bus {bus!r}: {', '.join(BUSES)}")
        lin = {ch - 1: db_to_lin(db) for ch, db in gains.items() if 1 <= ch <= self.n_out}
        vid = next(self._ids)
        voice = Voice(
            id=vid,
            samples=np.asarray(samples, dtype=np.float32),
            gains=lin,
            bus=bus,
            tag=tag,
            fade_in=int(fade_in_s * self.rate),
            done=done,
        )
        self._commands.put(("play", voice))
        return vid

    def stop(self, *, vid: int | None = None, tag: str | None = None, bus: str | None = None, fade_s: float = 0.5) -> None:
        """Fade out the matching voices (no filter = every voice)."""
        self._commands.put(("stop", (vid, tag, bus, int(fade_s * self.rate))))

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

    def take_meters(self) -> tuple[np.ndarray, int, int]:
        """(peak per output since the last call, blocks limited, blocks)."""
        peak, limited, blocks = self.peak.copy(), self.limited_blocks, self.blocks
        self.peak[:] = 0
        self.limited_blocks = self.blocks = 0
        return peak, limited, blocks

    def active(self, bus: str | None = None) -> int:
        return sum(1 for v in self.voices if bus is None or v.bus == bus)

    # -- the audio thread ----------------------------------------------------

    def _drain(self) -> None:
        while True:
            try:
                kind, arg = self._commands.get_nowait()
            except queue.Empty:
                return
            if kind == "play":
                self.voices.append(arg)
                if len(self.voices) > MAX_VOICES:
                    oldest = next((v for v in self.voices if v.bus == "sfx"), self.voices[0])
                    self.voices.remove(oldest)
                    if oldest.done is not None:
                        oldest.done()
            elif kind == "stop":
                vid, tag, bus, length = arg
                for v in self.voices:
                    if (vid is None or v.id == vid) and (tag is None or v.tag == tag) and (bus is None or v.bus == bus):
                        if v.stop_at is None:
                            v.stop_at, v.stop_len = v.pos, length
            elif kind == "routes":
                self._routes = arg
                self._matrix_target = arg if self.passthrough else np.zeros_like(arg)
            elif kind == "passthrough":
                self.passthrough = arg
                self._matrix_target = self._routes if arg else np.zeros_like(self._routes)
            elif kind == "master":
                self.master = arg

    def process(self, indata: np.ndarray | None, outdata: np.ndarray) -> None:
        """Fill `outdata` (frames × n_out) for one block."""
        self._drain()
        frames = outdata.shape[0]
        mix = np.zeros((frames, self.n_out), dtype=np.float32)
        ramp = np.linspace(0.0, 1.0, frames, endpoint=False, dtype=np.float32)[:, None] if frames else None

        # The matrix: in @ current, crossfaded toward the target over the block.
        if indata is not None and frames and (self.matrix.any() or self._matrix_target.any()):
            n = min(indata.shape[1], self.n_in)
            alpha = min(1.0, frames / self.smooth_frames)
            new = self.matrix + (self._matrix_target - self.matrix) * alpha
            src = indata[:frames, :n].astype(np.float32, copy=False)
            mix += (src @ self.matrix[:n]) * (1.0 - ramp) + (src @ new[:n]) * ramp
            self.matrix = new if alpha < 1.0 else self._matrix_target.copy()

        # The duck follows whether an announcement is playing.
        duck_goal = self.duck_target if any(v.bus == "announce" for v in self.voices) else 1.0
        step = (duck_goal - self.duck) * min(1.0, frames / self.duck_frames)
        duck = self.duck + step * ramp[:, 0] if frames else np.zeros(0, dtype=np.float32)
        self.duck += step

        finished: list[Voice] = []
        for v in self.voices:
            n = min(frames, len(v.samples) - v.pos)
            if n > 0 and len(v.outs):
                chunk = v.samples[v.pos : v.pos + n][:, v.src] * v.gain_vec
                env = v.envelope(n)
                if v.bus == "sfx":
                    env = env * duck[:n]
                mix[:n, v.outs] += chunk * env[:, None]
            v.pos += max(n, 0)
            if v.finished:
                finished.append(v)
        for v in finished:
            self.voices.remove(v)

        if self.master != 1.0:
            mix *= self.master

        # The limiter: per output, instant attack, smooth release.
        if frames:
            peak = np.abs(mix).max(axis=0)
            want = np.where(peak > self.limit, self.limit / np.maximum(peak, 1e-9), 1.0).astype(np.float32)
            rel = min(1.0, frames / self.release_frames)
            released = self.limiter + (1.0 - self.limiter) * rel
            new = np.minimum(want, released).astype(np.float32)
            down = new < self.limiter
            gain = np.where(down, new, self.limiter + (new - self.limiter) * ramp)
            mix *= gain
            if down.any() or (want < 1.0).any():
                self.limited_blocks += 1
            self.limiter = new
            np.clip(mix, -1.0, 1.0, out=mix)
            np.maximum(self.peak, np.abs(mix).max(axis=0), out=self.peak)
        self.blocks += 1
        self.ticks += 1
        outdata[:] = mix
        for v in finished:
            if v.done is not None:
                v.done()
