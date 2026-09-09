import { describe, expect, it } from 'vitest'
import { parseSignalArgs } from './signal-args'

describe('parseSignalArgs', () => {
  it('is null for an empty line (no args sent)', () => {
    expect(parseSignalArgs('')).toBeNull()
    expect(parseSignalArgs('   ')).toBeNull()
  })
  it('types numbers and booleans, keeps the rest as strings', () => {
    expect(parseSignalArgs('level: 3, armed: true, who: Ivo Marsh')).toEqual({
      level: 3,
      armed: true,
      who: 'Ivo Marsh',
    })
    expect(parseSignalArgs('x: -1.5')).toEqual({ x: -1.5 })
    expect(parseSignalArgs('label: "quoted"')).toEqual({ label: 'quoted' })
  })
  it('rejects a malformed line', () => {
    expect(parseSignalArgs('level')).toBeUndefined()
    expect(parseSignalArgs('level:')).toBeUndefined()
    expect(parseSignalArgs('1x: 2')).toBeUndefined()
  })
})
