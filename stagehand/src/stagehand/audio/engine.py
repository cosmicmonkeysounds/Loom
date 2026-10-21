"""The one PortAudio stream on the interface, and the device probe.

`Engine.open` resolves the CoreAudio device by substring, opens ONE
`sounddevice` stream — duplex (N in / N out) when the matrix passes inputs
through, output-only otherwise (no microphone permission needed) — at the
device rate, and hands every block to a fresh `Mixer`. A stream that dies
(the MOTU unplugged) reports `running == False`; the router reopens it.

`sounddevice` is reached through injectable `query` / `stream_factory`
arguments, so the tests drive the callback with numpy buffers and no card.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np

from .mixer import Mixer

log = logging.getLogger("stagehand.audio")


@dataclass(frozen=True)
class DeviceInfo:
    name: str
    inputs: int
    outputs: int
    rate: int
    #: PortAudio's index (opened by index, so a look-alike name can't match).
    index: int | None = None

    @property
    def handle(self) -> int | str:
        return self.index if self.index is not None else self.name


def query_device(name: str | None, query: Callable | None = None) -> DeviceInfo:
    """The device `name` (a substring; None = the default output) names.
    Raises ValueError when it names none, or several."""
    if query is None:
        import sounddevice as sd

        query = sd.query_devices
    info = query(name) if name is not None else query(kind="output")
    return DeviceInfo(
        name=str(info["name"]),
        inputs=int(info.get("max_input_channels", 0)),
        outputs=int(info.get("max_output_channels", 0)),
        rate=int(info.get("default_samplerate") or 48000),
        index=info.get("index") if isinstance(info.get("index"), int) else None,
    )


def probe(name: str | None, want_in: int, want_out: int, query: Callable | None = None) -> tuple[DeviceInfo | None, list[str]]:
    """(the device, problems) — for `stagehand check` and the boot log."""
    try:
        info = query_device(name, query)
    except Exception as err:  # noqa: BLE001 — ValueError (missing / ambiguous), no PortAudio
        return None, [f"audio device {name or '(default)'!r}: {err}"]
    problems = []
    if info.outputs < want_out:
        problems.append(f"{info.name!r} has {info.outputs} outputs; audio.json asks for {want_out}")
    if info.inputs < want_in:
        problems.append(f"{info.name!r} has {info.inputs} inputs; audio.json asks for {want_in}")
    return info, problems


class Engine:
    def __init__(
        self,
        device: str | None,
        n_in: int,
        n_out: int,
        *,
        rate: int | None = None,
        duplex: bool = True,
        blocksize: int = 512,
        latency: str | float = "high",
        mixer_args: dict[str, Any] | None = None,
        query: Callable | None = None,
        stream_factory: Callable | None = None,
    ) -> None:
        self.device = device
        self.want_in, self.want_out = n_in, n_out
        self.want_rate = rate
        self.duplex = duplex
        self.blocksize = blocksize
        self.latency = latency
        self.mixer_args = mixer_args or {}
        self._query = query
        self._factory = stream_factory
        self.stream: Any = None
        self.mixer: Mixer | None = None
        self.info: DeviceInfo | None = None
        self.xruns = 0
        self.errors = 0

    def describe(self) -> str:
        if self.info is None:
            return f"{self.device or 'default output'} (closed)"
        n_in = self.mixer.n_in if self.mixer and self.duplex else 0
        n_out = self.mixer.n_out if self.mixer else 0
        return f"{self.info.name} {n_in} in / {n_out} out @ {self.mixer.rate if self.mixer else '?'} Hz"

    @property
    def running(self) -> bool:
        if self.stream is None:
            return False
        return bool(getattr(self.stream, "active", True))

    def open(self) -> Mixer:
        """Open (or reopen) the stream. Raises on a missing device / PortAudio error."""
        self.close()
        info = query_device(self.device, self._query)
        n_out = min(self.want_out, info.outputs)
        n_in = min(self.want_in, info.inputs) if self.duplex else 0
        if n_out < 1:
            raise ValueError(f"{info.name!r} has no outputs")
        if n_out < self.want_out or (self.duplex and n_in < self.want_in):
            log.warning("%s: %d in / %d out, audio.json wants %d / %d — the rest are dropped", info.name, info.inputs, info.outputs, self.want_in, self.want_out)
        rate = self.want_rate or info.rate
        mixer = Mixer(max(n_in, 1), n_out, rate, **self.mixer_args)
        factory = self._factory
        if factory is None:
            import sounddevice as sd

            factory = sd.Stream if n_in > 0 else sd.OutputStream
        kwargs: dict[str, Any] = dict(
            samplerate=rate,
            blocksize=self.blocksize,
            dtype="float32",
            latency=self.latency,
        )
        if n_in > 0:
            kwargs.update(device=(info.handle, info.handle), channels=(n_in, n_out), callback=self._duplex_cb)
        else:
            kwargs.update(device=info.handle, channels=n_out, callback=self._output_cb)
        stream = factory(**kwargs)
        self.mixer, self.info = mixer, info
        stream.start()
        self.stream = stream
        log.info("audio stream open: %s", self.describe())
        return mixer

    def close(self) -> None:
        stream, self.stream = self.stream, None
        if stream is None:
            return
        for step in ("stop", "close"):
            try:
                getattr(stream, step)()
            except Exception as err:  # noqa: BLE001 — a dead device raises on stop
                log.debug("stream %s: %s", step, err)

    # -- the audio thread ----------------------------------------------------

    def _note(self, status: Any) -> None:
        if status:
            self.xruns += 1

    def _run(self, indata: np.ndarray | None, outdata: np.ndarray) -> None:
        mixer = self.mixer
        if mixer is None:
            outdata.fill(0)
            return
        try:
            mixer.process(indata, outdata)
        except Exception:  # noqa: BLE001 — never let the callback raise (PortAudio aborts)
            self.errors += 1
            outdata.fill(0)
            if self.errors <= 3:
                log.exception("mixer block failed")

    def _duplex_cb(self, indata, outdata, frames, time, status) -> None:  # noqa: ARG002
        self._note(status)
        self._run(indata, outdata)

    def _output_cb(self, outdata, frames, time, status) -> None:  # noqa: ARG002
        self._note(status)
        self._run(None, outdata)
