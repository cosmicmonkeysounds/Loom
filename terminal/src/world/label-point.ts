//! A point well inside a room — the same rule as `@loom/house/three`'s
//! `labelPoint`, kept here so the director and the mini-map maths stay free
//! of three.js (the subpath's index pulls in the whole renderer, and the
//! shadow view imports the director's window pose without it).

import { distanceToBoundary, pointInPolyStrict, polyBounds, type Vec2 } from "@loom/house";

/**
 * The bounds' centre when it is inside the room, else the most interior
 * point of an 11 × 11 grid over the bounds (an L-shaped room's centre can be
 * outside it).
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
      if (d > bestD + (bestD < 0 ? 0 : 0.25)) {
        best = p;
        bestD = d;
      }
    }
  }
  return best;
}
