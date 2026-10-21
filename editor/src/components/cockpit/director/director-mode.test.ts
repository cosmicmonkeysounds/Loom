// Wave 18 (B8, Q1): on an event server that knows callers, Run's Calling /
// Watching is the server's one caller claim — read off `cues.caller`,
// feature-detected (an older server keeps the per-console choice).

import { describe, expect, it } from 'vitest'
import { DirectorMode } from './director-keys'
import { FLIP_MS, callerIsMe, callerNote, claimMode, modeKey, shownMode, showCallerOf } from './director-mode'

describe('the server caller claim', () => {
  it('feature-detects cues.caller', () => {
    expect(showCallerOf({ last: null, fired: [] })).toEqual({ known: false, caller: null })
    expect(showCallerOf({ last: null, fired: [], caller: null })).toEqual({ known: true, caller: null })
    expect(showCallerOf({ caller: { name: ' Task Manager ', at: 3 } })).toEqual({ known: true, caller: { name: 'Task Manager', at: 3 } })
    expect(showCallerOf({ caller: { name: '' } })).toEqual({ known: true, caller: null })
    expect(showCallerOf(null)).toEqual({ known: false, caller: null })
  })
  it('is Calling only while this console holds the claim', () => {
    expect(claimMode({ name: 'Sam Rivera', at: 0 }, 'sam rivera')).toBe(DirectorMode.Calling)
    expect(claimMode({ name: 'Task Manager', at: 0 }, 'Sam Rivera')).toBe(DirectorMode.Watching)
    expect(claimMode(null, 'Sam Rivera')).toBe(DirectorMode.Watching)
    expect(callerIsMe({ name: 'Sam', at: 0 }, '')).toBe(false)
  })
  it('says who is calling', () => {
    expect(callerNote(null, 'Sam')).toBe('📣 Nobody is calling.')
    expect(callerNote({ name: 'Sam', at: 0 }, 'Sam')).toBe("📣 You're calling.")
    expect(callerNote({ name: 'Task Manager', at: 0 }, 'Sam')).toBe('📣 Task Manager is calling.')
  })
  it('trusts a fresh flip over a cue state that has not caught up', () => {
    const flip = { mode: DirectorMode.Calling, at: 1_000 }
    expect(shownMode(DirectorMode.Watching, flip, 1_000 + FLIP_MS)).toBe(DirectorMode.Calling)
    expect(shownMode(DirectorMode.Watching, flip, 1_001 + FLIP_MS)).toBe(DirectorMode.Watching)
    expect(shownMode(DirectorMode.Watching, null, 0)).toBe(DirectorMode.Watching)
  })
  it('keeps the per-console key for the local choice', () => {
    expect(modeKey('ev1')).toBe('loom.director.mode.ev1')
    expect(modeKey(null)).toBe('loom.director.mode.local')
  })
})
