"""The soundtrack from the TIDAL app (wave 52): the capture's buffer, the
reconciler against a fake page, the director's live beds on a real Mixer, and
the YAML. No device, no app."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from stagehand.audio.config import parse_audio_section
from stagehand.audio.mixer import Mixer
from stagehand.audio.routing import parse_audio
from stagehand.audio.soundtrack import LIVE_SWITCH_S, SILENT_S, Director, parse_soundtrack
from stagehand.audio.tidal import (
    DEVICE_JS,
    LOAD_JS,
    REPEAT_JS,
    STATE_JS,
    LiveInput,
    Tidal,
    TidalConfig,
    TidalError,
    TidalRemote,
    seconds,
)
from stagehand.module import ConfigError

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "router-audio.json").read_text(encoding="utf-8"))
DOC = parse_audio(FIXTURE["audio"])
HOUSE = FIXTURE["house"]
RATE = 1000
BLOCK = 100
CFG = TidalConfig(device="VoiceMeeter Aux Output", host_api="mme")
ACT_1 = "34e328b7-92a7-4bcc-9603-ff296a8fd201"
ACT_2 = "65394c9d-3e29-4f4e-9855-b510ef27dea4"


# -- the capture -------------------------------------------------------------------


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def stereo(n: int, left: float = 0.5, right: float = -0.25) -> np.ndarray:
    return np.tile(np.array([[left, right]], dtype=np.float32), (n, 1))


def test_a_reader_gets_the_capture_in_stereo_once_primed():
    live = LiveInput(CFG, 48000)
    reader = live.reader()
    block, real = reader.read(512)
    assert block.shape == (512, 2) and real == 512 and not block.any()  # nothing yet: silence
    for _ in range(8):
        live.write(stereo(1024))
    block, _ = reader.read(512)
    assert block[0].tolist() == [0.5, -0.25] and block[-1].tolist() == [0.5, -0.25]
    assert reader.underruns == 0


def test_a_mono_capture_is_doubled():
    live = LiveInput(CFG, 48000)
    reader = live.reader()
    reader.read(512)
    for _ in range(8):
        live.write(np.full((1024, 1), 0.5, dtype=np.float32))
    block, _ = reader.read(512)
    assert block[0].tolist() == [0.5, 0.5]


def test_two_readers_have_their_own_positions():
    """A bed moving speakers crossfades two voices of one capture."""
    live = LiveInput(CFG, 48000)
    a, b = live.reader(), live.reader()
    a.read(512), b.read(512)
    for _ in range(8):
        live.write(stereo(1024))
    a.read(512)
    a.read(512)
    block, _ = b.read(512)
    assert block.any() and a._r != b._r


def test_a_buffer_that_grows_slips_and_one_that_runs_short_counts():
    live = LiveInput(CFG, 48000)
    reader = live.reader()
    reader.read(512)
    for _ in range(40):
        live.write(stereo(1024))
    reader.read(512)
    assert reader.slips == 1
    while reader.underruns == 0:
        reader.read(512)
    assert reader.underruns == 1


def test_silence_is_timed_by_the_clock_so_a_dead_capture_counts():
    clock = Clock()
    live = LiveInput(CFG, 48000, clock=clock)
    live.write(stereo(100))
    clock.now = 3.0
    live.write(np.full((100, 2), 1e-5, dtype=np.float32))  # VoiceMeeter's idle bus
    assert live.silent_s() == 3.0
    clock.now = 30.0  # no callback at all
    assert live.silent_s() == 30.0
    live.write(stereo(100))
    assert live.silent_s() == 0.0


def test_the_capture_opens_the_named_device_on_its_host_api():
    opened = {}

    class Input:
        active = True

        def __init__(self, **kw):
            opened.update(kw)

        def start(self):
            opened["started"] = True

    devices = [
        {"name": "VoiceMeeter Aux Output", "hostapi": 0, "max_input_channels": 2},
        {"name": "VoiceMeeter Aux Output", "hostapi": 1, "max_input_channels": 2},
        {"name": "VoiceMeeter Output", "hostapi": 1, "max_input_channels": 2},
    ]
    apis = [{"name": "Windows DirectSound"}, {"name": "MME"}]
    live = LiveInput(CFG, 48000, factory=Input, query=lambda: (devices, apis))
    live.open()
    assert opened["device"] == 1 and opened["channels"] == 2 and opened["samplerate"] == 48000 and opened["started"]
    assert live.running


# -- the app -----------------------------------------------------------------------


class FakePage:
    """The app, as far as the reconciler can tell."""

    def __init__(self) -> None:
        self.url = "/"
        self.playing = False
        self.footer = True
        self.title = "Song"
        self.clicks: list[str] = []
        self.loads: list[tuple[str, bool]] = []
        self.load_answer: dict = {"ok": True, "title": "TITI - Act 1"}
        self.device = {"ok": True, "moved": False, "on": "VoiceMeeter Aux Input"}
        self.closed = False

    def eval(self, js: str):
        if js == STATE_JS:
            return json.dumps({"url": self.url, "footer": self.footer, "title": self.title, "artist": "Band", "time": "1:02", "duration": "3:46", "playing": self.playing})
        if LOAD_JS in js:
            uuid = js.split('const uuid="')[1].split('"')[0]
            self.loads.append((uuid, "const shuffle=true" in js))
            if self.load_answer["ok"]:
                self.url = f"/playlist/{uuid}"
                self.playing = True
            return json.dumps(self.load_answer)
        if DEVICE_JS in js:
            return json.dumps(self.device)
        if js == REPEAT_JS:
            self.clicks.append("repeat")
            return True
        name = js.split('const name="')[1].split('"')[0]
        self.clicks.append(name)
        if name == "pause":
            self.playing = False
        if name == "play":
            self.playing = True
        return True

    def close(self) -> None:
        self.closed = True


def remote(page: FakePage | None = None, clock: Clock | None = None) -> tuple[TidalRemote, FakePage]:
    page = page or FakePage()
    return TidalRemote(CFG, connect=lambda port: page, clock=clock or Clock()), page


def test_it_loads_the_wanted_playlist_once_and_sets_repeat():
    r, page = remote()
    r.want(ACT_1, shuffle=False)
    r.step()
    r.step()
    assert page.loads == [(ACT_1, False)] and page.clicks == ["repeat"]
    assert r.error is None and r.state == {"track": "Band - Song", "pos_s": 62.0, "dur_s": 226.0, "playing": True}


def test_a_new_playlist_loads_and_shuffle_is_passed_on():
    r, page = remote()
    r.want(ACT_1)
    r.step()
    r.want(ACT_2, shuffle=True)
    r.step()
    assert page.loads == [(ACT_1, False), (ACT_2, True)]


def test_a_stray_pause_resumes_and_nothing_wanted_pauses():
    r, page = remote()
    r.want(ACT_1)
    r.step()
    page.playing = False
    r.step()
    assert page.playing and page.loads == [(ACT_1, False)]  # resumed, not reloaded
    r.want(None)
    r.step()
    assert not page.playing


def test_the_same_playlist_after_a_pause_resumes_where_it_was():
    r, page = remote()
    r.want(ACT_1)
    r.step()
    r.want(None)
    r.step()
    r.want(ACT_1)
    r.step()
    assert len(page.loads) == 1 and page.playing


def test_a_restarted_router_adopts_what_the_app_is_playing():
    page = FakePage()
    page.url, page.playing = f"/playlist/{ACT_1}", True
    r, _ = remote(page)
    r.want(ACT_1)
    r.step()
    assert page.loads == [] and r.error is None


def test_a_new_worker_leaves_a_playing_app_alone_until_it_is_told():
    """The catch-up comes seconds after the router: no pause in between."""
    page = FakePage()
    page.url, page.playing = f"/playlist/{ACT_1}", True
    r, _ = remote(page)
    r.step()
    r.step()
    assert page.playing and page.clicks == []
    r.want(None)
    r.step()
    assert not page.playing


def test_a_page_left_open_but_paused_is_not_adopted():
    """The queue behind a paused footer may be anything: play it from the top."""
    page = FakePage()
    page.url = f"/playlist/{ACT_1}"
    r, _ = remote(page)
    r.want(ACT_1)
    r.step()
    assert page.loads == [(ACT_1, False)]


def test_next_clicks_next_only_on_the_wanted_playlist():
    r, page = remote()
    r.next()
    r.step()  # nothing wanted: it goes nowhere
    r.want(ACT_1)
    r.step()
    r.next()
    r.next()
    r.step()
    assert page.clicks.count("next") == 2


def test_a_playlist_that_wont_load_is_reported_and_retried_after_the_pause():
    clock = Clock()
    r, page = remote(clock=clock)
    page.load_answer = {"ok": False, "why": "it has no tracks to play"}
    r.want(ACT_1)
    r.step()
    assert "no tracks" in r.error and not r.down
    r.step()
    assert len(page.loads) == 1
    clock.now = 6.0
    page.load_answer = {"ok": True, "title": "x"}
    r.step()
    assert len(page.loads) == 2 and r.error is None


def test_changing_playlist_forgets_the_last_ones_error_and_tries_at_once():
    r, page = remote()
    page.load_answer = {"ok": False, "why": "it has no tracks to play"}
    r.want(ACT_1)
    r.step()
    assert r.error
    r.want(ACT_2)
    assert r.error is None
    r.step()
    assert [u for u, _ in page.loads] == [ACT_1, ACT_2]


def test_the_wrong_device_stops_the_load():
    r, page = remote()
    page.device = {"ok": False}
    r.want(ACT_1)
    r.step()
    assert "Sound output" in r.error and page.loads == []


def test_a_signed_out_app_is_a_problem():
    r, page = remote()
    page.footer = False
    r.want(ACT_1)
    r.step()
    assert "no player" in r.error


def test_an_app_that_dies_and_returns_is_put_right():
    pages = [FakePage(), FakePage()]
    calls = []

    def connect(port):
        calls.append(port)
        if len(calls) == 2:
            raise OSError("refused")
        return pages[0 if len(calls) == 1 else 1]

    r = TidalRemote(CFG, connect=connect)
    r.want(ACT_1)
    r.step()
    assert pages[0].playing
    pages[0].eval = lambda js: (_ for _ in ()).throw(OSError("gone"))
    r.step()
    r._retry_at = 0
    r.step()
    assert r.down and "does not answer" in r.error and calls == [9333, 9333]
    r.step()
    assert not r.down and r.error is None and pages[1].loads == [(ACT_1, False)]


def test_the_clock_text():
    assert seconds("3:46") == 226 and seconds("1:02:03") == 3723 and seconds("") is None and seconds("-") is None


# -- the director ------------------------------------------------------------------


class Reader:
    channels = 2
    length = None
    eof = False
    loop = True
    offset = 0
    played = 0
    underruns = 0

    def __init__(self, value: float) -> None:
        self.value = value
        self.closed = False

    def ready(self) -> bool:
        return True

    @property
    def finished(self) -> bool:
        return self.closed

    @property
    def position(self) -> int:
        return self.played

    def read(self, n):
        self.played += n
        return np.full((n, 2), self.value, dtype=np.float32), n

    def close(self, wait=True):
        self.closed = True


class FakeLive:
    def __init__(self) -> None:
        self.wants: list = []
        self.skips = 0
        self.opened: list[int] = []
        self.quiet = 0.0
        self.error: str | None = None
        self.down = False
        self.track = {"track": "Band - Song", "pos_s": 62.0, "dur_s": 226.0}

    def open(self, rate):
        self.opened.append(rate)

    def reader(self):
        return Reader(0.25)

    def want(self, uuid, *, shuffle=False):
        self.wants.append(uuid)

    def next(self):
        self.skips += 1

    def reachable(self):
        return not self.down

    def problem(self):
        return self.error

    def silent_s(self):
        return self.quiet

    def now(self):
        return self.track


class FileTrack(Reader):
    def __init__(self, path, rate, *, loop=False, offset=0):
        super().__init__(0.1)
        self.path, self.loop, self.offset = path, loop, offset
        self.length = 100 * rate


def soundtrack(tmp_path, *, fallback=True):
    folder = tmp_path / "act"
    folder.mkdir(exist_ok=True)
    if fallback:
        (folder / "song.mp3").write_bytes(b"x")
    return parse_soundtrack(
        {
            "scene_fade_s": 1,
            "crossfade_s": 1,
            "playlists": {
                "one": {"tidal": ACT_1, "dir": "act", "shuffle": False},
                "two": {"tidal": ACT_2},
                "files": {"dir": "act"},
            },
            "scenes": {
                "a": [{"to": "everywhere", "play": "one"}],
                "a2": [{"to": "everywhere", "play": "one"}],
                "b": [{"to": "everywhere", "play": "two"}],
                "c": [{"to": "everywhere", "play": "files"}],
                "off": [],
            },
        },
        tmp_path,
    )


def rig(tmp_path, *, fallback=True, live=None):
    live = live or FakeLive()
    mixer = Mixer(1, 12, RATE)
    d = Director(soundtrack(tmp_path, fallback=fallback), stream_factory=FileTrack, live=live)
    d.attach(mixer, DOC, HOUSE)
    return d, mixer, live


def run(d, mixer, seconds_: float):
    out = np.zeros((BLOCK, 12), dtype=np.float32)
    level = 0.0
    for _ in range(int(seconds_ * 10)):
        mixer.process(None, out)
        d.tick()
        level = float(np.abs(out).max())
    return level


def test_a_tidal_scene_asks_the_app_and_plays_on_the_music_bus(tmp_path):
    d, mixer, live = rig(tmp_path)
    assert live.opened == [RATE]
    d.set_scene("a")
    assert live.wants == [ACT_1] and d.beds["one"].live
    assert run(d, mixer, 2) > 0.07
    assert mixer.active("music") == 1


def test_a_scene_with_the_same_playlist_leaves_the_app_alone(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("a")
    run(d, mixer, 1)
    vid = d.beds["one"].cur.vid
    d.set_scene("a2")
    run(d, mixer, 1)
    assert live.wants == [ACT_1] and d.beds["one"].cur.vid == vid


def test_two_tidal_playlists_fade_out_before_the_app_changes(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("a")
    run(d, mixer, 2)
    d.set_scene("b")
    assert live.wants == [ACT_1]  # the old song is still fading
    assert d.beds["two"].live and d.beds["two"].cur is None
    run(d, mixer, 0.8)
    assert live.wants == [ACT_1]
    run(d, mixer, 0.4)
    assert live.wants == [ACT_1, ACT_2]
    assert run(d, mixer, LIVE_SWITCH_S + 0.5) < 0.07  # still fading in
    assert run(d, mixer, 2) > 0.07
    assert mixer.active("music") == 1


def test_leaving_tidal_pauses_the_app_when_the_fade_ends(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("a")
    run(d, mixer, 2)
    d.set_scene("off")
    assert live.wants == [ACT_1]
    run(d, mixer, 1.2)
    assert live.wants == [ACT_1, None]


def test_a_quick_return_cancels_the_pause(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("a")
    run(d, mixer, 2)
    d.set_scene("off")
    run(d, mixer, 0.3)
    d.set_scene("a")
    run(d, mixer, 3)
    assert None not in live.wants


def test_a_router_restarted_into_a_scene_without_the_app_pauses_it(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("off")
    assert live.wants == [None]


def test_stop_house_sounds_pauses_the_app(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("a")
    run(d, mixer, 2)
    d.stop(0.5, "stop house sounds")
    run(d, mixer, 1)
    assert live.wants == [ACT_1, None] and mixer.active("music") == 0


def test_tidal_to_files_crossfades(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("a")
    run(d, mixer, 2)
    d.set_scene("c")
    assert not d.beds["files"].live and d.beds["files"].cur is not None
    run(d, mixer, 1.2)
    assert live.wants == [ACT_1, None]


def test_next_skips_in_the_app(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("a")
    run(d, mixer, 1)
    assert d.next("one") == 1 and d.next("nothing") == 0 and live.skips == 1


def test_a_failing_app_falls_back_to_the_files(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("a")
    run(d, mixer, 2)
    live.error = "the app does not answer"
    run(d, mixer, 0.5)
    bed = d.beds["one"]
    assert not bed.live and bed.cur is not None and live.wants == [ACT_1, None]
    run(d, mixer, 2)
    assert mixer.active("music") == 1


def test_silence_on_the_cable_falls_back_only_after_its_grace(tmp_path):
    d, mixer, live = rig(tmp_path)
    live.quiet = 3600.0  # paused for an hour before this scene
    d.set_scene("a")
    run(d, mixer, 2)
    assert d.beds["one"].live
    run(d, mixer, SILENT_S)
    assert not d.beds["one"].live


def test_a_bed_waiting_for_the_fade_never_falls_back(tmp_path):
    d, mixer, live = rig(tmp_path)
    d.set_scene("b")
    run(d, mixer, 2)
    live.quiet = 3600.0
    d.set_scene("a")
    run(d, mixer, 0.5)
    assert d.beds["one"].live


def test_with_no_fallback_a_bed_waits_for_the_app(tmp_path):
    d, mixer, live = rig(tmp_path, fallback=False)
    live.down = True
    live.error = "the app does not answer"
    d.set_scene("a")
    run(d, mixer, 1)
    assert d.beds["one"].live and live.wants == [ACT_1]


def test_a_known_dead_app_starts_on_the_files_and_the_next_scene_tries_again(tmp_path):
    d, mixer, live = rig(tmp_path)
    live.down = True
    d.set_scene("a")
    assert not d.beds["one"].live and live.wants == [None]
    live.down = False
    d.set_scene("b")
    run(d, mixer, 3)
    assert d.beds["two"].live and live.wants == [None, ACT_2]


def test_a_stale_error_does_not_stop_the_next_playlist_being_tried(tmp_path):
    d, mixer, live = rig(tmp_path)
    live.error = "playlist x: it has no tracks to play"  # the app itself is up
    d.set_scene("a")
    assert d.beds["one"].live and live.wants == [ACT_1]


def test_status_shows_the_apps_track_and_no_missing_playlist(tmp_path):
    d, mixer, live = rig(tmp_path, fallback=False)
    d.set_scene("a")
    run(d, mixer, 1)
    st = d.status()
    assert st["beds"][0]["track"] == "Band - Song" and st["beds"][0]["pos_s"] == 62.0 and st["beds"][0]["dur_s"] == 226.0
    assert st["missing"] == ["files"]


def test_with_no_app_a_tidal_playlist_plays_its_files(tmp_path):
    """The MacBook fallback has no `tidal:` section."""
    mixer = Mixer(1, 12, RATE)
    d = Director(soundtrack(tmp_path), stream_factory=FileTrack)
    d.attach(mixer, DOC, HOUSE)
    d.set_scene("a")
    assert not d.beds["one"].live and d.beds["one"].cur is not None


def test_the_real_capture_reports_a_failed_open_and_tries_again():
    calls = []

    def query():
        calls.append(1)
        if len(calls) == 1:
            raise OSError("no PortAudio")
        return ([{"name": "VoiceMeeter Aux Output", "hostapi": 0, "max_input_channels": 2}], [{"name": "MME"}])

    class Input:
        active = True

        def __init__(self, **kw):
            pass

        def start(self):
            pass

    t = Tidal(CFG, factory=Input, query=query, connect=lambda port: FakePage())
    t.remote.start = lambda: None
    t.open(48000)
    assert "no PortAudio" in t.problem() and not t.reachable()
    with pytest.raises(TidalError):
        t.reader()
    t.open(48000)
    assert t.problem() is None and t.reachable() and t.reader() is not None


# -- the YAML ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "playlist, error",
    [
        ({"tidal": "not-an-id"}, r"tidal: a playlist id"),
        ({"tidal": ACT_1, "dir": "x", "files": ["y"]}, r"exactly one of dir or files \(a tidal playlist's fallback\)"),
        ({}, r"exactly one of dir or files"),
    ],
)
def test_a_bad_tidal_playlist_is_refused(tmp_path, playlist, error):
    with pytest.raises(ConfigError, match=error):
        parse_soundtrack({"playlists": {"a": playlist}}, tmp_path)


def test_one_scene_cant_hold_two_tidal_playlists(tmp_path):
    doc = {
        "playlists": {"a": {"tidal": ACT_1}, "b": {"tidal": ACT_2}},
        "scenes": {"s": [{"to": "living", "play": "a"}, {"to": "kitchen", "play": "b"}]},
    }
    with pytest.raises(ConfigError, match="one TIDAL app plays one playlist"):
        parse_soundtrack(doc, tmp_path)


def test_a_tidal_playlist_with_no_files_is_missing_only_without_the_app(tmp_path):
    st = parse_soundtrack({"playlists": {"a": {"tidal": ACT_1}}}, tmp_path)
    assert st.missing() == ["a"] and st.missing(True) == []
    assert ACT_1 in st.describe()[1]


def test_the_section_parses_and_refuses(tmp_path):
    cfg = parse_audio_section({"tidal": {"device": "VoiceMeeter Aux Output", "host_api": "DirectSound"}}, str(tmp_path))
    assert cfg.tidal == TidalConfig(device="VoiceMeeter Aux Output", host_api="directsound")
    assert parse_audio_section({}, str(tmp_path)).tidal is None
    for bad, error in (({"device": ""}, "device"), ({"device": "x", "nope": 1}, "nope"), ({"device": "x", "host_api": "jack"}, "host_api"), ({"device": "x", "port": 1}, "port")):
        with pytest.raises(ConfigError, match=error):
            parse_audio_section({"tidal": bad}, str(tmp_path))
