"""The house speaker router (`audio` module): config, the stream, where a
sound goes, announcements, speaker tests, the poll — no sound card, no server."""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import types
from pathlib import Path

import httpx
import numpy as np
import pytest
import soundfile as sf

from stagehand.audio.config import parse_audio_section
from stagehand.audio.module import AudioRouter, MixerOutput, sound_args
from stagehand.audio.sounds import SoundBank
from stagehand.alexa.module import Announcement, try_lock
from stagehand.config import parse_config
from stagehand.modapi import ModApiError
from stagehand.module import ConfigError

from test_audio_engine import FakeStream, fake_query  # the shared fakes

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "router-audio.json").read_text())
RATE = 8000


def run(coro):
    return asyncio.run(coro)


def write_wav(path: Path, seconds: float = 0.05, rate: int = RATE, value: float = 0.25, channels: int = 1) -> Path:
    sf.write(str(path), np.full((int(rate * seconds), channels), value, dtype=np.float32), rate)
    return path


def wav_bytes(seconds: float = 0.05, rate: int = RATE) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.full((int(rate * seconds), 1), 0.1, dtype=np.float32), rate, format="WAV")
    return buf.getvalue()


def answer(version: str = "v1", **audio_over) -> dict:
    return {
        "audio": {**FIXTURE["audio"], "device": {"name": "MOTU", "inputs": 16, "outputs": 16}, **audio_over},
        "version": version,
        "source": "project",
        "sounds": ["dance_song", "printer_grind", "zip", "announce_chime", "beans_spill"],
        "locations": [],
        "tests": [],
    }


def router(tmp_path, *, threaded=False, query=None, render_say=None, speak_direct=None, voice=True, **over) -> AudioRouter:
    sounds = tmp_path / "sounds"
    sounds.mkdir(exist_ok=True)
    section = {"sounds_dir": str(sounds), "cache_dir": str(tmp_path / "cache"), "announce_lock_dir": str(tmp_path / "lock"), **over}
    r = AudioRouter(
        parse_audio_section(section, str(tmp_path)),
        query=query or fake_query(),
        stream_factory=lambda **kw: FakeStream(threaded=threaded, **kw),
        render_say=render_say or (lambda text, voice: wav_bytes(0.05)),
        speak_direct=speak_direct or (lambda text, voice, device: None),
    )
    if voice and r.cfg.announce:
        r.lock_fd = try_lock(r.cfg.announce_lock_dir)  # what run() takes first
    return r


def with_house(r: AudioRouter) -> AudioRouter:
    r.set_house(FIXTURE["house"], persist=False)
    return r


def stream_of(r: AudioRouter) -> FakeStream:
    assert r.engine is not None
    return r.engine.stream


def loud(out: np.ndarray) -> list[int]:
    """1-based output channels with signal in this block."""
    return [i + 1 for i in range(out.shape[1]) if np.abs(out[:, i]).max() > 1e-4]


# -- the section beside the others -------------------------------------------------------------


SERVER = {"url": "http://127.0.0.1:7000", "mod_passcode": "p"}
SHOW = {
    "osc": {"targets": {"qlab": {"host": "127.0.0.1", "port": 53000}}},
    "mqtt": {"host": "127.0.0.1"},
    "cues": [
        {"on": {"directive": "sfx"}, "match": {"target": "zip"}, "osc": {"addr": "/cue/zip/start", "to": "qlab"}},
        {"on": {"directive": "sfx"}, "match": {"target": "announce_chime"}, "mqtt": {"topic": "show/chime", "payload": {}}},
        {"on": {"directive": "cue"}, "match": {"target": "lights_y2k"}, "osc": {"addr": "/cue/y2k/start", "to": "qlab"}},
    ],
}


def test_the_router_takes_the_qlab_sound_cues_away_only_when_it_plays_sounds(tmp_path):
    kept = parse_config({"server": SERVER, "show": SHOW, "audio": {"play_sounds": False}}, str(tmp_path))
    assert len(kept.modules["show"].cfg.cues) == 3
    handed = parse_config({"server": SERVER, "show": SHOW, "audio": {"play_sounds": True}}, str(tmp_path))
    show = handed.modules["show"]
    assert [r.on_directive for r in show.cfg.cues] == ["sfx", "cue"]  # the chime's MQTT rule stays
    assert show.cfg.cues[0].mqtt is not None and show.sounds_handed_off == 1
    assert "handed to the audio router" in "\n".join(show.describe())


def test_the_show_job_alone_still_hands_its_sounds_off(tmp_path):
    # `--only show` (its own launchd job) reads the same file's audio: section.
    cfg = parse_config({"server": SERVER, "show": SHOW, "audio": {"play_sounds": True}}, str(tmp_path), only=["show"])
    assert list(cfg.modules) == ["show"] and len(cfg.modules["show"].cfg.cues) == 2


def test_an_announcing_router_refuses_an_alexa_section(tmp_path):
    alexa = {"mqtt": {"host": "127.0.0.1"}}
    with pytest.raises(ConfigError, match="one owner"):
        parse_config({"server": SERVER, "alexa": alexa, "audio": {"announce": True}}, str(tmp_path))
    with pytest.raises(ConfigError, match="one owner"):
        parse_config({"server": SERVER, "alexa": alexa, "audio": {"announce": True}}, str(tmp_path), only=["alexa"])
    ok = parse_config({"server": SERVER, "alexa": alexa, "audio": {"announce": False}}, str(tmp_path))
    assert list(ok.modules) == ["alexa", "audio"]


def test_the_example_config_parses(tmp_path):
    from stagehand.config import load_config

    example = Path(__file__).parents[1] / "audio.example.yaml"
    cfg = load_config(example, env={})
    audio = cfg.modules["audio"]
    assert audio.cfg.play_sounds is False and audio.cfg.announce is False
    assert audio.cfg.no_duck == ("dance_song", "rave", "hand_jive") and audio.cfg.duck_hold_s == 7


# -- the stream --------------------------------------------------------------


# -- config in force ---------------------------------------------------------


def test_apply_opens_the_stream_and_reopens_only_on_a_device_change(tmp_path):
    r = router(tmp_path)
    assert r.apply(answer("v1")) and r.engine_running()
    first = stream_of(r)
    assert first.kwargs["channels"] == (16, 16)
    assert r.apply(answer("v2", cues={}))
    assert stream_of(r) is first  # a cue edit never reopens the device
    assert r.apply(answer("v3", device={"name": "MOTU", "inputs": 8, "outputs": 8}))
    assert stream_of(r) is not first and first.closed and stream_of(r).kwargs["channels"] == (8, 8)


def test_a_bad_doc_keeps_the_previous_config(tmp_path, caplog):
    r = router(tmp_path)
    r.apply(answer("v1"))
    with caplog.at_level(logging.ERROR):
        assert not r.apply({"audio": {"version": 9}, "version": "v2"})
    assert r.version == "v1" and "keeping the previous" in caplog.text


def test_the_matrix_passes_inputs_through(tmp_path):
    r = router(tmp_path)
    r.apply(answer("v1"))  # route: in 3 → out 1, 2 at −6 dB
    s = stream_of(r)
    indata = np.zeros((400, 16), dtype=np.float32)
    indata[:, 2] = 0.5
    for _ in range(8):
        out = s.pump(400, indata)
    assert loud(out) == [1, 2] and out[-1, 0] == pytest.approx(0.5 * 10 ** (-6 / 20), rel=0.01)


def test_passthrough_off_opens_an_output_only_stream(tmp_path):
    r = router(tmp_path, passthrough=False)
    r.apply(answer("v1"))
    assert stream_of(r).kwargs["channels"] == 16


def test_the_answer_is_cached_and_a_restart_routes_from_it(tmp_path):
    r = router(tmp_path)
    r.apply(answer("v7"))
    r.set_house(FIXTURE["house"])
    again = router(tmp_path)
    assert again.load_local() and again.version == "v7" and again.source == "cache"
    assert again.house == FIXTURE["house"] and again.engine_running()


def test_a_local_config_file_is_used_with_no_cache(tmp_path):
    local = tmp_path / "audio.json"
    local.write_text(json.dumps(FIXTURE["audio"]))
    r = router(tmp_path, config_file=str(local))
    assert r.load_local() and r.source == "file" and r.doc.device == "MOTU"


def test_same_version_from_the_server_takes_over_from_the_cache(tmp_path):
    r = router(tmp_path)
    r.apply(answer("v1"), source="cache", persist=False)
    stream = stream_of(r)
    assert r.apply(answer("v1")) and r.source == "project" and stream_of(r) is stream


# -- where a sound goes ------------------------------------------------------


def playing(tmp_path, **over) -> AudioRouter:
    r = with_house(router(tmp_path, play_sounds=True, **over))
    for name in ("dance_song", "printer_grind", "zip", "beans_spill", "Motorcycle"):
        write_wav(tmp_path / "sounds" / f"{name}.wav", rate=RATE * 2)  # resampled to the device rate
    r.apply(answer("v1"))
    return r


@pytest.mark.parametrize(
    "event, outs, why",
    [
        ({"args": "beans_spill, rooms: start-bar"}, [3, 4], "the story's rooms"),
        ({"args": "beans_spill, rooms: The Desktop"}, [1, 2], "a spaced LOCATION"),
        ({"args": "beans_spill, rooms: start-bar hall"}, [3, 4, 5], "two room ids"),
        ({"args": "printer_grind, rooms: hall"}, [5], "the story beats the cue"),
        ({"args": "printer_grind", "setting": "The Tube"}, [1, 2], "the cue beats the setting"),
        ({"args": "beans_spill", "setting": "The Tube"}, [5, 6], "the beat's setting"),
        ({"args": "beans_spill"}, [1, 2, 3, 4, 5, 6, 7], "everywhere"),
        ({"args": "dance_song"}, [1, 2, 3, 4, 5, 6, 7], "a cue to everywhere"),
    ],
)
def test_where_a_sound_goes(tmp_path, event, outs, why):
    r = playing(tmp_path)
    assert r.on_sim({"type": "directive", "verb": "sfx", **event}) == "played", why
    assert loud(stream_of(r).pump(200)) == outs, why


def test_cue_and_speaker_gains_apply(tmp_path):
    r = playing(tmp_path)
    r.on_sim({"type": "directive", "verb": "sfx", "args": "printer_grind"})  # −4 dB cue → desk-l/r at 0 dB trim
    out = stream_of(r).pump(200)
    assert out[100, 0] == pytest.approx(0.25 * 10 ** (-4 / 20), rel=0.02)
    r.on_sim({"type": "directive", "verb": "sfx", "args": "beans_spill, rooms: start-bar"})  # bar-1 trims −3 dB
    out = stream_of(r).pump(200)
    assert out[100, 2] == pytest.approx(0.25 * 10 ** (-3 / 20), rel=0.02)


def test_a_stereo_sound_is_laid_out_per_speaker(tmp_path):
    r = playing(tmp_path)
    sf.write(str(tmp_path / "sounds" / "song.wav"), np.stack([np.full(800, 0.2), np.full(800, 0.4)], axis=1).astype(np.float32), RATE)
    # bar-1 is `out: [4, 3]` (L on 4), desk-l / desk-r are one output each.
    assert r.on_sim({"type": "directive", "verb": "sfx", "args": "song, rooms: start-bar desktop"}) == "played"
    out = stream_of(r).pump(200)
    trim = 10 ** (-3 / 20)  # bar-1's −3 dB
    assert out[100, 3] == pytest.approx(0.2 * trim, rel=0.02) and out[100, 2] == pytest.approx(0.4 * trim, rel=0.02)
    assert out[100, 0] == pytest.approx(0.3, rel=0.02) and out[100, 1] == pytest.approx(0.3, rel=0.02)


def test_a_missing_file_is_logged_once_and_never_crashes(tmp_path, caplog):
    r = playing(tmp_path)
    with caplog.at_level(logging.WARNING):
        assert r.on_sim({"type": "directive", "verb": "sfx", "args": "alarm_siren"}) == "no-file"
        assert r.on_sim({"type": "directive", "verb": "sfx", "args": "alarm_siren"}) == "no-file"
    assert caplog.text.count("alarm_siren") == 1 and r.skipped == 2 and "alarm_siren" in r.health()["missing"]


def test_a_sound_to_nowhere_and_a_closed_stream_skip(tmp_path):
    r = playing(tmp_path)
    assert r.on_sim({"type": "directive", "verb": "sfx", "args": "zip"}) == "nowhere"  # its cue names nothing
    assert r.on_sim({"type": "directive", "verb": "sfx", "args": "zip, rooms: crawl"}) == "nowhere"  # a room with no speaker
    r.engine.close()
    assert r.on_sim({"type": "directive", "verb": "sfx", "args": "beans_spill"}) == "closed"


def test_file_names_match_case_insensitively(tmp_path):
    r = playing(tmp_path)
    assert r.on_sim({"type": "directive", "verb": "sfx", "args": "motorcycle"}) == "played"


def test_qlab_keeps_the_sounds_when_the_router_does_not_play_them(tmp_path):
    r = with_house(router(tmp_path))
    write_wav(tmp_path / "sounds" / "zip.wav")
    r.apply(answer("v1"))
    assert r.on_sim({"type": "directive", "verb": "sfx", "args": "zip, rooms: hall"}) is None
    assert not stream_of(r).pump(100).any()


def test_a_story_restart_fades_every_sound_out(tmp_path):
    r = playing(tmp_path)
    write_wav(tmp_path / "sounds" / "dance_song.wav", seconds=10)
    r.bank = SoundBank(r.cfg.sounds_dir, RATE)
    r.on_sim({"type": "directive", "verb": "sfx", "args": "dance_song"})
    s = stream_of(r)
    assert s.pump(100).any()
    r.on_lifecycle({"kind": "reset"})
    for _ in range(25):
        s.pump(400)
    assert r.mixer.active() == 0 and not s.pump(100).any()


def test_other_events_are_ignored(tmp_path):
    r = playing(tmp_path)
    assert r.on_sim({"type": "directive", "verb": "cue", "args": "lights_y2k"}) is None
    assert r.on_sim({"type": "beatEntered", "beat": "x"}) is None
    assert r.on_sim("nonsense") is None
    assert r.on_sim({"type": "directive", "verb": "sfx", "args": ""}) is None


# -- stop all house sounds (wave 18b, Q7) -------------------------------------


def test_stop_fades_every_sound_and_test_but_not_the_announcement_or_the_matrix(tmp_path):
    r = playing(tmp_path, announce=True)
    write_wav(tmp_path / "sounds" / "dance_song.wav", seconds=10)
    r.bank = SoundBank(r.cfg.sounds_dir, RATE)
    r.on_sim({"type": "directive", "verb": "sfx", "args": "dance_song"})
    r.mixer.play(np.full((RATE * 5, 1), 0.2, dtype=np.float32), {1: 0.0}, bus="test", tag="test")
    r.mixer.play(np.full((RATE * 5, 1), 0.2, dtype=np.float32), {2: 0.0}, bus="announce", tag="announce")
    s = stream_of(r)
    s.pump(100)
    assert r.stop_all(False, "Ada") is True
    for _ in range(10):
        s.pump(400)  # 0.5 s: past the 0.3 s fade
    assert r.mixer.active("sfx") == 0 and r.mixer.active("test") == 0
    assert r.mixer.active("announce") == 1 and loud(s.pump(100)) == [2]
    # One-shot: the next story sound plays as usual.
    assert r.on_sim({"type": "directive", "verb": "sfx", "args": "zip, rooms: hall"}) == "played"
    assert r.stops_done == 1


def test_stop_with_announcements_cuts_the_line_empties_the_queue_and_never_falls_back_to_say(tmp_path):
    direct: list = []

    async def go():
        r = with_house(router(tmp_path, announce=True, threaded=True, render_say=lambda t, v: wav_bytes(20.0), speak_direct=lambda t, v, d: direct.append(t)))
        r.apply(answer("v1"))
        r.announcements = asyncio.Queue()
        worker = asyncio.ensure_future(r._announce_worker())
        await r.announcements.put(Announcement(text="Five minutes."))
        r.announcements.put_nowait(Announcement(text="Queued."))
        for _ in range(200):
            await asyncio.sleep(0.005)
            if r.mixer.active("announce"):
                break
        assert r.stop_all(True, "Ada")
        assert r.announcements.empty()
        for _ in range(200):
            await asyncio.sleep(0.005)
            if not r.mixer.active("announce"):
                break
        await asyncio.sleep(0.05)
        worker.cancel()
        stream_of(r).stop()
        return r

    r = run(go())
    assert direct == [] and r.mixer.active() == 0


def test_a_cut_announcement_returns_quietly_instead_of_raising(tmp_path):
    r = router(tmp_path, announce=True)
    r.apply(answer("v1"))
    r._playing_epoch = r._announce_epoch
    r.stop_all(True)
    MixerOutput(r).play(np.zeros((10, 1), dtype=np.float32), RATE)  # no PlaybackError
    assert r.mixer.active("announce") == 0
    r._speak_unless_cut("Hi.", None, "MOTU")  # no say -a around the stop


def test_new_stops_prime_then_act_once_and_drop_stale_ones(tmp_path):
    r = router(tmp_path)
    assert r.new_stops([{"seq": 2, "at": 1000, "by": "Ada", "announce": False}], 1500) == []  # boot: primed
    assert r.stop_seq == 2
    fresh = r.new_stops([{"seq": 2, "at": 1000}, {"seq": 3, "at": 2000, "by": "Bo", "announce": True}], 2500)
    assert [t["seq"] for t in fresh] == [3]
    assert r.new_stops([{"seq": 3, "at": 2000}], 2600) == []
    # A restarted server's seqs start again; `at` never goes back.
    assert [t["seq"] for t in r.new_stops([{"seq": 1, "at": 9000}], 9100)] == [1] and r.stop_seq == 1
    # Older than 10 s by the server's clock: never acted on.
    assert r.new_stops([{"seq": 2, "at": 10_000}], 30_000) == [] and r.stop_seq == 2
    assert r.new_stops(None, 1) == [] and r.stop_seq == 0


def test_the_poll_sends_the_stop_cursor_and_acts_on_a_new_stop(tmp_path):
    stopped: list = []

    async def go():
        r = router(tmp_path)
        r.stop_all = lambda announce=False, by="": stopped.append((announce, by)) or True  # type: ignore[method-assign]
        first = answer("v1")
        first["stops"], first["now"] = [{"seq": 1, "at": 10, "by": "old", "announce": False}], 20
        second = answer("v1")
        second["stops"], second["now"] = [{"seq": 1, "at": 10}, {"seq": 2, "at": 30, "by": "Ada", "announce": True}], 40
        mod = FakeMod([first, second])
        task = asyncio.ensure_future(r._config_loop(mod))
        for _ in range(100):
            await asyncio.sleep(0.01)
            if stopped and len(mod.calls) >= 3:
                break
        task.cancel()
        return mod

    mod = run(go())
    polls = [c[1] for c in mod.calls if c[0] == "/api/mod/audio"]
    assert polls[1]["stops"] == 1 and polls[2]["stops"] == 2
    assert stopped == [(True, "Ada")]  # the boot answer's stop was only primed


def test_mqtt_stop_and_hand_play(tmp_path):
    async def go():
        r = playing(tmp_path, mqtt={"host": "127.0.0.1"})
        stops: list = []
        real = r.stop_all
        r.stop_all = lambda announce=False, by="": stops.append((announce, by)) or real(announce, by)  # type: ignore[method-assign]
        r.mqtt = FakeBridge(
            [
                ("show/audio/play", b'{"name": "zip", "to": ["hall"]}', False),
                ("show/audio/play", b'{"name": "beans_spill", "to": "start-bar"}', False),
                ("show/audio/play", b'{"name": "zip"}', True),  # retained: never replayed
                ("show/audio/play", b"garbage", False),
                ("show/audio/stop", b"", False),
                ("show/audio/stop", b'{"announce": true}', False),
                ("show/audio/stop", b'{"announce": true}', True),
            ]
        )
        task = asyncio.ensure_future(r._mqtt_loop())
        await asyncio.sleep(0.05)
        task.cancel()
        return r, stops

    r, stops = run(go())
    assert r.played == 2 and stops == [(False, "mqtt"), (True, "mqtt")]
    assert "show/audio/stop" in "\n".join(r.describe())


# -- announcements -----------------------------------------------------------


def test_announcements_come_from_the_feed_without_a_broker(tmp_path):
    async def go():
        r = router(tmp_path, announce=True)
        r.announcements = asyncio.Queue()
        assert r.on_sim({"type": "directive", "verb": "announce", "args": '"Go to the   living room."'}) == "announce"
        assert r.on_sim({"type": "directive", "verb": "sfx", "args": "announce_chime"}) == "chime"
        return [r.announcements.get_nowait(), r.announcements.get_nowait()]

    a, chime = run(go())
    assert a == Announcement(text="Go to the living room.") and chime == "chime"


def test_with_a_broker_the_feed_never_announces(tmp_path):
    r = router(tmp_path, announce=True, mqtt={"host": "127.0.0.1"})
    r.announcements = asyncio.Queue()
    assert r.on_sim({"type": "directive", "verb": "announce", "args": "Hello"}) is None
    assert r.on_sim({"type": "directive", "verb": "sfx", "args": "announce_chime"}) is None


def test_without_announce_the_chime_stays_the_alexa_players(tmp_path):
    r = router(tmp_path, play_sounds=True)
    r.announcements = asyncio.Queue()
    assert r.on_sim({"type": "directive", "verb": "sfx", "args": "announce_chime"}) is None
    assert r.on_sim({"type": "directive", "verb": "announce", "args": "Hello"}) is None


def test_an_announcement_plays_chime_then_voice_on_announce_to(tmp_path):
    said: list[str] = []

    def render(text, voice):
        said.append(text)
        return wav_bytes(0.1)

    async def go():
        r = with_house(router(tmp_path, announce=True, threaded=True, render_say=render))
        r.apply(answer("v1"))  # announce.to: downstairs + The Tube → 1, 3, 4, 5, 6
        s = stream_of(r)
        path = await r.make_announcer().announce(Announcement(text="Five minutes."))
        s.stop()
        return path, s

    path, s = run(go())
    assert path == "device-say" and said == ["Five minutes."]
    heard = sorted({ch for block in s.out for ch in loud(block)})
    assert heard == [1, 3, 4, 5, 6]


def test_announce_falls_back_to_say_when_the_stream_is_closed(tmp_path):
    direct: list[tuple] = []

    async def go():
        r = router(tmp_path, announce=True, speak_direct=lambda t, v, d: direct.append((t, d)))
        r.apply(answer("v1"))
        r.engine.close()
        return await r.make_announcer().announce(Announcement(text="Hi.", chime=False))

    assert run(go()) == "say-device" and direct == [("Hi.", "MOTU")]


def test_mixer_output_refuses_targets_with_no_wired_speaker(tmp_path):
    from stagehand.alexa.player import PlaybackError

    r = router(tmp_path, announce=True)
    r.apply(answer("v1", announce={"to": ["crawl"]}))
    with pytest.raises(PlaybackError, match="no wired speaker"):
        MixerOutput(r).play(np.zeros((10, 1), dtype=np.float32), RATE)


def test_a_held_alexa_lock_blocks_only_the_announcements(tmp_path, caplog):
    held = try_lock(str(tmp_path / "lock"))
    assert held is not None
    said: list[str] = []
    r = router(tmp_path, announce=True, play_sounds=True, voice=False, threaded=True, render_say=lambda t, v: said.append(t) or wav_bytes(0.05))
    write_wav(tmp_path / "sounds" / "zip.wav")

    class FeedMod(FakeMod):
        def feed_url(self, client_id="stagehand"):
            return "fake://feed"

        async def stream(self, url, on_open=None):
            on_open()
            await asyncio.sleep(0.05)
            yield "sim", json.dumps({"type": "directive", "verb": "sfx", "args": "zip, rooms: hall"})
            yield "sim", json.dumps({"type": "directive", "verb": "announce", "args": "Five minutes."})
            await asyncio.sleep(3600)

    class Ctx:
        mod = FeedMod([answer("v1")])

    async def go():
        task = asyncio.ensure_future(r.run(Ctx()))
        for _ in range(100):
            await asyncio.sleep(0.01)
            if r.played:
                break
        await asyncio.sleep(0.05)
        state = (r.engine_running(), r.played, r.announce_state(), r.health()["announce"], list(said), r.mixer.duck_hold > 0 or r.mixer.duck < 1.0)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        return state

    with caplog.at_level(logging.ERROR):
        running, played, state, health, spoken, ducked = run(go())
    os.close(held)
    assert running and played == 1  # the sounds play while the alexa player speaks
    assert state == health == "blocked" and spoken == []
    assert ducked  # its announcement still ducks the router's sounds
    assert "one owner" in caplog.text


def test_the_voice_lock_loop_takes_the_lock_once_it_frees(tmp_path, monkeypatch):
    held = try_lock(str(tmp_path / "lock"))
    r = router(tmp_path, announce=True, voice=False)
    real_sleep = asyncio.sleep

    async def fast(_s):
        await real_sleep(0.01)

    monkeypatch.setattr("stagehand.audio.module.asyncio.sleep", fast)

    async def go():
        task = asyncio.ensure_future(r._voice_lock_loop())
        await real_sleep(0.05)
        blocked = r.announce_state()
        os.close(held)
        await asyncio.wait_for(task, 1.0)
        return blocked

    assert run(go()) == "blocked" and r.announce_state() == "on" and r.speaks_announcements()


def test_a_blocked_announcement_is_dropped_not_queued_for_later(tmp_path, caplog):
    held = try_lock(str(tmp_path / "lock"))
    said: list[str] = []

    async def go():
        r = router(tmp_path, announce=True, voice=False, render_say=lambda t, v: said.append(t) or wav_bytes(0.05))
        r.apply(answer("v1"))
        r.announcements = asyncio.Queue()
        assert r.on_sim({"type": "directive", "verb": "announce", "args": "Hi."}) == "duck"
        r.announcements.put_nowait(Announcement(text="Hi."))  # e.g. off MQTT
        worker = asyncio.ensure_future(r._announce_worker())
        await asyncio.sleep(0.05)
        worker.cancel()
        return r

    with caplog.at_level(logging.WARNING):
        run(go())
    os.close(held)
    assert said == [] and "announcement dropped" in caplog.text


# -- the announcement duck when the alexa player speaks ------------------------------


def test_without_announce_each_announcement_ducks_the_beds_but_not_the_dance(tmp_path):
    r = with_house(router(tmp_path, play_sounds=True, no_duck=["dance_song"], duck_hold_s=7))
    write_wav(tmp_path / "sounds" / "beans_spill.wav", seconds=3)
    write_wav(tmp_path / "sounds" / "dance_song.wav", seconds=3)
    r.apply(answer("v1"))
    r.on_sim({"type": "directive", "verb": "sfx", "args": "beans_spill, rooms: start-bar"})  # 3, 4
    r.on_sim({"type": "directive", "verb": "sfx", "args": "dance_song, rooms: hall"})  # 5
    s = stream_of(r)
    before = s.pump(400)
    assert r.on_sim({"type": "directive", "verb": "announce", "args": "Five minutes."}) == "duck"
    for _ in range(25):
        out = s.pump(400)
    assert out[-1, 2] == pytest.approx(before[-1, 2] * 10 ** (-12 / 20), rel=0.05)  # the bed ducked
    assert out[-1, 4] == pytest.approx(before[-1, 4], rel=0.01)  # dance_song did not


def test_a_cue_can_say_duck_false_in_audio_json(tmp_path):
    r = with_house(router(tmp_path, play_sounds=True))
    cues = {**FIXTURE["audio"]["cues"], "rave": {"to": ["everywhere"], "duck": False}}
    r.apply(answer("v1", cues=cues))
    assert not r.ducks("rave") and r.ducks("beans_spill") and r.ducks("printer_grind")
    r2 = router(tmp_path, no_duck=["Hand_Jive"])
    r2.apply(answer("v1"))
    assert not r2.ducks("hand jive") and not r2.ducks("hand_jive")


def test_the_duck_hold_off_and_no_stream_mean_no_duck(tmp_path):
    r = router(tmp_path, duck_hold_s=0)
    r.apply(answer("v1"))
    assert r.on_sim({"type": "directive", "verb": "announce", "args": "Hi."}) is None
    assert router(tmp_path).on_sim({"type": "directive", "verb": "announce", "args": "Hi."}) is None  # no config yet


def test_an_announcing_router_never_ducks_on_the_feed_its_own_voice_does(tmp_path):
    r = router(tmp_path, announce=True, mqtt={"host": "127.0.0.1"})
    r.apply(answer("v1"))
    assert r.on_sim({"type": "directive", "verb": "announce", "args": "Hi."}) is None
    assert r.mixer.duck_hold == 0


# -- speaker tests -----------------------------------------------------------


def test_a_speaker_test_plays_tone_then_label_on_its_outputs(tmp_path):
    said: list[str] = []

    async def go():
        r = router(tmp_path, threaded=True, render_say=lambda t, v: said.append(t) or wav_bytes(0.05))
        r.apply(answer("v1"))
        assert await r.play_test(speaker="bar-1")
        await asyncio.sleep(0.15)
        s = stream_of(r)
        s.stop()
        return s

    s = run(go())
    assert said == ["Start Bar. Outputs 3, 4."]
    assert sorted({ch for block in s.out for ch in loud(block)}) == [3, 4]


def test_an_output_test_and_bad_targets(tmp_path):
    r = router(tmp_path)
    r.apply(answer("v1"))
    assert r.test_targets(None, 5) == ((5,), "Hall")
    assert r.test_targets(None, 12) == ((12,), "")
    assert r.test_targets("tent-spare", None) is None  # no output wired
    assert r.test_targets("nobody", None) is None
    assert r.test_targets(None, 99) is None


def test_new_tests_prime_then_play_each_once_across_a_server_restart(tmp_path):
    r = router(tmp_path)
    assert r.new_tests([{"seq": 4, "at": 1000, "speaker": "desk-l", "out": None}]) == []  # boot: primed
    assert r.test_seq == 4
    fresh = r.new_tests([{"seq": 4, "at": 1000}, {"seq": 5, "at": 2000, "out": 3}])
    assert [t["seq"] for t in fresh] == [5]
    assert r.new_tests([{"seq": 5, "at": 2000, "out": 3}]) == []
    # The server restarted: seq starts over, `at` keeps going.
    fresh = r.new_tests([{"seq": 1, "at": 9000, "out": 2}])
    assert [t["seq"] for t in fresh] == [1] and r.test_seq == 1
    assert r.new_tests(None) == [] and r.test_seq == 0


# -- the poll ----------------------------------------------------------------


class FakeMod:
    def __init__(self, answers):
        self.answers = list(answers)
        self.calls: list[tuple] = []

    async def get(self, path, params=None, timeout=None):
        self.calls.append((path, params, timeout))
        if path == "/api/spatial/house":
            return {"house": FIXTURE["house"], "version": "h1"}
        if not self.answers:
            await asyncio.sleep(3600)
        item = self.answers.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def test_the_poll_applies_long_polls_and_plays_new_tests(tmp_path):
    played: list[tuple] = []

    async def go():
        r = with_house(router(tmp_path))
        r.house = None

        async def fake_test(speaker=None, out=None):
            played.append((speaker, out))
            return True

        r.play_test = fake_test
        first = answer("v1")
        first["tests"] = [{"seq": 1, "at": 10, "speaker": "desk-l", "out": None}]
        second = answer("v1")
        second["tests"] = [{"seq": 1, "at": 10, "speaker": "desk-l"}, {"seq": 2, "at": 20, "speaker": None, "out": 7}]
        mod = FakeMod([first, second, answer("v2", cues={})])
        task = asyncio.ensure_future(r._config_loop(mod))
        for _ in range(100):
            await asyncio.sleep(0.01)
            if r.version == "v2" and r.house is not None:
                break
        task.cancel()
        return r, mod

    r, mod = run(go())
    polls = [c for c in mod.calls if c[0] == "/api/mod/audio"]
    # Every poll says it is the router (LA-4: the editor shows it listening);
    # the first ask returns at once (no `after`).
    assert polls[0][1]["router"] == 1 and polls[0][1]["name"] and "after" not in polls[0][1]
    assert {k: v for k, v in polls[1][1].items() if k not in ("router", "name")} == {"after": "v1", "tests": 1, "stops": 0, "wait": 25} and polls[1][2] == 40
    assert polls[1][1]["router"] == 1
    assert played == [(None, 7)]  # the boot answer's test was only primed
    assert r.version == "v2" and r.house == FIXTURE["house"]


def test_an_older_server_without_the_route_keeps_the_local_config(tmp_path, caplog):
    async def go():
        r = router(tmp_path)
        task = asyncio.ensure_future(r._config_loop(FakeMod([ModApiError("GET → 404", 404)])))
        await asyncio.sleep(0.05)
        task.cancel()
        return r

    with caplog.at_level(logging.ERROR):
        r = run(go())
    assert "older release" in caplog.text and r.doc is None


def test_the_stall_watchdog_reopens_a_silent_stream(tmp_path, caplog):
    r = router(tmp_path)
    r.apply(answer("v1"))
    first = stream_of(r)
    first.pump(64)
    assert not r.check_stream()  # it moved
    assert not r.check_stream()  # one quiet look is allowed
    with caplog.at_level(logging.ERROR):
        assert r.check_stream()  # two: reopened
    assert first.closed and stream_of(r) is not first and "stopped calling back" in caplog.text


def test_the_servers_default_doc_with_no_device_name_opens_the_default_output(tmp_path, caplog):
    # `defaultAudio()` (no project audio.json) has device.name "": PortAudio
    # reads "" as a substring every device matches and refuses it.
    def query(device=None, kind=None):
        if device is not None:
            raise ValueError(f"Multiple devices found for {device!r}")
        return fake_query(2, 2, name="MacBook Pro Speakers")(None, kind)

    r = router(tmp_path, query=query)
    default = {
        "version": 1,
        "device": {"name": "", "inputs": 16, "outputs": 16, "rate": 48000},
        "inputs": [{"ch": i, "label": f"In {i}", "kind": "line"} for i in range(1, 17)],
        "outputs": [{"ch": i, "label": f"Out {i}"} for i in range(1, 17)],
        "speakers": [], "zones": [], "routes": [], "cues": {},
    }
    with caplog.at_level(logging.WARNING):
        assert r.apply({"audio": default, "version": "d0", "source": "default"})
    assert r.engine_running() and "Speakers" in r.engine.describe()
    assert "names no device" in caplog.text
    assert r.test_targets(None, 1) == ((1,), "Out 1")


def test_health_reports_the_night(tmp_path):
    r = playing(tmp_path)
    r.on_sim({"type": "directive", "verb": "sfx", "args": "zip, rooms: hall"})
    stream_of(r).pump(200)
    h = r.health()
    assert h["ok"] and h["played"] == 1 and h["config"] == "v1" and h["blocks"] == 1
    assert h["peak_db"] > -20 and "MOTU" in h["device"]


def test_check_compares_the_device_with_the_cached_config(tmp_path, capsys):
    r = router(tmp_path, query=fake_query(8, 8))
    assert r.preflight() == []  # nothing cached: only the device is probed
    r.apply(answer("v1"))
    again = router(tmp_path, query=fake_query(8, 8))
    problems = again.preflight()
    assert len(problems) == 2 and "audio.json asks for 16" in problems[0]
    assert "8 in / 8 out" in capsys.readouterr().out


def test_check_fails_and_health_flags_a_moved_layout(tmp_path):
    """wave 18b (Q2): audio.json's `device.expect` against the device."""
    dev = {"name": "MOTU", "inputs": 16, "outputs": 16, "expect": {"inputs": 32, "outputs": 30}}
    r = router(tmp_path, query=fake_query(32, 26))
    r.apply(answer("v1", device=dev))
    problems = router(tmp_path, query=fake_query(32, 26)).preflight()
    assert len(problems) == 1 and "layout has moved" in problems[0]
    assert r.engine_running() and r.health()["layout"] == "moved"
    (tmp_path / "ok").mkdir()
    ok = router(tmp_path / "ok", query=fake_query(32, 30))
    ok.apply(answer("v1", device=dev))
    assert ok.preflight() == [] and ok.health()["layout"] == "ok"


def test_check_warns_about_missing_sound_files(tmp_path):
    r = router(tmp_path, play_sounds=True)
    r.apply(answer("v1"))
    write_wav(tmp_path / "sounds" / "zip.wav")
    warnings = router(tmp_path, play_sounds=True).warnings()
    missing = next(w for w in warnings if "no file for" in w).split("no file for ")[1].split(" in ")[0]
    assert missing == "dance_song, printer_grind"


class CheckMod:
    """A ModClient for `fetch_for_check`: one canned answer (or an error)."""

    calls: list = []

    def __init__(self, url, event="default", token=None, passcode=None, reply=None):
        self.reply = reply

    async def get(self, path, params=None, timeout=None):
        CheckMod.calls.append((path, params, timeout))
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply

    async def aclose(self):
        pass


def test_check_asks_the_server_when_nothing_is_cached(tmp_path):
    """LA-5: a fresh house Mac (no cache, no config_file) checks the device
    and the sound files against the server's audio.json, asked once."""
    server = types.SimpleNamespace(url="http://x", event="default", mod_token=None, mod_passcode="p")
    r = router(tmp_path, play_sounds=True, query=fake_query(8, 8))
    CheckMod.calls = []
    r.fetch_for_check(server, client_factory=lambda *a, **k: CheckMod(*a, reply=answer("v1"), **k))
    assert CheckMod.calls == [("/api/mod/audio", None, 3.0)]
    problems = r.preflight()
    assert problems and "audio.json asks for 16" in problems[0]
    warnings = r.warnings()
    missing = next(w for w in warnings if "no file for" in w)
    assert "dance_song" in missing and "beans_spill" in missing and "announce_chime" not in missing
    assert any("checked against the server's audio.json" in w for w in warnings)


def test_a_check_that_cannot_reach_the_server_warns_and_passes(tmp_path):
    server = types.SimpleNamespace(url="http://x", event="default", mod_token=None, mod_passcode="p")
    r = router(tmp_path, play_sounds=True)
    r.fetch_for_check(server, client_factory=lambda *a, **k: CheckMod(*a, reply=httpx.ConnectError("refused"), **k))
    assert r.preflight() == []
    assert any("could not ask the server" in w for w in r.warnings())
    # Something cached: the server is never asked.
    r.apply(answer("v1"))
    CheckMod.calls = []
    again = router(tmp_path)
    again.fetch_for_check(server, client_factory=lambda *a, **k: CheckMod(*a, reply=answer("v2"), **k))
    assert CheckMod.calls == []


def test_check_warns_about_sound_files_off_the_device_rate(tmp_path):
    r = router(tmp_path, play_sounds=True)
    r.apply(answer("v1", device={"name": "MOTU", "inputs": 16, "outputs": 16, "rate": RATE}))
    write_wav(tmp_path / "sounds" / "zip.wav", rate=RATE)
    write_wav(tmp_path / "sounds" / "beans_spill.wav", rate=44100)  # not a cue: any file counts
    warnings = router(tmp_path, play_sounds=True).warnings()
    off = next(w for w in warnings if "not at the device" in w)
    assert "beans_spill (44100 Hz)" in off and "zip" not in off and f"{RATE} Hz" in off



def test_sound_args_read_the_lowered_and_the_unlowered_form():
    assert sound_args("printer_grind") == ("printer_grind", None)
    assert sound_args("printer_grind, rooms: desktop start-bar") == ("printer_grind", "desktop start-bar")
    assert sound_args("printer_grind, in: The Desktop") == ("printer_grind", "The Desktop")
    assert sound_args("printer_grind with rooms: desktop") == ("printer_grind", "desktop")
    assert sound_args("") == ("", None)


class FakeBridge:
    def __init__(self, items):
        self.queue: asyncio.Queue = asyncio.Queue()
        for item in items:
            self.queue.put_nowait(item)
        self.published: list[tuple] = []

    def publish(self, topic, payload, retain=False, qos=0):
        self.published.append((topic, payload, retain))


def test_mqtt_tests_and_announcements(tmp_path):
    tested: list[tuple] = []

    async def go():
        r = router(tmp_path, announce=True, mqtt={"host": "127.0.0.1"})
        r.announcements = asyncio.Queue()

        async def fake_test(speaker=None, out=None):
            tested.append((speaker, out))
            return True

        r.play_test = fake_test
        r.mqtt = FakeBridge(
            [
                ("show/audio/test", b'{"speaker": "desk-l"}', False),
                ("show/audio/test", b'{"out": 3}', True),  # retained: never replayed
                ("show/audio/test", b"garbage", False),
                ("show/announce", b'{"text": "Five minutes."}', False),
                ("show/chime", b"{}", False),
            ]
        )
        task = asyncio.ensure_future(r._mqtt_loop())
        await asyncio.sleep(0.05)
        task.cancel()
        return [r.announcements.get_nowait() for _ in range(r.announcements.qsize())]

    queued = run(go())
    assert tested == [("desk-l", None)]
    assert queued == [Announcement(text="Five minutes."), "chime"]


def test_the_health_loop_publishes_stats(tmp_path):
    async def go():
        r = router(tmp_path, health_s=5)
        r.apply(answer("v1"))
        r.mqtt = FakeBridge([])
        r.cfg = type(r.cfg)(**{**r.cfg.__dict__, "health_s": 0.01})
        task = asyncio.ensure_future(r._health_loop())
        await asyncio.sleep(0.05)
        task.cancel()
        return r.mqtt.published

    published = run(go())
    topic, payload, retain = published[0]
    assert topic == "health/audio/stats" and retain and json.loads(payload)["config"] == "v1"


def test_on_the_real_rig_the_router_takes_every_qlab_sound_but_the_chime(tmp_path):
    import yaml

    house = Path(__file__).parents[1] / "trapped.house.yaml"
    doc = yaml.safe_load(house.read_text())
    assert "audio" not in doc  # off until the show switches it on
    before = parse_config(doc, str(tmp_path), only=["show"], env={}).modules["show"].cfg.cues
    after = parse_config({**doc, "audio": {"play_sounds": True}}, str(tmp_path), only=["show"], env={}).modules["show"].cfg.cues
    sounds = [r for r in before if r.on_directive == "sfx"]
    assert len(sounds) > 10
    left = [r for r in after if r.on_directive == "sfx"]
    assert [r.match.get("target") for r in left] == ["announce_chime"] and left[0].osc is None
    assert len(before) - len(after) == len(sounds) - 1


def test_run_end_to_end_with_a_fake_server(tmp_path):
    class FeedMod(FakeMod):
        def feed_url(self, client_id="stagehand"):
            assert client_id == "stagehand-audio"
            return "fake://feed"

        async def stream(self, url, on_open=None):
            on_open()
            await asyncio.sleep(0.05)  # the poll lands first
            yield "sim", json.dumps({"type": "directive", "verb": "sfx", "args": "zip, rooms: hall", "setting": None})
            await asyncio.sleep(3600)

    class Ctx:
        mod = FeedMod([answer("v1")])

    async def go():
        r = router(tmp_path, play_sounds=True)
        write_wav(tmp_path / "sounds" / "zip.wav")
        task = asyncio.ensure_future(r.run(Ctx()))
        for _ in range(100):
            await asyncio.sleep(0.01)
            if r.played:
                break
        stream = stream_of(r)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        return r, stream

    r, stream = run(go())
    assert r.played == 1 and r.house == FIXTURE["house"] and stream.closed
