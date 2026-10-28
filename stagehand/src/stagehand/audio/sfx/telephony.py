"""Telephony: dial tones, touch tones, rings, busy signals, modems, fax
(wave 38, C6).

Protocol tones are generic and should be accurate (`dsp.CALL_PROGRESS`,
`dsp.DTMF`, `dsp.ansam`, `dsp.fsk`): the North American precise tones, the
V.8 answer tone, Bell 103 / 202 FSK. What makes them sound like a phone is
the line: `dsp.telephone` (the 300–3400 Hz band), a touch of `saturate` (a
cheap earpiece) and a little `white` hiss under everything (`_line`).

The modem handshake is built the way a real one runs, phase by phase, from
generic signals: dial tone, touch tones, a burst of ring-back, the 2100 Hz
answer tone with its phase reversals, V.21 FSK chatter (the V.8 menu and its
answer), the two "bong" tones with their reversals (1200 / 2400 Hz), the
line-probing comb (a buzz of 150 Hz harmonics), a digital-impairment squeal,
and the scrambled QAM training hiss that ends in the speaker muting. Nothing
is a recording; every phase is synthesized from what the standard sends.

The steady call-progress tones (dial, busy, ring-back) and the fax's calling
tone are seamless loops: whole cycles of `loop_freq` tones, cadences that
divide the loop, and every filter `circular=True`.
"""

from __future__ import annotations

import numpy as np

from . import dsp
from .spec import Spec

#: The line's hiss under a call, relative to a full-scale tone.
HISS_DB = -44.0

# -- the line ----------------------------------------------------------------------


def _hiss(seconds: float, rng: np.random.Generator, db: float = HISS_DB) -> np.ndarray:
    """The line's own hiss at `db` below a full-scale tone (white at NOISE_RMS
    rescaled; the band comes from `_line`)."""
    return dsp.white(seconds, rng) * (dsp.db_to_lin(db) / dsp.NOISE_RMS)


def _line(x: np.ndarray, rng: np.random.Generator | None = None, circular: bool = False, drive: float = 0.15) -> np.ndarray:
    """`x` as heard down a phone line out of a small earpiece: hiss added (if
    an `rng` is given), a little asymmetric drive (the carbon and the cheap
    speaker), then the 300–3400 Hz band. The band comes after the drive, so
    the drive's harmonics above 3.4 kHz (a whistle on a big speaker), its
    low intermodulation hum and its DC all go with it."""
    if rng is not None:
        x = x + _hiss(dsp.seconds_of(x), rng)
    y = dsp.telephone(dsp.saturate(x, drive), circular=circular)
    return dsp.dc_block(y, 40, circular=circular)


def _hook_click(rng: np.random.Generator) -> np.ndarray:
    """A handset lifted: a dull plastic knock and a contact crackle."""
    knock = dsp.lowpass(dsp.white(0.04, rng), 900) * dsp.decay(0.04, 0.025)
    contact = dsp.highpass(dsp.crackle(0.05, rng, density=400), 2000) * 0.6
    return dsp.mix(knock, (contact, 0.004))


def _relay(rng: np.random.Generator) -> np.ndarray:
    """A relay or hook switch closing: two or three contact bounces a few
    milliseconds apart, each a bright tick with a short metallic ring."""
    tick = dsp.highpass(dsp.white(0.003, rng), 1500) * dsp.decay(0.003, 0.002)
    ring = dsp.sine(2900.0, 0.02) * dsp.decay(0.02, 0.012)
    one = dsp.mix(tick, (ring, 0.0, -14))
    return dsp.mix((one, 0.0), (one, 0.009, -6), (one, 0.021, -14))


def _cadence(freqs: tuple[float, ...], seconds: float, events: list[tuple[float, float]], ramp: float = 0.004) -> np.ndarray:
    """Equal-level sines at `freqs`, each a whole number of cycles in
    `seconds` (so a loop is seamless), gated on at `events`."""
    tone = sum(dsp.sine(dsp.loop_freq(f, seconds), seconds) for f in freqs) / len(freqs)
    return tone * dsp.gates(seconds, events, ramp, ramp)


# -- call progress (loops) -----------------------------------------------------------


def dial_tone(rng: np.random.Generator) -> np.ndarray:
    """The North American dial tone: 350 + 440 Hz, steady, down the line;
    a seamless six-second loop (both tones are whole cycles in it)."""
    s = 6.0
    tone = _cadence((350, 440), s, [(-1.0, s + 2.0)])
    return _line(tone, rng, circular=True)


def busy_signal(rng: np.random.Generator) -> np.ndarray:
    """The busy signal: 480 + 620 Hz, half a second on, half off; a seamless
    six-second loop."""
    s = 6.0
    tone = _cadence((480, 620), s, [(t, 0.5) for t in np.arange(0.0, s, 1.0)])
    return _line(tone, rng, circular=True)


def ringback(rng: np.random.Generator) -> np.ndarray:
    """Ring-back (what the caller hears while it rings): 440 + 480 Hz, two
    seconds on, four off; the two tones' 40 Hz beat is the warble. One
    seamless six-second cycle, the ring a second in (so the seam is in the
    quiet, and a one-off play starts with a breath of line)."""
    s = 6.0
    tone = _cadence((440, 480), s, [(1.0, 2.0)], ramp=0.01)
    return _line(tone, rng, circular=True)


def fax_cng(rng: np.random.Generator) -> np.ndarray:
    """A fax machine calling: a 1100 Hz beep, half a second, every 3.5 s
    (CNG); two of them, a seamless loop (its seam in a quiet gap)."""
    s = 7.0
    tone = _cadence((1100,), s, [(1.5, 0.5), (5.0, 0.5)])
    return _line(tone, rng, circular=True)


# -- rings ---------------------------------------------------------------------------


def _gong(strikes: np.ndarray, f0: float, ir_seconds: float = 1.6) -> np.ndarray:
    """A small steel ringer gong over `f0`: `strikes` (an impulse train, each
    value a hit's force) convolved with its inharmonic, separately decaying
    partials (a bowl's ratios, the high ones dying first)."""
    t = dsp.timebase(ir_seconds)
    ir = np.zeros_like(t)
    for ratio, amp, t60 in ((1.0, 1.0, 1.3), (2.32, 0.55, 0.8), (4.25, 0.3, 0.5), (6.63, 0.14, 0.3)):
        ir += amp * np.exp(-6.907755 * t / t60) * np.sin(dsp.TAU * ratio * f0 * t)
    return dsp.convolve(strikes, ir)


def phone_ring(rng: np.random.Generator) -> np.ndarray:
    """An old electromechanical telephone, two double rings: the 20 Hz
    ringing current swings the clapper between two gongs a little apart in
    pitch (each struck twenty times a second, the hits interleaved), in the
    double-ring cadence (0.4 s on, 0.2 off, 0.4 on, 2 off); a small room."""
    s = 5.6
    n = dsp.frames(s)
    bursts = [(0.0, 0.4), (0.6, 0.4), (3.0, 0.4), (3.6, 0.4)]
    a, b = np.zeros(n), np.zeros(n)
    for start, dur in bursts:
        hits = np.arange(start, start + dur, 1 / 20.0)
        force = np.minimum(1.0, 0.55 + 0.25 * np.arange(len(hits))) * (0.9 + 0.1 * rng.random(len(hits)))
        jit = rng.normal(0, 0.0006, len(hits))
        ia = np.clip(((hits + jit) * dsp.RATE).astype(np.int64), 0, n - 1)
        ib = np.clip(((hits + 0.025 - jit) * dsp.RATE).astype(np.int64), 0, n - 1)
        a[ia] += force
        b[ib] += force * 0.9
    bells = _gong(a, 1180.0) + _gong(b, 1365.0)
    rattle = dsp.highpass(dsp.convolve(a + b, dsp.white(0.003, rng) * dsp.decay(0.003, 0.002)), 2500)
    x = dsp.lowpass(bells + 0.35 * rattle, 9000)
    room = dsp.reverb(dsp.pad(x, after=0.8), room=0.35, damp=0.5, wet=0.14, width=0.3)
    return dsp.dc_block(dsp.fit(dsp.to_mono(room), s), 40)


# -- dialling ------------------------------------------------------------------------


def _key(digit: str, on: float, twist_db: float = 2.0) -> np.ndarray:
    lo, hi = dsp.DTMF[digit]
    return dsp.fade((dsp.sine(lo, on) + dsp.db_to_lin(twist_db) * dsp.sine(hi, on)) / 2.3, 0.004, 0.004)


def _human_dial(digits: str, rng: np.random.Generator, at: float = 0.0) -> tuple[list[tuple[np.ndarray, float]], float]:
    """Touch-tone keys pressed by a person: each held 80–150 ms, 100–220 ms
    apart, with a longer breath at each space (the 3-3-4 grouping). Returns
    the `mix` layers and when the last key lets go."""
    layers = []
    t = at
    for ch in digits:
        if ch == " ":
            t += float(rng.uniform(0.18, 0.3))
            continue
        on = float(rng.uniform(0.08, 0.15))
        layers.append((_key(ch, on), t))
        t += on + float(rng.uniform(0.1, 0.22))
    return layers, t


def dtmf_dialing(rng: np.random.Generator) -> np.ndarray:
    """Someone dials a ten-digit number on a touch-tone phone: the handset
    lifts, a moment of dial tone (which stops at the first key), then ten
    keys at a person's uneven pace in 3-3-4 groups (a fictional 555-01xx
    number), and the line goes quiet."""
    s = 4.6
    keys, done = _human_dial("902 555 0148", rng, at=0.75)
    dial = dsp.call_progress("dial", 0.62) * dsp.line([(0, 0), (0.02, 1), (0.6, 1), (0.62, 0)], 0.62)
    x = dsp.mix((_hook_click(rng), 0.0, -4), (dial, 0.1, -6), *[(k, t, -4) for k, t in keys], seconds=s)
    tail = dsp.line([(0, 1), (done + 0.3, 1), (s, 0.3)], s)
    return _line(x, rng) * tail


def touch_tone_dial(rng: np.random.Generator) -> np.ndarray:
    """Off hook, a second of dial tone, seven touch-tone digits (a 555
    number), the line clicking through into a ring-back's first burst."""
    s = 5.2
    line_hiss = dsp.white(s, rng) * 0.02
    dial = dsp.call_progress("dial", 1.3) * dsp.line([(0, 0), (0.02, 1), (1.27, 1), (1.3, 0)], 1.3)
    digits = dsp.dtmf("5550147", on=0.1, off=0.08)
    ring = dsp.call_progress("ringback", 1.6) * dsp.line([(0, 0), (0.05, 1), (1.5, 1), (1.6, 0)], 1.6)
    clunk = dsp.lowpass(dsp.crackle(0.12, rng, density=120), 1500)
    x = dsp.mix(
        (_hook_click(rng), 0.0, -4),
        (dial, 0.12, -6),
        (digits, 1.55, -5),
        (clunk, 2.95, -10),
        (ring, 3.35, -8),
        line_hiss,
        seconds=s,
    )
    return dsp.dc_block(dsp.saturate(dsp.telephone(x), 0.15), 40)


# -- the modem ------------------------------------------------------------------------


def _v21(seconds: float, rng: np.random.Generator, high: bool) -> np.ndarray:
    """V.21 FSK at 300 baud (the V.8 menu and its answer): the low channel
    (980 / 1180 Hz, the caller) or the high one (1650 / 1850, the answerer);
    ten ones of preamble, then random-looking data."""
    mark, space = (1650, 1850) if high else (980, 1180)
    count = max(1, int(round(seconds * 300)))
    bits = "1" * 10 + "".join(str(b) for b in rng.integers(0, 2, max(0, count - 10)))
    return dsp.fade(dsp.fit(dsp.fsk(bits, 300, mark, space), seconds), 0.005, 0.005)


def _bong(seconds: float) -> np.ndarray:
    """One of V.34's "bong" tones: 1200 and 2400 Hz together with a phase
    reversal half way (the band-limited line dips at the flip, which is the
    bong's knock), swelling in and ringing down."""
    t = dsp.timebase(seconds)
    tone = np.sin(dsp.TAU * 1200 * t) + 0.8 * np.sin(dsp.TAU * 2400 * t)
    # the reversal as a 3 ms crossfade into the inverted tone: it still dips
    # through zero (the knock) but without a hard step's crackle
    flip = np.clip((t - seconds / 2) / 0.003 + 0.5, 0, 1)
    tone = tone * (1 - 2 * flip)
    return tone * dsp.line([(0, 0), (0.015, 1), (seconds * 0.6, 0.85), (seconds, 0)], seconds)


def _probe(seconds: float, rng: np.random.Generator) -> np.ndarray:
    """Line probing: a comb of cosines every 150 Hz across the band (a few
    left out, as the standard does), at fixed random phases — a hard buzz."""
    t = dsp.timebase(seconds)
    out = np.zeros_like(t)
    for k in range(1, 26):
        if k * 150 in (900, 1200, 1800, 2400):
            continue
        out += np.cos(dsp.TAU * (k * 150 * t + float(rng.random())))
    return dsp.fade(out / 8, 0.004, 0.004)


def _squeal(seconds: float, rng: np.random.Generator) -> np.ndarray:
    """The 56k squeal (digital-impairment learning, as it sounds): a bright
    tone gliding up 1500 → 2700 Hz, frequency-modulated at half its pitch
    so it grows a ladder of sidebands, over a rough noise floor."""
    f = dsp.glide(1500, 2700, seconds)
    index = dsp.line([(0, 0.4), (seconds, 2.2)], seconds)
    tone = dsp.fm(f, ratio=0.5, index=index)
    grit = dsp.bandpass(dsp.white(seconds, rng), 2200, 0.8)[: len(f)] * 1.2
    return dsp.fade(tone + grit, 0.006, 0.01)


def _qam(seconds: float, rng: np.random.Generator, periodic: float = 0.0) -> np.ndarray:
    """Training: 16-QAM at 2400 symbols a second on an 1800 Hz carrier, so
    it fills the band like hiss. The first `periodic` seconds repeat one
    16-symbol pattern (lines every 150 Hz: the buzzing "brrr" before the
    "shhh"); after that every symbol is random (scrambled data)."""
    n = dsp.frames(seconds)
    step = dsp.RATE // 2400
    count = n // step + 1
    levels = np.array([-3.0, -1.0, 1.0, 3.0])
    i_sym = levels[rng.integers(0, 4, count)]
    q_sym = levels[rng.integers(0, 4, count)]
    fixed = int(periodic * 2400)
    if fixed:
        i_sym[:fixed] = np.resize(i_sym[:16], fixed)
        q_sym[:fixed] = np.resize(q_sym[:16], fixed)
    i_train, q_train = np.zeros(n), np.zeros(n)
    i_train[::step] = i_sym[: len(i_train[::step])]
    q_train[::step] = q_sym[: len(q_train[::step])]
    i_bb = dsp.lowpass(i_train, 1250, order=4)
    q_bb = dsp.lowpass(q_train, 1250, order=4)
    t = dsp.timebase(n=n)
    x = i_bb * np.cos(dsp.TAU * 1800 * t) - q_bb * np.sin(dsp.TAU * 1800 * t)
    return dsp.fade(x / max(1e-9, float(np.abs(x).max())), 0.004, 0.004)


def _handshake(rng: np.random.Generator, short: bool) -> tuple[list[tuple], float]:
    """The answer-to-connect half of a dial-up handshake as `mix` layers,
    starting at 0, and when the speaker mutes. `short` squeezes every phase
    (the quick reconnect)."""
    k = 0.45 if short else 1.0
    ans_s = 0.6 if short else 1.3
    t = 0.0
    layers: list[tuple] = [(dsp.fade(dsp.ansam(ans_s), 0.01, 0.01), t, -4)]
    layers.append((_v21(0.4 * k + 0.1, rng, high=False), t + ans_s - (0.5 * k + 0.05), -7))
    t += ans_s
    layers.append((_v21(0.3 * k, rng, high=True), t, -6))
    t += 0.3 * k + 0.08
    bong_s = 0.2 if short else 0.22
    layers.append((_bong(bong_s), t, -3))
    t += bong_s + (0.0 if short else 0.03)
    if not short:
        layers.append((_bong(bong_s), t, -4))
        t += bong_s + 0.05
    probe_s = 0.2 if short else 0.36
    layers.append((_probe(probe_s, rng), t, -6))
    t += probe_s
    squeal_s = 0.38 if short else 0.62
    layers.append((_squeal(squeal_s, rng), t, -5))
    t += squeal_s
    train_s = 0.75 if short else 1.3
    hiss = _qam(train_s, rng, periodic=0.12 if short else 0.28)
    # the last phase is brighter (the modems agree on a faster rate)
    lift = dsp.line([(0, 0.8), (train_s * 0.55, 0.8), (train_s * 0.6, 1.0), (train_s, 1.0)], train_s)
    layers.append((dsp.highshelf(hiss, 2500, 3) * lift, t, -5))
    t += train_s
    return layers, t


def modem_handshake(rng: np.random.Generator) -> np.ndarray:
    """The story's arrival sound: a 56k modem dials in, out of its own little
    speaker — off hook, dial tone, seven quick touch tones, a burst of
    ring-back, the answer tone's whine with its reversals, the V.21 chatter,
    two bongs, the line-probe buzz, the squeal, the training hiss, and the
    speaker cuts to silence once it connects."""
    s = 7.8
    dial = dsp.call_progress("dial", 0.8) * dsp.line([(0, 0), (0.02, 1), (0.78, 1), (0.8, 0)], 0.8)
    digits = dsp.dtmf("5550199", on=0.07, off=0.06)
    ring = dsp.call_progress("ringback", 0.5) * dsp.line([(0, 0), (0.03, 1), (0.45, 1), (0.5, 0)], 0.5)
    clunk = dsp.lowpass(dsp.crackle(0.08, rng, density=150), 1500)
    answer = 2.7
    shake, mute = _handshake(rng, short=False)
    layers = [
        (_hook_click(rng), 0.0, -4),
        (dial, 0.08, -6),
        (digits, 0.95, -5),
        (clunk, 1.95, -12),
        (ring, 2.05, -8),
        *[(sig, answer + at, g) for sig, at, g in shake],
    ]
    mute_at = answer + mute
    x = dsp.mix(*layers, seconds=s)
    x = x + _hiss(s, rng) * dsp.line([(0, 0), (0.05, 1), (mute_at - 0.01, 1), (mute_at, 0)], s)
    speaker = _line(x) * dsp.line([(0, 1), (mute_at - 0.008, 1), (mute_at, 0)], s)
    return dsp.mix(speaker, (_relay(rng), mute_at + 0.03, -16), seconds=s)


def modem_connect_short(rng: np.random.Generator) -> np.ndarray:
    """A quick modem connect (a redial, a reconnect): the answer tone, a
    flick of V.21, one bong, the probe buzz, a short squeal, a burst of
    training hiss and the speaker mutes."""
    s = 2.5
    shake, mute = _handshake(rng, short=True)
    x = dsp.mix(*shake, seconds=s)
    x = x + _hiss(s, rng) * dsp.line([(0, 1), (mute - 0.01, 1), (mute, 0)], s)
    speaker = _line(x) * dsp.line([(0, 1), (mute - 0.008, 1), (mute, 0)], s)
    return dsp.mix(speaker, (_relay(rng), min(s - 0.06, mute + 0.03), -16), seconds=s)


# -- odds and ends ------------------------------------------------------------------------


def off_hook_howler(rng: np.random.Generator) -> np.ndarray:
    """The receiver-off-hook howler: 1400 + 2060 + 2450 + 2600 Hz pulsed ten
    times a second, growing louder (the exchange's "hang up your phone"), the
    four tones beating against each other into a snarl."""
    s = 4.0
    x = dsp.call_progress("off_hook", s) * dsp.line([(0, 0.2), (3.0, 1.0), (s, 1.0)], s, curve="exp")
    x = x * dsp.line([(0, 1), (s - 0.15, 1), (s, 0)], s)
    return _line(x, rng, drive=0.25)


def sit_intercept(rng: np.random.Generator) -> np.ndarray:
    """The special-information tones before "the number you have dialed …":
    three rising steps, 913.8, 1370.6 and 1776.7 Hz (274, 274 and 380 ms),
    down the line, then the line's hush."""
    s = 1.4
    parts = []
    t = 0.05
    for f, dur in ((913.8, 0.274), (1370.6, 0.274), (1776.7, 0.380)):
        parts.append((dsp.fade(dsp.sine(f, dur), 0.004, 0.004), t))
        t += dur + 0.002
    x = dsp.mix(*parts, seconds=s)
    return _line(x, rng) * dsp.line([(0, 1), (t + 0.2, 1), (s, 0.2)], s)


def line_click(rng: np.random.Generator) -> np.ndarray:
    """The line clicking (a hook switch, someone picking up an extension):
    the contacts bounce, the transformer thumps, a breath of the line's hiss
    opens and closes."""
    s = 0.4
    thump = dsp.sine(dsp.glide(260, 160, 0.06), None) * dsp.decay(0.06, 0.04)
    hiss = _hiss(0.3, rng, -30) * dsp.line([(0, 0), (0.01, 1), (0.3, 0)], 0.3)
    x = dsp.mix((_relay(rng), 0.01), (thump, 0.012, -6), (dsp.telephone(hiss), 0.02))
    return dsp.dc_block(dsp.fit(dsp.highpass(x, 120), s), 40)


def hangup_tone(rng: np.random.Generator) -> np.ndarray:
    """The other end hangs up: a click on the line, a beat of nothing, then
    the fast busy (reorder: 480 + 620 Hz, a quarter second on and off)."""
    s = 4.0
    reorder = dsp.call_progress("reorder", 3.5)
    x = dsp.mix((_relay(rng), 0.02, -8), (reorder, 0.45, -3), seconds=s)
    return _line(x, rng)


def pager_beeps(rng: np.random.Generator) -> np.ndarray:
    """A 90s belt pager going off: three bursts of four quick piezo beeps at
    3.1 kHz (a square-ish piezo: odd harmonics, band-limited), in its little
    plastic case."""
    s = 2.1
    beep = dsp.fade(dsp.additive(3100.0, 0.06, partials=[(1, 1.0), (3, 0.25), (5, 0.05)]), 0.003, 0.004)
    layers = [(beep, g + i * 0.11) for g in (0.0, 0.62, 1.24) for i in range(4)]
    x = dsp.mix(*layers, seconds=s)
    case = dsp.peak_eq(dsp.highpass(x, 600), 2800, 4, 1.5)
    room = dsp.reverb(dsp.pad(case, after=0.3), room=0.25, damp=0.6, wet=0.1, width=0.2)
    return dsp.fit(dsp.to_mono(room), s)


SOUNDS: list[Spec] = [
    Spec("dial_tone", "telephony", dial_tone, 6.0, loop=True, note="North American dial tone, 350 + 440 Hz, down the line (seamless loop)"),
    Spec("busy_signal", "telephony", busy_signal, 6.0, loop=True, note="busy signal, 480 + 620 Hz, half a second on and off (seamless loop)"),
    Spec("ringback", "telephony", ringback, 6.0, loop=True, note="ring-back, 440 + 480 Hz, two seconds on, four off (seamless loop)"),
    Spec("phone_ring", "telephony", phone_ring, 5.6, note="old electromechanical phone bell, two double rings"),
    Spec("off_hook_howler", "telephony", off_hook_howler, 4.0, note="the off-hook howler: four pulsing tones growing louder"),
    Spec("dtmf_dialing", "telephony", dtmf_dialing, 4.6, note="a person dials ten touch-tone digits after a moment of dial tone"),
    Spec("touch_tone_dial", "telephony", touch_tone_dial, 5.2, note="off hook, dial tone, seven touch-tone digits, the ring-back begins"),
    Spec("modem_handshake", "telephony", modem_handshake, 7.8, story="modem_handshake", note="a 56k modem dials in: dial tone, touch tones, answer tone, bongs, squeal, hiss, silence"),
    Spec("modem_connect_short", "telephony", modem_connect_short, 2.5, note="a quick modem reconnect: answer tone, bong, squeal, hiss"),
    Spec("fax_cng", "telephony", fax_cng, 7.0, loop=True, note="a fax calling: 1100 Hz beeps every 3.5 s (seamless loop)"),
    Spec("sit_intercept", "telephony", sit_intercept, 1.4, note="special-information tones: three rising steps before a recording"),
    Spec("line_click", "telephony", line_click, 0.4, note="the phone line clicks: contact bounce, a thump, a breath of hiss"),
    Spec("hangup_tone", "telephony", hangup_tone, 4.0, note="the far end hangs up: a click, then the fast busy (reorder)"),
    Spec("pager_beeps", "telephony", pager_beeps, 2.1, note="a 90s belt pager: three bursts of four piezo beeps"),
]
