"""Party: horns, fanfares, drums, crowds, game-show stings (wave 38, C6).

Physical toys are a source through a resonator: a buzzing reed (`saw` or
`pulse` with `jitter`) into a paper tube (`bandpass` / `peak_eq`); a popper
is a noise burst with a fast `decay` plus confetti `crackle`. Brass is `saw`
through a lowpass that opens with the note's envelope (`_brass`: the
resonant `svf` so the cutoff moves per sample, a scoop into the pitch and a
vibrato that arrives late, as a player's does).

Drums are cheap and alive the same way: a roll or a crowd is an impulse
train (one impulse per stroke or clap) smeared by a decay kernel into an
envelope that multiplies *fresh* noise, so no two hits are the same grain
(`_hits`); a single hit is a pitched body plus filtered noise (`_snare`,
`_kick`, `_tom`); a cymbal is a few band-limited squares at inharmonic
frequencies, highpassed, over hiss (`_cymbal`).

Three of these stand in for story sounds (`media/sounds.yaml`):
`fanfare` → `award_fanfare`, `clock_tick` → `countdown_tick`, `bingo_start`
→ `bingo_start`. Every melody here is our own.
"""

from __future__ import annotations

import numpy as np

from . import dsp
from .spec import Spec


def _room(x: np.ndarray, room: float = 0.4, wet: float = 0.18, damp: float = 0.5) -> np.ndarray:
    """A room round a mono sound, folded back to mono (a one-shot is mono)."""
    return dsp.to_mono(dsp.reverb(x, room=room, damp=damp, wet=wet))


def _fit(x: np.ndarray, seconds: float) -> np.ndarray:
    """Exactly `seconds` long: cut or pad with silence."""
    n = dsp.frames(seconds)
    return x[:n] if len(x) >= n else np.pad(x, (0, n - len(x)))


# -- drums -------------------------------------------------------------------------


def _hits(seconds: float, times, amps, t60: float, attack: float = 0.0006) -> np.ndarray:
    """An envelope with one decaying spike per hit: impulses at `times` with
    `amps`, smeared by an `attack` / `t60` kernel. Multiply fresh noise by it
    and every stroke is its own grain."""
    n = dsp.frames(seconds)
    imp = np.zeros(n)
    idx = np.clip(np.round(np.asarray(times) * dsp.RATE).astype(np.int64), 0, n - 1)
    np.add.at(imp, idx, np.asarray(amps, dtype=np.float64))
    k = min(n, dsp.frames(t60 * 1.2))
    return dsp.convolve(imp, dsp.decay(k / dsp.RATE, t60, attack=attack))


def _snare(rng: np.random.Generator, seconds: float, tone: float = 190.0, snappy: float = 1.0, t60: float = 0.22) -> np.ndarray:
    """One snare hit: a skin that drops a little in pitch, the wires' hiss."""
    f = dsp.line([(0, tone * 1.15), (0.02, tone)], seconds, curve="exp")
    body = (dsp.sine(f) + 0.45 * dsp.sine(f * 1.59)) * dsp.decay(seconds, 0.1, attack=0.0005)
    wires = dsp.filt(dsp.white(seconds, rng), dsp.Biquad.highpass(1500), dsp.Biquad.peak(4500, 4, 1.0), dsp.Biquad.lowpass(10000)) * dsp.decay(seconds, t60, attack=0.0005)
    return 0.7 * body + 1.6 * snappy * wires


def _kick(rng: np.random.Generator, seconds: float, t60: float = 0.45) -> np.ndarray:
    """A round kick: a sine falling 150 → 52 Hz, a soft beater click."""
    f = dsp.line([(0, 150), (0.06, 52)], seconds, curve="exp")
    click = dsp.bandpass(dsp.white(seconds, rng), 2500, 0.8) * dsp.decay(seconds, 0.008)
    return dsp.sine(f) * dsp.decay(seconds, t60, attack=0.001) + 0.25 * click


def _tom(rng: np.random.Generator, seconds: float, tone: float = 110.0) -> np.ndarray:
    """A floor tom: a skin that sags a few Hz, an overtone, a little stick."""
    f = dsp.line([(0, tone * 1.25), (0.05, tone)], seconds, curve="exp")
    body = (dsp.sine(f) + 0.35 * dsp.sine(f * 1.5)) * dsp.decay(seconds, 0.4, attack=0.001)
    stick = dsp.bandpass(dsp.white(seconds, rng), 900, 0.9) * dsp.decay(seconds, 0.04)
    return body + 0.5 * stick


#: Six squares at inharmonic frequencies: the metallic ring of a cymbal.
_METAL = (231.0, 337.5, 419.0, 563.2, 607.0, 877.3)


def _cymbal(rng: np.random.Generator, seconds: float, t60: float = 1.4, bright: float = 1.0) -> np.ndarray:
    """A crash: metallic squares highpassed into a shimmer, hiss over them,
    a fast extra splash on the strike."""
    metal = sum(dsp.square(f, seconds) for f in _METAL) / len(_METAL)
    shimmer = dsp.filt(metal, dsp.Biquad.highpass(3800), dsp.Biquad.highpass(3800), dsp.Biquad.peak(7500, 4, 0.8))
    hiss = dsp.highpass(dsp.white(seconds, rng), 5500, order=4)
    env = dsp.decay(seconds, t60, attack=0.0015)
    splash = dsp.decay(seconds, 0.12, attack=0.0008)
    return (1.2 * shimmer + 1.4 * hiss) * env * (0.6 + 0.4 * bright) + 1.2 * hiss * splash * bright


def _timpani(rng: np.random.Generator, freq: float, seconds: float, t60: float = 1.4) -> np.ndarray:
    """A timpano: a tuned membrane (partials 1 : 1.5 : 1.99 : 2.44) that
    settles a few cents flat, under a felt mallet's thump."""
    f = dsp.line([(0, freq * 1.02), (0.08, freq)], seconds, curve="exp")
    ring = sum(a * dsp.sine(f * r) * dsp.decay(seconds, t60 * tf, attack=0.002) for r, a, tf in ((1, 1.0, 1.0), (1.5, 0.5, 0.7), (1.99, 0.3, 0.5), (2.44, 0.15, 0.35)))
    thump = dsp.lowpass(dsp.white(seconds, rng), 500) * dsp.decay(seconds, 0.06)
    return ring + 1.2 * thump


# -- brass and melody ---------------------------------------------------------------


def _brass(freq: float, dur: float, rng: np.random.Generator, bright: float = 1.0, vib: bool = True, release: float = 0.15) -> np.ndarray:
    """One brass note, `dur` held plus `release`: a saw (with a little narrow
    pulse for the nasal edge) through a resonant lowpass that flares open on
    the attack and settles, a quick pitch scoop into the note, a vibrato that
    only arrives on a held note, a breath of air."""
    s = dur + release
    t = dsp.timebase(s)
    scoop = dsp.line([(0, 2 ** (-35 / 1200)), (0.045, 1.0)], s, curve="exp")
    f = freq * scoop
    if vib:
        depth = dsp.line([(0, 0), (0.22, 0), (0.6, 14)], s)
        f = f * 2 ** (depth * np.sin(dsp.TAU * 5.4 * t) / 1200)
    f = dsp.jitter(f, rng, cents_rms=2.5, rate=5)
    amp = dsp.adsr(s, attack=0.022, decay_s=0.12, sustain=0.78, release=release)
    flare = dsp.adsr(s, attack=0.03, decay_s=0.18, sustain=0.55, release=release)
    src = dsp.saw(f) + 0.22 * dsp.pulse(f, width=0.22)
    # the opening filter, cheaply: a crossfade between a dark and a bright
    # static resonant lowpass (FFT) driven by the flare, instead of a
    # per-sample svf (a fanfare has two dozen notes)
    dark = dsp.filt(src, dsp.Biquad.lowpass(freq * 1.6 + 250, 1.0))
    open_ = dsp.filt(src, dsp.Biquad.lowpass(min(freq * 1.6 + 3600 * bright, 11000), 1.2))
    tone = dark + (open_ - dark) * np.clip(flare, 0, 1)
    breath = dsp.bandpass(dsp.white(s, rng), min(freq * 4, 6000), 1.5) * amp * 0.12
    return (tone + breath) * amp


def _brass_part(notes, rng: np.random.Generator, seconds: float, bright: float = 1.0, gain_db: float = 0.0, release: float | None = None) -> np.ndarray:
    """A line of `(start, note, dur)` played on `_brass`, mixed `seconds` long;
    `release` overrides the tongued-off default (a final chord dies away)."""
    layers = []
    for start, note, dur in notes:
        # a short note is tongued off quickly so a triplet stays three notes
        rel = release if release is not None else (0.05 if dur < 0.2 else 0.15)
        layers.append((_brass(dsp.hz(note), dur, rng, bright=bright, vib=dur > 0.35, release=rel), start, gain_db))
    return dsp.mix(*layers, seconds=seconds)


def _pluck(freq: float, seconds: float, t60: float = 0.35) -> np.ndarray:
    """A bright synth pluck for arpeggios: FM at ratio 1 (a harmonic, saw-ish
    attack melting to a sine) and a softer octave on top; the index is
    capped for high notes so no sideband aliases."""
    cap = max(0.3, 16000 / freq - 1)
    index = min(2.6, cap) * dsp.decay(seconds, 0.09) + 0.15
    body = dsp.fm(freq, seconds, ratio=1.0, index=index)
    top = dsp.sine(freq * 2, seconds) * dsp.decay(seconds, t60 * 0.5) if freq * 2 < 16000 else 0.0
    return (body + 0.3 * top) * dsp.decay(seconds, t60, attack=0.0015)


# -- the sounds ----------------------------------------------------------------------


def party_horn(rng: np.random.Generator) -> np.ndarray:
    """A paper party blower: a breathy toot that wobbles up as the paper
    unrolls, holds buzzing, then sags as the breath runs out."""
    s = 1.4
    pitch = dsp.line([(0, 330), (0.12, 452), (1.0, 445), (1.25, 400), (s, 380)], s)
    pitch = dsp.jitter(pitch, rng, cents_rms=14, rate=9)
    reed = dsp.pulse(pitch, width=0.34) * 0.6 + dsp.saw(pitch) * 0.4
    tube = dsp.filt(reed, dsp.Biquad.bandpass(1350, 1.4), dsp.Biquad.peak(2700, 5, 3), dsp.Biquad.lowpass(5200))
    breath = dsp.bandpass(dsp.pink(s, rng), 2500, 0.7)
    flutter = 1 + 0.25 * np.sin(dsp.TAU * 23 * dsp.timebase(s)) * dsp.line([(0, 1), (0.25, 0)], s)
    env = dsp.line([(0, 0), (0.03, 1), (1.05, 0.9), (s, 0)], s)
    return (tube * 3 + breath * 0.6) * env * flutter


def drumroll(rng: np.random.Generator) -> np.ndarray:
    """A snare roll that builds for three seconds (strokes quickening 17 → 24
    a second, hands not quite even, a crescendo from a whisper) and lands on
    an accent, a kick and a crash that rings out."""
    s, land = 4.0, 2.9
    rate = dsp.line([(0, 17), (land, 24)], land)
    ph = dsp.phase(rate)
    times = np.flatnonzero(np.diff(np.floor(ph))) / dsp.RATE
    times = times + rng.normal(0, 0.0025, len(times))
    swell = dsp.line([(0, 0.16), (land, 1.0)], land, curve="exp")
    amps = np.interp(times, dsp.timebase(land), swell) * np.where(np.arange(len(times)) % 2, 0.85, 1.0) * rng.uniform(0.88, 1.08, len(times))
    wires_env = _hits(s, times, amps, 0.11)
    skin_env = _hits(s, times, amps, 0.05)
    wires = dsp.filt(dsp.white(s, rng), dsp.Biquad.highpass(1400), dsp.Biquad.peak(4500, 4, 1.0), dsp.Biquad.lowpass(9000)) * wires_env
    skin = (dsp.sine(190, s) + 0.4 * dsp.sine(302, s)) * skin_env
    roll = 4.0 * wires + 0.3 * skin
    hit = s - land
    accent = _snare(rng, hit, snappy=1.2) * 1.2 + _kick(rng, hit) * 0.55 + _cymbal(rng, hit, t60=1.8) * 1.8
    x = dsp.mix((roll, 0.0), (accent, land), seconds=s)
    return dsp.fade(_room(x, room=0.45, wet=0.16), fade_out=0.35)


def fanfare(rng: np.random.Generator) -> np.ndarray:
    """The award fanfare: a brass trio in C (a bugle triplet pickup, a leap
    to C, a quick climb G–C–E–G and a held high C over a full chord), the
    low brass and timpani under the downbeats, a cymbal on the last chord.
    Our own tune, about three seconds."""
    s = 3.4
    lead = [(0.00, "G4", 0.09), (0.12, "G4", 0.09), (0.24, "G4", 0.09), (0.36, "C5", 0.36), (0.78, "G4", 0.15),
            (0.96, "C5", 0.13), (1.12, "E5", 0.13), (1.28, "G5", 0.18), (1.50, "C6", 1.1)]
    second = [(0.00, "E4", 0.09), (0.12, "E4", 0.09), (0.24, "E4", 0.09), (0.36, "G4", 0.36), (0.78, "E4", 0.15),
              (0.96, "G4", 0.13), (1.12, "C5", 0.13), (1.28, "E5", 0.18), (1.50, "G5", 1.1), (1.50, "E5", 1.1)]
    low = [(0.36, "C3", 0.36), (0.78, "G2", 0.3), (1.12, "C3", 0.3), (1.50, "C3", 1.1), (1.50, "G3", 1.1)]
    horns = _brass_part(lead, rng, s, bright=1.15) + _brass_part(second, rng, s, bright=0.9, gain_db=-4) + _brass_part(low, rng, s, bright=0.6, gain_db=-8)
    drums = dsp.mix(
        (_timpani(rng, dsp.hz("C3"), 1.2), 0.36, -3),
        (_timpani(rng, dsp.hz("G2"), 0.6), 0.78, -7),
        (_timpani(rng, dsp.hz("C3"), 1.8), 1.50, -1),
        (_cymbal(rng, 1.8, t60=1.7, bright=0.7), 1.50, -8),
        seconds=s,
    )
    return dsp.fade(_room(horns + drums, room=0.6, wet=0.2), fade_out=0.3)


def sting_reveal(rng: np.random.Generator) -> np.ndarray:
    """The reveal: a 1.3 s swell (noise rushing up through a narrowing
    band, a reversed cymbal) slammed into a dark orchestral hit — low brass
    in D minor, a boom, timpani, a crash — that rings off into the hall."""
    s, hit = 3.5, 1.3
    swell_env = dsp.line([(0, 0.0), (hit, 1.0)], hit) ** 2.2
    rush = dsp.svf(dsp.white(hit, rng), dsp.glide(400, 7000, hit), q=2.2, mode="bp") * swell_env * 2.5
    rev_cym = (_cymbal(rng, hit, t60=hit * 1.5)[::-1]) * dsp.line([(0, 0), (hit - 0.02, 1), (hit, 0)], hit)
    chord = [(0, "D2", 0.9), (0, "A2", 0.9), (0, "D3", 0.9), (0, "F3", 0.9), (0, "A3", 0.9), (0, "D4", 0.8)]
    brass = _brass_part(chord, rng, s - hit, bright=1.5, release=0.7)
    boom = dsp.sine(dsp.line([(0, 75), (0.25, 38)], s - hit, curve="exp")) * dsp.decay(s - hit, 1.1, attack=0.002)
    drums = dsp.mix((_timpani(rng, dsp.hz("D2"), s - hit, t60=1.6), 0, -2), (_cymbal(rng, s - hit, t60=1.9), 0, -5), (_kick(rng, 0.6), 0, -3), seconds=s - hit)
    x = dsp.mix((rush, 0.0, -2), (rev_cym, 0.0, -1), (brass, hit, 0), (boom, hit, -2), (drums, hit), seconds=s)
    return dsp.highpass(_room(x, room=0.75, wet=0.24), 30)


def countdown_beeps(rng: np.random.Generator) -> np.ndarray:
    """Three, two, one, GO: three short A5 beeps a second apart and a long,
    bright A6 GO with an octave under it, a little room."""
    s = 3.8
    def beep(freq: float, dur: float) -> np.ndarray:
        tone = dsp.additive(freq, dur, partials=[(1, 1.0), (2, 0.22), (3, 0.12), (4, 0.05)])
        return tone * dsp.gates(dur, [(0, dur - 0.012)], attack=0.004, release=0.012)

    go = beep(dsp.hz("A6"), 0.6) + 0.6 * beep(dsp.hz("A5"), 0.6)
    go *= dsp.line([(0, 1), (0.6, 0.6)], 0.6)
    x = dsp.mix((beep(dsp.hz("A5"), 0.16), 0.0), (beep(dsp.hz("A5"), 0.16), 1.0), (beep(dsp.hz("A5"), 0.16), 2.0), (go, 3.0, 1.5), seconds=s)
    return dsp.fade(_room(x, room=0.25, wet=0.08), fade_out=0.12)


def clock_tick(rng: np.random.Generator) -> np.ndarray:
    """The countdown's clock: seven seconds of a mechanical clock, tick and
    tock twice a second (the tock lower and softer, a faint escapement click
    just before each), in a small room."""
    s = 7.2
    n = 14
    def click(freqs, amp: float) -> np.ndarray:
        d = 0.09
        ring = sum(a * dsp.sine(f, d) * dsp.decay(d, t60) for f, a, t60 in freqs)
        grain = dsp.highpass(dsp.white(d, rng), 1500) * dsp.decay(d, 0.006)
        knock = dsp.bandpass(dsp.white(d, rng), 420, 1.5) * dsp.decay(d, 0.025)
        return amp * (ring + 0.8 * grain + 0.5 * knock)

    tick = ((2950, 1.0, 0.04), (4420, 0.6, 0.028), (6100, 0.3, 0.02), (1650, 0.4, 0.06))
    tock = ((2230, 1.0, 0.045), (3540, 0.55, 0.03), (5120, 0.25, 0.02), (1260, 0.45, 0.07))
    layers = []
    for i in range(n):
        at = 0.08 + i * 0.5 + rng.normal(0, 0.0015)
        amp = (1.0 if i % 2 == 0 else 0.78) * rng.uniform(0.92, 1.05)
        layers.append((click(tick if i % 2 == 0 else tock, amp), at))
        layers.append((click(tock, amp * 0.12), at - 0.011))  # the escapement, just ahead
    return _room(dsp.mix(*layers, seconds=s), room=0.25, wet=0.12, damp=0.6)


def timer_buzzer(rng: np.random.Generator) -> np.ndarray:
    """Time's up: an electric buzzer, BZZT-BZZT-BZZZZT, a major-third pair
    (233 + 294 Hz) rasped by its 50 Hz armature, through a tinny horn."""
    s = 1.55
    t = dsp.timebase(s)
    tone = dsp.pulse(233.1, s, width=0.4) + 0.8 * dsp.saw(293.7, s)
    rasp = 0.65 + 0.35 * np.sin(dsp.TAU * 50 * t) ** 2
    horn = dsp.filt(tone * rasp, dsp.Biquad.highpass(160), dsp.Biquad.peak(1250, 6, 1.4), dsp.Biquad.peak(2900, 3, 2), dsp.Biquad.lowpass(5000))
    horn = dsp.dc_block(dsp.saturate(horn * 0.4, 0.4))
    env = dsp.gates(s, [(0.0, 0.2), (0.28, 0.2), (0.56, 0.9)], attack=0.006, release=0.03)
    return horn * env


def spin_ticks(rng: np.random.Generator) -> np.ndarray:
    """A prize wheel spun hard: the flapper clacking over the pegs, 22 a
    second slowing to a last lazy click or two, a soft whir of the wheel under
    it fading with its speed."""
    s, stop = 4.6, 4.3
    t = dsp.timebase(s)
    speed = 22 * np.clip(1 - t / stop, 0, 1) ** 1.7
    ph = np.cumsum(speed) / dsp.RATE
    times = np.flatnonzero(np.diff(np.floor(ph))) / dsp.RATE
    amps = rng.uniform(0.85, 1.0, len(times)) * (0.75 + 0.25 * np.interp(times, t, speed / 22))
    def clack(d: float = 0.05) -> np.ndarray:
        noise = dsp.filt(dsp.white(d, rng), dsp.Biquad.bandpass(2800, 1.8), dsp.Biquad.highpass(600)) * dsp.decay(d, 0.012, attack=0.0003)
        body = dsp.sine(1150, d) * dsp.decay(d, 0.02, attack=0.0005)
        return dsp.lowpass(noise * 2.0 + 0.5 * body, 8000)
    layers = [(clack() * a, at) for at, a in zip(times, amps)]
    whir = dsp.bandpass(dsp.pink(s, rng), 320, 0.8) * (speed / 22) * 0.35
    return _room(dsp.mix((whir, 0.0), *layers, seconds=s), room=0.3, wet=0.1)


def applause_synth(rng: np.random.Generator) -> np.ndarray:
    """A crowd's applause: ninety people, each clapping at their own pace and
    pitch, joining over half a second, holding, and dropping out one by one;
    each clap a fresh noise grain through that person's hands' band; a
    living-room's reverb round the lot."""
    s, people = 5.0, 90
    bands = (650.0, 900.0, 1200.0, 1600.0, 2100.0, 2800.0)
    groups: list[list] = [[[], []] for _ in bands]
    for _ in range(people):
        rate = rng.uniform(3.2, 4.8)
        start = rng.exponential(0.3)
        stop = rng.uniform(2.6, 4.6)
        loud = rng.uniform(0.5, 1.0)
        t = start + rng.uniform(0, 1 / rate)
        g = groups[rng.integers(len(bands))]
        while t < stop:
            fade = min(1.0, (t - start) / 0.35 + 0.3) * min(1.0, (stop - t) / 0.8 + 0.2)
            g[0].append(t)
            g[1].append(loud * fade * rng.uniform(0.7, 1.0))
            t += 1 / rate + rng.normal(0, 0.012)
    claps = np.zeros(dsp.frames(s))
    for fc, (times, amps) in zip(bands, groups):
        if times:
            env = _hits(s, times, amps, 0.028, attack=0.0008)
            claps += dsp.bandpass(dsp.white(s, rng) * env, fc, 1.1)
    wash = dsp.bandpass(dsp.pink(s, rng), 1500, 0.5) * dsp.smooth(np.abs(claps), 0.15) * 0.5
    swell = dsp.line([(0, 0.25), (0.7, 1.0)], s)
    x = dsp.highpass((claps + wash) * swell, 250)
    return dsp.fade(_room(x, room=0.55, wet=0.22), fade_out=0.25)


def rimshot(rng: np.random.Generator) -> np.ndarray:
    """Ba-dum-tss: a snare, a floor tom with the kick, then the kick and a
    splashy cymbal left to ring."""
    s = 1.6
    x = dsp.mix(
        (_snare(rng, 0.4, tone=205, snappy=1.1), 0.0),
        (_tom(rng, 0.6, 105) + 0.6 * _kick(rng, 0.6), 0.19, -1),
        (_kick(rng, 0.6), 0.44, -8),
        (_cymbal(rng, 1.15, t60=0.95), 0.44, 5),
        seconds=s,
    )
    return _room(x, room=0.3, wet=0.12)


def sad_trombone(rng: np.random.Generator) -> np.ndarray:
    """Wah, wah, wah, waaah: four descending semitones on a muted trombone
    (a plunger 'wah' opening and closing the filter on each note), the last
    long one wobbling wider and sagging flat. The generic gag."""
    s = 2.9
    notes = [(0.00, "Eb4", 0.36), (0.44, "D4", 0.36), (0.88, "Db4", 0.36), (1.32, "C4", 1.3)]
    layers = []
    for start, name, dur in notes:
        f0 = dsp.hz(name) / 2  # a trombone plays it an octave down
        last = dur > 1
        n_s = dur + 0.1
        t = dsp.timebase(n_s)
        f = f0 * dsp.line([(0, 2 ** (-40 / 1200)), (0.05, 1.0)], n_s, curve="exp")
        if last:
            depth = dsp.line([(0, 0), (0.3, 20), (1.2, 70)], n_s)
            sag = dsp.line([(0, 1.0), (0.95, 1.0), (n_s, 2 ** (-90 / 1200))], n_s, curve="exp")
            f = f * sag * 2 ** (depth * np.sin(dsp.TAU * 5.2 * t) / 1200)
            wah = 0.55 + 0.45 * np.sin(dsp.TAU * 5.2 * t - 1.2) * dsp.line([(0, 0), (0.3, 1)], n_s)
        else:
            wah = dsp.line([(0, 0.15), (0.13, 1.0), (dur, 0.45)], n_s)
        f = dsp.jitter(f, rng, cents_rms=3, rate=6)
        src = dsp.saw(f) + 0.3 * dsp.pulse(f, width=0.3)
        tone = dsp.svf(src, f0 * (1.1 + 9 * wah**2), q=2.4)
        amp = dsp.adsr(n_s, attack=0.03, decay_s=0.1, sustain=0.85, release=0.1)
        layers.append((tone * amp, start))
    x = dsp.mix(*layers, seconds=s)
    return dsp.fade(_room(dsp.highpass(x, 60), room=0.35, wet=0.12), fade_out=0.2)


def airhorn(rng: np.random.Generator) -> np.ndarray:
    """A canned air horn: three blasts (two short, one long), three
    clashing reeds scooping up into their pitch, overdriven through a horn
    bell, the gas hissing under them."""
    s = 2.0
    blasts = [(0.0, 0.2), (0.28, 0.2), (0.56, 1.2)]
    x = np.zeros(dsp.frames(s))
    for start, dur in blasts:
        d = dur + 0.06
        scoop = dsp.line([(0, 2 ** (-160 / 1200)), (0.035, 1.0), (dur, 0.995), (d, 2 ** (-60 / 1200))], d, curve="exp")
        reeds = sum(a * dsp.saw(dsp.jitter(f * scoop, rng, cents_rms=6, rate=8)) for f, a in ((415.0, 1.0), (440.0 * 1.05, 0.8), (523.0, 0.6)))
        hiss = dsp.highpass(dsp.white(d, rng), 3000) * 0.6
        env = dsp.gates(d, [(0, dur)], attack=0.012, release=0.05)
        x += _fit(dsp.pad((reeds + hiss) * env, before=start), s)
    horn = dsp.filt(np.tanh(x * 1.6), dsp.Biquad.highpass(250), dsp.Biquad.peak(1150, 6, 1.2), dsp.Biquad.peak(2600, 4, 1.5), dsp.Biquad.lowpass(7000))
    return dsp.fade(_room(dsp.dc_block(horn), room=0.45, wet=0.14), fade_out=0.2)


def bingo_start(rng: np.random.Generator) -> np.ndarray:
    """The game-show 'let's play!' sting: a bright plucked arpeggio racing up
    two octaves of C, a short brass stab on F and a big one on C ('ta-DAA')
    with a kick, timpani and a crash, glass sparkles twinkling in the tail."""
    s = 2.6
    arp = ["C5", "E5", "G5", "C6", "E6", "G6", "C7"]
    layers = [(_pluck(dsp.hz(nm), 0.5), i * 0.06, -2 + i * 0.4) for i, nm in enumerate(arp)]
    stab = [(0, "F4", 0.1), (0, "A4", 0.1), (0, "C5", 0.1), (0, "F5", 0.1), (0, "F3", 0.1)]
    big = [(0, "C4", 0.85), (0, "E4", 0.85), (0, "G4", 0.85), (0, "C5", 0.85), (0, "E5", 0.85), (0, "C3", 0.85)]
    layers += [
        (_brass_part(stab, rng, 0.4, bright=1.4), 0.46, -3),
        (_brass_part(big, rng, s - 0.66, bright=1.4, release=0.55), 0.66, 0),
        (_kick(rng, 0.5), 0.66, -4),
        (_timpani(rng, dsp.hz("C3"), 1.4), 0.66, -6),
        (_cymbal(rng, s - 0.66, t60=1.6), 0.66, -9),
    ]
    for i, nm in enumerate(("G6", "C7", "E7", "G6", "C7")):
        layers.append((_pluck(dsp.hz(nm), 0.6, t60=0.5) * 0.35, 0.8 + 0.13 * i + rng.uniform(0, 0.03), -6))
    return _room(dsp.mix(*layers, seconds=s), room=0.55, wet=0.2)


def riser(rng: np.random.Generator) -> np.ndarray:
    """A four-second build: white noise through a band climbing 300 Hz → 9
    kHz and three detuned saws gliding up three octaves under an opening
    filter, both swelling hard into the last moment."""
    s = 4.0
    swell = dsp.line([(0, 0.0), (s, 1.0)], s) ** 2
    rush = dsp.svf(dsp.white(s, rng), dsp.glide(300, 9000, s), q=2.0, mode="bp") * 1.8
    f = dsp.glide(110, 880, s)
    saws = sum(dsp.saw(dsp.cents(f, c)) for c in (-14, 0, 13)) / 3
    tone = dsp.svf(saws, dsp.glide(500, 9000, s), q=1.2)
    x = (rush + 0.8 * tone) * (0.04 + swell)
    return dsp.fade(dsp.highpass(x, 60), fade_out=0.04)


SOUNDS: list[Spec] = [
    Spec("party_horn", "party", party_horn, 1.4, note="paper party blower: a buzzy toot that wobbles up, holds, sags"),
    Spec("drumroll", "party", drumroll, 4.0, note="snare roll building for three seconds, landing on an accent and a crash"),
    Spec("fanfare", "party", fanfare, 3.4, story="award_fanfare", note="the award fanfare: an original brass trio in C with timpani and a cymbal"),
    Spec("sting_reveal", "party", sting_reveal, 3.5, note="dramatic reveal: a rushing swell into a dark orchestral D minor hit"),
    Spec("countdown_beeps", "party", countdown_beeps, 3.8, note="3-2-1-GO: three A5 beeps a second apart, a long bright GO"),
    Spec("clock_tick", "party", clock_tick, 7.2, story="countdown_tick", note="countdown clock: seven seconds of mechanical tick-tock in a small room"),
    Spec("timer_buzzer", "party", timer_buzzer, 1.55, note="time's up: electric buzzer BZZT-BZZT-BZZZZT"),
    Spec("spin_ticks", "party", spin_ticks, 4.6, note="prize wheel spun hard: the flapper's clacks slowing to a stop"),
    Spec("applause_synth", "party", applause_synth, 5.0, note="a room of ninety people applauding: swell, hold, die away"),
    Spec("rimshot", "party", rimshot, 1.6, note="ba-dum-tss: snare, tom and kick, a splashy cymbal"),
    Spec("sad_trombone", "party", sad_trombone, 2.9, note="wah wah wah waaah: four falling semitones on a muted trombone"),
    Spec("airhorn", "party", airhorn, 2.0, note="canned air horn: two short blasts and a long one"),
    Spec("bingo_start", "party", bingo_start, 2.6, story="bingo_start", note="game-show let's-play sting: a racing bright arpeggio and a brass ta-DAA"),
    Spec("riser", "party", riser, 4.0, note="four-second build: a noise rush and a saw glide swelling up three octaves"),
]
