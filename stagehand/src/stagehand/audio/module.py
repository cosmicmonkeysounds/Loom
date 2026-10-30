"""The house speaker router (the `audio` module) — the router machine plays the house.

    event server  GET /api/mod/audio  (long-poll: audio.json + tests, stops, desk plays,
                                       the house mix, music commands, mixWatch)
                  POST /api/mod/audio/report  (acks for plays + tests, the health)
                  POST /api/mod/audio/meters  (live meters while a mixer panel watches)
                  GET /api/mod/audio/walkers  (SSE: who walks in the games, and where)
                  GET /api/spatial/house  (rooms → LOCATIONs)
                  mod feed  sim directive sfx / announce, lifecycle
         │
         ▼
    this module ── ONE sounddevice stream on the interface (the MOTU 828x on its
                   │  own outs: audio.json 10 in / 14 out, device.expect 32 / 30)
                   ├─ voices: `sound X` → sounds_dir/X.wav → its speakers' outputs
                   ├─ announcements: chime + `say` → audio.json `announce.to`
                   ├─ tests: a 1.5 s tone + the spoken label on one speaker / output
                   ├─ stops: Run's ■ Stop house sounds (`stops=`) / show/audio/stop
                   ├─ plays: the house desk's sound / say steps (`plays=`, wave 25) / show/audio/play
                   ├─ the soundtrack: music beds per scene (`cue music_<scene>`, wave 38)
                   ├─ the footsteps: the games' programs, heard walking (wave 49)
                   └─ the matrix: inputs (mics, the TV, a line) → outputs, audio.json `routes`;
                      every input metered, a `role` input ducks the music (its sidechain)

Where a `sound X` goes, first rule that applies:
  1. the story line's own rooms (`sound X with rooms: …` / `sound X in <Place>`)
  2. `audio.json` `cues[X].to`
  3. the enclosing beat's setting (a LOCATION)
  4. everywhere

Opt-in twice over (wave 17's D6; the show turns both on since wave 18b, and
QLab and the `alexa` player are retired there): with `play_sounds: false`
(the default) another cue player keeps `sound X` — the router only runs the
matrix and the tests; with `announce: false` the `alexa` player keeps the
announcements. When the router plays sounds the `show` module drops its OSC
`sound` cues (config.py), so no sound plays twice; when it announces, an
`alexa:` section in the same YAML is a config error and the router takes the
alexa player's lock before it speaks (a leftover alexa job blocks only the
announcements, never the sounds), so the house never has two voices. With
`announce: false` each `do announce` holds the `announce` priority source
for `duck_hold_s`; sounds in `no_duck` (the dance tracks) never duck.

Priority (wave 38, C2/C4): the YAML's `priority` says how deep each source
ducks the sfx and music buses; the sources are the audio.json inputs with a
`role` (their sidechain: Trabolta's TV, Clippy's mic, metered only on a
duplex stream, `passthrough: true`), the router's own announcements and
the takeover tracks. The speakers' trims are the outputs' (`set_trim`),
not the voices', so an edit on the map is heard at once on a long bed.

The soundtrack (wave 38, C3; `soundtrack.py`): with `soundtrack:` set the
router owns a `Director` that plays the scene's beds on the `music` bus.
The scene comes from, first that applies: a live `cue music_<scene>` on the
feed; MQTT `show/audio/music` (`{"scene"}`, `{"next": true, "playlist"?}`,
`{"stop": true}`) or the mixer's music commands (wave 40, below); the **catch-up** — `night.music` from `GET /api/screen/state`, read
as the lights job reads `night.lights`, on start, on every feed reconnect
and 2 s after a story restart (a live cue that lands while it is read wins;
null or unknown is `off`). A story `sound X` the soundtrack lists under
`tracks:` streams from `sounds_dir` (never decoded whole) on the sfx bus as
a `takeover`: the beds on its speakers fall silent until it ends.

"Stop all house sounds" (wave 18b, Q7) is one-shot and never journaled: every
sfx voice, speaker test and music bed fades over 0.3 s (the scene is
forgotten: the next scene cue, even the same one, brings the beds back);
`+ announcements` also cuts the
line playing now and empties the queue. The TV, the terminals and the live
inputs are untouched, and the story clock is not (the dance still lands on
`Night.dance_at`).

The house desk (wave 25, docs/loom-house-desk.md §4): a desk `sound` step
reaches the router as a play on the poll (`plays=<seq>`, primed by the
first answer, dropped after 10 s by the server's clock) and routes like a
story `sound` whose `rooms:` is the play's `to`, with its `gain` on top; a
`say` step is an announcement (the chime unless `chime: false`) to its own
`to`. Each play and each server test is acked to `/api/mod/audio/report`
as soon as it is handled, with its length in ms, so the desk knows when the
step ends; the health goes there every `health_s` too, with every file in
`sounds_dir` and its length. An older server (no plays, a 404 on the
report) is logged once and otherwise ignored: routing never depends on it.

The house mixer (wave 40, docs/loom-w40-contract.md C3): every answer
carries the event's live mix (`mix {seq, levels}`); when its seq moves the
router lays it out per strip and input per output (`mix.mix_gains`) and the
mixer ramps to it, on top of the speakers' install trims. The mix is cached
beside audio.json (`mix.json`), so a router started offline keeps the last
balance. The long poll passes `mix=<seq>`, `music=<seq>` and `watch=0|1`
(each list's first answer primes its cursor). `music` entries are the
mixer's transport, one-shot and dropped after 10 s by the server's `now`,
acted on in press order with the stops and plays: `next` (one playlist's
bed or all), `scene` and `stop` (by hand: held against the story's
catch-ups until the next live music cue), `story` (let go of the hand: the
catch-up now). While `mixWatch` is true (or the last meters answer said
`watch: true`) the router posts its live meters every 0.25 s to
`/api/mod/audio/meters` (the outputs, the inputs, the sources, each strip's
peak per output, and the soundtrack's status); `watch: false` stops it, a
404 (an older server) stops it for good.

The footsteps (wave 49, `footsteps.py`, docs/loom-w49-contract.md C4): the
server decides which speakers carry each program walking in the games, and
how loud, and streams that as `walkers` frames (`GET /api/mod/audio/walkers`,
on every change, every 2 s while anyone walks). The router plays the steps
itself on a clock of its own (`_walkers_clock`, on this thread, never the
audio callback), so nothing crosses the wire per step. They are sfx-bus
voices on the mix's `steps` strip, and need `play_sounds`. A 404 (an older
server) is logged once and the loop stops until a restart.

Survives the uplink: the last audio.json, house.json and mix are kept in
`cache_dir`, so a restart with the internet down still routes; sounds are
local files; MQTT (`show/announce`, `show/chime`, `show/audio/test`,
`show/audio/stop`, `show/audio/play`) works on the LAN alone.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import numpy as np

from ..alexa.config import AlexaConfig
from ..alexa.module import MAX_TEXT, Announcement, Announcer, parse_payload, try_lock
from ..alexa.player import PlaybackError, decode, resample
from ..localvoice import renderer, speaker
from ..modapi import ModApiError, ModClient, run_stream
from ..module import ConfigError, Context
from ..show.config import MqttConfig
from ..show.directives import parse_directive, unquote
from .config import AudioConfig, parse_audio_section
from .engine import Engine, device_name, enable_host_api, layout_problem, probe, with_host_api
from .footsteps import WALKERS_TICK_S, FootstepBank, StepRig, Walkers
from .mix import MixGains, mix_gains, mix_levels_of
from .mixer import Mixer, SidechainSource, lin_to_db
from .mp3len import length_problem as mp3_length_problem
from .routing import (
    EVERYWHERE,
    AudioDoc,
    AudioDocError,
    Resolved,
    output_gains,
    output_trims,
    parse_audio,
    fold,
    resolve_targets,
    sidechain_sources,
    speaker_layout,
    split_targets,
)
from .sounds import EXTENSIONS, SoundBank, identify_label, identify_tone, placeholders_in, sound_lengths
from .soundtrack import OFF, Director, scene_of_cue
from .tap import Tap, TapConfig, find_device
from .tidal import Tidal

log = logging.getLogger("stagehand.audio")

HEALTH_TOPIC = "health/audio"
STATS_TOPIC = "health/audio/stats"
#: The story's own chime: an announcing router rings it (merged into a fresh
#: announcement); otherwise the `alexa` player does, over MQTT.
CHIME_SOUND = "announce_chime"
#: The lifecycle kinds that restart the story: every sound fades out.
RESTART_KINDS = ("reset", "reload", "golive", "ended")
#: After a story restart the soundtrack catches up this long later (the
#: server has replayed the story's opening by then).
MUSIC_CATCH_UP_DELAY_S = 2.0
#: The soundtrack's clock: how often the director looks at its beds.
MUSIC_TICK_S = 0.1
#: How long a story restart's fade-out takes (every sound and bed).
RESTART_FADE_S = 1.0
#: Stop house sounds' fade (every sound and bed).
STOP_FADE_S = 0.3
HOUSE_REFRESH_S = 300.0
#: A stop older than this (by the server's clock) is never acted on: a
#: router that boots, or reconnects, well after a press stays quiet.
STOP_STALE_S = 10.0
#: A desk play older than this (by the server's clock) is never played
#: (wave 25 §4): the desk has given up on it (`DESK_ACK_MS`) by then.
PLAY_STALE_S = 10.0
#: How long a play's (at, seq) key is remembered (the server keeps 60 s).
PLAY_MEMORY_MS = 120_000
#: The router's report to the house desk (wave 25 §4): acks + the health.
REPORT_PATH = "/api/mod/audio/report"
#: The desk's gain range (dB), `DESK_GAIN_MIN` / `DESK_GAIN_MAX`.
GAIN_MIN_DB, GAIN_MAX_DB = -60.0, 12.0
#: (wave 40) The live meters' route, and how often they go while a panel
#: watches (`MIX_METERS_EVERY_MS`).
METERS_PATH = "/api/mod/audio/meters"
METERS_EVERY_S = 0.25
#: The soundtrack's status in the meters is read at most this often (it
#: lists every playlist's folder).
MUSIC_STATUS_EVERY_S = 1.0
#: A music command older than this (by the server's clock) is dropped.
MUSIC_STALE_S = 10.0
#: The mix in force, kept beside audio.json in `cache_dir`.
MIX_CACHE = "mix.json"
#: (wave 49) The stream of who is walking in the games.
WALKERS_PATH = "/api/mod/audio/walkers"


def play_gain(value: Any) -> float:
    """A play's `gain` (dB) → a float in the desk's range; anything else is 0."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    return max(GAIN_MIN_DB, min(GAIN_MAX_DB, float(value)))


def play_to(value: Any) -> list[str] | None:
    """A play's `to`: a target name or a list of them → the names, or None."""
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return None
    out = [t.strip() for t in value if isinstance(t, str) and t.strip()]
    return out or None


@dataclass(frozen=True)
class HouseSay:
    """A desk `say` play (wave 25), queued with the announcements: spoken on
    `to` (None: `announce.to`), acked to the server under `seq`."""

    text: str
    chime: bool = True
    to: tuple[str, ...] | None = None
    seq: int | None = None


@dataclass
class Speaking:
    """The desk say playing now: what MixerOutput adds up for its ack."""

    item: HouseSay
    #: The chime is still to come through MixerOutput before the voice.
    chime_pending: bool
    ms: float = 0.0
    acked: bool = False
    failure: str | None = None


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


def _camel_music(music: Any) -> dict[str, Any] | None:
    """The health's `music` in the report's names (`pos_s` → `posS`,
    `dur_s` → `durS`; wave 40's `scenes`, `hand`, `playlists` when present)."""
    if not isinstance(music, dict):
        return None
    beds = []
    for b in music.get("beds") or []:
        row = {"playlist": b["playlist"], "speakers": list(b["speakers"]), "track": b["track"], "posS": b["pos_s"]}
        if b.get("dur_s") is not None:
            row["durS"] = b["dur_s"]
        beds.append(row)
    out: dict[str, Any] = {"scene": music.get("scene"), "beds": beds, "missing": list(music.get("missing") or [])}
    if isinstance(music.get("scenes"), list):
        out["scenes"] = list(music["scenes"])
    if isinstance(music.get("hand"), bool):
        out["hand"] = music["hand"]
    if isinstance(music.get("playlists"), list):
        out["playlists"] = [{"name": p["name"], "tracks": p["tracks"], "loop": p["loop"]} for p in music["playlists"]]
    return out


def mix_wire(levels: dict[str, tuple[float, bool]]) -> dict[str, dict[str, Any]]:
    """Parsed levels → the wire's `{key: {db, mute}}` (the cache, the stats)."""
    return {k: {"db": db, "mute": mute} for k, (db, mute) in levels.items()}


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
        now = r.speaking
        if r.announce_cut():
            # Stopped (stop + announcements): return as if played. Raising
            # would send the Announcer to its `say -a` fallback, which would
            # speak around the router.
            log.info("announcement cut (stop)")
            if now is not None:
                now.failure = now.failure or "closed"
            return
        mixer = r.mixer
        if mixer is None or not r.engine_running():
            if now is not None:
                now.failure = now.failure or "closed"
            raise PlaybackError("the audio stream is closed")
        targets = r.speaking_targets()
        res = r.resolve(targets)
        if not res.outputs:
            if now is not None:
                now.failure = now.failure or "nowhere"
            raise PlaybackError(f"announce.to {list(targets)} reaches no wired speaker")
        data = resample(samples, rate, mixer.rate)
        if now is not None:
            # A desk say: the chime, then the voice. Its ack goes out as the
            # voice starts, with chime + voice, so the desk's step ends then.
            now.ms += len(data) * 1000 / mixer.rate
            if now.chime_pending:
                now.chime_pending = False
            elif not now.acked:
                now.acked = True
                r.ack("play", now.item.seq, "played", now.ms)
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
        render_say=None,
        speak_direct=None,
        decode=None,
        music_streams=None,
        music_rng=None,
        tap_stream_factory=None,
        tap_query=None,
        tidal=None,
    ) -> None:
        self.cfg = cfg
        self._query = query
        self._stream_factory = stream_factory
        # The tap's capture stream and device list (wave 46): fakes in the tests.
        self._tap_stream_factory = tap_stream_factory
        self._tap_query = tap_query
        # The machine's own voice (`say` on the Mac, SAPI on Windows: cfg.voice_engine).
        self.render_say = render_say or renderer(cfg.voice_engine)
        self.speak_direct = speak_direct or speaker(cfg.voice_engine)
        self._decode = decode
        late = enable_host_api(cfg.host_api)
        if late is not None:
            log.error("%s", late)
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
        #: The stops (wave 18b, Q7), cursored like the tests: the newest seen
        #: (server epoch ms), the list's seq cursor, primed by the first answer.
        self.stop_at = -1.0
        self.stop_seq = 0
        self._stops_primed = False
        self.stops_done = 0
        #: The desk's plays (wave 25 §4), cursored like the stops: the
        #: list's seq cursor, primed by the first answer; every (at, seq)
        #: handled is remembered so each play is played exactly once.
        self.play_seq = 0
        self._plays_primed = False
        self._plays_seen: set[tuple[float, int]] = set()
        self.plays_done = 0
        #: The desk say playing now, and where it is spoken (None: announce.to).
        self.speaking: Speaking | None = None
        self._speaking_to: tuple[str, ...] | None = None
        #: The server link the report goes through (set by `run` / the poll).
        self._mod: Any = None
        #: An older server answered 404 to the report: logged once.
        self._report_missing = False
        self._report_warned = 0.0
        self._background: set[asyncio.Future] = set()
        #: `stop + announcements`: the epoch bumps, so the line playing now
        #: is cut (its chime and its voice alike) and every line queued
        #: before the stop (stamped at `enqueue`) is skipped. A line queued
        #: after it plays at once.
        self._announce_epoch = 0
        self._playing_epoch = 0
        #: Bumped by every stop: a speaker test started before it never
        #: plays its spoken label (the tone fades with the test bus).
        self._test_epoch = 0
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
        #: The soundtrack's director (wave 38, C3), when `soundtrack:` is set.
        #: The TIDAL app (wave 52): a fake in the tests.
        self.tidal: Any = tidal if tidal is not None else (Tidal(cfg.tidal) if cfg.tidal is not None and cfg.soundtrack is not None else None)
        self.music: Director | None = Director(cfg.soundtrack, stream_factory=music_streams, rng=music_rng, live=self.tidal) if cfg.soundtrack is not None else None
        #: Bumped by every live scene (a feed cue, MQTT): a catch-up that read
        #: the state while one landed plays nothing (the live one wins).
        self._music_live = 0
        #: The scene in force was chosen by hand over MQTT (`stagehand music
        #: stop | scene`, C3's rank 2): a feed-reconnect catch-up (rank 3)
        #: leaves it be. The next live cue, or a story restart, clears it.
        self._music_hand = False
        self._music_catch_up: asyncio.Future | None = None
        #: The house mix (wave 40): its levels (key → (db, mute)) and the
        #: server's seq (None: none seen yet, an older server).
        self.mix_levels: dict[str, tuple[float, bool]] = {}
        self.mix_seq: int | None = None
        #: The music commands (wave 40), cursored like the plays.
        self.music_seq = 0
        self._music_primed = False
        self._music_seen: set[tuple[float, int]] = set()
        self.music_done = 0
        #: A mixer panel watches: the GET's `mixWatch`, and the last meters
        #: answer's `watch`. Either sends the meters (`_meters_loop`).
        self.mix_watch = False
        self._meters_watch = False
        #: The server has no meters route (404): never posted again.
        self._meters_gone = False
        self._meters_warned = 0.0
        self.meters_sent = 0
        self._music_status: tuple[float, dict[str, Any] | None] | None = None
        #: The footsteps (wave 49): who walks, and the takes at the stream's
        #: rate (built when the first walker comes, off this thread).
        self.walkers = Walkers(self._step_rig)
        self.steps: FootstepBank | None = None

    # -- describe / check ----------------------------------------------------

    def describe(self) -> list[str]:
        cfg = self.cfg
        doc = self._local_doc()
        dev = cfg.device or (doc.device if doc else "the audio.json device")
        return [
            f"device   : {dev}" + (f" on {cfg.host_api.upper()}" if cfg.host_api else "") + (f" ({doc.inputs} in / {doc.outputs} out)" if doc else "") + (" duplex" if cfg.passthrough else " output-only"),
            f"sounds   : {'the router plays `sound X` (OSC sound cues skipped)' if cfg.play_sounds else 'not here: play_sounds is false (another cue player)'} — {cfg.sounds_dir}",
            f"announce : {'the router (chime + ' + cfg.voice_engine + ' ' + (cfg.say_voice or 'default') + ')' if cfg.announce else 'not here (the alexa player)'}",
            f"matrix   : {'on' if cfg.passthrough else 'off'}" + (f", {len(doc.routes)} route(s)" if doc else ""),
            *(
                [f"tap      : {cfg.tap.device!r}" + (f" on {cfg.tap.host_api.upper()}" if cfg.tap.host_api else "") + f" summed into input {cfg.tap.ch} ({cfg.tap.gain_db:+.0f} dB)"]
                if cfg.tap is not None
                else []
            ),
            f"config   : the server's audio.json (long-poll {cfg.poll_wait:.0f}s)" + (f"; local {cfg.config_file}" if cfg.config_file else "") + f"; cache {cfg.cache_dir}",
            f"desk     : plays the house desk's sound / say steps; acks + health (every {cfg.health_s:g}s) to {REPORT_PATH}",
            f"mixer    : the server's live mix (cached in {MIX_CACHE}); music commands; meters every {METERS_EVERY_S:g}s to {METERS_PATH} while a panel watches",
            f"steps    : {f'the walkers on {WALKERS_PATH}, synthesised here; footstep_<surface>_<n>.wav in sounds_dir outranks a take' if cfg.play_sounds else 'not here: play_sounds is false'}",
            f"mqtt     : {f'{cfg.mqtt.host}:{cfg.mqtt.port} ← {cfg.test_topic}, {cfg.stop_topic}, {cfg.play_topic}' + (f', {cfg.music_topic}' if cfg.soundtrack is not None else '') + (f', {cfg.announce_topic}, {cfg.chime_topic}' if cfg.announce else '') if cfg.mqtt else '— (tests, stops + announcements from the server only)'}",
            f"levels   : master {cfg.master_db:+.0f} dB, limit {cfg.limit_db:+.0f} dBFS",
            "priority : "
            + ("; ".join(f"{name} " + ", ".join(f"{bus} {db:+.0f}" for bus, db in buses.items()) for name, buses in cfg.priority.items()) or "nothing ducks")
            + "; takeover silences the music"
            + (f" (announce held {cfg.duck_hold_s:g}s per alexa announcement)" if not cfg.announce and cfg.duck_hold_s > 0 else "")
            + (f"; never ducked: {', '.join(cfg.no_duck)}" if cfg.no_duck else ""),
            f"sidechain: {'the inputs with a role, ' if cfg.passthrough else 'off (output-only stream: passthrough is false) — '}"
            f"over {cfg.sidechain.threshold_db:+.0f} dBFS"
            + "".join(f", {role} over {db:+.0f} dBFS" for role, db in cfg.sidechain.roles)
            + f", attack {cfg.sidechain.attack_s:g}s, hold {cfg.sidechain.hold_s:g}s, release {cfg.sidechain.release_s:g}s",
            *(
                cfg.soundtrack.describe()
                + [f"music    : scenes from `cue music_<scene>`, {cfg.music_topic if cfg.mqtt else 'no broker'}, the catch-up (night.music); tracks (takeover): {', '.join(cfg.soundtrack.tracks) or 'none'}"]
                if cfg.soundtrack is not None
                else ["music    : — (no soundtrack:)"]
            ),
        ]

    @staticmethod
    def _parse_local(raw: Any) -> AudioDoc | None:
        if raw is None:
            return None
        try:
            return parse_audio(raw.get("audio", raw) if isinstance(raw, dict) else raw)
        except AudioDocError:
            return None

    def _local_doc(self) -> AudioDoc | None:
        """The audio.json the router would boot on: the cache, else
        `config_file`, else the server's answer to `check`."""
        for raw in (self._read_json(self._cache_path("audio.json")), self._read_json(self.cfg.config_file), self._check_answer):
            doc = self._parse_local(raw)
            if doc is not None:
                return doc
        return None

    def _stale_cache(self) -> tuple[AudioDoc, AudioDoc] | None:
        """(cache, config_file) when the cached audio.json carries no
        `device.expect` but `config_file` does: an older router's cache (the
        wave 17 MOTU, 16 / 16) that would hide a moved layout from `check`."""
        cached = self._parse_local(self._read_json(self._cache_path("audio.json")))
        local = self._parse_local(self._read_json(self.cfg.config_file))
        if cached is None or local is None or cached.expect is not None or local.expect is None:
            return None
        return cached, local

    def _check_doc(self) -> AudioDoc | None:
        """`check`'s audio.json: the boot one, unless the cache is stale
        (`_stale_cache`), when `config_file`'s layout check wins."""
        stale = self._stale_cache()
        return stale[1] if stale is not None else self._local_doc()

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
        """`stagehand check`: the device against the local / cached audio.json
        (and the tap's capture device, wave 46)."""
        return self._preflight_device() + self._preflight_tap() + self._preflight_tidal()

    def _preflight_tidal(self) -> list[str]:
        cfg = self.cfg.tidal
        if cfg is None or self.cfg.soundtrack is None:
            return []
        try:
            if self._tap_query is not None:
                devices, apis = self._tap_query()
            else:
                import sounddevice as sd

                devices, apis = list(sd.query_devices()), list(sd.query_hostapis())
            index = find_device(cfg, devices, apis)
        except Exception as err:  # noqa: BLE001 — ValueError (none / several), no PortAudio
            return [f"audio: {err}".replace("audio.tap", "audio.tidal")]
        print(f"audio tidal: {devices[index]['name']} → the music bus")
        return []

    def _preflight_tap(self) -> list[str]:
        tap = self.cfg.tap
        if tap is None:
            return []
        try:
            if self._tap_query is not None:
                devices, apis = self._tap_query()
            else:
                import sounddevice as sd

                devices, apis = list(sd.query_devices()), list(sd.query_hostapis())
            index = find_device(tap, devices, apis)
        except Exception as err:  # noqa: BLE001 — ValueError (none / several), no PortAudio
            return [f"audio: {err}"]
        print(f"audio tap: {devices[index]['name']} → input {tap.ch}")
        return []

    def _preflight_device(self) -> list[str]:
        doc = self._check_doc()
        if doc is None:
            name = with_host_api(device_name(self.cfg.device), self.cfg.host_api)
            info, problems = probe(name, 0, 1, self._query)
            if info is not None:
                log.info("audio device %s: %d in / %d out @ %d Hz (no local audio.json to check against)", info.name, info.inputs, info.outputs, info.rate)
            return [f"audio: {p}" for p in problems]
        info, problems = probe(self._device(doc), doc.inputs if self.cfg.passthrough else 0, doc.outputs, self._query, expect=doc.expect)
        if info is not None:
            expect = f", the device must report {doc.expect[0]} / {doc.expect[1]}" if doc.expect is not None else ""
            print(f"audio    : {info.name} — {info.inputs} in / {info.outputs} out @ {info.rate} Hz; audio.json wants {doc.inputs} / {doc.outputs}{expect}")
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
                # The pre-show gate (wave 18b): a generated placeholder still plays.
                held = placeholders_in(self.cfg.sounds_dir)
                if held:
                    out.append(f"audio: {len(held)} placeholder sound(s) still in sounds_dir — replace them with the real files: {', '.join(held)}")
                # Every file in the folder, not just the cues: `sound X` plays any name.
                names |= {p.stem for p in Path(self.cfg.sounds_dir).iterdir() if p.suffix.lower() in EXTENSIONS}
                for f in sorted(Path(self.cfg.sounds_dir).iterdir()):
                    problem = mp3_length_problem(f) if f.suffix.lower() == ".mp3" else None
                    if problem is not None:
                        out.append(f"audio: {problem}")
                off = bank.off_rate(names)
                if off:
                    listed = ", ".join(f"{n} ({r} Hz)" for n, r in off)
                    out.append(f"audio: {len(off)} sound file(s) not at the device's {rate} Hz — resampled at load, but convert them offline: {listed}")
        if sys.platform == "win32" and self.cfg.host_api is None:
            out.append(
                "audio: no host_api on Windows — every device is listed once per host API, so the name may match several, "
                "and only ASIO opens the MOTU as one multichannel device: set audio.host_api: asio"
            )
        if self.cfg.announce:
            # The voice this machine speaks with (`say` on the Mac, SAPI on
            # Windows): missing, the announcements are the chime alone.
            from .. import localvoice

            why = localvoice.problem(self.cfg.voice_engine)
            if why is not None:
                out.append(f"audio: announcements will be the chime alone — {why}")
            else:
                note = localvoice.voice_warning(self.cfg.voice_engine, self.cfg.say_voice)
                if note is not None:
                    out.append(f"audio: say_voice — {note}")
        if doc is not None:
            out.extend(f"audio: {w}" for w in self.priority_warnings(doc))
        out.extend(f"audio: {w}" for w in self.music_warnings(doc))
        stale = self._stale_cache()
        if stale is not None:
            cached, local = stale
            out.append(
                f"audio: the cached audio.json ({cached.device}, {cached.inputs} / {cached.outputs}, no device.expect) is older than "
                f"config_file ({local.device}, {local.inputs} / {local.outputs}, the device must report {local.expect[0]} / {local.expect[1]}) — "
                f"checked against config_file; the router boots on the cache until the server answers (delete {self._cache_path('audio.json')} if it is stale)"
            )
        if self._check_problem is not None:
            out.append(self._check_problem)
        elif doc is None:
            out.append("audio: no local audio.json (config_file / cache) — the router waits for the server")
        elif self._check_answer is not None:
            out.append("audio: checked against the server's audio.json (nothing cached on this Mac yet)")
        return out

    def priority_warnings(self, doc: AudioDoc) -> list[str]:
        """The inputs' roles against the YAML's `priority` (C1.1): a refused
        role, a reach that reaches nothing, a role no `priority` entry
        names (it ducks nothing), a sidechain on an output-only stream."""
        out = list(doc.warnings)
        specs, notes = sidechain_sources(doc, self.house)
        out.extend(notes)
        for role in sorted({s.name for s in specs} - set(self.cfg.priority)):
            out.append(f"input role {role!r} has no audio.priority entry — it ducks nothing")
        if specs and not self.cfg.passthrough:
            out.append(f"input roles {', '.join(sorted({s.name for s in specs}))} need a duplex stream (passthrough: true) — nothing is metered, nothing ducks under them")
        return out

    def _local_house(self) -> Any:
        """The house map `check` reads: the one in force, the cache, else `house_file`."""
        if isinstance(self.house, dict):
            return self.house
        for raw in (self._read_json(self._cache_path("house.json")), self._read_json(self.cfg.house_file)):
            if isinstance(raw, dict):
                return raw.get("house", raw) if isinstance(raw.get("house"), dict) else raw
        return None

    def music_warnings(self, doc: AudioDoc | None) -> list[str]:
        """C3's check: every playlist with no file, every scene entry that
        reaches no speaker, every track with no file in sounds_dir."""
        st = self.cfg.soundtrack
        if st is None:
            return []
        out = st.warnings(doc, self._local_house(), live=self.cfg.tidal is not None)
        if self.cfg.play_sounds and Path(self.cfg.sounds_dir).is_dir():  # no folder: the sounds_dir warning says it
            bank = SoundBank(self.cfg.sounds_dir, self.cfg.rate or 48000)
            missing = sorted(n for n in st.tracks if bank.find(n) is None)
            if missing:
                out.append(f"music: no file for the track(s) {', '.join(missing)} in {self.cfg.sounds_dir}")
        # A VBR MP3 with no length header plays only libsndfile's guess.
        seen: set[str] = set()
        for p in st.playlists.values():
            for path in p.tracks():
                if path not in seen:
                    seen.add(path)
                    problem = mp3_length_problem(path)
                    if problem is not None:
                        out.append(f"music: playlist {p.name}: {problem}")
        return out

    # -- config ----------------------------------------------------------------

    def _device_rate(self) -> int | None:
        doc = self._local_doc()
        info, _ = probe(self._device(doc), 0, 1, self._query)
        return info.rate if info is not None else None

    def _device(self, doc: AudioDoc | None) -> str | None:
        """The device query: the YAML's `device:` over audio.json's name,
        narrowed to `host_api` (ASIO on the Windows house PC)."""
        name = device_name(self.cfg.device) or (device_name(doc.device) if doc else None)
        return with_host_api(name, self.cfg.host_api)

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
        """At boot: the cached server answer, else `config_file` (and the
        cached mix: a router started offline keeps the last balance)."""
        house = self._read_json(self._cache_path("house.json")) or self._read_json(self.cfg.house_file)
        if isinstance(house, dict):
            self.house = house
        self.apply_mix(self._read_json(self._cache_path(MIX_CACHE)), persist=False)
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
        for note in doc.warnings:
            log.warning("audio.json: %s", note)
        self.ensure_engine()
        if self.mixer is not None:
            self._wire(self.mixer, doc)
        return True

    # -- the house mix (wave 40) ---------------------------------------------------

    def apply_mix(self, raw: Any, *, persist: bool = True) -> bool:
        """An answer's `mix {seq, levels}` (or the cached one). → True when
        it moved (its seq differs from the one in force): the levels are
        read as `mixLevelsOf` reads them, cached, and the mixer ramps to
        them. A mix with no seq (an older server's answer) is ignored."""
        if not isinstance(raw, dict):
            return False
        seq = raw.get("seq")
        if isinstance(seq, bool) or not isinstance(seq, int):
            return False
        if seq == self.mix_seq:
            return False
        self.mix_levels = mix_levels_of(raw.get("levels"))
        self.mix_seq = seq
        moved = self.mix_summary()
        log.info("🎚 house mix %d: %s", seq, ", ".join(moved) if moved else "every level at unity")
        if persist:
            self._write_json(MIX_CACHE, {"seq": seq, "levels": mix_wire(self.mix_levels)})
        mixer = self.mixer
        if mixer is not None and self.doc is not None:
            mixer.set_mix(self.mix_gains(self.doc, mixer))
        return True

    def mix_gains(self, doc: AudioDoc, mixer: Mixer) -> MixGains | None:
        """The mix in force on `doc`'s speakers, for `Mixer.set_mix` (None: unity)."""
        return mix_gains(self.mix_levels, doc, mixer.n_out) if self.mix_levels else None

    def mix_summary(self) -> list[str]:
        """The levels not at unity, one short phrase each (`master −3 dB`)."""
        return [f"{key} " + ("muted" if mute else f"{db:+g} dB") for key, (db, mute) in sorted(self.mix_levels.items())]

    @staticmethod
    def _routes(doc: AudioDoc) -> dict[tuple[int, int], float]:
        out: dict[tuple[int, int], float] = {}
        for r in doc.routes:
            for o in r.out:
                out[(r.inp, o)] = r.gain_db
        return out

    def _wire(self, mixer: Mixer, doc: AudioDoc) -> None:
        """Everything the mixer takes from audio.json (+ house.json): the
        matrix, the speakers' trims, the sidechain sources and where an
        external announcement is heard."""
        mixer.set_routes(self._routes(doc))
        mixer.set_trim(output_trims(doc))
        specs, notes = sidechain_sources(doc, self.house)
        for note in notes:
            if note not in self._unknown_logged:
                self._unknown_logged.add(note)
                log.warning("audio.json: %s", note)
        mixer.set_sources([SidechainSource(s.name, s.inputs, s.reach) for s in specs])
        mixer.set_announce_reach(resolve_targets(doc, self.house, list(doc.announce_to)).outputs)
        # The mix follows the speakers and the inputs too.
        mixer.set_mix(self.mix_gains(doc, mixer))
        if self.music is not None:
            # The beds follow the speakers: a moved speaker moves its bed.
            self.music.attach(mixer, doc, self.house)

    def set_house(self, house: Any, persist: bool = True) -> None:
        if isinstance(house, dict):
            self.house = house
            self._unknown_logged.clear()
            if persist:
                self._write_json("house.json", house)
            # A reach or announce.to may name a room or a LOCATION.
            if self.mixer is not None and self.doc is not None:
                self._wire(self.mixer, self.doc)

    # -- the stream ------------------------------------------------------------

    @property
    def mixer(self) -> Mixer | None:
        return self.engine.mixer if self.engine is not None else None

    def engine_running(self) -> bool:
        return self.engine is not None and self.engine.running

    def _tap_factory(self, cfg: TapConfig | None):
        if cfg is None:
            return None
        return lambda rate: Tap(cfg, rate, factory=self._tap_stream_factory, query=self._tap_query)

    def tap_state(self) -> str | None:
        engine = self.engine
        if self.cfg.tap is None or engine is None:
            return None
        if engine.tap is not None:
            return engine.tap.stats()
        return f"{self.cfg.tap.device} NOT OPEN ({engine.tap_error or 'no stream'})"

    def ensure_engine(self) -> bool:
        """Open the stream for the current config (reopen on a device change)."""
        doc = self.doc
        if doc is None:
            return False
        cfg = self.cfg
        signature = (self._device(doc), doc.inputs, doc.outputs, cfg.rate or doc.rate, cfg.passthrough, cfg.tap)
        if signature[0] is None and not self._blank_device_logged:
            self._blank_device_logged = True
            log.warning("audio.json names no device (device.name is blank) and the YAML sets no `device:` — using the default output")
        if self.engine is not None:
            self.engine.expect = doc.expect
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
                mixer_args={"master_db": cfg.master_db, "limit_db": cfg.limit_db, "sidechain": cfg.sidechain, "priority": cfg.priority},
                query=self._query,
                stream_factory=self._stream_factory,
                expect=doc.expect,
                tap=self._tap_factory(cfg.tap),
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
        self._wire(mixer, doc)
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

    def expand_targets(self, to: list[str] | tuple[str, ...]) -> list[str]:
        """A desk play's `to` → target names, each read like a story's
        `rooms:` (a whole name stays whole; `desktop start-bar` splits)."""
        assert self.doc is not None
        out: list[str] = []
        for t in to:
            for name in split_targets(t, self.doc, self.house):
                if name not in out:
                    out.append(name)
        return out

    def targets_for(self, name: str, rooms: str | None = None, setting: str | None = None, to: list[str] | None = None) -> tuple[list[str], float, str]:
        """→ (target names, cue gain dB, why) for `sound <name>`. `to` (a
        desk play's) stands where the story's `rooms:` would."""
        assert self.doc is not None
        cue = self.doc.cue(name)
        gain = cue.gain_db if cue is not None else 0.0
        if to:
            return self.expand_targets(to), gain, "desk"
        if rooms:
            return split_targets(rooms, self.doc, self.house), gain, "story"
        if cue is not None and cue.to:
            return list(cue.to), gain, "cue"
        if setting:
            return [setting], gain, "setting"
        return [EVERYWHERE], gain, "everywhere"

    def play_sound(self, name: str, rooms: str | None = None, setting: str | None = None, *, gain_db: float = 0.0, to: list[str] | None = None) -> str:
        """One `sound X`. → `played`, `closed`, `nowhere` or `no-file` (for logs + tests)."""
        return self.play_sound_ms(name, rooms, setting, gain_db=gain_db, to=to)[0]

    def play_sound_ms(self, name: str, rooms: str | None = None, setting: str | None = None, *, gain_db: float = 0.0, to: list[str] | None = None) -> tuple[str, float | None]:
        """`play_sound` and the file's length in ms when it played. `gain_db`
        (a desk play's or a hand play's) is added to the cue's gain."""
        if self.doc is None or self.mixer is None or not self.engine_running() or self.bank is None:
            self.skipped += 1
            log.warning("sound %s: the audio stream is closed — skipped", name)
            return "closed", None
        targets, gain, why = self.targets_for(name, rooms, setting, to)
        res = self.resolve(targets)
        if not res.outputs:
            self.skipped += 1
            log.warning("sound %s → %s (%s) reaches no wired speaker — skipped", name, targets, why)
            return "nowhere", None
        track = self.music.st.track(name) if self.music is not None else None
        if track is not None:
            return self._play_track(name, track.takeover, res, gain + gain_db, targets, why)
        data = self.bank.load(name)
        if data is None:
            self.skipped += 1
            return "no-file", None
        self.mixer.play(
            data,
            output_gains(self.doc, res.speakers, gain + gain_db),
            bus="sfx",
            tag=name,
            duck=self.ducks(name),
            layout=speaker_layout(self.doc, res.speakers),
            # The mix's strip: the chime is an announcement's, every other sound sfx.
            strip="announce" if fold(name) == fold(CHIME_SOUND) else "sfx",
        )
        self.played += 1
        log.info(
            "sound %s → %s (%s: %s) out %s%s", name, ",".join(res.speakers), why, ",".join(targets), ",".join(map(str, res.outputs)), f" {gain_db:+g} dB" if gain_db else ""
        )
        return "played", len(data) * 1000 / self.mixer.rate

    def _play_track(self, name: str, takeover: bool, res: Resolved, gain_db: float, targets: list[str], why: str) -> tuple[str, float | None]:
        """A soundtrack track (C3 `tracks:`): streamed from sounds_dir, never
        decoded whole, on the sfx bus as a takeover. Its ms (a desk ack) is
        the header's length (an MP3's is an estimate)."""
        assert self.bank is not None and self.mixer is not None and self.doc is not None
        stream = self.bank.stream(name)
        if stream is None:
            self.skipped += 1
            return "no-file", None
        self.mixer.play(
            stream,
            output_gains(self.doc, res.speakers, gain_db),
            bus="sfx",
            tag=name,
            duck=self.ducks(name),
            takeover=takeover,
            layout=speaker_layout(self.doc, res.speakers),
            strip="tracks",
        )
        self.played += 1
        log.info("sound %s → %s (%s: %s) out %s — a track%s", name, ",".join(res.speakers), why, ",".join(targets), ",".join(map(str, res.outputs)), " (takes the music over)" if takeover else "")
        return "played", (stream.length * 1000 / self.mixer.rate if stream.length else None)

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
        if verb == "cue":
            scene = scene_of_cue(event.get("args"))
            if scene is None or self.music is None:
                return None
            return self.music_scene(scene, "cue") and "music" or None
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

    # -- stop all house sounds (wave 18b, Q7) ------------------------------------

    def announce_cut(self) -> bool:
        """The announcement in hand was stopped (or a stop just landed)."""
        return self._playing_epoch != self._announce_epoch

    def stop_all(self, announce: bool = False, by: str = "") -> bool:
        """Fade out every story sound (0.3 s) and any speaker test; with
        `announce`, also cut the announcement playing now and empty the
        queue. One-shot: the next `sound X` plays as usual. The live inputs
        (the matrix) are never touched. → False when the stream is closed
        (nothing was playing to stop)."""
        mixer = self.mixer
        log.info("🔇 audio: %s stopped the house sounds%s", by or "someone", " and the announcements" if announce else "")
        self.walkers.clear()  # the next step would land in the fade; a new frame brings them back
        if mixer is not None:
            mixer.stop(bus="sfx", fade_s=STOP_FADE_S)
            mixer.stop(bus="test", fade_s=STOP_FADE_S)
        if self.music is not None:
            self.music.stop(STOP_FADE_S, "stop house sounds")
        self._test_epoch += 1
        if announce:
            self._announce_epoch += 1
            if mixer is not None:
                mixer.stop(bus="announce", fade_s=0.1)
            dropped = 0
            while self.announcements is not None and not self.announcements.empty():
                entry = self.announcements.get_nowait()
                item = entry[1] if isinstance(entry, tuple) and len(entry) == 2 else entry
                if isinstance(item, HouseSay):
                    self.ack("play", item.seq, "closed")
                dropped += 1
            if dropped:
                log.info("🔇 audio: %d queued announcement(s) dropped", dropped)
        self.stops_done += 1
        return mixer is not None

    def new_stops(self, stops: Any, now: Any = None) -> list[dict]:
        """The stops in a poll answer not yet acted on (as `new_tests`: the
        first answer only primes; `seq` restarts with the server, `at` never
        goes back). A stop older than `STOP_STALE_S` by the server's `now`
        is dropped, so a late router never cuts a song started since."""
        rows = [t for t in stops if isinstance(t, dict) and isinstance(t.get("seq"), int)] if isinstance(stops, list) else []
        self.stop_seq = max((t["seq"] for t in rows), default=0)
        fresh = sorted((t for t in rows if float(t.get("at") or 0) > self.stop_at), key=lambda t: float(t.get("at") or 0))
        if rows:
            self.stop_at = max(self.stop_at, max(float(t.get("at") or 0) for t in rows))
        if not self._stops_primed:
            self._stops_primed = True
            return []
        if isinstance(now, (int, float)) and not isinstance(now, bool):
            fresh = [t for t in fresh if now - float(t.get("at") or 0) <= STOP_STALE_S * 1000]
        return fresh

    def hand_play(self, doc: Any) -> str | None:
        """`show/audio/play {"name", "to"?, "gain"?}`: one sound by hand (the
        LAN's replacement for QLab's GO). `to` is a target or a list of
        them; `gain` (dB, −60…12) is added to the cue's, as a desk play's."""
        if not isinstance(doc, dict) or not isinstance(doc.get("name"), str) or not doc["name"].strip():
            return None
        to = doc.get("to")
        if isinstance(to, str):
            to = [to]
        rooms = ",".join(t for t in to if isinstance(t, str) and t.strip()) if isinstance(to, list) else ""
        return self.play_sound(doc["name"].strip(), rooms or None, gain_db=play_gain(doc.get("gain")))

    # -- the house desk's plays (wave 25 §4) -------------------------------------

    def new_plays(self, plays: Any, now: Any = None) -> list[dict]:
        """The plays in a poll answer not yet handled, oldest first. As the
        tests and stops: the first answer only primes (a restart never
        replays an old GO); `seq` restarts with the server and `at` never
        goes back, so a play is known by (at, seq). A play older than
        `PLAY_STALE_S` by the server's `now` is dropped."""
        rows = [p for p in plays if isinstance(p, dict) and isinstance(p.get("seq"), int) and not isinstance(p.get("seq"), bool)] if isinstance(plays, list) else []
        self.play_seq = max((p["seq"] for p in rows), default=0)

        def key(p: dict) -> tuple[float, int]:
            at = p.get("at")
            return (float(at) if isinstance(at, (int, float)) and not isinstance(at, bool) else 0.0, p["seq"])

        fresh = sorted((p for p in rows if key(p) not in self._plays_seen), key=key)
        self._plays_seen |= {key(p) for p in rows}
        if self._plays_seen:
            newest = max(at for at, _ in self._plays_seen)
            self._plays_seen = {k for k in self._plays_seen if k[0] >= newest - PLAY_MEMORY_MS}
        if not self._plays_primed:
            self._plays_primed = True
            return []
        if isinstance(now, (int, float)) and not isinstance(now, bool):
            stale = [p for p in fresh if now - key(p)[0] > PLAY_STALE_S * 1000]
            for p in stale:
                log.info("desk play %s is %.0fs old — dropped", p["seq"], (now - key(p)[0]) / 1000)
            fresh = [p for p in fresh if p not in stale]
        return fresh

    def serve_play(self, p: dict) -> str:
        """One desk play: a `sound` plays now and is acked at once with its
        length; a `say` joins the announcement queue (acked as its voice
        starts). → the sound's result, `queued`, or `error`."""
        seq = p.get("seq") if isinstance(p.get("seq"), int) else None
        to = play_to(p.get("to"))
        by = str(p.get("by") or "the desk")
        self.plays_done += 1
        sound = p.get("sound")
        if isinstance(sound, str) and sound.strip():
            gain = play_gain(p.get("gain"))
            log.info("desk play %s: %s plays %s%s%s", seq, by, sound.strip(), f" to {', '.join(to)}" if to else "", f" at {gain:+g} dB" if gain else "")
            result, ms = self.play_sound_ms(sound.strip(), gain_db=gain, to=to)
            self.ack("play", seq, result, ms)
            return result
        say = p.get("say")
        text = " ".join(say.split())[:MAX_TEXT] if isinstance(say, str) else ""
        if not text:
            log.warning("desk play %s: neither a sound nor a say (%r) — ignored", seq, {k: p.get(k) for k in ("sound", "say")})
            self.ack("play", seq, "error")
            return "error"
        if not self.speaks_announcements():
            log.warning("desk play %s: %s asked for a house announcement, but this router does not speak them (announce: %s)", seq, by, self.announce_state())
            self.ack("play", seq, "error")
            return "error"
        log.info("desk play %s: %s says %r%s", seq, by, text, f" to {', '.join(to)}" if to else "")
        self.enqueue(HouseSay(text=text, chime=p.get("chime") is not False, to=tuple(to) if to else None, seq=seq))
        return "queued"

    def speaking_targets(self) -> tuple[str, ...]:
        """Where the announcement in hand is spoken: a desk say's own `to`,
        else `announce.to`."""
        return self._speaking_to or self.announce_targets()

    async def _speak_play(self, item: HouseSay) -> None:
        """A desk say through the Announcer, on its own `to`; acked as the
        voice starts (MixerOutput), else here when it ends."""
        assert self.announcer is not None
        chime = item.chime and (self.doc is None or self.doc.announce_chime)
        now = Speaking(item=item, chime_pending=chime and getattr(self.announcer, "_chime", None) is not None)
        self.speaking = now
        self._speaking_to = tuple(self.expand_targets(item.to)) if item.to and self.doc is not None else None
        started = time.monotonic()
        try:
            path = await self.announcer.announce(Announcement(text=item.text, chime=chime))
        except Exception:  # noqa: BLE001 — acked as an error, and the next line plays
            log.exception("desk say %s failed", item.seq)
            path = "failed"
        finally:
            self.speaking = None
            self._speaking_to = None
        if not now.acked:
            now.acked = True
            if now.failure is not None:
                self.ack("play", item.seq, now.failure)
            elif path.startswith("say-"):
                # `say -a`: it spoke, around the mixer, and has finished now.
                self.ack("play", item.seq, "played", (time.monotonic() - started) * 1000)
            else:
                self.ack("play", item.seq, "played" if path != "failed" else "error", now.ms or None)

    # -- the report (wave 25 §4) ---------------------------------------------------

    def ack(self, kind: str, seq: Any, result: str, ms: float | None = None) -> None:
        """Post one ack (`kind` play | test) to the report, soon, from any
        thread. A play or test with no seq (MQTT's) is never acked."""
        if not isinstance(seq, int) or isinstance(seq, bool):
            return
        row: dict[str, Any] = {"seq": seq, "kind": kind, "result": result}
        if ms is not None:
            row["ms"] = int(round(ms))
        body = {"acks": [row]}
        loop = self.loop
        if loop is None or self._mod is None:
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            self._spawn(self.report(body))
        else:
            loop.call_soon_threadsafe(lambda: self._spawn(self.report(body)))

    def _spawn(self, coro) -> None:
        task = asyncio.ensure_future(coro)
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def report(self, body: dict) -> bool:
        """`POST /api/mod/audio/report {health?, acks?}`. → True when the
        server took it. An older server's 404 is logged once and otherwise
        ignored (the desk shows *no answer*); routing never waits on it."""
        mod = self._mod
        if mod is None:
            return False
        try:
            await mod.post(REPORT_PATH, body)
        except ModApiError as err:
            if err.status == 404:
                if not self._report_missing:
                    self._report_missing = True
                    log.info("the server has no %s (an older release) — the house desk sees no answers from this router; it plays on", REPORT_PATH)
                return False
            self._report_failed(err)
            return False
        except (httpx.HTTPError, OSError, ValueError) as err:
            self._report_failed(err)
            return False
        if self._report_missing:
            self._report_missing = False
            log.info("the server takes the router's report now")
        return True

    def _report_failed(self, err: Exception) -> None:
        now = time.monotonic()
        if now - self._report_warned > 60:
            self._report_warned = now
            log.warning("router report failed (%s) — the desk may show no answer", err or type(err).__name__)

    def on_lifecycle(self, doc: Any) -> None:
        kind = str(doc.get("kind", "")) if isinstance(doc, dict) else ""
        if kind not in RESTART_KINDS:
            return
        self.walkers.clear()
        if self.mixer is not None:
            log.info("lifecycle %s: every sound fades out", kind)
            self.mixer.stop(bus="sfx", fade_s=RESTART_FADE_S)
        if self.music is not None:
            self._music_hand = False  # a restart: the story's scene again
            self.music.stop(RESTART_FADE_S, f"lifecycle {kind}")
            self.schedule_music_catch_up(kind, delay=MUSIC_CATCH_UP_DELAY_S)

    # -- the soundtrack's scene (wave 38, C3) ------------------------------------------

    def music_scene(self, scene: str, why: str, *, hand: bool = False) -> bool:
        """A live scene (a feed cue, MQTT): it wins over a catch-up in flight.
        `hand` (MQTT's stop / scene) also holds it against later feed
        catch-ups; a cue (`hand=False`) hands the scene back to the story.
        → False for a scene the soundtrack does not define (logged once)."""
        if self.music is None:
            return False
        if not self.music.st.has_scene(scene):
            self.music.set_scene(scene, why)  # logs it once
            return False
        self._music_live += 1
        self._music_hand = hand
        return self.music.set_scene(scene, why)

    def on_music(self, doc: Any) -> str | None:
        """`show/audio/music`: `{"scene": name}`, `{"next": true, "playlist"?:
        name}`, `{"stop": true}`."""
        if self.music is None or not isinstance(doc, dict):
            return None
        by = str(doc.get("by") or "mqtt")
        if doc.get("stop") is True:
            return "stop" if self.music_scene(OFF, f"{by}: stop", hand=True) else None
        if doc.get("next") is True:
            playlist = doc.get("playlist") if isinstance(doc.get("playlist"), str) and doc["playlist"].strip() else None
            self.music_next(playlist.strip() if playlist else None, by)
            return "next"
        scene = doc.get("scene")
        if isinstance(scene, str) and scene.strip():
            return "scene" if self.music_scene(scene.strip(), by, hand=True) else None
        return None

    def music_next(self, playlist: str | None, by: str) -> int:
        """Skip to the next track on `playlist`'s bed (None: every bed)."""
        assert self.music is not None
        moved = self.music.next(playlist)
        log.info("🎵 soundtrack: %s skips to the next track%s (%d bed(s))", by, f" in {playlist}" if playlist else "", moved)
        return moved

    def music_status(self) -> dict[str, Any] | None:
        """The soundtrack's status (`Director.status`) + `hand`: the scene
        was picked by hand and the story's catch-ups are held."""
        if self.music is None:
            return None
        st = self.music.status()
        st["hand"] = self._music_hand
        return st

    # -- the mixer's music commands (wave 40) ----------------------------------------

    def new_music(self, entries: Any, now: Any = None) -> list[dict]:
        """The music commands in a poll answer not yet acted on, oldest
        first — as `new_plays`: the first answer primes, a command is known
        by (at, seq), one older than `MUSIC_STALE_S` by `now` is dropped."""
        rows = [e for e in entries if isinstance(e, dict) and isinstance(e.get("seq"), int) and not isinstance(e.get("seq"), bool)] if isinstance(entries, list) else []
        self.music_seq = max((e["seq"] for e in rows), default=0)

        def key(e: dict) -> tuple[float, int]:
            at = e.get("at")
            return (float(at) if isinstance(at, (int, float)) and not isinstance(at, bool) else 0.0, e["seq"])

        fresh = sorted((e for e in rows if key(e) not in self._music_seen), key=key)
        self._music_seen |= {key(e) for e in rows}
        if self._music_seen:
            newest = max(at for at, _ in self._music_seen)
            self._music_seen = {k for k in self._music_seen if k[0] >= newest - PLAY_MEMORY_MS}
        if not self._music_primed:
            self._music_primed = True
            return []
        if isinstance(now, (int, float)) and not isinstance(now, bool):
            stale = [e for e in fresh if now - key(e)[0] > MUSIC_STALE_S * 1000]
            for e in stale:
                log.info("music command %s (%s) is %.0fs old — dropped", e["seq"], e.get("action"), (now - key(e)[0]) / 1000)
            fresh = [e for e in fresh if e not in stale]
        return fresh

    def serve_music(self, e: dict) -> str | None:
        """One music command from the mixer panel (C0): `next` (`playlist`
        or every bed), `scene` and `stop` by hand (held against the story's
        catch-ups until the next live music cue), `story` (let go of the
        hand: the story's scene, now). → what was done, or None."""
        by = str(e.get("by") or "the mixer")
        action = e.get("action")
        self.music_done += 1
        if self.music is None:
            log.warning("music command %s (%s) from %s: this router has no soundtrack — ignored", e.get("seq"), action, by)
            return None
        if action == "next":
            playlist = e.get("playlist") if isinstance(e.get("playlist"), str) and e["playlist"] else None
            self.music_next(playlist, by)
            return "next"
        if action == "scene":
            scene = e.get("scene")
            if isinstance(scene, str) and scene and self.music_scene(scene, f"{by}: by hand", hand=True):
                return "scene"
            return None
        if action == "stop":
            return "stop" if self.music_scene(OFF, f"{by}: stop", hand=True) else None
        if action == "story":
            log.info("🎵 soundtrack: %s hands the music back to the story", by)
            self._music_hand = False
            self.schedule_music_catch_up("story")
            return "story"
        log.warning("music command %s: unknown action %r — ignored", e.get("seq"), action)
        return None

    def schedule_music_catch_up(self, why: str, delay: float = 0.0) -> None:
        """The catch-up, soon (a newer one replaces one still waiting)."""
        if self.music is None or self.loop is None:
            return
        if self._music_catch_up is not None and not self._music_catch_up.done():
            self._music_catch_up.cancel()

        def go() -> None:
            self._music_catch_up = asyncio.ensure_future(self.music_catch_up(why, delay))
            self._background.add(self._music_catch_up)
            self._music_catch_up.add_done_callback(self._background.discard)

        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is self.loop:
            go()
        else:
            self.loop.call_soon_threadsafe(go)

    async def music_catch_up(self, why: str, delay: float = 0.0) -> str | None:
        """`night.music` from the story's screen state → the scene (C3, the
        lights job's catch-up: the story, never a cache). A live scene that
        lands while the state is read wins; null or unknown is `off`; a
        read that fails changes nothing. → the scene played, or None."""
        if delay > 0:
            await asyncio.sleep(delay)
        if self.music is None or self._mod is None:
            return None
        if self._music_hand and why not in RESTART_KINDS:
            log.info("🎵 soundtrack catch-up (%s) skipped: a scene chosen by hand holds (until the next music cue)", why)
            return None
        seen = self._music_live
        answer: Any = None
        try:
            answer = await self._mod.get("/api/screen/state")
        except ModApiError as err:
            if err.status != 404:
                log.warning("🎵 soundtrack catch-up (%s) failed: %s", why, err)
                return None
        except (httpx.HTTPError, OSError, ValueError) as err:
            log.warning("🎵 soundtrack catch-up (%s) failed: %s", why, err or type(err).__name__)
            return None
        if self._music_live != seen:
            log.info("🎵 soundtrack catch-up (%s) skipped: a live scene arrived while the state was read", why)
            return None
        night = answer.get("night") if isinstance(answer, dict) else None
        value = night.get("music") if isinstance(night, dict) else None
        scene = value if isinstance(value, str) and self.music.st.has_scene(value) else OFF
        if value is not None and scene != value:
            log.warning("🎵 soundtrack catch-up (%s): night.music %r is no scene — off", why, value)
        self.music.set_scene(scene, f"catch-up {why}")
        return scene

    async def _music_loop(self) -> None:
        assert self.music is not None
        while True:
            await asyncio.sleep(MUSIC_TICK_S)
            try:
                self.music.tick()
            except Exception:  # noqa: BLE001 — one bad tick must not end the music
                log.exception("🎵 soundtrack tick failed")

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
        return Announcer(alexa, None, output=MixerOutput(self), render_say=self.render_say, speak_direct=self._speak_unless_cut)

    def _speak_unless_cut(self, text: str, voice: str | None, device: str | None) -> None:
        """The Announcer's `say -a` fallback, never around a stop."""
        if self.announce_cut():
            log.info("announcement cut (stop): no say fallback")
            return
        self.speak_direct(text, voice, device)

    def enqueue(self, item: Any) -> None:
        if self.announcements is None:
            log.warning("announcement dropped (the router is not running)")
            return
        # Stamped now, in the caller's thread: a stop that lands before the
        # worker takes it skips it, one that came before it never does.
        entry = (self._announce_epoch, item)
        if self.loop is not None:
            self.loop.call_soon_threadsafe(self.announcements.put_nowait, entry)
        else:
            self.announcements.put_nowait(entry)

    async def _announce_worker(self) -> None:
        assert self.announcements is not None
        while True:
            item = await self.announcements.get()
            stamp = self._announce_epoch
            if isinstance(item, tuple) and len(item) == 2 and isinstance(item[0], int):
                stamp, item = item
            if stamp != self._announce_epoch:
                log.info("🔇 audio: an announcement queued before the stop dropped")
                if isinstance(item, HouseSay):
                    self.ack("play", item.seq, "closed")
                continue
            if not self.speaks_announcements():
                now = time.monotonic()
                if now - self._dropped_logged > 60:
                    self._dropped_logged = now
                    log.warning("announcement dropped: an `alexa` player holds the house's voice (announce: blocked)")
                if isinstance(item, HouseSay):
                    self.ack("play", item.seq, "error")
                continue
            if self.announcer is None:
                self.announcer = self.make_announcer()
            # A stop from here on cuts this item (`announce_cut`).
            self._playing_epoch = stamp
            try:
                if item == "chime":
                    log.info("chime → %s", await self.announcer.ring())
                elif isinstance(item, HouseSay):
                    await self._speak_play(item)
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

    async def play_test(self, speaker: str | None = None, out: int | None = None, on_ack=None) -> bool:
        """A 1.5 s tone and the spoken label on one speaker / output.
        `on_ack(result, ms)` (a server test's ack, wave 25) runs once, as
        soon as the length is known: tone + label, in ms."""

        def answer(result: str, ms: float | None = None) -> None:
            if on_ack is not None:
                on_ack(result, ms)

        target = self.test_targets(speaker, out)
        mixer = self.mixer
        if self.doc is None or mixer is None or not self.engine_running():
            answer("closed")
            return False
        if target is None:
            answer("nowhere")
            return False
        outs, label = target
        gains = {ch: self.cfg.test_gain_db for ch in outs}
        text = identify_label(label, outs)
        log.info("speaker test: %s", text)
        epoch = self._test_epoch
        loop = asyncio.get_running_loop()
        tone_done = loop.create_future()

        def finished() -> None:
            loop.call_soon_threadsafe(lambda: tone_done.done() or tone_done.set_result(None))

        tone = identify_tone(mixer.rate, outs[0])
        tone_ms = len(tone) * 1000 / mixer.rate
        mixer.play(tone, gains, bus="test", tag="test", done=finished)
        try:
            spoken = await asyncio.to_thread(self.render_say, text, self.cfg.say_voice)
            samples, rate = decode(spoken)
        except PlaybackError as err:
            log.warning("speaker test label: %s", err)
            answer("played", tone_ms)
            return True
        answer("played", tone_ms + (len(samples) * 1000 / rate if rate else 0.0))
        try:
            await asyncio.wait_for(tone_done, timeout=5.0)
        except asyncio.TimeoutError:
            pass
        if self._test_epoch != epoch:
            log.info("speaker test %s: stopped, label not played", label or outs)
            return True
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
        if self._mod is None:
            self._mod = mod
        if self.loop is None:
            self.loop = asyncio.get_running_loop()
        backoff = 1.0
        missing_route = False
        while True:
            # `router=1` (+ this machine's name): the server shows the map
            # editor that a router is listening, so a Test there is played.
            params: dict[str, Any] = {"router": 1, "name": socket.gethostname().split(".")[0][:64]}
            if self.version is not None and self.source not in ("cache", "file"):
                params.update({"after": self.version, "tests": self.test_seq, "stops": self.stop_seq, "plays": self.play_seq, "wait": int(self.cfg.poll_wait)})
                # Wave 40: the mix's seq (once one is known), the music
                # commands' cursor and whether this router thinks a panel
                # watches (the server answers when that moves).
                if self.mix_seq is not None:
                    params["mix"] = self.mix_seq
                params.update({"music": self.music_seq, "watch": int(self.mix_watch)})
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
                mix_moved = self.apply_mix(answer.get("mix"))
                if isinstance(answer.get("mixWatch"), bool):
                    self.mix_watch = answer["mixWatch"]
                watch_moved = "watch" in params and int(self.mix_watch) != params["watch"]
                stops = self.new_stops(answer.get("stops"), answer.get("now"))
                plays = self.new_plays(answer.get("plays"), answer.get("now"))
                music = self.new_music(answer.get("music"), answer.get("now"))
                # One answer may hold all three: they act in the order they were pressed.
                pressed = [*(("stop", t) for t in stops), *(("play", t) for t in plays), *(("music", t) for t in music)]
                for kind, t in sorted(pressed, key=lambda e: float(e[1].get("at") or 0)):
                    if kind == "stop":
                        self.stop_all(t.get("announce") is True, str(t.get("by") or ""))
                    elif kind == "play":
                        self.serve_play(t)
                    else:
                        self.serve_music(t)
                tests = self.new_tests(answer.get("tests"))
                for t in tests:
                    seq = t.get("seq")
                    asyncio.ensure_future(self.play_test(t.get("speaker") or None, t.get("out"), on_ack=lambda result, ms, seq=seq: self.ack("test", seq, result, ms)))
                if changed:
                    asyncio.ensure_future(self._refresh_house(mod))
                    asyncio.ensure_future(self._preload())
                elif params and not tests and not pressed and not mix_moved and not watch_moved and time.monotonic() - asked < 1.0:
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
        if self.music is not None:
            names = {n for n in names if self.music.st.track(n) is None}  # tracks stream, never decoded whole
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

        await run_stream(mod, mod.feed_url("stagehand-audio"), on_frame, label="audio feed", on_connect=lambda: self.schedule_music_catch_up("feed"))

    # -- the footsteps (wave 49) -----------------------------------------------------

    def _step_rig(self) -> StepRig | None:
        """What a step plays through, or None: no stream, no speakers, or
        the takes not built yet (`Walkers` then skips the step, silently)."""
        mixer = self.mixer
        if mixer is None or self.doc is None or not self.doc.speakers or self.steps is None or not self.engine_running():
            return None
        return StepRig(mixer, self.doc, self.steps)

    def _build_steps(self, rate: int) -> FootstepBank:
        return FootstepBank(self.cfg.sounds_dir, rate, **({"decode": self._decode} if self._decode else {}))

    async def _walkers_clock(self) -> None:
        """The steps' clock, on this thread and never in the audio callback:
        a step is a `Mixer.play`, which only queues. The takes are built
        once someone walks, and off this thread. A failing tick is logged
        once: at this rate it would otherwise be the whole log."""
        failed = False
        while True:
            await asyncio.sleep(WALKERS_TICK_S)
            try:
                mixer = self.mixer
                if self.walkers.count and mixer is not None and (self.steps is None or self.steps.rate != mixer.rate):
                    self.steps = await asyncio.to_thread(self._build_steps, mixer.rate)
                self.walkers.tick(time.monotonic())
            except Exception:  # noqa: BLE001 — a bad step must not end the walkers
                if not failed:
                    log.exception("footsteps tick failed")
                failed = True

    async def _walkers_loop(self, mod: ModClient) -> None:
        """Hold `GET /api/mod/audio/walkers`, as `_feed_loop` holds the feed.
        A router that plays no sounds plays no steps; a 404 (an older server)
        is logged once and the loop stops until a restart."""
        if not self.cfg.play_sounds:
            return

        def on_frame(event: str, data: str) -> None:
            if event != "walkers":
                return
            try:
                doc = json.loads(data)
            except ValueError:
                return
            self.walkers.apply(doc)

        clock = asyncio.ensure_future(self._walkers_clock())
        try:
            await run_stream(mod, mod.stream_url(WALKERS_PATH), on_frame, label="walkers", stop_on=(404,))
        finally:
            clock.cancel()
        log.info("the server has no %s (an older release) — no footsteps until this router restarts", WALKERS_PATH)

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

    def layout_state(self) -> str:
        """`moved` while the open device disagrees with audio.json's
        `device.expect` (read live: a corrected audio.json clears it)."""
        info = self.engine.info if self.engine is not None and self.engine_running() else None
        expect = self.doc.expect if self.doc is not None else None
        return "moved" if info is not None and layout_problem(info, expect) is not None else "ok"

    def health(self) -> dict[str, Any]:
        mixer = self.mixer
        meters = mixer.take_meters() if mixer is not None else None
        peak = meters.peak if meters is not None else np.zeros(0)
        limited, blocks = (meters.limited, meters.blocks) if meters is not None else (0, 0)
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
            "stops": self.stops_done,
            "placeholders": placeholders_in(self.cfg.sounds_dir) if self.cfg.play_sounds else [],
            # `device.expect` disagreed with the device at the last open.
            "layout": self.layout_state(),
            # Wave 38 (C2): the inputs' peaks (dBFS since the last health;
            # empty on an output-only stream), each priority source's
            # activity (0..1) and the streamed voices' underruns (ever).
            "inputs": {str(ch): db for ch, db in meters.inputs.items()} if meters is not None else {},
            "sources": dict(meters.sources) if meters is not None else {},
            "underruns": meters.underruns if meters is not None else 0,
            # Wave 38 (C3): the scene, each bed (playlist, speakers, track,
            # pos_s, dur_s), the empty playlists; wave 40: scenes, playlists, hand.
            "music": self.music_status(),
            # Wave 40: the house mix in force (`stagehand music status` prints it).
            "mix": {"seq": self.mix_seq, "levels": mix_wire(self.mix_levels)},
            # Wave 49: how many programs are heard walking now.
            "walkers": self.walkers.count,
            # Wave 46: the software input (VoiceMeeter → input 3), or None.
            "tap": self.tap_state(),
        }

    def sound_lengths(self) -> dict[str, int]:
        """Every file in `sounds_dir` → its length in ms (the report's `sounds`)."""
        return sound_lengths(self.cfg.sounds_dir)

    def report_health(self, h: dict[str, Any], sounds: dict[str, int]) -> dict[str, Any]:
        """The report's `health` (wave 25 §4): the MQTT stats' numbers in
        the contract's names, plus every sound file's length."""
        out = {
            "ok": bool(h["ok"]),
            "device": h["device"],
            "layout": h["layout"],
            "voices": h["voices"],
            "xruns": h["xruns"],
            "peakDb": h["peak_db"],
            "announce": h["announce"],
            "missing": list(h["missing"]),
            "placeholders": list(h["placeholders"]),
            "sounds": sounds,
            "inputs": dict(h["inputs"]),
            "sources": dict(h["sources"]),
            "underruns": h["underruns"],
        }
        music = _camel_music(h.get("music"))
        if music is not None:  # a router with no soundtrack sends none (the field is optional)
            out["music"] = music
        return out

    async def _health_loop(self) -> None:
        # The first look comes soon (≤ 5 s), so the desk sees the sounds
        # without a minute's wait; then every `health_s`.
        wait = min(self.cfg.health_s, 5.0)
        while True:
            await asyncio.sleep(wait)
            wait = self.cfg.health_s
            h = self.health()
            log.info(
                "audio health: %s | audio.json %s (%s) | voices %d | played %d skipped %d | xruns %d | limited %d/%d | peak %.1f dBFS | announce %s%s%s",
                h["device"] or "closed", h["config"] or "—", h["source"], h["voices"], h["played"], h["skipped"], h["xruns"], h["limited"], h["blocks"], h["peak_db"], h["announce"],
                (" | LAYOUT MOVED (device.expect)" if h["layout"] == "moved" else "")
                + (f" | {len(h['placeholders'])} placeholder(s)" if h["placeholders"] else "")
                + (f" | underruns {h['underruns']}" if h["underruns"] else "")
                + (f" | {h['walkers']} walking" if h["walkers"] else "")
                + (f" | tap {h['tap']}" if h.get("tap") else "")
                + (f" | tidal {self.tidal.stats()}" if self.tidal is not None else "")
                + (f" | ducking: {', '.join(f'{k} {v:.0%}' for k, v in h['sources'].items() if v > 0)}" if any(v > 0 for v in h["sources"].values()) else "")
                + (f" | music {h['music']['scene'] or '—'}: " + (", ".join(f"{b['playlist']} {b['track'] or '—'}" for b in h["music"]["beds"]) or "no bed") if h.get("music") else ""),
                f" | no file: {', '.join(h['missing'])}" if h["missing"] else "",
            )
            if self.mqtt is not None:
                self.mqtt.publish(STATS_TOPIC, json.dumps(h), retain=True)
            if self._mod is not None:
                try:
                    sounds = await asyncio.to_thread(self.sound_lengths)
                except OSError:
                    sounds = {}
                await self.report({"health": self.report_health(h, sounds)})

    # -- the live meters (wave 40) ---------------------------------------------------

    def meters_wanted(self) -> bool:
        """A mixer panel watches (the GET's `mixWatch` or the last meters
        answer's `watch`), the server takes meters, and a stream is open."""
        return not self._meters_gone and self._mod is not None and self.mixer is not None and (self.mix_watch or self._meters_watch)

    def meters_body(self) -> dict[str, Any]:
        """`POST /api/mod/audio/meters`: every output's peak (after the
        limiter), the inputs' peaks, each source's activity, each strip's
        peak per output (before the limiter) — dBFS since the last packet,
        channels 1-based strings — and the soundtrack's status."""
        mixer = self.mixer
        assert mixer is not None
        live = mixer.take_live()
        db = lambda p: round(lin_to_db(float(p)), 1)  # noqa: E731
        body: dict[str, Any] = {
            "outputs": {str(i + 1): db(p) for i, p in enumerate(live.outputs)},
            "inputs": {str(ch): v for ch, v in live.inputs.items()},
            "sources": dict(live.sources),
            "buses": {name: {str(i + 1): db(p) for i, p in enumerate(row)} for name, row in live.strips.items()},
        }
        music = self._music_now()
        if music is not None:
            body["music"] = music
        return body

    def _music_now(self) -> dict[str, Any] | None:
        """The camelCased music status, read at most every `MUSIC_STATUS_EVERY_S`."""
        if self.music is None:
            return None
        now = time.monotonic()
        if self._music_status is None or now - self._music_status[0] >= MUSIC_STATUS_EVERY_S:
            self._music_status = (now, _camel_music(self.music_status()))
        return self._music_status[1]

    async def send_meters(self) -> bool:
        """One meters packet. → True when the server took it. Its `watch:
        false` stops the meters (until the GET says a panel watches again);
        a 404 (an older server) stops them for good."""
        mod = self._mod
        if mod is None or self.mixer is None:
            return False
        body = self.meters_body()
        try:
            answer = await mod.post(METERS_PATH, body)
        except ModApiError as err:
            if err.status == 404:
                self._meters_gone = True
                log.info("the server has no %s (an older release) — no live meters for the mixer panel", METERS_PATH)
                return False
            self._meters_failed(err)
            return False
        except (httpx.HTTPError, OSError, ValueError) as err:
            self._meters_failed(err)
            return False
        self.meters_sent += 1
        watch = answer.get("watch") if isinstance(answer, dict) else None
        if watch is False:
            if self._meters_watch or self.mix_watch:
                log.info("🎚 no mixer panel watches now — the live meters stop")
            self._meters_watch = self.mix_watch = False
        elif watch is True:
            self._meters_watch = True
        return True

    def _meters_failed(self, err: Exception) -> None:
        now = time.monotonic()
        if now - self._meters_warned > 60:
            self._meters_warned = now
            log.warning("live meters post failed (%s) — the mixer panel's meters may freeze", err or type(err).__name__)

    async def _meters_loop(self) -> None:
        while True:
            await asyncio.sleep(METERS_EVERY_S)
            if self.meters_wanted():
                await self.send_meters()

    async def _mqtt_loop(self) -> None:
        assert self.mqtt is not None
        cfg = self.cfg
        while True:
            topic, raw, retained = await self.mqtt.queue.get()
            if retained:
                continue  # a stale announcement or test is never replayed
            if topic == cfg.stop_topic:
                # `{}` or `{"announce": true}` — the stop with the uplink down.
                try:
                    doc = json.loads(raw.decode("utf-8")) if raw.strip() else {}
                except (UnicodeDecodeError, ValueError):
                    doc = None
                if isinstance(doc, dict):
                    self.stop_all(doc.get("announce") is True, str(doc.get("by") or "mqtt"))
                else:
                    log.warning("ignored %s payload %r", topic, raw[:80])
            elif topic == cfg.play_topic:
                try:
                    doc = json.loads(raw.decode("utf-8"))
                except (UnicodeDecodeError, ValueError):
                    doc = None
                if self.hand_play(doc) is None:
                    log.warning("ignored %s payload %r", topic, raw[:80])
            elif self.music is not None and topic == cfg.music_topic:
                try:
                    doc = json.loads(raw.decode("utf-8"))
                except (UnicodeDecodeError, ValueError):
                    doc = None
                if self.on_music(doc) is None:
                    log.warning("ignored %s payload %r", topic, raw[:80])
            elif topic == cfg.test_topic:
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
        self._mod = ctx.mod
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
            asyncio.ensure_future(self._meters_loop()),
            asyncio.ensure_future(self._walkers_loop(ctx.mod)),
        ]
        if self.cfg.announce and self.lock_fd is None:
            tasks.append(asyncio.ensure_future(self._voice_lock_loop()))
        if self.music is not None:
            tasks.append(asyncio.ensure_future(self._music_loop()))
            self.schedule_music_catch_up("start")
        if self.cfg.mqtt is not None:
            from ..show.mqtt import MqttBridge

            m = self.cfg.mqtt
            filters = [
                self.cfg.test_topic,
                self.cfg.stop_topic,
                self.cfg.play_topic,
                *([self.cfg.music_topic] if self.music is not None else []),
                *([self.cfg.announce_topic, self.cfg.chime_topic] if self.cfg.announce else []),
            ]
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
            if self.tidal is not None:
                self.tidal.close()
            if self.lock_fd is not None:
                os.close(self.lock_fd)
                self.lock_fd = None
