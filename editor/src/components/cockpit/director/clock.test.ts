import { afterEach, describe, expect, it, vi } from 'vitest'
import { startTick } from './clock'

afterEach(() => {
  vi.useRealTimers()
})

describe('useNow’s tick', () => {
  it('reads the clock the moment it turns active, then every ms — never the mount-time value', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const seen: number[] = []
    // the clock sat idle since mount (1 000); 40 minutes on, it turns active
    vi.setSystemTime(1_000 + 40 * 60_000)
    const stop = startTick((ms) => seen.push(ms), 30_000)
    expect(seen).toEqual([1_000 + 40 * 60_000])
    vi.advanceTimersByTime(30_000)
    expect(seen).toEqual([1_000 + 40 * 60_000, 1_000 + 40 * 60_000 + 30_000])
    stop()
    vi.advanceTimersByTime(60_000)
    expect(seen).toHaveLength(2)
  })
})
