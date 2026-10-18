import { describe, expect, it, vi } from 'vitest'
import { movedCue, movedPressedCue, ownMove, pressSettled, settleTarget, within, OWN_MS, PRESS_TIMEOUT_MS } from './moves'
import { DOORS_NOT_OPEN, failureText } from '@/lib/press-failure'

describe('movedCue', () => {
  it('names the new LAST', () => {
    expect(movedCue({ last: 'a', fired: ['a'] }, { last: 'b', fired: ['a', 'b'] })).toBe('b')
  })

  it('names an aside whose first press moved only `fired`, never LAST', () => {
    // During the Y2K hour LAST is 🕚; another director's 🔄 lands in fired.
    expect(movedCue({ last: 'y2k_clock', fired: ['y2k_clock'] }, { last: 'y2k_clock', fired: ['y2k_clock', 'reset_server_room'] })).toBe('reset_server_room')
  })

  it('names a repeat press that moved only the press count (another director\'s 📋)', () => {
    const prev = { last: 'read_the_results', fired: ['read_the_results'], presses: 9 }
    expect(movedCue(prev, { ...prev, presses: 10, pressed: 'read_the_results' })).toBe('read_the_results')
    expect(movedCue(prev, { ...prev, presses: 10, pressed: 'restore_the_lights' })).toBe('restore_the_lights')
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

describe('within', () => {
  it('a hung press turns into a failure after the timeout', async () => {
    vi.useFakeTimers()
    try {
      const hung = within(new Promise<string>(() => {}), PRESS_TIMEOUT_MS, () => 'late')
      vi.advanceTimersByTime(PRESS_TIMEOUT_MS)
      await expect(hung).resolves.toBe('late')
      await expect(within(Promise.resolve('ok'), PRESS_TIMEOUT_MS, () => 'late')).resolves.toBe('ok')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('failureText', () => {
  it('a press before the doors says so, not the server\'s "no scenario loaded"', () => {
    expect(failureText('no scenario loaded')).toBe(DOORS_NOT_OPEN)
    expect(DOORS_NOT_OPEN).toMatch(/doors aren't open/u)
  })
  it('any other failure is passed through', () => {
    expect(failureText('boom')).toBe('boom')
  })
})

describe('pressSettled (a landed press holds the lock until its snapshot)', () => {
  it('waits while the marks still show the count from before the press', () => {
    // 🍾 lands: the server says 8; the snapshot with it is up to 500 ms away.
    expect(pressSettled(8, 7)).toBe(false)
    expect(pressSettled(8, 8)).toBe(true)
    // Another press landed too: the marks are past it.
    expect(pressSettled(8, 9)).toBe(true)
  })

  it('never waits with no count to wait for (the local backend, an older server)', () => {
    expect(pressSettled(undefined, 7)).toBe(true)
    expect(pressSettled(8, undefined)).toBe(true)
  })
})

describe('movedPressedCue (the 409 moved banner)', () => {
  it("names the server's newest press over the stale marks", () => {
    expect(movedPressedCue('call_c7', 'call_c6')).toBe('call_c7')
    expect(movedPressedCue(null, 'call_c6')).toBeNull()
  })

  it('falls back to the marks when the server sent no cues', () => {
    expect(movedPressedCue(undefined, 'call_c6')).toBe('call_c6')
    expect(movedPressedCue(undefined, undefined)).toBeNull()
  })
})

describe('settleTarget (which answers hold the lock)', () => {
  it('a taken press holds it until the marks show its count', () => {
    expect(settleTarget({ presses: 2 }, 1)).toBe(2)
    expect(settleTarget({ presses: 2 }, 2)).toBeNull()
  })

  it("a 409 moved holds it until the marks show the press that beat it", () => {
    // A fired c2 @1 (presses 2) and the frame is coalesced; B's c2 @1 gets
    // 409 moved with cues.presses 2 while B's marks still say 1. Unlocking
    // now would let B re-arm c3 on count 1 — refused as moved again, or
    // dropped the moment the frame lands. Held, the re-arm binds to 2.
    expect(settleTarget({ moved: true, pressed: 'c2', presses: 2 }, 1)).toBe(2)
    expect(settleTarget({ moved: true, pressed: 'c2', presses: 2 }, 2)).toBeNull()
  })

  it('a failed press, or no count, unlocks at once', () => {
    expect(settleTarget({ error: 'boom', presses: 5 }, 1)).toBeNull()
    expect(settleTarget({ moved: true, pressed: 'c2' }, 1)).toBeNull()
    expect(settleTarget({}, 1)).toBeNull()
    expect(settleTarget({ presses: 3 }, undefined)).toBeNull()
  })
})
