"""Sirens: wails, yelps, klaxons, alarms (wave 38, C6).

A mechanical siren's pitch is its rotor's speed, so it rises and falls on a
smooth, slightly lagging curve (`dsp.smooth` over a breakpoint `sweep`) and
its tone is a hollow, odd-harmonic buzz with a breath of air through the
ports. Electronic sirens (yelp, hi-lo, the server alarm) are square or saw
oscillators on fast LFO or stepped pitch curves.
"""

from __future__ import annotations

import numpy as np

from . import dsp
from .spec import Spec


def siren_wail(rng: np.random.Generator) -> np.ndarray:
    """Two slow rises and falls of an outdoor rotor siren, heard from down the
    street: the rotor spins up to ≈ 950 Hz, coasts, sags; the air hiss rides
    the tone; a little slapback off the buildings."""
    s = 7.0
    contour = dsp.sweep([(0, 260), (1.4, 940), (2.2, 960), (3.3, 520), (4.1, 900), (4.8, 950), (6.2, 300), (s, 240)], s)
    f = dsp.jitter(dsp.smooth(contour, 0.18), rng, cents_rms=6, rate=4)
    tone = dsp.additive(f, partials=[(1, 1.0), (2, 0.12), (3, 0.42), (5, 0.22), (7, 0.11), (9, 0.05)])
    air = dsp.bandpass(dsp.white(s, rng), 1800, 0.8) * (0.15 + 0.85 * (f / 960) ** 2)
    body = dsp.peak_eq(tone + 0.35 * air, 1100, 4, 0.9)
    env = dsp.line([(0, 0), (0.25, 1), (6.3, 1), (s, 0)], s)
    street = dsp.reverb(dsp.pad(body * env, after=0.6)[: dsp.frames(s)], room=0.55, damp=0.6, wet=0.22, width=0.4)
    return dsp.to_mono(street)


SOUNDS: list[Spec] = [
    Spec("siren_wail", "sirens", siren_wail, 7.0, note="outdoor rotor siren: two slow rises and falls, down the street"),
]
