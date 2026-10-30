"""The software input (wave 46): a capture device (VoiceMeeter) summed into
one of the interface's inputs, as if cabled there, with no device."""

from __future__ import annotations

import logging

import numpy as np
import pytest

from stagehand.audio.config import parse_audio_section
from stagehand.audio.engine import Engine
from stagehand.audio.mixer import SidechainSource
from stagehand.audio.tap import Tap, TapConfig, find_device
from stagehand.module import ConfigError
from test_audio_engine import FakeStream, fake_query

RATE = 48000

APIS = [{"name": "MME"}, {"name": "Windows DirectSound"}, {"name": "ASIO"}]
DEVICES = [
    {"name": "VoiceMeeter Output (VB-Audio Vo", "hostapi": 0, "max_input_channels": 8},
    {"name": "VoiceMeeter Aux Output (VB-Audi", "hostapi": 0, "max_input_channels": 8},
    {"name": "VoiceMeeter Input (VB-Audio Voi", "hostapi": 0, "max_input_channels": 0},
    {"name": "VoiceMeeter Output (VB-Audio VoiceMeeter VAIO)", "hostapi": 1, "max_input_channels": 8},
    {"name": "MOTU Audio ASIO", "hostapi": 2, "max_input_channels": 32},
]


def query():
    return DEVICES, APIS


class FakeCapture:
    """A capture stream: `feed` runs its callback by hand."""

    def __init__(self, **kwargs) -> None:
        self.kwargs = kwargs
        self.active = False
        self.closed = False

    def start(self) -> None:
        self.active = True

    def stop(self) -> None:
        self.active = False

    def close(self) -> None:
        self.closed = True
        self.active = False

    def feed(self, block: np.ndarray) -> None:
        self.kwargs["callback"](block.astype(np.float32), len(block), None, None)


def make_tap(cfg: TapConfig | None = None) -> tuple[Tap, list[FakeCapture]]:
    made: list[FakeCapture] = []

    def factory(**kw):
        made.append(FakeCapture(**kw))
        return made[-1]

    return Tap(cfg or TapConfig("VoiceMeeter Output", "mme"), RATE, factory=factory, query=query), made


def test_find_device_matches_a_contiguous_name_on_one_host_api():
    # sounddevice's own matching would take "VoiceMeeter Aux Output" too.
    assert find_device(TapConfig("VoiceMeeter Output", "mme"), DEVICES, APIS) == 0
    assert find_device(TapConfig("voicemeeter output", "directsound"), DEVICES, APIS) == 3
    with pytest.raises(ValueError, match="several match"):
        find_device(TapConfig("VoiceMeeter Output"), DEVICES, APIS)
    with pytest.raises(ValueError, match="no capture device"):
        find_device(TapConfig("VoiceMeeter Input", "mme"), DEVICES, APIS)  # an output, not a capture


def test_the_tap_opens_mono_low_latency_at_the_router_rate():
    tap, made = make_tap()
    tap.open()
    kw = made[0].kwargs
    assert (kw["device"], kw["channels"], kw["samplerate"], kw["latency"]) == (0, 2, RATE, "low")
    assert tap.name.startswith("VoiceMeeter Output") and tap.running
    tap.close()
    assert made[0].closed and not tap.running


def test_it_waits_for_its_target_then_delivers_in_order_averaged_to_mono():
    tap, made = make_tap()
    tap.open()
    left = np.arange(1, 2001, dtype=np.float32) / 4000
    made[0].feed(np.column_stack([left, left * 0]))  # mono = left / 2
    col = np.zeros(512, np.float32)
    tap.add_into(col)  # target = 2000 + 1024 frames: still priming
    assert not col.any()
    made[0].feed(np.column_stack([left, left * 0]))
    tap.add_into(col)
    assert col[:4] == pytest.approx(left[:4] / 2) and tap.underruns == 0
    col2 = np.full(512, 0.5, np.float32)
    tap.add_into(col2)  # summed, not replaced
    assert col2[0] == pytest.approx(0.5 + left[512] / 2)


def test_a_dry_buffer_is_an_underrun_and_it_primes_again():
    tap, made = make_tap()
    tap.open()
    made[0].feed(np.full((1600, 2), 0.2))
    col = np.zeros(1024, np.float32)
    tap.add_into(col)  # target = 1600 + 2048: still priming
    assert not col.any()
    made[0].feed(np.full((1600, 2), 0.2))
    made[0].feed(np.full((1600, 2), 0.2))  # 4800 ≥ 3648
    for _ in range(4):
        tap.add_into(np.zeros(1024, np.float32))
    col = np.zeros(1024, np.float32)
    tap.add_into(col)  # 4800 - 4096 = 704 left: an underrun, the rest silence
    assert tap.underruns == 1 and col[0] == pytest.approx(0.2) and col[703] == pytest.approx(0.2) and col[704] == 0


def test_a_fast_capture_clock_slips_back_to_the_target():
    tap, made = make_tap()
    tap.open()
    for _ in range(20):
        made[0].feed(np.full((480, 1), 0.1))  # 9600 frames, target 480 + 1024
    tap.add_into(np.zeros(512, np.float32))
    assert tap.slips == 1
    assert tap._w - tap._r == tap.target(512) - 512


def test_gain_and_peak_in_the_stats():
    tap, made = make_tap(TapConfig("VoiceMeeter Output", "mme", gain_db=-6.0206))
    tap.open()
    for _ in range(3):
        made[0].feed(np.full((1000, 2), 0.5))  # ≥ target 1000 + 512
    col = np.zeros(256, np.float32)
    tap.add_into(col)
    assert col[0] == pytest.approx(0.25, rel=1e-3)
    assert "peak -12 dBFS" in tap.stats() and "underruns 0, slips 0" in tap.stats()


def test_the_engine_sums_the_tap_into_its_input_and_the_sidechain_ducks():
    """VoiceMeeter's voice lands on input 3: routed like the cable, and the
    trabolta sidechain ducks the music under it."""
    FakeStream.opened.clear()
    taps: list[Tap] = []
    made: list[FakeCapture] = []

    def tap_factory(rate):
        def cap(**kw):
            made.append(FakeCapture(**kw))
            return made[-1]

        taps.append(Tap(TapConfig("VoiceMeeter Output", "mme", ch=3), rate, factory=cap, query=query))
        return taps[-1]

    e = Engine("MOTU", 4, 4, rate=RATE, blocksize=512, query=fake_query(4, 4, rate=RATE), stream_factory=lambda **kw: FakeStream(**kw), tap=tap_factory)
    mixer = e.open()
    s = FakeStream.opened[-1]
    assert e.tap is taps[0] and made[0].kwargs["samplerate"] == RATE
    mixer.set_routes({(3, 1): 0.0})
    mixer.set_priority({"trabolta": {"music": -18}})
    mixer.set_sources([SidechainSource("trabolta", (3,), (1, 2))])
    mixer.play(np.full((RATE, 1), 0.1, dtype=np.float32), {2: 0.0}, bus="music", fade_in_s=0)
    indata = np.zeros((512, 4), np.float32)
    for _ in range(40):
        made[0].feed(np.full((512, 2), 0.25))
        out = s.pump(512, indata)
    assert not indata.any()  # PortAudio's buffer untouched
    assert out[-1, 0] == pytest.approx(0.25, rel=1e-3)
    assert out[-1, 1] == pytest.approx(0.1 * 10 ** (-18 / 20), rel=0.01)
    assert mixer.take_meters().sources["trabolta"] == 1.0 and e.errors == 0
    e.close()
    assert made[0].closed and e.tap is None


def test_a_tap_that_fails_to_open_never_stops_the_router(caplog):
    FakeStream.opened.clear()

    def tap_factory(rate):
        return Tap(TapConfig("VB-Cable", "mme"), rate, factory=FakeCapture, query=query)

    e = Engine("MOTU", 4, 4, rate=RATE, query=fake_query(4, 4, rate=RATE), stream_factory=lambda **kw: FakeStream(**kw), tap=tap_factory)
    with caplog.at_level(logging.ERROR):
        e.open()
    assert e.running and e.tap is None and "no capture device" in e.tap_error
    assert "playing on without it" in caplog.text
    assert FakeStream.opened[-1].pump(64).shape == (64, 4)


def test_a_tap_past_the_inputs_or_on_an_output_only_stream_is_refused():
    def tap_factory(rate):
        return Tap(TapConfig("VoiceMeeter Output", "mme", ch=9), rate, factory=FakeCapture, query=query)

    e = Engine("MOTU", 4, 4, rate=RATE, query=fake_query(4, 4, rate=RATE), stream_factory=lambda **kw: FakeStream(**kw), tap=tap_factory)
    e.open()
    assert e.tap is None and "past audio.json's 4 inputs" in e.tap_error
    e = Engine("MOTU", 4, 4, duplex=False, rate=RATE, query=fake_query(4, 4, rate=RATE), stream_factory=lambda **kw: FakeStream(**kw), tap=tap_factory)
    e.open()
    assert e.tap is None and "duplex" in e.tap_error


def test_the_section_parses_a_tap(tmp_path):
    cfg = parse_audio_section({"tap": {"device": "VoiceMeeter Output", "host_api": "MME"}}, str(tmp_path))
    assert cfg.tap == TapConfig("VoiceMeeter Output", "mme", 3, 2, 0.0)
    assert parse_audio_section({}, str(tmp_path)).tap is None


@pytest.mark.parametrize(
    "tap, msg",
    [
        ("VoiceMeeter", r"audio\.tap: a mapping"),
        ({}, r"audio\.tap\.device"),
        ({"device": "x", "host_api": "jack"}, r"audio\.tap\.host_api"),
        ({"device": "x", "ch": 0}, r"audio\.tap\.ch"),
        ({"device": "x", "channel": 3}, r"audio\.tap\.channel: unknown"),
    ],
)
def test_the_section_refuses_a_bad_tap(tmp_path, tap, msg):
    with pytest.raises(ConfigError, match=msg):
        parse_audio_section({"tap": tap}, str(tmp_path))
