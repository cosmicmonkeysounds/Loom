"""The house lights (the `lights` module) — the story's `cue <look>` → Zigbee2MQTT / WLED.

    event server  GET /api/mod/lights   (long poll: lights.json + tests + pairs; module=1)
                  GET /api/spatial/house (rooms → LOCATIONs, every 5 min)
                  GET /api/screen/state  (the catch-up: the story's heart vars)
                  mod feed  sim directive `cue X`, lifecycle
                  POST /api/mod/lights/devices (Z2M's device list, reduced)
         │
         ▼
    this module ── MQTT on this Mac's broker (Zigbee2MQTT's)
                   ├─ looks: `cue heart_wake` → looks.heart_wake → timed steps
                   │   zigbee2mqtt/<device>/set · <wled>/api, safety-clamped
                   ├─ tests: identify a fixture, play a look, publish one state
                   ├─ pairing: zigbee2mqtt/bridge/request/permit_join {"time": N}
                   ├─ zigbee2mqtt/bridge/{devices,groups,state} → the server
                   └─ health/lights (online / LWT lost) + health/lights/stats

**The sequencer.** A look plans (`plan.py`, the `planLook` mirror) into
timed commands; one asyncio task per look publishes them at their offsets
(`repeat` times, or every `period` for a loop). A new look on a fixture
takes that fixture away from whatever ran there: the old look keeps going on
its other fixtures only, and a `restore` it owed that fixture is dropped.
A `then: "restore"` look (D20) gives the light back at `period`: it restarts
the loop it interrupted on that fixture (a nag over the door loop), else
re-publishes the fixture's **settled** state — the state the last look that
is neither looping nor `restore` leaves it in (its commands merged in order,
taken when it starts, the last `transition` kept so the give-back fades —
0.8 s when it had none). Memory only; never a loop's step, never a restore.

**The catch-up (D21) reads the story, never a cache.** On module start, on
every MQTT or feed (re)connect, and 1.5 s after a `lifecycle` reset /
reload / golive, `GET /api/screen/state` and play: `night.alarm_on` →
`heart_alarm`; else the door open in `door` / `scan` / `talk` →
`heart_door_open`; else `night.heart_look`; else `boot`. An older server (a
404, no such fields) → `boot`. A live cue that lands while the state is read
wins (the catch-up then plays nothing).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import socket
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from ..modapi import ModApiError, ModClient, run_stream
from ..module import ConfigError, Context
from .config import LightsSectionConfig, parse_lights_section
from .plan import Command, Plan, ordered, plan_look
from .routing import LIGHTS_FILE, LightsDoc, LightsDocError, parse_lights
from .z2m import (
    bridge_online,
    identify_payload,
    light_topic,
    payload_for,
    permit_join_payload,
    permit_join_topic,
    reduce_devices,
)

log = logging.getLogger("stagehand.lights")

HEALTH_TOPIC = "health/lights"
STATS_TOPIC = "health/lights/stats"
RESTART_KINDS = ("reset", "reload", "golive")
LIFECYCLE_CATCH_UP_DELAY_S = 1.5
HOUSE_REFRESH_S = 300.0
#: Z2M's device list settles for this long before it goes to the server.
DEVICES_DEBOUNCE_S = 2.0
#: A WLED identify blinks this long, then the fixture's settled state comes back.
WLED_IDENTIFY_MS = 2000
#: A restore look gives the settled state back over this many seconds when it carried no `transition` (§4's swells).
RESTORE_FADE_S = 0.8
#: The heart stages in which an open door plays the door loop (D21).
DOOR_STAGES = ("door", "scan", "talk")
ALARM_LOOK = "heart_alarm"
DOOR_LOOK = "heart_door_open"


def build_lights(section: Any, base_dir: str) -> "HouseLights":
    try:
        return HouseLights(parse_lights_section(section, base_dir))
    except ConfigError:
        raise
    except ValueError as err:
        raise ConfigError(f"lights: {err}") from err


class Timer(Protocol):
    def now(self) -> float:
        """Milliseconds on a monotonic clock."""
        ...

    async def sleep_until(self, ms: float) -> None: ...


class RealTimer:
    def now(self) -> float:
        return time.monotonic() * 1000.0

    async def sleep_until(self, ms: float) -> None:
        delay = (ms - self.now()) / 1000.0
        await asyncio.sleep(max(0.0, delay))


def cue_name(args: Any) -> str:
    """A `cue` directive's first token (`heart_wake`, `lights_y2k, …`)."""
    parts = re.split(r"[\s,]+", str(args or "").strip(), maxsplit=1)
    return parts[0] if parts else ""


def catch_up_look(answer: Any, doc: LightsDoc | None) -> tuple[str | None, str]:
    """D21: the look the story's screen state says the room should show, and why."""
    boot = doc.boot if doc is not None else None
    night = answer.get("night") if isinstance(answer, dict) else None
    if not isinstance(night, dict) or not any(k in night for k in ("alarm_on", "server_door", "heart_stage", "heart_look")):
        return boot, "boot (no heart vars on this server)"
    if night.get("alarm_on") is True:
        return ALARM_LOOK, "the patch-bay alarm"
    if night.get("server_door") == "open" and night.get("heart_stage") in DOOR_STAGES:
        return DOOR_LOOK, f"the door is open ({night.get('heart_stage')})"
    look = night.get("heart_look")
    if isinstance(look, str) and look not in ("", "none"):
        spec = doc.look(look) if doc is not None else None
        if isinstance(spec, dict) and spec.get("then") == "restore":
            # A nag / warn gives back a settled state nobody holds after a restart.
            return boot, f"boot (the story's {look} only gives the light back)"
        return look, "the story's heart look"
    return boot, "boot"


@dataclass
class Run:
    """One look playing: the fixtures it still owns and what it owes them."""

    name: str
    plan: Plan
    owned: set[str]
    #: `restore` looks: per fixture, the looping look to restart (None: settled).
    resume: dict[str, str | None] = field(default_factory=dict)
    task: asyncio.Task | None = None

    @property
    def done(self) -> bool:
        return self.task is not None and self.task.done()


class HouseLights:
    name = "lights"

    def __init__(self, cfg: LightsSectionConfig, *, timer: Timer | None = None) -> None:
        self.cfg = cfg
        self.timer: Timer = timer or RealTimer()
        self.doc: LightsDoc | None = None
        self.version: str | None = None
        self.source = "none"
        self.house: Any = None
        self.mqtt: Any = None
        self.mod: ModClient | None = None
        self.catch_up_delay_s = LIFECYCLE_CATCH_UP_DELAY_S
        self.devices_debounce_s = DEVICES_DEBOUNCE_S
        #: fixture id → the run that owns it.
        self.running: dict[str, Run] = {}
        #: fixture id → its settled state (memory only).
        self.settled: dict[str, dict] = {}
        self.last_look: str | None = None
        self.last_at: float | None = None
        self.played = 0
        self.unknown_cues: set[str] = set()
        # Server cursors: tests and pairs (seq + server ms), primed by the first answer.
        self.test_seq = 0
        self.test_at = -1.0
        self.pair_seq = 0
        self.pair_at = -1.0
        self._primed = False
        # Zigbee2MQTT's side.
        self.z2m: str = "offline"
        self._raw_devices: Any = None
        self._raw_groups: Any = None
        self._devices_task: asyncio.Task | None = None
        self.devices_posted = 0
        self.device_names: set[str] = set()
        self._catch_up_task: asyncio.Task | None = None
        self._live_cues = 0
        self._tasks: set[asyncio.Task] = set()

    # -- describe / check ------------------------------------------------------

    def describe(self) -> list[str]:
        cfg = self.cfg
        doc = self._local_doc()
        return [
            f"mqtt     : {cfg.mqtt.host}:{cfg.mqtt.port} (Zigbee2MQTT base {cfg.z2m_base})",
            f"config   : the server's lights.json (long-poll {cfg.poll_wait:.0f}s)" + (f"; local {cfg.config_file}" if cfg.config_file else "") + f"; cache {cfg.cache_dir}",
            f"fixtures : {len(doc.fixtures)} · looks {len(doc.looks)}" + (f" · boot {doc.boot}" if doc and doc.boot else "") if doc else "fixtures : — (no local lights.json yet: the server's)",
            f"show     : {'drops its YAML cue rules for these looks' if cfg.take_looks else 'keeps its YAML cue rules (take_looks: false)'}",
        ]

    def _local_doc(self) -> LightsDoc | None:
        for path in (self._cache_path(LIGHTS_FILE), self.cfg.config_file):
            raw = self._read_json(path)
            if raw is None:
                continue
            try:
                return parse_lights(raw)
            except LightsDocError:
                continue
        return None

    def preflight(self) -> list[str]:
        """`stagehand check --only lights`: config valid, broker reachable,
        Z2M online, every fixture's device in Z2M's device list."""
        problems: list[str] = []
        if self.cfg.config_file:
            raw = self._read_json(self.cfg.config_file)
            if raw is None:
                problems.append(f"lights.config_file {self.cfg.config_file} is missing or not JSON")
            else:
                try:
                    parse_lights(raw)
                except LightsDocError as err:
                    problems.append(f"lights.config_file: {err}")
        probe = probe_broker(self.cfg)
        if probe is None:
            problems.append(f"no MQTT broker at {self.cfg.mqtt.host}:{self.cfg.mqtt.port} (is Mosquitto running on this machine?)")
            return problems
        state, devices = probe
        if state is not True:
            problems.append(f"Zigbee2MQTT is not online ({self.cfg.z2m_base}/bridge/state: {'offline' if state is False else 'nothing retained'}) — scripts/house-desktop/README.md §3 on Windows, scripts/house-macbook/zigbee.md on a Mac")
        doc = self._local_doc()
        if doc is not None and devices is not None:
            names = {d["friendly"] for d in devices}
            for f in doc.fixtures:
                if f.get("kind") in ("zigbee", "zigbee-group") and f["device"] not in names:
                    problems.append(f"fixture {f['id']}: no Zigbee2MQTT device or group named {f['device']!r} (rename it in the Z2M frontend, or fix lights.json)")
        return problems

    def warnings(self) -> list[str]:
        if self._local_doc() is None:
            return ["no lights.json on this Mac yet (no cache, no config_file): the module plays the server's once it answers"]
        return []

    # -- files -----------------------------------------------------------------

    def _cache_path(self, name: str) -> str:
        return os.path.join(self.cfg.cache_dir, name)

    @staticmethod
    def _read_json(path: str | None) -> Any:
        if not path:
            return None
        try:
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return None

    def _write_json(self, name: str, doc: Any) -> None:
        try:
            os.makedirs(self.cfg.cache_dir, exist_ok=True)
            tmp = self._cache_path(name + ".tmp")
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(doc, fh)
            os.replace(tmp, self._cache_path(name))
        except OSError as err:
            log.warning("could not cache %s (%s)", name, err)

    def load_local(self) -> bool:
        """Before the server answers: the cache, else `config_file`."""
        for path, source in ((self._cache_path(LIGHTS_FILE), "cache"), (self.cfg.config_file, "file")):
            raw = self._read_json(path)
            if raw is None:
                continue
            try:
                self.doc = parse_lights(raw)
            except LightsDocError as err:
                log.warning("ignored the %s lights.json (%s)", source, err)
                continue
            self.source = source
            break
        house = self._read_json(self._cache_path("house.json")) or self._read_json(self.cfg.house_file)
        if house is not None:
            self.house = house
        return self.doc is not None

    def apply(self, answer: dict, persist: bool = True) -> bool:
        """A `LightsView` → the config in force (the old one kept on a bad doc)."""
        try:
            doc = parse_lights(answer.get("lights"))
        except LightsDocError as err:
            log.error("the server's lights.json is unusable (%s) — keeping the last one", err)
            return False
        changed = str(answer.get("version")) != self.version
        self.doc = doc
        self.version = str(answer.get("version"))
        self.source = str(answer.get("source") or "server")
        if changed and persist:
            self._write_json(LIGHTS_FILE, doc.as_json())
            log.info("lights.json %s (%s): %d fixture(s), %d look(s)", self.version, self.source, len(doc.fixtures), len(doc.looks))
        return changed

    def set_house(self, house: Any, persist: bool = True) -> None:
        if isinstance(house, dict):
            self.house = house
            if persist:
                self._write_json("house.json", house)

    # -- publishing --------------------------------------------------------------

    def publish(self, topic: str, payload: dict) -> None:
        if self.mqtt is None:
            log.warning("no broker: dropped %s %s", topic, json.dumps(payload))
            return
        self.mqtt.publish(topic, json.dumps(payload))

    def _send(self, fid: str, state: dict) -> None:
        f = self.doc.fixture(fid) if self.doc is not None else None
        if f is None:
            return
        self.publish(light_topic(f, self.cfg.z2m_base), payload_for(f, state))

    # -- the sequencer -------------------------------------------------------------

    def _spawn(self, coro) -> asyncio.Task:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def play(self, name: str, only: set[str] | None = None, why: str = "cue") -> bool:
        """Start a look (on `only` of its fixtures when given). → False when
        no such look (or it reaches nothing)."""
        if self.doc is None:
            return False
        plan = plan_look(self.doc, self.house, name)
        if plan is None:
            return False
        fixtures = {c.fixture for c in plan.commands}
        if only is not None:
            fixtures &= only
        if not fixtures:
            return False
        run = Run(name=name, plan=plan, owned=set(fixtures))
        for fid in fixtures:
            prev = self.running.get(fid)
            live = prev is not None and not prev.done and fid in prev.owned
            if plan.restore:
                if live and prev.plan.restore:
                    run.resume[fid] = prev.resume.get(fid)  # a nag over a nag: still the loop underneath
                elif live and prev.plan.loop:
                    run.resume[fid] = prev.name
                else:
                    run.resume[fid] = None
            if prev is not None:
                prev.owned.discard(fid)
                prev.resume.pop(fid, None)
                if not prev.owned and prev.task is not None and not prev.task.done():
                    prev.task.cancel()
            self.running[fid] = run
            if not plan.loop and not plan.restore:
                merged: dict = dict(self.settled.get(fid) or {})
                for c in plan.commands:
                    if c.fixture == fid:
                        merged.update(c.set)
                self.settled[fid] = ordered(merged)  # the last command's `transition` kept: a give-back fades
        run.task = self._spawn(self._run(run))
        self.last_look, self.last_at = name, time.time()
        self.played += 1
        log.info("look %s (%s) → %s%s", name, why, ", ".join(sorted(fixtures)), " (loop)" if plan.loop else " (gives the light back)" if plan.restore else "")
        return True

    async def _run(self, run: Run) -> None:
        plan = run.plan
        start = self.timer.now()
        reps = 0
        try:
            while plan.repeat == 0 or reps < plan.repeat:
                base = start + reps * plan.period
                for c in plan.commands:
                    await self.timer.sleep_until(base + c.at)
                    if c.fixture in run.owned:
                        self._send(c.fixture, c.set)
                reps += 1
                if not run.owned:
                    return
                if plan.repeat == 0 and not plan.commands:
                    return
            if plan.restore:
                await self.timer.sleep_until(start + plan.period)
                self._give_back(run)
        except asyncio.CancelledError:
            pass

    def _give_back(self, run: Run) -> None:
        """A `restore` look's end: the loop it interrupted, else the settled
        state, else (nothing settled since a restart) the `boot` look."""
        loops: dict[str, set[str]] = {}
        unsettled: set[str] = set()
        for fid in sorted(run.owned):
            loop = run.resume.get(fid)
            if loop is not None and self.doc is not None and self.doc.look(loop) is not None:
                loops.setdefault(loop, set()).add(fid)
            else:
                state = self.settled.get(fid)
                if state:
                    self._send(fid, {**state, "transition": state.get("transition", RESTORE_FADE_S)})
                else:
                    unsettled.add(fid)
                if self.running.get(fid) is run:
                    del self.running[fid]
        run.owned.clear()
        for loop, fids in loops.items():
            self.play(loop, only=fids, why="given back")
        boot = self.doc.boot if self.doc is not None else None
        if unsettled and boot and boot != run.name:
            spec = self.doc.look(boot)
            if isinstance(spec, dict) and spec.get("then") != "restore":
                self.play(boot, only=unsettled, why="given back (boot)")

    def stop_all(self) -> None:
        """A story restart: every look stops and the settled states are forgotten."""
        for run in {id(r): r for r in self.running.values()}.values():
            run.owned.clear()
            if run.task is not None and not run.task.done():
                run.task.cancel()
        self.running.clear()
        self.settled.clear()

    # -- tests / identify / pairing --------------------------------------------------

    def run_test(self, test: dict) -> str:
        """One map-editor test: `{look}` plays it; `{fixture}` identifies;
        `{fixture, set}` publishes that state (clamped)."""
        if self.doc is None:
            return "no lights.json"
        look, fid, state = test.get("look"), test.get("fixture"), test.get("set")
        if isinstance(look, str):
            return f"look {look}" if self.play(look, why=f"test by {test.get('by') or '?'}") else f"no look {look}"
        f = self.doc.fixture(fid) if isinstance(fid, str) else None
        if f is None:
            return f"no fixture {fid}"
        if isinstance(state, dict):
            self._send(f["id"], {k: v for k, v in state.items() if v is not None})
            return f"set {f['id']}"
        self.publish(light_topic(f, self.cfg.z2m_base), identify_payload(f))
        if f.get("kind") == "wled":
            self._spawn(self._wled_identify_end(f["id"]))
        return f"identify {f['id']}"

    async def _wled_identify_end(self, fid: str) -> None:
        await self.timer.sleep_until(self.timer.now() + WLED_IDENTIFY_MS)
        state = self.settled.get(fid)
        self._send(fid, state if state else {"effect": "stop_effect"})

    def pair(self, seconds: int) -> None:
        self.publish(permit_join_topic(self.cfg.z2m_base), permit_join_payload(seconds))
        log.info("Zigbee pairing %s", f"open for {seconds} s" if seconds > 0 else "closed")

    def take(self, answer: dict, immediate: bool = False) -> tuple[list[dict], dict | None]:
        """The tests and the pair in a poll answer that are new to this module.
        The first answer only primes the cursors (nothing old is replayed)."""
        tests = [t for t in answer.get("tests") or [] if isinstance(t, dict) and isinstance(t.get("seq"), int)]
        pair = answer.get("pair") if isinstance(answer.get("pair"), dict) else None
        new_tests: list[dict] = []
        new_pair: dict | None = None
        if self._primed:
            new_tests = [t for t in tests if t["seq"] > self.test_seq or float(t.get("at") or 0) > self.test_at]
            if pair is not None and isinstance(pair.get("seq"), int) and (pair["seq"] > self.pair_seq or float(pair.get("at") or 0) > self.pair_at):
                new_pair = pair
        self._primed = True
        if tests:
            self.test_seq = max(t["seq"] for t in tests)
            self.test_at = max(self.test_at, max(float(t.get("at") or 0) for t in tests))
        elif immediate:
            self.test_seq = 0  # a restarted server answers a stale cursor at once
        if pair is not None and isinstance(pair.get("seq"), int):
            self.pair_seq = pair["seq"]
            self.pair_at = max(self.pair_at, float(pair.get("at") or 0))
        elif immediate:
            self.pair_seq = 0
        return new_tests, new_pair

    # -- the catch-up -------------------------------------------------------------

    def schedule_catch_up(self, why: str, delay: float = 0.0) -> None:
        if self._catch_up_task is not None and not self._catch_up_task.done():
            self._catch_up_task.cancel()
        self._catch_up_task = self._spawn(self.catch_up(why, delay))

    async def catch_up(self, why: str, delay: float = 0.0) -> str | None:
        if delay > 0:
            await asyncio.sleep(delay)
        if self.mod is None:
            return None
        if self.mqtt is not None and hasattr(self.mqtt, "connected") and not self.mqtt.connected.is_set():
            try:
                await asyncio.wait_for(self.mqtt.connected.wait(), 10.0)
            except asyncio.TimeoutError:
                log.warning("catch-up (%s) skipped: the broker is not connected (its reconnect catches up)", why)
                return None
        seen = self._live_cues
        answer: Any = None
        try:
            answer = await self.mod.get("/api/screen/state")
        except ModApiError as err:
            if err.status != 404:
                log.warning("catch-up (%s) failed: %s", why, err)
                return None
        except (httpx.HTTPError, OSError, ValueError) as err:
            log.warning("catch-up (%s) failed: %s", why, err)
            return None
        if self._live_cues != seen:
            log.info("catch-up (%s) skipped: a live cue arrived while the state was read", why)
            return None
        look, reason = catch_up_look(answer, self.doc)
        if look is None:
            return None
        if self.play(look, why=f"catch-up {why}: {reason}"):
            return look
        return None

    # -- the feed -------------------------------------------------------------------

    def on_sim(self, event: Any) -> str | None:
        if not isinstance(event, dict) or event.get("type") != "directive" or event.get("verb") != "cue":
            return None
        name = cue_name(event.get("args"))
        if self.doc is None or self.doc.look(name) is None:
            return None
        self._live_cues += 1
        return name if self.play(name) else None

    def on_lifecycle(self, doc: Any) -> None:
        kind = str(doc.get("kind", "")) if isinstance(doc, dict) else ""
        if kind in RESTART_KINDS:
            log.info("lifecycle %s: every look stops; the catch-up in %.1fs", kind, self.catch_up_delay_s)
            self.stop_all()
            self.schedule_catch_up(kind, delay=self.catch_up_delay_s)

    # -- Zigbee2MQTT's device list ------------------------------------------------------

    def on_mqtt(self, topic: str, raw: bytes) -> None:
        base = self.cfg.z2m_base
        if topic == f"{base}/bridge/state":
            ok = bridge_online(raw)
            if ok is not None:
                self.z2m = "online" if ok else "offline"
            return
        if topic not in (f"{base}/bridge/devices", f"{base}/bridge/groups"):
            return
        try:
            doc = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return
        if topic.endswith("/devices"):
            self._raw_devices = doc
        else:
            self._raw_groups = doc
        self.device_names = {d["friendly"] for d in self.devices()}
        self.schedule_devices()

    def devices(self) -> list[dict]:
        return reduce_devices(self._raw_devices, self._raw_groups)

    def schedule_devices(self, delay: float | None = None) -> None:
        if self._raw_devices is None:
            return
        if self._devices_task is not None and not self._devices_task.done():
            self._devices_task.cancel()
        self._devices_task = self._spawn(self._post_devices(self.devices_debounce_s if delay is None else delay))

    async def _post_devices(self, delay: float) -> None:
        if delay > 0:
            await asyncio.sleep(delay)
        if self.mod is None:
            return
        devices = self.devices()
        try:
            await self.mod.post("/api/mod/lights/devices", {"devices": devices})
        except ModApiError as err:
            if err.status != 404:
                log.warning("posting the Zigbee device list failed (%s)", err)
            return
        except (httpx.HTTPError, OSError) as err:
            log.warning("posting the Zigbee device list failed (%s)", err)
            return
        self.devices_posted += 1
        log.info("Zigbee2MQTT: %d device(s) / group(s) sent to the server", len(devices))

    # -- health ------------------------------------------------------------------------

    def stats(self) -> dict[str, Any]:
        return {
            "fixtures": len(self.doc.fixtures) if self.doc else 0,
            "looks": len(self.doc.looks) if self.doc else 0,
            "devices": len(self.device_names),
            "last_look": self.last_look,
            "last_at": self.last_at,
            "z2m": self.z2m,
        }

    async def _health_loop(self) -> None:
        while True:
            await asyncio.sleep(self.cfg.health_s)
            if self.mqtt is not None:
                self.mqtt.publish(STATS_TOPIC, json.dumps(self.stats()), retain=True)

    # -- loops ---------------------------------------------------------------------------

    async def _config_loop(self, mod: ModClient) -> None:
        backoff = 1.0
        missing_route = False
        first = True
        while True:
            params: dict[str, Any] = {"module": 1, "name": socket.gethostname().split(".")[0][:64]}
            if self.version is not None and self.source not in ("cache", "file", "none"):
                params.update({"after": self.version, "tests": self.test_seq, "pairs": self.pair_seq, "wait": int(self.cfg.poll_wait)})
            asked = time.monotonic()
            try:
                answer = await mod.get("/api/mod/lights", params, timeout=self.cfg.poll_wait + 15)
            except ModApiError as err:
                if err.status == 404:
                    if not missing_route:
                        log.error("the server has no /api/mod/lights (an older release) — playing the local lights.json")
                        missing_route = True
                    if first:
                        first = False
                        self.schedule_catch_up("start")
                    await asyncio.sleep(60)
                    continue
                log.warning("lights.json poll refused (%s) — retrying in %.0fs", err, backoff)
            except (httpx.HTTPError, OSError, ValueError) as err:
                log.warning("lights.json poll failed (%s) — retrying in %.0fs", err or type(err).__name__, backoff)
            else:
                backoff = 1.0
                missing_route = False
                quick = time.monotonic() - asked < 1.0 and "after" in params
                changed = self.apply(answer)
                tests, pair = self.take(answer, immediate=quick)
                if first:
                    first = False
                    self.schedule_catch_up("start")
                for t in tests:
                    log.info("test: %s", self.run_test(t))
                if pair is not None:
                    self.pair(int(pair.get("seconds") or 0))
                if changed:
                    self._spawn(self._refresh_house(mod))
                if answer.get("devicesAt") is None and self._raw_devices is not None:
                    self.schedule_devices(0)
                if quick and not tests and pair is None and not changed:
                    await asyncio.sleep(5.0)  # a server answering at once must not be hammered
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

        await run_stream(mod, mod.feed_url("stagehand-lights"), on_frame, label="lights feed", on_connect=lambda: self.schedule_catch_up("feed"))

    async def _mqtt_loop(self) -> None:
        assert self.mqtt is not None
        while True:
            topic, raw, _retained = await self.mqtt.queue.get()
            self.on_mqtt(topic, raw)

    async def run(self, ctx: Context) -> None:
        from ..show.mqtt import MqttBridge

        self.mod = ctx.mod
        loop = asyncio.get_running_loop()
        if self.load_local():
            log.info("playing the %s lights.json until the server answers", self.source)
        m = self.cfg.mqtt
        base = self.cfg.z2m_base
        self.mqtt = MqttBridge(
            m.host,
            m.port,
            filters=[f"{base}/bridge/state", f"{base}/bridge/devices", f"{base}/bridge/groups"],
            loop=loop,
            client_id=m.client_id,
            username=m.username,
            password=m.password,
            health_topic=HEALTH_TOPIC,
        )
        self.mqtt.on_connected = lambda: self.schedule_catch_up("mqtt")
        self.mqtt.start()
        tasks = [
            asyncio.ensure_future(self._config_loop(ctx.mod)),
            asyncio.ensure_future(self._house_loop(ctx.mod)),
            asyncio.ensure_future(self._feed_loop(ctx.mod)),
            asyncio.ensure_future(self._mqtt_loop()),
            asyncio.ensure_future(self._health_loop()),
        ]
        try:
            await asyncio.gather(*tasks)
        finally:
            for t in [*tasks, *self._tasks]:
                t.cancel()
            await asyncio.gather(*tasks, *self._tasks, return_exceptions=True)
            self.running.clear()
            if self.mqtt is not None:
                self.mqtt.stop()
                self.mqtt = None


def probe_broker(cfg: LightsSectionConfig, timeout: float = 2.0) -> tuple[bool | None, list[dict] | None] | None:
    """`stagehand check`: connect, read Z2M's retained bridge state + device
    list. → None (no broker), else (online?, devices or None)."""
    import threading

    import paho.mqtt.client as mqtt

    base = cfg.z2m_base
    got: dict[str, bytes] = {}
    done = threading.Event()
    want = {f"{base}/bridge/state", f"{base}/bridge/devices"}
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"{cfg.mqtt.client_id}-check")
    if cfg.mqtt.username:
        client.username_pw_set(cfg.mqtt.username, cfg.mqtt.password)

    def on_connect(c, _u, _f, rc, _p=None):
        if getattr(rc, "is_failure", False):
            done.set()
            return
        for t in want:
            c.subscribe(t)

    def on_message(_c, _u, msg):
        got[msg.topic] = msg.payload
        if want <= set(got):
            done.set()

    client.on_connect, client.on_message = on_connect, on_message
    try:
        client.connect(cfg.mqtt.host, cfg.mqtt.port, keepalive=10)
    except OSError:
        return None
    client.loop_start()
    try:
        done.wait(timeout)
    finally:
        client.loop_stop()
        client.disconnect()
    state = bridge_online(got[f"{base}/bridge/state"]) if f"{base}/bridge/state" in got else None
    devices = None
    if f"{base}/bridge/devices" in got:
        try:
            devices = reduce_devices(json.loads(got[f"{base}/bridge/devices"].decode("utf-8")))
        except (UnicodeDecodeError, ValueError):
            devices = None
    return state, devices


__all__ = ["HouseLights", "build_lights", "catch_up_look", "cue_name", "Command"]
