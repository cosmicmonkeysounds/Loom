import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  linkBadges,
  type TerminalDevice,
  DEFAULT_SILENT_MS,
  doorBadges,
  doorOverrideFromScreen,
  hasDoorSensor,
  hasPatchBay,
  patchBadges,
  patchOverrideFromScreen,
  RECHIME_MS,
  TerminalStatus,
  formatSilence,
  fullscreenTitle,
  majorityVersion,
  mergeTerminals,
  micBadge,
  micWanted,
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

  it('📢 when the tablet says the house announcements (wave 18b, ann=1); never a warning', () => {
    const [on] = rowsOf({ ...poll('Kitchen', 0), announce: true })
    expect(on!.device).toMatchObject({ announce: true })
    expect(terminalBadges(on!, null).map((x) => [x.key, x.text, x.warn])).toEqual([['announce', '📢', false]])
    const [off] = rowsOf({ ...poll('Kitchen', 0), announce: false })
    expect(terminalBadges(off!, null)).toEqual([])
  })

  it('🎤 the voice link (wave 19): grey while live / held / off, red when a placed terminal is denied or on http', () => {
    const [live] = rowsOf({ ...poll('Kitchen', 0), mic: 'live' })
    expect(live!.device).toMatchObject({ mic: 'live' })
    expect(terminalBadges(live!, null).map((x) => [x.key, x.text, x.warn])).toEqual([['mic', '🎤', false]])
    const [held] = rowsOf({ ...poll('Kitchen', 0), mic: 'muted' })
    expect(terminalBadges(held!, null).map((x) => [x.key, x.text, x.warn])).toEqual([['mic', '🎤 off', false]])
    expect(micBadge({ spot: 'hall', view: 'auto' }, 'muted').title).toMatch(/⚙/)
    const [locked] = rowsOf({ ...poll('Kitchen', 0), mic: 'locked' })
    expect(terminalBadges(locked!, null).map((x) => [x.key, x.text, x.warn])).toEqual([['mic', '🎤 tap', true]])
    const [off] = rowsOf({ ...poll('Kitchen', 0), mic: 'off' })
    expect(terminalBadges(off!, null).map((x) => [x.key, x.text, x.warn])).toEqual([['mic', '🎤 off', false]])
    const [denied] = rowsOf({ ...poll('Kitchen', 0), mic: 'denied' })
    expect(terminalBadges(denied!, null).map((x) => [x.key, x.text, x.warn])).toEqual([['mic', '🎤 denied', true]])
    const [http] = rowsOf({ ...poll('Kitchen', 0), mic: 'insecure' })
    expect(terminalBadges(http!, null).map((x) => [x.key, x.text, x.warn])).toEqual([['mic', '🎤 http', true]])
    // An older build sends nothing: no badge.
    const [old] = rowsOf(poll('Kitchen', 0))
    expect(terminalBadges(old!, null)).toEqual([])
  })

  it('🎤 is never red where no mic belongs: a mirror, or a terminal on no spot', () => {
    expect(micWanted({ spot: 'hall', view: 'auto' })).toBe(true)
    expect(micWanted({ spot: 'desktop-tv', view: 'tv' })).toBe(true)
    expect(micWanted({ spot: 'desktop-tv', view: 'mirror' })).toBe(false)
    expect(micWanted({ spot: '', view: 'face' })).toBe(false)
    expect(micBadge({ spot: '', view: 'face' }, 'denied')).toMatchObject({ text: '🎤 off', warn: false })
    expect(micBadge({ spot: 'tv', view: 'mirror' }, 'insecure')).toMatchObject({ text: '🎤 off', warn: false })
  })

  it('⛶ on the TV points at --kiosk (nobody taps it); on a tablet, a touch', () => {
    expect(fullscreenTitle({ view: 'tv' })).toMatch(/--kiosk/)
    expect(fullscreenTitle({ view: 'mirror' })).toMatch(/--kiosk/)
    expect(fullscreenTitle({ view: 'face' })).toMatch(/touch the screen once/)
    expect(fullscreenTitle({ view: 'face' })).not.toMatch(/kiosk/)
    // Wave 18b: the tent laptop is started with --kiosk like the TV.
    expect(fullscreenTitle({ view: 'reinstall' })).toMatch(/--kiosk/)
    expect(fullscreenTitle({ view: 'reinstall' })).toMatch(/Internet laptop/)
    expect(fullscreenTitle({ view: 'reinstall' })).not.toMatch(/touch the screen once/)
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
const costume = vi.fn(async (_id: string) => ({ on: true, url: 'https://loom.test/costume?e=evt&k=token' }))
const setCostume = vi.fn(async (_id: string, on: boolean) => ({ on }))
const setVoiceFx = vi.fn(async (_id: string, body: { fx?: string; shot?: string }) => ({ fx: body.fx ?? 'auto' }))
const identify = vi.fn(async (_id: string, name: string) => ({ name, until: 0 }))
const chime = vi.fn()
vi.mock('@/lib/api', () => ({ screensApi: { terminals: (id: string) => terminals(id), setVoiceMuted: (id: string, m: boolean) => setVoiceMuted(id, m), setVoiceFx: (id: string, b: { fx?: string; shot?: string }) => setVoiceFx(id, b), identify: (id: string, n: string) => identify(id, n), costume: (id: string) => costume(id), setCostume: (id: string, on: boolean) => setCostume(id, on) } }))
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

    // Wave 56: his voice's mode and a shot go the same way.
    await useTerminals.getState().setVoiceFx('clean')
    expect(setVoiceFx).toHaveBeenCalledWith('evt', { fx: 'clean' })
    expect(useTerminals.getState().voiceFx).toBe('clean')
    await useTerminals.getState().fireVoiceShot('kernel')
    expect(setVoiceFx).toHaveBeenCalledWith('evt', { shot: 'kernel' })
    expect(useTerminals.getState().voiceFx).toBe('clean') // a shot moves no mode
    setVoiceFx.mockRejectedValueOnce(new Error('403 moderators only'))
    await expect(useTerminals.getState().setVoiceFx('auto')).resolves.toBeUndefined()
    expect(useTerminals.getState().voiceFx).toBe('clean')
    expect(useTerminals.getState().muteError).toMatch(/his voice: 403/)
  })

  it('reads the costume once per bind, flips its switch, and says so when it can’t (wave 59)', async () => {
    const { useTerminals } = await import('@/store/terminals')
    terminals.mockResolvedValue(server(poll('Kitchen', 0)))
    useTerminals.getState().bind('evt-3')
    await vi.advanceTimersByTimeAsync(0)
    expect(useTerminals.getState().costume).toMatchObject({ on: true })
    await useTerminals.getState().setCostume(false)
    expect(setCostume).toHaveBeenCalledWith('evt-3', false)
    expect(useTerminals.getState().costume).toMatchObject({ on: false })
    setCostume.mockRejectedValueOnce(new Error('403 moderators only'))
    await expect(useTerminals.getState().setCostume(true)).resolves.toBeUndefined()
    expect(useTerminals.getState().muteError).toContain('403')
    expect(useTerminals.getState().costume).toMatchObject({ on: false })
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

describe('the 🚪 door badges (wave 20)', () => {
  const now = 1_000_000
  const rowWith = (p: Partial<TerminalPoll>): TerminalRow => mergeTerminals({}, server({ ...poll('Server Room', 500, 'face'), ...p }), now).rows[0]!

  it('carries the door fields off the poll into the row', () => {
    const r = rowWith({ door: 'closed', doorLevel: 3900, doorWarn: 'ldr_open' })
    expect(r.device).toMatchObject({ door: 'closed', doorLevel: 3900, doorWarn: 'ldr_open' })
  })

  it('shut is green with the level, open amber', () => {
    expect(doorBadges(rowWith({ door: 'closed', doorLevel: 3900 }).device, false)).toEqual([expect.objectContaining({ key: 'door', text: '🚪 shut 3900', tone: 'ok', warn: false })])
    expect(doorBadges(rowWith({ door: 'open', doorLevel: 120 }).device, false)).toEqual([expect.objectContaining({ key: 'door', text: '🚪 open 120', tone: 'amber', warn: false })])
    // No level reported: just the state.
    expect(doorBadges(rowWith({ door: 'open' }).device, false)[0]!.text).toBe('🚪 open')
  })

  it('a fault is red, names its code and says to use the 🚪 buttons', () => {
    const [b] = doorBadges(rowWith({ door: 'fault', doorFault: 'no_port' }).device, false)
    expect(b).toMatchObject({ key: 'door', text: '🚪 fault: no_port', tone: 'red', warn: true })
    expect(b!.title).toContain('use 🚪 opened / closed until it is fixed')
  })

  it('a warning follows the state as a small ⚠, never blocking', () => {
    const bs = doorBadges(rowWith({ door: 'open', doorLevel: 5, doorWarn: 'ldr_open' }).device, false)
    expect(bs.map((b) => b.key)).toEqual(['door', 'door-warn'])
    expect(bs[1]).toMatchObject({ text: '⚠ ldr_open', tone: 'amber', warn: false })
    expect(bs[1]!.title).toContain('normal for an open door in a dark hall')
  })

  it('override is amber and tells the director how to hand it back', () => {
    const bs = doorBadges(rowWith({ door: 'closed', doorLevel: 3900 }).device, true)
    expect(bs.at(-1)).toMatchObject({ key: 'door-override', text: 'override', tone: 'amber' })
    expect(bs.at(-1)!.title).toContain('press 🚪 Trust the door sensor again')
  })

  it('no badge for a terminal with no sensor (none, absent, not listed), override or not', () => {
    expect(doorBadges(rowWith({ door: 'none' }).device, true)).toEqual([])
    expect(doorBadges(rowWith({}).device, true)).toEqual([])
    expect(doorBadges(null, true)).toEqual([])
    expect(hasDoorSensor({ door: 'fault' })).toBe(true)
    expect(hasDoorSensor({})).toBe(false)
  })

  it('a silent laptop’s stale reading reads 🚪 ? (silent), never a green shut', () => {
    const bs = doorBadges(rowWith({ door: 'closed', doorLevel: 3900, doorWarn: 'ldr_open' }).device, true, true)
    expect(bs.map((b) => b.key)).toEqual(['door', 'door-override'])
    expect(bs[0]).toMatchObject({ text: '🚪 ? (silent)', tone: 'amber', warn: true })
    expect(bs[0]!.title).toContain('stopped polling')
    expect(bs[0]!.title).toContain('use 🚪 opened / closed')
    // terminalBadges reads the row's status: silent past `silentMs`.
    const late = mergeTerminals({}, server({ ...poll('Server Room', 60_000, 'face'), door: 'closed', doorLevel: 3900 }), now).rows[0]!
    expect(late.status).toBe(TerminalStatus.Silent)
    expect(terminalBadges(late, null)[0]).toMatchObject({ key: 'door', text: '🚪 ? (silent)' })
    expect(terminalBadges(rowWith({ door: 'closed', doorLevel: 3900 }), null)[0]).toMatchObject({ text: '🚪 shut 3900' })
  })

  it('terminalBadges leads with the door badges and passes the override through', () => {
    const r = rowWith({ door: 'closed', doorLevel: 3900, audio: true, version: 'v1' })
    expect(terminalBadges(r, 'v1', true).map((b) => b.key)).toEqual(['door', 'door-override', 'version'])
    expect(terminalBadges(r, 'v1').map((b) => b.key)).toEqual(['door', 'version'])
  })

  it('reads night.door_override off the screen state, false for anything else', () => {
    expect(doorOverrideFromScreen({ night: { door_override: true } })).toBe(true)
    expect(doorOverrideFromScreen({ night: { door_override: false } })).toBe(false)
    expect(doorOverrideFromScreen({ night: { door_override: null } })).toBe(false)
    expect(doorOverrideFromScreen({ night: {} })).toBe(false)
    expect(doorOverrideFromScreen({})).toBe(false)
    expect(doorOverrideFromScreen(null)).toBe(false)
  })
})

describe('the 🔌 patch bay badges (wave 22)', () => {
  const now = 1_000_000
  const rowWith = (p: Partial<TerminalPoll>): TerminalRow => mergeTerminals({}, server({ ...poll('Server Room', 500, 'face'), ...p }), now).rows[0]!

  it('carries the bay counts off the poll into the row', () => {
    expect(rowWith({ door: 'closed', patch: 3, patchComplete: false, patchBetween: 1 }).device).toMatchObject({ patch: 3, patchComplete: false, patchBetween: 1 })
    expect(hasPatchBay(rowWith({ patch: 0 }).device)).toBe(true)
    expect(hasPatchBay(rowWith({ door: 'closed' }).device)).toBe(false)
  })

  it('no cable is grey, some green, a complete set green with ✓', () => {
    const [none] = patchBadges(rowWith({ patch: 0, patchComplete: false, patchBetween: 0 }).device, false)
    expect(none).toMatchObject({ key: 'patch', text: '🔌 0', warn: false })
    expect(none!.tone).toBeUndefined()
    expect(patchBadges(rowWith({ patch: 2, patchComplete: false }).device, false)).toEqual([expect.objectContaining({ text: '🔌 2', tone: 'ok', warn: false })])
    const [four] = patchBadges(rowWith({ patch: 4, patchComplete: true }).device, false)
    expect(four).toMatchObject({ text: '🔌 4 ✓', tone: 'ok' })
    expect(four!.title).toContain('the story judges it')
  })

  it('an input between levels adds an amber ?, never a ✓', () => {
    const bs = patchBadges(rowWith({ patch: 4, patchComplete: false, patchBetween: 1 }).device, false)
    expect(bs.map((b) => [b.key, b.text, b.tone])).toEqual([
      ['patch', '🔌 4', 'ok'],
      ['patch-between', '🔌 ? 1', 'amber'],
    ])
    expect(bs[1]!.title).toContain('half-seated plug')
  })

  it('a fault is red and says the watch presses the buttons', () => {
    const [b] = patchBadges(rowWith({ patch: 'fault', patchFault: 'dup' }).device, false)
    expect(b).toMatchObject({ key: 'patch', text: '🔌 fault: dup', tone: 'red', warn: true })
    expect(b!.title).toContain('wiring fault')
    expect(b!.title).toContain('🔌 / 💥 / ❌')
    expect(patchBadges(rowWith({ patch: 'fault' }).device, false)[0]!.text).toBe('🔌 fault: unknown')
  })

  it('the override reads 🔌 buttons; a silent laptop reads ?', () => {
    const bs = patchBadges(rowWith({ patch: 4, patchComplete: true }).device, true)
    expect(bs.at(-1)).toMatchObject({ key: 'patch-override', text: '🔌 buttons', tone: 'amber' })
    expect(bs.at(-1)!.title).toContain('Trust the patch bay')
    expect(patchBadges(rowWith({ patch: 4, patchBetween: 2 }).device, false, true).map((b) => b.text)).toEqual(['🔌 ? (silent)'])
  })

  it('no badge for a terminal with no bay, override or not', () => {
    expect(patchBadges(rowWith({ door: 'closed' }).device, true)).toEqual([])
    expect(patchBadges(null, true)).toEqual([])
  })

  it('terminalBadges puts the bay right after the door, with its own override', () => {
    const r = rowWith({ door: 'closed', doorLevel: 3900, patch: 2, version: 'v1' })
    expect(terminalBadges(r, 'v1', false, true).map((b) => b.key)).toEqual(['door', 'patch', 'patch-override', 'version'])
    expect(terminalBadges(r, 'v1', true).map((b) => b.key)).toEqual(['door', 'door-override', 'patch', 'version'])
  })

  it('reads night.patch_override off the screen state', () => {
    expect(patchOverrideFromScreen({ night: { patch_override: true } })).toBe(true)
    expect(patchOverrideFromScreen({ night: { patch_override: false, door_override: true } })).toBe(false)
    expect(patchOverrideFromScreen({ night: {} })).toBe(false)
    expect(patchOverrideFromScreen(null)).toBe(false)
    expect(doorOverrideFromScreen({ night: { patch_override: true } })).toBe(false)
  })
})

describe('the link to the games (wave 59)', () => {
  const quiet = { audio: undefined, visible: undefined, battery: undefined, charging: undefined, fullscreen: undefined, mic: undefined, version: undefined, announce: undefined, door: undefined, doorLevel: undefined, doorFault: undefined, doorWarn: undefined, patch: undefined, patchComplete: undefined, patchBetween: undefined, patchFault: undefined }
  it('shows frames both ways and the last error in words', () => {
    const out = linkBadges({ ...quiet, camSent: 2.9, simReceived: 10, simDrawn: 18, linkError: 'blank', cam: { got: 2.8, read: 2.7 } } as TerminalDevice, false)
    expect(out.map((b) => b.key)).toEqual(['link-cam', 'link-sim', 'link-error'])
    expect(out[0]!.text).toBe('📷 2.9/s')
    expect(out[0]!.title).toMatch(/server took 2.8 a second, the games read 2.7/)
    expect(out[0]!.warn).toBe(false)
    expect(out[1]!.text).toBe('🎞 10/s · 18 drawn')
    expect(out[2]!.text).toMatch(/blank/)
    expect(out[2]!.warn).toBe(true)
  })
  it('warns on a camera sending nothing, says nothing of a half that isn\'t there or a code it doesn\'t know', () => {
    expect(linkBadges({ ...quiet, camSent: 0 } as TerminalDevice, false)[0]!.warn).toBe(true)
    expect(linkBadges({ ...quiet, linkError: 'nonsense' } as TerminalDevice, false)).toEqual([])
    expect(linkBadges(quiet as TerminalDevice, false)).toEqual([])
  })
  it('rides the server\'s list onto the row and into its badges', () => {
    const { rows } = mergeTerminals({}, { now: 1000, voiceMuted: false, silentMs: 20_000, terminals: [{ name: 'Hall', spot: 'hall', view: 'auto', character: '', ago: 10, camSent: 0.5, simReceived: 10, simDrawn: 18, linkError: 'offline', cam: { got: 0.5, read: 0 } }] }, 2000)
    const keys = terminalBadges(rows[0]!, null).map((b) => b.key)
    expect(keys).toEqual(expect.arrayContaining(['link-cam', 'link-sim', 'link-error']))
    expect(rows[0]!.device?.cam).toEqual({ got: 0.5, read: 0 })
  })
  it('a silent row shows no stale numbers', () => {
    expect(linkBadges({ ...quiet, camSent: 3 } as TerminalDevice, true)).toEqual([])
  })
})
