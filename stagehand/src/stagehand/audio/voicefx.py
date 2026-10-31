"""His voice torn up in real time (wave 56, `../docs/loom-w56-contract.md`).

The TV speaks with `speechSynthesis`, which hands a page no waveform: the
terminal can only choose what to say and how (`terminal/src/speech/glitch.ts`).
But on the Desktop Chrome's sound comes back to this router as input 3 (role
`trabolta`, `tap.py`), so here his voice is plain samples, and it can be
broken mid-word, whatever the terminal planned. This is an insert on that one
input: `Engine._duplex_cb` hands it the channel after the tap and before the
mixer, so the matrix, the meters and the sidechain all see the broken voice.

**What drives it** is the server's `voiceFx` block (`core/src/voice-fx.ts`),
read off the screen state once a second like the TV's own poll, so a spike
lands with the picture (`set_level`, `spike`, `end_spike`). It never decides
how broken he is; it only makes it heard.

**The sound.** While he speaks, flavours fire at random, more often the higher
the level, and a spike makes them nearly constant. A **source** replaces the
voice with something read from the ring (a stuck grain, a tape dragging to a
stop, a pitch shift, a scramble); **colours** treat what comes out of it in
series (bit crush, ring modulation, packet-loss gating). The `loop` flavour
feeds a feedback echo, whose tail outlives the event. Under them the level
itself frays him all the time: a little crush, and wow on the delay line.

**The callback's rules** (`stagehand/CLAUDE.md`): it never waits and never
touches a file or a socket. Control writes one attribute at a time (a float, a
tuple swapped whole), so there is no lock. Arrays are allocated only when an
event starts. At level 0 with nothing ringing a block costs one ring write and
the sound is untouched, sample for sample.

**It can never take his voice away.** On any exception `Engine` puts the
block back as it came and takes the insert out of the path, and `process`
trips itself off (`tripped`, dry from then on) if it runs over its share of
the block for long. Both are in the health line. An insert that fails leaves
him speaking plainly.

`python -m stagehand.audio.voicefx in.wav outdir` renders every flavour, for
auditioning with no interface.
"""

from __future__ import annotations

import logging
import math
import random
import time
from collections.abc import Callable, Sequence
from typing import Protocol

import numpy as np

log = logging.getLogger("stagehand.audio")

#: The flavours (`core/src/voice-fx.ts` `VOICE_FLAVOURS`, pinned by a test).
FLAVOURS = ("skip", "stall", "overclock", "driver", "packet", "dump", "safe", "loop", "kernel")
#: `(level it starts to appear at, how often it comes)`: the terminal's
#: `FLAVOUR_FROM` (pinned by a test), so one night sounds like one night.
FLAVOUR_FROM = {
    "skip": (0.0, 3),
    "packet": (0.1, 2),
    "stall": (0.2, 2),
    "loop": (0.3, 2),
    "overclock": (0.35, 2),
    "safe": (0.5, 1),
    "driver": (0.55, 2),
    "dump": (0.6, 1),
    "kernel": (0.7, 1),
}
#: The flavours that take over the voice: one at a time.
SOURCES = frozenset(("skip", "stall", "overclock", "driver", "kernel"))
#: The input's role in audio.json.
ROLE = "trabolta"

#: Frames of his voice kept for reading back (a power of two; 2.7 s at 48 kHz).
RING = 1 << 17
#: The two-tap pitch shifter's window.
PITCH_WINDOW_S = 0.045
#: A grain's fade at each end, so a repeat never clicks.
EDGE_S = 0.002
#: Peak above this means he is speaking.
VOICED = 0.01
#: How long after his last sound he still counts as speaking.
VOICED_HOLD_S = 0.3
#: Events a second of his speech at spike strength 1.
SPIKE_RATE = 3.0
#: The level follows `set_level` with this time constant.
LEVEL_SMOOTH_S = 1.0
#: The fraction of a block `process` may spend, and how many blocks over it
#: (net of the blocks under it) trip it off.
BUDGET = 0.5
TRIP_BLOCKS = 150
#: The continuous fray starts here.
FRAY_AT = 0.25
#: The wow on the delay line starts here.
WOW_AT = 0.4


def event_rate(level: float) -> float:
    """Events a second of his speech at `level`."""
    return level * level * 1.4 + level * 0.1


class Source(Protocol):
    done: bool

    def render(self, fx: VoiceFx, n: int) -> np.ndarray: ...


class Colour(Protocol):
    done: bool
    #: Its share of the sound (ramped by `process`, so nothing clicks).
    mix: float

    def render(self, fx: VoiceFx, x: np.ndarray) -> np.ndarray: ...


def _edged(buf: np.ndarray, edge: int) -> np.ndarray:
    """`buf` with a short fade at each end (a copy, or `buf` when it is too short)."""
    e = min(edge, len(buf) // 2)
    if e < 1:
        return buf
    out = buf.copy()
    ramp = np.linspace(0.0, 1.0, e, dtype=np.float32)
    out[:e] *= ramp
    out[-e:] *= ramp[::-1]
    return out


class _Grains:
    """Play one grain after another; `next_grain` says what comes next."""

    done = False

    def __init__(self, fx: VoiceFx) -> None:
        self.buf: np.ndarray = np.zeros(0, dtype=np.float32)
        self.pos = 0

    def next_grain(self, fx: VoiceFx) -> np.ndarray | None:
        raise NotImplementedError

    def render(self, fx: VoiceFx, n: int) -> np.ndarray:
        out = np.zeros(n, dtype=np.float32)
        filled = 0
        while filled < n:
            if self.pos >= len(self.buf):
                grain = self.next_grain(fx)
                if grain is None or len(grain) == 0:
                    self.done = True
                    break
                self.buf, self.pos = grain, 0
            take = min(n - filled, len(self.buf) - self.pos)
            out[filled : filled + take] = self.buf[self.pos : self.pos + take]
            filled += take
            self.pos += take
        return out


class Repeat(_Grains):
    """💿 The last moment of his voice, stuck. With `shrink` < 1 each repeat is
    shorter than the last: a stutter that winds up into a buzz."""

    def __init__(self, fx: VoiceFx, grain_s: float, repeats: int, shrink: float = 1.0) -> None:
        super().__init__(fx)
        self.base = fx.last(max(32, int(grain_s * fx.rate)))
        self.left = repeats
        self.shrink = shrink
        self.size = float(len(self.base))

    def next_grain(self, fx: VoiceFx) -> np.ndarray | None:
        if self.left <= 0:
            return None
        self.left -= 1
        length = max(64, int(self.size))
        self.size *= self.shrink
        return _edged(self.base[:length], fx.edge)


class Scramble(_Grains):
    """A major glitch's babble: grains of the last half second, out of order."""

    def __init__(self, fx: VoiceFx, dur_s: float) -> None:
        super().__init__(fx)
        self.left = int(dur_s * fx.rate)
        self.reach = int(0.45 * fx.rate)

    def next_grain(self, fx: VoiceFx) -> np.ndarray | None:
        if self.left <= 0:
            return None
        g = int(fx.rng.uniform(0.015, 0.045) * fx.rate)
        self.left -= g
        return _edged(fx.slice(fx.rng.randint(g, self.reach), g), fx.edge)


class Tape(_Grains):
    """⏳ A tape dragging to a stop: the read head slows, the pitch sinks."""

    def __init__(self, fx: VoiceFx, dur_s: float, low: float) -> None:
        self.t = 0
        self.total = max(1, int(dur_s * fx.rate))
        self.low = low
        # From the start of the block in hand: the read head may never pass
        # what has been written.
        self.head = float(fx.w - fx.block - 1)
        self.done = False

    def render(self, fx: VoiceFx, n: int) -> np.ndarray:
        u = (self.t + fx.index(n)) / self.total
        speed = 1.0 - (1.0 - self.low) * np.minimum(1.0, u) ** 2
        heads = self.head + np.cumsum(speed)
        self.head = float(heads[-1])
        self.t += n
        self.done = self.t >= self.total
        return fx.read(heads)


class Pitch:
    """🔥 👹 🎭 The two-tap pitch shifter: two read heads sliding through a
    short window, each faded out as it wraps. `ratios` are the ratios it steps
    through over the event (a glide when they are close, a hop when not)."""

    def __init__(self, fx: VoiceFx, dur_s: float, ratios: Sequence[float]) -> None:
        self.t = 0
        self.total = max(1, int(dur_s * fx.rate))
        self.ratios = tuple(ratios)
        self.window = PITCH_WINDOW_S * fx.rate
        self.phase = 0.0
        self.done = False

    def ratio(self) -> float:
        u = min(0.999, self.t / self.total) * len(self.ratios)
        return self.ratios[int(u)]

    def render(self, fx: VoiceFx, n: int) -> np.ndarray:
        r = self.ratio()
        i = fx.index(n)
        # The delay grows at 1 − r: signed, so a hop across 1 never jumps.
        step = (1.0 - r) / self.window
        ph = (self.phase + step * i) % 1.0
        self.phase = float((self.phase + step * n) % 1.0)
        ph2 = (ph + 0.5) % 1.0
        now = float(fx.w - n) + i
        a = fx.read(now - ph * self.window - 1.0)
        b = fx.read(now - ph2 * self.window - 1.0)
        g = np.sin(np.pi * ph, dtype=np.float32) ** 2
        self.t += n
        self.done = self.t >= self.total
        return a * g + b * (1.0 - g)


class Gate:
    """📉 Packet loss: he drops out, in holes as long as a syllable."""

    def __init__(self, fx: VoiceFx, dur_s: float, severity: float) -> None:
        self.left = int(dur_s * fx.rate)
        self.open = False
        self.next_flip = 0
        self.gain = 1.0
        self.severity = severity
        self.done = False
        self.mix = 0.0

    def render(self, fx: VoiceFx, x: np.ndarray) -> np.ndarray:
        n = len(x)
        self.next_flip -= n
        if self.next_flip <= 0:
            self.open = not self.open
            ms = fx.rng.uniform(30, 180) if self.open else fx.rng.uniform(15, 40 + 90 * self.severity)
            self.next_flip = int(ms / 1000 * fx.rate)
        to = 1.0 if self.open or self.left <= 0 else 0.0
        ramp = np.linspace(self.gain, to, n, dtype=np.float32)
        self.gain = to
        self.left -= n
        self.done = self.left <= 0 and to == 1.0
        return x * ramp


class Crush:
    """🔢 Sample-and-hold and too few bits: a voice in an old file format."""

    def __init__(self, fx: VoiceFx, dur_s: float, hold: int, bits: int, wet: float) -> None:
        self.left = int(dur_s * fx.rate)
        self.hold = max(1, hold)
        self.q = float(2 ** (max(1, bits) - 1))
        self.wet = wet
        self.off = 0
        self.done = False
        self.mix = 0.0

    def render(self, fx: VoiceFx, x: np.ndarray) -> np.ndarray:
        n = len(x)
        out = crush(x, self.hold, self.q, self.off, fx.ints(n))
        self.off = (self.off + n) % self.hold
        self.left -= n
        self.done = self.left <= 0
        return x + (out - x) * self.wet


def crush(x: np.ndarray, hold: int, q: float, off: int, i: np.ndarray) -> np.ndarray:
    n = len(x)
    held = x[np.maximum(((off + i[:n]) // hold) * hold - off, 0)]
    return np.round(held * q) / q


class Ring:
    """🧊 Ring modulation: the same words with nobody home."""

    def __init__(self, fx: VoiceFx, dur_s: float, hz: float, wet: float) -> None:
        self.left = int(dur_s * fx.rate)
        self.step = 2.0 * math.pi * hz / fx.rate
        self.wet = wet
        self.phase = 0.0
        self.done = False
        self.mix = 0.0

    def render(self, fx: VoiceFx, x: np.ndarray) -> np.ndarray:
        n = len(x)
        carrier = np.sin(self.phase + self.step * fx.index(n)).astype(np.float32)
        self.phase = (self.phase + self.step * n) % (2.0 * math.pi)
        self.left -= n
        self.done = self.left <= 0
        return x + (x * carrier - x) * self.wet


class Echo:
    """🔁 A feedback delay. `open` feeds it for a while; what is already in it
    rings on after the send closes, until it has died away."""

    SIZE = 1 << 15

    def __init__(self, rate: int) -> None:
        self.rate = rate
        self.buf = np.zeros(self.SIZE, dtype=np.float32)
        self.mask = self.SIZE - 1
        self.w = 0
        self.delay = int(0.15 * rate)
        self.feedback = 0.6
        self.send_left = 0
        #: Frames until what was sent comes back: nothing to hear is not yet silence.
        self.flight = 0
        self.level = 0.0

    def open(self, dur_s: float, delay_s: float, feedback: float) -> None:
        self.delay = min(self.SIZE - 1, int(delay_s * self.rate))
        self.feedback = min(0.8, feedback)
        self.send_left = int(dur_s * self.rate)

    @property
    def ringing(self) -> bool:
        return self.send_left > 0 or self.flight > 0 or self.level > 1e-4

    def process(self, x: np.ndarray, i: np.ndarray) -> np.ndarray:
        n = len(x)
        if not self.ringing:
            return x
        tap = self.buf[(self.w - self.delay + i[:n]) & self.mask]
        send = 1.0 if self.send_left > 0 else 0.0
        self.buf[(self.w + i[:n]) & self.mask] = x * send + tap * self.feedback
        self.w = (self.w + n) & self.mask
        self.flight = self.delay + n if self.send_left > 0 else max(0, self.flight - n)
        self.send_left = max(0, self.send_left - n)
        self.level = float(np.abs(tap).max())
        return x + tap * 0.8


class VoiceFx:
    def __init__(self, rate: int, *, seed: int | None = None, clock: Callable[[], float] = time.perf_counter) -> None:
        self.rate = rate
        self.rng = random.Random(seed)
        self.clock = clock
        self.ring = np.zeros(RING, dtype=np.float32)
        self.mask = RING - 1
        #: Frames ever written.
        self.w = 0
        #: The block in hand (0 between blocks): `_write` has already counted it.
        self.block = 0
        self.edge = int(EDGE_S * rate)
        self._i = np.arange(8192, dtype=np.int64)
        self._f = self._i.astype(np.float64)
        #: The level as the control side last set it, and as the sound follows it.
        self.want = 0.0
        self.now = 0.0
        #: `(strength, frames, flavours)`: control writes it, the callback takes it.
        self._spike: tuple[float, int, tuple[str, ...]] | None = None
        self.spike_left = 0
        self.spike_strength = 0.0
        self.spike_pool: tuple[str, ...] = ()
        self._spike_new = False
        self.source: Source | None = None
        self.colours: list[Colour] = []
        self.echo = Echo(rate)
        #: The source's share of the output (ramped, so nothing clicks).
        self.wet = 0.0
        self.voiced = 0
        self.wow_phase = 0.0
        self.wow_hz = 4.0
        self.fired = dict.fromkeys(FLAVOURS, 0)
        self.slow = 0
        self.tripped = False

    # -- the control side ------------------------------------------------------

    def set_level(self, level: float) -> None:
        self.want = min(1.0, max(0.0, float(level)))

    def spike(self, strength: float, ms: float, flavours: Sequence[str]) -> None:
        """Stand over the level for `ms`: flavours from `flavours`, at once."""
        pool = tuple(f for f in flavours if f in FLAVOUR_FROM)
        if pool and ms > 0:
            self._spike = (min(1.0, max(0.0, float(strength))), int(ms / 1000 * self.rate), pool)

    def end_spike(self) -> None:
        """The server stopped naming one (a director's Clean, a story restart)."""
        self._spike = (0.0, 0, ())

    def clear(self) -> None:
        """Back to clean."""
        self.set_level(0.0)
        self.end_spike()

    def stats(self) -> str:
        """For the health line."""
        fired = sum(self.fired.values())
        state = "TRIPPED, he is speaking dry" if self.tripped else f"level {self.now:.2f}"
        return f"{state}, {fired} glitches"

    # -- reading his voice -----------------------------------------------------

    def index(self, n: int) -> np.ndarray:
        if n > len(self._i):
            self._i = np.arange(n * 2, dtype=np.int64)
            self._f = self._i.astype(np.float64)
        return self._f[:n]

    def ints(self, n: int) -> np.ndarray:
        self.index(n)
        return self._i[:n]

    def last(self, n: int) -> np.ndarray:
        """His last `n` frames (a copy)."""
        return self.ring[(self.w - n + np.arange(n)) & self.mask].copy()

    def slice(self, back: int, n: int) -> np.ndarray:
        """`n` frames from `back` frames ago (a copy)."""
        return self.ring[(self.w - back + np.arange(n)) & self.mask].copy()

    def read(self, heads: np.ndarray) -> np.ndarray:
        """His voice at fractional positions (frames ever written)."""
        i = np.floor(heads).astype(np.int64)
        frac = (heads - i).astype(np.float32)
        a = self.ring[i & self.mask]
        b = self.ring[(i + 1) & self.mask]
        return a + (b - a) * frac

    # -- the flavours ----------------------------------------------------------

    def start(self, flavour: str, s: float) -> None:
        """Fire one flavour at severity `s` (0..1). One that needs the source
        while another holds it waits its turn: cutting in would click."""
        if flavour in SOURCES and self.source is not None:
            return
        r = self.rng
        self.fired[flavour] += 1
        if flavour == "skip":
            self.source = Repeat(self, r.uniform(0.03, 0.12), 3 + int(6 * s), r.choice((1.0, 1.0, 0.82)))
        elif flavour == "stall":
            self.source = Tape(self, 0.35 + 0.8 * s, 0.6 - 0.45 * s)
        elif flavour == "overclock":
            dur = 0.5 + 0.9 * s
            top = 1.35 + 0.6 * s
            self.source = Pitch(self, dur, [1.0 + (top - 1.0) * k / 7 for k in range(1, 8)])
            self.colours.append(Crush(self, dur, 2, 9, 0.5))
        elif flavour == "driver":
            hops = [r.choice((0.62, 0.75, 1.3, 1.5)) for _ in range(3 + int(5 * s))]
            self.source = Pitch(self, 0.18 * len(hops), hops)
        elif flavour == "packet":
            self.colours.append(Gate(self, 0.4 + 1.2 * s, s))
        elif flavour == "dump":
            dur = 0.3 + 0.8 * s
            self.colours.append(Crush(self, dur, r.randint(4, 9), r.randint(3, 5), 0.9))
            self.colours.append(Ring(self, dur, r.uniform(220, 900), 0.5))
        elif flavour == "safe":
            self.colours.append(Ring(self, 0.6 + 1.2 * s, r.uniform(60, 90), 0.85))
        elif flavour == "loop":
            self.echo.open(0.3 + 0.8 * s, r.uniform(0.09, 0.24), 0.55 + 0.25 * s)
        elif flavour == "kernel":
            dur = 0.6 + s
            self.source = Pitch(self, dur, [r.uniform(0.5, 0.68)])
            self.colours.append(Ring(self, dur, r.uniform(30, 45), 0.35))

    def _draw(self, level: float) -> str:
        open_ = [f for f in FLAVOURS if FLAVOUR_FROM[f][0] <= level]
        return self.rng.choices(open_, [FLAVOUR_FROM[f][1] for f in open_])[0]

    def _schedule(self, n: int) -> None:
        if self.source is not None and len(self.colours) >= 2:
            return
        spiking = self.spike_left > 0
        if spiking and self._spike_new:
            self._spike_new = False
            self.start(self.rng.choice(self.spike_pool), self.spike_strength)
            return
        if self.voiced <= 0:
            return
        rate = SPIKE_RATE * self.spike_strength if spiking else event_rate(self.now)
        if self.rng.random() >= rate * n / self.rate:
            return
        if spiking:
            if self.source is None and self.rng.random() < 0.25:
                self.source = Scramble(self, self.rng.uniform(0.2, 0.6))
            else:
                self.start(self.rng.choice(self.spike_pool), self.spike_strength)
        else:
            self.start(self._draw(self.now), min(1.0, self.now * self.rng.uniform(0.7, 1.3)))

    # -- the callback ----------------------------------------------------------

    def _take_spike(self) -> None:
        cmd, self._spike = self._spike, None
        if cmd is not None:
            self.spike_strength, self.spike_left, self.spike_pool = cmd
            self._spike_new = self.spike_left > 0

    def _write(self, col: np.ndarray) -> None:
        n = len(col)
        start = self.w & self.mask
        first = min(n, RING - start)
        self.ring[start : start + first] = col[:first]
        if first < n:
            self.ring[: n - first] = col[first:]
        self.w += n

    def _wow(self, x: np.ndarray, n: int, level: float) -> np.ndarray:
        """The delay line wandering: from nothing at `WOW_AT`, so it fades in."""
        depth = (level - WOW_AT) * 0.0075 * self.rate
        i = self.index(n)
        ph = self.wow_phase + 2.0 * math.pi * self.wow_hz / self.rate * i
        self.wow_phase = float(ph[-1]) % (2.0 * math.pi)
        back = depth * (0.5 + 0.5 * np.sin(ph))
        return self.read(float(self.w - n) + i - back - 1.0)

    def _fray(self, x: np.ndarray, level: float) -> np.ndarray:
        """The level itself: a voice losing its bits."""
        wet = (level - FRAY_AT) * 0.45
        out = crush(x, 2 + int(level * 3), float(2 ** (11 - int(5 * level))), 0, self._i)
        return x + (out - x) * wet

    @staticmethod
    def _blend(a: np.ndarray, b: np.ndarray, frm: float, to: float) -> np.ndarray:
        """`a` turning into `b` across the block, from share `frm` to `to`."""
        if frm == 1.0 and to == 1.0:
            return b
        return a + (b - a) * np.linspace(frm, to, len(a), dtype=np.float32)

    def process(self, col: np.ndarray) -> None:
        """Break one block of his voice in place. At rest it only remembers."""
        if self.tripped:
            return
        began = self.clock()
        n = len(col)
        self._take_spike()
        self._write(col)
        peak = float(np.abs(col).max()) if n else 0.0
        self.voiced = int(VOICED_HOLD_S * self.rate) if peak > VOICED else max(0, self.voiced - n)
        self.now += (self.want - self.now) * min(1.0, n / (LEVEL_SMOOTH_S * self.rate))
        if self.want == 0.0 and self.now < 0.002:
            self.now = 0.0
        level = self.now
        if self.spike_left > 0:
            self.spike_left -= n
        if level <= 0.0 and self.spike_left <= 0 and self.source is None and not self.colours and not self.echo.ringing:
            return
        self.index(n)
        self.block = n
        self._schedule(n)
        self.block = 0

        x = self._wow(col, n, level) if level > WOW_AT else col.copy()
        source = self.source
        if source is not None:
            # A source fades out through the block it ends on: its last
            # sound, not a jump back to the voice.
            torn = source.render(self, n)
            x = self._blend(x, torn, self.wet, wet := 0.0 if source.done else 1.0)
            self.wet = wet
            if source.done:
                self.source = None
        if self.colours:
            for c in self.colours:
                y = c.render(self, x)
                x = self._blend(x, y, c.mix, to := 0.0 if c.done else 1.0)
                c.mix = to
            self.colours = [c for c in self.colours if not c.done]
        if level > FRAY_AT:
            x = self._fray(x, level)
        x = self.echo.process(x, self._i)
        col[:] = np.clip(x, -1.0, 1.0)

        spent = self.clock() - began
        self.slow = self.slow + 1 if spent > BUDGET * n / self.rate else max(0, self.slow - 1)
        if self.slow >= TRIP_BLOCKS:
            self.tripped = True


def render(voice: np.ndarray, rate: int, *, level: float = 0.0, flavour: str | None = None, spike_ms: float = 0.0, blocksize: int = 512, seed: int = 56) -> np.ndarray:
    """`voice` (mono float32) as the router would play it."""
    fx = VoiceFx(rate, seed=seed)
    fx.want = fx.now = level
    if flavour is not None:
        fx.spike(1.0, spike_ms or 1000.0 * len(voice) / rate, (flavour,))
    out = voice.astype(np.float32).copy()
    for at in range(0, len(out), blocksize):
        fx.process(out[at : at + blocksize])
    return out


def main(argv: Sequence[str] | None = None) -> int:
    """`python -m stagehand.audio.voicefx in.wav outdir`: one file per flavour,
    three levels of the night, and a hijack."""
    import sys
    from pathlib import Path

    import soundfile as sf

    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 2:
        print(__doc__ or "", file=sys.stderr)
        return 2
    data, rate = sf.read(args[0], dtype="float32", always_2d=True)
    voice = data.mean(axis=1)
    out = Path(args[1])
    out.mkdir(parents=True, exist_ok=True)
    for flavour in FLAVOURS:
        sf.write(out / f"flavour-{flavour}.wav", render(voice, rate, flavour=flavour), rate)
    for level in (0.3, 0.6, 1.0):
        sf.write(out / f"level-{int(level * 100):03d}.wav", render(voice, rate, level=level), rate)
    fx = VoiceFx(rate, seed=56)
    fx.spike(1.0, 8000.0, ("overclock", "skip", "dump", "packet"))
    hijack = voice.copy()
    for at in range(0, len(hijack), 512):
        fx.process(hijack[at : at + 512])
    sf.write(out / "spike-hijack.wav", hijack, rate)
    print(f"{len(FLAVOURS) + 4} files in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
