//! The world view's director — one camera, cut by a pure rule
//! (`docs/loom-reinstall.md` §4):
//!
//!   mount   a placed terminal (a `spot` on the map) is ALWAYS a fixed window
//!           into the virtual copy of its own room: the camera *is* the
//!           terminal — at its spot on the wall, looking along its yaw /
//!           pitch / fov (`windowPose`) — whether or not anyone is in the
//!           room, the way the games' virtual terminals show the real room
//!           through the tablet's camera. It never follows, never orbits,
//!           and a find doesn't move it (the celebration is the overlay's);
//!   eyes    wave 54: a placed terminal looking through a program's eyes
//!           (`eyes.ts` decides when; `DirectorInput.eyes` names them): at
//!           their eye, along their yaw / pitch, their own ghost hidden;
//!   follow  an unplaced terminal rides over the shoulder of the most
//!           recently active player (a player who just found the duck wins;
//!           a followed player is held a few seconds, and only dropped for
//!           one clearly fresher);
//!   orbit   else (unplaced, nobody playing) a slow circle of the spawn room.
//!
//! The chase camera never ends up behind a wall: the segment from the
//! player's head to the camera is tested against the `buildWalls` segments
//! (door gaps are already cut out of them) — each wall a slab of the house's
//! wall thickness, so the camera stops short of its *near face* plus a
//! clearance, never inside or past it — and pulled in short of the first
//! hit, and kept under the room's ceiling. When the chase has no room (a
//! player with their back to a wall) it tries a raised, shorter chase, then
//! the left shoulder, and failing those looks out of the player's own eyes
//! (`insideHead` tells the renderer to hide that ghost). Camera moves within
//! a shot are smoothed exponentially; a change of shot is a cut.
//!
//! Pure: no three.js here (the shadow view imports `windowPose`).
//!
//! Times: `now` in milliseconds (the caller's clock, the same one the world
//! state uses), `dt` in seconds. Angles in degrees, house frame.

import { DEFAULT_SPOT_FOV, forward, polyBounds, styleOf, roomById, roomElevation, roomHeight, type HouseMap, type TerminalSpot, type Vec3, type WallSegment } from "@loom/house";
import { labelPoint } from "./label-point.ts";

/** A followed player is kept at least this long (ms) after a cut. */
export const MIN_HOLD = 5000;
/** …and after that only dropped for a player this much (ms) fresher. */
export const SWITCH_GAP = 3000;
/** A player who found the duck this recently (ms) takes the camera. */
export const CELEBRATE_HOLD = 8000;
/**
 * The mounted camera's default pitch (degrees, a little down) and vertical
 * fov — the house contract's `DEFAULT_SPOT_FOV` (§1.1), so the VR game and
 * the map editor frame an unset spot exactly as the wall shows it.
 */
export const MOUNT_PITCH = -8;
export const MOUNT_FOV = DEFAULT_SPOT_FOV;
export const FOLLOW_FOV = 65;
export const ORBIT_FOV = 70;
/** Chase framing (metres): behind, to the right, above the feet. */
export const CHASE_BACK = 2.4;
export const CHASE_SIDE = 0.45;
export const CHASE_HEIGHT = 1.95;
/** The fallback chase when the usual one has no room: higher, nearer. */
export const RAISED_BACK = 1.4;
export const RAISED_SIDE = 0.3;
export const RAISED_HEIGHT = 2.4;
/** The head the chase camera looks past (metres above the feet). */
const PIVOT_HEIGHT = 1.5;
/** Pulled in this far short of a wall (metres), never nearer the head than `MIN_PULL`. */
const WALL_MARGIN = 0.25;
export const MIN_PULL = 0.35;
/** Kept this far (metres) off a wall's face, beyond half its thickness — the near plane plus slack. */
export const CAMERA_CLEAR = 0.06;
/** Kept this far under a ceiling (metres). */
const CEILING_MARGIN = 0.15;
/** Orbit angular speed (radians per second): a lap a minute or so. */
const ORBIT_SPEED = 0.1;
/** Smoothing rate (1/s) of the follow camera. */
const SMOOTH = 3.5;
/** The games' eye (metres above the feet) and vertical fov. */
export const EYE_HEIGHT = 1.6;
export const EYES_FOV = 70;
/** Smoothing rate (1/s) through someone's eyes: takes the jitter off a headset, not the turn. */
export const EYES_SMOOTH = 10;

export interface CameraPose {
  pos: Vec3;
  /** A point the camera looks at. */
  look: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
}

export type Shot =
  | { kind: "mount"; spot: string; room: string; subject: string | null }
  | { kind: "eyes"; spot: string; room: string; subject: string }
  | { kind: "follow"; subject: string; room: string | null }
  | { kind: "orbit"; room: string | null };

/** What the director needs of a player (the render loop's interpolated pose). */
export interface DirectorPlayer {
  session: string;
  name: string;
  /** Feet, house frame. */
  p: Vec3;
  yaw: number;
  pitch: number;
  room: string | null;
  floor: string;
  lastActive: number;
  foundAt: number | null;
  /** Where their duck sits (feet, house frame) — the chase frames it once they are close. */
  duck?: Vec3 | null;
}

export interface DirectorInput {
  house: HouseMap;
  walls: readonly WallSegment[];
  /** This terminal's place (placed = always the mount shot; null = unplaced: follow / orbit). */
  spot: TerminalSpot | null;
  players: readonly DirectorPlayer[];
  /** The session a placed terminal looks through (`eyes.ts`), else its window. */
  eyes?: string | null;
  now: number;
  dt: number;
}

export interface Director {
  shot: Shot;
  /** When the current shot was cut to. */
  cutAt: number;
  /** The last time a player stood in this terminal's room (null = never). */
  lastInRoom: number | null;
  cam: CameraPose;
}

/** Two shots with the same key are the same shot (no cut between them). */
export function shotKey(s: Shot): string {
  return s.kind === "mount" ? `mount:${s.spot}` : s.kind === "eyes" ? `eyes:${s.spot}:${s.subject}` : s.kind === "follow" ? `follow:${s.subject}` : `orbit:${s.room ?? ""}`;
}

/** Freshest first; ties by name, then session (deterministic). */
function freshestFirst(players: readonly DirectorPlayer[]): DirectorPlayer[] {
  return [...players].sort((a, b) => b.lastActive - a.lastActive || a.name.localeCompare(b.name) || (a.session < b.session ? -1 : a.session > b.session ? 1 : 0));
}

/** Pick the shot for this frame. */
export function chooseShot(input: DirectorInput, prev: Director | null): Shot {
  const { spot, players, now } = input;
  if (spot !== null) {
    if (players.some((p) => p.session === input.eyes)) return { kind: "eyes", spot: spot.id, room: spot.room, subject: input.eyes! };
    // A placed terminal is otherwise a fixed window: mounted. The subject (for
    // the overlays) is whoever is in its room, the one already named first.
    const inRoom = freshestFirst(players.filter((p) => p.room === spot.room));
    const keep = prev?.shot.kind === "mount" ? prev.shot.subject : null;
    const subject = inRoom.find((p) => p.session === keep)?.session ?? inRoom[0]?.session ?? null;
    return { kind: "mount", spot: spot.id, room: spot.room, subject };
  }
  if (players.length > 0) {
    const celebrating = players
      .filter((p) => p.foundAt !== null && now - p.foundAt < CELEBRATE_HOLD)
      .sort((a, b) => (b.foundAt ?? 0) - (a.foundAt ?? 0))[0];
    if (celebrating) return { kind: "follow", subject: celebrating.session, room: celebrating.room };
    const fresh = freshestFirst(players)[0]!;
    if (prev?.shot.kind === "follow") {
      const subject = prev.shot.subject;
      const cur = players.find((p) => p.session === subject);
      if (cur && (now - prev.cutAt < MIN_HOLD || fresh.lastActive - cur.lastActive < SWITCH_GAP)) return { kind: "follow", subject: cur.session, room: cur.room };
    }
    return { kind: "follow", subject: fresh.session, room: fresh.room };
  }
  return { kind: "orbit", room: input.house.spawn.room };
}

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerp = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

/** Out of a program's own eyes: the games' eye, along where they look, under the ceiling. */
export function eyesCamera(house: HouseMap, player: Pick<DirectorPlayer, "p" | "yaw" | "pitch" | "room">): CameraPose {
  const pos = underCeiling(house, player.room, add(player.p, [0, EYE_HEIGHT, 0]));
  return { pos, look: add(pos, forward(player.yaw, player.pitch), 4), fov: EYES_FOV };
}

/** The terminal itself as a camera: at the screen, a hair into the room, along its yaw/pitch, its own (vertical) fov when set. */
export function mountCamera(spot: TerminalSpot): CameraPose {
  const pitch = spot.pitch ?? MOUNT_PITCH;
  const f = forward(spot.yaw, pitch);
  // Stand in front of the screen's own (hidden) mesh and the wall box.
  const pos = add(spot.pos, forward(spot.yaw, 0), 0.15);
  return { pos, look: add(pos, f, 4), fov: spot.fov ?? MOUNT_FOV };
}

/**
 * A placed terminal's window into the virtual house: `mountCamera`, kept
 * under its room's ceiling. The one pose every view of "where this tablet
 * hangs" uses (the world view's mount shot, the shadow view's projection).
 */
export function windowPose(house: HouseMap, spot: TerminalSpot): CameraPose {
  const cam = mountCamera(spot);
  const pos = underCeiling(house, spot.room, cam.pos);
  if (pos === cam.pos) return cam;
  const dy = pos[1] - cam.pos[1];
  return { pos, look: [cam.look[0], cam.look[1] + dy, cam.look[2]], fov: cam.fov };
}

/**
 * The first wall the segment `from → to` crosses, as a fraction of the way
 * (1 = none). A wall counts where it spans the segment's height at the
 * crossing; `pad` widens each wall's extent along its line (thickness at the
 * corners). With `clear` > 0 a wall is a slab: the hit is where the segment
 * comes within `clear` of the wall's centre plane on the side it starts from
 * (0 when it starts that close and heads in).
 */
export function firstHit(walls: readonly WallSegment[], from: Vec3, to: Vec3, pad = 0.08, clear = 0): number {
  let best = 1;
  for (const w of walls) {
    // "x": the wall runs along x at z = c; "z": along z at x = c.
    const [a, b, along0, along1] = w.axis === "x" ? [from[2], to[2], from[0], to[0]] : [from[0], to[0], from[2], to[2]];
    const da = a - w.c;
    const db = b - w.c;
    let t: number;
    if (clear > 0) {
      // Distances beyond the near face, on the side the segment starts from
      // (exactly on the centre plane: the side it is leaving).
      const side = da > 0 ? 1 : da < 0 ? -1 : db > 0 ? -1 : 1;
      const ea = side * da - clear;
      const eb = side * db - clear;
      if (ea <= 0) {
        if (side * db >= side * da) continue; // inside the slab, heading out
        t = 0;
      } else {
        if (eb >= 0) continue;
        t = ea / (ea - eb);
      }
    } else {
      if (da === db || (da > 0 && db > 0) || (da < 0 && db < 0)) continue;
      t = da / (da - db);
    }
    if (t < 0 || t >= best) continue;
    const s = along0 + (along1 - along0) * t;
    if (s < w.lo - pad || s > w.hi + pad) continue;
    const y = from[1] + (to[1] - from[1]) * t;
    if (y < w.bottom || y > w.top) continue;
    best = t;
  }
  return best;
}

/** `to` pulled toward `from`, and how far from `from` it ended (metres). */
function pull(walls: readonly WallSegment[], from: Vec3, to: Vec3, margin: number, min: number, clear: number): { pos: Vec3; d: number } {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  if (len === 0) return { pos: to, d: 0 };
  const t = firstHit(walls, from, to, 0.08, clear);
  if (t >= 1) return { pos: to, d: len };
  const room = t * len;
  const want = room - margin;
  // The `min` floor applies only where there is room for it — never past the slab.
  const d = want >= min ? want : Math.max(0, Math.min(min, room - 0.02));
  return { pos: lerp(from, to, Math.min(1, d / len)), d };
}

/**
 * `to`, pulled toward `from` to stop `margin` short of the first wall in
 * between — never nearer the head than `min` unless the wall itself is
 * nearer (`clear`: the wall's half-thickness plus slack, see `firstHit`).
 */
export function pullIn(walls: readonly WallSegment[], from: Vec3, to: Vec3, margin = WALL_MARGIN, min = MIN_PULL, clear = 0): Vec3 {
  return pull(walls, from, to, margin, min, clear).pos;
}

/** How far off a wall's centre plane a camera keeps in this house. */
export function wallClearance(house: HouseMap): number {
  return styleOf(house).wallThickness / 2 + CAMERA_CLEAR;
}

/** Clamp a camera under the ceiling of a room (outdoor / unknown rooms: unchanged). */
function underCeiling(house: HouseMap, roomId: string | null, p: Vec3): Vec3 {
  const room = roomId !== null ? roomById(house, roomId) : undefined;
  if (!room || room.outdoor) return p;
  const max = roomElevation(house, room) + roomHeight(house, room) - CEILING_MARGIN;
  return p[1] > max ? [p[0], max, p[2]] : p;
}

/** Within this far of their duck (plan metres, and `DUCK_FRAME_DY` in height) the chase frames the duck. */
export const DUCK_FRAME_M = 3;
export const DUCK_FRAME_DY = 1.5;

/**
 * Over the shoulder of a player: behind, a little right, above — never behind
 * a wall. No room for that (back to a wall): a raised shorter chase, then the
 * left shoulder, then the player's own eyes. Close to their duck, the shot
 * turns to it: behind the player on the line to the duck, looking at it —
 * so the find itself is on screen whichever way their head points.
 */
export function followCamera(house: HouseMap, walls: readonly WallSegment[], player: Pick<DirectorPlayer, "p" | "yaw" | "room" | "duck">): CameraPose {
  const duck = player.duck ?? null;
  const toDuck = duck === null ? null : ([duck[0] - player.p[0], duck[1] - player.p[1], duck[2] - player.p[2]] as Vec3);
  const nearDuck = toDuck !== null && Math.hypot(toDuck[0], toDuck[2]) <= DUCK_FRAME_M && Math.abs(toDuck[1]) <= DUCK_FRAME_DY;
  // Heading toward the duck (yaw 0 = −z, +yaw = CCW); standing on it, keep their own.
  const heading = nearDuck && Math.hypot(toDuck![0], toDuck![2]) > 0.4 ? (Math.atan2(-toDuck![0], -toDuck![2]) * 180) / Math.PI : player.yaw;
  const f = forward(heading, 0);
  const right: Vec3 = [-f[2], 0, f[0]];
  const pivot = add(player.p, [0, PIVOT_HEIGHT, 0]);
  const look = nearDuck ? add(duck!, [0, 0.25, 0]) : add(add(player.p, [0, 1.2, 0]), f, 2.5);
  const clear = wallClearance(house);
  const chase = (back: number, side: number, height: number): Vec3 => add(add(add(player.p, f, -back), right, side), [0, height, 0]);
  const candidates = [chase(CHASE_BACK, CHASE_SIDE, CHASE_HEIGHT), chase(RAISED_BACK, RAISED_SIDE, RAISED_HEIGHT), chase(CHASE_BACK, -CHASE_SIDE, CHASE_HEIGHT)];
  for (const want of candidates) {
    const r = pull(walls, pivot, want, WALL_MARGIN, MIN_PULL, clear);
    if (r.d >= MIN_PULL) return { pos: underCeiling(house, player.room, r.pos), look, fov: FOLLOW_FOV };
  }
  return { pos: underCeiling(house, player.room, pivot), look, fov: FOLLOW_FOV };
}

/** The camera is in (or at) this player's head — the renderer hides their ghost. */
export function insideHead(cam: CameraPose, p: Vec3): boolean {
  return Math.hypot(cam.pos[0] - p[0], cam.pos[1] - (p[1] + PIVOT_HEIGHT), cam.pos[2] - p[2]) < MIN_PULL - 0.05;
}

/** A slow circle inside a room, looking across it through its middle. */
export function orbitCamera(house: HouseMap, walls: readonly WallSegment[], roomId: string | null, now: number): CameraPose {
  const room = (roomId !== null ? roomById(house, roomId) : undefined) ?? house.rooms[0]!;
  const [cx, cz] = labelPoint(room.poly);
  const [x0, z0, x1, z1] = polyBounds(room.poly);
  const elev = roomElevation(house, room);
  const radius = Math.min(2.5, Math.max(0.5, 0.3 * Math.min(x1 - x0, z1 - z0)));
  const a = (now / 1000) * ORBIT_SPEED;
  const dir: Vec3 = [Math.sin(a), 0, Math.cos(a)];
  const centre: Vec3 = [cx, elev + 1.7, cz];
  const pos = underCeiling(house, room.id, pullIn(walls, centre, add(centre, dir, radius), WALL_MARGIN, MIN_PULL, wallClearance(house)));
  const look: Vec3 = [cx - dir[0] * radius * 1.5, elev + 1.0, cz - dir[2] * radius * 1.5];
  return { pos, look, fov: ORBIT_FOV };
}

/** Where the camera wants to be for a shot. */
export function framing(input: DirectorInput, shot: Shot): CameraPose {
  if (shot.kind === "mount" && input.spot !== null) return windowPose(input.house, input.spot);
  if (shot.kind === "eyes") {
    const p = input.players.find((x) => x.session === shot.subject);
    if (p) return eyesCamera(input.house, p);
  }
  if (shot.kind === "follow") {
    const p = input.players.find((x) => x.session === shot.subject);
    if (p) return followCamera(input.house, input.walls, p);
  }
  return orbitCamera(input.house, input.walls, shot.kind === "orbit" ? shot.room : input.house.spawn.room, input.now);
}

/** One frame of direction: the shot, and the (smoothed) camera. */
export function direct(input: DirectorInput, prev: Director | null): Director {
  const shot = chooseShot(input, prev);
  const target = framing(input, shot);
  const inRoom = input.spot !== null && input.players.some((p) => p.room === input.spot!.room);
  const lastInRoom = inRoom ? input.now : (prev?.lastInRoom ?? null);
  if (prev === null || shotKey(prev.shot) !== shotKey(shot)) return { shot, cutAt: input.now, lastInRoom, cam: target };
  if (shot.kind !== "follow" && shot.kind !== "eyes") return { shot, cutAt: prev.cutAt, lastInRoom, cam: target };
  const k = 1 - Math.exp(-Math.max(0, input.dt) * (shot.kind === "eyes" ? EYES_SMOOTH : SMOOTH));
  return {
    shot,
    cutAt: prev.cutAt,
    lastInRoom,
    cam: { pos: lerp(prev.cam.pos, target.pos, k), look: lerp(prev.cam.look, target.look, k), fov: target.fov },
  };
}

/** The floor a shot is on (the mini-map shows it). */
export function shotFloor(house: HouseMap, shot: Shot, players: readonly Pick<DirectorPlayer, "session" | "floor">[]): string {
  const roomFloor = (id: string | null) => (id !== null ? roomById(house, id)?.floor : undefined);
  if (shot.kind === "follow" || shot.kind === "eyes") {
    const p = players.find((x) => x.session === shot.subject);
    if (p) return p.floor;
  }
  return roomFloor(shot.room) ?? roomFloor(house.spawn.room) ?? house.floors[0]!.id;
}
