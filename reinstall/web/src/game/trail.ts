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
//!
//! "On" means on the ramp, not merely inside its rect: the physics lets a
//! body walk under a stair's high end, and from there `route()` (which
//! locates the feet on the stair all the same) heads along the underside
//! into the solid. A player under a ramp first steps back out of the rect
//! by its nearest open side, then follows the route from there.

import { STEP_UP, floorOf, locate, pathLength, pointInRect, portals, rampHeight, roomById, route } from "@loom/house";
import type { Door, HouseMap, Stair, Vec3 } from "@loom/house";
import { RADIUS } from "./physics.ts";

/** How far past a stair's side the step out from under it lands (clear of the side by more than a body). */
const OUT = RADIUS + 0.1;
/** Within this of a side (a body rubbing it), the step out isn't done yet: `route()` from there grazes the solid. */
const RUB = RADIUS + 0.05;

/** The stair whose ramp the feet stand on (within a step of its surface, rect boundary counting), the nearest one if two overlap in plan. */
export function stairUnder(house: HouseMap, feet: Vec3): Stair | null {
  let best: Stair | null = null;
  let bestDy = Infinity;
  for (const s of house.stairs) {
    if (!pointInRect(s.rect, [feet[0], feet[2]])) continue;
    const dy = Math.abs(feet[1] - rampHeight(house, s, [feet[0], feet[2]]));
    if (dy <= STEP_UP && dy < bestDy) {
      best = s;
      bestDy = dy;
    }
  }
  return best;
}

/**
 * The stair the feet stand beneath: on its lower floor, inside its rect in
 * plan (or rubbing one of the two sides along the flight), well below its
 * ramp.
 */
export function stairAbove(house: HouseMap, feet: Vec3): Stair | null {
  const floor = floorOf(house, feet[1]);
  for (const s of house.stairs) {
    if (roomById(house, s.from)?.floor !== floor) continue;
    const [x0, z0, x1, z1] = s.rect;
    const along = s.up === "n" || s.up === "s";
    const rect: [number, number, number, number] = along ? [x0 - RUB, z0, x1 + RUB, z1] : [x0, z0 - RUB, x1, z1 + RUB];
    if (!pointInRect(rect, [feet[0], feet[2]])) continue;
    if (rampHeight(house, s, [feet[0], feet[2]]) > feet[1] + STEP_UP) return s;
  }
  return null;
}

/**
 * Where a body under `stair` steps out to: straight out of the nearer of
 * the rect's two sides along the flight, else (both against a wall) out of
 * its high end. Only a point in the stair's own lower room counts (that
 * room holds the whole rect, so no wall stands between; a point past one
 * is in another room). Never the foot: the ramp meets the floor there. A
 * side first, even when the head is nearer: from just past the head,
 * `route()` (whose stair obstacle is shrunk so the ends see out) may cut
 * back under the ramp to where it is too low to stand.
 */
export function stepOut(house: HouseMap, stair: Stair, feet: Vec3): Vec3 | null {
  const [x0, z0, x1, z1] = stair.rect;
  const [x, y, z] = feet;
  const along = stair.up === "n" || stair.up === "s";
  const sides: Vec3[] = along ? [[x0 - OUT, y, z], [x1 + OUT, y, z]] : [[x, y, z0 - OUT], [x, y, z1 + OUT]];
  const head: Vec3 =
    stair.up === "n" ? [x, y, z0 - OUT] : stair.up === "s" ? [x, y, z1 + OUT] : stair.up === "e" ? [x1 + OUT, y, z] : [x0 - OUT, y, z];
  const open = (p: Vec3): boolean => locate(house, p).room === stair.from;
  const [a, b] = sides as [Vec3, Vec3];
  const near = Math.hypot(a[0] - x, a[2] - z) <= Math.hypot(b[0] - x, b[2] - z) ? [a, b] : [b, a];
  return [...near, head].find(open) ?? null;
}

/**
 * The map the trail routes over. `route()` keeps every guarded door shut
 * (no portal through it), but once the King has fallen the player can walk
 * through his door, and from behind it (the Server Room's only door) every
 * route would be the straight no-path line through a wall. So after the
 * fall his doors lose their guard and his prop stops being an obstacle,
 * as the physics drops it (`physicsOptions`). Standing, the map as it is.
 */
export function trailMap(house: HouseMap, king: string | null, fallen: boolean): HouseMap {
  if (king === null || !fallen) return house;
  const open = (d: Door): Door => {
    if (d.guard !== king) return d;
    const { guard: _guard, ...rest } = d;
    return rest;
  };
  return { ...house, doors: house.doors.map(open), props: house.props.filter((p) => p.id !== king) };
}

/** The route from the player's feet to the duck, made walkable on (and under) stairs (above). */
export function trail(house: HouseMap, feet: Vec3, duck: Vec3): Vec3[] {
  const stair = stairUnder(house, feet);
  if (stair === null) {
    const over = stairAbove(house, feet);
    const out = over === null ? null : stepOut(house, over, feet);
    if (out === null) return route(house, feet, duck);
    return [feet, out, ...route(house, out, duck).slice(1)];
  }
  // Gerald on the very same flight: nothing better than the plain route.
  if (pointInRect(stair.rect, [duck[0], duck[2]])) return route(house, feet, duck);
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
