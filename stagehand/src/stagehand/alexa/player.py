"""Sound out of the house Mac: decode, fit to the device, play — or `say`.

The primary path is PortAudio (`sounddevice`) on a named CoreAudio
output, so the announcement lands on exactly the zones it should: a
Multi-Output Device in Audio MIDI Setup, or one interface (the MOTU)
with an explicit channel map (`channels: [1, 2, 3, 4]` = Z1 + Z2). The
file's channels repeat across the map, so a mono TTS line or a stereo
chime fills every listed output.

The fallback is macOS `say -a <device>` — no Python audio stack, no
server, still the right speakers. Every external effect sits behind a
small function so the announcer's fallback logic is testable with no
sound card.
"""

from __future__ import annotations

import io
import logging
import subprocess
import tempfile
from pathlib import Path

import numpy as np

log = logging.getLogger("stagehand.alexa")


class PlaybackError(RuntimeError):
    pass


def decode(data: bytes) -> tuple[np.ndarray, int]:
    """Audio bytes (mp3 / wav / aiff / ogg) → (float32 frames × channels, rate)."""
    import soundfile as sf

    try:
        samples, rate = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    except Exception as err:  # noqa: BLE001 — libsndfile raises its own types
        raise PlaybackError(f"can't decode audio ({len(data)} bytes): {err}") from err
    return samples, int(rate)


def resample(samples: np.ndarray, rate: int, target: int) -> np.ndarray:
    """Linear resample — plenty for a chime and a speaking voice."""
    if rate == target or len(samples) == 0:
        return samples
    n = max(1, int(round(len(samples) * target / rate)))
    src = np.linspace(0.0, len(samples) - 1, num=n)
    idx = np.arange(len(samples))
    return np.stack([np.interp(src, idx, samples[:, c]) for c in range(samples.shape[1])], axis=1).astype(np.float32)


def fit_channels(samples: np.ndarray, width: int) -> np.ndarray:
    """Repeat the source channels cyclically across `width` outputs
    (mono → every output; stereo → L R L R …)."""
    if samples.shape[1] == width:
        return samples
    cols = [i % samples.shape[1] for i in range(width)]
    return samples[:, cols]


def chime(rate: int = 48000) -> np.ndarray:
    """The "Alexa" earcon, synthesised: two soft bell tones rising a fifth.
    No asset to forget on show night; a real file overrides it (`chime:`)."""
    out: list[np.ndarray] = []
    for freq, dur in ((660.0, 0.16), (990.0, 0.38)):
        t = np.arange(int(rate * dur)) / rate
        env = np.minimum(1.0, t / 0.008) * np.exp(-t * 7.0)
        tone = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * 2 * freq * t)
        out.append((0.35 * env * tone).astype(np.float32))
    out.append(np.zeros(int(rate * 0.12), dtype=np.float32))
    return np.concatenate(out)[:, None]


class DeviceOutput:
    """One CoreAudio output, re-resolved on every play (a MOTU replugged
    mid-show is found again; a missing one raises `PlaybackError`)."""

    def __init__(self, device: str | None, channels: tuple[int, ...] | None, gain_db: float = 0.0) -> None:
        self.device = device
        self.channels = channels
        self.gain = float(10 ** (gain_db / 20))

    def describe(self) -> str:
        where = self.device or "system default output"
        return f"{where}" + (f" ch {','.join(map(str, self.channels))}" if self.channels else "")

    def probe(self, query=None) -> str | None:
        """None when `device` names exactly one CoreAudio output, else why not
        (missing, or a substring several outputs match — every play would then
        fall back to `say`, perhaps on the wrong zones). `query` is
        `sounddevice.query_devices`, injectable for tests."""
        if self.device is None:
            return None
        try:
            if query is None:
                import sounddevice as sd

                query = sd.query_devices
            info = query(self.device, "output")
        except Exception as err:  # noqa: BLE001 — ValueError (missing / ambiguous), no PortAudio
            return f"output device {self.device!r}: {err}"
        if self.channels and max(self.channels) > int(info["max_output_channels"]):
            return f"{info['name']!r} has {info['max_output_channels']} outputs; channels asks for {max(self.channels)}"
        return None

    def play(self, samples: np.ndarray, rate: int) -> None:
        """Blocking: returns when the sound has finished."""
        try:
            import sounddevice as sd

            info = sd.query_devices(self.device, "output")
            target = int(info["default_samplerate"]) or rate
            if self.channels:
                if max(self.channels) > int(info["max_output_channels"]):
                    raise PlaybackError(
                        f"{info['name']!r} has {info['max_output_channels']} outputs; channels asks for {max(self.channels)}"
                    )
                width = len(self.channels)
            else:
                width = min(2, int(info["max_output_channels"])) or 1
            data = fit_channels(resample(samples, rate, target), width) * self.gain
            np.clip(data, -1.0, 1.0, out=data)
            sd.play(data, target, device=self.device, mapping=list(self.channels) if self.channels else None, blocking=True)
        except PlaybackError:
            raise
        except Exception as err:  # noqa: BLE001 — PortAudio / missing device / no lib
            raise PlaybackError(f"{self.describe()}: {err}") from err


def say_argv(text: str, voice: str | None, *, device: str | None = None, out: str | None = None) -> list[str]:
    """The `say` command line. The text goes after `--`, so an announcement
    that starts with `-` (`-o/some/file …`) is spoken, never read as a flag."""
    return [
        "say",
        *(["-v", voice] if voice else []),
        *(["-a", device] if device else []),
        *(["-o", out] if out else []),
        "--",
        text,
    ]


def say_to_file(text: str, voice: str | None) -> bytes:
    """macOS `say` rendered to AIFF bytes — the offline voice that still
    goes through the device + channel map."""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "say.aiff"
        argv = say_argv(text, voice, out=str(out))
        try:
            subprocess.run(argv, check=True, capture_output=True, timeout=30)
            return out.read_bytes()
        except (OSError, subprocess.SubprocessError) as err:
            raise PlaybackError(f"say -o failed: {err}") from err


def say_direct(text: str, voice: str | None, device: str | None) -> None:
    """Last resort: `say -a <device>` (or the default output). Blocking."""
    argv = say_argv(text, voice, device=device)
    try:
        subprocess.run(argv, check=True, capture_output=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as err:
        raise PlaybackError(f"{' '.join(argv[:-2])} failed: {err}") from err
