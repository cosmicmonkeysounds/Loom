//! A performer's own ticks (wave 13 fix round): a checklist to-do with no
//! `done when` (`done: null`) is nothing the story can tick, so on a booth
//! the performer ticks it by hand — "🎀 the ribbon", given. Kept per
//! sign-in, objective and label in the host's storage (localStorage on a
//! phone, memory in a Run → Players pane); every read and write is guarded,
//! so a private window or blocked storage only forgets the ticks. A to-do
//! the story tracks (`done: true | false`) is never tappable.

import type { SessionStorage } from "../host.ts";
import type { ObjectiveCheck, ObjectiveView } from "../types.ts";

/** One storage key for the booth; the sign-in rides inside it, so a new sign-in starts clean. */
export const TICKS_KEY = "loom.booth.ticks";

/** The most ticks kept (a night has far fewer). */
export const TICKS_MAX = 400;

/** A tick's key: the objective and the to-do's label. */
export function tickKey(objective: string, label: string): string {
  return `${objective}\u0000${label}`;
}

/** May the performer tick this to-do by hand? Only one the story cannot tick. */
export function tickable(c: Pick<ObjectiveCheck, "done">): boolean {
  return c.done === null;
}

/** Is to-do `label` of objective `objective` done: the story's verdict, else the performer's tick. */
export function checkDone(c: Pick<ObjectiveCheck, "done" | "label">, objective: string, ticks: ReadonlySet<string>): boolean {
  return c.done === true || (c.done === null && ticks.has(tickKey(objective, c.label)));
}

/** The ticks this sign-in made (empty for another sign-in, or unreadable storage). */
export function loadTicks(storage: SessionStorage, session: string | null): Set<string> {
  if (session === null) return new Set();
  try {
    const stored = storage.load<{ session?: unknown; keys?: unknown }>(TICKS_KEY);
    if (stored === null || stored.session !== session || !Array.isArray(stored.keys)) return new Set();
    return new Set(stored.keys.filter((k): k is string => typeof k === "string"));
  } catch {
    return new Set();
  }
}

export function saveTicks(storage: SessionStorage, session: string | null, ticks: ReadonlySet<string>): void {
  if (session === null) return;
  try {
    storage.save(TICKS_KEY, { session, keys: [...ticks].slice(-TICKS_MAX) });
  } catch {
    /* storage blocked: the ticks last until the page reloads */
  }
}

/** Tick or untick one to-do (a new set). */
export function toggleTick(ticks: ReadonlySet<string>, objective: string, label: string): Set<string> {
  const next = new Set(ticks);
  const k = tickKey(objective, label);
  if (next.has(k)) next.delete(k);
  else next.add(k);
  return next;
}

/** The objective's to-dos as a booth reads them, with the performer's ticks folded in (for `checkCount`). */
export function withTicks(o: ObjectiveView, ticks: ReadonlySet<string>): ObjectiveView {
  if (!o.checklist.some((c) => c.done === null)) return o;
  return { ...o, checklist: o.checklist.map((c) => (c.done === null && ticks.has(tickKey(o.id, c.label)) ? { ...c, done: true } : c)) };
}
