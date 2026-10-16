"""House announcements (the `alexa` module) — `do announce "…"` out of the house speakers.

    story  `do announce "Go to the living room."`
      → show module cue  → MQTT show/announce {"text": "Go to the living room."}
      → this module (on the house Mac)
           chime ──────────────► CoreAudio device (Z1 + Z2)
           voice: `say -o` (engine: say, the default — the Mac's own voice)
                  or disk cache → server `/api/mod/tts` → `say -o` (engine: server)
                 ──────────────► same device + channel map
           last resort: `say -a <device>`

The same announcement also rides the event server's screen state, so a
wall terminal set to `announce` says it too (OCT31 N-09, `terminal/src/announce.ts`).

The chime starts the instant the message lands and the voice is rendered
(or fetched) while it rings, so the line follows within the chime's
length. With `engine: server`, `prewarm:` fetches every scripted line at
boot and keeps it on disk — the cache also covers the house internet dying.

Hand-firing (no story, no server): publish to the topic yourself —
`mosquitto_pub -t show/announce -m '{"text":"Go to the living room."}'` —
or play one line locally with `stagehand announce --config … "text"`.

Announcements play one at a time in arrival order; the player never
overlaps two voices. Payloads: `{"text", "voice"?, "chime"?: false}` or
a bare string.

`sound announce_chime` (the story's chime on its own) arrives on
`show/chime` and rings the same chime on the same zones — unless an
announcement started or ended within `CHIME_MERGE_S`, whose own chime
already rang (the story often writes `do announce …` then `sound announce_chime`).

Anyone who can reach the broker can publish `show/announce`, so a line
is clipped to `MAX_TEXT` characters; bind Mosquitto's anonymous listener
to 127.0.0.1 (`scripts/house-mac/alexa.md` → *Lock down the broker*).
"""

from __future__ import annotations

import asyncio
import fcntl
import hashlib
import json
import logging
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from ..modapi import ModApiError, ModClient
from ..module import ConfigError, Context
from .config import AlexaConfig, parse_alexa
from .player import DeviceOutput, PlaybackError, chime, decode, say_direct, say_to_file

log = logging.getLogger("stagehand.alexa")

HEALTH_TOPIC = "health/alexa"
#: A bare chime this soon after an announcement (its start, or its end — a
#: slow voice fetch can make the line itself run past this) is the same moment.
CHIME_MERGE_S = 10.0
#: Longest line spoken (characters): anyone on the broker can publish
#: `show/announce`, so a payload is clipped rather than read out for minutes.
#: Every scripted line is far shorter.
MAX_TEXT = 300


def build_alexa(section: Any, base_dir: str) -> "Alexa":
    try:
        return Alexa(parse_alexa(section, base_dir))
    except ConfigError:
        raise
    except ValueError as err:
        raise ConfigError(f"alexa: {err}") from err


@dataclass(frozen=True)
class Announcement:
    text: str
    voice: str | None = None
    chime: bool = True


def parse_payload(raw: bytes) -> Announcement | None:
    """`{"text": …, "voice"?: …, "chime"?: bool}` or a bare string; None = ignore."""
    try:
        body = raw.decode("utf-8").strip()
    except UnicodeDecodeError:
        return None
    if not body:
        return None
    text: Any = body
    voice = None
    ring = True
    try:
        doc = json.loads(body)
    except json.JSONDecodeError:
        doc = body  # plain text
    if isinstance(doc, dict):
        text = doc.get("text")
        voice = doc.get("voice") if isinstance(doc.get("voice"), str) and doc.get("voice") else None
        ring = doc.get("chime") is not False
    else:
        text = doc  # a number / list / null stays non-text and is ignored
    if not isinstance(text, str):
        return None
    text = " ".join(text.split())
    if len(text) > MAX_TEXT:
        text = text[:MAX_TEXT].rsplit(" ", 1)[0] or text[:MAX_TEXT]
    # A cue template whose `{target}` never filled is not something to say aloud.
    if not text or text in ("{target}",):
        return None
    return Announcement(text=text, voice=voice, chime=ring)


#: (text, voice) → audio bytes, or raise.
Fetch = Callable[[str, str | None], Awaitable[bytes]]


class VoiceCache:
    """Server TTS bytes on disk, keyed by voice + text (survives restarts
    and the uplink dropping)."""

    def __init__(self, directory: str) -> None:
        self.dir = Path(directory)

    def _path(self, text: str, voice: str | None) -> Path:
        key = hashlib.sha256(f"{voice or ''}\n{text}".encode()).hexdigest()[:32]
        return self.dir / f"{key}.audio"

    def get(self, text: str, voice: str | None) -> bytes | None:
        try:
            return self._path(text, voice).read_bytes()
        except OSError:
            return None

    def put(self, text: str, voice: str | None, data: bytes) -> None:
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            p = self._path(text, voice)
            tmp = p.with_suffix(".tmp")
            tmp.write_bytes(data)
            tmp.replace(p)
        except OSError as err:
            log.warning("voice cache write failed: %s", err)


class Announcer:
    """The fallback ladder for one announcement. Every effect is injected
    so tests drive it with no sound card and no server."""

    def __init__(
        self,
        cfg: AlexaConfig,
        fetch: Fetch | None,
        output: DeviceOutput | None = None,
        cache: VoiceCache | None = None,
        render_say: Callable[[str, str | None], bytes] = say_to_file,
        speak_direct: Callable[[str, str | None, str | None], None] = say_direct,
    ) -> None:
        self.cfg = cfg
        self.fetch = fetch
        self.output = output or DeviceOutput(cfg.device, cfg.channels, cfg.gain_db)
        self.cache = cache or VoiceCache(cfg.cache_dir)
        self.render_say = render_say
        self.speak_direct = speak_direct
        self._chime = self._load_chime()
        #: monotonic start of the last announcement, restamped when it ends (for chime merging).
        self.last_announce: float | None = None

    def _load_chime(self):
        if self.cfg.chime == "off":
            return None
        if self.cfg.chime == "synth":
            return chime(), 48000
        try:
            return decode(Path(self.cfg.chime).read_bytes())
        except (OSError, PlaybackError) as err:
            log.warning("chime file unusable (%s) — using the synthesised chime", err)
            return chime(), 48000

    async def voice_bytes(self, text: str, voice: str | None) -> bytes | None:
        """Disk cache → server TTS (cached on success) → None. Always None
        with `engine: say` — the Mac's own voice never asks the server."""
        if self.cfg.engine != "server":
            return None
        voice = voice or self.cfg.voice
        hit = self.cache.get(text, voice)
        if hit is not None:
            return hit
        if self.fetch is None:
            return None
        try:
            data = await asyncio.wait_for(self.fetch(text, voice), timeout=self.cfg.tts_timeout)
        except (asyncio.TimeoutError, ModApiError, httpx.HTTPError, OSError) as err:
            log.warning("server voice unavailable (%s) — falling back to say", err or "timeout")
            return None
        if not data:
            return None
        self.cache.put(text, voice, data)
        return data

    async def prewarm(self) -> int:
        """Fetch + cache every `prewarm:` line not already on disk
        (`engine: server` only — `say` renders a line in well under a second)."""
        if self.cfg.engine != "server":
            return 0
        done = 0
        for text in self.cfg.prewarm:
            if self.cache.get(text, self.cfg.voice) is not None:
                done += 1
                continue
            if await self.voice_bytes(text, None) is not None:
                done += 1
        return done

    async def ring(self, now: float | None = None) -> str:
        """The chime alone (`sound announce_chime`): `chime`, `merged` (an
        announcement just rang it), `off`, or `failed`."""
        now = time.monotonic() if now is None else now
        if self.last_announce is not None and now - self.last_announce < CHIME_MERGE_S:
            return "merged"
        if self._chime is None:
            return "off"
        try:
            await asyncio.to_thread(self.output.play, *self._chime)
            return "chime"
        except PlaybackError as err:
            log.warning("chime failed: %s", err)
            return "failed"

    async def _voice_or_say(self, a: Announcement) -> tuple[str, bytes | None]:
        audio = await self.voice_bytes(a.text, a.voice)
        if audio is not None:
            return "device", audio
        try:
            return "device-say", await asyncio.to_thread(self.render_say, a.text, self.cfg.say_voice)
        except PlaybackError as err:
            log.warning("%s", err)
            return "device-say", None

    async def announce(self, a: Announcement) -> str:
        """Play one announcement; returns the path taken (for logs + tests):
        `device-say` (say rendered through the device — the default),
        `device` (the server voice, `engine: server`), `say-device`
        (`say -a`), `say-default`, or `failed`."""
        try:
            return await self._announce(a)
        finally:
            # The merge window counts from the end too: `sound announce_chime`
            # queued behind a long announcement must not ring after the line.
            self.last_announce = time.monotonic()

    async def _announce(self, a: Announcement) -> str:
        started = self.last_announce = time.monotonic()
        log.info("announce %r received", a.text)
        # The voice (`say` rendered to a file; with `engine: server` the
        # server's first) is prepared while the chime rings, so the line
        # follows the chime with no gap.
        fetching = asyncio.ensure_future(self._voice_or_say(a))
        device_ok = True
        if a.chime and self._chime is not None:
            try:
                await asyncio.to_thread(self.output.play, *self._chime)
            except PlaybackError as err:
                device_ok = False
                log.warning("chime failed: %s", err)
        path, audio = await fetching
        if device_ok and audio is not None:
            try:
                samples, rate = decode(audio)
                await asyncio.to_thread(self.output.play, samples, rate)
                log.info("announce %r via %s on %s (%.1fs)", a.text, path, self.output.describe(), time.monotonic() - started)
                return path
            except PlaybackError as err:
                log.warning("device playback failed: %s", err)
        for path, device in (("say-device", self.cfg.device), ("say-default", None)):
            if path == "say-device" and device is None:
                continue
            try:
                await asyncio.to_thread(self.speak_direct, a.text, self.cfg.say_voice, device)
                log.info("announce %r via %s (%.1fs)", a.text, path, time.monotonic() - started)
                return path
            except PlaybackError as err:
                log.warning("%s", err)
        log.error("announce %r FAILED on every path", a.text)
        return "failed"


def try_lock(directory: str) -> int | None:
    """An exclusive lock on `<cache_dir>/player.lock`, or None if another
    player on this machine holds it."""
    Path(directory).mkdir(parents=True, exist_ok=True)
    fd = os.open(os.path.join(directory, "player.lock"), os.O_RDWR | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        return None
    return fd


async def single_player(directory: str, poll: float = 5.0) -> int:
    """One player per house Mac: a second `alexa` (say, the show job started
    without `--only show`) waits silently instead of doubling every line a
    few hundred ms apart, and takes over if the first one dies."""
    warned = False
    while (fd := try_lock(directory)) is None:
        if not warned:
            log.warning("another alexa player holds %s/player.lock — standing by", directory)
            warned = True
        await asyncio.sleep(poll)
    return fd


class Alexa:
    name = "alexa"

    def __init__(self, cfg: AlexaConfig) -> None:
        self.cfg = cfg

    def describe(self) -> list[str]:
        cfg = self.cfg
        out = DeviceOutput(cfg.device, cfg.channels, cfg.gain_db)
        if cfg.engine == "server":
            voice = [
                f"voice    : server {cfg.voice or 'default'} → say {cfg.say_voice or 'default'} (after {cfg.tts_timeout:.0f}s)",
                f"prewarm  : {len(cfg.prewarm)} line(s) → {cfg.cache_dir}",
            ]
        else:
            voice = [f"voice    : say {cfg.say_voice or '(the system voice)'} — the Mac's own, no server"]
        return [
            f"mqtt     : {cfg.mqtt.host}:{cfg.mqtt.port} ← {cfg.topic}" + (f", {cfg.chime_topic}" if cfg.chime_topic else ""),
            f"output   : {out.describe()} (gain {cfg.gain_db:+.0f} dB)",
            *voice,
            f"chime    : {cfg.chime}",
        ]

    def preflight(self) -> list[str]:
        """Problems `stagehand check` fails on (the output device)."""
        cfg = self.cfg
        err = DeviceOutput(cfg.device, cfg.channels, cfg.gain_db).probe()
        return [f"alexa: {err} — see `scripts/accept/K-20.sh devices`"] if err else []

    def announcer(self, mod: ModClient | None) -> Announcer:
        fetch: Fetch | None = None
        if mod is not None and self.cfg.engine == "server":
            cfg = self.cfg

            async def fetch(text: str, voice: str | None) -> bytes:
                data, _ctype = await mod.speak(text, voice=voice, speed=cfg.speed, timeout=cfg.tts_timeout)
                return data

        return Announcer(self.cfg, fetch)

    async def run(self, ctx: Context) -> None:
        lock_fd = await single_player(self.cfg.cache_dir)
        try:
            await self._play_forever(ctx)
        finally:
            os.close(lock_fd)

    async def _play_forever(self, ctx: Context) -> None:
        from ..show.mqtt import MqttBridge

        announcer = self.announcer(ctx.mod)
        for problem in self.preflight():
            log.error("%s — announcements will fall back to `say`", problem)
        loop = asyncio.get_running_loop()
        bridge = MqttBridge(
            self.cfg.mqtt.host,
            self.cfg.mqtt.port,
            filters=[self.cfg.topic, *([self.cfg.chime_topic] if self.cfg.chime_topic else [])],
            loop=loop,
            client_id=self.cfg.mqtt.client_id,
            username=self.cfg.mqtt.username,
            password=self.cfg.mqtt.password,
            health_topic=HEALTH_TOPIC,
        )
        bridge.start()
        log.info("voice: %s", "the server's, `say` as the fallback" if self.cfg.engine == "server" else f"say {self.cfg.say_voice or ''} (the Mac's own)".rstrip())
        warm = asyncio.ensure_future(self._prewarm(announcer))
        try:
            while True:
                topic, raw = await bridge.queue.get()
                if topic == self.cfg.chime_topic:
                    log.info("chime → %s", await announcer.ring())
                    continue
                a = parse_payload(raw)
                if a is None:
                    log.warning("ignored %s payload %r", self.cfg.topic, raw[:120])
                    continue
                await announcer.announce(a)
        finally:
            warm.cancel()
            bridge.stop()

    async def _prewarm(self, announcer: Announcer) -> None:
        # Retried each minute until every line is on disk (the server may
        # come up after this Mac does). `engine: say` has nothing to fetch.
        total = len(self.cfg.prewarm) if self.cfg.engine == "server" else 0
        while total:
            n = await announcer.prewarm()
            log.info("prewarmed %d/%d announcement(s)", n, total)
            if n == total:
                return
            await asyncio.sleep(60)
