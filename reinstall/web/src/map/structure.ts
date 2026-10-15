//! The map editor's structural ops — pure: floors, rooms (rectangles),
//! stairs, and a blank house. Like `edit.ts`, each returns a changed copy
//! and nothing here enforces validity (the problem list does); what this
//! module guarantees is that nothing is left pointing at something that
//! was deleted. Rooms are drawn as rectangles; a polygon room from the JSON
//! still moves, validates and deletes like any other.

import { cloneData, floorById, pointInPolyStrict, polyBounds, rectPoly, roomAt, roomById } from "@loom/house";
import type { Compass, Floor, HouseMap, Room, Stair, Vec2 } from "@loom/house";
import { round } from "./doors.ts";
import { freshId, freshLabel, slug } from "./ids.ts";
import { moveRectEdge, moveRoom } from "./edit.ts";
import { rectOf, type Bounds } from "./plan.ts";
import { giveBack, reflowYard, settleFloor, settleRoom, yardOf } from "./yards.ts";

/** A new floor's default storey height, metres. */
export const FLOOR_HEIGHT = 2.5;
/** The slab between a storey's ceiling and the next floor up, for a new floor's default elevation. */
export const SLAB = 0.25;

// ── Floors ───────────────────────────────────────────────────────────

/** A new floor's defaults: above the top floor, labelled "Floor N". */
export function floorDefaults(house: HouseMap): Omit<Floor, "id"> {
  const top = [...house.floors].sort((a, b) => b.elevation - a.elevation)[0];
  const elevation = top === undefined ? 0 : round(top.elevation + top.height + SLAB);
  return { label: freshLabel(top === undefined ? "Ground floor" : "Upstairs", house.floors.map((f) => f.label)), elevation, height: FLOOR_HEIGHT };
}

/** Add a floor (its id slugged from the label, unique). */
export function addFloor(house: HouseMap, f: Omit<Floor, "id">): { house: HouseMap; id: string } {
  const next = cloneData(house);
  const id = freshId(slug(f.label, "floor"), next.floors.map((x) => x.id));
  next.floors.push({ id, label: f.label, elevation: f.elevation, height: f.height });
  return { house: next, id };
}

/** Set a floor's label / elevation / height. */
export function patchFloor(house: HouseMap, id: string, patch: Partial<Omit<Floor, "id">>): HouseMap {
  if (!house.floors.some((f) => f.id === id)) return house;
  const next = cloneData(house);
  const f = next.floors.find((x) => x.id === id)!;
  if (patch.label !== undefined) f.label = patch.label;
  if (patch.elevation !== undefined && Number.isFinite(patch.elevation)) {
    // Everything standing on the floor rides up or down with it.
    const dy = patch.elevation - f.elevation;
    f.elevation = patch.elevation;
    const on = new Set(next.rooms.filter((r) => r.floor === id).map((r) => r.id));
    for (const t of [...next.terminals, ...next.duck.spots, ...next.props, next.spawn]) {
      if (on.has(t.room)) t.pos = [t.pos[0], round(t.pos[1] + dy), t.pos[2]];
    }
  }
  if (patch.height !== undefined && patch.height > 0) f.height = patch.height;
  return next;
}

/** What deleting a room takes with it. */
export interface Cascade {
  rooms: string[];
  doors: string[];
  stairs: string[];
  terminals: string[];
  duckSpots: string[];
  props: string[];
  /** Deleting would leave the spawn nowhere: refused. */
  spawn: boolean;
}

/** Everything deleting `roomIds` would delete. */
export function cascadeOf(house: HouseMap, roomIds: readonly string[]): Cascade {
  const gone = new Set(roomIds);
  return {
    rooms: [...gone],
    doors: house.doors.filter((d) => gone.has(d.a) || (d.b !== null && gone.has(d.b))).map((d) => d.id),
    stairs: house.stairs.filter((s) => gone.has(s.from) || gone.has(s.to)).map((s) => s.id),
    terminals: house.terminals.filter((t) => gone.has(t.room)).map((t) => t.id),
    duckSpots: house.duck.spots.filter((d) => gone.has(d.room)).map((d) => d.id),
    props: house.props.filter((p) => gone.has(p.room)).map((p) => p.id),
    spawn: gone.has(house.spawn.room),
  };
}

/** "2 doors, 1 terminal and 3 props" — what a confirm says goes with it ("" for nothing). */
export function cascadeText(c: Cascade, withRooms = false): string {
  const parts: string[] = [];
  const n = (count: number, one: string, many: string) => count > 0 && parts.push(`${count} ${count === 1 ? one : many}`);
  if (withRooms) n(c.rooms.length, "room", "rooms");
  n(c.doors.length, "door", "doors");
  n(c.stairs.length, "stair", "stairs");
  n(c.terminals.length, "terminal", "terminals");
  n(c.duckSpots.length, "duck spot", "duck spots");
  n(c.props.length, "prop", "props");
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The confirm before deleting a room (or a whole yard). */
export function deleteRoomText(room: Room, c: Cascade): string {
  const extra = cascadeText(c);
  const what = room.outdoor === true ? `the yard “${room.label}”${c.rooms.length > 1 ? ` (all ${c.rooms.length} pieces)` : ""}` : `the room “${room.label}”`;
  return `Delete ${what}${extra !== "" ? ` with ${extra}` : ""}?`;
}

function dropRooms(house: HouseMap, c: Cascade): HouseMap {
  const next = cloneData(house);
  const has = (list: string[]) => new Set(list);
  const rooms = has(c.rooms);
  const doors = has(c.doors);
  const stairs = has(c.stairs);
  const terminals = has(c.terminals);
  const ducks = has(c.duckSpots);
  const props = has(c.props);
  next.rooms = next.rooms.filter((r) => !rooms.has(r.id));
  next.doors = next.doors.filter((d) => !doors.has(d.id));
  next.stairs = next.stairs.filter((s) => !stairs.has(s.id));
  next.terminals = next.terminals.filter((t) => !terminals.has(t.id));
  next.duck.spots = next.duck.spots.filter((d) => !ducks.has(d.id));
  next.props = next.props.filter((p) => !props.has(p.id));
  return next;
}

/**
 * Delete a floor with its rooms and everything in them. Refused for the
 * last floor, and while the spawn stands on it (move the spawn first).
 */
export function removeFloor(house: HouseMap, id: string): { house: HouseMap } | { error: string } {
  if (!house.floors.some((f) => f.id === id)) return { house };
  if (house.floors.length <= 1) return { error: "A house needs at least one floor." };
  const c = cascadeOf(house, house.rooms.filter((r) => r.floor === id).map((r) => r.id));
  if (c.spawn) return { error: "The spawn is on this floor — move it to another floor first." };
  const next = dropRooms(house, c);
  next.floors = next.floors.filter((f) => f.id !== id);
  return { house: next };
}

// ── Rooms ────────────────────────────────────────────────────────────

/** `[x0, z0, x1, z1]` from any two corners. */
export function rectFrom(a: Vec2, b: Vec2): Bounds {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/**
 * Add a rectangular room on a floor (`outdoor`: a yard — no roof, fences).
 * Its label defaults to "Room" / "Yard" (numbered when taken), its id is
 * slugged from it. An indoor room drawn over a yard is cut out of it
 * (`settleRoom`, a flap when it is free-standing); a yard drawn over rooms
 * is cut around them; a door to the outside on a wall it now shares opens
 * onto it.
 */
export function addRoom(house: HouseMap, floor: string, rect: Bounds, opts: { outdoor?: boolean; label?: string } = {}): { house: HouseMap; id: string } {
  const r = rect.map(round) as Bounds;
  if (!(r[2] > r[0] && r[3] > r[1])) return { house, id: "" };
  const next = cloneData(house);
  const label = opts.label ?? freshLabel(opts.outdoor ? "Yard" : "Room", next.rooms.map((x) => x.label));
  const id = freshId(slug(label, opts.outdoor ? "yard" : "room"), next.rooms.map((x) => x.id));
  const room: Room = { id, label, floor, poly: rectPoly(r) };
  if (opts.outdoor) room.outdoor = true;
  next.rooms.push(room);
  const cut = opts.outdoor ? reflowYard(next, [id]) : settleRoom(house, next, id);
  // Nothing re-cut: still, a door to the outside on a wall the new room now
  // shares opens onto it (a yard drawn beside the house's front door).
  if (cut === next) settleFloor(next, floor, new Set([id]));
  return { house: cut, id };
}

/**
 * Where a typed "W × D" room goes: east of `beside` (sharing its north
 * line — the next room along a survey), else with its north-west corner at
 * `at`.
 */
export function placeRect(house: HouseMap, w: number, d: number, beside: string | null, at: Vec2): Bounds {
  const room = beside !== null ? roomById(house, beside) : undefined;
  if (room !== undefined) {
    const [, z0, x1] = polyBounds(room.poly);
    return [x1, z0, round(x1 + w), round(z0 + d)];
  }
  return [at[0], at[1], round(at[0] + w), round(at[1] + d)];
}

/** The rooms deleting `id` deletes: a yard goes whole (every piece), any other room alone. */
export function deletesWith(house: HouseMap, id: string): string[] {
  const pieces = yardOf(house, id);
  return pieces.length > 0 ? pieces : [id];
}

/**
 * Delete a room with its doors, stairs and what stands in it — a yard with
 * all its pieces. Refused while the spawn is in it. A yard the room stood
 * in gets its footprint back.
 */
export function removeRoom(house: HouseMap, id: string): { house: HouseMap } | { error: string } {
  if (!house.rooms.some((r) => r.id === id)) return { house };
  const c = cascadeOf(house, deletesWith(house, id));
  if (c.spawn) return { error: "The spawn is in this room — move the spawn to another room first." };
  return { house: giveBack(house, dropRooms(house, c), id) };
}

/** Rename a room's id, and every reference to it. Refused (unchanged) for a taken or empty id. */
export function renameRoom(house: HouseMap, from: string, to: string): HouseMap {
  const id = to.trim();
  if (id === "" || id === from || house.rooms.some((r) => r.id === id) || !house.rooms.some((r) => r.id === from)) return house;
  const next = cloneData(house);
  const swap = (v: string) => (v === from ? id : v);
  for (const r of next.rooms) r.id = swap(r.id);
  for (const d of next.doors) {
    d.a = swap(d.a);
    if (d.b !== null) d.b = swap(d.b);
  }
  for (const s of next.stairs) {
    s.from = swap(s.from);
    s.to = swap(s.to);
  }
  for (const t of [...next.terminals, ...next.duck.spots, ...next.props, next.spawn]) t.room = swap(t.room);
  return next;
}

/**
 * Set a rectangular room's rect (the inspector's x / z / W / D): the same
 * size moves it (with what stands in it), a new size resizes it edge by
 * edge — both through the ops that keep doors and yards right.
 */
export function setRoomRect(house: HouseMap, id: string, rect: Bounds): HouseMap {
  const room = roomById(house, id);
  const r = room ? rectOf(room.poly) : null;
  if (r === null) return house;
  const to = rect.map(round) as Bounds;
  if (round(to[2] - to[0]) === round(r[2] - r[0]) && round(to[3] - to[1]) === round(r[3] - r[1])) return moveRoom(house, id, round(to[0] - r[0]), round(to[1] - r[1]));
  let next = house;
  // Grow outward first so a shrinking edge never crosses the other.
  if (to[0] < r[0]) next = moveRectEdge(next, id, "w", to[0]);
  if (to[2] > r[2]) next = moveRectEdge(next, id, "e", to[2]);
  if (to[1] < r[1]) next = moveRectEdge(next, id, "n", to[1]);
  if (to[3] > r[3]) next = moveRectEdge(next, id, "s", to[3]);
  if (to[0] > r[0]) next = moveRectEdge(next, id, "w", to[0]);
  if (to[2] < r[2]) next = moveRectEdge(next, id, "e", to[2]);
  if (to[1] > r[1]) next = moveRectEdge(next, id, "n", to[1]);
  if (to[3] < r[3]) next = moveRectEdge(next, id, "s", to[3]);
  return next;
}

// ── Stairs ───────────────────────────────────────────────────────────

/** Floors, lowest first. */
function floorsUp(house: HouseMap): Floor[] {
  return [...house.floors].sort((a, b) => a.elevation - b.elevation);
}

/**
 * Add a stair drawn on `floor`: `from` / `to` are the rooms under its
 * middle on this floor and the next floor up (or, on the top floor, the
 * next floor down and this one) — change them in the inspector. It rises
 * along its long side, toward the north or the east.
 */
export function addStair(house: HouseMap, floor: string, rect: Bounds): { house: HouseMap; id: string } {
  const r = rect.map(round) as Bounds;
  if (!(r[2] > r[0] && r[3] > r[1])) return { house, id: "" };
  const floors = floorsUp(house);
  const i = floors.findIndex((f) => f.id === floor);
  const mid: Vec2 = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
  const here = roomAt(house, mid, floor)?.id ?? "";
  const above = floors[i + 1];
  const below = floors[i - 1];
  let from = here;
  let to = above !== undefined ? (roomAt(house, mid, above.id)?.id ?? "") : "";
  if (above === undefined && below !== undefined) {
    from = roomAt(house, mid, below.id)?.id ?? "";
    to = here;
  }
  const up: Compass = r[3] - r[1] >= r[2] - r[0] ? "n" : "e";
  const next = cloneData(house);
  const id = freshId(slug(`${roomById(house, from)?.label ?? "stairs"} stairs`, "stairs"), next.stairs.map((s) => s.id));
  next.stairs.push({ id, from, to, rect: r, up });
  return { house: next, id };
}

/** Set a stair's rooms / rect / rising side. */
export function patchStair(house: HouseMap, id: string, patch: Partial<Omit<Stair, "id">>): HouseMap {
  if (!house.stairs.some((s) => s.id === id)) return house;
  const next = cloneData(house);
  const s = next.stairs.find((x) => x.id === id)!;
  Object.assign(s, patch);
  if (patch.rect !== undefined) s.rect = patch.rect.map(round) as Stair["rect"];
  return next;
}

/** Move a stair's rect by `(dx, dz)`. */
export function moveStair(house: HouseMap, id: string, dx: number, dz: number): HouseMap {
  const s = house.stairs.find((x) => x.id === id);
  if (s === undefined || (dx === 0 && dz === 0)) return house;
  const [x0, z0, x1, z1] = s.rect;
  return patchStair(house, id, { rect: [x0 + dx, z0 + dz, x1 + dx, z1 + dz] });
}

/** The rooms a stair's ends may be: the rooms on each floor its rect sits over. */
export function stairCandidates(house: HouseMap, stair: Stair): Room[] {
  const mid: Vec2 = [(stair.rect[0] + stair.rect[2]) / 2, (stair.rect[1] + stair.rect[3]) / 2];
  return house.rooms.filter((r) => pointInPolyStrict(r.poly, mid) || r.id === stair.from || r.id === stair.to);
}

// ── A blank house ────────────────────────────────────────────────────

/**
 * A fresh map to survey into: one floor, a 20 × 16 m yard around the
 * origin (the front door's outside threshold), the spawn and one duck
 * spot in it — valid as it stands.
 */
export function blankHouse(name: string, origin = "the front door's outside threshold, floor level"): HouseMap {
  return {
    version: 1,
    name,
    origin,
    floors: [{ id: "ground", label: "Ground floor", elevation: 0, height: FLOOR_HEIGHT }],
    rooms: [{ id: "yard", label: "Yard", floor: "ground", outdoor: true, poly: rectPoly([-10, -6, 10, 10]) }],
    doors: [],
    stairs: [],
    terminals: [],
    duck: { spots: [{ id: "duck-yard-1", room: "yard", pos: [4, 0, 4] }] },
    spawn: { room: "yard", pos: [0, 0, 2], yaw: 0 },
    props: [],
    spaces: {},
  };
}

/** A floor's rooms. */
export function roomsOn(house: HouseMap, floor: string): Room[] {
  return house.rooms.filter((r) => r.floor === floor);
}

/** Whether a floor exists. */
export function hasFloor(house: HouseMap, id: string): boolean {
  return floorById(house, id) !== undefined;
}
