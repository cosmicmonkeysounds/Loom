//! What a terminal knows about the reinstallation simulation — folded from
//! the spatial stream (`GET /api/spatial/stream`, `docs/loom-reinstall.md`
//! §2.2) by a pure reducer: who is playing, where they are (a `PoseBuffer`
//! per session, so the render loop interpolates ~120 ms behind), who moved
//! last (the director follows them), the celebrations a `found` frame
//! starts, and where each duck sits (a `duck` frame moves it when a map
//! save re-deals it).
//!
//! A find that released nobody while the story keeps the program captured
//! (the banishment: "Gerald cannot help you") is `kept`: the frame says
//! `released: false, captured: true`, and the screens show no golden egg
//! and no fly-off, only "GERALD CAN'T HELP". A server that doesn't send
//! `captured` on the frame is read as before (never kept).
//!
//! Times are the terminal's own clock (milliseconds — `performance.now()` in
//! the app, a counter in tests): poses are stamped when they *arrive*, never
//! with the server's `t`, so interpolation needs no clock sync.
//!
//! The state is replaced on every frame (new top-level object, new player
//! objects for the players a frame touched) so a `useSyncExternalStore`
//! selector sees each change; a session's `PoseBuffer` is the one thing
//! carried across by reference — it is the render loop's, and pushing the
//! same arrival time twice replaces rather than duplicates.

import type { DuckSpot, PlayerPose, PlayerState, SpatialFrame, SpatialWorld, Vec3 } from "@loom/house";
import { PoseBuffer } from "@loom/house/three";

/** A move this far (metres, plan + height) since the last one counts as activity. */
export const ACTIVE_MOVE = 0.15;
/** …or a turn this far (degrees). */
export const ACTIVE_TURN = 20;
/** How long a celebration stays up (ms) — the server lingers a found session 8 s. */
export const CELEBRATION_MS = 8000;

export interface WorldPlayer {
  session: string;
  guest: string;
  name: string;
  world: SpatialWorld;
  device: string;
  /** The latest pose received (not interpolated). */
  pose: PlayerPose;
  room: string | null;
  floor: string;
  duck: DuckSpot;
  found: boolean;
  /** When this player last really moved (local ms) — the director follows the freshest. */
  lastActive: number;
  /** The pose `lastActive` was measured from. */
  anchor: PlayerPose;
  /** When the duck was found (local ms), else null. */
  foundAt: number | null;
  /** The find released nobody and the program is still captured: Gerald
   *  stays put (no egg, no fly-off). */
  kept: boolean;
  /** Interpolation buffer (shared by reference across states). */
  buffer: PoseBuffer;
}

export interface Celebration {
  session: string;
  guest: string;
  name: string;
  /** The program was corrupted and is free now (else: just found Gerald). */
  released: boolean;
  /** Found Gerald, but the story keeps them captured (the banishment). */
  kept: boolean;
  at: number;
}

/** A `found` frame that released nobody while the program stays captured
 *  (`captured` is read off the wire: an older server never sends it). */
export function keptFind(f: { released: boolean }): boolean {
  return !f.released && (f as { captured?: unknown }).captured === true;
}

/** The celebration's line under the program's name. */
export function celebrationLine(c: Pick<Celebration, "released" | "kept">): string {
  if (c.kept) return "GERALD CAN'T HELP";
  return c.released ? "HAS BEEN REINSTALLED" : "FOUND THE GOLDEN DUCK";
}

/** Gerald lays his egg and flies off for a find — never for a kept one. */
export function laysEgg(p: Pick<WorldPlayer, "found" | "kept">): boolean {
  return p.found && !p.kept;
}

export interface WorldState {
  /** The map version the stream announced (`hello` / `house`) — refetch when it moves. */
  houseVersion: string | null;
  players: ReadonlyMap<string, WorldPlayer>;
  celebrations: readonly Celebration[];
  /** The last `reset` (local ms) — the story restarted, every session ended. */
  resetAt: number | null;
}

export const EMPTY_WORLD: WorldState = { houseVersion: null, players: new Map(), celebrations: [], resetAt: null };

function copyPose(p: PlayerPose): PlayerPose {
  return { p: [p.p[0], p.p[1], p.p[2]] as Vec3, yaw: p.yaw, pitch: p.pitch };
}

/** Did a player move (or turn) enough since `anchor` to count as active? */
export function moved(anchor: PlayerPose, pose: PlayerPose): boolean {
  const dx = pose.p[0] - anchor.p[0];
  const dy = pose.p[1] - anchor.p[1];
  const dz = pose.p[2] - anchor.p[2];
  if (dx * dx + dy * dy + dz * dz >= ACTIVE_MOVE * ACTIVE_MOVE) return true;
  const turn = Math.abs(((pose.yaw - anchor.yaw + 540) % 360) - 180);
  return turn >= ACTIVE_TURN;
}

function fromState(s: PlayerState, now: number, prior: WorldPlayer | undefined): WorldPlayer {
  const pose: PlayerPose = { p: [s.p[0], s.p[1], s.p[2]], yaw: s.yaw, pitch: s.pitch };
  const b = prior?.buffer ?? new PoseBuffer();
  b.push(now, pose);
  return {
    session: s.session,
    guest: s.guest,
    name: s.name,
    world: s.world,
    device: s.device,
    pose,
    room: s.room,
    floor: s.floor,
    duck: s.duck,
    found: s.found,
    lastActive: now,
    anchor: copyPose(pose),
    foundAt: s.found ? now : null,
    // The player list never says; a reconnect keeps what a `found` frame told us.
    kept: s.found && prior?.kept === true,
    buffer: b,
  };
}

function sameDuck(a: DuckSpot, b: DuckSpot): boolean {
  return a.id === b.id && a.room === b.room && a.pos[0] === b.pos[0] && a.pos[1] === b.pos[1] && a.pos[2] === b.pos[2];
}

/** Fold one stream frame into the state, at local time `now` (ms). */
export function reduce(state: WorldState, frame: SpatialFrame, now: number): WorldState {
  switch (frame.event) {
    case "hello": {
      // A (re)connect: the server's list is the truth. Keep the buffers of
      // sessions we already knew so their ghosts don't jump.
      const players = new Map<string, WorldPlayer>();
      for (const s of frame.data.players) players.set(s.session, fromState(s, now, state.players.get(s.session)));
      return { ...state, houseVersion: frame.data.houseVersion, players };
    }
    case "join": {
      const players = new Map(state.players);
      const s = frame.data.player;
      players.set(s.session, fromState(s, now, state.players.get(s.session)));
      return { ...state, players };
    }
    case "poses": {
      let players: Map<string, WorldPlayer> | null = null;
      for (const u of frame.data.players) {
        const cur = (players ?? state.players).get(u.session);
        if (!cur) continue; // a pose for a session we never saw join — the next hello brings it
        const pose: PlayerPose = { p: [u.p[0], u.p[1], u.p[2]], yaw: u.yaw, pitch: u.pitch };
        cur.buffer.push(now, pose);
        const active = moved(cur.anchor, pose);
        players ??= new Map(state.players);
        players.set(u.session, {
          ...cur,
          pose,
          room: u.room,
          floor: u.floor,
          lastActive: active ? now : cur.lastActive,
          anchor: active ? copyPose(pose) : cur.anchor,
        });
      }
      return players === null ? state : { ...state, players };
    }
    case "found": {
      const f = frame.data;
      const players = new Map(state.players);
      const cur = players.get(f.session);
      const kept = keptFind(f);
      if (cur) players.set(f.session, { ...cur, found: true, foundAt: cur.foundAt ?? now, kept, lastActive: now });
      const celebrations = [...state.celebrations.filter((c) => c.session !== f.session), { session: f.session, guest: f.guest, name: f.name, released: f.released, kept, at: now }];
      return { ...state, players, celebrations };
    }
    case "leave": {
      if (!state.players.has(frame.data.session)) return state;
      const players = new Map(state.players);
      players.delete(frame.data.session);
      return { ...state, players };
    }
    case "duck": {
      // A map save moved (or re-dealt) this player's duck. The server never
      // sends one for a found duck — it stays where it was found — so a
      // stray one for a found player is ignored, as is a no-op move.
      const { session, duck } = frame.data;
      const cur = state.players.get(session);
      if (!cur || cur.found || sameDuck(cur.duck, duck)) return state;
      const players = new Map(state.players);
      players.set(session, { ...cur, duck: { id: duck.id, room: duck.room, pos: [duck.pos[0], duck.pos[1], duck.pos[2]] } });
      return { ...state, players };
    }
    case "house":
      return frame.data.version === state.houseVersion ? state : { ...state, houseVersion: frame.data.version };
    case "reset":
      return { ...state, players: new Map(), celebrations: [], resetAt: now };
  }
}

/** Drop celebrations older than `CELEBRATION_MS` (same object when none expired). */
export function prune(state: WorldState, now: number): WorldState {
  const kept = state.celebrations.filter((c) => now - c.at < CELEBRATION_MS);
  return kept.length === state.celebrations.length ? state : { ...state, celebrations: kept };
}

/** Players, the freshest first (then by name, then session — deterministic). */
export function byActivity(state: WorldState): WorldPlayer[] {
  return [...state.players.values()].sort((a, b) => b.lastActive - a.lastActive || a.name.localeCompare(b.name) || (a.session < b.session ? -1 : a.session > b.session ? 1 : 0));
}

/** The stream's frame names (`addEventListener` on each). */
export const FRAME_NAMES: ReadonlySet<string> = new Set(["hello", "join", "poses", "found", "leave", "house", "duck", "reset"]);

/** Decode one SSE frame (`event` name + JSON `data`); null for anything unknown or malformed. */
export function decodeFrame(event: string, data: string): SpatialFrame | null {
  if (!FRAME_NAMES.has(event)) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed === null || typeof parsed !== "object") return null;
    return { event, data: parsed } as SpatialFrame;
  } catch {
    return null;
  }
}
