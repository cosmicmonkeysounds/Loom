//! The phone's credits (wave 44, C7): when the roll opens by itself and
//! what keeps it waiting. Pure; only the lazy chunk (`roll.tsx`) imports it,
//! so none of it is in the guest's first load (⊞ Start's item is in
//! `lazy.tsx`, the eager part).
//!
//! The story starts a roll by raising `Night.credits_roll`
//! (`NightView.credits`). A phone that sees it rise **live** opens the roll
//! full screen once (never on the first view after a load, never embedded
//! in Run → Players, only within `CREDITS_FRESH_MS` of the roll's `at` on
//! the story clock, the glitch takeover's rule in `moments/model.ts`
//! `takeoverDue`), remembers the roll per event in the host storage, and
//! waits behind the full pass, a `!!` takeover or the glitch.

import type { NightView } from "../types.ts";

export type NightCredits = NonNullable<NightView["credits"]>;

/** How fresh (story ms) a roll must be to open the phone by itself. */
export const CREDITS_FRESH_MS = 60_000;

/** The host-storage key holding the last roll this phone opened by itself, per event. */
export function creditsKey(eventId: string): string {
  return `loom.credits.${eventId}`;
}

/** The stored roll, or null for nothing (or anything that isn't one). */
export function seenRollOf(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * Does the roll open this phone now? Only live: never embedded, never on a
 * first view (a reload, a new sign-in), only for a roll above the last one
 * this provider saw (`prevRoll`) and above the one this phone already
 * opened (`seen`, from storage), and only within `CREDITS_FRESH_MS` of its
 * `at` on the story clock.
 */
export function creditsDue(prevRoll: number | null, credits: NightCredits | null | undefined, clock: number | undefined, firstView: boolean, embedded: boolean, seen: number | null): boolean {
  if (embedded || firstView || credits == null || clock === undefined) return false;
  if (!(credits.roll > 0) || (prevRoll !== null && credits.roll <= prevRoll) || (seen !== null && credits.roll <= seen)) return false;
  const age = clock - credits.at;
  return age >= 0 && age <= CREDITS_FRESH_MS;
}

/** What keeps an open roll off the screen (it waits, its clock stopped). */
export interface CreditsCover {
  /** The full-screen pass is up. */
  pass?: boolean;
  /** A `!!` takeover pin is up. */
  takeover?: boolean;
  /** The glitch takeover is playing. */
  glitch?: boolean;
  /** A booth face to face (the scanner, a guest card, PLAYER SELECT). */
  face?: boolean;
}

/** Is an open roll on screen now? */
export function creditsShown(open: boolean, cover: CreditsCover): boolean {
  return open && cover.pass !== true && cover.takeover !== true && cover.glitch !== true && cover.face !== true;
}
