"""Streamed voices (wave 38, C2): the streaming resampler and the ring
buffer a worker fills, with fake files (numpy arrays) and no device."""

from __future__ import annotations

import shutil
import subprocess
import threading
import time

import numpy as np
import pytest
import soundfile as sf

from stagehand.audio.stream import TAPS, Resampler, Stream


class ArrayFile:
    """A `soundfile.SoundFile` look-alike over an array (the injectable opener)."""

    def __init__(self, data: np.ndarray, rate: int, *, frames: int | None = None, fail_at: int | None = None) -> None:
        self.data = data if data.ndim == 2 else data[:, None]
        self.samplerate = rate
        self.channels = self.data.shape[1]
        self.frames = len(self.data) if frames is None else frames
        self.at = 0
        self.closed = False
        self.reads: list[int] = []
        self.seeks = 0
        self.fail_at = fail_at

    def read(self, n: int, dtype: str = "float32", always_2d: bool = True) -> np.ndarray:
        if self.fail_at is not None and self.at >= self.fail_at:
            raise RuntimeError("bad frame")
        self.reads.append(n)
        part = self.data[self.at : self.at + n]
        self.at += len(part)
        return part.astype(np.float32)

    def seek(self, pos: int) -> None:
        self.seeks += 1
        self.at = pos

    def close(self) -> None:
        self.closed = True


def opener_of(f: ArrayFile):
    return lambda path: f


def sine(freq: float, rate: int, seconds: float, channels: int = 1) -> np.ndarray:
    t = np.arange(int(rate * seconds)) / rate
    x = np.sin(2 * np.pi * freq * t).astype(np.float32)
    return np.repeat(x[:, None], channels, axis=1)


def rms_db(x: np.ndarray) -> float:
    return 20 * np.log10(np.sqrt(np.mean(np.square(x, dtype=np.float64))) + 1e-20)


# -- the resampler -------------------------------------------------------------


def test_a_1khz_sine_resamples_44k1_to_48k_within_minus_60_db():
    x = sine(1000, 44100, 1.0)
    r = Resampler(44100, 48000, 1)
    assert (r.up, r.down) == (160, 147) and r.taps >= 32
    y = r.process(x)[:, 0]
    ref = np.sin(2 * np.pi * 1000 * np.arange(len(y)) / 48000)
    settled = slice(TAPS * 2, len(y) - TAPS * 2)  # the filter's lead-in / lead-out
    err = rms_db(y[settled] - ref[settled]) - rms_db(ref[settled])
    assert err < -60, err
    assert abs(len(y) - 48000) <= 40  # all but the filter's tail (flush() gives it)


def test_the_resampler_has_no_seam_at_any_chunk_boundary():
    x = sine(3000, 44100, 0.5, channels=2) * np.array([1.0, 0.5], dtype=np.float32)
    whole = Resampler(44100, 48000, 2).process(x)
    r = Resampler(44100, 48000, 2)
    rng = np.random.default_rng(7)
    parts, at = [], 0
    while at < len(x):
        n = int(rng.integers(1, 3000))
        parts.append(r.process(x[at : at + n]))
        at += n
    chunked = np.concatenate(parts)
    assert chunked.shape == whole.shape
    assert np.abs(chunked - whole).max() < 1e-6  # bit-for-bit the same filter, so no seam


def test_a_downsample_is_band_limited():
    # 30 kHz at 96 kHz is above 48 kHz's Nyquist: it must not alias to 18 kHz.
    x = sine(30000, 96000, 0.25)
    y = Resampler(96000, 48000, 1).process(x)[200:-200, 0]
    assert rms_db(y) < -60
    passband = Resampler(96000, 48000, 1).process(sine(1000, 96000, 0.25))[200:-200, 0]
    assert rms_db(passband) == pytest.approx(rms_db(np.sin(np.linspace(0, 100, 10000))), abs=0.1)


def test_the_same_rate_is_a_copy():
    r = Resampler(48000, 48000, 2)
    x = np.random.default_rng(0).standard_normal((1000, 2)).astype(np.float32)
    assert r.identity and np.array_equal(r.process(x), x) and len(r.flush()) == 0


# -- the stream ---------------------------------------------------------------


def test_a_stream_plays_the_whole_file_then_finishes():
    f = ArrayFile(sine(440, 44100, 1.0), 44100)
    s = Stream("x.wav", 48000, opener=opener_of(f), start=False, chunk_s=0.25, buffer_s=0.6, prefill_s=0.2)
    assert s.length == 48000 and not s.ready()
    assert s.wait_ready(0) and s.ready()
    assert max(f.reads) <= 44100  # never more than 1 s a chunk
    got, real_total = [], 0
    while not s.finished:
        block, real = s.read(512)  # the callback's pattern
        got.append(block[:real])
        real_total += real
        s.fill()  # the worker's turn
    out = np.concatenate(got)
    assert real_total == len(out) == 48000 and s.eof and s.underruns == 0
    assert s.position == 48000
    ref = np.sin(2 * np.pi * 440 * np.arange(len(out)) / 48000)
    assert rms_db(out[200:-200, 0] - ref[200:-200]) < -60
    s.close()
    assert f.closed


def test_a_stream_reads_in_callback_sized_blocks_from_a_threaded_worker():
    f = ArrayFile(sine(1000, 44100, 2.0, channels=2), 44100)
    s = Stream("x.mp3", 48000, opener=opener_of(f), chunk_s=0.5, buffer_s=1.0, prefill_s=0.3)
    assert s.wait_ready(2.0)
    blocks = []
    for _ in range(80):  # 80 × 512 = 0.85 s, faster than real time
        block, real = s.read(512)
        blocks.append(block[:real])
        time.sleep(0.0005)
    out = np.concatenate(blocks)
    assert out.shape[1] == 2 and len(out) == 80 * 512 and s.underruns == 0
    ref = np.sin(2 * np.pi * 1000 * np.arange(len(out)) / 48000)
    assert rms_db(out[300:, 0] - ref[300:]) < -60
    s.close()
    assert f.closed and not (s._thread and s._thread.is_alive())


def test_an_underrun_plays_silence_counts_and_picks_up_where_it_was():
    f = ArrayFile(np.ones((4800, 1), dtype=np.float32) * 0.5, 48000)
    s = Stream("x.wav", 48000, opener=opener_of(f), start=False, chunk_s=0.01, buffer_s=0.03, prefill_s=0.01)
    s._step()  # one chunk only: 480 frames
    block, real = s.read(512)
    assert real == 480 and np.allclose(block[:480], 0.5) and not block[480:].any()
    assert s.underruns == 1 and not s.finished
    s.fill()
    block, real = s.read(512)
    assert real == 512 and np.allclose(block, 0.5) and s.position == 992


def test_a_looping_stream_wraps_without_a_seam():
    # A sine with a whole number of cycles: the loop point is continuous in
    # the file, so it must be continuous out of the resampler too.
    rate_in = 44100
    period = rate_in // 441  # 441 Hz: exactly 100 samples a cycle
    x = np.sin(2 * np.pi * np.arange(period * 30) / period).astype(np.float32)[:, None]  # 30 whole cycles
    f = ArrayFile(x, rate_in)
    s = Stream("loop.wav", 48000, loop=True, opener=opener_of(f), start=False, chunk_s=0.02, buffer_s=0.2, prefill_s=0.05)
    out = []
    for _ in range(40):
        s.fill()
        block, real = s.read(256)
        assert real == 256
        out.append(block)
    y = np.concatenate(out)[:, 0]
    assert f.seeks >= 2 and not s.eof and s.underruns == 0
    ref = np.sin(2 * np.pi * 441 * np.arange(len(y)) / 48000)
    # Across every wrap (and the chunk joints) the output stays the sine.
    assert rms_db(y[400:] - ref[400:]) < -60
    assert 0 <= s.position < s.length and s.length == round(len(x) * 48000 / rate_in)


def test_a_one_chunk_loop_at_the_device_rate_is_sample_exact():
    x = np.arange(1000, dtype=np.float32)[:, None] / 1000
    f = ArrayFile(x, 48000)
    s = Stream("loop.wav", 48000, loop=True, opener=opener_of(f), start=False, chunk_s=0.5, buffer_s=0.5, prefill_s=0.01)
    s.fill()
    block, _ = s.read(2500)
    assert np.array_equal(block[:, 0], np.concatenate([x[:, 0], x[:, 0], x[:500, 0]]))
    assert s.position == 500


def test_a_decode_error_ends_the_stream_early_not_the_callback():
    f = ArrayFile(np.full((48000, 1), 0.1, dtype=np.float32), 48000, fail_at=9600)
    s = Stream("bad.mp3", 48000, opener=opener_of(f), start=False, chunk_s=0.1, buffer_s=1.0, prefill_s=0.05)
    s.fill()
    total = 0
    while not s.finished:
        total += s.read(1024)[1]
    assert total == 9600 and s.error == "bad frame" and s.underruns == 0


def test_close_from_the_audio_thread_never_blocks():
    f = ArrayFile(sine(100, 48000, 5.0), 48000)
    s = Stream("x.wav", 48000, opener=opener_of(f), buffer_s=0.5)
    s.wait_ready(1.0)
    t0 = time.perf_counter()
    s.close(wait=False)
    assert time.perf_counter() - t0 < 0.01 and s.finished
    for _ in range(100):
        if f.closed:
            break
        time.sleep(0.01)
    assert f.closed  # the worker closed it itself


def test_a_header_with_no_length_and_a_mono_file_upmix():
    f = ArrayFile(np.full((480, 1), 0.2, dtype=np.float32), 48000, frames=0)
    s = Stream("x.ogg", 48000, opener=opener_of(f), start=False)
    assert s.length is None and s.channels == 1
    s.fill()
    assert s.read(480)[1] == 480


def test_the_real_opener_streams_a_wav(tmp_path):
    path = tmp_path / "bed.wav"
    sf.write(str(path), sine(500, 44100, 0.5, channels=2), 44100)
    s = Stream(path, 48000, buffer_s=1.0)
    assert s.wait_ready(2.0) and s.channels == 2 and s.length == 24000
    total = 0
    deadline = time.monotonic() + 3
    while not s.finished and time.monotonic() < deadline:
        total += s.read(512)[1]
        time.sleep(0.001)
    assert total == 24000
    s.close()


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")
def test_libsndfile_reads_an_mp3_and_streams_it(tmp_path):
    wav, mp3 = tmp_path / "t.wav", tmp_path / "t.mp3"
    sf.write(str(wav), sine(1000, 44100, 1.0) * 0.5, 44100)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-b:a", "128k", str(mp3)], check=True)
    info = sf.info(str(mp3))
    assert info.samplerate == 44100 and info.frames > 40000
    s = Stream(mp3, 48000, buffer_s=2.0)
    assert s.wait_ready(2.0) and s.length is not None and abs(s.length - 48000) < 4800  # approximate for MP3
    total, peak = 0, 0.0
    deadline = time.monotonic() + 5
    while not s.finished and time.monotonic() < deadline:
        block, real = s.read(1024)
        total += real
        peak = max(peak, float(np.abs(block).max()))
        time.sleep(0.0005)
    assert abs(total - 48000) < 4800 and 0.4 < peak < 0.6
    s.close()


def test_streams_close_their_threads():
    before = threading.active_count()
    streams = [Stream("x", 48000, opener=opener_of(ArrayFile(sine(100, 48000, 0.2), 48000))) for _ in range(5)]
    for s in streams:
        s.wait_ready(1.0)
        s.close()
    assert threading.active_count() <= before


def test_a_stream_can_start_partway_into_the_file():
    data = np.arange(48000, dtype=np.float32)[:, None] / 48000
    s = Stream("x.wav", 48000, opener=opener_of(ArrayFile(data, 48000)), start=False, offset=12000)
    assert s.offset == 12000 and s.wait_ready()
    block, real = s.read(100)
    assert real == 100 and block[0, 0] == pytest.approx(12000 / 48000) and s.position == 12100
    # A file at another rate seeks in its own frames.
    f = ArrayFile(np.zeros((44100, 1), dtype=np.float32), 44100)
    t = Stream("y.wav", 48000, opener=opener_of(f), start=False, offset=48000 // 2)
    assert f.at == 22050 and t.offset == 24000
