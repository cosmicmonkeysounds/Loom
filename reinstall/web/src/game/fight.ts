//! The King in the simulation — pure. He stands in the Server Room's
//! doorway with ONE health bar shared by every guest for the whole night
//! (the server's `KingState`, `docs/loom-reinstall.md` §3): each program may
//! hit him once per reinstallation visit (⚔ / Space, judged by the server on
//! its own copy of the pose — `POST /api/spatial/king/hit`). At 0 he kneels
//! for everyone and his door opens in both games; a director's restore
//! stands him back up.
//!
//! The bar over his head (`@loom/house/three` `drawBar`) is the only King
//! display (wave 26, R3): the HUD carries no meter, stage or kneeling line,
//! just the ⚔ HIT button while he is near and the passing notices. The
//! tablet only pre-checks the reach (`kingReach`, to nudge the player closer
//! before it asks) and says what the server answered. There is no chess here.

import { doorGap, floorOf, locate } from "@loom/house";
import type { HouseMap, KingReach, Prop, Vec3 } from "@loom/house";
import { RADIUS } from "./physics.ts";

// The reach rule is `@loom/house`'s, the one the server judges a hit by
// (with its slack): the tablet only pre-checks it to nudge the player
// closer before it asks. Standing on his very centre counts as facing him.
export { kingReach, KING_CONE_DEG, KING_REACH, type KingReach } from "@loom/house";

/** What the HUD says when a hit can't be asked for from here. */
export function nudgeFor(reach: Exclude<KingReach, "ok">): string {
  return reach === "facing" ? "Face him." : "Get closer to the King.";
}

/** Said (a passing notice) once this visit has hit him. A visit
 *  ends at the duck, not at Leave, a director's end or a timeout, so a
 *  re-scan before Gerald is found is still the visit that hit him. */
export const HIT_USED = "You hit him this reinstallation. Find Gerald before you hit him again.";

/** This visit's hit is spent from the start: the server's assignment says a
 *  re-scan is the visit that already hit him (missing on an old server). */
export function hitSpentAtStart(assignment: { kingHit?: boolean }): boolean {
  return assignment.kingHit === true;
}

/** Within this of his doorway (or of him), a body would be caught by the leaf or his box. */
const CLEAR = RADIUS + 0.15;

/**
 * Should the King's door stay open for this player although he stands
 * again (a director's restore)? While the player is behind it (in a room on
 * the far side of a door he guards: shutting it would lock them in), or in
 * the doorway (near its gap, or inside his box grown by a body: they would
 * be stuck in the leaf or in him). Once they are clear, it shuts.
 */
export function keepDoorOpen(house: HouseMap, king: Prop, feet: Vec3): boolean {
  const room = locate(house, feet).room;
  const floor = floorOf(house, feet[1]);
  for (const door of house.doors) {
    if (door.guard !== king.id) continue;
    const behind = door.a === king.room ? door.b : door.a;
    if (room !== null && room === behind) return true;
    const gap = doorGap(house, door);
    if (gap === null || gap.floor !== floor) continue;
    const [a, b]: [[number, number], [number, number]] =
      gap.axis === "x"
        ? [
            [gap.lo, gap.c],
            [gap.hi, gap.c],
          ]
        : [
            [gap.c, gap.lo],
            [gap.c, gap.hi],
          ];
    if (segmentDistance([feet[0], feet[2]], a, b) < CLEAR) return true;
  }
  if (floorOf(house, king.pos[1]) !== floor) return false;
  // His box, in his own frame (turned by his yaw).
  const yaw = ((king.yaw ?? 0) * Math.PI) / 180;
  const dx = feet[0] - king.pos[0];
  const dz = feet[2] - king.pos[2];
  const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  return Math.abs(lx) < king.size[0] / 2 + CLEAR && Math.abs(lz) < king.size[2] / 2 + CLEAR;
}

function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const len = vx * vx + vz * vz;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / len));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vz));
}
