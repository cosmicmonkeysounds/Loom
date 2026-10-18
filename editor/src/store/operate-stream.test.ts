// The server backend's mod stream, wired end to end through the store with
// a fake `EventSource` (C8 + O1-open-issues-03): a stream the server closed
// for good reopens on the backoff, `refresh` reopens a closed one, a dead
// control plane keeps the backoff going, and a `sim` frame's Log row is
// stamped in story time off the last snapshot's clock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    eventsApi: {
      ...actual.eventsApi,
      status: vi.fn(async () => ({
        id: 'evt-1',
        projectId: 'p-1',
        mode: 'preview' as const,
        status: 'open',
        codes: { event: 'EVT111', prime: 'PRM111', mod: 'MOD111' },
        joinUrl: 'http://localhost/?code=EVT111',
        createdAt: new Date(0).toISOString(),
        startedBy: 'Ada',
      })),
    },
    modApi: { ...actual.modApi, lens: vi.fn(async () => ({})) },
  }
})

import { eventsApi } from '@/lib/api'
import { STREAM_RETRY_BASE_MS } from '@/lib/stream-retry'
import { useAuth } from '@/store/auth'
import { useOperate } from '@/store/operate'

type Listener = (e: { data: string }) => void

/** Just enough `EventSource` for the operate store. */
class FakeEventSource {
  static all: FakeEventSource[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  readonly url: string
  private readonly listeners = new Map<string, Listener[]>()
  constructor(url: string) {
    this.url = url
    FakeEventSource.all.push(this)
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close(): void {
    this.readyState = 2
  }
  open(): void {
    this.readyState = 1
    this.onopen?.()
    this.emit('open', null)
  }
  emit(type: string, data: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) })
  }
  /** A non-200 answer (the proxy's 502): closed for good. */
  fail(): void {
    this.readyState = 2
    this.onerror?.()
  }
}

const latest = () => FakeEventSource.all[FakeEventSource.all.length - 1]!
const status = vi.mocked(eventsApi.status)

beforeEach(async () => {
  vi.useFakeTimers()
  FakeEventSource.all = []
  vi.stubGlobal('EventSource', FakeEventSource)
  useAuth.setState({ user: { id: 'u1', name: 'Ada', email: 'ada@example.test' } })
  useOperate.getState().detach()
  useOperate.getState().attach('p-1')
  await vi.advanceTimersByTimeAsync(0) // the attach's refresh → connect
  expect(FakeEventSource.all).toHaveLength(1)
  latest().open()
})

afterEach(() => {
  useOperate.getState().detach()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the Run mod stream (server backend)', () => {
  it('reopens a stream the server closed for good, after the backoff', async () => {
    const first = latest()
    first.fail()
    expect(useOperate.getState().connected).toBe(false)
    expect(FakeEventSource.all).toHaveLength(1) // nothing yet: the backoff first
    await vi.advanceTimersByTimeAsync(STREAM_RETRY_BASE_MS)
    expect(FakeEventSource.all).toHaveLength(2)
    expect(latest()).not.toBe(first)
    latest().open()
    expect(useOperate.getState().connected).toBe(true)
  })

  it('keeps retrying, slower, while the control plane answers 502', async () => {
    status.mockRejectedValueOnce(new Error('HTTP 502')).mockRejectedValueOnce(new Error('HTTP 502'))
    latest().fail()
    await vi.advanceTimersByTimeAsync(STREAM_RETRY_BASE_MS) // attempt 1: 502
    expect(FakeEventSource.all).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2 * STREAM_RETRY_BASE_MS) // attempt 2: 502
    expect(FakeEventSource.all).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(4 * STREAM_RETRY_BASE_MS) // attempt 3: up
    expect(FakeEventSource.all).toHaveLength(2)
  })

  it('a refresh (the poll, a collab notice) reopens a closed stream', async () => {
    latest().close() // closed with no error event seen
    await useOperate.getState().refresh()
    expect(FakeEventSource.all).toHaveLength(2)
    // An open stream is left alone.
    latest().open()
    await useOperate.getState().refresh()
    expect(FakeEventSource.all).toHaveLength(2)
  })

  it('a network blip (the browser retrying) is not reopened by hand', async () => {
    const es = latest()
    es.readyState = 0 // CONNECTING: the browser's own retry
    es.onerror?.()
    await vi.advanceTimersByTimeAsync(STREAM_RETRY_BASE_MS * 4)
    expect(FakeEventSource.all).toHaveLength(1)
  })

  it('stamps a sim frame in story time off the last snapshot clock', async () => {
    latest().emit('snapshot', { phase: 'open', clock: 65_000, ledgerLen: 0 })
    await vi.advanceTimersByTimeAsync(400)
    latest().emit('sim', { type: 'tick', elapsedMs: 0 })
    const row = useOperate.getState().log.at(-1)!
    expect(row.ts).toBeGreaterThanOrEqual(65_000)
    expect(row.ts).toBeLessThan(66_000)
    expect(row.ts).toBe(65_400)
  })

  it('a paused run stamps the snapshot clock, never running on', async () => {
    latest().emit('snapshot', { phase: 'paused', clock: 65_000, ledgerLen: 0 })
    await vi.advanceTimersByTimeAsync(5_000)
    latest().emit('sim', { type: 'tick', elapsedMs: 0 })
    expect(useOperate.getState().log.at(-1)!.ts).toBe(65_000)
  })
})
