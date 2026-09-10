import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@loom/core/sim'
import { eventMentions } from './log-filter'

describe('eventMentions', () => {
  it('matches a participant named in any string field or string array', () => {
    const dialogue = { type: 'dialogue', speaker: 'Greeter', text: 'hi', audience: ['g-1', 'g-2'], setting: null, beat: 'opening' } as unknown as SimEvent
    expect(eventMentions(dialogue, 'g-1')).toBe(true)
    expect(eventMentions(dialogue, 'Greeter')).toBe(true)
    expect(eventMentions(dialogue, 'g-9')).toBe(false)
    const scanned = { type: 'scanned', scanner: 'Recruiter', person: 'g-1' } as unknown as SimEvent
    expect(eventMentions(scanned, 'Recruiter')).toBe(true)
    expect(eventMentions(scanned, 'g-1')).toBe(true)
  })

  it('never matches on the event type or on unrelated text', () => {
    const e = { type: 'g-1', text: 'g-1 walked in' } as unknown as SimEvent
    expect(eventMentions(e, 'g-1')).toBe(false)
  })
})
