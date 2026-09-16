"""Show control — the cue router between the story and the house.

Two long-lived loops run concurrently:

  - the SSE loop consumes the event server's mod feed, matches `sim`
    events against the cue map, and dispatches OSC/MQTT cues;
  - the sensor loop consumes bridged MQTT messages, matches them
    against the sensor map, and injects journaled story mutations
    through the mod API.

The router itself is stateless (debounce aside): restart it any time —
retained MQTT re-converges the props and the journal carries the story.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
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

    def describe(self) -> list[str]:
        cfg = self.cfg
        lines = [
            f"mqtt     : {f'{cfg.mqtt.host}:{cfg.mqtt.port}' if cfg.mqtt else '— (no broker)'}",
            f"osc      : {', '.join(f'{n}={h}:{p}' for n, (h, p) in cfg.osc_targets.items()) or '— (no targets)'}",
            f"cues     : {len(cfg.cues)} rule(s)",
            f"sensors  : {len(cfg.sensors)} rule(s)",
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
            self.mqtt.start()
        tasks = [asyncio.ensure_future(self._sse_loop())]
        if self.mqtt is not None and self.cfg.sensors:
            tasks.append(asyncio.ensure_future(self._sensor_loop()))
        try:
            await asyncio.gather(*tasks)
        finally:
            for t in tasks:
                t.cancel()
            if self.mqtt is not None:
                self.mqtt.stop()
                self.mqtt = None

    # -- story → world -----------------------------------------------------

    async def _sse_loop(self) -> None:
        assert self.mod is not None

        def on_frame(event: str, data: str) -> None:
            if event == "sim":
                self._on_sim(json.loads(data))

        # The mod feed is capability-gated: `run_stream` authenticates, sends
        # the token on the stream request, and re-logs-in when it's refused.
        await run_stream(self.mod, self.mod.sse_url, on_frame, label="show feed")

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
            topic, raw = await self.mqtt.queue.get()
            payload = _decode_payload(raw)
            calls = evaluate_sensors(self.cfg.sensors, topic, payload, self.debouncer, time.monotonic())
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
