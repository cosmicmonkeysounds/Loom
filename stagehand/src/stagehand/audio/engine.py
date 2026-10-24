"""The one PortAudio stream on the interface, and the device probe.

`Engine.open` resolves the CoreAudio device by substring, opens ONE
`sounddevice` stream — duplex (N in / N out) when the matrix passes inputs
through, output-only otherwise (no microphone permission needed) — at the
device rate, and hands every block to a fresh `Mixer`. A stream that dies
(the MOTU unplugged) reports `running == False`; the router reopens it.

PortAudio reads the device list once, when it initialises, and never again,
so a replugged interface is invisible to a plain reopen (a stale index, or
no device at all). Every open that follows a failure — a stream that died
or stalled, an open that raised — re-initialises PortAudio first
(`portaudio_reinit`), which re-reads the list.

`sounddevice` is reached through injectable `query` / `stream_factory` /
`reinit` arguments, so the tests drive the callback with numpy buffers and
no card.
"""

from __future__ import annotations

import logging
import os
import sys
from collections.abc import Callable, MutableMapping
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


def device_name(name: str | None) -> str | None:
    """A blank name (the server's default audio.json has `device.name: ""`)
    means the default output: PortAudio reads `""` as a substring every
    device matches and refuses it as ambiguous."""
    if name is None or not str(name).strip():
        return None
    return str(name).strip()


#: `audio.host_api:` → the PortAudio host API name sounddevice matches.
#: sounddevice matches a device string as space-separated substrings, in
#: order, against "<device name>, <host API name>", so "828x ASIO" names the
#: 828x's ASIO driver only. On Windows every device is listed once per host
#: API (MME, DirectSound, WASAPI, WDM-KS, ASIO), so a bare name is ambiguous
#: there; the MOTU must be ASIO to be one 30-channel device.
HOST_APIS = {
    "asio": "ASIO",
    "wasapi": "WASAPI",
    "wdm-ks": "WDM-KS",
    "directsound": "DirectSound",
    "mme": "MME",
    "coreaudio": "Core Audio",
}


def with_host_api(name: str | None, host_api: str | None) -> str | None:
    """The device query string: `name` narrowed to one host API (or, with
    no name, that host API's only device)."""
    if not host_api:
        return name
    label = HOST_APIS[host_api]
    return f"{name} {label}" if name else label


def enable_host_api(host_api: str | None, env: MutableMapping[str, str] | None = None, modules: dict | None = None) -> str | None:
    """sounddevice ships two PortAudio DLLs on Windows and loads the ASIO
    one only when `SD_ENABLE_ASIO` is set at its import (sounddevice 0.5).
    Set it before anything imports sounddevice; → a warning when it is too
    late (already imported without it), else None."""
    if host_api != "asio":
        return None
    env = os.environ if env is None else env
    modules = sys.modules if modules is None else modules
    if "SD_ENABLE_ASIO" in env:
        return None
    if "sounddevice" in modules:
        return "audio.host_api is asio but sounddevice was imported before SD_ENABLE_ASIO was set — set SD_ENABLE_ASIO=1 in the job's environment"
    env["SD_ENABLE_ASIO"] = "1"
    return None


def portaudio_reinit() -> None:
    """Re-read PortAudio's device list (a replugged interface). Every stream
    in the process must be closed first; sounddevice keeps no others open
    for the router."""
    import sounddevice as sd

    sd._terminate()
    sd._initialize()


def query_device(name: str | None, query: Callable | None = None) -> DeviceInfo:
    """The device `name` (a substring; None or blank = the default output)
    names. Raises ValueError when it names none, or several."""
    name = device_name(name)
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


def layout_problem(info: DeviceInfo, expect: tuple[int, int] | None) -> str | None:
    """`device.expect` against what the device reports: None when they agree
    (or nothing is expected), else why the channel numbers can't be trusted."""
    if expect is None or (info.inputs, info.outputs) == tuple(expect):
        return None
    return (
        f"{info.name!r} reports {info.inputs} in / {info.outputs} out; audio.json device.expect is "
        f"{expect[0]} / {expect[1]} — the layout has moved (mirroring, 96 kHz or an optical port on TOSLink?), "
        "so the channel numbers are off: fix it in MOTU Audio Setup / CueMix"
    )


def probe(
    name: str | None,
    want_in: int,
    want_out: int,
    query: Callable | None = None,
    expect: tuple[int, int] | None = None,
) -> tuple[DeviceInfo | None, list[str]]:
    """(the device, problems) — for `stagehand check` and the boot log."""
    try:
        info = query_device(name, query)
    except Exception as err:  # noqa: BLE001 — ValueError (missing / ambiguous), no PortAudio
        return None, [f"audio device {name or '(default)'!r}: {err}"]
    problems = []
    moved = layout_problem(info, expect)
    if moved is not None:
        problems.append(moved)
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
        reinit: Callable[[], None] | None = None,
        expect: tuple[int, int] | None = None,
    ) -> None:
        self.device = device_name(device)
        #: `device.expect`: compared on every open (the router updates it).
        self.expect = expect
        #: The last open found the device's layout moved (it plays anyway:
        #: refusing to open mid-show would be worse).
        self.layout_moved = False
        self.want_in, self.want_out = n_in, n_out
        self.want_rate = rate
        self.duplex = duplex
        self.blocksize = blocksize
        self.latency = latency
        self.mixer_args = mixer_args or {}
        self._query = query
        self._factory = stream_factory
        # The real PortAudio is re-initialised only when the real query runs;
        # an injected query (a test) gets an injected reinit or none.
        self._reinit = reinit if reinit is not None else (portaudio_reinit if query is None else None)
        #: The next open re-reads the device list (after any failure).
        self.needs_reinit = False
        self.reinits = 0
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

    def mark_failed(self) -> None:
        """The stream stalled or died: the next open re-reads the devices."""
        self.needs_reinit = True

    def open(self) -> Mixer:
        """Open (or reopen) the stream. Raises on a missing device / PortAudio
        error; the next open then re-initialises PortAudio first."""
        if self.stream is not None and not self.running:
            self.needs_reinit = True  # it died under us (the MOTU unplugged)
        self.close()
        try:
            return self._open()
        except Exception:
            self.needs_reinit = True
            raise

    def _open(self) -> Mixer:
        if self.needs_reinit and self._reinit is not None:
            self.reinits += 1
            log.info("re-reading the audio devices (PortAudio re-initialised)")
            self._reinit()
        self.needs_reinit = False
        info = query_device(self.device, self._query)
        n_out = min(self.want_out, info.outputs)
        n_in = min(self.want_in, info.inputs) if self.duplex else 0
        if n_out < 1:
            raise ValueError(f"{info.name!r} has no outputs")
        moved = layout_problem(info, self.expect)
        self.layout_moved = moved is not None
        if moved is not None:
            log.error("%s — playing anyway", moved)
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
