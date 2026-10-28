"""Every sound in the SFX library, by name (wave 38, C6).

HOW TO ADD A SOUND
==================

1. Pick the category module (`sirens`, `dings`, `telephony`, `digital`,
   `retro`, `party`, `story`, `ambient`) and write a render function that
   takes the sound's own `rng` (a seeded `np.random.Generator`) and returns
   float mono `(frames,)` — or, for a loop, stereo `(frames, 2)` if you want.
   Build it from `dsp` (oscillators, noise, envelopes, filters, reverb,
   `mix`, `sequence` …); never `np.random.*` globals, never the clock: the
   render must be byte-identical every time.
2. Append a `Spec(name, category, render, seconds, loop, story, note)` to the
   module's `SOUNDS`. `seconds` is the rendered length (the tests allow
   ±5 %). `note` is a few words (≤ 160 chars) saying what it is; it lands in
   the WAV's ICMT.
3. `uv run pytest -q tests/test_sfx_framework.py` (every sound is rendered
   and checked automatically), then listen:
   `uv run stagehand sounds library --only <name> --config trapped.house.yaml`
   and look: `uv run --with matplotlib python -m stagehand.audio.sfx.inspect
   --only <name> --out /tmp/sfx`.

Naming. snake_case (`siren_wail`, `clock_tick`), unique across the whole
library (the registry refuses a duplicate). Ambient loops are named by the
story's hyphenated `LOCATION … ambient:` keys in `main.loom`
(`dryer-tumble` is the Fan Closet's, `fridge-hum` the Start Bar's …).
A story sound's stand-in names the story sound in `story=` and the manifest
(`media/sounds.yaml`) carries the matching `library: <name>`; the test pins
both directions.

Originality (C6). Every sound is original synthesis: no sample, and no
recreation of a trademarked or famous sound — no Windows / Mac / AOL / Nokia
/ Intel motif, no famous game jingle, no film sound. A generic protocol tone
is fine and should be accurate: the North American dial tone (350 + 440 Hz),
ringback, busy, reorder, DTMF, the V.8 / V.34 handshake's character, fax
CNG (`dsp.call_progress`, `dsp.dtmf`, `dsp.ansam`, `dsp.fsk`). A sound in
the *style* of an era (a 90s start-up chord, an 8-bit power-up) uses your own
notes.

Levels (render.py does them, so render at any level). A one-shot is peak
normalised to −1 dBFS. A loop is set to ≈ −18 dBFS RMS with its peak held ≤
−1 dBFS by a soft limiter; a sparse loop whose crest factor is above ≈ 17 dB
(drips, ticks) should ask for a lower RMS with `level_db=` (e.g. −24) rather
than be squashed. A one-shot gets a 0.5 ms fade in and a 5 ms fade out (no
click); still end it in its own decay. Keep a sound clean: `dsp.dc_block`
after saturation or brown noise.

Loops (`loop=True`; every ambient sound). The last sample must flow into
the first: the test checks the jump across the seam and that the seam's
sample-to-sample change is like the rest of the loop. Easiest is to build
it circularly: tones at `dsp.loop_freq` (whole cycles), periodic LFOs
(whole cycles too), events with `dsp.mix(..., seconds=S, wrap=True)`,
`pink` / `brown` noise (periodic by construction) and every filter /
reverb with `circular=True`. Otherwise render it `xfade` long and
`dsp.make_loop(x, S, xfade)`. Ambient loops are 20–40 s, quiet in
character (they sit under the music for an hour), and may be stereo.

Cost. Each render should take well under 0.5 s (the suite renders the
whole library twice in under a minute): prefer the FFT filters to `svf`
(≈ 12 ms per second of audio per call), and keep `svf` / `fm(feedback=)`
to short sounds.
"""

from __future__ import annotations

from . import ambient, digital, dings, party, retro, sirens, story, telephony
from .spec import CATEGORIES, Spec

MODULES = (sirens, dings, telephony, digital, retro, party, story, ambient)


def build(modules=MODULES) -> dict[str, Spec]:
    """name → Spec over every category module, in module order. A duplicate
    name (case-insensitive), or a spec in the wrong module, is an error."""
    out: dict[str, Spec] = {}
    seen: dict[str, str] = {}
    for mod in modules:
        category = mod.__name__.rsplit(".", 1)[-1]
        for spec in mod.SOUNDS:
            if not isinstance(spec, Spec):
                raise TypeError(f"{mod.__name__}.SOUNDS holds {spec!r}, not a Spec")
            if spec.category != category:
                raise ValueError(f"sfx {spec.name!r} says category {spec.category!r} but lives in {category}.py")
            key = spec.name.lower()
            if key in seen:
                raise ValueError(f"sfx {spec.name!r} is defined twice ({seen[key]} and {category})")
            seen[key] = category
            out[spec.name] = spec
    return out


SFX: dict[str, Spec] = build()

__all__ = ["CATEGORIES", "SFX", "Spec", "build"]
