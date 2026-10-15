//! Undo / redo over map drafts — pure. Every edit is a whole map value
//! (the ops never mutate), so the history is two stacks of plain values:
//! `past` (newest last) and `future` (the next redo last).

import type { HouseMap } from "@loom/house";

export interface History {
  past: HouseMap[];
  future: HouseMap[];
}

/** How many steps back the editor remembers. */
export const HISTORY_DEPTH = 100;

export const EMPTY_HISTORY: History = { past: [], future: [] };

/** A new edit replaces `current`: it goes on the undo stack and the redo stack clears. */
export function pushed(h: History, current: HouseMap): History {
  return { past: [...h.past.slice(-(HISTORY_DEPTH - 1)), current], future: [] };
}

/** One step back from `current`, or null when there is none. */
export function undone(h: History, current: HouseMap): { history: History; present: HouseMap } | null {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return null;
  return { history: { past: h.past.slice(0, -1), future: [...h.future, current] }, present: prev };
}

/** One step forward again, or null when there is none. */
export function redone(h: History, current: HouseMap): { history: History; present: HouseMap } | null {
  const next = h.future[h.future.length - 1];
  if (next === undefined) return null;
  return { history: { past: [...h.past, current], future: h.future.slice(0, -1) }, present: next };
}
