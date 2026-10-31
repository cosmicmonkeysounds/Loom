"""The Music manager and Trabolta at the stereo (wave 58, the music contract's C2-C4): a
held pause, previous and the library against the fake page; a playlist by hand
and a pause on a real Mixer; who wins between the story, a director and him."""

from __future__ import annotations

import asyncio
import json

from stagehand.audio.soundtrack import HAND_PREFIX, SILENT_S, parse_soundtrack, scene_of_cue, stereo_of_cue
from stagehand.audio.tidal import LIBRARY_EVERY_S, LIBRARY_JS, LIBRARY_MAX

from test_audio_router import FakeMod, answer, music_router, run, spin, with_house
from test_audio_tidal import ACT_1, ACT_2, Clock, FakeLive, FakePage, remote, rig
from test_audio_tidal import run as frames

LIB = [{"id": ACT_1, "title": "TITI - Act 1", "items": 19}, {"id": ACT_2, "title": "TITI - Act 2", "items": 16}]


# -- the app ---------------------------------------------------------------------


def playing(page=None, clock=None):
    r, p = remote(page, clock)
    r.want(ACT_1)
    r.step()
    p.clicks.clear()
    return r, p


def test_a_held_pause_stays_paused_where_a_stray_one_resumes():
    r, p = playing()
    r.pause(True)
    r.step()
    assert p.clicks == ["pause"] and p.playing is False
    p.clicks.clear()
    r.step()
    r.step()
    assert p.clicks == []
    r.pause(False)
    r.step()
    assert p.clicks == ["play"] and p.playing is True


def test_previous_clicks_previous_once_each_on_the_wanted_playlist():
    r, p = playing()
    r.previous()
    r.previous()
    r.step()
    assert p.clicks == ["previous", "previous"]
    p.clicks.clear()
    r.step()
    assert p.clicks == []


def test_previous_before_the_app_is_told_presses_nothing():
    r, p = remote()
    r.previous()
    r.step()
    assert p.clicks == []


def test_the_library_is_read_before_the_first_word_and_every_so_often():
    clock = Clock()
    page = FakePage()
    page.library = LIB
    r, p = remote(page, clock)
    r.step()
    assert r.library == LIB and p.clicks == [] and p.loads == []
    page.library = LIB[:1]
    r.step()
    assert r.library == LIB
    clock.now += LIBRARY_EVERY_S + 1
    r.step()
    assert r.library == LIB[:1]


def test_a_library_that_fails_keeps_the_last_list_and_breaks_nothing():
    clock = Clock()
    page = FakePage()
    page.library = LIB
    r, _ = remote(page, clock)
    r.want(ACT_1)
    r.step()
    page.library = RuntimeError("the page is busy")
    clock.now += LIBRARY_EVERY_S + 1
    r.step()
    assert r.library == LIB and r.error is None and not r.down


def test_the_library_drops_useless_rows_and_stops_at_its_cap():
    page = FakePage()
    page.library = [{"id": ACT_1}, {"title": "no id"}, *[{"id": ACT_1, "title": f"p{i}"} for i in range(LIBRARY_MAX + 5)]]
    r, _ = remote(page)
    r.step()
    assert len(r.library) == LIBRARY_MAX and r.library[0]["title"] == "p0"


def test_the_sidebar_script_names_the_sidebar():
    assert "main-layout-sidebar-wrapper" in LIBRARY_JS and "/playlist/" in LIBRARY_JS


# -- the director ------------------------------------------------------------------


def test_a_pause_holds_the_app_and_any_scene_change_lets_go(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("a")
    frames(d, mixer, 0.5)
    assert d.pause(True) is True
    assert live.holds == [True] and d.paused
    d.set_scene("b")
    assert live.holds == [True, False] and not d.paused


def test_the_same_scene_again_keeps_the_pause(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("a")
    frames(d, mixer, 0.5)
    d.pause(True)
    d.set_scene("a")
    assert d.paused and live.holds == [True]


def test_stop_lets_go_of_a_pause(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("a")
    frames(d, mixer, 0.5)
    d.pause(True)
    d.stop(0.1)
    assert not d.paused and live.holds == [True, False]


def test_a_file_bed_has_no_pause_and_no_previous(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("c")
    frames(d, mixer, 0.5)
    assert d.pause(True) is False and live.holds == [] and not d.paused
    assert d.previous() == 0 and live.backs == 0


def test_previous_reaches_the_app_on_a_live_bed(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("a")
    frames(d, mixer, 0.5)
    assert d.previous() == 1 and live.backs == 1


def test_a_paused_app_is_not_a_silent_cable(tmp_path):
    live = FakeLive()
    d, mixer, _ = rig(tmp_path, live=live)
    d.set_scene("a")
    frames(d, mixer, 0.5)
    d.pause(True)
    live.quiet = SILENT_S + 5
    frames(d, mixer, SILENT_S + 2)
    assert [bed.live for bed in d.beds.values()] == [True]


def test_letting_go_restarts_the_silent_clock(tmp_path):
    live = FakeLive()
    d, mixer, _ = rig(tmp_path, live=live)
    d.set_scene("a")
    frames(d, mixer, 0.5)
    d.pause(True)
    live.quiet = SILENT_S + 5
    frames(d, mixer, SILENT_S + 2)
    d.pause(False)
    frames(d, mixer, 1.0)
    assert [bed.live for bed in d.beds.values()] == [True]


def test_a_show_playlist_by_hand_takes_the_scenes_speakers(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("a")
    frames(d, mixer, 0.5)
    assert d.play_playlist("two") is True
    assert d.scene == f"{HAND_PREFIX}two" and list(d.beds) == ["two"]
    frames(d, mixer, 2.0)
    assert live.wants[-1] == ACT_2


def test_an_unknown_playlist_changes_nothing(tmp_path):
    d, mixer, _ = rig(tmp_path)
    d.set_scene("a")
    assert d.play_playlist("nope") is False and d.scene == "a"


def test_any_tidal_playlist_by_hand_stays_out_of_the_lists(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("a")
    frames(d, mixer, 0.5)
    other = "9e3a60bc-df4c-4c05-a56f-76ef3c20a8fc"
    assert d.play_tidal(other) is True
    frames(d, mixer, 2.0)
    assert live.wants[-1] == other
    st = d.status()
    assert not any(s.startswith(HAND_PREFIX) for s in st["scenes"])
    assert not any(p["name"].startswith("tidal_") for p in st["playlists"])
    assert st["tidal"]["online"] is True and st["beds"][0]["live"] is True


def test_a_tidal_pick_needs_a_real_id(tmp_path):
    d, _, _ = rig(tmp_path)
    assert d.play_tidal("not-an-id") is False


def test_a_looping_bed_runs_on_under_a_hand_playlist(tmp_path):
    (tmp_path / "act").mkdir()
    (tmp_path / "act" / "song.mp3").write_bytes(b"x")
    (tmp_path / "loop.wav").write_bytes(b"x")
    st = parse_soundtrack(
        {
            "playlists": {"one": {"dir": "act"}, "two": {"dir": "act"}, "dryer": {"files": ["loop.wav"], "loop": True}},
            "scenes": {"a": [{"to": "everywhere", "play": "one"}, {"to": "The Fan Closet", "play": "dryer"}]},
        },
        tmp_path,
    )
    d, _, _ = rig(tmp_path)
    d.st = st
    d.scene = "a"
    name = d._hand_scene(st.playlists["two"])
    assert [e.play for e in d.st.scenes[name]] == ["two", "dryer"]
    assert [e.play for e in st.scenes["a"]] == ["one", "dryer"]


def test_with_nothing_playing_a_pick_plays_everywhere(tmp_path):
    d, mixer, _ = rig(tmp_path)
    d.set_scene("off")
    assert d.play_playlist("two") is True
    assert list(d.beds) == ["two"]


# -- the feed's wire ----------------------------------------------------------------


def test_the_cue_reads_as_a_stereo_cue_and_never_as_a_scene():
    assert stereo_of_cue("music, action: skip") == {"action": "skip"}
    assert stereo_of_cue("music, action: play, playlist: act_2") == {"action": "play", "playlist": "act_2"}
    assert stereo_of_cue("music") is None
    assert stereo_of_cue("music_act_1") is None
    assert stereo_of_cue("lights, room: The Start Bar, state: off") is None
    assert stereo_of_cue(None) is None
    assert scene_of_cue("music, action: skip") is None


# -- who wins (the music contract's C4) ------------------------------------------------------------------

LIVE = {
    "playlists": {"a": {"dir": "music/a"}, "b": {"dir": "music/b"}},
    "scenes": {"one": [{"to": "everywhere", "play": "a"}], "two": [{"to": "everywhere", "play": "b"}], "off": []},
}


def router(tmp_path):
    r = with_house(music_router(tmp_path, LIVE))
    r.loop = asyncio.get_running_loop()
    r._mod = FakeMod([{"night": {"music": "one"}}])
    r.apply(answer("v1"))
    r.on_sim({"type": "directive", "verb": "cue", "args": "music_one"})
    spin(r, 5)
    return r


def stereo(r, args):
    return r.on_sim({"type": "directive", "verb": "cue", "args": args})


def test_his_playlist_is_a_loan_and_back_returns_the_story(tmp_path):
    async def go():
        r = router(tmp_path)
        stereo(r, "music, action: play, playlist: b")
        assert r.music.scene == f"{HAND_PREFIX}b" and r._music_loan and r._music_hand
        assert r.music_status()["loan"] is True
        stereo(r, "music, action: back")
        assert not r._music_loan and not r._music_hand
        await r._music_catch_up
        assert r.music.scene == "one"

    run(go())


def test_a_live_cue_ends_his_loan_and_the_later_back_does_nothing(tmp_path):
    async def go():
        r = router(tmp_path)
        stereo(r, "music, action: play, playlist: b")
        r.on_sim({"type": "directive", "verb": "cue", "args": "music_two"})
        assert r.music.scene == "two" and not r._music_loan and not r._music_hand
        assert r.on_stereo({"action": "back"}) is None
        assert r.music.scene == "two"

    run(go())


def test_a_directors_hand_refuses_him_entirely(tmp_path):
    async def go():
        r = router(tmp_path)
        assert r.serve_music({"seq": 1, "at": 1, "action": "scene", "scene": "two", "by": "Ada"}) == "scene"
        skips: list = []
        r.music.next = lambda playlist=None: skips.append(playlist) or 0  # type: ignore[method-assign]
        for cmd in ({"action": "skip"}, {"action": "hush"}, {"action": "play", "playlist": "a"}, {"action": "back"}):
            assert r.on_stereo(cmd) is None
        assert skips == [] and r.music.scene == "two" and r._music_hand and not r._music_loan

    run(go())


def test_a_directors_pick_takes_the_music_from_him_and_keeps_it(tmp_path):
    async def go():
        r = router(tmp_path)
        stereo(r, "music, action: play, playlist: b")
        assert r.serve_music({"seq": 1, "at": 1, "action": "playlist", "playlist": "a", "by": "Ada"}) == "playlist"
        assert r._music_hand and not r._music_loan
        assert r.on_stereo({"action": "back"}) is None
        assert r.music.scene == f"{HAND_PREFIX}a" and r._music_hand

    run(go())


def test_his_skip_moves_the_beds_and_starts_no_loan(tmp_path):
    async def go():
        r = router(tmp_path)
        skips: list = []
        r.music.next = lambda playlist=None: skips.append(playlist) or 1  # type: ignore[method-assign]
        assert r.on_stereo({"action": "skip"}) == "skip"
        assert skips == [None] and not r._music_loan and not r._music_hand

    run(go())


def test_a_file_bed_cannot_hush_so_no_loan_starts(tmp_path):
    async def go():
        r = router(tmp_path)
        assert r.on_stereo({"action": "hush"}) is None
        assert not r._music_loan and not r._music_hand

    run(go())


def test_an_unknown_playlist_of_his_starts_no_loan(tmp_path):
    async def go():
        r = router(tmp_path)
        assert r.on_stereo({"action": "play", "playlist": "nope"}) is None
        assert not r._music_loan and not r._music_hand and r.music.scene == "one"

    run(go())


def test_follow_the_story_ends_his_loan(tmp_path):
    async def go():
        r = router(tmp_path)
        stereo(r, "music, action: play, playlist: b")
        assert r.serve_music({"seq": 1, "at": 1, "action": "story"}) == "story"
        assert not r._music_loan and not r._music_hand
        await r._music_catch_up
        assert r.music.scene == "one"

    run(go())


def test_stop_house_sounds_ends_his_loan_but_never_a_directors_hand(tmp_path):
    async def go():
        r = router(tmp_path)
        stereo(r, "music, action: play, playlist: b")
        r.stop_all()
        assert not r._music_loan
        assert stereo(r, "music, action: back") is None  # his timed back finds no loan

        r2 = router(tmp_path)
        r2.serve_music({"seq": 1, "at": 1, "action": "scene", "scene": "two"})
        r2.stop_all()
        assert r2._music_hand

    run(go())


def test_stop_house_sounds_is_a_hand_a_catch_up_and_his_moves_cannot_undo(tmp_path):
    """ALL STOP: nothing restarts until the house manager says so. The panels show
    Follow the story, a dropped feed's catch-up stands down, and his moves are ignored."""

    async def go():
        r = router(tmp_path)
        assert r.stop_all(False, "Host") is not None
        assert r.music.scene is None and r.music_status()["hand"] is True  # the panel's ↺
        await r.music_catch_up("feed")
        assert r.music.scene is None
        for move in ("music, action: play, playlist: b", "music, action: skip", "music, action: hush"):
            assert stereo(r, move) is None, move
        assert r.music.scene is None

        r.serve_music({"seq": 1, "at": 1, "action": "story", "by": "Host"})  # Follow the story
        await r._music_catch_up
        assert r.music.scene == "one" and not r._music_hand

    run(go())


def test_a_live_cue_lets_go_of_a_stop(tmp_path):
    async def go():
        r = router(tmp_path)
        r.stop_all(False, "Host")
        r.on_sim({"type": "directive", "verb": "cue", "args": "music_two"})
        assert r.music.scene == "two" and not r._music_hand

    run(go())


def app_router(tmp_path):
    """The show's shape: every playlist on the app, so ⏸ really holds it."""
    live = {
        "playlists": {"a": {"tidal": ACT_1, "dir": "music/a", "shuffle": False}, "b": {"tidal": ACT_2, "dir": "music/b", "shuffle": False}},
        "scenes": {"one": [{"to": "everywhere", "play": "a"}], "two": [{"to": "everywhere", "play": "b"}], "off": []},
    }
    r = with_house(music_router(tmp_path, live))
    r.music.live = FakeLive()
    r.loop = asyncio.get_running_loop()
    r._mod = FakeMod([{"night": {"music": "one"}}] * 8)
    r.apply(answer("v1"))
    r.on_sim({"type": "directive", "verb": "cue", "args": "music_one"})
    spin(r, 5)
    return r


def pause(r, seq=1):
    return r.serve_music({"seq": seq, "at": seq, "action": "pause", "by": "Task Manager"})


def test_a_held_pause_binds_him(tmp_path):
    """The music contract's C0: a pause holds until told. Not by him."""

    async def go():
        r = app_router(tmp_path)
        assert pause(r) == "pause"
        assert stereo(r, "music, action: play, playlist: b") is None
        assert r.music.paused and r.music.scene == "one" and not r._music_loan
        assert stereo(r, "music, action: skip") is None
        assert r.music.live.skips == 0
        assert stereo(r, "music, action: hush") is None and not r._music_loan
        assert stereo(r, "music, action: back") is None
        assert r.music.paused

    run(go())


def test_a_hosts_pause_takes_his_loan_and_his_back_finds_nothing(tmp_path):
    async def go():
        r = app_router(tmp_path)
        stereo(r, "music, action: play, playlist: b")
        assert r._music_loan
        assert pause(r) == "pause"
        assert not r._music_loan and r._music_hand  # his playlist plays on in the host's hand
        assert r.music_status()["hand"] is True and r.music_status()["loan"] is False
        assert stereo(r, "music, action: back") is None
        assert r.music.paused and r.music.scene == f"{HAND_PREFIX}b"

    run(go())


def test_a_hosts_pause_over_his_hush_holds_when_the_hush_runs_out(tmp_path):
    async def go():
        r = app_router(tmp_path)
        stereo(r, "music, action: hush")
        assert r.music.paused and r._music_loan
        assert pause(r) == "pause"
        assert not r._music_loan and not r._music_hand  # the story's scene, paused
        assert stereo(r, "music, action: back") is None
        assert r.music.paused
        assert r.serve_music({"seq": 2, "at": 2, "action": "resume", "by": "Task Manager"}) == "resume"
        assert not r.music.paused

    run(go())


def test_a_pause_that_cannot_land_leaves_his_loan_alone(tmp_path):
    async def go():
        r = router(tmp_path)  # file beds: no app to hold
        stereo(r, "music, action: play, playlist: b")
        assert pause(r) is None
        assert r._music_loan and r._music_hand

    run(go())


def test_the_panel_commands_reach_the_director(tmp_path):
    async def go():
        r = router(tmp_path)
        assert r.serve_music({"seq": 1, "at": 1, "action": "previous"}) is None  # a file bed
        assert r.serve_music({"seq": 2, "at": 2, "action": "pause"}) is None
        assert r.serve_music({"seq": 3, "at": 3, "action": "resume"}) == "resume"
        assert r.serve_music({"seq": 4, "at": 4, "action": "playlist", "playlist": "nope"}) is None
        assert not r._music_hand
        assert r.serve_music({"seq": 5, "at": 5, "action": "tidal", "id": ACT_1}) is None  # no app here
        assert not r._music_hand

    run(go())


def test_the_report_carries_the_loan_and_the_app():
    from stagehand.audio.module import _camel_music

    out = _camel_music({"scene": "a", "beds": [{"playlist": "a", "speakers": [], "track": None, "pos_s": 0.0, "live": True}], "missing": [], "loan": True, "tidal": {"online": True}})
    assert out["loan"] is True and out["tidal"] == {"online": True} and out["beds"][0].get("live") is True
    assert "loan" not in _camel_music({"scene": None, "beds": [], "missing": [], "loan": False})
    json.dumps(out)
