import { describe, expect, it } from 'vitest'
import { movedCue, ownMove, OWN_MS } from './moves'

describe('movedCue', () => {
  it('names the new LAST', () => {
    expect(movedCue({ last: 'a', fired: ['a'] }, { last: 'b', fired: ['a', 'b'] })).toBe('b')
  })

  it('names an aside whose first press moved only `fired`, never LAST', () => {
    // During the Y2K hour LAST is 🕚; another director's 🔄 lands in fired.
    expect(movedCue({ last: 'y2k_clock', fired: ['y2k_clock'] }, { last: 'y2k_clock', fired: ['y2k_clock', 'reset_server_room'] })).toBe('reset_server_room')
  })

  it('is null when nothing moved', () => {
    expect(movedCue({ last: 'a', fired: ['a'] }, { last: 'a', fired: ['a'] })).toBeNull()
  })
})

describe('ownMove', () => {
  it('a press from any surface of this console is its own', () => {
    expect(ownMove({ name: 'trust_chart', at: 1000 }, 'trust_chart', 2000)).toBe(true)
    expect(ownMove({ name: 'the simulation completed', at: 1000 }, 'The_Simulation_Completed', 2000)).toBe(true)
    expect(ownMove({ name: 'trust_chart', at: 1000 }, 'truth_pong', 2000)).toBe(false)
    expect(ownMove({ name: 'trust_chart', at: 1000 }, 'trust_chart', 1000 + OWN_MS)).toBe(false)
    expect(ownMove(null, 'trust_chart', 0)).toBe(false)
  })
})
