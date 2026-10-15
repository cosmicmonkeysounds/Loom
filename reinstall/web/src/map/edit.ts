//! The map editor's operations — pure. Each takes a house map and returns
//! a changed copy (the input is never mutated), so the page keeps an undo
//! stack of plain values and validates every draft with `validateHouse`.
//! Nothing here enforces validity: an edit that leaves a door off its wall
//! is shown to the director as a live problem, not silently refused.

import { DOOR_TOLERANCE, cloneData, distanceToBoundary, roomAt, roomById, roomElevation, wrapYaw, yawToward } from "@loom/house";
import type { Door, HouseMap, Room, TerminalSpot, Vec2, Vec3 } from "@loom/house";
import type { SaveHouseReply } from "../api.ts";
import { clampGap, fitDoor, rectSideOf, resolveDoor, round } from "./doors.ts";
import { uniqueId } from "./ids.ts";
import { labelSpot, rectOf, snap, type Edge } from "./plan.ts";
import { settleRoom } from "./yards.ts";

export { uniqueId };

/** What the editor can point at. */
export type Selection =
  | { kind: "terminal"; id: string }
  | { kind: "duck"; id: string }
  | { kind: "spawn" }
  | { kind: "room"; id: string }
  | { kind: "prop"; id: string }
  | { kind: "door"; id: string }
  | { kind: "stair"; id: string }
  | { kind: "floor"; id: string };

/** Terminal screens hang at about eye height above their floor. */
export const TERMINAL_HEIGHT = 1.4;
/** The smallest side a room may be dragged down to. */
export const MIN_ROOM = 0.3;

function clone(h: HouseMap): HouseMap {
  return cloneData(h);
}

/** The plan position of a selectable thing (null for a room / unknown id). */
export function positionOf(house: HouseMap, sel: Selection): Vec3 | null {
  switch (sel.kind) {
    case "terminal":
      return house.terminals.find((t) => t.id === sel.id)?.pos ?? null;
    case "duck":
      return house.duck.spots.find((d) => d.id === sel.id)?.pos ?? null;
    case "spawn":
      return house.spawn.pos;
    case "prop":
      return house.props.find((p) => p.id === sel.id)?.pos ?? null;
    default:
      return null;
  }
}

/**
 * Move a terminal / duck spot / the spawn / a prop to a plan point (its
 * height is kept). Its `room` follows to whichever room on its floor now
 * contains it.
 */
export function moveTo(house: HouseMap, sel: Selection, plan: Vec2): HouseMap {
  if (sel.kind === "room") return house;
  const next = clone(house);
  const place = (thing: { room: string; pos: Vec3 }): void => {
    const floor = roomById(next, thing.room)?.floor;
    thing.pos = [plan[0], thing.pos[1], plan[1]];
    if (floor === undefined) return;
    const room = roomAt(next, plan, floor);
    if (room !== null) thing.room = room.id;
  };
  if (sel.kind === "terminal") {
    const t = next.terminals.find((x) => x.id === sel.id);
    if (t) place(t);
  } else if (sel.kind === "duck") {
    const d = next.duck.spots.find((x) => x.id === sel.id);
    if (d) place(d);
  } else if (sel.kind === "prop") {
    const p = next.props.find((x) => x.id === sel.id);
    if (p) place(p);
  } else place(next.spawn);
  return next;
}

/** The yaw of a selectable thing (terminals, the spawn, props). */
export function yawOf(house: HouseMap, sel: Selection): number | null {
  switch (sel.kind) {
    case "terminal":
      return house.terminals.find((t) => t.id === sel.id)?.yaw ?? null;
    case "spawn":
      return house.spawn.yaw;
    case "prop": {
      const p = house.props.find((x) => x.id === sel.id);
      return p === undefined ? null : (p.yaw ?? 0);
    }
    default:
      return null;
  }
}

/** Set a yaw (wrapped into [−180, 180), rounded to 0.5°). */
export function setYaw(house: HouseMap, sel: Selection, yaw: number): HouseMap {
  const y = Math.round(wrapYaw(yaw) * 2) / 2 + 0;
  const next = clone(house);
  if (sel.kind === "terminal") {
    const t = next.terminals.find((x) => x.id === sel.id);
    if (t) t.yaw = y;
  } else if (sel.kind === "spawn") next.spawn.yaw = y;
  else if (sel.kind === "prop") {
    const p = next.props.find((x) => x.id === sel.id);
    if (p) p.yaw = y;
  } else return house;
  return next;
}

/** Point a thing at a plan point (the rotate handle). */
export function aimAt(house: HouseMap, sel: Selection, target: Vec2, step = 5): HouseMap {
  const pos = positionOf(house, sel);
  if (pos === null) return house;
  const yaw = yawToward(pos, [target[0], pos[1], target[1]]);
  return setYaw(house, sel, Math.round(yaw / step) * step);
}

/** Add a terminal in a room (at its middle, eye height, facing north). */
export function addTerminal(house: HouseMap, roomId: string): { house: HouseMap; id: string } {
  const room = roomById(house, roomId);
  if (room === undefined) return { house, id: "" };
  const next = clone(house);
  const id = uniqueId("terminal", next.terminals.map((t) => t.id));
  const at = labelSpot(room.poly);
  const t: TerminalSpot = { id, name: `Terminal ${id.slice("terminal-".length)}`, room: roomId, pos: [snap(at[0]), roomElevation(next, room) + TERMINAL_HEIGHT, snap(at[1])], yaw: 0 };
  next.terminals.push(t);
  return { house: next, id };
}

/** Add a duck spot in a room (at its middle, on the floor). */
export function addDuckSpot(house: HouseMap, roomId: string): { house: HouseMap; id: string } {
  const room = roomById(house, roomId);
  if (room === undefined) return { house, id: "" };
  const next = clone(house);
  const id = uniqueId(`duck-${roomId}`, next.duck.spots.map((d) => d.id));
  const at = labelSpot(room.poly);
  next.duck.spots.push({ id, room: roomId, pos: [snap(at[0]), roomElevation(next, room), snap(at[1])] });
  return { house: next, id };
}

/** Remove a terminal, a duck spot, a door, a stair or a prop (the last duck
 *  spot stays — a map needs one). Rooms and floors cascade: `structure.ts`. */
export function removeThing(house: HouseMap, sel: Selection): HouseMap {
  const without = <T extends { id: string }>(list: T[], id: string, keepOne = false): T[] | null =>
    !list.some((x) => x.id === id) || (keepOne && list.length <= 1) ? null : list.filter((x) => x.id !== id);
  const next = clone(house);
  switch (sel.kind) {
    case "terminal": {
      const l = without(next.terminals, sel.id);
      if (l === null) return house;
      next.terminals = l;
      return next;
    }
    case "duck": {
      const l = without(next.duck.spots, sel.id, true);
      if (l === null) return house;
      next.duck.spots = l;
      return next;
    }
    case "door": {
      const l = without(next.doors, sel.id);
      if (l === null) return house;
      next.doors = l;
      return next;
    }
    case "stair": {
      const l = without(next.stairs, sel.id);
      if (l === null) return house;
      next.stairs = l;
      return next;
    }
    case "prop": {
      const l = without(next.props, sel.id);
      if (l === null) return house;
      next.props = l;
      return next;
    }
    default:
      return house;
  }
}

/** The doors on a room's own walls (± `DOOR_TOLERANCE`). */
function doorsOnWalls(house: HouseMap, room: Room): Door[] {
  return house.doors.filter((d) => (d.a === room.id || d.b === room.id) && distanceToBoundary(room.poly, d.at) <= DOOR_TOLERANCE + 1e-9);
}

/** The carried doors re-linked once the plan has settled (after any yard
 *  re-cut, so the rooms either side are final) and kept inside their run.
 *  `h` is a copy the caller owns. */
function relinked(h: HouseMap, ids: ReadonlySet<string>): HouseMap {
  h.doors = h.doors.map((d) => (ids.has(d.id) ? fitDoor(h, resolveDoor(h, d)) : d));
  return h;
}

/** What stands in a room (terminals, duck spots, props, the spawn). */
function thingsIn(house: HouseMap, roomId: string): { room: string; pos: Vec3 }[] {
  return [...house.terminals, ...house.duck.spots, ...house.props, house.spawn].filter((t) => t.room === roomId);
}

/**
 * Drag one edge of a rectangular (4-vertex) room to `value` (an x for
 * e/w, a z for n/s). The far edge stays; the room keeps at least
 * `MIN_ROOM` per side. Doors and wall-mounted things on the dragged edge
 * move with it; a door on a side that got shorter slides to stay on it;
 * every door on the room re-links to the rooms it now opens on, and a
 * yard the room now overlaps is cut around it (`settleRoom`). A
 * non-rectangular room is returned unchanged.
 */
export function moveRectEdge(house: HouseMap, roomId: string, edge: Edge, value: number): HouseMap {
  const room = roomById(house, roomId);
  const r = room ? rectOf(room.poly) : null;
  if (room === undefined || r === null) return house;
  let [x0, z0, x1, z1] = r;
  if (edge === "w") x0 = Math.min(value, x1 - MIN_ROOM);
  if (edge === "e") x1 = Math.max(value, x0 + MIN_ROOM);
  if (edge === "n") z0 = Math.min(value, z1 - MIN_ROOM);
  if (edge === "s") z1 = Math.max(value, z0 + MIN_ROOM);
  const to: [number, number, number, number] = [round(x0), round(z0), round(x1), round(z1)];
  if (to.every((v, i) => v === r[i])) return house;
  const next = clone(house);
  const target = next.rooms.find((x) => x.id === roomId)!;
  target.poly = rectPolyLike(room.poly, r, to);
  const moved = new Set(doorsOnWalls(house, room).map((d) => d.id));
  for (const d of next.doors) {
    if (!moved.has(d.id)) continue;
    const side = rectSideOf(r, d.at);
    if (side !== null) d.at = sideMoved(d.at, side, d.width, to);
  }
  // Wall-mounted things on the dragged edge go with it.
  for (const t of thingsIn(next, roomId)) {
    if (rectSideOf(r, [t.pos[0], t.pos[2]], 0.05) !== edge) continue;
    if (edge === "e" || edge === "w") t.pos = [edge === "e" ? to[2] : to[0], t.pos[1], t.pos[2]];
    else t.pos = [t.pos[0], t.pos[1], edge === "s" ? to[3] : to[1]];
  }
  return relinked(settleRoom(house, next, roomId), moved);
}

/** A door on `side` of a rect, carried to the same side of the rect `to`:
 *  across, the side's new line; along, kept, then clamped onto the side. */
function sideMoved(at: Vec2, side: Edge, width: number, to: readonly [number, number, number, number]): Vec2 {
  const [x0, z0, x1, z1] = to;
  if (side === "n" || side === "s") return [round(clampGap(at[0], width, x0, x1)), side === "n" ? z0 : z1];
  return [side === "w" ? x0 : x1, round(clampGap(at[1], width, z0, z1))];
}

/** The same rectangle's vertices, in the original winding / starting corner. */
function rectPolyLike(poly: readonly Vec2[], from: readonly number[], to: readonly number[]): Vec2[] {
  return poly.map(([x, z]) => [x === from[0] ? to[0]! : to[2]!, z === from[1] ? to[1]! : to[3]!]);
}

/**
 * Move a room by `(dx, dz)`, carrying what stands in it (its terminals,
 * duck spots, props and — when it is the spawn room — the spawn) and the
 * doors on its walls, which then re-link to whatever they open on at the
 * new place (a door left facing nothing opens to the outside). A yard it
 * now overlaps is cut around it; a yard it stood in gets its old
 * footprint back (`settleRoom`).
 */
export function moveRoom(house: HouseMap, roomId: string, dx: number, dz: number): HouseMap {
  const room = roomById(house, roomId);
  if (room === undefined || (dx === 0 && dz === 0)) return house;
  const next = clone(house);
  const shift = (p: Vec3): Vec3 => [round(p[0] + dx), p[1], round(p[2] + dz)];
  const target = next.rooms.find((r) => r.id === roomId)!;
  target.poly = target.poly.map(([x, z]) => [round(x + dx), round(z + dz)] as Vec2);
  for (const t of thingsIn(next, roomId)) t.pos = shift(t.pos);
  const moved = new Set(doorsOnWalls(house, room).map((d) => d.id));
  for (const d of next.doors) if (moved.has(d.id)) d.at = [round(d.at[0] + dx), round(d.at[1] + dz)];
  return relinked(settleRoom(house, next, roomId), moved);
}

/** Set one field of a terminal (the inspector's inputs). */
export function patchTerminal(house: HouseMap, id: string, patch: Partial<Omit<TerminalSpot, "id">>): HouseMap {
  if (!house.terminals.some((t) => t.id === id)) return house;
  const next = clone(house);
  const t = next.terminals.find((x) => x.id === id)!;
  Object.assign(t, patch);
  if (t.fov === undefined) delete t.fov;
  if (t.pitch === undefined) delete t.pitch;
  return next;
}

/** Set a room's label / location / colour / height / outdoor flag (a
 *  cleared location or height, or `outdoor: false`, is dropped). A room
 *  made indoor is cut out of any yard it overlaps. */
export function patchRoom(house: HouseMap, id: string, patch: Partial<Pick<Room, "label" | "location" | "color" | "height" | "outdoor">>): HouseMap {
  if (!house.rooms.some((r) => r.id === id)) return house;
  const next = clone(house);
  const r = next.rooms.find((x) => x.id === id)!;
  Object.assign(r, patch);
  if (r.location === "" || r.location === undefined) delete r.location;
  if (r.height === undefined || !(r.height > 0)) delete r.height;
  if (r.outdoor !== true) delete r.outdoor;
  return patch.outdoor === false ? settleRoom(house, next, id) : next;
}

/** Set the height (y) of a placed thing. */
export function setHeight(house: HouseMap, sel: Selection, y: number): HouseMap {
  const pos = positionOf(house, sel);
  if (pos === null || !Number.isFinite(y)) return house;
  const next = clone(house);
  const p = positionOf(next, sel)!;
  p[1] = y;
  return next;
}

/**
 * A wall terminal's provisioning link — **without** the moderator passcode
 * (the director appends `&code=<mod passcode>` before opening it on the
 * tablet; a printed link must not carry it).
 */
export function provisionLink(origin: string, t: Pick<TerminalSpot, "id" | "name">): string {
  const q = new URLSearchParams({ name: t.name, spot: t.id, view: "auto" });
  return `${origin}/terminal/?${q.toString()}`;
}

/**
 * The JSON tab's text → a draft the plan can draw. A map that is *invalid*
 * (a door off its wall, rooms overlapping) is still adopted — the problem
 * list says what is wrong while the plan shows it — but text that isn't
 * JSON, or JSON the plan can't draw at all (a room without a polygon, a
 * terminal without a position), is refused with the reason and the last
 * drawable draft stays. Missing optional lists are filled in as `[]`.
 */
export function draftFromText(text: string): { ok: true; house: HouseMap } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `JSON: ${(e as Error).message}` };
  }
  const why = shapeProblem(raw);
  if (why !== null) return { ok: false, error: `Not a drawable house map: ${why}` };
  const h = raw as HouseMap & Partial<Pick<HouseMap, "doors" | "stairs" | "terminals" | "props" | "spaces">>;
  return { ok: true, house: { ...h, doors: h.doors ?? [], stairs: h.stairs ?? [], terminals: h.terminals ?? [], props: h.props ?? [], spaces: h.spaces ?? {} } };
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isVec = (v: unknown, n: number): boolean => Array.isArray(v) && v.length === n && v.every(isNum);

/** The first reason the plan couldn't draw `raw`, or null. Only what the
 *  page reads is checked; everything else is `validateHouse`'s job. */
function shapeProblem(raw: unknown): string | null {
  if (!isObj(raw)) return "the top level must be an object";
  const list = (key: string, required: boolean, ok: (x: Json) => boolean): string | null => {
    const v = raw[key];
    if (v === undefined && !required) return null;
    if (!Array.isArray(v)) return `"${key}" must be a list`;
    const bad = v.findIndex((x) => !isObj(x) || !isStr(x["id"]) || !ok(x));
    return bad < 0 ? null : `${key}[${bad}] is malformed`;
  };
  return (
    list("floors", true, (f) => isNum(f["elevation"]) && isNum(f["height"])) ??
    list("rooms", true, (r) => isStr(r["floor"]) && Array.isArray(r["poly"]) && (r["poly"] as unknown[]).every((p) => isVec(p, 2))) ??
    list("doors", false, (d) => isStr(d["a"]) && isVec(d["at"], 2)) ??
    list("stairs", false, (s) => isStr(s["from"]) && isStr(s["to"]) && isVec(s["rect"], 4) && isStr(s["up"])) ??
    list("terminals", false, (t) => isStr(t["room"]) && isStr(t["name"]) && isVec(t["pos"], 3) && isNum(t["yaw"])) ??
    list("props", false, (p) => isStr(p["room"]) && isStr(p["kind"]) && isVec(p["pos"], 3) && isVec(p["size"], 3)) ??
    (isObj(raw["duck"]) && Array.isArray(raw["duck"]["spots"])
      ? (raw["duck"]["spots"] as unknown[]).every((d) => isObj(d) && isStr(d["id"]) && isStr(d["room"]) && isVec(d["pos"], 3))
        ? null
        : "a duck spot is malformed"
      : '"duck.spots" must be a list') ??
    (isObj(raw["spawn"]) && isStr(raw["spawn"]["room"]) && isVec(raw["spawn"]["pos"], 3) && isNum(raw["spawn"]["yaw"]) ? null : '"spawn" needs room, pos and yaw')
  );
}

/**
 * What the page does when the stream announces a map version (a `house`
 * frame, or the `hello` of every (re)connect — so a save missed while the
 * stream was down, or a page that came up on the bundled stand-in, catches
 * up): nothing while our own save is in flight, before the first load, or
 * when it is the version we have; else reload a clean draft, or warn over a
 * dirty one (never overwrite the director's edits).
 */
export function remoteMapAction(announced: string | null, current: string | null, state: { saving: boolean; dirty: boolean }): "reload" | "warn" | null {
  if (announced === null || current === null || state.saving || announced === current) return null;
  return state.dirty ? "warn" : "reload";
}

/** The map the page shows can be edited and saved: never the bundled
 *  stand-in (saving it would replace the event's own map with it). */
export function editableSource(source: string): boolean {
  return source !== "bundled";
}

/** The save button's state. `conflict`: another director saved since this
 *  page loaded its map (409) — nothing was saved; `version` is theirs. */
export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok"; warnings: string[]; version: string }
  | { kind: "error"; error: string; problems: string[] }
  | { kind: "conflict"; version: string | null };

/** What a save's reply shows the director. */
export function saveStateOf(r: SaveHouseReply): SaveState {
  if (r.ok) return { kind: "ok", warnings: r.result.warnings, version: r.result.version };
  if (r.conflict) return { kind: "conflict", version: r.version };
  return { kind: "error", error: r.error, problems: r.problems };
}

/** The version a save is based on — what the server compares (§2.1 `base`):
 *  the loaded map's, never the bundled stand-in's (which has none). */
export function saveBaseOf(loaded: { source: string; version: string } | null): string | null {
  return loaded === null || loaded.source === "bundled" || loaded.version === "" ? null : loaded.version;
}
