//! Durable state for the event server, so a process restart (laptop
//! sleep, crash, Ctrl-C, deploy) is transparent to everyone in the room.
//!
//! Strategy: **event sourcing**. The `Sim` is fully deterministic — no
//! clocks, no randomness — so we never serialize its tangled internal
//! state (choice continuations hold AST frames that don't round-trip).
//! Instead we journal every *mutation call* (`createPerson`, `join`,
//! `choose`, `tick`, …) as it happens, and on boot rebuild the live sim by
//! replaying the journal against a fresh `Sim.fromSources(scenarioSource)`.
//! Replay is exact because the inputs are exact.
//!
//! Alongside the journal we persist:
//!   - `codes.json`    the three passcodes (stable across restarts)
//!   - `meta.json`     scenario name + source + phase
//!   - `sessions.json` live mod / performer tokens (no re-login needed)
//!
//! Everything is small and written synchronously: durability before the
//! HTTP response matters far more than throughput on a one-room LAN.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Passcodes } from "./auth.ts";
import type { Session } from "./session.ts";
import type { RuntimePhase } from "./views.ts";

/** The sim mutations we journal — exactly the `Sim` methods the server calls. */
export type Mutation =
  | "createPerson"
  | "join"
  | "defect"
  | "arrive"
  | "scan"
  | "signal"
  | "escape"
  | "capture"
  | "setScore"
  | "setVar"
  | "fireBeat"
  | "reveal"
  | "choose"
  | "say"
  | "inviteToChannel"
  | "leaveChannel"
  | "unlock"
  | "redeem"
  | "share"
  | "quest"
  | "tick";

/** One replayable line of the journal: a method name + its arguments, and
 *  — for moderator mutations — who did it (`by`, a display name; replay
 *  ignores it, the Log / audit reads it). */
export interface JournalEntry {
  m: Mutation;
  a: unknown[];
  by?: string;
}

export interface Meta {
  version: 1;
  scenarioName: string;
  scenarioSource: string;
  phase: RuntimePhase;
  /** persona id → the director who spawned it (mod-spawned personas only). */
  owners?: Array<[string, string]>;
}

/** A persisted session: a token paired with the capabilities it carries. */
export type SessionEntry = [string, Session];

const CODES = "codes.json";
const META = "meta.json";
const JOURNAL = "journal.ndjson";
const SESSIONS = "sessions.json";
const HIDDEN = "hidden.json";
const GUESTS = "guests.json";
const AVATARS = "avatars.json";
/** Not `house.json`: `LOOM_HOUSE` may well point at `/data/house.json`, and
 *  the default event's state dir can be that same `/data`. */
const HOUSE = "spatial-house.json";
/** The project's map files as this event snapshotted them + the active
 *  variant (SW-MAP-01 / SW-MAP-13, `house-maps.ts`). */
const MAPS = "spatial-maps.json";
/** Web Push subscriptions by device (K-31a, `push.ts`). */
const PUSH = "push.json";

/** Read + JSON-parse a file, returning `null` on any miss/corruption. */
function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export class Store {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(name: string): string {
    return join(this.dir, name);
  }

  // --- passcodes ----------------------------------------------------------

  loadCodes(): Partial<Passcodes> | null {
    return readJson<Partial<Passcodes>>(this.path(CODES));
  }
  saveCodes(codes: Passcodes): void {
    writeFileSync(this.path(CODES), JSON.stringify(codes, null, 2));
  }

  // --- scenario meta ------------------------------------------------------

  loadMeta(): Meta | null {
    const m = readJson<Meta>(this.path(META));
    return m && m.version === 1 ? m : null;
  }
  saveMeta(meta: Meta): void {
    writeFileSync(this.path(META), JSON.stringify(meta, null, 2));
  }

  // --- command journal ----------------------------------------------------

  /** Append one mutation. Synchronous so it lands before we respond.
   *  `by` attributes a moderator mutation to a director (display name). */
  appendCommand(m: Mutation, a: unknown[], by?: string): void {
    appendFileSync(this.path(JOURNAL), JSON.stringify(by !== undefined ? { m, a, by } : { m, a }) + "\n");
  }

  /** Every journaled mutation in order. Skips any unparseable line. */
  readJournal(): JournalEntry[] {
    let raw: string;
    try {
      raw = readFileSync(this.path(JOURNAL), "utf8");
    } catch {
      return [];
    }
    const out: JournalEntry[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      try {
        out.push(JSON.parse(line) as JournalEntry);
      } catch {
        /* tolerate a torn final write */
      }
    }
    return out;
  }

  /** Start a fresh story timeline (new scenario, or a reset). */
  clearJournal(): void {
    rmSync(this.path(JOURNAL), { force: true });
  }

  // --- live sessions ------------------------------------------------------

  loadSessions(): SessionEntry[] {
    // Tolerate a stale/incompatible file (e.g. a pre-capability
    // `{mod, prime}` blob): anything that isn't the entry array is dropped,
    // so a format change degrades to "everyone re-logs in" rather than a
    // boot crash.
    const v = readJson<unknown>(this.path(SESSIONS));
    return Array.isArray(v) ? (v as SessionEntry[]) : [];
  }
  saveSessions(entries: SessionEntry[]): void {
    writeFileSync(this.path(SESSIONS), JSON.stringify(entries));
  }

  // --- guest capability tokens --------------------------------------------
  //
  // A guest's public id (`g-xxxxxx`) is broadcast in rosters, so it can't be
  // the credential. Registration mints an opaque token per guest; the map is
  // persisted here (never journaled) so a restart doesn't sign everyone out.

  loadGuests(): Array<[string, string]> {
    const v = readJson<unknown>(this.path(GUESTS));
    return Array.isArray(v) ? (v as Array<[string, string]>) : [];
  }
  saveGuests(entries: Array<[string, string]>): void {
    writeFileSync(this.path(GUESTS), JSON.stringify(entries));
  }

  // --- profile pictures ---------------------------------------------------
  //
  // Who has which picture (`[subject, url, "chosen"?]` — a hand-picked
  // `avatar:`, a Wikipedia picture the server found, a guest's own pick). Not
  // journaled: a picture is presentation, not story state.

  loadAvatars(): unknown[] {
    const v = readJson<unknown>(this.path(AVATARS));
    return Array.isArray(v) ? v : [];
  }
  saveAvatars(entries: unknown[]): void {
    writeFileSync(this.path(AVATARS), JSON.stringify(entries));
  }

  // --- the house map (reinstallation games) -------------------------------
  //
  // A director's edit of the house map for this event (`docs/loom-reinstall.md`
  // §1.3), kept as `spatial-house.json` in the event's state dir. Absent →
  // the project's map snapshot (its active variant, below), else the show's
  // own map file (`LOOM_HOUSE`, else the example's `house.json`).
  // The raw JSON comes back unvalidated; the runtime validates it.

  loadHouse(): unknown {
    return readJson<unknown>(this.path(HOUSE));
  }
  saveHouse(house: unknown): void {
    writeFileSync(this.path(HOUSE), JSON.stringify(house, null, 2));
  }
  /** Drop the director's save (a variant switch replaces it, a save to the
   *  project makes it redundant). True when there was one. */
  clearHouse(): boolean {
    const had = existsSync(this.path(HOUSE));
    rmSync(this.path(HOUSE), { force: true });
    return had;
  }
  hasHouse(): boolean {
    return existsSync(this.path(HOUSE));
  }

  // The project's map files this event snapshotted at launch (or reload, or
  // a save to the project), and which variant is active. Kept here as well
  // as on the event row so a restart keeps both — and so the LAN default
  // event, which has no row, remembers its variant. `files: null` = no
  // project snapshot.

  loadMaps(): { files: unknown; active: string | null } | null {
    const v = readJson<{ version?: unknown; files?: unknown; active?: unknown }>(this.path(MAPS));
    if (v === null || v.version !== 1) return null;
    return { files: v.files ?? null, active: typeof v.active === "string" ? v.active : null };
  }
  saveMaps(files: Record<string, string> | null, active: string | null): void {
    writeFileSync(this.path(MAPS), JSON.stringify({ version: 1, files, active }));
  }

  // --- push subscriptions (K-31a) -----------------------------------------
  //
  // One device per entry (`push.ts` validates on load). Not journaled: a
  // phone is not a story fact.

  loadPush(): unknown {
    return readJson<unknown>(this.path(PUSH));
  }
  savePush(data: unknown): void {
    writeFileSync(this.path(PUSH), JSON.stringify(data));
  }

  // --- moderation (hidden message seqs) -----------------------------------
  //
  // Chat history itself is *not* persisted: it's re-derived deterministically
  // by replaying the journal through the message composer. Moderation is the
  // one exception — hiding a message isn't a sim event — so the set of hidden
  // `seq`s is kept here and re-applied after the rebuild.

  loadHidden(): number[] {
    return readJson<number[]>(this.path(HIDDEN)) ?? [];
  }
  saveHidden(seqs: number[]): void {
    writeFileSync(this.path(HIDDEN), JSON.stringify(seqs));
  }
  clearHidden(): void {
    rmSync(this.path(HIDDEN), { force: true });
  }

  /** Has any prior run left state here to restore? */
  hasState(): boolean {
    return existsSync(this.path(META));
  }
}
