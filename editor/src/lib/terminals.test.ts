import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SILENT_MS,
  RECHIME_MS,
  TerminalStatus,
  formatSilence,
  fullscreenTitle,
  majorityVersion,
  mergeTerminals,
  terminalBadges,
  newlySilent,
  pruneAcks,
  shouldChime,
  strayRoom,
  type ScreenTerminals,
  type TerminalPoll,
  type TerminalRow,
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

  it('carries a room terminal\'s room into the row and the memory (wave 7)', () => {
    const now = 2_000_000
    const room = { ...poll('Server Room', 0, 'face'), spot: 'server-room', room: 'The Server Room' }
    const stray = { ...poll('Hall Tablet', 0, 'face'), spot: 'hall', room: 'The Desktop' }
    const first = mergeTerminals({}, server(room, stray, poll('Kitchen', 0)), now)
    const row = (n: string) => first.rows.find((r) => r.name === n)!
    expect(row('Server Room').room).toBe('The Server Room')
    expect(row('Hall Tablet').room).toBe('The Desktop')
    expect(row('Kitchen').room).toBe('')
    // The server forgot them (a restart): the remembered rows keep their room.
    const later = mergeTerminals(first.memory, server(), now + 1_000)
    expect(later.rows.find((r) => r.name === 'Hall Tablet')).toMatchObject({ room: 'The Desktop', remembered: true })
  })

  it('a room off the server-room spot is a stray (amber); the server-room terminal and a plain tablet are not', () => {
    expect(strayRoom({ spot: 'server-room', room: 'The Server Room' })).toBe(false)
    expect(strayRoom({ spot: 'hall', room: 'The Desktop' })).toBe(true)
    expect(strayRoom({ spot: '', room: 'The Desktop' })).toBe(true)
    expect(strayRoom({ spot: 'hall', room: '' })).toBe(false)
  })
})

describe('device badges (SW-SCR-21)', () => {
  const now = 1_000_000
  const rowsOf = (...t: TerminalPoll[]) => mergeTerminals({}, server(...t), now).rows
  const byName = (rows: TerminalRow[], n: string) => rows.find((r) => r.name === n)!

  it('carries the device off the listing; an older build or a remembered row has none', () => {
    const rows = rowsOf({ ...poll('Kitchen', 0), audio: false, visible: true, battery: 12, charging: false, version: 'b2' }, poll('Hall', 0))
    expect(byName(rows, 'Kitchen').device).toMatchObject({ audio: false, visible: true, battery: 12, version: 'b2' })
    expect(terminalBadges(byName(rows, 'Hall'), null)).toEqual([])
    const { memory } = mergeTerminals({}, server(poll('Attic', 0)), now)
    expect(mergeTerminals(memory, server(), now).rows[0]!.device).toBeNull()
  })

  it('🔇 locked sound, 💤 hidden, a low battery not charging is red; charging is not', () => {
    const [r] = rowsOf({ ...poll('Kitchen', 0), audio: false, visible: false, battery: 12, charging: false, version: 'b2' })
    const b = terminalBadges(r!, 'b2')
    expect(b.map((x) => [x.key, x.text, x.warn])).toEqual([
      ['audio', '🔇', true],
      ['hidden', '💤', true],
      ['battery', '🔋12%', true],
      ['version', 'b2', false],
    ])
    const [c] = rowsOf({ ...poll('Kitchen', 0), audio: true, visible: true, battery: 12, charging: true })
    expect(terminalBadges(c!, null).map((x) => [x.key, x.text, x.warn])).toEqual([['battery', '⚡12%', false]])
  })

  it('⛶ not full screen is red; full screen or no flag (a build that cannot be) shows nothing', () => {
    const [r] = rowsOf({ ...poll('Kitchen', 0), audio: true, visible: false, fullscreen: false })
    expect(r!.device).toMatchObject({ fullscreen: false })
    expect(terminalBadges(r!, null).map((x) => [x.key, x.text, x.warn])).toEqual([
      ['hidden', '💤', true],
      ['fullscreen', '⛶', true],
    ])
    const [on] = rowsOf({ ...poll('Kitchen', 0), fullscreen: true })
    expect(terminalBadges(on!, null)).toEqual([])
    const [none] = rowsOf({ ...poll('Kitchen', 0), audio: true })
    expect(terminalBadges(none!, null)).toEqual([])
  })

  it('⛶ on the TV points at --kiosk (nobody taps it); on a tablet, a touch', () => {
    expect(fullscreenTitle({ view: 'tv' })).toMatch(/--kiosk/)
    expect(fullscreenTitle({ view: 'mirror' })).toMatch(/--kiosk/)
    expect(fullscreenTitle({ view: 'face' })).toMatch(/touch the screen once/)
    expect(fullscreenTitle({ view: 'face' })).not.toMatch(/kiosk/)
  })

  it('flags a build that differs from the majority (none on a tie)', () => {
    const rows = rowsOf({ ...poll('A', 0), version: 'new' }, { ...poll('B', 0), version: 'new' }, { ...poll('C', 0), version: 'old' }, poll('D', 0))
    expect(majorityVersion(rows)).toBe('new')
    expect(terminalBadges(byName(rows, 'C'), 'new').find((x) => x.key === 'version')!.warn).toBe(true)
    expect(majorityVersion(rowsOf({ ...poll('A', 0), version: 'x' }, { ...poll('B', 0), version: 'y' }))).toBeNull()
    expect(majorityVersion(rowsOf(poll('A', 0)))).toBeNull()
  })

  it('flags a listed tablet that reports no build next to a majority: a cached pre-stamp build', () => {
    const rows = rowsOf({ ...poll('A', 0), version: 'new' }, { ...poll('B', 0), version: 'new' }, poll('Old', 0))
    expect(terminalBadges(byName(rows, 'Old'), 'new')).toEqual([expect.objectContaining({ key: 'version', text: 'old build', warn: true })])
    // With no majority (nobody reports one) it stays quiet; a remembered row has no device at all.
    expect(terminalBadges(byName(rows, 'Old'), null)).toEqual([])
    const { memory } = mergeTerminals({}, server(poll('Attic', 0)), now)
    expect(terminalBadges(mergeTerminals(memory, server(), now).rows[0]!, 'new')).toEqual([])
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
const identify = vi.fn(async (_id: string, name: string) => ({ name, until: 0 }))
const chime = vi.fn()
vi.mock('@/lib/api', () => ({ screensApi: { terminals: (id: string) => terminals(id), setVoiceMuted: (id: string, m: boolean) => setVoiceMuted(id, m), identify: (id: string, n: string) => identify(id, n) } }))
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

    // A failed flip (offline, a 403) never rejects: it is said on the card.
    setVoiceMuted.mockRejectedValueOnce(new Error('403 moderators only'))
    await expect(useTerminals.getState().setVoiceMuted(false)).resolves.toBeUndefined()
    expect(useTerminals.getState().voiceMuted).toBe(true)
    expect(useTerminals.getState().muteError).toMatch(/unmute the TV voice: 403/)
    await useTerminals.getState().setVoiceMuted(false)
    expect(useTerminals.getState().muteError).toBeNull()
  })

  it('identify asks the server for that terminal; a failure is said on the card, never thrown', async () => {
    const { useTerminals } = await import('@/store/terminals')
    terminals.mockResolvedValue(server(poll('Kitchen', 0)))
    useTerminals.getState().bind('evt-3')
    await useTerminals.getState().identify('Kitchen')
    expect(identify).toHaveBeenCalledWith('evt-3', 'Kitchen')
    expect(useTerminals.getState().identifyError).toBeNull()
    identify.mockRejectedValueOnce(new Error('403 moderators only'))
    await expect(useTerminals.getState().identify('Kitchen')).resolves.toBeUndefined()
    expect(useTerminals.getState().identifyError).toMatch(/identify Kitchen: 403/)
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
