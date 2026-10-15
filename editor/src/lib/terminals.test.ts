import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SILENT_MS,
  RECHIME_MS,
  TerminalStatus,
  formatSilence,
  mergeTerminals,
  newlySilent,
  pruneAcks,
  shouldChime,
  type ScreenTerminals,
  type TerminalPoll,
} from '@/lib/terminals'

const SILENT = 20_000
const poll = (name: string, ago: number, view = 'auto'): TerminalPoll => ({ name, spot: name.toLowerCase(), view, character: 'Trabolta', ago })
const server = (...terminals: TerminalPoll[]): ScreenTerminals => ({ now: 0, terminals, voiceMuted: false, silentMs: SILENT })

describe('mergeTerminals (K-29)', () => {
  it('a terminal is live until it has been silent for the server threshold; silent rows first', () => {
    const now = 1_000_000
    const { rows, memory } = mergeTerminals({}, server(poll('Kitchen', 2_000), poll('Hall', SILENT), poll('Attic', 500)), now)
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ['Hall', TerminalStatus.Silent],
      ['Attic', TerminalStatus.Live],
      ['Kitchen', TerminalStatus.Live],
    ])
    // Remembered on the client clock (server skew never leaks in).
    expect(memory['Kitchen']!.lastSeen).toBe(now - 2_000)
  })

  it('remembers a terminal the server forgot (a restart) and ages it from when this editor last saw it', () => {
    const t0 = 5_000_000
    const first = mergeTerminals({}, server(poll('Kitchen', 0), poll('Hall', 0)), t0)
    // The server restarted: only Kitchen re-polled.
    const later = mergeTerminals(first.memory, server(poll('Kitchen', 1_000)), t0 + SILENT + 3_000)
    const hall = later.rows.find((r) => r.name === 'Hall')!
    expect(hall).toMatchObject({ status: TerminalStatus.Silent, remembered: true, silentFor: SILENT + 3_000 })
    expect(later.rows.find((r) => r.name === 'Kitchen')).toMatchObject({ status: TerminalStatus.Live, remembered: false })
  })

  it('a failed poll ages every row on the client clock, with the default threshold, and keeps the memory', () => {
    const first = mergeTerminals({}, server(poll('Kitchen', 0)), 0)
    const failed = mergeTerminals(first.memory, null, DEFAULT_SILENT_MS)
    expect(failed.rows[0]).toMatchObject({ status: TerminalStatus.Silent, remembered: false })
    expect(failed.memory).toEqual(first.memory)
  })

  it('never moves a remembered poll backwards', () => {
    const first = mergeTerminals({}, server(poll('Kitchen', 0)), 100_000)
    const stale = mergeTerminals(first.memory, server(poll('Kitchen', 90_000)), 101_000)
    expect(stale.memory['Kitchen']!.lastSeen).toBe(100_000)
  })
})

describe('the chime rules', () => {
  const rowsAt = (ages: Record<string, number>) => mergeTerminals({}, server(...Object.entries(ages).map(([n, a]) => poll(n, a))), 1_000_000).rows

  it('chimes when a terminal goes silent, not again on the next look', () => {
    const before = rowsAt({ Kitchen: 1_000, Hall: 1_000 })
    const after = rowsAt({ Kitchen: 1_000, Hall: SILENT + 1 })
    expect(newlySilent(before, after)).toEqual(['Hall'])
    expect(shouldChime(['Hall'], after, new Set(), 0, 10)).toBe(true)
    expect(newlySilent(after, after)).toEqual([])
    expect(shouldChime([], after, new Set(), 10, 10 + RECHIME_MS - 1)).toBe(false)
  })

  it('re-chimes every minute until acknowledged; an ack lapses once the terminal comes back', () => {
    const dead = rowsAt({ Hall: SILENT + 1 })
    expect(shouldChime([], dead, new Set(), 0, RECHIME_MS)).toBe(true)
    expect(shouldChime([], dead, new Set(['Hall']), 0, RECHIME_MS)).toBe(false)
    expect(pruneAcks(new Set(['Hall']), dead)).toEqual(new Set(['Hall']))
    const back = rowsAt({ Hall: 0 })
    expect(pruneAcks(new Set(['Hall']), back)).toEqual(new Set())
    expect(shouldChime([], back, new Set(), 0, RECHIME_MS * 5)).toBe(false)
  })

  it('formats a silence', () => {
    expect(formatSilence(34_200)).toBe('34 s')
    expect(formatSilence(3 * 60_000 + 5_000)).toBe('3 min')
    expect(formatSilence(65 * 60_000)).toBe('1 h 5 min')
  })
})

// --- the store: polls the server, chimes on a newly silent terminal ----------

const terminals = vi.fn<(id: string) => Promise<ScreenTerminals>>()
const setVoiceMuted = vi.fn(async (_id: string, muted: boolean) => ({ muted }))
const chime = vi.fn()
vi.mock('@/lib/api', () => ({ screensApi: { terminals: (id: string) => terminals(id), setVoiceMuted: (id: string, m: boolean) => setVoiceMuted(id, m) } }))
vi.mock('@/lib/chime', () => ({ playChime: () => chime() }))

const mem = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage

describe('useTerminals', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000_000)
    mem.clear()
    terminals.mockReset()
    chime.mockReset()
  })
  afterEach(async () => {
    const { useTerminals } = await import('@/store/terminals')
    useTerminals.getState().bind(null)
    vi.useRealTimers()
  })

  it('goes red + chimes once when a tablet stops polling; remembers it across a server restart; mute round-trips', async () => {
    const { useTerminals } = await import('@/store/terminals')
    let hallGone: number | null = null
    terminals.mockImplementation(async () => server(poll('Kitchen', 0), poll('Hall', hallGone === null ? 0 : Date.now() - hallGone)))
    useTerminals.getState().bind('evt')
    await vi.advanceTimersByTimeAsync(0)
    expect(useTerminals.getState().rows.every((r) => r.status === TerminalStatus.Live)).toBe(true)
    expect(chime).not.toHaveBeenCalled()

    hallGone = Date.now() // the Hall tablet came off Wi-Fi
    await vi.advanceTimersByTimeAsync(16_000)
    expect(chime).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(8_000) // red within 25 s of the pull
    expect(useTerminals.getState().rows[0]).toMatchObject({ name: 'Hall', status: TerminalStatus.Silent })
    expect(chime).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(chime).toHaveBeenCalledTimes(1)

    // The server restarts and forgets Hall: still red, from this editor's memory.
    terminals.mockImplementation(async () => server(poll('Kitchen', 0)))
    await vi.advanceTimersByTimeAsync(4_000)
    expect(useTerminals.getState().rows[0]).toMatchObject({ name: 'Hall', status: TerminalStatus.Silent, remembered: true })
    useTerminals.getState().ack('Hall')
    await vi.advanceTimersByTimeAsync(RECHIME_MS)
    expect(chime).toHaveBeenCalledTimes(1)

    useTerminals.getState().forget('Hall')
    expect(useTerminals.getState().rows.map((r) => r.name)).toEqual(['Kitchen'])

    await useTerminals.getState().setVoiceMuted(true)
    expect(setVoiceMuted).toHaveBeenCalledWith('evt', true)
    expect(useTerminals.getState().voiceMuted).toBe(true)
  })

  it('an unreachable server is said so, and the rows age to red on the client clock', async () => {
    const { useTerminals } = await import('@/store/terminals')
    terminals.mockResolvedValueOnce(server(poll('Kitchen', 0))).mockRejectedValue(new Error('offline'))
    useTerminals.getState().bind('evt-2')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(24_000)
    expect(useTerminals.getState().reachable).toBe(false)
    expect(useTerminals.getState().rows[0]!.status).toBe(TerminalStatus.Silent)
    expect(chime).toHaveBeenCalledTimes(1)
  })
})
