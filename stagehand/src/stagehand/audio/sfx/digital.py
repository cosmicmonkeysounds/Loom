"""Digital: data bursts, glitches, downloads, beeps, scanner sweeps
(wave 38, C6).

The vocabulary of a computer that talks back: FSK warbles (`dsp.fsk`) for
data, `bitcrush` / `downsample` for something breaking, `svf` sweeps for
scanning, `gates` for stutter, `ring` for a metallic edge. Short and dry by
default; a little `reverb` only when it should sound like it is in the room.

The glitches are made the way a real one happens: a buffer of ordinary
computer sound (`_bleeps`) is cut up — a slice repeated (a stuck buffer),
read at the wrong speed (`_vari`), held at a sample rate that jumps
(`_hold`), quantised harder and harder (`_crush`). Every slice gets a 1 ms
edge (`_edges`) so the stutter is rhythmic rather than a spray of clicks,
and every glitch ends in a gentle lowpass: broken on purpose, never a hash
that hurts on a big speaker.
"""

from __future__ import annotations

import numpy as np

from . import dsp
from .spec import Spec

RATE = dsp.RATE
#: A bright, unresolved scale for computer bleeps (no tune: a computer thinking).
_BLEEP_HZ = (880.0, 1046.5, 1174.7, 1318.5, 1568.0, 1760.0, 2093.0, 2349.3)


# -- helpers (this module's own toolkit on top of dsp) ---------------------------


def _hold(x: np.ndarray, rate: float | np.ndarray) -> np.ndarray:
    """Sample-and-hold at a per-sample `rate` in Hz: `dsp.downsample` whose
    rate may jump or sweep (a sample-rate glitch, a crush that deepens)."""
    x = np.asarray(x, dtype=np.float64)
    n = len(x)
    if not n:
        return x
    clock = np.floor(np.cumsum(np.broadcast_to(np.asarray(rate, dtype=np.float64), (n,)) / RATE))
    change = np.empty(n, dtype=bool)
    change[0] = True
    change[1:] = clock[1:] != clock[:-1]
    return x[np.maximum.accumulate(np.where(change, np.arange(n), 0))]


def _crush(x: np.ndarray, bits: float | np.ndarray) -> np.ndarray:
    """`dsp.bitcrush` with a per-sample bit depth (a sweep from clean to broken)."""
    q = 2 ** (np.asarray(bits, dtype=np.float64) - 1)
    return np.round(np.asarray(x) * q) / q


def _vari(x: np.ndarray, speed: np.ndarray) -> np.ndarray:
    """Read `x` at a per-sample `speed` (1 = as recorded, 2 = an octave up,
    → 0 = a tape stop), linearly interpolated; past its end is silence."""
    pos = np.concatenate([[0.0], np.cumsum(speed[:-1])]) if len(speed) else np.zeros(0)
    return np.interp(pos, np.arange(len(x)), x, right=0.0)


def _cut(x: np.ndarray, start: float, dur: float) -> np.ndarray:
    a = dsp.frames(start)
    return np.array(x[a : a + dsp.frames(dur)], copy=True)


def _edges(x: np.ndarray, ms: float = 1.0) -> np.ndarray:
    """A 1 ms ramp at both ends of a slice: the stutter keeps its rhythm
    without a click at every splice."""
    return dsp.fade(x, ms / 1000, ms / 1000, curve="linear")


def _stutter(slice_: np.ndarray, repeats: int) -> np.ndarray:
    """A stuck buffer: the same slice `repeats` times back to back."""
    return np.concatenate([_edges(slice_)] * repeats)


def _beep(freq: float, dur: float, bright: float = 0.25) -> np.ndarray:
    """A clean computer beep: a sine with a little 2nd and 3rd harmonic
    (reads as 'electronic' without a square's fizz), 2 ms attack, short tail."""
    tone = dsp.additive(freq, dur, ((1, 1.0), (2, bright * 0.6), (3, bright)))
    return tone * dsp.adsr(dur, 0.002, 0.03, 0.7, min(0.012, dur / 3))


def _bleeps(rng: np.random.Generator, seconds: float, step: float = 0.04, scale: tuple[float, ...] = _BLEEP_HZ) -> np.ndarray:
    """The raw buffer the glitches break: random beeps from `scale`, one per
    `step`, over a soft FSK warble. Ordinary computer sound, so a repeat of
    it reads as a stuck buffer."""
    notes = []
    t = 0.0
    while t < seconds:
        f = float(rng.choice(scale)) * float(rng.choice((0.5, 1.0, 1.0)))
        notes.append((f, t, step * float(rng.uniform(0.6, 0.95)), float(rng.uniform(-6, 0))))
        t += step
    beeps = dsp.sequence(notes, lambda f, d: _beep(f, d, 0.4), seconds=seconds)
    bits = "".join(rng.choice(("0", "1"), int(seconds * 1200) + 1))
    warble = dsp.fit(dsp.fsk(bits, 1200, 1300, 2100), seconds)
    return beeps + 0.15 * warble


def _click(rng: np.random.Generator, modes: tuple[tuple[float, float, float], ...], noise: float = 0.5) -> np.ndarray:
    """A mechanical click: decaying sines (`(hz, amp, t60)`, the part's own
    ring) under a sub-millisecond noise tick."""
    dur = max(m[2] for m in modes) + 0.005
    t = dsp.timebase(dur)
    body = sum(a * np.sin(dsp.TAU * f * t) * np.exp(-6.9 * t / t60) for f, a, t60 in modes)
    k = dsp.frames(0.0008)
    tick = np.zeros(len(t))
    tick[:k] = rng.standard_normal(k) * np.exp(-np.arange(k) / (k / 4))
    return body + noise * dsp.highpass(tick, 1500)


def _thump(f0: float, f1: float, dur: float, t60: float) -> np.ndarray:
    """A low thud: a sine falling from `f0` to `f1`, decaying in `t60`."""
    return dsp.sine(dsp.glide(f0, f1, dur)) * dsp.decay(dur, t60, 0.002)


def _mono(x: np.ndarray) -> np.ndarray:
    return dsp.to_mono(x)


# -- the original example ---------------------------------------------------------


def packet_burst(rng: np.random.Generator) -> np.ndarray:
    """A short squirt of data: three FSK packets at rising speeds, each with
    a sync chirp in front, the last one crushed as if it barely got through."""
    s = 0.8  # the third packet ends at 0.72 s: 80 ms of filter tail, no dead air
    layers = []
    at = 0.05
    for i, baud in enumerate((300, 600, 1200)):
        bits = "".join(rng.choice(("0", "1"), 48 + 24 * i))
        chirp = dsp.sine(dsp.glide(900, 2600, 0.04)) * dsp.ar(0.04, 0.002)
        data = dsp.fsk(bits, baud, mark=1200 + 300 * i, space=2200 + 200 * i)
        data = dsp.fade(data, 0.003, 0.006)
        if i == 2:
            data = dsp.downsample(dsp.bitcrush(data, 5), 11025)
        layers += [(chirp, at, -3), (data, at + 0.05, -6)]
        at += 0.05 + len(data) / dsp.RATE + 0.08
    x = dsp.mix(*layers, seconds=s)
    return dsp.highpass(x, 250)


# -- glitches ------------------------------------------------------------------------


def glitch_burst_1(rng: np.random.Generator) -> np.ndarray:
    """The stutter roll: a run of bleeps catches on one slice and repeats it
    faster and faster (60 → 30 → 15 → 7.5 ms, a rising buzz), then slams into
    a crushed, rate-dropped hit."""
    s = 0.8
    src = _bleeps(rng, 0.4, step=0.035)
    head = _edges(_cut(src, 0.0, 0.12))
    grab = _cut(src, 0.07, 0.06)
    roll = [_stutter(grab[: dsp.frames(length)], reps) for length, reps in ((0.06, 3), (0.03, 4), (0.015, 6), (0.0075, 9))]
    hit = _cut(src, 0.2, 0.16)
    hit = _hold(_crush(hit * 1.4, 4), 3000) * dsp.decay(len(hit) / RATE, 0.14)
    hit = dsp.mix(hit * 1.3, _thump(140, 60, 0.16, 0.12) * 0.8, seconds=len(hit) / RATE)
    x = dsp.concat(head, *roll, _edges(hit))
    x = dsp.lowpass(dsp.fit(x, s), 9000)
    return dsp.dc_block(x)


def glitch_burst_2(rng: np.random.Generator) -> np.ndarray:
    """Sample-rate jumps: a bright held chord and its bleeps chopped into
    40–110 ms chunks, each at its own sample rate and bit depth, some read at
    double or half speed, some dropped out, with a high blip at each jump."""
    s = 1.2
    chord = sum(dsp.saw(dsp.cents(dsp.hz(n), c), s + 0.3) for n, c in (("E4", -6), ("B4", 5), ("E5", 0), ("G#5", -4)))
    src = dsp.lowpass(chord, 3500) * 0.35 + _bleeps(rng, s + 0.3, step=0.05)
    rates = (16000, 8000, 5512, 3000, 11025, 2000)
    parts = []
    t = 0.0
    while t < s:
        dur = float(rng.uniform(0.04, 0.11))
        kind = rng.choice(("hold", "hold", "fast", "slow", "drop"))
        piece = _cut(src, t, dur)
        if kind == "fast":
            piece = _vari(_cut(src, t, dur * 2), np.full(dsp.frames(dur), 2.0))
        elif kind == "slow":
            piece = _vari(piece, np.full(dsp.frames(dur), 0.5))
        elif kind == "drop":
            piece = piece * 0.0
        piece = _hold(_crush(piece, float(rng.choice((8, 6, 5, 4)))), float(rng.choice(rates)))
        blip = _beep(float(rng.choice((2637.0, 3136.0, 2349.3))), 0.018, 0.0)
        parts.append(_edges(dsp.mix(piece, (blip, 0.0, -4), seconds=dur)))
        t += dur
    x = dsp.fit(np.concatenate(parts), s) * dsp.line([(0, 1), (s - 0.18, 1), (s - 0.03, 0.0)], s)
    return dsp.filt(x, dsp.Biquad.highpass(90), dsp.Biquad.lowpass(8000))


def glitch_burst_3(rng: np.random.Generator) -> np.ndarray:
    """Backwards and stopping: a data warble plays, a slice of it swells in
    reverse, the whole buffer winds down like a tape stop, and two crushed
    blips (high, low) are all that is left."""
    s = 1.0
    src = _bleeps(rng, 0.8, step=0.03, scale=(1174.7, 1568.0, 1760.0, 2349.3))
    fwd = _edges(_cut(src, 0.0, 0.18))
    rev = _cut(src, 0.18, 0.16)[::-1] * dsp.line([(0, 0.2), (0.16, 1.0)], 0.16)
    stop_len = 0.36
    stop = _vari(_cut(src, 0.3, 0.5), dsp.line([(0, 1.0), (stop_len, 0.02)], stop_len, curve="exp"))
    stop = stop * dsp.line([(0, 1.0), (stop_len * 0.7, 0.8), (stop_len, 0.0)], stop_len)
    hi = _hold(_crush(dsp.square(1975.5, 0.05) * dsp.adsr(0.05, 0.001, 0.02, 0.6, 0.01), 3), 6000)
    lo = _hold(_crush(dsp.square(493.9, 0.08) * dsp.adsr(0.08, 0.001, 0.03, 0.6, 0.02), 3), 6000)
    x = dsp.concat(fwd, _edges(rev), _edges(stop), dsp.silence(0.05), _edges(hi) * 0.5, dsp.silence(0.03), _edges(lo) * 0.6)
    x = dsp.lowpass(dsp.fit(x, s), 7500)
    return dsp.dc_block(x)


def bitcrush_sweep(rng: np.random.Generator) -> np.ndarray:
    """A clean pulsing chord crushed by degrees: the bit depth falls 12 → 2
    and the sample rate 24 kHz → 900 Hz, so it turns from a synth into a
    toy into a broken buzz, then lets go."""
    s = 1.8
    chord = sum(dsp.saw(dsp.cents(dsp.hz(n), c), s) for n, c in (("A3", 0), ("E4", 7), ("A4", -5), ("C#5", 4), ("E5", -3)))
    pulse8 = dsp.gates(s, [(i * 0.1125, 0.08) for i in range(16)], 0.003, 0.02)
    x = dsp.lowpass(chord, 5000) * (0.45 + 0.55 * pulse8) / 4
    bits = dsp.line([(0, 12), (0.2, 12), (1.45, 2.0)], s, curve="exp")
    rate = dsp.line([(0, 24000), (0.2, 24000), (1.5, 900)], s, curve="exp")
    x = _hold(_crush(x, bits), rate)
    x = dsp.lowpass(x, 9000) * dsp.line([(0, 1), (1.35, 1), (s, 0)], s)
    return dsp.dc_block(x)


def corruption_stutter(rng: np.random.Generator) -> np.ndarray:
    """A little four-note phrase that cannot finish: each try is shorter,
    lower and more crushed than the last, until it smears into a buzz."""
    s = 1.5
    phrase_notes = [("C6", 0.0, 0.065), ("G5", 0.07, 0.065), ("E6", 0.14, 0.065), ("D6", 0.21, 0.08)]

    def voice(f: float, d: float) -> np.ndarray:
        return dsp.pulse(f, d, width=0.25) * dsp.adsr(d, 0.002, 0.03, 0.6, 0.015)

    phrase = dsp.lowpass(dsp.sequence(phrase_notes, voice, seconds=0.3), 6000)
    parts = []
    length = 0.3
    for i in range(9):
        speed = 0.96**i
        bits = 12 - i * 1.1
        take = _vari(phrase, np.full(dsp.frames(length), speed))
        take = _hold(_crush(take, bits), 24000 / (1 + 0.6 * i))
        parts.append(_edges(take))
        length *= 0.74 if i < 5 else 0.82
    buzz = _cut(phrase, 0.14, 0.02)
    smear = _hold(_crush(_stutter(buzz, 12), 3), 2500) * dsp.line([(0, 1), (0.24, 0)], 0.24)
    x = dsp.fit(dsp.concat(*parts, _edges(smear) * 0.8), s)
    return dsp.dc_block(dsp.lowpass(x, 8000))


def static_burst(rng: np.random.Generator) -> np.ndarray:
    """A burst of dead-channel TV static: band-limited hiss that flickers in
    level every few frames, crackle on top and a faint mains buzz under."""
    s = 1.2
    hiss = dsp.filt(dsp.white(s, rng), dsp.Biquad.highpass(400, 0.7), dsp.Biquad.lowpass(7500, 0.7), dsp.Biquad.peak(3000, 3, 0.8))
    steps = rng.uniform(0.45, 1.0, int(s / 0.02) + 2)
    flicker = dsp.smooth(np.repeat(steps, dsp.frames(0.02))[: dsp.frames(s)], 0.004)
    crackle = dsp.highpass(dsp.crackle(s, rng, density=90, grain_ms=1.5), 800)
    buzz = dsp.lowpass(dsp.saw(120.0, s), 1500) * 0.06
    env = dsp.line([(0, 0), (0.015, 1), (0.75, 0.85), (s, 0)], s)
    return (hiss * flicker + 0.5 * crackle + buzz) * env


# -- data --------------------------------------------------------------------------------


def data_stream(rng: np.random.Generator) -> np.ndarray:
    """A computer chattering: a rapid patter of beeps, FSK packets, little
    up/down chirps and gaps, 25–150 ms each, over a faint carrier."""
    s = 3.0
    layers = []
    t = 0.04
    while t < s - 0.12:
        kind = rng.choice(("beep", "beep", "beep", "fsk", "chirp", "gap"), p=(0.22, 0.22, 0.16, 0.18, 0.14, 0.08))
        if kind == "beep":
            d = float(rng.uniform(0.02, 0.05))
            layers.append((_beep(float(rng.choice(_BLEEP_HZ)), d), t, float(rng.uniform(-5, 0))))
        elif kind == "fsk":
            d = float(rng.uniform(0.06, 0.15))
            bits = "".join(rng.choice(("0", "1"), int(d * 1200) + 1))
            layers.append((dsp.fade(dsp.fit(dsp.fsk(bits, 1200, 1200, 2200), d), 0.003, 0.004), t, -7))
        elif kind == "chirp":
            d = 0.03
            lo, hi = float(rng.uniform(700, 1100)), float(rng.uniform(1800, 2800))
            f = dsp.glide(lo, hi, d) if rng.random() < 0.6 else dsp.glide(hi, lo, d)
            layers.append((dsp.sine(f) * dsp.adsr(d, 0.002, 0.01, 0.8, 0.008), t, -3))
        else:
            d = float(rng.uniform(0.03, 0.08))
        t += d + float(rng.uniform(0.004, 0.02))
    carrier = dsp.sine(1800.0, s) * 0.03 * dsp.line([(0, 0), (0.1, 1), (s - 0.15, 1), (s, 0)], s)
    x = dsp.mix(*layers, carrier, seconds=s)
    return dsp.filt(x, dsp.Biquad.highpass(200), dsp.Biquad.lowpass(7000))


def download_chirp(rng: np.random.Generator) -> np.ndarray:
    """Data coming in: five rising chirps, each higher and closer together,
    landing on a bright beep with a short echo."""
    s = 1.0
    layers = []
    t = 0.0
    gap = 0.13
    for i in range(5):
        d = 0.06 - 0.006 * i
        f0 = 500 * 1.22**i
        chirp = dsp.additive(dsp.glide(f0, f0 * 2, d), partials=((1, 1.0), (2, 0.2))) * dsp.adsr(d, 0.003, 0.02, 0.8, 0.015)
        layers.append((chirp, t, -2 + i * 0.5))
        t += gap
        gap *= 0.8
    layers.append((_beep(2349.3, 0.16, 0.15) * dsp.decay(0.16, 0.2), t + 0.02))
    x = dsp.mix(*layers, seconds=s)
    return dsp.delay(x, 0.085, feedback=0.3, mix_=0.3, damp=0.4)


def upload_whoosh(rng: np.random.Generator) -> np.ndarray:
    """Data going out: a band of noise sweeping up from a hum to a hiss with
    a rising tone inside it, gone with a small sparkle at the top."""
    s = 1.3
    rise = 1.05
    noise = dsp.pink(s, rng)
    cutoff = dsp.line([(0, 250), (rise, 7000), (s, 9000)], s, curve="exp")
    band = dsp.svf(noise, cutoff, q=2.5, mode="bp")
    tone = dsp.additive(dsp.line([(0, 180), (rise, 1600), (s, 1900)], s, curve="exp"), partials=((1, 1.0), (2, 0.3), (3, 0.12)))
    env = dsp.line([(0, 0.05), (rise * 0.8, 0.8), (rise, 1.0), (s, 0.0)], s, curve="linear") ** 1.5
    spark = dsp.sine(dsp.glide(3000, 4200, 0.12)) * dsp.decay(0.12, 0.1, 0.003)
    x = dsp.mix(band * 2.2 * env, tone * 0.35 * env, (spark, rise, -10), seconds=s)
    room = _mono(dsp.reverb(dsp.pad(x, 0.4), room=0.3, damp=0.6, wet=0.15))
    return dsp.dc_block(dsp.fit(room, s) * dsp.line([(0, 1), (s - 0.08, 1), (s, 0)], s))


def transfer_complete(rng: np.random.Generator) -> np.ndarray:
    """Done: three quick rising beeps, the last one ringing out, with a soft
    echo."""
    s = 1.0
    layers = [
        (_beep(dsp.hz("G5"), 0.07, 0.3), 0.0, -3),
        (_beep(dsp.hz("D6"), 0.07, 0.3), 0.085, -3),
        (_beep(dsp.hz("G6"), 0.45, 0.2) * dsp.decay(0.45, 0.5), 0.17),
    ]
    x = dsp.mix(*layers, seconds=s)
    return dsp.delay(x, 0.11, feedback=0.25, mix_=0.25, damp=0.5)


# -- power -----------------------------------------------------------------------------


def power_up(rng: np.random.Generator) -> np.ndarray:
    """Something charging up: a synth whine climbing from a growl to a high
    sing, swelling, then caught by a relay click and a small thud."""
    s = 1.6
    rise = 1.22
    f = dsp.line([(0, 55), (rise, 1900)], rise, curve="exp")
    f = dsp.vibrato(f, rate=9, depth_cents=10)
    whine = dsp.additive(f, partials=((1, 1.0), (2, 0.45), (3, 0.25), (4, 0.12), (6, 0.05)))
    whine = whine * dsp.line([(0, 0.15), (rise * 0.9, 1.0), (rise, 0.9)], rise) ** 1.3
    whine = dsp.fade(whine, 0.02, 0.006)
    click = _click(rng, ((2300, 1.0, 0.03), (4100, 0.5, 0.02), (900, 0.6, 0.05)), noise=0.8)
    thud = _thump(110, 55, 0.25, 0.18)
    after = dsp.sine(1900.0, 0.35) * dsp.decay(0.35, 0.3)
    return dsp.mix((whine, 0.0, -1), (click, rise, -4), (thud, rise, -4), (after, rise, -18), seconds=s)


def power_down(rng: np.random.Generator) -> np.ndarray:
    """Something switching off: a relay click, then the whine falls away from
    a high sing to a growl and stops with a low thunk."""
    s = 1.8
    fall = 1.3
    click = _click(rng, ((2600, 1.0, 0.025), (4500, 0.4, 0.015), (1100, 0.5, 0.04)), noise=0.8)
    f = dsp.line([(0, 1900), (fall, 38)], fall, curve="exp")
    whine = dsp.additive(f, partials=((1, 1.0), (2, 0.45), (3, 0.25), (4, 0.12)))
    whine = dsp.fade(whine * dsp.line([(0, 1.0), (fall * 0.7, 0.6), (fall, 0.15)], fall), 0.004, 0.05)
    thunk = _thump(85, 38, 0.4, 0.28) + 0.4 * dsp.lowpass(dsp.white(0.4, rng), 400) * dsp.decay(0.4, 0.08)
    return dsp.dc_block(dsp.mix((click, 0.005, -2), (whine, 0.025, -2), (thunk, fall - 0.04, 0), seconds=s))


def crt_power_on(rng: np.random.Generator) -> np.ndarray:
    """An old CRT switching on: a deep thump, the crackling sizzle of static
    charge across the glass, and the faint 15.7 kHz line whine settling in
    (kept gentle: a hint, not a test tone)."""
    s = 2.2
    thump = _thump(62, 34, 0.5, 0.35) + 0.5 * dsp.lowpass(dsp.brown(0.5, rng), 220) * dsp.decay(0.5, 0.15)
    relay = _click(rng, ((1500, 0.7, 0.03), (3200, 0.4, 0.02)), noise=0.5)
    zap_env = dsp.line([(0, 0), (0.03, 1.0), (0.25, 0.7), (1.0, 0.25), (1.7, 0.0)], s) * (1 + 0.4 * dsp.smooth(rng.uniform(-1, 1, dsp.frames(s)), 0.01))
    sizzle = dsp.filt(dsp.white(s, rng), dsp.Biquad.highpass(2500, 0.7), dsp.Biquad.peak(6000, 4, 1.0), dsp.Biquad.lowpass(11000))
    crackle = dsp.highpass(dsp.crackle(s, rng, density=160, grain_ms=1.2), 600)
    crackle = np.tanh(crackle * 4) * 0.3  # no one grain sets the peak
    hum = dsp.lowpass(dsp.saw(60.0, s), 900) * dsp.line([(0, 0), (0.3, 0.03), (1.4, 0.015), (s, 0.0)], s)
    whine = dsp.sine(15734.0, s) * dsp.line([(0, 0), (0.25, 0), (0.9, 1), (s - 0.4, 1), (s, 0)], s)
    x = dsp.mix(
        (thump, 0.005, 0),
        (relay, 0.005, -10),
        (sizzle * zap_env, 0.02, 3),
        (crackle * zap_env, 0.02, 2),
        hum,
        (whine, 0.0, -30),
        seconds=s,
    )
    return dsp.dc_block(x)


def degauss(rng: np.random.Generator) -> np.ndarray:
    """The big CRT degauss: a relay clunk, then a loud buzzing mains hum (60
    Hz and a thick stack of harmonics, the 120–500 Hz buzz pushed so a small
    speaker still says 'hum') with a metallic boing from the shadow mask,
    wobbling as it dies away."""
    s = 2.0
    t = dsp.timebase(s)
    f0 = dsp.vibrato(60.0, s, rate=7, depth_cents=5)
    ph = dsp.phase(f0)
    # random harmonic phases: a dense buzz with a sane crest, not a spike train
    hum = sum((1.0 if k % 2 else 0.7) / k**0.6 * np.sin(dsp.TAU * (k * ph + rng.random())) for k in range(1, 40))
    hum = dsp.peak_eq(dsp.soft_clip(hum / np.abs(hum).max(), 3), 240, 6, 0.8)
    wobble = 1 + 0.3 * dsp.sine(8.0, s) * dsp.decay(s, 1.0)
    # a degauss coil holds full current for a moment, then the thermistor chokes it off
    env = dsp.line([(0, 0), (0.008, 1.0), (0.3, 0.8), (0.9, 0.25), (1.5, 0.05), (s, 0.0)], s) * wobble
    boing_f = dsp.glide(1250, 1150, s)
    boing = dsp.additive(boing_f, partials=((1, 1.0), (2.76, 0.4), (5.4, 0.2))) * dsp.decay(s, 0.9, 0.002)
    boing = boing * (1 + 0.6 * np.sin(dsp.TAU * 120 * t))
    rattle = dsp.bandpass(dsp.ring(dsp.white(s, rng), 120.0), 2200, 1.5) * dsp.decay(s, 0.6)
    clunk = dsp.mix(_click(rng, ((700, 1.0, 0.06), (1800, 0.5, 0.03)), noise=0.6), _thump(120, 60, 0.2, 0.12))
    x = dsp.mix((hum * env, 0.01), (boing * 0.12, 0.01), (rattle * 0.4, 0.01), (clunk, 0.004, -4), seconds=s)
    x = dsp.filt(x, dsp.Biquad.highpass(80, 0.7), dsp.Biquad.lowpass(9000))
    return dsp.dc_block(x)


# -- alerts ------------------------------------------------------------------------------


def scan_beeps(rng: np.random.Generator) -> np.ndarray:
    """An antivirus scanning: a steady tick of short beeps whose pitch rides
    a slow up-and-down sweep, over a faint beam of noise sweeping with it."""
    s = 3.0
    period = 1.5
    step = 0.1
    layers = []
    for i in range(int((s - 0.1) / step)):
        t = i * step
        ph = (t % period) / period
        f = 900 * 2 ** (1.0 - abs(2 * ph - 1))  # 900 → 1800 → 900 Hz
        layers.append((_beep(f, 0.045, 0.2), t + 0.02, -1 if i % 4 == 0 else -4))
    t = dsp.timebase(s)
    ph = (t % period) / period
    beam_f = 1100 * 2 ** (2 * (1 - np.abs(2 * ph - 1)))
    beam = dsp.svf(dsp.white(s, rng), beam_f, q=6, mode="bp") * 0.5
    x = dsp.mix(*layers, beam * dsp.line([(0, 0), (0.2, 1), (s - 0.3, 1), (s, 0)], s), seconds=s)
    return dsp.highpass(x, 200)


def virus_detected(rng: np.random.Generator) -> np.ndarray:
    """An original alarm for 'threat found': two triplets of sharp high
    beeps, then a rough low buzzer (a minor second, chopped at 12 Hz) that
    dies away."""
    s = 1.8

    def triplet() -> np.ndarray:
        return dsp.mix(*[(_beep(1760.0, 0.055, 0.5), i * 0.085) for i in range(3)], seconds=0.26)

    dur = 0.85
    buzz = dsp.pulse(185.0, dur, 0.3) + 0.8 * dsp.pulse(196.0, dur, 0.3) + 0.4 * dsp.saw(370.0, dur)
    buzz = dsp.am(dsp.lowpass(buzz, 3200), 12.0, depth=0.55, shape="square")
    buzz = dsp.soft_clip(buzz * 0.5, 4) * dsp.adsr(dur, 0.005, 0.2, 0.75, 0.3)
    x = dsp.mix((triplet(), 0.0), (triplet(), 0.32), (buzz, 0.7, -2), seconds=s)
    x = dsp.filt(x, dsp.Biquad.highpass(120), dsp.Biquad.peak(2500, 2, 1.0))
    return dsp.dc_block(x)


def bsod_drone(rng: np.random.Generator) -> np.ndarray:
    """A system crashing: a crushed crack, then an ominous low drone (detuned
    saws on A1 and its fifth, slowly breathing) with a plain test-tone sine
    hanging over it, bending a little flat as it fades."""
    s = 4.0
    crack = _hold(_crush(dsp.white(0.18, rng) * 2, 3), 4000) * dsp.decay(0.18, 0.12)
    crack = dsp.mix(dsp.lowpass(crack, 6000), _thump(90, 40, 0.3, 0.25))
    drone = sum(dsp.saw(f, s) * a for f, a in ((55.0, 1.0), (55.35, 0.9), (82.4, 0.6), (110.4, 0.35), (164.6, 0.15)))
    breathe = 0.8 + 0.2 * dsp.sine(0.35, s, phase0=0.75)
    drone = dsp.lowpass(drone, 420, order=4) * breathe
    drone_env = dsp.line([(0, 0), (0.15, 0.2), (1.1, 1.0), (2.8, 1.0), (s, 0.0)], s)
    tone_f = dsp.line([(0, 440.0), (2.2, 440.0), (s, 428.0)], s)
    tone = dsp.sine(dsp.vibrato(tone_f, rate=4.5, depth_cents=3)) * dsp.line([(0, 0), (0.5, 0), (1.0, 1), (3.0, 0.9), (s, 0)], s)
    x = dsp.mix((crack, 0.004, -1), drone * drone_env, (tone, 0.0, -2), seconds=s)
    return dsp.dc_block(x)


def teleport(rng: np.random.Generator) -> np.ndarray:
    """Beamed somewhere: a shimmer of detuned partials sweeping up three
    octaves with a tremolo that speeds from flutter to buzz, a pop at the
    top, all in a small bright room."""
    s = 1.5
    rise = 1.1
    base = dsp.line([(0, 200), (rise, 1500), (s, 1600)], s, curve="exp")
    trem_rate = dsp.line([(0, 7), (rise, 38), (s, 40)], s, curve="exp")
    trem = 0.5 + 0.5 * np.sin(dsp.TAU * dsp.phase(trem_rate))
    shimmer = np.zeros(dsp.frames(s))
    for ratio, amp in ((1.0, 1.0), (1.5, 0.5), (2.003, 0.6), (3.01, 0.35), (4.02, 0.25), (5.03, 0.12)):
        shimmer += amp * dsp.sine(base * ratio, phase0=float(rng.random()))
    env = dsp.line([(0, 0), (0.25, 0.5), (rise, 1.0), (rise + 0.05, 0.0)], s) ** 1.2
    pop = dsp.sine(dsp.glide(900, 2600, 0.05)) * dsp.decay(0.05, 0.05, 0.002)
    x = dsp.mix(shimmer * (0.4 + 0.6 * trem) * env, (pop, rise, 2), seconds=s)
    wet = _mono(dsp.reverb(x, room=0.55, damp=0.3, wet=0.25))
    return dsp.dc_block(wet * dsp.line([(0, 1), (s - 0.1, 1), (s, 0)], s))


SOUNDS: list[Spec] = [
    Spec("packet_burst", "digital", packet_burst, 0.8, note="three FSK data packets at rising speeds, the last one crushed"),
    Spec("glitch_burst_1", "digital", glitch_burst_1, 0.8, note="data glitch: bleeps catch on a slice, roll faster into a buzz, slam into a crushed hit"),
    Spec("glitch_burst_2", "digital", glitch_burst_2, 1.2, note="data glitch: a chord chopped into chunks at jumping sample rates, sped up, slowed, dropped"),
    Spec("glitch_burst_3", "digital", glitch_burst_3, 1.0, note="data glitch: a warble swells backwards, winds down like a tape stop, two crushed blips"),
    Spec("bitcrush_sweep", "digital", bitcrush_sweep, 1.8, note="a pulsing chord crushed by degrees: 12 to 2 bits, 24 kHz to 900 Hz"),
    Spec("corruption_stutter", "digital", corruption_stutter, 1.5, note="a four-note phrase that cannot finish: each try shorter, lower, more crushed"),
    Spec("static_burst", "digital", static_burst, 1.2, note="a burst of dead-channel TV static: flickering hiss, crackle, faint buzz"),
    Spec("data_stream", "digital", data_stream, 3.0, note="a computer chattering: rapid beeps, FSK packets and chirps"),
    Spec("download_chirp", "digital", download_chirp, 1.0, note="data coming in: five rising chirps closing up onto a bright beep"),
    Spec("upload_whoosh", "digital", upload_whoosh, 1.3, note="data going out: a noise band and a tone sweeping up to a sparkle"),
    Spec("transfer_complete", "digital", transfer_complete, 1.0, note="done: three quick rising beeps, the last one ringing"),
    Spec("power_up", "digital", power_up, 1.6, note="a synth whine climbing from a growl to a sing, caught by a relay click"),
    Spec("power_down", "digital", power_down, 1.8, note="a relay click, a whine falling away to a growl, a low thunk"),
    Spec("crt_power_on", "digital", crt_power_on, 2.2, note="an old CRT switching on: thump, static crackle, a faint line whine"),
    Spec("degauss", "digital", degauss, 2.0, note="the CRT degauss: a clunk and a big buzzing hum with a metallic boing"),
    Spec("scan_beeps", "digital", scan_beeps, 3.0, note="an antivirus scanning: steady beeps riding an up-down sweep"),
    Spec("virus_detected", "digital", virus_detected, 1.8, note="an original 'threat found' alarm: two beep triplets and a rough buzzer"),
    Spec("bsod_drone", "digital", bsod_drone, 4.0, note="a system crash: a crushed crack, an ominous low drone, a hanging test tone"),
    Spec("teleport", "digital", teleport, 1.5, note="beamed away: a shimmer sweeping up three octaves, tremolo to buzz, a pop"),
]
