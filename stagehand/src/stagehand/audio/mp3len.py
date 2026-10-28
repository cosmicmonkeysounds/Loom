"""An MP3's real length, for `stagehand check` (wave 38 review).

libsndfile (1.2.2) takes an MP3's length from its header. A VBR file with
no Xing / Info / VBRI tag has no length in its header, so libsndfile guesses
one from the first frame's bitrate, and its decoder **stops at that guess**:
a 10-minute VBR rip without the tag plays only its first ~4 minutes, as if
the file ended there (a soundtrack bed crossfades on early; a takeover song
just ends). Reading past the guess is impossible through soundfile, so the
fix is the file's: re-encode it. This module finds those files cheaply:

  - the first frame carries a Xing / Info / VBRI tag → fine (LAME, iTunes
    and ffmpeg write one by default);
  - else walk every MPEG frame header (4 bytes each, no decoding: a few
    tens of ms for a 10-minute file); one bitrate throughout is CBR, whose
    size-based estimate is right; a VBR walk's length is compared with what
    libsndfile reports.

Pure Python, no decoding, injectable `info` (soundfile's) for the tests.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

#: A gap between the real and the header length worth a warning.
TOLERANCE_S = 1.0
#: How far a lost sync is searched for before the walk gives up.
RESYNC_BYTES = 64 * 1024

_BITRATES = {
    (1, 1): (0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448),
    (1, 2): (0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384),
    (1, 3): (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320),
    (2, 1): (0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256),
    (2, 2): (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
    (2, 3): (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
}
_RATES = {1: (44100, 48000, 32000), 2: (22050, 24000, 16000), 25: (11025, 12000, 8000)}


def frame_at(data: bytes, i: int) -> tuple[int, int, int, int, int] | None:
    """The MPEG audio frame header at `i` → (frame bytes, samples, rate,
    kbps, side-info bytes), or None when there is no valid header there."""
    if i + 4 > len(data) or data[i] != 0xFF or (data[i + 1] & 0xE0) != 0xE0:
        return None
    b1, b2, b3 = data[i + 1], data[i + 2], data[i + 3]
    ver_bits = (b1 >> 3) & 3
    layer_bits = (b1 >> 1) & 3
    if ver_bits == 1 or layer_bits == 0:
        return None
    version = {3: 1, 2: 2, 0: 25}[ver_bits]
    layer = 4 - layer_bits
    br_index, sr_index, pad = b2 >> 4, (b2 >> 2) & 3, (b2 >> 1) & 1
    if br_index in (0, 15) or sr_index == 3:
        return None  # free format / bad: not something libsndfile estimates either
    kbps = _BITRATES[(1 if version == 1 else 2, layer)][br_index]
    rate = _RATES[version][sr_index]
    if layer == 1:
        size, samples = (12 * kbps * 1000 // rate + pad) * 4, 384
    elif layer == 2:
        size, samples = 144 * kbps * 1000 // rate + pad, 1152
    else:
        samples = 1152 if version == 1 else 576
        size = (144 if version == 1 else 72) * kbps * 1000 // rate + pad
    mono = (b3 >> 6) == 3
    side = (17 if mono else 32) if version == 1 else (9 if mono else 17)
    return size, samples, rate, kbps, side


def _audio_start(data: bytes) -> int:
    """Skip an ID3v2 tag (and its footer)."""
    if len(data) >= 10 and data[:3] == b"ID3":
        size = (data[6] & 0x7F) << 21 | (data[7] & 0x7F) << 14 | (data[8] & 0x7F) << 7 | (data[9] & 0x7F)
        return 10 + size + (10 if data[5] & 0x10 else 0)
    return 0


def _sync(data: bytes, i: int) -> int | None:
    """The next offset from `i` holding two valid frames in a row (a lone
    0xFF byte in junk is not a frame)."""
    end = min(len(data), i + RESYNC_BYTES)
    while i < end:
        j = data.find(b"\xff", i, end)
        if j < 0:
            return None
        f = frame_at(data, j)
        if f is not None and (j + f[0] >= len(data) or frame_at(data, j + f[0]) is not None):
            return j
        i = j + 1
    return None


def scan(data: bytes) -> dict[str, Any] | None:
    """Walk the frames → {tag, cbr, seconds, rate}; None when no frame is
    found. `tag`: a Xing / Info / VBRI tag in the first frame (seconds is then
    not walked); `cbr`: one bitrate in every frame."""
    i = _sync(data, _audio_start(data))
    if i is None:
        return None
    first = frame_at(data, i)
    assert first is not None
    size, samples, rate, kbps, side = first
    body = data[i + 4 + side : i + 4 + side + 4]
    if body in (b"Xing", b"Info") or data[i + 36 : i + 40] == b"VBRI":
        return {"tag": True, "cbr": False, "seconds": None, "rate": rate}
    total = 0
    rates: set[int] = set()
    frames = 0
    while i is not None and i < len(data):
        f = frame_at(data, i)
        if f is None:
            i = _sync(data, i + 1)
            continue
        size, samples, _, kbps, _ = f
        total += samples
        frames += 1
        rates.add(kbps)
        i += max(1, size)
    return {"tag": False, "cbr": len(rates) == 1, "seconds": total / rate, "rate": rate}


def length_problem(path: str | Path, *, info: Callable[[str], Any] | None = None) -> str | None:
    """A warning for an MP3 libsndfile would stop playing early, else None
    (fine, not an MP3, or unreadable: other checks report a bad file)."""
    p = Path(path)
    if p.suffix.lower() != ".mp3":
        return None
    try:
        data = p.read_bytes()
    except OSError:
        return None
    found = scan(data)
    if found is None or found["tag"] or found["cbr"] or found["seconds"] is None:
        return None
    if info is None:
        import soundfile as sf

        info = sf.info
    try:
        meta = info(str(p))
        header_s = float(meta.frames) / float(meta.samplerate)
    except Exception:  # noqa: BLE001 — libsndfile raises its own types
        return None
    real_s = float(found["seconds"])
    if real_s - header_s <= TOLERANCE_S:
        return None
    return (
        f"{p.name}: a VBR MP3 without a length header — it plays only the first {header_s:.0f} s of {real_s:.0f} s; "
        f"re-encode it, e.g. `ffmpeg -i in.mp3 -c:a libmp3lame -q:a 2 out.mp3`"
    )
