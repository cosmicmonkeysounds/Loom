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
  MapVariantsResponse,
  SaveHouseResult,
  SaveToProjectResult,
  SpatialCandidate,
  SpatialWorld,
  StationInfo,
  SwitchVariantResult,
} from "@loom/house";
import { baseOf, type ReinstallConfig } from "./config.ts";
import type { Program } from "./program.ts";
import { NIGHT_ENDED, type ArmedRead } from "./game/fight.ts";
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
export async function fetchCandidates(config: ReinstallConfig): Promise<Program[]> {
  const r = await getJson<{ players?: SpatialCandidate[] }>(`${baseOf(config)}/api/mod/spatial/candidates`, config.token);
  return (r.players ?? []).map(toProgram);
}

/** A candidate row → the tablet's `Program` (`restricted` false from a server that doesn't say). */
export function toProgram(row: SpatialCandidate): Program {
  const restricted = (row as { restricted?: unknown }).restricted === true;
  return { id: row.id, name: row.name, captured: row.captured, restricted, location: row.location };
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

/** `POST /api/spatial/end` — best effort (the session may be over already). */
export async function postEnd(base: string, token: string): Promise<void> {
  try {
    await fetch(`${base}/api/spatial/end`, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: "{}", keepalive: true });
  } catch {
    /* gone either way */
  }
}

// --- the King (the tablet speaks for the story, with its mod token) --------

/** Retry waits for `postSignal`: 0.5 s doubling to 8 s. */
export const SIGNAL_RETRY_MS = [500, 1000, 2000, 4000, 8000] as const;

/** Where the tablet keeps its one pending story signal (the latest only), so
 *  a reload doesn't lose an unsent `chess won`. */
export const PENDING_SIGNAL_KEY = "loom-reinstall.pending-signal";
/** A pending signal this old is dropped, never posted: from the Y2K hour
 *  `chess won` hands the winner the server-room door code, so a win must not
 *  land minutes late (after a reload, the guest long gone) — a host fires ♟
 *  by hand instead. */
export const PENDING_SIGNAL_MAX_AGE_MS = 60_000;
/** One attempt is abandoned after this long (or when the signal would turn
 *  `PENDING_SIGNAL_MAX_AGE_MS` old): a black-holed uplink must fail fast,
 *  so "the win didn't reach the house" shows while the guest is still there. */
export const SIGNAL_ATTEMPT_TIMEOUT_MS = 5_000;

/** A story signal on its way to the event. */
export interface PendingSignal {
  eventId: string;
  name: string;
  subject: string;
  label: string;
  /** When the device first tried it (ms since the epoch). */
  at: number;
}

export type SignalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface SignalOptions {
  attempts?: number;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to `localStorage`; null (or a throwing one) keeps it in memory only. */
  storage?: SignalStorage | null;
  now?: () => number;
  /** Per attempt (default `SIGNAL_ATTEMPT_TIMEOUT_MS`). */
  timeoutMs?: number;
}

function browserStorage(): SignalStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function writePending(storage: SignalStorage | null, p: PendingSignal): void {
  try {
    storage?.setItem(PENDING_SIGNAL_KEY, JSON.stringify(p));
  } catch {
    /* blocked or full: in memory only */
  }
}

/** The stored pending signal, or null (none, unreadable, or not one). */
export function readPendingSignal(storage: SignalStorage | null = browserStorage()): PendingSignal | null {
  try {
    const raw = storage?.getItem(PENDING_SIGNAL_KEY);
    if (raw === null || raw === undefined) return null;
    const p = JSON.parse(raw) as Partial<PendingSignal>;
    const str = (v: unknown): v is string => typeof v === "string";
    return str(p.eventId) && str(p.name) && str(p.subject) && str(p.label) && typeof p.at === "number" && Number.isFinite(p.at)
      ? { eventId: p.eventId, name: p.name, subject: p.subject, label: p.label, at: p.at }
      : null;
  } catch {
    return null;
  }
}

/** Forget the stored signal — only when it is still `p` (a newer one wins), or whatever is there when `p` is null. */
function clearPending(storage: SignalStorage | null, p: PendingSignal | null): void {
  try {
    if (p !== null) {
      const cur = readPendingSignal(storage);
      if (cur !== null && (cur.at !== p.at || cur.name !== p.name || cur.subject !== p.subject)) return;
    }
    storage?.removeItem(PENDING_SIGNAL_KEY);
  } catch {
    /* nothing stored */
  }
}

/** The retry loop: "ok" on a 200, "refused" on a 4xx (final), "failed" when
 *  every attempt failed or the signal grew too old to send. */
async function sendSignal(config: ReinstallConfig, p: PendingSignal, opts: SignalOptions): Promise<"ok" | "refused" | "failed"> {
  const attempts = Math.max(1, opts.attempts ?? 1 + SIGNAL_RETRY_MS.length);
  const fetcher = opts.fetcher ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const body = JSON.stringify({ name: p.name, subject: p.subject, label: p.label });
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(SIGNAL_RETRY_MS[Math.min(i - 1, SIGNAL_RETRY_MS.length - 1)]!);
    const left = PENDING_SIGNAL_MAX_AGE_MS - (now() - p.at);
    if (left <= 0) return "failed";
    // A stalled request is aborted (a network failure): one that hung past
    // the cap could still land minutes after the win.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.min(opts.timeoutMs ?? SIGNAL_ATTEMPT_TIMEOUT_MS, left));
    try {
      const res = await fetcher(`${baseOf(config)}/api/mod/signal`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-loom-token": config.token },
        body,
        signal: ctl.signal,
      });
      if (res.ok) return "ok";
      if (res.status < 500) return "refused";
    } catch {
      /* the network (or the timeout): try again */
    } finally {
      clearTimeout(timer);
    }
  }
  return "failed";
}

/**
 * Fire a story signal as this device: `POST /api/mod/signal {name, subject,
 * label}` with the moderator token (`label` = the device's name, so the
 * journal reads "by Tent tablet" on a server that honours it). Retries a
 * network failure or a 5xx `attempts` times (0.5 → 8 s); a 4xx is final.
 * Resolves true on a 200. While a send is in flight it is also kept in
 * `localStorage` (the latest only), so a reload or crash mid-retry can post
 * it from `flushPendingSignal` — within `PENDING_SIGNAL_MAX_AGE_MS` of the
 * first try. Once it fails for good it is forgotten: the caller tells the
 * guest to get a host (`WIN_NOT_SENT`), and a late post after the host's ♟
 * would land the win twice.
 */
export async function postSignal(config: ReinstallConfig, name: string, subject: string, opts: SignalOptions = {}): Promise<boolean> {
  const storage = opts.storage === undefined ? browserStorage() : opts.storage;
  const p: PendingSignal = { eventId: config.eventId, name, subject, label: config.name, at: (opts.now ?? Date.now)() };
  writePending(storage, p);
  const r = await sendSignal(config, p, opts);
  clearPending(storage, p);
  return r === "ok";
}

/**
 * On page load: post the signal a previous page left unsent — once, and
 * only while it is fresh (< `PENDING_SIGNAL_MAX_AGE_MS`) and for this
 * device's event. Anything older, or for another event, is dropped unsent.
 */
export async function flushPendingSignal(config: ReinstallConfig, opts: SignalOptions = {}): Promise<"none" | "dropped" | "sent" | "refused" | "failed"> {
  const storage = opts.storage === undefined ? browserStorage() : opts.storage;
  const p = readPendingSignal(storage);
  if (p === null) {
    clearPending(storage, null); // an unreadable entry
    return "none";
  }
  const age = (opts.now ?? Date.now)() - p.at;
  if (p.eventId !== config.eventId || age < 0 || age >= PENDING_SIGNAL_MAX_AGE_MS) {
    clearPending(storage, p);
    return "dropped";
  }
  const r = await sendSignal(config, p, opts);
  // A failure stays stored until it ages out (the next load drops it).
  if (r !== "failed") clearPending(storage, p);
  return r === "ok" ? "sent" : r;
}

/** `fetchArmed` gives up (null = unknown) after this long: the checkmate's
 *  notice waits on it, so a black-holed uplink must never hold back "tell a
 *  host" past the signal's own retries. */
export const ARMED_TIMEOUT_MS = 4_000;

/**
 * Is the fight armed? Reads the mod view (`GET /api/state?role=mod`, as
 * `fetchLocations` does) for the world var at `path` and compares it with
 * `min`; null when the server is away, too slow (`timeoutMs`), or the var
 * is absent / not a number; `NIGHT_ENDED` once the night has ended
 * (`ENDED_PATH` true: the story gives nothing for a win then, while an armed
 * var like `Night.step` stays past its gate — so no badge and no "the code
 * is in your Codex", whatever an earlier read said) or the verdict is in
 * (`KING_ARMED_PATH` 0 with `VERDICT_PATH` true). A story's
 * `KING_ARMED_PATH` overrides `path` / `min`.
 */
export async function fetchArmed(config: ReinstallConfig, path: string, min: number, fetcher: typeof fetch = fetch, timeoutMs: number = ARMED_TIMEOUT_MS): Promise<ArmedRead> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve(null);
    }, timeoutMs);
  });
  try {
    return await Promise.race([readArmed(config, path, min, fetcher, ctl.signal), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The world var a show sets once an ending plays (`Night.ended`). Never
 *  read as "practice": an ended night is `NIGHT_ENDED`, not unarmed. */
export const ENDED_PATH = "Night.ended";

/** The story's own word on the King's stakes (wave 9, story-rules): 1 from
 *  the Y2K hour until 📄 truth.txt or an ending, else 0. When the story
 *  declares it, it wins over the map's `armed` gate — `Night.step` stays
 *  past 14 after 📄, so the gate alone kept saying FOR THE CODE. A story
 *  without it (an older show) is read off the map's gate as before. */
export const KING_ARMED_PATH = "Night.king_armed";
/** Round three closed (📄 truth.txt): with the King disarmed, the verdict is
 *  in and a win gives nothing — read like `NIGHT_ENDED` (no badge, no win
 *  line, no "tell a host"), never "practice until the Y2K clock". */
export const VERDICT_PATH = "Night.r3_closed";

async function readArmed(config: ReinstallConfig, path: string, min: number, fetcher: typeof fetch, signal: AbortSignal): Promise<ArmedRead> {
  try {
    const res = await fetcher(`${baseOf(config)}/api/state?role=mod`, { headers: { "x-loom-token": config.token }, signal });
    if (!res.ok) return null;
    const r = (await res.json()) as { world?: unknown };
    if (!Array.isArray(r.world)) return null;
    const rowAt = (p: string) => (r.world as unknown[]).find((w: unknown) => typeof w === "object" && w !== null && (w as { path?: unknown }).path === p) as { value?: unknown } | undefined;
    const yes = (v: unknown) => v === true || v === "true";
    const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN);
    if (yes(rowAt(ENDED_PATH)?.value)) return NIGHT_ENDED;
    const king = rowAt(KING_ARMED_PATH);
    if (king !== undefined && Number.isFinite(num(king.value))) {
      if (num(king.value) >= 1) return true;
      return yes(rowAt(VERDICT_PATH)?.value) ? NIGHT_ENDED : false;
    }
    const row = rowAt(path);
    if (row === undefined) return null;
    const v = num(row.value);
    return Number.isFinite(v) ? v >= min : null;
  } catch {
    return null;
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
