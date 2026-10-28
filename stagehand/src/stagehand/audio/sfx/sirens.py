"""Sirens: wails, yelps, klaxons, alarms (wave 38, C6).

Two families, two voices:

- **Electronic sirens** (the wail, the yelp, the hi-lo, the passing police
  car, the server room's alarm) are a band-limited square driving a horn
  speaker: `_horn` gives every one of them the same throat (a 5 kHz roll-off,
  a honk near 1.6 kHz, a touch of drive), so they read as one family and
  differ only in their pitch curves, which is how real ones differ too.
- **Mechanical sirens** (the air raid) are a rotor chopping air through
  ports: pitch is the rotor's speed, so it winds up and coasts down on
  motor curves, and the tone is a hollow odd-harmonic buzz with a breath of
  air through it (`_rotor`).

Bells (the fire bell) are struck resonators: a hammer's strike train
convolved with one impulse response of inharmonic, separately decaying
partials (`_struck`), which is exact, cheap (one FFT convolution) and gives
the real bell's shimmer for free, because each strike lands at a different
phase of the ringing.

Every pitch curve is smoothed (`dsp.smooth`) so a step never clicks, and
every sound ends in its own decay or reverb tail.
"""

from __future__ import annotations

import numpy as np

from . import dsp
from .spec import Spec

# -- shared voices --------------------------------------------------------------


def _horn(f: np.ndarray, drive: float = 0.25, honk_hz: float = 1600, bright: float = 0.6) -> np.ndarray:
    """An electronic siren driver into a horn speaker at per-sample pitch `f`:
    a polyBLEP square (`bright` of it) blended with a triangle, a little drive
    for grit, then the horn: rolled off above 5.5 kHz (no aliasing hash from
    the drive), a honk at `honk_hz`, nothing below 300 Hz (a horn cannot
    move air down there)."""
    x = bright * dsp.square(f) + (1 - bright) * dsp.triangle(f)
    x = dsp.saturate(0.85 * x, drive)
    x = dsp.lowpass(x, 5500, order=4)
    x = dsp.peak_eq(x, honk_hz, 5, 0.9)
    return dsp.highpass(dsp.dc_block(x, 40), 300)


def _street(x: np.ndarray, seconds: float, room: float = 0.55, wet: float = 0.2, damp: float = 0.6) -> np.ndarray:
    """`x` heard outdoors among buildings: a short reverb whose tail is kept
    (the input is padded) and cut to `seconds`, folded to mono."""
    wetted = dsp.reverb(dsp.pad(x, after=1.0), room=room, damp=damp, wet=wet, width=0.4)
    return dsp.fit(dsp.to_mono(wetted), seconds)


def _rotor(f: np.ndarray, rng: np.random.Generator, seconds: float) -> np.ndarray:
    """A mechanical siren rotor at per-sample pitch `f`: odd harmonics (the
    ports open and shut like a square, softened by the air), a little even
    content (the ports are not quite even), and air hiss through the ports
    whose level rises with the rotor's speed."""
    partials = [(1, 1.0), (2, 0.10), (3, 0.40), (4, 0.04), (5, 0.20), (7, 0.10), (9, 0.05), (11, 0.025)]
    tone = dsp.additive(f, partials=partials)
    top = max(1.0, float(f.max()))
    air = dsp.bandpass(dsp.white(seconds, rng), 1500, 0.7)[: len(f)] * (0.1 + 0.9 * (f / top) ** 2)
    return tone + 0.3 * air


def _struck(strikes: np.ndarray, partials: list[tuple[float, float, float]], f0: float, ir_seconds: float) -> np.ndarray:
    """A struck resonator: `strikes` (an impulse train, one sample per hit,
    its value the hit's force) convolved with a bank of decaying sines, each
    `(ratio × f0, amp, t60)`. A strike that lands while the bell is still
    ringing adds to it at whatever phase it is in, so a fast hammer gives the
    real shimmer and beat of an electric bell."""
    t = dsp.timebase(ir_seconds)
    ir = np.zeros_like(t)
    for ratio, amp, t60 in partials:
        ir += amp * np.exp(-6.907755 * t / t60) * np.sin(dsp.TAU * ratio * f0 * t)
    return dsp.convolve(strikes, ir)


def _envelope(points: list[tuple[float, float]], seconds: float) -> np.ndarray:
    return dsp.line(points, seconds)


# -- the electronic family ---------------------------------------------------------


def siren_wail(rng: np.random.Generator) -> np.ndarray:
    """The US electronic wail: two slow rises and falls between 600 and 1400
    Hz, the rise slowing as it nears the top and the fall gathering speed
    (as the old rotor sirens did, which the electronics imitate), a horn
    speaker's square-wave edge and a little slapback off the street."""
    s = 8.0
    contour = dsp.sweep(
        [(0, 600), (1.7, 1380), (2.2, 1400), (4.1, 640), (4.3, 620), (6.0, 1380), (6.5, 1400), (s, 820)], s
    )
    f = dsp.jitter(dsp.smooth(contour, 0.22), rng, cents_rms=4, rate=5)
    body = _horn(f, drive=0.3)
    env = _envelope([(0, 0), (0.06, 1), (7.3, 1), (s, 0)], s)
    return _street(body * env, s)


def _yelp_curve(seconds: float, rate: float = 3.4, lo: float = 620, hi: float = 1420) -> np.ndarray:
    """The yelp's pitch: a fast rise (45 % of each cycle) and a slightly
    slower fall, in pitch (exponential) between `lo` and `hi`, with its
    corners rounded so it warbles rather than zips."""
    t = dsp.timebase(seconds)
    p = (t * rate) % 1.0
    tri = np.where(p < 0.45, p / 0.45, (1 - p) / 0.55)
    tri = dsp.smooth(tri, 0.012)
    return lo * (hi / lo) ** np.clip(tri, 0, 1)


def siren_yelp(rng: np.random.Generator) -> np.ndarray:
    """The yelp: the same horn swept fast (≈ 3.4 times a second) between 620
    and 1420 Hz, the urgent "the car is right behind you" setting."""
    s = 4.5
    f = dsp.jitter(_yelp_curve(s), rng, cents_rms=3, rate=6)
    body = _horn(f, drive=0.3)
    env = _envelope([(0, 0), (0.04, 1), (4.2, 1), (s, 0)], s)
    return _street(body * env, s, wet=0.18)


def siren_hi_lo(rng: np.random.Generator) -> np.ndarray:
    """A two-tone hi-lo: 1050 and 790 Hz (about a fourth apart), 0.55 s each,
    the steps glided over 12 ms so they never click; a brighter, more nasal
    horn than the wail."""
    s = 6.6
    step = 0.55
    t = dsp.timebase(s)
    stepped = np.where(np.floor(t / step) % 2 == 0, 1050.0, 790.0)
    f = dsp.jitter(dsp.smooth(stepped, 0.012), rng, cents_rms=2, rate=4)
    body = _horn(f, drive=0.35, honk_hz=1300, bright=0.75)
    env = _envelope([(0, 0), (0.03, 1), (6.05, 1), (6.2, 0)], s)
    return _street(body * env, s, wet=0.18)


def siren_doppler_pass(rng: np.random.Generator) -> np.ndarray:
    """A police car passes at ≈ 80 km/h, 6 m away: its wail's
    pitch is shifted by the Doppler factor (up as it comes, a clear drop as it
    passes), its level follows 1/distance (louder in front, where the horn
    points), the air dulls it as it goes (a moving lowpass), and the tyres
    hiss past under it."""
    s = 9.0
    t = dsp.timebase(s)
    v, d0, t_close, c = 22.0, 6.0, 4.2, 343.0
    x = v * (t - t_close)
    r = np.sqrt(x**2 + d0**2)
    radial = v * x / r  # > 0 going away
    doppler = c / (c + radial)
    contour = dsp.sweep([(0, 700), (1.1, 1350), (2.3, 760), (3.4, 1350), (4.6, 760), (5.7, 1350), (6.9, 760), (8.0, 1350), (s, 900)], s)
    f = dsp.smooth(contour, 0.18) * doppler
    near = d0 / r
    facing = np.where(x < 0, 1.0, 0.55 + 0.45 * np.exp(-x / 6))  # the horn faces forward
    body = _horn(f, drive=0.3) * near * facing
    dulled = dsp.svf(body, 1800 + 7000 * near**1.5, 0.6, "lp")
    tyres = dsp.bandpass(dsp.pink(s, rng), 700, 0.6) * near**2 * 0.5
    env = _envelope([(0, 0), (0.5, 1), (8.4, 1), (s, 0)], s)
    return _street((dulled + tyres) * env, s, room=0.6, wet=0.16)


# -- mechanical and struck ----------------------------------------------------------


def siren_air_raid(rng: np.random.Generator) -> np.ndarray:
    """A huge dual-tone air-raid siren a long way off: the motor winds the
    rotor up over five seconds (fast at first, then straining), it howls
    with a minor third between its two rotors, the rotating head sweeps its
    beam past you every 3.6 s (louder, brighter, a few cents sharp as it
    faces you), then it coasts down for six seconds. The two rotors' slight
    mismatch beats slowly against itself."""
    s = 16.0
    t = dsp.timebase(s)
    top = 430.0
    up = top * (1 - np.exp(-t / 1.6))
    down = up[dsp.frames(8.5)] * np.exp(-np.maximum(0, t - 8.5) / 2.6)
    f1 = np.where(t < 8.5, up, down) + 25.0
    f1 = dsp.jitter(f1 * (1 + 0.006 * np.sin(dsp.TAU * 0.31 * t)), rng, cents_rms=5, rate=3)
    turn = 0.5 + 0.5 * np.cos(dsp.TAU * (t - 3.0) / 3.6)  # 1 = facing us
    f1 = f1 * 2 ** (8 * (turn - 0.5) / 1200)
    low = _rotor(f1, rng, s)
    high = _rotor(f1 * 1.189 * 1.003, rng, s)
    tone = low + 0.8 * high
    speed = np.clip((f1 - 25) / top, 0, 1)
    beam = 0.35 + 0.65 * turn**1.5
    beamed = tone * beam
    # facing us it is brighter: a crossfade of two fixed lowpasses (two FFTs,
    # not a 16 s per-sample swept filter)
    bright = dsp.lowpass(beamed, 1200) * (1 - turn) + dsp.lowpass(beamed, 4200) * turn
    env = speed**1.4 * _envelope([(0, 0), (0.3, 1), (s - 0.8, 1), (s, 0)], s)
    far = dsp.reverb(dsp.pad(dsp.highpass(bright * env, 90), after=1.5), room=0.85, damp=0.5, wet=0.45, width=0.5)
    return dsp.dc_block(dsp.fit(dsp.to_mono(far), s), 30)


def klaxon(rng: np.random.Generator) -> np.ndarray:
    """A submarine's dive klaxon, three times: each "a-OO-gah" is a motor-
    driven diaphragm horn spinning up (the pitch leaps from 140 to 310 Hz),
    holding, then sagging as it lets go; a raspy narrow pulse with a growl an
    octave down, through the horn's two resonances, in a steel hull."""
    one_s = 1.0

    def awooga() -> np.ndarray:
        contour = dsp.sweep([(0, 140), (0.28, 300), (0.62, 318), (0.95, 215), (one_s, 200)], one_s)
        f = dsp.jitter(dsp.smooth(contour, 0.035), rng, cents_rms=10, rate=25)
        rasp = dsp.pulse(f, width=0.18) + 0.45 * dsp.pulse(f / 2, width=0.3)
        rasp = rasp + 0.15 * dsp.white(one_s, rng)[: len(f)]
        horn = dsp.bandpass(rasp, 950, 1.4) + 0.7 * dsp.bandpass(rasp, 2300, 2.5) + 0.25 * rasp
        env = _envelope([(0, 0), (0.05, 0.6), (0.25, 1), (0.7, 1), (0.95, 0.35), (one_s, 0)], one_s)
        return dsp.lowpass(horn, 5000) * env

    s = 4.6
    hits = dsp.mix((awooga(), 0.0), (awooga(), 1.25), (awooga(), 2.5), seconds=s - 0.6)
    hull = dsp.comb(hits, 0.0071, 0.35, 0.3) * 0.25 + hits
    room = dsp.reverb(dsp.pad(dsp.dc_block(hull, 40), after=0.6), room=0.45, damp=0.25, wet=0.3, width=0.3)
    return dsp.fit(dsp.to_mono(room), s)


def alarm_bell(rng: np.random.Generator) -> np.ndarray:
    """An electric fire bell: the trembler's hammer hits a steel gong ≈ 19
    times a second (each hit a touch early or late, a touch harder or
    softer) for four seconds, then the bell rings out. The gong is a circular
    plate's inharmonic partials over 820 Hz, the high ones dying first; each
    hit adds a small metallic tick."""
    s = 5.4
    ring_s = 4.0
    n = dsp.frames(s)
    strikes = np.zeros(n)
    times = np.arange(0.0, ring_s, 1 / 19.0)
    times = times + rng.normal(0, 0.0012, len(times))
    force = 0.85 + 0.15 * rng.random(len(times))
    force[:3] *= (0.6, 0.8, 0.95)  # the hammer finds its swing
    idx = np.clip((times * dsp.RATE).astype(np.int64), 0, n - 1)
    strikes[idx] = force
    partials = [
        (1.000, 1.00, 2.2), (1.594, 0.70, 1.7), (2.136, 0.55, 1.3), (2.296, 0.60, 1.2), (2.653, 0.45, 1.0),
        (2.918, 0.35, 0.85), (3.501, 0.28, 0.65), (4.060, 0.22, 0.5), (5.40, 0.12, 0.35),
    ]
    gong = _struck(strikes, partials, 820.0, 2.6)
    tick = dsp.highpass(dsp.convolve(strikes, dsp.white(0.002, rng) * dsp.decay(0.002, 0.0015)), 3000)
    bell = gong + 0.6 * tick
    return dsp.dc_block(_street(dsp.lowpass(bell, 9000), s, room=0.35, wet=0.12, damp=0.5), 40)


# -- alerts and beepers ---------------------------------------------------------------


def red_alert(rng: np.random.Generator) -> np.ndarray:
    """A starship-style rising alert, five times: each whoop climbs from 300
    to 900 Hz (fast, then easing in at the top), two detuned saws and a
    square an octave down through a resonant filter that opens with the
    pitch, in a big metal room."""
    s = 6.4
    one_s = 1.0

    def whoop() -> np.ndarray:
        t = dsp.timebase(one_s)
        rise = 1 - np.exp(-t / 0.4)
        f = 300 * 3 ** (rise / (1 - np.exp(-0.85 / 0.4)))
        voice = 0.5 * dsp.saw(dsp.cents(f, 7)) + 0.5 * dsp.saw(dsp.cents(f, -7)) + 0.35 * dsp.square(f / 2)
        voice = dsp.svf(voice, np.minimum(3.2 * f, 6000), 2.2, "lp")
        env = _envelope([(0, 0), (0.03, 1), (0.8, 1), (one_s, 0)], one_s)
        return voice * env

    w = whoop()
    hits = dsp.mix(*[(w, i * 1.15) for i in range(5)], seconds=s - 0.6)
    room = dsp.reverb(dsp.pad(dsp.dc_block(hits, 40), after=0.6), room=0.7, damp=0.35, wet=0.28, width=0.5)
    return dsp.fit(dsp.to_mono(room), s)


def _beep(freq: float, seconds: float, harmonics: list[tuple[float, float]], drop_cents: float = 0.0) -> np.ndarray:
    """A short electronic beep: an additive tone (band-limited by
    construction) whose pitch can dip a few cents at its start (a piezo
    finding its resonance), with 3 ms ramps."""
    f = freq * 2 ** (-drop_cents * np.exp(-dsp.timebase(seconds) / 0.01) / 1200)
    return dsp.fade(dsp.additive(f, partials=harmonics), 0.003, 0.003)


def intruder_alarm(rng: np.random.Generator) -> np.ndarray:
    """A burglar alarm's sounder: hard pulsing square beeps at 1700 Hz, six
    a second, with every fourth beep a step lower (the sounder's own rhythm),
    softened above 6 kHz so it is loud, not shrill."""
    s = 5.0
    hi = dsp.lowpass(dsp.square(1700.0, 0.1), 6000)
    lo = dsp.lowpass(dsp.square(1450.0, 0.1), 6000)
    period = 1 / 6.0
    layers = []
    for i, start in enumerate(np.arange(0.0, s - 0.35, period)):
        layers.append((dsp.fade(lo if i % 4 == 3 else hi, 0.003, 0.004), float(start)))
    beeps = dsp.mix(*layers, seconds=s - 0.3)
    return _street(beeps, s, room=0.3, wet=0.12, damp=0.4)


def smoke_alarm_chirp(rng: np.random.Generator) -> np.ndarray:
    """A smoke alarm's low-battery chirp down a hallway: one 50 ms piezo
    chirp at 3.3 kHz (with its odd harmonics), then the hall's short tail."""
    s = 1.5
    chirp = _beep(3300.0, 0.05, [(1, 1.0), (2, 0.06), (3, 0.22)], drop_cents=60)
    hall = dsp.reverb(dsp.pad(chirp, before=0.05, after=s), room=0.35, damp=0.55, wet=0.2, width=0.3)
    return dsp.fit(dsp.to_mono(hall), s)


def warning_whoop(rng: np.random.Generator) -> np.ndarray:
    """An evacuation "whoop": a soft-edged electronic tone sweeping 500 →
    1200 Hz in half a second, a short breath, again (six times); a sine with a
    little third harmonic so it carries without hurting."""
    s = 4.8
    one_s = 0.55
    f = dsp.glide(500, 1200, one_s, curve="linear")
    tone = dsp.additive(f, partials=[(1, 1.0), (2, 0.08), (3, 0.18), (5, 0.05)])
    tone = dsp.fade(tone, 0.01, 0.03)
    hits = dsp.mix(*[(tone, i * 0.72) for i in range(6)], seconds=s - 0.45)
    return _street(hits, s, room=0.45, wet=0.15)


def server_alarm(rng: np.random.Generator) -> np.ndarray:
    """The server room's alarm (the story's `alarm_siren`): a rising power-up
    blip, then a hard electronic two-tone (932 / 698 Hz, a quarter-second
    each) with a pulsing high beep layer (2093 Hz, eight a second) and a low
    square throb on every low tone, all in a small hard room; urgent and
    digital, stepped rather than swept, so it never sounds like the wail."""
    s = 7.2
    end = 6.5
    t = dsp.timebase(s)
    step = 0.25
    stepped = np.where(np.floor((t - 0.3) / step) % 2 == 0, 932.0, 698.0)
    stepped = np.where(t < 0.3, 300 * (932 / 300) ** np.clip(t / 0.3, 0, 1), stepped)
    f = dsp.smooth(stepped, 0.006)
    two = 0.55 * dsp.saw(f) + 0.45 * dsp.square(f)
    two = dsp.peak_eq(dsp.lowpass(two, 5000, order=4), 1200, 4, 1.0)
    beep = _beep(2093.0, 0.06, [(1, 1.0), (3, 0.2)])
    beeps = dsp.mix(*[(beep, float(b)) for b in np.arange(0.3, end - 0.1, 0.125)], seconds=s)
    lows = [(float(a), step) for a in np.arange(0.3 + step, end, 2 * step)]
    throb = dsp.lowpass(dsp.square(110.0, s), 900) * dsp.gates(s, lows, 0.005, 0.02)
    env = _envelope([(0, 0), (0.02, 1), (end - 0.2, 1), (end, 0)], s)
    x = dsp.mix((two * env, 0.0), (beeps * env, 0.0, -7), (throb * env, 0.0, -12))
    room = dsp.reverb(dsp.pad(dsp.dc_block(x, 40), after=0.5), room=0.3, damp=0.3, wet=0.14, width=0.3)
    return dsp.fit(dsp.to_mono(room), s)


SOUNDS: list[Spec] = [
    Spec("siren_wail", "sirens", siren_wail, 8.0, note="US electronic wail: two slow rises and falls, 600-1400 Hz, horn speaker"),
    Spec("siren_yelp", "sirens", siren_yelp, 4.5, note="electronic yelp: fast warble 620-1420 Hz, horn speaker"),
    Spec("siren_hi_lo", "sirens", siren_hi_lo, 6.6, note="two-tone hi-lo siren, 1050 / 790 Hz"),
    Spec("siren_doppler_pass", "sirens", siren_doppler_pass, 9.0, note="a police car passes, its wail dropping in pitch as it goes"),
    Spec("siren_air_raid", "sirens", siren_air_raid, 16.0, note="distant dual-tone air-raid siren: wind up, rotating howl, wind down"),
    Spec("klaxon", "sirens", klaxon, 4.6, note="submarine dive klaxon, three times, in a steel hull"),
    Spec("alarm_bell", "sirens", alarm_bell, 5.4, note="electric fire bell: a fast hammer on a steel gong, then the ring-out"),
    Spec("red_alert", "sirens", red_alert, 6.4, note="sci-fi rising alert whoop, five times, in a metal room"),
    Spec("intruder_alarm", "sirens", intruder_alarm, 5.0, note="burglar alarm sounder: pulsing square beeps, six a second"),
    Spec("smoke_alarm_chirp", "sirens", smoke_alarm_chirp, 1.5, note="a smoke alarm's single low-battery chirp down a hallway"),
    Spec("warning_whoop", "sirens", warning_whoop, 4.8, note="evacuation whoop: 500-1200 Hz rising sweeps, six times"),
    Spec("server_alarm", "sirens", server_alarm, 7.2, story="alarm_siren", note="the server room's alarm: hard two-tone, pulsing beeps, a low throb"),
]
