//! The terminal heartbeat card's logic (OCT31 K-29), pure so it is tested
//! without a server or a clock. Every wall terminal and the TV poll the
//! event's lean screen state every 1–2 s; the server remembers each one's
//! last poll and `GET /e/:id/api/mod/screen/terminals` reports it. The card
//! turns a terminal red once it has been silent for `silentMs` and the
//! editor chimes.
//!
//! The server forgets every terminal when its process restarts, so a tablet
//! that died *and* missed the restart would simply vanish. The editor keeps
//! its own memory of every terminal it has seen (per event, in
//! localStorage); a remembered terminal the server no longer lists is shown
//! silent since the last time this editor saw it.
//!
//! Times are client epoch ms: a server `ago` becomes `clientNow - ago`, so a
//! skewed laptop clock never paints a live tablet red.
//!
//! A current terminal build also reports its device on every poll
//! (SW-SCR-21): sound unlocked, page visible, battery, full screen (wave
//! 17), build stamp — the row's badges (`terminalBadges`). An older build
//! reports none.
//!
//! A room terminal (wave 7) also reports the LOCATION it belongs to (`room`):
//! the row says so, and one that isn't on the server-room spot is amber
//! (`strayRoom`) — a tablet that once was the TV keeps its `room` when its
//! view changes, and then quietly acts as a room terminal.

/** One entry of the server's heartbeat list (`ScreenPoll & {ago}`). */
export interface TerminalPoll {
  name: string
  spot: string
  view: string
  character: string
  /** The LOCATION a room terminal belongs to (wave 7); absent: not a room terminal. */
  room?: string
  /** ms since its last poll, on the server's clock. */
  ago: number
  /** The device health its build reports (SW-SCR-21); absent from an older build. */
  audio?: boolean
  visible?: boolean
  battery?: number
  charging?: boolean
  /** Full screen (wave 17); absent: can't be, turned off in ⚙, or an older build. */
  fullscreen?: boolean
  version?: string
}

/** A row's device health, as its last listed poll said. */
export type TerminalDevice = Pick<TerminalPoll, 'audio' | 'visible' | 'battery' | 'charging' | 'fullscreen' | 'version'>

/** `GET /api/mod/screen/terminals`. */
export interface ScreenTerminals {
  now: number
  terminals: TerminalPoll[]
  voiceMuted: boolean
  silentMs: number
}

/** What the editor remembers of a terminal (client epoch ms). */
export interface RememberedTerminal {
  spot: string
  view: string
  /** The room terminal's LOCATION, as last polled ("" or absent: none). */
  room?: string
  lastSeen: number
}
export type TerminalMemory = Record<string, RememberedTerminal>

export const TerminalStatus = {
  Live: 'live',
  Silent: 'silent',
} as const
export type TerminalStatus = (typeof TerminalStatus)[keyof typeof TerminalStatus]

export interface TerminalRow {
  name: string
  spot: string
  view: string
  /** The room terminal's LOCATION ("" = not a room terminal). */
  room: string
  status: TerminalStatus
  /** ms since its last poll. */
  silentFor: number
  /** The server no longer lists it (a server restart): only this editor remembers it. */
  remembered: boolean
  /** Its device health off the server's list; null = not listed this poll. */
  device: TerminalDevice | null
}

/** The fallback silence threshold, when the server doesn't say (it does: 20 s). */
export const DEFAULT_SILENT_MS = 20_000
/** How often the card asks the server. */
export const TERMINALS_POLL_MS = 4_000
/** While a silent terminal hasn't been acknowledged, chime again this often. */
export const RECHIME_MS = 60_000
/** At most this many terminals are remembered. */
const MAX_REMEMBERED = 32

/**
 * Fold the server's list into the editor's memory and lay out the card's rows
 * (silent first, then by name). `server` null = this poll failed: the memory
 * is untouched and every row ages on the client clock.
 */
export function mergeTerminals(
  memory: TerminalMemory,
  server: ScreenTerminals | null,
  clientNow: number,
): { memory: TerminalMemory; rows: TerminalRow[] } {
  const silentMs = server?.silentMs ?? DEFAULT_SILENT_MS
  const next: TerminalMemory = { ...memory }
  const listed = new Map<string, TerminalDevice>()
  for (const p of server?.terminals ?? []) {
    if (p.name === '') continue
    listed.set(p.name, { audio: p.audio, visible: p.visible, battery: p.battery, charging: p.charging, fullscreen: p.fullscreen, version: p.version })
    const lastSeen = clientNow - Math.max(0, p.ago)
    const prev = next[p.name]
    // A server restart forgets; never move a remembered poll backwards.
    next[p.name] = { spot: p.spot, view: p.view, room: p.room ?? '', lastSeen: prev !== undefined ? Math.max(prev.lastSeen, lastSeen) : lastSeen }
  }
  const names = Object.keys(next).sort((a, b) => next[b]!.lastSeen - next[a]!.lastSeen)
  for (const n of names.slice(MAX_REMEMBERED)) delete next[n]

  const rows: TerminalRow[] = Object.entries(next).map(([name, m]) => {
    const silentFor = Math.max(0, clientNow - m.lastSeen)
    return {
      name,
      spot: m.spot,
      view: m.view,
      room: m.room ?? '',
      status: silentFor >= silentMs ? TerminalStatus.Silent : TerminalStatus.Live,
      silentFor,
      remembered: server !== null && !listed.has(name),
      device: listed.get(name) ?? null,
    }
  })
  rows.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === TerminalStatus.Silent ? -1 : 1))
  return { memory: next, rows }
}

/** Names that are silent now and weren't on the previous look. */
export function newlySilent(prev: readonly TerminalRow[], rows: readonly TerminalRow[]): string[] {
  const was = new Map(prev.map((r) => [r.name, r.status]))
  return rows.filter((r) => r.status === TerminalStatus.Silent && was.get(r.name) !== TerminalStatus.Silent).map((r) => r.name)
}

/** Acknowledgements only hold while a terminal stays silent: one that comes back is forgotten, so its next silence chimes again. */
export function pruneAcks(acked: ReadonlySet<string>, rows: readonly TerminalRow[]): Set<string> {
  const silent = new Set(rows.filter((r) => r.status === TerminalStatus.Silent).map((r) => r.name))
  return new Set([...acked].filter((n) => silent.has(n)))
}

/**
 * Should the editor chime now? On any terminal newly silent; otherwise every
 * `RECHIME_MS` while a silent one is unacknowledged (`lastChime` = when it
 * last chimed, 0 = never).
 */
export function shouldChime(fresh: readonly string[], rows: readonly TerminalRow[], acked: ReadonlySet<string>, lastChime: number, now: number): boolean {
  if (fresh.length > 0) return true
  const unacked = rows.some((r) => r.status === TerminalStatus.Silent && !acked.has(r.name))
  return unacked && now - lastChime >= RECHIME_MS
}

/** `2 s` / `34 s` / `3 min` / `1 h 5 min`. */
export function formatSilence(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

/** A TV-type screen (the house Mac's `view=tv`, or a `mirror`). */
export function isTvView(view: string): boolean {
  return view === 'tv' || view === 'mirror'
}

/** The house map spot the one real room terminal hangs on (the show's `server-room`). */
export const ROOM_TERMINAL_SPOT = 'server-room'

/** A room terminal off the server-room spot: most likely a tablet that once
 *  was the TV (`room=The Desktop`) and kept its room when its view changed —
 *  it now sleeps on attract and speaks that room's lines instead of its own. */
export function strayRoom(row: Pick<TerminalRow, 'room' | 'spot'>): boolean {
  return row.room !== '' && row.spot !== ROOM_TERMINAL_SPOT
}

/** A battery under this (and not charging) is a red badge. */
export const LOW_BATTERY = 20

export interface TerminalBadge {
  key: 'audio' | 'hidden' | 'fullscreen' | 'battery' | 'version'
  text: string
  title: string
  /** Needs a hand: red (amber for an odd version). */
  warn: boolean
}

/** The build most listed terminals run (null: none report one, or a tie) —
 *  a tablet on another one is still on a cached old build. */
export function majorityVersion(rows: readonly TerminalRow[]): string | null {
  const n = new Map<string, number>()
  for (const r of rows) if (r.device?.version) n.set(r.device.version, (n.get(r.device.version) ?? 0) + 1)
  const ranked = [...n.entries()].sort((a, b) => b[1] - a[1])
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0]![1] === ranked[1]![1])) return null
  return ranked[0]![0]
}

/** What to do about ⛶. A terminal counts Chrome's `--kiosk` / F11 and a Home
 *  Screen app as full screen, so on the TV (nobody taps it) a ⛶ means its
 *  Chrome was started without `--kiosk`; a tablet just needs a touch. */
export function fullscreenTitle(row: Pick<TerminalRow, 'view'>): string {
  return isTvView(row.view)
    ? 'Not full screen: this Chrome was started without --kiosk. Quit it and relaunch with the kiosk flags (kiosk.md → the TV); a click on the screen also asks'
    : 'Not full screen: touch the screen once (it asks again on every touch)'
}

/** A row's install-day badges: 🔇 sound locked, 💤 page hidden, ⛶ not full
 *  screen (only when the build says so: one that can't be sends nothing), the battery,
 *  and the build (flagged when it differs from the majority's, or is missing
 *  while the others report one). */
export function terminalBadges(row: TerminalRow, majority: string | null): TerminalBadge[] {
  const d = row.device
  if (d === null) return []
  const out: TerminalBadge[] = []
  if (d.audio === false) out.push({ key: 'audio', text: '🔇', title: 'Sound is locked: touch the screen once so it can speak', warn: true })
  if (d.visible === false) out.push({ key: 'hidden', text: '💤', title: 'The page is hidden: the screen is off, or another app / a screensaver is on top', warn: true })
  if (d.fullscreen === false) out.push({ key: 'fullscreen', text: '⛶', title: fullscreenTitle(row), warn: true })
  if (typeof d.battery === 'number') {
    const low = d.battery < LOW_BATTERY && d.charging !== true
    out.push({ key: 'battery', text: `${d.charging === true ? '⚡' : '🔋'}${d.battery}%`, title: d.charging === true ? 'Charging' : low ? 'Battery low: plug it in' : 'On battery', warn: low })
  }
  if (d.version) {
    const odd = majority !== null && d.version !== majority
    out.push({ key: 'version', text: d.version, title: odd ? `An older or newer build than the others (${majority}): reload it before doors` : 'The terminal build', warn: odd })
  } else if (majority !== null) {
    // Listed but no stamp while the others carry one: a build from before the
    // stamp (wave 5), cached on the tablet — the stalest of all.
    out.push({ key: 'version', text: 'old build', title: `Reports no build stamp (the others run ${majority}): a cached pre-wave-5 build, reload it before doors`, warn: true })
  }
  return out
}
