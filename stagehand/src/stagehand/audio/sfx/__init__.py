"""The SFX library (wave 38, C6): original synthesized sounds as WAV files.

    uv run stagehand sounds library --config trapped.house.yaml [--out DIR] [--only a,b] [--list] [--story]

`dsp` is the synthesis toolkit, one module per category holds the sounds
(`sirens`, `dings`, `telephony`, `digital`, `retro`, `party`, `story`,
`ambient`), `registry.SFX` gathers them (its docstring is the how-to for
adding one), `render` turns a `Spec` into a tagged 48 kHz WAV, `cli` is the
command, and `inspect` draws a waveform + spectrogram per sound for review.
The output (`media/library/`) is git-ignored: anyone re-renders it, byte for
byte.

Imports stay light: the router imports only `dsp` (numpy alone) at run time,
for the footsteps (`audio/footsteps.py`).
"""

from __future__ import annotations
