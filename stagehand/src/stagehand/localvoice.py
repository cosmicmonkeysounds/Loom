"""The machine's own voice: macOS `say`, or Windows SAPI through PowerShell.

The house announcements (`audio` router, the retired `alexa` player) and
the speaker-test / placeholder labels are spoken by the computer they run
on, never a server. Two engines:

    say    macOS `say -o <file>` (rendered) / `say -a <device>` (direct) —
           alexa/player.py, unchanged: the Mac's default, `Samantha`.
    sapi   Windows SAPI 5 (System.Speech, in every Windows 10 / 11) driven
           by Windows PowerShell 5.1 — rendered to a 48 kHz mono WAV, or
           spoken straight to the default output. The female desktop voice
           `Microsoft Zira Desktop` is the analogue of Samantha.

`auto` (the default everywhere) is `sapi` on Windows and `say` elsewhere,
so a Mac config behaves exactly as before and the same YAML runs on the
house PC (John's Desktop). SAPI can't name an output device, so `sapi`'s
direct path speaks on the default output; the router's own path (render,
then play through the house speakers) is the one that matters.

The text, the voice and the output path travel to PowerShell as
environment variables, never argv or stdin: Windows hands env strings over
as UTF-16 (so `’ — é` survive, where PowerShell 5.1's stdin uses the OEM
code page) and a line that starts with `-` can never be read as a flag.
The script itself goes as `-EncodedCommand` (base64 UTF-16LE), so no
quoting rule applies to it either. A voice SAPI doesn't have (a Mac name
like `Samantha` left in a shared YAML) falls back to the installed voice
matching the gender hint — female for announcements — never an error.

Every subprocess call goes through an injectable `run`, so the tests check
the argv and env on any platform with no PowerShell.
"""

from __future__ import annotations

import base64
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

from .alexa.player import PlaybackError, say_direct, say_to_file

log = logging.getLogger("stagehand.voice")

#: What a YAML `voice_engine:` may say.
ENGINES = ("auto", "say", "sapi")
#: The voice each engine uses when the config names none.
DEFAULT_VOICES = {"say": "Samantha", "sapi": "Microsoft Zira Desktop"}
#: SAPI's sample rate for a rendered line (the router resamples anyway).
SAPI_RATE = 48000

Run = Callable[..., "subprocess.CompletedProcess"]
Render = Callable[[str, "str | None"], bytes]
Speak = Callable[[str, "str | None", "str | None"], None]

#: One script for render (LOOM_SAPI_OUT set) and speak (unset); listing the
#: voices is its own. PowerShell 5.1 syntax only (no `??`, no ternary).
SAPI_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $picked = $false
  if ($env:LOOM_SAPI_VOICE) {
    try { $s.SelectVoice($env:LOOM_SAPI_VOICE); $picked = $true } catch { }
  }
  if ((-not $picked) -and $env:LOOM_SAPI_GENDER) {
    try {
      $g = [Enum]::Parse([System.Speech.Synthesis.VoiceGender], $env:LOOM_SAPI_GENDER, $true)
      $s.SelectVoiceByHints($g)
    } catch { }
  }
  if ($env:LOOM_SAPI_OUT) {
    $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo([int]$env:LOOM_SAPI_RATE, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $s.SetOutputToWaveFile($env:LOOM_SAPI_OUT, $f)
  } else {
    $s.SetOutputToDefaultAudioDevice()
  }
  $s.Speak($env:LOOM_SAPI_TEXT)
} finally {
  $s.Dispose()
}
"""

SAPI_LIST_SCRIPT = r"""
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  foreach ($v in $s.GetInstalledVoices()) { if ($v.Enabled) { [Console]::Out.WriteLine($v.VoiceInfo.Name) } }
} finally {
  $s.Dispose()
}
"""


def resolve(engine: str | None = "auto", platform: str | None = None) -> str:
    """`auto` → `sapi` on Windows, `say` elsewhere; `say` / `sapi` as named."""
    engine = engine or "auto"
    if engine not in ENGINES:
        raise ValueError(f"voice engine {engine!r}: {' | '.join(ENGINES)}")
    if engine != "auto":
        return engine
    return "sapi" if (platform or sys.platform) == "win32" else "say"


def default_voice(engine: str) -> str:
    return DEFAULT_VOICES[resolve(engine)]


def powershell() -> str:
    """Windows PowerShell 5.1 (always installed), never needing pwsh 7."""
    found = shutil.which("powershell") or shutil.which("powershell.exe")
    if found:
        return found
    root = os.environ.get("SystemRoot", r"C:\Windows")
    return os.path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")


def sapi_argv(script: str = SAPI_SCRIPT, exe: str | None = None) -> list[str]:
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    return [exe or powershell(), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded]


def sapi_env(text: str, voice: str | None, *, out: str | None = None, gender: str | None = "female", rate: int = SAPI_RATE, base: dict | None = None) -> dict[str, str]:
    env = dict(os.environ if base is None else base)
    for key in ("LOOM_SAPI_OUT", "LOOM_SAPI_VOICE", "LOOM_SAPI_GENDER"):
        env.pop(key, None)  # never inherit a stale value from the caller's env
    env["LOOM_SAPI_TEXT"] = text
    env["LOOM_SAPI_RATE"] = str(int(rate))
    if voice:
        env["LOOM_SAPI_VOICE"] = voice
    if gender:
        env["LOOM_SAPI_GENDER"] = gender
    if out:
        env["LOOM_SAPI_OUT"] = out
    return env


def _hidden() -> int:
    # A logon task's PowerShell window must never flash up on the TV.
    return getattr(subprocess, "CREATE_NO_WINDOW", 0)


def sapi_to_wav(text: str, voice: str | None, *, rate: int = SAPI_RATE, gender: str | None = "female", run: Run | None = None) -> bytes:
    """`text` rendered by SAPI to WAV bytes (16-bit mono at `rate`)."""
    run = run or subprocess.run
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "say.wav"
        try:
            run(sapi_argv(), env=sapi_env(text, voice, out=str(out), gender=gender, rate=rate), check=True, capture_output=True, timeout=30, creationflags=_hidden())
            data = out.read_bytes()
        except (OSError, subprocess.SubprocessError) as err:
            raise PlaybackError(f"SAPI render failed: {err}") from err
    if not data:
        raise PlaybackError("SAPI render failed: an empty file")
    return data


def sapi_speak(text: str, voice: str | None, device: str | None = None, *, gender: str | None = "female", run: Run | None = None) -> None:
    """SAPI straight to the default output (it can't name a device: `device`
    is ignored). Blocking. The router's last resort, as `say -a` is the Mac's."""
    del device
    run = run or subprocess.run
    try:
        run(sapi_argv(), env=sapi_env(text, voice, gender=gender), check=True, capture_output=True, timeout=60, creationflags=_hidden())
    except (OSError, subprocess.SubprocessError) as err:
        raise PlaybackError(f"SAPI speak failed: {err}") from err


def sapi_voices(run: Run | None = None) -> list[str] | None:
    """The installed, enabled SAPI voices, or None when PowerShell can't say."""
    run = run or subprocess.run
    try:
        res = run(sapi_argv(SAPI_LIST_SCRIPT), capture_output=True, text=True, timeout=30, check=True, creationflags=_hidden())
    except (OSError, subprocess.SubprocessError):
        return None
    return [line.strip() for line in (res.stdout or "").splitlines() if line.strip()]


def renderer(engine: str | None = "auto") -> Render:
    """The render function for an engine (resolved now): text, voice → bytes."""
    return sapi_to_wav if resolve(engine) == "sapi" else say_to_file


def speaker(engine: str | None = "auto") -> Speak:
    """The direct-speak function: text, voice, device → None (blocking)."""
    return sapi_speak if resolve(engine) == "sapi" else say_direct


def render_voice(text: str, voice: str | None) -> bytes:
    """`auto`, resolved at call time — the alexa player's default."""
    return renderer("auto")(text, voice)


def speak_voice(text: str, voice: str | None, device: str | None) -> None:
    speaker("auto")(text, voice, device)


def problem(engine: str | None = "auto", *, which: Callable[[str], str | None] = shutil.which) -> str | None:
    """Why this machine can't speak with `engine` (for `stagehand check`), or None.
    A voice SAPI lacks is not a problem (the gender fallback covers it) —
    `voice_warning` says so."""
    engine = resolve(engine)
    if engine == "say":
        return None if which("say") else "`say` is not on PATH (macOS only — on Windows use voice_engine: sapi, or leave it auto)"
    if not (which("powershell") or which("powershell.exe")):
        return "Windows PowerShell (powershell.exe) is not on PATH — SAPI announcements need it"
    return None


def voice_warning(engine: str | None, voice: str | None, *, run: Run | None = None) -> str | None:
    """A configured voice the engine doesn't have (SAPI only: `say` lists
    hundreds and fails loudly enough)."""
    if resolve(engine) != "sapi" or not voice:
        return None
    voices = sapi_voices(run)
    if voices is None:
        return "could not list the SAPI voices (PowerShell / System.Speech failed)"
    if voice not in voices:
        return f"SAPI has no voice {voice!r} (installed: {', '.join(voices) or 'none'}) — the default female voice speaks instead"
    return None
