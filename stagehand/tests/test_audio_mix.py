"""The house mixer on the router (wave 40, C3): the level sums pinned to
`core/src/house-mixer.ts`, the gain table on the show's audio.json, and the
mixer's strips, input gains, sidechain skip and live meters, block by block."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from stagehand.audio.mix import MixGains, clamp_mix_db, effective_db, input_source_id, mix_gains, mix_levels_of, parse_mix_key
from stagehand.audio.mixer import Mixer, Sidechain, SidechainSource, db_to_lin, lin_to_db
from stagehand.audio.routing import parse_audio

HERE = Path(__file__).parent
FIXTURE_COPY = HERE / "fixtures" / "house-mixer.json"
FIXTURE_HOME = HERE.parent.parent / "core" / "test" / "fixtures" / "house-mixer.json"
FIXTURE = json.loads(FIXTURE_COPY.read_text())
SHOW_AUDIO = HERE.parent.parent / "core" / "examples" / "trapped-in-the-internet" / "audio.json"
RATE = 1000


def show_doc():
    if not SHOW_AUDIO.exists():
        pytest.skip("the show folder is not beside this stagehand tree")
    return parse_audio(json.loads(SHOW_AUDIO.read_text()))


def lv(db: float = 0.0, mute: bool = False) -> dict:
    return {"db": db, "mute": mute}


# -- the mirror ----------------------------------------------------------------


def test_the_fixture_copy_matches_core():
    if not FIXTURE_HOME.exists():
        pytest.skip("core/ is not beside this stagehand tree")
    assert FIXTURE_COPY.read_bytes() == FIXTURE_HOME.read_bytes(), "re-copy core/test/fixtures/house-mixer.json"


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
def test_effective_db_matches_core(case):
    t = case["target"]
    got = effective_db(case["levels"], t["source"], t.get("room"), t.get("speaker"))
    if case["want"] is None:
        assert got is None
    else:
        assert got == pytest.approx(case["want"])
    # The parsed pairs sum the same as the wire's objects.
    again = effective_db(mix_levels_of(case["levels"]), t["source"], t.get("room"), t.get("speaker"))
    assert again == got


def test_keys_and_levels_are_read_like_core():
    assert parse_mix_key("master") == ("all", None, None)
    assert parse_mix_key("src:in:trabolta") == ("all", None, "in:trabolta")
    assert parse_mix_key("room:desktop/src:music") == ("room", "desktop", "music")
    assert parse_mix_key("spk:living-sub") == ("speaker", "living-sub", None)
    for bad in ("src:bogus", "room:", "room:a/b", "spk:", "speaker:x", "room:a/src:in:", 3):
        assert parse_mix_key(bad) is None, bad
    assert clamp_mix_db(-61) == -60 and clamp_mix_db(11) == 10 and clamp_mix_db(-3.25) == -3.0 and clamp_mix_db(-3.3) == -3.5
    assert clamp_mix_db(float("nan")) == 0 and clamp_mix_db(True) == 0
    got = mix_levels_of({"master": lv(-3.2), "src:sfx": lv(0), "bogus": lv(-6), "src:music": "loud", "room:hall": {"mute": True}})
    assert got == {"master": (-3.0, False), "room:hall": (0.0, True)}
    assert mix_levels_of(None) == {} and mix_levels_of([1]) == {}


def test_an_input_source_is_its_role_else_its_channel():
    doc = show_doc()
    assert [input_source_id(i) for i in doc.input_list[:4]] == ["in:clippy", "in:2", "in:trabolta", "in:4"]


# -- the gain table on the show's audio.json -------------------------------------


def test_mix_gains_on_the_show_rig():
    doc = show_doc()
    assert mix_gains({}, doc).unity()
    # The sub has its own speaker on out 1; living L / R are on 9 / 10.
    g = mix_gains({"spk:living-sub": lv(-6), "room:desktop/src:music": lv(-3), "src:sfx": lv(0, True)}, doc)
    music = g.strips["music"]
    assert len(music) == 12
    assert music[0] == pytest.approx(db_to_lin(-9))  # the sub: room −3 + speaker −6
    assert music[8] == pytest.approx(db_to_lin(-3)) and music[9] == pytest.approx(db_to_lin(-3))
    assert music[2] == music[3] == music[7] == 1.0  # the kitchen, the optical drive
    assert music[1] == music[10] == 1.0  # no speaker: master + src only
    assert g.strips["tracks"][0] == pytest.approx(db_to_lin(-6)) and g.strips["tracks"][8] == 1.0
    assert all(x == 0.0 for x in g.strips["sfx"])  # muted everywhere, the spare outputs too
    assert g.silent == frozenset()


def test_a_muted_room_silences_its_outputs_only_and_inputs_follow_the_mix():
    doc = show_doc()
    g = mix_gains({"room:start-bar": lv(0, True), "src:in:trabolta": lv(-6)}, doc)
    assert [o + 1 for o, x in enumerate(g.strips["music"]) if x == 0.0] == [3, 4]
    tv = g.inputs[3]
    assert tv[2] == tv[3] == 0.0  # the kitchen is muted, the TV there too
    assert tv[8] == pytest.approx(db_to_lin(-6)) and tv[7] == pytest.approx(db_to_lin(-6))
    assert g.inputs[1][8] == 1.0 and g.inputs[1][2] == 0.0  # a room mute is every source there
    # A room mute leaves the TV's ducking alone; a src mute (or master) stops it.
    assert g.silent == frozenset()
    assert mix_gains({"src:in:trabolta": lv(0, True)}, doc).silent == {"trabolta"}
    assert mix_gains({"master": lv(-60)}, doc).silent == {"trabolta", "clippy"}


def test_an_output_wired_to_two_speakers_takes_the_loudest():
    doc = parse_audio(
        {
            "version": 1,
            "device": {"name": "x", "inputs": 1, "outputs": 2},
            "speakers": [{"id": "a", "room": "r1", "out": [1]}, {"id": "b", "room": "r2", "out": [1]}],
        }
    )
    assert mix_gains({"room:r1": lv(-12), "room:r2": lv(-3)}, doc).strips["music"][0] == pytest.approx(db_to_lin(-3))
    assert mix_gains({"room:r1": lv(0, True)}, doc).strips["music"][0] == 1.0
    assert mix_gains({"room:r1": lv(0, True), "spk:b": lv(0, True)}, doc).strips["music"][0] == 0.0


# -- the mixer's strips -----------------------------------------------------------


def tone(frames: int, value: float = 0.1) -> np.ndarray:
    return np.full((frames, 1), value, dtype=np.float32)


def block(m: Mixer, frames: int = 100, indata: np.ndarray | None = None) -> np.ndarray:
    out = np.zeros((frames, m.n_out), dtype=np.float32)
    m.process(indata, out)
    return out


def test_a_muted_room_silences_a_bed_there_and_nowhere_else_and_never_a_test():
    doc = show_doc()
    m = Mixer(10, 12, RATE)
    block(m)  # running: a mix change ramps from here
    every = {o: 0.0 for o in (1, 3, 4, 8, 9, 10)}
    m.play(tone(20_000), every, bus="music", fade_in_s=0)
    m.play(tone(20_000, 0.05), {3: 0.0, 9: 0.0}, bus="test", fade_in_s=0)
    out = block(m)
    assert out[-1, 2] == pytest.approx(0.15) and out[-1, 8] == pytest.approx(0.15)
    m.set_mix(mix_gains({"room:start-bar": lv(0, True)}, doc, 12))
    out = block(m, 20)  # the ramp (TRIM_S = 50 ms): on its way down, not a step
    assert 0.05 < out[-1, 2] < 0.15
    for _ in range(2):
        out = block(m)
    assert out[-1, 2] == pytest.approx(0.05) and out[-1, 3] == 0.0  # the kitchen: only the test is left
    assert out[-1, 8] == pytest.approx(0.15) and out[-1, 0] == pytest.approx(0.1) and out[-1, 7] == pytest.approx(0.1)


def test_the_strips_move_apart_and_the_subs_own_fader():
    doc = show_doc()
    m = Mixer(10, 12, RATE)
    m.set_mix(mix_gains({"src:tracks": lv(-6), "spk:living-sub": lv(-12), "src:announce": lv(0, True)}, doc, 12))
    block(m)  # a fresh stream starts at the mix
    m.play(tone(5000), {1: 0.0, 9: 0.0}, bus="music", fade_in_s=0)
    m.play(tone(5000), {3: 0.0}, bus="sfx", strip="tracks", fade_in_s=0)
    m.play(tone(5000), {4: 0.0}, bus="sfx", fade_in_s=0)
    m.play(tone(5000), {8: 0.0}, bus="announce", fade_in_s=0)
    out = block(m)
    assert out[-1, 0] == pytest.approx(0.1 * db_to_lin(-12), rel=1e-3)  # the sub
    assert out[-1, 8] == pytest.approx(0.1)
    assert out[-1, 2] == pytest.approx(0.1 * db_to_lin(-6), rel=1e-3)  # a track
    assert out[-1, 3] == pytest.approx(0.1)  # other sfx
    assert out[-1, 7] == 0.0  # announcements muted
    with pytest.raises(ValueError):
        m.play(tone(10), {1: 0.0}, strip="nope")


def test_the_tv_route_follows_its_source():
    doc = show_doc()
    m = Mixer(10, 12, RATE, smooth_s=0.01)
    m.set_routes({(3, o): 0.0 for o in (3, 4, 8, 9, 10)})
    ind = np.zeros((100, 10), dtype=np.float32)
    ind[:, 2] = 0.4
    for _ in range(3):
        out = block(m, 100, ind)
    assert out[-1, 8] == pytest.approx(0.4, rel=1e-3) and out[-1, 0] == 0.0
    m.set_mix(mix_gains({"src:in:trabolta": lv(-6), "room:start-bar/src:in:trabolta": lv(0, True)}, doc, 12))
    for _ in range(3):
        out = block(m, 100, ind)
    assert out[-1, 8] == pytest.approx(0.4 * db_to_lin(-6), rel=1e-3)
    assert abs(out[-1, 2]) < 1e-4  # the kitchen's TV muted
    # The routes still replace the matrix under the mix (set_routes keeps working).
    m.set_routes({(3, 9): -6.0})
    for _ in range(3):
        out = block(m, 100, ind)
    assert out[-1, 8] == pytest.approx(0.4 * db_to_lin(-12), rel=1e-3) and abs(out[-1, 9]) < 1e-4
    m.set_mix(None)
    for _ in range(3):
        out = block(m, 100, ind)
    assert out[-1, 8] == pytest.approx(0.4 * db_to_lin(-6), rel=1e-3)


def test_muting_the_tv_everywhere_stops_its_duck():
    doc = show_doc()
    fast = Sidechain(threshold_db=-45, attack_s=0.1, hold_s=0.2, release_s=0.3)
    m = Mixer(10, 12, RATE, sidechain=fast, priority={"trabolta": {"music": -18}})
    m.set_sources([SidechainSource("trabolta", (3,), tuple(range(1, 13)))])
    m.play(tone(20_000), {9: 0.0}, bus="music", fade_in_s=0)
    ind = np.zeros((100, 10), dtype=np.float32)
    ind[:, 2] = 0.4
    for _ in range(3):
        out = block(m, 100, ind)
    assert out[-1, 8] == pytest.approx(0.1 * db_to_lin(-18), rel=0.02)
    # A room mute of the TV leaves its ducking alone.
    m.set_mix(mix_gains({"room:desktop/src:in:trabolta": lv(0, True)}, doc, 12))
    for _ in range(3):
        out = block(m, 100, ind)
    assert m.activity("trabolta") == 1.0
    m.set_mix(mix_gains({"src:in:trabolta": lv(0, True)}, doc, 12))
    out = block(m, 100, ind)
    assert 0.0 < m.activity("trabolta") < 1.0  # releasing, never a snap
    for _ in range(4):
        out = block(m, 100, ind)
    assert m.activity("trabolta") == 0.0 and out[-1, 8] == pytest.approx(0.1, rel=1e-3)


def test_live_meters_are_their_own():
    m = Mixer(2, 3, RATE)
    block(m)  # running: the mix below ramps
    m.take_meters()
    first = m.take_live()  # starts the per-strip sums
    assert first.inputs == {} and not first.outputs.any()
    m.play(tone(5000, 0.2), {1: 0.0, 2: 0.0}, bus="music", fade_in_s=0)
    m.play(tone(5000, 0.1), {2: 0.0}, bus="sfx", fade_in_s=0)
    m.play(tone(5000, 0.05), {2: 0.0}, bus="sfx", fade_in_s=0)  # two of a strip sum
    m.set_mix(MixGains(strips={"music": (0.5, 1.0, 1.0)}))
    ind = np.zeros((100, 2), dtype=np.float32)
    ind[:, 1] = 0.25
    for _ in range(3):
        block(m, 100, ind)
    live = m.take_live()
    assert live.outputs[0] == pytest.approx(0.2, rel=0.02)  # the first block, as the mix began its ramp
    assert live.outputs[1] == pytest.approx(0.35, rel=1e-3)
    assert live.strips["music"][1] == pytest.approx(0.2, rel=1e-3) and live.strips["sfx"][1] == pytest.approx(0.15, rel=1e-3)
    assert not live.strips["tracks"].any() and not live.strips["sfx"][0]
    assert live.inputs == {1: -120.0, 2: pytest.approx(lin_to_db(0.25), abs=0.1)}
    assert "announce" in live.sources
    block(m, 100, ind)
    again = m.take_live()
    assert again.outputs[0] == pytest.approx(0.1, rel=1e-3) and again.strips["music"][0] == pytest.approx(0.1, rel=1e-3)
    # The health line's meters never saw a take: they hold every block.
    h = m.take_meters()
    assert h.peak[1] == pytest.approx(0.35, rel=1e-3) and h.blocks == 4 and h.inputs[2] == pytest.approx(lin_to_db(0.25), abs=0.1)
    # Nobody reads the live meters: the per-strip sums stop.
    for _ in range(25):
        block(m)
    assert not m._live_on
