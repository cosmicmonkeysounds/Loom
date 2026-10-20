//! Setting a tablet up off the event's live house map: the terminals the
//! house editor placed (`house.terminals`, `TerminalSpot.view` / `speaks`)
//! are the list ⚙ offers, so "which tablet is this" is one tap — never a
//! typed name, a spot id and a screen type that must agree by hand.
//!
//! Pure: the setup screen (`Setup.tsx`) and the boot (`app.tsx`) call these.

import type { HouseMap, TerminalSpot } from "@loom/house";
import { DEFAULT_TV_ROOM, VIEWS, type TerminalConfig, type TerminalView, type UrlHints } from "./config.ts";

/** What a map terminal sets on a tablet chosen as it. */
export interface MapPick {
  spot: string;
  name: string;
  view: TerminalView;
  /** The LOCATION a room terminal speaks for, else "" (the TV: "" = `DEFAULT_TV_ROOM`). */
  room: string;
}

type MapLike = Pick<HouseMap, "terminals" | "rooms" | "floors">;

function viewOf(t: Pick<TerminalSpot, "view">): TerminalView {
  return typeof t.view === "string" && (VIEWS as readonly string[]).includes(t.view) ? (t.view as TerminalView) : "auto";
}

/** The LOCATION of a map room (its label when it names none). */
function locationOf(house: MapLike, roomId: string): string {
  const r = house.rooms.find((x) => x.id === roomId);
  return r?.location?.trim() || r?.label || roomId;
}

/** A map terminal → the tablet's spot / name / view / room. */
export function pickOf(house: MapLike, t: TerminalSpot): MapPick {
  const view = viewOf(t);
  const room = t.speaks === true && view !== "tv" && view !== "chess" && view !== "casino" ? locationOf(house, t.room) : "";
  return { spot: t.id, name: t.name.trim() || t.id, view, room };
}

/** The "unplaced" choice: no window, the face only. */
export const UNPLACED: MapPick = { spot: "", name: "Terminal", view: "face", room: "" };

/** A screen type in words, for the list. */
export function screenWords(pick: Pick<MapPick, "view" | "room">): string {
  if (pick.room !== "") return `room terminal — ${pick.room}`;
  switch (pick.view) {
    case "tv":
      return `TV — speaks ${DEFAULT_TV_ROOM}'s lines`;
    case "chess":
      return "chess board — the King";
    case "casino":
      return "casino";
    case "mirror":
      return "mirror — watch only, no scanner";
    case "shadow":
      return "shadow — this camera, the players as ghosts";
    case "world":
      return "house terminal — the simulation always";
    case "face":
      return "house terminal — face only";
    default:
      return "house terminal";
  }
}

/** One heartbeat off `GET /api/mod/screen/terminals`. */
export interface Heartbeat {
  name: string;
  spot: string;
  ago: number;
}

/** "⚠ online now: X, seen 5 s ago" for a spot another tablet polls from, or
 *  null. `self` (this tablet's current name + spot) is never "another". */
export function onlineBadge(spot: string, beats: readonly Heartbeat[], silentMs: number, self: { name: string; spot: string } | null): string | null {
  if (spot === "") return null;
  const others = beats.filter((b) => b.spot === spot && b.ago < silentMs && !(self !== null && b.name === self.name && b.spot === self.spot));
  if (others.length === 0) return null;
  others.sort((a, b) => a.ago - b.ago);
  return `⚠ online now: ${others.map((b) => `${b.name}, seen ${Math.max(0, Math.round(b.ago / 1000))} s ago`).join(" · ")}`;
}

export interface Choice {
  pick: MapPick;
  /** The room label + its LOCATION. */
  where: string;
  screen: string;
}

export interface FloorGroup {
  floor: string;
  label: string;
  rooms: Array<{ room: string; label: string; choices: Choice[] }>;
}

/** The map's terminals by floor (the map's order, highest first) then room. */
export function groupTerminals(house: MapLike): FloorGroup[] {
  const floors = [...house.floors].sort((a, b) => b.elevation - a.elevation);
  const out: FloorGroup[] = [];
  for (const f of floors) {
    const rooms: FloorGroup["rooms"] = [];
    for (const r of house.rooms.filter((x) => x.floor === f.id)) {
      const ts = house.terminals.filter((t) => t.room === r.id);
      if (ts.length === 0) continue;
      const loc = r.location?.trim();
      const label = loc && loc !== r.label ? `${r.label} · ${loc}` : r.label;
      rooms.push({ room: r.id, label, choices: ts.map((t) => { const pick = pickOf(house, t); return { pick, where: label, screen: screenWords(pick) }; }) });
    }
    if (rooms.length > 0) out.push({ floor: f.id, label: f.label || f.id, rooms });
  }
  return out;
}

/** A config set up as `pick` (from the map): the URL's own name / view /
 *  room still win when given (old links). */
export function applyPick(c: TerminalConfig, pick: MapPick, overrides: Pick<UrlHints, "name" | "view" | "room"> | null = null): TerminalConfig {
  return {
    ...c,
    spot: pick.spot,
    name: overrides?.name ?? pick.name,
    view: overrides?.view ?? pick.view,
    room: overrides?.room ?? pick.room,
    fromMap: pick.spot !== "",
  };
}

/** At boot: a terminal set up from the map follows the map's current entry
 *  for its spot (a variant switch, a director's save). Null = nothing to
 *  change (not from the map, the spot is gone, or already in step). */
export function followMap(c: TerminalConfig, house: MapLike): TerminalConfig | null {
  if (c.fromMap !== true || c.spot === "") return null;
  const t = house.terminals.find((x) => x.id === c.spot);
  if (t === undefined) return null;
  const pick = pickOf(house, t);
  if (pick.name === c.name && pick.view === c.view && pick.room === c.room) return null;
  return { ...c, name: pick.name, view: pick.view, room: pick.room };
}

/** A `?code=…&spot=…` link's config: with a spot the map has, that map
 *  terminal; the link's own name / view / room (old links) win, and a
 *  manual view or room means it no longer follows the map. Without a map
 *  (or a spot it lacks) the link's fields as given. */
export function urlConfig(base: TerminalConfig, hints: Pick<UrlHints, "spot" | "name" | "view" | "room">, house: MapLike | null): TerminalConfig {
  const t = hints.spot === null || house === null ? undefined : house.terminals.find((x) => x.id === hints.spot);
  if (t === undefined) return base;
  const next = applyPick(base, pickOf(house as MapLike, t), { name: hints.name, view: hints.view, room: hints.room });
  return hints.view !== null || hints.room !== null ? { ...next, fromMap: false } : next;
}
