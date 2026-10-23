//! `lights.json` (wave 20) — the house lights the story drives: every placed
//! fixture (a Zigbee bulb, a Zigbee2MQTT group, a WLED strip) on a
//! `house.json` room + a position, zones of fixtures, and the **looks** a
//! story `cue X` plays (`cue heart_wake` plays `looks.heart_wake`): one
//! command or a few timed steps, played once, a few times, in a loop, or
//! once and then giving the light back (`then: "restore"`).
//!
//! A project file of its own beside `audio.json`, never part of `house.json`:
//! placing a bulb mid-show must not bump the map version, and the tent / shed
//! map variants share one physical house.
//!
//! Zigbee bulbs drop commands sent too fast and look terrible flickering, so
//! the schema keeps steps ≥ `LIGHT_STEP_MIN_MS` apart per fixture (≥
//! `LIGHT_COLOR_STEP_MIN_MS` for a colour change) and warns about a fast
//! loop. A **safety** fixture is never OFF and never below its floor:
//! `validateLights` refuses a look written that way and `clampForSafety`
//! (applied by `planLook` and both payload builders) lifts anything else.
//!
//! `validateLights` refuses a broken file (`problems`) and advises on a valid
//! one (`warnings`); with a house it checks every fixture's room, floor and
//! position (the house frame is absolute: the basement is at −2.7 m).
//! `resolveLightTargets` turns a look's `to` list into fixtures and `planLook`
//! a look into timed, clamped commands; stagehand's `lights` module mirrors
//! both in Python, pinned by the shared fixtures
//! `house/test/fixtures/lights-*.json`. Pure, no `node:` imports.

import { foldTarget } from "./audio.ts";
import { fnv1a32 } from "./duck.ts";
import { distanceToBoundary, pointInPoly } from "./geometry.ts";
import type { HouseMap } from "./types.ts";

/** The project file's name. */
export const LIGHTS_FILE = "lights.json";
/** The implicit target of every fixture (no fixture or zone may take it). */
export const LIGHTS_EVERYWHERE = "everywhere";
export const LIGHT_KINDS = ["zigbee", "zigbee-group", "wled"] as const;
export type LightKind = (typeof LIGHT_KINDS)[number];
export const LIGHT_EFFECTS = ["blink", "breathe", "okay", "channel_change", "finish_effect", "stop_effect"] as const;
export type LightEffect = (typeof LIGHT_EFFECTS)[number];
/** Zigbee bulbs drop commands sent faster than this (ms between steps on one fixture). */
export const LIGHT_STEP_MIN_MS = 150;
/** A step that sets `color` / `color_temp` is 2–3 Zigbee commands: at least this far from the fixture's previous step. */
export const LIGHT_COLOR_STEP_MIN_MS = 400;
/** A looping look on a `zigbee` / `zigbee-group` fixture with a shorter period is a warning (never stream flicker over Zigbee). */
export const LIGHT_LOOP_MIN_PERIOD_MS = 1500;
/** How long after a `then: "restore"` look's last step the settled state comes back (ms; the look's `period` overrides). */
export const LIGHT_RESTORE_MS = 1000;
/** Longest look, steps included (ms), and the most steps. */
export const LIGHT_LOOK_MAX_MS = 120_000;
export const LIGHT_MAX_STEPS = 64;
/** A safety fixture's floor (Z2M brightness 0–254) unless its own `min` is higher. */
export const LIGHT_SAFETY_MIN = 40;
/** Cue families a look name may never start with (they are the screens'). */
export const LIGHT_RESERVED_PREFIXES = ["screens_", "terminals_", "tv_", "tablet_", "room_"] as const;
/** How far outside its room a fixture may stand in plan (as a speaker). */
export const LIGHT_SPOT_TOLERANCE = 0.05;
/** How high above the top floor a fixture may hang (m). */
export const LIGHT_TOP_HEADROOM = 4;
/** The most a look may repeat. */
export const LIGHT_MAX_REPEAT = 100;

/** What a fixture can do (a field it can't is dropped from every command). */
export interface LightCaps {
  color: boolean;
  ct: boolean;
  dim: boolean;
}

export interface LightFixture {
  /** `^[a-z0-9][a-z0-9-]*$`. */
  id: string;
  name: string;
  /** A `house.json` room id. */
  room: string;
  /** The room's floor id (informational; checked against the room). */
  floor?: string;
  /** Metres, the house frame (absolute: Y up, the basement below 0). */
  pos: { x: number; y: number; z: number };
  kind: LightKind;
  /** Z2M friendly name (zigbee), Z2M group friendly name (zigbee-group), or the WLED base topic (`wled/server`). */
  device: string;
  caps: LightCaps;
  /** Never OFF, never below `min ?? LIGHT_SAFETY_MIN`. */
  safety?: boolean;
  /** 1–254. */
  min?: number;
}

export interface LightZone {
  id: string;
  name: string;
  fixtures: string[];
}

/** One command to one or more fixtures, in Z2M's words. */
export interface LightState {
  state?: "ON" | "OFF";
  /** 0–254. */
  brightness?: number;
  /** `#rrggbb`. */
  color?: string;
  /** Mireds 150–500. */
  color_temp?: number;
  effect?: LightEffect;
  /** Seconds 0–30. */
  transition?: number;
}

export interface LightStep {
  /** ms from the look's start, strictly increasing per fixture, ≥ 150 apart. */
  at: number;
  set: LightState;
  /** Narrower targets than the look's (default: the look's). */
  to?: string[];
}

export interface LightLook {
  /** Targets (`resolveLightTargets`). */
  to: string[];
  /** One command at t = 0 (shorthand for `steps: [{at: 0, set}]`). */
  set?: LightState;
  steps?: LightStep[];
  /** Repeat the steps this many times (1 = once; default 1); `loop: true` = until another look. */
  repeat?: number;
  loop?: boolean;
  /** The step period when repeating (ms; default last step's `at` + 150). For
   *  `then: "restore"`: the delay from the start to the restore (default last
   *  step's `at` + `LIGHT_RESTORE_MS`). */
  period?: number;
  /** (D20) `"restore"`: after the look, re-publish each fixture's settled
   *  state; the look never becomes it. Not with `loop`. */
  then?: "restore";
  note?: string;
}

export interface LightsConfig {
  version: 1;
  note?: string;
  fixtures: LightFixture[];
  zones: LightZone[];
  /** Keyed by the story's cue name: `cue heart_wake` plays `looks.heart_wake`. */
  looks: Record<string, LightLook>;
  /** Applied by the module on boot and after a story reset (optional). */
  boot?: string;
}

export interface LightsValidation {
  ok: boolean;
  problems: string[];
  warnings: string[];
}

/** What a target list reaches: fixture ids, in file order. */
export interface LightTargets {
  fixtures: string[];
}

/** One timed command for one fixture, safety-clamped. */
export interface LightCommand {
  at: number;
  fixture: string;
  set: LightState;
}

export interface LightPlan {
  /** Sorted by `at`, then the fixtures' file order. */
  commands: LightCommand[];
  loop: boolean;
  /** The repeat period, or (a `restore` look) the delay to the restore (ms). */
  period: number | null;
  /** How many times the steps run: 0 = until another look (`loop`). */
  repeat: number;
  /** A `then: "restore"` look: give the light back at `period`. */
  restore: boolean;
}

/** A short content hash (8 hex digits) — the config's `version` on the wire. */
export function lightsHash(lights: LightsConfig): string {
  return fnv1a32(JSON.stringify(lights)).toString(16).padStart(8, "0");
}

/** A fresh config: nothing placed, no looks. */
export function defaultLights(): LightsConfig {
  return { version: 1, fixtures: [], zones: [], looks: {} };
}

/**
 * The fixtures a target list reaches. Each target is matched (folded, like
 * `foldTarget`) against, and reaches the union of: `everywhere` (every
 * fixture), a fixture id, a zone id or name, a room id (the fixtures whose
 * `room` it is), and — with a house — a room's label or a LOCATION (every
 * room whose `location` it is). A target that names nothing reaches nothing.
 * Fixtures come back in the file's order, de-duplicated.
 */
export function resolveLightTargets(lights: LightsConfig, house: HouseMap | null | undefined, to: readonly string[]): LightTargets {
  const hit = new Set<string>();
  const fixtures = Array.isArray(lights.fixtures) ? lights.fixtures : [];
  const zones = Array.isArray(lights.zones) ? lights.zones : [];
  const rooms = house?.rooms ?? [];
  for (const raw of to) {
    if (typeof raw !== "string") continue;
    const t = foldTarget(raw);
    if (t === "") continue;
    if (t === LIGHTS_EVERYWHERE) {
      for (const f of fixtures) hit.add(f.id);
      continue;
    }
    const roomIds = new Set<string>();
    for (const f of fixtures) {
      if (foldTarget(f.id) === t) hit.add(f.id);
      if (typeof f.room === "string" && foldTarget(f.room) === t) roomIds.add(f.room);
    }
    for (const z of zones) {
      if (foldTarget(z.id) === t || foldTarget(z.name) === t) for (const id of Array.isArray(z.fixtures) ? z.fixtures : []) hit.add(id);
    }
    for (const r of rooms) {
      if (foldTarget(r.id) === t || foldTarget(r.label) === t || (r.location !== undefined && foldTarget(r.location) === t)) roomIds.add(r.id);
    }
    for (const f of fixtures) if (roomIds.has(f.room)) hit.add(f.id);
  }
  const out: string[] = [];
  for (const f of fixtures) if (hit.has(f.id) && !out.includes(f.id)) out.push(f.id);
  return { fixtures: out };
}

/** A safety fixture's floor: its own `min` (1–254), else `LIGHT_SAFETY_MIN`. */
export function safetyMin(f: LightFixture): number {
  const m = f.min;
  return typeof m === "number" && Number.isInteger(m) && m >= 1 && m <= 254 ? m : LIGHT_SAFETY_MIN;
}

/**
 * A safety fixture never goes dark: `state: "OFF"` → `"ON"` at its floor,
 * a brightness under the floor → the floor. Anything else (and every state
 * on a non-safety fixture) is returned as given (a copy).
 */
export function clampForSafety(f: LightFixture, s: LightState): LightState {
  const out: LightState = { ...s };
  if (f.safety !== true) return out;
  const min = safetyMin(f);
  if (out.state === "OFF") {
    out.state = "ON";
    out.brightness = min;
  }
  if (out.brightness !== undefined && out.brightness < min) out.brightness = min;
  return ordered(out);
}

/** The fields a fixture's caps can't do, dropped. */
function forCaps(f: LightFixture, s: LightState): LightState {
  const out: LightState = { ...s };
  if (!f.caps?.color) delete out.color;
  if (!f.caps?.ct) delete out.color_temp;
  if (!f.caps?.dim) delete out.brightness;
  return out;
}

/** Does a state still do something (not just a transition)? */
function effective(s: LightState): boolean {
  return s.state !== undefined || s.brightness !== undefined || s.color !== undefined || s.color_temp !== undefined || s.effect !== undefined;
}

/** A state's keys in the one canonical order (the fixtures and the Python mirror compare it). */
function ordered(s: LightState): LightState {
  const out: LightState = {};
  if (s.state !== undefined) out.state = s.state;
  if (s.brightness !== undefined) out.brightness = s.brightness;
  if (s.color !== undefined) out.color = s.color;
  if (s.color_temp !== undefined) out.color_temp = s.color_temp;
  if (s.effect !== undefined) out.effect = s.effect;
  if (s.transition !== undefined) out.transition = s.transition;
  return out;
}

/** A look's steps (`set` is one step at 0). */
function stepsOf(look: LightLook): LightStep[] {
  if (Array.isArray(look.steps)) return look.steps;
  if (look.set !== undefined) return [{ at: 0, set: look.set }];
  return [];
}

/**
 * Expand a look into timed commands: each step over its targets (the
 * step's `to`, else the look's), the fields a fixture's caps can't do
 * dropped (a command left doing nothing is dropped too), safety-clamped,
 * sorted by `at` then the fixtures' file order. `period` = the look's, else
 * the last step's `at` + `LIGHT_STEP_MIN_MS` (a `restore` look:
 * + `LIGHT_RESTORE_MS`); `repeat` = 0 for a loop, else the look's (1).
 * Null for an unknown look.
 */
export function planLook(lights: LightsConfig, house: HouseMap | null | undefined, name: string): LightPlan | null {
  const looks = lights.looks ?? {};
  if (!Object.prototype.hasOwnProperty.call(looks, name)) return null;
  const look = looks[name]!;
  const byId = new Map((lights.fixtures ?? []).map((f, i) => [f.id, { f, i }]));
  const commands: Array<LightCommand & { order: number }> = [];
  const steps = stepsOf(look);
  let last = 0;
  for (const step of steps) {
    last = Math.max(last, step.at);
    const to = Array.isArray(step.to) ? step.to : look.to ?? [];
    for (const id of resolveLightTargets(lights, house, to).fixtures) {
      const hit = byId.get(id);
      if (hit === undefined) continue;
      const set = forCaps(hit.f, step.set ?? {});
      if (!effective(set)) continue;
      commands.push({ at: step.at, fixture: id, set: ordered(clampForSafety(hit.f, set)), order: hit.i });
    }
  }
  commands.sort((a, b) => a.at - b.at || a.order - b.order);
  const restore = look.then === "restore";
  const loop = look.loop === true;
  const period = look.period ?? last + (restore ? LIGHT_RESTORE_MS : LIGHT_STEP_MIN_MS);
  return { commands: commands.map(({ at, fixture, set }) => ({ at, fixture, set })), loop, period, repeat: loop ? 0 : (look.repeat ?? 1), restore };
}

/** The MQTT topic a fixture's commands go to (`base`: Z2M's base topic). */
export function lightTopic(f: LightFixture, base = "zigbee2mqtt"): string {
  return f.kind === "wled" ? `${f.device}/api` : `${base}/${f.device}/set`;
}

/**
 * A Zigbee2MQTT `/set` payload: the clamped state with only the set fields,
 * `color` as `{hex}`. (Topic: `zigbee2mqtt/<device>/set`.)
 */
export function z2mPayload(f: LightFixture, s: LightState): Record<string, unknown> {
  const c = ordered(clampForSafety(f, s));
  const out: Record<string, unknown> = {};
  if (c.state !== undefined) out["state"] = c.state;
  if (c.brightness !== undefined) out["brightness"] = c.brightness;
  if (c.color !== undefined) out["color"] = { hex: c.color };
  if (c.color_temp !== undefined) out["color_temp"] = c.color_temp;
  if (c.effect !== undefined) out["effect"] = c.effect;
  if (c.transition !== undefined) out["transition"] = c.transition;
  return out;
}

/** WLED's effect ids for the two effects it shares with Zigbee; any other effect is solid (0). */
const WLED_FX: Partial<Record<LightEffect, number>> = { blink: 1, breathe: 2 };

/**
 * A WLED JSON API payload (topic `<device>/api`): `on`, `bri`, `transition`
 * (tenths of a second) and one segment's `col` / `fx`, only the set fields
 * (`color_temp` has no WLED twin here and is dropped). Clamped.
 */
export function wledPayload(f: LightFixture, s: LightState): Record<string, unknown> {
  const c = ordered(clampForSafety(f, s));
  const out: Record<string, unknown> = {};
  if (c.state !== undefined) out["on"] = c.state !== "OFF";
  if (c.brightness !== undefined) out["bri"] = c.brightness;
  if (c.transition !== undefined) out["transition"] = Math.round(c.transition * 10);
  const seg: Record<string, unknown> = {};
  if (c.color !== undefined) {
    const hex = c.color.slice(1);
    seg["col"] = [[parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]];
  }
  if (c.effect !== undefined) seg["fx"] = WLED_FX[c.effect] ?? 0;
  if (Object.keys(seg).length > 0) out["seg"] = [seg];
  return out;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const ID_RE = /^[a-z0-9][a-z0-9-]*$/u;
const LOOK_RE = /^[a-z][a-z0-9_]*$/u;
const HEX_RE = /^#[0-9a-fA-F]{6}$/u;
const STATE_KEYS = new Set(["state", "brightness", "color", "color_temp", "effect", "transition"]);

/** The problems with one `LightState` (`at`: where, for the message). */
function stateProblems(at: string, s: unknown): string[] {
  const p: string[] = [];
  if (!isObj(s)) return [`${at} must be an object {state?, brightness?, color?, color_temp?, effect?, transition?}`];
  for (const k of Object.keys(s)) if (!STATE_KEYS.has(k)) p.push(`${at}: unknown field "${k}"`);
  if (s["state"] !== undefined && s["state"] !== "ON" && s["state"] !== "OFF") p.push(`${at}.state must be "ON" or "OFF"`);
  if (s["brightness"] !== undefined && (!isInt(s["brightness"]) || s["brightness"] < 0 || s["brightness"] > 254)) p.push(`${at}.brightness must be a whole number from 0 to 254`);
  if (s["color"] !== undefined && (!isStr(s["color"]) || !HEX_RE.test(s["color"]))) p.push(`${at}.color must be "#rrggbb"`);
  if (s["color_temp"] !== undefined && (!isInt(s["color_temp"]) || s["color_temp"] < 150 || s["color_temp"] > 500)) p.push(`${at}.color_temp must be mireds from 150 to 500`);
  if (s["color"] !== undefined && s["color_temp"] !== undefined) p.push(`${at} sets both color and color_temp`);
  if (s["effect"] !== undefined && !(LIGHT_EFFECTS as readonly unknown[]).includes(s["effect"])) p.push(`${at}.effect must be ${LIGHT_EFFECTS.map((e) => `"${e}"`).join(" | ")}`);
  if (s["transition"] !== undefined && (!isNum(s["transition"]) || s["transition"] < 0 || s["transition"] > 30)) p.push(`${at}.transition must be seconds from 0 to 30`);
  return p;
}

/**
 * Check a `lights.json` (parsed): `problems` refuse it, `warnings` advise.
 * With a `house`: every fixture's room exists, its `floor` (if given) is the
 * room's, its plan position is inside the room (± 0.05 m) and its height is
 * on the room's floor (between that floor's elevation and the next one up,
 * ± 0.05 m; the top floor + 4 m).
 */
export function validateLights(lights: unknown, house?: HouseMap | null): LightsValidation {
  const problems: string[] = [];
  const warnings: string[] = [];
  const done = (): LightsValidation => ({ ok: problems.length === 0, problems, warnings });
  if (!isObj(lights)) {
    problems.push("lights.json must be an object");
    return done();
  }
  if (lights["version"] !== 1) problems.push("version must be 1");
  if (lights["note"] !== undefined && !isStr(lights["note"])) problems.push("note must be a string");
  const list = (key: string): unknown[] => {
    const v = lights[key];
    if (Array.isArray(v)) return v;
    problems.push(`${key} must be a list`);
    return [];
  };

  // Fixtures.
  const fixtures = new Map<string, LightFixture>();
  const rooms = new Map((house?.rooms ?? []).map((r) => [r.id, r]));
  const floors = [...(house?.floors ?? [])].sort((a, b) => a.elevation - b.elevation);
  list("fixtures").forEach((f, i) => {
    let at = `fixtures[${i}]`;
    if (!isObj(f)) return void problems.push(`${at} must be an object`);
    const id = f["id"];
    if (!isStr(id) || !ID_RE.test(id)) problems.push(`${at}.id must be lower-case letters, digits and "-" (${JSON.stringify(id)})`);
    else {
      at = `fixtures[${i}] "${id}"`;
      if (fixtures.has(id)) problems.push(`${at}: the id is used twice`);
      if (id === LIGHTS_EVERYWHERE) problems.push(`${at}: "${LIGHTS_EVERYWHERE}" is reserved`);
    }
    if (!isStr(f["name"])) problems.push(`${at}.name must be a string`);
    if (!isStr(f["room"]) || f["room"] === "") problems.push(`${at}.room must be a room id`);
    if (f["floor"] !== undefined && !isStr(f["floor"])) problems.push(`${at}.floor must be a string`);
    const pos = f["pos"];
    const posOk = isObj(pos) && isNum(pos["x"]) && isNum(pos["y"]) && isNum(pos["z"]);
    if (!posOk) problems.push(`${at}.pos must be {x, y, z} in metres`);
    if (!(LIGHT_KINDS as readonly unknown[]).includes(f["kind"])) problems.push(`${at}.kind must be ${LIGHT_KINDS.map((k) => `"${k}"`).join(" | ")}`);
    if (!isStr(f["device"]) || f["device"].trim() === "") problems.push(`${at}.device must name the Zigbee2MQTT device / group or the WLED topic`);
    const caps = f["caps"];
    if (!isObj(caps) || typeof caps["color"] !== "boolean" || typeof caps["ct"] !== "boolean" || typeof caps["dim"] !== "boolean") problems.push(`${at}.caps must be {color, ct, dim} (true / false)`);
    if (f["safety"] !== undefined && typeof f["safety"] !== "boolean") problems.push(`${at}.safety must be true or false`);
    if (f["min"] !== undefined && (!isInt(f["min"]) || f["min"] < 1 || f["min"] > 254)) problems.push(`${at}.min must be a whole number from 1 to 254`);
    if (isStr(id) && !fixtures.has(id)) fixtures.set(id, f as unknown as LightFixture);
    // Placement against the house.
    if (house && isStr(f["room"]) && f["room"] !== "") {
      const room = rooms.get(f["room"]);
      if (room === undefined) problems.push(`${at}: unknown room "${f["room"]}"`);
      else {
        if (isStr(f["floor"]) && f["floor"] !== room.floor) problems.push(`${at}: floor "${f["floor"]}" is not room "${room.id}"'s floor "${room.floor}"`);
        if (posOk) {
          const p = pos as { x: number; y: number; z: number };
          const plan: [number, number] = [p.x, p.z];
          const inside = pointInPoly(room.poly, plan) || distanceToBoundary(room.poly, plan) <= LIGHT_SPOT_TOLERANCE + 1e-9;
          if (!inside) problems.push(`${at}: [${p.x}, ${p.z}] is outside room "${room.id}" (± ${LIGHT_SPOT_TOLERANCE} m)`);
          const k = floors.findIndex((fl) => fl.id === room.floor);
          if (k >= 0) {
            const lo = floors[k]!.elevation - LIGHT_SPOT_TOLERANCE;
            const hi = k + 1 < floors.length ? floors[k + 1]!.elevation + LIGHT_SPOT_TOLERANCE : floors[k]!.elevation + LIGHT_TOP_HEADROOM;
            if (p.y < lo - 1e-9 || p.y > hi + 1e-9) problems.push(`${at}: y ${p.y} is not on floor "${room.floor}" (${round2(lo)} to ${round2(hi)}: the house frame is absolute)`);
          }
        }
      }
    }
  });

  // Zones.
  const zoneIds = new Set<string>();
  list("zones").forEach((z, i) => {
    let at = `zones[${i}]`;
    if (!isObj(z)) return void problems.push(`${at} must be an object`);
    const id = z["id"];
    if (!isStr(id) || !ID_RE.test(id)) problems.push(`${at}.id must be lower-case letters, digits and "-" (${JSON.stringify(id)})`);
    else {
      at = `zones[${i}] "${id}"`;
      if (id === LIGHTS_EVERYWHERE) problems.push(`${at}: "${LIGHTS_EVERYWHERE}" is every fixture already and may not be redefined`);
      if (zoneIds.has(id) || fixtures.has(id)) problems.push(`${at}: the id is used twice`);
      zoneIds.add(id);
    }
    if (!isStr(z["name"])) problems.push(`${at}.name must be a string`);
    if (!Array.isArray(z["fixtures"])) problems.push(`${at}.fixtures must be a list of fixture ids`);
    else for (const fid of z["fixtures"]) if (!isStr(fid) || !fixtures.has(fid)) problems.push(`${at}: unknown fixture ${JSON.stringify(fid)}`);
  });

  // Looks.
  const looks = lights["looks"];
  const used = new Set<string>();
  const config = lights as unknown as LightsConfig;
  const canResolve = Array.isArray(config.fixtures) && Array.isArray(config.zones);
  const resolve = (to: string[]): LightFixture[] => (canResolve ? resolveLightTargets(config, house, to).fixtures.map((id) => fixtures.get(id)).filter((f): f is LightFixture => f !== undefined) : []);
  if (!isObj(looks)) problems.push("looks must be an object {cue name: look}");
  else {
    for (const [name, look] of Object.entries(looks)) {
      const at = `looks["${name}"]`;
      if (!LOOK_RE.test(name)) problems.push(`${at}: a look name is lower-case letters, digits and "_", starting with a letter (it is the story's cue name)`);
      const reserved = LIGHT_RESERVED_PREFIXES.find((p) => name.startsWith(p));
      if (reserved !== undefined) problems.push(`${at}: "${reserved}" cues are the screens', never a look`);
      if (!isObj(look)) {
        problems.push(`${at} must be an object {to, set | steps}`);
        continue;
      }
      if (look["note"] !== undefined && !isStr(look["note"])) problems.push(`${at}.note must be a string`);
      const toOk = (v: unknown): v is string[] => Array.isArray(v) && v.every((t) => isStr(t));
      if (!toOk(look["to"])) {
        problems.push(`${at}.to must be a list of fixtures, zones, rooms or LOCATIONs`);
        continue;
      }
      const lookTo = look["to"];
      if (lookTo.length === 0) warnings.push(`${at}.to names nothing`);
      for (const t of lookTo) if (canResolve && resolveLightTargets(config, house, [t]).fixtures.length === 0) warnings.push(`${at}.to: "${t}" reaches no fixture`);
      const hasSet = look["set"] !== undefined;
      const hasSteps = look["steps"] !== undefined;
      if (hasSet === hasSteps) {
        problems.push(`${at} must have exactly one of set or steps`);
        continue;
      }
      // The steps, each with its own targets.
      const steps: Array<{ at: number; set: Obj; to: string[]; where: string }> = [];
      if (hasSet) {
        const sp = stateProblems(`${at}.set`, look["set"]);
        problems.push(...sp);
        if (sp.length === 0) steps.push({ at: 0, set: look["set"] as Obj, to: lookTo, where: `${at}.set` });
      } else if (!Array.isArray(look["steps"]) || look["steps"].length === 0) problems.push(`${at}.steps must be a non-empty list of {at, set, to?}`);
      else {
        if (look["steps"].length > LIGHT_MAX_STEPS) problems.push(`${at} has ${look["steps"].length} steps (at most ${LIGHT_MAX_STEPS})`);
        look["steps"].forEach((s, j) => {
          const where = `${at}.steps[${j}]`;
          if (!isObj(s)) return void problems.push(`${where} must be an object {at, set, to?}`);
          const t = s["at"];
          if (!isNum(t) || t < 0) problems.push(`${where}.at must be ms from the look's start (≥ 0)`);
          const sp = stateProblems(`${where}.set`, s["set"]);
          problems.push(...sp);
          let to = lookTo;
          if (s["to"] !== undefined) {
            if (!toOk(s["to"])) return void problems.push(`${where}.to must be a list of fixtures, zones, rooms or LOCATIONs`);
            to = s["to"];
            for (const x of to) if (canResolve && resolveLightTargets(config, house, [x]).fixtures.length === 0) warnings.push(`${where}.to: "${x}" reaches no fixture`);
          }
          if (isNum(t) && t >= 0 && sp.length === 0) steps.push({ at: t, set: s["set"] as Obj, to, where });
        });
      }
      // Timing per fixture: increasing, spaced for Zigbee.
      const lastAt = new Map<string, number>();
      let longest = 0;
      for (const s of steps) {
        longest = Math.max(longest, s.at);
        const colour = s.set["color"] !== undefined || s.set["color_temp"] !== undefined;
        for (const f of resolve(s.to)) {
          used.add(f.id);
          const prev = lastAt.get(f.id);
          if (prev !== undefined) {
            const gap = colour ? LIGHT_COLOR_STEP_MIN_MS : LIGHT_STEP_MIN_MS;
            if (s.at <= prev) problems.push(`${s.where}: at ${s.at} ms is not after "${f.id}"'s previous step (${prev} ms)`);
            else if (s.at - prev < gap) problems.push(`${s.where}: at ${s.at} ms is ${s.at - prev} ms after "${f.id}"'s previous step (at least ${gap} ms${colour ? " for a colour change" : ""}: Zigbee drops faster commands)`);
          }
          lastAt.set(f.id, s.at);
          // A safety fixture is never written dark (the clamp is the backstop).
          if (f.safety === true) {
            const min = safetyMin(f);
            if (s.set["state"] === "OFF") problems.push(`${s.where} turns safety fixture "${f.id}" OFF (it never goes dark)`);
            else if (f.caps?.dim === true && isInt(s.set["brightness"]) && s.set["brightness"] < min) problems.push(`${s.where} dims safety fixture "${f.id}" to ${s.set["brightness"]} (its floor is ${min})`);
          }
          if (f.kind === "wled" && isStr(s.set["effect"]) && s.set["effect"] !== "blink" && s.set["effect"] !== "breathe") warnings.push(`${s.where}: WLED "${f.id}" has no "${s.set["effect"]}" effect (only blink and breathe); it is played solid`);
        }
      }
      // Repeat, loop, restore, period.
      const loop = look["loop"];
      if (loop !== undefined && typeof loop !== "boolean") problems.push(`${at}.loop must be true or false`);
      const repeat = look["repeat"];
      if (repeat !== undefined && (!isInt(repeat) || repeat < 1 || repeat > LIGHT_MAX_REPEAT)) problems.push(`${at}.repeat must be a whole number from 1 to ${LIGHT_MAX_REPEAT}`);
      const then = look["then"];
      if (then !== undefined && then !== "restore") problems.push(`${at}.then must be "restore"`);
      if (then === "restore" && loop === true) problems.push(`${at}: then "restore" can't loop (a loop never ends to give the light back)`);
      const period = look["period"];
      if (period !== undefined && (!isNum(period) || period <= 0)) problems.push(`${at}.period must be ms (> 0)`);
      else if (isNum(period) && steps.length > 0 && period <= longest) problems.push(`${at}.period ${period} ms ends before the last step (${longest} ms)`);
      const effPeriod = isNum(period) ? period : longest + (then === "restore" ? LIGHT_RESTORE_MS : LIGHT_STEP_MIN_MS);
      if (longest > LIGHT_LOOK_MAX_MS || (isNum(period) && period > LIGHT_LOOK_MAX_MS)) problems.push(`${at} runs past ${LIGHT_LOOK_MAX_MS} ms`);
      const repeats = loop === true || (isInt(repeat) && repeat > 1);
      if (repeats && effPeriod < LIGHT_LOOP_MIN_PERIOD_MS) {
        const zig = [...new Set(steps.flatMap((s) => resolve(s.to)))].filter((f) => f.kind === "zigbee" || f.kind === "zigbee-group");
        if (zig.length > 0) warnings.push(`${at} repeats every ${effPeriod} ms on Zigbee (${zig.map((f) => f.id).join(", ")}): under ${LIGHT_LOOP_MIN_PERIOD_MS} ms it reads as flicker and drops commands`);
      }
      // A look that does nothing on any of its fixtures.
      if (steps.length > 0 && canResolve) {
        const targeted = steps.some((s) => resolve(s.to).length > 0);
        const does = steps.some((s) => resolve(s.to).some((f) => effective(forCaps(f, s.set as LightState))));
        if (targeted && !does) warnings.push(`${at}: its fixtures can't do anything it sets (check their caps)`);
      }
    }
  }
  const boot = lights["boot"];
  if (boot !== undefined && isObj(looks) && (!isStr(boot) || !Object.prototype.hasOwnProperty.call(looks, boot))) problems.push(`boot names no look (${JSON.stringify(boot)})`);
  if (isObj(looks)) for (const id of fixtures.keys()) if (!used.has(id)) warnings.push(`fixture "${id}" is in no look`);
  return done();
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
