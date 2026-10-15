//! The map page's problem list — pure. `validateHouse` speaks in strings
//! (`doors[3] "back": …`), so each is read back to the thing it names, and
//! a click selects it. On top of validation, two checks the validator
//! can't make: **walkability** (SW-MAP-09 — `route()` from the spawn to
//! every duck spot, the algorithm the VR autopilot follows, so a duck
//! nobody can walk to is caught before the show — plus every room no
//! chain of doors leads into), and the story's
//! **LOCATIONs** (a room naming none of them; a LOCATION no room is).
//! Those two are warnings: they never block a save.

import { locate, roomById, route, visibleIn } from "@loom/house";
import type { HouseMap } from "@loom/house";
import type { Selection } from "./edit.ts";

export interface Problem {
  text: string;
  /** What the problem names (a click selects it), when it names one thing. */
  sel: Selection | null;
  /** `error`: from `validateHouse` (blocks a save); `warning`: advice. */
  level: "error" | "warning";
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

/** Walkability as warnings: one per unreachable duck spot, then one per room nobody can walk into. */
export function walkabilityProblems(house: HouseMap): Problem[] {
  const ducks = unreachableDucks(house).map((id): Problem => {
    const spot = house.duck.spots.find((d) => d.id === id)!;
    const room = roomById(house, spot.room)?.label ?? spot.room;
    return { text: `duck spot "${id}" (${room}) can't be reached from the spawn (no way through the doors)`, sel: { kind: "duck", id }, level: "warning" };
  });
  const rooms = unreachableRooms(house).map((id): Problem => {
    const r = roomById(house, id)!;
    return { text: `${r.outdoor ? "yard" : "room"} "${id}" (${r.label}) can't be reached from the spawn — no door leads into it`, sel: { kind: "room", id }, level: "warning" };
  });
  return [...ducks, ...rooms];
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
