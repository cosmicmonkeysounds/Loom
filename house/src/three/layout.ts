//! Pure placement maths behind the three.js builder — no three here, so it
//! is tested directly: wall boxes (the rendering-only thickness, with ends
//! extended into the perpendicular walls they meet so corners close), the
//! chevron trail (anchored at the duck so chevrons stand still while the
//! player walks), and a label point inside any rectilinear room.

import { distanceToBoundary, mmi, pointInPolyStrict, polyBounds } from "../geometry.ts";
import { wrapYaw } from "../frames.ts";
import { pathLength, sampleTrail } from "../route.ts";
import type { Vec2, Vec3, WallKind, WallSegment } from "../types.ts";

/** An axis-aligned box: centre + full size, house frame. */
export interface WallBox {
  center: Vec3;
  size: Vec3;
  kind: WallKind;
}

/** Fence boards are thinner than walls; rails are a bar. */
export function wallKindThickness(kind: WallKind, wallThickness: number): number {
  if (kind === "fence") return Math.min(wallThickness, 0.06);
  if (kind === "rail") return 0.05;
  return wallThickness;
}

/** Which kinds close a corner together: walls with fences, rails with rails. */
function joins(a: WallKind, b: WallKind): boolean {
  const solid = (k: WallKind) => k === "wall" || k === "fence";
  return (solid(a) && solid(b)) || (a === "rail" && b === "rail");
}

/**
 * One box per segment (same order). An end that meets a perpendicular
 * segment of a joining kind (overlapping in y) is extended by that
 * segment's half thickness, so an L corner has no notch; a door gap's
 * jambs are never widened (nothing perpendicular meets them).
 */
export function wallBoxes(walls: readonly WallSegment[], wallThickness: number): WallBox[] {
  return walls.map((w) => {
    const t = wallKindThickness(w.kind, wallThickness);
    const reach = (end: number): number => {
      let best = 0;
      const e = mmi(end);
      for (const o of walls) {
        if (o === w || o.floor !== w.floor || o.axis === w.axis || !joins(w.kind, o.kind)) continue;
        if (o.top <= w.bottom || o.bottom >= w.top) continue;
        // `o` is perpendicular: it sits at o.c along w's run, spans [lo, hi] across it.
        if (mmi(o.c) !== e) continue;
        if (mmi(o.lo) > mmi(w.c) || mmi(o.hi) < mmi(w.c)) continue;
        best = Math.max(best, wallKindThickness(o.kind, wallThickness) / 2);
      }
      return best;
    };
    const lo = w.lo - reach(w.lo);
    const hi = w.hi + reach(w.hi);
    const len = Math.max(hi - lo, 0.001);
    const mid = (lo + hi) / 2;
    const h = Math.max(w.top - w.bottom, 0.001);
    const y = (w.bottom + w.top) / 2;
    return w.axis === "x"
      ? { center: [mid, y, w.c], size: [len, h, t], kind: w.kind }
      : { center: [w.c, y, mid], size: [t, h, len], kind: w.kind };
  });
}

/** A chevron: where it sits and the yaw of the way to walk. */
export interface TrailPoint {
  p: Vec3;
  yaw: number;
}

/**
 * Chevron positions every `step` metres along a route, in walking order,
 * each with the heading of its leg. Sampled **from the end** (the duck), so
 * as the route's start follows the player the chevrons ahead do not move;
 * the ones closer than `skipStart` to the start (underfoot) are dropped,
 * and none sits on the end itself.
 */
export function trailPoints(path: readonly Vec3[], step = 0.75, skipStart = 0.4): TrailPoint[] {
  if (path.length < 2 || !(step > 0)) return [];
  const total = pathLength([...path]);
  const back = sampleTrail([...path].reverse(), step);
  const out: TrailPoint[] = [];
  back.forEach((s, k) => {
    if (total - (k + 1) * step >= skipStart - 1e-9) out.push({ p: s.p, yaw: wrapYaw(s.yaw + 180) });
  });
  return out.reverse();
}

/**
 * A point well inside a room for its name label: the bounds' centre when it
 * is inside, else the most interior point of an 11 × 11 grid over the
 * bounds (an L-shaped room's centre can be outside it).
 */
export function labelPoint(poly: Vec2[]): Vec2 {
  const [x0, z0, x1, z1] = polyBounds(poly);
  const centre: Vec2 = [(x0 + x1) / 2, (z0 + z1) / 2];
  let best: Vec2 = centre;
  let bestD = pointInPolyStrict(poly, centre) ? distanceToBoundary(poly, centre) : -1;
  const n = 11;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p: Vec2 = [x0 + ((x1 - x0) * (i + 0.5)) / n, z0 + ((z1 - z0) * (j + 0.5)) / n];
      if (!pointInPolyStrict(poly, p)) continue;
      const d = distanceToBoundary(poly, p);
      // The centre wins unless a grid point is clearly deeper inside.
      if (d > bestD + (bestD < 0 ? 0 : 0.25)) {
        best = p;
        bestD = d;
      }
    }
  }
  return best;
}
