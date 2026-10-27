//! How the cue state moved between two snapshots (pure): which cue it was,
//! and whether this console pressed it. An arm made against the old state
//! is stale ("Cues moved: <that cue> just fired. Re-arm."), and a LAST this
//! console did not press flashes who moved it.

import { armWindow, type Armed, type CueMarks } from '@loom/core/cue-sheet'
import type { FireResult, OwnPress } from '@/store/cockpit'
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

/** How long a landed press keeps every cue locked waiting for the snapshot
 *  that carries it (the phone's `REPOLL_WAIT_MS`): a console that lags past
 *  this unlocks anyway. */
export const SETTLE_MS = 3000

/** Has this console's own press reached its marks: the server's count after
 *  the press (`FireResult.presses`) against the count the marks show. With
 *  either unknown (the local backend, an older server) there is nothing to
 *  wait for. Until it has, a next arm would bind to a count from before the
 *  press — and its own press would then read as "Cues moved". */
export function pressSettled(want: number | undefined, seen: number | undefined): boolean {
  return typeof want !== 'number' || typeof seen !== 'number' || seen >= want
}

/** The cue a 409 `moved` banner names: the server's own newest press (the
 *  409's fresh `cues.pressed`), else what the marks last showed. */
export function movedPressedCue(fromServer: string | null | undefined, fromMarks: string | null | undefined): string | null {
  return fromServer !== undefined ? fromServer : (fromMarks ?? null)
}

/** The press count a press's answer holds the lock for, or null to unlock
 *  now: the server's count after a taken (or story-refused) press, and —
 *  just as much — the count a 409 `moved` reported (the press that beat
 *  this one). Without the second, a console whose marks lag re-arms on the
 *  count from before that press, and the re-armed press is refused as moved
 *  again. A failed press, no count, or marks that already show it: null. */
export function settleTarget(res: FireResult, seen: number | undefined): number | null {
  if (res.error !== undefined || typeof res.presses !== 'number') return null
  return pressSettled(res.presses, seen) ? null : res.presses
}

/** Ms until `armed` lapses at `now` (never below 0): its own window
 *  (`armWindow`: 4 s, or 10 s for a cue armed through the who? picker). */
export function armLapsesIn(armed: Pick<Armed, 'at' | 'ms'>, now: number): number {
  return Math.max(0, armed.at + armWindow(armed) - now)
}
