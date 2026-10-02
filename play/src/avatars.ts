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
//! code alone — no session yet.

import { createContext, useContext } from "react";

/** One row of a sign-in picker (mirror of the server's `IdentityRow`). */
export interface IdentityRow {
  name: string;
  faction: string | null;
  /** Picture serving key, or null when none was found (yet). */
  avatar: string | null;
  /** Someone already holds this name: greyed out, refused on sign-in. */
  claimed: boolean;
}

/** What `/api/identities` answers for a code. */
export interface Identities {
  role: "guest" | "prime";
  identities: IdentityRow[];
  /** Is the program directory (search) available to guests? */
  search: boolean;
}

/** One hit of the program directory search. */
export interface ProgramHit {
  name: string;
  description: string;
  avatar: string | null;
  claimed: boolean;
  /** Why a guest can't be this: `antivirus` (the enforcers' caste). */
  blocked: "antivirus" | null;
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

/** Picker rows in display order: free names first, then the taken ones. */
export function orderPicker(rows: readonly IdentityRow[]): IdentityRow[] {
  return [...rows.filter((r) => !r.claimed), ...rows.filter((r) => r.claimed)];
}

/** What a search hit's row says under the name. */
export function hitNote(hit: ProgramHit): string {
  if (hit.blocked === "antivirus") return "Antivirus — programs can't be antivirus software";
  if (hit.claimed) return "Taken tonight";
  return hit.description;
}

/** May this hit be picked? */
export function hitPickable(hit: ProgramHit): boolean {
  return !hit.claimed && hit.blocked === null;
}
