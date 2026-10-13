//! The map page's plan geometry — pure. The SVG plan uses house plan
//! coordinates directly: SVG `x` = house `x` (east →), SVG `y` = house `z`
//! (south ↓), so north is up and a metre is one user unit. Seen from above,
//! a house yaw is counter-clockwise on screen.

import { DEFAULT_SPOT_FOV, distanceToBoundary, fnv1a32, floorById, forward, horizontalFov, pointInPoly, polyBounds, roomById } from "@loom/house";
import type { HouseMap, Prop, Room, Stair, TerminalSpot, Vec2 } from "@loom/house";

export type Bounds = [number, number, number, number];

/** The plan extent of every room (all floors, so tabs share one frame). */
export function planBounds(house: HouseMap): Bounds {
  let b: Bounds | null = null;
  for (const r of house.rooms) {
    if (r.poly.length === 0) continue;
    const [x0, z0, x1, z1] = polyBounds(r.poly);
    b = b === null ? [x0, z0, x1, z1] : [Math.min(b[0], x0), Math.min(b[1], z0), Math.max(b[2], x1), Math.max(b[3], z1)];
  }
  return b ?? [-5, -5, 5, 5];
}

/** An SVG `viewBox` `[x, y, w, h]` around bounds, with a margin. */
export function viewBoxOf(b: Bounds, margin = 1): [number, number, number, number] {
  return [b[0] - margin, b[1] - margin, b[2] - b[0] + 2 * margin, b[3] - b[1] + 2 * margin];
}

/**
 * A client point → plan, for an `<svg>` laid out in `rect` showing
 * `viewBox` with the default `preserveAspectRatio="xMidYMid meet"`.
 */
export function clientToPlan(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, viewBox: readonly [number, number, number, number]): Vec2 {
  const [vx, vy, vw, vh] = viewBox;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const ox = rect.left + (rect.width - vw * scale) / 2;
  const oy = rect.top + (rect.height - vh * scale) / 2;
  return [vx + (clientX - ox) / scale, vy + (clientY - oy) / scale];
}

/** Snap to a grid step (default 5 cm), without float dust. */
export function snap(v: number, step = 0.05): number {
  const s = Math.round(v / step) * step;
  return Number(s.toFixed(6)) + 0;
}

export function snap2(p: Vec2, step = 0.05): Vec2 {
  return [snap(p[0], step), snap(p[1], step)];
}

/** A plan point well inside a polygon for its label: the centroid when it
 *  is inside, else the grid point farthest from the boundary. */
export function labelSpot(poly: Vec2[]): Vec2 {
  if (poly.length === 0) return [0, 0];
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const cross = p[0] * q[1] - q[0] * p[1];
    a += cross;
    cx += (p[0] + q[0]) * cross;
    cz += (p[1] + q[1]) * cross;
  }
  if (Math.abs(a) > 1e-9) {
    const c: Vec2 = [cx / (3 * a), cz / (3 * a)];
    if (pointInPoly(poly, c) && distanceToBoundary(poly, c) > 0.3) return c;
  }
  const [x0, z0, x1, z1] = polyBounds(poly);
  const step = Math.max(0.1, Math.min(x1 - x0, z1 - z0) / 12);
  let best: Vec2 = poly[0]!;
  let bestD = -1;
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let z = z0 + step / 2; z < z1; z += step) {
      const p: Vec2 = [x, z];
      if (!pointInPoly(poly, p)) continue;
      const d = distanceToBoundary(poly, p);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

/** A plan point at `dist` metres along a yaw's heading. */
export function along(p: Vec2, yaw: number, dist: number): Vec2 {
  const f = forward(yaw);
  return [p[0] + f[0] * dist, p[1] + f[2] * dist];
}

/**
 * A terminal's view cone on the plan: apex at the spot, `range` metres
 * deep, as wide as the wall tablet actually sees (the spot's vertical fov
 * — `TerminalSpot.fov`, unset = `DEFAULT_SPOT_FOV` — widened to the
 * tablet's landscape aspect by `horizontalFov`, both from `@loom/house`).
 */
export function viewCone(t: Pick<TerminalSpot, "pos" | "yaw" | "fov">, range = 2.5): Vec2[] {
  const fov = horizontalFov(t.fov ?? DEFAULT_SPOT_FOV);
  const apex: Vec2 = [t.pos[0], t.pos[2]];
  const pts: Vec2[] = [apex];
  const n = 8;
  for (let i = 0; i <= n; i++) pts.push(along(apex, t.yaw - fov / 2 + (fov * i) / n, range));
  return pts;
}

/** A prop's footprint corners (yaw applied like the scene builder / physics). */
export function propCorners(prop: Pick<Prop, "pos" | "size" | "yaw">): Vec2[] {
  const hw = prop.size[0] / 2;
  const hd = prop.size[2] / 2;
  const r = ((prop.yaw ?? 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const local: Vec2[] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return local.map(([x, z]) => [prop.pos[0] + x * c + z * s, prop.pos[2] - x * s + z * c]);
}

/** A stair's arrow on the plan: from the foot edge's middle to the head's. */
export function stairArrow(stair: Stair): { from: Vec2; to: Vec2 } {
  const [x0, z0, x1, z1] = stair.rect;
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  switch (stair.up) {
    case "n":
      return { from: [mx, z1], to: [mx, z0] };
    case "s":
      return { from: [mx, z0], to: [mx, z1] };
    case "e":
      return { from: [x0, mz], to: [x1, mz] };
    case "w":
      return { from: [x1, mz], to: [x0, mz] };
  }
}

/** The floor a room is on ("" for an unknown room). */
export function floorOfRoom(house: HouseMap, roomId: string): string {
  return roomById(house, roomId)?.floor ?? "";
}

/** A floor's label for tabs (its id when unknown). */
export function floorLabel(house: HouseMap, floorId: string): string {
  return floorById(house, floorId)?.label ?? floorId;
}

/** An SVG `points` attribute. */
export function pointsAttr(pts: readonly Vec2[]): string {
  return pts.map((p) => `${round(p[0])},${round(p[1])}`).join(" ");
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** `[x0, z0, x1, z1]` when the polygon is an axis-aligned rectangle (4 vertices). */
export function rectOf(poly: readonly Vec2[]): Bounds | null {
  if (poly.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % 4]!;
    if (p[0] !== q[0] && p[1] !== q[1]) return null;
  }
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  const b: Bounds = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
  if (b[2] - b[0] <= 0 || b[3] - b[1] <= 0) return null;
  // Exactly the four corners.
  const corners = new Set(poly.map((p) => `${p[0]},${p[1]}`));
  return corners.size === 4 && [`${b[0]},${b[1]}`, `${b[2]},${b[1]}`, `${b[2]},${b[3]}`, `${b[0]},${b[3]}`].every((k) => corners.has(k)) ? b : null;
}

export type Edge = "n" | "s" | "e" | "w";

/** Which edge of a rectangular room a plan point is on (within `tol`), if any. */
export function hitRectEdge(room: Pick<Room, "poly">, p: Vec2, tol: number): Edge | null {
  const r = rectOf(room.poly);
  if (r === null) return null;
  const [x0, z0, x1, z1] = r;
  const inX = p[0] >= x0 - tol && p[0] <= x1 + tol;
  const inZ = p[1] >= z0 - tol && p[1] <= z1 + tol;
  const cands: Array<[Edge, number]> = [];
  if (inX) cands.push(["n", Math.abs(p[1] - z0)], ["s", Math.abs(p[1] - z1)]);
  if (inZ) cands.push(["w", Math.abs(p[0] - x0)], ["e", Math.abs(p[0] - x1)]);
  let best: [Edge, number] | null = null;
  for (const c of cands) if (c[1] <= tol && (best === null || c[1] < best[1])) best = c;
  return best?.[0] ?? null;
}

/** The topmost room on a floor under a plan point (last drawn wins). */
export function roomUnder(house: HouseMap, floor: string, p: Vec2): Room | null {
  let hit: Room | null = null;
  for (const r of house.rooms) if (r.floor === floor && pointInPoly(r.poly, p)) hit = r;
  return hit;
}

/** A fixed palette for rooms without a colour (by index). */
export const ROOM_TINTS = ["#c0c0c0", "#b8d8d8", "#d8d0b0", "#c8c0e0", "#b0d0b0", "#e0c0c0", "#c0d0e8", "#e0d8b8"] as const;

/** A player's colour — the same hue as their ghost in the games
 *  (`avatarColor` in `@loom/house/three`: HSL(h, 75 %, 62 %)). */
export function playerColor(seed: string): string {
  return `hsl(${fnv1a32(seed) % 360} 75% 62%)`;
}
