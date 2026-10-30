"""The footsteps in the real house (wave 49, C4): the takes, the walkers' pace
and voices, the stream that feeds them — a fake mixer, a fake server. The
constants are pinned to `house/src/footsteps.ts`."""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from stagehand.audio.footsteps import (
    FILE_MAX_S,
    FOOTSTEP_PACE_MAX_S,
    FOOTSTEP_PACE_MIN_S,
    FOOTSTEP_STRIDE_M,
    FOOTSTEP_SURFACES,
    FOOTSTEPS_STALE_MS,
    MATCH_S,
    PACE_JITTER,
    STEP_GAIN_DB,
    STEP_TAG,
    STEP_VOICES,
    TAKE_PEAK_DB,
    TAKE_RMS_DB,
    STEP_GAP_S,
    TAKES,
    WALKERS_TICK_S,
    FootstepBank,
    StepRig,
    Walkers,
    step_outputs,
    step_pace_s,
)
from stagehand.audio.mix import mix_gains
from stagehand.audio.mixer import MAX_VOICES, Mixer, db_to_lin
from stagehand.audio.module import WALKERS_PATH
from stagehand.audio.routing import parse_audio
from stagehand.modapi import ModApiError, ModClient, run_stream

from test_audio_router import FakeMod, answer, router, run, stream_of

HOUSE_TS = Path(__file__).parents[2] / "house" / "src" / "footsteps.ts"
RATE = 8000
STALE_S = FOOTSTEPS_STALE_MS / 1000


# -- the mirror ------------------------------------------------------------------


def house_ts() -> str:
    if not HOUSE_TS.exists():
        pytest.skip("house/ is not beside this stagehand tree")
    return HOUSE_TS.read_text(encoding="utf-8")


def ts_number(text: str, name: str) -> float:
    found = re.search(rf"export const {name} = ([0-9_.]+);", text)
    assert found is not None, name
    return float(found.group(1).replace("_", ""))


def test_the_constants_are_the_houses():
    text = house_ts()
    assert ts_number(text, "FOOTSTEP_STRIDE_M") == FOOTSTEP_STRIDE_M
    assert ts_number(text, "FOOTSTEP_PACE_MIN_S") == FOOTSTEP_PACE_MIN_S
    assert ts_number(text, "FOOTSTEP_PACE_MAX_S") == FOOTSTEP_PACE_MAX_S
    assert ts_number(text, "FOOTSTEPS_STALE_MS") == FOOTSTEPS_STALE_MS
    surfaces = re.search(r"export const FOOTSTEP_SURFACES = \[(.*?)\] as const;", text)
    assert surfaces is not None and tuple(re.findall(r'"(\w+)"', surfaces.group(1))) == FOOTSTEP_SURFACES


def test_the_router_ticks_well_inside_the_jitter_at_the_fastest_pace():
    assert WALKERS_TICK_S < PACE_JITTER * FOOTSTEP_PACE_MIN_S


@pytest.mark.parametrize(
    "speed, want",
    [(0, 0.9), (-1, 0.9), (None, 0.9), (0.25, 0.9), (0.8, 0.9), (0.9, 0.8), (1.2, 0.6), (1.4, 0.72 / 1.4), (2.4, 0.3), (3, 0.3), (6, 0.3)],
)
def test_step_pace_mirrors_steppaces(speed, want):
    assert step_pace_s(speed) == pytest.approx(want)


# -- the bank --------------------------------------------------------------------


@pytest.fixture(scope="module")
def bank48():
    return FootstepBank("/nonexistent-sounds", 48000)


@pytest.fixture(scope="module")
def bank():
    return FootstepBank("/nonexistent-sounds", RATE)


def every_take(b: FootstepBank):
    for surface in FOOTSTEP_SURFACES:
        for n in range(b.takes(surface)):
            for muffled in (False, True):
                yield surface, n, muffled, b.take(surface, n, muffled=muffled)


def mono(x: np.ndarray) -> np.ndarray:
    return x[:, 0].astype(np.float64)


def db(x: float) -> float:
    return 20 * float(np.log10(max(x, 1e-12)))


def band_energy(x: np.ndarray, rate: int, lo: float, hi: float) -> float:
    spec = np.abs(np.fft.rfft(x, n=1 << 16)) ** 2
    f = np.fft.rfftfreq(1 << 16, 1 / rate)
    return float(spec[(f >= lo) & (f < hi)].sum())


def loudest_rms(x: np.ndarray, rate: int) -> float:
    n = int(MATCH_S * rate)
    power = np.cumsum(np.r_[0.0, x**2])
    return float(np.sqrt((power[n:] - power[:-n]).max() / n))


def test_every_surface_has_its_takes_and_a_muffled_copy_of_each(bank48):
    assert TAKES >= 6
    assert FOOTSTEP_SURFACES == ("floor", "tile", "grass")
    for surface in FOOTSTEP_SURFACES:
        assert bank48.takes(surface) == TAKES
    for _, _, _, x in every_take(bank48):
        assert x.ndim == 2 and x.shape[1] == 1 and x.dtype == np.float32 and np.isfinite(x).all()


def test_a_take_is_short_and_neither_starts_nor_ends_on_a_click(bank48):
    for surface, n, muffled, x in every_take(bank48):
        where = (surface, n, muffled)
        assert 0.1 <= len(x) / 48000 <= 0.3, where  # a voice's life: never pressures MAX_VOICES
        assert abs(x[0, 0]) < 1e-3 and abs(x[-1, 0]) < 1e-3, where
        assert np.abs(x[:: 480]).max() > 0, where


def test_the_takes_are_level_matched_and_under_the_peak(bank48):
    for surface in FOOTSTEP_SURFACES:
        levels = [loudest_rms(mono(bank48.take(surface, n)), 48000) for n in range(TAKES)]
        assert db(max(levels)) - db(min(levels)) < 0.5, surface
        assert TAKE_RMS_DB - 4 < db(np.mean(levels)) <= TAKE_RMS_DB + 0.1, surface
    for _, _, _, x in every_take(bank48):
        assert db(float(np.abs(x).max())) <= TAKE_PEAK_DB + 0.2


def test_a_step_is_a_thump_and_a_scuff_not_a_click(bank48):
    floor = mono(bank48.take("floor", 0))
    whole = band_energy(floor, 48000, 20, 20000)
    assert band_energy(floor, 48000, 60, 250) / whole > 0.5  # the weight is low…
    assert 1e-4 < band_energy(floor, 48000, 1200, 4000) / whole < 0.05  # …with a scuff on top

    def rms(x: np.ndarray, a_ms: float, b_ms: float) -> float:
        return float(np.sqrt(np.mean(x[int(a_ms * 48) : int(b_ms * 48)] ** 2)))

    # Heel, then the ball of the foot: above 1 kHz there are two events, the
    # second clearly after the first has died. A click has one, in 5 ms.
    top = np.fft.irfft(np.fft.rfft(floor) * (np.fft.rfftfreq(len(floor), 1 / 48000) > 1000), len(floor))
    assert rms(top, 50, 90) > 2 * rms(top, 35, 48)
    assert rms(floor, 60, 80) > 0.02 * rms(floor, 0, 20)


def test_the_surfaces_sound_apart(bank48):
    def top_share(surface: str, lo: float = 2000) -> float:
        x = np.concatenate([mono(bank48.take(surface, n)) for n in range(TAKES)])
        return band_energy(x, 48000, lo, 20000) / band_energy(x, 48000, 20, 20000)

    assert top_share("tile") > 3 * top_share("floor")  # hard and bright
    assert top_share("grass") > 3 * top_share("floor")  # the swish

    def late_top(surface: str) -> float:
        """What is left above 1 kHz, 100 ms after the heel."""
        x = mono(bank48.take(surface, 0))
        top = np.fft.irfft(np.fft.rfft(x) * (np.fft.rfftfreq(len(x), 1 / 48000) > 1000), len(x))
        return float(np.sqrt(np.mean(top[int(0.1 * 48000) : int(0.13 * 48000)] ** 2)))

    assert late_top("grass") > 4 * late_top("floor")  # the swish lasts
    assert len(bank48.take("tile", 0)) < len(bank48.take("floor", 0)) < len(bank48.take("grass", 0))


def test_the_two_feet_are_not_quite_the_same_foot(bank48):
    def heel_hz(n: int) -> float:
        x = mono(bank48.take("floor", n))[: int(0.05 * 48000)]
        spec = np.abs(np.fft.rfft(x, n=1 << 16))
        f = np.fft.rfftfreq(1 << 16, 1 / 48000)
        band = (f > 50) & (f < 140)
        return float(f[band][spec[band].argmax()])

    assert np.mean([heel_hz(n) for n in (1, 3, 5)]) != pytest.approx(np.mean([heel_hz(n) for n in (0, 2, 4)]), abs=0.1)


def test_a_muffled_step_has_lost_its_top_end_and_kept_its_thump(bank48):
    for surface in FOOTSTEP_SURFACES:
        for n in range(TAKES):
            clear, muffled = mono(bank48.take(surface, n)), mono(bank48.take(surface, n, muffled=True))
            assert band_energy(muffled, 48000, 1000, 20000) < band_energy(clear, 48000, 1000, 20000) * 10 ** (-25 / 10), (surface, n)
            low_clear, low_muffled = band_energy(clear, 48000, 40, 200), band_energy(muffled, 48000, 40, 200)
            assert abs(10 * np.log10(low_muffled / low_clear)) < 2.0, (surface, n)


def test_the_takes_are_deterministic_per_seed():
    a, b, c = FootstepBank("/nonexistent-sounds", RATE, seed=7), FootstepBank("/nonexistent-sounds", RATE, seed=7), FootstepBank("/nonexistent-sounds", RATE, seed=8)
    for surface, n, muffled, x in every_take(a):
        assert x.tobytes() == b.take(surface, n, muffled=muffled).tobytes()
        assert x.tobytes() != c.take(surface, n, muffled=muffled).tobytes()


def test_no_two_takes_are_alike(bank48):
    for surface in FOOTSTEP_SURFACES:
        takes = [bank48.take(surface, n).tobytes() for n in range(TAKES)]
        assert len(set(takes)) == TAKES


def test_the_bank_is_at_the_devices_rate(bank48):
    other = FootstepBank("/nonexistent-sounds", 44100)
    assert other.rate == 44100
    for surface, n, muffled, x in every_take(other):
        assert len(x) == pytest.approx(len(bank48.take(surface, n, muffled=muffled)) * 44100 / 48000, abs=1)
    # A rate too low for the scuff still builds: the tests' own 8 kHz.
    assert FootstepBank("/nonexistent-sounds", RATE).take("tile", 0).dtype == np.float32


def test_a_real_file_outranks_a_take(tmp_path, bank48):
    t = np.arange(48000) / 48000
    stereo = np.stack([0.5 * np.sin(2 * np.pi * 300 * t), 0.1 * np.sin(2 * np.pi * 300 * t)], axis=1)
    sf.write(str(tmp_path / "footstep_floor_2.wav"), stereo, 48000)
    sf.write(str(tmp_path / "footstep_grass_6.flac"), stereo[:9600], 48000)  # the bank finds it as `sound X` does
    sf.write(str(tmp_path / "footstep_floor_99.wav"), stereo, 48000)  # no such take: never read
    b = FootstepBank(tmp_path, 48000)
    assert b.real == ["floor_2", "grass_6"]
    took = b.take("floor", 1)
    assert took.shape[1] == 1 and took.tobytes() != bank48.take("floor", 1).tobytes()
    assert len(took) == int(FILE_MAX_S * 48000)  # cut, however long the file
    assert abs(took[-1, 0]) < 1e-3  # and never ends on a click
    assert db(loudest_rms(mono(took), 48000)) == pytest.approx(TAKE_RMS_DB, abs=0.2)  # matched like the rest
    assert band_energy(mono(b.take("floor", 1, muffled=True)), 48000, 250, 400) > 0  # it gets a muffled copy
    # …and the rest stay the synthesised ones.
    assert b.take("floor", 0).tobytes() == bank48.take("floor", 0).tobytes()


def test_a_broken_file_leaves_the_take_and_says_so(tmp_path, bank48, caplog):
    (tmp_path / "footstep_tile_1.wav").write_bytes(b"not a wav")
    (tmp_path / "footstep_tile_2.wav").write_bytes(b"")
    with caplog.at_level(logging.WARNING, logger="stagehand.audio"):
        b = FootstepBank(tmp_path, 48000)
    assert b.real == [] and "footstep_tile_1" in caplog.text
    assert b.take("tile", 0).tobytes() == bank48.take("tile", 0).tobytes()


def test_a_silent_file_is_not_a_take(tmp_path, bank48):
    sf.write(str(tmp_path / "footstep_floor_1.wav"), np.zeros(4800), 48000)
    b = FootstepBank(tmp_path, 48000)
    assert b.real == [] and b.take("floor", 0).tobytes() == bank48.take("floor", 0).tobytes()


def test_an_unknown_surface_reads_as_floor(bank):
    assert bank.takes("lava") == bank.takes("floor")
    assert bank.take("lava", 2) is bank.take("floor", 2)


# -- the walkers -----------------------------------------------------------------


class FakeMixer:
    """Records what `Mixer.play` was asked; anything else is a test failure."""

    def __init__(self) -> None:
        self.plays: list[dict] = []

    def play(self, source, gains, **kw):
        self.plays.append({"source": source, "gains": gains, **kw})
        return len(self.plays)


DOC = parse_audio(
    {
        "version": 1,
        "device": {"name": "x", "inputs": 2, "outputs": 8},
        "speakers": [
            {"id": "pair", "room": "r1", "out": [1, 2], "gain": -6},
            {"id": "one", "room": "r1", "out": [3]},
            {"id": "next-door", "room": "r2", "out": [4], "gain": 3},
            {"id": "shared", "room": "r2", "out": [3]},
            {"id": "unwired", "room": "r2", "out": []},
        ],
    }
)


def walker(sid: str = "s1", speed: float = 1.5, surface: str = "floor", to=None) -> dict:
    return {"id": sid, "speed": speed, "surface": surface, "to": [{"speaker": "one", "db": 0, "muffled": False}] if to is None else to}


def frame(*walkers: dict, seq: int = 1) -> dict:
    return {"seq": seq, "at": 0, "walkers": list(walkers)}


def rigged(bank: FootstepBank, seed: int = 1, doc=DOC) -> tuple[Walkers, FakeMixer]:
    mixer = FakeMixer()
    return Walkers(lambda: StepRig(mixer, doc, bank), rng=random.Random(seed)), mixer


def walk(w: Walkers, start: float, stop: float, *, tick: float = 0.001, keep_alive: dict | None = None) -> float:
    """Tick from `start` to `stop`, a frame every 2 s if `keep_alive`. → the end."""
    t, next_frame = start, start
    while t < stop:
        if keep_alive is not None and t >= next_frame:
            w.apply(keep_alive)
            next_frame = t + 2.0
        w.tick(t)
        t += tick
    return t


class Timed(FakeMixer):
    """A fake mixer that notes when each step played."""

    def __init__(self) -> None:
        super().__init__()
        self.now = 0.0
        self.times: list[float] = []

    def play(self, source, gains, **kw):
        self.times.append(self.now)
        return super().play(source, gains, **kw)


def timed_walk(bank: FootstepBank, speed: float, seconds: float, seed: int = 1) -> list[float]:
    mixer = Timed()
    w = Walkers(lambda: StepRig(mixer, DOC, bank), rng=random.Random(seed))
    w.apply(frame(walker(speed=speed)))
    t = 0.0
    while t < seconds:
        mixer.now = t
        w.tick(t)
        t += 0.001
        if int(t * 1000) % 2000 == 0:
            w.apply(frame(walker(speed=speed)))
    return mixer.times


def test_the_first_step_is_at_once_then_at_the_pace_with_its_jitter(bank):
    for speed in (0.5, 1.4, 2.0, 3.0):
        times = timed_walk(bank, speed, 60.0)
        assert times[0] == 0.0
        gaps = np.diff(times)
        pace = step_pace_s(speed)
        assert gaps.min() >= pace * (1 - PACE_JITTER) - 0.0011
        assert gaps.max() <= pace * (1 + PACE_JITTER) + 0.0021
        assert gaps.mean() == pytest.approx(pace, rel=0.02)
        assert gaps.std() > pace * 0.02  # a walk, not a metronome


def test_steps_alternate_feet_and_no_take_plays_twice_running(bank):
    w, mixer = rigged(bank)
    w.apply(frame(walker()))
    walk(w, 0.0, 120.0, keep_alive=frame(walker()))
    takes = {id(bank.take("floor", n)): n for n in range(bank.takes("floor"))}
    picked = [takes[id(p["source"])] for p in mixer.plays]
    assert len(picked) > 100
    assert [n % 2 for n in picked] == [i % 2 for i in range(len(picked))]  # left, right, left…
    assert all(a != b for a, b in zip(picked, picked[1:]))
    assert all(a != b for a, b in zip(picked, picked[2:]))  # nor one foot's twice running
    assert set(picked) == set(range(bank.takes("floor")))


def test_each_program_walks_on_its_own(bank):
    w, mixer = rigged(bank)
    both = frame(walker("a", speed=1.0), walker("b", speed=2.4))
    w.apply(both)
    walk(w, 0.0, 10.0, keep_alive=both)
    assert w.count == 2
    assert len(mixer.plays) == pytest.approx(10 / 0.72 + 10 / 0.3, abs=3)


def test_two_programs_steps_never_land_as_one(bank):
    mixer = Timed()
    w = Walkers(lambda: StepRig(mixer, DOC, bank), rng=random.Random(1))
    crowd = frame(*(walker(f"s{i}") for i in range(6)))
    w.apply(crowd)
    t = 0.0
    while t < 20.0:
        mixer.now = t
        w.tick(t)
        t += WALKERS_TICK_S
        if int(t / WALKERS_TICK_S) % 100 == 0:
            w.apply(crowd)
    assert len(mixer.times) > 100
    assert np.diff(mixer.times).min() >= STEP_GAP_S - 1e-9


def test_a_crowd_starting_together_stays_out_of_the_limiter(bank48):
    """Six in one frame, on one speaker: as loud as the loudest of them, not
    six times that, or the limiter takes the music down too."""
    mixer = Mixer(2, 8, 48000)
    w = Walkers(lambda: StepRig(mixer, DOC, bank48), rng=random.Random(3))
    w.apply(frame(*(walker(f"s{i}", to=[{"speaker": "one", "db": -6, "muffled": False}]) for i in range(6))))
    alone = max(float(np.abs(bank48.take("floor", n)).max()) for n in range(TAKES)) * db_to_lin(-6 + STEP_GAIN_DB)
    t, peak = 0.0, 0.0
    while t < 1.5:
        w.tick(t)
        out = np.zeros((480, 8), dtype=np.float32)
        mixer.process(None, out)
        peak = max(peak, float(np.abs(out).max()))
        t += 0.01
    assert peak < alone * 1.5
    assert mixer.limited_blocks == 0


def test_no_frame_for_the_stale_time_stops_everyone(bank):
    w, mixer = rigged(bank)
    w.apply(frame(walker()))
    walk(w, 0.0, STALE_S - 0.1)
    assert w.count == 1 and mixer.plays
    played = len(mixer.plays)
    end = walk(w, STALE_S - 0.1, STALE_S + 3.0)
    assert w.count == 0
    assert len(mixer.plays) - played <= 1  # only what was due before the line
    # A frame after the silence: they walk again.
    w.apply(frame(walker()))
    walk(w, end, end + 1.0)
    assert w.count == 1 and len(mixer.plays) > played


def test_frames_on_the_keep_alive_never_read_as_stale(bank):
    w, mixer = rigged(bank)
    w.apply(frame(walker()))
    walk(w, 0.0, 30.0, keep_alive=frame(walker()))
    assert w.count == 1 and len(mixer.plays) > 30


def test_a_quiet_house_is_never_stale(bank):
    w, mixer = rigged(bank)
    w.apply(frame())
    walk(w, 0.0, 30.0, tick=0.1)
    assert w.count == 0 and not mixer.plays


def test_a_walker_gone_from_the_frame_stops_after_its_current_step(bank):
    w, mixer = rigged(bank)
    w.apply(frame(walker("a"), walker("b")))
    w.tick(0.0)
    w.tick(STEP_GAP_S)
    assert len(mixer.plays) == 2
    w.apply(frame(walker("b")))
    assert w.count == 1
    walk(w, 0.1, 3.0, keep_alive=frame(walker("b")))
    # Its voice was never stopped (FakeMixer has no `stop`), and b walks on alone.
    assert len(mixer.plays) == pytest.approx(2 + 2.9 / step_pace_s(1.5), abs=1.5)


def test_the_last_one_stopping_stops_the_steps(bank):
    w, mixer = rigged(bank)
    w.apply(frame(walker()))
    w.tick(0.0)
    w.apply(frame())
    walk(w, 0.01, 3.0)
    assert w.count == 0 and len(mixer.plays) == 1


def test_stopping_and_starting_never_steps_early(bank):
    w, mixer = rigged(bank)
    w.apply(frame(walker()))
    w.tick(0.0)
    w.apply(frame())  # dropped under the moving speed…
    w.tick(0.1)
    w.apply(frame(walker()))  # …and back, 0.2 s after a step
    w.tick(0.2)
    assert len(mixer.plays) == 1
    w.tick(step_pace_s(1.5) * (1 + PACE_JITTER) + 0.01)
    assert len(mixer.plays) == 2


def test_speeding_up_pulls_the_next_step_in_and_slowing_down_lets_it_stand(bank):
    w, mixer = rigged(bank)
    w.apply(frame(walker(speed=0.5)))
    w.tick(0.0)
    w.apply(frame(walker(speed=2.0)))
    w.tick(step_pace_s(2.0) + 0.001)
    assert len(mixer.plays) == 2
    w.apply(frame(walker(speed=0.5)))
    w.tick(step_pace_s(2.0) + 0.002)
    assert len(mixer.plays) == 2


def test_a_stalled_clock_is_a_late_step_not_a_burst(bank):
    w, mixer = rigged(bank)
    w.apply(frame(walker()))
    w.tick(0.0)
    w.apply(frame(walker()))
    w.tick(4.0)  # the loop was busy for 4 s
    assert len(mixer.plays) == 2
    w.tick(4.01)
    w.tick(4.02)
    assert len(mixer.plays) == 2


def test_muffled_and_clear_outputs_are_separate_voices(bank):
    w, mixer = rigged(bank)
    w.apply(frame(walker(to=[{"speaker": "one", "db": -2, "muffled": False}, {"speaker": "pair", "db": -8, "muffled": False}, {"speaker": "next-door", "db": -14, "muffled": True}])))
    w.tick(0.0)
    assert len(mixer.plays) == 2
    clear, muffled = mixer.plays
    assert clear["gains"] == {1: -8.0, 2: -8.0, 3: -2.0}
    assert muffled["gains"] == {4: -14.0}
    n = next(k for k in range(bank.takes("floor")) if bank.take("floor", k) is clear["source"])
    assert muffled["source"] is bank.take("floor", n, muffled=True)  # the same footfall through the wall
    assert clear["level_db"] == muffled["level_db"]


def test_a_step_heard_only_through_a_wall_is_one_voice(bank):
    w, mixer = rigged(bank)
    w.apply(frame(walker(to=[{"speaker": "next-door", "db": -14, "muffled": True}])))
    w.tick(0.0)
    assert len(mixer.plays) == 1 and any(mixer.plays[0]["source"] is bank.take("floor", n, muffled=True) for n in range(TAKES))


def test_a_steps_voice_is_on_the_sfx_bus_and_the_steps_strip(bank):
    w, mixer = rigged(bank)
    w.apply(frame(walker(to=[{"speaker": "pair", "db": -6, "muffled": False}, {"speaker": "one", "db": -6, "muffled": False}])))
    w.tick(0.0)
    play = mixer.plays[0]
    assert play["bus"] == "sfx" and play["strip"] == "steps" and play["tag"] == STEP_TAG
    assert play.get("duck", True) is True and not play.get("takeover")  # ducked like sfx
    assert play["layout"] == ((1, 2), (3,))  # the router's play path


def test_the_gain_is_the_frames_db_and_the_trims_stay_on_the_outputs(bank):
    gains, speakers = step_outputs(DOC, (("pair", -6.0, False), ("next-door", -2.0, False)), False)
    assert gains == {1: -6.0, 2: -6.0, 4: -2.0}  # −6 / +3 trims are `set_trim`'s: never counted here
    assert speakers == ("pair", "next-door")


def test_each_step_moves_a_tiny_random_gain(bank):
    w, mixer = rigged(bank)
    w.apply(frame(walker()))
    walk(w, 0.0, 60.0, keep_alive=frame(walker()))
    levels = [p["level_db"] for p in mixer.plays]
    assert max(levels) <= STEP_GAIN_DB and min(levels) >= -STEP_GAIN_DB
    assert np.std(levels) > 0.2 and all(p["gains"] == {3: 0.0} for p in mixer.plays)


def test_an_output_two_speakers_share_takes_the_louder(bank):
    gains, speakers = step_outputs(DOC, (("one", -9.0, False), ("shared", -3.0, False)), False)
    assert gains == {3: -3.0} and speakers == ("one", "shared")
    gains, _ = step_outputs(DOC, (("shared", -3.0, False), ("one", -9.0, False)), False)
    assert gains == {3: -3.0}


def test_an_unknown_speaker_is_ignored(bank, caplog):
    w, mixer = rigged(bank)
    w.apply(frame(walker(to=[{"speaker": "gone", "db": 0, "muffled": False}, {"speaker": "one", "db": -4, "muffled": False}, {"speaker": "unwired", "db": 0, "muffled": False}])))
    with caplog.at_level(logging.DEBUG):
        w.tick(0.0)
    assert [p["gains"] for p in mixer.plays] == [{3: -4.0}] and not caplog.text


def test_only_unknown_speakers_play_nothing_and_keep_the_pace(bank):
    w, mixer = rigged(bank)
    w.apply(frame(walker(to=[{"speaker": "gone", "db": 0, "muffled": False}])))
    walk(w, 0.0, 2.0)
    assert not mixer.plays and w.count == 1


def test_a_closed_stream_skips_the_step_silently_and_keeps_the_pace(bank, caplog):
    open_now = [False]
    mixer = FakeMixer()
    w = Walkers(lambda: StepRig(mixer, DOC, bank) if open_now[0] else None, rng=random.Random(1))
    w.apply(frame(walker()))
    with caplog.at_level(logging.DEBUG):
        walk(w, 0.0, 2.0, keep_alive=frame(walker()))
    assert not mixer.plays and not caplog.text
    open_now[0] = True
    w.tick(2.0 + step_pace_s(1.5) * 1.1)
    assert len(mixer.plays) == 1  # back on its feet with the next one


def test_a_crowd_never_takes_the_voices_the_story_needs(bank):
    assert 2 * STEP_VOICES < MAX_VOICES
    mixer = FakeMixer()
    w = Walkers(lambda: StepRig(mixer, DOC, bank), rng=random.Random(1))
    crowd = frame(*(walker(f"s{i}", speed=2.4, surface="grass", to=[{"speaker": "one", "db": -4, "muffled": False}, {"speaker": "next-door", "db": -12, "muffled": True}]) for i in range(40)))
    w.apply(crowd)
    t, ringing, most = 0.0, [], 0
    while t < 8.0:
        before = len(mixer.plays)
        w.tick(t)
        ringing = [e for e in ringing if e > t] + [t + len(p["source"]) / RATE for p in mixer.plays[before:]]
        most = max(most, len(ringing))
        t += 0.02
        if int(t * 50) % 100 == 0:
            w.apply(crowd)
    assert most == STEP_VOICES  # full, and never past it
    assert len(mixer.plays) > 50


@pytest.mark.parametrize("bad", [None, 3, "x", [], {}, {"walkers": None}, {"walkers": "x"}])
def test_a_bad_frame_changes_nothing(bank, bad):
    w, mixer = rigged(bank)
    w.apply(frame(walker()))
    w.apply(bad)
    assert w.count == 1


def test_bad_rows_are_dropped_and_the_good_ones_walk(bank):
    w, mixer = rigged(bank)
    rows = [
        None,
        3,
        {},
        {"id": ""},
        {"id": 7},
        {"id": "sound", "speed": "fast", "surface": 3, "to": "x"},
        {"id": "mixed", "speed": 1.4, "surface": "lava", "to": [None, 3, {"speaker": 3, "db": 0}, {"speaker": "one"}, {"speaker": "one", "db": True}, {"speaker": "one", "db": -6}]},
    ]
    w.apply({"walkers": rows})
    assert w.count == 2  # both play by the same rules as any other
    w.tick(0.0)
    assert [p["gains"] for p in mixer.plays] == [{3: -6.0}]
    assert any(mixer.plays[0]["source"] is bank.take("floor", n) for n in range(TAKES))  # lava: floor


def test_a_walk_changes_surface_and_speakers_with_the_frame(bank):
    w, mixer = rigged(bank)
    w.apply(frame(walker(surface="floor")))
    w.tick(0.0)
    w.apply(frame(walker(surface="tile", to=[{"speaker": "next-door", "db": -3, "muffled": False}])))
    w.tick(1.0)
    assert any(mixer.plays[1]["source"] is bank.take("tile", n) for n in range(TAKES))
    assert mixer.plays[1]["gains"] == {4: -3.0}


def test_a_step_through_the_real_mixer_holds_the_trims_and_the_mix(bank):
    mixer = Mixer(2, 8, RATE, priority={})
    mixer.set_trim({1: -6.0})
    walkers = Walkers(lambda: StepRig(mixer, DOC, bank), rng=random.Random(3))
    walkers.apply(frame(walker(to=[{"speaker": "pair", "db": 0, "muffled": False}, {"speaker": "one", "db": -6, "muffled": False}, {"speaker": "next-door", "db": -6, "muffled": True}])))
    walkers.tick(0.0)
    voice = _plays(mixer)[0]
    assert db_to_lin(-STEP_GAIN_DB) <= voice.level <= db_to_lin(STEP_GAIN_DB)
    out = np.zeros((int(RATE * 0.3), 8), dtype=np.float32)
    mixer.process(None, out)
    peaks = np.abs(out).max(axis=0)
    # The take as it was made, heel and all: the mixer's fade-in would eat it.
    assert peaks[1] == pytest.approx(float(np.abs(voice.samples).max()) * voice.level, rel=1e-3)
    assert peaks[0] == pytest.approx(peaks[1] * db_to_lin(-6), rel=0.01)  # the speaker's trim, once
    assert peaks[2] == pytest.approx(peaks[1] * db_to_lin(-6), rel=0.01)  # the frame's db
    assert 0 < peaks[3] < peaks[2]  # muffled, on its own output
    assert peaks[4:].max() == 0.0
    assert mixer.active() == 0  # a step ends on its own: it never fills the mixer

    # The strip: muting Footsteps silences the steps; nothing else is asked of them.
    mixer.set_mix(mix_gains({"src:steps": {"db": 0, "mute": True}}, DOC, 8))
    mixer.process(None, np.zeros((RATE // 2, 8), dtype=np.float32))
    walkers.apply(frame(walker(to=[{"speaker": "one", "db": 0, "muffled": False}])))
    walkers.tick(10.0)
    out = np.zeros((int(RATE * 0.3), 8), dtype=np.float32)
    mixer.process(None, out)
    assert np.abs(out).max() == 0.0


def _plays(mixer: Mixer) -> list:
    """The voices queued on a mixer (the queue is put back as it was)."""
    rows = []
    while not mixer._commands.empty():
        rows.append(mixer._commands.get_nowait())
    for row in rows:
        mixer._commands.put(row)
    return [arg for kind, arg in rows if kind == "play"]


# -- the router ------------------------------------------------------------------


AUDIO = {
    "speakers": [
        {"id": "one", "room": "r1", "out": [1]},
        {"id": "two", "room": "r2", "out": [2]},
    ],
    "zones": [],
    "routes": [],
    "cues": {},
}


class WalkersMod(FakeMod):
    """A fake server: `frames` then silence on the walkers stream; `refuse`
    answers the stream with that error instead."""

    token = "t"

    def __init__(self, frames=(), refuse: Exception | None = None):
        super().__init__([])
        self.frames = list(frames)
        self.refuse = refuse
        self.opened: list[str] = []

    def feed_url(self, client_id="stagehand"):
        return "fake://feed"

    async def stream(self, url, on_open=None):
        self.opened.append(url)
        if self.refuse is not None:
            raise self.refuse
        on_open()
        for event, data in self.frames:
            yield event, data
        await asyncio.sleep(3600)


def show_frame(*walkers: dict) -> tuple[str, str]:
    return "walkers", json.dumps(frame(*walkers))


async def until(test, polls: int = 300) -> bool:
    for _ in range(polls):
        if test():
            return True
        await asyncio.sleep(0.01)
    return False


def live_router(tmp_path, **over):
    r = router(tmp_path, play_sounds=True, **over)
    r.apply(answer("v1", **AUDIO))
    return r


def test_the_stream_feeds_the_walkers_and_a_step_reaches_a_speaker(tmp_path):
    async def go():
        r = live_router(tmp_path)
        mod = WalkersMod([("walkers", "not json"), ("other", "{}"), show_frame(walker(to=[{"speaker": "two", "db": -6, "muffled": False}, {"speaker": "nobody", "db": 0, "muffled": False}]))])
        task = asyncio.ensure_future(r._walkers_loop(mod))
        walked = await until(lambda: r.walkers.count == 1 and r.steps is not None and r.mixer._commands.qsize() > 0)
        out = stream_of(r).pump(1600)
        count = r.health()["walkers"]
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        return walked, mod, out, count, r

    walked, mod, out, count, r = run(go())
    assert walked and mod.opened == [f"fake://{WALKERS_PATH}"] and count == 1
    assert np.abs(out[:, 1]).max() > 0.01 and np.abs(out[:, 0]).max() == 0.0
    assert r.steps.rate == r.mixer.rate
    assert r.played == 0 and r.skipped == 0  # a step is not a story sound
    assert r.bank.missing == set()  # and no missing take is a missing sound


def test_the_takes_wait_for_the_first_walker(tmp_path):
    async def go():
        r = live_router(tmp_path)
        task = asyncio.ensure_future(r._walkers_loop(WalkersMod()))
        await asyncio.sleep(0.08)
        steps = r.steps
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        return steps

    assert run(go()) is None


def test_a_404_is_logged_once_and_the_loop_stops_until_a_restart(tmp_path, caplog):
    async def go():
        r = live_router(tmp_path)
        mod = WalkersMod(refuse=ModApiError("GET → 404", 404))
        before = len(asyncio.all_tasks())
        with caplog.at_level(logging.INFO):
            await asyncio.wait_for(r._walkers_loop(mod), 5)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        return mod, len(asyncio.all_tasks()) - before

    mod, left = run(go())
    assert len(mod.opened) == 1 and left == 0  # never asked again, the clock gone with it
    notes = [rec for rec in caplog.records if WALKERS_PATH in rec.getMessage()]
    assert len(notes) == 1 and "older release" in notes[0].getMessage()


def test_any_other_refusal_keeps_trying(tmp_path, monkeypatch):
    real_sleep = asyncio.sleep

    async def quick(_seconds, *a):
        await real_sleep(0)

    monkeypatch.setattr("stagehand.modapi.asyncio.sleep", quick)

    async def go():
        r = live_router(tmp_path)
        mod = WalkersMod(refuse=ModApiError("GET → 503", 503))
        task = asyncio.ensure_future(r._walkers_loop(mod))
        while len(mod.opened) < 3:
            await real_sleep(0)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        return mod

    assert len(run(go()).opened) >= 3


def test_a_login_404_is_no_old_server(monkeypatch):
    """No token in hand: the event is not there yet. `stop_on` is about the
    route, so the stream keeps trying and starts when the event does."""
    real_sleep = asyncio.sleep

    async def quick(_seconds, *a):
        await real_sleep(0)

    monkeypatch.setattr("stagehand.modapi.asyncio.sleep", quick)

    class NoEvent(WalkersMod):
        token = None

    async def go():
        mod = NoEvent(refuse=ModApiError("mod login failed: 404", 404))
        task = asyncio.ensure_future(run_stream(mod, "fake://x", lambda e, d: None, label="x", stop_on=(404,)))
        while len(mod.opened) < 3:
            await real_sleep(0)
        assert not task.done()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        return mod

    assert len(run(go()).opened) >= 3


def test_a_router_that_plays_no_sounds_opens_no_stream(tmp_path):
    async def go():
        r = router(tmp_path)  # play_sounds defaults to false
        r.apply(answer("v1", **AUDIO))
        mod = WalkersMod()
        await asyncio.wait_for(r._walkers_loop(mod), 2)
        return mod

    assert run(go()).opened == []


def test_a_config_without_speakers_plays_nothing(tmp_path, bank):
    r = router(tmp_path, play_sounds=True)
    assert r._step_rig() is None  # no doc yet
    r.apply(answer("v1", speakers=[], zones=[], routes=[], cues={}))
    r.steps = bank
    assert r.doc.speakers == () and r._step_rig() is None
    r.walkers.apply(frame(walker()))
    r.walkers.tick(0.0)  # no error, no voice
    assert r.mixer.active() == 0 and _plays(r.mixer) == []


def test_the_rig_needs_a_running_engine_and_the_takes(tmp_path, bank):
    r = live_router(tmp_path)
    assert r._step_rig() is None  # no bank yet
    r.steps = bank
    rig = r._step_rig()
    assert rig is not None and rig.mixer is r.mixer and rig.doc is r.doc and rig.bank is bank
    r.engine.close()
    assert r._step_rig() is None


def test_the_clock_catches_a_failing_tick_and_logs_it_once(tmp_path, caplog):
    async def go():
        r = live_router(tmp_path)

        def boom(_now):
            raise RuntimeError("no")

        r.walkers.tick = boom
        with caplog.at_level(logging.ERROR):
            task = asyncio.ensure_future(r._walkers_clock())
            await asyncio.sleep(WALKERS_TICK_S * 4)
            alive = not task.done()
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        return alive

    assert run(go())
    assert len([rec for rec in caplog.records if "footsteps tick failed" in rec.getMessage()]) == 1


def test_stop_house_sounds_and_a_story_restart_stop_the_walkers(tmp_path):
    r = live_router(tmp_path)
    r.walkers.apply(frame(walker()))
    r.stop_all()
    assert r.walkers.count == 0
    r.walkers.apply(frame(walker()))
    r.on_lifecycle({"kind": "paused"})
    assert r.walkers.count == 1
    r.on_lifecycle({"kind": "reset"})
    assert r.walkers.count == 0


def test_a_rate_change_rebuilds_the_takes(tmp_path):
    async def go():
        r = live_router(tmp_path)
        r.steps = FootstepBank(tmp_path / "sounds", r.mixer.rate + 8000)
        r.walkers.apply(frame(walker()))
        task = asyncio.ensure_future(r._walkers_clock())
        done = await until(lambda: r.steps.rate == r.mixer.rate)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        return done

    assert run(go())


def test_run_holds_the_walkers_stream(tmp_path):
    class Ctx:
        mod = WalkersMod()

    Ctx.mod.answers = [answer("v1", **AUDIO)]

    async def go():
        r = router(tmp_path, play_sounds=True)
        task = asyncio.ensure_future(r.run(Ctx()))
        ok = await until(lambda: f"fake://{WALKERS_PATH}" in Ctx.mod.opened)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        return ok

    assert run(go())
    assert f"fake://{WALKERS_PATH}" in Ctx.mod.opened


def test_a_real_client_over_a_real_socket_reads_a_frame_then_stops_on_a_404(monkeypatch):
    """The whole wire as the server writes it (`:ok`, a `walkers` event, a
    `:ping`), then the 404 of an older release: nothing here is a fake but the
    server's logic."""
    real_sleep = asyncio.sleep

    async def quick(_seconds, *a):
        await real_sleep(0)

    monkeypatch.setattr("stagehand.modapi.asyncio.sleep", quick)
    body = ":ok\n\nevent: walkers\ndata: " + json.dumps(frame(walker())) + "\n\n:ping\n\n"
    asked: list[tuple[str, str]] = []

    async def handle(reader, writer):
        request = (await reader.readline()).decode()
        headers = {}
        while (line := (await reader.readline()).strip()):
            name, _, value = line.decode().partition(":")
            headers[name.lower()] = value.strip()
        asked.append((request.split()[1], headers.get("x-loom-token", "")))
        if len(asked) == 1:
            writer.write(f"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n{body}".encode())
        else:
            writer.write(b'HTTP/1.1 404 Not Found\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}')
        await writer.drain()
        writer.close()

    async def go():
        server = await asyncio.start_server(handle, "127.0.0.1", 0)
        mod = ModClient(f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}", event="ev1", token="tok")
        frames: list[tuple[str, str]] = []
        await asyncio.wait_for(run_stream(mod, mod.stream_url(WALKERS_PATH), lambda e, d: frames.append((e, d)), label="walkers", stop_on=(404,)), 10)
        await mod.aclose()
        server.close()
        await server.wait_closed()
        return frames

    frames = run(go())
    assert asked == [("/e/ev1/api/mod/audio/walkers", "tok")] * 2
    assert [e for e, _ in frames] == ["walkers"] and json.loads(frames[0][1]) == frame(walker())


def test_the_client_builds_the_events_stream_url():
    async def go():
        scoped = ModClient("http://h:7000/", event="ev1", token="t")
        bare = ModClient("http://h:7000", token="t")
        urls = scoped.stream_url(WALKERS_PATH), bare.stream_url(WALKERS_PATH)
        await scoped.aclose()
        await bare.aclose()
        return urls

    assert run(go()) == ("http://h:7000/e/ev1/api/mod/audio/walkers", "http://h:7000/api/mod/audio/walkers")


def test_describe_says_where_the_steps_come_from(tmp_path):
    assert any("footstep_<surface>_<n>.wav" in line for line in router(tmp_path, play_sounds=True).describe())
    assert any(line.startswith("steps") and "not here" in line for line in router(tmp_path).describe())
