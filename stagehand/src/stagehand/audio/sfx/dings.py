"""Dings: bells, chimes, notifications, correct / wrong answers (wave 38, C6).

FM is the workhorse here: a carrier with a modulator at a non-integer ratio
(3.5, 1.4, √2 …) and an index that decays with the note gives the bright
strike melting into a pure hum that reads as metal or glass. Additive
partials at measured bell ratios (0.5, 1, 1.2, 1.5, 2, 2.5, 3 …) give a
tuned bell. Keep each strike's decay inside the sound (the edge fade is only
5 ms).
"""

from __future__ import annotations

import numpy as np

from . import dsp
from .spec import Spec


def _strike(freq: float, seconds: float, t60: float, brightness: float = 2.2) -> np.ndarray:
    """One glassy FM strike: index falls from `brightness` to near zero."""
    index = brightness * dsp.decay(seconds, t60 * 0.35) + 0.05
    return dsp.fm(freq, seconds, ratio=3.5, index=index) * dsp.decay(seconds, t60, attack=0.002)


def notify_ding(rng: np.random.Generator) -> np.ndarray:
    """A soft two-strike notification (a fifth, falling), a small room
    around it: friendly, not urgent."""
    s = 1.6
    hi = _strike(dsp.hz("E6"), 1.4, 1.1)
    lo = _strike(dsp.hz("A5"), 1.4, 1.3, brightness=1.6)
    shimmer = dsp.highpass(dsp.white(0.03, rng), 6000) * dsp.decay(0.03, 0.02)
    x = dsp.mix((hi, 0.0), (shimmer, 0.0, -14), (lo, 0.14, -2), seconds=s)
    return dsp.to_mono(dsp.reverb(x, room=0.35, damp=0.5, wet=0.18))


SOUNDS: list[Spec] = [
    Spec("notify_ding", "dings", notify_ding, 1.6, note="soft two-strike glassy notification, a falling fifth"),
]
