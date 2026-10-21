"""The router's parts below the module: the `audio:` section, the one
device stream (a fake sounddevice), the sound bank and the test signals."""

from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from stagehand.audio.config import parse_audio_section
from stagehand.audio.engine import Engine, probe
from stagehand.audio.sounds import IDENTIFY_S, SoundBank, identify_label, identify_tone
from stagehand.modapi import ModClient
from stagehand.module import ConfigError

RATE = 8000


def write_wav(path: Path, seconds: float = 0.05, rate: int = RATE, value: float = 0.25, channels: int = 1) -> Path:
    sf.write(str(path), np.full((int(rate * seconds), channels), value, dtype=np.float32), rate)
    return path


class FakeStream:
    """A sounddevice stream: records how it was opened; `pump` runs the
    callback by hand, `threaded=True` pumps it from a thread like PortAudio."""

    opened: list["FakeStream"] = []

    def __init__(self, threaded: bool = False, **kwargs) -> None:
        self.kwargs = kwargs
        self.active = False
        self.closed = False
        self.threaded = threaded
        self.out: list[np.ndarray] = []
        self._thread: threading.Thread | None = None
        FakeStream.opened.append(self)

    @property
    def n_out(self) -> int:
        ch = self.kwargs["channels"]
        return ch[1] if isinstance(ch, tuple) else ch

    @property
    def n_in(self) -> int:
        ch = self.kwargs["channels"]
        return ch[0] if isinstance(ch, tuple) else 0

    def start(self) -> None:
        self.active = True
        if self.threaded:
            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()

    def _loop(self) -> None:
        while self.active:
            self.pump(256)
            time.sleep(0.001)

    def stop(self) -> None:
        self.active = False

    def close(self) -> None:
        self.closed = True
        self.active = False

    def pump(self, frames: int = 400, indata: np.ndarray | None = None) -> np.ndarray:
        out = np.zeros((frames, self.n_out), dtype=np.float32)
        cb = self.kwargs["callback"]
        if self.n_in:
            if indata is None:
                indata = np.zeros((frames, self.n_in), dtype=np.float32)
            cb(indata, out, frames, None, None)
        else:
            cb(out, frames, None, None)
        self.out.append(out)
        return out


def fake_query(inputs: int = 16, outputs: int = 16, rate: int = RATE, name: str = "MOTU UltraLite-mk5"):
    def query(device=None, kind=None):
        if device is not None and device not in name and device != 3:
            raise ValueError(f"No device matching {device!r}")
        return {"name": name, "index": 3, "max_input_channels": inputs, "max_output_channels": outputs, "default_samplerate": rate}

    return query


def test_section_defaults(tmp_path):
    cfg = parse_audio_section({}, str(tmp_path))
    assert (cfg.play_sounds, cfg.announce, cfg.passthrough) == (False, False, True)
    assert cfg.sounds_dir == str((tmp_path / "media" / "sounds").resolve())
    assert cfg.latency == "high" and cfg.poll_wait == 25 and cfg.mqtt is None
    assert parse_audio_section(None, str(tmp_path)) == cfg


def test_section_paths_resolve_beside_the_yaml(tmp_path):
    (tmp_path / "a.json").write_text("{}")
    cfg = parse_audio_section({"sounds_dir": "media", "config_file": "a.json", "latency": 0.02, "mqtt": {"host": "127.0.0.1"}}, str(tmp_path))
    assert cfg.sounds_dir == str((tmp_path / "media").resolve())
    assert cfg.config_file == str((tmp_path / "a.json").resolve())
    assert cfg.latency == 0.02 and cfg.mqtt.client_id == "stagehand-audio"


@pytest.mark.parametrize(
    "section, msg",
    [
        ({"play_sounds": "yes"}, "play_sounds"),
        ({"latency": "medium"}, "latency"),
        ({"master_db": 40}, "master_db"),
        ({"config_file": "nope.json"}, "config_file"),
        ({"chime": "missing.wav"}, "chime"),
        ({"mqtt": {"port": 1883}}, "mqtt"),
        ({"blocksize": 7}, "blocksize"),
        ([], "mapping"),
    ],
)
def test_section_refuses(tmp_path, section, msg):
    with pytest.raises(ConfigError, match=msg):
        parse_audio_section(section, str(tmp_path))


def test_the_engine_opens_one_duplex_stream_by_index():
    FakeStream.opened.clear()
    e = Engine("MOTU", 16, 16, query=fake_query(), stream_factory=lambda **kw: FakeStream(**kw))
    mixer = e.open()
    s = FakeStream.opened[-1]
    assert s.kwargs["device"] == (3, 3) and s.kwargs["channels"] == (16, 16)
    assert s.kwargs["samplerate"] == RATE and s.kwargs["dtype"] == "float32" and s.active
    assert (mixer.n_in, mixer.n_out, mixer.rate) == (16, 16, RATE)
    assert "16 in / 16 out" in e.describe()
    e.close()
    assert s.closed and not e.running


def test_output_only_without_passthrough_and_smaller_devices_drop_channels(caplog):
    FakeStream.opened.clear()
    e = Engine("MOTU", 16, 16, duplex=False, rate=48000, query=fake_query(inputs=8, outputs=8), stream_factory=lambda **kw: FakeStream(**kw))
    with caplog.at_level(logging.WARNING):
        mixer = e.open()
    s = FakeStream.opened[-1]
    assert s.kwargs["channels"] == 8 and s.kwargs["device"] == 3 and s.kwargs["samplerate"] == 48000
    assert mixer.n_out == 8 and "the rest are dropped" in caplog.text
    assert s.pump(64).shape == (64, 8)


def test_a_callback_that_fails_writes_silence_and_counts():
    e = Engine("MOTU", 2, 2, query=fake_query(2, 2), stream_factory=lambda **kw: FakeStream(**kw))
    mixer = e.open()

    def boom(indata, outdata):
        raise RuntimeError("bad block")

    mixer.process = boom
    out = e.stream.pump(32)
    assert not out.any() and e.errors == 1


class Replug:
    """PortAudio's device list: frozen until `reinit` re-reads it."""

    def __init__(self) -> None:
        self.plugged = True
        self.listed = True  # what PortAudio last read
        self.reinits = 0

    def query(self, device=None, kind=None):
        if not self.listed:
            raise ValueError(f"No device matching {device!r}")
        return fake_query()(device, kind)

    def reinit(self) -> None:
        self.reinits += 1
        self.listed = self.plugged


def test_a_replugged_interface_needs_portaudio_reinitialised():
    pa = Replug()
    e = Engine("MOTU", 2, 2, query=pa.query, reinit=pa.reinit, stream_factory=lambda **kw: FakeStream(**kw))
    e.open()
    assert pa.reinits == 0  # the first open never re-reads
    # Unplugged: the stream dies, and PortAudio's list is stale (still empty
    # once re-read while unplugged).
    pa.plugged = pa.listed = False
    e.stream.active = False
    with pytest.raises(ValueError):
        e.open()
    assert pa.reinits == 1 and e.needs_reinit
    # Plugged back in: a plain query would still fail (the list is stale) —
    # only the reinit before the next open finds it.
    pa.plugged = True
    with pytest.raises(ValueError):
        pa.query("MOTU")
    e.open()
    assert pa.reinits == 2 and e.running and not e.needs_reinit
    e.open()  # a healthy reopen (a config change) does not re-read
    assert pa.reinits == 2


def test_a_stalled_stream_is_marked_for_a_reinit():
    pa = Replug()
    e = Engine("MOTU", 2, 2, query=pa.query, reinit=pa.reinit, stream_factory=lambda **kw: FakeStream(**kw))
    e.open()
    e.mark_failed()
    e.open()
    assert pa.reinits == 1 and e.reinits == 1


def test_a_blank_device_name_is_the_default_output():
    asked = []

    def query(device=None, kind=None):
        asked.append((device, kind))
        if device is not None:
            raise ValueError(f"Multiple devices found for {device!r}")  # what PortAudio says to ""
        return fake_query(2, 2)(None, kind)

    for blank in ("", "   ", None):
        e = Engine(blank, 2, 2, query=query, stream_factory=lambda **kw: FakeStream(**kw))
        e.open()
        assert e.running and e.device is None
    assert asked == [(None, "output")] * 3
    assert probe("", 0, 2, query)[1] == []


def test_probe_reports_missing_and_short_devices():
    info, problems = probe("MOTU", 16, 16, fake_query(8, 8))
    assert info.outputs == 8 and len(problems) == 2 and "8 outputs" in problems[0]
    assert probe("Scarlett", 0, 2, fake_query())[0] is None
    assert probe("MOTU", 16, 16, fake_query())[1] == []


def test_identify_tone_and_label():
    tone = identify_tone(RATE, 3)
    assert tone.shape == (int(RATE * IDENTIFY_S / 3) * 3, 1) and np.abs(tone).max() <= 0.31
    assert not np.allclose(identify_tone(RATE, 1)[:400], identify_tone(RATE, 2)[:400])
    assert identify_label("Desktop left", (1,)) == "Desktop left. Output 1."
    assert identify_label("", (3, 4)) == "Outputs 3, 4."


def test_mod_client_feed_url_and_long_poll_timeout():
    c = ModClient("http://h:7000/", event="ev1", token="t")
    assert c.feed_url("stagehand-audio") == "http://h:7000/e/ev1/events?role=mod&id=stagehand-audio&lean=1"
    assert c.sse_url.endswith("id=stagehand&lean=1")



def test_the_bank_finds_names_exactly_then_case_insensitively(tmp_path):
    write_wav(tmp_path / "zip.wav")
    write_wav(tmp_path / "Motorcycle.AIFF")
    (tmp_path / "notes.txt").write_text("x")
    bank = SoundBank(tmp_path, RATE)
    assert bank.find("zip") == tmp_path / "zip.wav"
    assert bank.find("motorcycle").samefile(tmp_path / "Motorcycle.AIFF")
    assert bank.find("notes") is None and bank.find("../zip") is None and bank.find("a/b") is None


def test_the_bank_resamples_once_and_rereads_a_changed_file(tmp_path):
    p = write_wav(tmp_path / "zip.wav", seconds=0.1, rate=16000, channels=2)
    bank = SoundBank(tmp_path, RATE)
    data = bank.load("zip")
    assert data.shape == (800, 2) and bank.load("zip") is data
    write_wav(p, seconds=0.2, rate=RATE)
    os.utime(p, (time.time() + 5, time.time() + 5))
    assert bank.load("zip").shape == (1600, 1)


def test_a_missing_or_broken_sound_is_logged_once(tmp_path, caplog):
    (tmp_path / "broken.wav").write_bytes(b"not audio")
    bank = SoundBank(tmp_path, RATE)
    with caplog.at_level(logging.WARNING):
        for _ in range(3):
            assert bank.load("alarm_siren") is None
            assert bank.load("broken") is None
    logged = [r.getMessage() for r in caplog.records]
    assert sum("'alarm_siren'" in m for m in logged) == 1 and sum("'broken'" in m for m in logged) == 1
    assert bank.missing == {"alarm_siren", "broken"}
    write_wav(tmp_path / "alarm_siren.wav")
    assert bank.load("alarm_siren") is not None and bank.missing == {"broken"}


def test_preload_reports_what_has_no_file(tmp_path):
    write_wav(tmp_path / "zip.wav")
    assert SoundBank(tmp_path, RATE).preload(["zip", "dance_song", "zip"]) == (1, ["dance_song"])
