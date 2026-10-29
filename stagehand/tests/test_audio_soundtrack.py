"""The house soundtrack (wave 38, C3): the YAML, the playlists' order, scenes
→ beds, the scene-change rules and the crossfades on the mixer's clock —
fake streams (constant levels, a header that may lie), a real Mixer, no device."""

from __future__ import annotations

import json
import random
from pathlib import Path

import numpy as np
import pytest
import yaml

from stagehand.audio.mixer import Mixer, db_to_lin
from stagehand.audio.routing import parse_audio
from stagehand.audio.soundtrack import (
    LEAD_S,
    OFF,
    Deck,
    Director,
    Playlist,
    fisher_yates,
    load_soundtrack,
    parse_soundtrack,
    scene_beds,
    scene_of_cue,
)
from stagehand.module import ConfigError

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "router-audio.json").read_text(encoding="utf-8"))
DOC = parse_audio(FIXTURE["audio"])
HOUSE = FIXTURE["house"]
RATE = 1000  # 100-frame blocks are 0.1 s: the arithmetic stays readable
BLOCK = 100
MEDIA = Path(__file__).resolve().parents[1] / "media"


class FakeTrack:
    """A `stream.Stream` look-alike: `real` frames of one constant level.
    `header` is what the file's header claims (an MP3's estimate); the
    decoder reaches the real end (`eof`) `buffer` frames ahead of play."""

    def __init__(self, path: str, rate: int, *, loop: bool = False, offset: int = 0, value: float = 0.25, real: int = 2000, header: int | None = None, buffer: int = 400) -> None:
        self.path, self.rate, self.loop = path, rate, loop
        self.name = Path(path).stem
        self.channels = 1
        self.value = value
        self.real = real
        self.length = real if header is None else header
        self.offset = offset
        self.buffer = buffer
        self.played = 0
        self.underruns = 0
        self.closed = False

    def ready(self) -> bool:
        return True

    @property
    def eof(self) -> bool:
        return not self.loop and self.offset + self.played + self.buffer >= self.real

    @property
    def produced(self) -> int:
        return min(self.real - self.offset, self.played + self.buffer)

    @property
    def finished(self) -> bool:
        return self.closed or (not self.loop and self.offset + self.played >= self.real)

    @property
    def position(self) -> int:
        here = self.offset + self.played
        return here % self.real if self.loop else here

    def read(self, n: int) -> tuple[np.ndarray, int]:
        take = n if self.loop else max(0, min(n, self.real - self.offset - self.played))
        out = np.zeros((n, 1), dtype=np.float32)
        out[:take] = self.value
        self.played += take
        return out, take

    def close(self, wait: bool = True) -> None:
        self.closed = True


class Library:
    """The director's `stream_factory`: every file name → its FakeTrack's
    (value, real frames, header frames); records what was opened."""

    def __init__(self, specs: dict[str, tuple] | None = None, *, buffer: int = 400) -> None:
        self.specs = specs or {}
        self.buffer = buffer
        self.opened: list[FakeTrack] = []
        self.fail: set[str] = set()

    def __call__(self, path, rate, *, loop=False, offset=0):
        name = Path(path).stem
        if name in self.fail:
            raise RuntimeError("bad file")
        value, real, header = (self.specs.get(name, ()) + (None, None, None))[:3]
        t = FakeTrack(str(path), rate, loop=loop, offset=offset, value=value or 0.1, real=real or 2000, header=header, buffer=self.buffer)
        self.opened.append(t)
        return t

    def open_now(self) -> list[FakeTrack]:
        return [t for t in self.opened if not t.closed]


def folder(tmp_path: Path, name: str, files: list[str]) -> Path:
    d = tmp_path / "music" / name
    d.mkdir(parents=True, exist_ok=True)
    for f in files:
        (d / f).write_bytes(b"")
    return d


def soundtrack(tmp_path: Path, doc: dict):
    return parse_soundtrack({"level_db": 0, "crossfade_s": 0.5, "scene_fade_s": 0.3, **doc}, tmp_path, str(tmp_path / "soundtrack.yaml"))


def director(tmp_path: Path, doc: dict, lib: Library | None = None, *, outs: int = 7, seed: int = 1):
    st = soundtrack(tmp_path, doc)
    lib = lib or Library()
    d = Director(st, stream_factory=lib, rng=random.Random(seed))
    m = Mixer(1, outs, RATE)
    d.attach(m, DOC, HOUSE)
    return d, m, lib


def run(d: Director, m: Mixer, blocks: int) -> np.ndarray:
    """`blocks` blocks of the mixer, the director ticking before each."""
    outs = []
    for _ in range(blocks):
        d.tick()
        out = np.zeros((BLOCK, m.n_out), dtype=np.float32)
        m.process(None, out)
        outs.append(out)
    return np.concatenate(outs)


# -- the YAML -------------------------------------------------------------------


def test_the_shows_soundtrack_loads():
    st = load_soundtrack(MEDIA / "soundtrack.yaml")
    assert (st.level_db, st.crossfade_s, st.scene_fade_s) == (-10, 3, 2.5)
    acts = ["doors", "act_1", "malware", "act_2", "act_3", "final", "ceremony", "afterparty"]
    assert list(st.playlists) == [*acts, "fan_closet"]
    for name in acts:
        assert st.playlists[name].dir == str((MEDIA / "music" / name.replace("_", "-")).resolve())
        assert st.scenes[name] == st.scenes[name] and [(e.to, e.play) for e in st.scenes[name]] == [(("everywhere",), name), (("The Fan Closet",), "fan_closet")]
    fan = st.playlists["fan_closet"]
    assert fan.files == (str((MEDIA / "library/ambient/dryer-tumble.wav").resolve()),) and fan.loop and fan.level_db == -14
    assert st.scenes["off"] == ()
    assert set(st.tracks) == {"dance_song", "rave", "hand_jive", "youre_the_one_vocoder", "youre_the_one_sandy_only", "ceremony_bed", "ad_jingle"}
    assert all(t.takeover for t in st.tracks.values()) and st.bed_level("fan_closet") == -24


@pytest.mark.parametrize(
    "doc, error",
    [
        ({"playlist": {}}, r"soundtrack.yaml.playlist: unknown key"),
        ({"version": 2}, r"version: only 1"),
        ({"level_db": 3}, r"soundtrack.yaml.level_db: a number from -60 to 0"),
        ({"crossfade_s": "3"}, r"crossfade_s: a number"),
        ({"playlists": {"a": {"dir": "x", "files": ["y"]}}}, r"playlists.a: exactly one of dir or files"),
        ({"playlists": {"a": {}}}, r"playlists.a: exactly one of dir or files"),
        ({"playlists": {"a": {"dir": "x", "shufle": True}}}, r"playlists.a.shufle: unknown key"),
        ({"playlists": {"a": {"files": []}}}, r"playlists.a.files: a non-empty list"),
        ({"playlists": {"a": {"dir": "x", "loop": "yes"}}}, r"playlists.a.loop: true or false"),
        ({"playlists": {"Act 1": {"dir": "x"}}}, r"a playlist name is a-z"),
        ({"scenes": {"act-1": []}}, r"a scene name is a-z"),
        ({"scenes": {"a": [{"to": "everywhere", "play": "nope"}]}}, r"scenes.a\[0\].play: no playlist 'nope'"),
        ({"scenes": {"a": [{"to": "everywhere"}]}}, r"scenes.a\[0\]: needs both to and play"),
        ({"scenes": {"a": [{"to": [], "play": None}]}}, r"scenes.a\[0\].to: a target"),
        ({"scenes": {"a": {"to": "everywhere"}}}, r"scenes.a: a list"),
        ({"tracks": {"rave": {"takeover": "yes"}}}, r"tracks.rave.takeover: true or false"),
        ({"tracks": {"rave": {"duck": False}}}, r"tracks.rave.duck: unknown key"),
    ],
)
def test_a_bad_soundtrack_fails_at_load_naming_the_key(tmp_path, doc, error):
    with pytest.raises(ConfigError, match=error):
        parse_soundtrack(doc, tmp_path, str(tmp_path / "soundtrack.yaml"))


def test_a_missing_or_broken_file_is_a_config_error_and_the_router_refuses_to_boot(tmp_path):
    from stagehand.audio.config import parse_audio_section

    with pytest.raises(ConfigError, match="no such file"):
        parse_audio_section({"soundtrack": "nope.yaml"}, str(tmp_path))
    (tmp_path / "bad.yaml").write_text("playlists: [unclosed\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="not valid YAML"):
        parse_audio_section({"soundtrack": "bad.yaml"}, str(tmp_path))
    (tmp_path / "ok.yaml").write_text(yaml.safe_dump({"playlists": {"a": {"dir": "music/a"}}, "scenes": {"a": [{"to": "everywhere", "play": "a"}]}}), encoding="utf-8")
    cfg = parse_audio_section({"soundtrack": "ok.yaml"}, str(tmp_path))
    assert cfg.soundtrack is not None and cfg.soundtrack.playlists["a"].dir == str((tmp_path / "music/a").resolve())
    assert cfg.music_topic == "show/audio/music" and parse_audio_section({}, str(tmp_path)).soundtrack is None


def test_scene_cues_and_tracks_by_name(tmp_path):
    assert scene_of_cue("music_act_1") == "act_1" and scene_of_cue("music_doors, extra") == "doors"
    assert scene_of_cue("lights_game") is None and scene_of_cue("music_") is None and scene_of_cue(None) is None
    st = soundtrack(tmp_path, {"tracks": {"hand_jive": None}})
    assert st.track("Hand-Jive").name == "hand_jive" and st.track("zip") is None
    assert st.has_scene(OFF) and not st.has_scene("doors")


# -- a playlist's order ---------------------------------------------------------------


def test_a_shuffled_playlist_plays_every_file_once_a_pass_and_never_twice_in_a_row(tmp_path):
    d = folder(tmp_path, "act-1", [f"t{i}.mp3" for i in range(5)] + ["notes.txt", ".hidden.mp3"])
    deck = Deck(Playlist("act_1", dir=str(d)), random.Random(7))
    played = [deck.next() for _ in range(5 * 200)]
    names = [Path(p).name for p in played]
    for k in range(200):
        assert sorted(names[k * 5 : k * 5 + 5]) == [f"t{i}.mp3" for i in range(5)]  # a pass: each once
    assert all(a != b for a, b in zip(names, names[1:]))  # never twice in a row, across passes too
    firsts = {names[k * 5] for k in range(200)}
    assert len(firsts) == 5  # reshuffled every pass
    # A file dropped in mid-pass joins the next pass.
    deck2 = Deck(Playlist("act_1", dir=str(d)), random.Random(3))
    first_pass = [Path(deck2.next()).name for _ in range(5)]
    (d / "t9.mp3").write_bytes(b"")
    assert "t9.mp3" not in first_pass and "t9.mp3" in {Path(deck2.next()).name for _ in range(6)}


def test_an_unshuffled_playlist_cycles_in_order_and_fisher_yates_is_a_permutation(tmp_path):
    d = folder(tmp_path, "doors", ["b.wav", "a.wav", "c.flac"])
    deck = Deck(Playlist("doors", dir=str(d), shuffle=False), random.Random(1))
    assert [Path(deck.next()).name for _ in range(6)] == ["a.wav", "b.wav", "c.flac"] * 2
    items = list(range(10))
    assert sorted(fisher_yates(items, random.Random(5))) == list(range(10)) and items != list(range(10))
    empty = Deck(Playlist("x", dir=str(tmp_path / "none")), random.Random(1))
    assert empty.next() is None


# -- scenes → beds -------------------------------------------------------------------


def test_each_speaker_takes_the_last_entry_and_null_is_silence(tmp_path):
    st = soundtrack(
        tmp_path,
        {
            "playlists": {"a": {"dir": "music/a"}, "b": {"dir": "music/b"}},
            "scenes": {
                "s": [
                    {"to": "everywhere", "play": "a"},
                    {"to": ["The Start Bar", "hall-1"], "play": "b"},
                    {"to": "Disk Cleanup", "play": None},
                    {"to": "The Fan Closet", "play": "b"},
                    {"to": "crawl", "play": "a"},
                ]
            },
        },
    )
    beds, notes = scene_beds(st, "s", DOC, HOUSE)
    assert beds == {"a": ("desk-l", "desk-r", "stairs-1"), "b": ("bar-1", "hall-1")}  # bath-1 silent; tent-spare unwired
    assert notes == [
        "scene s entry 4 (b): 'The Fan Closet' names no zone, room, LOCATION or speaker",
        "scene s entry 5 (a): crawl reaches no wired speaker",
    ]
    assert len(st.warnings(DOC, HOUSE)) == 2 + 2  # + the two empty playlists


# -- the director ----------------------------------------------------------------------


TWO = {
    "playlists": {"a": {"dir": "music/a"}, "b": {"dir": "music/b"}, "c": {"dir": "music/c"}},
    "scenes": {
        "one": [{"to": "everywhere", "play": "a"}, {"to": "The Start Bar", "play": "b"}],
        "two": [{"to": "everywhere", "play": "c"}, {"to": "The Start Bar", "play": "b"}],
        "three": [{"to": "everywhere", "play": "c"}, {"to": ["The Start Bar", "hall-1"], "play": "b"}],
        "off": [],
    },
}


def _fill(tmp_path, specs: dict[str, list[str]]) -> None:
    for name, files in specs.items():
        folder(tmp_path, name, files)


def test_a_scene_lays_its_beds_on_their_speakers(tmp_path):
    _fill(tmp_path, {"a": ["a1.mp3"], "b": ["b1.mp3"]})
    d, m, lib = director(tmp_path, TWO, Library({"a1": (0.2, 10_000), "b1": (0.4, 10_000)}))
    assert d.set_scene("one", "test")
    out = run(d, m, 5)
    assert np.allclose(out[-1], [0.2, 0.2, 0.4, 0.4, 0.2, 0.2, 0.2])  # bar-1 (3, 4) plays b, the rest a
    s = d.status()
    assert s["scene"] == "one" and s["missing"] == ["c"]
    assert s["beds"] == [
        {"playlist": "a", "speakers": ["desk-l", "desk-r", "hall-1", "stairs-1", "bath-1"], "track": "a1", "pos_s": 0.5, "dur_s": 10.0},
        {"playlist": "b", "speakers": ["bar-1"], "track": "b1", "pos_s": 0.5, "dur_s": 10.0},
    ]
    # Wave 40: every scene (off included) and every playlist, for the mixer's picker.
    assert s["scenes"] == ["one", "two", "three", "off"]
    assert s["playlists"] == [{"name": "a", "tracks": 1, "loop": False}, {"name": "b", "tracks": 1, "loop": False}, {"name": "c", "tracks": 0, "loop": False}]


def test_a_scene_change_keeps_an_unchanged_bed_untouched_and_fades_the_rest(tmp_path):
    _fill(tmp_path, {"a": ["a1.mp3"], "b": ["b1.mp3"], "c": ["c1.mp3"]})
    d, m, lib = director(tmp_path, TWO, Library({"a1": (0.2, 10_000), "b1": (0.4, 10_000), "c1": (0.3, 10_000)}))
    d.set_scene("one")
    run(d, m, 5)
    b_vid = d.beds["b"].cur.vid
    assert d.set_scene("two", "act change")
    assert d.beds["b"].cur.vid == b_vid  # the same voice: never touched
    out = run(d, m, 6)  # scene_fade_s 0.3
    assert np.allclose(out[-1], [0.3, 0.3, 0.4, 0.4, 0.3, 0.3, 0.3])
    assert len(lib.opened) == 3 and lib.opened[0].closed  # a1 faded out and was closed
    assert d.set_scene("two") and d.beds["b"].cur.vid == b_vid  # the current scene again: a no-op
    assert len(lib.opened) == 3


def test_a_bed_whose_speakers_change_keeps_its_place_in_the_track(tmp_path):
    _fill(tmp_path, {"a": ["a1.mp3"], "b": ["b1.mp3"], "c": ["c1.mp3"]})
    d, m, lib = director(tmp_path, TWO, Library({"b1": (0.4, 10_000), "c1": (0.3, 10_000)}))
    d.set_scene("two")
    run(d, m, 20)  # 2 s in
    old = d.beds["b"].cur
    d.set_scene("three")  # b now also reaches the hall
    moved = d.beds["b"].cur
    assert moved.vid != old.vid and moved.path == old.path
    assert moved.stream.offset == 2000 + int(LEAD_S * RATE)  # where the old one is when the new one starts
    assert moved.start == m.frames + int(LEAD_S * RATE)
    out = run(d, m, 10)
    assert np.allclose(out[-1], [0.3, 0.3, 0.4, 0.4, 0.4, 0.3, 0.3])  # the hall (5) moved to b
    # On bar-1, which both voices reach, the move is seamless: the old fades as the new comes in.
    assert np.allclose(out[:, 2], 0.4, atol=1e-3)
    assert old.stream.closed and not moved.stream.closed


def test_tracks_crossfade_on_the_mixer_clock_and_at_most_two_are_open(tmp_path):
    _fill(tmp_path, {"a": ["x.mp3", "y.mp3"]})
    lib = Library({"x": (0.2, 2000), "y": (0.4, 2000)})
    doc = {"playlists": {"a": {"dir": "music/a", "shuffle": False}}, "scenes": {"s": [{"to": "desk-l", "play": "a"}]}}
    d, m, lib = director(tmp_path, doc, lib)
    d.set_scene("s")
    peak_open = 0
    outs = []
    for _ in range(60):
        outs.append(run(d, m, 1))
        peak_open = max(peak_open, len(lib.open_now()))
    out = np.concatenate(outs)[:, 0]
    assert peak_open == 2  # the current track and the next, never more
    # x: frames 0–1999 at 0.2 (its first 0.3 s fade in); the crossfade (0.5 s)
    # starts at 1500 exactly, on the mixer's clock; y holds from 2000 and
    # crosses back into x at 3000 (y's own end, 1500 + 2000, less the fade).
    assert np.allclose(out[400:1500], 0.2)
    assert out[1499] == pytest.approx(0.2) and out[1750] == pytest.approx(0.3, abs=0.002)
    assert np.allclose(out[2000:3000], 0.4) and out[3250] == pytest.approx(0.3, abs=0.002)
    assert np.allclose(out[3500:4500], 0.2)
    assert [Path(t.path).stem for t in lib.opened[:3]] == ["x", "y", "x"]
    assert d.beds["a"].cur.path.endswith("y.mp3")


def test_an_mp3_shorter_than_its_header_starts_the_next_track_at_its_real_end(tmp_path):
    _fill(tmp_path, {"a": ["x.mp3", "y.mp3"]})
    # The header claims 4 s; the file ends at 1.5 s, and the decoder only
    # knows 0.2 s ahead (`buffer`): the next track starts there, not at 3.5 s.
    lib = Library({"x": (0.2, 1500, 4000), "y": (0.4, 4000)}, buffer=200)
    doc = {"playlists": {"a": {"dir": "music/a", "shuffle": False}}, "scenes": {"s": [{"to": "desk-l", "play": "a"}]}}
    d, m, lib = director(tmp_path, doc, lib)
    d.set_scene("s")
    out = run(d, m, 30)[:, 0]
    assert np.allclose(out[400:1300], 0.2)
    gap = np.flatnonzero(out[1300:2000] < 0.05)
    assert len(gap) <= BLOCK  # at most a block of silence where the real end fell
    assert np.allclose(out[2000:3000], 0.4)


def test_a_track_that_will_not_open_is_skipped_and_an_empty_playlist_waits_for_files(tmp_path):
    _fill(tmp_path, {"a": ["bad.mp3", "good.mp3"]})
    lib = Library({"good": (0.3, 10_000)})
    lib.fail.add("bad")
    doc = {"playlists": {"a": {"dir": "music/a", "shuffle": False}, "b": {"dir": "music/b"}}, "scenes": {"s": [{"to": "desk-l", "play": "a"}, {"to": "desk-r", "play": "b"}]}}
    d, m, lib = director(tmp_path, doc, lib)
    d.set_scene("s")
    out = run(d, m, 5)
    assert out[-1, 0] == pytest.approx(0.3) and out[-1, 1] == 0.0
    assert d.status()["missing"] == ["b"]
    folder(tmp_path, "b", ["late.mp3"])  # dropped in mid-show
    out = run(d, m, 110)  # the retry is 10 s
    assert out[-1, 1] == pytest.approx(0.1) and d.status()["missing"] == []


def test_a_one_file_loop_is_one_seamless_stream(tmp_path):
    (tmp_path / "library").mkdir()
    (tmp_path / "library" / "dryer.wav").write_bytes(b"")
    doc = {"playlists": {"fan": {"files": ["library/dryer.wav"], "loop": True}}, "scenes": {"s": [{"to": "hall-1", "play": "fan"}]}}
    d, m, lib = director(tmp_path, doc, Library({"dryer": (0.2, 300)}))
    d.set_scene("s")
    out = run(d, m, 40)[:, 4]
    assert len(lib.opened) == 1 and lib.opened[0].loop and np.allclose(out[400:], 0.2)
    assert d.next() == 0  # a loop has no next
    status = d.status()
    assert "dur_s" not in status["beds"][0] and status["playlists"] == [{"name": "fan", "tracks": 1, "loop": True}]
    assert status["scenes"] == ["s", "off"]  # off is always a scene


def test_next_crossfades_every_bed_to_its_next_track(tmp_path):
    _fill(tmp_path, {"a": ["x.mp3", "y.mp3"]})
    doc = {"playlists": {"a": {"dir": "music/a", "shuffle": False}}, "scenes": {"s": [{"to": "desk-l", "play": "a"}]}}
    d, m, lib = director(tmp_path, doc, Library({"x": (0.2, 60_000), "y": (0.4, 60_000)}))
    d.set_scene("s")
    run(d, m, 10)
    assert d.next() == 1
    out = run(d, m, 10)[:, 0]
    assert out[0] == pytest.approx(0.2) and out[-1] == pytest.approx(0.4)


def test_next_with_a_playlist_skips_only_that_bed(tmp_path):
    _fill(tmp_path, {"a": ["x.mp3", "y.mp3"], "b": ["p.mp3", "q.mp3"]})
    doc = {
        "playlists": {"a": {"dir": "music/a", "shuffle": False}, "b": {"dir": "music/b", "shuffle": False}},
        "scenes": {"s": [{"to": "desk-l", "play": "a"}, {"to": "hall-1", "play": "b"}]},
    }
    d, m, lib = director(tmp_path, doc, Library({"x": (0.2, 60_000), "y": (0.4, 60_000), "p": (0.1, 60_000), "q": (0.3, 60_000)}))
    d.set_scene("s")
    run(d, m, 10)
    assert d.next("b") == 1
    out = run(d, m, 10)
    assert out[-1, 0] == pytest.approx(0.2) and out[-1, 4] == pytest.approx(0.3)  # a plays on, b moved to q
    assert d.next("nobody") == 0
    assert d.next() == 2
    out = run(d, m, 10)
    assert out[-1, 0] == pytest.approx(0.4) and out[-1, 4] == pytest.approx(0.1)


def test_a_takeover_track_silences_the_beds_on_its_speakers_only_and_they_come_back(tmp_path):
    _fill(tmp_path, {"a": ["x.mp3"]})
    doc = {"playlists": {"a": {"dir": "music/a"}}, "scenes": {"s": [{"to": "everywhere", "play": "a"}]}}
    d, m, lib = director(tmp_path, doc, Library({"x": (0.2, 60_000)}))
    d.set_scene("s")
    run(d, m, 5)
    m.play(np.full((1500, 1), 0.5, dtype=np.float32), {1: 0.0, 2: 0.0}, bus="sfx", takeover=True, duck=False, fade_in_s=0)
    out = run(d, m, 10)
    assert out[-1, 0] == pytest.approx(0.5, abs=1e-3) and out[-1, 4] == pytest.approx(0.2)  # the bed silent on 1, 2 only
    out = run(d, m, 40)  # the track ends; the takeover releases over 2 s
    assert out[-1, 0] == pytest.approx(0.2) and out[-1, 4] == pytest.approx(0.2)


def test_a_track_the_mix_mutes_takes_nothing_over_there(tmp_path):
    """Wave 40: a featured track muted in the mix on an output leaves the
    bed playing there (else a muted song would leave the room silent)."""
    from stagehand.audio.mix import MixGains

    _fill(tmp_path, {"a": ["x.mp3"]})
    doc = {"playlists": {"a": {"dir": "music/a"}}, "scenes": {"s": [{"to": "everywhere", "play": "a"}]}}
    d, m, lib = director(tmp_path, doc, Library({"x": (0.2, 60_000)}))
    n = m.n_out
    m.set_mix(MixGains(strips={"tracks": tuple(0.0 if o == 0 else 1.0 for o in range(n))}))
    d.set_scene("s")
    run(d, m, 5)
    m.play(np.full((1500, 1), 0.5, dtype=np.float32), {1: 0.0, 2: 0.0}, bus="sfx", strip="tracks", takeover=True, duck=False, fade_in_s=0)
    out = run(d, m, 10)
    assert out[-1, 0] == pytest.approx(0.2, abs=1e-3)  # muted there: the bed plays on
    assert out[-1, 1] == pytest.approx(0.5, abs=1e-3)  # heard there: it takes the bed over


def test_stop_fades_every_bed_and_the_same_scene_starts_again(tmp_path):
    _fill(tmp_path, {"a": ["a1.mp3"], "b": ["b1.mp3"]})
    d, m, lib = director(tmp_path, TWO, Library({"a1": (0.2, 60_000), "b1": (0.4, 60_000)}))
    d.set_scene("one")
    run(d, m, 5)
    d.stop(0.3, "stop house sounds")
    out = run(d, m, 5)
    assert not out[-1].any() and d.scene is None and d.status()["beds"] == []
    assert d.set_scene("one")  # the same scene: back
    out = run(d, m, 5)
    assert out[-1, 0] == pytest.approx(0.2) and out[-1, 2] == pytest.approx(0.4)


def test_off_and_an_unknown_scene(tmp_path, caplog):
    _fill(tmp_path, {"a": ["a1.mp3"]})
    d, m, lib = director(tmp_path, TWO, Library({"a1": (0.2, 60_000)}))
    d.set_scene("one")
    run(d, m, 5)
    assert not d.set_scene("rave_party", "cue") and not d.set_scene("rave_party", "cue")
    assert caplog.text.count("rave_party") == 1 and d.scene == "one"
    assert d.set_scene(None) and d.scene == OFF
    out = run(d, m, 5)
    assert not out[-1].any()


def test_a_new_mixer_starts_the_scene_again_and_a_scene_before_the_mixer_waits_for_it(tmp_path):
    _fill(tmp_path, {"a": ["a1.mp3"]})
    st = soundtrack(tmp_path, TWO)
    lib = Library({"a1": (0.2, 60_000)})
    d = Director(st, stream_factory=lib, rng=random.Random(1))
    assert d.set_scene("one") and not lib.opened  # no stream yet: remembered
    m = Mixer(1, 7, RATE)
    d.attach(m, DOC, HOUSE)
    assert run(d, m, 5)[-1, 0] == pytest.approx(0.2)
    m2 = Mixer(1, 7, RATE)  # the stream reopened (a replugged interface)
    d.attach(m2, DOC, HOUSE)
    assert lib.opened[0].closed  # the old mixer's track is closed, not left running
    assert run(d, m2, 5)[-1, 0] == pytest.approx(0.2) and d.beds["a"].cur.vid == 1


def test_the_level_is_the_top_level_plus_the_playlists(tmp_path):
    _fill(tmp_path, {"a": ["a1.mp3"]})
    doc = {"level_db": -10, "playlists": {"a": {"dir": "music/a", "level_db": -4}}, "scenes": {"s": [{"to": "desk-l", "play": "a"}]}}
    st = parse_soundtrack({"crossfade_s": 0.5, "scene_fade_s": 0.3, **doc}, tmp_path)
    d = Director(st, stream_factory=Library({"a1": (0.5, 60_000)}), rng=random.Random(1))
    m = Mixer(1, 7, RATE)
    d.attach(m, DOC, HOUSE)
    d.set_scene("s")
    assert run(d, m, 5)[-1, 0] == pytest.approx(0.5 * db_to_lin(-14), rel=1e-3)


def test_a_track_that_dies_with_no_warning_starts_the_next_at_once(tmp_path):
    # The worst case: the decoder never reports the real end (no `eof`), the
    # header says 4 s, and the file stops at 2.5 s: the prefilled next track
    # starts on the next tick, not at the header's crossfade.
    _fill(tmp_path, {"a": ["x.mp3", "y.mp3"]})
    lib = Library({"x": (0.2, 2500, 4000), "y": (0.4, 60_000)}, buffer=-10_000)
    doc = {"playlists": {"a": {"dir": "music/a", "shuffle": False}}, "scenes": {"s": [{"to": "desk-l", "play": "a"}]}}
    d, m, lib = director(tmp_path, doc, lib)
    d.set_scene("s")
    out = run(d, m, 24)[:, 0]
    assert np.allclose(out[400:2500], 0.2)
    assert np.allclose(out[2700:], 0.4, atol=0.01)  # y within two blocks, not at 3.5 s
    assert [Path(t.path).stem for t in lib.opened] == ["x", "y"]


def test_a_scene_note_repeated_in_every_scene_is_one_warning(tmp_path):
    entries = [{"to": "everywhere", "play": "a"}, {"to": "crawl", "play": "a"}]
    st = soundtrack(tmp_path, {"playlists": {"a": {"dir": "music/a"}}, "scenes": {"x": entries, "y": entries, "z": entries[:1]}})
    notes = [w for w in st.warnings(DOC, HOUSE) if "crawl" in w]
    assert notes == ["music: (a): crawl reaches no wired speaker (in 2 scenes: x, y)"]


# -- a file that gives no audio, a crossfade's third track (wave 38 review) ---------------


def test_a_playlist_whose_only_file_holds_no_audio_waits_instead_of_reopening_every_tick(tmp_path, caplog):
    # A 0-frame render, a file still being copied: it opens fine and ends at
    # once. Without a back-off the bed reopened it every 0.1 s tick all night.
    _fill(tmp_path, {"a": ["empty.wav"]})
    doc = {"playlists": {"a": {"dir": "music/a"}}, "scenes": {"s": [{"to": "desk-l", "play": "a"}]}}
    d, m, lib = director(tmp_path, doc, Library({"empty": (0.2, 1)}))
    d.set_scene("s")
    run(d, m, 30)  # 3 s (the bug: ~30 opens)
    first = len(lib.opened)
    assert first <= 2  # the open, and the next one prepared ahead
    run(d, m, 220)  # 25 s in all: one more pass every 10 s
    assert len(lib.opened) <= first + 2 * 2, [t.path for t in lib.opened]
    assert d.status()["beds"][0]["track"] is None
    assert caplog.text.count("played no audio") == 1  # logged once


@pytest.mark.parametrize("loop", [False, True])
def test_a_real_zero_frame_wav_is_tried_every_10_s_not_every_tick(tmp_path, loop):
    import soundfile as sf

    d0 = folder(tmp_path, "a", [])
    sf.write(str(d0 / "dryer.wav"), np.zeros((0, 1), dtype=np.float32), 48000)
    files = {"dir": "music/a"} if not loop else {"files": ["music/a/dryer.wav"], "loop": True}
    st = soundtrack(tmp_path, {"playlists": {"a": files}, "scenes": {"s": [{"to": "desk-l", "play": "a"}]}})
    opened: list = []

    def real(path, rate, *, loop=False, offset=0):
        from stagehand.audio.stream import Stream

        s = Stream(path, rate, loop=loop, offset=offset)
        s.wait_ready(1.0)
        opened.append(s)
        return s

    d = Director(st, stream_factory=real, rng=random.Random(1))
    m = Mixer(1, 7, RATE)
    d.attach(m, DOC, HOUSE)
    d.set_scene("s")
    run(d, m, 30)  # 3 s: the bug opened it ~25 times
    assert len(opened) <= 2
    for s in opened:
        s.close()


def test_one_empty_file_among_good_ones_never_pauses_the_bed(tmp_path):
    _fill(tmp_path, {"a": ["e.mp3", "x.mp3", "y.mp3"]})
    doc = {"playlists": {"a": {"dir": "music/a", "shuffle": False}}, "scenes": {"s": [{"to": "desk-l", "play": "a"}]}}
    d, m, lib = director(tmp_path, doc, Library({"e": (0.9, 1), "x": (0.2, 2000), "y": (0.4, 2000)}))
    d.set_scene("s")
    out = run(d, m, 150)[:, 0]  # 15 s: e, x, y, e, x, y, …
    names = [Path(t.path).stem for t in lib.opened]
    assert names[:6] == ["e", "x", "y", "e", "x", "y"]
    assert len(np.flatnonzero(out[500:] < 0.05)) <= 3 * BLOCK  # never a 10 s back-off: at most a block per pass


def test_a_track_that_dies_before_its_scheduled_crossfade_never_leaves_a_third_track(tmp_path):
    _fill(tmp_path, {"a": ["x.mp3", "y.mp3", "z.mp3"]})
    doc = {"playlists": {"a": {"dir": "music/a", "shuffle": False}}, "scenes": {"s": [{"to": "desk-l", "play": "a"}]}}
    d, m, lib = director(tmp_path, doc, Library({"x": (0.2, 60_000), "y": (0.2, 60_000), "z": (0.2, 60_000)}))
    d.set_scene("s")
    run(d, m, 10)
    assert d.next() == 1  # y scheduled LEAD_S ahead
    d.beds["a"].cur.stream.close()  # x's worker dies inside that window
    out = run(d, m, 30)
    assert m.active("music") == 1 and out[-1, 0] == pytest.approx(0.2, abs=1e-3)
    assert d.next() == 1
    run(d, m, 3)
    d.stop(0.3, "stop house sounds")
    out = run(d, m, 10)
    assert not out[-1].any() and m.active("music") == 0


def test_stop_silences_a_music_voice_the_director_lost_track_of(tmp_path):
    _fill(tmp_path, {"a": ["x.mp3"]})
    doc = {"playlists": {"a": {"dir": "music/a"}}, "scenes": {"s": [{"to": "desk-l", "play": "a"}]}}
    d, m, lib = director(tmp_path, doc, Library({"x": (0.2, 60_000)}))
    d.set_scene("s")
    m.play(np.full((60_000, 1), 0.3, dtype=np.float32), {2: 0.0}, bus="music", fade_in_s=0)  # an orphan
    run(d, m, 5)
    d.stop(0.3, "stop house sounds")
    out = run(d, m, 10)
    assert not out[-1].any() and m.active("music") == 0
