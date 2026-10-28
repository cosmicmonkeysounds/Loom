"""A library stand-in (`stagehand sounds library --story`) is a real sound,
but any file someone puts beside it wins, whatever its extension: a real
`ad_jingle.mp3` must beat the library's `ad_jingle.wav` (wave 38)."""

from __future__ import annotations

from pathlib import Path

from stagehand.audio import sounds
from stagehand.audio.sfx import render


def _write(path: Path, tag: str | None) -> Path:
    body = b"RIFF\x00\x00\x00\x00WAVE" + (f"LIST INFO ICMT {tag} — x".encode() if tag else b"") + b"\x00" * 64
    path.write_bytes(body)
    return path


def test_the_tag_is_the_renderers():
    assert sounds.SFX_TAG == render.SFX_TAG


def test_a_real_file_of_any_extension_beats_a_stand_in(tmp_path):
    _write(tmp_path / "ad_jingle.wav", sounds.SFX_TAG)
    real = _write(tmp_path / "ad_jingle.mp3", None)
    bank = sounds.SoundBank(tmp_path, 48000)
    assert bank.find("ad_jingle") == real
    assert sounds.is_stand_in(tmp_path / "ad_jingle.wav") and not sounds.is_placeholder(tmp_path / "ad_jingle.wav")


def test_a_stand_in_beats_a_placeholder_and_a_real_file_in_another_case_beats_both(tmp_path):
    _write(tmp_path / "zip.wav", sounds.PLACEHOLDER_TAG)
    stand_in = _write(tmp_path / "zip.flac", sounds.SFX_TAG)
    bank = sounds.SoundBank(tmp_path, 48000)
    assert bank.find("zip") == stand_in
    assert sounds.placeholders_in(tmp_path) == []
    real = _write(tmp_path / "ZIP.ogg", None)
    assert bank.find("zip").samefile(real)  # a case-insensitive disk (macOS, Windows) names it zip.ogg
