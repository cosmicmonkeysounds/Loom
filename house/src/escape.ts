//! The void (wave 26, R4) — walking out of the house. Both games let a
//! program out through an exterior door (`Door.b === null`) onto an outside
//! ground (`outsideGround`, the same rect as VR's `_build_ground`). Once
//! the program is `ESCAPE_M` plan metres past the walls on its floor
//! (`voidDistance`), the game scares them, teleports them back to the spawn
//! and posts an escape moment (`POST /api/spatial/moment {kind: "escape"}`);
//! the server re-checks with `ESCAPE_M − ESCAPE_SLACK` and a per-session
//! `ESCAPE_COOLDOWN_MS`. Pure; the GDScript port is
//! `reinstall/vr/house/house_escape.gd`, pinned by `<map>.escape.json`.

import { distanceToBoundary, floorById, polyBounds, roomById } from "./geometry.ts";
import { floorOf, locate } from "./locate.ts";
import type { HouseMap, Vec2, Vec3 } from "./types.ts";

/** Plan metres past the house walls (on the player's floor) that trigger an escape. */
export const ESCAPE_M = 5;
/** The server accepts an escape at `ESCAPE_M − ESCAPE_SLACK` (its pose lags a little). */
export const ESCAPE_SLACK = 0.5;
/** One escape per session per this long (the server's cooldown). */
export const ESCAPE_COOLDOWN_MS = 20_000;
/** How far the outside ground reaches past the rooms on its floor (= VR `GROUND_MARGIN`). */
export const OUTSIDE_GROUND_MARGIN = 30;
/** The story signal an escape posts (`who: admin`, no args). */
export const ESCAPE_SIGNAL = "simulation escape attempt";

/** The walkable outside of a map (`outsideGround`). */
export interface OutsideGround {
  /** The floor the first exterior door opens from. */
  floor: string;
  /** That floor's elevation (0 for an unknown floor). */
  y: number;
  /** `[x0, z0, x1, z1]`: the bounds of that floor's rooms grown by `OUTSIDE_GROUND_MARGIN`. */
  rect: [number, number, number, number];
}

/**
 * The walkable outside: the floor an exterior (`b: null`) door opens from
 * (the first such door, in array order, whose room `a` exists), its
 * elevation and the bounds of every room on that floor grown by `margin`
 * (default `OUTSIDE_GROUND_MARGIN`). Null when the map has no exterior
 * door. The same rect as VR `_build_ground` (the rooms are holes in it).
 */
export function outsideGround(house: HouseMap, margin = OUTSIDE_GROUND_MARGIN): OutsideGround | null {
  let floor: string | null = null;
  for (const door of house.doors) {
    if (door.b !== null) continue;
    const room = roomById(house, door.a);
    if (room !== undefined) {
      floor = room.floor;
      break;
    }
  }
  if (floor === null) return null;
  const pts: Vec2[] = [];
  for (const room of house.rooms) if (room.floor === floor) pts.push(...room.poly);
  if (pts.length === 0) return null;
  const b = polyBounds(pts);
  return { floor, y: floorById(house, floor)?.elevation ?? 0, rect: [b[0] - margin, b[1] - margin, b[2] + margin, b[3] + margin] };
}

/**
 * How far into the void a point is: null inside a room (`locate(p).room
 * !== null`); else the plan distance to the nearest room boundary on
 * `floorOf(p[1])` — `Infinity` when that floor has no rooms.
 */
export function voidDistance(house: HouseMap, p: Vec3): number | null {
  if (locate(house, p).room !== null) return null;
  const floor = floorOf(house, p[1]);
  const plan: Vec2 = [p[0], p[2]];
  let best = Infinity;
  for (const room of house.rooms) {
    if (room.floor !== floor) continue;
    const d = distanceToBoundary(room.poly, plan);
    if (d < best) best = d;
  }
  return best;
}
