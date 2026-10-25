"""The router's media: story sounds from `sounds_dir`, and the test signals.

`sound printer_grind` plays `<sounds_dir>/printer_grind.(wav|aiff|aif|flac)`,
decoded with libsndfile and resampled once to the device rate with a
band-limited (FFT, ideal low-pass) resampler — songs are full range, so the
alexa player's linear resample (fine for a chime and a voice) would alias
and dull them — then kept in memory (re-read when the file changes on disk). A name with no file is
logged once and skipped — never a crash mid-show. Names are matched exactly,
then case-insensitively; a name that isn't a plain file name (`../x`) is
refused. A real file always wins over a generated placeholder (wave 18b: a
`.wav` whose header carries the `loom-placeholder` tag, `placeholders.py`),
so a real `dance_song.aiff` dropped beside the placeholder `dance_song.wav`
is the one that plays.

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
#: The tag a generated placeholder carries in its RIFF INFO comment.
PLACEHOLDER_TAG = "loom-placeholder v1"
_HEAD = 4096
#: path → (mtime, size, is a placeholder): a header is read once per change.
_tagged: dict[str, tuple[float, int, bool]] = {}


def is_placeholder(path: str | Path) -> bool:
    """Does the file's first 4 KB carry the placeholder tag? (cached by mtime)"""
    p = Path(path)
    try:
        st = p.stat()
    except OSError:
        return False
    hit = _tagged.get(str(p))
    if hit is not None and hit[0] == st.st_mtime and hit[1] == st.st_size:
        return hit[2]
    try:
        with p.open("rb") as f:
            tagged = PLACEHOLDER_TAG.encode() in f.read(_HEAD)
    except OSError:
        return False
    _tagged[str(p)] = (st.st_mtime, st.st_size, tagged)
    return tagged


def _best(paths: list[Path]) -> Path | None:
    """The first real file, else the first placeholder."""
    return next((p for p in paths if not is_placeholder(p)), paths[0] if paths else None)


def placeholders_in(directory: str | Path) -> list[str]:
    """The names (stems) in `directory` that play a placeholder (no real file
    of that name beside it), sorted — `stagehand check`'s pre-show list."""
    d = Path(directory)
    try:
        entries = sorted(p for p in d.iterdir() if p.suffix.lower() in EXTENSIONS and p.is_file())
    except OSError:
        return []
    stems: dict[str, list[Path]] = {}
    for p in entries:
        stems.setdefault(p.stem.lower(), []).append(p)
    out = []
    for group in stems.values():
        best = _best(group)
        if best is not None and is_placeholder(best):
            out.append(best.stem)
    return sorted(out)


def length_ms(path: str | Path) -> int | None:
    """A sound file's length in ms from its header (None if unreadable)."""
    try:
        import soundfile as sf

        info = sf.info(str(path))
        return int(round(info.frames * 1000 / info.samplerate)) if info.samplerate else None
    except Exception:  # noqa: BLE001 — libsndfile raises its own types
        return None


#: path → (mtime, size, ms or None): a header is read once per change.
_lengths: dict[str, tuple[float, int, int | None]] = {}


def sound_lengths(directory: str | Path, measure=length_ms) -> dict[str, int]:
    """Every sound in `directory` → its length in ms (wave 25: the router's
    report to the house desk, so a desk step knows how long a file runs and
    the desk's checks see which story sounds have a file). One entry per
    name, the file that plays (`_best`: a real file over a placeholder);
    an unreadable file is left out. Lengths are cached by mtime + size."""
    d = Path(directory)
    try:
        entries = sorted(p for p in d.iterdir() if p.suffix.lower() in EXTENSIONS and p.is_file())
    except OSError:
        return {}
    stems: dict[str, list[Path]] = {}
    for p in entries:
        stems.setdefault(p.stem.lower(), []).append(p)
    out: dict[str, int] = {}
    for group in stems.values():
        best = _best(group)
        if best is None:
            continue
        try:
            st = best.stat()
        except OSError:
            continue
        hit = _lengths.get(str(best))
        if hit is not None and hit[0] == st.st_mtime and hit[1] == st.st_size:
            ms = hit[2]
        else:
            ms = measure(best)
            _lengths[str(best)] = (st.st_mtime, st.st_size, ms)
        if ms is not None:
            out[best.stem] = ms
    return dict(sorted(out.items()))


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
        exact = [p for p in (self.dir / f"{name}{ext}" for ext in EXTENSIONS) if p.is_file()]
        hit = _best(exact)
        if hit is not None and not is_placeholder(hit):
            return hit
        try:
            entries = list(self.dir.iterdir())
        except OSError:
            return hit
        low = name.lower()
        folded = [p for p in sorted(entries) if p.suffix.lower() in EXTENSIONS and p.stem.lower() == low and p.is_file()]
        # A real file in another case beats an exact-named placeholder.
        return _best([*exact, *(p for p in folded if p not in exact)])

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
