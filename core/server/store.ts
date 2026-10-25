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
//!   - `claim-secret.json` the reserved programs' claim secret (stable
//!                     across restarts and story restarts; never cleared)
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
  | "release"
  | "capture"
  | "restrict"
  | "unrestrict"
  | "setScore"
  | "setVar"
  | "fireBeat"
  | "reveal"
  | "broadcast"
  | "choose"
  | "say"
  | "inviteToChannel"
  | "leaveChannel"
  | "unlock"
  | "redeem"
  | "share"
  | "quest"
  | "wallet"
  | "crew" // w18 crews: one `CrewOp` (crews.ts) — found / invite / recruit / answer / leave / rename / dissolve
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
  /** This run's doors have opened (its `entry:` beat, if any, has played).
   *  A paused run of a story with no `start:` and no tick yet has nothing
   *  in its journal to say so. Absent in an older meta. */
  opened?: boolean;
  /** persona id → the director who spawned it (mod-spawned personas only). */
  owners?: Array<[string, string]>;
}

/** A persisted session: a token paired with the capabilities it carries. */
export type SessionEntry = [string, Session];

const CODES = "codes.json";
const META = "meta.json";
/** The secret the reserved programs' claim tokens are keyed by (W-03,
 *  `identity.ts` `claimToken`). */
const CLAIM_SECRET = "claim-secret.json";
const JOURNAL = "journal.ndjson";
const SESSIONS = "sessions.json";
const HIDDEN = "hidden.json";
const GUESTS = "guests.json";
const BADGES = "badges.json";
const AVATARS = "avatars.json";
/** Not `house.json`: `LOOM_HOUSE` may well point at `/data/house.json`, and
 *  the default event's state dir can be that same `/data`. */
const HOUSE = "spatial-house.json";
/** The project's map files as this event snapshotted them + the active
 *  variant (SW-MAP-01 / SW-MAP-13, `house-maps.ts`). */
const MAPS = "spatial-maps.json";
/** The project's `facts.json` as this event snapshotted it (Wave 4 lane B,
 *  `facts.ts`). Not `facts.json`: `LOOM_FACTS` defaults to a sibling of
 *  `LOOM_HOUSE`, and the default event's state dir can be that same dir. */
const FACTS = "project-facts.json";
/** The project's `audio.json` as this event snapshotted it (wave 17,
 *  `audio.ts`). Not `audio.json`: `LOOM_AUDIO` may sit in the same dir. */
const AUDIO = "project-audio.json";
/** A director's speaker save (the map editor), which wins over the project's. */
const AUDIO_SAVE = "audio-save.json";
/** Wave 18b (Q8): the house list of tablets a director ticked on Run's
 *  House sound card, laid over the config in force (never a whole save). */
const AUDIO_ANNOUNCE = "audio-announce.json";
/** The project's `lights.json` as this event snapshotted it (wave 20,
 *  `lights.ts`). Not `lights.json`: `LOOM_LIGHTS` may sit in the same dir. */
const LIGHTS = "project-lights.json";
/** A director's lights save (the map editor), which wins over the project's. */
const LIGHTS_SAVE = "lights-save.json";
/** The project's `desk.json` as this event snapshotted it (wave 25,
 *  `desk.ts`). Not `desk.json`: `LOOM_DESK` may sit in the same dir. */
const DESK = "project-desk.json";
/** A director's desk save (Run → House), which wins over the project's. */
const DESK_SAVE = "desk-save.json";
/** The house checks' marks (wave 25, `desk.ts`): setup happens days before
 *  the show, so they survive a restart; never story state, never the journal. */
const DESK_MARKS = "desk-marks.json";
/** Web Push subscriptions by device (K-31a, `push.ts`). */
const PUSH = "push.json";
/** Every duck found this story (SW-RE-14, the ceremony's speedrun). */
const RUNS = "spatial-runs.jsonl";
/** The director's TV-voice mute (K-18, OP-20's ALL STOP) — not story state,
 *  so no restart or replay touches it; a crash must not unmute the TV. */
const SCREEN_VOICE = "screen-voice.json";
/** Since when each agent thread's guest has been waiting (hub ms, the wall
 *  clock) and when the event was paused — so a restart keeps a host's
 *  "waiting 0:34" exact (recheck item 4). Tied to the journal's chat seqs:
 *  `clearJournal` drops it. */
const AGENT_WAITS = "agent-waits.json";

/** One open agent request's wait, by thread (`threadKey`) and the seq of
 *  the line that opened it. */
export interface AgentWait {
  key: string;
  seq: number;
  since: number;
}
export interface AgentWaits {
  pausedAt: number | null;
  waits: AgentWait[];
}

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

  // --- the reserved programs' claim secret ---------------------------------

  loadClaimSecret(): string | null {
    const raw = readJson<{ secret?: unknown }>(this.path(CLAIM_SECRET));
    return typeof raw?.secret === "string" && raw.secret !== "" ? raw.secret : null;
  }
  saveClaimSecret(secret: string): void {
    writeFileSync(this.path(CLAIM_SECRET), JSON.stringify({ secret }, null, 2));
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
    rmSync(this.path(AGENT_WAITS), { force: true });
  }

  /** The agent waits (`AGENT_WAITS`), or null on a miss; a malformed row is dropped. */
  loadAgentWaits(): AgentWaits | null {
    const raw = readJson<{ pausedAt?: unknown; waits?: unknown }>(this.path(AGENT_WAITS));
    if (raw === null || typeof raw !== "object") return null;
    const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    const waits: AgentWait[] = [];
    if (Array.isArray(raw.waits)) {
      for (const w of raw.waits as unknown[]) {
        if (w === null || typeof w !== "object") continue;
        const { key, seq, since } = w as Record<string, unknown>;
        if (typeof key === "string" && num(seq) && num(since)) waits.push({ key, seq, since });
      }
    }
    return { pausedAt: num(raw.pausedAt) ? raw.pausedAt : null, waits };
  }
  saveAgentWaits(waits: AgentWaits): void {
    writeFileSync(this.path(AGENT_WAITS), JSON.stringify(waits));
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

  // --- badge links (wave 23, routes/rejoin.ts) -----------------------------
  //
  // Which printed badge number each guest linked (`[n, personId]`). Not
  // journaled (a badge is not a story fact); cut with the guest tokens on
  // every story restart.

  loadBadges(): unknown {
    return readJson<unknown>(this.path(BADGES)) ?? [];
  }
  saveBadges(entries: Array<[number, string]>): void {
    writeFileSync(this.path(BADGES), JSON.stringify(entries));
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

  // The project's `facts.json` this event snapshotted at launch (or a
  // reload, or `/api/mod/load {facts}`) — the facts judge's key. Kept here
  // as well as on the event row so a restart keeps it, and so the LAN
  // default event, which has no row, has one. `null` = the project has none
  // (the show file next to `LOOM_HOUSE` is the fallback then).

  loadFacts(): string | null {
    const v = readJson<{ version?: unknown; text?: unknown }>(this.path(FACTS));
    if (v === null || v.version !== 1) return null;
    return typeof v.text === "string" ? v.text : null;
  }
  saveFacts(text: string | null): void {
    writeFileSync(this.path(FACTS), JSON.stringify({ version: 1, text }));
  }

  // The project's `audio.json` this event snapshotted (launch, reload,
  // `/api/mod/load {audio}`, Save to project) and a director's save, which
  // wins over it (`audio.ts`). Neither is story state: a restart keeps both.

  loadAudio(): string | null {
    const v = readJson<{ version?: unknown; text?: unknown }>(this.path(AUDIO));
    if (v === null || v.version !== 1) return null;
    return typeof v.text === "string" ? v.text : null;
  }
  saveAudio(text: string | null): void {
    writeFileSync(this.path(AUDIO), JSON.stringify({ version: 1, text }));
  }
  /** The director's save, unvalidated (the hub checks it). */
  loadAudioSave(): unknown {
    return readJson<unknown>(this.path(AUDIO_SAVE));
  }
  saveAudioSave(audio: unknown): void {
    writeFileSync(this.path(AUDIO_SAVE), JSON.stringify(audio, null, 2));
  }
  clearAudioSave(): void {
    rmSync(this.path(AUDIO_SAVE), { force: true });
  }
  /** The house tablets list a director set (`POST /api/mod/audio/announce`),
   *  or null when none was set this event. */
  loadAudioAnnounce(): string[] | null {
    const v = readJson<{ version?: unknown; terminals?: unknown }>(this.path(AUDIO_ANNOUNCE));
    if (v === null || v.version !== 1 || !Array.isArray(v.terminals)) return null;
    return v.terminals.filter((t): t is string => typeof t === "string" && t.trim() !== "");
  }
  saveAudioAnnounce(terminals: string[] | null): void {
    if (terminals === null) rmSync(this.path(AUDIO_ANNOUNCE), { force: true });
    else writeFileSync(this.path(AUDIO_ANNOUNCE), JSON.stringify({ version: 1, terminals }));
  }

  // The project's `lights.json` this event snapshotted (launch, reload,
  // `/api/mod/load {lights}`, Save to project) and a director's save, which
  // wins over it (`lights.ts`, wave 20). Neither is story state: a restart
  // keeps both.

  loadLights(): string | null {
    const v = readJson<{ version?: unknown; text?: unknown }>(this.path(LIGHTS));
    if (v === null || v.version !== 1) return null;
    return typeof v.text === "string" ? v.text : null;
  }
  saveLights(text: string | null): void {
    writeFileSync(this.path(LIGHTS), JSON.stringify({ version: 1, text }));
  }
  /** The director's save, unvalidated (the hub checks it). */
  loadLightsSave(): unknown {
    return readJson<unknown>(this.path(LIGHTS_SAVE));
  }
  saveLightsSave(lights: unknown): void {
    writeFileSync(this.path(LIGHTS_SAVE), JSON.stringify(lights, null, 2));
  }
  clearLightsSave(): void {
    rmSync(this.path(LIGHTS_SAVE), { force: true });
  }

  // The project's `desk.json` this event snapshotted (launch, reload,
  // `/api/mod/load {desk}`, Save to project), a director's save, which wins
  // over it, and the checks' marks (`desk.ts`, wave 25). None is story
  // state: a restart keeps all three, a story reset clears none.

  loadDesk(): string | null {
    const v = readJson<{ version?: unknown; text?: unknown }>(this.path(DESK));
    if (v === null || v.version !== 1) return null;
    return typeof v.text === "string" ? v.text : null;
  }
  saveDesk(text: string | null): void {
    writeFileSync(this.path(DESK), JSON.stringify({ version: 1, text }));
  }
  /** The director's save, unvalidated (the hub checks it). */
  loadDeskSave(): unknown {
    return readJson<unknown>(this.path(DESK_SAVE));
  }
  saveDeskSave(desk: unknown): void {
    writeFileSync(this.path(DESK_SAVE), JSON.stringify(desk, null, 2));
  }
  clearDeskSave(): void {
    rmSync(this.path(DESK_SAVE), { force: true });
  }
  /** The checks' marks by key, unvalidated (the hub checks each). */
  loadDeskMarks(): unknown {
    return readJson<unknown>(this.path(DESK_MARKS));
  }
  saveDeskMarks(marks: unknown): void {
    writeFileSync(this.path(DESK_MARKS), JSON.stringify(marks, null, 2));
  }

  // One line per duck found (`spatial.ts` `DuckRun`), cleared with the
  // journal: the runs belong to this story timeline. Raw lines come back
  // unvalidated (`parseDuckRun` checks them); a torn last line is skipped.

  appendRun(run: unknown): void {
    appendFileSync(this.path(RUNS), JSON.stringify(run) + "\n");
  }
  loadRuns(): unknown[] {
    let raw: string;
    try {
      raw = readFileSync(this.path(RUNS), "utf8");
    } catch {
      return [];
    }
    const out: unknown[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* tolerate a torn final write */
      }
    }
    return out;
  }
  clearRuns(): void {
    rmSync(this.path(RUNS), { force: true });
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

  loadVoiceMuted(): boolean {
    return readJson<{ muted?: unknown }>(this.path(SCREEN_VOICE))?.muted === true;
  }
  saveVoiceMuted(muted: boolean): void {
    writeFileSync(this.path(SCREEN_VOICE), JSON.stringify({ muted }));
  }

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
