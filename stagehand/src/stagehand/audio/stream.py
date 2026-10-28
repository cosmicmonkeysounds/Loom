"""Streamed voices (wave 38, C2): a long file played without decoding it whole.

A story sound is decoded once and kept in memory (`sounds.SoundBank`), which
is right for a 3 s zip and wrong for a night of MP3 beds: an hour of stereo
at 48 kHz is 1.4 GB of float32. A `Stream` instead opens the file and lets
a **worker thread** decode it a chunk (≤ 1 s) at a time, resample the chunk
to the device rate and write it into a ring buffer; the audio callback only
copies frames out of that buffer (`read`). The callback never decodes, never
resamples and holds the buffer's lock only for an index update, so a slow
disk or a fat MP3 frame costs the worker time, never a block.

The resampler (`Resampler`) is a streaming polyphase windowed-sinc filter at
the exact rational ratio (44.1 → 48 kHz is up 160, down 147), Kaiser
windowed, `TAPS` taps per output sample. It carries its input history and
its phase across chunks, so a chunk boundary is invisible (no seam), and a
`loop` stream simply seeks the file to 0 at the end and keeps feeding the
same resampler: the loop point is as continuous as the file's own last and
first samples. A file already at the device rate is copied through
untouched.

When the buffer runs dry before the end (the worker starved), the callback
plays silence for the missing frames and counts an **underrun**: the health
line shows it, and the stream picks up where it was (late, never skipped).

    s = Stream(path, 48000, loop=False)   # opens the file, starts the worker
    s.wait_ready(1.0)                     # prefilled (or at its end): start the voice now
    block, real = s.read(512)             # the audio thread: (512, channels), frames that were the file's
    s.position, s.length, s.finished      # output frames: where it is, how long (header), done
    Stream(path, 48000, offset=n)         # start n output frames into the file (a moved bed)
    s.close()                             # stop the worker, close the file

The file is reached through an injectable `opener(path)` returning an
object shaped like `soundfile.SoundFile` (`samplerate`, `channels`,
`frames`, `read(n, dtype=, always_2d=)`, `seek(0)`, `close()`), so the tests
stream numpy arrays with no file at all; `start=False` keeps the worker off
and `fill()` runs it by hand, block by block, deterministically.
"""

from __future__ import annotations

import logging
import math
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger("stagehand.audio")

#: Taps per output sample (per polyphase branch) at an upsample. A
#: downsample by M/L widens the filter by ceil(M/L) so it still spans
#: TAPS output samples.
TAPS = 64
#: Kaiser β: ≈ 86 dB stopband, passband ripple far below the −60 dB budget.
KAISER_BETA = 8.6
#: The cutoff as a fraction of the lower Nyquist: flat to ≈ 18 kHz at 44.1 kHz.
ROLLOFF = 0.9
#: Outputs computed per vectorised pass (bounds the gather's memory).
_SLICE = 4096

#: Seconds decoded per worker step (the contract's ≤ 1 s).
CHUNK_S = 0.5
#: Seconds the ring buffer holds.
BUFFER_S = 4.0
#: Seconds buffered before `ready()` (a voice starts only on a prefilled stream).
PREFILL_S = 0.5


class Resampler:
    """Streaming band-limited resampler, (frames, channels) float32 in and
    out at `rate_out / rate_in`, exact rational ratio.

    Output sample j is the input's band-limited value at input time
    j·rate_in/rate_out: the filter's group delay is compensated by starting
    the output phase at the filter's centre, so output 0 is input 0 (no
    lead-in shift). `process` returns every output it can compute from the
    input seen so far; `flush` pushes zeros through to empty the filter at
    the true end of the input."""

    def __init__(self, rate_in: int, rate_out: int, channels: int, *, taps: int = TAPS, beta: float = KAISER_BETA, rolloff: float = ROLLOFF) -> None:
        if rate_in <= 0 or rate_out <= 0 or channels <= 0:
            raise ValueError("rates and channels must be positive")
        g = math.gcd(int(rate_in), int(rate_out))
        self.up, self.down = int(rate_out) // g, int(rate_in) // g
        self.channels = channels
        self.identity = self.up == self.down
        L, M = self.up, self.down
        #: Taps per branch (input samples each output looks at).
        self.taps = 0 if self.identity else (taps if taps % 2 == 0 else taps + 1) * max(1, -(-M // L))
        K = self.taps
        self.t = 0
        self.consumed = 0
        if self.identity:
            self.bank = np.zeros((1, 0), dtype=np.float32)
            self.hist = np.zeros((0, channels), dtype=np.float32)
            return
        n = L * K
        centre = n // 2
        fc = rolloff * 0.5 / max(L, M)  # cycles per upsampled sample
        k = np.arange(n, dtype=np.float64) - centre
        # np.kaiser(n + 1) is symmetric about n / 2 = `centre`: drop its last
        # point so the window's centre is an integer tap (no half-sample lag).
        h = 2.0 * fc * np.sinc(2.0 * fc * k) * np.kaiser(n + 1, beta)[:n] * L
        #: bank[p, k] = h[p + k·L]: branch p's taps, newest input first.
        self.bank = np.ascontiguousarray(h.reshape(K, L).T, dtype=np.float32)
        #: The upsampled-domain position of the next output (absolute).
        self.t = centre
        #: The last K − 1 inputs (zeros before the first).
        self.hist = np.zeros((K - 1, channels), dtype=np.float32)
        self._k = np.arange(K, dtype=np.int64)

    def out_frames(self, frames_in: int) -> int:
        """The most frames `process` can return for `frames_in` inputs."""
        if self.identity:
            return frames_in
        return frames_in * self.up // self.down + 2

    @property
    def flush_frames(self) -> int:
        """The most frames `flush` returns."""
        return 0 if self.identity else self.out_frames(self.taps)

    def process(self, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x, dtype=np.float32)
        if x.ndim == 1:
            x = x[:, None]
        if self.identity:
            self.consumed += len(x)
            return x
        L, M, K = self.up, self.down, self.taps
        ext = np.concatenate([self.hist, x], axis=0)
        base = self.consumed
        avail = base + len(x)
        count = max(0, -(-(avail * L - self.t) // M))
        out = np.empty((count, self.channels), dtype=np.float32)
        for start in range(0, count, _SLICE):
            stop = min(count, start + _SLICE)
            tj = self.t + np.arange(start, stop, dtype=np.int64) * M
            newest = tj // L - base + (K - 1)
            idx = newest[:, None] - self._k[None, :]
            coef = self.bank[tj % L]
            for c in range(self.channels):
                out[start:stop, c] = np.einsum("nk,nk->n", coef, ext[idx, c])
        self.t += count * M
        self.consumed = avail
        self.hist = ext[len(ext) - (K - 1) :].copy() if K > 1 else self.hist
        return out

    def flush(self) -> np.ndarray:
        """The filter's tail: the input's last samples, played out."""
        if self.identity:
            return np.zeros((0, self.channels), dtype=np.float32)
        return self.process(np.zeros((self.taps, self.channels), dtype=np.float32))


def open_soundfile(path: str | Path) -> Any:
    """The real opener: libsndfile (WAV, AIFF, FLAC, OGG, MP3 since 1.1)."""
    import soundfile as sf

    return sf.SoundFile(str(path))


class Stream:
    """One file, decoded and resampled by a worker into a ring buffer the
    audio callback reads. See the module docstring for the life cycle.

    Thread rules: `read` (and `ready`, `finished`) are the audio thread's;
    `wait_ready`, `close`, `fill` the control side's; `position`, `played`,
    `underruns`, `length`, `eof` are plain reads, safe from anywhere."""

    def __init__(
        self,
        path: str | Path,
        rate: int,
        *,
        loop: bool = False,
        opener: Callable[[str | Path], Any] | None = None,
        chunk_s: float = CHUNK_S,
        buffer_s: float = BUFFER_S,
        prefill_s: float = PREFILL_S,
        start: bool = True,
        name: str = "",
        offset: int = 0,
    ) -> None:
        self.path = path
        self.name = name or Path(str(path)).stem
        self.rate = int(rate)
        self.loop = loop
        self._file = (opener or open_soundfile)(path)  # raises: the caller logs a missing / bad file
        self.file_rate = int(self._file.samplerate)
        self.channels = max(1, int(self._file.channels))
        frames = int(getattr(self._file, "frames", 0) or 0)
        #: The file's length in output frames, from its header (an MP3's is
        #: an estimate); None when the header doesn't say.
        self.length: int | None = int(round(frames * self.rate / self.file_rate)) if frames > 0 and self.file_rate > 0 else None
        #: Output frames into the file this stream starts at (`offset`: the
        #: soundtrack moving a bed to new speakers mid-track starts a second
        #: stream where the first one is). 0 when the file can't seek.
        self.offset = 0
        if offset > 0:
            skip = int(round(offset * self.file_rate / self.rate))
            try:
                self._file.seek(skip)
            except Exception as err:  # noqa: BLE001 — libsndfile raises its own types
                log.warning("stream %s: can't seek to %d (%s) — starts at 0", self.name, skip, err)
            else:
                self.offset = int(round(skip * self.rate / self.file_rate))
        self._rs = Resampler(self.file_rate, self.rate, self.channels)
        self._chunk_in = max(1, min(int(chunk_s * self.file_rate), self.file_rate))
        #: The most one step can write (a chunk plus the end's flush).
        self._step_max = self._rs.out_frames(self._chunk_in) + self._rs.flush_frames
        cap = max(int(buffer_s * self.rate), 2 * self._step_max)
        self._cap = cap
        self._buf = np.zeros((cap, self.channels), dtype=np.float32)
        self._r = 0
        self._w = 0
        self._filled = 0
        self._prefill = max(1, min(int(prefill_s * self.rate), cap - self._step_max))
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._ready = threading.Event()
        self._eof = False
        self._closed = False
        self._file_closed = False
        #: Input frames read in all (every pass of a loop).
        self._in_total = 0
        #: Input frames read in the current pass (a loop's empty-file guard).
        self._in_pass = 0
        #: Output frames written / read (real ones, never the underrun silence).
        self.produced = 0
        self.played = 0
        #: Blocks the callback found the buffer short before the end.
        self.underruns = 0
        #: Output frame (by `played`) at which each loop pass began.
        self._wraps: list[int] = [0]
        self.error: str | None = None
        self._thread: threading.Thread | None = None
        if start:
            self._thread = threading.Thread(target=self._run, name=f"stream {self.name}", daemon=True)
            self._thread.start()

    # -- the worker ----------------------------------------------------------

    def _write(self, out: np.ndarray) -> None:
        n = len(out)
        if n == 0:
            return
        w, cap = self._w, self._cap
        first = min(n, cap - w)
        self._buf[w : w + first] = out[:first]
        if n > first:
            self._buf[: n - first] = out[first:]
        # The region written was free, so the reader never saw it half-done;
        # only the counters need the lock.
        with self._lock:
            self._w = (w + n) % cap
            self._filled += n
            self.produced += n

    def _free(self) -> int:
        with self._lock:
            return self._cap - self._filled

    def _finish(self) -> None:
        with self._lock:
            self._eof = True
        self._ready.set()

    def _step(self) -> bool:
        """Decode, resample and write one chunk. → False when there is
        nothing to do now (the buffer is full, the end was written, closed)."""
        if self._closed or self._eof or self._free() < self._step_max:
            return False
        try:
            data = self._file.read(self._chunk_in, dtype="float32", always_2d=True)
        except Exception as err:  # noqa: BLE001 — libsndfile raises its own types
            self.error = str(err) or type(err).__name__
            log.warning("stream %s: decode failed (%s) — ended early", self.name, self.error)
            self._write(self._rs.flush())
            self._finish()
            return False
        data = np.asarray(data, dtype=np.float32)
        if data.ndim == 1:
            data = data[:, None]
        if data.shape[1] != self.channels:
            data = data[:, : self.channels] if data.shape[1] > self.channels else np.repeat(data[:, :1], self.channels, axis=1)
        n = len(data)
        self._in_total += n
        self._in_pass += n
        out = self._rs.process(data) if n else np.zeros((0, self.channels), dtype=np.float32)
        if n < self._chunk_in:  # the end of the file
            if self.loop and self._in_pass > 0:
                self._write(out)
                # The next pass starts exactly where the resampler's clock
                # says the file's frame 0 lands (output j = input j·in/out).
                self._wraps.append(int(round(self._in_total * self.rate / self.file_rate)))
                self._in_pass = 0
                self._file.seek(0)
                self._mark_ready()
                return True
            out = np.concatenate([out, self._rs.flush()], axis=0)
            want = int(round(self._in_total * self.rate / self.file_rate))
            self._write(out[: max(0, want - self.produced)])
            self._finish()
            return False
        self._write(out)
        self._mark_ready()
        return True

    def _mark_ready(self) -> None:
        if not self._ready.is_set():
            with self._lock:
                filled = self._filled
            if filled >= self._prefill:
                self._ready.set()

    def fill(self) -> int:
        """Run the worker's steps here until the buffer is full or the end
        is written (`start=False`, the tests). → steps run."""
        steps = 0
        while self._step():
            steps += 1
        return steps

    def _run(self) -> None:
        try:
            while not self._closed:
                self._wake.clear()
                if not self._step():
                    if self._eof:
                        break
                    self._wake.wait(0.05)
        except Exception:  # noqa: BLE001 — a worker that dies must end the voice, not hang it
            log.exception("stream %s: worker failed", self.name)
            self._finish()
        finally:
            self._close_file()

    def _close_file(self) -> None:
        if self._file_closed:
            return
        self._file_closed = True
        try:
            self._file.close()
        except Exception as err:  # noqa: BLE001
            log.debug("stream %s: close: %s", self.name, err)

    # -- the audio thread ----------------------------------------------------

    def ready(self) -> bool:
        """Prefilled (or the whole file is in): a voice may start."""
        return self._ready.is_set()

    @property
    def eof(self) -> bool:
        """The worker has written the file's last frame (never, looping)."""
        return self._eof

    @property
    def finished(self) -> bool:
        """Every frame played (or closed): the voice is done."""
        return self._closed or (self._eof and self._filled == 0)

    def read(self, n: int) -> tuple[np.ndarray, int]:
        """→ ((n, channels) frames, how many of them are the file's). The
        rest is silence: past the end, or an underrun (counted)."""
        out = np.zeros((n, self.channels), dtype=np.float32)
        with self._lock:
            have, eof = self._filled, self._eof
        take = min(n, have)
        if take > 0:
            r, cap = self._r, self._cap
            first = min(take, cap - r)
            out[:first] = self._buf[r : r + first]
            if take > first:
                out[first:take] = self._buf[: take - first]
            with self._lock:
                self._r = (r + take) % cap
                self._filled -= take
                self.played += take
        if take < n and not eof and not self._closed:
            self.underruns += 1
        self._wake.set()
        return out, take

    # -- the control side ----------------------------------------------------

    @property
    def position(self) -> int:
        """Output frames into the current pass of the file (a loop restarts
        at 0; the first pass counts from `offset`)."""
        played = self.played
        start = 0
        for w in self._wraps:
            if w <= played:
                start = w
        return played - start + (self.offset if start == 0 else 0)

    @property
    def buffered(self) -> int:
        return self._filled

    def wait_ready(self, timeout: float | None = None) -> bool:
        """Block until prefilled (or ended). With no worker running, fill here."""
        if self._thread is None:
            self.fill()
            return self.ready()
        return self._ready.wait(timeout)

    def close(self, wait: bool = True) -> None:
        """Stop the worker and close the file. `wait=False` (the audio
        thread) only flags it: the worker closes the file itself."""
        self._closed = True
        self._wake.set()
        thread = self._thread
        if thread is None or not thread.is_alive():
            if thread is None or wait:
                self._close_file()
            return
        if wait and thread is not threading.current_thread():
            thread.join(timeout=2.0)
