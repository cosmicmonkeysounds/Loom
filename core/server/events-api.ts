//! Control-plane HTTP: launching + controlling a project's live event.
//!
//! An author launches an event (live or a private preview) from their
//! dashboard; the server snapshots the project's `.loom` source, reuses the
//! project's previous event's three passcodes (minting them on a first
//! launch — codes are pinned so End → relaunch keeps printed QRs working;
//! a launch body's `rotate: "staff"` mints fresh performer + mod codes and
//! keeps the guest code, `rotate: true` mints all three),
//! records the event, and spins up (or reuses) its `EventRuntime` with the
//! doors open. Guests then join with the event code —
//! their experience is the ordinary per-event flow, unchanged.
//!
//! One active event per project is enforced both here and by a partial unique
//! index on `event`.
//!
//! The project's house maps (`house.json`, `house.<variant>.json`) are
//! snapshotted beside the source (`event.house_maps`, SW-MAP-01): a launch
//! plays the project's current map, a reload refreshes it, and the runtime
//! gets a `ProjectLink` back so the map page can "Save to project".

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { makePass, type Passcodes } from "./auth.ts";
import { collabHub } from "./collab.ts";
import { readBody, sendJson, str } from "./http-util.ts";
import type { EventRegistry, EventSpec } from "./registry.ts";
import type { AuthUser } from "./projects.ts";
import { asMapFiles, type ProjectLink } from "./house-maps.ts";
import {
  activeEvent,
  setEventSource,
  createEvent,
  getProjectFor,
  lastEventCodes,
  lastEventMapVariant,
  projectMaps,
  projectSource,
  setEventHouseMaps,
  setEventMapVariant,
  setEventMode,
  setEventStatus,
  upsertFile,
  type EventRow,
} from "./db/queries.ts";

export interface EventContext {
  registry: EventRegistry;
  joinBase: () => string;
}

/** The `EventSpec` the registry needs to (re)build a row's runtime. */
export function specFromRow(row: EventRow): EventSpec {
  return {
    eventId: row.id,
    codes: { event: row.event_code, prime: row.prime_code, mod: row.mod_code },
    scenarioName: row.scenario_name,
    scenarioSource: row.scenario_source,
    mode: row.mode === "preview" ? "preview" : "live",
    houseMaps: asMapFiles(row.house_maps),
    mapVariant: row.map_variant ?? null,
    project: projectLink(row.project_id, row.id),
  };
}

/**
 * An event's way back to its project (`house-maps.ts` `ProjectLink`): a map
 * file is written like `PUT /api/projects/:id/files` writes one — upserted,
 * folded into the live co-editing doc when it's open, announced to every
 * editor's tree — and the event row's snapshot follows.
 */
export function projectLink(projectId: string, eventId: string): ProjectLink {
  return {
    projectId,
    async writeFile(path, content) {
      const file = await upsertFile(projectId, path, content);
      collabHub().adoptExternalWrite(projectId, path, file.content);
      collabHub().notifyFileChange(projectId, "put", path);
    },
    async saveSnapshot(maps) {
      await setEventHouseMaps(eventId, maps);
    },
    async saveVariant(file) {
      await setEventMapVariant(eventId, file);
    },
  };
}

/** The dashboard-facing view of an event, including its live phase + codes. */
function eventView(row: EventRow, joinBase: () => string, phase?: string, stale?: boolean) {
  return {
    id: row.id,
    projectId: row.project_id,
    mode: row.mode,
    status: phase ?? row.status,
    codes: { event: row.event_code, prime: row.prime_code, mod: row.mod_code },
    joinUrl: `${joinBase()}/?code=${row.event_code}`,
    createdAt: row.created_at,
    /** Display name of the author who launched it. */
    startedBy: row.created_by_name ?? null,
    /** The project's files have moved on since the running snapshot was
     *  taken — "Push current draft" would change what guests play. */
    ...(stale !== undefined ? { stale } : {}),
  };
}

/** Display name for attribution (`by` on lifecycle notices + journal lines). */
function nameOf(user: AuthUser): string {
  return user.name || user.email;
}

// Every open editor polls the status route; flushing the collab docs on each
// poll would persist every project every few seconds for nothing. Flush at
// most once per FLUSH_EVERY_MS per project when computing `stale`.
const FLUSH_EVERY_MS = 5_000;
const lastFlush = new Map<string, number>();

/** Is the project's current text different from what the event runs on? */
async function sourceIsStale(projectId: string, running: string): Promise<boolean> {
  const now = Date.now();
  if (now - (lastFlush.get(projectId) ?? 0) >= FLUSH_EVERY_MS) {
    lastFlush.set(projectId, now);
    await collabHub().flush(projectId);
  }
  const src = await projectSource(projectId);
  return src !== null && src.source !== running;
}

/** Mint three fresh passcodes for a new event. */
function freshCodes(): Passcodes {
  return { event: makePass(), prime: makePass(), mod: makePass() };
}

/**
 * How a launch treats the project's pinned codes (K-10): `none` reuses them
 * all (End → relaunch keeps every printed QR working), `staff` keeps the
 * guest code but mints fresh performer + mod codes (a leaked staff code,
 * printed join QRs untouched), `all` mints three fresh codes.
 */
export type CodeRotation = "none" | "staff" | "all";

/** The launch body's `rotate` field: `true` / `"all"` → all, `"staff"` → staff. */
export function parseRotation(raw: unknown): CodeRotation {
  if (raw === true || raw === "all") return "all";
  if (raw === "staff") return "staff";
  return "none";
}

/**
 * The codes a launch tries on `attempt`: the project's previous event's codes
 * first (pinned — or partly, per `rotate`), fresh ones if there were none or
 * the pinned set collided with another live event.
 */
export function launchCodes(previous: Passcodes | null, attempt: number, mint: () => Passcodes = freshCodes, rotate: CodeRotation = "none"): Passcodes {
  if (attempt !== 0 || previous === null || rotate === "all") return mint();
  return rotate === "staff" ? { ...mint(), event: previous.event } : { ...previous };
}

/**
 * Insert a launch row, trying the pinned codes first and fresh ones on a
 * collision (another project's live event holds them — the unique indexes
 * throw). Three attempts; the last error propagates.
 */
export async function insertWithCodes<T>(
  previous: Passcodes | null,
  insert: (codes: Passcodes) => Promise<T>,
  opts: { rotate?: CodeRotation; mint?: () => Passcodes; warn?: (msg: string) => void } = {},
): Promise<T> {
  const rotate = opts.rotate ?? "none";
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  for (let attempt = 0; ; attempt++) {
    const codes = launchCodes(previous, attempt, opts.mint, rotate);
    if (attempt === 1 && previous !== null && rotate !== "all") {
      warn("pinned codes are taken by another live event; minting fresh ones");
    }
    try {
      return await insert(codes);
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
}

/**
 * Handle `/api/projects/:id/event[/action]` for a signed-in author.
 * `segs` is the split path (`["api","projects",id,"event", action?]`).
 */
export async function handleEvent(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  segs: string[],
  user: AuthUser,
  ctx: EventContext,
): Promise<boolean> {
  const projectId = segs[2]!;
  const action = segs[4]; // undefined | "pause" | "resume" | "end" | "reload" | "golive"
  const { registry, joinBase } = ctx;
  const by = nameOf(user);

  // Owner or invited collaborator — the whole writing team can launch and
  // control a project's event (a shared rehearsal is the point of a preview).
  const project = await getProjectFor(user.id, projectId);
  if (project === null) {
    sendJson(res, 404, { error: "no such project" });
    return true;
  }

  // GET /api/projects/:id/event — the active event (or null).
  if (segs.length === 4 && method === "GET") {
    const active = await activeEvent(projectId);
    if (active === null) {
      sendJson(res, 200, { event: null });
      return true;
    }
    const runtime = registry.get(active.id);
    const running = runtime?.source ?? active.scenario_source;
    sendJson(res, 200, { event: eventView(active, joinBase, runtime?.currentPhase, await sourceIsStale(projectId, running)) });
    return true;
  }

  // POST /api/projects/:id/event — launch.
  if (segs.length === 4 && method === "POST") {
    const existing = await activeEvent(projectId);
    if (existing !== null) {
      sendJson(res, 409, { error: "an event is already active for this project", event: eventView(existing, joinBase) });
      return true;
    }
    // Live co-editing persists on a debounce — flush so the launch snapshot
    // is the text the authors are looking at right now.
    await collabHub().flush(projectId);
    const src = await projectSource(projectId);
    if (src === null) {
      sendJson(res, 400, { error: "project has no files to run" });
      return true;
    }
    const maps = await projectMaps(projectId);
    const body = await readBody(req);
    const mode = str(body, "mode") === "preview" ? "preview" : "live";

    // Insert the row. Codes are pinned to the project: reuse the last
    // event's (ended events free their codes), falling back to fresh ones on
    // a collision with another project's live event. `rotate` ("staff" /
    // true) is how a leaked code gets replaced.
    const previous = await lastEventCodes(projectId);
    // The tent ↔ shed choice carries over too: a relaunch on a rain night
    // stays on the shed (a variant the project no longer has falls back to
    // house.json in the runtime).
    const mapVariant = await lastEventMapVariant(projectId);
    const row = await insertWithCodes(
      previous,
      (codes) =>
        createEvent({
          id: randomUUID(),
          project_id: projectId,
          mode,
          status: "open",
          event_code: codes.event,
          prime_code: codes.prime,
          mod_code: codes.mod,
          scenario_name: project.name,
          scenario_source: src.source,
          created_by_name: by,
          house_maps: maps,
          map_variant: mapVariant,
        }),
      { rotate: parseRotation(body["rotate"]), warn: (m) => console.warn(`[events] project ${projectId}: ${m}`) },
    );

    const runtime = registry.ensure(specFromRow(row));
    runtime.openDoors();
    collabHub().notifyEvent(projectId, { kind: "launched", by, eventId: row.id, mode });
    sendJson(res, 200, { event: eventView(row, joinBase, runtime.currentPhase) });
    return true;
  }

  // POST /api/projects/:id/event/{pause,resume,end}
  if (segs.length === 5 && method === "POST") {
    const active = await activeEvent(projectId);
    if (active === null) {
      sendJson(res, 404, { error: "no active event" });
      return true;
    }
    const notify = (kind: "golive" | "ended" | "reload" | "paused" | "resumed", mode = active.mode) =>
      collabHub().notifyEvent(projectId, { kind, by, eventId: active.id, mode });
    if (action === "pause") {
      registry.get(active.id)?.pause();
      await setEventStatus(active.id, "paused");
      notify("paused");
      sendJson(res, 200, { event: eventView(active, joinBase, "paused") });
      return true;
    }
    if (action === "resume") {
      const runtime = registry.ensure(specFromRow(active));
      runtime.openDoors();
      await setEventStatus(active.id, "open");
      notify("resumed");
      sendJson(res, 200, { event: eventView(active, joinBase, runtime.currentPhase) });
      return true;
    }
    if (action === "end") {
      registry.stop(active.id, by);
      await setEventStatus(active.id, "ended");
      notify("ended");
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (action === "golive") {
      // Promote the rehearsal in place: same id, codes, and QR (posters
      // printed during the rehearsal keep working); the story restarts fresh
      // and every rehearsal guest / persona / performer sign-in is cut.
      if (active.mode !== "preview") {
        sendJson(res, 409, { error: "already live", event: eventView(active, joinBase) });
        return true;
      }
      // The DB write first: it can fail harmlessly; the restart below is the
      // irreversible cut (tokens cleared, booths signed out).
      await setEventMode(active.id, "live");
      const promoted: EventRow = { ...active, mode: "live" };
      const runtime = registry.ensure(specFromRow(promoted));
      runtime.restart(undefined, undefined, { kind: "golive", by });
      notify("golive", "live");
      sendJson(res, 200, {
        event: eventView(promoted, joinBase, runtime.currentPhase, await sourceIsStale(projectId, runtime.source)),
      });
      return true;
    }
    if (action === "reload") {
      // Push the project's current text into the running event: the story
      // starts over on the new draft (journal + chat cleared, entry beat
      // replayed if the doors are open). Guests keep their codes. The map
      // snapshot follows the project's files too (the active variant kept).
      await collabHub().flush(projectId);
      const src = await projectSource(projectId);
      if (src === null) {
        sendJson(res, 400, { error: "project has no files to run" });
        return true;
      }
      const maps = await projectMaps(projectId);
      const runtime = registry.ensure(specFromRow(active));
      runtime.restart(src.source, project.name, { kind: "reload", by });
      runtime.setProjectMaps(maps);
      await setEventSource(active.id, src.source);
      await setEventHouseMaps(active.id, maps);
      notify("reload");
      sendJson(res, 200, { event: eventView({ ...active, scenario_source: src.source }, joinBase, runtime.currentPhase, false) });
      return true;
    }
  }

  return false;
}
