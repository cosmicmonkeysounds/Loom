"""Retro: chip-tune blips, power-ups, game-over stings, 8-bit jingles,
early-PC beeps and the machines themselves (wave 38, C6).

The sound of a 1980s sound chip: `pulse` waves at 12.5 / 25 / 50 % width,
a `triangle` bass, a noise channel through `bitcrush`, notes stepped by
`sequence` at frame rate (≈ 60 Hz arpeggios), everything `downsample`d a
little. Use your own melodies: no famous game motif.

The noise channel is a real 15-bit LFSR (`_lfsr`), clocked at a rate that
may fall (an explosion's rumble); its 93-step short mode is the metallic
one. The pulses are polyBLEP band-limited, so a high chip note stays clean.

The machines (a hard drive, a floppy, a keyboard, a dot-matrix printer, a
CD tray, a case fan) are modal: each click is a few decaying sines at the
part's own resonances (`_click`) under a sub-millisecond noise tick, and a
motor is a jittered buzz. The two chords (`startup_tone`, `system_shutdown`)
are warm pads of our own voicing, a swell and a falling roll, not any
operating system's sound.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np

from . import dsp
from .spec import Spec

RATE = dsp.RATE


# -- helpers (this module's own toolkit on top of dsp) ---------------------------


def _chip(width: float) -> dsp.Voice:
    def voice(freq: float, dur: float) -> np.ndarray:
        tone = dsp.pulse(dsp.vibrato(freq, dur, rate=7, depth_cents=12), width=width)
        return tone * dsp.adsr(dur, 0.002, 0.05, 0.6, min(0.04, dur / 2))

    return voice


def _plain(width: float, release: float = 0.02) -> dsp.Voice:
    """A chip note with no vibrato and a short release (arpeggios, blips)."""

    def voice(freq: float, dur: float) -> np.ndarray:
        return dsp.pulse(freq, dur, width=width) * dsp.adsr(dur, 0.002, 0.04, 0.7, min(release, dur / 2))

    return voice


def _tri(freq: float | np.ndarray, seconds: float | None = None) -> np.ndarray:
    """The chip's triangle bass: 4-bit stepped like the real one (16 levels)."""
    return dsp.bitcrush(dsp.triangle(freq, seconds), 4)


@lru_cache(maxsize=2)
def _lfsr(short: bool = False) -> np.ndarray:
    """One period of the noise channel's 15-bit LFSR as ±1: 32767 steps in
    long mode (hiss), 93 in short mode (a metallic buzz)."""
    reg = 1
    tap = 6 if short else 1
    out = []
    seen = set()
    while reg not in seen:
        seen.add(reg)
        out.append(1.0 if reg & 1 else -1.0)
        fb = (reg & 1) ^ ((reg >> tap) & 1)
        reg = (reg >> 1) | (fb << 14)
    return np.array(out)


def _noise(rate: float | np.ndarray, seconds: float, short: bool = False) -> np.ndarray:
    """The noise channel clocked at `rate` Hz (per-sample: a falling rumble)."""
    seq = _lfsr(short)
    n = dsp.frames(seconds)
    clock = np.floor(np.cumsum(np.broadcast_to(np.asarray(rate, dtype=np.float64), (n,)) / RATE)).astype(np.int64)
    return seq[clock % len(seq)]


def _frames60(env: np.ndarray) -> np.ndarray:
    """An envelope stepped at 60 Hz in 16 levels, as a chip's volume register
    moves (then smoothed 1 ms so the steps do not click). The register is
    linear, so anything below 1/30 rounds to silence: give it a linear-ish
    decay (`line`), not a long exponential one, or the tail is cut short."""
    step = dsp.frames(1 / 60)
    held = np.repeat(env[::step], step)[: len(env)]
    return dsp.smooth(np.round(held * 15) / 15, 0.001)


def _click(rng: np.random.Generator, modes: tuple[tuple[float, float, float], ...], noise: float = 0.5, noise_ms: float = 0.8) -> np.ndarray:
    """A mechanical click: decaying sines (`(hz, amp, t60)`, the part's own
    ring) under a short noise tick."""
    dur = max(m[2] for m in modes) + 0.005
    t = dsp.timebase(dur)
    body = sum(a * np.sin(dsp.TAU * f * t) * np.exp(-6.9 * t / t60) for f, a, t60 in modes)
    k = max(2, dsp.frames(noise_ms / 1000))
    tick = np.zeros(len(t))
    tick[:k] = rng.standard_normal(k) * np.exp(-np.arange(k) / (k / 4))
    return body + noise * dsp.highpass(tick, 1500)


def _thump(f0: float, f1: float, dur: float, t60: float) -> np.ndarray:
    """A low thud: a sine falling from `f0` to `f1`, decaying in `t60`."""
    return dsp.sine(dsp.glide(f0, f1, dur)) * dsp.decay(dur, t60, 0.002)


def _wobble(rng: np.random.Generator, f: float, spread: float = 0.06) -> float:
    """A part's resonance, a little different each strike."""
    return f * float(rng.uniform(1 - spread, 1 + spread))


def _pad(notes: list[float], seconds: float, rng: np.random.Generator, detune: float = 7.0) -> np.ndarray:
    """A warm pad: each note two saws a few cents apart and a sine an octave
    down at a whisper, random phases (no flam at the attack)."""
    out = np.zeros(dsp.frames(seconds))
    for f in notes:
        out += dsp.saw(dsp.cents(f, -detune), seconds, phase0=float(rng.random()))
        out += dsp.saw(dsp.cents(f, detune), seconds, phase0=float(rng.random()))
        out += 0.6 * dsp.sine(f, seconds, phase0=float(rng.random()))
    return out / max(1, len(notes))


def _bright_to_dark(x: np.ndarray, dark: float, bright: float, curve: np.ndarray) -> np.ndarray:
    """A filter that opens (or closes) without a per-sample loop: crossfade a
    dark and a bright lowpassed copy along `curve` (0 dark … 1 bright)."""
    return dsp.lowpass(x, dark) * (1 - curve) + dsp.lowpass(x, bright) * curve


def _mono(x: np.ndarray) -> np.ndarray:
    return dsp.to_mono(x)


# -- chip-tune -----------------------------------------------------------------------


def chip_powerup(rng: np.random.Generator) -> np.ndarray:
    """A rising chip-tune power-up: a fast stepped arpeggio climbing two
    octaves on a thin pulse, an octave-up echo on a fatter one, a crushed
    noise sparkle at the top."""
    s = 1.1
    step = 1 / 30
    climb = ["G4", "B4", "D5", "G5", "A5", "C6", "E6", "G6", "B5", "D6", "F#6", "B6"]
    notes = [(n, i * step, step * 0.9) for i, n in enumerate(climb)] + [("G6", len(climb) * step, 0.45)]
    lead = dsp.sequence(notes, _chip(0.125), seconds=s)
    echo = dsp.sequence([(n, t + 0.05, d * 0.8, -9) for n, t, d in notes], _chip(0.5), seconds=s)
    spark = dsp.bitcrush(dsp.highpass(dsp.white(0.3, rng), 5000), 4) * dsp.decay(0.3, 0.25)
    x = dsp.mix(lead, echo, (spark, len(climb) * step, -12), seconds=s)
    # a lowpass, not a 24 kHz sample-and-hold: the hold's images above 12 kHz were fizz
    return dsp.lowpass(x, 11000)


def coin(rng: np.random.Generator) -> np.ndarray:
    """A pickup: two grace notes up a major third and a fifth onto a bright
    ringing top (E6 → G#6 → B6) on a 25 % pulse, with a quiet echo."""
    s = 0.6
    notes = [("E6", 0.0, 0.04), ("G#6", 0.04, 0.04), ("B6", 0.08, 0.42)]

    def voice(f: float, d: float) -> np.ndarray:
        return dsp.pulse(f, d, width=0.25) * _frames60(dsp.line([(0, 0), (0.001, 1.0), (d, 0.0 if d > 0.1 else 0.8)], d) ** 1.5)

    lead = dsp.sequence(notes, voice, seconds=s)
    x = dsp.mix(lead, (lead, 0.07, -12), seconds=s)
    return dsp.lowpass(x, 12000)


def level_up(rng: np.random.Generator) -> np.ndarray:
    """Level up: three quick major arpeggios each a step higher (C, D, E),
    landing on a held E6 with vibrato over a triangle bass."""
    s = 1.5
    step = 0.05
    notes = []
    t = 0.0
    for chord in (("C5", "E5", "G5", "C6"), ("D5", "F#5", "A5", "D6"), ("E5", "G#5", "B5", "E6")):
        for n in chord:
            notes.append((n, t, step * 0.85))
            t += step
    held = ("E6", t, 0.7)
    lead = dsp.sequence(notes, _plain(0.25), seconds=s) + dsp.sequence([held], _chip(0.25), seconds=s)
    harmony = dsp.sequence([("B5", t, 0.7, -6)], _chip(0.5), seconds=s)
    bass = dsp.sequence([("C3", 0.0, 0.2), ("D3", 0.2, 0.2), ("E3", t, 0.7)], lambda f, d: _tri(f, d) * dsp.adsr(d, 0.002, 0.05, 0.9, 0.05), seconds=s)
    return dsp.mix(lead, harmony * 0.7, bass * 0.6, seconds=s)


def game_over(rng: np.random.Generator) -> np.ndarray:
    """Game over: a slow falling A-minor line (E5 C5 A4) on a square, a sad
    turn through F4, and E4 held and bending down to D4 as it fades, over a
    triangle bass."""
    s = 2.6
    q = 0.24
    lead = dsp.sequence([("E5", 0.0, q * 0.9), ("C5", q, q * 0.9), ("A4", 2 * q, q * 0.9), ("F4", 3 * q, q * 1.2)], _chip(0.5), seconds=s)
    last_at, last = 4 * q + 0.08, 1.5
    bend = dsp.line([(0, dsp.hz("E4")), (0.45, dsp.hz("E4")), (last, dsp.hz("D4"))], last, curve="exp")
    tail = dsp.pulse(dsp.vibrato(bend, rate=5, depth_cents=18), width=0.5) * dsp.adsr(last, 0.003, 0.2, 0.7, 0.9)
    bass = dsp.sequence(
        [("A2", 0.0, 3 * q * 0.95), ("F2", 3 * q, q * 1.2), ("E2", last_at, last * 0.9)],
        lambda f, d: _tri(f, d) * dsp.adsr(d, 0.003, 0.1, 0.8, min(0.3, d / 2)),
        seconds=s,
    )
    x = dsp.mix(lead * 0.7, (tail * 0.7, last_at), bass * 0.7, seconds=s)
    return dsp.lowpass(x, 9000)


def jump(rng: np.random.Generator) -> np.ndarray:
    """A jump: a 25 % pulse sliding up a bit more than an octave, quick."""
    s = 0.35
    f = dsp.line([(0, 260), (0.16, 820), (s, 900)], s, curve="exp")
    x = dsp.pulse(f, width=0.25) * _frames60(dsp.line([(0, 1.0), (0.12, 0.8), (s, 0.0)], s))
    return dsp.lowpass(x, 10000)


def laser(rng: np.random.Generator) -> np.ndarray:
    """A laser 'pew': a thin pulse diving from 2.6 kHz to a growl, a fatter
    one a fifth under it, gone in a third of a second."""
    s = 0.45
    f = dsp.line([(0, 2600), (0.3, 180), (s, 150)], s, curve="exp")
    x = dsp.pulse(f, width=0.125) + 0.5 * dsp.pulse(f * 2 / 3, width=0.5)
    x = x * dsp.decay(s, 0.38, 0.001)
    return dsp.dc_block(dsp.lowpass(x, 9000))


def explosion_8bit(rng: np.random.Generator) -> np.ndarray:
    """An 8-bit explosion: the LFSR noise channel clocked down from a hiss to
    a rumble, its volume stepping down at frame rate, a triangle thump under
    the start."""
    s = 1.5
    rate = dsp.line([(0, 12000), (0.08, 6000), (s, 500)], s, curve="exp")
    boom = _noise(rate, s) * _frames60(dsp.line([(0, 0), (0.004, 1.0), (1.45, 0.0)], s) ** 1.6)
    thump = _tri(dsp.glide(160, 40, 0.45)) * dsp.decay(0.45, 0.4, 0.002)
    x = dsp.mix(boom, (thump, 0.0, -2), seconds=s)
    return dsp.dc_block(dsp.lowpass(x, 9000))


def power_pellet(rng: np.random.Generator) -> np.ndarray:
    """Invincible: a dominant-seventh chord arpeggiated at 30 notes a second,
    its pulse width sweeping and the whole thing climbing an octave, a
    triangle root climbing under it, ending on a bright held top."""
    s = 1.6
    run = 1.25
    t = dsp.timebase(run)
    chord = np.array([dsp.hz(n) for n in ("C5", "E5", "G5", "A#5")])
    f = chord[(np.floor(t * 30).astype(int)) % 4] * 2 ** (t / run)
    width = 0.125 + 0.375 * (0.5 - 0.5 * np.cos(dsp.TAU * t * 2.5))
    lead = dsp.pulse(f, width=width) * _frames60(dsp.line([(0, 0.6), (run, 1.0)], run))
    top_d = s - run
    top = dsp.pulse(dsp.vibrato(dsp.hz("C7"), top_d, rate=9, depth_cents=15), width=0.25) * dsp.adsr(top_d, 0.002, 0.05, 0.7, 0.2)
    bass = _tri(dsp.hz("C3") * 2 ** (t / run)) * 0.8
    x = dsp.mix(lead * 0.6, bass, (top * 0.5, run), seconds=s)
    return dsp.lowpass(x, 10000)


# -- the machines ------------------------------------------------------------------------


def hdd_seek(rng: np.random.Generator) -> np.ndarray:
    """An old hard drive at work: the spindle's steady whine, and the head
    actuator chattering in bursts of seeks, each a tiny double click."""
    s = 2.5
    spin = dsp.additive(dsp.jitter(120.0, rng, s, cents_rms=3), partials=((1, 0.25), (2, 0.5), (3, 0.3), (5, 0.12), (8, 0.05)))
    whine = dsp.sine(5400.0, s) * 0.05
    air = dsp.bandpass(dsp.pink(s, rng), 1500, 0.6) * 0.2
    bed = (spin * 0.15 + whine * 0.6 + air * 0.6) * dsp.line([(0, 0), (0.15, 1), (s - 0.25, 1), (s, 0)], s)
    layers = [bed]
    t = 0.12
    while t < s - 0.25:
        for _ in range(int(rng.integers(3, 9))):
            if t >= s - 0.25:
                break
            a = float(rng.uniform(0.5, 1.0))
            click = _click(rng, ((_wobble(rng, 2300), 1.0, 0.012), (_wobble(rng, 4100), 0.5, 0.008), (_wobble(rng, 650), 0.7, 0.025)), noise=0.6)
            stop = _click(rng, ((_wobble(rng, 2600), 0.6, 0.01), (_wobble(rng, 800), 0.5, 0.02)), noise=0.3)
            layers += [(click, t, dsp.lin_to_db(a)), (stop, t + float(rng.uniform(0.004, 0.012)), dsp.lin_to_db(a * 0.7))]
            t += float(rng.uniform(0.025, 0.07))
        t += float(rng.uniform(0.15, 0.4))
    x = dsp.mix(*layers, seconds=s)
    return dsp.highpass(x, 80)


def _steps(rng: np.random.Generator, times: list[float], seconds: float, ir: np.ndarray) -> np.ndarray:
    """A stepper motor: one impulse per step (a little uneven) through the
    mechanism's own ring `ir`; a fast run of steps is a pitched buzz."""
    imp = np.zeros(dsp.frames(seconds))
    for t in times:
        i = dsp.frames(t)
        if i < len(imp):
            imp[i] += float(rng.uniform(0.7, 1.0))
    return dsp.convolve(imp, ir)


def floppy_read(rng: np.random.Generator) -> np.ndarray:
    """A floppy drive reading: the head-load clunk, the stepper's buzzing
    seeks ('brrrt', pitched by the step rate), single track steps while it
    reads over the spindle's whir, and the clunk again at the end."""
    s = 3.0
    ir = _click(rng, ((620, 1.0, 0.03), (1550, 0.7, 0.02), (3200, 0.4, 0.01)), noise=0.4)
    times: list[float] = []

    def run(at: float, count: int, rate: float) -> float:
        times.extend(at + i / rate for i in range(count))
        return at + count / rate

    run(0.3, 34, 320)
    for i in range(6):
        times.append(0.55 + 0.13 * i)
    run(1.4, 50, 420)
    run(1.8, 18, 240)
    for i in range(4):
        times.append(2.0 + 0.11 * i)
    run(2.5, 12, 300)
    stepper = _steps(rng, times, s, ir)
    spindle = dsp.am(dsp.lowpass(dsp.saw(dsp.jitter(100.0, rng, s, cents_rms=10), s), 800), 5.0, depth=0.4)
    spindle = spindle + 0.4 * dsp.bandpass(dsp.pink(s, rng), 900, 1.5)
    spindle = spindle * dsp.line([(0, 0), (0.12, 0), (0.3, 1), (2.75, 1), (2.88, 0), (s, 0)], s) * 0.15
    clunk = dsp.mix(_click(rng, ((1100, 0.8, 0.04), (2700, 0.4, 0.02), (380, 0.9, 0.06)), noise=0.8), _thump(140, 80, 0.12, 0.08))
    x = dsp.mix(stepper, spindle, (clunk, 0.05), (clunk * 0.8, 2.86), seconds=s)
    return dsp.highpass(x, 70)


def _key(rng: np.random.Generator, space: bool = False) -> np.ndarray:
    """One mechanical key: the switch's sharp click and the keycap's hollow
    thock on the way down, a softer clack on the way up. The spacebar is
    lower, longer and rattles on its stabiliser."""
    if space:
        down = _click(rng, ((_wobble(rng, 210), 1.0, 0.09), (_wobble(rng, 520), 0.6, 0.05), (_wobble(rng, 2100), 0.4, 0.015)), noise=0.7)
        rattle = dsp.mix(*[(_click(rng, ((_wobble(rng, 3000, 0.15), 0.25, 0.006),), noise=0.3), 0.008 + 0.009 * i) for i in range(3)])
        down = dsp.mix(down, rattle)
        up = _click(rng, ((_wobble(rng, 260), 0.5, 0.05), (_wobble(rng, 1900), 0.3, 0.012)), noise=0.3)
        gap = float(rng.uniform(0.08, 0.12))
    else:
        down = _click(rng, ((_wobble(rng, 2300, 0.12), 0.8, 0.018), (_wobble(rng, 400, 0.15), 0.9, 0.045), (_wobble(rng, 1150, 0.1), 0.4, 0.03)), noise=0.8)
        up = _click(rng, ((_wobble(rng, 2700, 0.12), 0.4, 0.012), (_wobble(rng, 480, 0.15), 0.4, 0.03)), noise=0.4)
        gap = float(rng.uniform(0.05, 0.09))
    return dsp.mix(down, (up, gap, -4))


def keyboard_typing(rng: np.random.Generator) -> np.ndarray:
    """Someone typing on a clicky mechanical keyboard: words of 2–8 keys at
    an uneven human pace, the spacebar between words, a pause to think."""
    s = 4.0
    layers = []
    t = 0.05
    words = 0
    while t < s - 0.25:
        for _ in range(int(rng.integers(2, 9))):
            if t >= s - 0.25:
                break
            layers.append((_key(rng), t, float(rng.uniform(-5, 0))))
            t += float(np.clip(rng.normal(0.11, 0.03), 0.06, 0.2))
        if t >= s - 0.25:
            break
        layers.append((_key(rng, space=True), t, 0.0))
        words += 1
        t += float(rng.uniform(0.12, 0.2)) + (float(rng.uniform(0.25, 0.45)) if words % 4 == 0 else 0.0)
    x = dsp.mix(*layers, seconds=s)
    return dsp.highpass(x, 100)


def mouse_click(rng: np.random.Generator) -> np.ndarray:
    """One mouse click: a tight plastic tick on the press and a lighter one
    on the release."""
    s = 0.25
    press = _click(rng, ((3200, 1.0, 0.007), (5400, 0.4, 0.004), (1400, 0.5, 0.012)), noise=0.9, noise_ms=0.5)
    release = _click(rng, ((3600, 0.6, 0.006), (1600, 0.3, 0.01)), noise=0.5, noise_ms=0.4)
    x = dsp.mix((press, 0.01), (release, 0.095, -5), seconds=s)
    return dsp.highpass(x, 300)


def _print_line(rng: np.random.Generator, seconds: float, column_hz: float, ir: np.ndarray) -> np.ndarray:
    """One line of dot-matrix print: the head fires a column of pins every
    1/`column_hz` s (characters of 6 columns and a 2-column gap, words with
    spaces), each column as loud as its pin count, through the head's ring."""
    n = dsp.frames(seconds)
    imp = np.zeros(n)
    col = 0
    t = 0.0
    space_left = 0
    while t < seconds:
        if space_left == 0 and rng.random() < 0.03:
            space_left = 8
        in_char = col % 8 < 6
        if in_char and space_left == 0:
            pins = int(rng.binomial(9, 0.4))
            imp[min(n - 1, dsp.frames(t))] = pins / 9
        space_left = max(0, space_left - 1)
        col += 1
        t += 1 / column_hz
    return dsp.convolve(imp, ir)


def dot_matrix_jam(rng: np.random.Generator) -> np.ndarray:
    """A dot-matrix printer printing a line, returning, feeding, starting the
    next — and jamming: the platen motor grinds and stalls against the
    paper, gears skipping, a last clunk and it gives up."""
    s = 5.0
    head_ir = _click(rng, ((2900, 1.0, 0.004), (1650, 0.8, 0.006), (950, 0.5, 0.008)), noise=0.5)
    layers = []
    # line 1, left to right; the carriage motor hums under the print
    line1 = _print_line(rng, 1.25, 1500, head_ir)
    carriage = dsp.lowpass(dsp.pulse(dsp.jitter(185.0, rng, 1.25, cents_rms=12), width=0.3), 1500) * 0.25
    layers += [(line1, 0.12), (carriage * dsp.ar(1.25, 0.02, 1.3), 0.12)]
    # carriage return: a quick motor whir and a stop
    ret = dsp.lowpass(dsp.saw(dsp.glide(220, 330, 0.32)), 2000) * dsp.line([(0, 0), (0.03, 1), (0.28, 1), (0.32, 0)], 0.32) * 0.4
    stop = _click(rng, ((700, 0.9, 0.04), (1900, 0.5, 0.02)), noise=0.6)
    layers += [(ret, 1.42), (stop, 1.74)]
    # line feed: the platen stepper's ratchet
    feed_imp = [1.85 + i / 650 for i in range(40)]
    layers.append(_steps(rng, feed_imp, s, _click(rng, ((1300, 0.6, 0.008), (3100, 0.3, 0.005)), noise=0.3)) * 0.6)
    # line 2 starts, right to left
    line2 = _print_line(rng, 0.7, 1500, head_ir)
    carriage2 = dsp.lowpass(dsp.pulse(dsp.jitter(175.0, rng, 0.7, cents_rms=12), width=0.3), 1500) * 0.25
    layers += [(line2 * dsp.line([(0, 1), (0.55, 1), (0.7, 0.4)], 0.7), 2.05), (carriage2, 2.05)]
    # the jam: the motor strains (a low buzz that sags and surges), gears skip
    jam_at, jam = 2.7, 1.9
    strain_f = dsp.jitter(dsp.line([(0, 140), (0.4, 95), (jam, 70)], jam, curve="exp"), rng, cents_rms=90, rate=6)
    strain = dsp.pulse(strain_f, width=0.35) + 0.6 * dsp.saw(strain_f * 1.5)
    surge = 0.6 + 0.4 * dsp.smooth(rng.uniform(0, 1, dsp.frames(jam)), 0.05) ** 2
    strain = dsp.soft_clip(dsp.lowpass(strain, 1800) * surge * 0.6, 6) * dsp.line([(0, 0), (0.05, 1), (jam - 0.3, 1), (jam, 0)], jam)
    paper = dsp.bandpass(dsp.crackle(jam, rng, density=60, grain_ms=3), 2500, 0.8) * 2.0
    # the grind itself: gritty noise chopped by the straining motor's own cycle
    chop = 0.5 + 0.5 * dsp.pulse(strain_f, width=0.35) / 1.3
    grit = dsp.filt(dsp.white(jam, rng), dsp.Biquad.bandpass(1400, 0.7), dsp.Biquad.lowpass(4500)) * chop * surge
    grit = grit * dsp.line([(0, 0), (0.1, 1), (jam - 0.3, 1), (jam, 0)], jam)
    layers += [(strain, jam_at, -2), (paper, jam_at, -6), (grit, jam_at, -1)]
    t = jam_at + 0.1
    while t < jam_at + jam - 0.3:
        skip = dsp.mix(_click(rng, ((_wobble(rng, 1200, 0.1), 1.0, 0.03), (_wobble(rng, 2500, 0.1), 0.6, 0.015)), noise=1.0), _thump(160, 90, 0.06, 0.05))
        layers.append((skip, t, float(rng.uniform(-6, 0))))
        t += float(rng.uniform(0.07, 0.14))
    final = dsp.mix(_click(rng, ((520, 1.0, 0.08), (1300, 0.6, 0.04)), noise=0.8), _thump(110, 60, 0.2, 0.15))
    layers.append((final, jam_at + jam - 0.25))
    x = dsp.mix(*layers, seconds=s)
    return dsp.dc_block(dsp.filt(x, dsp.Biquad.highpass(70), dsp.Biquad.lowpass(10000)))


def cd_tray(rng: np.random.Generator) -> np.ndarray:
    """A CD tray ejecting: the latch click, the little gear motor whirring
    it out, the thunk at the end of travel and the disc settling."""
    s = 1.6
    latch = _click(rng, ((2500, 0.8, 0.012), (4200, 0.4, 0.008)), noise=0.7)
    run = 0.85
    mf = dsp.jitter(dsp.line([(0, 80), (0.1, 105), (run, 112)], run), rng, cents_rms=15, rate=20)
    motor = dsp.lowpass(dsp.saw(mf), 2500) + 0.25 * dsp.sine(mf * 14)
    motor = motor + 0.5 * dsp.bandpass(dsp.pink(run, rng), 1800, 0.8)
    motor = motor * dsp.line([(0, 0), (0.04, 1), (run - 0.05, 1), (run, 0.2)], run)
    thunk = dsp.mix(_click(rng, ((900, 1.0, 0.05), (1700, 0.5, 0.03), (300, 0.8, 0.06)), noise=0.6), _thump(130, 70, 0.18, 0.12))
    settle = dsp.mix(*[(_click(rng, ((_wobble(rng, 3300, 0.1), 0.3, 0.006),), noise=0.2), 0.03 * i + 0.01 * i * i) for i in range(4)])
    x = dsp.mix((latch, 0.01), (motor * 0.4, 0.06), (thunk, 0.06 + run - 0.02), (settle, 0.06 + run + 0.06, -8), seconds=s)
    return dsp.dc_block(dsp.highpass(x, 60))


def fan_spin_up(rng: np.random.Generator) -> np.ndarray:
    """A PC case fan spinning up from rest: a switch tick, then the blade
    hum and the rush of air rising together toward full speed, the motor's
    small whine on top."""
    s = 3.2
    t = dsp.timebase(s)
    speed = 1 - np.exp(-np.maximum(0, t - 0.05) / 0.75)  # 0 → 1 (≈ 2400 rpm)
    rpm = 2400 * speed
    blade = 7 * rpm / 60  # blade pass, → 280 Hz
    hum = dsp.additive(np.maximum(blade, 1.0), partials=((1, 1.0), (2, 0.35), (3, 0.15)))
    motor = dsp.sine(np.maximum(rpm / 60 * 12, 1.0)) * 0.2
    air = dsp.svf(dsp.pink(s, rng), 300 + 5 * blade, q=0.9, mode="bp") * 1.6
    air = air * (1 - 0.3 + 0.3 * (0.5 + 0.5 * np.sin(dsp.TAU * dsp.phase(np.maximum(blade, 0.0)))))
    body = (hum * 0.35 + motor + air) * speed**1.5
    tick = _click(rng, ((1800, 0.6, 0.015), (3500, 0.3, 0.008)), noise=0.5)
    x = dsp.mix(body * dsp.line([(0, 1), (s - 0.5, 1), (s, 0)], s), (tick, 0.01, -6), seconds=s)
    return dsp.dc_block(dsp.highpass(x, 40))


# -- the chords ----------------------------------------------------------------------------


def startup_tone(rng: np.random.Generator) -> np.ndarray:
    """An original warm computer-startup swell: an E♭ major-ninth-and-sixth
    pad that blooms open (dark to bright) over half a second, a soft FM
    bell on top as it arrives, and a long glowing tail in a room."""
    s = 3.2
    voicing = [dsp.hz(n) for n in ("Eb3", "Bb3", "F4", "G4", "C5", "D5")]
    pad = _pad(voicing, s, rng) + 0.25 * dsp.sine(dsp.hz("Eb2"), s)
    open_ = dsp.line([(0, 0), (0.6, 1), (1.4, 0.8), (s, 0.4)], s) ** 1.5
    pad = _bright_to_dark(pad, 500, 3200, open_)
    env = dsp.line([(0, 0), (0.45, 0.9), (0.8, 1.0), (1.5, 0.75), (s, 0.0)], s) ** 1.3
    bell_d = 2.2
    bell = dsp.fm(dsp.hz("Bb5"), bell_d, ratio=3.5, index=dsp.line([(0, 2.0), (bell_d, 0.1)], bell_d)) * dsp.decay(bell_d, 1.6, 0.01)
    x = dsp.mix(pad * env, (bell, 0.38, -9), seconds=s)
    room = _mono(dsp.reverb(x, room=0.75, damp=0.55, wet=0.22))
    return dsp.dc_block(room * dsp.line([(0, 1), (s - 0.2, 1), (s, 0)], s))


def system_shutdown(rng: np.random.Generator) -> np.ndarray:
    """An original, wistful shutdown chord: four soft electric-piano notes
    falling (G5 D5 B♭4 F4), settling on an E♭ major-seventh pad that dims
    and sags a little flat as the machine goes to sleep."""
    s = 3.0
    falling = [("G5", 0.0), ("D5", 0.2), ("Bb4", 0.4), ("F4", 0.6)]

    def ep(freq: float, dur: float) -> np.ndarray:
        idx = dsp.line([(0, 1.8), (dur, 0.15)], dur)
        return dsp.fm(freq, dur, ratio=1.0, index=idx) * dsp.decay(dur, 2.2, 0.004)

    keys = dsp.sequence([(n, at, s - at - 0.1) for n, at in falling], ep, seconds=s)
    sag = dsp.line([(0, 1.0), (1.8, 1.0), (s, 2 ** (-35 / 1200))], s, curve="exp")
    chord = np.zeros(dsp.frames(s))
    for name in ("Eb3", "Bb3", "D4", "G4"):
        f0 = dsp.hz(name)
        chord += dsp.saw(dsp.cents(f0, -6) * sag, phase0=float(rng.random())) + dsp.saw(dsp.cents(f0, 6) * sag, phase0=float(rng.random()))
    chord = chord / 8 + 0.3 * dsp.sine(dsp.hz("Eb2") * sag)
    dim = dsp.line([(0, 0.6), (0.9, 1.0), (s, 0.0)], s)
    chord = _bright_to_dark(chord, 350, 1800, dim)
    chord_env = dsp.line([(0, 0), (0.6, 0.0), (1.0, 0.8), (1.6, 0.7), (s, 0.0)], s)
    x = dsp.mix(keys * 0.55, chord * chord_env, seconds=s)
    x = x * dsp.line([(0, 1), (1.8, 1), (s, 0.0)], s)
    room = _mono(dsp.reverb(x, room=0.7, damp=0.6, wet=0.2))
    return dsp.dc_block(room)


SOUNDS: list[Spec] = [
    Spec("chip_powerup", "retro", chip_powerup, 1.1, note="8-bit power-up: a stepped pulse arpeggio climbing two octaves"),
    Spec("coin", "retro", coin, 0.6, note="8-bit pickup: two grace notes onto a ringing top, 25 % pulse"),
    Spec("level_up", "retro", level_up, 1.5, note="8-bit level up: three rising major arpeggios onto a held note"),
    Spec("game_over", "retro", game_over, 2.6, note="8-bit game over: a slow falling minor line, the last note bending down"),
    Spec("jump", "retro", jump, 0.35, note="8-bit jump: a pulse sliding up an octave"),
    Spec("laser", "retro", laser, 0.45, note="8-bit laser: a thin pulse diving from 2.6 kHz to a growl"),
    Spec("explosion_8bit", "retro", explosion_8bit, 1.5, note="8-bit explosion: LFSR noise clocked down to a rumble, stepped volume, a thump"),
    Spec("power_pellet", "retro", power_pellet, 1.6, note="8-bit invincibility: a fast seventh-chord arpeggio climbing an octave"),
    Spec("hdd_seek", "retro", hdd_seek, 2.5, note="an old hard drive: spindle whine and bursts of head-seek clicks"),
    Spec("floppy_read", "retro", floppy_read, 3.0, note="a floppy drive reading: clunk, stepper buzzes and ticks, spindle whir"),
    Spec("keyboard_typing", "retro", keyboard_typing, 4.0, note="typing on a clicky mechanical keyboard, spacebar between words"),
    Spec("mouse_click", "retro", mouse_click, 0.25, note="one mouse click: press and release"),
    Spec(
        "dot_matrix_jam", "retro", dot_matrix_jam, 5.0, story="printer_grind",
        note="a dot-matrix printer prints a line, feeds, starts the next and jams: grinding, gears skipping",
    ),
    Spec("startup_tone", "retro", startup_tone, 3.2, note="an original warm startup swell: an E-flat pad blooming open, a soft bell"),
    Spec(
        "system_shutdown", "retro", system_shutdown, 3.0, story="windows_shutdown",
        note="an original wistful shutdown chord: four falling e-piano notes onto a dimming pad",
    ),
    Spec("cd_tray", "retro", cd_tray, 1.6, note="a CD tray ejecting: latch click, gear motor whir, thunk"),
    Spec("fan_spin_up", "retro", fan_spin_up, 3.2, note="a PC case fan spinning up from rest: blade hum and rushing air"),
]
