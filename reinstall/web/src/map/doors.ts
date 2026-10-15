//! Doors on the plan — pure. A door is a gap in a wall line, so every op
//! here works on **wall lines**: an axis plus a coordinate (`"x"` = the
//! wall runs along x at z = c, `"z"` = along z at x = c, as in
//! `WallSegment`). Which rooms a door joins is never typed in: it is read
//! off the plan by sampling just either side of the line at the door
//! (`sidesAt`) — one room there means a door to the outside (`b: null`).
//! A run (`wallRun`) is the stretch of a line with the same two rooms
//! either side: the most a door may span there.

import { DOOR_TOLERANCE, cloneData, distanceToBoundary, distanceToSegment, pointInPolyStrict, roomAt, roomById } from "@loom/house";
import type { Door, HouseMap, Vec2 } from "@loom/house";
import { freshId } from "./ids.ts";
import { snap } from "./plan.ts";

export type Axis = "x" | "z";

/** A wall line: `"x"` runs along x at z = `c`; `"z"` runs along z at x = `c`. */
export interface WallLine {
  axis: Axis;
  c: number;
}

/** The two rooms either side of a stretch of wall: `[the − side, the + side]`
 *  (north / west first), `null` where the outside is. */
export type Sides = [string | null, string | null];

export interface WallRun {
  line: WallLine;
  lo: number;
  hi: number;
  sides: Sides;
}

/** The default new door, metres. */
export const DOOR_WIDTH = 0.9;
/** How far off a wall line a door's sampling looks for the rooms either side. */
const SIDE = 0.005;

/** The plan point at `t` along a wall line (`off` metres across it). */
export function pointOn(line: WallLine, t: number, off = 0): Vec2 {
  return line.axis === "x" ? [t, line.c + off] : [line.c + off, t];
}

/** A plan point's coordinate along a wall line. */
export function alongOf(line: WallLine, p: Vec2): number {
  return line.axis === "x" ? p[0] : p[1];
}

/** The room a plan point is strictly inside (its boundary doesn't count:
 *  a door exactly at a corner is not inside the room round the corner). */
function roomInside(house: HouseMap, floor: string, p: Vec2): string | null {
  return house.rooms.find((r) => r.floor === floor && pointInPolyStrict(r.poly, p) && distanceToBoundary(r.poly, p) > 1e-6)?.id ?? null;
}

/** The rooms on either side of a wall line at `t`. */
export function sidesAt(house: HouseMap, floor: string, line: WallLine, t: number): Sides {
  return [roomInside(house, floor, pointOn(line, t, -SIDE)), roomInside(house, floor, pointOn(line, t, SIDE))];
}

/** A wall there: two different rooms, or a room and the outside. */
const isWall = (s: Sides): boolean => s[0] !== s[1];
const sameSides = (a: Sides, b: Sides): boolean => a[0] === b[0] && a[1] === b[1];

/** Every room edge on `floor` lying on the line (± `DOOR_TOLERANCE`), as `[lo, hi]`. */
function edgesOn(house: HouseMap, floor: string, line: WallLine): [number, number][] {
  const out: [number, number][] = [];
  for (const room of house.rooms) {
    if (room.floor !== floor) continue;
    const n = room.poly.length;
    for (let i = 0; i < n; i++) {
      const p = room.poly[i]!;
      const q = room.poly[(i + 1) % n]!;
      const across = line.axis === "x" ? [p[1], q[1]] : [p[0], q[0]];
      const along = line.axis === "x" ? [p[0], q[0]] : [p[1], q[1]];
      if (across[0] !== across[1] || along[0] === along[1]) continue;
      if (Math.abs(across[0]! - line.c) > DOOR_TOLERANCE + 1e-9) continue;
      out.push([Math.min(along[0]!, along[1]!), Math.max(along[0]!, along[1]!)]);
    }
  }
  return out;
}

/**
 * The run of wall through `t` on a line: the stretch either side of `t`
 * with the same rooms on its two sides. Null when there is no wall at `t`
 * (no room edge there, or the same room on both sides).
 */
export function wallRun(house: HouseMap, floor: string, line: WallLine, t: number): WallRun | null {
  const edges = edgesOn(house, floor, line);
  const cuts = [...new Set(edges.flatMap((e) => e))].sort((a, b) => a - b);
  if (cuts.length < 2) return null;
  // The elementary intervals (between consecutive edge ends) with a wall.
  const spans: { lo: number; hi: number; sides: Sides }[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const lo = cuts[i]!;
    const hi = cuts[i + 1]!;
    const mid = (lo + hi) / 2;
    if (!edges.some((e) => e[0] <= mid && mid <= e[1])) continue;
    spans.push({ lo, hi, sides: sidesAt(house, floor, line, mid) });
  }
  const eps = 1e-9;
  // A t exactly on a cut belongs to the span either side: the first with a wall.
  const k = spans.findIndex((s) => s.lo - eps <= t && t <= s.hi + eps && isWall(s.sides));
  if (k < 0) return null;
  const at = spans[k]!;
  let lo = k;
  let hi = k;
  while (lo > 0 && spans[lo - 1]!.hi === spans[lo]!.lo && sameSides(spans[lo - 1]!.sides, at.sides)) lo--;
  while (hi + 1 < spans.length && spans[hi + 1]!.lo === spans[hi]!.hi && sameSides(spans[hi + 1]!.sides, at.sides)) hi++;
  return { line, lo: spans[lo]!.lo, hi: spans[hi]!.hi, sides: at.sides };
}

/** The room edge on `floor` nearest a plan point, within `tol`: its line and the point's projection on it. */
export function nearestWall(house: HouseMap, floor: string, p: Vec2, tol: number): { line: WallLine; t: number; dist: number } | null {
  let best: { line: WallLine; t: number; dist: number } | null = null;
  for (const room of house.rooms) {
    if (room.floor !== floor) continue;
    const n = room.poly.length;
    for (let i = 0; i < n; i++) {
      const a = room.poly[i]!;
      const b = room.poly[(i + 1) % n]!;
      if (a[0] !== b[0] && a[1] !== b[1]) continue;
      const d = distanceToSegment(p, a, b);
      if (d > tol || (best !== null && d >= best.dist)) continue;
      const line: WallLine = a[1] === b[1] ? { axis: "x", c: a[1] } : { axis: "z", c: a[0] };
      const lo = Math.min(alongOf(line, a), alongOf(line, b));
      const hi = Math.max(alongOf(line, a), alongOf(line, b));
      best = { line, t: Math.max(lo, Math.min(hi, alongOf(line, p))), dist: d };
    }
  }
  return best;
}

/** A door's floor: its room `a`'s (else `b`'s), "" when neither exists. */
export function doorFloor(house: HouseMap, door: Pick<Door, "a" | "b">): string {
  return roomById(house, door.a)?.floor ?? (door.b !== null ? roomById(house, door.b)?.floor : undefined) ?? "";
}

/**
 * The wall line a door sits on: the line through its point (either axis)
 * that a room edge of its floor lies on, within `DOOR_TOLERANCE` — snapped
 * to that edge's exact coordinate. Its own rooms' edges are preferred.
 * Null for a door off every wall.
 */
export function doorLine(house: HouseMap, door: Pick<Door, "a" | "b" | "at">): WallLine | null {
  const floor = doorFloor(house, door);
  // Best: an edge of its own rooms, nearest, then the one the point is
  // furthest inside (a door at a corner lies on the end of the other wall).
  let best: { line: WallLine; own: boolean; d: number; margin: number } | null = null;
  for (const room of house.rooms) {
    if (room.floor !== floor) continue;
    const own = room.id === door.a || room.id === door.b;
    const n = room.poly.length;
    for (let i = 0; i < n; i++) {
      const a = room.poly[i]!;
      const b = room.poly[(i + 1) % n]!;
      let line: WallLine;
      if (a[1] === b[1] && a[0] !== b[0]) line = { axis: "x", c: a[1] };
      else if (a[0] === b[0] && a[1] !== b[1]) line = { axis: "z", c: a[0] };
      else continue;
      const d = Math.round(distanceToSegment(door.at, a, b) * 1000);
      if (d > DOOR_TOLERANCE * 1000) continue;
      const t = alongOf(line, door.at);
      const margin = Math.min(t - Math.min(alongOf(line, a), alongOf(line, b)), Math.max(alongOf(line, a), alongOf(line, b)) - t);
      const better = best === null || (own && !best.own) || (own === best.own && (d < best.d || (d === best.d && margin > best.margin)));
      if (better) best = { line, own, d, margin };
    }
  }
  return best?.line ?? null;
}

/** The door's gap on the plan (for drawing): its two ends, or null off a wall. */
export function doorGap(house: HouseMap, door: Door): [Vec2, Vec2] | null {
  const line = doorLine(house, door);
  if (line === null) return null;
  const t = alongOf(line, door.at);
  return [pointOn(line, t - door.width / 2), pointOn(line, t + door.width / 2)];
}

/** `a` / `b` for a door with these rooms either side: keeps the door's own
 *  `a` (or `b`) where it still is one, else the room the door was placed from. */
function pickRooms(sides: Sides, keep: string[]): { a: string; b: string | null } | null {
  const rooms = sides.filter((s): s is string => s !== null);
  if (rooms.length === 0) return null;
  const a = keep.find((k) => rooms.includes(k)) ?? rooms[0]!;
  return { a, b: rooms.find((r) => r !== a) ?? null };
}

/**
 * The door with `a` / `b` re-read off the plan: the rooms either side of
 * its wall at its point now. Unchanged (the same object) when it is off
 * every wall, or already right.
 */
export function resolveDoor(house: HouseMap, door: Door): Door {
  const line = doorLine(house, door);
  if (line === null) return door;
  const floor = doorFloor(house, door);
  const keep = door.b !== null ? [door.a, door.b] : [door.a];
  const r = pickRooms(sidesAt(house, floor, line, alongOf(line, door.at)), keep);
  if (r === null || (r.a === door.a && r.b === door.b)) return door;
  return { ...door, a: r.a, b: r.b };
}

/**
 * A re-linked door kept inside its run: slid along its wall until its gap
 * fits the stretch it is on, and narrowed only when the stretch is shorter
 * than the door (a yard re-cut under a flap, a room moved half off its
 * neighbour). Unchanged off every wall.
 */
export function fitDoor(house: HouseMap, door: Door): Door {
  const line = doorLine(house, door);
  if (line === null) return door;
  const t = alongOf(line, door.at);
  const run = wallRun(house, doorFloor(house, door), line, t);
  if (run === null) return door;
  const width = Math.min(door.width, round(run.hi - run.lo));
  const at = pointOn(line, round(clampGap(t, width, run.lo, run.hi)));
  if (width === door.width && at[0] === door.at[0] && at[1] === door.at[1]) return door;
  // Slid onto the run: the rooms there are the ones it opens on.
  return resolveDoor(house, { ...door, at, width });
}

/** Clamp a door's centre so its gap stays inside `[lo, hi]` (centred when it can't fit). */
export function clampGap(t: number, width: number, lo: number, hi: number): number {
  if (hi - lo <= width) return (lo + hi) / 2;
  return Math.max(lo + width / 2, Math.min(hi - width / 2, t));
}

/**
 * The Door tool: a door on the wall nearest `p` (within `tol`), its centre
 * snapped to `step` along the wall and kept inside the run, `width` wide
 * (narrower when the run is shorter), joining the rooms either side —
 * `a` is the room the click was in. Null when no wall is near.
 */
export function placeDoor(house: HouseMap, floor: string, p: Vec2, opts: { tol: number; width?: number; step?: number }): { house: HouseMap; id: string } | null {
  const hit = nearestWall(house, floor, p, opts.tol);
  if (hit === null) return null;
  const run = wallRun(house, floor, hit.line, hit.t);
  if (run === null) return null;
  const width = Math.min(opts.width ?? DOOR_WIDTH, Number((run.hi - run.lo).toFixed(3)));
  const t = clampGap(snap(hit.t, opts.step ?? 0.05), width, run.lo, run.hi);
  const clicked = roomAt(house, p, floor)?.id;
  const rooms = pickRooms(run.sides, clicked !== undefined ? [clicked] : []);
  if (rooms === null) return null;
  const next = cloneData(house);
  const id = freshId(`${rooms.a}-${rooms.b ?? "out"}`, next.doors.map((d) => d.id));
  next.doors.push({ id, a: rooms.a, b: rooms.b, at: pointOn(run.line, round(t)), width });
  return { house: next, id };
}

/**
 * Drag a door along its wall line to (the projection of) `p`: snapped,
 * kept in the run it lands in, `a` / `b` re-read there — sliding a door
 * along a corridor wall re-links it to the next room. A door off every
 * wall, or a point where the line has no wall, leaves the map unchanged.
 */
export function moveDoorAlong(house: HouseMap, id: string, p: Vec2, step = 0.05): HouseMap {
  const door = house.doors.find((d) => d.id === id);
  if (door === undefined) return house;
  const line = doorLine(house, door);
  if (line === null) return house;
  const floor = doorFloor(house, door);
  const target = snap(alongOf(line, p), step);
  // Past the end of the wall (or over a gap in it): stop at the end of the run it is on.
  const run = wallRun(house, floor, line, target) ?? wallRun(house, floor, line, alongOf(line, door.at));
  if (run === null) return house;
  const t = round(clampGap(target, door.width, run.lo, run.hi));
  const at = pointOn(line, t);
  if (at[0] === door.at[0] && at[1] === door.at[1]) return house;
  const next = cloneData(house);
  const d = next.doors.find((x) => x.id === id)!;
  d.at = at;
  Object.assign(d, resolveDoor(next, d));
  return next;
}

/** Open the whole edge: the door spans its entire run (yard piece ↔ yard piece, an archway). */
export function openEdge(house: HouseMap, id: string): HouseMap {
  const door = house.doors.find((d) => d.id === id);
  if (door === undefined) return house;
  const line = doorLine(house, door);
  if (line === null) return house;
  const run = wallRun(house, doorFloor(house, door), line, alongOf(line, door.at));
  if (run === null) return house;
  const next = cloneData(house);
  const d = next.doors.find((x) => x.id === id)!;
  d.at = pointOn(line, round((run.lo + run.hi) / 2));
  d.width = round(run.hi - run.lo);
  return next;
}

/** Set a door's width / height (a cleared height falls back to the house default). */
export function patchDoor(house: HouseMap, id: string, patch: { width?: number; height?: number | undefined }): HouseMap {
  if (!house.doors.some((d) => d.id === id)) return house;
  const next = cloneData(house);
  const d = next.doors.find((x) => x.id === id)!;
  if (patch.width !== undefined && Number.isFinite(patch.width) && patch.width > 0) d.width = patch.width;
  if ("height" in patch) {
    if (patch.height === undefined || !(patch.height > 0)) delete d.height;
    else d.height = patch.height;
  }
  return next;
}

/** The side (`n`/`s`/`e`/`w`) of the rect `[x0, z0, x1, z1]` a point lies on (± tol), if any. */
export function rectSideOf(rect: readonly number[], p: Vec2, tol = DOOR_TOLERANCE): "n" | "s" | "e" | "w" | null {
  const [x0, z0, x1, z1] = rect as [number, number, number, number];
  const inX = p[0] >= x0 - tol && p[0] <= x1 + tol;
  const inZ = p[1] >= z0 - tol && p[1] <= z1 + tol;
  if (inX && Math.abs(p[1] - z0) <= tol) return "n";
  if (inX && Math.abs(p[1] - z1) <= tol) return "s";
  if (inZ && Math.abs(p[0] - x0) <= tol) return "w";
  if (inZ && Math.abs(p[0] - x1) <= tol) return "e";
  return null;
}

/** Round to 1 mm without float dust. */
export function round(v: number): number {
  return Math.round(v * 1000) / 1000 + 0;
}
