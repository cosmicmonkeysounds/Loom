//! How the cue state moved between two snapshots (pure): which cue it was,
//! and whether this console pressed it. An arm made against the old state
//! is stale ("Cues moved: <that cue> just fired. Re-arm."), and a LAST this
//! console did not press flashes who moved it.

import type { CueMarks } from '@loom/core/cue-sheet'
import type { OwnPress } from '@/store/cockpit'
import { foldKey } from './glance'

/** How long after sending a press its LAST still counts as this console's. */
export const OWN_MS = 10_000

/** The cue that moved the state from `prev` to `next`: the new LAST, else
 *  the cue newly appended to `fired` (an aside's first press — 🔄, ❌, the
 *  server's 🦆 — moves `fired` but never LAST); null when nothing moved. */
export function movedCue(prev: Pick<CueMarks, 'last' | 'fired'>, next: Pick<CueMarks, 'last' | 'fired'>): string | null {
  if (next.last !== prev.last && next.last !== null) return next.last
  if (next.fired.length > prev.fired.length) return next.fired[next.fired.length - 1] ?? null
  return null
}

/** Was `id` this console's own press (any surface), sent within `OWN_MS`? */
export function ownMove(own: OwnPress | null, id: string | null, now: number): boolean {
  return own !== null && id !== null && foldKey(own.name) === foldKey(id) && now - own.at < OWN_MS
}
