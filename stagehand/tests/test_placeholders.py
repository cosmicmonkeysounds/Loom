"""Placeholder sounds (wave 18b, Q1): the generator's format and tag, that it
never touches a real file, that the router prefers a real file, and that
`stagehand check` lists what is still a placeholder."""

from __future__ import annotations

import os
import time

import numpy as np
import pytest
import soundfile as sf

from stagehand.audio.placeholders import MANIFEST, MOTIFS, RATE, SoundSpec, generate, load_manifest, motif, write_placeholder
from stagehand.audio.sounds import PLACEHOLDER_TAG, SoundBank, is_placeholder, placeholders_in

from test_audio_router import answer, router, write_wav


def quiet(_: str):
    return None


def test_the_manifest_has_19_sounds_and_every_motif_renders():
    specs = load_manifest()
    assert len(specs) == 19 and "announce_chime" not in specs
    assert specs["dance_song"].lead_silence == 10 and specs["dance_song"].no_duck
    assert {n for n, s in specs.items() if s.no_duck} == {"dance_song", "rave", "hand_jive"}
    assert all(s.real for s in specs.values())
    for kind in MOTIFS:
        x = motif(kind, 1.0)
        assert x.ndim == 1 and len(x) > 0 and np.isclose(np.abs(x).max(), 1.0), kind


def test_a_bad_manifest_is_refused(tmp_path):
    p = tmp_path / "m.yaml"
    for body, msg in (
        ("sounds: {}", "needs a `sounds:`"),
        ("sounds: {zip: {motif: kazoo, seconds: 1}}", "motif"),
        ("sounds: {zip: {motif: zip, seconds: 0}}", "seconds"),
        ("sounds: {zip: {motif: zip, seconds: 1, lead_silence: 99}}", "lead_silence"),
    ):
        p.write_text(body, encoding="utf-8")
        with pytest.raises(ValueError, match=msg):
            load_manifest(p)


def test_the_generator_writes_19_tagged_48k_mono_files(tmp_path):
    t0 = time.monotonic()
    done = generate(tmp_path, load_manifest(MANIFEST), say=False)
    assert [a for _, a in done] == ["wrote"] * 19
    assert time.monotonic() - t0 < 60
    for name, _ in done:
        path = tmp_path / f"{name}.wav"
        info = sf.info(str(path))
        assert (info.samplerate, info.channels, info.subtype) == (RATE, 1, "PCM_16"), name
        assert is_placeholder(path) and f"{PLACEHOLDER_TAG} — ".encode() in path.read_bytes()[:4096]
        data, _ = sf.read(str(path))
        assert 0.45 < np.abs(data).max() <= 0.51, name  # ≈ −6 dBFS peak
    dance, _ = sf.read(str(tmp_path / "dance_song.wav"))
    assert not dance[: 10 * RATE].any() and dance[10 * RATE :].any()  # the blackout's 10 s, exact
    assert placeholders_in(tmp_path) == sorted(n for n, _ in done)


def test_the_label_follows_the_motif_when_say_answers(tmp_path):
    spoken: list[str] = []

    def label(text):
        spoken.append(text)
        return np.full(RATE // 10, 0.5)

    spec = {"zip": SoundSpec("zip", "zip", 1.5, "a whoosh")}
    generate(tmp_path, spec, label=label)
    data, _ = sf.read(str(tmp_path / "zip.wav"))
    assert spoken == ["Placeholder. zip."] and len(data) == int(1.5 * RATE) + int(0.3 * RATE) + RATE // 10


def test_the_generator_never_touches_a_real_file_and_rewrites_a_placeholder_only_with_force(tmp_path):
    specs = load_manifest()
    write_wav(tmp_path / "zip.wav", rate=RATE)  # a real file (no tag)
    write_wav(tmp_path / "dance_song.aiff", rate=RATE)  # a real file under another extension
    before = (tmp_path / "zip.wav").read_bytes()
    done = dict(generate(tmp_path, specs, say=False, only={"zip", "dance_song", "rave"}))
    assert done == {"zip": "keep", "dance_song": "keep", "rave": "wrote"}
    assert (tmp_path / "zip.wav").read_bytes() == before and not (tmp_path / "dance_song.wav").exists()
    mtime = os.stat(tmp_path / "rave.wav").st_mtime_ns
    assert dict(generate(tmp_path, specs, say=False, only={"rave"})) == {"rave": "skip"}
    assert os.stat(tmp_path / "rave.wav").st_mtime_ns == mtime
    assert dict(generate(tmp_path, specs, say=False, only={"rave"}, force=True)) == {"rave": "wrote"}


def test_the_router_prefers_a_real_file_over_a_placeholder(tmp_path):
    write_placeholder(tmp_path / "dance_song.wav", np.zeros(100), "dance_song", "the dance track")
    bank = SoundBank(tmp_path, RATE)
    assert bank.find("dance_song").name == "dance_song.wav"  # only the placeholder: it plays
    write_wav(tmp_path / "dance_song.aiff", rate=RATE)
    assert bank.find("dance_song").name == "dance_song.aiff"  # .wav used to win
    assert placeholders_in(tmp_path) == []
    write_placeholder(tmp_path / "zip.wav", np.zeros(100), "zip", "a whoosh")
    write_wav(tmp_path / "Zip.flac", rate=RATE)  # a real file in another case still wins
    assert bank.find("zip").suffix == ".flac"
    # A placeholder replaced in place by a real file of the same name is real at once.
    write_wav(tmp_path / "dance_song.wav", rate=RATE)
    assert not is_placeholder(tmp_path / "dance_song.wav")


def test_check_and_health_list_the_placeholders_still_present(tmp_path):
    r = router(tmp_path, play_sounds=True)
    r.apply(answer("v1"))
    sounds = tmp_path / "sounds"
    generate(sounds, {n: s for n, s in load_manifest().items() if n in ("printer_grind", "dance_song")}, say=False)
    write_wav(sounds / "zip.wav")
    warnings = router(tmp_path, play_sounds=True).warnings()
    held = next(w for w in warnings if "placeholder" in w)
    assert "2 placeholder sound(s)" in held and held.endswith("dance_song, printer_grind")
    assert not any("no file for" in w and "printer_grind" in w for w in warnings)  # a placeholder is a file
    assert r.health()["placeholders"] == ["dance_song", "printer_grind"]
    assert router(tmp_path).health()["placeholders"] == []  # play_sounds off: not the router's concern
