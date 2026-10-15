//! Event arguments that name a place, folded onto the declared LOCATION.
//!
//! A story compares a `room` argument with plain string equality
//! (`room == "The Start Bar"`), and the cue it emits (`<cue: lights, room:
//! {room}, …>`) must match stagehand's rule exactly. An agent (or a director
//! typing into Run) writes "the start bar" or "the_start_bar" just as often, so the
//! server folds such a value (case, `_` / `-`, runs of spaces — `foldName`)
//! onto the exact declared LOCATION name, or its `label:`, before the
//! signal is journaled. Only the place-shaped keys below: a free-text
//! argument (`text`) is never rewritten.

import { foldName } from "../src/parser/names.ts";

export const PLACE_ARG_KEYS: ReadonlySet<string> = new Set(["room", "at", "location", "place"]);

type Args = Record<string, unknown>;

/** `args` with every place-shaped string value that folds to a LOCATION
 *  replaced by that LOCATION's exact name; anything else is kept as is. */
export function canonicalPlaceArgs<T extends Args>(args: T, locations: Iterable<{ id: string; label: string | null }>): T {
  let byFold: Map<string, string> | null = null;
  let out: Args | null = null;
  for (const [k, v] of Object.entries(args)) {
    if (!PLACE_ARG_KEYS.has(k) || typeof v !== "string") continue;
    if (byFold === null) {
      byFold = new Map();
      for (const l of locations) {
        byFold.set(foldName(l.id), l.id);
        if (l.label !== null && !byFold.has(foldName(l.label))) byFold.set(foldName(l.label), l.id);
      }
    }
    const id = byFold.get(foldName(v));
    if (id !== undefined && id !== v) (out ??= { ...args })[k] = id;
  }
  return (out ?? args) as T;
}
