"""The soundtrack from the TIDAL desktop app (wave 52): a playlist as a live bed.

TIDAL plays its own decrypted audio in its own process, so nothing here reads
a file: the app plays into a virtual cable and the router listens to the
cable's other end, in stereo, as a voice on the `music` bus. Scenes, ducking,
the house mixer and Stop house sounds all work on it as on any bed.

    TIDAL → "VoiceMeeter Aux Input" → VoiceMeeter's AUX strip, B2 only
          → "VoiceMeeter Aux Output" → `LiveInput` → one `LiveReader` per voice

    audio:
      tidal: { device: "VoiceMeeter Aux Output", host_api: mme }

The second half is the control: which playlist the app is on. TIDAL has no
API for its desktop player, but it is an Electron app, so started with
`--remote-debugging-port` (scripts/house-desktop/tidal.ps1) it answers the
Chrome DevTools protocol on loopback. `TidalRemote` is a **reconciler**: the
director only says what it wants (`want(uuid)` or `want(None)`), and a worker
thread looks at the app every `POLL_S` and presses its buttons until it
matches. So nothing here can block the event loop or the audio callback, a
TIDAL that crashed and came back is put right by itself (playing the wanted
playlist from the top), and a track paused by a stray click resumes.

A router restarted mid-act finds the app already playing, on the wanted
playlist's page, and adopts it rather than starting the act over.

The buttons are found by TIDAL's own `data-test` attributes, which an update
could rename: tidal.ps1 starts the app with `-disable-auto-update`. Any
failure is reported through `problem()`, and the director then plays the
playlist's fallback folder if it has one (`soundtrack.py`).

The capture side is `tap.py`'s buffer in stereo, with one read position per
reader, because a bed that moves speakers crossfades two voices of one
capture. Everything that touches a device or the app is injectable: `factory`
/ `query` (the capture stream), `connect` (the page), `clock`.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np

from .tap import SLACK_S, find_device

log = logging.getLogger("stagehand.audio")

#: Seconds the capture's ring buffer holds.
BUFFER_S = 2.0
#: The least the buffer holds. Music can wait, and the capture's bursts
#: outgrow `tap.py`'s voice-tight target (measured on the 828x's ASIO clock).
MIN_TARGET_S = 0.15
#: The bed's channels (a mono capture device is doubled).
CHANNELS = 2
#: The app is looked at this often (a command wakes the worker at once).
POLL_S = 1.0
#: After a playlist failed to load, this long before the next try.
RETRY_S = 5.0
#: A sample over this (dBFS) is music: VoiceMeeter's idle bus sits near -90.
SIGNAL_DB = -75.0
#: The default loopback port (tidal.ps1's `-Port`).
PORT = 9333


class TidalError(Exception):
    """The app answered, and is not in the state it should be."""


@dataclass(frozen=True)
class TidalConfig:
    #: A part of the capture device's name (the cable's output side).
    device: str
    #: engine.HOST_APIS key the device must be on.
    host_api: str | None = None
    #: A part of the name of the device TIDAL plays into (its Sound output menu).
    output: str = "VoiceMeeter Aux Input"
    port: int = PORT
    gain_db: float = 0.0


# -- the capture ----------------------------------------------------------------


class LiveInput:
    """The cable's output in a ring buffer, stereo at the mixer's rate."""

    def __init__(
        self,
        cfg: TidalConfig,
        rate: int,
        *,
        factory: Callable[..., Any] | None = None,
        query: Callable[[], tuple[list[dict], list[dict]]] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.cfg = cfg
        self.rate = rate
        self.gain = float(10 ** (cfg.gain_db / 20))
        self._factory = factory
        self._query = query
        self._clock = clock
        self._buf = np.zeros((int(rate * BUFFER_S), CHANNELS), dtype=np.float32)
        self._lock = threading.Lock()
        self._w = 0  # frames ever written
        self._chunk = 0  # the largest capture chunk seen
        self._floor = float(10 ** (SIGNAL_DB / 20))
        self._loud_at = clock()
        self.stream: Any = None
        self.name: str | None = None
        self.peak = 0.0

    def open(self) -> None:
        if self._query is None:
            import sounddevice as sd

            devices, apis = list(sd.query_devices()), list(sd.query_hostapis())
        else:
            devices, apis = self._query()
        index = find_device(self.cfg, devices, apis)
        self.name = str(devices[index]["name"])
        channels = max(1, min(CHANNELS, int(devices[index].get("max_input_channels", 1))))
        factory = self._factory
        if factory is None:
            import sounddevice as sd

            factory = sd.InputStream
        stream = factory(device=index, channels=channels, samplerate=self.rate, dtype="float32", latency="high", callback=self._capture)
        stream.start()
        self.stream = stream
        self._loud_at = self._clock()
        log.info("🎵 tidal: listening on %s (%d ch @ %d Hz)", self.name, channels, self.rate)

    def close(self) -> None:
        stream, self.stream = self.stream, None
        if stream is not None:
            for step in ("stop", "close"):
                try:
                    getattr(stream, step)()
                except Exception as err:  # noqa: BLE001
                    log.debug("tidal capture %s: %s", step, err)

    @property
    def running(self) -> bool:
        return self.stream is not None and bool(getattr(self.stream, "active", True))

    def _capture(self, indata, frames, time, status) -> None:  # noqa: ARG002
        self.write(indata)

    def write(self, block: np.ndarray) -> None:
        if block.shape[1] < CHANNELS:
            block = np.repeat(block[:, :1], CHANNELS, axis=1)
        n = len(block)
        size = len(self._buf)
        if n > size:
            block = block[-size:]
            n = size
        peak = float(np.abs(block).max()) if n else 0.0
        with self._lock:
            self._chunk = max(self._chunk, n)
            start = self._w % size
            first = min(n, size - start)
            self._buf[start : start + first] = block[:first]
            self._buf[: n - first] = block[first:]
            self._w += n
        self.peak = max(self.peak, peak)
        if peak >= self._floor:
            self._loud_at = self._clock()

    def target(self, frames: int) -> int:
        return min(len(self._buf) // 2, max(int(MIN_TARGET_S * self.rate), self._chunk + 2 * frames))

    def silent_s(self) -> float:
        """Seconds since the cable last carried music (a capture that
        stopped delivering counts as silence)."""
        return max(0.0, self._clock() - self._loud_at)

    def reader(self) -> LiveReader:
        return LiveReader(self)


class LiveReader:
    """One voice's position in the capture. Shaped like a `stream.Stream`
    that never ends: the mixer plays it, the director's beds hold it."""

    #: The director never schedules a crossfade on a live voice.
    length = None
    eof = False
    loop = True
    offset = 0

    def __init__(self, live: LiveInput) -> None:
        self.live = live
        self.channels = CHANNELS
        self.played = 0
        self.underruns = 0
        self.slips = 0
        self.closed = False
        self._r: int | None = None
        self._priming = True

    def ready(self) -> bool:
        return True

    def wait_ready(self, timeout: float | None = None) -> bool:  # noqa: ARG002
        return True

    @property
    def finished(self) -> bool:
        return self.closed

    @property
    def position(self) -> int:
        return self.played

    def close(self, wait: bool = True) -> None:  # noqa: ARG002
        self.closed = True

    def read(self, n: int) -> tuple[np.ndarray, int]:
        """→ ((n, 2) frames, n). Two crystals drift, as in `tap.py`: a buffer
        that grows drops down to the target (`slips`), one that runs short
        plays silence (`underruns`) and waits to refill."""
        out = np.zeros((n, CHANNELS), dtype=np.float32)
        self.played += n
        live = self.live
        size = len(live._buf)
        with live._lock:
            w = live._w
            target = live.target(n)
            if self._r is None or w - self._r > size:
                self._r = max(0, w - target)
            fill = w - self._r
            if self._priming:
                if fill < target:
                    return out, n
                self._priming = False
            if fill > target + live._chunk + int(SLACK_S * live.rate):
                self.slips += 1
                self._r = w - target
                fill = target
            take = min(n, fill)
            if take < n:
                self.underruns += 1
                self._priming = True
            start = self._r % size
            first = min(take, size - start)
            out[:first] = live._buf[start : start + first]
            out[first:take] = live._buf[: take - first]
            self._r += take
        if live.gain != 1.0:
            out *= live.gain
        return out, n


# -- the app --------------------------------------------------------------------


def _js(body: str, **args: Any) -> str:
    """A page script: `body` runs in its own async scope, with `q` (a
    data-test lookup), `sleep`, and `args` as JSON constants."""
    consts = "".join(f"const {k}={json.dumps(v)};" for k, v in args.items())
    return (
        "(async()=>{const q=s=>document.querySelector(`[data-test=\"${s}\"]`);"
        "const sleep=ms=>new Promise(r=>setTimeout(r,ms));"
        f"{consts}{body}}})()"
    )


STATE_JS = _js(
    "return JSON.stringify({url:location.pathname,footer:!!q('footer-player'),"
    "title:q('footer-track-title')?.innerText||'',artist:q('footer-artist-name')?.innerText||'',"
    "time:q('current-time')?.innerText||'',duration:q('duration')?.innerText||'',playing:!!q('pause')})"
)


def _click_js(test: str) -> str:
    return _js("const b=q(name);if(b)b.click();return !!b", name=test)


#: Go to the playlist in the app's own router (no reload: playback goes on)
#: and wait for it: the old page's button lingers after the push, so the
#: header's title must have changed and the page's rows be there, or the
#: click would play the page being left.
LOAD_JS = """
const header=()=>q('playlist-header-container')?.querySelector('[data-test="title"]')?.innerText||'';
const before=location.pathname.endsWith(uuid)?null:header();
if(before!==null){history.pushState({},'','/playlist/'+uuid);dispatchEvent(new PopStateEvent('popstate',{state:{}}));}
let found=false;
for(let i=0;i<100&&!found;i++){await sleep(100);found=header()!==''&&header()!==before&&!!q('play-all')&&!!q('table-row-title');}
if(!found)return JSON.stringify({ok:false,why:q('playlist-page')?'it has no tracks to play':'its page never loaded'});
const shuffled=q('shuffle')?.getAttribute('aria-checked')==='true';
if(!shuffle&&shuffled){q('shuffle').click();await sleep(150);}
q(shuffle?'shuffle-all':'play-all').click();
for(let i=0;i<80;i++){await sleep(100);if(q('pause'))return JSON.stringify({ok:true,title:header()});}
return JSON.stringify({ok:false,why:'it did not start'});
"""

#: The Repeat button cycles off → all → one; a playlist that ended would
#: otherwise hand the room to TIDAL's own autoplay, or to silence.
REPEAT_JS = _js(
    "for(let i=0;i<3;i++){const b=q('repeat');if(!b)return false;"
    "if(b.getAttribute('aria-checked')==='true'&&b.getAttribute('aria-label')==='Repeat')return true;"
    "b.click();await sleep(200);}return false"
)

#: The Sound output menu: the app's own choice, so it survives a restart.
#: (Selecting through `NativePlayerComponent` leaves the page's state behind.)
DEVICE_JS = """
q('select-device').click();await sleep(500);
const items=[...document.querySelectorAll('[data-test="output-device"]')];
const on=items.find(e=>e.getAttribute('aria-checked')==='true');
const name=e=>e.innerText.split('\\n')[0];
const hit=items.find(e=>name(e).toLowerCase().includes(output.toLowerCase()));
if(!hit||on===hit){q('select-device').click();return JSON.stringify({ok:!!hit,moved:false,on:on?name(on):''});}
hit.click();await sleep(500);
if(q('contextmenu'))q('select-device')?.click();
return JSON.stringify({ok:true,moved:true,on:name(hit)});
"""


def seconds(clock: str) -> float | None:
    """The footer's "3:46" / "1:02:03" → seconds (None: no clock shown)."""
    try:
        total = 0
        for part in clock.strip().split(":"):
            total = total * 60 + int(part)
    except ValueError:
        return None
    return float(total)


class CdpPage:
    """The app's page over Chrome DevTools, on loopback only."""

    def __init__(self, port: int, *, timeout: float = 15.0) -> None:
        import httpx
        from websockets.sync.client import connect

        targets = httpx.get(f"http://127.0.0.1:{port}/json/list", timeout=3.0).json()
        page = next((t for t in targets if t.get("type") == "page" and "tidal.com" in str(t.get("url"))), None)
        if page is None:
            raise TidalError("the app has no TIDAL page open")
        self.timeout = timeout
        self._ws = connect(page["webSocketDebuggerUrl"], max_size=None, open_timeout=5, close_timeout=1)
        self._id = 0

    def eval(self, expression: str) -> Any:
        self._id += 1
        mine = self._id
        self._ws.send(json.dumps({"id": mine, "method": "Runtime.evaluate", "params": {"expression": expression, "awaitPromise": True, "returnByValue": True}}))
        deadline = time.monotonic() + self.timeout
        while True:
            frame = json.loads(self._ws.recv(timeout=max(0.01, deadline - time.monotonic())))
            if frame.get("id") != mine:
                continue
            result = frame.get("result") or {}
            if "exceptionDetails" in result or "error" in frame:
                detail = result.get("exceptionDetails", {}).get("exception", {}).get("description") or frame.get("error")
                raise TidalError(f"the page refused a script ({detail})")
            return result.get("result", {}).get("value")

    def close(self) -> None:
        try:
            self._ws.close()
        except Exception as err:  # noqa: BLE001
            log.debug("tidal page close: %s", err)


def connect_page(port: int) -> Any:
    return CdpPage(port)


class TidalRemote:
    """Keeps the app on what is wanted (see the module docstring). `step` is
    one look; the worker thread runs it, the tests call it by hand."""

    def __init__(self, cfg: TidalConfig, *, connect: Callable[[int], Any] | None = None, clock: Callable[[], float] = time.monotonic) -> None:
        self.cfg = cfg
        self._connect = connect or connect_page
        self._clock = clock
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None
        self._stopping = False
        self._page: Any = None
        self._want: tuple[str, bool] | None = None
        #: The director has spoken. Until then the app is left as it is: a
        #: router restarted mid-act must not pause the act before its catch-up.
        self._told = False
        self._skips = 0
        #: The playlist the app was last told to play (None: don't know).
        self._loaded: str | None = None
        self._prepared = False
        self._repeat_set = False
        self._retry_at = 0.0
        #: Why the app is not doing what is wanted (None: all is well).
        self.error: str | None = None
        #: The app does not answer at all (`error` may also be one playlist's).
        self.down = False
        self.state: dict[str, Any] = {}

    # -- the director's side (the event loop) ------------------------------------

    def want(self, uuid: str | None, *, shuffle: bool = False) -> None:
        with self._lock:
            next_want = (uuid, shuffle) if uuid is not None else None
            changed = next_want != self._want
            self._want = next_want
            self._told = True
            if changed:
                self._retry_at = 0.0
                if not self.down:
                    self.error = None  # that was the last playlist's
        self._wake.set()

    def next(self) -> None:
        with self._lock:
            self._skips += 1
        self._wake.set()

    def start(self) -> None:
        if self._thread is None:
            self._stopping = False
            self._thread = threading.Thread(target=self._run, name="stagehand-tidal", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stopping = True
        self._wake.set()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=3.0)
        self._disconnect()

    # -- the worker ------------------------------------------------------------------

    def _run(self) -> None:
        while not self._stopping:
            self.step()
            self._wake.wait(POLL_S)
            self._wake.clear()

    def _disconnect(self) -> None:
        page, self._page = self._page, None
        self._loaded = None
        self._prepared = False
        self._repeat_set = False
        if page is not None:
            page.close()

    def _report(self, problem: str) -> None:
        if problem != self.error:
            log.warning("🎵 tidal: %s", problem)
        self.error = problem

    def step(self) -> None:
        try:
            if self._page is None:
                self._page = self._connect(self.cfg.port)
                self.down = False
                log.info("🎵 tidal: the app answers on port %d", self.cfg.port)
            self._reconcile()
        except TidalError as err:
            self._report(str(err))
        except Exception as err:  # noqa: BLE001 — httpx, websockets, a dead socket: the app is gone
            self._disconnect()
            self.state = {}
            self.down = True
            self._report(f"the app does not answer on port {self.cfg.port} ({type(err).__name__}): start it with scripts\\house-desktop\\tidal.ps1")

    def _read(self) -> dict[str, Any]:
        st = json.loads(self._page.eval(STATE_JS))
        self.state = {
            "track": " - ".join(x for x in (st.get("artist"), st.get("title")) if x),
            "pos_s": seconds(st.get("time") or ""),
            "dur_s": seconds(st.get("duration") or ""),
            "playing": bool(st.get("playing")),
        }
        return st

    def _reconcile(self) -> None:
        st = self._read()
        if not st.get("footer"):
            raise TidalError("the app shows no player (still starting, or signed out)")
        with self._lock:
            want, told, skips, self._skips = self._want, self._told, self._skips, 0
        if not told:
            return
        if want is None:
            if st["playing"]:
                self._page.eval(_click_js("pause"))
            self.error = None
            return
        uuid, shuffle = want
        if self._loaded != uuid:
            if st["playing"] and st["url"].endswith(uuid):
                self._loaded = uuid
                log.info("🎵 tidal: already playing %s", uuid)
            else:
                self._load(uuid, shuffle)
        elif not st["playing"]:
            self._page.eval(_click_js("play"))
        if self._loaded == uuid:
            if not self._repeat_set:
                self._repeat_set = bool(self._page.eval(REPEAT_JS))
            for _ in range(skips):
                self._page.eval(_click_js("next"))
            self.error = None

    def _load(self, uuid: str, shuffle: bool) -> None:
        now = self._clock()
        if now < self._retry_at:
            return
        self._retry_at = now + RETRY_S
        if not self._prepared:
            device = json.loads(self._page.eval(_js(DEVICE_JS, output=self.cfg.output)))
            if not device.get("ok"):
                raise TidalError(f"no {self.cfg.output!r} in the app's Sound output menu (is VoiceMeeter installed?)")
            if device.get("moved"):
                log.info("🎵 tidal: Sound output set to %s", device.get("on"))
            self._prepared = True
        answer = json.loads(self._page.eval(_js(LOAD_JS, uuid=uuid, shuffle=shuffle)))
        if not answer.get("ok"):
            raise TidalError(f"playlist {uuid}: {answer.get('why')}")
        self._loaded = uuid
        log.info("🎵 tidal: playing %s (%s)", answer.get("title"), uuid)


# -- the two together ---------------------------------------------------------------


class Tidal:
    """What the director holds: the capture and the app as one source."""

    def __init__(
        self,
        cfg: TidalConfig,
        *,
        factory: Callable[..., Any] | None = None,
        query: Callable[[], tuple[list[dict], list[dict]]] | None = None,
        connect: Callable[[int], Any] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.cfg = cfg
        self._factory = factory
        self._query = query
        self._clock = clock
        self.remote = TidalRemote(cfg, connect=connect, clock=clock)
        self.input: LiveInput | None = None
        self.input_error: str | None = None

    def open(self, rate: int) -> None:
        """Listen at `rate` and start the worker (again, harmless; a capture
        that failed to open is tried again at each scene)."""
        self.remote.start()
        if self.input is not None and self.input.rate == rate and self.input.running:
            return
        self.close_input()
        live = LiveInput(self.cfg, rate, factory=self._factory, query=self._query, clock=self._clock)
        try:
            live.open()
        except Exception as err:  # noqa: BLE001 — PortAudio raises its own types
            if str(err) != self.input_error:
                log.error("🎵 tidal: can't open the capture (%s)", err)
            self.input_error = str(err)
            return
        self.input, self.input_error = live, None

    def close_input(self) -> None:
        live, self.input = self.input, None
        if live is not None:
            live.close()

    def close(self) -> None:
        """The router is stopping. The app plays on: a router restarted
        mid-act adopts it (`TidalRemote._reconcile`)."""
        self.remote.stop()
        self.close_input()

    def reader(self) -> Any:
        if self.input is None:
            raise TidalError(f"the capture is not open ({self.input_error or 'no stream'})")
        return self.input.reader()

    def want(self, uuid: str | None, *, shuffle: bool = False) -> None:
        self.remote.want(uuid, shuffle=shuffle)

    def next(self) -> None:
        self.remote.next()

    def reachable(self) -> bool:
        """Worth trying: the capture is open and the app is not known to be down."""
        return self.input is not None and not self.remote.down

    def problem(self) -> str | None:
        """Why a live bed can't play now (None: nothing known to be wrong)."""
        if self.input is None:
            return f"the capture is not open ({self.input_error or 'no stream'})"
        return self.remote.error

    def silent_s(self) -> float:
        return self.input.silent_s() if self.input is not None else 0.0

    def now(self) -> dict[str, Any]:
        return self.remote.state

    def stats(self) -> str:
        """For the health line."""
        problem = self.problem()
        if problem is not None:
            return f"PROBLEM: {problem}"
        peak = 0.0
        if self.input is not None:
            peak, self.input.peak = self.input.peak, 0.0
        db = 20 * np.log10(peak) if peak > 0 else -120.0
        st = self.remote.state
        return f"{'playing' if st.get('playing') else 'paused'} {st.get('track') or '—'}, capture peak {db:.0f} dBFS"
