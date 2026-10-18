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
 *  server's 🦆 — moves `fired` but never LAST), else the cue a new press
 *  re-fired (LAST again, 📋 per question, or an aside again: only the press
 *  count moves); null when nothing moved. */
export function movedCue(prev: Pick<CueMarks, 'last' | 'fired' | 'presses'>, next: Pick<CueMarks, 'last' | 'fired' | 'presses' | 'pressed'>): string | null {
  if (next.last !== prev.last && next.last !== null) return next.last
  if (next.fired.length > prev.fired.length) return next.fired[next.fired.length - 1] ?? null
  if (typeof next.presses === 'number' && typeof prev.presses === 'number' && next.presses > prev.presses) return next.pressed ?? null
  return null
}

/** Was `id` this console's own press (any surface), sent within `OWN_MS`? */
export function ownMove(own: OwnPress | null, id: string | null, now: number): boolean {
  return own !== null && id !== null && foldKey(own.name) === foldKey(id) && now - own.at < OWN_MS
}

/** How long a press may hang (venue Wi-Fi) before it counts as failed and
 *  the cues unlock. */
export const PRESS_TIMEOUT_MS = 8000

/** What a press that never answered reads as. It may still land: LAST says. */
export const NO_ANSWER = `no answer in ${PRESS_TIMEOUT_MS / 1000} s — check LAST before pressing again`

/** `p`, or `late()` once `ms` pass without an answer. */
export function within<T>(p: Promise<T>, ms: number, late: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const out = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(late()), ms)
  })
  return Promise.race([p, out]).finally(() => clearTimeout(timer))
}
