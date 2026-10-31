"""The input the games hear (wave 59, `docs/loom-w59-contract.md`): the wire's
mirror of `@loom/house`, the resampler, the gate, the ring the callback writes,
and the upload, over a fake stream and a fake server. Never a device."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import time
from pathlib import Path

import httpx
import numpy as np
import pytest

from stagehand.audio import gamefeed
from stagehand.audio.config import parse_audio_section
from stagehand.audio.engine import Engine
from stagehand.audio.gamefeed import (
    GATE_HANG_S,
    LOWPASS_HZ,
    RING_S,
    STREAM_PATH,
    UP_QUEUE,
    UPLOAD_PATH,
    VOICE_CHUNK_BYTES,
    VOICE_CHUNK_MS,
    VOICE_CODEC,
    VOICE_GATE_DBFS,
    VOICE_RATE,
    Downsampler,
    GameFeed,
    GameFeedConfig,
    Gate,
    mulaw_encode,
    rms_dbfs,
)
from stagehand.config import load_config
from stagehand.modapi import ModApiError, ModClient
from stagehand.module import ConfigError

from test_audio_engine import FakeStream, fake_query
from test_audio_router import answer, router, stream_of

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
FIXTURE = HERE / "fixtures" / "house-audio" / "voice-mulaw.json"
HOUSE_FIXTURE = ROOT / "house" / "test" / "fixtures" / "voice-mulaw.json"
HOUSE_TS = ROOT / "house" / "src" / "voice.ts"
WEB_TS = ROOT / "reinstall" / "web" / "src" / "game" / "voice.ts"
SHOW = ROOT / "core" / "examples" / "trapped-in-the-internet"
RATE = 48000
#: Input frames in one 200 ms chunk at `RATE`.
CHUNK_IN = RATE // 5


def sine(hz: float, seconds: float, rate: int = RATE, level: float = 0.5) -> np.ndarray:
    return (level * np.sin(2 * np.pi * hz * np.arange(int(rate * seconds)) / rate)).astype(np.float32)


class Clock:
    def __init__(self, t: float = 100.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


def feed_of(cfg: GameFeedConfig | None = None, listening: bool = True, clock: Clock | None = None) -> GameFeed:
    feed = GameFeed(cfg or GameFeedConfig(), clock=clock or Clock(), wall=lambda: 1000.0)
    feed.open(RATE)
    feed.listening = listening
    return feed


class FakeMod:
    """The server's half: records the uploads, and answers as told."""

    def __init__(self, answers: list | None = None) -> None:
        self.answers = list(answers or [])
        self.posts: list[dict] = []
        self.forgot = 0

    def stream_url(self, path: str) -> str:
        return f"fake://{path}"

    def forget_token(self) -> None:
        self.forgot += 1

    async def post_bytes(self, path, body, params=None, timeout=None):
        self.posts.append({"path": path, "body": body, "params": params, "timeout": timeout})
        item = self.answers.pop(0) if self.answers else {"ok": True, "listening": True, "ears": 1}
        if isinstance(item, Exception):
            raise item
        return item


async def sends(feed: GameFeed, mod: FakeMod, until) -> None:
    """Run the send loop until `until()`, or fail."""
    task = asyncio.ensure_future(feed._send_loop(mod))
    try:
        for _ in range(500):
            await asyncio.sleep(0)
            if until():
                return
            await asyncio.sleep(0.001)
        raise AssertionError("the send loop never got there")
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


# -- the mirror of @loom/house ----------------------------------------------------


def ts_value(text: str, name: str) -> str:
    found = re.search(rf"export const {name} = (.+?);", text)
    assert found is not None, name
    return found.group(1).strip().strip('"')


def test_the_wire_is_the_houses():
    if not HOUSE_TS.exists():
        pytest.skip("house/ is not beside this stagehand tree")
    text = HOUSE_TS.read_text(encoding="utf-8")
    assert int(ts_value(text, "VOICE_RATE")) == VOICE_RATE
    assert int(ts_value(text, "VOICE_CHUNK_MS")) == VOICE_CHUNK_MS
    assert int(ts_value(text, "VOICE_CHUNK_BYTES")) == VOICE_CHUNK_BYTES
    assert ts_value(text, "VOICE_CODEC") == VOICE_CODEC
    assert float(ts_value(text, "VOICE_GATE_DBFS")) == VOICE_GATE_DBFS
    web = WEB_TS.read_text(encoding="utf-8")
    assert float(ts_value(web, "VOICE_LOWPASS_HZ")) == LOWPASS_HZ
    assert int(ts_value(web, "VOICE_UP_QUEUE")) == UP_QUEUE


def test_the_vectors_are_a_copy_of_the_houses():
    if not HOUSE_FIXTURE.exists():
        pytest.skip("house/ is not beside this stagehand tree")
    assert FIXTURE.read_bytes() == HOUSE_FIXTURE.read_bytes(), "re-copy house/test/fixtures/voice-mulaw.json"


def test_mulaw_matches_every_vector():
    rows = [r for r in json.loads(FIXTURE.read_text(encoding="utf-8")) if r["kind"] == "encode"]
    assert len(rows) > 10
    got = mulaw_encode(np.array([r["x"] for r in rows], dtype=np.float64))
    assert list(got) == [r["byte"] for r in rows]


def test_mulaw_clamps_and_takes_nan_as_silence():
    assert mulaw_encode(np.array([2.0, -2.0, float("nan"), 0.0])) == bytes([0x80, 0x00, 0xFF, 0xFF])


def test_a_whole_chunk_encodes_inside_a_block_of_real_time():
    assert len(mulaw_encode(np.zeros(VOICE_CHUNK_BYTES))) == VOICE_CHUNK_BYTES


# -- the resampler -----------------------------------------------------------------


def test_a_tone_comes_through_at_16k_where_it_should():
    out = Downsampler(RATE).push(sine(1000, 1.0))
    assert len(out) == VOICE_RATE
    # The filter is linear-phase: its delay is half its length.
    delay_s = (len(gamefeed._lowpass(RATE)) - 1) / 2 / RATE
    t = np.arange(len(out)) / VOICE_RATE
    want = 0.5 * np.sin(2 * np.pi * 1000 * (t - delay_s))
    settled = int(0.05 * VOICE_RATE)
    assert np.abs(out[settled:] - want[settled:]).max() < 0.01


def test_nothing_above_the_wires_nyquist_folds_back():
    for hz in (9000, 12000, 15000, 20000):
        out = Downsampler(RATE).push(sine(hz, 0.5))[1000:]
        assert rms_dbfs(out) < rms_dbfs(sine(hz, 0.5)) - 40, hz


def test_the_voice_band_stays_flat():
    for hz in (200, 3000, 6000):
        out = Downsampler(RATE).push(sine(hz, 0.5))[1000:]
        assert abs(rms_dbfs(out) - rms_dbfs(sine(hz, 0.5))) < 1.0, hz


@pytest.mark.parametrize("rate", [48000, 44100])
def test_any_split_is_the_whole(rate):
    x = sine(440, 1.0, rate) + sine(1700, 1.0, rate, 0.2)
    whole = Downsampler(rate).push(x)
    down = Downsampler(rate)
    parts, i, rng = [], 0, np.random.default_rng(7)
    while i < len(x):
        n = int(rng.integers(1, 2000))
        parts.append(down.push(x[i : i + n]))
        i += n
    assert np.abs(np.concatenate(parts) - whole).max() < 1e-4
    assert len(whole) == pytest.approx(VOICE_RATE, abs=2)


def test_nothing_drifts_over_a_night_at_a_rate_that_is_no_multiple():
    down = Downsampler(44100)
    total = sum(len(down.push(np.zeros(4410))) for _ in range(36000))  # an hour
    assert total == pytest.approx(3600 * VOICE_RATE, abs=2)


# -- the gate ----------------------------------------------------------------------


def test_the_gate_opens_with_its_preroll_holds_then_closes():
    g = Gate(-42, hang_s=1.0)
    quiet, loud = b"q", b"L"
    assert g.push(quiet, -70, 0.0) == []
    assert g.push(loud, -20, 0.2) == [quiet, loud]  # the word's onset
    assert g.push(quiet, -70, 0.4) == [quiet]
    assert g.push(quiet, -70, 1.2) == [quiet]  # the pause between two phrases
    assert g.push(quiet, -70, 1.3) == []
    assert g.open is False


def test_the_gate_hangs_longer_than_a_terminals():
    text = HOUSE_TS.read_text(encoding="utf-8") if HOUSE_TS.exists() else "export const VOICE_HANG_MS = 400;"
    assert GATE_HANG_S * 1000 > float(ts_value(text, "VOICE_HANG_MS"))


def test_a_silent_input_sends_nothing():
    feed = feed_of()
    feed.write(np.zeros(CHUNK_IN * 3, dtype=np.float32))
    feed.drain()
    assert not feed.queue


# -- the ring and the chunks --------------------------------------------------------


def test_a_loud_input_makes_whole_chunks_for_the_wire():
    feed = feed_of()
    tone = sine(800, 0.65)
    for start in range(0, len(tone), 512):
        feed.write(tone[start : start + 512])
    feed.drain()
    assert len(feed.queue) == 3 and all(len(c) == VOICE_CHUNK_BYTES for c in feed.queue)


def test_only_what_is_heard_is_kept_and_the_level_is_read_either_way():
    feed = feed_of(listening=False)
    feed.write(sine(800, 0.4))
    feed.drain()
    assert not feed.queue
    assert feed.peak == pytest.approx(0.5, abs=0.01)
    assert "-6 dBFS" in feed.stats() and "nobody hearing" in feed.stats()
    assert "-120 dBFS" in feed.stats()  # the peak is since the last call


def test_the_gain_is_applied_and_clipping_is_the_codecs():
    feed = feed_of(GameFeedConfig(gain_db=6.0))
    feed.write(sine(800, 0.25, level=0.25))
    feed.drain()
    assert feed.peak == pytest.approx(0.5, abs=0.01)


def test_the_upload_queue_keeps_the_newest():
    feed = feed_of()
    feed.write(sine(800, 1.5))
    feed.drain()
    assert len(feed.queue) == UP_QUEUE and feed.dropped > 0


def test_a_stalled_loop_loses_the_oldest_and_counts_it():
    feed = feed_of(listening=False)
    too_much = int(RATE * RING_S) + 1000
    ramp = np.arange(too_much, dtype=np.float32) / too_much
    for start in range(0, too_much, 512):
        feed.write(ramp[start : start + 512])
    taken = feed._take()
    assert len(taken) == int(RATE * RING_S) and feed.overflows > 0
    assert taken[-1] == ramp[-1]


def test_the_ring_is_gapless_across_its_wrap_and_two_threads():
    """The callback on one thread, the event loop on another, as in the house."""
    feed = feed_of(listening=False)
    total = RATE * 5
    ramp = (np.arange(total) % 1000).astype(np.float32)
    got: list[np.ndarray] = []

    def writer() -> None:
        for start in range(0, total, 512):
            # A device paces its callback; left free, one GIL slice laps the ring.
            while feed._w - feed._r > RATE:
                time.sleep(0)
            feed.write(ramp[start : start + 512])

    thread = threading.Thread(target=writer)
    thread.start()
    while thread.is_alive():
        got.append(feed._take())
    thread.join()
    got.append(feed._take())
    assert feed.overflows == 0
    assert np.array_equal(np.concatenate(got), ramp)


def test_a_long_block_never_overruns_the_ring():
    feed = feed_of(listening=False)
    feed.write(np.ones(int(RATE * RING_S) * 2, dtype=np.float32))
    assert len(feed._take()) == int(RATE * RING_S)


def test_nothing_is_written_before_a_stream_opens():
    feed = GameFeed(GameFeedConfig())
    feed.write(np.ones(512, dtype=np.float32))
    feed.drain()
    assert not feed.opened and "NOT OPEN" in feed.stats()


# -- the stream ---------------------------------------------------------------------


def test_the_stream_says_it_is_a_mic_that_plays_nothing():
    feed = feed_of(GameFeedConfig(spot="a b"))
    assert feed.stream_path() == f"{STREAM_PATH}?spot=a%20b&mic=1&hear=0"


def test_the_stream_says_when_to_send():
    feed = feed_of(listening=False)
    feed.on_frame("hello", json.dumps({"codec": "mulaw", "rate": 16000, "listen": False, "ears": 0}))
    assert feed.listening is False
    feed.on_frame("listen", json.dumps({"on": True, "ears": 2}))
    assert feed.listening is True and feed.ears == 2
    feed.write(sine(800, 0.25))
    feed.drain()
    assert feed.queue
    feed.on_frame("listen", json.dumps({"on": False, "ears": 0}))
    assert feed.listening is False and not feed.queue and feed.ears == 0


def test_a_reconnect_tells_it_again():
    feed = feed_of(listening=False)
    feed.on_frame("hello", json.dumps({"codec": "mulaw", "rate": 16000, "listen": True, "ears": 1}))
    assert feed.listening is True


def test_a_wire_it_cant_speak_is_never_sent_to():
    feed = feed_of(listening=False)
    feed.on_frame("hello", json.dumps({"codec": "opus", "rate": 48000, "listen": True}))
    feed.write(sine(800, 0.25))
    feed.drain()
    assert feed.compatible is False and not feed.queue


def test_other_frames_and_junk_are_ignored():
    feed = feed_of(listening=False)
    feed.on_frame("voice", json.dumps({"on": True}))
    feed.on_frame("listen", "not json")
    feed.on_frame("listen", "[1]")
    assert feed.listening is False


def test_stopping_listening_starts_the_next_chunk_clean():
    feed = feed_of()
    feed.write(sine(800, 0.1))
    feed.drain()
    assert len(feed._pending) > 0
    feed.set_listening(False)
    assert len(feed._pending) == 0 and feed._gate.open is False


# -- the upload ----------------------------------------------------------------------


def test_chunks_go_up_in_order_as_this_spot():
    async def main():
        feed = feed_of()
        mod = FakeMod()
        feed.write(sine(800, 0.45))
        await sends(feed, mod, lambda: len(mod.posts) == 2)
        return feed, mod

    feed, mod = asyncio.run(main())
    assert [p["path"] for p in mod.posts] == [UPLOAD_PATH, UPLOAD_PATH]
    assert [p["params"]["spot"] for p in mod.posts] == ["desktop-tv", "desktop-tv"]
    assert [p["params"]["seq"] for p in mod.posts] == [5000, 5001]  # the wall clock's chunks
    assert all(len(p["body"]) == VOICE_CHUNK_BYTES for p in mod.posts)
    assert mod.posts[0]["timeout"] == gamefeed.POST_TIMEOUT_S and feed.sent == 2


def test_a_restarted_router_is_never_below_where_it_left_off():
    first = GameFeed(GameFeedConfig(), wall=lambda: 1000.0)
    first.seq += 5 * 3600  # an hour at five chunks a second
    again = GameFeed(GameFeedConfig(), wall=lambda: 1000.0 + 3600 + 1)
    assert again.seq > first.seq


def test_an_answer_that_nobody_hears_empties_the_queue_and_the_stream_stays_the_authority():
    async def main():
        feed = feed_of()
        mod = FakeMod([{"ok": True, "listening": False, "ears": 0, "dropped": True}])
        feed.write(sine(800, 0.65))
        feed.drain()
        assert len(feed.queue) == 3
        await sends(feed, mod, lambda: len(mod.posts) >= 1)
        return feed, mod

    feed, mod = asyncio.run(main())
    assert len(mod.posts) == 1 and not feed.queue
    assert feed.listening is True  # an answer can land after a newer `listen {on}`


@pytest.mark.parametrize("status", [401, 403])
def test_a_refused_token_is_dropped_and_the_loop_goes_on(status, monkeypatch):
    monkeypatch.setattr(gamefeed, "REFUSED_S", 0.0)

    async def main():
        feed = feed_of()
        mod = FakeMod([ModApiError("no", status)])
        feed.write(sine(800, 0.45))
        await sends(feed, mod, lambda: len(mod.posts) == 2)
        return feed, mod

    feed, mod = asyncio.run(main())
    assert mod.forgot == 1 and feed.sent == 1 and feed.dropped == 1


def test_a_dead_network_never_stops_the_loop_and_is_logged_once(monkeypatch, caplog):
    monkeypatch.setattr(gamefeed, "REFUSED_S", 0.0)

    async def main():
        feed = feed_of()
        mod = FakeMod([httpx.ConnectError("gone"), OSError("gone"), {"ok": True, "listening": True}])
        feed.write(sine(800, 0.65))
        await sends(feed, mod, lambda: len(mod.posts) == 3)
        return feed

    with caplog.at_level(logging.WARNING, logger="stagehand.audio"):
        feed = asyncio.run(main())
    assert feed.sent == 1 and sum("upload failed" in r.getMessage() for r in caplog.records) == 1


def test_a_chunk_that_blows_up_costs_only_that_chunk(monkeypatch, caplog):
    async def main():
        feed = feed_of()
        real = feed.drain
        calls = {"n": 0}

        def flaky() -> None:
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("boom")
            real()

        monkeypatch.setattr(feed, "drain", flaky)
        mod = FakeMod()
        feed.write(sine(800, 0.25))
        await sends(feed, mod, lambda: len(mod.posts) == 1)
        return mod

    with caplog.at_level(logging.WARNING, logger="stagehand.audio"):
        asyncio.run(main())
    assert any("a chunk failed" in r.getMessage() for r in caplog.records)


def test_run_never_raises_and_restarts_itself(monkeypatch):
    """The router's jobs share one gather: a fault here must not end them."""
    monkeypatch.setattr(gamefeed, "RESTART_S", 0.0)
    calls: list[str] = []

    async def fake_run_stream(client, url, on_frame, *, label):
        calls.append(url)
        if len(calls) == 1:
            raise RuntimeError("a bug")
        await asyncio.sleep(3600)

    monkeypatch.setattr(gamefeed, "run_stream", fake_run_stream)

    async def main():
        feed = feed_of()
        task = asyncio.ensure_future(feed.run(FakeMod()))
        for _ in range(100):
            await asyncio.sleep(0.001)
            if len(calls) == 2:
                break
        assert not task.done()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        return feed

    feed = asyncio.run(main())
    assert calls == [f"fake://{feed.stream_path()}"] * 2
    assert feed.listening is False  # nobody told it otherwise, after the fault


def test_post_bytes_sends_raw_and_never_logs_in_on_a_403():
    """Five chunks a second must not become five logins a second."""

    async def main():
        seen: list[httpx.Request] = []

        def answer(req: httpx.Request) -> httpx.Response:
            seen.append(req)
            if req.url.params["seq"] == "1":
                return httpx.Response(403, json={"error": "voice is off at this terminal"})
            return httpx.Response(200, json={"ok": True, "listening": True})

        mod = ModClient("http://x", event="ev", token="t", passcode="p")
        await mod._client.aclose()
        mod._client = httpx.AsyncClient(base_url="http://x", transport=httpx.MockTransport(answer))
        ok = await mod.post_bytes(UPLOAD_PATH, b"\xff" * 3200, params={"seq": 0, "spot": "desktop-tv"})
        with pytest.raises(ModApiError) as refused:
            await mod.post_bytes(UPLOAD_PATH, b"\xff" * 3200, params={"seq": 1, "spot": "desktop-tv"})
        await mod.aclose()
        return ok, refused.value.status, seen

    ok, status, seen = asyncio.run(main())
    assert ok["listening"] is True and status == 403 and len(seen) == 2
    req = seen[0]
    assert req.url.path == "/e/ev/api/spatial/voice" and req.url.params["spot"] == "desktop-tv"
    assert req.headers["x-loom-token"] == "t" and req.headers["content-type"] == "application/octet-stream"
    assert req.content == b"\xff" * 3200


# -- the engine ---------------------------------------------------------------------


def engine_with(feed, n_in: int = 4, **kw) -> Engine:
    return Engine("MOTU", n_in, 4, rate=RATE, query=fake_query(n_in, 4, rate=RATE), stream_factory=lambda **k: FakeStream(**k), feed=feed, **kw)


def block(column: int, value: float, frames: int = 512, n_in: int = 4) -> np.ndarray:
    data = np.zeros((frames, n_in), dtype=np.float32)
    data[:, column - 1] = value
    return data


@pytest.mark.parametrize("ch", [1, 3])
def test_the_callback_hands_over_only_its_input_and_leaves_portaudios_buffer(ch):
    FakeStream.opened.clear()
    feed = GameFeed(GameFeedConfig(ch=ch))
    e = engine_with(feed)
    e.open()
    data = block(ch, 0.25)
    held = data.copy()
    FakeStream.opened[-1].pump(512, data)
    assert np.array_equal(data, held)
    assert np.array_equal(feed._take(), np.full(512, 0.25, dtype=np.float32))
    other = block(2, 0.25)
    FakeStream.opened[-1].pump(512, other)
    assert not feed._take().any()


def test_the_feed_does_not_touch_what_the_house_hears():
    """The same blocks, with and without a feed, through a routed input."""
    outs = []
    for feed in (None, GameFeed(GameFeedConfig())):
        FakeStream.opened.clear()
        e = engine_with(feed)
        mixer = e.open()
        mixer.set_passthrough(True)
        mixer.set_routes({(1, 1): 0.0})
        for _ in range(8):  # past the matrix's ramp
            out = FakeStream.opened[-1].pump(512, block(1, 0.25))
        outs.append(out.copy())
    assert np.abs(outs[0][:, 0]).max() > 0.2  # it really is routed
    assert np.array_equal(outs[0], outs[1])


def test_a_feed_that_throws_leaves_the_path_and_the_house_plays_on():
    class Broken:
        cfg = GameFeedConfig()

        def open(self, rate: int) -> None:
            pass

        def write(self, column: np.ndarray) -> None:
            raise RuntimeError("boom")

    FakeStream.opened.clear()
    e = engine_with(Broken())
    e.open()
    s = FakeStream.opened[-1]
    assert s.pump(512, block(1, 0.25)).shape == (512, 4)
    assert e.feed_failed is True and e.errors == 1
    assert s.pump(512, block(1, 0.25)).shape == (512, 4)  # once, not every block
    assert e.errors == 1
    e.open()  # a reopened stream gets it back
    assert e.feed_failed is False


def test_the_feed_comes_back_with_a_reopened_stream():
    FakeStream.opened.clear()
    feed = GameFeed(GameFeedConfig())
    e = engine_with(feed)
    e.open()
    FakeStream.opened[-1].pump(512, block(1, 0.25))
    e.open()
    assert not len(feed._take())  # what the old stream left is not heard
    FakeStream.opened[-1].pump(512, block(1, 0.25))
    assert len(feed._take()) == 512


def test_an_input_past_the_stream_is_a_log_line_not_a_crash(caplog):
    FakeStream.opened.clear()
    feed = GameFeed(GameFeedConfig(ch=9))
    e = engine_with(feed)
    with caplog.at_level(logging.ERROR, logger="stagehand.audio"):
        e.open()
    FakeStream.opened[-1].pump(512, block(1, 0.25))
    assert not feed.opened and any("game feed not opened" in r.getMessage() for r in caplog.records)
    assert e.feed_failed is False


def test_a_stream_reopened_with_fewer_inputs_stops_reading_it():
    FakeStream.opened.clear()
    feed = GameFeed(GameFeedConfig(ch=3))
    e = engine_with(feed)
    e.open()
    e.want_in = 2  # audio.json moved; the callback's slice would raise
    e.open()
    FakeStream.opened[-1].pump(512, np.zeros((512, 2), dtype=np.float32))
    assert e.errors == 0 and e.feed_failed is False


def test_an_output_only_stream_never_opens_it():
    FakeStream.opened.clear()
    feed = GameFeed(GameFeedConfig())
    e = Engine("MOTU", 4, 4, duplex=False, rate=RATE, query=fake_query(4, 4, rate=RATE), stream_factory=lambda **k: FakeStream(**k), feed=feed)
    e.open()
    assert not feed.opened


# -- the section and the router ---------------------------------------------------


def test_the_section_defaults_to_the_tv_and_takes_its_fields(tmp_path):
    assert parse_audio_section({}, str(tmp_path)).game_feed is None
    assert parse_audio_section({"game_feed": {}}, str(tmp_path)).game_feed == GameFeedConfig(ch=1, spot="desktop-tv", gain_db=0.0, gate_db=-42.0)
    cfg = parse_audio_section({"game_feed": {"ch": 2, "spot": " hall ", "gain_db": 6, "gate_db": -50}}, str(tmp_path)).game_feed
    assert cfg == GameFeedConfig(ch=2, spot="hall", gain_db=6.0, gate_db=-50.0)


@pytest.mark.parametrize(
    ("raw", "word"),
    [
        ("yes", "a mapping"),
        ({"chan": 1}, "chan: unknown"),
        ({"ch": 0}, "game_feed.ch"),
        ({"spot": ""}, "game_feed.spot"),
        ({"spot": 3}, "game_feed.spot"),
        ({"gain_db": 99}, "game_feed.gain_db"),
        ({"gate_db": 3}, "game_feed.gate_db"),
    ],
)
def test_a_bad_section_fails_at_boot_never_mid_show(tmp_path, raw, word):
    with pytest.raises(ConfigError, match=word):
        parse_audio_section({"game_feed": raw}, str(tmp_path))


def test_the_router_says_what_it_is_doing(tmp_path):
    r = router(tmp_path, game_feed={"ch": 1, "spot": "desktop-tv"})
    assert any(line.startswith("game feed: input 1 heard in the reinstallation games at desktop-tv") for line in r.describe())
    h = r.health()
    assert "input 1 → desktop-tv" in h["game_feed"]
    assert router(tmp_path).feed is None and router(tmp_path).health()["game_feed"] is None


def test_a_router_with_no_inputs_has_no_feed_and_says_so(tmp_path):
    r = router(tmp_path, game_feed={"ch": 1}, passthrough=False)
    assert r.feed is None
    assert any("NOT RUNNING" in line for line in r.describe())


def test_the_router_opens_the_feed_with_its_stream_and_says_when_it_failed(tmp_path):
    r = router(tmp_path, game_feed={"ch": 1})
    assert r.apply(answer("v1")) and r.engine_running()
    assert r.engine.feed is r.feed and r.feed.opened
    stream_of(r).pump(512)
    assert len(r.feed._take()) == 512
    assert "FAILED" not in r.feed_state()
    r.engine.feed_failed = True
    assert "FAILED" in r.feed_state()


def test_the_desktop_feeds_mic_1_to_the_tv_and_the_macbook_nothing(monkeypatch):
    monkeypatch.setenv("SD_ENABLE_ASIO", "1")
    env = {"LOOM_EVENT_ID": "ev", "LOOM_MOD_PASSCODE": "pw"}
    desktop = load_config(HERE.parent / "trapped.desktop.yaml", only=["audio"], env=env).modules["audio"].cfg
    assert desktop.game_feed == GameFeedConfig(ch=1, spot="desktop-tv")
    macbook = load_config(HERE.parent / "trapped.macbook.yaml", only=["audio"], env=env).modules["audio"].cfg
    assert macbook.game_feed is None  # output-only: it has no inputs to read


@pytest.mark.parametrize("name", ["house.json", "house.shed.json"])
def test_the_spot_is_a_voice_terminal_in_the_desktop_on_both_show_maps(name):
    house = json.loads((SHOW / name).read_text(encoding="utf-8"))
    spot = next(t for t in house["terminals"] if t["id"] == GameFeedConfig.spot)
    assert spot["room"] == "desktop" and spot.get("voice") is not False and spot["view"] == "tv"
    assert house["spawn"]["room"] != spot["room"]  # voiceOn's unset rule
    # At most `VOICE_MAX_TERMINALS` compete for a player's ears in the room.
    assert sum(t["room"] == spot["room"] for t in house["terminals"]) <= 4


def test_mic_1_is_an_input_of_the_show_interface():
    audio = json.loads((SHOW / "audio.json").read_text(encoding="utf-8"))
    assert GameFeedConfig.ch in [i["ch"] for i in audio["inputs"]]
    assert audio["device"]["rate"] == RATE
