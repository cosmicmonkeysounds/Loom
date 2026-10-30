"""A software input (wave 46): another capture device summed into one of the
interface's input channels, as if it were cabled there.

The house PC has no line out, so Chrome's sound (the TV page, Trabolta's
voice) cannot be cabled into the 828x's Analog In 1 (input 3, role
`trabolta`). Instead Chrome plays into a virtual cable (VoiceMeeter's
"VoiceMeeter Input"), and the router opens that cable's other end
("VoiceMeeter Output") as a second, capture-only stream next to the ASIO
one. Its frames land in a ring buffer; the ASIO callback adds them into
the configured input channel before the mixer sees the block, so the
matrix routes them, the meters read them and the `trabolta` sidechain
ducks the music under them exactly as with the cable.

    audio:
      tap: { device: "VoiceMeeter Output", host_api: mme, ch: 3 }

The two streams run on two clocks (VoiceMeeter's and the MOTU's), so the
buffer drifts: when it holds more than `high` frames the oldest are
dropped down to `target` (a `slip`), and when a block finds it short the
rest is silence (an `underrun`) and the tap waits until it holds `target`
frames again. `target` follows the largest chunk the capture callback has
delivered (MME hands over big ones), so the latency is as low as the
capture device allows. A slip or an underrun is a small click in the
voice, every few minutes at worst (two crystals agree to ~50 ppm).

The capture callback and the ASIO callback hold the lock only for index
updates and buffer copies (the audio callback never waits). Capture
channels are averaged to mono: Trabolta's voice is the same on both
sides. `factory` / `query` are injectable, so the tests need no device.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np

log = logging.getLogger("stagehand.audio")

#: Seconds the ring buffer holds (anything older is dropped on write).
BUFFER_S = 1.0
#: Extra frames over the target before a slip, in seconds.
SLACK_S = 0.05


@dataclass(frozen=True)
class TapConfig:
    #: A part of the capture device's name (contiguous, case-insensitive).
    device: str
    #: engine.HOST_APIS key the device must be on (`mme` for VoiceMeeter).
    host_api: str | None = None
    #: The interface input (1-based, audio.json's numbering) it is summed into.
    ch: int = 3
    #: Capture channels opened (averaged to mono).
    channels: int = 2
    gain_db: float = 0.0


def find_device(cfg: TapConfig, devices: list[dict], host_apis: list[dict]) -> int:
    """The one capture device whose name contains `cfg.device` on `cfg.host_api`.
    Raises ValueError naming the candidates when there are none or several.
    (sounddevice's own matching splits on spaces, so "VoiceMeeter Output"
    would also match "VoiceMeeter Aux Output".)"""
    from .engine import HOST_APIS

    want = cfg.device.lower()
    api = HOST_APIS.get(cfg.host_api or "", None)
    hits = [
        i
        for i, d in enumerate(devices)
        if want in str(d["name"]).lower()
        and int(d.get("max_input_channels", 0)) > 0
        and (api is None or api.lower() in str(host_apis[d["hostapi"]]["name"]).lower())
    ]
    if len(hits) != 1:
        on = f" on {api}" if api else ""
        names = "; ".join(f"{devices[i]['name']} ({host_apis[devices[i]['hostapi']]['name']})" for i in hits)
        raise ValueError(f"audio.tap device {cfg.device!r}{on}: {'no capture device matches' if not hits else 'several match — ' + names}")
    return hits[0]


class Tap:
    def __init__(
        self,
        cfg: TapConfig,
        rate: int,
        *,
        factory: Callable[..., Any] | None = None,
        query: Callable[[], tuple[list[dict], list[dict]]] | None = None,
    ) -> None:
        self.cfg = cfg
        self.rate = rate
        self.gain = float(10 ** (cfg.gain_db / 20))
        self._factory = factory
        self._query = query
        self._buf = np.zeros(int(rate * BUFFER_S), dtype=np.float32)
        self._lock = threading.Lock()
        self._w = 0  # frames ever written
        self._r = 0  # frames ever read
        self._chunk = 0  # the largest capture chunk seen
        self._priming = True
        self.stream: Any = None
        self.name: str | None = None
        self.underruns = 0
        self.slips = 0
        self.overflows = 0
        self.peak = 0.0

    # -- the capture side ------------------------------------------------------

    def open(self) -> None:
        if self._query is None:
            import sounddevice as sd

            devices, apis = list(sd.query_devices()), list(sd.query_hostapis())
        else:
            devices, apis = self._query()
        index = find_device(self.cfg, devices, apis)
        self.name = str(devices[index]["name"])
        channels = max(1, min(self.cfg.channels, int(devices[index].get("max_input_channels", 1))))
        factory = self._factory
        if factory is None:
            import sounddevice as sd

            factory = sd.InputStream
        stream = factory(device=index, channels=channels, samplerate=self.rate, dtype="float32", latency="low", callback=self._capture)
        stream.start()
        self.stream = stream
        log.info("audio tap open: %s → input %d (%d ch @ %d Hz)", self.name, self.cfg.ch, channels, self.rate)

    def close(self) -> None:
        stream, self.stream = self.stream, None
        if stream is not None:
            for step in ("stop", "close"):
                try:
                    getattr(stream, step)()
                except Exception as err:  # noqa: BLE001
                    log.debug("tap %s: %s", step, err)

    @property
    def running(self) -> bool:
        return self.stream is not None and bool(getattr(self.stream, "active", True))

    def _capture(self, indata, frames, time, status) -> None:  # noqa: ARG002
        mono = indata[:, 0] if indata.shape[1] == 1 else indata.mean(axis=1)
        self.write(mono)

    def write(self, mono: np.ndarray) -> None:
        n = len(mono)
        size = len(self._buf)
        if n > size:
            mono = mono[-size:]
            n = size
        with self._lock:
            self._chunk = max(self._chunk, n)
            start = self._w % size
            first = min(n, size - start)
            self._buf[start : start + first] = mono[:first]
            self._buf[: n - first] = mono[first:]
            self._w += n
            if self._w - self._r > size:
                self.overflows += 1
                self._r = self._w - size

    # -- the ASIO side -----------------------------------------------------------

    def target(self, frames: int) -> int:
        return min(len(self._buf) // 2, self._chunk + 2 * frames)

    def add_into(self, column: np.ndarray) -> None:
        """Add the next len(column) frames into `column` (one input channel
        of the block, writable), in the ASIO callback."""
        frames = len(column)
        size = len(self._buf)
        with self._lock:
            fill = self._w - self._r
            target = self.target(frames)
            if self._priming:
                if fill < target:
                    return
                self._priming = False
            if fill > target + self._chunk + int(SLACK_S * self.rate):
                self.slips += 1
                self._r = self._w - target
                fill = target
            n = min(frames, fill)
            if n < frames:
                self.underruns += 1
                self._priming = True
            start = self._r % size
            first = min(n, size - start)
            chunk = np.concatenate((self._buf[start : start + first], self._buf[: n - first])) if first < n else self._buf[start : start + n].copy()
            self._r += n
        if n:
            chunk *= self.gain
            column[:n] += chunk
            self.peak = max(self.peak, float(np.abs(chunk).max()))

    def stats(self) -> str:
        """For the health line: the device, its peak since the last call, the glitches."""
        peak, self.peak = self.peak, 0.0
        db = 20 * np.log10(peak) if peak > 0 else -120.0
        state = self.name or self.cfg.device
        if not self.running:
            state += " (closed)"
        return f"{state} → in {self.cfg.ch} peak {db:.0f} dBFS, underruns {self.underruns}, slips {self.slips}"
