//! The control plane's boot — waiting for the database, rehydrating the live
//! events, and saying honestly how far it got (C1: T4-02, T4-03, S1-ops-01).
//!
//! The process listens at once: the default (LAN) event restores
//! synchronously before `listen`, so a house with no database never waits.
//! The DB-backed events only exist once the control plane has reached the
//! database, migrated and re-registered every non-ended `event` row. Until
//! then a request for an event the registry doesn't know is *not* "gone":
//! the router answers 503 `starting` (+ `retry-after: 1`) rather than the
//! 404 `unknown event` the play app and the terminals read as "this event
//! has ended" (a dropped guest session, a terminal back at setup).
//!
//! With `DATABASE_URL` set explicitly (the SaaS deployment) a database that
//! isn't accepting connections yet — a host reboot races Postgres, a
//! `docker compose restart` catches it in recovery — is retried with a
//! capped backoff for as long as it takes, never given up on: a process
//! whose control plane stayed off would host none of the show's events for
//! its whole life while looking healthy. With the dev default (no
//! `DATABASE_URL`) one probe decides, as before, so a LAN box with no
//! Postgres boots straight into "event plane only".
//!
//! `GET /api/health` reads `ControlPlaneBoot.health`: 200 `{ok: true,
//! controlPlane, events}` on a LAN box (no `DATABASE_URL`) or once the
//! control plane is up and every live row is hosted; otherwise 503
//! `{ok: false, reason}` — `database` while the database is unreachable,
//! `starting` while it is migrating / rehydrating, `events` (+ `failed`, their ids) when a live row would not rehydrate.
//! A row that would not rehydrate is remembered, so its phones get 503
//! `event failed to load` — never the 404 that signs them out — and its
//! codes say the same at the door (`missEvent` / `missCode`). Pure and
//! clock-free (the sleep is injected) so the rules are unit-testable.

import { passOk } from "./auth.ts";

/** Where the control plane's boot stands. */
export type BootPhase =
  /** Not yet probed, or probing for the first time. */
  | "starting"
  /** The database is unreachable; retrying (`DATABASE_URL` set). */
  | "waiting"
  /** Reached + migrated; re-registering the live events. */
  | "rehydrating"
  /** On, every live event hosted. */
  | "up"
  /** Off for this process (no database on a LAN box, or refused). */
  | "off";

/** Why `/api/health` answers 503. */
export type HealthReason = "database" | "starting" | "events";

/** The `/api/health` answer. */
export interface HealthAnswer {
  status: 200 | 503;
  body: { ok: true; controlPlane: boolean; events: number; failed?: string[] } | { ok: false; reason: HealthReason; failed?: string[] };
}

/** The router's answer for an event id / a code it doesn't host. */
export interface MissAnswer {
  status: 404 | 503;
  body: { error: string };
  /** Seconds, for `retry-after` (503 only). */
  retryAfter?: number;
}

/** A live row's identity, for remembering one that would not host. */
export interface RowKey {
  id: string;
  /** Its event / performer / mod codes. */
  codes: string[];
}

/** The first retry waits 1 s, doubling to this ceiling. */
export const DB_RETRY_MAX_MS = 15_000;

/** The wait before retry number `attempt` (0-based): 1, 2, 4, 8, 15, 15… s. */
export function dbRetryDelay(attempt: number): number {
  return Math.min(DB_RETRY_MAX_MS, 1000 * 2 ** Math.min(attempt, 10));
}

export class ControlPlaneBoot {
  phase: BootPhase = "starting";
  /** How many live events the rehydrate re-registered. */
  rehydrated = 0;
  /** Live rows whose rehydrate threw, by id. */
  readonly failed = new Map<string, RowKey>();

  /** @param required `DATABASE_URL` was set explicitly: the deployment needs
   *  its control plane, so it waits for the database and health says so. */
  constructor(readonly required: boolean) {}

  /** Authoring routes are on (also while the live events re-register). */
  get controlPlane(): boolean {
    return this.phase === "rehydrating" || this.phase === "up";
  }

  /** Has the boot finished either way? Until then an unregistered event id
   *  may still be one of the database's: answer `starting`, never 404. */
  get settled(): boolean {
    return this.phase === "up" || this.phase === "off";
  }

  /** @param isHosted is that id in the registry now (a row that failed at
   *  boot and was relaunched since no longer counts as failed). */
  health(events: number, isHosted: (id: string) => boolean = () => false): HealthAnswer {
    const failed = [...this.failed.keys()].filter((id) => !isHosted(id));
    const listed = failed.length > 0 ? { failed } : {};
    if (this.required && this.phase === "up" && failed.length > 0) return { status: 503, body: { ok: false, reason: "events", failed } };
    if (this.phase === "up" || !this.required) {
      return { status: 200, body: { ok: true, controlPlane: this.controlPlane, events, ...listed } };
    }
    const reason = this.phase === "waiting" || this.phase === "off" ? "database" : "starting";
    return { status: 503, body: { ok: false, reason } };
  }

  /** `/e/<id>/…` for an id the registry doesn't host. */
  missEvent(id: string): MissAnswer {
    if (this.failed.has(id)) return { status: 503, body: { error: "event failed to load" }, retryAfter: 5 };
    if (!this.settled) return { status: 503, body: { error: "starting" }, retryAfter: 1 };
    return { status: 404, body: { error: "unknown event" } };
  }

  /** `/api/resolve-code` for a code no hosted event has. */
  missCode(code: string): MissAnswer {
    const trimmed = code.trim();
    for (const row of this.failed.values()) {
      if (trimmed !== "" && row.codes.some((c) => c !== "" && passOk(trimmed, c))) {
        return { status: 503, body: { error: "event failed to load" }, retryAfter: 5 };
      }
    }
    if (!this.settled) return { status: 503, body: { error: "starting" }, retryAfter: 1 };
    return { status: 404, body: { error: "no event with that code" } };
  }
}

/** What `startControlPlane` drives — the real DB calls in `server.ts`, fakes in tests. */
export interface BootDeps<Row> {
  /** One `select 1`: is the database accepting connections? */
  dbReady(): Promise<boolean>;
  /** Migrate the auth + domain schema (throws if the database drops). */
  setup(): Promise<void>;
  /** Every non-ended `event` row. */
  liveEvents(): Promise<Row[]>;
  /** Host one row in the registry (replays its journal). */
  host(row: Row): void;
  /** The row's id + codes, remembered when `host` throws. */
  keyOf(row: Row): RowKey;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  /** The database, for the log lines (`DATABASE_URL`). */
  where?: string;
}

/**
 * Bring the control plane up: probe the database (retrying with
 * `dbRetryDelay` while `boot.required`), migrate, then re-register every
 * live event. Never rejects: a failure leaves the phase at `off` (LAN) or
 * keeps retrying (`required`), logged either way. One row that won't host
 * is logged, remembered in `boot.failed` and skipped so it can't keep the
 * rest of the night down.
 */
export async function startControlPlane<Row>(boot: ControlPlaneBoot, deps: BootDeps<Row>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    let reached = false;
    try {
      reached = await deps.dbReady();
      if (reached) {
        await deps.setup();
        boot.phase = "rehydrating";
        boot.failed.clear();
        let hosted = 0;
        for (const row of await deps.liveEvents()) {
          try {
            deps.host(row);
            hosted++;
          } catch (err) {
            const key = deps.keyOf(row);
            boot.failed.set(key.id, key);
            deps.log(`  ⚠️  could not rehydrate event ${key.id}: ${String(err)} — it answers 503 until it is fixed and loom restarts`);
          }
        }
        boot.rehydrated = hosted;
        boot.phase = "up";
        if (attempt > 0) deps.log(`  ✅ database reachable after ${attempt} retr${attempt === 1 ? "y" : "ies"} — control plane up`);
        return;
      }
    } catch (err) {
      deps.log(`  ⚠️  control plane setup failed: ${String(err)}`);
    }
    if (!boot.required) {
      boot.phase = "off";
      if (!reached) deps.log(`  ⚠️  control plane disabled — database unreachable${deps.where !== undefined ? ` at ${deps.where}` : ""}`);
      return;
    }
    boot.phase = reached ? "starting" : "waiting";
    const wait = dbRetryDelay(attempt);
    // Every miss for the first few, then about once a minute.
    if (attempt < 5 || attempt % 4 === 0) {
      deps.log(`  ⏳ database not ready — retrying in ${Math.round(wait / 1000)} s (attempt ${attempt + 1}); unknown events answer 503 starting`);
    }
    await deps.sleep(wait);
  }
}
