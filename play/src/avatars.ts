//! Profile pictures + the sign-in pickers' data.
//!
//! Every view carries `avatars`: folded display name → serving key. The
//! picture itself is served by the event server at
//! `/e/:eventId/api/avatar/<key>` (same-origin, so the CSP is untouched);
//! this module turns a name into that URL, and hands the map to every
//! avatar tile through a context so a message's sender, a directory row,
//! and a cast pill all show the same face.
//!
//! The pickers: a guest sees the story's unclaimed *programs* (bare
//! `CHARACTER`s) and may search the program directory (any software on
//! Wikipedia, antivirus greyed out); a performer sees the unclaimed
//! *parts*. Both come from `POST /e/:id/api/identities`, resolved from the
//! code alone — no session yet. Having picked a program, a guest chooses
//! its *picture* from a few (`/api/identities/pictures`: the story's
//! hand-picked ones, then the article's logos / box art / screenshots),
//! and can switch later from their pass (`/api/guest/picture`).

import { createContext, useContext } from "react";

/** One row of a sign-in picker (mirror of the server's `IdentityRow`). */
export interface IdentityRow {
  name: string;
  faction: string | null;
  /** Picture serving key, or null when none was found (yet). */
  avatar: string | null;
  /** Someone already holds this name: greyed out, refused on sign-in. */
  claimed: boolean;
  /** Saved for an invited guest (`reserved: true`) and locked for this
   *  caller — no matching `claim` rode in: 🔒 Reserved, refused on sign-in
   *  (409 `reserved`). Absent from an older server → open. */
  reserved?: boolean;
}

/** What `/api/identities` answers for a code. */
export interface Identities {
  role: "guest" | "prime";
  identities: IdentityRow[];
  /** Is the program directory (search) available to guests? */
  search: boolean;
  /** False until the director opens the doors (there is no cast to pick
   *  from yet). Absent from an older server → treated as open. */
  doorsOpen?: boolean;
  /** Wave 54: the reserved program this caller's claim opens. */
  invited?: string;
}

/** How often the join screen re-asks while the doors are still closed. */
export const DOORS_POLL_MS = 5000;

/** One hit of the program directory search. */
export interface ProgramHit {
  name: string;
  description: string;
  avatar: string | null;
  claimed: boolean;
  /** A featured program found by its article name, saved for an invited
   *  guest and locked for this caller. Absent from an older server → open. */
  reserved?: boolean;
  /** Why a guest can't be this: `antivirus` (the enforcers' caste). */
  blocked: "antivirus" | null;
}

/** One picture a guest may choose (mirror of the server's `PictureChoice`). */
export interface PictureChoice {
  /** Serving key. */
  key: string;
  /** The Wikipedia / Commons file it is ("" for a plain link). */
  file: string;
}

/** The pictures on offer for a program, before sign-in. */
export interface ProgramPictures {
  /** The name the guest will register as (a directory pick's article title). */
  name: string;
  options: PictureChoice[];
}

/** A signed-in guest's picture options, and which one is theirs now. */
export interface PictureChoices {
  options: PictureChoice[];
  avatar: string | null;
}

/** Which option starts selected: the one they have now, else the first. */
export function initialPick(options: readonly PictureChoice[], current: string | null = null): string | null {
  if (current !== null && options.some((o) => o.key === current)) return current;
  return options[0]?.key ?? null;
}

/** Fold a display name the way the story (and the server's book) does. */
export function foldName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The same-origin URL of a picture by serving key. */
export function avatarUrl(eventId: string, key: string): string {
  return `/e/${encodeURIComponent(eventId)}/api/avatar/${encodeURIComponent(key)}`;
}

/** When a picture that failed to load is asked for again, in ms after each
 *  failure (wave 36). A failure on a phone is often a moment, not the
 *  picture: a Wi-Fi hiccup, or the server still fetching it from
 *  Wikipedia. After the last retry the tile keeps its initials. */
export const PICTURE_RETRY_MS: readonly number[] = [2000, 8000];

/** One picture's tries so far: how many loads failed, and whether a
 *  retry is waiting its turn. */
export interface PictureTries {
  fails: number;
  waiting: boolean;
}

export const PICTURE_START: PictureTries = { fails: 0, waiting: false };

/** A load failed: wait for the next retry, or give up after the last. */
export function pictureFailed(t: PictureTries): PictureTries {
  const fails = t.fails + 1;
  return { fails, waiting: fails <= PICTURE_RETRY_MS.length };
}

/** The retry's wait is over: load again. */
export function pictureRetry(t: PictureTries): PictureTries {
  return { ...t, waiting: false };
}

/** Has this picture given up for good? */
export function pictureGaveUp(t: PictureTries): boolean {
  return t.fails > PICTURE_RETRY_MS.length;
}

/** The URL to load now, or null (waiting, or given up: the initials show).
 *  A retry carries `?try=n`, so a browser that remembered the failure
 *  (Safari keeps a broken image for the page's life) asks the server
 *  again; the server ignores the query. */
export function pictureUrl(src: string, t: PictureTries): string | null {
  if (t.waiting || pictureGaveUp(t)) return null;
  return t.fails === 0 ? src : `${src}${src.includes("?") ? "&" : "?"}try=${t.fails}`;
}

/** Everyone's pictures, ready to look up by (any spelling of) a name. */
export interface AvatarLookup {
  /** The picture URL for a display name, or null when they have none. */
  srcFor(name: string): string | null;
}

export const NO_AVATARS: AvatarLookup = { srcFor: () => null };

/** Build a lookup from a view's `avatars` map (folded name → key). */
export function avatarLookup(eventId: string | null, avatars: Record<string, string> | undefined): AvatarLookup {
  if (eventId === null || avatars === undefined) return NO_AVATARS;
  return {
    srcFor(name) {
      const key = avatars[foldName(name)];
      return key === undefined ? null : avatarUrl(eventId, key);
    },
  };
}

export const AvatarsContext = createContext<AvatarLookup>(NO_AVATARS);

/** The current app's picture lookup (an empty one outside a signed-in app). */
export function useAvatars(): AvatarLookup {
  return useContext(AvatarsContext);
}

/** May this row be picked (not taken, not reserved for someone else)? */
export function rowPickable(row: IdentityRow): boolean {
  return !row.claimed && row.reserved !== true;
}

/** Picker rows in display order: free names first, then the reserved
 *  ones, then the taken ones. */
export function orderPicker(rows: readonly IdentityRow[]): IdentityRow[] {
  const reserved = (r: IdentityRow) => !r.claimed && r.reserved === true;
  return [...rows.filter(rowPickable), ...rows.filter(reserved), ...rows.filter((r) => r.claimed)];
}

/** A picker tile's note under the name (`· taken`, `🔒 Reserved`), or null. */
export function rowNote(row: IdentityRow): string | null {
  if (row.claimed) return "taken";
  if (row.reserved === true) return "🔒 Reserved";
  return null;
}

/** A picker tile's tooltip. */
export function rowTitle(row: IdentityRow): string {
  if (row.claimed) return `${row.name} is taken tonight`;
  if (row.reserved === true) return `${row.name} is saved for an invited guest`;
  return `Be ${row.name}`;
}

/** What a search hit's row says under the name. */
export function hitNote(hit: ProgramHit): string {
  if (hit.blocked === "antivirus") return "Antivirus — programs can't be antivirus software";
  if (hit.claimed) return "Taken tonight";
  if (hit.reserved === true) return "🔒 Reserved — saved for an invited guest";
  return hit.description;
}

/** May this hit be picked (not antivirus, not taken, not reserved)? */
export function hitPickable(hit: ProgramHit): boolean {
  return !hit.claimed && hit.blocked === null && hit.reserved !== true;
}
