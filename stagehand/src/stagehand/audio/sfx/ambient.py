"""Ambient: the room beds, one per `LOCATION … ambient:` key in the story's
`main.loom` (wave 38, C6), named by that key (`dryer-tumble` is the Fan
Closet's), plus a couple of spare machine-room beds. The soundtrack
(`media/soundtrack.yaml`) plays them as seamless stream loops under the
music, often for an hour, so they are quiet in character, never melodic,
and never have a moment that stands out on the fortieth repeat.

Every one is built circularly (see the registry's HOW TO): the loop length
is fixed first, every periodic thing (a hum, a rotation, an LFO) is at a
`dsp.loop_freq` so it fits a whole number of times, a tone whose pitch
wanders is given a whole number of cycles (`_loop_tone`), every event is
placed with `mix(wrap=True)` (and kept off the seam itself, so the seam
check sees the bed and not a drip), and every filter and the room run
`circular=True`. Then the seam is not a crossfade but simply not there.

Sparse beds (drips, rattles, clicks) carry a `level_db` under −18 so the
renderer's limiter does not flatten their transients.
"""

from __future__ import annotations

import numpy as np

from . import dsp
from .spec import Spec

#: The story's LOCATION ambient keys (main.loom); a loop per key (tests pin it).
LOCATION_KEYS = (
    "screensaver-hum", "pitch-black", "cable-rattle", "fridge-hum", "processor-whine", "startup-chimes",
    "dripping-tap", "dial-tone", "dryer-tumble", "coil-whine", "platter-spin",
)

#: Keep an event's onset this far from the loop's seam (s).
SEAM_MARGIN = 0.08


# -- loop helpers ------------------------------------------------------------------

#: LFOs and drifts are computed on a grid this many samples apart and
#: interpolated (they move at a few Hz at most; a 30 s np.sin is not free).
CONTROL_STEP = 32


def _control(s: float, f) -> np.ndarray:
    """A slow control curve `f(t)` sampled every CONTROL_STEP samples and
    interpolated to the loop's length; `f` must be periodic over `s`."""
    n = dsp.frames(s)
    tc = np.arange(0, n + CONTROL_STEP, CONTROL_STEP) / dsp.RATE
    return np.interp(dsp.timebase(n=n), tc, f(tc))


def _lfo(rate: float, s: float, phase: float = 0.0) -> np.ndarray:
    """A sine LFO in −1…1 with a whole number of cycles in the loop."""
    r = dsp.loop_freq(rate, s)
    return _control(s, lambda t: np.sin(dsp.TAU * (r * t + phase)))


def _wander(s: float, rng: np.random.Generator, rate: float = 0.1, terms: int = 4) -> np.ndarray:
    """A slow, aimless, periodic drift in −1…1: a few LFOs at unrelated
    whole-cycle rates around `rate` with random phases. A fan's speed, a
    pad's swell, the load on a coil."""
    parts = [(dsp.loop_freq(rate * rng.uniform(0.5, 2.0), s), rng.uniform(), 1 / (k + 1)) for k in range(terms)]
    out = _control(s, lambda t: sum(a * np.sin(dsp.TAU * (r * t + p)) for r, p, a in parts))
    return out / max(1e-12, float(np.abs(out).max()))


def _loop_tone(freq: np.ndarray, phase0: float = 0.0) -> np.ndarray:
    """A sine following a per-sample `freq` over the whole loop, nudged (by
    well under a cent) to a whole number of cycles so it meets itself at
    the seam."""
    total = float(np.sum(freq)) / dsp.RATE
    scale = max(1, round(total)) / max(total, 1e-12)
    return dsp.sine(freq * scale, phase0=phase0)


def _shape(f: np.ndarray, lo: float, hi: float, power: float, order: int) -> np.ndarray:
    """A noise colour (`power` 0 white, 1 pink, 2 brown) between Butterworth-
    like skirts at `lo` and `hi` (`order` × 6 dB/oct), as magnitudes."""
    f = np.maximum(f, 1e-3)
    out = f ** (-power / 2) / np.sqrt(1 + (lo / f) ** (2 * order)) / np.sqrt(1 + (f / hi) ** (2 * order))
    out[0] = 0.0
    return out


class _Spectrum:
    """A loop's steady content written straight into its spectrum and
    rendered by one inverse FFT per channel. A sine with a whole number of
    cycles in the loop is a single bin (and a whole-cycle tremolo two more),
    so a room full of hums, partials and drones costs one FFT; band-shaped
    noise is random bins under a curve. Periodic by construction: there is
    no seam to hide."""

    def __init__(self, s: float, rng: np.random.Generator) -> None:
        self.s, self.rng = s, rng
        self.n = dsp.frames(s)
        self.f = np.fft.rfftfreq(self.n, 1 / dsp.RATE)
        self.bins = np.zeros((2, len(self.f)), dtype=complex)

    def _put(self, freq: float, amp: float, phase: float, pan: float) -> None:
        k = int(round(freq * self.s))
        if 0 < k < len(self.f) - 1:
            th = (np.clip(pan, -1, 1) + 1) * np.pi / 4
            v = amp * self.n / 2 * np.exp(1j * (phase - np.pi / 2))
            self.bins[0, k] += v * np.cos(th) * np.sqrt(2)
            self.bins[1, k] += v * np.sin(th) * np.sqrt(2)

    def tone(self, freq: float, amp: float, pan: float = 0.0, am: tuple | None = None, phase: float | None = None) -> None:
        """A sine of peak `amp` at `freq` (the nearest whole-cycle bin),
        panned. `am=(depth, rate[, lfo_phase])` swings it between 1 − depth
        and 1 at a whole-cycle `rate`: the carrier and its two sidebands."""
        ph = self.rng.uniform(0, dsp.TAU) if phase is None else phase
        if not am:
            self._put(freq, amp, ph, pan)
            return
        depth, rate, *psi = am
        rate = dsp.loop_freq(rate, self.s)
        psi = psi[0] * dsp.TAU if psi else self.rng.uniform(0, dsp.TAU)
        self._put(freq, amp * (1 - depth / 2), ph, pan)
        self._put(freq - rate, amp * depth / 4, ph - psi + np.pi / 2, pan)
        self._put(freq + rate, amp * depth / 4, ph + psi - np.pi / 2, pan)

    def harmonics(self, f0: float, partials, amp: float = 1.0, pan: float = 0.0, am: tuple | None = None) -> None:
        """Whole harmonics `(k, a)` of `f0` (itself moved to a whole-cycle
        frequency, so every harmonic is too): mains, a motor, a fan's blades."""
        f = dsp.loop_freq(f0, self.s)
        for k, a in partials:
            self.tone(f * k, amp * a, pan, am)

    def noise(self, lo: float, hi: float, rms: float, power: float = 1.0, order: int = 2, width: float = 1.0) -> None:
        """Band-shaped noise at `rms` per channel; `width` 1 is independent
        left and right (a wide room), 0 the same in both."""
        shape = _shape(self.f, lo, hi, power, order)
        m = len(self.f)

        def bins() -> np.ndarray:
            return self.rng.standard_normal(m) + 1j * self.rng.standard_normal(m)

        common = bins()
        for c in range(2):
            x = (np.sqrt(1 - width) * common + np.sqrt(width) * bins()) * shape
            self.bins[c] += x * rms / max(1e-12, np.sqrt(2 * np.sum(np.abs(x) ** 2)) / self.n)

    def render(self) -> np.ndarray:
        return np.stack([np.fft.irfft(self.bins[c], self.n) for c in range(2)], axis=1)


def _band_noise(s: float, rng: np.random.Generator, lo: float, hi: float, power: float = 1.0, order: int = 2, channels: int = 1) -> np.ndarray:
    """Band-shaped periodic noise at dsp.NOISE_RMS, mono or `channels`=2
    independent: for noise that is then modulated (a drum's roll, a breath)."""
    n = dsp.frames(s)
    shape = _shape(np.fft.rfftfreq(n, 1 / dsp.RATE), lo, hi, power, order)
    out = []
    for _ in range(channels):
        x = np.fft.irfft((rng.standard_normal(len(shape)) + 1j * rng.standard_normal(len(shape))) * shape, n)
        out.append(x * dsp.NOISE_RMS / max(1e-12, float(np.sqrt(np.mean(x**2)))))
    return out[0] if channels == 1 else np.stack(out, axis=1)


def _scatter(events, s: float) -> np.ndarray:
    """`dsp.mix(*events, seconds=s, wrap=True)` for many short events, by
    slicing (stereo out): `(signal, at[, gain_db])`, whatever runs past the
    end folding onto the start."""
    n = dsp.frames(s)
    out = np.zeros((n, 2))
    for sig, at, *g in events:
        x = dsp.stereo(sig) * (dsp.db_to_lin(g[0]) if g else 1.0)
        pos = dsp.frames(at % s) % n
        while len(x):
            take = min(len(x), n - pos)
            out[pos : pos + take] += x[:take]
            x, pos = x[take:], 0
    return out


def _onset(rng: np.random.Generator, s: float, lo: float = 0.0, hi: float | None = None) -> float:
    """A random event time in the loop, kept off the seam."""
    hi = s if hi is None else hi
    return float(rng.uniform(max(lo, SEAM_MARGIN), min(hi, s - SEAM_MARGIN)))


def _times(rng: np.random.Generator, s: float, gap: tuple[float, float]) -> list[float]:
    """Event times through the loop, each `gap` (uniform) after the last,
    none within SEAM_MARGIN of the seam."""
    out, now = [], float(rng.uniform(SEAM_MARGIN, gap[1]))
    while now < s - SEAM_MARGIN:
        out.append(now)
        now += float(rng.uniform(*gap))
    return out


def _room(x: np.ndarray, room: float, damp: float, wet: float, width: float = 1.0) -> np.ndarray:
    """A loop in its room (circular: the tail wraps into the head)."""
    return dsp.reverb(x, room=room, damp=damp, wet=wet, width=width, circular=True)


def _finish(x: np.ndarray, low_cut: float = 30.0, *extra: dsp.Biquad) -> np.ndarray:
    """Every bed ends here, in one FFT pass: no DC, a 24 dB/oct cut under
    the speakers' reach, and any last tone shaping (`extra` sections)."""
    x = np.asarray(x, dtype=np.float64)
    x = x - x.mean(axis=0)
    cut = (dsp.Biquad.highpass(low_cut, 0.5412), dsp.Biquad.highpass(low_cut, 1.3066), dsp.Biquad.highpass(15, 0.6))
    return dsp.filt(x, *cut, *extra, circular=True)


# -- the Desktop -----------------------------------------------------------------------


def screensaver_hum(rng: np.random.Generator) -> np.ndarray:
    """The Desktop (living room): an old monitor left on its screensaver. The
    mains hum of its supply (120 Hz and friends, breathing a little), the
    tube's faint static and hiss, and a soft, slowly swelling open chord,
    like the screensaver's colours."""
    s = 30.0
    sp = _Spectrum(s, rng)
    sp.harmonics(60, ((1, 0.2), (2, 1.0), (3, 0.3), (4, 0.25), (5, 0.08), (6, 0.1), (8, 0.05), (10, 0.03)), amp=0.6, am=(0.15, 0.07, 0.0))
    for k, (note, where) in enumerate((("D3", -0.6), ("A3", 0.5), ("E4", -0.25), ("F#4", 0.3))):
        f = dsp.hz(note)
        swell = (0.9, 1 / (7.5 + 7.5 * (k % 2)), rng.uniform())
        for d in (-0.13, 0.11):
            for h, a in ((1, 1.0), (3, 1 / 9), (5, 1 / 25)):  # a soft triangle
                sp.tone((f + d) * h, 0.08 * a, where, am=swell)
    sp.noise(3500, 8000, rms=0.012)
    static = dsp.crackle(s, rng, density=6, grain_ms=1.0)
    x = sp.render() + dsp.stereo(static - static.mean()) * 0.05
    return _finish(_room(x, room=0.5, damp=0.6, wet=0.18))


# -- the Optical Drive -------------------------------------------------------------------


def pitch_black(rng: np.random.Generator) -> np.ndarray:
    """The Optical Drive (mud room, the Login cutscene): the dark inside a
    closed drive. A deep, barely-there drone (two low tones beating slowly
    across the room, and quiet overtones so small speakers carry it too)
    over a dark rumble that breathes very slowly."""
    s = 30.0
    sp = _Spectrum(s, rng)
    for f, a, where in ((49.0, 1.0, -0.4), (49.27, 0.8, 0.4), (98.1, 0.35, -0.1), (147.0, 0.15, 0.2), (196.2, 0.06, 0.0)):
        sp.tone(f, 0.25 * a, where, am=(0.5, 0.05))
    sp.noise(150, 500, rms=0.012)
    rumble = _band_noise(s, rng, 32, 140, power=2, order=4, channels=2) * (0.6 + 0.4 * _wander(s, rng, 0.04))[:, None]
    return _finish(sp.render() + rumble, low_cut=32)


# -- the Tube ------------------------------------------------------------------------


def _tap(rng: np.random.Generator, bright: float) -> np.ndarray:
    """One cable knocking the duct: a click at the cable's pitch and the
    sheet metal's brief ring."""
    d = 0.18
    imp = np.zeros(dsp.frames(d))
    imp[0] = 1.0
    click = dsp.filt(imp, dsp.Biquad.bandpass(bright, 3.0)) * 3
    ring = dsp.filt(imp, dsp.Biquad.bandpass(rng.uniform(480, 560), 18)) + 0.7 * dsp.filt(imp, dsp.Biquad.bandpass(rng.uniform(1180, 1320), 22))
    return click + ring * 0.8


def cable_rattle(rng: np.random.Generator) -> np.ndarray:
    """The Tube (hall and stairs): cables in a metal duct. A faint draught
    in the duct, and now and then a run of rattles (a few to a dozen knocks
    as something shifts), a lone tick, or the duct flexing with a dull
    "thunk"; never regular."""
    s = 30.0
    events = []
    for at in _times(rng, s, (1.2, 5.0)):
        kind = rng.random()
        where = rng.uniform(-0.7, 0.7)
        if kind < 0.6:  # a run of rattles, drifting along the duct
            count = int(rng.integers(3, 13))
            gaps = rng.exponential(0.05, count) + 0.012
            level = rng.uniform(0.4, 1.0) * np.exp(-np.arange(count) * rng.uniform(0.05, 0.3))
            for k in range(count):
                tap = _tap(rng, rng.uniform(1800, 4500)) * level[k] * rng.uniform(0.6, 1.0)
                events.append((dsp.pan(tap, where + 0.03 * k), at + float(gaps[: k + 1].sum())))
        elif kind < 0.85:  # a lone tick
            events.append((dsp.pan(_tap(rng, rng.uniform(2500, 5000)) * rng.uniform(0.3, 0.6), where), at))
        else:  # the duct flexing
            d = 0.4
            imp = np.zeros(dsp.frames(d))
            imp[0] = 1.0
            thunk = dsp.filt(imp, dsp.Biquad.bandpass(rng.uniform(150, 210), 6)) * 2.5 + dsp.filt(imp, dsp.Biquad.bandpass(780, 10))
            events.append((dsp.pan(thunk * rng.uniform(0.5, 0.9), where), at))
    rattles = _scatter(events, s)
    draught = _band_noise(s, rng, 120, 700, channels=2) * (0.8 + 0.2 * _wander(s, rng, 0.08))[:, None]
    x = rattles + draught * 0.05
    return _finish(_room(x, room=0.6, damp=0.4, wet=0.22), low_cut=60)


# -- the Start Bar -------------------------------------------------------------------


def fridge_hum(rng: np.random.Generator) -> np.ndarray:
    """The Start Bar (kitchen): the refrigerator. Its compressor's motor
    (≈ 59.8 Hz and harmonics) against the mains' 120 Hz, so the two beat
    into a slow, gentle wobble; the condenser fan's air behind it, a thin
    whine, and once a loop, the refrigerant's quiet gurgle."""
    s = 30.0
    sp = _Spectrum(s, rng)
    motor = ((1, 0.45), (2, 1.0), (3, 0.5), (4, 0.3), (5, 0.18), (6, 0.12), (7, 0.07), (8, 0.05), (10, 0.03), (12, 0.02))
    sp.harmonics(59.8, motor, amp=0.5, pan=-0.15, am=(0.1, 0.2))
    sp.harmonics(60, ((2, 0.6), (4, 0.15)), amp=0.2, pan=-0.15)
    sp.tone(1240, 0.008, -0.15, am=(0.8, 0.1))
    sp.noise(120, 1600, rms=0.07)
    bubbles = []
    for k in range(int(rng.integers(9, 15))):
        d = rng.uniform(0.03, 0.06)
        f = dsp.glide(rng.uniform(280, 420), rng.uniform(550, 900), d)
        bubble = dsp.sine(f) * dsp.decay(d, d * 0.9, attack=0.003)
        bubbles.append((bubble * rng.uniform(0.4, 1.0), k * rng.uniform(0.07, 0.16)))
    gurgle = dsp.reverb(dsp.pad(dsp.mix(*bubbles), after=0.5), room=0.4, damp=0.6, wet=0.3)
    x = sp.render() + _scatter([(gurgle * 0.1, _onset(rng, s, 6, s - 8))], s)
    return _finish(x, low_cut=40)


# -- the CPU -------------------------------------------------------------------------


def processor_whine(rng: np.random.Generator) -> np.ndarray:
    """The CPU (office): a computer working hard. The fan's air and its
    blade tone, and the electronic whine of the board, a few close tones
    around 2–4.5 kHz drifting gently with the load, kept well under the
    fan so it reads as busy, not painful."""
    s = 30.0
    load = _wander(s, rng, 0.12)
    whine = np.zeros(dsp.frames(s))
    for f, a in ((3380.0, 1.0), (2253.0, 0.5), (4507.0, 0.25)):
        whine += a * _loop_tone(f * (1 + 0.004 * load + 0.0015 * _wander(s, rng, 0.6)), rng.uniform())
    whine = whine * (0.65 + 0.35 * _wander(s, rng, 0.2))
    sp = _Spectrum(s, rng)
    sp.noise(160, 3500, rms=0.25)
    sp.harmonics(280, ((1, 1.0), (2, 0.35), (3, 0.12)), amp=0.03, am=(0.2, 0.25))
    x = sp.render() + dsp.pan(whine, 0.2) * 0.06
    return _finish(x, low_cut=60)


# -- the Steam Room ---------------------------------------------------------------------

#: F major pentatonic (no half steps: any two chimes sound well together).
CHIME_NOTES = ("F5", "G5", "A5", "C6", "D6", "F6", "G6", "A6", "C7")


def _chime(f: float, t60: float, ratio: float) -> np.ndarray:
    """A soft glassy chime (FM, the index falling with the note)."""
    d = t60 + 0.1
    index = 1.4 * dsp.decay(d, t60 * 0.3) + 0.05
    return dsp.fm(f, d, ratio=ratio, index=index) * dsp.decay(d, t60, attack=0.004)


def startup_chimes(rng: np.random.Generator) -> np.ndarray:
    """The Steam Room (game room): a waiting room of start-up sounds. A warm
    pad that slowly swells and brightens, and every few seconds a soft
    chime or a little rising or falling run of two to four, from a
    pentatonic scale, never the same twice in the loop."""
    s = 36.0
    sp = _Spectrum(s, rng)
    opening = (0.9, 1 / 18, 0.0)
    for k, (note, where) in enumerate((("F3", -0.4), ("C4", 0.4), ("G4", -0.2), ("A4", 0.3), ("E5", 0.0))):
        f = dsp.hz(note)
        swell = (0.8, 1 / (9 + 3 * k), rng.uniform())
        for d in (-0.09, 0.12):
            for h, a in ((1, 1.0), (2, 0.25), (3, 0.12), (4, 0.05)):
                sp.tone((f + d) * h, 0.05 * a, where, am=swell if h == 1 else opening)
    events = []
    last = None
    for at in _times(rng, s, (2.6, 6.0)):
        count = int(rng.choice((1, 1, 2, 3, 4)))
        start = int(rng.integers(0, len(CHIME_NOTES) - 3))
        if start == last:
            start = (start + 2) % (len(CHIME_NOTES) - 3)
        last = start
        up = rng.random() < 0.6
        step = rng.uniform(0.09, 0.17)
        where = rng.uniform(-0.6, 0.6)
        ratio = float(rng.choice((3.5, 1.4, 2.0)))
        # a chime still ringing across the seam is seamless but bright there:
        # let every run ring out before the loop comes round
        count = min(count, max(1, int((s - 2.4 - at) / step) + 1))
        if at > s - 2.4:
            continue
        for k in range(count):
            idx = start + k if up else start + count - 1 - k
            ch = _chime(dsp.hz(CHIME_NOTES[min(idx, len(CHIME_NOTES) - 1)]), rng.uniform(1.4, 2.6), ratio) * rng.uniform(0.5, 0.9)
            events.append((dsp.pan(ch, where + 0.15 * k * (1 if up else -1)), at + k * step))
    x = sp.render() + _scatter(events, s) * 0.22
    return _finish(_room(x, room=0.75, damp=0.45, wet=0.3), low_cut=60)


# -- Disk Cleanup ---------------------------------------------------------------------


def _drip(rng: np.random.Generator, deep: bool = False) -> np.ndarray:
    """One water drop: the splash's tick and the bubble's "plink", a sine
    whose pitch rises fast as the bubble closes."""
    d = 0.12
    f0 = rng.uniform(380, 600) if deep else rng.uniform(650, 1150)
    f = dsp.line([(0, f0), (rng.uniform(0.015, 0.03), f0 * rng.uniform(1.6, 2.4))], d, curve="exp")
    plink = dsp.sine(f) * dsp.decay(d, rng.uniform(0.05, 0.09), attack=0.001)
    tick = dsp.highpass(dsp.white(0.004, rng), 3000) * dsp.decay(0.004, 0.003)
    return dsp.mix(plink, (tick, 0.0, -10))


def dripping_tap(rng: np.random.Generator) -> np.ndarray:
    """Disk Cleanup (bathrooms): a tap that won't stop dripping in a tiled
    room. Its drops come at an uneven, slightly lazy pace (now and then a
    quick double), a second deeper drip somewhere else plops into a puddle
    more rarely, and the tiles answer every one."""
    s = 30.0
    events = []
    now = float(rng.uniform(SEAM_MARGIN, 1.0))
    while now < s - SEAM_MARGIN:
        events.append((dsp.pan(_drip(rng), -0.35) * rng.uniform(0.6, 1.0), now))
        if rng.random() < 0.15 and now + 0.3 < s - SEAM_MARGIN:
            events.append((dsp.pan(_drip(rng), -0.3) * rng.uniform(0.3, 0.5), now + rng.uniform(0.09, 0.22)))
        now += float(rng.uniform(0.9, 2.1))
    for at in _times(rng, s, (3.5, 8.0)):
        events.append((dsp.pan(_drip(rng, deep=True), 0.55) * rng.uniform(0.4, 0.7), at))
    sp = _Spectrum(s, rng)
    sp.noise(80, 500, rms=0.008)
    x = _room(_scatter(events, s), room=0.78, damp=0.2, wet=0.45) + sp.render()
    return _finish(x, low_cut=60)


# -- the RAM ------------------------------------------------------------------------


def dial_tone(rng: np.random.Generator) -> np.ndarray:
    """The RAM (studio): an old phone off the hook, its dial tone (the North
    American 350 + 440 Hz) heard down a worn line: the narrow band, a
    little mains hum, hiss, a faint wobble and the odd crackle."""
    s = 24.0
    sp = _Spectrum(s, rng)
    wobble = (0.06, 0.25, 0.0)
    for f in dsp.CALL_PROGRESS["dial"][0]:
        sp.tone(f, 0.5, am=wobble)
    sp.harmonics(60, ((1, 1.0), (3, 0.5), (5, 0.2)), amp=0.025)
    sp.noise(200, 6000, rms=0.012, power=0, width=0.0)
    crackle = dsp.crackle(s, rng, density=1.5, grain_ms=1.5)
    line = dsp.saturate((sp.render()[:, 0] + 0.06 * (crackle - crackle.mean())) * 0.7, 0.15)
    phone = (dsp.Biquad.highpass(300, 0.8), dsp.Biquad.highpass(300, 0.6), dsp.Biquad.lowpass(3400, 0.8),
             dsp.Biquad.lowpass(3400, 0.6), dsp.Biquad.peak(1600, 4, 1.2))
    return _finish(line, 40, *phone)


# -- the Fan Closet ---------------------------------------------------------------------


def _thump(rng: np.random.Generator, weight: float) -> np.ndarray:
    """A load of clothes landing on the drum: a dull low burst and the
    cabinet panel booming briefly under it."""
    d = rng.uniform(0.16, 0.24)
    burst = dsp.lowpass(dsp.pink(d, rng), rng.uniform(220, 380), order=4) * dsp.decay(d, d * 0.7, attack=rng.uniform(0.004, 0.012))
    panel = dsp.filt(burst, dsp.Biquad.bandpass(rng.uniform(95, 125), 4)) * 2.5 + dsp.filt(burst, dsp.Biquad.bandpass(rng.uniform(210, 260), 5))
    return (burst + panel) * weight


def _swish(rng: np.random.Generator) -> np.ndarray:
    """Fabric sliding down the drum before it falls."""
    d = rng.uniform(0.18, 0.3)
    return dsp.bandpass(dsp.pink(d, rng), rng.uniform(700, 1200), 0.8) * dsp.line([(0, 0), (d * 0.8, 1), (d, 0)], d)


def _clink(rng: np.random.Generator) -> np.ndarray:
    """A zipper pull or a jeans button hitting the steel drum: a hard tick
    and a short, inharmonic metallic ring."""
    d = 0.25
    f = rng.uniform(1900, 2900) if rng.random() < 0.6 else rng.uniform(1100, 1500)
    ring = dsp.additive(f, d, ((1, 1.0), (1.47, 0.6), (2.09, 0.35), (2.76, 0.2))) * dsp.decay(d, rng.uniform(0.08, 0.16))
    tick = dsp.filt(dsp.white(0.003, rng), dsp.Biquad.highpass(2500), dsp.Biquad.lowpass(7000)) * dsp.decay(0.003, 0.002)
    return dsp.mix(ring, (tick * 2, 0.0))


def dryer_tumble(rng: np.random.Generator) -> np.ndarray:
    """The Fan Closet (laundry): a clothes dryer, running. The motor's hum
    and the belt's whir; the blower's whoosh, pulsing faintly with the
    drum; the drum's slow roll; and the load tumbling: a heavy thump about
    once a turn (≈ 0.8–1.2 s apart, never exactly), the fabric's swish
    before it, now and then a lighter second fall, and every few turns a
    zipper or a button clinking round the drum."""
    s = 32.0
    turn = dsp.loop_freq(0.875, s)  # the drum: 28 turns in the loop, ≈ 52 rpm
    roll = 0.5 + 0.5 * _lfo(turn, s)

    sp = _Spectrum(s, rng)
    sp.harmonics(28.75, ((2, 0.5), (3, 0.3), (4, 1.0), (5, 0.2), (6, 0.25), (8, 0.1)), amp=0.025)
    sp.harmonics(60, ((2, 1.0), (4, 0.25), (6, 0.08)), amp=0.012)
    whir = _band_noise(s, rng, 300, 390) * (0.8 + 0.2 * _lfo(turn * 3.0, s))
    rumble = _band_noise(s, rng, 60, 110, power=2) * (0.55 + 0.45 * roll)
    blower = _band_noise(s, rng, 150, 2200, channels=2) * (0.92 + 0.08 * roll)[:, None]

    events = []
    for r in range(int(round(turn * s))):
        base = float(np.clip((r + 0.62) / turn + rng.normal(0, 0.12), 0.35, s - 0.3))
        where = rng.uniform(-0.35, 0.35)
        events.append((dsp.pan(_swish(rng), where), base - 0.26, -16))
        events.append((dsp.pan(_thump(rng, rng.uniform(0.65, 1.0)), where), base))
        if rng.random() < 0.3:  # a second, lighter lump falls after
            events.append((dsp.pan(_thump(rng, rng.uniform(0.3, 0.5)), -where), base + rng.uniform(0.18, 0.4)))
        if rng.random() < 0.35:  # a clink, sometimes skittering twice or thrice
            at = (r + rng.uniform(0.1, 0.45)) / turn
            where_c = rng.uniform(-0.6, 0.6)
            for k in range(int(rng.choice((1, 1, 2, 3)))):
                events.append((dsp.pan(_clink(rng), where_c), at + k * rng.uniform(0.05, 0.11), -19 - 5 * k))
    tumbling = _scatter(events, s)

    x = sp.render() + dsp.stereo(whir * 0.035 + rumble * 0.14) + blower * 0.11 + tumbling * 2.4
    x = _room(x, room=0.32, damp=0.65, wet=0.14, width=0.7)
    return _finish(x, 35, dsp.Biquad.highshelf(4000, -5))


# -- the Graphics Card -------------------------------------------------------------------


def coil_whine(rng: np.random.Generator) -> np.ndarray:
    """The Graphics Card (bedroom 2): a graphics card under a jumpy load. Its
    coils whine in steps that jump with the frame load (a light idle, busy
    stretches, quick chirps), and its fan rises and falls more slowly
    behind them."""
    s = 30.0
    n = dsp.frames(s)
    load = np.empty(n)
    pos, state = 0, 0.2
    while pos < n:
        span = dsp.frames(float(rng.choice((rng.uniform(0.08, 0.3), rng.uniform(0.4, 2.8)), p=(0.35, 0.65))))
        load[pos : pos + span] = state
        pos += span
        state = float(rng.choice((0.15, 0.45, 0.7, 1.0), p=(0.3, 0.25, 0.25, 0.2)))
    load = dsp.onepole(load, 30, circular=True)  # ≈ 5 ms: chirpy, never a click
    whine_f = 1500 + 1300 * load
    whine = _loop_tone(whine_f, rng.uniform()) + 0.25 * _loop_tone(2 * whine_f, rng.uniform())
    whine = whine * (0.25 + 0.75 * load**1.5)
    fan_speed = 0.6 + 0.4 * dsp.onepole(load, 0.15, circular=True)
    blade = _loop_tone(310 * fan_speed, rng.uniform())
    fan = _band_noise(s, rng, 200, 3000, channels=2) * fan_speed[:, None]
    x = fan * 0.8 + dsp.stereo(blade * 0.015) + dsp.pan(whine, 0.15) * 0.1
    return _finish(x, low_cut=60)


# -- the Hard Drive -------------------------------------------------------------------


def _seek(rng: np.random.Generator, clicks: int, spacing: tuple[float, float]) -> np.ndarray:
    """The head actuator seeking: a run of small, hard ticks, each ringing
    the drive's little box (its resonances are the room: no reverb)."""
    d = spacing[1] * clicks + 0.1
    imp = np.zeros(dsp.frames(d))
    at = 0.0
    for _ in range(clicks):
        imp[dsp.frames(at)] = rng.uniform(0.5, 1.0) * rng.choice((-1.0, 1.0))
        at += rng.uniform(*spacing)
    x = dsp.filt(imp, dsp.Biquad.bandpass(rng.uniform(1200, 1500), 4)) + 0.6 * dsp.filt(imp, dsp.Biquad.bandpass(rng.uniform(2900, 3400), 6)) + 0.4 * dsp.filt(imp, dsp.Biquad.bandpass(420, 3))
    return dsp.normalize_peak(x, 0.0)


def platter_spin(rng: np.random.Generator) -> np.ndarray:
    """The Hard Drive (crawl space): a big old hard drive. Its platters at
    7200 rpm (a 120 Hz hum with its overtones and the spindle's thin
    whine), the bearing hiss, and now and then the heads seeking: a tick,
    a short run, once a loop a long busy grind."""
    s = 30.0
    sp = _Spectrum(s, rng)
    sp.harmonics(120, ((1, 1.0), (2, 0.45), (3, 0.3), (4, 0.12), (6, 0.05)), amp=0.5, am=(0.2, 0.2))
    sp.tone(1920, 0.016, am=(0.6, 0.13))
    sp.noise(1800, 3500, rms=0.03)
    events = []
    for at in _times(rng, s, (1.0, 4.5)):
        count = int(rng.choice((1, 2, 3, 4, 6)))
        events.append((dsp.pan(_seek(rng, count, (0.012, 0.05)) * rng.uniform(0.5, 1.0), rng.uniform(-0.2, 0.2)), at))
    events.append((_seek(rng, 22, (0.006, 0.014)) * 0.7, _onset(rng, s, 4, s - 4)))
    x = sp.render() + _scatter(events, s) * 0.6
    return _finish(x, low_cut=50)


# -- the Server Room (spares) ----------------------------------------------------------


def server_room_fans(rng: np.random.Generator) -> np.ndarray:
    """A basement server room: a rack's small fans (each a blade tone, close
    enough to the others to beat slowly), their air, and the HVAC's low
    hum and duct rumble under them."""
    s = 30.0
    sp = _Spectrum(s, rng)
    for k in range(5):
        sp.harmonics(rng.uniform(150, 200) * 7, ((1, 1.0), (2, 0.3)), amp=0.03, pan=-0.7 + 0.35 * k, am=(0.3, rng.uniform(0.05, 0.2)))
    sp.noise(200, 6000, rms=0.2)
    sp.noise(400, 2500, rms=0.1)
    sp.harmonics(60, ((1, 0.4), (2, 1.0), (3, 0.3), (4, 0.2)), amp=0.05)
    sp.noise(30, 160, rms=0.12, power=2)
    return _finish(sp.render(), low_cut=40)


def data_center_hum(rng: np.random.Generator) -> np.ndarray:
    """A vast data hall: a dense, dark roar of air from rows of racks and
    the cooling units, breathing very slowly; the electrical hum of the
    room; a faint shimmer of hundreds of fans beating against each other."""
    s = 36.0
    breath = 0.85 + 0.15 * _lfo(1 / 12, s)
    roar = _band_noise(s, rng, 60, 1800, channels=2) * breath[:, None]
    sp = _Spectrum(s, rng)
    sp.noise(30, 300, rms=0.2, power=2)
    sp.harmonics(60, tuple((k, 1.0 / k) for k in range(1, 11)), amp=0.03)
    for _ in range(10):
        sp.tone(rng.uniform(900, 1300), 0.004, rng.uniform(-0.9, 0.9))
    return _finish(roar + sp.render(), low_cut=35)


SOUNDS: list[Spec] = [
    Spec("screensaver-hum", "ambient", screensaver_hum, 30.0, loop=True,
         note="the Desktop: a monitor on its screensaver, mains hum, tube hiss, a soft swelling open chord"),
    Spec("pitch-black", "ambient", pitch_black, 30.0, loop=True, level_db=-22,
         note="the Optical Drive: a deep, barely-there drone and a dark breathing rumble"),
    Spec("cable-rattle", "ambient", cable_rattle, 30.0, loop=True, level_db=-31,
         note="the Tube: cables in a metal duct, sparse runs of rattles, lone ticks, a flexing thunk"),
    Spec("fridge-hum", "ambient", fridge_hum, 30.0, loop=True,
         note="the Start Bar: a refrigerator's compressor beating gently against the mains, fan air, a gurgle"),
    Spec("processor-whine", "ambient", processor_whine, 30.0, loop=True,
         note="the CPU: a busy computer's fan and blade tone, a soft electronic whine drifting with the load"),
    Spec("startup-chimes", "ambient", startup_chimes, 36.0, loop=True,
         note="the Steam Room: a warm slowly-opening pad and sparse random pentatonic chimes"),
    Spec("dripping-tap", "ambient", dripping_tap, 30.0, loop=True, level_db=-28,
         note="Disk Cleanup: a tap dripping unevenly in a tiled room, a deeper drip into a puddle"),
    Spec("dial-tone", "ambient", dial_tone, 24.0, loop=True, level_db=-22,
         note="the RAM: a North American dial tone (350 + 440 Hz) down a worn line, hum, hiss, crackle"),
    Spec("dryer-tumble", "ambient", dryer_tumble, 32.0, loop=True, level_db=-22,
         note="the Fan Closet: a clothes dryer, motor hum, blower, thumping load, the odd zipper clink"),
    Spec("coil-whine", "ambient", coil_whine, 30.0, loop=True,
         note="the Graphics Card: coil whine stepping with a jumpy load, the card's fan following slowly"),
    Spec("platter-spin", "ambient", platter_spin, 30.0, loop=True,
         note="the Hard Drive: platters at 7200 rpm, bearing hiss, heads seeking now and then"),
    Spec("server-room-fans", "ambient", server_room_fans, 30.0, loop=True,
         note="a basement server room: rack fans beating slowly, their air, HVAC hum and duct rumble"),
    Spec("data-center-hum", "ambient", data_center_hum, 36.0, loop=True,
         note="a vast data hall: a dense dark roar of air breathing slowly, electrical hum, fan shimmer"),
]
