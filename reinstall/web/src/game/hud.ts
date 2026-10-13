//! The heads-up display's arithmetic — pure: where am I (room + its story
//! location), how warm am I (the route's length to the duck, compared with
//! a moment ago), how long have I been in here, which way is north, and am
//! I there yet.

import { DUCK_MAX_RISE, floorOf, locate, roomById, wrapYaw } from "@loom/house";
import type { DuckSpot, HouseMap, Vec3 } from "@loom/house";

/** Plan distance at which the duck counts as reached (and `found` is sent). */
export const REACH = 0.9;

/**
 * The most the duck's y may sit above (or below) the feet for the server
 * to accept a find (`nearDuck` in `core/server/spatial.ts` bounds it by
 * `DUCK_MAX_RISE` from `@loom/house`, §2.1 `found`) — the same 1.2 m the
 * validator caps a spot's rise at, so the game never asks for a find the
 * server must refuse.
 */
export const FOUND_DY = DUCK_MAX_RISE;

/**
 * Close enough to the duck to call it found: within `REACH` on the plan,
 * on its floor, and no more than `FOUND_DY` below or above the feet (a duck
 * raised onto a high shelf is out of reach — the server would refuse it).
 */
export function withinReach(house: HouseMap, feet: Vec3, duck: DuckSpot): boolean {
  if (Math.hypot(feet[0] - duck.pos[0], feet[2] - duck.pos[2]) > REACH) return false;
  if (Math.abs(feet[1] - duck.pos[1]) > FOUND_DY) return false;
  return floorOf(house, feet[1]) === floorOf(house, duck.pos[1]);
}

/**
 * Standing right under the duck (within `REACH` on the plan, on its floor)
 * but it sits more than `FOUND_DY` off the feet — a map problem the player
 * can't walk out of, so the game says so.
 */
export function perchedOutOfReach(house: HouseMap, feet: Vec3, duck: DuckSpot): boolean {
  if (Math.hypot(feet[0] - duck.pos[0], feet[2] - duck.pos[2]) > REACH) return false;
  return Math.abs(feet[1] - duck.pos[1]) > FOUND_DY && floorOf(house, feet[1]) === floorOf(house, duck.pos[1]);
}

/**
 * How long to wait before asking for the find again after `refusals`
 * refusals in a row (the server's copy of the pose said "not near", or the
 * doors were closed): 1.5 s, 3 s, 6 s, then every 10 s.
 */
export function foundRetryMs(refusals: number): number {
  return Math.min(10_000, 1500 * 2 ** Math.max(0, refusals));
}

/** What the HUD says while a find waits for the doors (§2.1: 409 "doors
 *  are closed" — the run is paused, or not open yet). */
export const PAUSED_NOTICE = "The simulation is paused — Gerald will wait for you.";

/** The room the feet are in, as the HUD names it. */
export function roomTitle(house: HouseMap, feet: Vec3): { room: string; location: string | null } {
  const at = locate(house, feet);
  const room = at.room !== null ? roomById(house, at.room) : undefined;
  if (room === undefined) return { room: "Somewhere between rooms", location: null };
  return { room: room.label, location: room.location ?? null };
}

export type Heat = "found" | "burning" | "hot" | "warmer" | "colder" | "cold" | "steady";

/**
 * How warm the player is: absolute when close (burning < 1.5 m, hot < 4 m
 * of route), else the trend against the distance a moment ago (a change
 * under 0.15 m is "steady"). `prev` null = no trend yet.
 */
export function heat(dist: number, prev: number | null): Heat {
  if (dist <= REACH) return "found";
  if (dist < 1.5) return "burning";
  if (dist < 4) return "hot";
  if (prev === null || Math.abs(dist - prev) < 0.15) return dist > 15 ? "cold" : "steady";
  return dist < prev ? "warmer" : "colder";
}

export const HEAT_LABEL: Record<Heat, string> = {
  found: "THERE!",
  burning: "BURNING HOT",
  hot: "HOT",
  warmer: "WARMER",
  colder: "COLDER",
  cold: "COLD",
  steady: "FOLLOW THE GOLDEN ARROWS",
};

/** `m:ss` (or `h:mm:ss`). */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** A compass bearing (0 = N, 90 = E, clockwise) for a house yaw (0 = N, + = left). */
export function bearingOf(yaw: number): number {
  const b = -wrapYaw(yaw);
  return ((b % 360) + 360) % 360;
}

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** The 8-point compass name of a yaw. */
export function compassPoint(yaw: number): (typeof POINTS)[number] {
  return POINTS[Math.round(bearingOf(yaw) / 45) % 8]!;
}

/**
 * The on-screen angle (degrees, clockwise, 0 = straight ahead) of a plan
 * target seen from `from` while facing `yaw` — the compass's duck pip.
 */
export function relativeBearing(from: Vec3, to: Vec3, yaw: number): number {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  if (dx === 0 && dz === 0) return 0;
  // Bearing of the target: clockwise from north (−z).
  const target = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const rel = target - bearingOf(yaw);
  return ((((rel + 180) % 360) + 360) % 360) - 180 + 0;
}
