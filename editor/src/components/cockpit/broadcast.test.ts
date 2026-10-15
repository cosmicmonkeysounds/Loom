import { describe, expect, it } from 'vitest'

import { alertCue } from './broadcast'

describe('alertCue', () => {
  it('marks an alert once, and leaves plain cues (and hand-typed markers) alone', () => {
    expect(alertCue('Go to the living room', true)).toBe('!Go to the living room')
    expect(alertCue('  intermission ', false)).toBe('intermission')
    expect(alertCue('!already', true)).toBe('!already')
    expect(alertCue('"!quoted"', true)).toBe('"!quoted"')
    expect(alertCue('!typed', false)).toBe('!typed')
  })
})
