//! The map page's problem list — pure. `validateHouse` speaks in strings
//! (`doors[3] "back": …`), so each is read back to the thing it names, and
//! a click selects it. On top of validation, two checks the validator
//! can't make: **walkability** (SW-MAP-09 — `route()` from the spawn to
//! every duck spot, the algorithm the VR autopilot follows, so a duck
//! nobody can walk to is caught before the show — plus every room no
//! chain of doors leads into, plus every duck within reach of a wall from
//! the next room), and the story's **LOCATIONs** (a room naming none of
//! them; a LOCATION no room is). Those two are warnings: they never block
//! a save.

import { inPropFootprint, locate, roomById, route, TALK_NONE, visibleIn, voiceOn } from "@loom/house";
import type { DescentScript, HouseMap, Vec2 } from "@loom/house";
import { REACH } from "../game/hud.ts";
import type { Selection } from "./edit.ts";

export interface Problem {
  text: string;
  /** What the problem names (a click selects it), when it names one thing. */
  sel: Selection | null;
  /** `error`: from `validateHouse` (blocks a save); `warning`: advice. */
  level: "error" | "warning";
  /** A speaker- / lights-config item naming no speaker / light: a click opens its tab. */
  tab?: "audio" | "lights";
}

const LISTS: Record<string, (house: HouseMap, id: string) => Selection | null> = {
  rooms: (h, id) => (h.rooms.some((r) => r.id === id) ? { kind: "room", id } : null),
  doors: (h, id) => (h.doors.some((d) => d.id === id) ? { kind: "door", id } : null),
  stairs: (h, id) => (h.stairs.some((s) => s.id === id) ? { kind: "stair", id } : null),
  terminals: (h, id) => (h.terminals.some((t) => t.id === id) ? { kind: "terminal", id } : null),
  "duck.spots": (h, id) => (h.duck.spots.some((d) => d.id === id) ? { kind: "duck", id } : null),
  props: (h, id) => (h.props.some((p) => p.id === id) ? { kind: "prop", id } : null),
  floors: (h, id) => (h.floors.some((f) => f.id === id) ? { kind: "floor", id } : null),
};

/** What a `validateHouse` problem names, when it is one thing. */
export function selectionOf(house: HouseMap, text: string): Selection | null {
  const listed = /^(rooms|doors|stairs|terminals|duck\.spots|props|floors)\[\d+\] "([^"]*)"/.exec(text);
  if (listed) return LISTS[listed[1]!]!(house, listed[2]!);
  if (/^spawn\b/.test(text)) return { kind: "spawn" };
  const pair = /^(rooms|floors) "([^"]*)" and "/.exec(text);
  if (pair) return LISTS[pair[1]!]!(house, pair[2]!);
  return null;
}

/** `validateHouse`'s problems, each with what it names. */
export function structuredProblems(house: HouseMap, problems: readonly string[]): Problem[] {
  return problems.map((text) => ({ text, sel: selectionOf(house, text), level: "error" }));
}

/**
 * The duck spots a player starting at the spawn can't walk to — the same
 * `route()` the VR autopilot and the web game's golden trail follow. Only
 * meaningful on a valid map (pass `validateHouse`'s normalized house).
 */
export function unreachableDucks(house: HouseMap): string[] {
  const from = house.spawn.pos;
  const start = locate(house, from).room;
  const out: string[] = [];
  for (const spot of house.duck.spots) {
    const path = route(house, from, spot.pos);
    if (path.length > 2) continue;
    // `[from, to]` is a straight walk — or no path at all.
    const end = locate(house, spot.pos).room;
    const room = start !== null ? roomById(house, start) : undefined;
    if (start !== null && start === end && room !== undefined && visibleIn(house, room, from, spot.pos)) continue;
    out.push(spot.id);
  }
  return out;
}

/**
 * The rooms no door (or stair) chain leads to from the spawn's room — a
 * part of a yard a tent sealed off, a room drawn with no door yet. Read
 * off the door graph alone (a door to the outside leads nowhere), so it
 * runs on any draft.
 */
export function unreachableRooms(house: HouseMap): string[] {
  const links = new Map<string, string[]>(house.rooms.map((r) => [r.id, []]));
  const link = (a: string, b: string) => {
    links.get(a)?.push(b);
    links.get(b)?.push(a);
  };
  for (const d of house.doors) if (d.b !== null) link(d.a, d.b);
  for (const s of house.stairs) link(s.from, s.to);
  const seen = new Set<string>([house.spawn.room]);
  const stack = [house.spawn.room];
  while (stack.length > 0) {
    for (const n of links.get(stack.pop()!) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return house.rooms.filter((r) => !seen.has(r.id)).map((r) => r.id);
}

/**
 * The rooms a guarded door (`Door.guard`, a king standing in it) seals off:
 * for each such door, the room on the far side from the spawn (by the door
 * graph with the guarded doors shut) — a room no other way reaches. Nothing
 * when the guard leaves another way in.
 */
export function guardedRooms(house: HouseMap): Array<{ room: string; door: string; king: string }> {
  const guarded = house.doors.filter((d) => d.guard !== undefined);
  if (guarded.length === 0) return [];
  const shut = new Set(guarded.map((d) => d.id));
  const links = new Map<string, string[]>(house.rooms.map((r) => [r.id, []]));
  const link = (a: string, b: string) => {
    links.get(a)?.push(b);
    links.get(b)?.push(a);
  };
  for (const d of house.doors) if (d.b !== null && !shut.has(d.id)) link(d.a, d.b);
  for (const s of house.stairs) link(s.from, s.to);
  const seen = new Set<string>([house.spawn.room]);
  const stack = [house.spawn.room];
  while (stack.length > 0) {
    for (const n of links.get(stack.pop()!) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  const out: Array<{ room: string; door: string; king: string }> = [];
  for (const d of guarded) {
    if (d.b === null) continue;
    const far = seen.has(d.a) && !seen.has(d.b) ? d.b : seen.has(d.b) && !seen.has(d.a) ? d.a : null;
    if (far !== null && !out.some((o) => o.room === far)) out.push({ room: far, door: d.id, king: d.guard! });
  }
  return out;
}

/** Plan distance from `p` to the nearest edge of `poly`. */
function edgeDistance(poly: readonly Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i]!;
    const [bx, bz] = poly[(i + 1) % poly.length]!;
    const len2 = (bx - ax) ** 2 + (bz - az) ** 2;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - az) * (bz - az)) / len2));
    best = Math.min(best, Math.hypot(p[0] - (ax + t * (bx - ax)), p[1] - (az + t * (bz - az))));
  }
  return best;
}

/** Sample step (metres) for `duckWallLeaks`. */
const LEAK_STEP = 0.05;

/**
 * The duck spots a player can pick up through a wall from the next room:
 * the find is plan distance + floor only (`withinReach`, the server's
 * `nearDuck`), so a duck within `REACH` of a shared wall is found from the
 * room behind it. Samples every point within `REACH` a player's feet can
 * stand on (≥ the body radius + half a wall from the duck room's edge) and
 * records each other room on the same floor — the sampler of
 * `core/test/show-house.test.ts`. One entry per (duck, room) pair.
 */
export function duckWallLeaks(house: HouseMap): Array<{ duck: string; from: string }> {
  const clearance = 0.25 + (house.style?.wallThickness ?? 0.12) / 2;
  const n = Math.floor(REACH / LEAK_STEP);
  const out: Array<{ duck: string; from: string }> = [];
  for (const s of house.duck.spots) {
    const own = roomById(house, s.room);
    const floor = own !== undefined ? house.floors.find((f) => f.id === own.floor) : undefined;
    if (own === undefined || floor === undefined) continue;
    const seen = new Set<string>();
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const dx = i * LEAK_STEP;
        const dz = j * LEAK_STEP;
        if (Math.hypot(dx, dz) > REACH) continue;
        const p: Vec2 = [s.pos[0] + dx, s.pos[2] + dz];
        if (edgeDistance(own.poly, p) < clearance) continue; // against the wall line: no feet fit
        const at = locate(house, [p[0], floor.elevation, p[1]]);
        if (at.room === null || at.room === s.room || at.floor !== own.floor || seen.has(at.room)) continue;
        seen.add(at.room);
        out.push({ duck: s.id, from: at.room });
      }
    }
  }
  return out;
}

/** How tall Gerald stands, for `buriedDucks`. */
const DUCK_HEIGHT = 0.5;

/**
 * The duck spots with Gerald inside a prop's box: the validator refuses a solid
 * one, but a prop that isn't solid (a TV, a toaster, a descent's strange prop)
 * would draw right over him, and he would be found by walking up to nothing.
 */
export function buriedDucks(house: HouseMap): Array<{ duck: string; prop: string }> {
  const out: Array<{ duck: string; prop: string }> = [];
  for (const s of house.duck.spots) {
    const mid = s.pos[1] + DUCK_HEIGHT / 2;
    for (const p of house.props) {
      if (p.kind === "label") continue;
      if (mid > p.pos[1] && mid < p.pos[1] + p.size[1] && inPropFootprint(p, [s.pos[0], s.pos[2]])) out.push({ duck: s.id, prop: p.id });
    }
  }
  return out;
}

/** Walkability as warnings: one per unreachable duck spot, one per duck found through a wall (per room behind it), one per duck buried in a prop, one per room nobody can walk into, then one per room a King guards. */
export function walkabilityProblems(house: HouseMap): Problem[] {
  const ducks = unreachableDucks(house).map((id): Problem => {
    const spot = house.duck.spots.find((d) => d.id === id)!;
    const room = roomById(house, spot.room)?.label ?? spot.room;
    return { text: `duck spot "${id}" (${room}) can't be reached from the spawn (no way through the doors)`, sel: { kind: "duck", id }, level: "warning" };
  });
  const leaks = duckWallLeaks(house).map(({ duck, from }): Problem => {
    const spot = house.duck.spots.find((d) => d.id === duck)!;
    const room = roomById(house, spot.room)?.label ?? spot.room;
    const other = roomById(house, from)?.label ?? from;
    return { text: `duck spot "${duck}" (${room}) can be picked up through the wall from "${other}" — move it ≥ ~1.2 m from that wall`, sel: { kind: "duck", id: duck }, level: "warning" };
  });
  const buried = buriedDucks(house).map(({ duck, prop }): Problem => {
    const spot = house.duck.spots.find((d) => d.id === duck)!;
    const room = roomById(house, spot.room)?.label ?? spot.room;
    return { text: `duck spot "${duck}" (${room}) is inside prop "${prop}" — nobody will see Gerald there`, sel: { kind: "duck", id: duck }, level: "warning" };
  });
  const rooms = unreachableRooms(house).map((id): Problem => {
    const r = roomById(house, id)!;
    return { text: `${r.outdoor ? "yard" : "room"} "${id}" (${r.label}) can't be reached from the spawn — no door leads into it`, sel: { kind: "room", id }, level: "warning" };
  });
  const guarded = guardedRooms(house).map(({ room, door, king }): Problem => {
    const r = roomById(house, room)!;
    return { text: `room "${room}" (${r.label}) is guarded by king "${king}" at door "${door}" — it opens when he falls`, sel: { kind: "door", id: door }, level: "warning" };
  });
  return [...ducks, ...leaks, ...buried, ...rooms, ...guarded, ...voiceProblems(house)];
}

/** The voice link as warnings: a terminal standing in the spawn room (the
 *  tent, beside the headsets) with the link on. */
export function voiceProblems(house: HouseMap): Problem[] {
  return house.terminals
    .filter((t) => t.room === house.spawn.room && voiceOn(house, t))
    .map((t): Problem => ({
      text: `terminal "${t.id}" stands in the spawn room with the voice link on — the headsets beside it would hear the room twice (the tent laptop's is off)`,
      sel: { kind: "terminal", id: t.id },
      level: "warning",
    }));
}

/** (wave 49) A prop told to talk as a talker `descent.json` doesn't have: it
 *  just never wakes, so a warning. Nothing while the script is unknown.
 *  DRAFT w49 (UI copy). */
export function talkProblems(house: HouseMap, script: DescentScript | null): Problem[] {
  if (script === null) return [];
  const known = new Set(script.talkers.map((t) => t.id));
  return house.props
    .filter((p) => p.talk !== undefined && p.talk !== TALK_NONE && !known.has(p.talk))
    .map((p): Problem => ({ text: `prop "${p.id}" talks as "${p.talk}", and descent.json has no such talker — it will never wake`, sel: { kind: "prop", id: p.id }, level: "warning" }));
}

/** A story LOCATION, as the mod view lists them. */
export interface StoryLocation {
  id: string;
  label: string | null;
}

/** The event server's name match (`foldName`, `core/src/parser/names.ts`). */
export function foldName(name: string): string {
  return name.trim().toLowerCase().replace(/[_\-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

/**
 * The story's LOCATIONs against the map: a room naming a LOCATION the
 * story doesn't declare (what the server warns about on a save), and each
 * LOCATION no room is (a place the games can't show — fine for a place
 * that has no geometry, worth a look otherwise). Nothing while the
 * story's locations are unknown.
 */
export function locationProblems(house: HouseMap, locations: readonly StoryLocation[] | null): Problem[] {
  if (locations === null) return [];
  const known = new Set(locations.map((l) => foldName(l.id)));
  const out: Problem[] = [];
  for (const r of house.rooms) {
    if (r.location !== undefined && !known.has(foldName(r.location))) {
      out.push({ text: `room "${r.id}": "${r.location}" is not a LOCATION in the story`, sel: { kind: "room", id: r.id }, level: "warning" });
    }
  }
  const used = new Set(house.rooms.flatMap((r) => (r.location !== undefined ? [foldName(r.location)] : [])));
  for (const l of locations) {
    if (!used.has(foldName(l.id))) out.push({ text: `LOCATION ${l.id} has no room on the map`, sel: null, level: "warning" });
  }
  return out;
}
