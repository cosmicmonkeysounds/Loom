//! Control-plane HTTP: launching + controlling a project's live event.
//!
//! An author launches an event (live or a private preview) from their
//! dashboard; the server snapshots the project's `.loom` source, mints the
//! three passcodes, records the event, and spins up (or reuses) its
//! `EventRuntime` with the doors open. Guests then join with the event code —
//! their experience is the ordinary per-event flow, unchanged.
//!
//! One active event per project is enforced both here and by a partial unique
//! index on `event`.

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { makePass, type Passcodes } from "./auth.ts";
import { collabHub } from "./collab.ts";
import { readBody, sendJson, str } from "./http-util.ts";
import type { EventRegistry, EventSpec } from "./registry.ts";
import type { AuthUser } from "./projects.ts";
import {
  activeEvent,
  setEventSource,
  createEvent,
  getProjectFor,
  projectSource,
  setEventMode,
  setEventStatus,
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
    const body = await readBody(req);
    const mode = str(body, "mode") === "preview" ? "preview" : "live";

    // Insert the row (retrying on the astronomically-rare code collision).
    let row: EventRow | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const codes = freshCodes();
      try {
        row = await createEvent({
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
        });
        break;
      } catch (err) {
        if (attempt === 2) throw err;
      }
    }

    const runtime = registry.ensure(specFromRow(row!));
    runtime.openDoors();
    collabHub().notifyEvent(projectId, { kind: "launched", by, eventId: row!.id, mode });
    sendJson(res, 200, { event: eventView(row!, joinBase, runtime.currentPhase) });
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
      const runtime = registry.ensure(specFromRow(active));
      runtime.restart(undefined, undefined, { kind: "golive", by });
      notify("golive", "live");
      const promoted: EventRow = { ...active, mode: "live" };
      sendJson(res, 200, {
        event: eventView(promoted, joinBase, runtime.currentPhase, await sourceIsStale(projectId, runtime.source)),
      });
      return true;
    }
    if (action === "reload") {
      // Push the project's current text into the running event: the story
      // starts over on the new draft (journal + chat cleared, entry beat
      // replayed if the doors are open). Guests keep their codes.
      await collabHub().flush(projectId);
      const src = await projectSource(projectId);
      if (src === null) {
        sendJson(res, 400, { error: "project has no files to run" });
        return true;
      }
      const runtime = registry.ensure(specFromRow(active));
      runtime.restart(src.source, project.name, { kind: "reload", by });
      await setEventSource(active.id, src.source);
      notify("reload");
      sendJson(res, 200, { event: eventView({ ...active, scenario_source: src.source }, joinBase, runtime.currentPhase, false) });
      return true;
    }
  }

  return false;
}
