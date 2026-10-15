//! Where is a point? — `docs/loom-reinstall.md` §1.2 "Locate". The server
//! labels every pose with `locate`; the games stand on `heightAt`.

import { floorById, inPropFootprint, pointInPoly, pointInRect, pointInRectStrict, propSolid, rampHeight, roomById, stairLevels } from "./geometry.ts";
import type { HouseMap, Located, Prop, Room, Vec2, Vec3 } from "./types.ts";

/** How far below a floor's elevation a point still counts as on it. */
export const FLOOR_SLACK = 0.5;
/** The highest step up `heightAt` accepts above the hint. */
export const STEP_UP = 0.45;
/** How tall a standing player is, for the solid-prop checks (`solidPropAt`). */
export const BODY_CLEAR = 1.7;
/** How far into a prop's top a thing resting on it may sit. */
export const PROP_REST = 0.01;
/** A solid prop whose top clears the feet by less than this is stepped
 *  over, not stood in (the games' `STEP_OVER`) — `standable`'s rest. */
export const PROP_STEP_OVER = 0.05;

/** The highest floor whose elevation ≤ `y + 0.5`, else the lowest (ties: first in array order). */
export function floorOf(house: HouseMap, y: number): string {
  let best: { id: string; elevation: number } | null = null;
  for (const f of house.floors) {
    if (f.elevation > y + FLOOR_SLACK) continue;
    if (!best || f.elevation > best.elevation) best = f;
  }
  if (best) return best.id;
  let lowest = house.floors[0];
  for (const f of house.floors) if (lowest && f.elevation < lowest.elevation) lowest = f;
  return lowest?.id ?? "";
}

/** The room on `floor` whose polygon contains the point (boundary counts; first in array order). */
export function roomAt(house: HouseMap, p: Vec2, floor: string): Room | null {
  for (const room of house.rooms) {
    if (room.floor === floor && pointInPoly(room.poly, p)) return room;
  }
  return null;
}

/**
 * The floor and room of a point. Over a stair rect (and on one of its two
 * floors by `floorOf`), the point is in the stair's `from` room when its y
 * is strictly nearer the lower elevation, else in `to`.
 */
export function locate(house: HouseMap, p: Vec3): Located {
  const plan: Vec2 = [p[0], p[2]];
  const floor = floorOf(house, p[1]);
  for (const stair of house.stairs) {
    if (!pointInRect(stair.rect, plan)) continue;
    const from = roomById(house, stair.from);
    const to = roomById(house, stair.to);
    if (!from || !to) continue;
    if (floor !== from.floor && floor !== to.floor) continue;
    const { low, high } = stairLevels(house, stair);
    return Math.abs(p[1] - low) < Math.abs(p[1] - high)
      ? { floor: from.floor, room: from.id }
      : { floor: to.floor, room: to.id };
  }
  return { floor, room: roomAt(house, plan, floor)?.id ?? null };
}

/**
 * Every surface under a plan point: each room floor containing it, unless
 * the point is strictly inside a stair hole in it (the hole is the open
 * rect), and each ramp whose rect contains it (boundary counts).
 */
export function surfacesAt(house: HouseMap, p: Vec2): number[] {
  const out: number[] = [];
  for (const room of house.rooms) {
    if (!pointInPoly(room.poly, p)) continue;
    if (house.stairs.some((s) => s.to === room.id && pointInRectStrict(s.rect, p))) continue;
    out.push(floorById(house, room.floor)?.elevation ?? 0);
  }
  for (const stair of house.stairs) {
    if (pointInRect(stair.rect, p)) out.push(rampHeight(house, stair, p));
  }
  return out;
}

/**
 * The surface to stand on: the highest candidate ≤ `yHint + 0.45`, else the
 * lowest candidate, else `null` (nothing under the point).
 */
export function heightAt(house: HouseMap, p: Vec2, yHint: number): number | null {
  const candidates = surfacesAt(house, p);
  let best: number | null = null;
  let lowest: number | null = null;
  for (const h of candidates) {
    if (h <= yHint + STEP_UP && (best === null || h > best)) best = h;
    if (lowest === null || h < lowest) lowest = h;
  }
  return best ?? lowest;
}

/**
 * The solid prop a thing `clear` metres tall with its base at `p` would be
 * buried in (first in array order), else null. Resting on a prop's top (to
 * within `rest`) is fine. The spawn / spot rule of `validateHouse`, and
 * half of `standable` (which steps over `PROP_STEP_OVER`, like the games).
 */
export function solidPropAt(house: HouseMap, p: Vec3, clear = BODY_CLEAR, rest = PROP_REST): Prop | null {
  const plan: Vec2 = [p[0], p[2]];
  const y = p[1];
  return house.props.find((q) => propSolid(q) && y < q.pos[1] + q.size[1] - rest && y + clear > q.pos[1] && inPropFootprint(q, plan)) ?? null;
}

/**
 * Could a player stand with their feet at `p`? In a room (`locate`), over a
 * surface (`heightAt`), and not buried in a solid prop (`solidPropAt`). A
 * remap — a director's save, the tent ↔ shed switch — keeps every live
 * player where they stand; one who isn't standable on the new map (the
 * shed is a solid prop on the tent map) is put back at its spawn, by the
 * games and the server alike (`docs/loom-reinstall.md` §1.3).
 */
export function standable(house: HouseMap, p: Vec3): boolean {
  if (locate(house, p).room === null) return false;
  if (heightAt(house, [p[0], p[2]], p[1]) === null) return false;
  return solidPropAt(house, p, BODY_CLEAR, PROP_STEP_OVER) === null;
}
