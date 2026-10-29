//! The reinstallation games' server half — `docs/loom-reinstall.md` §2.
//!
//! A transport-free `SpatialHub` (the `AgentHub` pattern: an injected clock,
//! plain subscriber objects with `send(event, data)`), owned by
//! `EventRuntime`. It keeps the house map the games and terminals share, the
//! play **sessions** (one per program in the simulation, each with a secret
//! session token the game uses for its own high-rate calls), the **stations**
//! (VR headsets polling for an assignment), and every player's latest pose.
//!
//! Poses never touch the journal, the chat or `fanout`: they live here, in
//! memory, and stream to the terminals as `poses` frames (latest-only, only
//! the players that moved). The story outcomes — finding the duck, hitting
//! the King — are handed back to the runtime (`found(token, release)`,
//! `hit(token, commit)`), which commits them.
//!
//! **The King** (C2): one shared health bar per event, off the map's king
//! prop. Its current hit points live in the story world (the prop's
//! `health` path, read through `kingHp`) — or, with no path, here in
//! memory. Each session (one reinstallation visit) may hit him once; a
//! `king` frame goes out whenever his state changes (`syncKing`, which the
//! runtime calls after every committed mutation).
//!
//! **Presence** (wave 26, C8): beside the raw `locate` room the stream
//! draws, each session keeps a presence room (`presenceRoom`, with its
//! doorway hysteresis). The terminals' link to the Internet judges by it:
//! `voicePlayers()` for the voice relay, `spotHere()` for the screen
//! state's `spot.here`, `camSpotsFor()` / `linked()` for the camera feeds.
//!
//! **Game moments** (wave 26, C6): `moment(token, req, commit)` judges an
//! escape into the void, a visit to Trabolta's heart and a pickup on the
//! session's last pose, with the `@loom/house` rules, and hands the story
//! signal to the runtime to commit. The per-session escape cooldown, who
//! heard the heart and who took each pickup are memory only.
//!
//! **The house lights** (wave 39, C2): on every pose flush, a leave, a
//! reset and a map swap the hub runs `presenceStep` over its joined
//! sessions with the lights config in force (an injected getter: the hub
//! never imports `LightsHub`) and tells the runtime when the pulsed set
//! changed (`onPresence`). The `lights` frame (`GameLights`) is built
//! elsewhere (`lights-shown.ts`): the hub sends it after each `hello`
//! (`lightsHello`) and broadcasts it (`sendLights`).

import { randomBytes, randomUUID } from "node:crypto";

import {
  DUCK_MAX_RISE,
  ESCAPE_M,
  ESCAPE_SIGNAL,
  ESCAPE_SLACK,
  ESCAPE_COOLDOWN_MS,
  KING_HIT_SLACK,
  PICKUP_SLACK_M,
  floorOf,
  guardWarnings,
  heartReached,
  houseHash,
  kingProps,
  kingReach,
  kingStateOf,
  linkedSpots,
  locate,
  momentProp,
  pickDuckSpot,
  pickupReach,
  presenceRoom,
  presenceStep,
  propSignal,
  samePulsed,
  standable,
  voidDistance,
  withFallenKings,
  wrapYaw,
} from "@loom/house";
import type {
  Assignment,
  DuckSpot,
  GameLights,
  HouseMap,
  HouseSource,
  KingReach,
  KingState,
  LeaveReason,
  LightsConfig,
  PlayerPose,
  PresenceEntry,
  PresencePlayer,
  PlayerState,
  PoseUpdate,
  Prop,
  SpatialCandidate,
  SpatialFrames,
  SpatialPrefs,
  SpatialWorld,
  Spawn,
  StationInfo,
  Vec3,
} from "@loom/house";

import type { MomentLine } from "./chat.ts";
import type { VoiceRoutePlayer } from "./spatial-voice.ts";

/** A station counts as online when it polled within this long. */
export const STATION_ONLINE_MS = 5_000;
/** A session with no pose for this long leaves (`timeout`). */
export const POSE_TIMEOUT_MS = 60_000;
/** A parked assignment nobody claims is dropped after this long — a
 *  headset may sit on the desk a while before someone puts it on. */
export const PARK_TIMEOUT_MS = 5 * 60_000;
/** A found session lingers this long (terminals celebrate), then leaves. */
export const FOUND_LINGER_MS = 8_000;
/** (wave 40) A suspended walk (the headset doffed, the web tab hidden) is
 *  held — exempt from the pose timeout — for this long, so it can resume
 *  where it was. After it, the walk is given up (`timeout`): the duck frees,
 *  the device returns to its lobby / scanner. */
export const SUSPEND_GRACE_MS = 2 * 60_000;
/** `found` accepts a last pose within this plan distance of the duck… */
export const FOUND_PLAN_M = 2.0;
/** Every pose coordinate is clamped to ± this many metres. */
export const MAX_COORD = 1000;
/** How many finished session tokens are remembered (→ 410, not 401). */
const ENDED_MEMORY = 1000;

/** One stream subscriber (a terminal, the map page, a game watching ghosts). */
export interface SpatialSubscriber {
  id: string;
  name: string;
  send(event: string, data: unknown): void;
}

export interface SpatialHubOptions {
  eventId: string;
  now?: () => number;
  /** Session token minting (default `randomUUID`). */
  newToken?: () => string;
  /** Public session id minting (default `s-` + 6 hex). */
  newSessionId?: () => string;
  /** A duck was found — the runtime keeps the run on disk (the ceremony's
   *  Golden Duck Speedrun, SW-RE-14). */
  onRun?: (run: DuckRun) => void;
  /** A game saved a program's settings — the runtime keeps them on disk. */
  onPrefs?: (all: Record<string, SpatialPrefs>) => void;
  /** Reads a world path (the King's `health`): his current hit points. A
   *  missing or non-number value reads as full. Absent (or a king with no
   *  `health` path): the hub keeps his hit points in memory. */
  kingHp?: (path: string) => unknown;
  /** A program's profile picture: its avatar key (`/api/avatar/<key>`), or
   *  null. Read live, so a changed picture never goes stale. */
  avatarOf?: (guest: string, name: string) => string | null;
  /** (wave 18b, R16) May this program play now — still marked for
   *  reinstallation (the runtime's `eligibleFor`)? Read when a station
   *  takes a parked assignment, when its first pose claims it, and every
   *  sweep of a claimed, unfound walk: false ends it (`unmarked`).
   *  Absent: everyone may (the begin route checked). */
  mayPlay?: (guest: string) => boolean;
  /** (wave 39) The house lights config in force: presence reads it on every
   *  pose flush. Absent: nothing ever pulses. */
  lights?: () => LightsConfig;
  /** (wave 39) The pulsed fixture set changed (`samePulsed` false): the
   *  runtime hands it to `LightsHub.setPresence`. */
  onPresence?: (entries: ReadonlyMap<string, PresenceEntry>) => void;
  /** (wave 39) The `lights` frame a new subscriber gets right after its
   *  `hello`; null sends none. */
  lightsHello?: () => GameLights | null;
  /** (wave 39) The map was swapped (the `lights` frame drops a fixture
   *  whose room it lost). */
  onHouse?: () => void;
}

/** One find of the duck: who, on what, and how long it took — from the
 *  moment the player was in the simulation (a web begin, or a headset's
 *  first pose) to the find, less any time the doors were closed (a
 *  director's pause freezes the run like it freezes the story's clocks). */
export interface DuckRun {
  guest: string;
  name: string;
  world: SpatialWorld;
  device: string;
  ms: number;
  /** When the duck was found (epoch ms on the hub's clock). */
  foundAt: number;
  /** Found after the night ended (wave 18, C7): a party favour, never on
   *  the recap's duck board or the speedrun award. */
  after?: true;
}

/** Parse a stored run (a `spatial-runs.jsonl` line); null when malformed. */
export function parseDuckRun(v: unknown): DuckRun | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);
  const n = (k: string) => (typeof r[k] === "number" && Number.isFinite(r[k]) && (r[k] as number) >= 0 ? (r[k] as number) : null);
  const guest = str("guest");
  const name = str("name");
  const device = str("device");
  const ms = n("ms");
  const foundAt = n("foundAt");
  if (guest === null || name === null || device === null || ms === null || foundAt === null || !isWorld(r["world"])) return null;
  return { guest, name, world: r["world"], device, ms, foundAt, ...(r["after"] === true ? { after: true as const } : {}) };
}

/** Where the map came from: a director's save for this event, the
 *  project's snapshot (its active variant), or the show's file. */
export type { HouseSource };

/** One program in the simulation. */
interface Session {
  /** Begun with `force: true` (exempt from `mayPlay`, wave 18b). */
  forced: boolean;
  id: string;
  token: string;
  guest: string;
  name: string;
  world: SpatialWorld;
  device: string;
  station: string | null;
  captured: boolean;
  duck: DuckSpot;
  spawn: Spawn;
  houseVersion: string;
  /** False while the assignment waits for its station's first pose. */
  claimed: boolean;
  /** Announced to the stream (`join`) — and so owed a `leave`. */
  joined: boolean;
  pose: PlayerPose;
  /** Where the player really is (`locate`): the stream's `room` / `floor`. */
  room: string | null;
  floor: string;
  /** (wave 26, C8) The room the player counts as being in for the
   *  terminals' link (`presenceRoom`, with its doorway hysteresis): voice,
   *  cameras and `spotHere` judge by it. Memory only, like the pose. */
  presence: string | null;
  /** (wave 26, C6) When this session's last escape was accepted (hub
   *  clock; null = never): the per-session cooldown. Memory only. */
  escapedAt: number | null;
  /** Moved since the last flush. */
  dirty: boolean;
  /** The last pose (or the begin, before any pose). */
  activeAt: number;
  startedAt: number;
  /** When the player entered the simulation (a web begin, or the claiming
   *  pose of a parked assignment) — a duck run's clock starts here, read
   *  on the open-doors clock (`runClock`). */
  playingAt: number;
  found: boolean;
  foundAt: number;
  released: boolean;
  /** Still captured once the find was committed (C4b): a find that
   *  released nobody while the story keeps the program (the banishment). */
  keptCaptured: boolean;
  /** This visit hit the King (one hit per visit, D2; `kingSpent`). */
  kingHit: boolean;
  /** The avatar key last told the stream (`refreshAvatar` sends a change). */
  avatar: string | null;
  /** The game said its intro (video + tutorial) is over (`ready`): the
   *  duck run's clock restarted then, once. */
  ready: boolean;
  /** (wave 40) Suspended: the headset was doffed or the web tab hidden. A
   *  held session is exempt from the pose timeout (it keeps its pose, duck
   *  and intro phase) until `SUSPEND_GRACE_MS` after `heldAt`, so the same
   *  program can resume where it was. A pose or `resume` clears it. */
  held: boolean;
  heldAt: number;
}

interface Station {
  id: string;
  name: string;
  world: SpatialWorld;
  seenAt: number;
}

/** What `begin` needs to know about the program (the runtime reads the sim). */
export interface BeginInput {
  guest: string;
  name: string;
  world: SpatialWorld;
  device: string;
  station: string | null;
  captured: boolean;
  /** (wave 18b) A director's `force: true` begin: the marked-only gate
   *  (`mayPlay`) never ends it (K-30's unmarked test walk). */
  forced?: boolean;
}

export type PoseOutcome = "ok" | "unknown" | "over";

/** (wave 40) What `resume` answers: the dead token's state, or the walk to
 *  pick up — its assignment, the pose to respawn at, and whether its intro
 *  was already done (so the game resumes in-house, not back in the video). */
export type ResumeOutcome =
  | { kind: "unknown" | "over" }
  | { kind: "ok"; assignment: Assignment; pose: PlayerPose; ready: boolean };

export type FoundOutcome =
  | { kind: "unknown" }
  | { kind: "over" }
  /** A parked assignment nobody has played yet (no pose has claimed it). */
  | { kind: "parked" }
  | { kind: "far"; distance: number; dy: number }
  /** `captured`: still captured after the commit (C4b) — the story kept them. */
  | { kind: "found"; released: boolean; already: boolean; captured: boolean };

/** The session a token names, as the runtime needs it to commit an outcome. */
export interface SessionRef {
  id: string;
  guest: string;
  device: string;
  captured: boolean;
}

/** The King a map carries, as the runtime needs it to commit a hit or a
 *  director's edit: the prop and its `health` world path (null = the hub
 *  holds his hit points). */
export interface KingRef {
  prop: Prop;
  path: string | null;
}

export type HitOutcome =
  | { kind: "unknown" }
  | { kind: "over" }
  /** A parked assignment nobody has played yet (no pose has claimed it). */
  | { kind: "parked" }
  /** The map has no king. */
  | { kind: "none" }
  | { kind: "fallen"; king: KingState }
  /** This visit already hit him. */
  | { kind: "already"; king: KingState }
  /** The last pose doesn't reach him (`kingReach` with `KING_HIT_SLACK`). */
  | { kind: "far"; reach: Exclude<KingReach, "ok"> }
  | { kind: "hit"; king: KingState };

/** (wave 26, C6) A line one moment's commit said to its program (display
 *  text, never pronounced), from `chat.ts` `momentLines`. */
export type { MomentLine };

/** (wave 26, C6) What a game moment is: the void, Trabolta's heart, a pickup. */
export type MomentKind = "escape" | "heart" | "pickup";

/** (wave 26, C6) A `POST /api/spatial/moment` body (the token rides beside it). */
export type MomentRequest = { kind: "escape" } | { kind: "heart"; prop: string } | { kind: "pickup"; prop: string };

/** (wave 26, C6) How a moment was judged. `ok.spawn` (escape: where the
 *  player was re-seated), `ok.prop` (heart / pickup: the prop). */
export type MomentOutcome =
  | { kind: "unknown" }
  | { kind: "over" }
  | { kind: "parked" }
  | { kind: "bad" }
  | { kind: "noProp" }
  | { kind: "notOut"; distance: number }
  | { kind: "cooldown"; retryMs: number }
  | { kind: "sealed" }
  | { kind: "notThere" }
  | { kind: "far"; distance: number }
  | { kind: "already" }
  | { kind: "ok"; spawn?: Spawn; prop?: Prop; lines: MomentLine[] };

/** The longest prop id a moment may name. */
const MOMENT_PROP_MAX = 80;

/**
 * (wave 26, C6) Parse a moment body: `kind` one of escape / heart / pickup;
 * heart and pickup name their prop (`prop`, a non-empty string). Null when
 * malformed (the route's 400 `bad moment`). Other fields (the `token`) are
 * ignored.
 */
export function parseMomentRequest(body: Record<string, unknown>): MomentRequest | null {
  const kind = body["kind"];
  if (kind === "escape") return { kind };
  if (kind !== "heart" && kind !== "pickup") return null;
  const prop = typeof body["prop"] === "string" ? body["prop"].trim() : "";
  if (prop === "" || prop.length > MOMENT_PROP_MAX) return null;
  return { kind, prop };
}

/** Is this a game world name? */
export function isWorld(v: unknown): v is SpatialWorld {
  return v === "vr" || v === "web";
}

/**
 * Parse a `POST /api/spatial/pose` body: `p` three finite numbers (each
 * clamped to ±1000 m), `yaw` finite (wrapped into [-180, 180)), `pitch`
 * optional finite (clamped to ±90). Null when malformed.
 */
export function parsePose(body: Record<string, unknown>): PlayerPose | null {
  const p = body["p"];
  if (!Array.isArray(p) || p.length !== 3) return null;
  const xyz: number[] = [];
  for (const c of p) {
    if (typeof c !== "number" || !Number.isFinite(c)) return null;
    xyz.push(Math.max(-MAX_COORD, Math.min(MAX_COORD, c)));
  }
  const yaw = body["yaw"];
  if (typeof yaw !== "number" || !Number.isFinite(yaw)) return null;
  const rawPitch = body["pitch"];
  if (rawPitch !== undefined && (typeof rawPitch !== "number" || !Number.isFinite(rawPitch))) return null;
  const pitch = typeof rawPitch === "number" ? Math.max(-90, Math.min(90, rawPitch)) : 0;
  return { p: [xyz[0]!, xyz[1]!, xyz[2]!], yaw: wrapYaw(yaw), pitch: pitch + 0 };
}

/**
 * Is a pose near enough the duck to find it? Within `FOUND_PLAN_M` in plan,
 * and either within `DUCK_MAX_RISE` in height (`@loom/house` — the highest a
 * spot may sit above its floor; a pose is the player's feet) or — given the
 * map — on the same floor (`floorOf`), the games' own reach rule, so a spot
 * raised above that (a shelf) can never deadlock a player the game says
 * reached it.
 */
export function nearDuck(p: Vec3, duck: Vec3, house?: HouseMap | null): { near: boolean; distance: number; dy: number } {
  const distance = Math.hypot(p[0] - duck[0], p[2] - duck[2]);
  const dy = Math.abs(p[1] - duck[1]);
  const level = dy <= DUCK_MAX_RISE || (house != null && floorOf(house, p[1]) === floorOf(house, duck[1]));
  return { near: distance <= FOUND_PLAN_M && level, distance, dy };
}

/** A King's state as a comparable key (null = no King). */
function kingKey(king: KingState | null): string | null {
  return king === null ? null : `${king.id}:${king.hp}/${king.max}`;
}

/** Same spot, same room, same place? */
function sameSpot(a: DuckSpot, b: DuckSpot): boolean {
  return a.id === b.id && a.room === b.room && a.pos[0] === b.pos[0] && a.pos[1] === b.pos[1] && a.pos[2] === b.pos[2];
}

/** `GET /api/mod/spatial/candidates` order: captured first, then the marked
 *  (restricted, not yet captured), then by name (then id). */
export function sortCandidates<T extends SpatialCandidate & { marked?: boolean }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.captured !== b.captured) return a.captured ? -1 : 1;
    // The marked next — restricted, or (C7) eligible by the story's `reinstall:`.
    const am = a.restricted || a.marked === true;
    const bm = b.restricted || b.marked === true;
    if (am !== bm) return am ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Rooms whose `location` names no LOCATION in the story (the validator has
 *  no model), plus `@loom/house`'s own soft warnings (a door's guard standing
 *  more than `GUARD_REACH` from the door it guards). */
export function houseWarnings(house: HouseMap, isLocation: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const room of house.rooms) {
    if (room.location !== undefined && !isLocation(room.location)) {
      out.push(`room "${room.id}": location "${room.location}" is not a LOCATION in the story`);
    }
  }
  out.push(...guardWarnings(house));
  return out;
}

/** `POST /api/spatial/prefs` body → the settings it names (unknown keys
 *  dropped); null when it names none or a value is out of range. */
export function parsePrefs(body: unknown): SpatialPrefs | null {
  if (body === null || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const out: SpatialPrefs = {};
  if (b.turn !== undefined) {
    if (b.turn !== "snap" && b.turn !== "smooth") return null;
    out.turn = b.turn;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** A settings file's contents → guest → settings (bad rows dropped). */
export function parsePrefsBook(raw: unknown): Record<string, SpatialPrefs> {
  const out: Record<string, SpatialPrefs> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [guest, v] of Object.entries(raw as Record<string, unknown>)) {
    const p = parsePrefs(v);
    if (p !== null) out[guest] = p;
  }
  return out;
}

/** The map version: FNV-1a 32 of its JSON (8 hex digits). */
export function houseVersion(house: HouseMap): string {
  return houseHash(house);
}

export class SpatialHub {
  private readonly o: SpatialHubOptions;
  private readonly subscribers = new Map<string, SpatialSubscriber>();
  private readonly sessions = new Map<string, Session>(); // session id →
  private readonly byToken = new Map<string, string>(); // token → session id
  /** Finished tokens → why (a late pose gets 410, not 401). */
  private readonly ended = new Map<string, LeaveReason>();
  private readonly stations = new Map<string, Station>();
  /** The spot each guest found last (the next duck avoids it). */
  private readonly lastFound = new Map<string, string>();
  /** Every find since the story (re)started (the ceremony's speedrun). */
  private readonly runLog: DuckRun[] = [];
  private map: { house: HouseMap; version: string; source: HouseSource } | null = null;
  /** Closed-doors time so far, and when the doors last closed (null = open). */
  private closedMs = 0;
  private closedSince: number | null = null;
  /** The King's hit points when his prop names no `health` path (king id →). */
  private readonly kingMemory = new Map<string, number>();
  /** The King's state as last told the stream (JSON), for `syncKing`. */
  private kingSent: string | null = null;
  /** Guests whose visit hit the King and has not found its duck yet. A
   *  visit is a walk to the duck: quitting (Leave, `end`), a director's end,
   *  a timeout or a re-scan never starts a fresh one, or one guest could
   *  take the whole shared bar with Leave + re-scan. A find ends the visit
   *  (the next scan may hit again); a story reset forgets them all. */
  private readonly kingSpent = new Set<string>();
  /** Whose hit is being committed: the `king` frame's `by`. */
  private hitBy: string | null = null;
  /** (wave 26, C6) Guests who heard the in-game heart tonight (a commit
   *  that said something). Memory only: a restart forgets it and the
   *  story's own guard (`program.sim_heart`) keeps him quiet. */
  private readonly heartHeard = new Set<string>();
  /** (wave 26, C6) Pickup prop id → the guests who took it tonight. Memory
   *  only; the story's own guard (`carries_virus`) keeps it once-only. */
  private readonly picked = new Map<string, Set<string>>();
  /** Each guest's game settings (`setPrefs`): kept on disk by the runtime
   *  (`onPrefs`) and never cleared by a story reset — they are the
   *  person's comfort, not the story's. */
  private readonly prefs = new Map<string, SpatialPrefs>();
  /** (wave 39) The fixtures a program is under now (`presenceStep`'s last
   *  answer, its hold included). Memory only. */
  private pulsed: Map<string, PresenceEntry> = new Map();

  constructor(o: SpatialHubOptions) {
    this.o = o;
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** The hub's clock with every closed-doors stretch taken out: duck runs
   *  are timed on it, so a pause mid-run doesn't count. */
  private runClock(): number {
    const now = this.now();
    return now - this.closedMs - (this.closedSince === null ? 0 : now - this.closedSince);
  }

  /** The runtime's doors opened or closed (open / pause / a fresh load).
   *  Poses still flow while closed; only the duck-run clock stops. */
  setOpen(open: boolean): void {
    if (open && this.closedSince !== null) {
      this.closedMs += this.now() - this.closedSince;
      this.closedSince = null;
    } else if (!open && this.closedSince === null) {
      this.closedSince = this.now();
    }
  }

  // -- the house ------------------------------------------------------------

  get house(): HouseMap | null {
    return this.map?.house ?? null;
  }
  get version(): string {
    return this.map?.version ?? "";
  }
  get source(): HouseSource {
    return this.map?.source ?? "show";
  }

  /**
   * Swap the map (a validated, normalized one). `announce` tells every
   * stream to refetch it — off for the initial load. Live sessions follow
   * the new map: a session that hasn't found its duck keeps its spot *id*
   * (so a moved room carries the duck along) and takes the spot's new
   * position; a spot the new map no longer has is re-dealt. Rooms + floors
   * are recomputed (the next flush carries them), a parked assignment moves
   * to the new spawn — and so does a player whose pose is not `standable`
   * on the new map (inside a solid prop, outside every room; a fallen King
   * is not solid, as `withFallenKings` has it); the games
   * re-seat their body by the same rule. After the `house` frame, every player whose duck
   * moved or was re-dealt gets a `duck {session, duck}` frame; a game also
   * learns its (possibly new) duck from `GET /api/spatial/house` with its
   * session token (a parked assignment, not on the stream yet, only there).
   */
  setHouse(house: HouseMap, source: HouseSource, announce = true): string {
    const version = houseVersion(house);
    this.map = { house, version, source };
    // Judge where a player may stand on the map as the games walk it: a
    // fallen King is no obstacle (the games drop him from the physics), so
    // a player crossing his doorway keeps their place (`withFallenKings`).
    const king = this.king();
    const walk = king?.fallen === true ? withFallenKings(house, new Set([king.id])) : house;
    const moved: Session[] = [];
    for (const s of this.sessions.values()) {
      if (!s.found) {
        const before = s.duck;
        const same = house.duck.spots.find((d) => d.id === s.duck.id);
        if (same !== undefined) s.duck = same;
        else {
          const last = this.lastFound.get(s.guest);
          s.duck = pickDuckSpot(house, s.id, last !== undefined ? [last] : []);
        }
        if (s.joined && !sameSpot(before, s.duck)) moved.push(s);
      }
      s.spawn = house.spawn;
      // A parked assignment starts at the new spawn; a player who stands
      // where the new map has no floor (in a room that is a solid prop
      // there — the shed on the tent map — or outside every room) is put
      // back at it, as the games put their body back (`standable`).
      if (!s.claimed || !standable(walk, s.pose.p)) s.pose = { p: [...house.spawn.pos], yaw: house.spawn.yaw, pitch: 0 };
      const at = locate(house, s.pose.p);
      s.room = at.room;
      s.floor = at.floor;
      // A map swap forgets the doorway hysteresis (C8): rooms may have moved.
      s.presence = presenceRoom(house, s.pose.p, null);
      s.houseVersion = version;
      if (s.joined) s.dirty = true;
    }
    // (wave 39) Fixtures follow their rooms: who is under which light now.
    this.stepPresence();
    if (announce) this.broadcast("house", { version });
    for (const s of moved) this.broadcast("duck", { session: s.id, duck: s.duck });
    if (announce) this.syncKing(null);
    else this.kingSent = kingKey(this.king());
    this.o.onHouse?.();
    return version;
  }

  // -- the King -------------------------------------------------------------

  /** The map's King (its first king prop) and where his hit points live;
   *  null when there is no map or no king. */
  kingRef(): KingRef | null {
    const prop = this.map === null ? undefined : kingProps(this.map.house)[0];
    if (prop === undefined) return null;
    const path = prop.health !== undefined && prop.health !== "" && this.o.kingHp !== undefined ? prop.health : null;
    return { prop, path };
  }

  /** The shared King now (null = none): his `health` world value, else the
   *  hub's own count — full when neither holds a number. */
  king(): KingState | null {
    const ref = this.kingRef();
    if (ref === null) return null;
    const raw = ref.path !== null ? this.o.kingHp!(ref.path) : this.kingMemory.get(ref.prop.id);
    return kingStateOf(ref.prop, raw);
  }

  /**
   * Tell the stream if the King changed since it last heard (a `king`
   * frame, `by` = the hitter's display name while a hit commits, else
   * `by` as given — null for a director's edit). The runtime calls this
   * after every committed mutation; nothing is sent when nothing changed.
   * Returns the state.
   */
  syncKing(by: string | null = null): KingState | null {
    const king = this.king();
    const key = kingKey(king);
    if (key === this.kingSent) return king;
    this.kingSent = key;
    if (king !== null) this.broadcast("king", { ...king, by: this.hitBy ?? by });
    return king;
  }

  /**
   * A game's player hits the King. The session must be claimed and must not
   * have hit him this visit, he must be standing, and its last pose must
   * reach him (`kingReach` with `KING_HIT_SLACK` — the pose pump is 10 Hz
   * latest-only, so the game flushes one right before). Then `commit` writes
   * his new hit points (`next`, one fewer) — when they live in the world —
   * and posts the story's signals; with no world path the hub counts them
   * itself. The `king` frame names the hitter.
   */
  hit(token: string | undefined, commit: (s: SessionRef, next: KingState, ref: KingRef) => void): HitOutcome {
    const s = this.byTokenLive(token);
    if (s === null) return { kind: this.tokenState(token) };
    if (!s.claimed) return { kind: "parked" };
    const ref = this.kingRef();
    const king = this.king();
    if (ref === null || king === null || this.map === null) return { kind: "none" };
    if (king.fallen) return { kind: "fallen", king };
    if (s.kingHit) return { kind: "already", king };
    const reach = kingReach(this.map.house, s.pose.p, s.pose.yaw, ref.prop, KING_HIT_SLACK);
    if (reach !== "ok") return { kind: "far", reach };
    s.kingHit = true;
    if (!s.found) this.kingSpent.add(s.guest);
    s.activeAt = this.now();
    const hp = king.hp - 1;
    const next: KingState = { id: king.id, hp, max: king.max, fallen: hp <= 0 };
    if (ref.path === null) this.kingMemory.set(ref.prop.id, hp);
    // Every `king` frame until this returns names the hitter: the commit's
    // own mutations sync it (the runtime's choke point), and a hub-held
    // King changes only here.
    this.hitBy = s.name;
    try {
      commit({ id: s.id, guest: s.guest, device: s.device, captured: s.captured }, next, ref);
      return { kind: "hit", king: this.syncKing() ?? next };
    } finally {
      this.hitBy = null;
    }
  }

  /** A director sets his hit points (clamped to 0..max): `commit` writes the
   *  world path, else the hub keeps them. Null when there is no King. */
  setKingHp(hp: number, commit: (ref: KingRef, hp: number) => void): KingState | null {
    const ref = this.kingRef();
    const king = this.king();
    if (ref === null || king === null) return null;
    const next = Math.max(0, Math.min(king.max, Math.round(hp)));
    if (ref.path === null) this.kingMemory.set(ref.prop.id, next);
    else commit(ref, next);
    return this.syncKing(null);
  }

  // -- the stream -----------------------------------------------------------

  /** Subscribe; the subscriber gets its `hello` at once. */
  attach(sub: SpatialSubscriber): void {
    this.subscribers.set(sub.id, sub);
    const hello: SpatialFrames["hello"] = { eventId: this.o.eventId, houseVersion: this.version, players: this.players(), king: this.king() };
    sub.send("hello", hello);
    // (wave 39) The real lights, right after the hello.
    const lights = this.o.lightsHello?.() ?? null;
    if (lights !== null) sub.send("lights", lights);
  }

  /** (wave 39) Broadcast a `lights` frame (`lights-shown.ts` decides when). */
  sendLights(frame: GameLights): void {
    this.broadcast("lights", frame);
  }

  detach(id: string): void {
    this.subscribers.delete(id);
  }

  detachAll(): void {
    this.subscribers.clear();
  }

  /** Is anything going on (a stream open, or a session alive)? The runtime
   *  runs its flush loop only while this holds. */
  get active(): boolean {
    // (wave 39) A pulse held after its program left still needs the flush
    // loop to let it go.
    return this.subscribers.size > 0 || this.sessions.size > 0 || this.pulsed.size > 0;
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  private broadcast<K extends keyof SpatialFrames>(event: K, data: SpatialFrames[K]): void {
    for (const s of this.subscribers.values()) s.send(event, data);
  }

  /** Every player in the simulation (claimed sessions), oldest first. */
  players(): PlayerState[] {
    return [...this.sessions.values()].filter((s) => s.joined).map((s) => this.stateOf(s));
  }

  /** A program's avatar key, read live (null without a reader). */
  private avatarFor(s: Session): string | null {
    return this.o.avatarOf?.(s.guest, s.name) ?? null;
  }

  /**
   * A program's picture changed (its own pick, a lookup that landed): every
   * live session of that guest whose avatar key moved gets an `avatar
   * {session, avatar}` frame. Returns how many frames went out.
   */
  refreshAvatar(guest: string): number {
    let sent = 0;
    for (const s of this.sessions.values()) {
      if (s.guest !== guest) continue;
      const avatar = this.avatarFor(s);
      if (avatar === s.avatar) continue;
      s.avatar = avatar;
      if (!s.joined) continue;
      this.broadcast("avatar", { session: s.id, avatar });
      sent++;
    }
    return sent;
  }

  private stateOf(s: Session): PlayerState {
    s.avatar = this.avatarFor(s);
    return {
      session: s.id,
      guest: s.guest,
      name: s.name,
      world: s.world,
      device: s.device,
      p: s.pose.p,
      yaw: s.pose.yaw,
      pitch: s.pose.pitch,
      room: s.room,
      floor: s.floor,
      duck: s.duck,
      found: s.found,
      startedAt: s.startedAt,
      avatar: s.avatar,
    };
  }

  // -- sessions -------------------------------------------------------------

  private mintSessionId(): string {
    for (;;) {
      const id = this.o.newSessionId?.() ?? `s-${randomBytes(3).toString("hex")}`;
      if (!this.sessions.has(id)) return id;
    }
  }

  /**
   * Start a program's simulation. Ends any live session of the same guest
   * (`replaced`) — the same visit (D2: a re-scan mid-walk), so a King hit
   * it spent stays spent, as it does after a quit until the duck is found
   * (`kingSpent`) — and, with a station, any older assignment still
   * parked there. Null when there is no house map.
   */
  begin(input: BeginInput): Assignment | null {
    const map = this.map;
    if (map === null) return null;
    // The visit's hit stays spent until its duck is found (`kingSpent`):
    // a re-scan mid-walk (D2), or after quitting, is the same visit.
    const kingHit = this.kingSpent.has(input.guest);
    for (const s of [...this.sessions.values()]) {
      if (s.guest === input.guest) {
        this.finish(s, "replaced");
      } else if (input.station !== null && s.station === input.station && (!s.claimed || s.held)) this.finish(s, "replaced");
      // (wave 40) A different program taking a station supersedes whatever
      // was there — a parked assignment, or a walk held for resume (one
      // headset, one walk). An active, un-held walk is left alone.
    }
    const id = this.mintSessionId();
    const token = this.o.newToken?.() ?? randomUUID();
    const last = this.lastFound.get(input.guest);
    const duck = pickDuckSpot(map.house, id, last !== undefined ? [last] : []);
    const spawn = map.house.spawn;
    const at = locate(map.house, spawn.pos);
    const now = this.now();
    const s: Session = {
      forced: input.forced === true,
      id,
      token,
      guest: input.guest,
      name: input.name,
      world: input.world,
      device: input.device,
      station: input.station,
      captured: input.captured,
      duck,
      spawn,
      houseVersion: map.version,
      claimed: input.station === null,
      joined: false,
      pose: { p: [...spawn.pos], yaw: spawn.yaw, pitch: 0 },
      room: at.room,
      floor: at.floor,
      presence: presenceRoom(map.house, spawn.pos, null),
      escapedAt: null,
      dirty: false,
      activeAt: now,
      startedAt: now,
      playingAt: this.runClock(),
      found: false,
      foundAt: 0,
      released: false,
      keptCaptured: false,
      kingHit,
      avatar: null,
      ready: false,
      held: false,
      heldAt: 0,
    };
    s.avatar = this.avatarFor(s);
    this.sessions.set(id, s);
    this.byToken.set(token, id);
    if (s.claimed) this.join(s);
    return this.assignmentOf(s);
  }

  private assignmentOf(s: Session): Assignment {
    return {
      session: s.id,
      token: s.token,
      guest: s.guest,
      name: s.name,
      world: s.world,
      device: s.device,
      station: s.station,
      captured: s.captured,
      duck: s.duck,
      spawn: s.spawn,
      houseVersion: s.houseVersion,
      avatar: this.avatarFor(s),
      kingHit: s.kingHit,
      // (wave 26, C6) What this program already did tonight in the game:
      // a re-scan never shows a taken disk again, nor replays the heart.
      picked: this.pickedBy(s.guest),
      heartHeard: this.heartHeard.has(s.guest),
      // The intro video and tutorial are skippable once a find is on the
      // run log; the settings a headset saved come back with every deal.
      reinstalled: this.reinstalledBy(s.guest),
      prefs: this.prefs.get(s.guest) ?? null,
    };
  }

  /** Ducks this guest found since the story (re)started (the run log, which
   *  survives a server restart). */
  reinstalledBy(guest: string): number {
    let n = 0;
    for (const r of this.runLog) if (r.guest === guest) n++;
    return n;
  }

  /** The game's intro (the video, the tutorial) is over: the duck run's
   *  clock starts again now, so a first-timer's run isn't timed through
   *  them. Once per session; refreshes the pose timeout. */
  ready(token: string | undefined): PoseOutcome {
    const s = this.byTokenLive(token);
    if (s === null) return this.tokenState(token);
    s.activeAt = this.now();
    if (!s.ready && !s.found) {
      s.ready = true;
      s.playingAt = this.runClock();
    }
    return "ok";
  }

  /** (wave 40) The headset was doffed, or the web tab hidden: hold the walk
   *  so the pose timeout does not end it, keeping its pose, duck and intro
   *  phase for a resume within `SUSPEND_GRACE_MS`. Only a claimed, un-found
   *  walk holds (a parked one keeps its own `PARK_TIMEOUT_MS`; a found one
   *  lingers and leaves). The stream is told nothing — the player stays put,
   *  paused, so the terminals do not flicker. A dead token hears unknown/over. */
  suspend(token: string | undefined): PoseOutcome {
    const s = this.byTokenLive(token);
    if (s === null) return this.tokenState(token);
    if (s.claimed && !s.found && !s.held) {
      s.held = true;
      s.heldAt = this.now();
    }
    return "ok";
  }

  /** (wave 40) Pick a held (or still-live) walk back up: clear the hold,
   *  refresh its timeout, and answer with the assignment, the pose to
   *  respawn at, and whether the intro was done. A dead token (the grace
   *  elapsed, or a different program took the station) hears unknown/over,
   *  and the game starts fresh. */
  resume(token: string | undefined): ResumeOutcome {
    const s = this.byTokenLive(token);
    if (s === null) return { kind: this.tokenState(token) };
    s.held = false;
    s.activeAt = this.now();
    return { kind: "ok", assignment: this.assignmentOf(s), pose: s.pose, ready: s.ready };
  }

  /** Save the program's game settings (merged over what it had); a dead
   *  token answers `unknown` / `over`. */
  setPrefs(token: string | undefined, prefs: SpatialPrefs): { kind: "ok"; prefs: SpatialPrefs } | { kind: "unknown" | "over" } {
    const s = this.byTokenLive(token);
    if (s === null) return { kind: this.tokenState(token) };
    s.activeAt = this.now();
    const next: SpatialPrefs = { ...(this.prefs.get(s.guest) ?? {}), ...prefs };
    this.prefs.set(s.guest, next);
    this.o.onPrefs?.(this.allPrefs());
    return { kind: "ok", prefs: next };
  }

  /** Every guest's saved settings (what the runtime keeps on disk). */
  allPrefs(): Record<string, SpatialPrefs> {
    return Object.fromEntries(this.prefs);
  }

  /** Adopt the settings kept on disk (a server restart). */
  restorePrefs(all: Record<string, SpatialPrefs>): void {
    this.prefs.clear();
    for (const [guest, p] of Object.entries(all)) this.prefs.set(guest, p);
  }

  private join(s: Session): void {
    s.joined = true;
    this.broadcast("join", { player: this.stateOf(s) });
  }

  /** R16 (wave 18b): is this session's program no longer allowed in? Never
   *  for a director's forced walk. */
  private unmarked(s: Session): boolean {
    return !s.forced && this.o.mayPlay?.(s.guest) === false;
  }

  /** End a session: forget it, remember its token, tell the stream. */
  private finish(s: Session, reason: LeaveReason): void {
    this.sessions.delete(s.id);
    this.byToken.delete(s.token);
    this.ended.set(s.token, reason);
    if (this.ended.size > ENDED_MEMORY) {
      const oldest = this.ended.keys().next().value;
      if (oldest !== undefined) this.ended.delete(oldest);
    }
    if (s.joined) {
      this.broadcast("leave", { session: s.id, reason });
      this.stepPresence();
    }
  }

  /** The live session behind a token (claimed or parked), for auth + commits. */
  sessionFor(token: string | undefined): SessionRef | null {
    const s = this.byTokenLive(token);
    return s === null ? null : { id: s.id, guest: s.guest, device: s.device, captured: s.captured };
  }

  /** Is this a token of a live session? */
  hasToken(token: string | undefined): boolean {
    return this.byTokenLive(token) !== null;
  }

  /** The voice link's view of a token's session: its public id, and whether
   *  it is in the simulation yet (a parked one is heard by nobody). */
  voiceSessionFor(token: string | undefined): { id: string; joined: boolean } | null {
    const s = this.byTokenLive(token);
    return s === null ? null : { id: s.id, joined: s.joined };
  }

  /** Is the session with this public id still live (claimed or parked)? */
  hasSession(id: string): boolean {
    return this.sessions.has(id);
  }

  private byTokenLive(token: string | undefined): Session | null {
    if (token === undefined || token === "") return null;
    const id = this.byToken.get(token);
    return id === undefined ? null : (this.sessions.get(id) ?? null);
  }

  /** Why a token is not a live session's: never was one, or its session ended. */
  tokenState(token: string | undefined): "unknown" | "over" {
    return token !== undefined && this.ended.has(token) ? "over" : "unknown";
  }

  /** A game's pose (latest only). The first one claims a parked assignment. */
  pose(token: string | undefined, pose: PlayerPose): PoseOutcome {
    const s = this.byTokenLive(token);
    if (s === null) return this.tokenState(token);
    const map = this.map;
    s.activeAt = this.now();
    s.held = false; // (wave 40) poses are flowing again — the walk is live
    const same = s.pose.p[0] === pose.p[0] && s.pose.p[1] === pose.p[1] && s.pose.p[2] === pose.p[2] && s.pose.yaw === pose.yaw && s.pose.pitch === pose.pitch;
    if (!same) {
      s.pose = { p: [...pose.p], yaw: pose.yaw, pitch: pose.pitch };
      if (map !== null) {
        const at = locate(map.house, pose.p);
        s.room = at.room;
        s.floor = at.floor;
        s.presence = presenceRoom(map.house, pose.p, s.presence);
      }
    }
    if (!s.claimed) {
      // A parked assignment whose program is no longer marked (released
      // between the send and the put-on) never plays (R16, G1).
      if (this.unmarked(s)) {
        this.finish(s, "unmarked");
        return "over";
      }
      this.claim(s); // the join frame carries this very pose
    } else if (!same) {
      s.dirty = true;
    }
    return "ok";
  }

  /**
   * A station took up its assignment: in the simulation now (`join`). Any
   * other session on that station is over (`replaced`) — a headset that
   * crashed mid-game and came back never ended its last one, and a ghost
   * must not linger beside the new player.
   */
  private claim(s: Session): void {
    s.claimed = true;
    s.playingAt = this.runClock();
    if (s.station !== null) {
      for (const o of [...this.sessions.values()]) {
        if (o !== s && o.station === s.station) this.finish(o, "replaced");
      }
    }
    this.join(s);
  }

  /** The duck a live session is looking for (its game reads it with the map). */
  duckFor(token: string | undefined): DuckSpot | null {
    return this.byTokenLive(token)?.duck ?? null;
  }

  // -- presence (wave 26, C8) -----------------------------------------------

  /** The players in the simulation as the voice relay routes them: joined
   *  sessions with `room` = their presence room (never the raw `locate`
   *  room the stream draws), oldest first. */
  voicePlayers(): VoiceRoutePlayer[] {
    const out: VoiceRoutePlayer[] = [];
    for (const s of this.sessions.values()) {
      if (s.joined) out.push({ session: s.id, name: s.name, p: s.pose.p, floor: s.floor, room: s.presence });
    }
    return out;
  }

  /** The presence rooms of every player in the simulation (joined sessions). */
  private presenceRooms(): Array<string | null> {
    const out: Array<string | null> = [];
    for (const s of this.sessions.values()) if (s.joined) out.push(s.presence);
    return out;
  }

  /**
   * How many players count as being in a map spot's room now (`spotHere`,
   * the screen state's `spot.here`, C4): live joined sessions whose
   * presence room is that terminal's `room`. 0 for a `view: "reinstall"`
   * spot (the tent station is never linked, T3); null with no map or for a
   * spot the map lacks.
   */
  spotHere(spot: string): number | null {
    const house = this.map?.house;
    if (house === undefined) return null;
    const t = house.terminals.find((x) => x.id === spot);
    if (t === undefined) return null;
    if (t.view === "reinstall") return 0;
    let n = 0;
    for (const s of this.sessions.values()) if (s.joined && s.presence === t.room) n++;
    return n;
  }

  /** The map spots linked to the Internet now (`linkedSpots` of every
   *  player's presence room): a terminal there is watched (C7). Empty with
   *  no map. */
  linked(): Set<string> {
    const house = this.map?.house;
    return house === undefined ? new Set() : linkedSpots(house, this.presenceRooms());
  }

  /**
   * The camera spots a game session may see (C7): the map terminals in its
   * presence room, never a `view: "reinstall"` one (the tent, T3). Empty for
   * a parked session (not in the simulation yet) or one in no room; null
   * when the token names no live session.
   */
  camSpotsFor(token: string | undefined): Set<string> | null {
    const s = this.byTokenLive(token);
    if (s === null) return null;
    const house = this.map?.house;
    if (house === undefined || !s.joined || s.presence === null) return new Set();
    return linkedSpots(house, [s.presence]);
  }

  // -- game moments (wave 26, C6) -------------------------------------------

  /** The pickup prop ids a guest took tonight, sorted. */
  private pickedBy(guest: string): string[] {
    const out: string[] = [];
    for (const [prop, who] of this.picked) if (who.has(guest)) out.push(prop);
    return out.sort();
  }

  /**
   * A game moment (C6), judged on the session's last pose (the game flushes
   * one first). The session must be claimed (a pose). Then:
   * - **escape**: `voidDistance` at least `ESCAPE_M − ESCAPE_SLACK` past the
   *   walls, and `ESCAPE_COOLDOWN_MS` since this session's last escape. The
   *   pose is re-seated at the map spawn (room, floor and presence follow;
   *   the next flush jumps the ghost back), then `commit(ESCAPE_SIGNAL)`.
   * - **heart**: the prop is a heart, the map's King is fallen (or there is
   *   none), the guest hasn't heard it tonight, and `heartReached` holds.
   *   `commit(propSignal, {prop})`; the guest joins `heartHeard` only when
   *   the commit said something (a visit before he is awake may retry).
   * - **pickup**: the prop is a pickup, this guest hasn't taken it, and
   *   `pickupReach` with `PICKUP_SLACK_M` holds. `commit(propSignal, {item,
   *   prop})`, then the guest is in `picked[prop]`.
   * `commit` journals the signal and returns what it said to the program.
   */
  moment(
    token: string | undefined,
    req: MomentRequest,
    commit: (s: SessionRef, signal: string, args: Record<string, string>) => MomentLine[],
  ): MomentOutcome {
    const s = this.byTokenLive(token);
    if (s === null) return { kind: this.tokenState(token) };
    const kind = (req as { kind?: unknown }).kind;
    const propId = (req as { prop?: unknown }).prop;
    if (kind !== "escape" && ((kind !== "heart" && kind !== "pickup") || typeof propId !== "string" || propId === "")) return { kind: "bad" };
    if (!s.claimed) return { kind: "parked" };
    const map = this.map;
    // No map (unreachable while `begin` needs one): an escape is never out,
    // and `noProp` stays the heart's and the pickup's answer alone.
    if (map === null) return kind === "escape" ? { kind: "notOut", distance: 0 } : { kind: "noProp" };
    const house = map.house;
    const now = this.now();
    const ref: SessionRef = { id: s.id, guest: s.guest, device: s.device, captured: s.captured };
    if (kind === "escape") {
      const distance = voidDistance(house, s.pose.p);
      if (distance === null || distance < ESCAPE_M - ESCAPE_SLACK) return { kind: "notOut", distance: distance ?? 0 };
      if (s.escapedAt !== null && now - s.escapedAt >= 0 && now - s.escapedAt < ESCAPE_COOLDOWN_MS) {
        return { kind: "cooldown", retryMs: ESCAPE_COOLDOWN_MS - (now - s.escapedAt) };
      }
      s.escapedAt = now;
      s.activeAt = now;
      // Back to the spawn: the terminals' ghost jumps back on the next
      // flush, and the voice and cams follow the presence room at once.
      const spawn = s.spawn;
      s.pose = { p: [...spawn.pos], yaw: spawn.yaw, pitch: 0 };
      const at = locate(house, spawn.pos);
      s.room = at.room;
      s.floor = at.floor;
      s.presence = presenceRoom(house, spawn.pos, null);
      if (s.joined) s.dirty = true;
      return { kind: "ok", spawn, lines: commit(ref, ESCAPE_SIGNAL, {}) };
    }
    const id = propId as string;
    if (kind === "heart") {
      const prop = momentProp(house, id, "heart");
      if (prop === null) return { kind: "noProp" };
      const king = this.king();
      if (king !== null && !king.fallen) return { kind: "sealed" };
      if (this.heartHeard.has(s.guest)) return { kind: "already" };
      if (!heartReached(house, s.pose.p, prop)) return { kind: "notThere" };
      s.activeAt = now;
      const lines = commit(ref, propSignal(prop), { prop: prop.id });
      if (lines.length > 0) this.heartHeard.add(s.guest);
      return { kind: "ok", prop, lines };
    }
    const prop = momentProp(house, id, "pickup");
    if (prop === null) return { kind: "noProp" };
    if (this.picked.get(prop.id)?.has(s.guest) === true) return { kind: "already" };
    if (!pickupReach(house, s.pose.p, prop, PICKUP_SLACK_M)) {
      return { kind: "far", distance: Math.hypot(prop.pos[0] - s.pose.p[0], prop.pos[2] - s.pose.p[2]) };
    }
    s.activeAt = now;
    let who = this.picked.get(prop.id);
    if (who === undefined) this.picked.set(prop.id, (who = new Set()));
    // Taken before the commit: a story hook that throws never lets the
    // same disk be taken twice.
    who.add(s.guest);
    const lines = commit(ref, propSignal(prop), { item: prop.item ?? "", prop: prop.id });
    return { kind: "ok", prop, lines };
  }

  /**
   * The game says its player reached the duck. The session must have been
   * claimed (a pose) and its last pose must be near the duck; then `release`
   * commits the story outcome (once) and reports whether the program was
   * released. A repeat answers `already` without committing.
   * `stillCaptured` asks the story, after the commit, whether the program is
   * still captured (C4b: the `found` frame's `captured`, so a wall terminal
   * never lays an egg for a find the story refused); without it, a program
   * captured at the deal that the find didn't release counts as kept.
   */
  found(token: string | undefined, release: (s: SessionRef) => boolean, stillCaptured?: (s: SessionRef) => boolean): FoundOutcome {
    const s = this.byTokenLive(token);
    if (s === null) return { kind: this.tokenState(token) };
    if (s.found) return { kind: "found", released: s.released, already: true, captured: s.keptCaptured };
    // Unmarked since the last sweep (it runs once a second): over, never a
    // release for a program no longer marked (R16, G2).
    if (this.unmarked(s)) {
      this.finish(s, "unmarked");
      return { kind: "over" };
    }
    if (!s.claimed) return { kind: "parked" };
    const near = nearDuck(s.pose.p, s.duck.pos, this.map?.house);
    if (!near.near) return { kind: "far", distance: near.distance, dy: near.dy };
    s.found = true;
    s.foundAt = this.now();
    this.kingSpent.delete(s.guest); // the visit is over: the next scan may hit
    s.activeAt = s.foundAt;
    const ref: SessionRef = { id: s.id, guest: s.guest, device: s.device, captured: s.captured };
    s.released = release(ref);
    s.keptCaptured = stillCaptured !== undefined ? stillCaptured(ref) : s.captured && !s.released;
    this.lastFound.set(s.guest, s.duck.id);
    const run: DuckRun = { guest: s.guest, name: s.name, world: s.world, device: s.device, ms: Math.max(0, this.runClock() - s.playingAt), foundAt: s.foundAt };
    this.runLog.push(run);
    this.o.onRun?.(run);
    this.broadcast("found", { session: s.id, guest: s.guest, name: s.name, duck: s.duck, released: s.released, captured: s.keptCaptured });
    return { kind: "found", released: s.released, already: false, captured: s.keptCaptured };
  }

  /** Every duck found since the story (re)started, in order. */
  runs(): DuckRun[] {
    return [...this.runLog];
  }

  /** Adopt runs kept on disk (a server restart mid-show). */
  restoreRuns(runs: readonly DuckRun[]): void {
    this.runLog.length = 0;
    this.runLog.push(...runs);
  }

  /** End a session by its token (the game quit). */
  endByToken(token: string | undefined): PoseOutcome {
    const s = this.byTokenLive(token);
    if (s === null) return this.tokenState(token);
    this.finish(s, s.found ? "found" : "ended");
    return "ok";
  }

  /** End a session by its public id (a director). False when there is none. */
  end(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (s === undefined) return false;
    this.finish(s, s.found ? "found" : "ended");
    return true;
  }

  /** The `poses` frame for every player that moved since the last flush
   *  (sent to the stream; null — and nothing sent — when nobody moved). */
  flush(): SpatialFrames["poses"] | null {
    const players: PoseUpdate[] = [];
    for (const s of this.sessions.values()) {
      if (!s.dirty || !s.joined) continue;
      s.dirty = false;
      players.push({ session: s.id, p: s.pose.p, yaw: s.pose.yaw, pitch: s.pose.pitch, room: s.room, floor: s.floor });
    }
    // (wave 39) Every tick, moved or not: a held pulse lets go by the clock.
    this.stepPresence();
    if (players.length === 0) return null;
    const frame = { t: this.now(), players };
    this.broadcast("poses", frame);
    return frame;
  }

  // -- the house lights (wave 39, C2) ---------------------------------------

  /** The fixtures a program is under now (with the hold), keyed by fixture id. */
  presence(): ReadonlyMap<string, PresenceEntry> {
    return this.pulsed;
  }

  /** Run `presenceStep` over the joined sessions (a director's forced walk
   *  counts too); tell the runtime when the pulsed set changed. `fresh`
   *  forgets the hysteresis and the hold (a story reset). */
  private stepPresence(fresh = false): void {
    const getLights = this.o.lights;
    if (getLights === undefined) return;
    const players: PresencePlayer[] = [];
    for (const s of this.sessions.values()) if (s.joined) players.push({ session: s.id, room: s.presence, p: s.pose.p });
    const prev = fresh ? new Map<string, PresenceEntry>() : this.pulsed;
    let next: Map<string, PresenceEntry>;
    try {
      next = presenceStep(getLights(), this.map?.house ?? null, players, prev, this.now());
    } catch {
      next = new Map();
    }
    const changed = !samePulsed(this.pulsed, next);
    this.pulsed = next;
    if (changed) this.o.onPresence?.(next);
  }

  /** Time out silent sessions, let found ones go, drop stale parked ones. */
  sweep(): void {
    const now = this.now();
    for (const s of [...this.sessions.values()]) {
      if (s.found) {
        if (now - s.foundAt >= FOUND_LINGER_MS) this.finish(s, "found");
      } else if (!s.claimed) {
        if (now - s.startedAt >= PARK_TIMEOUT_MS) this.finish(s, "timeout");
      } else if (this.unmarked(s)) {
        // A live walk whose program was unmarked mid-way (a director's
        // release): it ends before a find could reward a healthy program
        // (R16, G2). A found walk is exempt — its own release unmarks it.
        this.finish(s, "unmarked");
      } else if (s.held) {
        // (wave 40) A suspended walk is exempt from the pose timeout; it is
        // given up only after the resume grace, freeing its duck.
        if (now - s.heldAt >= SUSPEND_GRACE_MS) this.finish(s, "timeout");
      } else if (now - s.activeAt >= POSE_TIMEOUT_MS) {
        this.finish(s, "timeout");
      }
    }
  }

  /** The story restarted: every session is over, and a hub-held King
   *  stands up again (a world-held one follows the story's own reseed).
   *  Stations stay known. */
  reset(kind: string): void {
    for (const s of [...this.sessions.values()]) this.finish(s, "reset");
    this.lastFound.clear();
    this.runLog.length = 0;
    this.kingMemory.clear();
    this.kingSpent.clear();
    this.heartHeard.clear();
    this.picked.clear();
    // (wave 39) A story reset is a cut: no pulse is held over it.
    this.stepPresence(true);
    this.broadcast("reset", { kind });
    this.syncKing(null);
  }

  // -- stations -------------------------------------------------------------

  /** A station polled: mark it seen, hand it the newest unclaimed assignment parked for it. */
  station(id: string, name: string, world: SpatialWorld): Assignment | null {
    this.stations.set(id, { id, name: name || id, world, seenAt: this.now() });
    let newest: Session | null = null;
    for (const s of [...this.sessions.values()]) {
      if (s.station !== id || s.claimed) continue;
      // Parked for a program no longer marked (R16, G1): over, never handed out.
      if (this.unmarked(s)) {
        this.finish(s, "unmarked");
        continue;
      }
      if (newest === null || s.startedAt >= newest.startedAt) newest = s;
    }
    return newest === null ? null : this.assignmentOf(newest);
  }

  /** Every station that ever polled, with whether it is online and who is
   *  on it: the newest claimed session there, else the newest parked one. */
  stationList(): StationInfo[] {
    const now = this.now();
    return [...this.stations.values()].map((st) => {
      let busy: Session | null = null;
      for (const s of this.sessions.values()) {
        if (s.station !== st.id) continue;
        if (busy === null || (s.claimed === busy.claimed ? s.startedAt >= busy.startedAt : s.claimed)) busy = s;
      }
      return {
        id: st.id,
        name: st.name,
        world: st.world,
        online: now - st.seenAt < STATION_ONLINE_MS,
        busy: busy === null ? null : { session: busy.id, guest: busy.guest, name: busy.name },
      };
    });
  }

  /** Live sessions (tests + tooling). */
  get sessionCount(): number {
    return this.sessions.size;
  }
}
