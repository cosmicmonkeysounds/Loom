"""Story: the sounds made for *Trapped in the Internet*'s own beats
(wave 38, C6) — the stand-ins for the story's `sound X` files (each with
`story=` and a matching `library:` key in media/sounds.yaml) and the
show's own little interface sounds.

These sit inside the show's fiction (a computer's insides in 1999), so they
borrow every category's tools: the beans are a thousand tiny resonant
clicks, the glitch is crushed digital, the bell is a church bell's measured
partials, the motorcycle is a pulse train of exhaust pops. Keep the story
stand-ins near the length in their manifest `real:` line.

They play on real speakers at a party, often over music: each one is built
to be recognised in the first half second, and to end in its own decay (the
renderer's 5 ms edge fade is a safety net, not the ending).
"""

from __future__ import annotations

import math

import numpy as np

from . import dsp
from .spec import Spec


def _room(x: np.ndarray, room: float = 0.3, damp: float = 0.5, wet: float = 0.12, predelay: float = 0.0) -> np.ndarray:
    """A mono sound in a room, back to mono (a one-shot is mono)."""
    return dsp.to_mono(dsp.reverb(x, room=room, damp=damp, wet=wet, predelay=predelay))


def _impulses(n: int, at: np.ndarray, amp: np.ndarray) -> np.ndarray:
    """A sparse impulse train: `amp[i]` at sample `at[i]` (summed where they
    meet). Filtering a train once by FFT costs the same as one click, which
    is how a thousand beans stay cheap."""
    out = np.zeros(n)
    keep = (at >= 0) & (at < n)
    np.add.at(out, at[keep].astype(np.int64), amp[keep])
    return out


def _crossings(rate: np.ndarray) -> np.ndarray:
    """Sample indices where an event clock running at `rate` events/s ticks
    (each whole cycle of its cumulative phase): zipper teeth, engine firings."""
    ph = dsp.phase(rate)
    return np.nonzero(np.diff(np.floor(ph)) > 0)[0] + 1


def access_denied(rng: np.random.Generator) -> np.ndarray:
    """A terminal refusing you: two short low buzzes, a rough minor second,
    through a small cheap speaker."""
    s = 0.75

    def buzz(dur: float) -> np.ndarray:
        tone = dsp.square(dsp.hz("A2"), dur) + 0.8 * dsp.square(dsp.hz("A#2"), dur) + 0.3 * dsp.saw(dsp.hz("A3"), dur)
        return tone * dsp.gates(dur, [(0, dur)], 0.004, 0.02)

    x = dsp.mix((buzz(0.2), 0.0), (buzz(0.32), 0.27), seconds=s)
    speaker = dsp.filt(x, dsp.Biquad.highpass(320, 0.9), dsp.Biquad.peak(1400, 6, 1.5), dsp.Biquad.lowpass(4200))
    hum = dsp.white(s, rng) * 0.004
    return dsp.soft_clip(speaker * 0.6, 4) + hum


# -- beans ---------------------------------------------------------------------------


def beans_spill(rng: np.random.Generator) -> np.ndarray:
    """PRINT FAILED: a bag of dried beans poured onto a baking tray. Some
    1000 hard little impacts, Poisson-timed under a pour envelope (a rush,
    a steady stream, the stragglers), each bean ticking at its own pitch and
    bouncing once or twice; the tray rings faintly under them all."""
    s = 3.0
    n = dsp.frames(s)
    density = dsp.line([(0, 0), (0.05, 420), (0.3, 650), (1.5, 520), (2.0, 200), (2.45, 40), (2.75, 6), (2.85, 0)], s)
    first = np.nonzero(rng.random(n) < density / dsp.RATE)[0]
    level = np.minimum(rng.lognormal(-0.6, 0.55, len(first)), 2.0)
    # a bean bounces: one or two smaller hits 12–60 ms later
    at, amp = [first], [level]
    for k, (lo, hi, keep) in enumerate(((0.012, 0.05, 0.7), (0.03, 0.09, 0.35))):
        pick = rng.random(len(first)) < keep
        at.append(first[pick] + (rng.uniform(lo, hi, pick.sum()) * dsp.RATE).astype(np.int64))
        amp.append(level[pick] * rng.uniform(0.15, 0.45, pick.sum()) / (k + 1))
    at_all, amp_all = np.concatenate(at), np.concatenate(amp)
    # each hit goes to one of a handful of resonant "bean" bands, log-spaced
    bands = np.geomspace(1500, 7800, 7) * rng.uniform(0.92, 1.08, 7)
    which = rng.integers(0, len(bands), len(at_all))
    ticks = np.zeros(n)
    for b, f in enumerate(bands):
        sel = which == b
        train = _impulses(n, at_all[sel], amp_all[sel] * rng.choice((-1.0, 1.0), sel.sum()))
        # the energy of a click through a band grows with its width: even them out
        ticks += dsp.filt(train, dsp.Biquad.bandpass(f, 7.0)) * math.sqrt(4000 / f)
    # the heavier beans' knock, and the tray's faint ring under the lot
    all_hits = _impulses(n, at_all, amp_all)
    knock = dsp.filt(all_hits, dsp.Biquad.bandpass(950, 2.5)) * 0.5
    tray = dsp.filt(all_hits, dsp.Biquad.bandpass(1420, 40)) * 0.6 + dsp.filt(all_hits, dsp.Biquad.bandpass(2630, 55)) * 0.4
    hiss = dsp.highpass(dsp.white(s, rng), 3000) * (density / 1200) * 0.08
    x = ticks + knock + tray + hiss
    x = dsp.lowpass(dsp.highpass(x, 250), 11000)
    return _room(x, room=0.28, damp=0.55, wet=0.1)


# -- zipper --------------------------------------------------------------------------


def zipper(rng: np.random.Generator) -> np.ndarray:
    """The Antivirus zips everyone out: a short tug, then one fast pull up a
    jacket zipper, each tooth a tiny click so the teeth themselves are the
    rising "zzzip", ending on the top stop's clack."""
    s = 1.2
    n = dsp.frames(s)
    rate = dsp.line([(0.0, 0), (0.02, 70), (0.1, 95), (0.11, 0),          # the tug: a few slow teeth
                     (0.22, 0), (0.24, 130), (0.42, 300), (0.62, 620), (0.68, 540), (0.70, 0)], s)
    teeth = _crossings(rate)
    period = dsp.RATE / np.maximum(rate[teeth], 60)
    teeth = teeth + (rng.uniform(-0.04, 0.04, len(teeth)) * period).astype(np.int64)
    amp = rng.uniform(0.6, 1.0, len(teeth))
    train = _impulses(n, teeth, amp)
    grain = dsp.white(0.0015, rng) * dsp.decay(0.0015, 0.0012)
    clicks = dsp.convolve(train, grain)
    teeth_sound = dsp.filt(clicks, dsp.Biquad.highpass(700, 0.7), dsp.Biquad.peak(2600, 7, 1.4), dsp.Biquad.peak(5200, 3, 1.0), dsp.Biquad.lowpass(9000))
    slider = dsp.filt(train, dsp.Biquad.bandpass(1150, 3.0)) * 0.6
    # the fabric's rush under the pull, its band rising with the speed
    pull = dsp.gates(s, [(0.23, 0.46)], 0.04, 0.05)
    rush = dsp.svf(dsp.white(s, rng), 900 + 4 * rate, q=1.4, mode="bp") * pull * 0.25
    # the top stop: a heavier double clack
    stop = np.zeros(n)
    for at, a in ((0.705, 1.6), (0.722, 0.7)):
        stop[dsp.frames(at)] = a
    clack = dsp.filt(stop, dsp.Biquad.bandpass(1800, 5)) + dsp.filt(stop, dsp.Biquad.bandpass(3700, 7)) * 0.7 + dsp.filt(stop, dsp.Biquad.bandpass(620, 4)) * 0.5
    x = teeth_sound + slider + rush + clack * 1.4
    return _room(x, room=0.2, damp=0.6, wet=0.08)


# -- the Y2K bell --------------------------------------------------------------------

#: A tuned church bell's partials, relative to the prime (the strike note):
#: (ratio, amplitude, t60 s, doublet beat Hz). The hum and the prime ring
#: longest; the tierce (a minor third) gives a bell its plaintive colour, and
#: the nominal (the octave) with the upper partials at 2 : 3 : 4 makes the
#: strike pitch the ear hears. Real bells are a little out of tune with
#: themselves (the ratios are not exact), and each partial is a near-pair of
#: modes that beats slowly: that wah is what makes it sound like bronze.
BELL = (
    (0.5, 0.55, 6.5, 0.23),
    (1.0, 0.42, 5.2, 0.47),
    (1.187, 0.62, 4.3, 0.71),
    (1.503, 0.22, 2.8, 1.10),
    (2.0, 0.9, 4.2, 0.62),
    (2.51, 0.30, 2.2, 1.30),
    (2.66, 0.26, 2.0, 1.70),
    (3.01, 0.36, 2.2, 1.25),
    (4.07, 0.28, 1.6, 2.10),
    (5.17, 0.14, 0.8, 2.6),
    (5.96, 0.11, 0.6, 3.1),
    (6.86, 0.08, 0.45, 3.7),
    (8.18, 0.06, 0.33, 4.4),
    (9.43, 0.04, 0.25, 5.0),
)


def tower_bell(rng: np.random.Generator) -> np.ndarray:
    """The Y2K hour: one strike of a big clock-tower bell. A church bell's
    fourteen measured partials (hum, prime, tierce, quint, nominal and the
    rest), each a slowly beating pair of modes, struck by a heavy clapper
    (a thud and a brief clang of high modes), heard across a square with
    the buildings answering. It plays six times a night."""
    s = 5.0
    t = dsp.timebase(s)
    prime = dsp.hz("D3")
    body = np.zeros(len(t))
    for ratio, amp, t60, beat in BELL:
        f = prime * ratio * (1 + rng.normal(0, 0.0015))
        ph = rng.uniform(0, dsp.TAU, 2)
        pair = np.sin(dsp.TAU * f * t + ph[0]) + 0.55 * np.sin(dsp.TAU * (f + beat) * t + ph[1])
        attack = 0.004 if ratio < 1.2 else 0.0015
        body += amp * pair * dsp.decay(s, t60, attack=attack)
    # the clapper: high, short-lived inharmonic modes, a dull thud, a knock
    clang = dsp.additive(prime, 0.6, ((10.9, 0.5), (12.6, 0.4), (14.3, 0.3), (16.7, 0.2), (19.2, 0.15))) * dsp.decay(0.6, 0.14)
    thud = dsp.lowpass(dsp.white(0.08, rng), 260, order=4) * dsp.decay(0.08, 0.07, attack=0.002) * 6
    knock = dsp.bandpass(dsp.white(0.02, rng), 1700, 1.2) * dsp.decay(0.02, 0.015) * 1.5
    x = dsp.mix((body, 0.0), (clang, 0.0, -9), (thud, 0.0, -4), (knock, 0.0, -10), seconds=s)
    # an open square: a big diffuse tail, and one far wall's echo
    echo = dsp.lowpass(dsp.delay(x, 0.29, feedback=0.22, mix_=0.5, damp=0.5), 2500)
    x = 0.8 * x + 0.2 * echo
    x = _room(x, room=0.8, damp=0.55, wet=0.2, predelay=0.025)
    # the last second and a half fades the hum into the night (the tail
    # would otherwise be cut at 5 s)
    tail = np.clip((s - t) / 1.6, 0, 1) ** 1.6
    return dsp.dc_block(x * tail)


# -- the motorcycle -------------------------------------------------------------------


def motorcycle(rng: np.random.Generator) -> np.ndarray:
    """Trabolta leaves: a kick-start, the engine catching, a lumpy V-twin
    idle, two blips of the throttle, the clunk into first, then pulling
    away through a gear change, receding (Doppler, distance and air dulling
    the top) until he is gone. The engine is a train of exhaust pops at the
    firing rate (uneven, as a V-twin's are) through the pipe's resonances."""
    s = 7.0
    n = dsp.frames(s)
    t = dsp.timebase(s)
    # firings per second (a four-stroke twin fires twice every two turns: rpm / 60)
    rate = dsp.line([
        (0.0, 0), (0.33, 0), (0.34, 6), (0.55, 13), (0.72, 33), (0.95, 22), (1.3, 14.5),
        (2.45, 14.5), (2.68, 52), (2.8, 50), (3.25, 17), (3.4, 15), (3.62, 68), (3.72, 66), (4.25, 16), (4.6, 14.5),
        (4.85, 17), (5.75, 58), (5.85, 43), (6.9, 74), (7.0, 75),
    ], s)
    rate = rate * dsp.jitter(np.ones(n), rng, cents_rms=18, rate=4)
    # throttle: how hard each firing is (and how bright)
    throttle = dsp.line([
        (0.34, 0.6), (0.6, 0.9), (0.75, 0.5), (1.2, 0.35), (2.45, 0.35), (2.55, 1.0), (2.75, 0.9), (2.82, 0.2),
        (3.3, 0.35), (3.45, 1.0), (3.68, 1.0), (3.75, 0.2), (4.3, 0.35), (4.85, 0.6), (5.0, 1.0), (5.76, 1.0),
        (5.8, 0.25), (5.9, 1.0), (7.0, 1.0),
    ], s)
    fire = _crossings(rate)
    # the V-twin's lope: every other firing comes late (a 315° / 405° beat)
    period = dsp.RATE / np.maximum(rate[fire], 1)
    fire = fire + (np.arange(len(fire)) % 2 * 0.12 * period).astype(np.int64)
    th = throttle[np.minimum(fire, n - 1)]
    amp = (0.2 + 1.0 * th**1.3) * rng.uniform(0.75, 1.1, len(fire))
    weak = (rng.random(len(fire)) < 0.12) & (th < 0.5)
    amp[weak] *= 0.45
    # the first catch sputters
    amp[:3] *= (0.5, 0.7, 0.85)[: len(amp[:3])]
    dark = _impulses(n, fire, amp * (1 - th))
    bright = _impulses(n, fire, amp * th)

    ir_t = dsp.timebase(0.14)
    noise = dsp.white(0.14, rng) * 4

    def exhaust(freqs: tuple[tuple[float, float, float], ...], rasp: float) -> np.ndarray:
        ir = sum(a * np.sin(dsp.TAU * f * ir_t) * np.exp(-ir_t / tau) for f, a, tau in freqs)
        return ir + rasp * noise * np.exp(-ir_t / 0.004)

    ir_dark = exhaust(((72, 1.0, 0.03), (150, 0.55, 0.016), (330, 0.2, 0.008)), 0.08)
    ir_bright = exhaust(((78, 0.9, 0.022), (165, 0.7, 0.013), (420, 0.45, 0.007), (980, 0.2, 0.003)), 0.35)
    engine = dsp.convolve(dark, ir_dark) + dsp.convolve(bright, ir_bright)
    # the intake and the mechanicals: noise that follows the revs
    revs = np.clip(rate / 70, 0, 1.1)
    intake = dsp.lowpass(dsp.pink(s, rng), 700) * throttle * revs * 0.5
    mech = dsp.bandpass(dsp.white(s, rng), 2600, 1.5) * revs * 0.12 * (rate > 0)
    engine = dsp.soft_clip(engine * 0.35 + intake + mech, 6)

    # the kick-start: lever clatter, a thud, the crank turning over twice
    kick = np.zeros(n)
    for at, a in ((0.06, 1.0), (0.085, 0.6), (0.2, 0.5)):
        kick[dsp.frames(at)] = a
    clatter = dsp.filt(kick, dsp.Biquad.bandpass(1700, 6)) + dsp.filt(kick, dsp.Biquad.bandpass(3100, 8)) * 0.6
    thud = dsp.lowpass(dsp.white(s, rng), 180, order=4) * dsp.gates(s, [(0.07, 0.05)], 0.003, 0.05) * 3
    crank = dsp.convolve(_impulses(n, np.array([dsp.frames(0.14), dsp.frames(0.24)]), np.array([0.35, 0.4])), ir_dark)
    # into first gear
    gear = np.zeros(n)
    gear[dsp.frames(4.7)] = 1.0
    clunk = dsp.filt(gear, dsp.Biquad.bandpass(900, 5)) + dsp.filt(gear, dsp.Biquad.bandpass(2100, 7)) * 0.5
    x = dsp.lowpass(engine, 7000) + clatter * 4 + thud * 3 + crank * 0.6 + clunk * 1.2

    # riding away from 4.9 s: distance, Doppler, air
    v = dsp.line([(4.9, 0), (5.75, 9), (5.85, 8.5), (7.0, 19)], s)
    r = 2.5 + np.cumsum(v) / dsp.RATE
    heard = t - (r - 2.5) / 343.0
    x = np.interp(heard, t, x)
    far = np.clip((r - 2.5) / 22, 0, 1)
    x = x * (1 - far) + dsp.lowpass(x, 900) * far
    x = x * np.minimum(1.0, 2.5 / r) ** 0.9
    x = x * np.clip((s - t) / 0.45, 0, 1) ** 2
    return dsp.dc_block(_room(x, room=0.35, damp=0.5, wet=0.1), 30)


# -- the ad hijack jingle ---------------------------------------------------------------

BPM = 126
#: The hook, in beats from the drum pickup (bar 1 starts on beat 2), written
#: an octave above where the marimba plays it. Original: I – IV – ii7 V7 – I,
#: "dum da-da dum" twice, a climbing run, and the "ba-da-BUM" button.
HOOK = (
    ("A5", 1.0, 0.5), ("B5", 1.5, 0.5),
    ("D6", 2.0, 0.75), ("A5", 2.75, 0.25), ("B5", 3.0, 0.5), ("A5", 3.5, 0.5), ("F#5", 4.0, 0.5), ("A5", 4.5, 0.5), ("D6", 5.0, 1.0),
    ("E6", 6.0, 0.75), ("D6", 6.75, 0.25), ("B5", 7.0, 0.5), ("G5", 7.5, 0.5), ("B5", 8.0, 0.5), ("D6", 8.5, 0.5), ("G6", 9.0, 1.0),
    ("F#6", 10.0, 0.5), ("E6", 10.5, 0.5), ("D6", 11.0, 0.5), ("B5", 11.5, 0.5), ("C#6", 12.0, 0.5), ("E6", 12.5, 0.5), ("A6", 13.0, 0.5), ("G6", 13.5, 0.5),
    ("F#6", 14.0, 0.5), ("A5", 15.5, 0.25), ("D6", 16.0, 1.5),
)
#: Brass chord stabs: (start beat, beats, notes).
STABS = (
    (2.0, 0.4, ("D4", "F#4", "A4", "D5")), (3.5, 0.4, ("D4", "F#4", "A4", "D5")), (5.0, 0.8, ("D4", "F#4", "A4", "D5")),
    (6.0, 0.4, ("D4", "G4", "B4", "D5")), (7.5, 0.4, ("D4", "G4", "B4", "D5")), (9.0, 0.8, ("D4", "G4", "B4", "D5")),
    (10.0, 0.4, ("E4", "G4", "B4", "D5")), (11.5, 0.4, ("E4", "G4", "B4", "D5")),
    (12.0, 0.4, ("C#4", "E4", "G4", "A4")), (13.0, 0.8, ("C#4", "E4", "G4", "A4")),
    (14.0, 0.45, ("D4", "F#4", "A4", "D5")), (15.5, 0.25, ("D4", "F#4", "A4", "D5")),
    (16.0, 1.6, ("D4", "F#4", "A4", "D5", "F#5")),
)
#: Each bar's bass root (beats 2–14) and the button's.
ROOTS = (("D2", 2.0), ("G2", 6.0), ("E2", 10.0), ("A2", 12.0))


def _marimba(f: float, dur: float) -> np.ndarray:
    """A marimba bar: the fundamental, its tuned fourth partial (≈ 3.9×) and
    a tenth, each decaying at its own rate, plus the mallet's knock."""
    d = max(dur, 0.7)
    x = (dsp.sine(f, d) * dsp.decay(d, 0.65, attack=0.002)
         + 0.35 * dsp.sine(f * 3.93, d) * dsp.decay(d, 0.16, attack=0.001)
         + 0.1 * dsp.sine(f * 9.2, d) * dsp.decay(d, 0.05))
    return x


def _epiano(f: float, dur: float) -> np.ndarray:
    """The DX-style bell piano that doubled every 90s jingle an octave up."""
    d = max(dur, 0.5)
    idx = 1.8 * dsp.decay(d, 0.25) + 0.15
    return dsp.fm(f, d, ratio=1.0, index=idx) * dsp.decay(d, 0.7, attack=0.002)


def _brass(notes: tuple[str, ...], dur: float, rng: np.random.Generator) -> np.ndarray:
    """A synth-brass stab: two detuned saws a note, a quick scoop up into
    pitch, and a resonant lowpass that blats open and closes as it fades."""
    d = dur + 0.15
    scoop = dsp.line([(0, -35), (0.03, 0)], d)
    x = np.zeros(dsp.frames(d))
    for name in notes:
        f = dsp.hz(name)
        for c in (-7.0, 6.0):
            x += dsp.saw(dsp.cents(f, c + scoop), None, phase0=rng.uniform())
    env = dsp.adsr(d, attack=0.012, decay_s=0.15, sustain=0.75, release=0.12)
    cutoff = dsp.line([(0, 700), (0.035, 4200), (0.2, 2200), (d, 1300)], d, curve="exp")
    return dsp.svf(x * env, cutoff, q=1.3) / len(notes)


def _bass(f: float, dur: float) -> np.ndarray:
    """A plucky synth bass: a round sine body and a saw whose brightness dies
    fast, so each note snaps then sits."""
    d = dur + 0.04
    body = dsp.sine(f, d) + 0.25 * dsp.sine(2 * f, d)
    snap = dsp.lowpass(dsp.saw(f, d), 1400) * dsp.decay(d, 0.12)
    return (body + 0.8 * snap) * dsp.adsr(d, attack=0.003, decay_s=0.08, sustain=0.7, release=0.04)


def _kick(rng: np.random.Generator) -> np.ndarray:
    d = 0.35
    f = dsp.line([(0, 150), (0.05, 52), (d, 46)], d, curve="exp")
    click = dsp.highpass(dsp.white(d, rng), 2500) * dsp.decay(d, 0.008)
    return dsp.sine(f) * dsp.decay(d, 0.3, attack=0.001) + 0.3 * click


def _snare(rng: np.random.Generator) -> np.ndarray:
    d = 0.25
    tone = dsp.sine(dsp.line([(0, 230), (0.03, 185)], d)) * dsp.decay(d, 0.08)
    rattle = dsp.filt(dsp.white(d, rng), dsp.Biquad.highpass(1200), dsp.Biquad.peak(4500, 4, 1)) * dsp.decay(d, 0.17, attack=0.001)
    clap = dsp.mix(*[(dsp.bandpass(dsp.white(0.02, rng), 1600, 1.0) * dsp.decay(0.02, 0.015), k * 0.009) for k in range(3)])
    return dsp.mix(0.6 * tone, 1.6 * rattle, 2.2 * clap)


def _hat(rng: np.random.Generator, length: float = 0.05) -> np.ndarray:
    return dsp.highpass(dsp.white(length + 0.02, rng), 7500, order=4) * dsp.decay(length + 0.02, length)


def ad_jingle(rng: np.random.Generator) -> np.ndarray:
    """The Ad Hijack: a cheesy late-90s TV-ad jingle, instrumental. A drum
    machine pickup, a bright marimba hook doubled by a bell piano, synth
    brass stabs, a bouncing bass over I – IV – ii7 V7, and a "ba-da-BUM"
    button with a crash. An original tune."""
    s = 9.0
    beat = 60 / BPM
    melody = dsp.sequence([(dsp.hz(nm) / 2, st, du) for nm, st, du in HOOK], _marimba, seconds=s, bpm=BPM)
    sparkle = dsp.sequence([(dsp.hz(nm), st, du) for nm, st, du in HOOK], _epiano, seconds=s, bpm=BPM)
    brass = dsp.mix(*[(_brass(notes, du * beat, rng), st * beat) for st, du, notes in STABS], seconds=s)

    bass_notes = []
    for i, (root, start) in enumerate(ROOTS):
        f = dsp.hz(root)
        span = 4.0 if i < 2 else 2.0
        pattern = ((0, 0.5, 1), (0.75, 0.25, 1), (1.5, 0.4, 2), (2.0, 0.5, 1.5), (2.75, 0.25, 1), (3.0, 0.4, 2), (3.5, 0.4, 1.5))
        for off, du, mult in pattern:
            if off < span:
                bass_notes.append((f * mult, start + off, du))
    d2 = dsp.hz("D2")
    bass_notes += [(d2, 14.0, 0.45), (d2 * 1.5, 15.5, 0.25), (d2, 16.0, 1.2)]
    # (mixed by hand: `sequence` would read a bass frequency under 128 as a MIDI note)
    bass = dsp.mix(*[(_bass(f, du * beat), st * beat) for f, st, du in bass_notes], seconds=s)

    kick, snare = _kick(rng), _snare(rng)
    drums = []
    for k in range(8):  # the pickup: a 16th snare roll, crescendo
        drums.append((snare, k * 0.25 * beat, -16 + 2 * k))
    for bar in range(3):
        b0 = 2 + 4 * bar
        for off in (0, 2, 2.5):
            drums.append((kick, (b0 + off) * beat, 0))
        for off in (1, 3):
            drums.append((snare, (b0 + off) * beat, -2))
        for e in range(8):
            drums.append((_hat(rng, 0.18 if e == 7 else 0.04), (b0 + e / 2) * beat, -8 if e % 2 else -12))
    crash_s = 1.8
    crash = dsp.filt(dsp.white(crash_s, rng), dsp.Biquad.highpass(3500), dsp.Biquad.peak(7000, 3, 0.8)) * dsp.decay(crash_s, 1.6, attack=0.002)
    drums += [(kick, 14 * beat, 0), (crash, 14 * beat, -6), (snare, 15.5 * beat, -6), (snare, 15.62 * beat, -3), (kick, 16 * beat, 0), (crash, 16 * beat, -2)]
    drum_bus = dsp.mix(*drums, seconds=s)

    x = dsp.mix((melody, 0.0, -1), (sparkle, 0.0, -13), (brass, 0.0, -2), (bass, 0.0, -5), (drum_bus, 0.0, -3), seconds=s)
    x = dsp.highshelf(dsp.lowshelf(x, 120, 2), 6000, 2)
    x = dsp.soft_clip(dsp.normalize_peak(x, -2), 3)
    x = _room(x, room=0.35, damp=0.5, wet=0.1)
    t = dsp.timebase(s)
    return x * np.clip((s - t) / 0.4, 0, 1)


# -- the Truther download -------------------------------------------------------------


def truther_glitch(rng: np.random.Generator) -> np.ndarray:
    """The Truther Download: a burst of data corruption (stuttering buffer
    repeats, crushed and pitch-jumped grains, dropouts, error blips) that
    freezes into a speeding stutter, then a download chirp sweeps up and two
    blips say it's done."""
    s = 3.6
    src_s = 2.4
    # the material being corrupted: an FM chord, a fast bleep arpeggio, static
    bleep_notes = [(float(rng.choice((392, 523, 659, 784, 1046, 1318))), k * 0.04, 0.035) for k in range(int(src_s / 0.04))]
    bleeps = dsp.sequence(bleep_notes, lambda f, d: dsp.pulse(f, d, 0.3) * dsp.ar(d, 0.002), seconds=src_s)
    chord = dsp.fm(220, src_s, ratio=1.41, index=2.5) + 0.7 * dsp.fm(277, src_s, ratio=2.01, index=1.5)
    src = 0.5 * bleeps + 0.5 * chord + 0.4 * dsp.crackle(src_s, rng, density=120)

    def grain(pos: float, dur: float) -> np.ndarray:
        a = dsp.frames(pos)
        return src[a : a + dsp.frames(dur)]

    def edged(x: np.ndarray) -> np.ndarray:
        return dsp.fade(x, 0.0008, 0.0015, curve="linear")

    parts: list[np.ndarray] = []
    now = 0.0
    while now < 1.75:
        op = rng.choice(("stutter", "crush", "pitch", "reverse", "drop", "blip"), p=(0.27, 0.2, 0.17, 0.1, 0.14, 0.12))
        pos = rng.uniform(0, src_s - 0.3)
        if op == "stutter":
            g = edged(grain(pos, rng.uniform(0.012, 0.05)))
            seg = np.concatenate([g] * int(rng.integers(2, 7)))
        elif op == "crush":
            seg = edged(dsp.bitcrush(dsp.downsample(grain(pos, rng.uniform(0.05, 0.15)), rng.uniform(2000, 6000)), rng.uniform(2.5, 4.5)))
        elif op == "pitch":
            g = grain(pos, 0.2)
            factor = float(rng.choice((0.5, 0.75, 1.5, 2.0)))
            idx = np.arange(0, len(g) - 1, factor)[: dsp.frames(rng.uniform(0.04, 0.1))]
            seg = edged(np.interp(idx, np.arange(len(g)), g))
        elif op == "reverse":
            seg = edged(grain(pos, rng.uniform(0.04, 0.12))[::-1])
        elif op == "drop":
            seg = dsp.silence(rng.uniform(0.02, 0.07))
        else:
            d = rng.uniform(0.03, 0.07)
            seg = dsp.square(rng.uniform(900, 2400), d) * 0.6 * dsp.gates(d, [(0, d)], 0.001, 0.003)
        parts.append(seg * rng.uniform(0.6, 1.0))
        now += dsp.seconds_of(seg)
    # the freeze: one grain repeating faster and faster, rising, into the chirp
    g0 = grain(rng.uniform(0, src_s - 0.3), 0.06)
    length = 0.06
    while length > 0.004:
        g = edged(np.interp(np.linspace(0, len(g0) - 1, dsp.frames(length)), np.arange(len(g0)), g0))
        parts.append(g * 0.9)
        length *= 0.86
    glitch = np.concatenate(parts)
    glitch = dsp.lowpass(dsp.highpass(glitch, 150), 9000)

    # the download: a warbling sweep up, a data hiss riding it, then "done"
    cd = 0.6
    f = dsp.glide(380, 2500, cd) * 2 ** (60 * np.sin(dsp.TAU * 38 * dsp.timebase(cd)) / 1200)
    chirp = dsp.sine(f) * dsp.line([(0, 0), (0.03, 0.8), (0.5, 1.0), (cd, 0.0)], cd)
    data = dsp.svf(dsp.white(cd, rng), f * 1.5, q=3, mode="bp") * 0.5 * dsp.line([(0, 0), (0.1, 1), (cd, 0)], cd)
    done = dsp.concat(
        dsp.sine(dsp.hz("G6"), 0.07) * dsp.ar(0.07, 0.003),
        dsp.silence(0.03),
        dsp.sine(dsp.hz("D7"), 0.24) * dsp.decay(0.24, 0.2, attack=0.003),
    )
    t_glitch = dsp.seconds_of(glitch)
    x = dsp.mix((glitch, 0.0), (chirp + data, t_glitch + 0.04, -4), (done, t_glitch + 0.72, -5), seconds=s)
    return _room(x, room=0.3, damp=0.4, wet=0.1)


# -- the heart monitor -------------------------------------------------------------------

BEAT_HZ = 960.0


def _beep(dur: float) -> np.ndarray:
    """A patient monitor's beep through its small speaker: a near-sine with a
    little second and third harmonic, soft edges."""
    x = dsp.sine(BEAT_HZ, dur) + 0.08 * dsp.sine(2 * BEAT_HZ, dur) + 0.03 * dsp.sine(3 * BEAT_HZ, dur)
    return x * dsp.gates(dur, [(0, dur)], 0.004, 0.02)


def heart_monitor(rng: np.random.Generator) -> np.ndarray:
    """A heart monitor at 70 bpm: seven beeps in exactly six seconds (it
    loops seamlessly), over the faint hiss of the machine."""
    s = 6.0
    period = 60 / 70
    beeps = dsp.mix(*[(_beep(0.11), 0.12 + k * period) for k in range(7)], seconds=s, wrap=True)
    hiss = dsp.bandpass(dsp.pink(s, rng), 2500, 0.6, circular=True) * 0.02
    x = dsp.filt(beeps, dsp.Biquad.highpass(350), dsp.Biquad.peak(2000, 2, 1.0), circular=True) + hiss
    return x


def flatline(rng: np.random.Generator) -> np.ndarray:
    """The monitor's last beats, slowing, then the long unbroken tone."""
    s = 7.0
    beats = (0.15, 1.0, 1.95, 3.05)
    beeps = dsp.mix(*[(_beep(0.11), at, -2.0 * k) for k, at in enumerate(beats)], seconds=s)
    flat_at, flat_end = 4.0, 7.0
    flat = dsp.fit(dsp.pad(_beep(flat_end - flat_at), before=flat_at), s)
    hiss = dsp.bandpass(dsp.pink(s, rng), 2500, 0.6) * 0.02
    x = dsp.filt(beeps + flat * 0.9, dsp.Biquad.highpass(350), dsp.Biquad.peak(2000, 2, 1.0)) + hiss
    t = dsp.timebase(s)
    return x * np.clip((s - t) / 0.8, 0, 1) ** 1.5


SOUNDS: list[Spec] = [
    Spec("access_denied", "story", access_denied, 0.75, note="a terminal refusing you: two low rough buzzes"),
    Spec("beans_spill", "story", beans_spill, 3.0, story="beans_spill",
         note="PRINT FAILED: dried beans poured onto a tray, a rush of rattling clicks thinning to stragglers"),
    Spec("zipper", "story", zipper, 1.2, story="zip", note="a tug and one fast pull of a jacket zipper, ending on the top stop's clack"),
    Spec("tower_bell", "story", tower_bell, 5.0, story="y2k_chime",
         note="the Y2K hour: one strike of a big clock-tower bell, hum, tierce and nominal beating across a square"),
    Spec("motorcycle", "story", motorcycle, 7.0, story="motorcycle",
         note="Trabolta leaves: kick-start, V-twin idle, two revs, into first and riding away with Doppler"),
    Spec("ad_jingle", "story", ad_jingle, 9.0, story="ad_jingle",
         note="the Ad Hijack: an original cheesy 1999 TV-ad jingle, marimba hook, synth brass, drum machine, button ending"),
    Spec("truther_glitch", "story", truther_glitch, 3.6, story="truther_glitch",
         note="the Truther Download: a data-corruption glitch burst freezing into a download chirp and a done blip"),
    Spec("heart_monitor", "story", heart_monitor, 6.0, loop=True, note="a heart monitor beeping at 70 bpm, a seamless 6 s loop"),
    Spec("flatline", "story", flatline, 7.0, note="a heart monitor's last slowing beeps, then the long flatline tone"),
]
