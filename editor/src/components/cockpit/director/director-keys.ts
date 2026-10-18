//! The Director page's keyboard (wave 10, spec §4.2), as a pure reducer:
//! `directorKey(state, key, ctx) → {state, effect, handled}`. Calling mode
//! only — a console in Watching mode never acts on a key. Firing always
//! takes two strokes: the first arms (core's `tapCue`, the same arm model
//! the phone uses), a second one ≥ `ARM_DEAD_MS` later fires.
//!
//! | key        | nothing armed                               | armed          |
//! |------------|---------------------------------------------|----------------|
//! | Space      | arm NEXT (or say "nothing to press")        | fire           |
//! | Enter      | arm the cursor row, else NEXT (a subject cue opens its picker) | fire |
//! | Esc        | clear the cursor, then the filter           | disarm         |
//! | j / ↓, k / ↑ | move the cursor through the visible cues  | disarm, move   |
//! | /          | focus the filter                            | —              |
//! | .          | scroll NEXT (or LAST) into view             | —              |
//!
//! Enter and Space on a focused button that is not a cue (Tools' Fire, the
//! mode toggle, an ⓘ) are that button's; Enter on a focused cue presses
//! that cue. A cursor on a row no longer on screen is dropped.

import { tapCue, type Armed, type CueMarks, type CueRow } from '@loom/core/cue-sheet'

export const DirectorMode = {
  Calling: 'calling',
  Watching: 'watching',
} as const
export type DirectorMode = (typeof DirectorMode)[keyof typeof DirectorMode]

export interface KeyState {
  armed: Armed | null
  /** The cue the j / k cursor sits on. */
  cursor: string | null
}

export interface KeyInput {
  key: string
  repeat?: boolean
  meta?: boolean
  ctrl?: boolean
  alt?: boolean
  /** The event came from an input / select / textarea / contenteditable. */
  editable?: boolean
  /** The event came from a focused native control that Enter / Space
   *  activates (a button, a `<summary>`, a link) and that is not a cue —
   *  the Tools drawer's Fire / Send, the mode toggle, an ⓘ, a glance link.
   *  Enter and Space are that control's, never the page's. */
  control?: boolean
  /** The event came from this cue's own focused button: Enter presses that
   *  cue (its click), Space stays the page's (NEXT). */
  cue?: string | null
}

export interface KeyCtx {
  mode: DirectorMode
  now: number
  /** Every row (to look an id up). */
  rows: readonly CueRow[]
  /** The ids the cursor walks, in DOM order (visible spine rows, then the
   *  On hand chips). */
  order: readonly string[]
  marks: CueMarks
  /** The filter's text (Esc clears it once nothing else is left to clear). */
  filter: string
  /** A press is in flight, or NEXT is cooling down: a fire key does nothing. */
  locked?: boolean
}

export type KeyEffect =
  | { kind: 'none' }
  | { kind: 'fire'; id: string; subject: string | null; value?: string }
  | { kind: 'pick'; id: string }
  | { kind: 'nothing-to-press' }
  | { kind: 'clear-filter' }
  | { kind: 'focus-filter' }
  | { kind: 'scroll'; id: string }

export interface KeyResult {
  state: KeyState
  effect: KeyEffect
  /** The page handled the key: `preventDefault` + `stopPropagation`. */
  handled: boolean
}

const NONE: KeyEffect = { kind: 'none' }

function pass(state: KeyState): KeyResult {
  return { state, effect: NONE, handled: false }
}

/** A tap on `row` as a key result (arm / pick / fire / ignore). */
function tap(state: KeyState, row: CueRow, ctx: KeyCtx): KeyResult {
  const t = tapCue(state.armed, row, ctx.now, ctx.marks)
  switch (t.kind) {
    case 'arm':
      return { state: { ...state, armed: t.armed }, effect: NONE, handled: true }
    case 'pick':
      return { state: { ...state, armed: null, cursor: row.id }, effect: { kind: 'pick', id: row.id }, handled: true }
    case 'fire':
      return {
        state: { ...state, armed: null },
        effect: { kind: 'fire', id: t.id, subject: t.subject, ...(t.value !== undefined ? { value: t.value } : {}) },
        handled: true,
      }
    default:
      return { state, effect: NONE, handled: true }
  }
}

function move(state: KeyState, ctx: KeyCtx, step: 1 | -1): KeyResult {
  const order = ctx.order
  if (order.length === 0) return { state: { ...state, armed: null }, effect: NONE, handled: true }
  const at = state.cursor === null ? -1 : order.indexOf(state.cursor)
  const nextAt = at < 0 ? (step === 1 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, at + step))
  const cursor = order[nextAt]!
  return { state: { armed: null, cursor }, effect: { kind: 'scroll', id: cursor }, handled: true }
}

export function directorKey(state: KeyState, key: KeyInput, ctx: KeyCtx): KeyResult {
  if (ctx.mode !== DirectorMode.Calling) return pass(state)
  if (key.editable === true || key.meta === true || key.ctrl === true || key.alt === true || key.repeat === true) return pass(state)
  const activates = key.key === 'Enter' || key.key === ' ' || key.key === 'Spacebar'
  if (activates && key.control === true) return pass(state)
  if (key.key === 'Enter' && key.cue !== undefined && key.cue !== null) return pass(state)
  const byId = (id: string | null) => (id === null ? undefined : ctx.rows.find((r) => r.id === id))
  const next = ctx.rows.find((r) => r.next)
  // A cursor on a row that is no longer on screen (its act folded, the
  // filter cleared) is gone: Enter never reaches a cue nobody can see.
  if (state.cursor !== null && !ctx.order.includes(state.cursor)) state = { ...state, cursor: null }
  switch (key.key) {
    case ' ':
    case 'Spacebar': {
      if (state.armed !== null) {
        if (ctx.locked === true) return { state, effect: NONE, handled: true }
        const row = byId(state.armed.id)
        return row === undefined ? { state: { ...state, armed: null }, effect: NONE, handled: true } : tap(state, row, ctx)
      }
      if (next === undefined) return { state, effect: { kind: 'nothing-to-press' }, handled: true }
      if (ctx.locked === true) return { state, effect: NONE, handled: true }
      return tap(state, next, ctx)
    }
    case 'Enter': {
      if (ctx.locked === true) return { state, effect: NONE, handled: true }
      if (state.armed !== null) {
        const row = byId(state.armed.id)
        return row === undefined ? { state: { ...state, armed: null }, effect: NONE, handled: true } : tap(state, row, ctx)
      }
      const row = byId(state.cursor) ?? next
      if (row === undefined) return { state, effect: { kind: 'nothing-to-press' }, handled: true }
      return tap(state, row, ctx)
    }
    case 'Escape': {
      if (state.armed !== null) return { state: { ...state, armed: null }, effect: NONE, handled: true }
      if (state.cursor !== null) return { state: { ...state, cursor: null }, effect: NONE, handled: true }
      if (ctx.filter !== '') return { state, effect: { kind: 'clear-filter' }, handled: true }
      return pass(state)
    }
    case 'j':
    case 'ArrowDown':
      return move(state, ctx, 1)
    case 'k':
    case 'ArrowUp':
      return move(state, ctx, -1)
    case '/':
      return { state, effect: { kind: 'focus-filter' }, handled: true }
    case '.': {
      const target = next ?? ctx.rows.find((r) => r.last)
      return target === undefined ? { state, effect: NONE, handled: true } : { state, effect: { kind: 'scroll', id: target.id }, handled: true }
    }
    default:
      return pass(state)
  }
}
