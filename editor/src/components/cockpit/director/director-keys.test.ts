import { describe, expect, it } from 'vitest'
import { cueRows, type CueInteraction, type CueMarks } from '@loom/core/cue-sheet'
import { DirectorMode, directorKey, type KeyCtx, type KeyState } from './director-keys'

const IX: CueInteraction[] = [
  { id: 'open_doors', label: 'A1 · 🚪 Open the doors', who: 'admin', act: 'A · Doors' },
  { id: 'award_most_trusted', label: 'G2 · 🥇 Most Trusted', who: 'admin', subject: true },
  { id: 'last_call', label: 'B1 · 🔔 Last call', who: 'admin' },
]
const MARKS: CueMarks = { last: null, fired: [] }
const rows = cueRows(IX, MARKS)
const EMPTY: KeyState = { armed: null, cursor: null }
const ctx = (now: number, extra: Partial<KeyCtx> = {}): KeyCtx => ({
  mode: DirectorMode.Calling,
  now,
  rows,
  order: rows.map((r) => r.id),
  marks: MARKS,
  filter: '',
  ...extra,
})

describe('directorKey', () => {
  it('space arms NEXT, space fires after 300 ms', () => {
    const armed = directorKey(EMPTY, { key: ' ' }, ctx(1000))
    expect(armed).toMatchObject({ handled: true, effect: { kind: 'none' } })
    expect(armed.state.armed).toMatchObject({ id: 'open_doors', at: 1000, last: null, firedCount: 0 })
    // Inside the dead time: still armed, nothing fires.
    const early = directorKey(armed.state, { key: ' ' }, ctx(1200))
    expect(early.effect.kind).toBe('none')
    expect(early.state.armed?.id).toBe('open_doors')
    const fired = directorKey(early.state, { key: ' ' }, ctx(1400))
    expect(fired.effect).toEqual({ kind: 'fire', id: 'open_doors', subject: null })
    expect(fired.state.armed).toBeNull()
  })

  it('space with nothing to press says so', () => {
    const none = cueRows(IX, { last: 'last_call', fired: ['open_doors', 'last_call'] })
    expect(directorKey(EMPTY, { key: ' ' }, ctx(0, { rows: none })).effect.kind).toBe('nothing-to-press')
  })

  it('enter on a subject cue opens the picker', () => {
    const down = directorKey(EMPTY, { key: 'j' }, ctx(0))
    const onAward = directorKey(down.state, { key: 'ArrowDown' }, ctx(0))
    expect(onAward.state.cursor).toBe('award_most_trusted')
    const enter = directorKey(onAward.state, { key: 'Enter' }, ctx(0))
    expect(enter.effect).toEqual({ kind: 'pick', id: 'award_most_trusted' })
    expect(enter.state.armed).toBeNull()
    // Enter with no cursor arms NEXT.
    expect(directorKey(EMPTY, { key: 'Enter' }, ctx(0)).state.armed?.id).toBe('open_doors')
  })

  it('esc disarms before clearing the filter', () => {
    const armed = directorKey({ armed: null, cursor: 'last_call' }, { key: 'Enter' }, ctx(0, { filter: 'call' }))
    expect(armed.state.armed?.id).toBe('last_call')
    const disarm = directorKey(armed.state, { key: 'Escape' }, ctx(10, { filter: 'call' }))
    expect(disarm).toMatchObject({ handled: true, effect: { kind: 'none' }, state: { armed: null, cursor: 'last_call' } })
    const uncursor = directorKey(disarm.state, { key: 'Escape' }, ctx(20, { filter: 'call' }))
    expect(uncursor.state.cursor).toBeNull()
    expect(directorKey(uncursor.state, { key: 'Escape' }, ctx(30, { filter: 'call' })).effect.kind).toBe('clear-filter')
    expect(directorKey(uncursor.state, { key: 'Escape' }, ctx(30)).handled).toBe(false)
  })

  it('keys are ignored in Watching mode', () => {
    for (const key of [' ', 'Enter', 'Escape', 'j', '/', '.']) {
      const r = directorKey(EMPTY, { key }, ctx(0, { mode: DirectorMode.Watching }))
      expect(r).toEqual({ state: EMPTY, effect: { kind: 'none' }, handled: false })
    }
  })

  it('repeat keydown is ignored', () => {
    const armed = directorKey(EMPTY, { key: ' ' }, ctx(0)).state
    expect(directorKey(armed, { key: ' ', repeat: true }, ctx(600))).toMatchObject({ handled: false, state: armed, effect: { kind: 'none' } })
    // So are modifiers and keys typed into a field.
    expect(directorKey(armed, { key: ' ', meta: true }, ctx(600)).handled).toBe(false)
    expect(directorKey(armed, { key: ' ', editable: true }, ctx(600)).handled).toBe(false)
  })

  it('a stale arm re-arms instead of firing; a locked console fires nothing', () => {
    const armed = directorKey(EMPTY, { key: ' ' }, ctx(0)).state
    const moved = directorKey(armed, { key: ' ' }, ctx(600, { marks: { last: 'open_doors', fired: ['open_doors'] } }))
    expect(moved.effect.kind).toBe('none')
    expect(moved.state.armed).toMatchObject({ id: 'open_doors', at: 600, last: 'open_doors' })
    expect(directorKey(armed, { key: ' ' }, ctx(600, { locked: true })).effect.kind).toBe('none')
  })

  it('/ focuses the filter and . scrolls to NEXT', () => {
    expect(directorKey(EMPTY, { key: '/' }, ctx(0)).effect.kind).toBe('focus-filter')
    expect(directorKey(EMPTY, { key: '.' }, ctx(0)).effect).toEqual({ kind: 'scroll', id: 'open_doors' })
  })

  it('enter and space on a focused button are that button’s, not NEXT’s', () => {
    for (const key of [' ', 'Enter']) {
      expect(directorKey(EMPTY, { key, control: true }, ctx(0))).toEqual({ state: EMPTY, effect: { kind: 'none' }, handled: false })
    }
    // Enter on a focused cue presses that cue (its own click) …
    expect(directorKey(EMPTY, { key: 'Enter', cue: 'last_call' }, ctx(0)).handled).toBe(false)
    // … Space on it is still the page's: NEXT.
    expect(directorKey(EMPTY, { key: ' ', cue: 'last_call' }, ctx(0)).state.armed?.id).toBe('open_doors')
  })

  it('a cursor on a row no longer on screen never arms it', () => {
    const order = rows.filter((r) => r.id !== 'last_call').map((r) => r.id)
    const enter = directorKey({ armed: null, cursor: 'last_call' }, { key: 'Enter' }, ctx(0, { order }))
    expect(enter.state.armed?.id).toBe('open_doors')
    expect(enter.state.cursor).toBeNull()
    // j starts again from the top.
    expect(directorKey({ armed: null, cursor: 'last_call' }, { key: 'j' }, ctx(0, { order })).state.cursor).toBe('open_doors')
  })
})
