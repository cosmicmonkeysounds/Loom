//! The spatial plane's routes (`docs/loom-reinstall.md` §2.1), as the web
//! game and the map page call them. Moderator calls carry the device's mod
//! token; a game's own high-rate calls carry its session token. Errors are
//! the play app's `ApiError` (the server's `error` text + the HTTP status).

import { api, ApiError } from "@loom/play/client.ts";
import { normalizeHouse, validateHouse } from "@loom/house";
import type { Assignment, DuckSpot, FoundResult, HouseMap, HouseResponse, SaveHouseResult, SpatialCandidate, SpatialWorld, StationInfo } from "@loom/house";
import { baseOf, type ReinstallConfig } from "./config.ts";
import { showHouse } from "./show-house.ts";
import { isDuckSpot } from "./spatial.ts";

export { ApiError };

async function getJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(path, { headers: { "x-loom-token": token } });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError((data["error"] as string) || `HTTP ${res.status}`, res.status);
  return data as T;
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
export async function fetchCandidates(config: ReinstallConfig): Promise<SpatialCandidate[]> {
  const r = await getJson<{ players?: SpatialCandidate[] }>(`${baseOf(config)}/api/mod/spatial/candidates`, config.token);
  return r.players ?? [];
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

export interface LoadedHouse {
  house: HouseMap;
  version: string;
  source: HouseResponse["source"] | "bundled";
  /** A game reading with its session token also learns its duck (§2.1) —
   *  a map edit mid-game may have moved or re-dealt it. */
  duck?: DuckSpot;
}

/**
 * The event's house map (`token` = a mod token or a session token). When
 * the server can't be reached or answers nothing usable, the show's map
 * bundled into this app stands in (`source: "bundled"`).
 */
export async function fetchHouse(base: string, token: string): Promise<LoadedHouse> {
  try {
    const r = await getJson<HouseResponse & { duck?: unknown }>(`${base}/api/spatial/house`, token);
    const v = validateHouse(r.house);
    if (v.ok && v.house !== undefined) return { house: v.house, version: r.version, source: r.source, ...(isDuckSpot(r.duck) ? { duck: r.duck } : {}) };
  } catch {
    /* fall through to the bundled map */
  }
  return { house: normalizeHouse(structuredClone(showHouse)), version: "bundled", source: "bundled" };
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

export type SaveHouseReply =
  | { ok: true; result: SaveHouseResult }
  /** `conflict`: the map changed since `base` was loaded (409 `{error:
   *  "the map changed — reload", version}`) — nothing was saved; `version`
   *  is the server's current one. */
  | { ok: false; status: number; error: string; problems: string[]; conflict: boolean; version: string | null };

/**
 * Save a director's edit of the map. `base` is the version the editor
 * loaded: the server refuses (409, `conflict`) when another director saved
 * since, so two editors on one base never silently overwrite each other;
 * a null base (the bundled stand-in, say) skips the check. A refusal of a
 * bad map carries the server's problem list (400 `{error, problems}`).
 */
export async function saveHouse(config: ReinstallConfig, house: HouseMap, base: string | null = null, fetcher: typeof fetch = fetch): Promise<SaveHouseReply> {
  const res = await fetcher(`${baseOf(config)}/api/mod/spatial/house`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-loom-token": config.token },
    body: JSON.stringify(base !== null ? { house, base } : { house }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { ok: true, result: data as unknown as SaveHouseResult };
  const problems = Array.isArray(data["problems"]) ? (data["problems"] as unknown[]).map(String) : [];
  const version = typeof data["version"] === "string" ? data["version"] : null;
  return {
    ok: false,
    status: res.status,
    error: typeof data["error"] === "string" ? data["error"] : `HTTP ${res.status}`,
    problems,
    conflict: res.status === 409,
    version,
  };
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

export type FoundReply =
  | { kind: "found"; result: FoundResult }
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
  if (res.ok) return { kind: "found", result: { ok: true, released: data["released"] === true, already: data["already"] === true } };
  if (res.status === 409 && data["error"] === DOORS_CLOSED) return { kind: "paused" };
  if (res.status === 409) return { kind: "far", distance: typeof data["distance"] === "number" ? data["distance"] : null };
  if (res.status === 401 || res.status === 410 || res.status === 404) return { kind: "over", status: res.status };
  return { kind: "error", message: typeof data["error"] === "string" ? data["error"] : `HTTP ${res.status}` };
}

/** `POST /api/spatial/end` — best effort (the session may be over already). */
export async function postEnd(base: string, token: string): Promise<void> {
  try {
    await fetch(`${base}/api/spatial/end`, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: "{}", keepalive: true });
  } catch {
    /* gone either way */
  }
}

/** The spatial stream's URL (a mod token or a session token). */
export function streamUrl(base: string, token: string, name: string): string {
  return `${base}/api/spatial/stream?name=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}`;
}
