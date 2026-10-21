//! Setting a tablet up off the event's live house map: the terminals the
//! house editor placed (`house.terminals`, `TerminalSpot.view` / `speaks`)
//! are the list ⚙ offers, so "which tablet is this" is one tap — never a
//! typed name, a spot id and a screen type that must agree by hand.
//!
//! The map's voice link rides along (wave 19, `TerminalSpot.voice`, read
//! through `@loom/house` `voiceOn`): a tablet set up as the tent takes no
//! part in it, and follows the map when a director turns a spot's link on
//! or off.
//!
//! Pure: the setup screen (`Setup.tsx`) and the boot (`app.tsx`) call these.

import { voiceOn, type HouseMap, type TerminalSpot } from "@loom/house";
import { DEFAULT_TV_ROOM, VIEWS, type TerminalConfig, type TerminalView, type UrlHints } from "./config.ts";

/** What a map terminal sets on a tablet chosen as it. */
export interface MapPick {
  spot: string;
  name: string;
  view: TerminalView;
  /** The LOCATION a room terminal speaks for, else "" (the TV: "" = `DEFAULT_TV_ROOM`). */
  room: string;
  /** The map's voice link at this spot (`voiceOn`: off on the tent). */
  voice: boolean;
}

type MapLike = Pick<HouseMap, "terminals" | "rooms" | "floors" | "spawn">;

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
  return { spot: t.id, name: t.name.trim() || t.id, view, room, voice: voiceOn(house as HouseMap, t) };
}

/** The "unplaced" choice: no window, the face only, no voice link. */
export const UNPLACED: MapPick = { spot: "", name: "Terminal", view: "face", room: "", voice: false };

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
    voiceLink: pick.voice,
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
  if (pick.name === c.name && pick.view === c.view && pick.room === c.room && pick.voice === c.voiceLink) return null;
  return { ...c, name: pick.name, view: pick.view, room: pick.room, voiceLink: pick.voice };
}

/** Any terminal on the map (from it or not): the map's voice link for its
 *  spot, when it differs from the stored one. Null = nothing to change
 *  (unplaced, a spot the map lacks, or already in step). */
export function followVoice(c: TerminalConfig, house: MapLike): TerminalConfig | null {
  if (c.spot === "") return null;
  const t = house.terminals.find((x) => x.id === c.spot);
  if (t === undefined) return null;
  const voice = voiceOn(house as HouseMap, t);
  return voice === c.voiceLink ? null : { ...c, voiceLink: voice };
}

/** Whether a config says what its map terminal says (name / view / room). */
function agrees(c: Pick<TerminalConfig, "name" | "view" | "room">, pick: MapPick): boolean {
  return c.name === pick.name && c.view === pick.view && c.room === pick.room;
}

/**
 * A `?code=…&spot=…` link's config (`given` = `provision`'s, the link's
 * fields applied):
 * - a spot the map has, the link naming no `view` (the new form): that map
 *   terminal, a `name` / `room` in the link winning;
 * - an old fleet link (it names a `view`): exactly as given, as before;
 * - either way it follows the map at boot only while it says what the map
 *   says — a link's own name / view / room is never renamed back by
 *   `followMap`;
 * - no map read (the server didn't answer): as given, following the map
 *   from the next boot when the link named only the spot;
 * - a spot the map lacks: as given (the caller says so).
 */
export function urlConfig(given: TerminalConfig, hints: Pick<UrlHints, "spot" | "name" | "view" | "room">, house: MapLike | null): TerminalConfig {
  if (hints.spot === null) return given;
  if (house === null) return hints.name === null && hints.view === null && hints.room === null ? { ...given, fromMap: true } : given;
  const t = house.terminals.find((x) => x.id === hints.spot);
  if (t === undefined) return given;
  const pick = pickOf(house, t);
  const next = hints.view !== null ? { ...given, spot: pick.spot, voiceLink: pick.voice } : applyPick(given, pick, { name: hints.name, view: null, room: hints.room });
  return { ...next, fromMap: agrees(next, pick) };
}

/**
 * Setup's tap with ⚙'s advanced screen / room: `view` / `room` "" = the
 * map's. A manual choice that differs from the map's stops the tablet
 * following it; one that agrees keeps it on the map.
 */
export function withManual(c: TerminalConfig, pick: MapPick, manual: { view: TerminalView | ""; room: string }): TerminalConfig {
  const room = manual.room.trim();
  if (manual.view === "" && room === "") return c;
  const next = { ...c, view: manual.view || c.view, room: room || c.room };
  return { ...next, fromMap: pick.spot !== "" && agrees(next, pick) };
}
