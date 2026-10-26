"""How a word is said (wave 26, V3; contract C10): `localvoice.pronounce`
and the shared table, a byte-for-byte copy of the terminal's. Every house
voice says "Anti Virus" — the router's announcements and desk `say` steps,
Alexa's `say` engine and Alexa's `engine: server` fetch (and its cache) —
while the text it logs stays "Antivirus"."""

from __future__ import annotations

import asyncio
import io
import json
import subprocess
import wave
from pathlib import Path

import numpy as np

from stagehand import localvoice
from stagehand.alexa.config import parse_alexa
from stagehand.alexa.module import Announcer, Announcement, VoiceCache

ROOT = Path(__file__).resolve().parents[2]
COPIES = ["terminal/src/speech/pronounce.json", "stagehand/src/stagehand/pronounce.json", "reinstall/vr/config/pronounce.json"]


def wav(seconds: float = 0.05, rate: int = 48000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.sin(np.arange(int(seconds * rate)) / 9) * 8000).astype("<i2").tobytes())
    return buf.getvalue()


def test_the_table_is_the_terminals_byte_for_byte():
    ours = localvoice.PRONOUNCE_FILE.read_bytes()
    assert localvoice.PRONOUNCE_FILE == ROOT / "stagehand/src/stagehand/pronounce.json"
    for copy in COPIES:
        assert (ROOT / copy).read_bytes() == ours, copy
    doc = json.loads(ours)
    assert doc == {"version": 1, "words": [{"word": "Antiviruses", "say": "Anti Viruses"}, {"word": "Antivirus", "say": "Anti Virus"}]}


def test_pronounce_matches_the_terminals_rules():
    p = localvoice.pronounce
    assert p("Antivirus, you know what to do.") == "Anti Virus, you know what to do."
    assert p("the antivirus") == "the Anti Virus"
    assert p("ANTIVIRUS!") == "Anti Virus!"
    assert p("Antiviruses, march.") == "Anti Viruses, march."  # the longest word wins
    assert p("the Antivirus' booth") == "the Anti Virus' booth"  # the possessive
    assert p("éAntivirus") == "éAnti Virus"  # é is not [A-Za-z0-9]
    assert p("Antivirus2") == "Antivirus2"
    assert p("NotAntivirus") == "NotAntivirus"
    assert p("Antivirusy") == "Antivirusy"
    assert p("Norton Anti-Virus") == "Norton Anti-Virus"  # the program names keep their hyphen
    assert p(p("Antivirus")) == "Anti Virus"
    assert p("") == ""
    assert p("Truthcoin", (("truthcoin", "Truth coin"),)) == "Truth coin"
    assert p("Antivirus", ()) == "Antivirus"


def test_a_broken_table_says_every_word_as_written(monkeypatch, tmp_path):
    bad = tmp_path / "pronounce.json"
    bad.write_text("{nope")
    monkeypatch.setattr(localvoice, "PRONOUNCE_FILE", bad)
    localvoice.pronounce_table.cache_clear()
    try:
        assert localvoice.pronounce("Antivirus") == "Antivirus"
    finally:
        localvoice.pronounce_table.cache_clear()


class Recorder:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def __call__(self, argv, **kw):
        self.calls.append((list(argv), kw))
        out = (kw.get("env") or {}).get("LOOM_SAPI_OUT")
        if out:
            Path(out).write_bytes(wav())
        return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")


def test_the_routers_say_and_sapi_get_the_said_text(monkeypatch):
    monkeypatch.setattr(localvoice.sys, "platform", "win32")
    got: list[str] = []
    monkeypatch.setattr(localvoice, "sapi_to_wav", lambda text, voice: got.append(text) or b"RIFF")
    monkeypatch.setattr(localvoice, "sapi_speak", lambda text, voice, device=None: got.append(text))
    assert localvoice.renderer("auto")("The Antivirus march.", None) == b"RIFF"
    localvoice.speaker("auto")("Antiviruses, now.", None, None)
    assert localvoice.render_voice("Antivirus.", "Zira") == b"RIFF"
    localvoice.speak_voice("Antivirus.", None, None)
    assert got == ["The Anti Virus march.", "Anti Viruses, now.", "Anti Virus.", "Anti Virus."]


def test_sapi_hands_powershell_the_said_text():
    run = Recorder()
    # The wrapper the router uses, over the real SAPI renderer with a stub run.
    render = localvoice.pronounced(lambda text, voice: localvoice.sapi_to_wav(text, voice, run=run))
    assert render("Antivirus, you know what to do.", None).startswith(b"RIFF")
    assert run.calls[0][1]["env"]["LOOM_SAPI_TEXT"] == "Anti Virus, you know what to do."


def test_say_hands_the_mac_the_said_text(monkeypatch):
    seen: list[list[str]] = []

    def fake_run(argv, **kw):
        seen.append(list(argv))
        out = argv[argv.index("-o") + 1] if "-o" in argv else None
        if out:
            Path(out).write_bytes(b"FORM")
        return subprocess.CompletedProcess(argv, 0)

    from stagehand.alexa import player

    monkeypatch.setattr(player.subprocess, "run", fake_run)
    monkeypatch.setattr(localvoice.sys, "platform", "darwin")
    localvoice.renderer("auto")("The Antivirus march.", "Samantha")
    localvoice.speaker("auto")("The Antiviruses march.", "Samantha", None)
    assert seen[0][-1] == "The Anti Virus march."
    assert seen[1][-1] == "The Anti Viruses march."


def test_the_router_says_announcements_pronounced(monkeypatch):
    from stagehand.audio.config import parse_audio_section
    from stagehand.audio.module import AudioRouter

    got: list[str] = []
    monkeypatch.setattr(localvoice.sys, "platform", "darwin")
    monkeypatch.setattr(localvoice, "say_to_file", lambda text, voice: got.append(text) or b"FORM")
    r = AudioRouter(parse_audio_section({"announce": True}))
    r.render_say("Antivirus, report to the Internet.", "Samantha")
    assert got == ["Anti Virus, report to the Internet."]


class Out:
    def __init__(self) -> None:
        self.played = 0

    def play(self, samples, rate) -> None:
        self.played += 1

    def describe(self) -> str:
        return "test"


def test_alexa_say_engine_pronounces(tmp_path):
    cfg = parse_alexa({"mqtt": {"host": "x"}, "chime": "off", "cache_dir": str(tmp_path)})
    said: list[str] = []
    a = Announcer(cfg, None, output=Out(), render_say=lambda text, voice: said.append(text) or wav())
    path = asyncio.run(a.announce(Announcement(text="The Antivirus are coming.", voice=None, chime=False)))
    assert path == "device-say" and said == ["The Anti Virus are coming."]


def test_alexa_say_fallbacks_pronounce(tmp_path):
    from stagehand.alexa.player import PlaybackError

    cfg = parse_alexa({"mqtt": {"host": "x"}, "chime": "off", "cache_dir": str(tmp_path)})
    direct: list[str] = []

    def no_render(text, voice):
        raise PlaybackError("no say -o")

    a = Announcer(cfg, None, output=Out(), render_say=no_render, speak_direct=lambda text, voice, device: direct.append(text))
    asyncio.run(a.announce(Announcement(text="Antiviruses!", voice=None, chime=False)))
    assert direct == ["Anti Viruses!"]


def test_alexa_server_engine_fetches_and_caches_the_said_text(tmp_path):
    cfg = parse_alexa({"mqtt": {"host": "x"}, "engine": "server", "chime": "off", "cache_dir": str(tmp_path), "prewarm": ["Antivirus, you know what to do."]})
    asked: list[str] = []

    async def fetch(text, voice):
        asked.append(text)
        return wav()

    said: list[str] = []
    a = Announcer(cfg, fetch, output=Out(), render_say=lambda text, voice: said.append(text) or wav())
    assert asyncio.run(a.prewarm()) == 1
    assert asked == ["Anti Virus, you know what to do."]
    cache = VoiceCache(str(tmp_path))
    assert cache.get("Anti Virus, you know what to do.", cfg.voice) is not None
    assert cache.get("Antivirus, you know what to do.", cfg.voice) is None
    # Prewarmed: the announcement is the cached bytes, never asking again.
    path = asyncio.run(a.announce(Announcement(text="Antivirus, you know what to do.", voice=None, chime=False)))
    assert path == "device" and asked == ["Anti Virus, you know what to do."] and said == []
    assert asyncio.run(a.prewarm()) == 1 and len(asked) == 1

    # The server down: the `say -o` fallback is handed the said text too.
    async def down(text, voice):
        asked.append(text)
        raise OSError("down")

    b = Announcer(cfg, down, output=Out(), cache=VoiceCache(str(tmp_path / "empty")), render_say=lambda text, voice: said.append(text) or wav())
    assert asyncio.run(b.announce(Announcement(text="The Antiviruses march.", voice=None, chime=False))) == "device-say"
    assert asked[-1] == "The Anti Viruses march." and said == ["The Anti Viruses march."]
