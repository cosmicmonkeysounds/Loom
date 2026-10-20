//! The spatial plane's routes (`docs/loom-reinstall.md` §2.1), as the web
//! game and the map page call them. Moderator calls carry the device's mod
//! token; a game's own high-rate calls carry its session token. Errors are
//! the play app's `ApiError` (the server's `error` text + the HTTP status).

import { api, ApiError } from "@loom/play/client.ts";
import { cloneData, normalizeHouse, validateHouse } from "@loom/house";
import type {
  Assignment,
  DuckSpot,
  FoundResult,
  HouseMap,
  HouseResponse,
  KingState,
  MapVariantsResponse,
  SaveHouseResult,
  SaveToProjectResult,
  SpatialCandidate,
  SpatialWorld,
  StationInfo,
  SwitchVariantResult,
} from "@loom/house";
import { baseOf, type ReinstallConfig } from "./config.ts";
import { isEligible, type Program } from "./program.ts";
import { showHouse } from "./show-house.ts";
import { isDuckSpot, kingOf } from "./spatial.ts";

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
export async function fetchCandidates(config: ReinstallConfig): Promise<Program[]> {
  const r = await getJson<{ players?: SpatialCandidate[] }>(`${baseOf(config)}/api/mod/spatial/candidates`, config.token);
  return (r.players ?? []).map(toProgram);
}

/** A candidate row → the tablet's `Program` (`restricted` false from a server that doesn't say). */
export function toProgram(row: SpatialCandidate): Program {
  const restricted = (row as { restricted?: unknown }).restricted === true;
  const eligible = typeof row.eligible === "boolean" ? row.eligible : isEligible({ captured: row.captured, restricted });
  return { id: row.id, name: row.name, captured: row.captured, restricted, eligible, location: row.location };
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
    const r = await getJson<{ locations?: unknown }>(`${baseOf(config)}/api/state?role=mod`, config.token);
    if (!Array.isArray(r.locations)) return null;
    return r.locations.flatMap((l: unknown) => {
      if (typeof l !== "object" || l === null) return [];
      const { id, label } = l as { id?: unknown; label?: unknown };
      return typeof id === "string" ? [{ id, label: typeof label === "string" ? label : null }] : [];
    });
  } catch {
    return null;
  }
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
