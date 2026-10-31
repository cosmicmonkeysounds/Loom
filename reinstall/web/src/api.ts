//! The spatial plane's routes (`docs/loom-reinstall.md` §2.1), as the web
//! game and the map page call them. Moderator calls carry the device's mod
//! token; a game's own high-rate calls carry its session token. Errors are
//! the play app's `ApiError` (the server's `error` text + the HTTP status).

import { api, ApiError } from "@loom/play/client.ts";
import { cloneData, normalizeHouse, parseDescent, validateHouse } from "@loom/house";
import type {
  Assignment,
  DescentScript,
  DuckSpot,
  FoundResult,
  HouseMap,
  HouseResponse,
  KingState,
  MapVariantsResponse,
  PlayerPose,
  SaveHouseResult,
  SaveToProjectResult,
  SpatialCandidate,
  Spawn,
  SpatialWorld,
  StationInfo,
  SwitchVariantResult,
} from "@loom/house";
import { baseOf, type ReinstallConfig } from "./config.ts";
import { isEligible, isMarked, type Program } from "./program.ts";
import { showHouse } from "./show-house.ts";
import { TENT_HELP_SIGNAL } from "./help.ts";
import { isDuckSpot, kingOf } from "./spatial.ts";

export { ApiError };

async function getJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(path, { headers: { "x-loom-token": token } });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError((data["error"] as string) || `HTTP ${res.status}`, res.status);
  return data as T;
}

/** 🆘 Help Me (wave 44, C9): fire the story's guest button for the program
 *  this device serves, as the device (`label`). "failed" when the server
 *  refused it or the story turned it down (its # hosts line says why). */
export async function askForHelp(config: ReinstallConfig, guest: string): Promise<"ok" | "failed"> {
  try {
    const r = await api<{ ok?: boolean; refused?: boolean }>(`${baseOf(config)}/api/mod/signal`, { name: TENT_HELP_SIGNAL, subject: guest, label: `Tent · ${config.name}`.slice(0, 60) }, config.token);
    return r.ok === true && r.refused !== true ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

/** Is the device's moderator token still honoured? (A server that is away
 *  is not a revoked token.) */
export async function tokenAlive(config: ReinstallConfig): Promise<boolean> {
  try {
    const res = await fetch(`${baseOf(config)}/api/mod/spatial/stations`, { headers: { "x-loom-token": config.token } });
    return res.status !== 401 && res.status !== 403;
  } catch {
    return true;
  }
}

/** Every guest / persona for the typed fallback, the corrupted first. */
export async function fetchCandidates(config: ReinstallConfig): Promise<Program[]> {
  const r = await getJson<{ players?: SpatialCandidate[] }>(`${baseOf(config)}/api/mod/spatial/candidates`, config.token);
  return (r.players ?? []).map(toProgram);
}

/** A candidate row → the tablet's `Program` (`restricted` false from a
 *  server that doesn't say; `marked` off the wave 18 server's flag, else
 *  read from `restricted`). */
export function toProgram(row: SpatialCandidate): Program {
  const restricted = (row as { restricted?: unknown }).restricted === true;
  const eligible = typeof row.eligible === "boolean" ? row.eligible : isEligible({ captured: row.captured, restricted });
  const flag = (row as { marked?: unknown }).marked;
  const marked = isMarked({ captured: row.captured, restricted, eligible, ...(typeof flag === "boolean" ? { marked: flag } : {}) });
  // After the end the server says `favour` (and `marked` false for everyone).
  const favour = (row as { favour?: unknown }).favour === true;
  const reinstalled = typeof row.reinstalled === "number" && Number.isFinite(row.reinstalled) ? Math.max(0, Math.floor(row.reinstalled)) : 0;
  return { id: row.id, name: row.name, captured: row.captured, restricted, eligible, marked, favour, location: row.location, reinstalled };
}

/** Has an ending played? (`night.ended` off the lean screen state, polled
 *  without a terminal name so the tablet never shows up as a terminal.)
 *  Null when the server can't say (no story yet, an older server, offline). */
export async function fetchNightEnded(config: ReinstallConfig): Promise<boolean | null> {
  try {
    const r = await getJson<{ night?: { ended?: unknown } | null }>(`${baseOf(config)}/api/screen/state`, config.token);
    const ended = r.night?.ended;
    return typeof ended === "boolean" ? ended : null;
  } catch {
    return null;
  }
}

/** The VR (and web) stations the server has seen. */
export async function fetchStations(config: ReinstallConfig): Promise<StationInfo[]> {
  const r = await getJson<{ stations?: StationInfo[] }>(`${baseOf(config)}/api/mod/spatial/stations`, config.token);
  return r.stations ?? [];
}

/** Start a program's simulation — here (no station) or parked for a headset. */
export async function begin(config: ReinstallConfig, guest: string, world: SpatialWorld, station: string | null = null): Promise<Assignment> {
  return api<Assignment>(`${baseOf(config)}/api/mod/spatial/begin`, { guest, world, device: config.name, ...(station !== null ? { station } : {}) }, config.token);
}

/** A director ends a session by its public id. */
export async function endSession(config: ReinstallConfig, session: string): Promise<void> {
  await api(`${baseOf(config)}/api/mod/spatial/end`, { session }, config.token);
}

/**
 * The story's LOCATIONs (the mod view, `GET /api/state` with the mod
 * token) — the map page's room picker and its "no room for LOCATION X"
 * check. Null when the server is away or has no story loaded.
 */
export async function fetchLocations(config: ReinstallConfig): Promise<{ id: string; label: string | null }[] | null> {
  try {
    return locationsOf(await getJson<{ locations?: unknown; phase?: unknown }>(`${baseOf(config)}/api/state?role=mod`, config.token));
  } catch {
    return null;
  }
}

/** The story's LOCATIONs off a mod view, or null = unknown. An empty list
 *  before the doors (an older server's null-sim view) is unknown too, never
 *  "the story has none": else every room reads "not a LOCATION" (LA-3). */
export function locationsOf(r: { locations?: unknown; phase?: unknown }): { id: string; label: string | null }[] | null {
  if (!Array.isArray(r.locations)) return null;
  if (r.locations.length === 0 && r.phase !== "open" && r.phase !== "paused") return null;
  return r.locations.flatMap((l: unknown) => {
    if (typeof l !== "object" || l === null) return [];
    const { id, label } = l as { id?: unknown; label?: unknown };
    return typeof id === "string" ? [{ id, label: typeof label === "string" ? label : null }] : [];
  });
}

export interface LoadedHouse {
  house: HouseMap;
  version: string;
  source: HouseResponse["source"] | "bundled";
  /** A game reading with its session token also learns its duck (§2.1) —
   *  a map edit mid-game may have moved or re-dealt it. */
  duck?: DuckSpot;
  /** …and the shared King (`kingOf`: null = none on the map; absent = an
   *  old server with no shared King). */
  king?: KingState | null;
}

/**
 * The event's house map (`token` = a mod token or a session token). When
 * the server can't be reached or answers nothing usable, the show's map
 * bundled into this app stands in (`source: "bundled"`).
 */
export async function fetchHouse(base: string, token: string): Promise<LoadedHouse> {
  try {
    const r = await getJson<HouseResponse & { duck?: unknown; king?: unknown }>(`${base}/api/spatial/house`, token);
    const v = validateHouse(r.house);
    const king = kingOf(r.king);
    if (v.ok && v.house !== undefined)
      return { house: v.house, version: r.version, source: r.source, ...(isDuckSpot(r.duck) ? { duck: r.duck } : {}), ...(king !== undefined ? { king } : {}) };
  } catch {
    /* fall through to the bundled map */
  }
  return { house: normalizeHouse(cloneData(showHouse)), version: "bundled", source: "bundled" };
}

/**
 * The map a freshly dealt session was dealt on (`version` = the
 * assignment's `houseVersion`): its spawn and duck spot are only valid on
 * that map, so the bundled stand-in or another version is no good. Tries
 * `attempts` times with a short backoff while the server can't be reached;
 * null when it never got it, or got a different version (the
 * caller ends the session and asks for a rescan — a director who saved in
 * between means a fresh `begin` deals on the new map).
 */
export async function fetchDealtHouse(
  base: string,
  token: string,
  version: string,
  opts: { attempts?: number; backoffMs?: number; fetch?: typeof fetchHouse; sleep?: (ms: number) => Promise<void> } = {},
): Promise<LoadedHouse | null> {
  const attempts = opts.attempts ?? 3;
  const get = opts.fetch ?? fetchHouse;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep((opts.backoffMs ?? 400) * 2 ** (i - 1));
    const loaded = await get(base, token);
    // The server answered: it is that map or a newer one (no retry fixes that).
    if (loaded.source !== "bundled") return loaded.version === version ? loaded : null;
  }
  return null;
}

/** Every map write's reply (a save, a variant switch, a save to the
 *  project), every outcome a value. */
export type MapReply<T> =
  | { ok: true; result: T }
  /** `conflict`: the map changed since `base` was loaded (409 `{error:
   *  "the map changed — reload", version}`) — nothing was saved; `version`
   *  is the server's current one. A 409 without a `version` (an event with
   *  no project, for a save to it) is not a conflict. */
  | { ok: false; status: number; error: string; problems: string[]; conflict: boolean; version: string | null };

export type SaveHouseReply = MapReply<SaveHouseResult>;

/** POST a map write as a moderator and fold the reply into a `MapReply`. */
async function postMap<T>(url: string, token: string, body: Record<string, unknown>, fetcher: typeof fetch): Promise<MapReply<T>> {
  const res = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-loom-token": token },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { ok: true, result: data as unknown as T };
  const problems = Array.isArray(data["problems"]) ? (data["problems"] as unknown[]).map(String) : [];
  const version = typeof data["version"] === "string" ? data["version"] : null;
  return {
    ok: false,
    status: res.status,
    error: typeof data["error"] === "string" ? data["error"] : `HTTP ${res.status}`,
    problems,
    conflict: res.status === 409 && version !== null,
    version,
  };
}

/**
 * Save a director's edit of the map. `base` is the version the editor
 * loaded: the server refuses (409, `conflict`) when another director saved
 * since, so two editors on one base never silently overwrite each other;
 * a null base (the bundled stand-in, say) skips the check. A refusal of a
 * bad map carries the server's problem list (400 `{error, problems}`).
 */
export async function saveHouse(config: ReinstallConfig, house: HouseMap, base: string | null = null, fetcher: typeof fetch = fetch): Promise<SaveHouseReply> {
  return postMap<SaveHouseResult>(`${baseOf(config)}/api/mod/spatial/house`, config.token, base !== null ? { house, base } : { house }, fetcher);
}

// --- the project's map variants (SW-MAP-01 / SW-MAP-13, §2.1) -----------

/** The event's whole-map variants (`house.json`, `house.shed.json`, …). */
export async function fetchVariants(base: string, token: string): Promise<MapVariantsResponse> {
  return getJson<MapVariantsResponse>(`${base}/api/mod/spatial/variants`, token);
}

/** Play another variant — the tent ↔ shed switch, mid-show too. `version`
 *  = the map version the page holds (null skips the check). */
export async function switchVariant(base: string, token: string, file: string, version: string | null, fetcher: typeof fetch = fetch): Promise<MapReply<SwitchVariantResult>> {
  return postMap<SwitchVariantResult>(`${base}/api/mod/spatial/variant`, token, version !== null ? { file, base: version } : { file }, fetcher);
}

/** "Save to project": the event's current map becomes a project file
 *  (`file` null = the active variant's), for the next launch and every
 *  co-writer. A 409 with no `version` = the event has no project. */
export async function saveToProject(base: string, token: string, file: string | null, version: string | null, fetcher: typeof fetch = fetch): Promise<MapReply<SaveToProjectResult>> {
  return postMap<SaveToProjectResult>(
    `${base}/api/mod/spatial/house/project`,
    token,
    { ...(file !== null ? { file } : {}), ...(version !== null ? { base: version } : {}) },
    fetcher,
  );
}

// --- a game's own calls (session token) ---------------------------------

/** One pose POST; resolves to the HTTP status, `null` when the network failed. */
export async function postPose(base: string, token: string, body: unknown): Promise<number | null> {
  try {
    const res = await fetch(`${base}/api/spatial/pose`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-loom-token": token },
      body: JSON.stringify(body),
      keepalive: true,
    });
    return res.status;
  } catch {
    return null;
  }
}

/** A judged find (`POST /api/spatial/found` 200, §2.1): `FoundResult` plus
 *  `captured` — whether the program is still in the Internet after the
 *  find was committed (null from a server that doesn't say). A captured
 *  program the find did not release is a refused reinstallation: the story
 *  kept them (the banishment), so the tablet never celebrates it. */
export type FoundAnswer = Omit<FoundResult, "captured"> & { captured: boolean | null };

export type FoundReply =
  | { kind: "found"; result: FoundAnswer }
  | { kind: "far"; distance: number | null }
  /** The doors are closed (the run is paused, or not open yet): the find
   *  wasn't judged, the session stays un-found — retry after a while. */
  | { kind: "paused" }
  | { kind: "over"; status: number }
  | { kind: "error"; message: string };

/** The 409 a closed event answers every participant action with. */
export const DOORS_CLOSED = "doors are closed";

/** `POST /api/spatial/found`, every outcome a value (409 is part of the
 *  game — "not near the duck" or "doors are closed", told apart by `error`). */
export async function postFound(base: string, token: string, fetcher: typeof fetch = fetch): Promise<FoundReply> {
  let res: Response;
  try {
    res = await fetcher(`${base}/api/spatial/found`, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: "{}" });
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) {
    const captured = typeof data["captured"] === "boolean" ? data["captured"] : null;
    return { kind: "found", result: { ok: true, released: data["released"] === true, already: data["already"] === true, captured } };
  }
  if (res.status === 409 && data["error"] === DOORS_CLOSED) return { kind: "paused" };
  if (res.status === 409) return { kind: "far", distance: typeof data["distance"] === "number" ? data["distance"] : null };
  if (res.status === 401 || res.status === 410 || res.status === 404) return { kind: "over", status: res.status };
  return { kind: "error", message: typeof data["error"] === "string" ? data["error"] : `HTTP ${res.status}` };
}

/** What the server said to a hit on the King (`POST /api/spatial/king/hit`,
 *  §2.1), every outcome a value. */
export type KingHitReply =
  /** Landed: one point off the shared bar, this visit's hit spent. */
  | { kind: "hit"; king: KingState }
  /** This visit already hit him (a re-scan mid-walk is the same visit). */
  | { kind: "already"; king: KingState | null }
  /** He has fallen already: nothing to hit. */
  | { kind: "fallen"; king: KingState | null }
  /** The server's copy of the pose isn't near him (or isn't facing him). */
  | { kind: "far" }
  /** The doors are closed (the run is paused): nothing was judged. */
  | { kind: "paused" }
  /** No shared King here (none on the map, or a server without the route). */
  | { kind: "none" }
  | { kind: "over"; status: number }
  | { kind: "error"; message: string };

/** `POST /api/spatial/king/hit {}` with the session token. Flush the pose
 *  first: the server judges the reach on the last one it has. */
export async function postKingHit(base: string, token: string, fetcher: typeof fetch = fetch): Promise<KingHitReply> {
  let res: Response;
  try {
    res = await fetcher(`${base}/api/spatial/king/hit`, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: "{}" });
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const king = kingOf(data["king"]) ?? null;
  const error = typeof data["error"] === "string" ? data["error"] : `HTTP ${res.status}`;
  if (res.ok) return king !== null ? { kind: "hit", king } : { kind: "error", message: "no king in the answer" };
  if (res.status === 409) {
    if (error === DOORS_CLOSED) return { kind: "paused" };
    if (error === "already hit") return { kind: "already", king };
    if (error === "fallen") return { kind: "fallen", king };
    if (error === "not near") return { kind: "far" };
    return { kind: "error", message: error }; // an unclaimed or parked session: try again in a moment
  }
  if (res.status === 404) return { kind: "none" };
  if (res.status === 401 || res.status === 410) return { kind: "over", status: res.status };
  return { kind: "error", message: error };
}

// --- game moments (wave 26, C6): the void, the heart, the virus disk -------

/** What a game asks the moment route about (the session token in `x-loom-token`). */
export type MomentRequest = { kind: "escape" } | { kind: "heart"; prop: string } | { kind: "pickup"; prop: string };

/** One line the story said to this program in that moment: display text,
 *  never pronounced (the game pronounces it for its own voice). */
export interface MomentLine {
  from: string;
  text: string;
}

/** The old server's generic 404 body (`server.ts`) — the new route never answers it. */
export const OLD_SERVER_404 = "not found";

/**
 * What the server said to a moment (`POST /api/spatial/moment`, C6), every
 * outcome a value. The two 404s are told apart by the `error` string only:
 * `"no such prop"` is the new route's; any other 404 body is an old server
 * without the route (`old`).
 */
export type MomentReply =
  | { kind: "escaped"; lines: MomentLine[]; spawn: Spawn | null; cooldownMs: number }
  | { kind: "heart"; lines: MomentLine[] }
  | { kind: "picked"; lines: MomentLine[]; item: string; prop: string }
  /** 400 — an unknown kind, or a heart / pickup with no prop: give up. */
  | { kind: "bad" }
  /** 404 `no such prop`: give up. */
  | { kind: "noProp" }
  /** Any other 404: an old server without the route. */
  | { kind: "old" }
  /** 401 / 410: the session is over. */
  | { kind: "over"; status: number }
  /** 409 doors are closed (paused, before doors). */
  | { kind: "paused" }
  /** 409: the session has not started — send a pose first. */
  | { kind: "parked" }
  | { kind: "notOut"; distance: number | null }
  | { kind: "cooldown"; retryMs: number | null }
  /** Heart: the King still stands. */
  | { kind: "sealed" }
  /** Heart: the last pose isn't inside his room. */
  | { kind: "notThere" }
  /** Pickup: the last pose is out of reach. */
  | { kind: "far"; distance: number | null }
  /** Heart heard / disk taken by this program tonight. */
  | { kind: "already" }
  | { kind: "error"; message: string };

/** The lines of a moment's answer (malformed entries dropped). */
export function momentLinesOf(raw: unknown): MomentLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((l: unknown) => {
    if (typeof l !== "object" || l === null) return [];
    const { from, text } = l as { from?: unknown; text?: unknown };
    return typeof text === "string" && text.trim() !== "" ? [{ from: typeof from === "string" ? from : "", text }] : [];
  });
}

function spawnOf(raw: unknown): Spawn | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { room, pos, yaw } = raw as { room?: unknown; pos?: unknown; yaw?: unknown };
  if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return { room: typeof room === "string" ? room : "", pos: [pos[0], pos[1], pos[2]], yaw: typeof yaw === "number" && Number.isFinite(yaw) ? yaw : 0 };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** `POST /api/spatial/moment` with the session token. Flush the pose first:
 *  the server judges the session's last pose, as for `king/hit`. */
export async function postMoment(base: string, token: string, req: MomentRequest, fetcher: typeof fetch = fetch): Promise<MomentReply> {
  let res: Response;
  try {
    res = await fetcher(`${base}/api/spatial/moment`, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: JSON.stringify(req) });
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const error = typeof data["error"] === "string" ? data["error"] : `HTTP ${res.status}`;
  if (res.ok) {
    const lines = momentLinesOf(data["lines"]);
    const kind = data["kind"] ?? req.kind;
    if (kind === "escape") return { kind: "escaped", lines, spawn: spawnOf(data["spawn"]), cooldownMs: num(data["cooldownMs"]) ?? 0 };
    if (kind === "heart") return { kind: "heart", lines };
    if (kind === "pickup") {
      const prop = typeof data["prop"] === "string" ? data["prop"] : req.kind === "pickup" ? req.prop : "";
      return { kind: "picked", lines, item: typeof data["item"] === "string" ? data["item"] : "", prop };
    }
    return { kind: "error", message: "an answer for another kind" };
  }
  if (res.status === 400) return { kind: "bad" };
  if (res.status === 401 || res.status === 410) return { kind: "over", status: res.status };
  if (res.status === 404) return error === "no such prop" ? { kind: "noProp" } : { kind: "old" };
  if (res.status === 409) {
    if (error === DOORS_CLOSED) return { kind: "paused" };
    if (error.startsWith("this session has not started")) return { kind: "parked" };
    if (error === "not out") return { kind: "notOut", distance: num(data["distance"]) };
    if (error === "cooldown") return { kind: "cooldown", retryMs: num(data["retryMs"]) };
    if (error === "sealed") return { kind: "sealed" };
    if (error === "not there") return { kind: "notThere" };
    if (error === "far") return { kind: "far", distance: num(data["distance"]) };
    if (error === "already") return { kind: "already" };
  }
  return { kind: "error", message: error };
}

// --- the descent (wave 49, C3): the words, and what a program told a prop -------

/**
 * The words of the descent (`GET /api/spatial/descent`), or null: no words,
 * and the visions play without them (an old server, nothing configured, no
 * network, a file that doesn't validate). Fetched at the start of a walk,
 * never blocking it. `token`: a session's, or a moderator's on the map page.
 */
export async function fetchDescent(base: string, token: string, fetcher: typeof fetch = fetch): Promise<DescentScript | null> {
  try {
    const res = await fetcher(`${base}/api/spatial/descent`, { headers: { "x-loom-token": token } });
    if (!res.ok) return null;
    const data = (await res.json()) as { script?: unknown };
    return parseDescent(data.script);
  } catch {
    return null;
  }
}

/** A talker remembers what it was told (`POST /api/spatial/told`). Best effort: memory only, for a later walk. */
export async function postTold(base: string, token: string, talker: string, mark: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher(`${base}/api/spatial/told`, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: JSON.stringify({ talker, mark }) });
    return res.ok;
  } catch {
    return false;
  }
}

/** `POST /api/spatial/end` — best effort (the session may be over already). */
/** The intro is over (wave 33): the server's run clock restarts. Best
 *  effort — an old server's 404, a dead session or no network change
 *  nothing here (the pose pump hears a dead session). */
export async function postReady(base: string, token: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher(`${base}/api/spatial/ready`, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: "{}" });
    return res.ok;
  } catch {
    return false;
  }
}

/** (wave 59) How `POST /api/spatial/reset` answered. `off`: nothing changed on
 *  the server (an older server, or no answer), and the walk goes on as it was. */
export type ResetReply = { kind: "reset"; duck: DuckSpot } | { kind: "over" } | { kind: "off" };

/** The run reset: the server re-seats this walk at the spawn and deals Gerald a new spot. */
export async function postReset(base: string, token: string, fetcher: typeof fetch = fetch): Promise<ResetReply> {
  try {
    const res = await fetcher(`${base}/api/spatial/reset`, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: "{}" });
    if (res.status === 401 || res.status === 410) return { kind: "over" };
    if (!res.ok) return { kind: "off" };
    const duck = ((await res.json()) as { duck?: unknown }).duck;
    return isDuckSpot(duck) ? { kind: "reset", duck } : { kind: "off" };
  } catch {
    return { kind: "off" };
  }
}

export async function postEnd(base: string, token: string): Promise<void> {
  try {
    await fetch(`${base}/api/spatial/end`, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: "{}", keepalive: true });
  } catch {
    /* gone either way */
  }
}

// --- suspend + resume (wave 40): a doffed headset / a hidden web tab --------

/** `POST /api/spatial/suspend` with the session token (wave 40): hold the
 *  walk so the server keeps it past the pose timeout for a short grace,
 *  ready to resume. Best effort, `keepalive` so it survives the tab going to
 *  the background (the x-loom-token header rules out `sendBeacon`). */
export async function postSuspend(base: string, token: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher(`${base}/api/spatial/suspend`, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: "{}", keepalive: true });
    return res.ok;
  } catch {
    return false;
  }
}

function poseOf(raw: unknown): PlayerPose | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { p, yaw, pitch } = raw as { p?: unknown; yaw?: unknown; pitch?: unknown };
  if (!Array.isArray(p) || p.length !== 3 || !p.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return { p: [p[0], p[1], p[2]], yaw: num(yaw) ?? 0, pitch: num(pitch) ?? 0 };
}

/** What `POST /api/spatial/resume` said (wave 40), every outcome a value. */
export type ResumeReply =
  /** The walk to pick up: the assignment to rebuild it, the pose to respawn
   *  at, and whether its intro was already done (resume in-house, not the video). */
  | { kind: "ok"; assignment: Assignment; pose: PlayerPose; ready: boolean }
  /** 401 / 410 / 404: the walk is gone (the grace elapsed, or it was taken over). */
  | { kind: "over"; status: number }
  | { kind: "error"; message: string };

/** `POST /api/spatial/resume {}` with the session token: pick a held walk
 *  back up where it was. */
export async function postResume(base: string, token: string, fetcher: typeof fetch = fetch): Promise<ResumeReply> {
  let res: Response;
  try {
    res = await fetcher(`${base}/api/spatial/resume`, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: "{}" });
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) {
    const pose = poseOf(data["pose"]);
    const assignment = data["assignment"];
    if (pose === null || typeof assignment !== "object" || assignment === null) return { kind: "error", message: "the resume answer was incomplete" };
    return { kind: "ok", assignment: assignment as Assignment, pose, ready: data["ready"] === true };
  }
  if (res.status === 401 || res.status === 410 || res.status === 404) return { kind: "over", status: res.status };
  return { kind: "error", message: typeof data["error"] === "string" ? data["error"] : `HTTP ${res.status}` };
}

/** The spatial stream's URL (a mod token or a session token). */
export function streamUrl(base: string, token: string, name: string): string {
  return `${base}/api/spatial/stream?name=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}`;
}

/** Why the spatial stream closed: the status of `GET /api/spatial/house`
 *  with the same token (the stream's own gate), null when unreachable. */
export function streamProbe(base: string, token: string, fetcher: typeof fetch = fetch): () => Promise<number | null> {
  return () =>
    fetcher(`${base}/api/spatial/house`, { headers: { "x-loom-token": token } }).then(
      (r) => r.status,
      () => null,
    );
}

// --- the terminals' camera feeds (wave 14, docs/loom-reinstall.md §2.3) ---

/** A fresh feed (`GET /api/spatial/cams`). */
export interface CamInfo {
  spot: string;
  at: number;
  w: number;
  h: number;
}

/** The fresh feeds; `status` null when the network failed (then `cams` is empty). */
export async function fetchCams(base: string, token: string, fetcher: typeof fetch = fetch): Promise<{ status: number | null; cams: CamInfo[] }> {
  try {
    const res = await fetcher(`${base}/api/spatial/cams`, { headers: { "x-loom-token": token }, cache: "no-store" });
    if (!res.ok) return { status: res.status, cams: [] };
    const data = (await res.json().catch(() => ({}))) as { cams?: unknown };
    const cams = Array.isArray(data.cams)
      ? data.cams.filter((c): c is CamInfo => typeof c === "object" && c !== null && typeof (c as CamInfo).spot === "string" && typeof (c as CamInfo).at === "number")
      : [];
    return { status: res.status, cams };
  } catch {
    return { status: null, cams: [] };
  }
}

/** One feed's latest frame (`GET /api/spatial/cam?spot=`): the JPEG and its
 *  `x-cam-at`, else the status (null = the network failed). */
export async function fetchCamFrame(
  base: string,
  token: string,
  spot: string,
  fetcher: typeof fetch = fetch,
): Promise<{ status: number | null; at: number | null; blob: Blob | null }> {
  try {
    const res = await fetcher(`${base}/api/spatial/cam?spot=${encodeURIComponent(spot)}`, { headers: { "x-loom-token": token }, cache: "no-store" });
    if (!res.ok) return { status: res.status, at: null, blob: null };
    const at = Number(res.headers.get("x-cam-at"));
    return { status: res.status, at: Number.isFinite(at) ? at : null, blob: await res.blob() };
  } catch {
    return { status: null, at: null, blob: null };
  }
}

// --- the voice link (wave 19, docs/loom-reinstall.md §2.4) -----------------

/** One μ-law chunk up (`POST /api/spatial/voice?seq=`): the status (null =
 *  the network failed) and the server's word on whether anybody hears this
 *  player (`listening`, null when it didn't say). Raw bytes, never
 *  `keepalive` (that budget is the pose pump's). */
export async function postVoice(
  base: string,
  token: string,
  seq: number,
  bytes: Uint8Array,
  fetcher: typeof fetch = fetch,
): Promise<{ status: number | null; listening: boolean | null; ears?: number }> {
  try {
    const res = await fetcher(`${base}/api/spatial/voice?seq=${seq}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-loom-token": token },
      body: bytes as BodyInit,
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      status: res.status,
      listening: typeof data["listening"] === "boolean" ? data["listening"] : null,
      ...(typeof data["ears"] === "number" ? { ears: data["ears"] } : {}),
    };
  } catch {
    return { status: null, listening: null };
  }
}

/** The voice stream's URL for a player (the session token). */
export function voiceStreamUrl(base: string, token: string): string {
  return `${base}/api/spatial/voice/stream?token=${encodeURIComponent(token)}`;
}
