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

import { randomBytes, randomUUID } from "node:crypto";

import {
  DUCK_MAX_RISE,
  KING_HIT_SLACK,
  floorOf,
  guardWarnings,
  houseHash,
  kingProps,
  kingReach,
  kingStateOf,
  locate,
  pickDuckSpot,
  standable,
  withFallenKings,
  wrapYaw,
} from "@loom/house";
import type {
  Assignment,
  DuckSpot,
  HouseMap,
  HouseSource,
  KingReach,
  KingState,
  LeaveReason,
  PlayerPose,
  PlayerState,
  PoseUpdate,
  Prop,
  SpatialCandidate,
  SpatialFrames,
  SpatialWorld,
  Spawn,
  StationInfo,
  Vec3,
} from "@loom/house";

/** A station counts as online when it polled within this long. */
export const STATION_ONLINE_MS = 5_000;
/** A session with no pose for this long leaves (`timeout`). */
export const POSE_TIMEOUT_MS = 60_000;
/** A parked assignment nobody claims is dropped after this long — a
 *  headset may sit on the desk a while before someone puts it on. */
export const PARK_TIMEOUT_MS = 5 * 60_000;
/** A found session lingers this long (terminals celebrate), then leaves. */
export const FOUND_LINGER_MS = 8_000;
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
  /** Reads a world path (the King's `health`): his current hit points. A
   *  missing or non-number value reads as full. Absent (or a king with no
   *  `health` path): the hub keeps his hit points in memory. */
  kingHp?: (path: string) => unknown;
  /** A program's profile picture: its avatar key (`/api/avatar/<key>`), or
   *  null. Read live, so a changed picture never goes stale. */
  avatarOf?: (guest: string, name: string) => string | null;
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
  return { guest, name, world: r["world"], device, ms, foundAt };
}

/** Where the map came from: a director's save for this event, the
 *  project's snapshot (its active variant), or the show's file. */
export type { HouseSource };

/** One program in the simulation. */
interface Session {
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
  room: string | null;
  floor: string;
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
  /** This visit hit the King (one hit per visit, D2). */
  kingHit: boolean;
  /** The avatar key last told the stream (`refreshAvatar` sends a change). */
  avatar: string | null;
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
}

export type PoseOutcome = "ok" | "unknown" | "over";

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
export function sortCandidates(rows: SpatialCandidate[]): SpatialCandidate[] {
  return [...rows].sort((a, b) => {
    if (a.captured !== b.captured) return a.captured ? -1 : 1;
    if (a.restricted !== b.restricted) return a.restricted ? -1 : 1;
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
  /** Whose hit is being committed: the `king` frame's `by`. */
  private hitBy: string | null = null;

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
      s.houseVersion = version;
      if (s.joined) s.dirty = true;
    }
    if (announce) this.broadcast("house", { version });
    for (const s of moved) this.broadcast("duck", { session: s.id, duck: s.duck });
    if (announce) this.syncKing(null);
    else this.kingSent = kingKey(this.king());
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
    return this.subscribers.size > 0 || this.sessions.size > 0;
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
   * it spent stays spent — and, with a station, any older assignment still
   * parked there. Null when there is no house map.
   */
  begin(input: BeginInput): Assignment | null {
    const map = this.map;
    if (map === null) return null;
    let kingHit = false;
    for (const s of [...this.sessions.values()]) {
      if (s.guest === input.guest) {
        // Only a live walk carries its hit (D2: a re-scan mid-walk); a found
        // session lingering for its celebration is a finished visit.
        if (!s.found) kingHit ||= s.kingHit;
        this.finish(s, "replaced");
      } else if (input.station !== null && s.station === input.station && !s.claimed) this.finish(s, "replaced");
    }
    const id = this.mintSessionId();
    const token = this.o.newToken?.() ?? randomUUID();
    const last = this.lastFound.get(input.guest);
    const duck = pickDuckSpot(map.house, id, last !== undefined ? [last] : []);
    const spawn = map.house.spawn;
    const at = locate(map.house, spawn.pos);
    const now = this.now();
    const s: Session = {
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
    };
  }

  private join(s: Session): void {
    s.joined = true;
    this.broadcast("join", { player: this.stateOf(s) });
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
    if (s.joined) this.broadcast("leave", { session: s.id, reason });
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
    const same = s.pose.p[0] === pose.p[0] && s.pose.p[1] === pose.p[1] && s.pose.p[2] === pose.p[2] && s.pose.yaw === pose.yaw && s.pose.pitch === pose.pitch;
    if (!same) {
      s.pose = { p: [...pose.p], yaw: pose.yaw, pitch: pose.pitch };
      if (map !== null) {
        const at = locate(map.house, pose.p);
        s.room = at.room;
        s.floor = at.floor;
      }
    }
    if (!s.claimed) {
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
    if (!s.claimed) return { kind: "parked" };
    const near = nearDuck(s.pose.p, s.duck.pos, this.map?.house);
    if (!near.near) return { kind: "far", distance: near.distance, dy: near.dy };
    s.found = true;
    s.foundAt = this.now();
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
    if (players.length === 0) return null;
    const frame = { t: this.now(), players };
    this.broadcast("poses", frame);
    return frame;
  }

  /** Time out silent sessions, let found ones go, drop stale parked ones. */
  sweep(): void {
    const now = this.now();
    for (const s of [...this.sessions.values()]) {
      if (s.found) {
        if (now - s.foundAt >= FOUND_LINGER_MS) this.finish(s, "found");
      } else if (!s.claimed) {
        if (now - s.startedAt >= PARK_TIMEOUT_MS) this.finish(s, "timeout");
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
    this.broadcast("reset", { kind });
    this.syncKing(null);
  }

  // -- stations -------------------------------------------------------------

  /** A station polled: mark it seen, hand it the newest unclaimed assignment parked for it. */
  station(id: string, name: string, world: SpatialWorld): Assignment | null {
    this.stations.set(id, { id, name: name || id, world, seenAt: this.now() });
    let newest: Session | null = null;
    for (const s of this.sessions.values()) {
      if (s.station === id && !s.claimed && (newest === null || s.startedAt >= newest.startedAt)) newest = s;
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
