"""Telephony: dial tones, touch tones, rings, busy signals, modems, fax
(wave 38, C6).

Protocol tones are generic and should be accurate (`dsp.CALL_PROGRESS`,
`dsp.DTMF`, `dsp.ansam`, `dsp.fsk`): the North American precise tones, the
V.8 answer tone, Bell 103 / 202 FSK. What makes them sound like a phone is
the line: `dsp.telephone` (the 300–3400 Hz band), a touch of `saturate` (a
cheap earpiece) and a little `white` hiss under everything.
"""

from __future__ import annotations

import numpy as np

from . import dsp
from .spec import Spec


def _hook_click(rng: np.random.Generator) -> np.ndarray:
    """A handset lifted: a dull plastic knock and a contact crackle."""
    knock = dsp.lowpass(dsp.white(0.04, rng), 900) * dsp.decay(0.04, 0.025)
    contact = dsp.highpass(dsp.crackle(0.05, rng, density=400), 2000) * 0.6
    return dsp.mix(knock, (contact, 0.004))


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


SOUNDS: list[Spec] = [
    Spec("touch_tone_dial", "telephony", touch_tone_dial, 5.2, note="off hook, dial tone, seven touch-tone digits, the ring-back begins"),
]
