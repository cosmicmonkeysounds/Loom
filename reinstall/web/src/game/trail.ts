//! The golden trail the player follows — pure. Off a stair it is exactly
//! `route()` (§1.2, the normative one every port shares). On a stair it is
//! not: `route()` locates a point on the ramp in one of the stair's two
//! rooms and starts from there, so a player who has just stepped onto the
//! foot is told to turn back to it (the foot is a node of the lower room,
//! 0.2 m behind them), and past the half-way mark the ramp's own obstacle is
//! skipped (it holds the start) so the first leg can run straight through
//! the rails. A walker following either gets stuck on every stair.
//!
//! So a player on a stair leaves it by one of its two ends: the trail is
//! `[feet, end, …route(end, duck)]` for whichever end makes the whole walk
//! shorter. The pip and the chevrons then point up (or down) the flight.

import { floorOf, pathLength, pointInRect, portals, route, roomById } from "@loom/house";
import type { HouseMap, Stair, Vec3 } from "@loom/house";

/** The stair whose rect (boundary counting) the feet stand on, on one of its two floors. */
export function stairUnder(house: HouseMap, feet: Vec3): Stair | null {
  if (house.stairs.length === 0) return null;
  const floor = floorOf(house, feet[1]);
  for (const s of house.stairs) {
    if (!pointInRect(s.rect, [feet[0], feet[2]])) continue;
    const lo = roomById(house, s.from)?.floor;
    const hi = roomById(house, s.to)?.floor;
    if (floor === lo || floor === hi) return s;
  }
  return null;
}

/** The route from the player's feet to the duck, made walkable on stairs (above). */
export function trail(house: HouseMap, feet: Vec3, duck: Vec3): Vec3[] {
  const stair = stairUnder(house, feet);
  // Gerald on the very same flight: nothing better than the plain route.
  if (stair === null || pointInRect(stair.rect, [duck[0], duck[2]])) return route(house, feet, duck);
  let best: Vec3[] | null = null;
  let bestLength = Infinity;
  for (const end of portals(house)) {
    if (end.kind === "door" || end.id !== stair.id) continue;
    const rest = route(house, end.pos, duck);
    const walk: Vec3[] = [feet, end.pos, ...rest.slice(1)];
    const length = pathLength(walk);
    if (length < bestLength) {
      best = walk;
      bestLength = length;
    }
  }
  return best ?? route(house, feet, duck);
}
