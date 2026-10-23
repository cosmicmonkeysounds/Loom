//! The lights config's routes (wave 20, `core/server/lights.ts`), as the map
//! page calls them with the device's moderator token: `GET /api/mod/lights`
//! (the config in force, the story's look cues, the LOCATIONs, the recent
//! tests, the pairing window, the Zigbee2MQTT devices the house Mac's
//! `lights` module reported, whether that module is listening; with `after`
//! a long poll), `POST /api/mod/lights {lights, base?}` (409 on a stale
//! base), `POST /api/mod/lights/project`, `POST /api/mod/lights/test
//! {fixture} | {look} | {fixture, set}` and `POST /api/mod/lights/pair
//! {seconds}`. Every write's outcome is a value (`MapReply`, like the map's).

import type { LightCaps, LightState, LightsConfig } from "@loom/house";
import type { MapReply } from "../api.ts";
import { normalizeLights } from "./lights.ts";

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
  members?: string[];
}

/** One test the module was asked to play. */
export interface LightTestRow {
  seq: number;
  at: number;
  fixture: string | null;
  look: string | null;
  set: LightState | null;
  by: string;
}

/** The latest "pair new device" while it is open (a close rides a while too). */
export interface LightPairInfo {
  seq: number;
  at: number;
  seconds: number;
  until: number;
  by: string;
}

/** The house Mac's `lights` module (null: it never polled this server). */
export interface LightsModuleInfo {
  name: string;
  at: number;
  online: boolean;
}

export interface LightsView {
  lights: LightsConfig;
  version: string;
  source: "director" | "project" | "env" | "default";
  /** Every story `cue X` that could be a look (the builder's suggestions). */
  looks: string[];
  locations: string[];
  tests: LightTestRow[];
  pair: LightPairInfo | null;
  devices: Z2mDevice[];
  /** When the module last reported the devices (server ms); null = never. */
  devicesAt: number | null;
  module: LightsModuleInfo | null;
  problems: string[];
  warnings: string[];
  /** The server's clock when it answered (null: an older server), and when
   *  this browser got the answer (client ms): every stamp above is server
   *  time, so a countdown runs on `serverNowOf`, never on `Date.now()`. */
  now: number | null;
  receivedAt: number;
}

/** The server's clock now, off the last answer (`clientNow` - `receivedAt`
 *  since its `now`); the client's own clock from an older server. */
export function serverNowOf(view: Pick<LightsView, "now" | "receivedAt"> | null, clientNow: number): number {
  if (view === null || view.now === null) return clientNow;
  return view.now + Math.max(0, clientNow - view.receivedAt);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function capsOf(v: unknown): LightCaps | null {
  if (!isObj(v) || typeof v["color"] !== "boolean" || typeof v["ct"] !== "boolean" || typeof v["dim"] !== "boolean") return null;
  return { color: v["color"], ct: v["ct"], dim: v["dim"] };
}

/** A device entry off an answer (null: not one). */
export function deviceOf(v: unknown): Z2mDevice | null {
  if (!isObj(v) || typeof v["friendly"] !== "string" || v["friendly"] === "") return null;
  const members = strings(v["members"]);
  return {
    friendly: v["friendly"],
    ieee: typeof v["ieee"] === "string" ? v["ieee"] : "",
    type: typeof v["type"] === "string" ? v["type"] : "EndDevice",
    model: strOrNull(v["model"]),
    vendor: strOrNull(v["vendor"]),
    description: strOrNull(v["description"]),
    caps: capsOf(v["caps"]),
    ...(Array.isArray(v["members"]) ? { members } : {}),
  };
}

function testOf(v: unknown): LightTestRow | null {
  if (!isObj(v) || !num(v["seq"]) || !num(v["at"])) return null;
  return { seq: v["seq"], at: v["at"], fixture: strOrNull(v["fixture"]), look: strOrNull(v["look"]), set: isObj(v["set"]) ? (v["set"] as LightState) : null, by: typeof v["by"] === "string" ? v["by"] : "" };
}

export function pairOf(v: unknown): LightPairInfo | null {
  if (!isObj(v) || !num(v["seq"]) || !num(v["at"]) || !num(v["seconds"]) || !num(v["until"])) return null;
  return { seq: v["seq"], at: v["at"], seconds: v["seconds"], until: v["until"], by: typeof v["by"] === "string" ? v["by"] : "" };
}

export function moduleOf(v: unknown): LightsModuleInfo | null {
  if (!isObj(v) || typeof v["online"] !== "boolean" || !num(v["at"])) return null;
  return { name: typeof v["name"] === "string" ? v["name"] : "", at: v["at"], online: v["online"] };
}

/** A GET answer → a view (anything missing read as empty: an older shape never throws). */
export function lightsViewOf(data: Obj, receivedAt: number = Date.now()): LightsView {
  const source = data["source"];
  return {
    lights: normalizeLights(data["lights"]),
    version: typeof data["version"] === "string" ? data["version"] : "",
    source: source === "director" || source === "project" || source === "env" ? source : "default",
    looks: strings(data["looks"]),
    locations: strings(data["locations"]),
    tests: Array.isArray(data["tests"]) ? data["tests"].flatMap((t) => testOf(t) ?? []) : [],
    pair: pairOf(data["pair"]),
    devices: Array.isArray(data["devices"]) ? data["devices"].flatMap((d) => deviceOf(d) ?? []) : [],
    devicesAt: num(data["devicesAt"]) ? data["devicesAt"] : null,
    module: moduleOf(data["module"]),
    problems: strings(data["problems"]),
    warnings: strings(data["warnings"]),
    now: num(data["now"]) ? data["now"] : null,
    receivedAt,
  };
}

/** The GET's outcome: the view; `missing` = a server with no lights routes (404); `error` = away / refused. */
export type LightsFetch = { kind: "ok"; view: LightsView } | { kind: "missing" } | { kind: "error"; status: number | null; error: string };

/** The long poll's cursors (each one the newest the page has seen). */
export interface LightsQuery {
  after?: string;
  tests?: number;
  pairs?: number;
  devicesAt?: number;
  wait?: number;
}

/** `GET /api/mod/lights[?after=&tests=&pairs=&devicesAt=&wait=]`. */
export async function fetchLights(base: string, token: string, opts: LightsQuery & { signal?: AbortSignal; fetcher?: typeof fetch } = {}): Promise<LightsFetch> {
  const q = new URLSearchParams();
  if (opts.after !== undefined) q.set("after", opts.after);
  if (opts.tests !== undefined) q.set("tests", String(opts.tests));
  if (opts.pairs !== undefined) q.set("pairs", String(opts.pairs));
  if (opts.devicesAt !== undefined) q.set("devicesAt", String(opts.devicesAt));
  if (opts.wait !== undefined) q.set("wait", String(opts.wait));
  const qs = q.toString();
  try {
    const res = await (opts.fetcher ?? fetch)(`${base}/api/mod/lights${qs !== "" ? `?${qs}` : ""}`, {
      headers: { "x-loom-token": token },
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as Obj;
    if (res.status === 404) return { kind: "missing" };
    if (!res.ok) return { kind: "error", status: res.status, error: typeof data["error"] === "string" ? data["error"] : `HTTP ${res.status}` };
    return { kind: "ok", view: lightsViewOf(data) };
  } catch (e) {
    return { kind: "error", status: null, error: (e as Error).message };
  }
}

async function post<T>(url: string, token: string, body: Obj, fetcher: typeof fetch): Promise<MapReply<T>> {
  try {
    const res = await fetcher(url, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Obj;
    if (res.ok) return { ok: true, result: data as unknown as T };
    const version = typeof data["version"] === "string" ? data["version"] : null;
    return { ok: false, status: res.status, error: typeof data["error"] === "string" ? data["error"] : `HTTP ${res.status}`, problems: strings(data["problems"]), conflict: res.status === 409 && version !== null, version };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message, problems: [], conflict: false, version: null };
  }
}

export interface SaveLightsResult {
  version: string;
  warnings: string[];
}

/** A director's save of the lights, based on the version the page loaded (null: no check). */
export function saveLights(base: string, token: string, lights: LightsConfig, baseVersion: string | null, fetcher: typeof fetch = fetch): Promise<MapReply<SaveLightsResult>> {
  return post<SaveLightsResult>(`${base}/api/mod/lights`, token, baseVersion !== null ? { lights, base: baseVersion } : { lights }, fetcher);
}

/** The config in force becomes the project's `lights.json`. */
export function saveLightsToProject(base: string, token: string, fetcher: typeof fetch = fetch): Promise<MapReply<{ version: string }>> {
  return post<{ version: string }>(`${base}/api/mod/lights/project`, token, {}, fetcher);
}

/** What a test asks: identify a fixture, play a look, or one state on a fixture. */
export type LightTestTarget = { fixture: string } | { look: string } | { fixture: string; set: LightState };

export function testLight(base: string, token: string, target: LightTestTarget, fetcher: typeof fetch = fetch): Promise<MapReply<{ ok: true; seq: number; module: boolean }>> {
  return post<{ ok: true; seq: number; module: boolean }>(`${base}/api/mod/lights/test`, token, target as Obj, fetcher);
}

/** Open Zigbee joining for `seconds` (0 closes it). */
export function pairLights(base: string, token: string, seconds: number, fetcher: typeof fetch = fetch): Promise<MapReply<{ ok: true; seq: number; until: number }>> {
  return post<{ ok: true; seq: number; until: number }>(`${base}/api/mod/lights/pair`, token, { seconds }, fetcher);
}

/** What a test's (or pair's) refusal tells the director. */
export function lightRefusal(r: { status: number; error: string }, target: LightTestTarget | { pair: number }): string {
  if (r.status === 401 || r.status === 403) return "This device's moderator access was refused.";
  if (r.status === 0) return `Couldn't reach the server (${r.error}).`;
  if (r.status === 404 && r.error === "no such fixture" && "fixture" in target) return `“${target.fixture}” isn't saved yet — 💾 save the lights, then test it.`;
  if (r.status === 404 && r.error === "no such look" && "look" in target) return `The look “${target.look}” isn't saved yet — 💾 save the lights, then test it.`;
  if (r.status === 404) return "This server has no lights routes (it predates wave 20).";
  if (r.status === 400 && r.error === "set does nothing") return "That would change nothing on this light (its caps can't do it) — try another colour or Identify.";
  return `Not sent — ${r.error}.`;
}

/** What a sent test says, given whether the module is listening. */
export function lightTestSentText(what: string, module: boolean): string {
  return module ? `💡 Sent: ${what} — watch the light.` : `💡 Queued: ${what} — but the lights module isn't polling (is stagehand's lights job running on the house Mac?).`;
}

/** The Lights tab's module badge. */
export function moduleBadge(m: LightsModuleInfo | null, now: number): { text: string; ok: boolean } {
  if (m === null) return { text: "💡 no lights module yet", ok: false };
  if (m.online) return { text: `💡 module online${m.name !== "" ? ` · ${m.name}` : ""}`, ok: true };
  const s = Math.max(0, Math.round((now - m.at) / 1000));
  return { text: `💡 module last seen ${s < 60 ? `${s} s` : `${Math.round(s / 60)} min`} ago`, ok: false };
}

/** The lights save's line on a 409. */
export function lightsConflictText(version: string | null): string {
  return `Lights not saved — they changed since you loaded them${version !== null ? ` (now v${version})` : ""}. Reload the lights, then redo your edits.`;
}
