"""The router's side of the house desk (wave 25, docs/loom-house-desk.md §4):
desk plays on the poll, their routing and gain, the acks and the health
report, and an older server that has none of it — no sound card, no server."""

from __future__ import annotations

import asyncio
import logging
import os

import numpy as np
import pytest

from stagehand.alexa.player import chime
from stagehand.audio import sounds as sounds_mod
from stagehand.audio.module import PLAY_STALE_S, HouseSay, play_gain, play_to
from stagehand.modapi import ModApiError

from test_audio_router import FakeBridge, FakeMod, answer, loud, playing, router, run, stream_of, wav_bytes, with_house, write_wav

REPORT = "/api/mod/audio/report"


def acks(mod: FakeMod) -> list[dict]:
    return [row for path, body in mod.posts if path == REPORT for row in body.get("acks", [])]


async def linked(r, mod: FakeMod):
    """What `run` does before any play: the loop and the server link."""
    r.loop = asyncio.get_running_loop()
    r._mod = mod
    return r


async def settle(n: int = 5) -> None:
    for _ in range(n):
        await asyncio.sleep(0)


# -- the cursor ----------------------------------------------------------------


def test_new_plays_prime_then_play_each_once_and_drop_stale_ones(tmp_path):
    r = router(tmp_path)
    assert r.new_plays([{"seq": 3, "at": 1000, "sound": "zip"}], 1500) == []  # boot: primed
    assert r.play_seq == 3
    fresh = r.new_plays([{"seq": 3, "at": 1000}, {"seq": 4, "at": 2000, "sound": "zip"}], 2500)
    assert [p["seq"] for p in fresh] == [4]
    assert r.new_plays([{"seq": 3, "at": 1000}, {"seq": 4, "at": 2000}], 2600) == []
    # Two GOs in the same millisecond are two plays, in either answer.
    assert [p["seq"] for p in r.new_plays([{"seq": 4, "at": 2000}, {"seq": 5, "at": 2000}], 2700)] == [5]
    # A restarted server's seqs start again; `at` keeps going.
    assert [p["seq"] for p in r.new_plays([{"seq": 1, "at": 9000}], 9100)] == [1] and r.play_seq == 1
    # Older than 10 s by the server's clock: never played (the desk gave up).
    assert r.new_plays([{"seq": 2, "at": 10_000}], 10_000 + PLAY_STALE_S * 1000 + 1) == [] and r.play_seq == 2
    # An older server sends no plays at all: the cursor is 0.
    assert r.new_plays(None, 1) == [] and r.play_seq == 0


def test_an_answer_with_no_plays_still_primes(tmp_path):
    r = router(tmp_path)
    assert r.new_plays([], 10) == []
    assert [p["seq"] for p in r.new_plays([{"seq": 1, "at": 20}], 25)] == [1]


def test_play_fields_are_read_defensively():
    assert play_gain(-6) == -6.0 and play_gain(40) == 12.0 and play_gain(-200) == -60.0
    assert play_gain(None) == 0.0 and play_gain(True) == 0.0 and play_gain("3") == 0.0
    assert play_to(None) is None and play_to([]) is None and play_to([" ", 3]) is None
    assert play_to("hall") == ["hall"] and play_to(["hall", " The Desktop "]) == ["hall", "The Desktop"]


# -- a sound play --------------------------------------------------------------


@pytest.mark.parametrize(
    "play, outs, why",
    [
        ({"sound": "beans_spill", "to": ["hall"]}, [5], "the play's own to"),
        ({"sound": "printer_grind", "to": ["start-bar"]}, [3, 4], "to beats the cue's to"),
        ({"sound": "beans_spill", "to": ["start-bar hall"]}, [3, 4, 5], "an entry splits like rooms:"),
        ({"sound": "beans_spill", "to": ["The Desktop"]}, [1, 2], "a spaced LOCATION stays whole"),
        ({"sound": "printer_grind", "to": None}, [1, 2], "no to: the cue's to"),
        ({"sound": "beans_spill"}, [1, 2, 3, 4, 5, 6, 7], "no to, no cue: everywhere"),
    ],
)
def test_a_sound_play_routes_like_a_story_sound(tmp_path, play, outs, why):
    async def go():
        r = await linked(playing(tmp_path), FakeMod([]))
        assert r.serve_play({"seq": 7, "at": 1, **play}) == "played", why
        await settle()
        return r

    r = run(go())
    assert loud(stream_of(r).pump(200)) == outs, why
    # The ack carries the file's length (write_wav: 0.05 s).
    assert acks(r._mod) == [{"seq": 7, "kind": "play", "result": "played", "ms": 50}]


def test_a_sound_plays_gain_adds_to_the_cue_and_the_speaker(tmp_path):
    async def go():
        r = await linked(playing(tmp_path), FakeMod([]))
        r.serve_play({"seq": 1, "at": 1, "sound": "printer_grind", "gain": -6})  # cue −4, desk-l 0 dB trim
        out = stream_of(r).pump(200)
        r.serve_play({"seq": 2, "at": 2, "sound": "beans_spill", "to": ["start-bar"], "gain": 3})  # bar-1 −3 dB trim
        out2 = stream_of(r).pump(200)
        return out, out2

    out, out2 = run(go())
    assert out[100, 0] == pytest.approx(0.25 * 10 ** (-10 / 20), rel=0.02)
    assert out2[100, 2] == pytest.approx(0.25 * 10 ** (0 / 20), rel=0.02)


def test_a_sound_play_that_cannot_play_is_acked_with_why(tmp_path):
    async def go():
        r = await linked(playing(tmp_path), FakeMod([]))
        r.serve_play({"seq": 1, "at": 1, "sound": "alarm_siren"})
        r.serve_play({"seq": 2, "at": 2, "sound": "zip"})  # its cue goes nowhere
        r.serve_play({"seq": 3, "at": 3, "sound": "beans_spill", "to": ["crawl"]})  # a room with no speaker
        r.serve_play({"seq": 4, "at": 4})  # neither sound nor say
        r.engine.close()
        r.serve_play({"seq": 5, "at": 5, "sound": "beans_spill"})
        await settle()
        return r

    r = run(go())
    assert [(a["seq"], a["result"], "ms" in a) for a in acks(r._mod)] == [
        (1, "no-file", False),
        (2, "nowhere", False),
        (3, "nowhere", False),
        (4, "error", False),
        (5, "closed", False),
    ]
    assert r.plays_done == 5


def test_a_sound_play_needs_no_play_sounds(tmp_path):
    """`play_sounds: false` hands the story's `sound X` to another player;
    the desk names the router's own files, so its plays still play."""

    async def go():
        r = with_house(router(tmp_path, play_sounds=False))
        write_wav(tmp_path / "sounds" / "beans_spill.wav")
        r.apply(answer("v1"))
        await linked(r, FakeMod([]))
        return r.serve_play({"seq": 1, "at": 1, "sound": "beans_spill", "to": ["hall"]})

    assert run(go()) == "played"


# -- a say play ----------------------------------------------------------------


def say_router(tmp_path, said: list | None = None, **over):
    def render(text, voice):
        if said is not None:
            said.append(text)
        return wav_bytes(0.1)

    r = with_house(router(tmp_path, announce=True, threaded=True, render_say=render, **over))
    r.apply(answer("v1"))  # announce.to: downstairs + The Tube → 1, 3, 4, 5, 6
    return r


async def speak(r, play: dict, *, wait_for: int = 1):
    mod = FakeMod([])
    await linked(r, mod)
    r.announcements = asyncio.Queue()
    worker = asyncio.ensure_future(r._announce_worker())
    assert r.serve_play(play) == "queued"
    for _ in range(400):
        await asyncio.sleep(0.01)
        if len(acks(mod)) >= wait_for and not r.mixer.active("announce"):
            break
    await asyncio.sleep(0.05)
    worker.cancel()
    s = stream_of(r)
    s.stop()
    return mod, s


def test_a_say_play_rings_the_chime_and_speaks_on_its_own_to(tmp_path):
    said: list[str] = []
    r = say_router(tmp_path, said)
    mod, s = run(speak(r, {"seq": 9, "at": 1, "say": "  The   bar is open. ", "to": ["hall"]}))
    assert said == ["The bar is open."]
    assert sorted({ch for block in s.out for ch in loud(block)}) == [5]
    [ack] = acks(mod)
    chime_ms = len(chime()) * 1000 / 48000
    assert ack["seq"] == 9 and ack["kind"] == "play" and ack["result"] == "played"
    assert ack["ms"] == pytest.approx(chime_ms + 100, abs=3)  # chime + the rendered speech


def test_a_say_play_without_chime_or_to_speaks_announce_to(tmp_path):
    r = say_router(tmp_path)
    mod, s = run(speak(r, {"seq": 2, "at": 1, "say": "Five minutes.", "to": None, "chime": False}))
    assert sorted({ch for block in s.out for ch in loud(block)}) == [1, 3, 4, 5, 6]
    assert acks(mod) == [{"seq": 2, "kind": "play", "result": "played", "ms": 100}]
    assert r.speaking is None and r.speaking_targets() == ("downstairs", "The Tube")


def test_a_say_play_to_nowhere_is_acked_nowhere(tmp_path):
    r = say_router(tmp_path)
    mod, _ = run(speak(r, {"seq": 3, "at": 1, "say": "Hello.", "to": ["crawl"]}))
    assert [(a["seq"], a["result"]) for a in acks(mod)] == [(3, "nowhere")]


def test_a_say_play_queued_before_a_stop_is_acked_closed(tmp_path):
    async def go():
        r = say_router(tmp_path)
        mod = FakeMod([])
        await linked(r, mod)
        r.announcements = asyncio.Queue()
        r.serve_play({"seq": 4, "at": 1, "say": "Never said."})
        r.stop_all(True, "Ada")  # the queue is emptied before the worker sees it
        r.serve_play({"seq": 5, "at": 2, "say": "Said."})
        r._announce_epoch += 1  # a stop the worker sees as the line comes up
        worker = asyncio.ensure_future(r._announce_worker())
        for _ in range(100):
            await asyncio.sleep(0.01)
            if acks(mod):
                break
        worker.cancel()
        stream_of(r).stop()
        return mod

    # seq 4 reached the queue after the stop's drain but carries the old
    # stamp; seq 5 came up after a later stop: neither is ever spoken.
    assert [(a["seq"], a["result"]) for a in acks(run(go()))] == [(4, "closed"), (5, "closed")]


def test_a_say_play_on_a_router_that_does_not_announce_is_an_error(tmp_path):
    async def go():
        r = await linked(playing(tmp_path), FakeMod([]))  # announce: false
        assert r.serve_play({"seq": 6, "at": 1, "say": "Hello."}) == "error"
        await settle()
        return r

    assert [(a["seq"], a["result"]) for a in acks(run(go())._mod)] == [(6, "error")]


def test_a_say_play_is_clipped_like_an_announcement(tmp_path):
    async def go():
        r = with_house(router(tmp_path, announce=True))
        r.apply(answer("v1"))
        await linked(r, FakeMod([]))
        r.announcements = asyncio.Queue()
        r.serve_play({"seq": 1, "at": 1, "say": "word " * 200, "to": "hall", "chime": True})
        await settle()
        return r.announcements.get_nowait()[1]

    item = run(go())
    assert isinstance(item, HouseSay) and len(item.text) <= 300 and item.to == ("hall",) and item.chime and item.seq == 1


# -- the poll ------------------------------------------------------------------


def test_the_poll_sends_the_plays_cursor_primes_then_plays(tmp_path):
    async def go():
        r = playing(tmp_path)
        first = answer("v1")
        first["plays"], first["now"] = [{"seq": 1, "at": 10, "by": "old", "sound": "beans_spill", "to": None, "gain": None}], 20
        second = answer("v1")
        second["plays"] = [first["plays"][0], {"seq": 2, "at": 30, "by": "Ada", "sound": "beans_spill", "to": ["hall"], "gain": None}]
        second["now"] = 40
        third = answer("v1")
        third["plays"], third["now"] = second["plays"], 50  # the same list again: nothing new
        mod = FakeMod([first, second, third])
        await linked(r, mod)
        r.version = None  # a booting router: the first ask returns at once
        task = asyncio.ensure_future(r._config_loop(mod))
        for _ in range(100):
            await asyncio.sleep(0.01)
            if len(mod.calls) >= 4:
                break
        task.cancel()
        return r, mod

    r, mod = run(go())
    polls = [c[1] for c in mod.calls if c[0] == "/api/mod/audio"]
    assert "plays" not in polls[0] and polls[1]["plays"] == 1 and polls[2]["plays"] == 2
    assert r.played == 1 and r.plays_done == 1  # the boot answer's play was only primed
    assert [(a["seq"], a["result"]) for a in acks(mod)] == [(2, "played")]


def test_a_stop_and_a_play_in_one_answer_act_in_the_order_pressed(tmp_path):
    order: list[str] = []

    async def go():
        r = playing(tmp_path)
        r.stop_all = lambda announce=False, by="": order.append(f"stop {by}") or True  # type: ignore[method-assign]
        r.serve_play = lambda p: order.append(f"play {p['seq']}") or "played"  # type: ignore[method-assign]
        first = answer("v1")
        first["now"] = 0
        second = answer("v1")
        second["stops"] = [{"seq": 1, "at": 20, "by": "Ada", "announce": False}]
        second["plays"] = [{"seq": 1, "at": 10, "sound": "zip"}, {"seq": 2, "at": 30, "sound": "zip"}]
        second["now"] = 35
        mod = FakeMod([first, second])
        r.version = None
        task = asyncio.ensure_future(r._config_loop(mod))
        for _ in range(100):
            await asyncio.sleep(0.01)
            if len(order) >= 3:
                break
        task.cancel()

    run(go())
    assert order == ["play 1", "stop Ada", "play 2"]


def test_a_server_test_is_acked_with_tone_and_label_length(tmp_path):
    async def go():
        r = router(tmp_path, threaded=True, render_say=lambda t, v: wav_bytes(0.25))
        r.apply(answer("v1"))
        got: list = []
        assert await r.play_test(speaker="bar-1", on_ack=lambda result, ms: got.append((result, round(ms))))
        assert not await r.play_test(speaker="nobody", on_ack=lambda result, ms: got.append((result, ms)))
        s = stream_of(r)
        r.engine.close()
        assert not await r.play_test(speaker="bar-1", on_ack=lambda result, ms: got.append((result, ms)))
        s.stop()
        return got

    assert run(go()) == [("played", 1750), ("nowhere", None), ("closed", None)]


# -- the report ----------------------------------------------------------------


def test_an_older_server_without_the_report_is_logged_once(tmp_path, caplog):
    async def go():
        r = playing(tmp_path)
        mod = FakeMod([], post_error=ModApiError("POST → 404", 404))
        await linked(r, mod)
        for seq in (1, 2, 3):
            assert r.serve_play({"seq": seq, "at": seq, "sound": "beans_spill"}) == "played"
        await settle()
        assert not await r.report({"health": {}})
        return r, mod

    with caplog.at_level(logging.INFO):
        r, mod = run(go())
    assert caplog.text.count("older release") == 1 and r.played == 3 and len(mod.posts) == 4


def test_a_failing_report_warns_rarely_and_never_raises(tmp_path, caplog):
    import httpx

    async def go():
        r = playing(tmp_path)
        await linked(r, FakeMod([], post_error=httpx.ConnectError("down")))
        r.serve_play({"seq": 1, "at": 1, "sound": "beans_spill"})
        r.serve_play({"seq": 2, "at": 2, "sound": "beans_spill"})
        await settle()
        return r

    with caplog.at_level(logging.WARNING):
        r = run(go())
    assert caplog.text.count("router report failed") == 1 and r.played == 2


def test_no_ack_without_a_seq_or_a_link(tmp_path):
    async def go():
        r = await linked(playing(tmp_path), FakeMod([]))
        r.ack("play", None, "played")
        r.ack("play", True, "played")
        mod = r._mod
        r._mod = None
        r.ack("play", 1, "played")
        await settle()
        return mod

    assert run(go()).posts == []


def test_the_health_loop_reports_the_stats_and_every_sound_file(tmp_path):
    async def go():
        r = playing(tmp_path, health_s=5)
        write_wav(tmp_path / "sounds" / "long.wav", seconds=1.5)
        (tmp_path / "sounds" / "notes.txt").write_text("not a sound")
        mod = FakeMod([])
        await linked(r, mod)
        r.mqtt = FakeBridge([])
        r.cfg = type(r.cfg)(**{**r.cfg.__dict__, "health_s": 0.01})
        task = asyncio.ensure_future(r._health_loop())
        for _ in range(100):
            await asyncio.sleep(0.01)
            if mod.posts:
                break
        task.cancel()
        return r, mod

    r, mod = run(go())
    path, body = mod.posts[0]
    h = body["health"]
    assert path == REPORT and set(body) == {"health"}
    assert set(h) == {"ok", "device", "layout", "voices", "xruns", "peakDb", "announce", "missing", "placeholders", "sounds", "inputs", "sources", "underruns"}
    # Wave 38 (C2): the input meters (none pumped yet), the sources, the underruns.
    assert h["inputs"] == {} and h["sources"] == {"announce": 0.0, "takeover": 0.0} and h["underruns"] == 0
    assert h["ok"] is True and "MOTU" in h["device"] and h["layout"] == "ok" and h["announce"] == "off"
    assert h["sounds"] == {"Motorcycle": 50, "beans_spill": 50, "dance_song": 50, "long": 1500, "printer_grind": 50, "zip": 50}
    assert r.mqtt.published  # the MQTT stats go out as ever


def test_sound_lengths_are_cached_by_mtime_and_a_real_file_beats_a_placeholder(tmp_path, monkeypatch):
    d = tmp_path / "s"
    d.mkdir()
    write_wav(d / "a.wav", seconds=0.5)
    write_wav(d / "b.wav", seconds=0.25)
    (d / "bad.wav").write_bytes(b"not audio")
    calls: list[str] = []

    def measure(p):
        calls.append(p.name)
        return sounds_mod.length_ms(p)

    sounds_mod._lengths.clear()
    assert sounds_mod.sound_lengths(d, measure) == {"a": 500, "b": 250}
    assert sounds_mod.sound_lengths(d, measure) == {"a": 500, "b": 250}
    assert sorted(calls) == ["a.wav", "b.wav", "bad.wav"]  # read once each
    write_wav(d / "a.wav", seconds=1.0)
    st = os.stat(d / "a.wav")
    os.utime(d / "a.wav", (st.st_atime, st.st_mtime + 5))
    assert sounds_mod.sound_lengths(d, measure)["a"] == 1000 and calls.count("a.wav") == 2
    # A real `c.aiff` beside a placeholder `c.wav` is the one that plays.
    monkeypatch.setattr(sounds_mod, "is_placeholder", lambda p: p.suffix == ".wav" and p.stem == "c")
    write_wav(d / "c.wav", seconds=0.1)
    import soundfile as sf

    sf.write(str(d / "c.aiff"), np.zeros((800, 1), dtype=np.float32), 8000)
    assert sounds_mod.sound_lengths(d, measure)["c"] == 100
    assert sounds_mod.sound_lengths(tmp_path / "missing") == {}


# -- MQTT hand play --------------------------------------------------------------


def test_mqtt_hand_play_takes_an_optional_gain(tmp_path):
    async def go():
        r = playing(tmp_path, mqtt={"host": "127.0.0.1"})
        r.mqtt = FakeBridge([("show/audio/play", b'{"name": "beans_spill", "to": "hall", "gain": -6}', False)])
        task = asyncio.ensure_future(r._mqtt_loop())
        await asyncio.sleep(0.05)
        task.cancel()
        return r

    r = run(go())
    out = stream_of(r).pump(200)
    assert r.played == 1 and loud(out) == [5]
    assert out[100, 4] == pytest.approx(0.25 * 10 ** (-6 / 20), rel=0.02)


def test_a_stop_with_announcements_acks_every_queued_say_closed(tmp_path):
    async def go():
        r = say_router(tmp_path)
        mod = FakeMod([])
        await linked(r, mod)
        r.announcements = asyncio.Queue()
        r.announcements.put_nowait((r._announce_epoch, HouseSay(text="One.", seq=11)))
        r.announcements.put_nowait((r._announce_epoch, "chime"))
        r.stop_all(True, "Ada")
        await settle()
        stream_of(r).stop()
        return mod

    assert acks(run(go())) == [{"seq": 11, "kind": "play", "result": "closed"}]
