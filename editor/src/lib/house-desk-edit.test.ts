// Run → House: the cue editor's pure edits (wave 25). Every op hands back a
// new desk, never touches the one it was given, and keeps the desk valid
// where it can (fresh ids, no screens prefixes).

import { describe, expect, it } from 'vitest'
import { validateDesk, type DeskConfig } from '@loom/core/house-desk'
import {
  addCue,
  addStep,
  clean,
  deleteCue,
  deleteStep,
  duplicateCue,
  duplicateStep,
  idFromName,
  moveCue,
  moveStep,
  newCue,
  newStep,
  sameDesk,
  setCue,
  setStep,
  setStepKind,
  setStepStart,
} from './house-desk-edit'

const desk = (): DeskConfig => ({
  version: 1,
  cues: [
    { id: 'preshow', name: 'Pre-show', section: 'Doors', steps: [{ kind: 'look', look: 'warm' }] },
    { id: 'heart', number: '12', name: 'The Heart wakes', steps: [{ kind: 'wait', ms: 500 }, { kind: 'event', event: 'heart_speaks', start: 'with' }] },
  ],
})

const HOUSE = {
  sounds: [{ name: 'server_hum', to: null, file: 'ok' as const, ms: 4000 }],
  looks: [{ name: 'heart_wake', to: ['The Server Room'], ms: 2000, loop: false }],
  fixtures: [{ id: 'server_room_rgb', name: 'RGB', room: 'server', roomName: 'Server room', kind: 'bulb', caps: { color: true, ct: true, dim: true }, safety: false, device: 'server_room_rgb', inZ2m: true }],
  rooms: ['The Server Room'],
  events: ['heart_speaks'],
}

describe('ids from names', () => {
  it('folds a name to an id the story can write after `cue`', () => {
    expect(idFromName('The Heart wakes!')).toBe('the_heart_wakes')
    expect(idFromName('  Café — 2.5 ')).toBe('cafe_2_5')
    expect(idFromName('!!!')).toBe('cue')
  })
  it('never takes a screens prefix, a taken id or a look name', () => {
    expect(idFromName('Room tone')).toBe('cue_room_tone')
    expect(idFromName('TV on')).toBe('cue_tv_on')
    expect(idFromName('Heart', ['heart', 'heart_2'])).toBe('heart_3')
    expect(idFromName('Warm', [], ['warm'])).toBe('warm_2')
  })
})

describe('cues', () => {
  it('adds a fresh cue at the end or at an index', () => {
    const d = desk()
    const c = newCue(d, 'Heart')
    expect(c).toEqual({ id: 'heart_2', name: 'Heart', steps: [] })
    const end = addCue(d, c)
    expect(end.index).toBe(2)
    expect(end.desk.cues.map((x) => x.id)).toEqual(['preshow', 'heart', 'heart_2'])
    const mid = addCue(d, c, 1)
    expect(mid.desk.cues.map((x) => x.id)).toEqual(['preshow', 'heart_2', 'heart'])
    expect(d.cues).toHaveLength(2)
  })

  it('duplicates a cue after itself with a fresh id and no section heading', () => {
    const d = desk()
    const { desk: next, index } = duplicateCue(d, 0)
    expect(index).toBe(1)
    expect(next.cues[1]).toEqual({ id: 'preshow_2', name: 'Pre-show copy', steps: [{ kind: 'look', look: 'warm' }] })
    // A deep copy: editing the copy's steps leaves the original alone.
    expect(next.cues[1]!.steps).not.toBe(d.cues[0]!.steps)
    expect(validateDesk(next).ok).toBe(true)
  })

  it('deletes a cue and picks the row that took its place', () => {
    expect(deleteCue(desk(), 0).index).toBe(0)
    expect(deleteCue(desk(), 1).index).toBe(0)
    const one: DeskConfig = { version: 1, cues: [desk().cues[0]!] }
    expect(deleteCue(one, 0)).toEqual({ desk: { version: 1, cues: [] }, index: null })
  })

  it('moves a cue, and refuses to move past either end', () => {
    expect(moveCue(desk(), 1, -1).desk.cues.map((c) => c.id)).toEqual(['heart', 'preshow'])
    expect(moveCue(desk(), 1, -1).index).toBe(0)
    expect(moveCue(desk(), 1, 1).desk.cues.map((c) => c.id)).toEqual(['preshow', 'heart'])
    expect(moveCue(desk(), 0, -1).index).toBe(0)
  })

  it('sets fields; blank optional ones are dropped', () => {
    const d = setCue(desk(), 1, { name: 'Heart', number: '', notes: 'by the door', done: 'heart_done' })
    expect(d.cues[1]).toEqual({ id: 'heart', name: 'Heart', notes: 'by the door', done: 'heart_done', steps: desk().cues[1]!.steps })
    expect(setCue(d, 1, { done: undefined }).cues[1]!.done).toBeUndefined()
    expect(setCue(desk(), 9, { name: 'x' })).toEqual(desk())
  })
})

describe('steps', () => {
  it('a new step of every kind validates against the house it was made from', () => {
    const kinds = ['sound', 'say', 'look', 'light', 'stop', 'event', 'speech', 'wait'] as const
    const d: DeskConfig = { version: 1, cues: [{ id: 'all', name: 'All', steps: kinds.map((k) => newStep(k, HOUSE)) }] }
    const v = validateDesk(d, { sounds: ['server_hum'], looks: ['heart_wake'], lightTargets: ['server_room_rgb'], rooms: ['The Server Room'], events: ['heart_speaks'] })
    expect(v.problems).toEqual([])
    expect(v.warnings).toEqual([])
    expect(newStep('sound', HOUSE)).toEqual({ kind: 'sound', sound: 'server_hum' })
    expect(newStep('light', {})).toMatchObject({ to: ['everywhere'] })
  })

  it('adds, duplicates (with ↑), deletes and moves steps', () => {
    const a = addStep(desk(), 0, { kind: 'wait', ms: 100 })
    expect(a.index).toBe(1)
    expect(a.desk.cues[0]!.steps).toHaveLength(2)
    const dup = duplicateStep(desk(), 0, 0)
    expect(dup.desk.cues[0]!.steps[1]).toEqual({ kind: 'look', look: 'warm', start: 'with' })
    const del = deleteStep(desk(), 1, 1)
    expect(del.desk.cues[1]!.steps).toEqual([{ kind: 'wait', ms: 500 }])
    expect(del.index).toBe(0)
    expect(deleteStep(del.desk, 1, 0).index).toBeNull()
    const mv = moveStep(desk(), 1, 1, -1)
    expect(mv.desk.cues[1]!.steps.map((s) => s.kind)).toEqual(['event', 'wait'])
    expect(mv.index).toBe(0)
  })

  it('sets fields immutably and clears optional ones', () => {
    const d = desk()
    const next = setStep(d, 1, 0, { ms: 900, wait: 200, note: 'breathe' })
    expect(next.cues[1]!.steps[0]).toEqual({ kind: 'wait', ms: 900, wait: 200, note: 'breathe' })
    expect(d.cues[1]!.steps[0]).toEqual({ kind: 'wait', ms: 500 })
    expect(setStep(next, 1, 0, { note: undefined }).cues[1]!.steps[0]).toEqual({ kind: 'wait', ms: 900, wait: 200 })
    // A patch never changes the kind.
    expect(setStep(d, 1, 0, { kind: 'sound' }).cues[1]!.steps[0]!.kind).toBe('wait')
  })

  it('changes a kind, keeping how the step starts, its wait and its note', () => {
    const d = setStep(desk(), 1, 1, { wait: 300, note: 'n' })
    expect(setStepKind(d, 1, 1, 'look', HOUSE).cues[1]!.steps[1]).toEqual({ kind: 'look', look: 'heart_wake', start: 'with', wait: 300, note: 'n' })
  })

  it('toggles with ↑ / then', () => {
    expect(setStepStart(desk(), 1, 1, false).cues[1]!.steps[1]).toEqual({ kind: 'event', event: 'heart_speaks' })
    expect(setStepStart(desk(), 0, 0, true).cues[0]!.steps[0]).toEqual({ kind: 'look', look: 'warm', start: 'with' })
  })
})

describe('helpers', () => {
  it('clean drops undefined keys only', () => {
    expect(clean({ a: 1, b: undefined, c: '' })).toEqual({ a: 1, c: '' })
  })
  it('sameDesk compares content', () => {
    expect(sameDesk(desk(), desk())).toBe(true)
    expect(sameDesk(desk(), setCue(desk(), 0, { name: 'x' }))).toBe(false)
  })
})
