//! What every part of the Director page shares: the cue rows and their
//! acts, the one arm model, the award fields, the key cursor and the
//! Calling / Watching mode. Provided by `DirectorTab`.

import { createContext, useContext } from 'react'
import type { CueAct, CueRow } from '@loom/core/cue-sheet'
import type { ArmedApi } from './useArmed'
import type { AwardFieldsApi } from './useAwardFields'
import type { DirectorMode } from './director-keys'

export interface DirectorCtx {
  rows: CueRow[]
  acts: CueAct[]
  /** The focus act's index (-1: none). */
  focus: number
  /** Each row's act (by row id). */
  actOf: ReadonlyMap<string, CueAct>
  arm: ArmedApi
  awards: AwardFieldsApi
  cursor: string | null
  setCursor(id: string | null): void
  mode: DirectorMode
  /** Open an act in the running order and scroll to it (the stepper). */
  showAct(key: string): void
}

export const DirectorContext = createContext<DirectorCtx | null>(null)

export function useDirector(): DirectorCtx {
  const c = useContext(DirectorContext)
  if (c === null) throw new Error('useDirector outside the Director page')
  return c
}

/** An act's short name: its code, else its title, else "the sheet". */
export function actName(act: CueAct | undefined): string {
  if (act === undefined) return 'the sheet'
  return act.code ?? act.title ?? 'the sheet'
}

/** The warning an armed cue carries — never a block (a `while:` never
 *  stops a press). */
export function outOfTurn(row: CueRow, d: Pick<DirectorCtx, 'acts' | 'focus' | 'actOf'>): string | null {
  if (!row.live) return '⚠ Not on offer now: the story may refuse it'
  const focus = d.acts[d.focus]
  const act = d.actOf.get(row.id)
  if (row.sequence && focus !== undefined && act !== undefined && act.key !== focus.key && act.state !== 'anytime') {
    return `⚠ This is a ${actName(act)} cue; the night is in ${actName(focus)}`
  }
  return null
}
