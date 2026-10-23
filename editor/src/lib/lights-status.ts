//! The house lights on the Run page (wave 20, D8), pure so it tests without
//! a server. The event's `lights.json` (`GET /e/:id/api/mod/lights`, the map
//! editor's own read, asked here with no `after`, so it answers at once) says
//! which fixtures are placed, and the server knows whether the house Mac's
//! `lights` module is listening and whether a director opened Zigbee pairing.
//! The House map card's 💡 row reads it every `LIGHTS_POLL_MS`: *💡 lights
//! module online · N fixtures* (or *offline*), *pairing … s* while joining is
//! open, and the problems / warnings counts. Placing fixtures, looks and the
//! pairing button live in the map editor's 💡 Lights tab, not here.
//!
//! The editor has no dependency on `@loom/house`: the wire is parsed here,
//! defensively; an older server (404) or a malformed answer is null and the
//! row shows nothing.

/** How often the card re-reads the lights (no long poll). */
export const LIGHTS_POLL_MS = 15_000
/** …and while pairing is open, so the countdown's end shows promptly. */
export const LIGHTS_PAIR_POLL_MS = 5_000

/** The parts of `LightsView` the 💡 row reads. */
export interface LightsStatus {
  version: string
  source: 'director' | 'project' | 'env' | 'default'
  fixtures: number
  /** null: the module never polled this server. */
  module: { name: string; at: number; online: boolean } | null
  /** The latest pair while joining is open (null: closed). A close (`seconds: 0`) reads null. */
  pair: { seq: number; at: number; seconds: number; until: number } | null
  /** Z2M devices the module reported (0 when it never did). */
  devices: number
  problems: string[]
  warnings: string[]
  /** The newest server time the answer carries (its `now` when a server
   *  sends one, else the latest stamp in it): the countdown's anchor. */
  serverNow: number | null
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
const SOURCES = ['director', 'project', 'env', 'default'] as const

/** A `GET /api/mod/lights` answer → the row's status; null when it isn't one. */
export function lightsStatusOf(v: unknown): LightsStatus | null {
  if (!isRecord(v) || !isRecord(v['lights']) || typeof v['version'] !== 'string') return null
  const fixtures = Array.isArray(v['lights']['fixtures']) ? v['lights']['fixtures'].length : 0
  const m = v['module']
  const module = isRecord(m) && isNum(m['at']) ? { name: typeof m['name'] === 'string' ? m['name'] : '', at: m['at'], online: m['online'] === true } : null
  const p = v['pair']
  const pair =
    isRecord(p) && isNum(p['seq']) && isNum(p['at']) && isNum(p['seconds']) && isNum(p['until']) && p['seconds'] > 0
      ? { seq: p['seq'], at: p['at'], seconds: p['seconds'], until: p['until'] }
      : null
  const stamps: number[] = []
  if (isNum(v['now'])) stamps.push(v['now'])
  else {
    if (module !== null) stamps.push(module.at)
    if (pair !== null) stamps.push(pair.at)
    if (isNum(v['devicesAt'])) stamps.push(v['devicesAt'])
    if (Array.isArray(v['tests'])) for (const t of v['tests']) if (isRecord(t) && isNum(t['at'])) stamps.push(t['at'])
  }
  const source = SOURCES.find((s) => s === v['source']) ?? 'default'
  return {
    version: v['version'],
    source,
    fixtures,
    module,
    pair,
    devices: Array.isArray(v['devices']) ? v['devices'].length : 0,
    problems: strings(v['problems']),
    warnings: strings(v['warnings']),
    serverNow: stamps.length > 0 ? Math.max(...stamps) : null,
  }
}

/** Is there anything for the row to say? A story with no fixtures placed and
 *  no module ever seen has no lights: the row stays hidden. */
export function lightsShown(s: LightsStatus | null): s is LightsStatus {
  return s !== null && (s.fixtures > 0 || s.module !== null || s.pair !== null || s.problems.length > 0)
}

/**
 * When pairing closes, on this editor's clock. The answer carries no clock
 * of its own, so the time left is read off the newest server stamp in it (a
 * lower bound on the server's clock: never more time than the server gave)
 * and counted down from when the answer arrived (`receivedAt`, client ms).
 * Null: pairing isn't open.
 */
export function pairDeadline(s: LightsStatus, receivedAt: number): number | null {
  if (s.pair === null) return null
  const anchor = s.serverNow ?? s.pair.at
  const left = Math.min(s.pair.seconds * 1000, s.pair.until - anchor)
  return left > 0 ? receivedAt + left : null
}

/** `pairing 87 s` while open (null once the deadline passed). */
export function pairText(deadline: number | null, now: number): string | null {
  if (deadline === null || deadline <= now) return null
  return `pairing ${Math.ceil((deadline - now) / 1000)} s`
}

/** The row's words: `💡 lights module online · 1 fixture` / `… offline …`. */
export function lightsLine(s: LightsStatus): string {
  const mod = s.module === null ? 'lights module never connected' : s.module.online ? 'lights module online' : 'lights module offline'
  return `💡 ${mod} · ${s.fixtures} ${s.fixtures === 1 ? 'fixture' : 'fixtures'}`
}

/** The module part's hover: what is (or isn't) listening. */
export function moduleTitle(s: LightsStatus): string {
  if (s.module === null) return 'The house Mac’s lights module has not polled this server since it started: the story’s light cues play nowhere (stagehand launchd job lights)'
  if (!s.module.online) return `The lights module${s.module.name !== '' ? ` on ${s.module.name}` : ''} stopped polling: light cues play nowhere until it is back`
  return `The lights module${s.module.name !== '' ? ` on ${s.module.name}` : ''} is listening; ${s.devices} Zigbee ${s.devices === 1 ? 'device' : 'devices'} reported`
}

/** `2 problems · 1 warning` (null: none). */
export function problemsText(s: LightsStatus): string | null {
  const parts: string[] = []
  if (s.problems.length > 0) parts.push(`${s.problems.length} ${s.problems.length === 1 ? 'problem' : 'problems'}`)
  if (s.warnings.length > 0) parts.push(`${s.warnings.length} ${s.warnings.length === 1 ? 'warning' : 'warnings'}`)
  return parts.length > 0 ? parts.join(' · ') : null
}
