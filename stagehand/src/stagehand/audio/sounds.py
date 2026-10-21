"""The router's media: story sounds from `sounds_dir`, and the test signals.

`sound printer_grind` plays `<sounds_dir>/printer_grind.(wav|aiff|aif|flac)`,
decoded with libsndfile and resampled once to the device rate with a
band-limited (FFT, ideal low-pass) resampler — songs are full range, so the
alexa player's linear resample (fine for a chime and a voice) would alias
and dull them — then kept in memory (re-read when the file changes on disk). A name with no file is
logged once and skipped — never a crash mid-show. Names are matched exactly,
then case-insensitively; a name that isn't a plain file name (`../x`) is
refused.

The speaker test is a 1.5 s identifying tone — three rising beeps whose
pitch steps with the output number, so a walk round the house can tell
outputs apart by ear — followed by the speaker's spoken label.
"""

from __future__ import annotations

import logging
import math
import re
from pathlib import Path

import numpy as np

log = logging.getLogger("stagehand.audio")

EXTENSIONS = (".wav", ".aiff", ".aif", ".flac")
_SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,80}$")
IDENTIFY_S = 1.5


def _smooth(n: int) -> int:
    """The smallest 2·3·5-smooth number ≥ n (a fast FFT length)."""
    best = 1 << max(0, (n - 1).bit_length())
    p5 = 1
    while p5 < best:
        p35 = p5
        while p35 < best:
            q = p35
            while q < n:
                q *= 2
            best = min(best, q)
            p35 *= 3
        p5 *= 5
    return best


def resample_hq(samples: np.ndarray, rate: int, target: int) -> np.ndarray:
    """Band-limited resample of (frames, channels) float audio: one FFT per
    channel, the spectrum cut (down) or zero-padded (up) at the lower
    Nyquist, back at the exact ratio. Silence is padded after the sound so
    the FFT's wrap-around can't ring into its start. Done once per file."""
    if rate == target or len(samples) == 0:
        return samples
    x = samples if samples.ndim == 2 else samples[:, None]
    n = len(x)
    n_out = max(1, int(round(n * target / rate)))
    g = math.gcd(rate, target)
    step_in, step_out = rate // g, target // g
    blocks = _smooth(-(-(n + rate // 20 + 64) // step_in))
    m, m_out = blocks * step_in, blocks * step_out
    bins = m_out // 2 + 1
    keep = min(m // 2 + 1, bins)
    out = np.empty((n_out, x.shape[1]), dtype=np.float32)
    for c in range(x.shape[1]):
        spec = np.fft.rfft(x[:, c].astype(np.float64), n=m)
        cut = np.zeros(bins, dtype=np.complex128)
        cut[:keep] = spec[:keep]
        if m_out < m and m_out % 2 == 0:
            cut[-1] = cut[-1].real  # the new Nyquist bin of a downsample
        out[:, c] = (np.fft.irfft(cut, n=m_out)[:n_out] * (m_out / m)).astype(np.float32)
    return out


def rate_of(path: Path) -> int | None:
    """A sound file's sample rate from its header (None if unreadable)."""
    try:
        import soundfile as sf

        return int(sf.info(str(path)).samplerate)
    except Exception:  # noqa: BLE001 — libsndfile raises its own types
        return None


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
        data = resample_hq(samples, rate, self.rate)
        self._cache[str(path)] = (mtime, data)
        self.missing.discard(name)
        return data

    def off_rate(self, names) -> list[tuple[str, int]]:
        """(name, file rate) for every file not at the bank's rate — they play
        (resampled at load) but are best converted offline."""
        out = []
        for name in sorted(set(names)):
            path = self.find(name)
            r = rate_of(path) if path is not None else None
            if r is not None and r != self.rate:
                out.append((name, r))
        return out

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
