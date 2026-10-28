"""A VBR MP3 with no length header (wave 38 review): libsndfile plays only
its estimate, so `check` finds such files by walking the frame headers."""

from __future__ import annotations

from types import SimpleNamespace

from stagehand.audio.mp3len import frame_at, length_problem, scan

RATE = 44100
KBPS_INDEX = {32: 1, 128: 9, 320: 14}


def frame(kbps: int, tag: bytes = b"") -> bytes:
    """One MPEG-1 layer III 44.1 kHz stereo frame, its payload zeros."""
    head = bytes([0xFF, 0xFB, KBPS_INDEX[kbps] << 4, 0x00])
    size = 144 * kbps * 1000 // RATE
    body = bytearray(size - 4)
    body[32 : 32 + len(tag)] = tag
    return head + bytes(body)


def mp3(kbps_list: list[int], *, tag: bytes = b"", id3: bool = False) -> bytes:
    out = b"".join(frame(k, tag if i == 0 else b"") for i, k in enumerate(kbps_list))
    if id3:
        out = b"ID3\x03\x00\x00\x00\x00\x00\x0a" + b"\x00" * 10 + out
    return out + b"TAG" + b"\x00" * 125  # an ID3v1 tail is no frame


def secs(n: int) -> float:
    return n * 1152 / RATE


def test_a_frame_header_is_read_and_junk_is_not():
    f = frame_at(frame(128), 0)
    assert f is not None and f[1:4] == (1152, RATE, 128) and f[0] == 417
    assert frame_at(b"\xff\x00\x00\x00", 0) is None and frame_at(b"abc", 0) is None


def test_the_walk_counts_every_frame_and_tells_cbr_from_vbr():
    vbr = scan(mp3([320, 32] * 500, id3=True))
    assert vbr["tag"] is False and vbr["cbr"] is False and abs(vbr["seconds"] - secs(1000)) < 1e-6
    cbr = scan(mp3([128] * 300))
    assert cbr["cbr"] is True and abs(cbr["seconds"] - secs(300)) < 1e-6
    assert scan(mp3([320, 32] * 10, tag=b"Xing"))["tag"] is True
    assert scan(mp3([320, 32] * 10, tag=b"Info"))["tag"] is True
    assert scan(b"\x00" * 5000) is None


def test_check_warns_only_for_a_vbr_file_whose_header_length_is_short(tmp_path):
    def info_of(seconds: float):
        return lambda path: SimpleNamespace(frames=int(seconds * RATE), samplerate=RATE)

    bad = tmp_path / "song.mp3"
    bad.write_bytes(mp3([320, 32] * 2000))  # ≈ 104 s of frames
    problem = length_problem(bad, info=info_of(40.0))  # libsndfile's guess from the first frame
    assert problem is not None and "song.mp3" in problem and "first 40 s of 104 s" in problem and "ffmpeg" in problem
    assert length_problem(bad, info=info_of(secs(4000))) is None  # the header agrees
    tagged = tmp_path / "tagged.mp3"
    tagged.write_bytes(mp3([320, 32] * 2000, tag=b"Xing"))
    assert length_problem(tagged, info=info_of(40.0)) is None  # a length header: exact
    cbr = tmp_path / "cbr.mp3"
    cbr.write_bytes(mp3([128] * 2000))
    assert length_problem(cbr, info=info_of(40.0)) is None  # CBR: the estimate is right
    wav = tmp_path / "x.wav"
    wav.write_bytes(b"RIFF")
    assert length_problem(wav) is None and length_problem(tmp_path / "gone.mp3") is None
