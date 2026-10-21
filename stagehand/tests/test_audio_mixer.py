"""The router's mixer, block by block, with no device."""

from __future__ import annotations

import numpy as np
import pytest

from stagehand.audio.mixer import MAX_VOICES, Mixer, db_to_lin, lin_to_db

RATE = 1000  # small blocks keep the arithmetic readable


def block(m: Mixer, frames: int = 100, indata: np.ndarray | None = None) -> np.ndarray:
    out = np.zeros((frames, m.n_out), dtype=np.float32)
    m.process(indata, out)
    return out


def tone(frames: int, value: float = 0.5, channels: int = 1) -> np.ndarray:
    return np.full((frames, channels), value, dtype=np.float32)


def test_db_conversions():
    assert db_to_lin(0) == 1.0 and db_to_lin(-200) == 0.0
    assert lin_to_db(1.0) == 0.0 and lin_to_db(0) == -120.0
    assert db_to_lin(-6) == pytest.approx(0.501, abs=1e-3)


def test_a_mono_voice_reaches_only_its_outputs_at_their_gains():
    m = Mixer(2, 4, RATE)
    m.play(tone(300), {1: 0.0, 3: -6.0}, fade_in_s=0)
    out = block(m)
    assert np.allclose(out[:, 0], 0.5)
    assert np.allclose(out[:, 2], 0.5 * db_to_lin(-6))
    assert not out[:, 1].any() and not out[:, 3].any()


def test_a_stereo_voice_spreads_left_right_across_its_outputs_in_channel_order():
    m = Mixer(2, 4, RATE)
    stereo = np.stack([np.full(200, 0.2), np.full(200, 0.4)], axis=1).astype(np.float32)
    m.play(stereo, {4: 0.0, 2: 0.0}, fade_in_s=0)
    out = block(m)
    assert np.allclose(out[:, 1], 0.2) and np.allclose(out[:, 3], 0.4)


def test_outputs_past_the_device_are_dropped():
    m = Mixer(2, 2, RATE)
    m.play(tone(100), {1: 0.0, 9: 0.0}, fade_in_s=0)
    assert np.allclose(block(m)[:, 0], 0.5)


def test_voices_sum_end_and_call_done_once():
    m = Mixer(1, 1, RATE)
    calls: list[str] = []
    m.play(tone(150, 0.1), {1: 0.0}, fade_in_s=0, done=lambda: calls.append("a"))
    m.play(tone(50, 0.2), {1: 0.0}, fade_in_s=0, done=lambda: calls.append("b"))
    first = block(m)
    assert np.allclose(first[:50, 0], 0.3) and np.allclose(first[50:, 0], 0.1)
    assert calls == ["b"] and m.active() == 1
    second = block(m)
    assert np.allclose(second[:50, 0], 0.1) and not second[50:, 0].any()
    assert calls == ["b", "a"] and m.active() == 0
    block(m)
    assert calls == ["b", "a"]


def test_fade_in_ramps_from_silence():
    m = Mixer(1, 1, RATE)
    m.play(tone(200, 1.0 * 0.5), {1: 0.0}, fade_in_s=0.1)  # 100 frames
    out = block(m)[:, 0]
    assert out[0] == 0.0 and out[50] == pytest.approx(0.25, abs=0.01) and np.all(np.diff(out) >= -1e-7)


def test_stop_fades_out_by_tag_and_leaves_the_rest():
    m = Mixer(1, 2, RATE)
    m.play(tone(1000), {1: 0.0}, tag="dance_song", fade_in_s=0)
    m.play(tone(1000), {2: 0.0}, tag="zip", fade_in_s=0)
    block(m)
    m.stop(tag="dance_song", fade_s=0.05)  # 50 frames
    out = block(m)
    assert out[0, 0] == pytest.approx(0.5) and out[25, 0] == pytest.approx(0.25, abs=0.02)
    assert not out[60:, 0].any() and np.allclose(out[:, 1], 0.5)
    assert m.active() == 1


def test_stop_with_no_filter_stops_every_voice():
    m = Mixer(1, 1, RATE)
    for _ in range(3):
        m.play(tone(1000), {1: -20.0})
    m.stop(fade_s=0)
    block(m)
    assert m.active() == 0


def test_an_announcement_ducks_the_sfx_bus_only():
    m = Mixer(1, 2, RATE, duck_db=-12, duck_s=0.1)
    m.play(tone(2000, 0.1), {1: 0.0}, fade_in_s=0)  # a bed
    m.play(tone(2000, 0.1), {2: 0.0}, bus="test", fade_in_s=0)
    block(m)
    m.play(tone(300, 0.1), {2: -60.0}, bus="announce", fade_in_s=0)
    out = block(m)
    out = block(m)
    assert out[-1, 0] == pytest.approx(0.1 * db_to_lin(-12), rel=0.05)
    assert out[-1, 1] == pytest.approx(0.1, rel=0.01)
    for _ in range(4):  # the announcement ends; the bed comes back
        out = block(m)
    assert out[-1, 0] == pytest.approx(0.1, rel=0.02)


def test_the_matrix_passes_inputs_through_and_smooths_a_change():
    m = Mixer(2, 3, RATE, smooth_s=0.1)
    m.set_routes({(1, 2): 0.0, (2, 3): -6.0})
    indata = np.ones((100, 2), dtype=np.float32) * 0.5
    first = block(m, indata=indata)
    assert first[0, 1] == 0.0 and first[-1, 1] > 0.4  # ramped, not stepped
    out = block(m, indata=indata)
    assert np.allclose(out[:, 1], 0.5, atol=1e-3)
    assert np.allclose(out[:, 2], 0.5 * db_to_lin(-6), atol=1e-3)
    assert not out[:, 0].any()


def test_passthrough_off_mutes_the_matrix_but_keeps_the_routes():
    m = Mixer(1, 1, RATE, smooth_s=0.01)
    m.set_routes({(1, 1): 0.0})
    indata = np.full((100, 1), 0.5, dtype=np.float32)
    block(m, indata=indata)
    m.set_passthrough(False)
    block(m, indata=indata)
    assert not block(m, indata=indata).any()
    m.set_passthrough(True)
    block(m, indata=indata)
    assert np.allclose(block(m, indata=indata), 0.5, atol=1e-3)


def test_the_limiter_holds_the_ceiling_and_releases():
    m = Mixer(1, 2, RATE, limit_db=-6, release_s=0.2)
    ceiling = db_to_lin(-6)
    m.play(tone(300, 0.9), {1: 0.0}, fade_in_s=0)
    m.play(tone(2000, 0.1), {2: 0.0}, fade_in_s=0)
    out = block(m)
    assert np.abs(out[:, 0]).max() <= ceiling + 1e-6
    assert np.allclose(out[:, 1], 0.1)  # another room is untouched
    peak, limited, blocks = m.take_meters()
    assert limited == 1 and blocks == 1 and peak[0] == pytest.approx(ceiling, rel=1e-3)
    for _ in range(3):
        block(m)
    assert m.limiter[0] > ceiling / 0.9  # releasing once the loud voice ended


def test_hard_clip_is_the_last_word():
    m = Mixer(1, 1, RATE, limit_db=0)
    for _ in range(4):
        m.play(tone(100, 0.9), {1: 0.0}, fade_in_s=0)
    assert np.abs(block(m)).max() <= 1.0


def test_too_many_voices_drop_the_oldest_sfx():
    m = Mixer(1, 1, RATE)
    dropped: list[int] = []
    m.play(tone(10_000), {1: -40.0}, bus="announce")
    for i in range(MAX_VOICES):
        m.play(tone(10_000), {1: -40.0}, done=lambda i=i: dropped.append(i))
    block(m)
    assert m.active() == MAX_VOICES and dropped == [0] and m.active("announce") == 1


def test_master_gain_and_an_unknown_bus():
    m = Mixer(1, 1, RATE)
    m.set_master_db(-6)
    m.play(tone(100, 0.5), {1: 0.0}, fade_in_s=0)
    assert block(m)[0, 0] == pytest.approx(0.5 * db_to_lin(-6))
    with pytest.raises(ValueError):
        m.play(tone(10), {1: 0.0}, bus="music")
