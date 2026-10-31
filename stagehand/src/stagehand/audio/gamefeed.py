"""An input of the interface heard in the reinstallation games (wave 59,
`docs/loom-w59-mic-contract.md`): Mic 1 of the 828x as the sound of the living-room
TV in The Desktop.

No new transport. To the event server the router is one more terminal at the
spot `desktop-tv` on the voice relay (`docs/loom-reinstall.md` §2.4), the wire
every wall terminal speaks: it holds `GET /api/spatial/voice/stream?spot=&mic=1
&hear=0` and POSTs 200 ms chunks of 16 kHz μ-law to `/api/spatial/voice`, only
while the stream says someone hears it (`listen {on}`). So the games need no
code to hear it (a Quest APK already on the headset plays it at the TV's
screen), the server's same-room rule says who hears it, and nothing leaves the
house while nobody stands in the virtual Desktop.

    audio:
      game_feed: { ch: 1, spot: desktop-tv }

The input is read as it comes in, before the mixer, so the house mix and
CueMix never touch it. The audio callback only copies the column into a ring
buffer (`write`, under a lock held for that copy). Everything else, the
resample, the gate, the μ-law and the upload, runs on the router's event loop
(`run`), so a slow network can never reach the callback: the ring keeps the
last `RING_S`, and the upload queue keeps only the newest `UP_QUEUE` chunks.
Late audio is worse than a gap.

`mulaw_encode` is `@loom/house` `mulawByte`, pinned by a byte-for-byte copy of
`house/test/fixtures/voice-mulaw.json`. `Downsampler` is the house `Resampler`
behind the anti-alias filter a browser's `BiquadFilterNode` gives the web game;
`Gate` is `VoiceGate`'s open path with a longer hang (`GATE_HANG_S`). All of it
is pure and needs no device. The stream, the POST and the clocks are injected
(`mod`, `clock`, `wall`), so the tests need no server either.

Nothing here may stop the house: `run` never raises, and a `write` that throws
takes the feed out of the path (`Engine._duplex_cb`).
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx
import numpy as np

from ..modapi import ModApiError, ModClient, run_stream

log = logging.getLogger("stagehand.audio")

# The wire: `house/src/voice.ts` (tests/test_audio_gamefeed.py reads them there).
VOICE_RATE = 16000
VOICE_CHUNK_MS = 200
VOICE_CHUNK_BYTES = 3200
VOICE_CODEC = "mulaw"
VOICE_GATE_DBFS = -42.0
#: The web game's mic filter (`VOICE_LOWPASS_HZ`): under the wire's Nyquist.
LOWPASS_HZ = 7000.0

STREAM_PATH = "/api/spatial/voice/stream"
UPLOAD_PATH = "/api/spatial/voice"

#: Seconds of input the ring holds for the event loop.
RING_S = 2.0
#: How often the loop looks at the ring, when it has nothing to send.
POLL_S = 0.02
#: Chunks that wait to go up at most (600 ms, the web game's `VOICE_UP_QUEUE`).
UP_QUEUE = 3
#: One upload's deadline: past it the chunk is late, and later ones matter more.
POST_TIMEOUT_S = 2.0
#: After a refused or failed upload, before the next one.
REFUSED_S = 1.0
#: The gate stays open this long after the last loud chunk. Longer than a
#: terminal's 400 ms: a pause between phrases must not close the stream,
#: because every reopening restarts the game's jitter buffer.
GATE_HANG_S = 1.0
#: After the feed's own loop died of something unforeseen.
RESTART_S = 5.0
#: A failure is logged at most this often (s).
WARN_S = 60.0


@dataclass(frozen=True)
class GameFeedConfig:
    #: The interface input (1-based, audio.json's numbering).
    ch: int = 1
    #: The terminal the games hear it at (a spot on the show's maps).
    spot: str = "desktop-tv"
    gain_db: float = 0.0
    #: A chunk over this (RMS, dBFS) opens the gate.
    gate_db: float = VOICE_GATE_DBFS


# --- G.711 μ-law --------------------------------------------------------------------


def _mulaw_table() -> np.ndarray:
    """Every clipped 14-bit magnitude → its μ-law byte before the sign's mask
    (`mulawByte`'s bias and segments)."""
    seg_end = (0x3F, 0x7F, 0xFF, 0x1FF, 0x3FF, 0x7FF, 0xFFF, 0x1FFF)
    table = np.zeros(8160, dtype=np.uint8)
    for mag in range(8160):
        biased = mag + (0x84 >> 2)
        seg = next((i for i, end in enumerate(seg_end) if biased <= end), 8)
        table[mag] = 0x7F if seg >= 8 else (seg << 4) | ((biased >> (seg + 1)) & 0x0F)
    return table


_MULAW = _mulaw_table()


def mulaw_encode(samples: np.ndarray) -> bytes:
    """Float samples in [-1, 1] (clamped; NaN = 0) → μ-law bytes, one per
    sample. The 14-bit magnitude is `floor(|x| * 8192 + 0.5)`, as every port rounds."""
    x = np.nan_to_num(np.asarray(samples, dtype=np.float64), nan=0.0, posinf=1.0, neginf=-1.0)
    magnitude = np.floor(np.minimum(np.abs(x), 1.0) * 8192 + 0.5).astype(np.int64)
    bytes_ = _MULAW[np.minimum(magnitude, 8159)]
    return np.where(x < 0, bytes_ ^ 0x7F, bytes_ ^ 0xFF).astype(np.uint8).tobytes()


def rms_dbfs(samples: np.ndarray) -> float:
    """A chunk's RMS level (dBFS); silence or nothing is -inf."""
    if len(samples) == 0:
        return float("-inf")
    power = float(np.mean(np.square(samples, dtype=np.float64)))
    return 10 * np.log10(power) if power > 0 else float("-inf")


# --- the resampler ------------------------------------------------------------------


def _lowpass(rate: int, cutoff: float = LOWPASS_HZ) -> np.ndarray:
    """A Hamming-windowed sinc, about 2 ms long: flat to `cutoff` less a
    little, and past -50 dB by the wire's Nyquist."""
    n = int(rate * 0.002) | 1
    middle = (n - 1) / 2
    taps = np.sinc(2 * cutoff / rate * (np.arange(n) - middle)) * np.hamming(n)
    return (taps / taps.sum()).astype(np.float32)


class Downsampler:
    """`rate` → 16 kHz, and the output of any split of a signal is the output
    of the whole. The low-pass comes first (the house `Resampler` is linear and
    has no anti-alias filter of its own); then each output sits at source
    position `k * rate / 16000`, tracked in integers, so nothing drifts over a
    night. At 48 kHz that is plain decimation by 3."""

    def __init__(self, rate: int, to: int = VOICE_RATE) -> None:
        self.rate = int(round(rate))
        self.to = int(round(to))
        if self.rate <= 0 or self.to <= 0:
            raise ValueError(f"bad rates {rate} -> {to}")
        self._taps = _lowpass(self.rate)
        self.reset()

    def reset(self) -> None:
        self._held = np.zeros(len(self._taps) - 1, dtype=np.float32)
        #: The next output's source position * `to`, from the next block's first sample.
        self._num = 0
        #: The last filtered sample (source position -1).
        self._last = 0.0

    def push(self, samples: np.ndarray) -> np.ndarray:
        n = len(samples)
        if n == 0:
            return np.zeros(0, dtype=np.float32)
        joined = np.concatenate((self._held, samples.astype(np.float32)))
        self._held = joined[-(len(self._taps) - 1) :]
        filtered = np.convolve(joined, self._taps, mode="valid")
        limit = (n - 1) * self.to
        count = 0 if self._num > limit else (limit - self._num) // self.rate + 1
        positions = self._num + np.arange(count, dtype=np.int64) * self.rate
        whole = positions // self.to
        part = (positions - whole * self.to) / self.to
        before = np.where(whole < 0, self._last, filtered[np.maximum(whole, 0)])
        after = filtered[np.minimum(whole + 1, n - 1)]
        self._num += count * self.rate - n * self.to
        self._last = float(filtered[-1])
        return (before + (after - before) * part).astype(np.float32)


# --- the gate -----------------------------------------------------------------------


class Gate:
    """`VoiceGate` without its holds: a chunk over the gate opens it (and sends
    the one quiet chunk before it, so a word's onset is not clipped); it stays
    open `hang_s` after the last loud chunk. There is no half-duplex hold:
    nothing here plays the games back into this input's own microphone."""

    def __init__(self, gate_db: float = VOICE_GATE_DBFS, hang_s: float = GATE_HANG_S) -> None:
        self.gate_db = gate_db
        self.hang_s = hang_s
        self.reset()

    def reset(self) -> None:
        self.open = False
        self._until = float("-inf")
        self._preroll: bytes | None = None

    def push(self, chunk: bytes, dbfs: float, now: float) -> list[bytes]:
        if dbfs > self.gate_db:
            pre = [self._preroll] if not self.open and self._preroll is not None else []
            self.open = True
            self._until = now + self.hang_s
            self._preroll = None
            return [*pre, chunk]
        if self.open and now <= self._until:
            return [chunk]
        self.open = False
        self._preroll = chunk
        return []


# --- the feed -----------------------------------------------------------------------


class GameFeed:
    def __init__(
        self,
        cfg: GameFeedConfig,
        *,
        clock: Callable[[], float] = time.monotonic,
        wall: Callable[[], float] = time.time,
    ) -> None:
        self.cfg = cfg
        self.gain = float(10 ** (cfg.gain_db / 20))
        self._clock = clock
        self._buf: np.ndarray | None = None
        self._lock = threading.Lock()
        self._w = 0  # frames ever written
        self._r = 0  # frames ever read
        self._down: Downsampler | None = None
        self._pending = np.zeros(0, dtype=np.float32)
        self._gate = Gate(cfg.gate_db)
        #: Chunks waiting to go up, oldest first.
        self.queue: deque[bytes] = deque()
        #: Counts in chunks from the wall clock, so a restarted router is never
        #: below the seq it left off at (a game drops a seq it has seen).
        self.seq = int(wall() * 1000 / VOICE_CHUNK_MS)
        self.listening = False
        self.ears = 0
        self.compatible = True
        self.sent = 0
        self.dropped = 0
        self.overflows = 0
        self.peak = 0.0
        self._warned = 0.0
        self._warned_ever = False

    # -- the audio thread ----------------------------------------------------------

    def open(self, rate: int) -> None:
        """A stream opens at `rate`, before its first block. What was in the
        ring belonged to the old stream."""
        with self._lock:
            self._buf = np.zeros(int(rate * RING_S), dtype=np.float32)
            self._w = self._r = 0
        self._down = Downsampler(rate)
        self._pending = np.zeros(0, dtype=np.float32)

    @property
    def opened(self) -> bool:
        return self._buf is not None

    def write(self, column: np.ndarray) -> None:
        """One block of this input, in the audio callback: a copy and an index."""
        buf = self._buf
        if buf is None:
            return
        n = len(column)
        size = len(buf)
        if n > size:
            column = column[-size:]
            n = size
        with self._lock:
            start = self._w % size
            first = min(n, size - start)
            buf[start : start + first] = column[:first]
            buf[: n - first] = column[first:]
            self._w += n
            if self._w - self._r > size:
                self.overflows += 1
                self._r = self._w - size

    # -- the event loop ------------------------------------------------------------

    def _take(self) -> np.ndarray:
        buf = self._buf
        if buf is None:
            return np.zeros(0, dtype=np.float32)
        size = len(buf)
        with self._lock:
            n = self._w - self._r
            start = self._r % size
            first = min(n, size - start)
            out = np.concatenate((buf[start : start + first], buf[: n - first])) if first < n else buf[start : start + n].copy()
            self._r = self._w
        return out

    def drain(self) -> None:
        """What came in since the last look → chunks in `queue`. The peak is
        read whoever listens: it is how a person sees the level of the input."""
        samples = self._take()
        if len(samples) == 0:
            return
        samples *= self.gain
        self.peak = max(self.peak, float(np.abs(samples).max()))
        if not self.listening or not self.compatible or self._down is None:
            return
        pending = np.concatenate((self._pending, self._down.push(samples)))
        whole = len(pending) // VOICE_CHUNK_BYTES
        now = self._clock()
        for i in range(whole):
            chunk = pending[i * VOICE_CHUNK_BYTES : (i + 1) * VOICE_CHUNK_BYTES]
            self.queue.extend(self._gate.push(mulaw_encode(chunk), rms_dbfs(chunk), now))
        self._pending = pending[whole * VOICE_CHUNK_BYTES :]
        while len(self.queue) > UP_QUEUE:
            self.queue.popleft()
            self.dropped += 1

    def set_listening(self, on: bool) -> None:
        if on == self.listening:
            return
        self.listening = on
        if not on:
            self.queue.clear()
            self._gate.reset()
            self._pending = np.zeros(0, dtype=np.float32)
            if self._down is not None:
                self._down.reset()
        log.info("game feed: %s", f"{self.cfg.spot} is heard in the games, sending input {self.cfg.ch}" if on else "nobody hears it, not sending")

    def on_frame(self, event: str, data: str) -> None:
        """The voice stream's `hello` / `listen`. The stream is the authority
        on whether to send; an upload's answer can land after a newer `listen`."""
        if event not in ("hello", "listen"):
            return
        try:
            doc = json.loads(data)
        except ValueError:
            return
        if not isinstance(doc, dict):
            return
        if event == "hello":
            self.compatible = doc.get("codec", VOICE_CODEC) == VOICE_CODEC and doc.get("rate", VOICE_RATE) == VOICE_RATE
            if not self.compatible:
                log.error("game feed: the server speaks %s at %s Hz, not sending", doc.get("codec"), doc.get("rate"))
        ears = doc.get("ears")
        self.ears = ears if isinstance(ears, int) and not isinstance(ears, bool) else 0
        self.set_listening((doc.get("listen") if event == "hello" else doc.get("on")) is True)

    def stream_path(self) -> str:
        """A terminal whose mic can be heard and that plays nothing: the games
        hear this stream's spot, and no player is routed to the router."""
        return f"{STREAM_PATH}?spot={quote(self.cfg.spot, safe='')}&mic=1&hear=0"

    def _warn(self, message: str, *args: Any, **kwargs: Any) -> None:
        now = self._clock()
        if self._warned_ever is False or now - self._warned > WARN_S:
            self._warned, self._warned_ever = now, True
            log.warning(message, *args, **kwargs)

    async def _post(self, mod: ModClient, chunk: bytes) -> None:
        seq = self.seq
        self.seq += 1
        try:
            answer = await mod.post_bytes(UPLOAD_PATH, chunk, params={"seq": seq, "spot": self.cfg.spot}, timeout=POST_TIMEOUT_S)
        except ModApiError as err:
            if err.status in (401, 403):
                mod.forget_token()
            self._warn("game feed refused (%s)", err)
        except (httpx.HTTPError, OSError) as err:
            self._warn("game feed upload failed (%s)", err or type(err).__name__)
        else:
            self.sent += 1
            if answer.get("listening") is False:
                self.queue.clear()  # never `set_listening`: see `on_frame`
            return
        self.dropped += 1
        await asyncio.sleep(REFUSED_S)

    async def _send_loop(self, mod: ModClient) -> None:
        while True:
            try:
                self.drain()
                if self.queue:
                    await self._post(mod, self.queue.popleft())
                    continue
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — never the house's problem
                self._warn("game feed: a chunk failed", exc_info=True)
            await asyncio.sleep(POLL_S)

    async def run(self, mod: ModClient) -> None:
        """Hold the stream and send; never raises (the router's other jobs
        share this `gather`: a fault here must not end them)."""
        while True:
            sender = asyncio.ensure_future(self._send_loop(mod))
            try:
                await run_stream(mod, mod.stream_url(self.stream_path()), self.on_frame, label="game feed")
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("game feed stopped, restarting it; the house plays on")
            finally:
                sender.cancel()
            self.set_listening(False)
            await asyncio.sleep(RESTART_S)

    def stats(self) -> str:
        """For the health line: the input's peak since the last call, who hears it, the counts."""
        peak, self.peak = self.peak, 0.0
        db = 20 * np.log10(peak) if peak > 0 else -120.0
        heard = f"{self.ears} hearing" if self.listening else "nobody hearing"
        state = "" if self.opened else ", NOT OPEN"
        return f"input {self.cfg.ch} → {self.cfg.spot} peak {db:.0f} dBFS, {heard}, sent {self.sent}, dropped {self.dropped}, overflows {self.overflows}{state}"
