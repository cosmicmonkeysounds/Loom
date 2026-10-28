"""Retro: chip-tune blips, power-ups, game-over stings, 8-bit jingles,
early-PC beeps (wave 38, C6).

The sound of a 1980s sound chip: `pulse` waves at 12.5 / 25 / 50 % width,
a `triangle` bass, a noise channel through `bitcrush`, notes stepped by
`sequence` at frame rate (≈ 60 Hz arpeggios), everything `downsample`d a
little. Use your own melodies: no famous game motif.
"""

from __future__ import annotations

import numpy as np

from . import dsp
from .spec import Spec


def _chip(width: float) -> dsp.Voice:
    def voice(freq: float, dur: float) -> np.ndarray:
        tone = dsp.pulse(dsp.vibrato(freq, dur, rate=7, depth_cents=12), width=width)
        return tone * dsp.adsr(dur, 0.002, 0.05, 0.6, min(0.04, dur / 2))

    return voice


def chip_powerup(rng: np.random.Generator) -> np.ndarray:
    """A rising chip-tune power-up: a fast stepped arpeggio climbing two
    octaves on a thin pulse, an octave-up echo on a fatter one, a crushed
    noise sparkle at the top."""
    s = 1.1
    step = 1 / 30
    climb = ["G4", "B4", "D5", "G5", "A5", "C6", "E6", "G6", "B5", "D6", "F#6", "B6"]
    notes = [(n, i * step, step * 0.9) for i, n in enumerate(climb)] + [("G6", len(climb) * step, 0.45)]
    lead = dsp.sequence(notes, _chip(0.125), seconds=s)
    echo = dsp.sequence([(n, t + 0.05, d * 0.8, -9) for n, t, d in notes], _chip(0.5), seconds=s)
    spark = dsp.bitcrush(dsp.highpass(dsp.white(0.3, rng), 5000), 4) * dsp.decay(0.3, 0.25)
    x = dsp.mix(lead, echo, (spark, len(climb) * step, -12), seconds=s)
    return dsp.downsample(x, 24000)


SOUNDS: list[Spec] = [
    Spec("chip_powerup", "retro", chip_powerup, 1.1, note="8-bit power-up: a stepped pulse arpeggio climbing two octaves"),
]
