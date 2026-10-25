//! The house lights' config (wave 20): the server half of `lights.json`.
//!
//! `@loom/house` (`house/src/lights.ts`) owns the schema, `validateLights`,
//! `resolveLightTargets` and `planLook`; this module holds the config an
//! event plays, the Zigbee2MQTT device list the house Mac's `lights` module
//! reports, and the routes. Like `audio.json` the file belongs to the
//! project but is its own file: placing a bulb mid-show never bumps the map
//! version, and both map variants share it. What is in force:
//!
//! 1. a director's save (`POST /api/mod/lights`, the map editor) — kept in
//!    the event's state dir, it wins until a Save to project replaces it;
//! 2. the project's `lights.json`, snapshotted at launch / reload beside the
//!    maps (the event row's `house_maps` record, key `lights.json`);
//! 3. `LOOM_LIGHTS` — the LAN fallback file (re-read on mtime, last good kept);
//! 4. `defaultLights()` (no fixtures, no looks).
//!
//! Routes (a mod token or the author's session; none on the host allowlist):
//! - `GET /api/mod/lights[?after=<version>&tests=<seq>&pairs=<seq>&devicesAt=<ms>&wait=<s>&module=1&name=<host>]`
//!   → `LightsView`; with `after` it is a long poll (the module, the map
//!   editor): it answers at once when the version moved on, a test / pair
//!   newer than the cursors is pending or the device list is newer than
//!   `devicesAt` (the last view's), else after the first change (a
//!   save, a project snapshot, a test, a pair, a new device list) or `wait`
//!   seconds (default 25, at most 30). `module=1` records the module's
//!   presence (`LightsView.module`);
//! - `POST /api/mod/lights {lights, base?}` → the director's save (400
//!   `problems`, 409 `stale` on a stale `base`);
//! - `POST /api/mod/lights/project` → the config in force becomes the
//!   project's `lights.json`;
//! - `POST /api/mod/lights/test {fixture} | {look} | {fixture, set}` →
//!   `{ok, seq, module}`: identify a fixture, play a look, or publish one
//!   state (the last `LIGHT_TESTS`, memory only, `LIGHT_TEST_MS` old at most,
//!   ride every GET; 400 `set does nothing` for an empty or transition-only set);
//! - `POST /api/mod/lights/devices {devices}` → the module's reduced
//!   Zigbee2MQTT device + group list (memory only, replaced whole);
//! - `POST /api/mod/lights/pair {seconds}` → let new Zigbee devices join for
//!   that long (0 closes; memory only).
//!
//! Transport-light: `LightsHub` takes an injected clock and store; the
//! handlers take the runtime's context.

import { readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  LIGHTS_FILE,
  defaultLights,
  isLightLookName,
  lightStateDoes,
  lightStateProblems,
  lightsHash,
  validateLights,
  type HouseMap,
  type LightCaps,
  type LightState,
  type LightsConfig,
} from "@loom/house";

import type { SimModel } from "../src/runtime/sim/model.ts";
import { storyLocations } from "./audio.ts";
import { queryTokenOf, sendJson } from "./http-util.ts";
import type { Store } from "./store.ts";

export { LIGHTS_FILE } from "@loom/house";

/** Where the config in force comes from. */
export type LightsSource = "director" | "project" | "env" | "default";

/** One test for the module: identify a fixture (`fixture` alone), play a
 *  look (`look`), or publish one state (`fixture` + `set`). */
export interface LightTest {
  seq: number;
  /** Server epoch ms. */
  at: number;
  fixture?: string;
  look?: string;
  set?: LightState;
  by: string;
}

/** A director's "pair new device": Zigbee2MQTT's permit-join for `seconds`
 *  (0 closes it). */
export interface LightPair {
  seq: number;
  /** Server epoch ms. */
  at: number;
  seconds: number;
  /** `at` + `seconds` (ms): joining is open until then. */
  until: number;
  by: string;
}

/** One Zigbee2MQTT device or group, as the module reduced it. */
export interface Z2mDevice {
  friendly: string;
  ieee: string;
  /** "Coordinator" | "Router" | "EndDevice" | "Group". */
  type: string;
  model: string | null;
  vendor: string | null;
  description: string | null;
  /** Null: not a light. */
  caps: LightCaps | null;
  /** A group's member friendly names. */
  members?: string[];
}

/** The house Mac's `lights` module: its last poll and whether it is listening. */
export interface LightsModule {
  name: string;
  /** Its last poll (server epoch ms). */
  at: number;
  /** Parked on a long poll, or polled within `LIGHTS_MODULE_ONLINE_MS`. */
  online: boolean;
}

/** The GET answer. */
export interface LightsView {
  lights: LightsConfig;
  version: string;
  source: LightsSource;
  /** Every `cue X` in the story whose X is a valid look name (sorted,
   *  deduped): the editor's suggestions. */
  looks: string[];
  locations: string[];
  /** The last `LIGHT_TESTS`, ≤ `LIGHT_TEST_MS` old, oldest first. */
  tests: LightTest[];
  /** The latest pair while `until` is ahead (a close — `seconds: 0` — rides
   *  for `LIGHT_TEST_MS` so the module hears it). */
  pair: LightPair | null;
  devices: Z2mDevice[];
  /** When the module last reported the devices (server ms); null = never. */
  devicesAt: number | null;
  module: LightsModule | null;
  /** The config in force checked against the house in force (a map edit can
   *  leave a fixture outside its room) — advice, never a refusal here. */
  problems: string[];
  warnings: string[];
  /** The server's clock when it answered (ms): the anchor for every other
   *  stamp here (a pairing's `until`, `module.at`, `devicesAt`), so a
   *  client counts down without trusting its own clock. */
  now: number;
}

/** How many tests ride a GET, and for how long. Wave 25: 32, not 8 — a
 *  house-desk cue queues a burst (a `look` plus one `{fixture, set}` per
 *  fixture a `light` step reaches) inside one module poll, and a test that
 *  falls off the list before the module polls is never played. */
export const LIGHT_TESTS = 32;
export const LIGHT_TEST_MS = 60_000;
/** The long poll's default and longest wait (seconds). */
export const LIGHTS_WAIT_S = 25;
export const LIGHTS_WAIT_MAX_S = 30;
/** The module counts as online this long after its last poll (ms): a long
 *  poll is 25 s, so a live module is never seen as gone between two. */
export const LIGHTS_MODULE_ONLINE_MS = 40_000;
/** The device list's caps: entries and the request's JSON size. */
export const LIGHT_DEVICES_MAX = 500;
export const LIGHT_DEVICES_MAX_BYTES = 256 * 1024;
/** Zigbee2MQTT's permit-join ceiling (seconds). */
export const LIGHT_PAIR_MAX_S = 254;

/** Is `path` the project's lights file (at the project's root)? */
export function isLightsFile(path: string): boolean {
  return path === LIGHTS_FILE;
}

/** The `lights.json` text among a project's files, or null (an empty file —
 *  just created — counts as none). */
export function lightsFileOf(files: Iterable<{ path: string; content: string }>): string | null {
  for (const f of files) if (isLightsFile(f.path)) return f.content.trim() === "" ? null : f.content;
  return null;
}

/** The `lights.json` string inside an untrusted data-file record (the event
 *  row's `house_maps` jsonb, a `/api/mod/load` body). */
export function lightsOf(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>)[LIGHTS_FILE];
  return typeof v === "string" ? v : null;
}

/** Parse + shape-check a `lights.json` text (no house: a room the map lost
 *  must not silently drop the whole config mid-show). */
export function parseLightsText(text: string): { lights: LightsConfig | null; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { lights: null, problems: [`not JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const v = validateLights(raw);
  return v.ok ? { lights: raw as LightsConfig, problems: [] } : { lights: null, problems: v.problems };
}

/** The problems a project `lights.json` write would be refused for ([] = fine). */
export function lightsProblems(text: string): string[] {
  return parseLightsText(text).problems;
}

/** A `lights.json` as a project file: pretty, one trailing newline. */
export function lightsFileText(lights: LightsConfig): string {
  return `${JSON.stringify(lights, null, 2)}\n`;
}

/** Every `cue X` the story uses whose X can be a look, sorted — the map
 *  editor's suggestions. Read off the compiled model's directive text. */
export function storyLooks(model: SimModel | null): string[] {
  if (model === null) return [];
  let text = "";
  try {
    text = JSON.stringify([model.rules, [...model.roles.values()].map((r) => r.hooks), [...model.characters.values()].map((c) => c.hooks), [...model.beats.values()]]);
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^A-Za-z0-9_])cue:\s*([A-Za-z_][A-Za-z0-9_]*)/gu)) if (isLightLookName(m[1]!)) out.add(m[1]!);
  return [...out].sort();
}

const isStr = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** A `Z2mDevice` off untrusted JSON, or null. Long strings are cut. */
export function parseZ2mDevice(raw: unknown): Z2mDevice | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (!isStr(d["friendly"]) || d["friendly"].trim() === "" || !isStr(d["ieee"]) || !isStr(d["type"])) return null;
  for (const k of ["model", "vendor", "description"]) if (d[k] !== undefined && !strOrNull(d[k])) return null;
  let caps: LightCaps | null = null;
  const c = d["caps"];
  if (c !== undefined && c !== null) {
    if (typeof c !== "object" || Array.isArray(c)) return null;
    const cc = c as Record<string, unknown>;
    if (typeof cc["color"] !== "boolean" || typeof cc["ct"] !== "boolean" || typeof cc["dim"] !== "boolean") return null;
    caps = { color: cc["color"], ct: cc["ct"], dim: cc["dim"] };
  }
  const cut = (v: unknown, n: number): string | null => (isStr(v) ? v.slice(0, n) : null);
  const out: Z2mDevice = { friendly: d["friendly"].slice(0, 128), ieee: d["ieee"].slice(0, 64), type: d["type"].slice(0, 32), model: cut(d["model"], 128), vendor: cut(d["vendor"], 128), description: cut(d["description"], 256), caps };
  const m = d["members"];
  if (m !== undefined) {
    if (!Array.isArray(m) || m.some((x) => !isStr(x))) return null;
    out.members = (m as string[]).slice(0, 64).map((x) => x.slice(0, 128));
  }
  return out;
}

export interface LightsHubInit {
  store: Store;
  /** The project's `lights.json` text as the row snapshotted it: null = the
   *  project has none; absent = no row snapshot (the state dir's copy). */
  projectText?: string | null;
  /** `LOOM_LIGHTS`: the LAN fallback file. */
  envFile?: string | null;
  now?: () => number;
}

/** The config an event plays, the module's devices, its tests and pairs,
 *  and the long poll's waiters. */
export class LightsHub {
  private readonly store: Store;
  private projectText: string | null;
  private projectMemo: { text: string; lights: LightsConfig | null } | null = null;
  private director: LightsConfig | null;
  private readonly envFile: string | null;
  private envMemo: { mtimeMs: number; lights: LightsConfig | null } | null = null;
  private readonly now: () => number;
  private testLog: LightTest[] = [];
  private testSeq = 0;
  private lastPair: LightPair | null = null;
  private pairSeq = 0;
  private deviceList: Z2mDevice[] = [];
  private devicesSeenAt: number | null = null;
  private waiters = new Set<() => void>();
  private moduleSeenAt: number | null = null;
  private moduleName = "";
  private moduleParked = 0;
  /** A problem logged once per text, not per request. */
  private readonly warned = new Set<string>();

  constructor(init: LightsHubInit) {
    this.store = init.store;
    this.now = init.now ?? Date.now;
    this.envFile = init.envFile ?? null;
    this.projectText = init.projectText !== undefined ? init.projectText : init.store.loadLights();
    if (init.projectText !== undefined) init.store.saveLights(init.projectText);
    const saved = init.store.loadLightsSave();
    this.director = saved !== null && validateLights(saved).ok ? (saved as LightsConfig) : null;
  }

  /** The project's `lights.json` text as this event holds it. */
  get project(): string | null {
    return this.projectText;
  }

  /** A reload's (or `/api/mod/load`'s) fresh project snapshot. */
  setProjectText(text: string | null): void {
    const was = this.current().version;
    this.projectText = text;
    this.store.saveLights(text);
    if (this.current().version !== was) this.wake();
  }

  /** The config in force, its version (content hash) and where it is from. */
  /** The hub's clock (server ms): `LightsView.now`. */
  clock(): number {
    return this.now();
  }

  current(): { lights: LightsConfig; version: string; source: LightsSource } {
    const pick = (lights: LightsConfig, source: LightsSource) => ({ lights, version: lightsHash(lights), source });
    if (this.director !== null) return pick(this.director, "director");
    const project = this.projectLights();
    if (project !== null) return pick(project, "project");
    const env = this.envLights();
    if (env !== null) return pick(env, "env");
    return pick(defaultLights(), "default");
  }

  private projectLights(): LightsConfig | null {
    const text = this.projectText;
    if (text === null || text.trim() === "") return null;
    if (this.projectMemo === null || this.projectMemo.text !== text) {
      const p = parseLightsText(text);
      if (p.lights === null) this.warn(`the project's ${LIGHTS_FILE} is ignored (${p.problems[0] ?? "invalid"})`);
      this.projectMemo = { text, lights: p.lights };
    }
    return this.projectMemo.lights;
  }

  private envLights(): LightsConfig | null {
    if (this.envFile === null) return null;
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.envFile).mtimeMs;
    } catch {
      return this.envMemo?.lights ?? null;
    }
    if (this.envMemo === null || this.envMemo.mtimeMs !== mtimeMs) {
      let p: { lights: LightsConfig | null; problems: string[] };
      try {
        p = parseLightsText(readFileSync(this.envFile, "utf8"));
      } catch (err) {
        p = { lights: null, problems: [`unreadable: ${err instanceof Error ? err.message : String(err)}`] };
      }
      if (p.lights === null) this.warn(`${this.envFile}: ${p.problems[0] ?? "invalid"} — keeping the last good config`);
      this.envMemo = { mtimeMs, lights: p.lights ?? this.envMemo?.lights ?? null };
    }
    return this.envMemo.lights;
  }

  private warn(line: string): void {
    if (this.warned.has(line)) return;
    this.warned.add(line);
    process.stderr.write(`  ⚠️  lights: ${line}\n`);
  }

  /** A director's save: validated against the house in force; refused on a
   *  stale `base`. */
  save(raw: unknown, base: unknown, house: HouseMap | null): { status: 200; version: string; warnings: string[] } | { status: 400 | 409; body: Record<string, unknown> } {
    const cur = this.current();
    if (typeof base === "string" && base !== "" && base !== cur.version) {
      return { status: 409, body: { error: "stale", version: cur.version, source: cur.source } };
    }
    const v = validateLights(raw, house);
    if (!v.ok) return { status: 400, body: { error: `invalid ${LIGHTS_FILE}`, problems: v.problems, warnings: v.warnings } };
    const lights = JSON.parse(JSON.stringify(raw)) as LightsConfig;
    this.director = lights;
    this.store.saveLightsSave(lights);
    this.wake();
    return { status: 200, version: lightsHash(lights), warnings: v.warnings };
  }

  /** The config in force became the project's `lights.json`: the snapshot
   *  follows and the director's save is dropped (it is the project's now). */
  savedToProject(text: string): void {
    this.projectText = text;
    this.store.saveLights(text);
    this.director = null;
    this.store.clearLightsSave();
    this.wake();
  }

  /** The module polled (or answered a long poll): it is listening. */
  noteModule(name: string | null): void {
    this.moduleSeenAt = this.now();
    if (name !== null && name.trim() !== "") this.moduleName = name.trim().slice(0, 64);
  }

  /** A module long poll parked (+1) or let go (−1). */
  moduleWaiting(delta: 1 | -1): void {
    this.moduleParked = Math.max(0, this.moduleParked + delta);
  }

  /** The module's presence, null when it never polled this server. */
  module(): LightsModule | null {
    const seen = this.moduleSeenAt;
    if (seen === null) return null;
    return { name: this.moduleName, at: seen, online: this.moduleParked > 0 || this.now() - seen < LIGHTS_MODULE_ONLINE_MS };
  }

  /** Queue a test (already checked against the config in force). */
  test(t: { fixture?: string; look?: string; set?: LightState }, by: string): LightTest {
    const test: LightTest = { seq: ++this.testSeq, at: this.now(), ...(t.fixture !== undefined ? { fixture: t.fixture } : {}), ...(t.look !== undefined ? { look: t.look } : {}), ...(t.set !== undefined ? { set: t.set } : {}), by: by.slice(0, 64) };
    this.testLog.push(test);
    if (this.testLog.length > LIGHT_TESTS) this.testLog.shift();
    this.wake();
    return test;
  }

  /** The recent tests (≤ `LIGHT_TESTS`, ≤ `LIGHT_TEST_MS` old), oldest first. */
  tests(): LightTest[] {
    const since = this.now() - LIGHT_TEST_MS;
    this.testLog = this.testLog.filter((t) => t.at >= since);
    return [...this.testLog];
  }

  /** Open (or, at 0, close) Zigbee joining for `seconds`. */
  pair(seconds: number, by: string): LightPair {
    const at = this.now();
    this.lastPair = { seq: ++this.pairSeq, at, seconds, until: at + seconds * 1000, by: by.slice(0, 64) };
    this.wake();
    return this.lastPair;
  }

  /** The latest pair while joining is open (a close, for `LIGHT_TEST_MS`). */
  currentPair(): LightPair | null {
    const p = this.lastPair;
    if (p === null) return null;
    const now = this.now();
    if (p.seconds === 0) return now - p.at < LIGHT_TEST_MS ? p : null;
    return p.until > now ? p : null;
  }

  /** The module's device list, replaced whole. */
  setDevices(devices: Z2mDevice[]): void {
    this.deviceList = devices;
    this.devicesSeenAt = this.now();
    this.wake();
  }

  devices(): { devices: Z2mDevice[]; devicesAt: number | null } {
    return { devices: [...this.deviceList], devicesAt: this.devicesSeenAt };
  }

  /** Is anything newer than the poller's view? A cursor past this hub's own
   *  counter was issued by an earlier process (a server restart counts from
   *  1 again): stale, so the poll answers at once. */
  moved(after: string, testsAfter: number | null, pairsAfter: number | null = null, devicesAfter: number | null = null): boolean {
    if (this.current().version !== after) return true;
    // A device list newer than the poller's `devicesAt` (posted between two
    // of its polls) answers at once.
    if (devicesAfter !== null && this.devicesSeenAt !== null && this.devicesSeenAt > devicesAfter) return true;
    if (testsAfter !== null && (testsAfter > this.testSeq || this.tests().some((t) => t.seq > testsAfter))) return true;
    if (pairsAfter !== null) {
      if (pairsAfter > this.pairSeq) return true;
      const p = this.currentPair();
      if (p !== null && p.seq > pairsAfter) return true;
    }
    return false;
  }

  /** Resolve on the next change or after `ms`; `cancel` drops the waiter. */
  waitChange(ms: number): { done: Promise<void>; cancel: () => void } {
    let wake!: () => void;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = new Promise<void>((resolve) => {
      wake = () => {
        if (timer !== undefined) clearTimeout(timer);
        this.waiters.delete(wake);
        resolve();
      };
      this.waiters.add(wake);
      timer = setTimeout(wake, Math.max(0, ms));
    });
    return { done, cancel: wake };
  }

  /** Waiters parked right now (tests). */
  get waiting(): number {
    return this.waiters.size;
  }

  private wake(): void {
    for (const w of [...this.waiters]) w();
  }
}

/** What the lights routes need from the event runtime. */
export interface LightsContext {
  /** The house map in force (fixture rooms are checked against it). */
  house: () => HouseMap | null;
  /** The story's model (its cue names and LOCATIONs). */
  model: () => SimModel | null;
}

export function lightsView(hub: LightsHub, ctx: LightsContext): LightsView {
  const cur = hub.current();
  const model = ctx.model();
  const v = validateLights(cur.lights, ctx.house());
  return { ...cur, looks: storyLooks(model), locations: storyLocations(model), tests: hub.tests(), pair: hub.currentPair(), ...hub.devices(), module: hub.module(), problems: v.problems, warnings: v.warnings, now: hub.clock() };
}

/**
 * `GET /api/mod/lights[?after=&tests=&pairs=&devicesAt=&wait=&module=1&name=]` — the
 * config + the long poll. Returns true when it answered (or will: a parked
 * long poll).
 */
export async function handleLightsGet(hub: LightsHub, ctx: LightsContext, req: IncomingMessage, res: ServerResponse, url: URL, authorized: (token: string | undefined) => boolean): Promise<boolean> {
  if (!authorized(queryTokenOf(req, url))) {
    sendJson(res, 403, { error: "moderators only" });
    return true;
  }
  res.setHeader?.("cache-control", "no-store");
  const cursor = (k: string): number | null => {
    const raw = url.searchParams.get(k) ?? "";
    return /^\d+$/u.test(raw) ? Number(raw) : null;
  };
  const after = url.searchParams.get("after");
  const testsAfter = cursor("tests");
  const pairsAfter = cursor("pairs");
  const devicesAfter = cursor("devicesAt");
  const waitRaw = Number(url.searchParams.get("wait") ?? LIGHTS_WAIT_S);
  const waitS = Number.isFinite(waitRaw) ? Math.min(LIGHTS_WAIT_MAX_S, Math.max(0, waitRaw)) : LIGHTS_WAIT_S;
  // The house Mac's module says who it is (`module=1`); the map editor's own
  // long poll does not, so it never passes for one.
  const isModule = url.searchParams.get("module") === "1";
  if (isModule) hub.noteModule(url.searchParams.get("name"));
  if (after !== null && after !== "" && !hub.moved(after, testsAfter, pairsAfter, devicesAfter) && waitS > 0) {
    const w = hub.waitChange(waitS * 1000);
    // A caller that hangs up frees its waiter at once.
    req.on?.("close", w.cancel);
    if (isModule) hub.moduleWaiting(1);
    try {
      await w.done;
    } finally {
      if (isModule) hub.moduleWaiting(-1);
    }
  }
  if (isModule) hub.noteModule(url.searchParams.get("name"));
  sendJson(res, 200, lightsView(hub, ctx));
  return true;
}

/** The project link the save needs (`ProjectLink.writeFile` + the row snapshot). */
export interface LightsProjectLink {
  writeFile(path: string, content: string): Promise<void>;
  /** Record the event row's data snapshot (maps + facts + audio + lights). */
  saveSnapshot(): Promise<void>;
}

/**
 * `POST /api/mod/lights`, `…/project`, `…/test`, `…/devices`, `…/pair` —
 * already authorized by the runtime's mod gate. Returns false for any other path.
 */
export async function handleLightsPost(hub: LightsHub, ctx: LightsContext, path: string, body: Record<string, unknown>, res: ServerResponse, project: LightsProjectLink | null, by: string): Promise<boolean> {
  switch (path) {
    case "/api/mod/lights": {
      const r = hub.save(body["lights"], body["base"], ctx.house());
      if (r.status !== 200) sendJson(res, r.status, r.body);
      else {
        process.stdout.write(`  💡 lights: ${by} saved the lights (${r.version})\n`);
        sendJson(res, 200, { ok: true, version: r.version, source: "director", warnings: r.warnings });
      }
      return true;
    }
    case "/api/mod/lights/project": {
      if (project === null) {
        sendJson(res, 409, { error: "no project" });
        return true;
      }
      const text = lightsFileText(hub.current().lights);
      try {
        await project.writeFile(LIGHTS_FILE, text);
      } catch (err) {
        process.stderr.write(`  ⚠️  lights: saving ${LIGHTS_FILE} to the project failed (${err instanceof Error ? err.message : String(err)})\n`);
        sendJson(res, 502, { error: "could not write the project file" });
        return true;
      }
      hub.savedToProject(text);
      try {
        await project.saveSnapshot();
      } catch (err) {
        process.stderr.write(`  ⚠️  lights: recording the snapshot failed (${err instanceof Error ? err.message : String(err)})\n`);
      }
      process.stdout.write(`  💡 lights: ${by} saved the lights to the project as ${LIGHTS_FILE}\n`);
      sendJson(res, 200, { ok: true, version: hub.current().version });
      return true;
    }
    case "/api/mod/lights/test": {
      const fixture = body["fixture"];
      const look = body["look"];
      const set = body["set"];
      const { lights } = hub.current();
      if (look !== undefined) {
        if (fixture !== undefined || set !== undefined) {
          sendJson(res, 400, { error: "test a look, a fixture, or a fixture with a set" });
          return true;
        }
        if (typeof look !== "string" || !Object.prototype.hasOwnProperty.call(lights.looks, look)) {
          sendJson(res, 404, { error: "no such look" });
          return true;
        }
        sendJson(res, 200, { ok: true, seq: hub.test({ look }, by).seq, module: hub.module()?.online === true });
        return true;
      }
      if (fixture === undefined) {
        sendJson(res, 400, { error: "test a look, a fixture, or a fixture with a set" });
        return true;
      }
      if (typeof fixture !== "string" || !lights.fixtures.some((f) => f.id === fixture)) {
        sendJson(res, 404, { error: "no such fixture" });
        return true;
      }
      if (set !== undefined) {
        const problems = lightStateProblems("set", set);
        if (problems.length > 0) {
          sendJson(res, 400, { error: problems[0] });
          return true;
        }
        if (!lightStateDoes(set as LightState)) {
          sendJson(res, 400, { error: "set does nothing" });
          return true;
        }
      }
      const t = hub.test({ fixture, ...(set !== undefined ? { set: set as LightState } : {}) }, by);
      sendJson(res, 200, { ok: true, seq: t.seq, module: hub.module()?.online === true });
      return true;
    }
    case "/api/mod/lights/devices": {
      const raw = body["devices"];
      if (!Array.isArray(raw)) {
        sendJson(res, 400, { error: "send {devices: [...]}" });
        return true;
      }
      if (raw.length > LIGHT_DEVICES_MAX) {
        sendJson(res, 400, { error: `at most ${LIGHT_DEVICES_MAX} devices` });
        return true;
      }
      if (JSON.stringify(raw).length > LIGHT_DEVICES_MAX_BYTES) {
        sendJson(res, 400, { error: `the device list is over ${LIGHT_DEVICES_MAX_BYTES / 1024} KB` });
        return true;
      }
      const devices: Z2mDevice[] = [];
      for (const [i, d] of raw.entries()) {
        const dev = parseZ2mDevice(d);
        if (dev === null) {
          sendJson(res, 400, { error: `devices[${i}] is not {friendly, ieee, type, model, vendor, description, caps, members?}` });
          return true;
        }
        devices.push(dev);
      }
      hub.setDevices(devices);
      sendJson(res, 200, { ok: true, n: devices.length });
      return true;
    }
    case "/api/mod/lights/pair": {
      const seconds = body["seconds"];
      if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 0 || seconds > LIGHT_PAIR_MAX_S) {
        sendJson(res, 400, { error: `seconds must be a whole number from 0 to ${LIGHT_PAIR_MAX_S}` });
        return true;
      }
      const p = hub.pair(seconds, by);
      process.stdout.write(seconds === 0 ? `  💡 lights: ${by} closed Zigbee pairing\n` : `  💡 lights: ${by} opened Zigbee pairing for ${seconds} s\n`);
      sendJson(res, 200, { ok: true, seq: p.seq, until: p.until });
      return true;
    }
    default:
      return false;
  }
}
