"""The house speaker router (the `audio` module) — the house Mac plays the house.

    event server  GET /api/mod/audio  (long-poll: audio.json + speaker tests)
                  GET /api/spatial/house  (rooms → LOCATIONs)
                  mod feed  sim directive sfx / announce, lifecycle
         │
         ▼
    this module ── ONE sounddevice stream on the interface (the MOTU, 16 / 16)
                   ├─ voices: `sound X` → sounds_dir/X.wav → its speakers' outputs
                   ├─ announcements: chime + `say` → audio.json `announce.to`
                   ├─ tests: a 1.5 s tone + the spoken label on one speaker / output
                   └─ the matrix: inputs (QLab, mics, the TV) → outputs, audio.json `routes`

Where a `sound X` goes, first rule that applies:
  1. the story line's own rooms (`sound X with rooms: …` / `sound X in <Place>`)
  2. `audio.json` `cues[X].to`
  3. the enclosing beat's setting (a LOCATION)
  4. everywhere

Opt-in twice over (decision D6): with `play_sounds: false` (the default) QLab
keeps playing `sound X` — the router only runs the matrix and the tests; with
`announce: false` the `alexa` player keeps the announcements. When the router
plays sounds the `show` module drops its QLab `sound` cues (config.py), so no
sound plays twice; when it announces, an `alexa:` section in the same YAML is a
config error and the router takes the alexa player's lock before it speaks
(a leftover alexa job blocks only the announcements, never the sounds), so
the house never has two voices. With `announce: false` each `do announce`
ducks the router's sounds for `duck_hold_s` (QLab's `duck_music`); sounds
in `no_duck` (the dance tracks) never duck.

Survives the uplink: the last audio.json and house.json are kept in
`cache_dir`, so a restart with the internet down still routes; sounds are
local files; MQTT (`show/announce`, `show/chime`, `show/audio/test`) works on
the LAN alone.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import threading
import time
from pathlib import Path
from typing import Any

import httpx
import numpy as np

from ..alexa.config import AlexaConfig
from ..alexa.module import MAX_TEXT, Announcement, Announcer, parse_payload, try_lock
from ..alexa.player import PlaybackError, decode, resample, say_direct, say_to_file
from ..modapi import ModApiError, ModClient, run_stream
from ..module import ConfigError, Context
from ..show.config import MqttConfig
from ..show.directives import parse_directive, unquote
from .config import AudioConfig, parse_audio_section
from .engine import Engine, device_name, probe
from .mixer import Mixer, lin_to_db
from .routing import (
    EVERYWHERE,
    AudioDoc,
    AudioDocError,
    Resolved,
    output_gains,
    parse_audio,
    fold,
    resolve_targets,
    speaker_layout,
    split_targets,
)
from .sounds import EXTENSIONS, SoundBank, identify_label, identify_tone

log = logging.getLogger("stagehand.audio")

HEALTH_TOPIC = "health/audio"
STATS_TOPIC = "health/audio/stats"
#: The story's own chime: an announcing router rings it (merged into a fresh
#: announcement); otherwise the `alexa` player does, over MQTT.
CHIME_SOUND = "announce_chime"
#: The lifecycle kinds that restart the story: every sound fades out.
RESTART_KINDS = ("reset", "reload", "golive", "ended")
HOUSE_REFRESH_S = 300.0


def build_audio(section: Any, base_dir: str) -> "AudioRouter":
    try:
        return AudioRouter(parse_audio_section(section, base_dir))
    except ConfigError:
        raise
    except ValueError as err:
        raise ConfigError(f"audio: {err}") from err


def sound_args(args: str) -> tuple[str, str | None]:
    """An `sfx` directive's args → (sound name, the story's rooms or None).
    `printer_grind, rooms: desktop` is the lowered form; an unlowered
    `printer_grind with rooms: desktop` (an older server) reads the same."""
    pd = parse_directive("sfx", args)
    name = pd.targets[0] if pd.targets else ""
    rooms = pd.kwargs.get("rooms") or pd.kwargs.get("in") or None
    if not name:
        for key, value in pd.kwargs.items():
            head, sep, tail = key.partition(" with ")
            if sep and tail.strip() in ("rooms", "in"):
                return head.strip(), value or None
    return name, rooms


class MixerOutput:
    """The `alexa` Announcer's output, played through the router's mixer on
    `announce.to` instead of a device of its own. `play` blocks (it runs in a
    worker thread) until the voice has finished."""

    def __init__(self, router: "AudioRouter") -> None:
        self.router = router

    def describe(self) -> str:
        return f"house speakers {','.join(self.router.announce_targets())}"

    def play(self, samples: np.ndarray, rate: int) -> None:
        r = self.router
        mixer = r.mixer
        if mixer is None or not r.engine_running():
            raise PlaybackError("the audio stream is closed")
        res = r.resolve(r.announce_targets())
        if not res.outputs:
            raise PlaybackError(f"announce.to {list(r.announce_targets())} reaches no wired speaker")
        data = resample(samples, rate, mixer.rate)
        finished = threading.Event()
        mixer.play(data, output_gains(r.doc, res.speakers, r.cfg.announce_gain_db), bus="announce", tag="announce", done=finished.set)
        if not finished.wait(timeout=len(data) / mixer.rate + 3.0):
            raise PlaybackError("the announcement never finished (the stream stalled)")


class AudioRouter:
    name = "audio"

    def __init__(
        self,
        cfg: AudioConfig,
        *,
        query=None,
        stream_factory=None,
        render_say=say_to_file,
        speak_direct=say_direct,
        decode=None,
    ) -> None:
        self.cfg = cfg
        self._query = query
        self._stream_factory = stream_factory
        self.render_say = render_say
        self.speak_direct = speak_direct
        self._decode = decode
        self.doc: AudioDoc | None = None
        self.version: str | None = None
        self.source = "none"
        #: Every sound name the compiled story uses (the server's `sounds`).
        self.story_sounds: list[str] = []
        self.house: Any = None
        self.engine: Engine | None = None
        self._signature: tuple | None = None
        self.bank: SoundBank | None = None
        #: The newest speaker test seen (server epoch ms) and the list's seq cursor.
        self.test_at = -1.0
        self.test_seq = 0
        self._tests_primed = False
        self.loop: asyncio.AbstractEventLoop | None = None
        self.announcements: asyncio.Queue | None = None
        self.announcer: Announcer | None = None
        self.mqtt = None
        self._unknown_logged: set[str] = set()
        self.played = 0
        self.skipped = 0
        self._last_open_error = 0.0
        self._last_ticks = -1
        self._stalls = 0
        self._blank_device_logged = False
        #: The alexa player's lock, once held (announce: true only).
        self.lock_fd: int | None = None
        self._dropped_logged = 0.0
        #: `stagehand check` on a fresh house Mac: the server's answer, asked
        #: once, when no cache or config_file holds an audio.json yet (LA-5).
        self._check_answer: dict | None = None
        self._check_problem: str | None = None

    # -- describe / check ----------------------------------------------------

    def describe(self) -> list[str]:
        cfg = self.cfg
        doc = self._local_doc()
        dev = cfg.device or (doc.device if doc else "the audio.json device")
        return [
            f"device   : {dev}" + (f" ({doc.inputs} in / {doc.outputs} out)" if doc else "") + (" duplex" if cfg.passthrough else " output-only"),
            f"sounds   : {'the router plays `sound X` (QLab skipped)' if cfg.play_sounds else 'QLab plays `sound X` (router idle)'} — {cfg.sounds_dir}",
            f"announce : {'the router (chime + say ' + (cfg.say_voice or 'default') + ')' if cfg.announce else 'not here (the alexa player)'}",
            f"matrix   : {'on' if cfg.passthrough else 'off'}" + (f", {len(doc.routes)} route(s)" if doc else ""),
            f"config   : the server's audio.json (long-poll {cfg.poll_wait:.0f}s)" + (f"; local {cfg.config_file}" if cfg.config_file else "") + f"; cache {cfg.cache_dir}",
            f"mqtt     : {f'{cfg.mqtt.host}:{cfg.mqtt.port} ← {cfg.test_topic}' + (f', {cfg.announce_topic}, {cfg.chime_topic}' if cfg.announce else '') if cfg.mqtt else '— (tests + announcements from the server only)'}",
            f"levels   : master {cfg.master_db:+.0f} dB, limit {cfg.limit_db:+.0f} dBFS, duck {cfg.duck_db:+.0f} dB"
            + (f" (held {cfg.duck_hold_s:g}s per alexa announcement)" if not cfg.announce and cfg.duck_hold_s > 0 else "")
            + (f"; never ducked: {', '.join(cfg.no_duck)}" if cfg.no_duck else ""),
        ]

    def _local_doc(self) -> AudioDoc | None:
        for raw in (self._read_json(self._cache_path("audio.json")), self._read_json(self.cfg.config_file), self._check_answer):
            if raw is None:
                continue
            try:
                return parse_audio(raw.get("audio", raw) if isinstance(raw, dict) else raw)
            except AudioDocError:
                continue
        return None

    def fetch_for_check(self, server: Any, *, client_factory: Any = None, timeout: float = 3.0) -> None:
        """`stagehand check` with no local audio.json (a fresh house Mac): ask
        the server once (no long poll, `timeout` s), so the device's channel
        counts and the sound files are checked against the config in force.
        A failure is a warning, never a failed check."""
        if self._local_doc() is not None or server is None or not getattr(server, "url", ""):
            return

        async def ask() -> dict:
            mod = (client_factory or ModClient)(server.url, event=server.event, token=server.mod_token, passcode=server.mod_passcode)
            try:
                return await asyncio.wait_for(mod.get("/api/mod/audio", None, timeout=timeout), timeout + 2)
            finally:
                close = getattr(mod, "aclose", None)
                if close is not None:
                    await close()

        try:
            answer = asyncio.run(ask())
        except (ModApiError, httpx.HTTPError, OSError, ValueError, asyncio.TimeoutError) as err:
            self._check_problem = f"audio: could not ask the server for audio.json ({err or type(err).__name__}) — checked against nothing"
            return
        if isinstance(answer, dict) and isinstance(answer.get("audio"), dict):
            self._check_answer = answer
            self.story_sounds = [str(x) for x in answer.get("sounds") or [] if isinstance(x, str)]

    def preflight(self) -> list[str]:
        """`stagehand check`: the device against the local / cached audio.json."""
        doc = self._local_doc()
        if doc is None:
            name = self.cfg.device
            info, problems = probe(name, 0, 1, self._query)
            if info is not None:
                log.info("audio device %s: %d in / %d out @ %d Hz (no local audio.json to check against)", info.name, info.inputs, info.outputs, info.rate)
            return [f"audio: {p}" for p in problems]
        info, problems = probe(device_name(self.cfg.device) or device_name(doc.device), doc.inputs if self.cfg.passthrough else 0, doc.outputs, self._query)
        if info is not None:
            print(f"audio    : {info.name} — {info.inputs} in / {info.outputs} out @ {info.rate} Hz; audio.json wants {doc.inputs} / {doc.outputs}")
        return [f"audio: {p}" for p in problems]

    def warnings(self) -> list[str]:
        doc = self._local_doc()
        out = []
        if self.cfg.play_sounds:
            if not Path(self.cfg.sounds_dir).is_dir():
                out.append(f"audio: sounds_dir {self.cfg.sounds_dir} does not exist — every `sound X` will be silent")
            else:
                rate = self.cfg.rate or (doc.rate if doc is not None else None) or self._device_rate() or 48000
                bank = SoundBank(self.cfg.sounds_dir, rate)
                names = {n for n in (doc.cues if doc is not None else {}) if n != CHIME_SOUND}
                # The server's own list of the story's sounds (a check that asked it).
                names |= {n for n in self.story_sounds if n != CHIME_SOUND}
                missing = sorted(n for n in names if bank.find(n) is None)
                if missing:
                    out.append(f"audio: no file for {', '.join(missing)} in {self.cfg.sounds_dir}")
                # Every file in the folder, not just the cues: `sound X` plays any name.
                names |= {p.stem for p in Path(self.cfg.sounds_dir).iterdir() if p.suffix.lower() in EXTENSIONS}
                off = bank.off_rate(names)
                if off:
                    listed = ", ".join(f"{n} ({r} Hz)" for n, r in off)
                    out.append(f"audio: {len(off)} sound file(s) not at the device's {rate} Hz — resampled at load, but convert them offline: {listed}")
        if self._check_problem is not None:
            out.append(self._check_problem)
        elif doc is None:
            out.append("audio: no local audio.json (config_file / cache) — the router waits for the server")
        elif self._check_answer is not None:
            out.append("audio: checked against the server's audio.json (nothing cached on this Mac yet)")
        return out

    # -- config ----------------------------------------------------------------

    def _device_rate(self) -> int | None:
        doc = self._local_doc()
        info, _ = probe(device_name(self.cfg.device) or (device_name(doc.device) if doc else None), 0, 1, self._query)
        return info.rate if info is not None else None

    def _cache_path(self, name: str) -> str:
        return os.path.join(self.cfg.cache_dir, name)

    @staticmethod
    def _read_json(path: str | None) -> Any:
        if not path:
            return None
        try:
            return json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _write_json(self, name: str, doc: Any) -> None:
        try:
            Path(self.cfg.cache_dir).mkdir(parents=True, exist_ok=True)
            p = Path(self._cache_path(name))
            tmp = p.with_suffix(".tmp")
            tmp.write_text(json.dumps(doc), encoding="utf-8")
            tmp.replace(p)
        except OSError as err:
            log.warning("audio cache write failed: %s", err)

    def load_local(self) -> bool:
        """At boot: the cached server answer, else `config_file`."""
        house = self._read_json(self._cache_path("house.json")) or self._read_json(self.cfg.house_file)
        if isinstance(house, dict):
            self.house = house
        for raw, source in ((self._read_json(self._cache_path("audio.json")), "cache"), (self._read_json(self.cfg.config_file), "file")):
            if isinstance(raw, dict) and self.apply(raw if "audio" in raw else {"audio": raw}, source=source, persist=False):
                return True
        return False

    def apply(self, answer: dict, *, source: str | None = None, persist: bool = True) -> bool:
        """A `GET /api/mod/audio` answer (or a local copy). → True when the
        config is now in force. Reopens the stream when the device changed."""
        raw = answer.get("audio")
        version = answer.get("version")
        if raw is None:
            return False
        if version is not None and str(version) == self.version and self.doc is not None:
            self.source = source or str(answer.get("source") or self.source)
            return True
        try:
            doc = parse_audio(raw)
        except AudioDocError as err:
            log.error("audio.json refused (%s) — keeping the previous config", err)
            return False
        self.doc = doc
        self.version = str(version) if version is not None else None
        self.source = source or str(answer.get("source") or "server")
        if isinstance(answer.get("sounds"), list):
            self.story_sounds = [s for s in answer["sounds"] if isinstance(s, str)]
        self._unknown_logged.clear()
        log.info("audio.json %s (%s): %d speaker(s), %d zone(s), %d route(s), %d cue(s)", self.version or "?", self.source, len(doc.speakers), len(doc.zones), len(doc.routes), len(doc.cues))
        if persist:
            self._write_json("audio.json", {k: answer[k] for k in ("audio", "version", "source", "sounds") if k in answer})
        self.ensure_engine()
        if self.mixer is not None:
            self.mixer.set_routes(self._routes(doc))
        return True

    @staticmethod
    def _routes(doc: AudioDoc) -> dict[tuple[int, int], float]:
        out: dict[tuple[int, int], float] = {}
        for r in doc.routes:
            for o in r.out:
                out[(r.inp, o)] = r.gain_db
        return out

    def set_house(self, house: Any, persist: bool = True) -> None:
        if isinstance(house, dict):
            self.house = house
            self._unknown_logged.clear()
            if persist:
                self._write_json("house.json", house)

    # -- the stream ------------------------------------------------------------

    @property
    def mixer(self) -> Mixer | None:
        return self.engine.mixer if self.engine is not None else None

    def engine_running(self) -> bool:
        return self.engine is not None and self.engine.running

    def ensure_engine(self) -> bool:
        """Open the stream for the current config (reopen on a device change)."""
        doc = self.doc
        if doc is None:
            return False
        cfg = self.cfg
        signature = (device_name(cfg.device) or device_name(doc.device), doc.inputs, doc.outputs, cfg.rate or doc.rate, cfg.passthrough)
        if signature[0] is None and not self._blank_device_logged:
            self._blank_device_logged = True
            log.warning("audio.json names no device (device.name is blank) and the YAML sets no `device:` — using the default output")
        if self.engine is not None and signature == self._signature and self.engine.running:
            return True
        if self.engine is not None and signature != self._signature:
            self.engine.close()
            self.engine = None
        if self.engine is None:
            self.engine = Engine(
                signature[0],
                doc.inputs,
                doc.outputs,
                rate=signature[3],
                duplex=cfg.passthrough,
                blocksize=cfg.blocksize,
                latency=cfg.latency,
                mixer_args={"master_db": cfg.master_db, "limit_db": cfg.limit_db, "duck_db": cfg.duck_db},
                query=self._query,
                stream_factory=self._stream_factory,
            )
            self._signature = signature
        try:
            mixer = self.engine.open()
        except Exception as err:  # noqa: BLE001 — missing device / PortAudio
            now = time.monotonic()
            if now - self._last_open_error > 30:
                log.error("audio stream failed to open (%s) — retrying", err)
                self._last_open_error = now
            return False
        mixer.set_passthrough(cfg.passthrough)
        mixer.set_routes(self._routes(doc))
        self.bank = SoundBank(cfg.sounds_dir, mixer.rate, **({"decode": self._decode} if self._decode else {}))
        return True

    # -- routing ---------------------------------------------------------------

    def resolve(self, targets) -> Resolved:
        if self.doc is None:
            return Resolved()
        res = resolve_targets(self.doc, self.house, list(targets))
        for name in res.unknown:
            if name not in self._unknown_logged:
                self._unknown_logged.add(name)
                log.warning("audio target %r names no zone, room, LOCATION or speaker", name)
        return res

    def announce_targets(self) -> tuple[str, ...]:
        return self.doc.announce_to if self.doc is not None else (EVERYWHERE,)

    def targets_for(self, name: str, rooms: str | None = None, setting: str | None = None) -> tuple[list[str], float, str]:
        """→ (target names, cue gain dB, why) for `sound <name>`."""
        assert self.doc is not None
        cue = self.doc.cue(name)
        gain = cue.gain_db if cue is not None else 0.0
        if rooms:
            return split_targets(rooms, self.doc, self.house), gain, "story"
        if cue is not None and cue.to:
            return list(cue.to), gain, "cue"
        if setting:
            return [setting], gain, "setting"
        return [EVERYWHERE], gain, "everywhere"

    def play_sound(self, name: str, rooms: str | None = None, setting: str | None = None) -> str:
        """One `sound X`. → `played`, `closed`, `nowhere` or `no-file` (for logs + tests)."""
        if self.doc is None or self.mixer is None or not self.engine_running() or self.bank is None:
            self.skipped += 1
            log.warning("sound %s: the audio stream is closed — skipped", name)
            return "closed"
        targets, gain, why = self.targets_for(name, rooms, setting)
        res = self.resolve(targets)
        if not res.outputs:
            self.skipped += 1
            log.warning("sound %s → %s (%s) reaches no wired speaker — skipped", name, targets, why)
            return "nowhere"
        data = self.bank.load(name)
        if data is None:
            self.skipped += 1
            return "no-file"
        self.mixer.play(
            data,
            output_gains(self.doc, res.speakers, gain),
            bus="sfx",
            tag=name,
            duck=self.ducks(name),
            layout=speaker_layout(self.doc, res.speakers),
        )
        self.played += 1
        log.info("sound %s → %s (%s: %s) out %s", name, ",".join(res.speakers), why, ",".join(targets), ",".join(map(str, res.outputs)))
        return "played"

    def ducks(self, name: str) -> bool:
        """Does `sound <name>` duck under an announcement? Not when the YAML's
        `no_duck` names it or its audio.json cue says `duck: false` (the
        show's dance tracks, as QLab's `duck_music` group always skipped)."""
        key = fold(name)
        if any(fold(n) == key for n in self.cfg.no_duck):
            return False
        cue = self.doc.cue(name) if self.doc is not None else None
        return cue is None or cue.duck

    # -- the story feed --------------------------------------------------------

    def speaks_announcements(self) -> bool:
        """`announce: true` and the voice lock is ours (no alexa player)."""
        return self.cfg.announce and self.lock_fd is not None

    def announce_state(self) -> str:
        return "off" if not self.cfg.announce else ("on" if self.lock_fd is not None else "blocked")

    def announcements_from_feed(self) -> bool:
        """With a broker, announcements arrive on MQTT (the show module's
        `show/announce` rule) — never both, or each line would play twice."""
        return self.cfg.announce and self.cfg.mqtt is None

    def on_sim(self, event: Any) -> str | None:
        if not isinstance(event, dict) or event.get("type") != "directive":
            return None
        verb = str(event.get("verb", ""))
        if verb == "sfx":
            name, rooms = sound_args(str(event.get("args", "")))
            if not name:
                return None
            if name == CHIME_SOUND:
                if self.announcements_from_feed():
                    self.enqueue("chime")
                    return "chime"
                return None
            if not self.cfg.play_sounds:
                return None
            setting = event.get("setting") if isinstance(event.get("setting"), str) else None
            return self.play_sound(name, rooms, setting)
        if verb == "announce":
            if not self.speaks_announcements():
                # The alexa player speaks it (announce: false, or its lock is
                # still held): the router's beds duck for the line's length,
                # as QLab's `duck_music` did.
                if self.mixer is not None and self.cfg.duck_hold_s > 0:
                    self.mixer.duck_for(self.cfg.duck_hold_s)
                    return "duck"
                return None
            if self.announcements_from_feed():
                text = " ".join(unquote(str(event.get("args", "")).strip()).split())[:MAX_TEXT]
                if text and text != "{target}":
                    self.enqueue(Announcement(text=text))
                    return "announce"
        return None

    def on_lifecycle(self, doc: Any) -> None:
        kind = str(doc.get("kind", "")) if isinstance(doc, dict) else ""
        if kind in RESTART_KINDS and self.mixer is not None:
            log.info("lifecycle %s: every sound fades out", kind)
            self.mixer.stop(bus="sfx", fade_s=1.0)

    # -- announcements -----------------------------------------------------------

    def make_announcer(self) -> Announcer:
        cfg = self.cfg
        alexa = AlexaConfig(
            mqtt=MqttConfig(host="-"),
            device=device_name(cfg.device) or (device_name(self.doc.device) if self.doc else None),
            engine="say",
            say_voice=cfg.say_voice,
            chime=cfg.chime,
            gain_db=0.0,
            cache_dir=self._cache_path("voice"),
        )
        return Announcer(alexa, None, output=MixerOutput(self), render_say=self.render_say, speak_direct=self.speak_direct)

    def enqueue(self, item: Any) -> None:
        if self.announcements is None:
            log.warning("announcement dropped (the router is not running)")
            return
        if self.loop is not None:
            self.loop.call_soon_threadsafe(self.announcements.put_nowait, item)
        else:
            self.announcements.put_nowait(item)

    async def _announce_worker(self) -> None:
        assert self.announcements is not None
        while True:
            item = await self.announcements.get()
            if not self.speaks_announcements():
                now = time.monotonic()
                if now - self._dropped_logged > 60:
                    self._dropped_logged = now
                    log.warning("announcement dropped: an `alexa` player holds the house's voice (announce: blocked)")
                continue
            if self.announcer is None:
                self.announcer = self.make_announcer()
            try:
                if item == "chime":
                    log.info("chime → %s", await self.announcer.ring())
                elif isinstance(item, Announcement):
                    if self.doc is not None and not self.doc.announce_chime:
                        item = Announcement(text=item.text, voice=item.voice, chime=False)
                    await self.announcer.announce(item)
            except Exception:  # noqa: BLE001 — one bad line must not stop the next
                log.exception("announcement failed")

    # -- speaker tests -----------------------------------------------------------

    def test_targets(self, speaker: str | None, out: int | None) -> tuple[tuple[int, ...], str] | None:
        """(outputs, label) for a test of one speaker or one output, or None."""
        if self.doc is None:
            return None
        if speaker:
            s = self.doc.speaker(speaker)
            if s is None:
                log.warning("speaker test: no speaker %r in audio.json", speaker)
                return None
            if not s.out:
                log.warning("speaker test: %s has no output", s.name)
                return None
            return tuple(sorted(s.out)), s.name
        if isinstance(out, int) and 1 <= out <= self.doc.outputs:
            return (out,), self.doc.output_labels.get(out, "")
        log.warning("speaker test: neither a speaker nor an output (%r)", out)
        return None

    async def play_test(self, speaker: str | None = None, out: int | None = None) -> bool:
        target = self.test_targets(speaker, out)
        mixer = self.mixer
        if target is None or mixer is None or not self.engine_running():
            return False
        outs, label = target
        gains = {ch: self.cfg.test_gain_db for ch in outs}
        text = identify_label(label, outs)
        log.info("speaker test: %s", text)
        loop = asyncio.get_running_loop()
        tone_done = loop.create_future()

        def finished() -> None:
            loop.call_soon_threadsafe(lambda: tone_done.done() or tone_done.set_result(None))

        mixer.play(identify_tone(mixer.rate, outs[0]), gains, bus="test", tag="test", done=finished)
        try:
            spoken = await asyncio.to_thread(self.render_say, text, self.cfg.say_voice)
            samples, rate = decode(spoken)
        except PlaybackError as err:
            log.warning("speaker test label: %s", err)
            return True
        try:
            await asyncio.wait_for(tone_done, timeout=5.0)
        except asyncio.TimeoutError:
            pass
        mixer.play(resample(samples, rate, mixer.rate), gains, bus="test", tag="test")
        return True

    def new_tests(self, tests: Any) -> list[dict]:
        """The tests in a poll answer not yet played. The first answer only
        primes the cursor (a restart never replays an old press)."""
        rows = [t for t in tests if isinstance(t, dict) and isinstance(t.get("seq"), int)] if isinstance(tests, list) else []
        # `seq` restarts with the server; `at` (its epoch ms) never goes back.
        self.test_seq = max((t["seq"] for t in rows), default=0)
        fresh = sorted((t for t in rows if float(t.get("at") or 0) > self.test_at), key=lambda t: float(t.get("at") or 0))
        if rows:
            self.test_at = max(self.test_at, max(float(t.get("at") or 0) for t in rows))
        if not self._tests_primed:
            self._tests_primed = True
            return []
        return fresh

    # -- loops -------------------------------------------------------------------

    async def _config_loop(self, mod: ModClient) -> None:
        backoff = 1.0
        missing_route = False
        while True:
            # `router=1` (+ this machine's name): the server shows the map
            # editor that a router is listening, so a Test there is played.
            params: dict[str, Any] = {"router": 1, "name": socket.gethostname().split(".")[0][:64]}
            if self.version is not None and self.source not in ("cache", "file"):
                params.update({"after": self.version, "tests": self.test_seq, "wait": int(self.cfg.poll_wait)})
            asked = time.monotonic()
            try:
                answer = await mod.get("/api/mod/audio", params, timeout=self.cfg.poll_wait + 15)
            except ModApiError as err:
                if err.status == 404:
                    if not missing_route:
                        log.error("the server has no /api/mod/audio (an older release) — routing from the local audio.json")
                        missing_route = True
                    await asyncio.sleep(60)
                    continue
                log.warning("audio.json poll refused (%s) — retrying in %.0fs", err, backoff)
            except (httpx.HTTPError, OSError, ValueError) as err:
                log.warning("audio.json poll failed (%s) — retrying in %.0fs", err or type(err).__name__, backoff)
            else:
                backoff = 1.0
                missing_route = False
                changed = str(answer.get("version")) != self.version or self.source in ("cache", "file", "none")
                self.apply(answer)
                tests = self.new_tests(answer.get("tests"))
                for t in tests:
                    asyncio.ensure_future(self.play_test(t.get("speaker") or None, t.get("out")))
                if changed:
                    asyncio.ensure_future(self._refresh_house(mod))
                    asyncio.ensure_future(self._preload())
                elif params and not tests and time.monotonic() - asked < 1.0:
                    # A server that answers a long-poll at once (an older
                    # release ignoring `wait`) must not be hammered.
                    await asyncio.sleep(5.0)
                continue
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)

    async def _refresh_house(self, mod: ModClient) -> None:
        try:
            doc = await mod.get("/api/spatial/house")
        except (ModApiError, httpx.HTTPError, OSError, ValueError) as err:
            log.warning("house map read failed (%s) — LOCATIONs resolve from the cached map", err)
            return
        self.set_house(doc.get("house"))

    async def _house_loop(self, mod: ModClient) -> None:
        while True:
            await asyncio.sleep(HOUSE_REFRESH_S)
            await self._refresh_house(mod)

    async def _preload(self) -> None:
        if not self.cfg.play_sounds or self.bank is None or self.doc is None:
            return
        names = {n for n in [*self.doc.cues, *self.story_sounds] if n != CHIME_SOUND}
        loaded, missing = await asyncio.to_thread(self.bank.preload, names)
        log.info("sounds: %d loaded from %s%s", loaded, self.cfg.sounds_dir, f"; NO FILE for {', '.join(missing)}" if missing else "")

    async def _feed_loop(self, mod: ModClient) -> None:
        def on_frame(event: str, data: str) -> None:
            try:
                doc = json.loads(data)
            except ValueError:
                return
            if event == "sim":
                self.on_sim(doc)
            elif event == "lifecycle":
                self.on_lifecycle(doc)

        await run_stream(mod, mod.feed_url("stagehand-audio"), on_frame, label="audio feed")

    def check_stream(self) -> bool:
        """One watchdog look: reopen a closed stream, or one whose callback
        stopped (a replugged interface can leave PortAudio "active" but
        silent). → True when the stream was (re)opened."""
        if self.doc is None:
            return False
        mixer = self.mixer
        if self.engine_running() and mixer is not None:
            if mixer.ticks != self._last_ticks:
                self._last_ticks, self._stalls = mixer.ticks, 0
                return False
            self._stalls += 1
            if self._stalls < 2:
                return False
            log.error("the audio stream stopped calling back — reopening it")
            assert self.engine is not None
            self.engine.mark_failed()
            self.engine.close()
        self._stalls = 0
        return self.ensure_engine()

    async def _watchdog(self) -> None:
        while True:
            await asyncio.sleep(2.0)
            if self.check_stream():
                asyncio.ensure_future(self._preload())

    def health(self) -> dict[str, Any]:
        mixer = self.mixer
        peak, limited, blocks = mixer.take_meters() if mixer is not None else (np.zeros(0), 0, 0)
        return {
            "ok": self.engine_running(),
            "device": self.engine.describe() if self.engine is not None else None,
            "config": self.version,
            "source": self.source,
            "voices": mixer.active() if mixer is not None else 0,
            "xruns": self.engine.xruns if self.engine is not None else 0,
            "reinits": self.engine.reinits if self.engine is not None else 0,
            "limited": limited,
            "blocks": blocks,
            "peak_db": round(lin_to_db(float(peak.max())) if len(peak) else -120.0, 1),
            "played": self.played,
            "skipped": self.skipped,
            "missing": sorted(self.bank.missing) if self.bank is not None else [],
            "announce": self.announce_state(),
        }

    async def _health_loop(self) -> None:
        while True:
            await asyncio.sleep(self.cfg.health_s)
            h = self.health()
            log.info(
                "audio health: %s | audio.json %s (%s) | voices %d | played %d skipped %d | xruns %d | limited %d/%d | peak %.1f dBFS | announce %s%s",
                h["device"] or "closed", h["config"] or "—", h["source"], h["voices"], h["played"], h["skipped"], h["xruns"], h["limited"], h["blocks"], h["peak_db"], h["announce"],
                f" | no file: {', '.join(h['missing'])}" if h["missing"] else "",
            )
            if self.mqtt is not None:
                self.mqtt.publish(STATS_TOPIC, json.dumps(h), retain=True)

    async def _mqtt_loop(self) -> None:
        assert self.mqtt is not None
        cfg = self.cfg
        while True:
            topic, raw, retained = await self.mqtt.queue.get()
            if retained:
                continue  # a stale announcement or test is never replayed
            if topic == cfg.test_topic:
                try:
                    doc = json.loads(raw.decode("utf-8"))
                except (UnicodeDecodeError, ValueError):
                    doc = None
                if isinstance(doc, dict):
                    await self.play_test(doc.get("speaker") or None, doc.get("out"))
                else:
                    log.warning("ignored %s payload %r", topic, raw[:80])
            elif cfg.announce and topic == cfg.chime_topic:
                self.enqueue("chime")
            elif cfg.announce and topic == cfg.announce_topic:
                a = parse_payload(raw)
                if a is not None:
                    self.enqueue(a)

    async def _voice_lock_loop(self) -> None:
        """announce: true — take the alexa player's lock. Until it is ours
        only the announcements wait (dropped, logged, `announce: blocked` in
        health); sounds, the matrix and the tests play from the start."""
        warned = False
        while self.lock_fd is None:
            self.lock_fd = try_lock(self.cfg.announce_lock_dir)
            if self.lock_fd is not None:
                if warned:
                    log.info("the alexa player stopped — the router speaks the announcements now")
                return
            if not warned:
                log.error(
                    "an `alexa` player holds %s/player.lock — the router owns announcements (announce: true), "
                    "so it will not speak them until that player stops (one owner of the house's voice); "
                    "every sound, the matrix and the tests play meanwhile",
                    self.cfg.announce_lock_dir,
                )
                warned = True
            await asyncio.sleep(5.0)

    async def run(self, ctx: Context) -> None:
        if self.cfg.announce:
            self.lock_fd = try_lock(self.cfg.announce_lock_dir)
        self.loop = asyncio.get_running_loop()
        self.announcements = asyncio.Queue()
        if self.load_local():
            log.info("routing from the %s audio.json until the server answers", self.source)
        tasks = [
            asyncio.ensure_future(self._config_loop(ctx.mod)),
            asyncio.ensure_future(self._house_loop(ctx.mod)),
            asyncio.ensure_future(self._feed_loop(ctx.mod)),
            asyncio.ensure_future(self._watchdog()),
            asyncio.ensure_future(self._health_loop()),
            asyncio.ensure_future(self._announce_worker()),
        ]
        if self.cfg.announce and self.lock_fd is None:
            tasks.append(asyncio.ensure_future(self._voice_lock_loop()))
        if self.cfg.mqtt is not None:
            from ..show.mqtt import MqttBridge

            m = self.cfg.mqtt
            filters = [self.cfg.test_topic, *([self.cfg.announce_topic, self.cfg.chime_topic] if self.cfg.announce else [])]
            self.mqtt = MqttBridge(m.host, m.port, filters=filters, loop=self.loop, client_id=m.client_id, username=m.username, password=m.password, health_topic=HEALTH_TOPIC)
            self.mqtt.start()
            tasks.append(asyncio.ensure_future(self._mqtt_loop()))
        try:
            await asyncio.gather(*tasks)
        finally:
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if self.mqtt is not None:
                self.mqtt.stop()
                self.mqtt = None
            if self.engine is not None:
                self.engine.close()
            if self.lock_fd is not None:
                os.close(self.lock_fd)
                self.lock_fd = None
