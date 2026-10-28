"""The SFX library's synthesis toolkit (wave 38, C6, `audio/sfx/dsp.py`):
the FFT filters match the per-sample reference, circular mode is a loop's
steady state, the oscillators are band-limited and phase-continuous, the
protocol tones are on frequency, and the mixing and loop helpers do what
the category modules rely on."""

from __future__ import annotations

import math

import numpy as np
import pytest

from stagehand.audio.sfx import dsp
from stagehand.audio.sfx.dsp import RATE, Biquad


def rng(seed: int = 7) -> np.random.Generator:
    return np.random.default_rng(seed)


def peak_hz(x: np.ndarray, lo: float = 20, hi: float = 24000) -> float:
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    f = np.fft.rfftfreq(len(x), 1 / RATE)
    band = (f >= lo) & (f <= hi)
    return float(f[band][np.argmax(spec[band])])


def alias_db(x: np.ndarray, f0: float) -> float:
    """Energy away from the harmonics of `f0`, relative to the total."""
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / RATE)
    near = np.abs(f / f0 - np.round(f / f0)) * f0 < 15
    return 10 * math.log10(spec[~near].sum() / spec.sum())


# -- time and pitch -----------------------------------------------------------------


def test_time_helpers():
    assert dsp.frames(1.5) == 72000 and dsp.frames(-1) == 0
    assert len(dsp.timebase(0.5)) == 24000 and dsp.timebase(n=3)[2] == 2 / RATE
    assert dsp.fit(np.ones(10), 1.0).shape == (48000,) and dsp.fit(np.ones(96000), 1.0).shape == (48000,)
    assert dsp.fit(np.ones((10, 2)), 1.0).shape == (48000, 2)
    assert dsp.pad(np.ones(10), after=0.001, before=0.001).shape == (106,)
    assert dsp.concat(np.ones(5), np.ones((5, 2))).shape == (10, 2)


@pytest.mark.parametrize(("note", "want"), [("A4", 440.0), ("C4", 261.6256), ("A#4", 466.1638), ("Bb4", 466.1638), ("E6", 1318.51), (69, 440.0), (60.0, 261.6256)])
def test_note_names(note, want):
    assert dsp.hz(note) == pytest.approx(want, rel=1e-4)


def test_a_bad_note_is_refused():
    with pytest.raises(ValueError):
        dsp.hz("H2")


def test_loop_freq_fits_whole_cycles():
    f = dsp.loop_freq(100.3, 2.5)
    assert f * 2.5 == pytest.approx(round(f * 2.5)) and abs(f - 100.3) <= 0.2


def test_phase_is_continuous_through_a_glide():
    f = dsp.glide(200, 3000, 0.5)
    assert f[0] == pytest.approx(200) and f[-1] == pytest.approx(3000)
    ph = dsp.phase(f)
    assert ph[0] == 0 and np.all(np.diff(ph) > 0)
    x = dsp.sine(f)
    assert np.max(np.abs(np.diff(x))) <= dsp.TAU * 3000 / RATE * 1.01, "no jump anywhere"
    lin = dsp.glide(200, 400, 0.1, curve="linear")
    assert lin[len(lin) // 2] == pytest.approx(300, rel=0.01)
    with pytest.raises(ValueError):
        dsp.glide(1, 2, 1, curve="wiggle")


def test_sweep_interpolates_in_pitch():
    f = dsp.sweep([(0, 100), (1, 400)], 1.0)
    assert f[dsp.frames(0.5)] == pytest.approx(200, rel=0.01)


def test_vibrato_and_jitter_stay_near_the_pitch():
    v = dsp.vibrato(440, 1.0, depth_cents=50)
    assert v.max() == pytest.approx(440 * 2 ** (50 / 1200), rel=1e-3)
    j = dsp.jitter(440, rng(), 1.0, cents_rms=10)
    cents = 1200 * np.log2(j / 440)
    assert np.sqrt(np.mean(cents**2)) == pytest.approx(10, rel=0.01)


# -- oscillators ---------------------------------------------------------------------


@pytest.mark.parametrize("osc", ["saw", "square", "triangle"])
def test_the_band_limited_oscillators_alias_far_less_than_naive(osc):
    f = 3111.0
    t = dsp.timebase(1.0)
    ph = f * t % 1
    naive = {"saw": 2 * ph - 1, "square": np.where(ph < 0.5, 1.0, -1.0), "triangle": 1 - 4 * np.abs(ph - 0.5)}[osc]
    good = getattr(dsp, osc)(f, 1.0)
    assert alias_db(good, f) < alias_db(naive, f) - 10
    assert peak_hz(good) == pytest.approx(f, abs=2)


def test_pulse_is_zero_mean_at_any_width():
    for w in (0.125, 0.25, 0.5):
        x = dsp.pulse(dsp.loop_freq(220, 1.0), 1.0, width=w)
        assert abs(x.mean()) < 0.01


def test_additive_drops_partials_above_nyquist():
    x = dsp.additive(10000, 0.5, partials=[(1, 1), (3, 1)])
    spec = np.abs(np.fft.rfft(x))
    f = np.fft.rfftfreq(len(x), 1 / RATE)
    assert spec[(f > 18000)].max() < spec.max() * 1e-3, "the 30 kHz partial is gone, not folded to 18 kHz"


def test_wavetable_plays_its_table_at_pitch():
    cycle = dsp.table([(1, 1), (2, 0.5)])
    x = dsp.wavetable(cycle, 300, 0.5)
    assert peak_hz(x) == pytest.approx(300, abs=3)
    assert np.abs(x).max() == pytest.approx(1, abs=0.01)


def test_fm_and_feedback_fm():
    plain = dsp.fm(440, 0.2, ratio=1, index=0)
    assert np.allclose(plain, dsp.sine(440, 0.2))
    bright = dsp.fm(440, 0.2, ratio=2, index=3)
    assert alias_db(bright, 440) < -20 and np.abs(bright).max() <= 1
    fb = dsp.fm(440, 0.05, feedback=1.0)
    assert np.all(np.isfinite(fb)) and np.abs(fb).max() <= 1


def test_ring_and_am():
    x = dsp.ring(dsp.sine(1000, 0.5), 200)
    assert peak_hz(x) in (pytest.approx(800, abs=3), pytest.approx(1200, abs=3))
    trem = dsp.am(np.ones(48000), 4, depth=0.5)
    assert trem.min() == pytest.approx(0.5, abs=0.01) and trem.max() == pytest.approx(1.0, abs=0.01)


# -- noise ------------------------------------------------------------------------------


@pytest.mark.parametrize("colour", ["white", "pink", "brown"])
def test_noise_colours_share_one_rms_and_are_seeded(colour):
    a = getattr(dsp, colour)(1.0, rng(1))
    b = getattr(dsp, colour)(1.0, rng(1))
    assert np.array_equal(a, b)
    assert np.sqrt(np.mean(a**2)) == pytest.approx(dsp.NOISE_RMS, rel=1e-6)


def test_pink_and_brown_tilt_down():
    def octave_db(x, lo):
        spec = np.abs(np.fft.rfft(x)) ** 2
        f = np.fft.rfftfreq(len(x), 1 / RATE)
        return 10 * math.log10(spec[(f >= lo) & (f < 2 * lo)].mean())

    p, b = dsp.pink(4, rng(2)), dsp.brown(4, rng(3))
    assert octave_db(p, 500) - octave_db(p, 1000) == pytest.approx(3, abs=1)
    assert octave_db(b, 500) - octave_db(b, 1000) == pytest.approx(6, abs=1)


def test_velvet_and_crackle_are_sparse():
    v = dsp.velvet(1.0, rng(), density=100)
    assert np.count_nonzero(v) == 100 and set(np.unique(v)) <= {-1.0, 0.0, 1.0}
    c = dsp.crackle(1.0, rng(), density=20)
    assert np.mean(np.abs(c) > 1e-3) < 0.1 and np.abs(c).max() <= 3


# -- envelopes --------------------------------------------------------------------------


def test_envelopes():
    d = dsp.decay(1.0, 0.5)
    assert d[0] == 1 and d[dsp.frames(0.5)] == pytest.approx(1e-3, rel=0.01)
    a = dsp.ar(1.0, attack=0.1)
    assert a[0] == 0 and a.argmax() == pytest.approx(dsp.frames(0.1), abs=2) and a[-1] < 2e-3
    e = dsp.adsr(1.0, 0.01, 0.1, 0.5, 0.2)
    assert e[0] == 0 and e.max() == pytest.approx(1, abs=0.01) and e[dsp.frames(0.6)] == pytest.approx(0.5, abs=0.02) and e[-1] < 0.01
    g = dsp.gates(1.0, [(0.1, 0.2), (0.5, 0.1)])
    assert g[dsp.frames(0.2)] == 1 and g[dsp.frames(0.4)] == 0 and g[dsp.frames(0.55)] == 1
    ln = dsp.line([(0, 0), (1, 1)], 1.0)
    assert ln[dsp.frames(0.25)] == pytest.approx(0.25, abs=1e-3)
    ex = dsp.line([(0, 1), (1, 100)], 1.0, curve="exp")
    assert ex[dsp.frames(0.5)] == pytest.approx(10, rel=0.01)


def test_fade_ramps_both_ends_of_mono_and_stereo():
    for x in (np.ones(4800), np.ones((4800, 2))):
        y = dsp.fade(x, 0.01, 0.02)
        assert np.all(np.abs(y[0]) < 0.01) and np.all(np.abs(y[-1]) < 0.01)
        assert np.all(y[2400] == 1) and np.all(x == 1), "the input is not changed"


# -- filters ----------------------------------------------------------------------------

DESIGNS = [
    Biquad.lowpass(1000, 5), Biquad.highpass(200), Biquad.bandpass(2000, 4), Biquad.notch(1000),
    Biquad.peak(3000, 6, 2), Biquad.lowshelf(200, -6), Biquad.highshelf(5000, 4),
    Biquad.onepole(500), Biquad.onepole(500, "hp"),
]


@pytest.mark.parametrize("bq", DESIGNS, ids=lambda b: f"{b.b0:.3g}")
def test_the_fft_filter_matches_the_per_sample_biquad(bq):
    x = rng().standard_normal(9000)
    assert np.max(np.abs(dsp.filt(x, bq) - dsp.biquad_loop(x, bq))) < 1e-6


def test_the_filters_do_what_they_say():
    x = dsp.sine(100, 0.5) + dsp.sine(5000, 0.5)
    assert peak_hz(dsp.lowpass(x, 500, order=4)) == pytest.approx(100, abs=3)
    assert peak_hz(dsp.highpass(x, 1000, order=4)) == pytest.approx(5000, abs=3)
    assert peak_hz(dsp.bandpass(dsp.white(1, rng()), 3000, 8)) == pytest.approx(3000, rel=0.1)
    assert dsp.rms_db(dsp.notch(dsp.sine(1000, 0.5), 1000)[4800:]) < -40
    tel = dsp.telephone(dsp.sine(100, 0.5) + dsp.sine(1000, 0.5))
    assert peak_hz(tel) == pytest.approx(1000, abs=3)


def test_circular_filtering_is_the_loops_steady_state():
    p = rng().standard_normal(4800)
    steady = dsp.filt(np.tile(p, 20), Biquad.lowpass(300, 8))[-4800:]
    assert np.max(np.abs(dsp.filt(p, Biquad.lowpass(300, 8), circular=True) - steady)) < 1e-6
    ir = np.exp(-np.arange(9000) / 800)
    linear = dsp.convolve(np.tile(p, 4), ir)[-4800:]
    assert np.max(np.abs(dsp.convolve(p, ir, circular=True) - linear)) < 1e-3


def test_the_svf_matches_the_biquad_at_a_fixed_cutoff_and_sweeps():
    x = rng().standard_normal(4800)
    assert np.max(np.abs(dsp.svf(x, 1000.0) - dsp.filt(x, Biquad.lowpass(1000)))) < 1e-6
    swept = dsp.svf(dsp.white(0.5, rng()), dsp.glide(200, 8000, 0.5), q=4, mode="bp")
    assert np.all(np.isfinite(swept))
    early, late = swept[: dsp.frames(0.1)], swept[-dsp.frames(0.1) :]
    assert peak_hz(early) < 600 < 4000 < peak_hz(late)
    for mode in ("hp", "notch"):
        assert np.all(np.isfinite(dsp.svf(x, 500.0, mode=mode)))
    with pytest.raises(ValueError):
        dsp.svf(x, 500.0, mode="wah")


def test_smooth_glides_a_step():
    step = np.concatenate([np.zeros(4800), np.ones(4800)])
    s = dsp.smooth(step, 0.01)
    assert s[4800 + dsp.frames(0.01)] == pytest.approx(1 - 1 / math.e, abs=0.03) and s[-1] == pytest.approx(1, abs=0.01)


# -- delay and reverb ----------------------------------------------------------------------


def test_comb_and_delay_echo_on_time():
    click = np.zeros(48000)
    click[0] = 1
    echoes = dsp.comb(click, 0.1, feedback=0.5)
    assert echoes[dsp.frames(0.1)] == pytest.approx(1, abs=1e-6) and echoes[dsp.frames(0.2)] == pytest.approx(0.5, abs=1e-6)
    wet = dsp.delay(click, 0.25, feedback=0.3, mix_=0.5, damp=0)
    assert wet[dsp.frames(0.25)] == pytest.approx(0.5, abs=1e-6)


def test_allpass_keeps_the_spectrum_flat():
    x = dsp.allpass(np.r_[1.0, np.zeros(2**16 - 1)], 0.01, 0.6)
    mag = np.abs(np.fft.rfft(x))
    assert mag.min() == pytest.approx(1, abs=0.02) and mag.max() == pytest.approx(1, abs=0.02)


def test_reverb_is_stereo_has_a_tail_and_loops_circularly():
    blip = dsp.pad(dsp.sine(800, 0.05) * dsp.decay(0.05, 0.05), after=1.5)
    r = dsp.reverb(blip, room=0.8, wet=0.5, dry=0)
    assert r.shape == (len(blip), 2)
    assert dsp.rms_db(r[dsp.frames(0.5) : dsp.frames(1.0)]) > -60, "a tail"
    assert not np.allclose(r[:, 0], r[:, 1]), "the right channel is spread"
    p = dsp.white(0.5, rng())
    steady = dsp.reverb(np.tile(p, 16), room=0.6)[-len(p) :]
    assert np.max(np.abs(dsp.reverb(p, room=0.6, circular=True) - steady)) < 0.01 * np.abs(steady).max()


# -- lo-fi, drive, mixing ---------------------------------------------------------------------


def test_lofi_and_drive():
    x = dsp.sine(440, 0.1)
    assert len(np.unique(dsp.bitcrush(x, 3))) <= 9
    held = dsp.downsample(x, 8000)
    assert np.all(held[::6] == held[1::6][: len(held[::6])])
    assert np.abs(dsp.soft_clip(x, 6)).max() == pytest.approx(1.0, abs=1e-3)
    assert np.abs(dsp.soft_clip(x * 4, 6)).max() <= 1 / math.tanh(dsp.db_to_lin(6)) + 1e-9
    assert np.abs(dsp.hard_clip(x * 2, 0.5)).max() == 0.5
    sat = dsp.saturate(x, 0.5)
    assert np.abs(sat).max() <= 1.0 + 1e-9 and abs(sat.mean()) < 0.1


def test_levels():
    x = dsp.sine(dsp.loop_freq(440, 1.0), 1.0)
    assert dsp.peak_db(dsp.normalize_peak(x, -6)) == pytest.approx(-6, abs=1e-6)
    assert dsp.rms_db(dsp.normalize_rms(x, -20)) == pytest.approx(-20, abs=1e-6)
    assert dsp.rms_db(x) == pytest.approx(-3.01, abs=0.01)
    assert dsp.lin_to_db(dsp.db_to_lin(-12.5)) == pytest.approx(-12.5)
    assert dsp.peak_db(np.zeros(0)) < -200


def test_mix_places_layers_and_wraps_a_loop():
    a = np.ones(4800)
    m = dsp.mix((a, 0.05, -6), a)
    assert len(m) == 4800 + 2400 and m[0] == 1 and m[2400] == pytest.approx(1 + 0.501, abs=1e-3)
    st = dsp.mix(a, (np.ones((100, 2)), 0.0))
    assert st.shape == (4800, 2) and st[0, 1] == 2
    w = dsp.mix((a, 0.08), seconds=0.1, wrap=True)
    assert len(w) == 4800 and w[0] == 1 and w.sum() == 4800, "the overflow lands on the head"
    with pytest.raises(ValueError):
        dsp.mix(a, wrap=True)


def test_pan_is_constant_power():
    x = np.ones(10)
    for p in (-1, -0.5, 0, 0.5, 1):
        st = dsp.pan(x, p)
        assert np.sum(st[0] ** 2) == pytest.approx(2.0)
    assert dsp.pan(x, -1)[0, 1] == pytest.approx(0, abs=1e-12)
    assert dsp.stereo(x).shape == (10, 2) and dsp.to_mono(dsp.stereo(x)).shape == (10,)


def test_dc_block_and_make_loop():
    x = dsp.sine(300, 1.0) + 0.5
    assert abs(dsp.dc_block(x)[24000:].mean()) < 0.01
    assert abs(dsp.dc_block(x, circular=True).mean()) < 1e-6
    hiss = dsp.lowpass(dsp.white(3.0, rng()), 1000)
    loop = dsp.make_loop(hiss, 2.5, 0.5)
    assert len(loop) == dsp.frames(2.5)
    assert abs(loop[0] - hiss[dsp.frames(2.5)]) < 1e-3, "the head starts where the tail would continue"
    assert dsp.make_loop(dsp.stereo(hiss), 2.5, 0.5).shape == (dsp.frames(2.5), 2)
    with pytest.raises(ValueError):
        dsp.make_loop(hiss, 2.9, 0.5)


# -- telephony and sequencing ---------------------------------------------------------------


def test_dtmf_digits_are_on_frequency():
    five = dsp.dtmf("5", on=0.2, off=0.0)
    assert peak_hz(five, 600, 1000) == pytest.approx(770, abs=6)
    assert peak_hz(five, 1100, 1700) == pytest.approx(1336, abs=6)
    assert len(dsp.dtmf("12 3", on=0.1, off=0.05)) == dsp.frames(0.15) * 4
    with pytest.raises(ValueError):
        dsp.dtmf("X")


def test_call_progress_tones_and_cadences():
    dial = dsp.call_progress("dial", 1.0)
    assert peak_hz(dial, 300, 400) == pytest.approx(350, abs=2) and peak_hz(dial, 400, 500) == pytest.approx(440, abs=2)
    busy = dsp.call_progress("busy", 2.0)
    assert np.abs(busy[dsp.frames(0.7) : dsp.frames(0.8)]).max() == 0, "off half the time"
    assert np.abs(busy[dsp.frames(1.1) : dsp.frames(1.2)]).max() > 0.5
    with pytest.raises(ValueError):
        dsp.call_progress("howler", 1.0)
    assert peak_hz(dsp.ansam(1.0)) == pytest.approx(2100, abs=20)


def test_fsk_switches_tones_per_bit():
    x = dsp.fsk("1100", 100, mark=1200, space=2200)
    assert len(x) == dsp.frames(0.04)
    assert peak_hz(x[: dsp.frames(0.02)]) == pytest.approx(1200, abs=60)
    assert peak_hz(x[dsp.frames(0.02) :]) == pytest.approx(2200, abs=60)


def test_sequence_places_notes_in_seconds_or_beats():
    seen = []

    def voice(f, d):
        seen.append((round(f, 2), round(d, 3)))
        return np.ones(dsp.frames(d))

    out = dsp.sequence([("A4", 0, 0.1), (None, 0.1, 0.1), (60, 0.2, 0.1, -6)], voice)
    assert seen == [(440.0, 0.1), (261.63, 0.1)] and len(out) == dsp.frames(0.3)
    assert out[dsp.frames(0.15)] == 0 and out[dsp.frames(0.25)] == pytest.approx(0.501, abs=1e-3)
    seen.clear()
    dsp.sequence([("A4", 1, 1)], voice, bpm=120)
    assert seen == [(440.0, 0.5)]
