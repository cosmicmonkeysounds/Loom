"""The SFX library (wave 38, C6): every sound in the registry renders clean,
at its level, at its length, deterministically, into a tagged WAV; loops are
seamless; the registry refuses duplicates; the manifest's `library:` keys
and the story's LOCATION ambient keys line up with it; and `sounds library
--story` never replaces a real file.

The per-sound tests iterate over the whole registry, so a category agent's
new sound is covered by adding it. Each sound is rendered once per module
(the cache) plus once more for the determinism check.
"""

from __future__ import annotations

import re
import struct
import time
import zlib
from pathlib import Path

import numpy as np
import pytest

from stagehand import cli
from stagehand.audio.placeholders import MANIFEST, load_manifest, write_placeholder
from stagehand.audio.sfx import ambient, dsp
from stagehand.audio.sfx import cli as sfx_cli
from stagehand.audio.sfx import render as R
from stagehand.audio.sfx.registry import CATEGORIES, SFX, Spec, build
from stagehand.audio.sounds import is_placeholder

MAIN_LOOM = Path(__file__).resolve().parents[2] / "core" / "examples" / "trapped-in-the-internet" / "main.loom"
NAMES = sorted(SFX)
#: How long one render may take (the whole suite renders the library twice).
MAX_RENDER_S = 2.0


@pytest.fixture(scope="module")
def rendered() -> dict[str, tuple[np.ndarray, float]]:
    out = {}
    for name in NAMES:
        t0 = time.perf_counter()
        x = R.render(SFX[name])
        out[name] = (x, time.perf_counter() - t0)
    return out


def info_chunk(data: bytes) -> dict[str, str]:
    """The INFO sub-chunks of a WAV (INAM, ICMT …), as text."""
    assert data[:4] == b"RIFF" and data[8:12] == b"WAVE"
    pos, out = 12, {}
    while pos + 8 <= len(data):
        cid, size = data[pos : pos + 4], struct.unpack("<I", data[pos + 4 : pos + 8])[0]
        body = data[pos + 8 : pos + 8 + size]
        if cid == b"LIST" and body[:4] == b"INFO":
            p = 4
            while p + 8 <= len(body):
                sid, ssize = body[p : p + 4], struct.unpack("<I", body[p + 4 : p + 8])[0]
                out[sid.decode()] = body[p + 8 : p + 8 + ssize].rstrip(b"\0").decode("utf-8")
                p += 8 + ssize + (ssize % 2)
        if cid == b"data":
            break
        pos += 8 + size + (size % 2)
    return out


def channels(x: np.ndarray) -> list[np.ndarray]:
    return [x] if x.ndim == 1 else [x[:, c] for c in range(x.shape[1])]


def seam_problem(x: np.ndarray, window: int = 256) -> str | None:
    """Why the loop `x` does not flow from its last sample into its first, or
    None: the jump across the seam must be no bigger than the loop's own
    99.5th-percentile step, and the RMS of the sample-to-sample change in a
    window round the seam no more than 3× the median of that elsewhere."""
    for i, c in enumerate(channels(np.asarray(x, dtype=np.float64))):
        steps = np.abs(np.diff(c))
        jump = abs(float(c[0]) - float(c[-1]))
        typical = float(np.percentile(steps, 99.5))
        if jump > typical + 1e-9:
            return f"channel {i}: jump {jump:.4f} across the seam > the loop's 99.5th-percentile step {typical:.4f}"
        across = np.concatenate([c[-window:], c[:window]])
        seam = float(np.sqrt(np.mean(np.diff(across) ** 2)))
        blocks = [np.sqrt(np.mean(np.diff(c[k : k + 2 * window]) ** 2)) for k in range(0, len(c) - 2 * window, 2 * window)]
        median = float(np.median(blocks))
        if seam > 3 * median + 1e-9:
            return f"channel {i}: the seam's step RMS {seam:.5f} > 3 × the median {median:.5f}"
    return None


# -- the registry ---------------------------------------------------------------


def test_the_registry_has_every_category_and_unique_names():
    assert NAMES, "the library is empty"
    assert {s.category for s in SFX.values()} == set(CATEGORIES), "every category module has at least one sound"
    lower = [n.lower() for n in SFX]
    assert len(lower) == len(set(lower))
    for name, spec in SFX.items():
        assert spec.name == name


def test_the_registry_refuses_a_duplicate_or_a_misplaced_spec():
    class Mod:
        def __init__(self, name, sounds):
            self.__name__ = f"stagehand.audio.sfx.{name}"
            self.SOUNDS = sounds

    one = Spec("beep", "dings", lambda rng: np.ones(10), 1.0, note="x")
    with pytest.raises(ValueError, match="defined twice"):
        build((Mod("dings", [one]), Mod("dings", [Spec("BEEP".lower(), "dings", one.render, 1.0, note="y")])))
    with pytest.raises(ValueError, match="lives in sirens.py"):
        build((Mod("sirens", [one]),))
    with pytest.raises(TypeError):
        build((Mod("dings", ["beep"]),))


@pytest.mark.parametrize(
    ("kwargs", "msg"),
    [
        ({"name": "Beep"}, "snake_case"),
        ({"name": "dryer-tumble"}, "snake_case"),
        ({"category": "kazoo"}, "category"),
        ({"category": "ambient", "name": "dryer_tumble", "loop": True}, "hyphens"),
        ({"category": "ambient", "name": "dryer-tumble"}, "loop"),
        ({"seconds": 0}, "seconds"),
        ({"note": ""}, "note"),
        ({"note": "x" * 200}, "note"),
        ({"level_db": -3}, "level_db"),
        ({"level_db": -60}, "level_db"),
        ({"level_db": True}, "level_db"),
        ({"loop": True, "level_db": -3}, "level_db"),
        ({"story": "Not A Name"}, "story"),
    ],
)
def test_a_bad_spec_is_refused(kwargs, msg):
    base = {"name": "beep", "category": "dings", "render": lambda rng: np.ones(10), "seconds": 1.0, "note": "a beep"}
    with pytest.raises(ValueError, match=msg):
        Spec(**{**base, **kwargs})


# -- every sound -------------------------------------------------------------------


@pytest.mark.parametrize("name", NAMES)
def test_each_sound_renders_clean_at_its_length_and_shape(name, rendered):
    spec = SFX[name]
    x, took = rendered[name]
    assert x.dtype == np.float32
    assert np.all(np.isfinite(x))
    assert abs(len(x) / R.RATE - spec.seconds) <= spec.seconds * 0.05
    if spec.loop:
        assert x.ndim == 1 or x.shape[1] == 2
    else:
        assert x.ndim == 1, "a one-shot is mono"
    assert took < MAX_RENDER_S, f"{name} took {took:.2f} s to render (keep it under {MAX_RENDER_S} s)"


@pytest.mark.parametrize("name", NAMES)
def test_each_sound_is_at_its_level(name, rendered):
    spec = SFX[name]
    x, _ = rendered[name]
    peak = dsp.peak_db(x)
    if spec.loop:
        target = R.LOOP_RMS_DB if spec.level_db is None else spec.level_db
        assert abs(dsp.rms_db(x) - target) <= 1.0, f"{name}: RMS {dsp.rms_db(x):.2f} dBFS, want ≈ {target}"
        assert peak <= R.LOOP_PEAK_DB + 0.01
    else:
        # loudness, not peak: the loudest 400 ms at the target, unless the
        # −1 dBFS peak cap turned the whole sound down first (a spiky sound)
        target = R.ONESHOT_LOUD_DB if spec.level_db is None else spec.level_db
        loud = dsp.loudness_db(x)
        assert peak <= R.ONESHOT_PEAK_DB + 0.01, f"{name}: peak {peak:.2f} dBFS over the cap"
        if abs(peak - R.ONESHOT_PEAK_DB) > 0.05:
            assert abs(loud - target) <= 0.1, f"{name}: loudest 400 ms {loud:.2f} dBFS, want {target}"
        else:
            assert loud <= target + 0.1, f"{name}: loudest 400 ms {loud:.2f} dBFS over its target {target}"
        assert abs(float(x[0])) < 0.01 and abs(float(x[-1])) < 0.01, "a one-shot starts and ends at silence"
    assert dsp.rms_db(x) > -60, "not silent"


#: One-shots that end on purpose at full tilt (the riser stops at its peak).
ENDS_AT_ITS_PEAK = {"riser"}


@pytest.mark.parametrize("name", [n for n in NAMES if not SFX[n].loop and n not in ENDS_AT_ITS_PEAK])
def test_each_one_shot_ends_in_its_own_decay(name, rendered):
    # the renderer's 5 ms fade is a safety net, not the ending: the 30 ms to
    # 6 ms before the end is already quiet, or the fade chops a live sound
    x = rendered[name][0].astype(np.float64)
    tail = x[-dsp.frames(0.030) : -dsp.frames(0.006)]
    assert dsp.rms_db(tail) < -40, f"{name}: {dsp.rms_db(tail):.1f} dBFS just before the end (cut, not decayed)"


@pytest.mark.parametrize("name", NAMES)
def test_each_sound_has_no_dc_or_sub_audio_rumble(name, rendered):
    x, _ = rendered[name]
    for c in channels(x.astype(np.float64)):
        assert abs(float(c.mean())) <= 0.02, f"{name}: DC offset {c.mean():.3f}"
        spec = np.abs(np.fft.rfft(c)) ** 2
        f = np.fft.rfftfreq(len(c), 1 / R.RATE)
        assert spec[f < 20].sum() <= 0.05 * spec.sum(), f"{name}: more than 5 % of its energy is below 20 Hz"


@pytest.mark.parametrize("name", [n for n in NAMES if SFX[n].loop])
def test_each_loop_is_seamless(name, rendered):
    x, _ = rendered[name]
    assert seam_problem(x) is None, seam_problem(x)


@pytest.mark.parametrize("name", NAMES)
def test_each_sound_is_deterministic_and_tagged(name, rendered):
    spec = SFX[name]
    x, _ = rendered[name]
    first, again = R.wav_bytes(spec, x), R.wav_bytes(spec, R.render(spec))
    assert first == again, f"{name} rendered different bytes the second time (a global RNG? the clock?)"
    info = info_chunk(first)
    assert info["INAM"] == name and info["ICMT"] == f"loom-sfx v1 — {spec.note}"
    fmt = first.index(b"fmt ")
    _, tag, ch, rate, _, _, bits = struct.unpack("<IHHIIHH", first[fmt + 4 : fmt + 24])
    assert (tag, rate, bits, ch) == (1, 48000, 16, 1 if x.ndim == 1 else 2)
    assert first.index(b"LIST") < first.index(b"data") < 4096, "the tag sits in the header (sounds.is_placeholder reads 4 KB)"


def test_the_seam_check_catches_a_seam():
    t = dsp.timebase(2.0)
    good = np.sin(dsp.TAU * dsp.loop_freq(220.3, 2.0) * t)
    bad = np.sin(dsp.TAU * 220.3 * t)
    assert seam_problem(good) is None
    assert "jump" in seam_problem(bad)
    rng = np.random.default_rng(1)
    hiss = dsp.lowpass(rng.standard_normal(dsp.frames(3)), 800)
    assert seam_problem(dsp.make_loop(hiss, 2.5, 0.4)) is None
    assert seam_problem(hiss) is not None


# -- the renderer's rules ------------------------------------------------------------


def test_render_rejects_bad_output():
    def spec(render, seconds=1.0, loop=False):
        return Spec("probe", "dings", render, seconds, loop=loop, note="probe")

    for render, msg in (
        (lambda rng: np.full(48000, np.nan), "NaN"),
        (lambda rng: np.zeros(48000), "silent"),
        (lambda rng: np.ones(30000), "spec says"),
        (lambda rng: np.ones((48000, 2)), "mono"),
        (lambda rng: np.ones((48000, 3)), "shape"),
    ):
        with pytest.raises(R.RenderError, match=msg):
            R.render(spec(render))


def test_a_peaky_loop_is_held_under_the_ceiling_and_level_db_is_honoured():
    def drips(rng):
        x = np.zeros(dsp.frames(4))
        x[:: dsp.frames(0.5)] = 1.0
        return dsp.lowpass(x, 3000, circular=True) + dsp.pink(4, rng) * 0.002

    x = R.render(Spec("drips", "ambient", drips, 4.0, loop=True, note="probe"))
    assert dsp.peak_db(x) <= R.LOOP_PEAK_DB + 0.01
    quiet = R.render(Spec("drips", "ambient", drips, 4.0, loop=True, note="probe", level_db=-30))
    assert abs(dsp.rms_db(quiet) - -30) <= 1.0


def test_a_one_shot_is_set_by_loudness_with_its_peak_capped_by_gain():
    def beeps(rng):  # a steady beeper: the old peak normalisation made it ~ −4 dBFS loud
        return dsp.square(1000, 1.0) * 0.3

    def tick(rng):  # one bare grain: the cap binds long before the target
        x = np.zeros(dsp.frames(1.0))
        x[1000:1010] = 1.0
        return x

    loud = R.render(Spec("beeps", "dings", beeps, 1.0, note="probe"))
    assert dsp.loudness_db(loud) == pytest.approx(R.ONESHOT_LOUD_DB, abs=0.1)
    assert dsp.peak_db(loud) < R.ONESHOT_PEAK_DB
    quiet = R.render(Spec("beeps", "dings", beeps, 1.0, note="probe", level_db=-24))
    assert dsp.loudness_db(quiet) == pytest.approx(-24, abs=0.1)
    spiky = R.render(Spec("tick", "dings", tick, 1.0, note="probe"))
    assert dsp.peak_db(spiky) == pytest.approx(R.ONESHOT_PEAK_DB, abs=0.01)
    assert dsp.loudness_db(spiky) < R.ONESHOT_LOUD_DB - 10
    # a plain gain: the faded render scaled, never limited or clipped
    shaped = dsp.fade(tick(None), 0.0005, 0.005, curve="linear")
    ratio = spiky[1000:1010] / shaped[1000:1010]
    assert np.allclose(ratio, ratio[0], rtol=1e-5)


def test_the_story_stand_ins_sit_within_a_few_db_of_each_other(rendered):
    # one fader for the whole house: the five-minute tick must not vanish
    # under the modem (wave 38 review: a 21 dB spread under peak levels)
    louds = {lib: dsp.loudness_db(rendered[lib][0]) for lib in sfx_cli.story_map().values() if lib in SFX}
    assert louds
    quietest = min(louds, key=louds.get)
    assert louds[quietest] >= R.ONESHOT_LOUD_DB - 6, f"{quietest}: loudest 400 ms {louds[quietest]:.1f} dBFS"
    assert max(louds.values()) <= R.ONESHOT_LOUD_DB + 0.1


def test_the_countdown_tick_has_a_body_not_bare_grains(rendered):
    # the peak sits in a clack with body, so the −1 dBFS cap does not hold the
    # tick 13 dB under the other cues (it was 14 dB over its own 10 ms RMS)
    x = rendered["clock_tick"][0].astype(np.float64)
    i = int(np.argmax(np.abs(x)))
    around = x[max(0, i - 240) : i + 240]
    assert dsp.peak_db(x) - dsp.rms_db(around) < 10
    spectrum = np.abs(np.fft.rfft(x)) ** 2
    f = np.fft.rfftfreq(len(x), 1 / R.RATE)
    assert spectrum[f < 2000].sum() >= 0.3 * spectrum.sum(), "a woody body under the 2–5 kHz rings"


def test_the_seed_is_stable_across_runs():
    # crc32, never Python's salted hash(): a re-render on another day is the same file
    assert R.seed("siren_wail") == zlib.crc32(b"siren_wail")
    assert R.rng_for("a").integers(0, 1 << 30) == R.rng_for("a").integers(0, 1 << 30)


# -- the manifest and the story --------------------------------------------------------


def test_the_manifest_library_keys_name_library_sounds():
    stories = sfx_cli.story_map()
    assert stories == {
        "modem_handshake": "modem_handshake", "bingo_start": "bingo_start", "truther_glitch": "truther_glitch",
        "countdown_tick": "clock_tick", "printer_grind": "dot_matrix_jam", "beans_spill": "beans_spill",
        "zip": "zipper", "y2k_chime": "tower_bell", "alarm_siren": "server_alarm",
        "windows_shutdown": "system_shutdown", "motorcycle": "motorcycle", "award_fanfare": "fanfare",
        "ad_jingle": "ad_jingle",
    }
    songs = {n for n, s in load_manifest().items() if s.no_duck} | {"youre_the_one_vocoder", "youre_the_one_sandy_only", "ceremony_bed"}
    assert not songs & set(stories), "the songs have no library stand-in"
    # each existing stand-in says which story sound it is, and nothing else claims one
    for story, lib in stories.items():
        if lib in SFX:
            assert SFX[lib].story == story, f"{lib}: Spec(story={story!r}) to match sounds.yaml"
    claimed = {s.story: s.name for s in SFX.values() if s.story}
    for story, lib in claimed.items():
        assert stories.get(story) == lib, f"{lib} says story={story!r}; sounds.yaml {story}.library must be {lib}"
    missing = sorted(lib for lib in stories.values() if lib not in SFX)
    if missing:
        pytest.xfail(f"the category lanes have not added these yet: {', '.join(missing)}")


def test_a_bad_library_key_is_refused(tmp_path):
    p = tmp_path / "m.yaml"
    p.write_text("sounds: {zip: {motif: zip, seconds: 1, library: Zipper!}}")
    with pytest.raises(ValueError, match="library"):
        load_manifest(p)
    p.write_text("sounds: {zip: {motif: zip, seconds: 1, library: zipper}}")
    assert load_manifest(p)["zip"].library == "zipper"
    p.write_text("sounds: {zip: {motif: zip, seconds: 1}}")
    assert load_manifest(p)["zip"].library is None


def test_the_ambient_keys_are_the_storys_locations():
    keys = re.findall(r"^\s+ambient:\s*([a-z0-9-]+)\s*$", MAIN_LOOM.read_text(encoding="utf-8"), re.M)
    assert sorted(keys) == sorted(ambient.LOCATION_KEYS), "main.loom's LOCATION ambient keys moved: update ambient.LOCATION_KEYS"
    ambients = {n for n, s in SFX.items() if s.category == "ambient"}
    for name in ambients:
        assert SFX[name].loop
    missing = sorted(set(keys) - ambients)
    if missing:
        pytest.xfail(f"the ambient lane has not added these loops yet: {', '.join(missing)}")


# -- writing ---------------------------------------------------------------------------

CHEAP = ["access_denied", "packet_burst"]


def test_build_writes_the_library_layout_and_a_rerun_touches_nothing(tmp_path):
    specs = sfx_cli.select(",".join(CHEAP + ["dryer-tumble"]))
    done = sfx_cli.build(specs, tmp_path)
    assert {(w.path.relative_to(tmp_path).as_posix(), w.action) for w in done} == {
        ("story/access_denied.wav", "wrote"), ("digital/packet_burst.wav", "wrote"), ("ambient/dryer-tumble.wav", "wrote"),
    }
    assert R.is_sfx(tmp_path / "ambient" / "dryer-tumble.wav") and not is_placeholder(tmp_path / "ambient" / "dryer-tumble.wav")
    assert {w.action for w in sfx_cli.build(specs, tmp_path)} == {"same"}
    with pytest.raises(KeyError, match="kazoo"):
        sfx_cli.select("kazoo,access_denied")
    assert [s.name for s in sfx_cli.select(None)] == list(SFX)


def test_install_story_replaces_only_placeholders_and_library_files(tmp_path):
    spec = SFX["access_denied"]
    data = R.wav_bytes(spec, R.render(spec))
    d = tmp_path / "sounds"
    d.mkdir()
    # nothing there → written
    assert sfx_cli.install_story(d, "zip", data)[1] == "wrote"
    assert (d / "zip.wav").read_bytes() == data
    # the same bytes → same; an older library file → rewritten
    assert sfx_cli.install_story(d, "zip", data)[1] == "same"
    older = R.wav_bytes(SFX["packet_burst"], R.render(SFX["packet_burst"]))
    (d / "zip.wav").write_bytes(older)
    assert sfx_cli.install_story(d, "zip", data)[1] == "wrote" and (d / "zip.wav").read_bytes() == data
    # a placeholder → replaced, and it is no longer a placeholder
    write_placeholder(d / "beans_spill.wav", np.sin(np.arange(4800) / 10), "beans_spill", "beans")
    assert is_placeholder(d / "beans_spill.wav")
    assert sfx_cli.install_story(d, "beans_spill", data)[1] == "wrote"
    assert not is_placeholder(d / "beans_spill.wav") and R.is_sfx(d / "beans_spill.wav")
    # a real file → kept, untouched
    (d / "motorcycle.wav").write_bytes(b"RIFF real asset")
    assert sfx_cli.install_story(d, "motorcycle", data)[1] == "keep"
    assert (d / "motorcycle.wav").read_bytes() == b"RIFF real asset"
    # a real file under another extension beside a placeholder → kept, nothing written
    write_placeholder(d / "y2k_chime.wav", np.sin(np.arange(4800) / 10), "y2k_chime", "bell")
    (d / "Y2K_Chime.aiff").write_bytes(b"FORM real bell")
    before = (d / "y2k_chime.wav").read_bytes()
    assert sfx_cli.install_story(d, "y2k_chime", data)[1] == "keep"
    assert (d / "y2k_chime.wav").read_bytes() == before


def conf(tmp_path) -> str:
    p = tmp_path / "house.yaml"
    p.write_text(f"server: {{url: 'http://h', mod_passcode: x}}\naudio: {{sounds_dir: '{tmp_path / 'sounds'}', play_sounds: true}}\n")
    return str(p)


def test_the_cli_lists_writes_and_installs_story_sounds(tmp_path, capsys):
    path = conf(tmp_path)
    assert cli.main(["sounds", "library", "--list", "--config", path]) == 0
    out = capsys.readouterr().out
    assert all(n in out for n in SFX) and f"{len(SFX)} sound(s)" in out
    assert cli.main(["sounds", "library", "--only", "kazoo", "--config", path]) == 2
    assert "kazoo" in capsys.readouterr().err

    manifest = tmp_path / "m.yaml"
    manifest.write_text(
        "sounds:\n"
        "  zip: {motif: zip, seconds: 1, library: access_denied}\n"
        "  beans_spill: {motif: rattle, seconds: 1, library: packet_burst}\n"
        "  rave: {motif: beat_fast, seconds: 1}\n"
        "  motorcycle: {motif: engine, seconds: 1, library: not_made_yet}\n"
    )
    sounds = tmp_path / "sounds"
    sounds.mkdir()
    (sounds / "beans_spill.wav").write_bytes(b"RIFF a real recording")
    lib = tmp_path / "lib"
    argv = ["sounds", "library", "--story", "--only", ",".join(CHEAP), "--out", str(lib), "--manifest", str(manifest), "--config", path]
    assert cli.main(argv) == 0
    out, err = capsys.readouterr()
    assert (lib / "story" / "access_denied.wav").exists() and (lib / "digital" / "packet_burst.wav").exists()
    assert R.is_sfx(sounds / "zip.wav")
    assert (sounds / "beans_spill.wav").read_bytes() == b"RIFF a real recording"
    assert "keep  story beans_spill" in out and "1 story sound(s) written" in out
    assert "not_made_yet" in err
    assert not (sounds / "rave.wav").exists()


def test_the_default_library_folder_is_git_ignored():
    stagehand = Path(__file__).resolve().parents[1]
    assert sfx_cli.LIBRARY_DIR == stagehand / "media" / "library"
    ignored = (stagehand / ".gitignore").read_text().split()
    assert "media/library/" in ignored and "media/music/" in ignored
    assert MANIFEST.parent == stagehand / "media"
