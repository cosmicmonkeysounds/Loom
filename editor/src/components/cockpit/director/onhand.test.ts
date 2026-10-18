import { describe, expect, it } from 'vitest'
import { prevLineOpen } from './context'

describe('prevLineOpen', () => {
  it('a fold lasts only while that act is the previous one', () => {
    expect(prevLineOpen(null, 'd')).toBe(true)
    expect(prevLineOpen('d', 'd')).toBe(false)
    // After 🌑 the previous act is E: its fallbacks open again.
    expect(prevLineOpen('d', 'e')).toBe(true)
    expect(prevLineOpen('d', undefined)).toBe(true)
  })
})
