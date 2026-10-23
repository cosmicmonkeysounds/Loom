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

/**
 * The history after another director's save of one part of the document
 * (`key`: the speakers, the lights) was adopted: every entry takes the
 * adopted `value`, so the other parts' steps still undo, and a step that
 * only changed that part (now the same document twice: every other part
 * the same value as its neighbour) disappears. The present wins a tie.
 */
export function rebaseField<D extends object, K extends keyof D>(h: History<D>, present: D, key: K, value: D[K]): History<D> {
  const line = [...h.past.map((d) => ({ d, now: false })), { d: present, now: true }, ...[...h.future].reverse().map((d) => ({ d, now: false }))];
  const others = (Object.keys(present) as (keyof D)[]).filter((k) => k !== key);
  const same = (a: D, b: D): boolean => others.every((k) => a[k] === b[k]);
  const kept: { d: D; now: boolean }[] = [];
  for (const x of line) {
    const last = kept[kept.length - 1];
    if (last !== undefined && same(last.d, x.d)) {
      if (x.now) kept[kept.length - 1] = x;
      continue;
    }
    kept.push(x);
  }
  const at = kept.findIndex((x) => x.now);
  const re = (x: { d: D }): D => ({ ...x.d, [key]: value });
  return { past: kept.slice(0, at).map(re), future: kept.slice(at + 1).map(re).reverse() };
}
