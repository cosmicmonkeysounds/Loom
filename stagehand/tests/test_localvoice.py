"""The machine's own voice (`localvoice`): `say` on the Mac, SAPI through
Windows PowerShell on the house PC — checked on any platform with the
subprocess stubbed (the argv, the env, the WAV it hands back)."""

from __future__ import annotations

import base64
import io
import subprocess
import wave

import numpy as np
import pytest

from stagehand import localvoice
from stagehand.alexa.player import PlaybackError, say_direct, say_to_file
from stagehand.audio.config import parse_audio_section


def wav(seconds: float = 0.1, rate: int = 48000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.sin(np.arange(int(seconds * rate)) / 9) * 8000).astype("<i2").tobytes())
    return buf.getvalue()


class FakeRun:
    """subprocess.run: records each call; writes a WAV to LOOM_SAPI_OUT."""

    def __init__(self, *, fail: bool = False, stdout: str = "") -> None:
        self.calls: list[tuple[list[str], dict]] = []
        self.fail = fail
        self.stdout = stdout

    def __call__(self, argv, **kw):
        self.calls.append((list(argv), kw))
        if self.fail:
            raise subprocess.CalledProcessError(1, argv, stderr=b"boom")
        out = (kw.get("env") or {}).get("LOOM_SAPI_OUT")
        if out:
            with open(out, "wb") as f:
                f.write(wav())
        return subprocess.CompletedProcess(argv, 0, stdout=self.stdout, stderr="")


def script_of(argv: list[str]) -> str:
    assert argv[-2] == "-EncodedCommand"
    return base64.b64decode(argv[-1]).decode("utf-16-le")


def test_auto_is_sapi_on_windows_and_say_elsewhere():
    assert localvoice.resolve("auto", "win32") == "sapi"
    assert localvoice.resolve("auto", "darwin") == "say"
    assert localvoice.resolve("auto", "linux") == "say"
    assert localvoice.resolve("say", "win32") == "say"
    assert localvoice.resolve(None, "darwin") == "say"
    with pytest.raises(ValueError):
        localvoice.resolve("espeak")


def test_the_mac_keeps_say_and_samantha(monkeypatch):
    monkeypatch.setattr(localvoice.sys, "platform", "darwin")
    assert localvoice.renderer("auto") is say_to_file
    assert localvoice.speaker("auto") is say_direct
    cfg = parse_audio_section({"announce": True})
    assert (cfg.voice_engine, cfg.say_voice) == ("say", "Samantha")


def test_windows_defaults_to_sapi_and_zira(monkeypatch):
    monkeypatch.setattr(localvoice.sys, "platform", "win32")
    assert localvoice.renderer("auto") is localvoice.sapi_to_wav
    assert localvoice.speaker("auto") is localvoice.sapi_speak
    cfg = parse_audio_section({"announce": True})
    assert (cfg.voice_engine, cfg.say_voice) == ("sapi", "Microsoft Zira Desktop")
    # An explicit voice and engine are kept as written.
    cfg = parse_audio_section({"voice_engine": "sapi", "say_voice": "Microsoft Hazel Desktop"})
    assert (cfg.voice_engine, cfg.say_voice) == ("sapi", "Microsoft Hazel Desktop")


def test_a_bad_engine_is_a_config_error():
    from stagehand.module import ConfigError

    with pytest.raises(ConfigError, match="voice_engine"):
        parse_audio_section({"voice_engine": "festival"})


def test_sapi_render_passes_the_text_by_env_never_argv():
    run = FakeRun()
    text = "-o /etc/passwd — it’s Zoë’s turn"
    data = localvoice.sapi_to_wav(text, "Microsoft Zira Desktop", run=run)
    assert data.startswith(b"RIFF")
    (argv, kw), = run.calls
    assert argv[1:6] == ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"]
    assert all(text not in a for a in argv)  # never a flag, never quoted
    env = kw["env"]
    assert env["LOOM_SAPI_TEXT"] == text
    assert env["LOOM_SAPI_VOICE"] == "Microsoft Zira Desktop"
    assert env["LOOM_SAPI_GENDER"] == "female"
    assert env["LOOM_SAPI_RATE"] == "48000"
    assert env["LOOM_SAPI_OUT"].endswith("say.wav")
    assert kw["check"] is True and kw["timeout"] == 30
    script = script_of(argv)
    assert "SetOutputToWaveFile($env:LOOM_SAPI_OUT" in script
    assert "SelectVoiceByHints" in script  # a voice it lacks falls back by gender


def test_sapi_speak_goes_to_the_default_output():
    run = FakeRun()
    localvoice.sapi_speak("Go to the living room.", None, "MOTU", run=run)
    (argv, kw), = run.calls
    assert "LOOM_SAPI_OUT" not in kw["env"] and "LOOM_SAPI_VOICE" not in kw["env"]
    assert "SetOutputToDefaultAudioDevice" in script_of(argv)


def test_a_stale_env_value_never_leaks_into_a_call(monkeypatch):
    monkeypatch.setenv("LOOM_SAPI_OUT", "C:/old.wav")
    monkeypatch.setenv("LOOM_SAPI_VOICE", "Old")
    env = localvoice.sapi_env("hi", None)
    assert "LOOM_SAPI_OUT" not in env and "LOOM_SAPI_VOICE" not in env


def test_a_failed_sapi_call_is_a_playback_error():
    with pytest.raises(PlaybackError, match="SAPI render failed"):
        localvoice.sapi_to_wav("hi", None, run=FakeRun(fail=True))
    with pytest.raises(PlaybackError, match="SAPI speak failed"):
        localvoice.sapi_speak("hi", None, run=FakeRun(fail=True))


def test_the_script_is_powershell_5_1():
    """No pwsh-7-only syntax in what Windows PowerShell 5.1 runs."""
    for script in (localvoice.SAPI_SCRIPT, localvoice.SAPI_LIST_SCRIPT):
        for token in ("??", "?.", "&&", "||", "-Parallel"):
            assert token not in script


def test_listing_and_warning_about_voices():
    run = FakeRun(stdout="Microsoft David Desktop\r\nMicrosoft Zira Desktop\r\n")
    assert localvoice.sapi_voices(run) == ["Microsoft David Desktop", "Microsoft Zira Desktop"]
    assert localvoice.voice_warning("sapi", "Microsoft Zira Desktop", run=run) is None
    note = localvoice.voice_warning("sapi", "Samantha", run=run)
    assert "no voice 'Samantha'" in note and "female" in note
    assert localvoice.voice_warning("say", "Samantha", run=run) is None  # say lists its own
    assert localvoice.sapi_voices(FakeRun(fail=True)) is None


def test_problem_names_the_missing_binary():
    assert localvoice.problem("say", which=lambda n: "/usr/bin/say") is None
    assert "not on PATH" in localvoice.problem("say", which=lambda n: None)
    assert localvoice.problem("sapi", which=lambda n: "C:/x/powershell.exe" if n == "powershell" else None) is None
    assert "PowerShell" in localvoice.problem("sapi", which=lambda n: None)


def test_the_placeholder_label_speaks_with_sapi_on_windows():
    from stagehand.audio.placeholders import say_label

    run = FakeRun()
    label = say_label("Placeholder. zip.", engine="sapi", which=lambda n: "powershell.exe", run=run)
    assert label is not None and len(label) == 4800
    assert run.calls[0][1]["env"]["LOOM_SAPI_RATE"] == "48000"
    # No PowerShell: the motif alone.
    assert say_label("x", engine="sapi", which=lambda n: None, run=run) is None
    assert say_label("x", engine="sapi", which=lambda n: "powershell.exe", run=FakeRun(fail=True)) is None


def test_the_announcer_defaults_to_the_machines_voice(monkeypatch):
    from stagehand.alexa.config import parse_alexa
    from stagehand.alexa.module import Announcer

    a = Announcer(parse_alexa({"mqtt": {"host": "x"}}), None)
    assert a.render_say is localvoice.render_voice and a.speak_direct is localvoice.speak_voice
    monkeypatch.setattr(localvoice.sys, "platform", "win32")
    got = []
    monkeypatch.setattr(localvoice, "sapi_to_wav", lambda t, v: got.append((t, v)) or b"RIFF")
    assert localvoice.render_voice("hi", "Samantha") == b"RIFF" and got == [("hi", "Samantha")]


def test_the_router_takes_its_engines_voice(monkeypatch):
    from stagehand.audio.module import AudioRouter

    monkeypatch.setattr(localvoice.sys, "platform", "win32")
    r = AudioRouter(parse_audio_section({"announce": True}))
    assert r.render_say is localvoice.sapi_to_wav and r.speak_direct is localvoice.sapi_speak
    assert any("chime + sapi Microsoft Zira Desktop" in line for line in r.describe())
    monkeypatch.setattr(localvoice.sys, "platform", "darwin")
    r = AudioRouter(parse_audio_section({"announce": True}))
    assert r.render_say is say_to_file
    assert any("chime + say Samantha" in line for line in r.describe())
