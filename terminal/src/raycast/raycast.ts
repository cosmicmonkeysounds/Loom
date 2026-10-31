//! The raycast view's pure maths (wave 16): a "simple recreation of the
//! game" for a tablet with no WebGL2 — the classic raycaster, one ray per
//! column of a small canvas, over the same `@loom/house` walls the games
//! collide with (`buildWalls`: axis-aligned segments in metres, door gaps
//! already cut, lintels over the doors), drawn **from the terminal's own
//! spot** as a fixed window into the virtual copy of its room (the
//! "second person": you watch the players from where the tablet hangs),
//! or — a terminal with no spot on the map — over the shoulder of the most
//! recently active player.
//!
//! Plain `@loom/house` only (never `@loom/house/three`): three.js stays out
//! of this chunk.
//!
//! Frames: house metres, Y up, `+z` south, yaw 0 = north (`-z`), positive
//! yaw turns left (`forward()`). Screen: x right, y down, in internal pixels.

import { DEFAULT_SPOT_FOV, floorOf, horizontalFov, pointInPoly, roomById, styleOf, type HouseMap, type TerminalSpot, type Vec2, type Vec3, type WallSegment } from "@loom/house";

/** A placed terminal looks a little down, like the world view's mount (`director.ts` `MOUNT_PITCH`). */
export const MOUNT_PITCH = -8;
/** The follow camera: behind, above the feet, its vertical fov (metres / degrees). */
export const CHASE_BACK = 2.4;
export const CHASE_HEIGHT = 1.95;
export const CHASE_PITCH = -12;
export const FOLLOW_FOV = 65;
/** Out of a program's eyes, the world view's (`director.ts` `EYE_HEIGHT`, `EYES_FOV`, `EYES_SMOOTH`). */
export const EYE_HEIGHT = 1.6;
export const EYES_FOV = 70;
export const EYES_SMOOTH = 10;
/** Rays start this far out (metres): a wall the camera hangs on is never drawn. */
export const NEAR = 0.05;
/** Pulled in this far short of a wall the chase camera would sit behind (metres). */
const WALL_MARGIN = 0.25;
const MIN_PULL = 0.35;

export interface RayCamera {
  /** The eye (metres). */
  pos: Vec3;
  yaw: number;
  pitch: number;
  /** Vertical field of view, degrees. */
  fov: number;
  /** The floor drawn: the spot's, or the followed player's. */
  floor: string;
}

// --- the camera ---------------------------------------------------------------

/** A placed terminal's fixed window: its spot's pose (pitch default `MOUNT_PITCH`, fov default `DEFAULT_SPOT_FOV`). */
export function spotCamera(house: HouseMap, spot: TerminalSpot): RayCamera {
  const floor = roomById(house, spot.room)?.floor ?? floorOf(house, spot.pos[1]);
  return { pos: [spot.pos[0], spot.pos[1], spot.pos[2]], yaw: spot.yaw, pitch: spot.pitch ?? MOUNT_PITCH, fov: spot.fov ?? DEFAULT_SPOT_FOV, floor };
}

/** The plan direction a yaw faces, `[dx, dz]`. */
export function dirOf(yaw: number): Vec2 {
  const a = (yaw * Math.PI) / 180;
  return [-Math.sin(a), -Math.cos(a)];
}

/** The plan direction to the right of a yaw. */
export function rightOf(yaw: number): Vec2 {
  const a = (yaw * Math.PI) / 180;
  return [Math.cos(a), -Math.sin(a)];
}

/**
 * The follow camera behind a player (feet `p`, facing `yaw`), pulled in
 * short of the first wall between their head and it so it never looks
 * through a wall from behind.
 */
export function chaseCamera(walls: readonly WallSegment[], floor: string, p: Vec3, yaw: number): RayCamera {
  const [fx, fz] = dirOf(yaw);
  let back = CHASE_BACK;
  const hit = nearestHit(walls, floor, p[1] + 1.5, p[0], p[2], -fx, -fz, back + WALL_MARGIN);
  if (hit !== null) back = Math.max(MIN_PULL, hit - WALL_MARGIN);
  return { pos: [p[0] - fx * back, p[1] + CHASE_HEIGHT, p[2] - fz * back], yaw, pitch: CHASE_PITCH, fov: FOLLOW_FOV, floor };
}

/** Out of a program's own eyes (feet `p`), at the games' eye height and fov. */
export function eyeCamera(floor: string, p: Vec3, yaw: number, pitch: number): RayCamera {
  return { pos: [p[0], p[1] + EYE_HEIGHT, p[2]], yaw, pitch, fov: EYES_FOV, floor };
}

function wrap(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

/** Ease a follow camera toward `target` (exponential, rate per second); a floor change is a cut. */
export function smoothCamera(cur: RayCamera | null, target: RayCamera, dt: number, rate = 3.5): RayCamera {
  if (cur === null || cur.floor !== target.floor) return target;
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  const lerp = (a: number, b: number) => a + (b - a) * k;
  return {
    pos: [lerp(cur.pos[0], target.pos[0]), lerp(cur.pos[1], target.pos[1]), lerp(cur.pos[2], target.pos[2])],
    yaw: cur.yaw + wrap(target.yaw - cur.yaw) * k,
    pitch: lerp(cur.pitch, target.pitch),
    fov: lerp(cur.fov, target.fov),
    floor: target.floor,
  };
}

/** The horizontal fov (degrees) a vertical fov gives on a `w × h` screen. */
export function hfovOf(vfov: number, w: number, h: number): number {
  return horizontalFov(vfov, w / Math.max(1, h));
}

/** Focal length in pixels for a vertical fov over `h` rows. */
export function focalOf(vfov: number, h: number): number {
  return h / 2 / Math.tan((vfov * Math.PI) / 360);
}

/** The horizon row: the screen centre, moved up when the camera looks down. */
export function horizonOf(pitch: number, h: number, focal: number): number {
  return h / 2 + focal * Math.tan((pitch * Math.PI) / 180);
}

/** The screen row of world height `y` at depth `depth`. */
export function rowOf(y: number, eyeY: number, depth: number, horizon: number, focal: number): number {
  return horizon - ((y - eyeY) / depth) * focal;
}

// --- walls --------------------------------------------------------------------

/** A wall the rays test, with the colour of the room on each side (in pieces along it). */
export interface RayWall {
  axis: "x" | "z";
  c: number;
  lo: number;
  hi: number;
  bottom: number;
  top: number;
  kind: WallSegment["kind"];
  /** Opaque: hides what is behind it (a wall or a lintel; never a rail or fence). */
  solid: boolean;
  /** Room colour per `PIECE` metres along the wall: on the low-coordinate side, the high side. */
  low: string[];
  high: string[];
}

export const PIECE = 0.5;
const OUTSIDE = "#3c6e3c";
const INDOOR = "#c8c8c8";

/** The walls of one floor, each with its rooms' colours (rails and fences kept: you see over them). */
export function rayWalls(house: HouseMap, walls: readonly WallSegment[], floor: string): RayWall[] {
  const rooms = house.rooms.filter((r) => r.floor === floor);
  const colourAt = (x: number, z: number): string => {
    for (const r of rooms) if (pointInPoly(r.poly, [x, z])) return r.color ?? (r.outdoor ? OUTSIDE : INDOOR);
    return OUTSIDE;
  };
  const off = Math.max(0.12, styleOf(house).wallThickness);
  const out: RayWall[] = [];
  for (const w of walls) {
    if (w.floor !== floor || w.hi - w.lo < 1e-3) continue;
    const n = Math.max(1, Math.ceil((w.hi - w.lo) / PIECE));
    const low: string[] = [];
    const high: string[] = [];
    for (let i = 0; i < n; i++) {
      const u = Math.min(w.hi, w.lo + (i + 0.5) * PIECE);
      if (w.axis === "x") {
        low.push(colourAt(u, w.c - off));
        high.push(colourAt(u, w.c + off));
      } else {
        low.push(colourAt(w.c - off, u));
        high.push(colourAt(w.c + off, u));
      }
    }
    out.push({ axis: w.axis, c: w.c, lo: w.lo, hi: w.hi, bottom: w.bottom, top: w.top, kind: w.kind, solid: w.kind === "wall" || w.kind === "lintel", low, high });
  }
  return out;
}

/**
 * Where a ray (origin `ox, oz`, direction `dx, dz`, not necessarily unit)
 * meets an axis-aligned wall: the ray parameter `t` (so with a direction
 * whose forward component is 1, `t` is the perpendicular depth) and the
 * coordinate along the wall, else null (parallel, behind, or past an end).
 */
export function hitWall(w: Pick<RayWall, "axis" | "c" | "lo" | "hi">, ox: number, oz: number, dx: number, dz: number): { t: number; u: number } | null {
  const o = w.axis === "x" ? oz : ox;
  const d = w.axis === "x" ? dz : dx;
  if (Math.abs(d) < 1e-9) return null;
  const t = (w.c - o) / d;
  if (t <= NEAR) return null;
  const u = (w.axis === "x" ? ox : oz) + t * (w.axis === "x" ? dx : dz);
  if (u < w.lo || u > w.hi) return null;
  return { t, u };
}

/** The nearest wall (standing at height `y`) along a unit ray within `max` metres, else null. */
function nearestHit(walls: readonly WallSegment[], floor: string, y: number, ox: number, oz: number, dx: number, dz: number, max: number): number | null {
  let best: number | null = null;
  for (const w of walls) {
    if (w.floor !== floor || w.kind === "lintel" || y < w.bottom || y > w.top) continue;
    const h = hitWall(w, ox, oz, dx, dz);
    if (h !== null && h.t <= max && (best === null || h.t < best)) best = h.t;
  }
  return best;
}

/** One wall slice a column draws. */
export interface ColumnHit {
  depth: number;
  wall: RayWall;
  colour: string;
  /** Shade 0–1: the wall's orientation and the fog. */
  light: number;
}

/** How far the fog reaches (metres): a wall this far is about a third lit. */
export const FOG = 14;

/** A wall's light at `depth`: walls along x (facing north / south) lit, along z darker; fog with distance. */
export function wallLight(axis: "x" | "z", depth: number): number {
  return (axis === "x" ? 1 : 0.72) * (0.25 + 0.75 * Math.exp(-depth / FOG));
}

/**
 * Cast every column. `cols[x]` holds the walls the ray meets, **far to
 * near** (draw in order: nearer walls paint over farther ones), and
 * `zbuf[x]` the depth of the nearest solid wall the eye can't see past
 * (Infinity when none) — a sprite column is drawn only nearer than it.
 */
export function castColumns(walls: readonly RayWall[], cam: RayCamera, w: number, h: number): { cols: ColumnHit[][]; zbuf: Float64Array; focal: number; horizon: number } {
  const focal = focalOf(cam.fov, h);
  const horizon = horizonOf(cam.pitch, h, focal);
  const [fx, fz] = dirOf(cam.yaw);
  const [rx, rz] = rightOf(cam.yaw);
  const ox = cam.pos[0];
  const oz = cam.pos[2];
  const eye = cam.pos[1];
  const cols: ColumnHit[][] = [];
  const zbuf = new Float64Array(w).fill(Infinity);
  // Cull: walls wholly behind the camera plane never meet a forward ray.
  const ahead = walls.filter((wl) => {
    const ax = wl.axis === "x" ? wl.lo : wl.c;
    const az = wl.axis === "x" ? wl.c : wl.lo;
    const bx = wl.axis === "x" ? wl.hi : wl.c;
    const bz = wl.axis === "x" ? wl.c : wl.hi;
    return (ax - ox) * fx + (az - oz) * fz > NEAR || (bx - ox) * fx + (bz - oz) * fz > NEAR;
  });
  for (let x = 0; x < w; x++) {
    const k = (x + 0.5 - w / 2) / focal;
    const dx = fx + rx * k;
    const dz = fz + rz * k;
    const hits: ColumnHit[] = [];
    for (const wl of ahead) {
      const hit = hitWall(wl, ox, oz, dx, dz);
      if (hit === null) continue;
      // A wall wholly off screen (above the top row, below the bottom) adds nothing.
      const top = rowOf(wl.top, eye, hit.t, horizon, focal);
      const bottom = rowOf(wl.bottom, eye, hit.t, horizon, focal);
      if (bottom < 0 || top > h) continue;
      const camLow = (wl.axis === "x" ? oz : ox) < wl.c;
      const pieces = camLow ? wl.low : wl.high;
      const colour = pieces[Math.min(pieces.length - 1, Math.max(0, Math.floor((hit.u - wl.lo) / PIECE)))] ?? INDOOR;
      hits.push({ depth: hit.t, wall: wl, colour, light: wallLight(wl.axis, hit.t) });
      // Only a wall that covers the eye line hides what is behind it.
      if (wl.solid && wl.bottom <= eye && wl.top >= eye && hit.t < zbuf[x]!) zbuf[x] = hit.t;
    }
    hits.sort((a, b) => b.depth - a.depth);
    cols.push(visibleHits(hits, zbuf[x]!, eye, horizon, focal, h));
  }
  return { cols, zbuf, focal, horizon };
}

/**
 * The hits (far to near) a column actually shows: a wall behind the nearest
 * eye-covering solid wall (at depth `occluder`) is drawn only where its rows
 * (clipped to the screen) poke out above or below that wall's — so a column
 * paints one or two slices, never every wall down the line (the old tablets
 * pay per `fillRect`).
 */
export function visibleHits(hits: readonly ColumnHit[], occluder: number, eye: number, horizon: number, focal: number, h: number): ColumnHit[] {
  if (occluder === Infinity) return [...hits];
  let a1 = 0;
  let b1 = 0;
  for (const c of hits) {
    if (Math.abs(c.depth - occluder) < 1e-9 && c.wall.solid && c.wall.bottom <= eye && c.wall.top >= eye) {
      a1 = Math.max(0, rowOf(c.wall.top, eye, c.depth, horizon, focal));
      b1 = Math.min(h, rowOf(c.wall.bottom, eye, c.depth, horizon, focal));
      break;
    }
  }
  return hits.filter((c) => {
    if (c.depth <= occluder + 1e-6) return true;
    const a2 = Math.max(0, rowOf(c.wall.top, eye, c.depth, horizon, focal));
    const b2 = Math.min(h, rowOf(c.wall.bottom, eye, c.depth, horizon, focal));
    return a2 < a1 - 0.5 || b2 > b1 + 0.5;
  });
}

/** `#rgb` / `#rrggbb` scaled by `light` (0–1) as `rgb(…)`. */
export function shade(hex: string, light: number): string {
  let s = hex.trim().replace(/^#/, "");
  if (s.length === 3) s = s.split("").map((ch) => ch + ch).join("");
  const n = Number.parseInt(s, 16);
  if (!Number.isFinite(n) || s.length !== 6) return `rgb(${Math.round(200 * light)},${Math.round(200 * light)},${Math.round(200 * light)})`;
  const k = Math.max(0, Math.min(1.2, light));
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// --- sprites ------------------------------------------------------------------

/** A billboard projected to the screen. */
export interface Projected {
  /** Perpendicular depth (metres). */
  depth: number;
  /** Centre column, and the left / right columns (may run off screen). */
  x: number;
  x0: number;
  x1: number;
  /** Top and bottom rows. */
  y0: number;
  y1: number;
}

/**
 * Project a billboard standing at plan `(px, pz)` from height `bottom` to
 * `top`, `width` metres wide; null when it is behind the camera or wholly
 * off screen sideways.
 */
export function projectSprite(cam: RayCamera, w: number, h: number, px: number, pz: number, bottom: number, top: number, width: number): Projected | null {
  const focal = focalOf(cam.fov, h);
  const horizon = horizonOf(cam.pitch, h, focal);
  const [fx, fz] = dirOf(cam.yaw);
  const [rx, rz] = rightOf(cam.yaw);
  const dx = px - cam.pos[0];
  const dz = pz - cam.pos[2];
  const depth = dx * fx + dz * fz;
  if (depth <= NEAR * 4) return null;
  const lateral = dx * rx + dz * rz;
  const x = w / 2 + (lateral / depth) * focal;
  const half = ((width / 2) * focal) / depth;
  if (x + half < 0 || x - half > w) return null;
  return { depth, x, x0: x - half, x1: x + half, y0: rowOf(top, cam.pos[1], depth, horizon, focal), y1: rowOf(bottom, cam.pos[1], depth, horizon, focal) };
}

/** The runs of columns `[start, end)` of a sprite spanning `x0…x1` that are nearer than the walls (`zbuf`). */
export function visibleRuns(x0: number, x1: number, depth: number, zbuf: ArrayLike<number>): Array<[number, number]> {
  const a = Math.max(0, Math.floor(x0));
  const b = Math.min(zbuf.length, Math.ceil(x1));
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let x = a; x < b; x++) {
    const seen = depth < zbuf[x]!;
    if (seen && start < 0) start = x;
    if (!seen && start >= 0) {
      runs.push([start, x]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, b]);
  return runs;
}

/** Far first: the order sprites are painted in. */
export function depthSorted<T extends { depth: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.depth - a.depth);
}

// --- what to look at ----------------------------------------------------------

/** The internal resolution for a `cw × ch` box: 180 rows, the box's aspect, 240–400 columns. */
export function internalSize(cw: number, ch: number, rows = 180): { w: number; h: number } {
  const aspect = cw > 0 && ch > 0 ? cw / ch : 16 / 9;
  return { w: Math.max(240, Math.min(400, Math.round(rows * aspect))), h: rows };
}

/** A player the follow camera can track. */
export interface Followable {
  session: string;
  lastActive: number;
  foundAt: number | null;
}

/** The player an unplaced terminal follows: one who just found the duck, else the most recently active. */
export function followTarget<P extends Followable>(players: Iterable<P>, now: number, celebrate = 8000): P | null {
  let best: P | null = null;
  let bestScore = -Infinity;
  for (const p of players) {
    const fresh = p.foundAt !== null && now - p.foundAt < celebrate;
    const score = (fresh ? 1e12 : 0) + p.lastActive;
    if (score > bestScore || (score === bestScore && best !== null && p.session < best.session)) [best, bestScore] = [p, score];
  }
  return best;
}
