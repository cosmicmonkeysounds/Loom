"""scripts/house-desktop/*.ps1 — the house PC's PowerShell — checked
without PowerShell: Windows PowerShell 5.1 syntax only (a stock Windows
10 / 11 has no pwsh 7), ASCII (5.1 reads a BOM-less script in the ANSI
code page), balanced delimiters outside strings and comments, and no
secret baked in."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

DIR = Path(__file__).resolve().parents[2] / "scripts" / "house-desktop"
SCRIPTS = sorted(DIR.glob("*.ps1"))

#: Syntax / cmdlets PowerShell 7 has and 5.1 doesn't.
PWSH7_ONLY = [
    (re.compile(r"\?\?"), "?? (null-coalescing)"),
    (re.compile(r"\?\."), "?. (null-conditional)"),
    (re.compile(r"&&|\|\|"), "&& / || (pipeline chains)"),
    (re.compile(r"\s\?\s[^:]+\s:\s"), "a ternary"),
    (re.compile(r"-Parallel\b", re.I), "ForEach-Object -Parallel"),
    (re.compile(r"-AsHashtable\b", re.I), "ConvertFrom-Json -AsHashtable"),
    (re.compile(r"-TcpPort\b", re.I), "Test-Connection -TcpPort"),
    (re.compile(r"\$PSStyle\b|\bGet-Error\b", re.I), "a pwsh-7 variable / cmdlet"),
    (re.compile(r"-AdditionalChildPath\b", re.I), "Join-Path -AdditionalChildPath"),
]


def code_only(text: str) -> str:
    """The script with every string's contents, comment and here-string
    blanked (kept as spaces), so delimiters and tokens are the code's."""
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        two = text[i : i + 2]
        if two == "<#":
            j = text.find("#>", i + 2)
            j = n if j < 0 else j + 2
            out.append(re.sub(r"[^\n]", " ", text[i:j]))
            i = j
        elif two in ("@'", '@"') and text[i + 2 : i + 3] == "\n":
            end = "\n" + two[1] + "@"
            j = text.find(end, i + 3)
            j = n if j < 0 else j + len(end)
            out.append(re.sub(r"[^\n]", " ", text[i:j]))
            i = j
        elif c == "#":
            j = text.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i))
            i = j
        elif c == "'":
            j = i + 1
            while j < n:
                if text[j] == "'" and text[j + 1 : j + 2] == "'":
                    j += 2
                    continue
                if text[j] == "'":
                    break
                j += 1
            out.append("''" + " " * (j - i - 1))
            i = j + 1
        elif c == '"':
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == "`" else 1
            out.append('""' + " " * (j - i - 1))
            i = j + 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def test_there_are_scripts():
    names = {p.name for p in SCRIPTS}
    assert {"common.ps1", "setup-mosquitto.ps1", "zigbee2mqtt.ps1", "start-stagehand.ps1", "tv-kiosk.ps1", "preflight.ps1"} <= names
    assert (DIR / "README.md").is_file()


@pytest.mark.parametrize("path", SCRIPTS, ids=lambda p: p.name)
def test_ascii_only(path):
    bad = [(i + 1, line) for i, line in enumerate(path.read_text(encoding="utf-8").splitlines()) if not line.isascii()]
    assert not bad, f"{path.name}: non-ASCII on lines {[n for n, _ in bad]} (5.1 reads it as ANSI)"


@pytest.mark.parametrize("path", SCRIPTS, ids=lambda p: p.name)
def test_powershell_5_1_only(path):
    code = code_only(path.read_text(encoding="utf-8"))
    for i, line in enumerate(code.splitlines(), 1):
        for pattern, what in PWSH7_ONLY:
            assert not pattern.search(line), f"{path.name}:{i}: {what} is PowerShell 7 only"


@pytest.mark.parametrize("path", SCRIPTS, ids=lambda p: p.name)
def test_balanced_delimiters(path):
    code = code_only(path.read_text(encoding="utf-8"))
    pairs = {")": "(", "}": "{", "]": "["}
    stack: list[tuple[str, int]] = []
    for i, line in enumerate(code.splitlines(), 1):
        for c in line:
            if c in "({[":
                stack.append((c, i))
            elif c in pairs:
                assert stack and stack[-1][0] == pairs[c], f"{path.name}:{i}: unmatched {c!r}"
                stack.pop()
    assert not stack, f"{path.name}: {stack[-1][0]!r} opened on line {stack[-1][1]} never closes"


@pytest.mark.parametrize("path", [p for p in SCRIPTS if p.name != "common.ps1"], ids=lambda p: p.name)
def test_each_script_has_help_a_param_block_and_the_helpers(path):
    text = path.read_text(encoding="utf-8")
    assert text.lstrip().startswith("<#") and ".SYNOPSIS" in text
    assert "[CmdletBinding()]" in text and re.search(r"(?m)^param\(", text)
    assert '. "$PSScriptRoot\\common.ps1"' in text


def test_setup_mosquitto_lets_the_service_read_the_password_file():
    # The service runs as LocalSystem; mosquitto_passwd 2.1 locks the file to its creator.
    text = (DIR / "setup-mosquitto.ps1").read_text(encoding="utf-8")
    assert "icacls.exe $passwd /grant '*S-1-5-18:(R)'" in text
    assert "'S-1-5-18'" in text  # -Check flags a file SYSTEM cannot read


def test_the_tokenizer_blanks_strings_and_comments():
    code = code_only("$a = 'x ?? y' # && here\n$b = \"q `\" (\"\n<# { #>\n@'\n}\n'@\n")
    assert "??" not in code and "&&" not in code and "(" not in code and "{" not in code and "}" not in code


@pytest.mark.parametrize("path", sorted(DIR.iterdir()), ids=lambda p: p.name)
def test_no_secret_in_the_folder(path):
    if path.is_dir():
        return
    text = path.read_text(encoding="utf-8")
    assert not re.search(r"V\d-D\d", text), f"{path.name}: a patch-bay combo"
    # A mod passcode only ever comes from -ModCode / $env:LOOM_MOD_CODE.
    for m in re.finditer(r"(?:code=|LOOM_MOD_CODE\s*=\s*|mod_passcode:\s*)['\"]?([^'\"&\s)<>]+)", text):
        assert m.group(1).startswith(("$", "<", "'", "+", "(")) or m.group(1) in ("**",), f"{path.name}: {m.group(0)!r} looks like a real code"
