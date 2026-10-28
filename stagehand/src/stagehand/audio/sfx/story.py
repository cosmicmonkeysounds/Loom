"""Story: the sounds made for *Trapped in the Internet*'s own beats
(wave 38, C6) — the stand-ins for the story's `sound X` files (each with
`story=` and a matching `library:` key in media/sounds.yaml) and the
show's own little interface sounds.

These sit inside the show's fiction (a computer's insides in 1999), so they
borrow every category's tools: a printer is a motor and a stepper, the beans
are crackle through a bowl, the glitch is crushed digital, the fanfare is
brass. Keep the story stand-ins near the length in their manifest `real:`
line.
"""

from __future__ import annotations

import numpy as np

from . import dsp
from .spec import Spec


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


SOUNDS: list[Spec] = [
    Spec("access_denied", "story", access_denied, 0.75, note="a terminal refusing you: two low rough buzzes"),
]
