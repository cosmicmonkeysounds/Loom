//! D7 of the voice link (wave 19, `docs/loom-reinstall.md` §2.4): whether a
//! terminal spot takes part at all. Its own tiny module, apart from the codec
//! in `voice.ts`, so a page that only needs this answer (the terminal's
//! entry, its Setup map) never pulls the codec into its main bundle.

import type { HouseMap, TerminalSpot } from "./types.ts";

/** A terminal spot, by value or by id (an unknown id is no terminal). */
export type SpotRef = TerminalSpot | string;

/** The spot `spot` names on `house`, else null. */
export function spotOf(house: HouseMap, spot: SpotRef): TerminalSpot | null {
  return typeof spot === "string" ? (house.terminals.find((t) => t.id === spot) ?? null) : spot;
}

/**
 * D7: whether a terminal takes part in the voice link. `voice: true` → on,
 * `voice: false` → off; unset → on, except a terminal standing in the map's
 * spawn room (the tent / the shed: the tent laptop, beside the headsets).
 */
export function voiceOn(house: HouseMap, spot: SpotRef): boolean {
  const t = spotOf(house, spot);
  if (!t) return false;
  if (t.voice === true) return true;
  if (t.voice === false) return false;
  return t.room !== house.spawn.room;
}
