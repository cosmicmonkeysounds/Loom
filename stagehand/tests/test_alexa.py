"""The fake Alexa (`alexa` module): payloads, config, the fallback ladder,
the voice cache, and the server TTS call — all with no sound card."""

from __future__ import annotations

import asyncio
import io
import json

import httpx
import numpy as np
import pytest
import soundfile as sf

from stagehand.alexa.config import parse_alexa
from stagehand.alexa.module import Announcement, Announcer, VoiceCache, parse_payload
from stagehand.alexa.player import PlaybackError, chime, fit_channels, resample
from stagehand.config import parse_config
from stagehand.modapi import ModApiError, ModClient
from stagehand.module import ConfigError


def run(coro):
    return asyncio.run(coro)


def wav(seconds: float = 0.05, rate: int = 22050, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.zeros((int(rate * seconds), channels), dtype=np.float32), rate, format="WAV")
    return buf.getvalue()


def cfg(tmp_path, **over):
    doc = {"mqtt": {"host": "127.0.0.1"}, "cache_dir": str(tmp_path / "cache"), "tts_timeout": 0.5, **over}
    return parse_alexa(doc, str(tmp_path))


class FakeOutput:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.played: list[tuple[int, int]] = []  # (frames, rate)

    def describe(self) -> str:
        return "fake"

    def play(self, samples, rate) -> None:
        if self.fail:
            raise PlaybackError("no such device")
        self.played.append((len(samples), rate))


class Effects:
    """Records the `say` side effects the announcer reaches for."""

    def __init__(self, render_fails: bool = False, direct_fails_on: tuple = ()) -> None:
        self.rendered: list[str] = []
        self.direct: list[tuple[str, str | None]] = []
        self.render_fails = render_fails
        self.direct_fails_on = direct_fails_on

    def render(self, text, voice):
        if self.render_fails:
            raise PlaybackError("say -o failed")
        self.rendered.append(text)
        return wav()

    def speak(self, text, voice, device):
        if device in self.direct_fails_on:
            raise PlaybackError(f"say -a {device} failed")
        self.direct.append((text, device))


def announcer(c, fetch=None, output=None, effects=None):
    effects = effects or Effects()
    return Announcer(c, fetch, output=output or FakeOutput(), render_say=effects.render, speak_direct=effects.speak), effects


# -- payloads -----------------------------------------------------------------


def test_payloads_json_bare_and_junk():
    assert parse_payload(b'{"text": "Go to the  living room."}') == Announcement("Go to the living room.")
    assert parse_payload(b'{"text": "Hi", "voice": "af_heart", "chime": false}') == Announcement("Hi", "af_heart", False)
    assert parse_payload(b"Time is up.") == Announcement("Time is up.")
    assert parse_payload(b'"quoted"') == Announcement("quoted")
    for junk in (b"", b"   ", b'{"text": ""}', b'{"text": 5}', b"[1,2]", b'{"text": "{target}"}', b"\xff\xfe"):
        assert parse_payload(junk) is None, junk


# -- config -------------------------------------------------------------------


def test_config_defaults_and_validation(tmp_path):
    c = parse_alexa({"mqtt": {"host": "h"}})
    assert (c.topic, c.device, c.channels, c.chime, c.voice, c.say_voice) == (
        "show/announce", None, None, "synth", "af_sky", "Samantha",
    )
    assert c.mqtt.client_id == "stagehand-alexa"
    with pytest.raises(ConfigError, match="mqtt"):
        parse_alexa({})
    with pytest.raises(ConfigError, match="channels"):
        parse_alexa({"mqtt": {"host": "h"}, "channels": [0, 1]})
    with pytest.raises(ConfigError, match="twice"):
        parse_alexa({"mqtt": {"host": "h"}, "channels": [1, 1]})
    with pytest.raises(ConfigError, match="no such file"):
        parse_alexa({"mqtt": {"host": "h"}, "chime": "nope.wav"}, str(tmp_path))
    (tmp_path / "ding.wav").write_bytes(wav())
    assert parse_alexa({"mqtt": {"host": "h"}, "chime": "ding.wav"}, str(tmp_path)).chime == str((tmp_path / "ding.wav").resolve())
    assert parse_alexa({"mqtt": {"host": "h"}, "chime": False}).chime == "off"
    with pytest.raises(ConfigError, match="speed"):
        parse_alexa({"mqtt": {"host": "h"}, "speed": 3})


def test_alexa_is_a_registered_module_section():
    c = parse_config({"server": {"url": "http://h", "mod_passcode": "x"}, "alexa": {"mqtt": {"host": "h"}, "device": "MOTU"}})
    alexa = c.modules["alexa"]
    assert alexa.name == "alexa"
    assert any("MOTU" in line for line in alexa.describe())


# -- the fallback ladder -------------------------------------------------------


def test_server_voice_plays_after_the_chime_and_is_cached(tmp_path):
    c = cfg(tmp_path)
    calls = []

    async def fetch(text, voice):
        calls.append((text, voice))
        return wav(rate=24000)

    a, fx = announcer(c, fetch)
    assert run(a.announce(Announcement("Go to the living room."))) == "device"
    assert [r for _, r in a.output.played] == [48000, 24000]  # chime, then the voice
    assert calls == [("Go to the living room.", "af_sky")]
    # The second time comes off disk — no server call.
    assert run(a.announce(Announcement("Go to the living room.", chime=False))) == "device"
    assert len(calls) == 1 and fx.rendered == [] and fx.direct == []


def test_server_down_falls_back_to_say_through_the_device(tmp_path):
    async def fetch(text, voice):
        raise ModApiError("503 no voice", 503)

    a, fx = announcer(cfg(tmp_path), fetch)
    assert run(a.announce(Announcement("Time is up."))) == "device-say"
    assert fx.rendered == ["Time is up."] and len(a.output.played) == 2


def test_a_slow_server_times_out_into_say(tmp_path):
    async def fetch(text, voice):
        await asyncio.sleep(5)
        return wav()

    a, fx = announcer(cfg(tmp_path, tts_timeout=0.05), fetch)
    assert run(a.announce(Announcement("Hi", chime=False))) == "device-say"


def test_no_server_link_at_all_uses_say(tmp_path):
    a, fx = announcer(cfg(tmp_path), None)
    assert run(a.announce(Announcement("Hi"))) == "device-say"


def test_a_missing_device_falls_back_to_say_dash_a_then_default(tmp_path):
    c = cfg(tmp_path, device="MOTU")
    a, fx = announcer(c, None, output=FakeOutput(fail=True))
    assert run(a.announce(Announcement("Hi"))) == "say-device"
    assert fx.direct == [("Hi", "MOTU")]

    a, fx = announcer(c, None, output=FakeOutput(fail=True), effects=Effects(direct_fails_on=("MOTU",)))
    assert run(a.announce(Announcement("Hi"))) == "say-default"
    assert fx.direct == [("Hi", None)]

    a, fx = announcer(c, None, output=FakeOutput(fail=True), effects=Effects(direct_fails_on=("MOTU", None)))
    assert run(a.announce(Announcement("Hi"))) == "failed"


def test_say_render_failure_still_speaks(tmp_path):
    a, fx = announcer(cfg(tmp_path), None, effects=Effects(render_fails=True))
    assert run(a.announce(Announcement("Hi", chime=False))) == "say-default"


def test_chime_off_and_per_message_no_chime(tmp_path):
    async def fetch(text, voice):
        return wav()

    a, _ = announcer(cfg(tmp_path, chime="off"), fetch)
    run(a.announce(Announcement("Hi")))
    assert len(a.output.played) == 1


def test_prewarm_fetches_once_and_survives_restart(tmp_path):
    c = cfg(tmp_path, prewarm=["Go to the living room.", "Time is up."])
    calls = []

    async def fetch(text, voice):
        calls.append(text)
        return wav()

    a, _ = announcer(c, fetch)
    assert run(a.prewarm()) == 2
    b, _ = announcer(c, fetch)  # a fresh process, same disk
    assert run(b.prewarm()) == 2
    assert calls == ["Go to the living room.", "Time is up."]


def test_voice_cache_keys_on_voice(tmp_path):
    vc = VoiceCache(str(tmp_path))
    vc.put("Hi", "af_sky", b"one")
    assert vc.get("Hi", "af_sky") == b"one"
    assert vc.get("Hi", "am_michael") is None


# -- the signal path -----------------------------------------------------------


def test_fit_channels_repeats_the_source_across_the_map():
    mono = np.array([[1.0], [2.0]], dtype=np.float32)
    assert fit_channels(mono, 4).tolist() == [[1, 1, 1, 1], [2, 2, 2, 2]]
    stereo = np.array([[1.0, -1.0]], dtype=np.float32)
    assert fit_channels(stereo, 4).tolist() == [[1, -1, 1, -1]]
    assert fit_channels(stereo, 1).tolist() == [[1]]


def test_resample_length_and_chime_shape():
    x = np.ones((24000, 1), dtype=np.float32)
    assert resample(x, 24000, 48000).shape == (48000, 1)
    ch = chime()
    assert ch.shape[1] == 1 and 0.5 < len(ch) / 48000 < 0.8 and float(np.abs(ch).max()) <= 1.0


# -- the server call -------------------------------------------------------------


def test_mod_client_speak_posts_to_the_tts_route_and_relogs_on_403():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.url.path, req.headers.get("x-loom-token"), req.content))
        if req.url.path.endswith("/login"):
            return httpx.Response(200, json={"token": f"t{len(seen)}"})
        if req.headers.get("x-loom-token") == "t1":
            return httpx.Response(403, json={"error": "moderators only"})
        return httpx.Response(200, content=b"ID3audio", headers={"content-type": "audio/mpeg"})

    async def go():
        mod = ModClient("http://h", event="ev1", passcode="pw")
        mod._client = httpx.AsyncClient(base_url="http://h", transport=httpx.MockTransport(handler))
        try:
            return await mod.speak("Hi", voice="af_sky", speed=1.1)
        finally:
            await mod.aclose()

    data, ctype = run(go())
    assert (data, ctype) == (b"ID3audio", "audio/mpeg")
    tts = [s for s in seen if s[0] == "/e/ev1/api/mod/tts"]
    assert len(tts) == 2 and json.loads(tts[-1][2]) == {"text": "Hi", "voice": "af_sky", "speed": 1.1}


def test_mod_client_speak_raises_on_503():
    def handler(req):
        if req.url.path.endswith("/login"):
            return httpx.Response(200, json={"token": "t"})
        return httpx.Response(503, json={"error": "no speech endpoint configured"})

    async def go():
        mod = ModClient("http://h", passcode="pw")
        mod._client = httpx.AsyncClient(base_url="http://h", transport=httpx.MockTransport(handler))
        try:
            await mod.speak("Hi")
        finally:
            await mod.aclose()

    with pytest.raises(ModApiError) as err:
        run(go())
    assert err.value.status == 503


def test_only_one_player_per_machine(tmp_path):
    from stagehand.alexa.module import single_player, try_lock

    first = try_lock(str(tmp_path))
    assert first is not None
    assert try_lock(str(tmp_path)) is None  # a second player stands by

    async def second():
        task = asyncio.ensure_future(single_player(str(tmp_path), poll=0.01))
        await asyncio.sleep(0.05)
        assert not task.done()
        import os

        os.close(first)  # the first player dies → the second takes over
        return await asyncio.wait_for(task, 1)

    fd = run(second())
    assert fd is not None


def test_a_bare_chime_merges_into_a_fresh_announcement(tmp_path):
    from stagehand.alexa.module import CHIME_MERGE_S

    a, _ = announcer(cfg(tmp_path), None)
    assert run(a.ring()) == "chime" and len(a.output.played) == 1
    run(a.announce(Announcement("Time is up.")))  # chime + say
    assert run(a.ring()) == "merged" and len(a.output.played) == 3
    assert run(a.ring(now=a.last_announce + CHIME_MERGE_S + 1)) == "chime"
    off, _ = announcer(cfg(tmp_path, chime="off"), None)
    assert run(off.ring()) == "off"
    broken, _ = announcer(cfg(tmp_path), None, output=FakeOutput(fail=True))
    assert run(broken.ring()) == "failed"
    assert parse_alexa({"mqtt": {"host": "h"}}).chime_topic == "show/chime"
