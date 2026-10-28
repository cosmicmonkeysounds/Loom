"""The router's mixer, block by block, with no device."""

from __future__ import annotations

import numpy as np
import pytest

from stagehand.audio.mixer import MAX_VOICES, Mixer, Sidechain, SidechainSource, db_to_lin, lin_to_db
from stagehand.audio.stream import Stream

from test_audio_stream import ArrayFile  # the fake file

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


def test_a_stereo_file_on_a_mono_speaker_plays_the_downmix():
    m = Mixer(1, 2, RATE)
    stereo = np.stack([np.full(200, 0.2), np.full(200, 0.4)], axis=1).astype(np.float32)
    m.play(stereo, {1: 0.0}, fade_in_s=0, layout=[(1,)])
    out = block(m)
    assert np.allclose(out[:, 0], 0.3) and not out[:, 1].any()


def test_a_stereo_file_is_laid_out_per_speaker_not_by_output_parity():
    # Output 3 is a mono hall speaker, 4 / 5 a left / right pair: the pair
    # must get L R (by channel parity it would get R L), the hall the downmix.
    m = Mixer(1, 6, RATE)
    stereo = np.stack([np.full(200, 0.2), np.full(200, 0.4)], axis=1).astype(np.float32)
    m.play(stereo, {3: 0.0, 4: 0.0, 5: 0.0}, fade_in_s=0, layout=[(3,), (4, 5)])
    out = block(m)
    assert np.allclose(out[:, 2], 0.3) and np.allclose(out[:, 3], 0.2) and np.allclose(out[:, 4], 0.4)
    # A pair keeps its own order (`out: [6, 5]` → L on 6).
    m.play(stereo, {5: 0.0, 6: 0.0}, fade_in_s=0, layout=[(6, 5)])
    block(m)  # the first voice is still going on 3–5: look at 6 alone
    m2 = Mixer(1, 6, RATE)
    m2.play(stereo, {5: 0.0, 6: 0.0}, fade_in_s=0, layout=[(6, 5)])
    out = block(m2)
    assert np.allclose(out[:, 5], 0.2) and np.allclose(out[:, 4], 0.4)


def test_a_mono_file_plays_on_every_speaker_layout():
    m = Mixer(1, 3, RATE)
    m.play(tone(200, 0.25), {1: 0.0, 2: 0.0, 3: 0.0}, fade_in_s=0, layout=[(1,), (2, 3)])
    assert np.allclose(block(m), 0.25)


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
    meters = m.take_meters()
    assert meters.limited == 1 and meters.blocks == 1 and meters.peak[0] == pytest.approx(ceiling, rel=1e-3)
    assert meters.inputs == {} and meters.underruns == 0  # no input block yet: output-only
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
        m.play(tone(10), {1: 0.0}, bus="beds")


def test_too_many_voices_never_drop_music_and_fade_the_dropped_sfx():
    m = Mixer(1, 2, RATE)
    dropped: list[str] = []
    m.play(tone(10_000, 0.01), {2: 0.0}, bus="music", fade_in_s=0, done=lambda: dropped.append("music"))
    m.play(tone(10_000, 0.5), {1: 0.0}, fade_in_s=0, done=lambda: dropped.append("oldest"))
    for _ in range(MAX_VOICES - 2):
        m.play(tone(10_000, 0.0), {1: 0.0})
    block(m)
    m.play(tone(10_000, 0.0), {1: 0.0})  # the 33rd
    out = block(m, 20)
    # A 10 ms fade (10 frames here), not a cut.
    assert out[0, 0] == pytest.approx(0.5) and out[5, 0] == pytest.approx(0.25, rel=0.01) and not out[10:, 0].any()
    assert dropped == ["oldest"] and m.active("music") == 1 and np.allclose(out[:, 1], 0.01)


def test_too_many_voices_keep_a_takeover_track_and_drop_the_oldest_short_sfx():
    # The show's songs (dance_song, ceremony_bed) are takeover streams on the
    # sfx bus, so nearly always the oldest sfx voice: a burst of dings over
    # the cap fades a ding, never the song.
    m = Mixer(1, 2, RATE)
    dropped: list[str] = []
    f = ArrayFile(np.full((60_000, 1), 0.3, dtype=np.float32), RATE)
    song = Stream("dance_song.mp3", RATE, opener=lambda p: f, start=False, chunk_s=0.1, buffer_s=2.0, prefill_s=0.1)
    song.fill()
    vid = m.play(song, {2: 0.0}, takeover=True, duck=False, fade_in_s=0, done=lambda: dropped.append("song"))
    m.play(tone(10_000, 0.5), {1: 0.0}, fade_in_s=0, done=lambda: dropped.append("oldest ding"))
    block(m)
    for _ in range(MAX_VOICES - 1):
        m.play(tone(10_000, 0.0), {1: 0.0})  # the 33rd voice is the last of these
    out = block(m, 20)
    assert out[5, 0] == pytest.approx(0.25, rel=0.01) and not out[10:, 0].any()  # the ding's 10 ms fade
    assert dropped == ["oldest ding"] and m.playing(vid) and np.allclose(out[:, 1], 0.3)
    assert not song.finished and not f.closed


def test_when_every_voice_is_a_track_the_cap_still_holds():
    m = Mixer(1, 1, RATE)
    dropped: list[int] = []
    for i in range(MAX_VOICES + 1):
        m.play(tone(10_000, 0.0), {1: 0.0}, takeover=True, done=lambda i=i: dropped.append(i))
    block(m, 20)
    assert dropped == [0] and m.active() == MAX_VOICES


# -- priority ducking (wave 38, C2) ------------------------------------------

PRIORITY = {"trabolta": {"music": -18, "sfx": -8}, "announce": {"music": -15, "sfx": -12}, "clippy": {"music": -12}}
FAST = Sidechain(threshold_db=-45, attack_s=0.1, hold_s=0.2, release_s=0.3)


def ducker(n_in: int = 2, n_out: int = 3, **kw) -> Mixer:
    m = Mixer(n_in, n_out, RATE, sidechain=FAST, priority=PRIORITY, **kw)
    m.set_sources([SidechainSource("trabolta", (1,), tuple(range(1, n_out + 1))), SidechainSource("clippy", (2,), (1,))])
    return m


def talk(m: Mixer, *, trabolta: float = 0.0, clippy: float = 0.0, frames: int = 100) -> np.ndarray:
    ind = np.zeros((frames, m.n_in), dtype=np.float32)
    ind[:, 0], ind[:, 1] = trabolta, clippy
    return block(m, frames, ind)


def test_an_announcement_ducks_music_and_sfx_by_their_own_depths_and_never_the_test_bus():
    m = Mixer(1, 3, RATE, priority=PRIORITY)
    m.play(tone(5000, 0.1), {1: 0.0}, fade_in_s=0)  # a story sound
    m.play(tone(5000, 0.1), {2: 0.0}, bus="music", fade_in_s=0)  # a bed
    m.play(tone(5000, 0.1), {3: 0.0}, bus="test", fade_in_s=0)
    block(m)
    m.play(tone(500, 0.1), {1: -120.0, 2: -120.0, 3: -120.0}, bus="announce", fade_in_s=0)  # silent, everywhere
    for _ in range(5):  # attack 0.3 s
        out = block(m)
    assert out[-1, 0] == pytest.approx(0.1 * db_to_lin(-12), rel=0.02)
    assert out[-1, 1] == pytest.approx(0.1 * db_to_lin(-15), rel=0.02)
    assert out[-1, 2] == pytest.approx(0.1, rel=1e-3)
    assert m.activity("announce") == 1.0
    for _ in range(12):  # it ended; release 1.0 s
        out = block(m)
    assert out[-1, 0] == pytest.approx(0.1, rel=1e-3) and out[-1, 1] == pytest.approx(0.1, rel=1e-3)


def test_an_announcement_ducks_only_the_outputs_it_plays_on():
    m = Mixer(1, 2, RATE, priority=PRIORITY)
    m.play(tone(5000, 0.1), {1: 0.0, 2: 0.0}, bus="music", fade_in_s=0)
    m.play(tone(1000, 0.1), {1: -120.0}, bus="announce", fade_in_s=0)
    for _ in range(5):
        out = block(m)
    assert out[-1, 0] == pytest.approx(0.1 * db_to_lin(-15), rel=0.02) and out[-1, 1] == pytest.approx(0.1, rel=1e-3)


def test_a_timed_announcement_hold_extends_ducks_its_reach_and_releases_slowly():
    m = Mixer(1, 2, RATE, priority=PRIORITY)
    m.set_announce_reach([1])  # audio.json announce.to
    m.play(tone(9000, 0.1), {1: 0.0, 2: 0.0}, fade_in_s=0)
    block(m)
    m.duck_for(0.7)  # the alexa player speaks: no announce voice here
    m.duck_for(0.2)  # a shorter hold never cuts the longer one
    for _ in range(4):
        out = block(m)
    ducked = 0.1 * db_to_lin(-12)
    assert out[-1, 0] == pytest.approx(ducked, rel=0.02) and out[-1, 1] == pytest.approx(0.1, rel=1e-3)
    for _ in range(3):  # still held at 0.7 s
        out = block(m)
    assert out[-1, 0] == pytest.approx(ducked, rel=0.02)
    out = block(m)  # released: on its way up, not back at once
    assert ducked * 1.05 < out[-1, 0] < 0.09
    for _ in range(12):
        out = block(m)
    assert out[-1, 0] == pytest.approx(0.1, rel=1e-3)


def test_trabolta_ducks_deeper_than_clippy_and_the_deepest_claim_wins():
    m = ducker()
    m.play(tone(20_000, 0.1), {1: 0.0, 2: 0.0}, bus="music", fade_in_s=0)
    m.play(tone(20_000, 0.1), {3: 0.0}, fade_in_s=0)  # a story sound
    for _ in range(3):  # Clippy talks (attack 0.1 s): the living room's music only
        out = talk(m, clippy=0.3)
    assert out[-1, 0] == pytest.approx(0.1 * db_to_lin(-12), rel=0.02)
    assert out[-1, 1] == pytest.approx(0.1, rel=1e-3)  # outside Clippy's reach
    assert out[-1, 2] == pytest.approx(0.1, rel=1e-3)  # Clippy never ducks the sfx
    for _ in range(3):  # Trabolta too: everywhere, deeper
        out = talk(m, trabolta=0.3, clippy=0.3)
    assert out[-1, 0] == pytest.approx(0.1 * db_to_lin(-18), rel=0.02)
    assert out[-1, 1] == pytest.approx(0.1 * db_to_lin(-18), rel=0.02)
    assert out[-1, 2] == pytest.approx(0.1 * db_to_lin(-8), rel=0.02)
    meters = m.take_meters()
    assert meters.sources == {"announce": 0.0, "takeover": 0.0, "trabolta": 1.0, "clippy": 1.0}
    assert meters.inputs == {1: pytest.approx(lin_to_db(0.3), abs=0.1), 2: pytest.approx(lin_to_db(0.3), abs=0.1)}


def test_a_sidechain_holds_then_releases_and_ignores_a_quiet_input():
    m = ducker()
    m.play(tone(20_000, 0.1), {2: 0.0}, bus="music", fade_in_s=0)
    for _ in range(3):
        out = talk(m, trabolta=db_to_lin(-50))  # under the −45 dB threshold
    assert out[-1, 1] == pytest.approx(0.1, rel=1e-3) and m.activity("trabolta") == 0.0
    for _ in range(2):
        out = talk(m, trabolta=0.5)
    ducked = 0.1 * db_to_lin(-18)
    assert out[-1, 1] == pytest.approx(ducked, rel=0.02)
    out = talk(m)  # quiet, but held 0.2 s
    out = talk(m)
    assert out[-1, 1] == pytest.approx(ducked, rel=0.02)
    out = talk(m)  # the hold ran out: releasing (0.3 s), not back at once
    assert ducked * 1.2 < out[-1, 1] < 0.09
    for _ in range(4):
        out = talk(m)
    assert out[-1, 1] == pytest.approx(0.1, rel=1e-3)


def test_a_duck_is_a_ramp_not_a_step():
    m = ducker()
    m.play(tone(20_000, 0.1), {2: 0.0}, bus="music", fade_in_s=0)
    talk(m)
    out = talk(m, trabolta=0.5)[:, 1]
    assert np.all(np.diff(out) <= 1e-7) and out[0] > out[-1] and np.abs(np.diff(out)).max() < 0.002


def test_no_duck_voices_the_matrix_and_the_announce_and_test_buses_never_duck():
    m = ducker(n_out=4)
    m.set_routes({(1, 4): 0.0})  # the TV → output 4 (also Trabolta's sidechain)
    m.play(tone(20_000, 0.1), {1: 0.0}, bus="music", fade_in_s=0, duck=False)  # a no_duck track
    m.play(tone(20_000, 0.1), {2: 0.0}, bus="announce", fade_in_s=0)
    m.play(tone(20_000, 0.1), {3: 0.0}, bus="test", fade_in_s=0)
    for _ in range(4):
        out = talk(m, trabolta=0.2)
    assert np.allclose(out[-1, :3], 0.1, rtol=1e-3)
    assert out[-1, 3] == pytest.approx(0.2, rel=1e-3)


def test_a_takeover_silences_the_music_on_its_outputs_only_and_it_comes_back():
    m = Mixer(1, 3, RATE, priority=PRIORITY)
    m.play(tone(30_000, 0.1), {1: 0.0, 2: 0.0}, bus="music", fade_in_s=0)  # a bed on 1 + 2
    m.play(tone(30_000, 0.1), {3: 0.0}, fade_in_s=0)  # a story sound
    block(m)
    rave = m.play(tone(1000, 0.3), {1: 0.0, 3: 0.0}, fade_in_s=0, takeover=True, duck=False)
    for _ in range(6):  # attack 0.5 s
        out = block(m)
    assert out[-1, 0] == pytest.approx(0.3, abs=1e-4)  # the track alone: the bed is silent under it
    assert out[-1, 1] == pytest.approx(0.1, rel=1e-3)  # off the track's outputs: untouched
    assert out[-1, 2] == pytest.approx(0.4, rel=1e-3)  # sfx is not music: takeover leaves it
    assert m.playing(rave)
    for _ in range(5):  # the track ends (1 s); the release is 2 s
        out = block(m)
    assert not m.playing(rave) and 0.0 < out[-1, 0] < 0.1
    for _ in range(20):
        out = block(m)
    assert out[-1, 0] == pytest.approx(0.1, rel=1e-3) and m.activity("takeover") == 0.0


def test_a_takeover_voice_that_ducks_is_never_ducked_by_its_own_claim():
    m = Mixer(1, 1, RATE, priority={**PRIORITY, "takeover": {"sfx": -20}})
    m.play(tone(5000, 0.1), {1: 0.0}, fade_in_s=0)  # a story sound
    m.play(tone(5000, 0.2), {1: 0.0}, fade_in_s=0, takeover=True)
    for _ in range(8):
        out = block(m)
    assert out[-1, 0] == pytest.approx(0.2 + 0.1 * db_to_lin(-20), rel=0.01)


def test_a_source_keeps_its_activity_across_a_new_source_list_and_reserved_names_are_refused():
    m = ducker()
    for _ in range(2):
        talk(m, trabolta=0.5)
    m.set_sources([SidechainSource("trabolta", (1,), (1, 2, 3))])
    talk(m)
    assert m.activity("trabolta") == 1.0 and m.activity("clippy") == 0.0
    with pytest.raises(ValueError, match="reserved"):
        m.set_sources([{"name": "takeover", "inputs": [1], "reach": [1]}])


def test_a_dropped_source_releases_its_duck_instead_of_snapping_off():
    # An audio.json edit during Trabolta's talk drops (or renames) his role:
    # the duck still releases over release_s (0.3 s here), never in a block.
    m = ducker(n_out=2)
    m.play(tone(20_000, 0.1), {1: 0.0, 2: 0.0}, bus="music", fade_in_s=0)
    for _ in range(3):
        out = talk(m, trabolta=0.5)
    ducked = 0.1 * db_to_lin(-18)
    assert out[-1, 0] == pytest.approx(ducked, rel=0.02)
    m.set_sources([])
    out = talk(m)
    assert out[0, 0] == pytest.approx(ducked, rel=0.05)  # no jump at the change
    assert out[-1, 0] < 0.1 * db_to_lin(-6)  # one block on: still well down
    assert m.activity("trabolta") == pytest.approx(2 / 3, abs=0.01)
    for _ in range(3):
        out = talk(m)
    assert out[-1, 0] == pytest.approx(0.1, rel=1e-3) and m.activity("trabolta") == 0.0 and m._ghosts == []


def test_a_shrunk_reach_releases_on_the_outputs_it_left():
    m = ducker(n_out=2)
    m.play(tone(20_000, 0.1), {1: 0.0, 2: 0.0}, bus="music", fade_in_s=0)
    for _ in range(3):
        talk(m, trabolta=0.5)
    m.set_sources([SidechainSource("trabolta", (1,), (1,))])  # now only output 1
    out = talk(m, trabolta=0.5)
    ducked = 0.1 * db_to_lin(-18)
    assert out[-1, 0] == pytest.approx(ducked, rel=0.02)  # still held where it reaches
    assert ducked * 1.1 < out[-1, 1] < 0.1 * db_to_lin(-6)  # releasing where it left
    for _ in range(3):
        out = talk(m, trabolta=0.5)
    assert out[-1, 1] == pytest.approx(0.1, rel=1e-3) and out[-1, 0] == pytest.approx(ducked, rel=0.02)


def test_a_role_can_have_its_own_threshold():
    sc = Sidechain(threshold_db=-45, attack_s=0.1, hold_s=0.2, release_s=0.3, roles=(("clippy", -20.0),))
    m = Mixer(2, 1, RATE, sidechain=sc, priority=PRIORITY)
    m.set_sources([SidechainSource("trabolta", (1,), (1,)), SidechainSource("clippy", (2,), (1,))])
    for _ in range(3):
        talk(m, trabolta=db_to_lin(-30), clippy=db_to_lin(-30))  # the lav's room noise
    assert m.activity("trabolta") == 1.0 and m.activity("clippy") == 0.0
    for _ in range(3):
        talk(m, clippy=db_to_lin(-12))  # Clippy speaks
    assert m.activity("clippy") == 1.0


def test_two_inputs_with_one_role_take_the_louder():
    m = Mixer(2, 1, RATE, sidechain=FAST, priority=PRIORITY)
    m.set_sources([SidechainSource("clippy", (1,), (1,)), SidechainSource("clippy", (2,), (1,))])
    for _ in range(2):
        talk(m, clippy=0.5)  # input 2 only
    assert m.activity("clippy") == 1.0 and m.take_meters().sources["clippy"] == 1.0


def test_an_output_only_stream_meters_nothing_and_never_opens_a_sidechain():
    m = ducker()
    for _ in range(3):
        block(m)
    meters = m.take_meters()
    assert meters.inputs == {} and meters.sources["trabolta"] == 0.0


# -- the trim, the live level, the clock --------------------------------------


def test_the_trim_is_per_output_after_the_mix_and_ramps_over_50_ms():
    m = Mixer(1, 2, RATE)
    m.set_routes({(1, 2): 0.0})
    m.play(tone(5000, 0.5), {1: 0.0}, fade_in_s=0)
    ind = np.full((100, 1), 0.2, dtype=np.float32)
    for _ in range(2):
        block(m, indata=ind)
    m.set_trim({1: -6.0, 2: -12.0})
    out = block(m, indata=ind)
    assert out[0, 0] == pytest.approx(0.5 - 0.5 * (1 - db_to_lin(-6)) / 50, rel=1e-3)  # step 1 of 50
    assert out[25, 0] == pytest.approx(0.5 + (0.5 * db_to_lin(-6) - 0.5) * 26 / 50, rel=1e-3)
    assert np.allclose(out[50:, 0], 0.5 * db_to_lin(-6)) and np.allclose(out[50:, 1], 0.2 * db_to_lin(-12), atol=1e-4)
    m.set_trim({})  # back to 0 dB
    block(m, indata=ind)
    out = block(m, indata=ind)
    assert np.allclose(out[:, 0], 0.5) and np.allclose(out[:, 1], 0.2, atol=1e-4)


def test_a_live_level_ramps_a_playing_voice_by_id_or_tag():
    m = Mixer(1, 2, RATE)
    a = m.play(tone(5000, 0.5), {1: 0.0}, fade_in_s=0, tag="bed")
    m.play(tone(5000, 0.5), {2: 0.0}, fade_in_s=0, tag="other", level_db=-6)
    out = block(m)
    assert np.allclose(out[:, 1], 0.5 * db_to_lin(-6))
    m.level(vid=a, db=-120, ramp_s=0.2)  # 200 frames
    out = block(m)
    assert out[49, 0] == pytest.approx(0.5 * 0.75, rel=1e-3) and out[99, 0] == pytest.approx(0.25, rel=1e-3)
    m.level(tag="bed", db=0, ramp_s=0)  # a new level takes over at once
    assert np.allclose(block(m)[:, 0], 0.5)
    with pytest.raises(ValueError):
        m.level(db=0)


def test_the_frame_clock_positions_and_a_sample_exact_start():
    m = Mixer(1, 1, RATE)
    assert m.frames == 0
    block(m, 64)
    block(m, 64)
    assert m.frames == 128
    first = m.play(np.ones((100, 1), dtype=np.float32) * 0.1, {1: 0.0}, fade_in_s=0)
    second = m.play(np.ones((100, 1), dtype=np.float32) * 0.2, {1: 0.0}, fade_in_s=0, start_at=128 + 100)
    assert m.pos(first) == 0 and m.playing(second)
    out = block(m, 64)
    assert m.pos(first) == 64 and m.pos(second) == 0 and np.allclose(out[:, 0], 0.1)
    out = block(m, 64)  # frames 192..255: the first ends at 228, the second starts there
    assert np.allclose(out[:36, 0], 0.1) and np.allclose(out[36:, 0], 0.2)
    assert m.pos(first) is None and m.pos(second) == 28 and m.frames == 256


def test_a_stopped_voice_that_never_started_is_dropped_at_once():
    m = Mixer(1, 1, RATE)
    calls: list[int] = []
    vid = m.play(tone(100), {1: 0.0}, start_at=10_000, done=lambda: calls.append(1))
    block(m)
    m.stop(vid=vid)
    block(m)
    assert calls == [1] and not m.playing(vid) and m.active() == 0


# -- streamed voices --------------------------------------------------------------


def test_a_streamed_voice_waits_for_its_prefill_plays_counts_underruns_and_closes():
    f = ArrayFile(np.full((300, 2), 0.25, dtype=np.float32), RATE)
    s = Stream("bed.wav", RATE, opener=lambda p: f, start=False, chunk_s=0.1, buffer_s=0.5, prefill_s=0.15)
    done: list[int] = []
    m = Mixer(1, 2, RATE)
    vid = m.play(s, {1: 0.0, 2: 0.0}, bus="music", fade_in_s=0, done=lambda: done.append(1))
    out = block(m)
    assert not out.any() and m.pos(vid) == 0  # not prefilled: waiting, not an underrun
    s._step()  # 100 frames: still short of the 150-frame prefill
    assert not block(m).any()
    s._step()
    out = block(m, 150)
    assert np.allclose(out, 0.25) and m.take_meters().underruns == 0
    out = block(m, 100)  # the worker is behind: 50 real frames, then silence
    assert np.allclose(out[:50], 0.25) and not out[50:].any() and m.take_meters().underruns == 1
    s.fill()
    out = block(m, 200)  # the last 100 frames, then the end
    assert np.allclose(out[:100], 0.25) and not out[100:].any()
    assert done == [1] and not m.playing(vid) and f.closed and m.underruns == 1


def test_stopping_a_streamed_voice_fades_and_closes_it():
    f = ArrayFile(np.full((5000, 1), 0.5, dtype=np.float32), RATE)
    s = Stream("bed.wav", RATE, opener=lambda p: f, start=False, chunk_s=0.1, buffer_s=1.0, prefill_s=0.1)
    s.fill()
    m = Mixer(1, 1, RATE)
    m.play(s, {1: 0.0}, bus="music", fade_in_s=0, tag="bed")
    block(m)
    m.stop(tag="bed", fade_s=0.05)
    out = block(m)
    assert out[25, 0] == pytest.approx(0.25, abs=0.02) and not out[60:].any()
    assert m.active() == 0 and s.finished and f.closed


def test_a_scheduled_stop_starts_its_fade_on_the_frame_a_crossfade_meets():
    # The soundtrack's crossfade: the next track `start_at` S fades in while
    # the current one, stopped `at` S, fades out; the two sum to the level.
    m = Mixer(1, 1, RATE)
    a = m.play(tone(1000, 0.4), {1: 0.0}, fade_in_s=0)
    block(m)  # frames 0–99
    m.play(tone(1000, 0.4), {1: 0.0}, fade_in_s=0.2, start_at=150)
    m.stop(vid=a, fade_s=0.2, at=150)
    out = np.concatenate([block(m) for _ in range(4)])[:, 0]  # frames 100–499
    assert np.allclose(out[:50], 0.4)  # before S: the first alone, untouched
    assert np.allclose(out[50:250], 0.4, atol=0.005)  # through the fade: constant sum
    assert np.allclose(out[260:], 0.4) and m.playing(a) is False


def test_a_shorter_stop_carries_on_from_the_fade_already_running():
    m = Mixer(1, 1, RATE)
    vid = m.play(tone(5000, 0.5), {1: 0.0}, fade_in_s=0)
    block(m)
    m.stop(vid=vid, fade_s=1.0)  # 1 s fade …
    half = block(m)[:, 0]  # … 10 % of it run
    m.stop(vid=vid, fade_s=0.1)  # then a 0.1 s stop: no jump back up
    after = block(m)[:, 0]
    assert after[0] <= half[-1] + 1e-6 and after[-1] == pytest.approx(0.0, abs=0.01)
    longer = m.play(tone(5000, 0.5), {1: 0.0}, fade_in_s=0)
    block(m)
    m.stop(vid=longer, fade_s=0.1)
    m.stop(vid=longer, fade_s=5.0)  # a longer stop never stretches a fade
    block(m)
    assert not m.playing(longer)
