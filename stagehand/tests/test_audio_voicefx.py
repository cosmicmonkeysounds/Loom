"""The router's half of wave 56: his voice torn up in the audio callback."""

from __future__ import annotations

import re
import time
from pathlib import Path

import numpy as np
import pytest

from stagehand.audio.voicefx import (
    FLAVOUR_FROM,
    FLAVOURS,
    Echo,
    VoiceFx,
    event_rate,
    render,
)

RATE = 48000
BLOCK = 512
ROOT = Path(__file__).resolve().parents[2]


def tone(seconds: float, hz: float = 440.0, amp: float = 0.4) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    return (amp * np.sin(2 * np.pi * hz * t)).astype(np.float32)


def speech(seconds: float, seed: int = 1) -> np.ndarray:
    """Voice-like: a buzz with formants, in syllable-long bursts."""
    r = np.random.default_rng(seed)
    t = np.arange(int(seconds * RATE)) / RATE
    x = sum(a * np.sin(2 * np.pi * f * t) for f, a in ((130, 0.5), (260, 0.3), (700, 0.2), (1300, 0.1)))
    env = (np.sin(2 * np.pi * 2.5 * t) > -0.6).astype(np.float32)
    return (0.35 * x * env + 0.01 * r.standard_normal(len(t)) * env).astype(np.float32)


def blocks(fx: VoiceFx, x: np.ndarray, size: int = BLOCK) -> np.ndarray:
    out = x.copy()
    for at in range(0, len(out), size):
        fx.process(out[at : at + size])
    return out


def peak_hz(x: np.ndarray) -> float:
    spectrum = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    return float(np.argmax(spectrum)) * RATE / len(x)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x * x)))


def test_at_rest_it_leaves_him_sample_for_sample():
    x = speech(1.0)
    assert np.array_equal(blocks(VoiceFx(RATE, seed=1), x), x)


def test_at_rest_it_still_remembers_him_so_a_spike_has_something_to_break():
    fx = VoiceFx(RATE, seed=1)
    x = tone(0.1)
    blocks(fx, x)
    assert np.array_equal(fx.last(100), x[-100:])


def test_the_ring_wraps():
    fx = VoiceFx(RATE, seed=1)
    x = tone(0.2)
    for _ in range(20):
        blocks(fx, x)
    assert fx.w == 20 * len(x)
    assert np.array_equal(fx.last(BLOCK), x[-BLOCK:])


@pytest.mark.parametrize("flavour", FLAVOURS)
def test_each_flavour_changes_him_and_stays_bounded(flavour):
    x = speech(3.0)
    y = render(x, RATE, flavour=flavour)
    assert np.isfinite(y).all()
    assert np.abs(y).max() <= 1.0
    assert not np.array_equal(y, x)
    assert rms(y - x) > 0.01
    assert rms(y) > 0.05  # broken, not gone


@pytest.mark.parametrize("flavour", FLAVOURS)
def test_each_flavour_stays_about_as_loud_as_he_was(flavour):
    """Broken, not turned down or up: a pile of ring modulators once sat 10 dB
    under his voice for as long as a spike stood."""
    x = speech(6.0)
    db = 20 * np.log10(rms(render(x, RATE, flavour=flavour)) / rms(x))
    assert -8.5 < db < 2.5, f"{flavour}: {db:.1f} dB"


def test_colours_never_pile_up():
    fx = VoiceFx(RATE, seed=2)
    fx.spike(1.0, 20_000, ("safe", "dump", "packet"))
    most = 0
    x = speech(20.0)
    for at in range(0, len(x), BLOCK):
        fx.process(x[at : at + BLOCK].copy())
        most = max(most, len(fx.colours))
    assert most <= 2  # `dump` is two at once; nothing stacks on it


@pytest.mark.parametrize("flavour", FLAVOURS)
@pytest.mark.parametrize("size", [64, 512, 2048])
def test_each_flavour_takes_any_block_size(flavour, size):
    fx = VoiceFx(RATE, seed=3)
    fx.spike(1.0, 1500, (flavour,))
    assert np.isfinite(blocks(fx, speech(1.5), size)).all()


@pytest.mark.parametrize("flavour", FLAVOURS)
def test_each_flavour_survives_silence_and_full_scale(flavour):
    for x in (np.zeros(RATE, np.float32), np.ones(RATE, np.float32), -np.ones(RATE, np.float32)):
        fx = VoiceFx(RATE, seed=4)
        fx.spike(1.0, 1000, (flavour,))
        y = blocks(fx, x)
        assert np.isfinite(y).all() and np.abs(y).max() <= 1.0


def test_kernel_drops_his_pitch_and_overclock_lifts_it():
    x = tone(1.5, 300.0)
    fx = VoiceFx(RATE, seed=2)
    fx.start("kernel", 1.0)
    fx.colours.clear()  # the pitch alone, not its ring
    fx.source.ratios = (0.5,)
    low = peak_hz(blocks(fx, x)[int(0.3 * RATE) : int(1.2 * RATE)])
    assert low == pytest.approx(150, abs=8)
    fx = VoiceFx(RATE, seed=2)
    fx.start("overclock", 1.0)
    fx.colours.clear()
    fx.source.ratios = (1.5,)
    assert peak_hz(blocks(fx, x)[int(0.3 * RATE) : int(1.2 * RATE)]) == pytest.approx(450, abs=8)


def test_a_stall_sinks_towards_its_end():
    fx = VoiceFx(RATE, seed=2)
    x = tone(0.4, 600.0)
    blocks(fx, x)
    fx.start("stall", 1.0)
    y = blocks(fx, tone(1.1, 600.0))
    early, late = y[: int(0.3 * RATE)], y[int(0.7 * RATE) : int(1.1 * RATE)]
    assert peak_hz(late) < peak_hz(early) * 0.7


def test_skip_repeats_one_grain():
    fx = VoiceFx(RATE, seed=2)
    x = speech(0.5)
    blocks(fx, x)
    fx.start("skip", 1.0)
    fx.source.base = fx.source.base[:2400]
    fx.source.size = 2400.0
    fx.source.shrink = 1.0
    y = blocks(fx, np.zeros(RATE // 4, np.float32))
    a, b = y[2400:4800], y[4800:7200]
    assert rms(a) > 0.01
    assert np.corrcoef(a[100:-100], b[100:-100])[0, 1] > 0.98


def test_packet_loss_opens_real_holes():
    x = tone(2.0)
    y = render(x, RATE, flavour="packet")
    env = np.array([np.abs(y[i : i + 240]).max() for i in range(0, len(y) - 240, 240)])
    assert (env < 0.02).sum() >= 3
    assert (env > 0.3).sum() >= 3


def test_the_echo_rings_on_and_dies():
    fx = VoiceFx(RATE, seed=2)
    fx.echo.open(0.05, 0.1, 0.7)
    x = tone(0.05)
    y = blocks(fx, np.concatenate([x, np.zeros(3 * RATE, np.float32)]))
    after = y[len(x) + int(0.05 * RATE) : len(x) + int(0.25 * RATE)]
    assert np.abs(after).max() > 0.05
    assert not fx.echo.ringing
    assert np.abs(y[-BLOCK:]).max() == 0.0


def test_the_echo_never_runs_away():
    echo = Echo(RATE)
    echo.open(10.0, 0.05, 5.0)
    assert echo.feedback <= 0.75
    fx = VoiceFx(RATE, seed=2)
    fx.echo.open(10.0, 0.05, 0.8)
    y = blocks(fx, tone(8.0, amp=0.9))
    assert np.abs(y).max() <= 1.0
    assert rms(y[-RATE:]) < 1.0


def test_nothing_clicks_as_an_event_starts_or_ends():
    x = tone(3.0, 220.0, 0.3)
    biggest_step = np.abs(np.diff(x)).max()
    for flavour in ("skip", "stall", "kernel", "overclock", "driver"):
        y = render(x, RATE, flavour=flavour)
        # A grain's fade or a pitch window's wrap, never a jump to a stray sample.
        assert np.abs(np.diff(y)).max() < biggest_step * 45, flavour


def test_the_night_fires_more_as_the_level_climbs():
    assert event_rate(0.1) < event_rate(0.5) < event_rate(1.0)
    assert event_rate(0.0) == 0.0
    counts = []
    for level in (0.1, 0.5, 1.0):
        fx = VoiceFx(RATE, seed=5)
        fx.want = fx.now = level
        blocks(fx, speech(20.0))
        counts.append(sum(fx.fired.values()))
    assert counts[0] < counts[1] < counts[2]
    assert counts[2] >= 8


def test_the_flavours_open_with_the_level():
    fx = VoiceFx(RATE, seed=6)
    fx.want = fx.now = 0.25
    blocks(fx, speech(30.0))
    assert fx.fired["kernel"] == 0 and fx.fired["dump"] == 0
    fx = VoiceFx(RATE, seed=6)
    fx.want = fx.now = 1.0
    blocks(fx, speech(120.0))
    assert all(fx.fired[f] > 0 for f in FLAVOURS)


def test_it_waits_for_him_to_speak():
    fx = VoiceFx(RATE, seed=7)
    fx.want = fx.now = 1.0
    blocks(fx, np.zeros(10 * RATE, np.float32))
    assert sum(fx.fired.values()) == 0


def test_the_level_frays_him_all_the_time():
    x = speech(2.0)
    y = render(x, RATE, level=0.8, seed=9)
    assert rms(y - x) > 0.003


def test_a_level_moves_smoothly_and_clears():
    fx = VoiceFx(RATE, seed=8)
    fx.set_level(1.0)
    blocks(fx, np.zeros(RATE // 2, np.float32))
    assert 0.2 < fx.now < 0.6
    fx.clear()
    blocks(fx, np.zeros(20 * RATE, np.float32))
    assert fx.now == 0.0


def test_a_spike_fires_at_once_stands_for_its_length_and_lets_go():
    fx = VoiceFx(RATE, seed=8)
    fx.spike(1.0, 1000, ("skip",))
    blocks(fx, speech(0.01))  # the very first block
    assert fx.fired["skip"] == 1
    before = sum(fx.fired.values())
    blocks(fx, speech(1.2))
    assert sum(fx.fired.values()) > before
    x = speech(1.0)
    blocks(fx, np.zeros(4 * RATE, np.float32))
    assert np.array_equal(blocks(fx, x), x)  # clean again, sample for sample


def test_a_spike_ignores_a_flavour_it_doesnt_know():
    fx = VoiceFx(RATE, seed=8)
    fx.spike(1.0, 1000, ("nope",))
    assert fx._spike is None
    fx.spike(1.0, 1000, ("nope", "skip"))
    assert fx._spike is not None and fx._spike[2] == ("skip",)


def test_clear_stops_a_spike():
    fx = VoiceFx(RATE, seed=8)
    fx.spike(1.0, 60_000, ("packet",))
    blocks(fx, speech(0.2))
    fx.clear()
    blocks(fx, speech(0.1))
    assert fx.spike_left == 0


def test_a_block_over_budget_for_long_trips_it_off_and_leaves_him_dry():
    t = {"now": 0.0}

    def clock() -> float:
        t["now"] += 0.02  # every block 20 ms: far over budget
        return t["now"]

    fx = VoiceFx(RATE, seed=8, clock=clock)
    fx.set_level(1.0)
    fx.now = 1.0
    blocks(fx, speech(3.0))
    assert fx.tripped
    x = speech(0.5)
    assert np.array_equal(blocks(fx, x), x)
    assert "TRIPPED" in fx.stats()


def test_one_slow_block_never_trips_it():
    ticks = iter(range(10**7))
    fx = VoiceFx(RATE, seed=8, clock=lambda: next(ticks) * (0.05 if next(ticks) % 40 == 0 else 1e-6))
    fx.now = fx.want = 1.0
    blocks(fx, speech(2.0))
    assert not fx.tripped


def test_the_worst_block_fits_the_callback():
    """Far inside the ~10 ms a 512-frame block has; the mixer needs the rest."""
    fx = VoiceFx(RATE, seed=8)
    fx.want = fx.now = 1.0
    fx.spike(1.0, 30_000, FLAVOURS)
    x = speech(10.0)
    spent = []
    for at in range(0, len(x) - BLOCK, BLOCK):
        began = time.perf_counter()
        fx.process(x[at : at + BLOCK])
        spent.append(time.perf_counter() - began)
    assert np.percentile(spent, 99) < 0.004
    assert not fx.tripped


def test_render_is_repeatable_on_one_seed():
    x = speech(2.0)
    assert np.array_equal(render(x, RATE, level=0.9, seed=11), render(x, RATE, level=0.9, seed=11))
    assert not np.array_equal(render(x, RATE, level=0.9, seed=11), render(x, RATE, level=0.9, seed=12))


def test_the_flavours_are_the_servers():
    src = (ROOT / "core/src/voice-fx.ts").read_text(encoding="utf-8")
    listed = re.search(r"VOICE_FLAVOURS = \[(.*?)\]", src, re.S).group(1)
    assert tuple(re.findall(r'"(\w+)"', listed)) == FLAVOURS


def test_the_levels_are_the_terminals():
    src = (ROOT / "terminal/src/speech/glitch.ts").read_text(encoding="utf-8")
    block = re.search(r"FLAVOUR_FROM[^=]*= \{(.*?)\n\};", src, re.S).group(1)
    found = {m[0]: (float(m[1]), int(m[2])) for m in re.findall(r"(\w+): \{ level: ([\d.]+), weight: (\d+) \}", block)}
    assert found == FLAVOUR_FROM


# -- on the stream ---------------------------------------------------------------


class Boom(VoiceFx):
    def process(self, col):
        col[:] = 0.0  # half done, then it dies
        raise RuntimeError("bad block")


def on_engine(fx_type=VoiceFx, ch=3, duplex=True):
    from test_audio_engine import FakeStream, fake_query

    from stagehand.audio.engine import Engine

    FakeStream.opened.clear()
    e = Engine("MOTU", 4, 4, rate=RATE, blocksize=BLOCK, duplex=duplex, query=fake_query(4, 4, rate=RATE), stream_factory=lambda **kw: FakeStream(**kw), voicefx=fx_type, voicefx_ch=ch)
    mixer = e.open()
    return e, mixer, FakeStream.opened[-1]


def test_it_breaks_his_input_on_the_way_to_the_speakers_and_nothing_else():
    e, mixer, s = on_engine()
    mixer.set_routes({(3, 1): 0.0, (4, 2): 0.0})
    e.voicefx.spike(1.0, 2000, ("safe",))
    x = tone(0.6)
    seen = []
    for at in range(0, len(x) - BLOCK, BLOCK):
        indata = np.zeros((BLOCK, 4), np.float32)
        indata[:, 2] = x[at : at + BLOCK]
        indata[:, 3] = x[at : at + BLOCK]
        seen.append(s.pump(BLOCK, indata).copy())
        assert np.array_equal(indata[:, 2], x[at : at + BLOCK])  # PortAudio's buffer untouched
    out = np.concatenate(seen)[int(0.2 * RATE) :]
    assert e.errors == 0
    assert rms(out[:, 0] - out[:, 1]) > 0.02  # his channel broke
    assert out[:, 1] == pytest.approx(x[int(0.2 * RATE) : int(0.2 * RATE) + len(out)], abs=0.01)  # the other didn't


def test_a_throw_in_the_callback_leaves_him_speaking_dry_for_good():
    e, mixer, s = on_engine(Boom)
    mixer.set_routes({(3, 1): 0.0})
    indata = np.zeros((BLOCK, 4), np.float32)
    indata[:, 2] = 0.25
    for _ in range(100):  # past the matrix's smoothing
        out = s.pump(BLOCK, indata)
    assert e.errors == 1  # once: it is out of the path for good
    assert e.voicefx is None and e.voicefx_failed
    assert out[-1, 0] == pytest.approx(0.25, rel=1e-3)


def test_it_needs_a_duplex_stream_and_a_real_input():
    assert on_engine(duplex=False)[0].voicefx is None
    assert on_engine(ch=0)[0].voicefx is None
    assert on_engine(ch=9)[0].voicefx is None


def test_a_closed_engine_lets_it_go():
    e, _, _ = on_engine()
    assert e.voicefx is not None
    e.close()
    assert e.voicefx is None


# -- the router ------------------------------------------------------------------


def fx_router(tmp_path, **over):
    from test_audio_router import answer, router

    r = router(tmp_path, voicefx=True, **over)
    r.apply(answer("v1", inputs=[{"ch": 3, "label": "TV", "kind": "line", "role": "trabolta"}]))
    return r


def test_the_router_finds_his_input_by_its_role(tmp_path):
    r = fx_router(tmp_path)
    assert r.engine.voicefx is not None and r.engine.voicefx_ch == 3
    assert "voice fx" in "\n".join(r.describe())


def test_off_by_default(tmp_path):
    from test_audio_router import answer, router

    r = router(tmp_path)
    r.apply(answer("v1", inputs=[{"ch": 3, "label": "TV", "kind": "line", "role": "trabolta"}]))
    assert r.engine.voicefx is None
    assert r.voicefx_state() is None


def test_no_trabolta_input_no_insert(tmp_path):
    from test_audio_router import answer, router

    r = router(tmp_path, voicefx=True)
    r.apply(answer("v1", inputs=[{"ch": 3, "label": "TV", "kind": "line"}]))
    assert r.engine.voicefx is None


def test_the_server_sets_the_level(tmp_path):
    r = fx_router(tmp_path)
    r.on_voice_fx({"mode": "auto", "level": 0.8, "spike": None}, 1000)
    assert r.engine.voicefx.want == 0.8


def test_a_spike_plays_once_for_what_is_left_of_it(tmp_path):
    r = fx_router(tmp_path)
    fx = r.engine.voicefx
    spike = {"key": "hijack:1000", "at": 1000, "ms": 8000, "strength": 1, "flavours": ["skip", "packet"]}
    r.on_voice_fx({"level": 0, "spike": spike}, 3000)
    assert fx._spike == (1.0, int(6.0 * fx.rate), ("skip", "packet"))
    fx._spike = None
    r.on_voice_fx({"level": 0, "spike": spike}, 3500)
    assert fx._spike is None


def test_a_spike_the_server_stops_naming_stops_a_directors_clean_lands(tmp_path):
    r = fx_router(tmp_path)
    fx = r.engine.voicefx
    r.on_voice_fx({"level": 0.9, "spike": {"key": "shot:1", "at": 1, "ms": 8000, "strength": 1, "flavours": ["kernel"]}}, 2)
    fx.process(tone(0.02))
    assert fx.spike_left > 0
    r.on_voice_fx({"mode": "clean", "level": 0, "spike": None}, 3)
    fx.process(tone(0.02))
    assert fx.spike_left == 0 and fx.want == 0


def test_a_malformed_answer_changes_nothing(tmp_path):
    r = fx_router(tmp_path)
    r.on_voice_fx({"level": 0.5, "spike": None}, 1)
    for bad in (None, "no", {"level": "high"}, {"level": True}, {"spike": {"key": 3}}, {"spike": {"key": "x", "ms": "long"}}):
        r.on_voice_fx(bad, 1)
    assert r.engine.voicefx.want == 0.5


def test_a_reopened_stream_keeps_his_level(tmp_path):
    r = fx_router(tmp_path)
    r.on_voice_fx({"level": 0.7, "spike": None}, 1)
    old = r.engine.voicefx
    r.engine.mark_failed()
    r.engine.stream.active = False
    assert r.ensure_engine()
    assert r.engine.voicefx is not old
    assert r.engine.voicefx.want == 0.7


def test_the_health_line_carries_it(tmp_path):
    r = fx_router(tmp_path)
    r.on_voice_fx({"level": 0.5, "spike": None}, 1)
    assert "glitches" in r.voicefx_state()
    r.engine.voicefx_failed = True
    assert "FAILED" in r.voicefx_state()


def test_the_desktop_turns_it_on_and_the_macbook_fallback_cant():
    import yaml

    desktop = yaml.safe_load((ROOT / "stagehand/trapped.desktop.yaml").read_text(encoding="utf-8"))
    assert desktop["audio"]["voicefx"] is True
    macbook = yaml.safe_load((ROOT / "stagehand/trapped.macbook.yaml").read_text(encoding="utf-8"))
    assert macbook["audio"]["passthrough"] is False


def test_the_voice_role_is_the_shows():
    import json

    doc = json.loads((ROOT / "core/examples/trapped-in-the-internet/audio.json").read_text(encoding="utf-8"))
    assert any(i.get("role") == "trabolta" for i in doc["inputs"])
