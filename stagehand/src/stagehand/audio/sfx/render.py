"""A library sound → its finished samples → a tagged WAV (wave 38, C6).

`render(spec)` runs the sound's own render with a generator seeded from a
stable hash of its name (crc32, never Python's salted `hash`), checks what
came back (finite, not silent, the right length and shape) and sets the
level: a one-shot is peak-normalised to −1 dBFS with a 0.5 ms / 5 ms edge
fade; a loop is set to its RMS target (−18 dBFS unless `level_db`) with a
soft limiter holding the peak at −1 dBFS. `wav_bytes` writes 48 kHz 16-bit
PCM (stereo only for a stereo loop) with a RIFF LIST/INFO chunk right after
`fmt ` — INAM = the name, ICMT = `loom-sfx v1 — <note>` — the same chunk the
placeholders carry, with a different tag: the router treats a loom-sfx file
as a real sound (`sounds.is_placeholder` is false), and `--story` knows it
may replace one (`is_sfx`).

Everything is deterministic: the same library renders the same bytes.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

import numpy as np

from ..placeholders import _info_chunk
from . import dsp
from .spec import Spec

RATE = dsp.RATE
#: The tag a library sound carries in its RIFF INFO comment.
SFX_TAG = "loom-sfx v1"
ONESHOT_PEAK_DB = -1.0
LOOP_RMS_DB = -18.0
LOOP_PEAK_DB = -1.0
LENGTH_TOLERANCE = 0.05
_HEAD = 4096


class RenderError(ValueError):
    """A sound's render returned something the library will not write."""


def seed(name: str) -> int:
    return zlib.crc32(name.encode("utf-8"))


def rng_for(name: str) -> np.random.Generator:
    return np.random.default_rng(seed(name))


def raw(spec: Spec) -> np.ndarray:
    """The sound's own render, checked, before any level is set."""
    x = np.asarray(spec.render(rng_for(spec.name)), dtype=np.float64)
    if x.ndim == 2 and x.shape[1] == 1:
        x = x[:, 0]
    if not (x.ndim == 1 or (x.ndim == 2 and x.shape[1] == 2)):
        raise RenderError(f"sfx {spec.name}: render returned shape {x.shape}; want (frames,) or (frames, 2)")
    if x.ndim == 2 and not spec.loop:
        raise RenderError(f"sfx {spec.name}: a one-shot is mono (only a loop may be stereo)")
    if not np.all(np.isfinite(x)):
        raise RenderError(f"sfx {spec.name}: render returned NaN or inf")
    want = spec.seconds * RATE
    if abs(len(x) - want) > want * LENGTH_TOLERANCE:
        raise RenderError(f"sfx {spec.name}: rendered {len(x) / RATE:.3f} s, the spec says {spec.seconds} s (±5 %)")
    if not len(x) or float(np.abs(x).max()) < 1e-6:
        raise RenderError(f"sfx {spec.name}: render is silent")
    return x


def _soft_limit(x: np.ndarray, ceiling: float, knee_db: float = 6.0) -> np.ndarray:
    """Identity below `ceiling − knee`, a tanh curve above it that never
    reaches `ceiling`: per sample, so a loop stays seamless."""
    t = ceiling * dsp.db_to_lin(-knee_db)
    a = np.abs(x)
    over = a > t
    out = np.array(x, copy=True)
    room = ceiling - t
    out[over] = np.sign(x[over]) * (t + room * np.tanh((a[over] - t) / room))
    return out


def level(spec: Spec, x: np.ndarray) -> np.ndarray:
    """Set the finished level (see the module docstring)."""
    if not spec.loop:
        x = dsp.fade(x, 0.0005, 0.005, curve="linear")
        return dsp.normalize_peak(x, ONESHOT_PEAK_DB)
    target = LOOP_RMS_DB if spec.level_db is None else spec.level_db
    ceiling = dsp.db_to_lin(LOOP_PEAK_DB)
    for _ in range(4):
        x = dsp.normalize_rms(x, target)
        if float(np.abs(x).max()) <= ceiling:
            return x
        x = _soft_limit(x, ceiling)
        if abs(dsp.rms_db(x) - target) < 0.25:
            break
    peak = float(np.abs(x).max())
    return x * (ceiling / peak) if peak > ceiling else x


def render(spec: Spec) -> np.ndarray:
    """The finished float32 samples of `spec`, mono or (frames, 2)."""
    return level(spec, raw(spec)).astype(np.float32)


def pcm16(samples: np.ndarray) -> bytes:
    return np.round(np.clip(samples.astype(np.float64), -1, 1) * 32767).astype("<i2").tobytes()


def wav_bytes(spec: Spec, samples: np.ndarray) -> bytes:
    """A 48 kHz 16-bit PCM WAV with the loom-sfx INFO chunk."""
    channels = 1 if samples.ndim == 1 else samples.shape[1]
    data = pcm16(samples)
    fmt = b"fmt " + struct.pack("<IHHIIHH", 16, 1, channels, RATE, RATE * 2 * channels, 2 * channels, 16)
    riff = b"WAVE" + fmt + _info_chunk(spec.name, f"{SFX_TAG} — {spec.note}") + b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(riff)) + riff


def library_path(out_dir: str | Path, spec: Spec) -> Path:
    """`<out>/<category>/<name>.wav` (ambient loops: `<out>/ambient/<name>.wav`)."""
    return Path(out_dir) / spec.category / f"{spec.name}.wav"


def write_bytes(path: Path, data: bytes) -> str:
    """Write atomically → `wrote`, or `same` when the file already holds these bytes."""
    try:
        if path.read_bytes() == data:
            return "same"
    except OSError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)
    return "wrote"


def is_sfx(path: str | Path) -> bool:
    """Does the file's header carry the loom-sfx tag?"""
    try:
        with Path(path).open("rb") as f:
            return SFX_TAG.encode() in f.read(_HEAD)
    except OSError:
        return False


def stats(samples: np.ndarray) -> dict[str, float]:
    """Peak and RMS dBFS and length: for `--list`, inspect and the tests."""
    return {"peak_db": dsp.peak_db(samples), "rms_db": dsp.rms_db(samples), "seconds": len(samples) / RATE}


def describe(spec: Spec) -> str:
    kind = "loop" if spec.loop else "one-shot"
    return f"{spec.name:<22} {spec.category:<10} {spec.seconds:>6.2f} s  {kind:<8} {spec.note}"


__all__ = [
    "LOOP_PEAK_DB", "LOOP_RMS_DB", "ONESHOT_PEAK_DB", "RATE", "RenderError", "SFX_TAG",
    "describe", "is_sfx", "level", "library_path", "pcm16", "raw", "render", "rng_for", "seed", "stats",
    "wav_bytes", "write_bytes",
]
