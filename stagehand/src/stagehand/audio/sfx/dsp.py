"""The SFX library's synthesis toolkit (wave 38, C6): numpy only, 48 kHz.

Every sound in the library is built from these pieces, so they are written to
be combined: each generator takes a length in seconds (or a per-sample
frequency array, whose length is then the length) and returns float64 mono
`(frames,)`; anything that takes a signal also takes stereo `(frames, 2)` and
works per channel. Nothing here reads a clock or a global random state: noise
takes the sound's own `np.random.Generator` (`registry.Spec.render`'s `rng`),
so a re-render is byte-identical.

There is no scipy on the house machines (and no new dependency for a party),
so the filters are done two ways:

- **LTI filters by FFT** (`filt`, `lowpass` …, `reverb`, `delay`, `comb`):
  the filter's exact frequency response multiplied into the signal's
  spectrum over a grid long enough for its tail (the tail past the input's
  end is cut: pad first with `pad` to keep it). With `circular=True` the grid
  is the signal itself, so the response wraps the tail round to the head —
  exactly the steady state of a looping signal, which is what makes a
  filtered or reverberated ambient loop seamless for free.
- **Time-varying filters by a per-sample loop** (`svf`, `biquad_loop`): a
  swept cutoff (a wah, a zipper, a sweeping siren). A plain Python loop costs
  about 12 ms per second of audio on John's MacBook: fine offline.

Building a seamless loop (an ambient bed) is easiest *circularly*: tones at
`loop_freq` (a whole number of cycles in the loop), events placed with
`mix(..., wrap=True)`, filters and reverb with `circular=True`. When a part
cannot be made periodic, render it a little long and `make_loop` crossfades
its tail into its head.

Levels here are loose (the generators sit near ±1, the noises at the same
RMS so they swap freely); `render.py` sets the final level, so a sound never
has to normalise itself.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass

import numpy as np

RATE = 48000
NYQUIST = RATE / 2
TAU = 2 * math.pi
#: The RMS every noise colour is scaled to, so white, pink and brown swap freely.
NOISE_RMS = 0.25

Signal = np.ndarray
Freq = float | np.ndarray


# -- time ----------------------------------------------------------------------


def frames(seconds: float) -> int:
    """Samples in `seconds` at RATE (rounded, never negative)."""
    return max(0, int(round(seconds * RATE)))


def seconds_of(x: Signal) -> float:
    return len(x) / RATE


def timebase(seconds: float | None = None, n: int | None = None) -> np.ndarray:
    """Time in seconds of each sample: 0, 1/RATE, … (`n` samples, or `seconds`)."""
    return np.arange(frames(seconds or 0) if n is None else n) / RATE


def silence(seconds: float, stereo: bool = False) -> Signal:
    n = frames(seconds)
    return np.zeros((n, 2) if stereo else n)


def pad(x: Signal, after: float = 0.0, before: float = 0.0) -> Signal:
    """Silence before and/or after `x` (to keep a reverb or delay tail)."""
    widths = [(frames(before), frames(after))] + [(0, 0)] * (x.ndim - 1)
    return np.pad(x, widths)


def fit(x: Signal, seconds: float) -> Signal:
    """`x` cut or padded with silence to exactly `seconds`."""
    n = frames(seconds)
    if len(x) >= n:
        return x[:n]
    return pad(x, after=(n - len(x)) / RATE) if x.ndim == 1 else np.pad(x, [(0, n - len(x)), (0, 0)])


def concat(*parts: Signal) -> Signal:
    """Back to back; mono parts are promoted when any part is stereo."""
    if any(p.ndim == 2 for p in parts):
        parts = tuple(stereo(p) for p in parts)
    return np.concatenate(parts)


def _n_for(freq: Freq, seconds: float | None) -> int:
    if np.ndim(freq):
        return len(freq)
    if seconds is None:
        raise ValueError("a scalar frequency needs `seconds`")
    return frames(seconds)


def _freq_array(freq: Freq, n: int) -> np.ndarray:
    return np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))


# -- pitch -----------------------------------------------------------------------

_NOTE = re.compile(r"^([A-Ga-g])([#b♯♭]?)(-?\d+)$")
_SEMIS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi_to_hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def hz(note: str | float) -> float:
    """A note name → Hz: `"A4"` = 440, `"C#5"`, `"Eb3"`; a number is a MIDI
    note (69 = A4). Middle C is C4."""
    if isinstance(note, (int, float)):
        return midi_to_hz(float(note))
    m = _NOTE.match(note.strip())
    if not m:
        raise ValueError(f"not a note: {note!r} (e.g. A4, C#5, Eb3)")
    letter, acc, octave = m.groups()
    semi = _SEMIS[letter.upper()] + {"#": 1, "♯": 1, "b": -1, "♭": -1}.get(acc, 0)
    return midi_to_hz(12 * (int(octave) + 1) + semi)


def cents(freq: Freq, c: float) -> Freq:
    """`freq` moved by `c` cents (100 to the semitone)."""
    return freq * 2 ** (c / 1200)


def loop_freq(freq: float, seconds: float) -> float:
    """The frequency nearest `freq` with a whole number of cycles in `seconds`:
    a tone at it ends exactly where it starts, so a loop has no phase jump."""
    return max(1, round(freq * seconds)) / seconds


# -- frequency curves ------------------------------------------------------------


def glide(f0: float, f1: float, seconds: float, curve: str = "exp") -> np.ndarray:
    """A per-sample frequency from `f0` to `f1`: `exp` (even in pitch, how a
    siren or a falling bomb sounds) or `linear` (even in Hz)."""
    n = frames(seconds)
    if curve == "exp":
        return np.geomspace(f0, f1, n) if n else np.zeros(0)
    if curve == "linear":
        return np.linspace(f0, f1, n)
    raise ValueError(f"glide curve {curve!r}: exp or linear")


def sweep(points: Sequence[tuple[float, float]], seconds: float, curve: str = "exp") -> np.ndarray:
    """A breakpoint frequency curve: `[(t, hz), …]`, held before the first and
    after the last point; `exp` interpolates in pitch, `linear` in Hz."""
    return line(points, seconds, curve=curve)


def vibrato(freq: Freq, seconds: float | None = None, rate: float = 5.5, depth_cents: float = 20, phase0: float = 0.0) -> np.ndarray:
    """`freq` with a sine vibrato (`depth_cents` either side at `rate` Hz)."""
    n = _n_for(freq, seconds)
    lfo = np.sin(TAU * (rate * timebase(n=n) + phase0))
    return _freq_array(freq, n) * 2 ** (depth_cents * lfo / 1200)


def jitter(freq: Freq, rng: np.random.Generator, seconds: float | None = None, cents_rms: float = 8, rate: float = 12) -> np.ndarray:
    """`freq` with a slow random wander (a reed, a motor, a tired fan): band-
    limited noise at about `rate` Hz, `cents_rms` deep."""
    n = _n_for(freq, seconds)
    wander = onepole(rng.standard_normal(n), rate)
    wander *= cents_rms / max(1e-12, float(np.sqrt(np.mean(wander**2))))
    return _freq_array(freq, n) * 2 ** (wander / 1200)


def phase(freq: Freq, seconds: float | None = None, phase0: float = 0.0) -> np.ndarray:
    """Cumulative phase in **cycles** (not radians) for a per-sample `freq`:
    sample i is `phase0 + Σ freq[:i] / RATE`, so a glide stays phase-continuous
    (no click where the pitch moves) and sample 0 is exactly `phase0`."""
    n = _n_for(freq, seconds)
    f = _freq_array(freq, n)
    if not np.ndim(freq):
        return phase0 + float(freq) * np.arange(n) / RATE
    out = np.empty(n)
    if n:
        out[0] = 0.0
        np.cumsum(f[:-1], out=out[1:])
    return phase0 + out / RATE


# -- oscillators -------------------------------------------------------------------


def sine(freq: Freq, seconds: float | None = None, phase0: float = 0.0) -> Signal:
    return np.sin(TAU * phase(freq, seconds, phase0))


def _blep(t: np.ndarray, dt: np.ndarray) -> np.ndarray:
    """The 2-sample polyBLEP residual for a unit step at phase 0 (t in cycles)."""
    out = np.zeros_like(t)
    a = t < dt
    x = t[a] / dt[a]
    out[a] = x + x - x * x - 1
    b = t > 1 - dt
    x = (t[b] - 1) / dt[b]
    out[b] = x * x + x + x + 1
    return out


def _blamp(t: np.ndarray, dt: np.ndarray) -> np.ndarray:
    """The polyBLAMP residual (the BLEP's integral) for a slope change at phase 0."""
    out = np.zeros_like(t)
    a = t < dt
    x = t[a] / dt[a] - 1
    out[a] = -(x**3) / 3
    b = t > 1 - dt
    x = (t[b] - 1) / dt[b] + 1
    out[b] = x**3 / 3
    return out


def _dt(freq: Freq, n: int) -> np.ndarray:
    return np.clip(np.abs(_freq_array(freq, n)) / RATE, 1e-9, 0.5)


def saw(freq: Freq, seconds: float | None = None, phase0: float = 0.0) -> Signal:
    """A rising sawtooth, −1…1, band-limited with polyBLEP (no aliasing hiss
    on a fast glide)."""
    n = _n_for(freq, seconds)
    t = phase(freq, seconds, phase0) % 1.0
    return 2 * t - 1 - _blep(t, _dt(freq, n))


def pulse(freq: Freq, seconds: float | None = None, width: float | np.ndarray = 0.5, phase0: float = 0.0) -> Signal:
    """A pulse wave, high for `width` of each cycle (0.5 = square; 0.125 is
    the thin, nasal chip-tune pulse). `width` may be per-sample (PWM). Its DC
    (2·width − 1) is taken out, so a narrow pulse sits round zero like any
    other wave (peaks then reach up to 2 − 2·width: normalise after)."""
    n = _n_for(freq, seconds)
    t = phase(freq, seconds, phase0) % 1.0
    w = np.clip(np.broadcast_to(np.asarray(width, dtype=np.float64), (n,)), 0.01, 0.99)
    dt = _dt(freq, n)
    naive = np.where(t < w, 1.0, -1.0)
    return naive + _blep(t, dt) - _blep((t - w) % 1.0, dt) - (2 * w - 1)


def square(freq: Freq, seconds: float | None = None, phase0: float = 0.0) -> Signal:
    return pulse(freq, seconds, 0.5, phase0)


def triangle(freq: Freq, seconds: float | None = None, phase0: float = 0.0) -> Signal:
    """A triangle, ±1, its corners rounded with polyBLAMP. Phase 0 is the
    bottom corner (−1)."""
    n = _n_for(freq, seconds)
    t = phase(freq, seconds, phase0) % 1.0
    dt = _dt(freq, n)
    naive = 1 - 4 * np.abs(t - 0.5)
    # slope per sample flips by ±8·dt at each corner (bottom at 0, top at ½)
    return naive + 4 * dt * (_blamp(t, dt) - _blamp((t - 0.5) % 1.0, dt))


def additive(freq: Freq, seconds: float | None = None, partials: Iterable[tuple[float, float]] = ((1, 1),), phase0: float = 0.0) -> Signal:
    """A sum of sines at `freq × ratio` with amplitude `amp` per `(ratio, amp)`;
    a partial is silenced wherever it would pass Nyquist (band-limited by
    construction). Ratios need not be whole (a bell, a bar, a gong)."""
    n = _n_for(freq, seconds)
    ph = phase(freq, seconds, phase0)
    f = _freq_array(freq, n)
    out = np.zeros(n)
    for ratio, amp in partials:
        keep = np.clip((NYQUIST * 0.95 - f * ratio) / (NYQUIST * 0.05), 0, 1)
        out += amp * keep * np.sin(TAU * ratio * ph)
    return out


def table(partials: Iterable[tuple[float, float]], size: int = 2048) -> np.ndarray:
    """One cycle of a wavetable from `(harmonic, amp)` pairs (whole harmonics),
    peak-normalised: for `wavetable`."""
    t = np.arange(size) / size
    w = sum(a * np.sin(TAU * h * t) for h, a in partials)
    w = np.asarray(w, dtype=np.float64)
    return w / max(1e-12, float(np.abs(w).max()))


def wavetable(cycle: np.ndarray, freq: Freq, seconds: float | None = None, phase0: float = 0.0) -> Signal:
    """Play one cycle (`table`, or any array) at `freq`, linearly
    interpolated. Keep the table smooth (few harmonics) for high notes."""
    cycle = np.asarray(cycle, dtype=np.float64)
    size = len(cycle)
    pos = (phase(freq, seconds, phase0) % 1.0) * size
    i = np.floor(pos).astype(np.int64)
    frac = pos - i
    return cycle[i % size] * (1 - frac) + cycle[(i + 1) % size] * frac


def fm(
    freq: Freq,
    seconds: float | None = None,
    ratio: float = 1.0,
    index: float | np.ndarray = 1.0,
    feedback: float = 0.0,
    phase0: float = 0.0,
) -> Signal:
    """A two-operator FM voice: a sine carrier at `freq` phase-modulated by a
    sine at `freq × ratio`, `index` deep (radians; per-sample for a decaying
    brightness, the classic bell or electric piano). `feedback` (0…1.5) feeds
    the modulator back into itself, from sine toward saw (a per-sample loop)."""
    n = _n_for(freq, seconds)
    pc = phase(freq, seconds, phase0)
    pm = phase(_freq_array(freq, n) * ratio, None)
    idx = np.broadcast_to(np.asarray(index, dtype=np.float64), (n,))
    if feedback:
        mod = np.empty(n)
        prev = 0.0
        pm_l = (TAU * pm).tolist()
        for i in range(n):
            prev = math.sin(pm_l[i] + feedback * prev)
            mod[i] = prev
    else:
        mod = np.sin(TAU * pm)
    return np.sin(TAU * pc + idx * mod)


def ring(x: Signal, freq: Freq) -> Signal:
    """Ring modulation: `x` times a sine at `freq` (the metallic robot voice)."""
    return _per_channel(x, lambda c: c * sine(freq, len(c) / RATE if not np.ndim(freq) else None)[: len(c)])


def am(x: Signal, rate: Freq, depth: float = 1.0, shape: str = "sine") -> Signal:
    """Amplitude modulation (tremolo): `x` swung between `1 − depth` and 1 at
    `rate` Hz; `shape` sine or square (a hard chop, a rotary warning beacon)."""

    def one(c: np.ndarray) -> np.ndarray:
        n = len(c)
        lfo = sine(rate, n / RATE) if not np.ndim(rate) else sine(rate)
        lfo = lfo[:n]
        if shape == "square":
            lfo = np.tanh(lfo * 12)
        return c * (1 - depth + depth * (0.5 + 0.5 * lfo))

    return _per_channel(x, one)


# -- noise --------------------------------------------------------------------------


def _scaled(x: np.ndarray) -> np.ndarray:
    return x * (NOISE_RMS / max(1e-12, float(np.sqrt(np.mean(x**2)))))


def white(seconds: float, rng: np.random.Generator) -> Signal:
    """Gaussian white noise at NOISE_RMS."""
    return _scaled(rng.standard_normal(frames(seconds)))


def _coloured(seconds: float, rng: np.random.Generator, power: float) -> np.ndarray:
    n = frames(seconds)
    if n < 2:
        return np.zeros(n)
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / RATE)
    f[0] = f[1]
    spec *= f ** (-power / 2)
    spec[0] = 0
    return _scaled(np.fft.irfft(spec, n))


def pink(seconds: float, rng: np.random.Generator) -> Signal:
    """Pink noise (−3 dB/octave: rain, air, a room) by spectral shaping. It is
    periodic over its own length, so a pink bed loops seamlessly as it is."""
    return _coloured(seconds, rng, 1.0)


def brown(seconds: float, rng: np.random.Generator) -> Signal:
    """Brown noise (−6 dB/octave: rumble, a distant engine, surf), periodic
    over its own length like `pink`."""
    return _coloured(seconds, rng, 2.0)


def velvet(seconds: float, rng: np.random.Generator, density: float = 2000) -> Signal:
    """Velvet noise: one ±1 impulse at a random place in each 1/`density` s
    slot. Sparse, smooth-sounding; at low density (≈ 20–200) a dry crackle."""
    n = frames(seconds)
    out = np.zeros(n)
    slot = max(1, int(RATE / density))
    starts = np.arange(0, n, slot)
    pos = starts + rng.integers(0, slot, len(starts))
    sign = rng.choice((-1.0, 1.0), len(starts))
    keep = pos < n
    out[pos[keep]] = sign[keep]
    return out


def crackle(seconds: float, rng: np.random.Generator, density: float = 30, grain_ms: float = 2.0) -> Signal:
    """Random clicks (vinyl, embers, static on a line): Poisson-timed, each a
    tiny decaying noise grain with a random level (mostly soft, a few loud)."""
    n = frames(seconds)
    out = np.zeros(n)
    count = rng.poisson(density * seconds)
    if not count or not n:
        return out
    pos = rng.integers(0, n, count)
    amps = rng.pareto(2.5, count) + 0.2
    out[pos] = amps * rng.choice((-1.0, 1.0), count)
    g = frames(grain_ms / 1000) or 1
    grain = rng.standard_normal(g) * np.exp(-np.arange(g) / max(1, g / 5))
    return np.convolve(out, grain)[:n] / max(1e-12, float(amps.max()))


# -- envelopes -------------------------------------------------------------------


def line(points: Sequence[tuple[float, float]], seconds: float, curve: str = "linear") -> np.ndarray:
    """A breakpoint curve `[(t, value), …]` over `seconds`, held flat before the
    first and after the last point. `curve="exp"` interpolates the logarithm
    (values must be > 0): pitch, and fades that sound even."""
    t = timebase(seconds)
    ts = np.array([p[0] for p in points], dtype=np.float64)
    vs = np.array([p[1] for p in points], dtype=np.float64)
    if curve == "exp":
        return np.exp(np.interp(t, ts, np.log(np.maximum(vs, 1e-12))))
    if curve != "linear":
        raise ValueError(f"line curve {curve!r}: linear or exp")
    return np.interp(t, ts, vs)


def decay(seconds: float, t60: float, attack: float = 0.0) -> np.ndarray:
    """An exponential decay that falls 60 dB in `t60` seconds, after an optional
    linear `attack` (a pluck, a bell, a drip)."""
    t = timebase(seconds)
    env = np.exp(-6.907755 * np.maximum(0, t - attack) / max(1e-6, t60))
    if attack > 0:
        env *= np.clip(t / attack, 0, 1)
    return env


def ar(seconds: float, attack: float = 0.005, release: float | None = None) -> np.ndarray:
    """Attack–release: a linear rise over `attack`, then an exponential fall
    reaching −60 dB at the end (or after `release` seconds)."""
    rel = (seconds - attack) if release is None else release
    return decay(seconds, max(1e-4, rel), attack)


def adsr(seconds: float, attack: float = 0.01, decay_s: float = 0.1, sustain: float = 0.7, release: float = 0.2) -> np.ndarray:
    """The synth envelope over a note of `seconds` (release included at the
    end): linear attack, exponential-ish decay to `sustain`, hold, then a
    release from wherever it is to 0."""
    n = frames(seconds)
    t = timebase(n=n)
    rel_start = max(0.0, seconds - release)
    a = np.clip(t / max(attack, 1e-6), 0, 1)
    d = sustain + (1 - sustain) * np.exp(-5 * np.maximum(0, t - attack) / max(decay_s, 1e-6))
    env = np.where(t < attack, a, d)
    level_at_rel = float(np.interp(rel_start, t, env)) if n else 0.0
    r = np.clip(1 - (t - rel_start) / max(release, 1e-6), 0, 1) ** 2
    return np.where(t >= rel_start, level_at_rel * r, env)


def gates(seconds: float, events: Iterable[tuple[float, float]], attack: float = 0.003, release: float = 0.01) -> np.ndarray:
    """An on/off envelope from `(start, duration)` pairs with short ramps (no
    clicks): a cadence (a ring, a busy signal), a stutter, a morse beep."""
    n = frames(seconds)
    t = timebase(n=n)
    env = np.zeros(n)
    for start, dur in events:
        up = np.clip((t - start) / max(attack, 1e-6), 0, 1)
        down = np.clip((start + dur - t) / max(release, 1e-6), 0, 1)
        env = np.maximum(env, np.minimum(up, down))
    return env


def fade(x: Signal, fade_in: float = 0.0, fade_out: float = 0.0, curve: str = "sine") -> Signal:
    """Fade the ends: `sine` (equal power, the default), `linear`, or `exp`."""
    x = np.array(x, dtype=np.float64, copy=True)
    n = len(x)
    for length, rev in ((frames(fade_in), False), (frames(fade_out), True)):
        k = min(length, n)
        if not k:
            continue
        r = np.linspace(0, 1, k, endpoint=False) + 1 / k / 2
        g = {"sine": np.sin(r * math.pi / 2), "linear": r, "exp": r**3}[curve]
        if rev:
            g = g[::-1]
            x[n - k :] *= g if x.ndim == 1 else g[:, None]
        else:
            x[:k] *= g if x.ndim == 1 else g[:, None]
    return x


# -- filters ---------------------------------------------------------------------


@dataclass(frozen=True)
class Biquad:
    """A second-order section (RBJ cookbook designs), a0 normalised to 1."""

    b0: float
    b1: float
    b2: float
    a1: float
    a2: float

    @staticmethod
    def _rbj(f: float, q: float) -> tuple[float, float, float]:
        w = TAU * min(max(f, 1.0), NYQUIST * 0.995) / RATE
        return w, math.cos(w), math.sin(w) / (2 * max(q, 1e-3))

    @classmethod
    def _norm(cls, b0: float, b1: float, b2: float, a0: float, a1: float, a2: float) -> Biquad:
        return cls(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)

    @classmethod
    def lowpass(cls, f: float, q: float = 0.7071) -> Biquad:
        _, c, al = cls._rbj(f, q)
        return cls._norm((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al)

    @classmethod
    def highpass(cls, f: float, q: float = 0.7071) -> Biquad:
        _, c, al = cls._rbj(f, q)
        return cls._norm((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al)

    @classmethod
    def bandpass(cls, f: float, q: float = 1.0) -> Biquad:
        """Constant 0 dB peak gain at `f`."""
        _, c, al = cls._rbj(f, q)
        return cls._norm(al, 0, -al, 1 + al, -2 * c, 1 - al)

    @classmethod
    def notch(cls, f: float, q: float = 4.0) -> Biquad:
        _, c, al = cls._rbj(f, q)
        return cls._norm(1, -2 * c, 1, 1 + al, -2 * c, 1 - al)

    @classmethod
    def peak(cls, f: float, gain_db: float, q: float = 1.0) -> Biquad:
        _, c, al = cls._rbj(f, q)
        a = 10 ** (gain_db / 40)
        return cls._norm(1 + al * a, -2 * c, 1 - al * a, 1 + al / a, -2 * c, 1 - al / a)

    @classmethod
    def lowshelf(cls, f: float, gain_db: float, slope: float = 1.0) -> Biquad:
        a = 10 ** (gain_db / 40)
        w = TAU * min(max(f, 1.0), NYQUIST * 0.995) / RATE
        c, s = math.cos(w), math.sin(w)
        al = s / 2 * math.sqrt((a + 1 / a) * (1 / slope - 1) + 2)
        sq = 2 * math.sqrt(a) * al
        return cls._norm(
            a * ((a + 1) - (a - 1) * c + sq), 2 * a * ((a - 1) - (a + 1) * c), a * ((a + 1) - (a - 1) * c - sq),
            (a + 1) + (a - 1) * c + sq, -2 * ((a - 1) + (a + 1) * c), (a + 1) + (a - 1) * c - sq,
        )

    @classmethod
    def highshelf(cls, f: float, gain_db: float, slope: float = 1.0) -> Biquad:
        a = 10 ** (gain_db / 40)
        w = TAU * min(max(f, 1.0), NYQUIST * 0.995) / RATE
        c, s = math.cos(w), math.sin(w)
        al = s / 2 * math.sqrt((a + 1 / a) * (1 / slope - 1) + 2)
        sq = 2 * math.sqrt(a) * al
        return cls._norm(
            a * ((a + 1) + (a - 1) * c + sq), -2 * a * ((a - 1) + (a + 1) * c), a * ((a + 1) + (a - 1) * c - sq),
            (a + 1) - (a - 1) * c + sq, 2 * ((a - 1) - (a + 1) * c), (a + 1) - (a - 1) * c - sq,
        )

    @classmethod
    def onepole(cls, f: float, mode: str = "lp") -> Biquad:
        """A 6 dB/octave one-pole (as a degenerate biquad)."""
        p = math.exp(-TAU * min(max(f, 0.01), NYQUIST * 0.995) / RATE)
        if mode == "lp":
            return cls(1 - p, 0, 0, -p, 0)
        if mode == "hp":
            return cls((1 + p) / 2, -(1 + p) / 2, 0, -p, 0)
        raise ValueError(f"onepole mode {mode!r}: lp or hp")

    def response(self, z_inv: np.ndarray) -> np.ndarray:
        """H at the points z⁻¹ (complex)."""
        return (self.b0 + self.b1 * z_inv + self.b2 * z_inv**2) / (1 + self.a1 * z_inv + self.a2 * z_inv**2)

    def ring_samples(self, floor: float = 1e-7) -> int:
        """How long the impulse response takes to fall to `floor` (from its
        largest pole), capped at 10 s."""
        r = float(np.max(np.abs(np.roots([1.0, self.a1, self.a2])))) if (self.a1 or self.a2) else 0.0
        if r <= 0:
            return 4
        if r >= 1:
            return 10 * RATE
        return int(min(10 * RATE, math.log(floor) / math.log(r) + 4))


def _per_channel(x: Signal, f: Callable[[np.ndarray], np.ndarray]) -> Signal:
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        return f(x)
    return np.stack([f(x[:, c]) for c in range(x.shape[1])], axis=1)


def _fft_size(n: int) -> int:
    return 1 << max(1, (n - 1).bit_length())


def apply_response(x: Signal, response: Callable[[np.ndarray], np.ndarray], tail: int, circular: bool = False) -> Signal:
    """Filter `x` by a frequency response `response(z⁻¹)` on an FFT grid: the
    engine under every LTI filter here. `tail` is how many samples the
    response rings for (the grid is padded by it so the tail does not wrap);
    `circular=True` uses `x`'s own length (the periodic steady state: for a
    loop). The output is as long as the input.

    The response is sampled once on a grid just long enough for its tail
    (its impulse response, cut below about −80 dB) and then convolved by FFT,
    so a 30 s ambient bed through a reverb costs two FFTs, not a 30 s grid of
    complex powers per comb."""
    ir_size = _fft_size(max(8, tail))
    z_inv = np.exp(-1j * TAU * np.fft.rfftfreq(ir_size))
    ir = np.fft.irfft(response(z_inv), ir_size)
    return convolve(x, ir, circular)


def convolve(x: Signal, ir: np.ndarray, circular: bool = False) -> Signal:
    """`x` convolved with an impulse response `ir` by FFT, as long as `x`:
    linear (the tail past the end is cut), or `circular` (the tail wraps to
    the head — a seamless loop through a filter or a room)."""
    ir = np.asarray(ir, dtype=np.float64)

    def one(c: np.ndarray) -> np.ndarray:
        n = len(c)
        if not n:
            return c
        if circular:
            folded = np.zeros(n)
            np.add.at(folded, np.arange(len(ir)) % n, ir)
            return np.fft.irfft(np.fft.rfft(c) * np.fft.rfft(folded), n)
        size = _fft_size(n + len(ir))
        return np.fft.irfft(np.fft.rfft(c, size) * np.fft.rfft(ir, size), size)[:n]

    return _per_channel(x, one)


def filt(x: Signal, *sections: Biquad, circular: bool = False) -> Signal:
    """`x` through a cascade of `Biquad`s (by FFT: exact, fast, any length)."""
    if not sections:
        return np.asarray(x, dtype=np.float64)

    def h(z_inv: np.ndarray) -> np.ndarray:
        out = np.ones_like(z_inv)
        for s in sections:
            out = out * s.response(z_inv)
        return out

    return apply_response(x, h, sum(s.ring_samples() for s in sections), circular)


def lowpass(x: Signal, f: float, q: float = 0.7071, order: int = 2, circular: bool = False) -> Signal:
    """A lowpass at `f`; `order` 2, 4, 6 … stacks sections (12 dB/oct each)."""
    return filt(x, *[Biquad.lowpass(f, q)] * max(1, order // 2), circular=circular)


def highpass(x: Signal, f: float, q: float = 0.7071, order: int = 2, circular: bool = False) -> Signal:
    return filt(x, *[Biquad.highpass(f, q)] * max(1, order // 2), circular=circular)


def bandpass(x: Signal, f: float, q: float = 1.0, circular: bool = False) -> Signal:
    return filt(x, Biquad.bandpass(f, q), circular=circular)


def notch(x: Signal, f: float, q: float = 4.0, circular: bool = False) -> Signal:
    return filt(x, Biquad.notch(f, q), circular=circular)


def peak_eq(x: Signal, f: float, gain_db: float, q: float = 1.0, circular: bool = False) -> Signal:
    return filt(x, Biquad.peak(f, gain_db, q), circular=circular)


def lowshelf(x: Signal, f: float, gain_db: float, circular: bool = False) -> Signal:
    return filt(x, Biquad.lowshelf(f, gain_db), circular=circular)


def highshelf(x: Signal, f: float, gain_db: float, circular: bool = False) -> Signal:
    return filt(x, Biquad.highshelf(f, gain_db), circular=circular)


def onepole(x: Signal, f: float, mode: str = "lp", circular: bool = False) -> Signal:
    """A gentle 6 dB/oct filter; on a control curve, smoothing (`f` ≈ 1/time)."""
    return filt(x, Biquad.onepole(f, mode), circular=circular)


def telephone(x: Signal, circular: bool = False) -> Signal:
    """The narrow telephone band (≈ 300–3400 Hz) with a little nasal bump."""
    return filt(x, Biquad.highpass(300, 0.8), Biquad.highpass(300, 0.6), Biquad.lowpass(3400, 0.8), Biquad.lowpass(3400, 0.6), Biquad.peak(1600, 4, 1.2), circular=circular)


def biquad_loop(x: Signal, s: Biquad) -> Signal:
    """The same biquad as `filt`, sample by sample (transposed direct form II):
    the reference the FFT path is tested against, and the start of anything
    stateful you want to hand-roll."""

    def one(c: np.ndarray) -> np.ndarray:
        z1 = z2 = 0.0
        out = []
        b0, b1, b2, a1, a2 = s.b0, s.b1, s.b2, s.a1, s.a2
        for v in c.tolist():
            y = b0 * v + z1
            z1 = b1 * v - a1 * y + z2
            z2 = b2 * v - a2 * y
            out.append(y)
        return np.array(out)

    return _per_channel(x, one)


def svf(x: Signal, cutoff: Freq, q: float | np.ndarray = 0.7071, mode: str = "lp") -> Signal:
    """A state-variable filter (Zavalishin's TPT form) whose `cutoff` (and `q`)
    may move every sample without zipper noise or blowing up: the swept
    resonant filter (a wah, a zipper, a laser, a filter-opening riser).
    `mode`: lp, hp, bp (0 dB peak) or notch. A per-sample loop."""
    if mode not in ("lp", "hp", "bp", "notch"):
        raise ValueError(f"svf mode {mode!r}: lp, hp, bp or notch")

    def one(c: np.ndarray) -> np.ndarray:
        n = len(c)
        f = np.clip(np.broadcast_to(np.asarray(cutoff, dtype=np.float64), (n,)), 1.0, NYQUIST * 0.49)
        g = np.tan(math.pi * f / RATE).tolist()
        k = (1 / np.clip(np.broadcast_to(np.asarray(q, dtype=np.float64), (n,)), 0.05, 100)).tolist()
        ic1 = ic2 = 0.0
        out = [0.0] * n
        xs = c.tolist()
        for i in range(n):
            gi, ki = g[i], k[i]
            a1 = 1 / (1 + gi * (gi + ki))
            v3 = xs[i] - ic2
            v1 = a1 * ic1 + gi * a1 * v3
            v2 = ic2 + gi * v1
            ic1 = 2 * v1 - ic1
            ic2 = 2 * v2 - ic2
            if mode == "lp":
                out[i] = v2
            elif mode == "bp":
                out[i] = ki * v1
            elif mode == "hp":
                out[i] = xs[i] - ki * v1 - v2
            else:
                out[i] = xs[i] - ki * v1
        return np.array(out)

    return _per_channel(x, one)


def smooth(control: np.ndarray, seconds: float) -> np.ndarray:
    """A control curve (a gain, a frequency) smoothed with a one-pole of time
    constant `seconds`: a stepped sequence becomes a glide (portamento)."""
    return onepole(control - control[0], 1 / (TAU * max(seconds, 1e-5))) + control[0] if len(control) else control


# -- delay and reverb --------------------------------------------------------------


def _decay_tail(delay: int, feedback: float, floor_db: float = -80, cap_s: float = 8.0) -> int:
    fb = min(abs(feedback), 0.9999)
    if fb <= 0:
        return delay + 1
    return int(min(cap_s * RATE, delay * (floor_db / 20 * math.log(10)) / math.log(fb) + delay))


def comb(x: Signal, delay_s: float, feedback: float = 0.7, damp: float = 0.0, circular: bool = False) -> Signal:
    """A feedback comb: echoes every `delay_s`, each `feedback` as loud,
    `damp` (0…1) dulling each repeat. Short delays (1–20 ms) ring at
    1/delay Hz: a metallic tube, a flanged robot. Output is the echoes only."""
    d = max(1, frames(delay_s))

    def h(z_inv: np.ndarray) -> np.ndarray:
        zd = z_inv**d
        lp = (1 - damp) / (1 - damp * z_inv)
        return zd / (1 - feedback * lp * zd)

    return apply_response(x, h, _decay_tail(d, feedback), circular)


def delay(x: Signal, seconds: float, feedback: float = 0.4, mix_: float = 0.35, damp: float = 0.3, circular: bool = False) -> Signal:
    """A feedback echo (a slapback, a canyon, an announcement in a hangar):
    the dry signal plus `mix_` of the repeats. Pad first to hear the tail."""
    wet = comb(x, seconds, feedback, damp, circular)
    return np.asarray(x, dtype=np.float64) * (1 - mix_ * 0.5) + wet * mix_


def allpass(x: Signal, delay_s: float, g: float = 0.5, circular: bool = False) -> Signal:
    """A true Schroeder allpass, (−g + z⁻ᴰ) / (1 − g·z⁻ᴰ): smears a transient
    into a short burst of echoes without colouring the spectrum; chained,
    it diffuses (a spring, a metallic smear). `reverb` uses Freeverb's own,
    slightly coloured variant for its character."""
    d = max(1, frames(delay_s))

    def h(z_inv: np.ndarray) -> np.ndarray:
        zd = z_inv**d
        return (-g + zd) / (1 - g * zd)

    return apply_response(x, h, _decay_tail(d, g), circular)


_COMBS = (1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617)
_ALLPASSES = (556, 441, 341, 225)
_SPREAD = 23


def reverb(
    x: Signal,
    room: float = 0.5,
    damp: float = 0.5,
    wet: float = 0.3,
    dry: float = 1.0,
    width: float = 1.0,
    predelay: float = 0.0,
    circular: bool = False,
) -> Signal:
    """A Freeverb-style room (8 damped combs in parallel, 4 allpasses in
    series, a slightly detuned right channel), computed by FFT. `room` 0…1 is
    the size/decay (0.9 ≈ a hall), `damp` 0…1 dulls the tail, `width` 0…1 the
    stereo spread. Returns **stereo** `(frames, 2)`, as long as the input: pad
    the input to keep the tail. With `circular=True` the tail wraps into the
    head (a seamless loop)."""
    mono = np.asarray(x, dtype=np.float64)
    if mono.ndim == 2:
        mono = mono.mean(axis=1)
    fb = room * 0.28 + 0.7
    dmp = damp * 0.4
    scale = RATE / 44100
    pre = frames(predelay)

    def network(offset: int) -> Callable[[np.ndarray], np.ndarray]:
        def h(z_inv: np.ndarray) -> np.ndarray:
            lp = (1 - dmp) / (1 - dmp * z_inv)
            total = np.zeros_like(z_inv)
            for c in _COMBS:
                zd = z_inv ** int((c + offset) * scale)
                total += zd / (1 - fb * lp * zd)
            for a in _ALLPASSES:
                zd = z_inv ** int((a + offset) * scale)
                total = total * (-1 + (1 + 0.5) * zd) / (1 - 0.5 * zd)
            return total * 0.015 * (z_inv**pre if pre else 1)

        return h

    tail = _decay_tail(int(max(_COMBS) * scale), fb) + pre
    left = apply_response(mono, network(0), tail, circular)
    right = apply_response(mono, network(_SPREAD), tail, circular)
    w1, w2 = wet * (width / 2 + 0.5), wet * (1 - width) / 2
    wl, wr = left * w1 + right * w2, right * w1 + left * w2
    src = stereo(x) * dry
    return src + np.stack([wl, wr], axis=1) * 3


# -- lo-fi and drive ----------------------------------------------------------------


def bitcrush(x: Signal, bits: float = 8) -> Signal:
    """Quantise to `bits` (fractional is fine): 8 is a toy, 4 is a broken game."""
    q = 2 ** (bits - 1)
    return np.round(np.asarray(x) * q) / q


def downsample(x: Signal, rate: float = 8000) -> Signal:
    """Sample-and-hold at `rate` Hz with no anti-alias filter: the gritty
    aliasing of an early sampler or a talking toy."""
    x = np.asarray(x, dtype=np.float64)
    step = RATE / max(1.0, rate)
    idx = (np.floor(np.arange(len(x)) / step) * step).astype(np.int64)
    return x[np.minimum(idx, len(x) - 1)]


def soft_clip(x: Signal, drive_db: float = 6.0) -> Signal:
    """tanh saturation, `drive_db` into it, rescaled so a full-scale (±1)
    input still peaks at ±1; a hotter input flattens just past it (never
    beyond 1/tanh(drive))."""
    g = 10 ** (drive_db / 20)
    return np.tanh(np.asarray(x) * g) / math.tanh(g)


def hard_clip(x: Signal, ceiling: float = 1.0) -> Signal:
    return np.clip(x, -ceiling, ceiling)


def saturate(x: Signal, amount: float = 0.3) -> Signal:
    """Asymmetric warmth (a tube, a cheap speaker): even harmonics from a
    biased tanh (silence stays at 0, and a ±1 input stays within ±1). The
    asymmetry rectifies a little: `dc_block` after it."""
    x = np.asarray(x, dtype=np.float64)
    bias = amount * 0.5
    k = 1 + 3 * amount
    y = np.tanh(x * k + bias) - math.tanh(bias)
    # the negative side bends harder: scale by it so a ±1 input stays within ±1
    return y / max(1e-12, math.tanh(bias) - math.tanh(bias - k), math.tanh(k + bias) - math.tanh(bias))


# -- mixing ---------------------------------------------------------------------


def db_to_lin(db: float | np.ndarray) -> float | np.ndarray:
    return 10 ** (np.asarray(db) / 20) if np.ndim(db) else 10 ** (db / 20)


def lin_to_db(v: float) -> float:
    return 20 * math.log10(max(v, 1e-12))


def peak_db(x: Signal) -> float:
    return lin_to_db(float(np.abs(x).max())) if np.size(x) else -240.0


def rms_db(x: Signal) -> float:
    return lin_to_db(float(np.sqrt(np.mean(np.square(x))))) if np.size(x) else -240.0


#: The window of `loudness_db`: about how long the ear integrates loudness
#: over (BS.1770's momentary loudness uses the same 400 ms).
LOUDNESS_WINDOW_S = 0.4


def loudness_db(x: Signal, window: float = LOUDNESS_WINDOW_S) -> float:
    """Perceived loudness, simply: the RMS dBFS of the loudest `window`-second
    stretch (every start sample, via a running sum). A sound shorter than the
    window counts as padded with silence, so a 20 ms click reads quieter than
    a 400 ms beep at the same RMS, as it sounds. Mono; a stereo signal is
    measured on its channels' mean power."""
    x = np.asarray(x, dtype=np.float64)
    if not np.size(x):
        return -240.0
    power = np.square(x) if x.ndim == 1 else np.mean(np.square(x), axis=1)
    n = max(1, frames(window))
    if len(power) < n:
        power = np.concatenate([power, np.zeros(n - len(power))])
    run = np.concatenate([[0.0], np.cumsum(power)])
    best = float((run[n:] - run[:-n]).max()) / n
    return 10 * math.log10(max(best, 1e-24))


def normalize_peak(x: Signal, dbfs: float = -1.0) -> Signal:
    return np.asarray(x) * (db_to_lin(dbfs) / max(1e-12, float(np.abs(x).max())))


def normalize_rms(x: Signal, dbfs: float = -18.0) -> Signal:
    return np.asarray(x) * (db_to_lin(dbfs) / max(1e-12, float(np.sqrt(np.mean(np.square(x))))))


def stereo(x: Signal) -> Signal:
    """Mono → two equal channels; stereo stays."""
    x = np.asarray(x, dtype=np.float64)
    return np.stack([x, x], axis=1) if x.ndim == 1 else x


def to_mono(x: Signal) -> Signal:
    x = np.asarray(x, dtype=np.float64)
    return x.mean(axis=1) if x.ndim == 2 else x


def pan(x: Signal, pos: float | np.ndarray = 0.0) -> Signal:
    """Mono → stereo, constant power: `pos` −1 (left) … 0 … 1 (right), per-sample
    for a moving source (a motorcycle passing, a fly round the room)."""
    m = to_mono(x)
    p = np.clip(np.broadcast_to(np.asarray(pos, dtype=np.float64), m.shape), -1, 1)
    th = (p + 1) * math.pi / 4
    return np.stack([m * np.cos(th), m * np.sin(th)], axis=1) * math.sqrt(2)


def gain(x: Signal, db: float) -> Signal:
    return np.asarray(x) * db_to_lin(db)


Layer = Signal | tuple


def mix(*layers: Layer, seconds: float | None = None, wrap: bool = False) -> Signal:
    """Sum layers, each an array or `(array, at_seconds[, gain_db])`. The result
    is as long as the longest end, or exactly `seconds`; `wrap=True` (with
    `seconds`) folds whatever runs past the end back onto the start — events
    in a seamless loop. Any stereo layer makes the mix stereo."""
    items: list[tuple[np.ndarray, int, float]] = []
    for layer in layers:
        if isinstance(layer, tuple):
            sig, at, *g = layer
            items.append((np.asarray(sig, dtype=np.float64), frames(at), db_to_lin(g[0]) if g else 1.0))
        else:
            items.append((np.asarray(layer, dtype=np.float64), 0, 1.0))
    is_stereo = any(s.ndim == 2 for s, _, _ in items)
    end = max((at + len(s) for s, at, _ in items), default=0)
    n = frames(seconds) if seconds is not None else end
    if wrap and seconds is None:
        raise ValueError("mix(wrap=True) needs `seconds` (the loop length)")
    out = np.zeros((n, 2) if is_stereo else n)
    for sig, at, g in items:
        sig = stereo(sig) if is_stereo else sig
        if wrap and n:
            idx = (at + np.arange(len(sig))) % n
            np.add.at(out, idx, sig * g)
        else:
            stop = min(n, at + len(sig))
            if stop > at:
                out[at:stop] += sig[: stop - at] * g
    return out


def dc_block(x: Signal, cutoff: float = 15.0, circular: bool = False) -> Signal:
    """Take out DC and sub-audio drift (after saturation, a brown-noise bed, an
    asymmetric waveform) with a gentle highpass; `circular` for a loop."""
    x = np.asarray(x, dtype=np.float64)
    if circular:
        x = x - x.mean(axis=0)
    return filt(x, Biquad.highpass(cutoff, 0.6), circular=circular)


def make_loop(x: Signal, seconds: float, xfade: float = 0.5, power: bool = True) -> Signal:
    """A seamless loop of `seconds` from `x` rendered at least `seconds + xfade`
    long: the bit past the loop's end is crossfaded over its head, so the last
    sample flows into the first. `power=True` (equal power) suits noise and
    other uncorrelated content; `False` (linear) suits material that is in
    phase across the seam (a tone at `loop_freq`)."""
    n, k = frames(seconds), frames(xfade)
    x = np.asarray(x, dtype=np.float64)
    if len(x) < n + k:
        raise ValueError(f"make_loop: needs {n + k} frames ({seconds} + {xfade} s), has {len(x)}")
    out = np.array(x[:n], copy=True)
    if k:
        r = (np.arange(k) + 0.5) / k
        fin, fout = (np.sin(r * math.pi / 2), np.cos(r * math.pi / 2)) if power else (r, 1 - r)
        if x.ndim == 2:
            fin, fout = fin[:, None], fout[:, None]
        out[:k] = x[:k] * fin + x[n : n + k] * fout
    return out


# -- telephony -----------------------------------------------------------------------

#: The DTMF keypad: (low, high) Hz per key.
DTMF = {
    "1": (697, 1209), "2": (697, 1336), "3": (697, 1477), "A": (697, 1633),
    "4": (770, 1209), "5": (770, 1336), "6": (770, 1477), "B": (770, 1633),
    "7": (852, 1209), "8": (852, 1336), "9": (852, 1477), "C": (852, 1633),
    "*": (941, 1209), "0": (941, 1336), "#": (941, 1477), "D": (941, 1633),
}

#: North American precise call-progress tones: (frequencies, cadence of
#: (on, off) seconds, or None for steady).
CALL_PROGRESS: dict[str, tuple[tuple[float, ...], tuple[float, float] | None]] = {
    "dial": ((350, 440), None),
    "ringback": ((440, 480), (2.0, 4.0)),
    "busy": ((480, 620), (0.5, 0.5)),
    "reorder": ((480, 620), (0.25, 0.25)),
    "off_hook": ((1400, 2060, 2450, 2600), (0.1, 0.1)),
    "cng": ((1100,), (0.5, 3.0)),  # a calling fax machine
    "ans": ((2100,), None),  # a modem / fax answering
}


def tones(freqs: Iterable[float], seconds: float) -> Signal:
    """Equal-level sines summed and scaled to peak ≈ 1."""
    fs = list(freqs)
    return sum(sine(f, seconds) for f in fs) / max(1, len(fs))


def dtmf(digits: str, on: float = 0.09, off: float = 0.07, twist_db: float = 2.0) -> Signal:
    """Touch-tone digits back to back (`on` s each, `off` s between), the high
    tone `twist_db` louder, as real phones send them. Spaces are a pause."""
    parts = []
    for ch in digits.upper():
        if ch == " ":
            parts.append(silence(on + off))
            continue
        if ch not in DTMF:
            raise ValueError(f"dtmf: no key {ch!r}")
        lo, hi = DTMF[ch]
        tone = sine(lo, on) + db_to_lin(twist_db) * sine(hi, on)
        parts += [fade(tone / 2.3, 0.004, 0.004), silence(off)]
    return np.concatenate(parts) if parts else np.zeros(0)


def call_progress(kind: str, seconds: float) -> Signal:
    """A call-progress tone (`CALL_PROGRESS`: dial, ringback, busy, reorder,
    off_hook, cng, ans) for `seconds`, with its cadence."""
    if kind not in CALL_PROGRESS:
        raise ValueError(f"call_progress: {kind!r} is not one of {', '.join(CALL_PROGRESS)}")
    freqs, cadence = CALL_PROGRESS[kind]
    x = tones(freqs, seconds)
    if cadence is None:
        return x
    on, off = cadence
    events = [(t, on) for t in np.arange(0, seconds, on + off)]
    return x * gates(seconds, events, 0.004, 0.004)


def ansam(seconds: float, reversals: bool = True) -> Signal:
    """A V.8 modem answer tone: 2100 Hz with a 15 Hz, 20 % amplitude
    modulation and (optionally) a phase reversal every 450 ms — the bright
    ringing whine at the start of a dial-up handshake."""
    t = timebase(seconds)
    flip = np.floor(t / 0.45) % 2 * 0.5 if reversals else 0
    return np.sin(TAU * (2100 * t + flip)) * (0.8 + 0.2 * np.sin(TAU * 15 * t))


def fsk(bits: str | Sequence[int], baud: float, mark: float, space: float) -> Signal:
    """Phase-continuous FSK: each bit `1/baud` s at `mark` (1) or `space` (0)
    Hz (Bell 103: 300 baud, 1270 / 1070; Bell 202: 1200 baud, 1200 / 2200)."""
    per = RATE / baud
    seq = [int(b) for b in bits]
    n = int(round(per * len(seq)))
    idx = np.minimum((np.arange(n) / per).astype(np.int64), len(seq) - 1)
    f = np.where(np.array(seq)[idx] == 1, mark, space).astype(np.float64)
    return sine(f)


# -- sequencing --------------------------------------------------------------------

Voice = Callable[[float, float], Signal]


def sequence(
    notes: Iterable[tuple],
    voice: Voice,
    seconds: float | None = None,
    bpm: float | None = None,
    wrap: bool = False,
) -> Signal:
    """A little sequencer: each `(note, start, dur[, gain_db])` (a note name,
    a MIDI number or Hz as a float > 127 … see `hz`; `None` is a rest) is
    rendered by `voice(freq_hz, dur_s)` (it may return more than `dur` for a
    release tail) and mixed at `start`. With `bpm`, start and dur are in beats."""
    beat = 60 / bpm if bpm else 1.0
    layers = []
    for item in notes:
        note, start, dur, *g = item
        if note is None:
            continue
        f = float(note) if isinstance(note, float) and note > 127 else hz(note)
        layers.append((voice(f, dur * beat), start * beat, g[0] if g else 0.0))
    return mix(*layers, seconds=seconds, wrap=wrap)
