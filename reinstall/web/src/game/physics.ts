//! The walker — pure. One body (a circle of radius 0.25 m, 1.7 m tall,
//! standing on its feet) moved through the house map in the house frame
//! (`docs/loom-reinstall.md` §3 "Play"):
//!
//! - **Walls.** Every `buildWalls` segment (walls, fences, lintels, rails)
//!   whose vertical span overlaps the body blocks it, as a line with round
//!   ends (door jambs); solid props block as boxes (cylinders as discs).
//!   Contacts push the circle out along the contact normal, so walking into
//!   a wall at an angle slides along it.
//! - **Floors.** `heightAt` gives the surface under the feet: floors, and
//!   ramps for stairs. A rise of up to `STEP_UP` is climbed; nothing under
//!   the feet or a rise too high is a wall. A drop of more than a step is a
//!   fall (gravity).
//! - **The outside** (wave 26, R4). With `ground` (the engine passes
//!   `@loom/house` `outsideGround`, the same rect as VR's `_build_ground`),
//!   a plan point no floor covers but inside that rect, within a step of its
//!   elevation, stands on the outside ground — so a program walks out through
//!   an exterior door into the void. Walls and fences still block: the only
//!   way out is a door gap. Without it, the outside is a wall.
//! - **Head room.** A surface overhead inside the body's height — a stair's
//!   ramp seen from the floor below its side — is a wall too: you can walk
//!   under the high end of a stair, not into the solid under its ramp.
//! - **No tunnelling.** A frame's travel is cut into substeps of at most
//!   `MAX_SUBSTEP` (< the radius), and a contact whose centre sits exactly on
//!   the line is pushed back to the side it came from.
//!
//! Units: metres, seconds, degrees. Yaw follows the house frame (0 = north,
//! + = counter-clockwise from above, i.e. turning left).

import { buildWalls, doorGap, heightAt, pointInRect, propSolid, rampHeight, standable, STEP_UP, surfacesAt, wallEnds, withFallenKings } from "@loom/house";
import type { HouseMap, OutsideGround, Vec2, Vec3, WallSegment } from "@loom/house";

export const RADIUS = 0.25;
export const EYE_HEIGHT = 1.6;
/** The body's collision span above the feet (a lintel at 2.0 m is cleared). */
export const BODY_HEIGHT = 1.7;
export const WALK_SPEED = 1.8;
export const RUN_FACTOR = 1.6;
/** Degrees per second at full stick / key. */
export const TURN_RATE = 110;
export const LOOK_RATE = 80;
export const MAX_PITCH = 75;
/** Longest horizontal travel per substep (well under `RADIUS`). */
export const MAX_SUBSTEP = 0.1;
/** A frame longer than this is clamped (a tab coming back, a GC pause). */
export const MAX_DT = 0.1;
export const GRAVITY = 9.8;
/** A blocker whose top clears the feet by less than this is stepped over. */
export const STEP_OVER = 0.05;
const PUSH_ITERATIONS = 4;
const EPS = 1e-9;

/** What moves. `p` is the feet (as the wire wants it); `vy` the fall speed. */
export interface Body {
  p: Vec3;
  yaw: number;
  pitch: number;
  vy: number;
}

/** One frame of intent (`input.ts` combines keys, sticks and drags into it). */
export interface MoveInput {
  /** `[right, forward]`, each −1…1 (clamped to the unit disc). */
  move: [number, number];
  /** −1…1, + = turn right. */
  turn: number;
  /** −1…1, + = look up. */
  look: number;
  run: boolean;
  /** Direct yaw / pitch deltas in degrees (a mouse drag), + = right / up. */
  dragYaw?: number;
  dragPitch?: number;
}

export const NO_INPUT: MoveInput = { move: [0, 0], turn: 0, look: 0, run: false };

type Blocker =
  | { kind: "segment"; a: Vec2; b: Vec2; bottom: number; top: number }
  | { kind: "box"; c: Vec2; hw: number; hd: number; cos: number; sin: number; bottom: number; top: number }
  | { kind: "disc"; c: Vec2; r: number; bottom: number; top: number };

/** The collision geometry of one house, built once per map. */
export interface PhysicsWorld {
  house: HouseMap;
  blockers: Blocker[];
  /** The walkable outside (`PhysicsOptions.ground`), null when there is none. */
  ground: { y: number; rect: readonly [number, number, number, number] } | null;
}

export interface PhysicsOptions {
  /** Props (by id) left out of the collision — a fallen king. */
  omitProps?: ReadonlySet<string>;
  /** Doors (by id) shut: their gap (`doorGap`) blocks like a wall — a guarded door while its king stands. */
  closedDoors?: ReadonlySet<string>;
  /** The outside ground (`outsideGround(house)`, wave 26 R4): walkable where no floor is. */
  ground?: OutsideGround | null;
}

export function buildPhysicsWorld(house: HouseMap, walls: readonly WallSegment[] = buildWalls(house), opts: PhysicsOptions = {}): PhysicsWorld {
  const blockers: Blocker[] = [];
  for (const w of walls) {
    const [a, b] = wallEnds(w);
    blockers.push({ kind: "segment", a, b, bottom: w.bottom, top: w.top });
  }
  if (opts.closedDoors !== undefined) {
    for (const door of house.doors) {
      if (!opts.closedDoors.has(door.id)) continue;
      const gap = doorGap(house, door);
      if (gap === null) continue;
      const [a, b] = wallEnds(gap);
      blockers.push({ kind: "segment", a, b, bottom: gap.bottom, top: gap.top });
    }
  }
  for (const prop of house.props) {
    if (!propSolid(prop)) continue;
    if (opts.omitProps?.has(prop.id)) continue;
    const [w, h, d] = prop.size;
    const c: Vec2 = [prop.pos[0], prop.pos[2]];
    const bottom = prop.pos[1];
    const top = prop.pos[1] + h;
    if (prop.kind === "cylinder") blockers.push({ kind: "disc", c, r: Math.max(w, d) / 2, bottom, top });
    else {
      const r = ((prop.yaw ?? 0) * Math.PI) / 180;
      blockers.push({ kind: "box", c, hw: w / 2, hd: d / 2, cos: Math.cos(r), sin: Math.sin(r), bottom, top });
    }
  }
  const ground = opts.ground ?? null;
  return { house, blockers, ground: ground === null ? null : { y: ground.y, rect: ground.rect } };
}

/**
 * The surface under a plan point for a body at `y`: `heightAt` (floors,
 * ramps), else the outside ground when the point is inside its rect and its
 * elevation is within a step of `y` (never a hole in an upper floor, never
 * the basement's). Null: the void (a wall).
 */
export function groundAt(world: PhysicsWorld, plan: Vec2, y: number): number | null {
  const h = heightAt(world.house, plan, y);
  if (h !== null) return h;
  const g = world.ground;
  if (g === null) return null;
  const [x0, z0, x1, z1] = g.rect;
  if (plan[0] < x0 || plan[0] > x1 || plan[1] < z0 || plan[1] > z1) return null;
  return Math.abs(g.y - y) <= STEP_UP + EPS ? g.y : null;
}

/** The body at the map's spawn. */
export function spawnBody(house: HouseMap, at: { pos: Vec3; yaw: number } = house.spawn): Body {
  const y = heightAt(house, [at.pos[0], at.pos[2]], at.pos[1]) ?? at.pos[1];
  return { p: [at.pos[0], y, at.pos[2]], yaw: wrap(at.yaw), pitch: 0, vy: 0 };
}

/**
 * The body after a remap (a director's save, the tent ↔ shed switch,
 * `docs/loom-reinstall.md` §1.3): where it stands when that is still
 * `standable` on the new map, else back at the new map's spawn (facing its
 * way, pitch kept) — a player inside what is now a solid prop (the shed on
 * the tent map) or outside every room would be stuck there. `fallen` names
 * the kings that are down: standing room is judged with them out of the way
 * (`withFallenKings` — a kneeling King is no solid prop), as the server's
 * `setHouse` re-seats, so a player on his spot or in his doorway stays put.
 */
export function bodyAfterRemap(house: HouseMap, body: Body, fallen: ReadonlySet<string> = new Set()): { body: Body; respawned: boolean } {
  if (standable(withFallenKings(house, fallen), body.p)) return { body, respawned: false };
  return { body: { ...spawnBody(house), pitch: body.pitch }, respawned: true };
}

/** Where the eye is, for a body. */
export function eyeOf(body: Body): Vec3 {
  return [body.p[0], body.p[1] + EYE_HEIGHT, body.p[2]];
}

/** The plan unit vectors `[forward, right]` of a yaw. */
export function planAxes(yaw: number): [Vec2, Vec2] {
  const r = (yaw * Math.PI) / 180;
  const s = Math.sin(r);
  const c = Math.cos(r);
  return [
    [-s, -c],
    [c, -s],
  ];
}

/** Advance the body by `dt` seconds of `input`. Pure. */
export function move(body: Body, input: MoveInput, dt: number, world: PhysicsWorld): Body {
  const t = Math.min(Math.max(dt, 0), MAX_DT);
  const yaw = wrap(body.yaw - clamp1(input.turn) * TURN_RATE * t - (input.dragYaw ?? 0));
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, body.pitch + clamp1(input.look) * LOOK_RATE * t + (input.dragPitch ?? 0)));

  // Intent → a plan displacement.
  let [mx, mf] = input.move;
  const mag = Math.hypot(mx, mf);
  if (mag > 1) {
    mx /= mag;
    mf /= mag;
  }
  const speed = WALK_SPEED * (input.run ? RUN_FACTOR : 1);
  const [fwd, right] = planAxes(yaw);
  const dx = (fwd[0] * mf + right[0] * mx) * speed * t;
  const dz = (fwd[1] * mf + right[1] * mx) * speed * t;

  let p: Vec3 = [body.p[0], body.p[1], body.p[2]];
  const travel = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(travel / MAX_SUBSTEP));
  for (let i = 0; i < steps; i++) p = step(world, p, dx / steps, dz / steps);
  // Nothing moved but the floor may still be under us (spawned, or pushed).
  if (travel === 0) p = settle(world, p);

  // Vertical: stand on the surface, or fall to it.
  let vy = body.vy;
  const ground = groundAt(world, [p[0], p[2]], p[1]);
  if (ground === null) vy = 0;
  else if (p[1] - ground <= STEP_UP + EPS && vy === 0) p[1] = ground;
  else if (p[1] > ground) {
    vy += GRAVITY * t;
    p[1] = Math.max(ground, p[1] - vy * t);
    if (p[1] === ground) vy = 0;
  } else {
    p[1] = ground;
    vy = 0;
  }
  return { p, yaw, pitch, vy };
}

/** One substep: slide the circle by `(dx, dz)` and stand it on the floor. */
function step(world: PhysicsWorld, p: Vec3, dx: number, dz: number): Vec3 {
  const tries: Array<[number, number]> = [
    [dx, dz],
    [dx, 0],
    [0, dz],
  ];
  for (const [ddx, ddz] of tries) {
    if (ddx === 0 && ddz === 0) continue;
    const plan = resolve(world, [p[0] + ddx, p[2] + ddz], p[1], [p[0], p[2]]);
    const ground = groundAt(world, plan, p[1]);
    if (ground === null || ground > p[1] + STEP_UP + EPS) continue; // the void, or a wall of floor
    // Snap down only by a step: a bigger drop is left to gravity.
    const y = ground >= p[1] - STEP_UP - EPS ? ground : p[1];
    // Something overhead inside the body (a ramp beside us): a wall. A body
    // already wedged under one (a remap moved the stair) may still leave.
    if (headBlocked(world.house, plan, y) && !headBlocked(world.house, [p[0], p[2]], p[1])) continue;
    return [plan[0], y, plan[1]];
  }
  return p;
}

/** Push the circle out of whatever it overlaps where it stands. */
function settle(world: PhysicsWorld, p: Vec3): Vec3 {
  const plan = resolve(world, [p[0], p[2]], p[1], [p[0], p[2]]);
  const ground = groundAt(world, plan, p[1]);
  if (ground === null || ground > p[1] + STEP_UP + EPS) return p;
  if (headBlocked(world.house, plan, p[1]) && !headBlocked(world.house, [p[0], p[2]], p[1])) return p;
  return [plan[0], p[1], plan[1]];
}

/** Rim samples for the head-room test: just inside the circle, so a body
 *  hugging a stair's rail (centre exactly `RADIUS` off it) still fits. */
const RIM = RADIUS * 0.9;

/**
 * Would a body standing at `y` over `plan` have a surface inside it — above
 * a step, below the top of its head? The centre is tested against every
 * surface (floors, ramps); the rim against ramps only, so the body can't
 * lean a quarter metre into the solid under a stair's side.
 */
export function headBlocked(house: HouseMap, plan: Vec2, y: number): boolean {
  const inside = (s: number) => s > y + STEP_UP + EPS && s < y + BODY_HEIGHT;
  if (surfacesAt(house, plan).some(inside)) return true;
  if (house.stairs.length === 0) return false;
  const rim: Vec2[] = [
    [plan[0] + RIM, plan[1]],
    [plan[0] - RIM, plan[1]],
    [plan[0], plan[1] + RIM],
    [plan[0], plan[1] - RIM],
  ];
  for (const stair of house.stairs) {
    for (const q of rim) if (pointInRect(stair.rect, q) && inside(rampHeight(house, stair, q))) return true;
  }
  return false;
}

/** Does a blocker's vertical span meet a body standing at `y`? */
export function blocksAt(bottom: number, top: number, y: number): boolean {
  return bottom < y + BODY_HEIGHT && top > y + STEP_OVER;
}

/** Push a plan point out of every blocker at height `y` (`prev`: where it came from). */
function resolve(world: PhysicsWorld, at: Vec2, y: number, prev: Vec2): Vec2 {
  let c: Vec2 = [at[0], at[1]];
  for (let it = 0; it < PUSH_ITERATIONS; it++) {
    let moved = false;
    for (const b of world.blockers) {
      if (!blocksAt(b.bottom, b.top, y)) continue;
      const next = pushOut(b, c, prev);
      if (next !== null) {
        c = next;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return c;
}

function pushOut(b: Blocker, c: Vec2, prev: Vec2): Vec2 | null {
  switch (b.kind) {
    case "segment": {
      const q = closestOnSegment(c, b.a, b.b);
      const dx = c[0] - q[0];
      const dz = c[1] - q[1];
      const d = Math.hypot(dx, dz);
      if (d >= RADIUS - EPS) return null;
      if (d > EPS) return [q[0] + (dx / d) * RADIUS, q[1] + (dz / d) * RADIUS];
      // Dead on the line: back out toward the side we came from.
      const ex = b.b[0] - b.a[0];
      const ez = b.b[1] - b.a[1];
      const el = Math.hypot(ex, ez) || 1;
      let nx = -ez / el;
      let nz = ex / el;
      if ((prev[0] - q[0]) * nx + (prev[1] - q[1]) * nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      return [q[0] + nx * RADIUS, q[1] + nz * RADIUS];
    }
    case "disc": {
      const dx = c[0] - b.c[0];
      const dz = c[1] - b.c[1];
      const d = Math.hypot(dx, dz);
      const min = b.r + RADIUS;
      if (d >= min - EPS) return null;
      if (d > EPS) return [b.c[0] + (dx / d) * min, b.c[1] + (dz / d) * min];
      const px = prev[0] - b.c[0];
      const pz = prev[1] - b.c[1];
      const pl = Math.hypot(px, pz) || 1;
      return [b.c[0] + (px / pl) * min, b.c[1] + (pz / pl) * min];
    }
    case "box": {
      // Into the box's frame (inverse of the prop's yaw about +y).
      const rx = c[0] - b.c[0];
      const rz = c[1] - b.c[1];
      const lx = rx * b.cos - rz * b.sin;
      const lz = rx * b.sin + rz * b.cos;
      const qx = Math.max(-b.hw, Math.min(b.hw, lx));
      const qz = Math.max(-b.hd, Math.min(b.hd, lz));
      let ox: number;
      let oz: number;
      const dx = lx - qx;
      const dz = lz - qz;
      const d = Math.hypot(dx, dz);
      if (d > EPS) {
        if (d >= RADIUS - EPS) return null;
        ox = qx + (dx / d) * RADIUS;
        oz = qz + (dz / d) * RADIUS;
      } else {
        // Inside: out through the nearest face.
        const pen = [b.hw - lx, b.hw + lx, b.hd - lz, b.hd + lz];
        const i = pen.indexOf(Math.min(...pen));
        ox = i === 0 ? b.hw + RADIUS : i === 1 ? -b.hw - RADIUS : lx;
        oz = i === 2 ? b.hd + RADIUS : i === 3 ? -b.hd - RADIUS : lz;
      }
      // Back to the house frame.
      return [b.c[0] + ox * b.cos + oz * b.sin, b.c[1] - ox * b.sin + oz * b.cos];
    }
  }
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const len2 = ex * ex + ez * ez;
  if (len2 < EPS) return [a[0], a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / len2));
  return [a[0] + ex * t, a[1] + ez * t];
}

function clamp1(v: number): number {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}

function wrap(yaw: number): number {
  return ((((yaw + 180) % 360) + 360) % 360) - 180 + 0;
}
