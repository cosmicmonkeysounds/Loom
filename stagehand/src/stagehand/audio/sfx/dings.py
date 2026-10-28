"""Dings: bells, chimes, notifications, correct / wrong answers (wave 38, C6).

FM is the workhorse here: a carrier with a modulator at a non-integer ratio
(3.5, 1.4, √2 …) and an index that decays with the note gives the bright
strike melting into a pure hum that reads as metal or glass. Additive
partials at measured bell ratios (0.5, 1, 1.2, 1.5, 2, 2.5, 3 …) give a
tuned bell. Keep each strike's decay inside the sound (the edge fade is only
5 ms).

Two rules keep these clean on a party PA. An FM index is capped per note so
the highest strong sideband (≈ carrier + (index + 1) × modulator) stays under
17 kHz: a high note with a bright index would otherwise fold back down as a
hash (`_fm_strike`). Each additive partial decays on its own clock, the high
ones faster, which is what makes a struck thing sound struck instead of an
organ (`_partials`).
"""

from __future__ import annotations

import numpy as np

from . import dsp
from .spec import Spec

#: The highest frequency an FM sideband or a partial may reach (aliasing guard).
_TOP = 17000.0

#: Partial ratios of a free-free bar (a doorbell's tone bar, a glockenspiel).
_BAR = (1.0, 2.756, 5.404, 8.933)
#: Of a wine glass rim (Rossing's measured modes, rounded).
_GLASS = (1.0, 2.32, 4.25, 6.63)


def _fm_strike(freq: float, seconds: float, t60: float, ratio: float = 3.5, brightness: float = 2.2, bright_t60: float | None = None) -> np.ndarray:
    """One FM strike: the index falls from `brightness` (capped so no strong
    sideband passes `_TOP`) to a whisper, so the attack is bright and the
    tail a near-pure tone."""
    cap = max(0.2, (_TOP - freq) / (freq * ratio) - 1)
    index = min(brightness, cap) * dsp.decay(seconds, bright_t60 or t60 * 0.35) + 0.05
    return dsp.fm(freq, seconds, ratio=ratio, index=index) * dsp.decay(seconds, t60, attack=0.002)


def _strike(freq: float, seconds: float, t60: float, brightness: float = 2.2) -> np.ndarray:
    """One glassy FM strike (the 3.5 ratio): index falls from `brightness`."""
    return _fm_strike(freq, seconds, t60, 3.5, brightness)


def _partials(freq: float, seconds: float, partials, t60: float, attack: float = 0.0015) -> np.ndarray:
    """An additive struck tone: `(ratio, amp, t60 factor)` per partial, each
    decaying on its own clock (the high ones die first); a partial above
    `_TOP` is left out."""
    out = np.zeros(dsp.frames(seconds))
    for ratio, amp, tf in partials:
        f = freq * ratio
        if f >= _TOP:
            continue
        out += amp * dsp.sine(f, seconds) * dsp.decay(seconds, t60 * tf, attack)
    return out


def _tick(rng: np.random.Generator, seconds: float = 0.012, lo: float = 3000) -> np.ndarray:
    """The mallet's contact: a few ms of highpassed noise (the 'k' of a strike)."""
    return dsp.highpass(dsp.white(seconds, rng), lo) * dsp.decay(seconds, seconds * 0.6)


def _room(x: np.ndarray, room: float = 0.3, wet: float = 0.15, damp: float = 0.5) -> np.ndarray:
    """A small room round a mono sound, folded back to mono (a one-shot is mono)."""
    return dsp.to_mono(dsp.reverb(x, room=room, damp=damp, wet=wet))


# -- notifications -------------------------------------------------------------------


def notify_ding(rng: np.random.Generator) -> np.ndarray:
    """A soft two-strike notification (a fifth, falling), a small room
    around it: friendly, not urgent."""
    s = 1.6
    hi = _strike(dsp.hz("E6"), 1.4, 1.1)
    lo = _strike(dsp.hz("A5"), 1.4, 1.3, brightness=1.6)
    shimmer = dsp.highpass(dsp.white(0.03, rng), 6000) * dsp.decay(0.03, 0.02)
    x = dsp.mix((hi, 0.0), (shimmer, 0.0, -14), (lo, 0.14, -2), seconds=s)
    return _room(x, room=0.35, wet=0.18)


def _bell_tone(freq: float, seconds: float, t60: float, rng: np.random.Generator, glass: float = 0.6) -> np.ndarray:
    """The library's house 'ding': a tuned additive bell (a slow beat from a
    detuned twin of the fundamental, a quiet octave and twelfth) under a
    glassy FM strike that gives the attack its sparkle."""
    tuned = _partials(
        freq,
        seconds,
        [(1.0, 1.0, 1.0), (1.0021, 0.35, 0.9), (2.0, 0.22, 0.45), (3.01, 0.08, 0.3), (4.17, 0.05, 0.18)],
        t60,
    )
    sparkle = _fm_strike(freq, seconds, t60 * 0.7, ratio=3.5, brightness=1.8, bright_t60=0.08)
    return tuned + glass * sparkle + 0.05 * dsp.pad(_tick(rng), after=seconds)[: dsp.frames(seconds)]


def ding(rng: np.random.Generator) -> np.ndarray:
    """One clean, warm notification ding on C6: a bell that sparkles on the
    strike and settles into a pure, gently beating tone."""
    s = 1.5
    return _room(_bell_tone(dsp.hz("C6"), s, 1.15, rng), room=0.3, wet=0.14)


def ding_double(rng: np.random.Generator) -> np.ndarray:
    """Ding-ding: the same bell twice, quickly, the second a touch softer
    (an incoming message that wants a look)."""
    s = 1.5
    f = dsp.hz("A5")
    one = _bell_tone(f, 1.3, 0.95, rng)
    x = dsp.mix((one, 0.0), (one, 0.16, -2.5), seconds=s)
    return _room(x, room=0.3, wet=0.14)


def notify_pop(rng: np.random.Generator) -> np.ndarray:
    """A round little bubble pop: a sine that leaps up an octave and a half
    in 45 ms and dies, a soft wet click on the front, an echo of it higher."""
    s = 0.4
    def bloop(f0: float, f1: float, length: float) -> np.ndarray:
        f = dsp.line([(0, f0), (0.045, f1), (length, f1 * 1.04)], length, curve="exp")
        return dsp.sine(f) * dsp.decay(length, 0.11, attack=0.003)

    click = dsp.bandpass(dsp.white(0.006, rng), 2500, 1.2) * dsp.decay(0.006, 0.004)
    x = dsp.mix((bloop(420, 1150, 0.25), 0.0), (click, 0.0, -10), (bloop(700, 1750, 0.2), 0.07, -9), seconds=s)
    return _room(x, room=0.2, wet=0.08)


def message_blip(rng: np.random.Generator) -> np.ndarray:
    """A short two-step blip (a chat message landing): a soft sine 'bl' and a
    fifth-up 'ip', each a touch of FM so it reads on a phone speaker."""
    s = 0.3
    def blip(f: float, length: float) -> np.ndarray:
        return dsp.fm(f, length, ratio=2.0, index=0.6 * dsp.decay(length, 0.05) + 0.1) * dsp.decay(length, length * 0.9, attack=0.004)

    x = dsp.mix((blip(1320, 0.07), 0.0), (blip(1980, 0.16), 0.055), seconds=s)
    return _room(x, room=0.15, wet=0.06)


# -- chimes --------------------------------------------------------------------------


def _chime_run(notes: list[str], gap: float, seconds: float, rng: np.random.Generator, last_t60: float = 1.15) -> np.ndarray:
    """Notes struck one after another `gap` apart on the house bell, the last
    left to ring."""
    layers = []
    for i, name in enumerate(notes):
        last = i == len(notes) - 1
        tone = _bell_tone(dsp.hz(name), seconds - i * gap, last_t60 if last else 0.7, rng, glass=0.7)
        layers.append((tone, i * gap, 0.0 if last else -1.5))
    return _room(dsp.mix(*layers, seconds=seconds), room=0.35, wet=0.16)


def chime_up(rng: np.random.Generator) -> np.ndarray:
    """Three bell notes rising (G5 C6 E6): something arrived, something good."""
    return _chime_run(["G5", "C6", "E6"], 0.11, 1.6, rng)


def chime_down(rng: np.random.Generator) -> np.ndarray:
    """Three bell notes falling (E6 B5 G5): something left, closed, signed off."""
    return _chime_run(["E6", "B5", "G5"], 0.12, 1.6, rng, last_t60=1.25)


def error_ding(rng: np.random.Generator) -> np.ndarray:
    """A dull, low 'bonk-bonk' falling a minor third: a wooden-ish FM strike
    (ratio 1.4, inharmonic and dark) with its top rolled off. 'Nope', not
    alarm."""
    s = 0.9
    def bonk(f: float, length: float) -> np.ndarray:
        tone = _fm_strike(f, length, 0.42, ratio=1.41, brightness=2.6, bright_t60=0.05)
        thud = dsp.sine(dsp.line([(0, f * 0.75), (0.04, f * 0.5)], length)) * dsp.decay(length, 0.09, attack=0.001)
        return dsp.lowpass(tone + 0.5 * thud, 1800)

    x = dsp.mix((bonk(dsp.hz("E4"), 0.5), 0.0), (bonk(dsp.hz("C#4"), 0.75), 0.15, 0.5), seconds=s)
    return dsp.highpass(_room(x, room=0.2, wet=0.1), 70)


def warning_beep(rng: np.random.Generator) -> np.ndarray:
    """Three bright beeps at ≈ 1 kHz, an instrument-panel warning: a sine with
    a band-limited square's edge mixed in and rolled off above 4 kHz, so it
    cuts without stinging; dry, as a panel speaker is."""
    s = 0.75
    on, step = 0.11, 0.2
    env = dsp.gates(s, [(i * step, on) for i in range(3)], attack=0.004, release=0.012)
    tone = dsp.sine(1046.5, s) + 0.3 * dsp.square(1046.5, s)
    return dsp.lowpass(tone, 4000) * env


def critical_stop(rng: np.random.Generator) -> np.ndarray:
    """A hard stop: a low dissonant saw cluster (C2 under C3, F♯3, B3, C4)
    slammed with a dark thud; its edge closes over half a second while the
    body groans on, ground a little by saturation. Our own notes, no system
    motif."""
    s = 1.8
    voices = [(dsp.hz("C2"), 0.6), (dsp.hz("C3"), 1.0), (dsp.hz("F#3"), 0.85), (dsp.hz("B3"), 0.7), (dsp.hz("C4"), 0.5)]
    cluster = sum(a * dsp.saw(dsp.cents(f, 7 * (i - 2)), s) for i, (f, a) in enumerate(voices))
    bright = dsp.lowpass(cluster, 3800) * dsp.decay(s, 0.6, attack=0.003)
    dark = dsp.lowpass(cluster, 900) * dsp.decay(s, 1.7, attack=0.003)
    chord = dsp.dc_block(dsp.saturate((bright * 0.7 + dark * 0.6) * 0.45, 0.6))
    boom = dsp.sine(dsp.line([(0, 120), (0.1, 50)], s, curve="exp")) * dsp.decay(s, 0.35, attack=0.002)
    hit = dsp.lowpass(dsp.white(s, rng), 1200) * dsp.decay(s, 0.1, attack=0.001)
    x = chord + 0.45 * boom + 0.5 * hit
    return dsp.highpass(_room(x, room=0.4, wet=0.14), 35)


def success_flourish(rng: np.random.Generator) -> np.ndarray:
    """An upbeat four-step flourish: E5 G5 D6 climbing quick, then a C6–E6–G6
    chord that rings, on a bright mallet (FM at ratio 1 for the warm body,
    the house bell an octave up for the sparkle)."""
    s = 1.7
    def mallet(f: float, length: float, t60: float) -> np.ndarray:
        body = _fm_strike(f, length, t60, ratio=1.0, brightness=2.4, bright_t60=0.12)
        return body + 0.35 * _bell_tone(f * 2, length, t60 * 0.8, rng, glass=0.4)

    layers = [(mallet(dsp.hz(n), 0.6, 0.4), t, 0.0) for n, t in (("E5", 0.0), ("G5", 0.085), ("D6", 0.17))]
    for i, n in enumerate(("C6", "E6", "G6")):  # strummed by 12 ms: a hand, not a sampler
        layers.append((mallet(dsp.hz(n), s - 0.33, 1.1), 0.3 + 0.012 * i, -4.5))
    return _room(dsp.mix(*layers, seconds=s), room=0.4, wet=0.18)


# -- bells ---------------------------------------------------------------------------


def doorbell(rng: np.random.Generator) -> np.ndarray:
    """Ding-dong: two metal tone bars (free-bar partials 1 : 2.76 : 5.40),
    E5 then C5, each hit by a felt hammer (a soft wooden knock under the
    ring), in a hallway."""
    s = 2.7
    def bar(f: float, length: float) -> np.ndarray:
        ring = _partials(f, length, [(r, a, tf) for r, a, tf in zip(_BAR, (1.0, 0.32, 0.12, 0.05), (1.0, 0.35, 0.18, 0.1))], 2.0, attack=0.002)
        knock = dsp.bandpass(dsp.white(length, rng), 700, 1.5) * dsp.decay(length, 0.03, attack=0.001)
        return ring + 0.18 * knock

    x = dsp.mix((bar(dsp.hz("E5"), s), 0.0), (bar(dsp.hz("C5"), s - 0.6), 0.6), seconds=s)
    return _room(x, room=0.45, wet=0.18)


def elevator_ding(rng: np.random.Generator) -> np.ndarray:
    """The lift has arrived: one soft, mellow chime on F♯5 with a slow
    shimmer (two near-unison partials beating), a gentle strike, a lobby."""
    s = 2.1
    f = dsp.hz("F#5")
    tone = _partials(f, s, [(1.0, 1.0, 1.0), (1.0032, 0.6, 1.0), (2.0, 0.25, 0.5), (3.0, 0.08, 0.3), (4.95, 0.03, 0.15)], 1.9, attack=0.004)
    strike = _fm_strike(f, s, 0.5, ratio=2.0, brightness=1.2, bright_t60=0.05)
    return _room(tone + 0.3 * strike, room=0.5, wet=0.2)


def correct_answer(rng: np.random.Generator) -> np.ndarray:
    """The game-show 'correct!': a bright bell chord (A major: A5 C♯6 E6) rung
    twice, fast, the second left to ring, with a sparkle on top."""
    s = 1.4
    def chord(length: float, t60: float) -> np.ndarray:
        return sum(_fm_strike(dsp.hz(n), length, t60, ratio=2.0, brightness=3.0, bright_t60=0.15) for n in ("A5", "C#6", "E6")) + 0.4 * _partials(dsp.hz("A6"), length, [(1, 1, 1), (2.32, 0.3, 0.4)], t60 * 0.7)

    x = dsp.mix((chord(0.4, 0.25), 0.0, -1.5), (chord(s - 0.12, 1.0), 0.12), seconds=s)
    return _room(x, room=0.35, wet=0.15)


def wrong_buzzer(rng: np.random.Generator) -> np.ndarray:
    """The game-show 'wrong!': a low, harsh, nasal buzz (two beating reeds at
    98 and 104 Hz through a honky mid peak), on for most of a second. Harsh
    on purpose, but rolled off above 3.5 kHz so it never shreds."""
    s = 1.0
    reeds = dsp.pulse(98, s, width=0.3) * 0.7 + dsp.saw(103.8, s) * 0.6
    tone = dsp.filt(reeds, dsp.Biquad.highpass(90), dsp.Biquad.peak(620, 7, 1.2), dsp.Biquad.peak(1500, 4, 2), dsp.Biquad.lowpass(3500))
    tone = dsp.dc_block(dsp.saturate(tone * 0.5, 0.5))
    env = dsp.line([(0, 0), (0.012, 1), (0.82, 0.92), (0.9, 0)], s)
    return tone * env


def bingo_ding(rng: np.random.Generator) -> np.ndarray:
    """BINGO! A brass desk bell slapped twice: a bright, high bell
    (inharmonic 1 : 2.61 : 4.83 : 7.3 with a beating twin) and the plunger's
    click on each hit."""
    s = 1.8
    def slap(length: float) -> np.ndarray:
        f = 1870.0
        ring = _partials(f, length, [(1.0, 1.0, 1.0), (1.0045, 0.5, 0.9), (2.61, 0.4, 0.45), (4.83, 0.16, 0.25), (7.3, 0.06, 0.15)], 1.3)
        click = dsp.highpass(dsp.white(0.01, rng), 2000) * dsp.decay(0.01, 0.006)
        return dsp.mix((ring, 0.0), (click, 0.0, -6), seconds=length)

    x = dsp.mix((slap(0.6), 0.0, -2.0), (slap(s - 0.2), 0.2), seconds=s)
    return _room(x, room=0.35, wet=0.15)


def glass_ping(rng: np.random.Generator) -> np.ndarray:
    """A knife tapped on a wine glass: a pure, high ring (glass-rim modes
    1 : 2.32 : 4.25 : 6.63, the fundamental beating slowly against its
    twin) that hangs for over a second."""
    s = 1.8
    f = 1480.0
    modes = [(1.0, 1.0, 1.0), (1.0019, 0.8, 1.0)] + [(r, a, tf) for r, a, tf in zip(_GLASS[1:], (0.35, 0.14, 0.05), (0.5, 0.3, 0.18))]
    ring = _partials(f, s, modes, 1.6, attack=0.001)
    tap = dsp.highpass(dsp.white(0.006, rng), 4000) * dsp.decay(0.006, 0.004)
    return _room(dsp.mix((ring, 0.0), (tap, 0.0, -8), seconds=s), room=0.3, wet=0.12)


SOUNDS: list[Spec] = [
    Spec("ding", "dings", ding, 1.5, note="one clean warm notification ding on C6: sparkly strike, pure beating tail"),
    Spec("ding_double", "dings", ding_double, 1.5, note="ding-ding: the house bell twice, quickly"),
    Spec("notify_ding", "dings", notify_ding, 1.6, note="soft two-strike glassy notification, a falling fifth"),
    Spec("notify_pop", "dings", notify_pop, 0.4, note="round little bubble pop with a higher echo"),
    Spec("message_blip", "dings", message_blip, 0.3, note="short two-step chat-message blip, a fifth up"),
    Spec("chime_up", "dings", chime_up, 1.6, note="three bell notes rising (G5 C6 E6)"),
    Spec("chime_down", "dings", chime_down, 1.6, note="three bell notes falling (E6 B5 G5)"),
    Spec("error_ding", "dings", error_ding, 0.9, note="dull low bonk-bonk falling a minor third: nope"),
    Spec("warning_beep", "dings", warning_beep, 0.75, note="three bright 1 kHz instrument-panel warning beeps"),
    Spec("critical_stop", "dings", critical_stop, 1.8, note="hard stop: low dissonant saw cluster slammed with a dark thud"),
    Spec("success_flourish", "dings", success_flourish, 1.7, note="upbeat four-step mallet flourish ending on a ringing C major chord"),
    Spec("doorbell", "dings", doorbell, 2.7, note="ding-dong on two metal tone bars (E5, C5), felt hammers, a hallway"),
    Spec("elevator_ding", "dings", elevator_ding, 2.1, note="the lift has arrived: one soft shimmering chime on F#5"),
    Spec("correct_answer", "dings", correct_answer, 1.4, note="game-show correct: a bright A major bell chord rung twice"),
    Spec("wrong_buzzer", "dings", wrong_buzzer, 1.0, note="game-show wrong: a low harsh nasal buzz, most of a second"),
    Spec("bingo_ding", "dings", bingo_ding, 1.8, note="BINGO: a brass desk bell slapped twice"),
    Spec("glass_ping", "dings", glass_ping, 1.8, note="a knife tapped on a wine glass: a pure high ring"),
]
