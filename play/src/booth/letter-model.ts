//! Wave 41 (C3): the performer's letter opt-in, pure (`letter.tsx` draws
//! it; `test/w41-booth-letter.test.ts`).

import { ApiError } from "../client.ts";
import type { SessionStorage } from "../host.ts";
import type { PrimeLetter } from "../types.ts";

export const LETTER_TITLE = "✉️ A letter from Jean Trabolta";
// DRAFT w41 (C3): the opt-in's copy.
export const LETTER_COPY = "When the night is over, Jean Trabolta writes to everyone who played. Leave an email if you want yours. Optional.";

/** One storage key per event + character: a *No thanks* there. */
export function letterDismissKey(eventId: string, character: string): string {
  return `loom.booth.letter:${eventId}:${character}`;
}

export function loadLetterDismissed(storage: SessionStorage, key: string): boolean {
  try {
    return storage.load<boolean>(key) === true;
  } catch {
    return false;
  }
}

export function saveLetterDismissed(storage: SessionStorage, key: string): void {
  try {
    storage.save(key, true);
  } catch {
    /* storage blocked: the card comes back on the next load */
  }
}

export type LetterCardState = "none" | "ask" | "onFile";

/** What the card shows: nothing without `letter`; the form while changing
 *  the address; the receipt with one on file; nothing once dismissed. */
export function letterCardState(letter: PrimeLetter | undefined, email: string | null, dismissed: boolean, editing: boolean): LetterCardState {
  if (letter === undefined) return "none";
  if (editing) return "ask";
  if (email !== null) return "onFile";
  return dismissed ? "none" : "ask";
}

/** A refused save, in plain words. */
export function letterErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 400) return "That doesn't look like an email address.";
    if (e.status === 403) return "This sign-in has no part to write to.";
  }
  return "Couldn't save it. Try again.";
}

/** Is the booth's home on screen (where the card lives), and no scan up?
 *  A player's home is Mission, a host's is Show, any other booth's the
 *  room list; on a phone an open room covers it. */
export function letterOnHome(o: { player: boolean; mission: boolean; host: boolean; showOnScreen: boolean; wide: boolean; roomOpen: boolean; scanning: boolean }): boolean {
  if (o.scanning) return false;
  if (o.player) return o.mission && (o.wide || !o.roomOpen);
  if (o.host) return o.showOnScreen;
  return o.wide || !o.roomOpen;
}
