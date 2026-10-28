"""Labelled placeholder sounds for every story `sound X` (wave 18b, Q1).

    uv run stagehand sounds placeholders --config trapped.house.yaml [--force] [--no-say] [--only a,b] [--out DIR]

The manifest is `stagehand/media/sounds.yaml` (tracked): per name, the
motif, its length, any lead silence and what the real file should be. Each
placeholder is `<sounds_dir>/<name>.wav`, 48 kHz / 16-bit / mono at about
−6 dBFS peak: a distinct synthesised motif (so a walk round the house tells
the cues apart by ear), then "Placeholder. <name>." in the machine's own
voice when there is one (the Mac's `say`, Windows SAPI; `--no-say` for CI).
A RIFF LIST/INFO chunk right after `fmt ` carries INAM = the name and ICMT = `loom-placeholder v1 — <real>`,
which is how the router and `stagehand check` tell a placeholder from a real
asset (`sounds.is_placeholder`).

Never destructive: an untagged file is never overwritten, and a name that
already has a real `.wav` / `.aiff` / `.aif` / `.flac` is skipped. An
existing placeholder is rewritten only with `--force`.
"""

from __future__ import annotations

import re
import shutil
import struct
import subprocess
import tempfile
import wave
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from .sounds import EXTENSIONS, PLACEHOLDER_TAG, is_placeholder

RATE = 48000
#: The tracked manifest beside the YAML configs (stagehand/media/sounds.yaml).
MANIFEST = Path(__file__).resolve().parents[3] / "media" / "sounds.yaml"
#: An SFX library name (audio/sfx/spec.py: snake_case, or an ambient's hyphens).
_LIBRARY_NAME = re.compile(r"^[a-z][a-z0-9_-]{0,47}$")
MOTIFS = (
    "modem", "arpeggio_up", "jingle", "glitch", "ticks", "grind", "rattle", "zip", "bell", "siren",
    "shutdown", "beat", "beat_fast", "beat_swing", "vocoder", "vocoder_sad", "engine", "pad", "fanfare",
)


@dataclass(frozen=True)
class SoundSpec:
    name: str
    motif: str
    seconds: float
    real: str
    lead_silence: float = 0.0
    no_duck: bool = False
    #: The SFX library sound that stands in for it (wave 38, C6): `stagehand
    #: sounds library --story` writes that sound here as `<name>.wav`.
    library: str | None = None


def load_manifest(path: str | Path = MANIFEST) -> dict[str, SoundSpec]:
    """The manifest's sounds, in file order. Raises ValueError on a bad entry."""
    doc = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    sounds = doc.get("sounds") if isinstance(doc, dict) else None
    if not isinstance(sounds, dict) or not sounds:
        raise ValueError(f"{path}: needs a `sounds:` mapping")
    out: dict[str, SoundSpec] = {}
    for name, raw in sounds.items():
        if not isinstance(raw, dict):
            raise ValueError(f"{path}: sounds.{name} must be a mapping")
        motif, seconds = raw.get("motif"), raw.get("seconds")
        if motif not in MOTIFS:
            raise ValueError(f"{path}: sounds.{name}.motif {motif!r} is not one of {', '.join(MOTIFS)}")
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not 0 < seconds <= 600:
            raise ValueError(f"{path}: sounds.{name}.seconds must be 0–600")
        lead = raw.get("lead_silence", 0)
        if isinstance(lead, bool) or not isinstance(lead, (int, float)) or not 0 <= lead <= 60:
            raise ValueError(f"{path}: sounds.{name}.lead_silence must be 0–60")
        library = raw.get("library")
        if library is not None and (not isinstance(library, str) or not _LIBRARY_NAME.match(library)):
            raise ValueError(f"{path}: sounds.{name}.library must be an SFX library sound name")
        out[str(name)] = SoundSpec(str(name), motif, float(seconds), str(raw.get("real") or ""), float(lead), raw.get("no_duck") is True, library)
    return out


# -- the motifs ------------------------------------------------------------------


def _env(n: int, a: float = 0.01, r: float = 0.05) -> np.ndarray:
    t = np.arange(n) / RATE
    dur = n / RATE
    return np.clip(t / a, 0, 1) * np.clip((dur - t) / r, 0, 1)


def _tone(freq: Any, sec: float, kind: str = "sine") -> np.ndarray:
    n = int(sec * RATE)
    t = np.arange(n) / RATE
    ph = 2 * np.pi * (np.cumsum(np.broadcast_to(freq, (n,))) / RATE if np.ndim(freq) else freq * t)
    if kind == "square":
        w = np.sign(np.sin(ph))
    elif kind == "saw":
        w = 2 * ((ph / (2 * np.pi)) % 1) - 1
    else:
        w = np.sin(ph)
    return w * _env(n)


def _noise(sec: float, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).uniform(-1, 1, int(sec * RATE))


def _silence(sec: float) -> np.ndarray:
    return np.zeros(int(sec * RATE))


def motif(kind: str, sec: float) -> np.ndarray:
    """One placeholder's synthesised pattern, peak-normalised to 1."""
    n = int(sec * RATE)
    t = np.arange(n) / RATE
    if kind == "modem":
        parts = [_tone(1800, 0.4), _tone(2100, 0.3, "square") * 0.4, _noise(0.6, 2) * 0.3]
        parts += [_tone(f, 0.15) for f in (980, 1180, 1650, 1850)] * 3
        x = np.concatenate(parts)
    elif kind == "arpeggio_up":
        x = np.concatenate([_tone(f, 0.25, "square") * 0.5 for f in (523, 659, 784, 1047)] + [_tone(1047, 1.0)])
    elif kind == "jingle":
        notes = (659, 659, 784, 659, 523, 587, 659, 0, 0, 0, 0, 0)
        x = np.concatenate([_tone(f, 0.25) if f else _silence(0.25) for f in notes] * 2)
    elif kind == "glitch":
        rng = np.random.default_rng(3)
        x = np.concatenate([_tone(rng.uniform(200, 4000), rng.uniform(0.02, 0.12), "square") * 0.5 for _ in range(40)])
    elif kind == "ticks":
        x = np.concatenate([np.concatenate([_tone(1500, 0.03, "square") * 0.6, _silence(0.47)]) for _ in range(max(1, int(sec / 0.5)))])
    elif kind == "grind":
        x = _noise(sec, 4) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 18 * t))) * 0.5
    elif kind == "rattle":
        x = _noise(sec, 5) * (np.random.default_rng(6).uniform(0, 1, n) > 0.97) * _env(n, 0.05, 1.0)
    elif kind == "zip":
        x = _tone(np.linspace(300, 3000, n), sec, "saw") * 0.4
    elif kind == "bell":
        x = sum(np.sin(2 * np.pi * f * t) * a for f, a in ((440, 1), (880, 0.5), (1320, 0.25))) * np.exp(-t * 1.5) / 1.75
    elif kind == "siren":
        x = _tone(700 + 400 * np.sin(2 * np.pi * 0.5 * t), sec, "saw") * 0.4
    elif kind == "shutdown":
        x = np.concatenate([_tone(f, 0.6) for f in (784, 659, 523, 392)] + [_tone(262, 0.8)])
    elif kind.startswith("beat"):
        bpm = {"beat": 120, "beat_fast": 140, "beat_swing": 100}[kind]
        beat = 60 / bpm
        kick = _tone(np.linspace(120, 50, int(0.15 * RATE)), 0.15)
        bar = np.concatenate([kick, _silence(beat - 0.15)])
        x = np.tile(bar, max(1, int(sec / beat)))[:n]
        x = x + 0.2 * np.sin(2 * np.pi * (330 if kind == "beat_fast" else 220) * t[: len(x)])
    elif kind.startswith("vocoder"):
        carrier = _tone(220 if kind == "vocoder" else 196, sec, "saw")
        x = carrier * (0.5 + 0.5 * np.sin(2 * np.pi * 3 * t)) * 0.4
    elif kind == "engine":
        x = _tone(np.linspace(40, 140, n), sec, "saw") * 0.4 * _env(n, 0.3, 2.0)
    elif kind == "pad":
        x = (np.sin(2 * np.pi * 220 * t) + np.sin(2 * np.pi * 277 * t) + np.sin(2 * np.pi * 330 * t)) / 3 * 0.3 * _env(n, 3, 3)
    elif kind == "fanfare":
        x = np.concatenate([_tone(f, d, "saw") * 0.4 for f, d in ((392, 0.2), (523, 0.2), (659, 0.2), (784, 1.2))])
    else:
        raise ValueError(f"no motif {kind!r}")
    x = np.asarray(x, dtype=np.float64)
    return x / max(1e-9, float(np.abs(x).max()))


# -- the spoken label ----------------------------------------------------------------


def say_label(text: str, *, engine: str = "auto", which=shutil.which, run=None) -> np.ndarray | None:
    """`text` in the machine's own voice at RATE, mono — the Mac's `say`, or
    Windows SAPI (localvoice, `engine: auto` picks by platform); None when
    there is no voice (the placeholder is then the motif alone)."""
    from .. import localvoice

    run = run or subprocess.run
    resolved = localvoice.resolve(engine)
    if localvoice.problem(resolved, which=which) is not None:
        return None
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "label.wav"
        try:
            if resolved == "sapi":
                out.write_bytes(localvoice.sapi_to_wav(text, None, rate=RATE, run=run))
            else:
                run(["say", "-o", str(out), "--file-format=WAVE", f"--data-format=LEI16@{RATE}", text], check=True, timeout=30, capture_output=True)
            with wave.open(str(out)) as w:
                raw = w.readframes(w.getnframes())
                ch = w.getnchannels()
        except (subprocess.SubprocessError, OSError, wave.Error, localvoice.PlaybackError):
            return None
    a = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768
    a = a.reshape(-1, ch).mean(axis=1) if ch > 1 else a
    return a / max(1e-9, float(np.abs(a).max())) if len(a) else None


# -- the file --------------------------------------------------------------------


def _info_chunk(name: str, comment: str) -> bytes:
    def sub(cid: bytes, text: str) -> bytes:
        b = text.encode("utf-8") + b"\0"
        if len(b) % 2:
            b += b"\0"
        return cid + struct.pack("<I", len(b)) + b

    body = b"INFO" + sub(b"INAM", name) + sub(b"ICMT", comment)
    return b"LIST" + struct.pack("<I", len(body)) + body


def write_placeholder(path: Path, samples: np.ndarray, name: str, real: str) -> None:
    """A 16-bit mono WAV at ≈ −6 dBFS peak with the tag in its INFO chunk."""
    pcm = (np.clip(samples, -1, 1) * 32767 * 0.5).astype("<i2").tobytes()
    fmt = b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, RATE, RATE * 2, 2, 16)
    riff = b"WAVE" + fmt + _info_chunk(name, f"{PLACEHOLDER_TAG} — {real}") + b"data" + struct.pack("<I", len(pcm)) + pcm
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(b"RIFF" + struct.pack("<I", len(riff)) + riff)
    tmp.replace(path)


def render(spec: SoundSpec, label: Callable[[str], np.ndarray | None] | None = say_label) -> np.ndarray:
    parts = [np.zeros(int(spec.lead_silence * RATE)), motif(spec.motif, spec.seconds)]
    if label is not None:
        spoken = label(f"Placeholder. {spec.name.replace('_', ' ')}.")
        if spoken is not None:
            parts += [np.zeros(int(0.3 * RATE)), spoken]
    return np.concatenate(parts)


def generate(
    out_dir: str | Path,
    manifest: dict[str, SoundSpec],
    *,
    say: bool = True,
    force: bool = False,
    only: set[str] | None = None,
    label: Callable[[str], np.ndarray | None] | None = None,
) -> list[tuple[str, str]]:
    """Write the placeholders. → (name, `wrote` | `skip` (a placeholder is
    there; `--force` rewrites it) | `keep` (a real file is there))."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    speak = (label or say_label) if say else None
    done: list[tuple[str, str]] = []
    for name, spec in manifest.items():
        if only and name not in only:
            continue
        dest = out / f"{name}.wav"
        same = [p for p in out.iterdir() if p.is_file() and p.suffix.lower() in EXTENSIONS and p.stem.lower() == name.lower()]
        if any(not is_placeholder(p) for p in same):
            done.append((name, "keep"))
            continue
        if dest.exists() and not force:
            done.append((name, "skip"))
            continue
        write_placeholder(dest, render(spec, speak), name, spec.real)
        done.append((name, "wrote"))
    return done
