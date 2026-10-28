"""Ambient: the room beds, one per `LOCATION … ambient:` key in the story's
`main.loom` (wave 38, C6), named by that key (`dryer-tumble` is the Fan
Closet's). The soundtrack (`media/soundtrack.yaml`) plays them as seamless
stream loops under the music, often for an hour, so they are quiet in
character, never melodic, and never have a moment that stands out on the
fortieth repeat.

Every one is built circularly (see the registry's HOW TO): the loop length
is fixed first, every periodic thing (a hum, a rotation, an LFO) is at a
`dsp.loop_freq` so it fits a whole number of times, every event is placed
with `mix(wrap=True)`, and every filter and the room run `circular=True`.
Then the seam is not a crossfade but simply not there.
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


def dryer_tumble(rng: np.random.Generator) -> np.ndarray:
    """The Fan Closet: a tumble dryer through a closet door. A motor hum, the
    drum's slow roll, airflow, a load of clothes thumping over once or twice a
    turn, and now and then a zipper or button ticking on the drum."""
    s = 24.0
    t = dsp.timebase(s)
    turn = dsp.loop_freq(0.82, s)  # drum revolutions per second, whole turns in the loop
    roll = 0.5 + 0.5 * np.sin(dsp.TAU * turn * t)

    hum_f = dsp.loop_freq(100, s)
    hum = sum(a * np.sin(dsp.TAU * hum_f * k * t + p) for k, a, p in ((1, 1.0, 0.0), (2, 0.35, 1.1), (3, 0.12, 2.3)))
    hum = hum * (0.85 + 0.15 * roll)

    rumble = dsp.bandpass(dsp.brown(s, rng), 70, 0.9, circular=True) * (0.6 + 0.4 * roll)
    air_l = dsp.lowpass(dsp.pink(s, rng), 1300, circular=True)
    air_r = dsp.lowpass(dsp.pink(s, rng), 1300, circular=True)
    air = np.stack([air_l, air_r], axis=1) * (0.9 + 0.1 * roll)[:, None]

    events = []
    rotations = int(round(turn * s))
    for r in range(rotations):
        for _ in range(1 if rng.random() < 0.6 else 2):
            at = (r + rng.uniform(0.55, 0.9)) / turn
            dur = rng.uniform(0.08, 0.16)
            thump = dsp.bandpass(dsp.pink(dur, rng), rng.uniform(110, 190), 1.2) * dsp.decay(dur, dur * 0.8, attack=0.006)
            events.append((dsp.pan(thump, rng.uniform(-0.3, 0.3)), at, rng.uniform(-4, 0)))
        if rng.random() < 0.3:
            tick_s = 0.05
            tick = dsp.bandpass(dsp.white(tick_s, rng), rng.uniform(2800, 4200), 6) * dsp.decay(tick_s, 0.03)
            ticks = dsp.mix(*[(tick, k * rng.uniform(0.06, 0.1)) for k in range(rng.integers(1, 4))])
            events.append((dsp.pan(ticks, rng.uniform(-0.5, 0.5)), (r + rng.uniform(0.1, 0.5)) / turn, -14))
    tumbling = dsp.mix(*events, seconds=s, wrap=True)

    bed = dsp.mix(
        (dsp.stereo(hum), 0.0, -22),
        (dsp.stereo(rumble), 0.0, -6),
        (air, 0.0, -9),
        (tumbling, 0.0, 9),
        seconds=s,
    )
    closet = dsp.dc_block(dsp.highshelf(bed, 3000, -6, circular=True), 30, circular=True)
    return dsp.reverb(closet, room=0.25, damp=0.7, wet=0.12, width=0.6, circular=True)


SOUNDS: list[Spec] = [
    Spec("dryer-tumble", "ambient", dryer_tumble, 24.0, loop=True, note="the Fan Closet: a tumble dryer behind a door, hum, roll, thumping clothes"),
]
