//! The live OBJECTIVEs a participant's phone shows (wave 13): the Inspector's
//! *Their view* lists them off the exact lens (`GuestView.objectives` /
//! `PrimeView.objectives`, the server's own `objectivesFor`), so a director
//! reads the guest's or the booth's NOW objective and checklist without
//! opening their phone. Pure, tested in `objectives.test.ts`.

import type { ObjectiveView } from '@loom/core/views'

/** One checklist line as the Inspector draws it. */
export const CheckState = {
  /** `done when` holds now. */
  Done: 'done',
  /** `done when` does not hold yet. */
  Open: 'open',
  /** A to-do with no condition (the story can't tell). */
  Todo: 'todo',
} as const
export type CheckState = (typeof CheckState)[keyof typeof CheckState]

export interface ObjectiveRow {
  id: string
  title: string
  /** The first live objective is the phone's NOW. */
  now: boolean
  act: string | null
  brief: string
  loud: boolean
  checks: Array<{ label: string; state: CheckState; glyph: string }>
  /** `done of total` over the checks that have a condition; null when none has one. */
  progress: string | null
  /** The interaction ids (plus `pass` / `scan`) the objective offers this viewer. */
  buttons: string[]
}

const GLYPH: Record<CheckState, string> = { done: '☑', open: '☐', todo: '·' }

/** The exact lens's objectives as rows, in model order (NOW first). An
 *  older server sends none: an empty list. */
export function objectiveRows(objectives: readonly ObjectiveView[] | undefined): ObjectiveRow[] {
  return (objectives ?? []).map((o, i) => {
    const checks = o.checklist.map((c) => {
      const state: CheckState = c.done === true ? CheckState.Done : c.done === false ? CheckState.Open : CheckState.Todo
      return { label: c.label, state, glyph: GLYPH[state] }
    })
    const judged = checks.filter((c) => c.state !== CheckState.Todo)
    return {
      id: o.id,
      title: o.title,
      now: i === 0,
      act: o.act,
      brief: o.brief,
      loud: o.loud === true,
      checks,
      progress: judged.length === 0 ? null : `${judged.filter((c) => c.state === CheckState.Done).length} of ${judged.length}`,
      buttons: [...o.buttons],
    }
  })
}

/** The button ids as labels: an interaction's own label where the view
 *  lists it, `📷 Scan` / `🎟 Pass` for the two built-ins, else the id. */
export function objectiveButtonLabels(buttons: readonly string[], interactions: ReadonlyArray<{ id: string; label: string }>): string[] {
  return buttons.map((b) => {
    if (b === 'scan') return '📷 Scan'
    if (b === 'pass') return '🎟 Pass'
    return interactions.find((i) => i.id === b)?.label ?? b
  })
}
