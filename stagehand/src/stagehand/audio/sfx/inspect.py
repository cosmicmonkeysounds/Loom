"""Look at library sounds (wave 38, C6): a PNG per sound and a contact sheet.

    uv run --with matplotlib python -m stagehand.audio.sfx.inspect --only a,b --out /tmp/sfx [--wav] [--seconds 8]

Each sound is rendered exactly as the library writes it and drawn as its
waveform over a log-frequency spectrogram, titled with its category, length,
peak, RMS and loudness (the loudest 400 ms) dBFS. A loop is drawn twice round (the seam in the middle,
marked) so a click or a jump at the seam shows. `contact.png` puts every
spectrogram on one sheet for a quick pass over a whole category.

matplotlib is imported inside `main` only: it is a reviewer's tool (`uv run
--with matplotlib`), never a stagehand dependency. The spectrogram is plain
numpy, so the numbers are there without it (`spectrogram`).
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import numpy as np

from . import dsp
from . import render as R
from .registry import CATEGORIES, SFX, Spec


def spectrogram(x: np.ndarray, size: int = 2048, hop: int = 512) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """→ (times s, freqs Hz, dB [freq, time]) of mono `x` (Hann window)."""
    x = dsp.to_mono(x)
    if len(x) < size:
        x = np.pad(x, (0, size - len(x)))
    win = np.hanning(size)
    count = 1 + (len(x) - size) // hop
    idx = np.arange(size)[None, :] + hop * np.arange(count)[:, None]
    mag = np.abs(np.fft.rfft(x[idx] * win, axis=1)).T
    db = 20 * np.log10(np.maximum(mag / (size / 4), 1e-6))
    times = (np.arange(count) * hop + size / 2) / dsp.RATE
    return times, np.fft.rfftfreq(size, 1 / dsp.RATE), db


def title(spec: Spec, x: np.ndarray) -> str:
    st = R.stats(x)
    kind = "loop" if spec.loop else "one-shot"
    ch = "stereo" if x.ndim == 2 else "mono"
    return (
        f"{spec.name} · {spec.category} · {st['seconds']:.2f} s {kind} {ch} · "
        f"peak {st['peak_db']:.1f} dBFS · RMS {st['rms_db']:.1f} dBFS · loudest 400 ms {st['loud_db']:.1f} dBFS"
    )


def _view(spec: Spec, x: np.ndarray, seconds: float | None) -> tuple[np.ndarray, float | None]:
    """What to draw: a loop twice round (→ the seam's time), a long sound cut."""
    seam = None
    if spec.loop:
        half = len(x) if seconds is None else min(len(x), dsp.frames(seconds / 2))
        x = np.concatenate([x[-half:], x[:half]])
        seam = half / dsp.RATE
    elif seconds is not None:
        x = x[: dsp.frames(seconds)]
    return x, seam


def _draw(plt, spec: Spec, x: np.ndarray, out: Path, seconds: float | None) -> None:
    view, seam = _view(spec, x, seconds)
    fig, (wave, spec_ax) = plt.subplots(2, 1, figsize=(12, 6), sharex=True, gridspec_kw={"height_ratios": [1, 2]})
    t = np.arange(len(view)) / dsp.RATE
    if view.ndim == 2:
        wave.plot(t, view[:, 0], lw=0.4, color="#2a6fdb", label="L")
        wave.plot(t, view[:, 1], lw=0.4, color="#d9622b", alpha=0.7, label="R")
        wave.legend(loc="upper right", fontsize=7)
    else:
        wave.plot(t, view, lw=0.4, color="#2a6fdb")
    wave.set_ylim(-1, 1)
    wave.axhline(dsp.db_to_lin(-1), color="#999", lw=0.5, ls=":")
    wave.axhline(-dsp.db_to_lin(-1), color="#999", lw=0.5, ls=":")
    times, freqs, db = spectrogram(view)
    keep = freqs >= 20
    mesh = spec_ax.pcolormesh(times, freqs[keep], db[keep], shading="auto", cmap="magma", vmin=-100, vmax=0)
    spec_ax.set_yscale("log")
    spec_ax.set_ylim(20, dsp.NYQUIST)
    spec_ax.set_ylabel("Hz")
    spec_ax.set_xlabel("s" + ("  (a loop, twice round: the seam is the dashed line)" if seam is not None else ""))
    if seam is not None:
        for ax in (wave, spec_ax):
            ax.axvline(seam, color="#39c", lw=0.8, ls="--")
    fig.colorbar(mesh, ax=[wave, spec_ax], label="dB", fraction=0.03)
    fig.suptitle(title(spec, x), fontsize=10)
    fig.text(0.01, 0.01, spec.note, fontsize=8, color="#555")
    fig.savefig(out, dpi=110)
    plt.close(fig)


def _contact(plt, rendered: list[tuple[Spec, np.ndarray]], out: Path) -> None:
    cols = 4
    rows = max(1, math.ceil(len(rendered) / cols))
    fig, axes = plt.subplots(rows, cols, figsize=(4 * cols, 2.4 * rows), squeeze=False)
    for ax in axes.flat:
        ax.axis("off")
    for ax, (spec, x) in zip(axes.flat, rendered):
        times, freqs, db = spectrogram(x, size=1024, hop=512)
        keep = freqs >= 20
        ax.axis("on")
        ax.pcolormesh(times, freqs[keep], db[keep], shading="auto", cmap="magma", vmin=-100, vmax=0)
        ax.set_yscale("log")
        ax.set_ylim(20, dsp.NYQUIST)
        ax.set_xticks([])
        ax.set_yticks([])
        st = R.stats(x)
        ax.set_title(f"{spec.name} ({spec.category}) {st['seconds']:.1f}s {st['peak_db']:.0f}/{st['rms_db']:.0f} dB", fontsize=7)
    fig.tight_layout()
    fig.savefig(out, dpi=100)
    plt.close(fig)


def pick(only: str | None, category: str | None = None) -> list[Spec]:
    """The named sounds (a comma list), or a category's, or everything."""
    if only:
        names = [n.strip() for n in only.split(",") if n.strip()]
        unknown = [n for n in names if n not in SFX]
        if unknown:
            raise KeyError(", ".join(unknown))
        return [SFX[n] for n in names]
    return [s for s in SFX.values() if category is None or s.category == category]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m stagehand.audio.sfx.inspect", description=__doc__.split("\n")[0])
    ap.add_argument("--only", help="a comma list of sound names (default: every sound)")
    ap.add_argument("--category", choices=CATEGORIES, help="every sound in one category")
    ap.add_argument("--out", required=True, help="the folder for the PNGs (and --wav files)")
    ap.add_argument("--seconds", type=float, help="draw at most this long (a loop: this much across the seam)")
    ap.add_argument("--wav", action="store_true", help="also write each sound's WAV beside its PNG")
    args = ap.parse_args(argv)
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("inspect needs matplotlib: uv run --with matplotlib python -m stagehand.audio.sfx.inspect …", file=sys.stderr)
        return 2
    try:
        specs = pick(args.only, args.category)
    except KeyError as err:
        print(f"inspect: no such sound: {err.args[0]}", file=sys.stderr)
        return 2
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rendered: list[tuple[Spec, np.ndarray]] = []
    for spec in specs:
        try:
            x = R.render(spec)
        except R.RenderError as err:
            print(f"FAIL  {err}", file=sys.stderr)
            continue
        _draw(plt, spec, x, out / f"{spec.name}.png", args.seconds)
        if args.wav:
            R.write_bytes(out / f"{spec.name}.wav", R.wav_bytes(spec, x))
        rendered.append((spec, x))
        print(f"drew  {out / (spec.name + '.png')}  {title(spec, x)}")
    if rendered:
        _contact(plt, rendered, out / "contact.png")
        print(f"sheet {out / 'contact.png'} ({len(rendered)} sounds)")
    return 0 if len(rendered) == len(specs) else 1


if __name__ == "__main__":
    raise SystemExit(main())
