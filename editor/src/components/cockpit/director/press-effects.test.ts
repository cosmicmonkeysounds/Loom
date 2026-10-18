import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from '@/store/cockpit'
import type { SimEvent } from '@loom/core/sim'
import { pressEffects, pressSlice } from './press-effects'

let seq = 0
const e = (event: SimEvent): LedgerEntry => ({ seq: seq++, event })
const set = (path: string, value: string) => e({ type: 'worldSet', path, value })

describe('pressEffects', () => {
  it('aggregates per-guest writes, stops at the next input, and handles "before connect"', () => {
    seq = 0
    const persons = new Set(['p1', 'p2', 'p3'])
    const log: LedgerEntry[] = [
      e({ type: 'signal', name: 'y2k_clock', subject: null }),
      set('Night.phase', '"old"'),
      e({ type: 'tick', elapsedMs: 1000 }),
      e({ type: 'signal', name: 'y2k_clock', subject: null }),
      set('Night.phase', '"y2k"'),
      set('Night.clock', '"23:00"'),
      set('Night.clock', '"23:01"'),
      set('Night._asked_at', '5'),
      set('Time.hour', '23'),
      set('Kernel.majority', '"Combo A"'),
      set('p1.cleared', 'true'),
      set('p2.cleared', 'true'),
      set('p3.cleared', 'true'),
      e({ type: 'revealed', target: 'The Server Room', kind: 'location', person: null }),
      e({ type: 'broadcast', cue: 'one', audience: [], scope: 'all' }),
      e({ type: 'broadcast', cue: 'two', audience: [], scope: 'all' }),
      e({ type: 'broadcast', cue: 'three', audience: [], scope: 'all' }),
      e({ type: 'chat', from: 'p1', channel: 'lobby', text: 'hi', audience: 'all', parentSeq: null }),
      set('Night.after', 'never'),
    ]
    const fx = pressEffects(log, 'y2k_clock', { persons, secretHeads: new Set(['Kernel']), max: 10 })!
    expect(fx.seq).toBe(3)
    expect(fx.items).toEqual([
      'Night.phase → y2k',
      'Night.clock → 23:01',
      'Kernel.majority → ••••',
      'cleared → true ×3',
      '📂 The Server Room open',
      '📣 one',
      '📣 two',
      '+1 broadcasts',
    ])
    expect(fx.more).toBe(0)
    const short = pressEffects(log, 'Y2K Clock', { persons })!
    expect(short.items).toHaveLength(4)
    expect(short.more).toBe(4)
    // Pressed before this console connected: nothing in its log.
    expect(pressEffects(log, 'final_reveal')).toBeNull()
  })

  it('reads the story’s own fire of an auto cue', () => {
    seq = 0
    const log = [e({ type: 'directive', verb: 'fire', args: 'final_reveal for Night' }), e({ type: 'beatEntered', beat: 'The Reveal', setting: null, subject: null })]
    expect(pressEffects(log, 'final_reveal')!.items).toEqual(['⤷ The Reveal'])
  })
})

describe('pressEffects after a refused re-press', () => {
  it('describes the press that set LAST, not a later refused one', () => {
    seq = 0
    const log: LedgerEntry[] = [
      e({ type: 'signal', name: 'y2k_clock', subject: null }),
      set('Night.phase', '"y2k"'),
      e({ type: 'tick', elapsedMs: 1000 }),
      // Pressed again out of turn: the rule only tells # hosts why.
      e({ type: 'signal', name: 'y2k_clock', subject: null }),
      e({ type: 'broadcast', cue: '❌ Not yet', audience: [], scope: 'channel(hosts)' }),
      set('Night._asked_at', '5'),
    ]
    const fx = pressEffects(log, 'y2k_clock', { staffRooms: ['room:hosts'] })!
    expect(fx.seq).toBe(0)
    expect(fx.items).toEqual(['Night.phase → y2k'])
    // A cue no rule hears (every press empty) still reads its newest press.
    seq = 0
    const bare = [e({ type: 'signal', name: 'lights', subject: null }), e({ type: 'tick', elapsedMs: 1 }), e({ type: 'signal', name: 'lights', subject: null })]
    expect(pressEffects(bare, 'lights', { staffRooms: ['room:hosts'] })!.seq).toBe(2)
  })
})

describe('pressSlice', () => {
  it('is the press and its effects, up to the next input', () => {
    seq = 0
    const log = [set('Night.a', '1'), e({ type: 'signal', name: 'trust_chart', subject: null }), set('Night.b', '2'), e({ type: 'tick', elapsedMs: 1 }), set('Night.c', '3')]
    expect(pressSlice(log, 1).map((r) => r.seq)).toEqual([1, 2])
    expect(pressSlice(log, 99)).toEqual([])
  })
})
