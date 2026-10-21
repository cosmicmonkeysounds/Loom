"""The router's media: story sounds from `sounds_dir`, and the test signals.

`sound printer_grind` plays `<sounds_dir>/printer_grind.(wav|aiff|aif|flac)`,
decoded with libsndfile and resampled once to the device rate, then kept in
memory (re-read when the file changes on disk). A name with no file is
logged once and skipped — never a crash mid-show. Names are matched exactly,
then case-insensitively; a name that isn't a plain file name (`../x`) is
refused.

The speaker test is a 1.5 s identifying tone — three rising beeps whose
pitch steps with the output number, so a walk round the house can tell
outputs apart by ear — followed by the speaker's spoken label.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

import numpy as np

from ..alexa.player import resample

log = logging.getLogger("stagehand.audio")

EXTENSIONS = (".wav", ".aiff", ".aif", ".flac")
_SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,80}$")
IDENTIFY_S = 1.5


def decode_file(path: Path) -> tuple[np.ndarray, int]:
    import soundfile as sf

    samples, rate = sf.read(str(path), dtype="float32", always_2d=True)
    return samples, int(rate)


class SoundBank:
    def __init__(self, directory: str | Path, rate: int, decode=decode_file) -> None:
        self.dir = Path(directory)
        self.rate = rate
        self._decode = decode
        self._cache: dict[str, tuple[float, np.ndarray]] = {}
        #: Names already logged as missing (logged once each).
        self.missing: set[str] = set()

    def find(self, name: str) -> Path | None:
        if not _SAFE.match(name) or ".." in name:
            return None
        for ext in EXTENSIONS:
            p = self.dir / f"{name}{ext}"
            if p.is_file():
                return p
        try:
            entries = list(self.dir.iterdir())
        except OSError:
            return None
        low = name.lower()
        for p in sorted(entries):
            if p.suffix.lower() in EXTENSIONS and p.stem.lower() == low and p.is_file():
                return p
        return None

    def load(self, name: str) -> np.ndarray | None:
        """The sound at the bank's rate, or None (missing / unreadable)."""
        path = self.find(name)
        if path is None:
            if name not in self.missing:
                self.missing.add(name)
                log.warning("sound %r: no file in %s (%s) — skipped", name, self.dir, "/".join(e[1:] for e in EXTENSIONS))
            return None
        try:
            mtime = path.stat().st_mtime
        except OSError:
            mtime = 0.0
        hit = self._cache.get(str(path))
        if hit is not None and hit[0] == mtime:
            return hit[1]
        try:
            samples, rate = self._decode(path)
        except Exception as err:  # noqa: BLE001 — libsndfile raises its own types
            if name not in self.missing:
                self.missing.add(name)
                log.warning("sound %r: can't decode %s (%s) — skipped", name, path, err)
            return None
        data = resample(samples, rate, self.rate)
        self._cache[str(path)] = (mtime, data)
        self.missing.discard(name)
        return data

    def preload(self, names) -> tuple[int, list[str]]:
        """Decode every name now (at boot / on a config change). → (loaded, missing)."""
        loaded, missing = 0, []
        for name in sorted(set(names)):
            if self.load(name) is None:
                missing.append(name)
            else:
                loaded += 1
        return loaded, missing


def identify_tone(rate: int, channel: int, seconds: float = IDENTIFY_S) -> np.ndarray:
    """Three rising beeps over `seconds`, pitched by the output number."""
    base = 440.0 * 2 ** (((max(channel, 1) - 1) % 12) / 12)
    beep = seconds / 3
    out: list[np.ndarray] = []
    for k, ratio in enumerate((1.0, 1.25, 1.5)):
        n = int(rate * beep)
        t = np.arange(n) / rate
        on = t < beep * 0.7
        env = np.minimum(1.0, t / 0.01) * np.where(on, 1.0, 0.0)
        env *= np.minimum(1.0, np.maximum(0.0, (beep * 0.7 - t) / 0.02))
        out.append((0.3 * env * np.sin(2 * np.pi * base * ratio * t)).astype(np.float32))
    return np.concatenate(out)[:, None]


def identify_label(label: str, channels: tuple[int, ...]) -> str:
    """What the test says after the tone: `Desktop left. Output 1.`"""
    chs = ", ".join(map(str, channels))
    word = "Output" if len(channels) == 1 else "Outputs"
    return f"{label}. {word} {chs}." if label else f"{word} {chs}."
