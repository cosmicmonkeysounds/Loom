import { describe, expect, it } from 'vitest'
import { storyNow } from './cockpit'
import { logClock } from '@/components/cockpit/log-describe'

describe('the story clock', () => {
  it('storyNow: runs on from the snapshot, stands still while paused', () => {
    const clock = { ms: 60_000, at: 1_000 }
    expect(storyNow(clock, true, 4_500)).toBe(63_500)
    expect(storyNow(clock, false, 4_500)).toBe(60_000)
    expect(storyNow(clock, true, 500)).toBe(60_000)
    expect(storyNow(null, true, 4_500)).toBeNull()
  })

  it('a server run stamps Log rows in story time (wave 8 open issue 5), never the wall clock', () => {
    const T = Date.now()
    const ts = storyNow({ ms: 65_000, at: T }, true, T + 400)!
    expect(ts).toBeGreaterThanOrEqual(65_000)
    expect(ts).toBeLessThan(66_000)
    expect(logClock(ts)).toBe('01:05')
    // Paused: exactly the snapshot's reading.
    expect(storyNow({ ms: 65_000, at: T }, false, T + 9_000)).toBe(65_000)
    // No clock (an older server): the row reads — .
    expect(logClock(storyNow(null, true, T) ?? undefined)).toBe('—')
    // The old stamp, for the record: an epoch reads as an 8-digit minute.
    expect(logClock(T).length).toBeGreaterThan(5)
  })

  it('logClock: mm:ss, minutes past an hour unbounded', () => {
    expect(logClock(0)).toBe('00:00')
    expect(logClock(59_999)).toBe('00:59')
    expect(logClock(3_725_000)).toBe('62:05')
    expect(logClock(undefined)).toBe('—')
  })
})
