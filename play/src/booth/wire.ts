//! Wave 18's booth fields, read off the wire before the core lane's types
//! land in `types.ts` (CONTRACTS C3–C8, addenda A1). Every one is optional:
//! an older server sends none and the booth behaves as wave 17's. Once
//! core merges these mirror its names exactly, so the casts here can go.

import type { CueRow } from "../../../core/src/cue-sheet.ts";
import { foldName } from "../avatars.ts";
import type { ChatMessage, Interaction, ObjectiveView, PrimeGuest, PrimeView } from "../types.ts";

/** One marked program on the Wanted board (C6 `PrimeView.wanted[]`). */
export interface WantedEntry {
  id: string;
  name: string;
  avatar?: string | null;
  reason: string | null;
  /** The LOCATION id they stand in (null: not seen in a room). */
  location: string | null;
  /** WALL-clock ms they were last seen (the server's presence stamp; null: not since the server started). */
  lastSeen: number | null;
  /** Story ms the mark turned true. */
  markedAt: number;
  /** The Antivirus character on it (`program.escort_by`), or null. */
  claimedBy: string | null;
  /** Caught: kept 60 s with this set, then dropped. */
  captured: boolean;
}

/** An objective's named target (C5). */
export interface ObjectiveTarget {
  id: string;
  name: string;
  avatar?: string | null;
  location?: string | null;
}

/** `ObjectiveView` with wave 18's booth keys (C5, A7). */
export type BoothObjective = ObjectiveView & { target?: ObjectiveTarget; pick?: string[]; evergreen?: true };

/** Who is calling the show (C8 `cues.caller`). */
export interface CallerView {
  name: string;
  at: number;
}

/** Clippy's own cues (C8 `PrimeView.calls`). */
export interface CallsView {
  rows: CueRow[];
  next: string | null;
  /** NEXT's title when the row isn't this booth's (C8 fix, BN-F11). */
  nextTitle?: string | null;
  last: string | null;
  lastName: string | null;
  act: string | null;
  presses: number;
  caller?: CallerView | null;
}

/** A readout with its guest (C3). */
export type BoothMessage = ChatMessage & { aboutName?: string; aboutAvatar?: string | null };

/** A booth guest row with its last sighting (A1). */
export type BoothGuest = PrimeGuest & { lastSeen?: number | null };

/** The booth view with wave 18's keys. */
export type BoothView = PrimeView & {
  wanted?: WantedEntry[];
  calls?: CallsView;
  globalButtons?: string[];
  objectives?: BoothObjective[];
  guests: BoothGuest[];
};

/** The view, read with wave 18's keys (a cast: the fields are optional). */
export function boothView(view: PrimeView | null | undefined): BoothView | null {
  return (view ?? null) as BoothView | null;
}

/** `PrimeView.wanted`, or null when this booth gets no board (an older server, or not in the `wanted:` line's `for`). */
export function wantedOf(view: PrimeView | null | undefined): WantedEntry[] | null {
  const w = boothView(view)?.wanted;
  return Array.isArray(w) ? w : null;
}

/** The marked programs still loose (the tray LED, the NOW chip). */
export function looseWanted(view: PrimeView | null | undefined): WantedEntry[] {
  return (wantedOf(view) ?? []).filter((w) => !w.captured);
}

/** `PrimeView.calls` (Clippy's booth only). */
export function callsOf(view: PrimeView | null | undefined): CallsView | null {
  const c = boothView(view)?.calls;
  return c !== undefined && c !== null && Array.isArray(c.rows) ? c : null;
}

/** `PrimeView.globalButtons` (C4): ids this booth may press with no guest. */
export function globalButtonsOf(view: PrimeView | null | undefined): string[] {
  const g = boothView(view)?.globalButtons;
  return Array.isArray(g) ? g : [];
}

/** A guest's last sighting (A1), else the wanted entry's, else undefined (unknown). */
export function lastSeenOf(g: Pick<BoothGuest, "id" | "lastSeen">, wanted: readonly WantedEntry[] | null): number | null | undefined {
  if (g.lastSeen !== undefined) return g.lastSeen;
  const w = wanted?.find((x) => x.id === g.id);
  return w !== undefined ? w.lastSeen : undefined;
}

/** May this booth press story button `id` (it is in the view, and its `by:` names this character or nobody)? */
export function mayPress(interactions: readonly Interaction[] | undefined, id: string, me: string): boolean {
  const i = (interactions ?? []).find((x) => x.id === id);
  if (i === undefined) return false;
  if (i.actors === undefined || i.only !== true) return true;
  const f = foldName(me);
  return i.actors.some((a) => foldName(a) === f);
}
