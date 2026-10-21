//! Undo / redo over map drafts — pure. Every edit is a whole value (the
//! ops never mutate), so the history is two stacks of plain values: `past`
//! (newest last) and `future` (the next redo last). The page keeps one
//! history of `{house, audio}` pairs (`audio.ts` `Doc`), so a map edit, a
//! speaker edit and a map edit that carries speakers each undo in one step.

import type { HouseMap } from "@loom/house";

export interface History<T = HouseMap> {
  past: T[];
  future: T[];
}

/** How many steps back the editor remembers. */
export const HISTORY_DEPTH = 100;

export const EMPTY_HISTORY: History = { past: [], future: [] };

/** An empty history of any value (the page's `{house, audio}` pairs). */
export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] };
}

/** A new edit replaces `current`: it goes on the undo stack and the redo stack clears. */
export function pushed<T>(h: History<T>, current: T): History<T> {
  return { past: [...h.past.slice(-(HISTORY_DEPTH - 1)), current], future: [] };
}

/** One step back from `current`, or null when there is none. */
export function undone<T>(h: History<T>, current: T): { history: History<T>; present: T } | null {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return null;
  return { history: { past: h.past.slice(0, -1), future: [...h.future, current] }, present: prev };
}

/** One step forward again, or null when there is none. */
export function redone<T>(h: History<T>, current: T): { history: History<T>; present: T } | null {
  const next = h.future[h.future.length - 1];
  if (next === undefined) return null;
  return { history: { past: [...h.past, current], future: h.future.slice(0, -1) }, present: next };
}
