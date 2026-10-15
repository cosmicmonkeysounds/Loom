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

/** One entry of the server's heartbeat list (`ScreenPoll & {ago}`). */
export interface TerminalPoll {
  name: string
  spot: string
  view: string
  character: string
  /** ms since its last poll, on the server's clock. */
  ago: number
}

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
  status: TerminalStatus
  /** ms since its last poll. */
  silentFor: number
  /** The server no longer lists it (a server restart): only this editor remembers it. */
  remembered: boolean
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
  const listed = new Set<string>()
  for (const p of server?.terminals ?? []) {
    if (p.name === '') continue
    listed.add(p.name)
    const lastSeen = clientNow - Math.max(0, p.ago)
    const prev = next[p.name]
    // A server restart forgets; never move a remembered poll backwards.
    next[p.name] = { spot: p.spot, view: p.view, lastSeen: prev !== undefined ? Math.max(prev.lastSeen, lastSeen) : lastSeen }
  }
  const names = Object.keys(next).sort((a, b) => next[b]!.lastSeen - next[a]!.lastSeen)
  for (const n of names.slice(MAX_REMEMBERED)) delete next[n]

  const rows: TerminalRow[] = Object.entries(next).map(([name, m]) => {
    const silentFor = Math.max(0, clientNow - m.lastSeen)
    return {
      name,
      spot: m.spot,
      view: m.view,
      status: silentFor >= silentMs ? TerminalStatus.Silent : TerminalStatus.Live,
      silentFor,
      remembered: server !== null && !listed.has(name),
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
