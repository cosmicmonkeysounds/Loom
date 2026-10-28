"""Digital: data bursts, glitches, downloads, beeps, scanner sweeps
(wave 38, C6).

The vocabulary of a computer that talks back: FSK warbles (`dsp.fsk`) for
data, `bitcrush` / `downsample` for something breaking, `svf` sweeps for
scanning, `gates` for stutter, `ring` for a metallic edge. Short and dry by
default; a little `reverb` only when it should sound like it is in the room.
"""

from __future__ import annotations

import numpy as np

from . import dsp
from .spec import Spec


def packet_burst(rng: np.random.Generator) -> np.ndarray:
    """A short squirt of data: three FSK packets at rising speeds, each with
    a sync chirp in front, the last one crushed as if it barely got through."""
    s = 1.5
    layers = []
    at = 0.05
    for i, baud in enumerate((300, 600, 1200)):
        bits = "".join(rng.choice(("0", "1"), 48 + 24 * i))
        chirp = dsp.sine(dsp.glide(900, 2600, 0.04)) * dsp.ar(0.04, 0.002)
        data = dsp.fsk(bits, baud, mark=1200 + 300 * i, space=2200 + 200 * i)
        data = dsp.fade(data, 0.003, 0.006)
        if i == 2:
            data = dsp.downsample(dsp.bitcrush(data, 5), 11025)
        layers += [(chirp, at, -3), (data, at + 0.05, -6)]
        at += 0.05 + len(data) / dsp.RATE + 0.08
    x = dsp.mix(*layers, seconds=s)
    return dsp.highpass(x, 250)


SOUNDS: list[Spec] = [
    Spec("packet_burst", "digital", packet_burst, 1.5, note="three FSK data packets at rising speeds, the last one crushed"),
]
