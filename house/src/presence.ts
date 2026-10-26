//! Presence (wave 26, R5) — which room a reinstalled player counts as being
//! in, for the terminals' link to the Internet: a terminal shows the world,
//! sends its camera and is heard (and hears) only while a player is in its
//! spot's room. The raw room is `locate`'s; `presenceRoom` adds a doorway
//! hysteresis so a player standing in a door never flaps between rooms —
//! held only at the door (or the stair) that joins the two rooms, never
//! through a solid wall.
//! The server keeps one `prev` per session (`SpatialHub`), the voice rule
//! (`hearsTerminals` / `hearsPlayers`) is fed the presence room, and
//! `linkedSpots` names the terminals linked now. Pure; the GDScript port is
//! in `reinstall/vr/house/house_locate.gd`, pinned by `<map>.presence.json`.

import { distanceToSegment, doorGap, pointInPoly, pointInRect, roomById, wallEnds } from "./geometry.ts";
import { locate } from "./locate.ts";
import type { HouseMap, Vec2, Vec3 } from "./types.ts";

/** A player within this (plan metres) of the door gap they came through stays in the room behind it. */
export const PRESENCE_HYSTERESIS_M = 0.75;
/** A client may keep a terminal linked this long after its room empties (a latch; the server never lingers). */
export const PRESENCE_LINGER_MS = 3000;

/**
 * The room a player counts as being in: `locate(p).room`, except that the
 * player stays in `prev` (a doorway hysteresis) while
 * - they are still inside `prev`'s polygon (boundary counts) on its floor;
 * - or `prev` and the new room (null: outside) are joined by a door on
 *   that floor and they are within `PRESENCE_HYSTERESIS_M` (plan) of its
 *   gap (`doorGap`) — a player beside the shared wall away from the door
 *   is in the room they stand in, never held through the wall;
 * - or `prev` and the new room are joined by a stair and they are over its
 *   rect (the ramp switches rooms at half height; they keep `prev` until
 *   they step off it).
 * Null when `locate` says no room and no door holds them. Pure; the caller
 * keeps `prev` (null on a first pose, a re-seat or a map swap).
 */
export function presenceRoom(house: HouseMap, p: Vec3, prev: string | null): string | null {
  const at = locate(house, p);
  if (prev === null || at.room === prev) return at.room;
  const room = roomById(house, prev);
  if (room === undefined) return at.room;
  const plan: Vec2 = [p[0], p[2]];
  if (room.floor === at.floor) {
    if (pointInPoly(room.poly, plan)) return prev;
    for (const door of house.doors) {
      if (!joins(door.a, door.b, prev, at.room)) continue;
      const gap = doorGap(house, door);
      if (gap === null || gap.floor !== room.floor) continue;
      const [a, b] = wallEnds(gap);
      if (distanceToSegment(plan, a, b) <= PRESENCE_HYSTERESIS_M) return prev;
    }
  }
  if (at.room !== null) {
    for (const stair of house.stairs) {
      if (joins(stair.from, stair.to, prev, at.room) && pointInRect(stair.rect, plan)) return prev;
    }
  }
  return at.room;
}

/** Does the link `a`–`b` join `prev` and `room`, either way round? */
function joins(a: string, b: string | null, prev: string, room: string | null): boolean {
  return (a === prev && b === room) || (b === prev && a === room);
}

/**
 * The map terminal ids whose `room` holds at least one of `rooms` (nulls
 * ignored), in map order — never a `view: "reinstall"` terminal (the tent
 * station: every walk starts in its room, and it is never linked, T3).
 */
export function linkedSpots(house: HouseMap, rooms: Iterable<string | null>): Set<string> {
  const occupied = new Set<string>();
  for (const r of rooms) if (r !== null) occupied.add(r);
  const out = new Set<string>();
  for (const t of house.terminals) {
    if (t.view === "reinstall") continue;
    if (occupied.has(t.room)) out.add(t.id);
  }
  return out;
}
