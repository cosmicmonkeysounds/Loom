"""Party: horns, poppers, fanfares, crowd cheers, drum rolls, rimshots,
game-show stings (wave 38, C6).

Physical toys are a source through a resonator: a buzzing reed (`saw` or
`pulse` with `jitter`) into a paper tube (`bandpass` / `peak_eq`); a popper
is a noise burst with a fast `decay` plus confetti `crackle`. Brass is `saw`
through a lowpass that opens with the note's envelope.
"""

from __future__ import annotations

import numpy as np

from . import dsp
from .spec import Spec


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


SOUNDS: list[Spec] = [
    Spec("party_horn", "party", party_horn, 1.4, note="paper party blower: a buzzy toot that wobbles up, holds, sags"),
]
