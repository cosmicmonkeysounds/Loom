import { describe, expect, it } from 'vitest'
import { STREAM_RETRY_MAX_MS, probeVerdict, reconnectDelay, streamClosed } from './stream-retry'

describe('stream retry (C8)', () => {
  it('streamClosed: none or CLOSED needs a new stream; CONNECTING / OPEN are the browser\'s', () => {
    expect(streamClosed(null)).toBe(true)
    expect(streamClosed({ readyState: 2 })).toBe(true)
    expect(streamClosed({ readyState: 0 })).toBe(false)
    expect(streamClosed({ readyState: 1 })).toBe(false)
  })

  it('reconnectDelay: doubles from 1 s, capped at 15 s', () => {
    expect([0, 1, 2, 3, 4, 5, 60].map(reconnectDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000, STREAM_RETRY_MAX_MS])
    expect(reconnectDelay(-3)).toBe(1_000)
  })

  it('probeVerdict: a 502 / 503 / network error retries, 2xx reopens, signed out or gone stops', () => {
    expect(probeVerdict(200)).toBe('reopen')
    expect(probeVerdict(204)).toBe('reopen')
    expect(probeVerdict(502)).toBe('retry')
    expect(probeVerdict(503)).toBe('retry')
    expect(probeVerdict(null)).toBe('retry')
    expect(probeVerdict(401)).toBe('stop')
    expect(probeVerdict(403)).toBe('stop')
    expect(probeVerdict(404)).toBe('stop')
  })
})
