"""One library sound's declaration (wave 38, C6).

A category module lists its sounds as `Spec`s; `registry.py` gathers them.
The spec lives in its own module so a category can import it without
importing the registry (which imports every category).
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

#: The categories, one module each, and each one's folder under media/library/.
CATEGORIES = ("sirens", "dings", "telephony", "digital", "retro", "party", "story", "ambient")
#: snake_case for every sound but the ambient loops, whose names are the
#: story's hyphenated `LOCATION … ambient:` keys (`dryer-tumble`).
NAME = re.compile(r"^[a-z][a-z0-9_]{0,47}$")
AMBIENT_NAME = re.compile(r"^[a-z][a-z0-9-]{0,47}$")
MAX_NOTE = 160

Render = Callable[[np.random.Generator], np.ndarray]


@dataclass(frozen=True)
class Spec:
    """A sound: `render(rng)` returns float mono `(frames,)` (or, for a loop,
    stereo `(frames, 2)`) about `seconds` long, at any level (render.py sets
    it). `story` is the story `sound X` it stands in for, if any (the
    manifest's `library:` key is the switch; this is the cross-check). `note`
    says what it is in a few words and lands in the WAV's ICMT. `level_db`
    moves a loop's RMS target off −18 dBFS (a sparse bed: drips, a ticking
    clock) and is refused on a one-shot."""

    name: str
    category: str
    render: Render
    seconds: float
    loop: bool = False
    story: str | None = None
    note: str = ""
    level_db: float | None = None

    def __post_init__(self) -> None:
        if self.category not in CATEGORIES:
            raise ValueError(f"sfx {self.name!r}: category {self.category!r} is not one of {', '.join(CATEGORIES)}")
        pattern = AMBIENT_NAME if self.category == "ambient" else NAME
        if not pattern.match(self.name):
            shape = "lower-case-with-hyphens (the LOCATION ambient key)" if self.category == "ambient" else "snake_case"
            raise ValueError(f"sfx {self.name!r}: a {self.category} name is {shape}, ≤ 48 chars")
        if self.category == "ambient" and not self.loop:
            raise ValueError(f"sfx {self.name!r}: an ambient sound is a loop (loop=True)")
        if isinstance(self.seconds, bool) or not isinstance(self.seconds, (int, float)) or not 0.05 <= self.seconds <= 600:
            raise ValueError(f"sfx {self.name!r}: seconds must be 0.05–600")
        if not self.note or len(self.note) > MAX_NOTE:
            raise ValueError(f"sfx {self.name!r}: needs a note of 1–{MAX_NOTE} chars")
        if self.level_db is not None and (not self.loop or not -40 <= self.level_db <= -6):
            raise ValueError(f"sfx {self.name!r}: level_db is a loop's RMS target, −40…−6 dBFS")
        if self.story is not None and not NAME.match(self.story):
            raise ValueError(f"sfx {self.name!r}: story {self.story!r} is not a story sound name")
