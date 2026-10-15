//! The director's cue sheet (K-21), as pure data.
//!
//! The story declares its `who: admin` INTERACTIONs in running order, each
//! label opening with the source cue code (`C1/V1 · 📣 Call everyone to the
//! Desktop`). This module turns those into rows the Director page renders
//! as one-click buttons: the code split off, the last cue marked, the next
//! one (the declaration after the last) suggested, a free-text filter, and
//! the story's `Night.phase` read off the world.

import type { CueState, InteractionSummary } from '@loom/core/views'
import type { WorldEntry } from '@/store/cockpit'

export interface CueRow {
  /** The INTERACTION id — the named event the button fires. */
  id: string
  /** 1-based position in the declared order. */
  n: number
  /** The source cue code (`C1/V1`, `V2`, `Clippy 2/X`), or null. */
  code: string | null
  /** The label without its code. */
  title: string
  /** Fired at least once tonight. */
  fired: boolean
  /** The most recent cue to fire. */
  last: boolean
  /** The cue after the last one in running order. */
  next: boolean
  /** The cue does nothing without a person (an award's winner): the sheet
   *  asks for one before it fires. */
  subject: boolean
}

/** A code is the label's first ` · `-separated part, if it is short. */
const CODE_MAX = 12

export function splitCode(label: string): { code: string | null; title: string } {
  const at = label.indexOf(' · ')
  if (at > 0 && at <= CODE_MAX) return { code: label.slice(0, at).trim(), title: label.slice(at + 3).trim() }
  return { code: null, title: label.trim() }
}

/** Every admin cue in declared order, marked against the cue state. */
export function cueRows(interactions: InteractionSummary[], cues: CueState): CueRow[] {
  const fired = new Set(cues.fired)
  const admin = interactions.filter((i) => i.who === 'admin')
  const lastIdx = cues.last === null ? -1 : admin.findIndex((i) => i.id === cues.last)
  return admin.map((i, idx) => {
    const { code, title } = splitCode(i.label || i.id)
    return {
      id: i.id,
      n: idx + 1,
      code,
      title,
      fired: fired.has(i.id),
      last: idx === lastIdx,
      next: idx === lastIdx + 1,
      subject: i.subject === true,
    }
  })
}

/** Rows whose code, label or id contain every word of `query` (case-folded). */
export function filterCues(rows: CueRow[], query: string): CueRow[] {
  const words = query.toLowerCase().split(/\s+/u).filter((w) => w !== '')
  if (words.length === 0) return rows
  return rows.filter((r) => {
    const hay = `${r.code ?? ''} ${r.title} ${r.id}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/** The story's `Night.phase` (quotes stripped), or null when unset. */
export function nightPhase(world: WorldEntry[]): string | null {
  const e = world.find((w) => w.path === 'Night.phase')
  if (e === undefined) return null
  const v = e.value.replace(/^"(.*)"$/u, '$1').trim()
  return v === '' || v === 'null' ? null : v
}

/** A person-cue's optional `value` box (the number the award line reads):
 *  empty → no arguments, a number → a number, anything else → the text. */
export function cueValueArgs(raw: string): { value: string | number } | null {
  const t = raw.trim()
  if (t === '') return null
  return { value: /^-?\d+(\.\d+)?$/u.test(t) ? Number(t) : t }
}
