"""Show control — the cue router between the story and the house.

Two long-lived loops run concurrently:

  - the SSE loop consumes the event server's mod feed, matches `sim`
    events against the cue map, and dispatches OSC/MQTT cues;
  - the sensor loop consumes bridged MQTT messages, matches them
    against the sensor map, and injects journaled story mutations
    through the mod API.

The router itself is stateless (debounce aside): restart it any time.
Retained MQTT re-converges the door indicator, and the lights catch up:
on every (re)connect of the feed or of the broker, and 1.5 s after a
reset / reload / golive `lifecycle` frame (once the restarted story's
entry beat ran),
`_catch_up` reads the story's mirrors (`Night.lights`, `Night.dark_room`)
from `GET /api/state` and replays the `catch_up:` cues through the cue
map — so a cue fired while the uplink was down is not lost for good.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import replace
from typing import Any

import httpx

from ..modapi import ModApiError, ModClient, run_stream
from ..module import ConfigError, Context
from ..templating import coerce_scalar
from .config import ShowConfig, parse_show
from .cuemap import MqttCue, OscCue, evaluate_cues
from .mqtt import MqttBridge
from .osc import OscSender
from .sensormap import Debouncer, ModCall, evaluate_sensors

log = logging.getLogger("stagehand.show")

#: After a restart's `lifecycle` frame, wait this long before reading the
#: world: the frame is sent before the story replays its entry beat.
LIFECYCLE_CATCH_UP_DELAY_S = 1.5
#: The lifecycle kinds that restart the story (`ended` only logs).
_RESTART_KINDS = ("reset", "reload", "golive")
#: How long a catch-up waits for the broker session before giving up (the
#: broker's own reconnect schedules another).
MQTT_READY_TIMEOUT_S = 10.0


def build_show(section: Any, base_dir: str) -> "ShowControl":
    try:
        return ShowControl(parse_show(section))
    except ConfigError:
        raise
    except ValueError as err:  # cue/sensor/topic/condition parse errors
        raise ConfigError(f"show: {err}") from err


class ShowControl:
    name = "show"

    def __init__(self, cfg: ShowConfig) -> None:
        self.cfg = cfg
        self.osc = OscSender(cfg.osc_targets) if cfg.osc_targets else None
        self.mqtt: MqttBridge | None = None
        self.debouncer = Debouncer()
        self.mod: ModClient | None = None
        self.catch_up_delay_s = LIFECYCLE_CATCH_UP_DELAY_S
        self.mqtt_ready_timeout_s = MQTT_READY_TIMEOUT_S
        self._catch_up_task: asyncio.Task | None = None
        #: Live-feed `cue`s a `catch_up:` rule covers: a catch-up whose state
        #: read raced one replays nothing (its world is older than the cue).
        self._feed_cues = 0
        #: QLab `sound` cues dropped because the `audio` router plays them.
        self.sounds_handed_off = 0

    def hand_sounds_to_router(self) -> None:
        """The `audio` router plays `sound X` (`audio.play_sounds: true`):
        drop every `sound` cue that goes to an OSC target (QLab), so no sound
        plays twice. MQTT `sound` rules stay (`announce_chime` → the player)."""
        keep = [r for r in self.cfg.cues if not (r.on_directive == "sfx" and r.osc is not None)]
        self.sounds_handed_off = len(self.cfg.cues) - len(keep)
        self.cfg = replace(self.cfg, cues=keep)

    def describe(self) -> list[str]:
        cfg = self.cfg
        lines = [
            f"mqtt     : {f'{cfg.mqtt.host}:{cfg.mqtt.port}' if cfg.mqtt else '— (no broker)'}",
            f"osc      : {', '.join(f'{n}={h}:{p}' for n, (h, p) in cfg.osc_targets.items()) or '— (no targets)'}",
            f"cues     : {len(cfg.cues)} rule(s)" + (f" ({self.sounds_handed_off} QLab sound cue(s) handed to the audio router)" if self.sounds_handed_off else ""),
            f"sensors  : {len(cfg.sensors)} rule(s)",
            f"catch-up : {', '.join(r.path for r in cfg.catch_up) or '—'}",
        ]
        if cfg.mqtt_filters:
            lines.append(f"subscribe: {', '.join(cfg.mqtt_filters)}")
        return lines

    async def run(self, ctx: Context) -> None:
        self.mod = ctx.mod
        loop = asyncio.get_running_loop()
        if self.cfg.mqtt is not None:
            self.mqtt = MqttBridge(
                self.cfg.mqtt.host,
                self.cfg.mqtt.port,
                filters=self.cfg.mqtt_filters,
                loop=loop,
                client_id=self.cfg.mqtt.client_id,
                username=self.cfg.mqtt.username,
                password=self.cfg.mqtt.password,
            )
            # Cues sent while the broker was away were dropped: re-converge.
            self.mqtt.on_connected = lambda: self._schedule_catch_up("mqtt")
            self.mqtt.start()
        tasks = [asyncio.ensure_future(self._sse_loop())]
        if self.mqtt is not None and self.cfg.sensors:
            tasks.append(asyncio.ensure_future(self._sensor_loop()))
        try:
            await asyncio.gather(*tasks)
        finally:
            for t in tasks:
                t.cancel()
            if self._catch_up_task is not None:
                self._catch_up_task.cancel()
            if self.mqtt is not None:
                self.mqtt.stop()
                self.mqtt = None

    # -- story → world -----------------------------------------------------

    async def _sse_loop(self) -> None:
        assert self.mod is not None

        def on_frame(event: str, data: str) -> None:
            if event == "sim":
                self._on_feed_sim(json.loads(data))
            elif event == "lifecycle":
                self._on_lifecycle(json.loads(data))

        # The mod feed is capability-gated: `run_stream` authenticates, sends
        # the token on the stream request, and re-logs-in when it's refused.
        await run_stream(
            self.mod,
            self.mod.sse_url,
            on_frame,
            label="show feed",
            on_connect=lambda: self._schedule_catch_up("connect"),
        )

    def _on_feed_sim(self, doc: dict) -> None:
        """A `sim` event from the live feed (a catch-up's replay skips this)."""
        if isinstance(doc, dict) and doc.get("type") == "directive" and doc.get("verb") == "cue":
            if any(r.covers(doc.get("args", "")) for r in self.cfg.catch_up):
                self._feed_cues += 1
        self._on_sim(doc)

    def _on_lifecycle(self, doc: dict) -> None:
        kind = str(doc.get("kind", "")) if isinstance(doc, dict) else ""
        if kind in _RESTART_KINDS:
            self._schedule_catch_up(kind, delay=self.catch_up_delay_s)
        else:
            log.info("lifecycle %s", kind or "?")

    def _schedule_catch_up(self, why: str, delay: float = 0.0) -> None:
        """Run `_catch_up` as its own task (never awaited inside a frame
        handler: a slow state call must not hold the feed). A newer one
        replaces a pending one — it reads a fresher world."""
        if not self.cfg.catch_up:
            return
        if self._catch_up_task is not None and not self._catch_up_task.done():
            self._catch_up_task.cancel()
        self._catch_up_task = asyncio.ensure_future(self._catch_up(why, delay))

    async def _catch_up(self, why: str, delay: float = 0.0) -> None:
        """Replay the `catch_up:` cues for the story's current world."""
        assert self.mod is not None
        if delay > 0:
            await asyncio.sleep(delay)
        if self.mqtt is not None and not self.mqtt.connected.is_set():
            # paho drops QoS-0 publishes queued before its session is up.
            try:
                await asyncio.wait_for(self.mqtt.connected.wait(), self.mqtt_ready_timeout_s)
            except asyncio.TimeoutError:
                log.warning("catch-up (%s) skipped: the broker is not connected (its reconnect catches up)", why)
                return
        seen = self._feed_cues
        try:
            doc = await self.mod.get("/api/state", {"role": "mod"})
        except (ModApiError, httpx.HTTPError, OSError, ValueError) as err:
            log.warning("catch-up (%s) FAILED: %s", why, err)
            return
        if self._feed_cues != seen:
            log.info("catch-up (%s) skipped: a live cue arrived while the state was read", why)
            return
        world: dict[str, str] = {}
        for entry in doc.get("world") or []:
            if isinstance(entry, dict) and isinstance(entry.get("path"), str):
                world[entry["path"]] = str(entry.get("value", ""))
        for rule in self.cfg.catch_up:
            args = rule.args_for(world)
            if args is None:
                continue
            log.info("catch-up (%s): cue %s", why, args)
            self._on_sim({"type": "directive", "verb": "cue", "args": args})

    def _on_sim(self, event: dict) -> None:
        for cue in evaluate_cues(self.cfg.cues, event):
            if isinstance(cue, OscCue):
                if self.osc is None:
                    continue
                args = list(cue.args)
                if cue.t_exec_offset_ms is not None:
                    args.append(str(int(time.time() * 1000) + cue.t_exec_offset_ms))
                self.osc.send(cue.addr, args, to=cue.to)
                log.info("cue osc %s %s → %s", cue.addr, args, list(cue.to) if cue.to else "all")
            elif isinstance(cue, MqttCue):
                if self.mqtt is None:
                    continue
                self.mqtt.publish(cue.topic, cue.payload, retain=cue.retain, qos=cue.qos)
                log.info("cue mqtt %s %s%s", cue.topic, cue.payload, " (retained)" if cue.retain else "")

    # -- world → story -----------------------------------------------------

    async def _sensor_loop(self) -> None:
        assert self.mqtt is not None
        while True:
            topic, raw, retained = await self.mqtt.queue.get()
            payload = _decode_payload(raw)
            calls = evaluate_sensors(self.cfg.sensors, topic, payload, self.debouncer, time.monotonic(), retained=retained)
            for call in calls:
                await self._mod_call(topic, call)

    async def _mod_call(self, topic: str, call: ModCall) -> None:
        assert self.mod is not None
        try:
            if call.kind == "signal":
                await self.mod.signal(call.fields["name"], call.fields.get("subject"))
            elif call.kind == "beat":
                await self.mod.beat(call.fields["name"], call.fields.get("subject"))
            elif call.kind == "arrive":
                await self.mod.arrive(call.fields["person"], call.fields["location"])
            log.info("sensor %s → %s %s", topic, call.kind, call.fields)
        except (ModApiError, httpx.HTTPError, OSError) as err:
            log.warning("sensor %s → %s %s FAILED: %s", topic, call.kind, call.fields, err)


def _decode_payload(raw: bytes) -> dict:
    """JSON object payloads pass through; anything else lands as `value`."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return {"value": None}
    try:
        doc = json.loads(text)
    except json.JSONDecodeError:
        return {"value": coerce_scalar(text.strip())}
    if isinstance(doc, dict):
        return doc
    return {"value": doc}
