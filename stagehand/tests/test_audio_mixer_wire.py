"""The router's side of the house mixer (wave 40, C3): the mix from the
poll (cursors, the cache), the music commands, the live meters loop, the
MQTT `next` per playlist — a fake stream, a fake server."""

from __future__ import annotations

import asyncio
import json

import numpy as np
import pytest

from stagehand.audio import module as audio_module
from stagehand.audio.module import METERS_PATH, MIX_CACHE, MUSIC_STALE_S
from stagehand.modapi import ModApiError

from test_audio_router import FakeBridge, FakeMod, answer, loud, music_router, playing, router, run, spin, stream_of, with_house

RATE = 8000


def lv(db: float = 0.0, mute: bool = False) -> dict:
    return {"db": db, "mute": mute}


def mixed(version: str = "v1", seq: int = 1, levels: dict | None = None, **more) -> dict:
    a = answer(version)
    a.update({"mix": {"seq": seq, "levels": levels or {}}, "music": [], "mixWatch": False, "now": 0, **more})
    return a


async def poll(r, answers: list, *, until=lambda r, mod: False, polls: int | None = None, mod: FakeMod | None = None):
    mod = mod or FakeMod(answers)
    r.loop = asyncio.get_running_loop()
    r._mod = mod
    r.version = None if r.version is None else r.version
    task = asyncio.ensure_future(r._config_loop(mod))
    want = polls if polls is not None else len(answers) + 1
    for _ in range(200):
        await asyncio.sleep(0.01)
        if len([c for c in mod.calls if c[0] == "/api/mod/audio"]) >= want and until(r, mod):
            break
    task.cancel()
    return mod


def audio_polls(mod: FakeMod) -> list[dict]:
    return [c[1] for c in mod.calls if c[0] == "/api/mod/audio"]


# -- the mix ---------------------------------------------------------------------


def test_the_mix_applies_when_its_seq_moves_and_mutes_a_room(tmp_path):
    r = playing(tmp_path)
    assert r.on_sim({"type": "directive", "verb": "sfx", "args": "beans_spill"}) == "played"
    assert loud(stream_of(r).pump(200)) == [1, 2, 3, 4, 5, 6, 7]
    assert r.apply_mix({"seq": 4, "levels": {"room:start-bar": lv(0, True), "bogus": lv(-3)}})
    assert r.mix_levels == {"room:start-bar": (0.0, True)} and r.mix_seq == 4
    assert not r.apply_mix({"seq": 4, "levels": {}})  # the same seq: nothing moved
    assert not r.apply_mix({"levels": {}}) and not r.apply_mix(None)  # an older server's answer
    s = stream_of(r)
    s.pump(600)  # the first sound ends; the mix has ramped (TRIM_S)
    r.on_sim({"type": "directive", "verb": "sfx", "args": "beans_spill"})
    assert loud(s.pump(200)) == [1, 2, 5, 6, 7]  # bar-1 (3, 4) muted, nowhere else
    # Cached beside audio.json: a router started offline keeps the balance.
    cached = json.loads((tmp_path / "cache" / MIX_CACHE).read_text())
    assert cached == {"seq": 4, "levels": {"room:start-bar": {"db": 0.0, "mute": True}}}
    again = router(tmp_path, play_sounds=True)
    assert again.load_local() and again.mix_seq == 4 and again.mix_levels == {"room:start-bar": (0.0, True)}
    stream_of(again).pump(10)  # a fresh stream starts at the mix
    assert not again.mixer.mix_gain[:, 2].any() and (again.mixer.mix_gain[:, 0] == 1.0).all()
    # The stats carry the mix (`stagehand music status` prints it); the report does not.
    h = r.health()
    assert h["mix"] == {"seq": 4, "levels": {"room:start-bar": {"db": 0.0, "mute": True}}}
    assert "mix" not in r.report_health(h, {})


def test_a_muted_room_never_mutes_a_speaker_test(tmp_path):
    async def go():
        r = with_house(router(tmp_path, threaded=True))
        r.apply(answer("v1"))
        r.apply_mix({"seq": 1, "levels": {"room:start-bar": lv(0, True), "master": lv(-20)}})
        assert await r.play_test(speaker="bar-1")
        await asyncio.sleep(0.1)
        s = stream_of(r)
        s.stop()
        return s

    s = run(go())
    out = np.concatenate(s.out)
    assert loud(out) == [3, 4]
    assert np.abs(out[:, 2]).max() > 0.05  # at the test's own level, not −20 dB


def test_the_poll_sends_the_mix_music_and_watch_cursors(tmp_path):
    async def go():
        r = router(tmp_path)
        first = mixed("v1", seq=3, levels={"master": lv(-6)})
        first["music"] = [{"seq": 2, "at": -1, "by": "old", "action": "stop"}]
        second = mixed("v1", seq=3, mixWatch=True)
        second["levels"] = None
        third = mixed("v1", seq=5, levels={}, mixWatch=True)
        mod = await poll(r, [first, second, third], until=lambda r, mod: r.mix_seq == 5)
        return r, mod

    r, mod = run(go())
    polls = audio_polls(mod)
    assert "mix" not in polls[0] and "music" not in polls[0]  # the boot ask: no cursors at all
    assert (polls[1]["mix"], polls[1]["music"], polls[1]["watch"]) == (3, 2, 0)  # primed by the first answer
    assert (polls[2]["mix"], polls[2]["watch"]) == (3, 1)  # mixWatch moved: the router says so
    assert polls[3]["mix"] == 5 and r.mix_levels == {}
    assert r.music_done == 0  # the boot answer's command was only primed


def test_new_music_primes_then_serves_each_once_and_drops_stale_ones(tmp_path):
    r = router(tmp_path)
    assert r.new_music([{"seq": 1, "at": 1000, "action": "next"}], 1500) == []
    fresh = r.new_music([{"seq": 1, "at": 1000}, {"seq": 2, "at": 2000, "action": "next"}], 2500)
    assert [e["seq"] for e in fresh] == [2] and r.music_seq == 2
    assert r.new_music([{"seq": 2, "at": 2000}], 2600) == []
    assert r.new_music([{"seq": 3, "at": 3000, "action": "stop"}], 3000 + MUSIC_STALE_S * 1000 + 1) == []
    assert r.new_music(None, 1) == [] and r.music_seq == 0


def test_music_commands_act_in_press_order_with_the_stops_and_plays(tmp_path):
    order: list[str] = []

    async def go():
        r = playing(tmp_path)
        r.stop_all = lambda announce=False, by="": order.append(f"stop {by}") or True  # type: ignore[method-assign]
        r.serve_play = lambda p: order.append(f"play {p['seq']}") or "played"  # type: ignore[method-assign]
        r.serve_music = lambda e: order.append(f"music {e['action']}") or e["action"]  # type: ignore[method-assign]
        second = mixed("v1", now=100)
        second["stops"] = [{"seq": 1, "at": 30, "by": "Ada"}]
        second["plays"] = [{"seq": 1, "at": 10, "sound": "zip"}]
        second["music"] = [{"seq": 1, "at": 20, "by": "Bo", "action": "next"}, {"seq": 2, "at": 40, "by": "Bo", "action": "story"}]
        await poll(r, [mixed("v1"), second], until=lambda r, mod: len(order) >= 4)

    run(go())
    assert order == ["play 1", "music next", "stop Ada", "music story"]


def test_serve_music_drives_the_director(tmp_path):
    async def go():
        r = with_house(music_router(tmp_path))
        r.loop = asyncio.get_running_loop()
        r._mod = FakeMod([{"night": {"music": "two"}}])
        r.apply(answer("v1"))
        r.on_sim({"type": "directive", "verb": "cue", "args": "music_one"})
        spin(r, 5)
        skipped: list = []
        real = r.music.next
        r.music.next = lambda playlist=None: skipped.append(playlist) or real(playlist)  # type: ignore[method-assign]
        assert r.serve_music({"seq": 1, "at": 1, "action": "next", "playlist": "b"}) == "next"
        assert r.serve_music({"seq": 2, "at": 2, "action": "next"}) == "next"
        assert skipped == ["b", None]
        assert r.serve_music({"seq": 3, "at": 3, "action": "scene", "scene": "two", "by": "Ada"}) == "scene"
        assert r.music.scene == "two" and r._music_hand and r.music_status()["hand"] is True
        assert r.serve_music({"seq": 4, "at": 4, "action": "scene", "scene": "rave"}) is None  # no such scene
        assert r.serve_music({"seq": 5, "at": 5, "action": "stop"}) == "stop"
        assert r.music.scene == "off" and r._music_hand
        # A catch-up (a feed reconnect) holds against the hand…
        assert await r.music_catch_up("feed") is None and r.music.scene == "off"
        # …until the story is followed again: the catch-up runs now.
        assert r.serve_music({"seq": 6, "at": 6, "action": "story"}) == "story"
        assert not r._music_hand
        await r._music_catch_up
        assert r.music.scene == "two"
        assert r.serve_music({"seq": 7, "at": 7, "action": "dance"}) is None
        return r

    r = run(go())
    assert r.music_done == 7


def test_a_router_with_no_soundtrack_ignores_music_commands(tmp_path):
    r = router(tmp_path)
    assert r.serve_music({"seq": 1, "at": 1, "action": "next"}) is None


def test_mqtt_next_takes_a_playlist(tmp_path):
    async def go():
        r = with_house(music_router(tmp_path, mqtt={"host": "127.0.0.1"}))
        r.apply(answer("v1"))
        got: list = []
        r.music.next = lambda playlist=None: got.append(playlist) or 1  # type: ignore[method-assign]
        r.mqtt = FakeBridge([("show/audio/music", b'{"next": true, "playlist": "b"}', False), ("show/audio/music", b'{"next": true}', False)])
        task = asyncio.ensure_future(r._mqtt_loop())
        await asyncio.sleep(0.05)
        task.cancel()
        return got

    assert run(go()) == ["b", None]


# -- the live meters ----------------------------------------------------------------


class MetersMod(FakeMod):
    """A fake server whose meters route answers from a script (`watch`
    values, or an exception)."""

    def __init__(self, answers, meters):
        super().__init__(answers)
        self.meters = list(meters)

    async def post(self, path, body):
        self.posts.append((path, body))
        if path != METERS_PATH:
            return {"ok": True}
        step = self.meters.pop(0) if self.meters else True
        if isinstance(step, Exception):
            raise step
        return {"ok": True, "watch": step}


def meters_posts(mod: FakeMod) -> list[dict]:
    return [b for p, b in mod.posts if p == METERS_PATH]


def test_the_meters_body(tmp_path):
    async def go():
        r = with_house(music_router(tmp_path))
        r.apply(answer("v1"))
        r.on_sim({"type": "directive", "verb": "cue", "args": "music_one"})
        mod = MetersMod([], [True])
        r._mod = mod
        r.mixer.take_live()
        spin(r, 5)
        assert await r.send_meters()
        return mod

    [body] = meters_posts(run(go()))
    assert set(body) == {"outputs", "inputs", "sources", "buses", "music"}
    assert len(body["outputs"]) == 16 and body["outputs"]["1"] == pytest.approx(20 * np.log10(0.2), abs=0.2)
    assert body["outputs"]["16"] == -120.0 and body["inputs"]["3"] == -120.0
    assert set(body["buses"]) == {"music", "tracks", "sfx", "announce"}
    assert body["buses"]["music"]["1"] == pytest.approx(20 * np.log10(0.2), abs=0.2) and body["buses"]["sfx"]["1"] == -120.0
    assert body["sources"]["announce"] == 0.0
    music = body["music"]
    assert music["scene"] == "one" and music["hand"] is False and "off" in music["scenes"]
    assert music["beds"][0]["durS"] > 0 and "posS" in music["beds"][0]
    json.dumps(body)


def test_the_meters_loop_starts_on_mix_watch_and_stops_on_watch_false(tmp_path, monkeypatch):
    monkeypatch.setattr(audio_module, "METERS_EVERY_S", 0.01)

    async def go():
        r = router(tmp_path)
        r.apply(answer("v1"))
        mod = MetersMod([], [True, True, False])
        r._mod = mod
        task = asyncio.ensure_future(r._meters_loop())
        await asyncio.sleep(0.08)
        quiet = len(meters_posts(mod))  # nobody watches: nothing sent
        r.mix_watch = True  # the GET's mixWatch
        for _ in range(100):
            await asyncio.sleep(0.01)
            if len(meters_posts(mod)) >= 3:
                break
        await asyncio.sleep(0.08)
        task.cancel()
        return r, mod, quiet

    r, mod, quiet = run(go())
    assert quiet == 0
    assert len(meters_posts(mod)) == 3  # watch, watch, then watch: false stopped it
    assert not r.mix_watch and not r._meters_watch and r.meters_sent == 3


def test_the_meters_answer_alone_keeps_them_going_and_a_404_ends_them(tmp_path, monkeypatch):
    monkeypatch.setattr(audio_module, "METERS_EVERY_S", 0.01)

    async def go():
        r = router(tmp_path)
        r.apply(answer("v1"))
        mod = MetersMod([], [True, ModApiError("POST → 404", 404)])
        r._mod = mod
        r.mix_watch = True
        task = asyncio.ensure_future(r._meters_loop())
        await asyncio.sleep(0.02)
        r.mix_watch = False  # the GET has moved on, but the meters said watch
        await asyncio.sleep(0.1)
        task.cancel()
        return r, mod

    r, mod = run(go())
    assert len(meters_posts(mod)) == 2 and r._meters_gone and not r.meters_wanted()


def test_a_failed_meters_post_is_retried(tmp_path):
    async def go():
        r = router(tmp_path)
        r.apply(answer("v1"))
        r._mod = MetersMod([], [OSError("down"), True])
        r.mix_watch = True
        return [await r.send_meters(), await r.send_meters(), r.meters_wanted()]

    assert run(go()) == [False, True, True]


def test_no_meters_without_a_stream_or_a_server(tmp_path):
    r = router(tmp_path)
    r.mix_watch = True
    assert not r.meters_wanted()  # no stream yet
    r.apply(answer("v1"))
    assert not r.meters_wanted()  # no server link
