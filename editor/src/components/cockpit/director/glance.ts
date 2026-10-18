//! The Director's glance column, as pure data (wave 10, spec §3): what
//! needs a director's hand right now, the story's `watch:` board (values,
//! role counts over the guests, person rows), "Recently changed" when the
//! story declares no board, the people and the cast at a glance, and the
//! staff room's feed. Every section only summarises and links — nothing
//! here edits — and every row says where a click goes (`GlanceLink`).

import type { AgentMindSummary, WalletModView } from '@loom/core/views'
import {
  CockpitTab,
  SelectionKind,
  type CastSummary,
  type ChannelSummary,
  type CockpitMessage,
  type FactionSummary,
  type FactsView,
  type LedgerEntry,
  type LocationSummary,
  type RosterRow,
  type WatchSummary,
  type WorldEntry,
} from '@/store/cockpit'
import { judgeModeOf, pendingFilings, stageSegments } from '../mind'
import { heldTransfers } from '../wallet'
import { PartPresence, castPresence, isSignedIn, performerParts } from '../parts'

/** Where a glance row goes when clicked. */
export type GlanceLink =
  | { kind: 'tab'; tab: CockpitTab; channel?: string; worldFilter?: string; logSeq?: number }
  | { kind: 'inspect'; selection: { kind: SelectionKind; id: string } }

/** A name or path head's comparison key (case, `_`, `-`, space runs). */
export function foldKey(s: string): string {
  return s.trim().toLowerCase().replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ').trim()
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export const ValueTone = {
  True: 'true',
  False: 'false',
  None: 'none',
  Number: 'number',
  Text: 'text',
} as const
export type ValueTone = (typeof ValueTone)[keyof typeof ValueTone]

export interface WatchValue {
  text: string
  tone: ValueTone
}

/** A world value for the glance: `●` / `○` for a bool, `—` for nothing,
 *  quotes stripped. */
export function formatWatchValue(raw: string | null | undefined): WatchValue {
  if (raw === null || raw === undefined) return { text: '—', tone: ValueTone.None }
  const v = raw.trim().replace(/^"(.*)"$/su, '$1')
  if (v === '' || v === 'null' || v === 'none') return { text: '—', tone: ValueTone.None }
  if (v === 'true') return { text: '●', tone: ValueTone.True }
  if (v === 'false') return { text: '○', tone: ValueTone.False }
  if (/^-?\d+(\.\d+)?$/u.test(v)) return { text: v, tone: ValueTone.Number }
  return { text: v, tone: ValueTone.Text }
}

/** What a secret value shows until the director holds 👁. */
export const MASK = '••••'

/** Path heads whose values the Director never shows in clear: every
 *  `secret: true` CHARACTER (the cast says so), plus any a secret watch
 *  item names (an older server's cast carries no flag). */
export function secretHeads(cast: readonly CastSummary[], watch: readonly WatchSummary[]): Set<string> {
  const out = new Set(cast.filter((c) => c.secret === true).map((c) => c.id))
  for (const w of watch) if (w.secret === true && w.path !== null) out.add(w.path.split('.')[0]!)
  return out
}

/** A path's live value (the world row), or undefined. */
export function worldValue(world: readonly WorldEntry[], path: string): string | undefined {
  return world.find((w) => w.path === path)?.value
}

// ---------------------------------------------------------------------------
// The watch board
// ---------------------------------------------------------------------------

export const RoleAggKind = { Bool: 'bool', Number: 'number', Text: 'text' } as const
export type RoleAggKind = (typeof RoleAggKind)[keyof typeof RoleAggKind]

export type RoleAgg =
  | { type: typeof RoleAggKind.Bool; count: number; total: number }
  | { type: typeof RoleAggKind.Number; sum: number; max: number; total: number }
  | { type: typeof RoleAggKind.Text; top: Array<{ value: string; count: number }>; total: number }

export type WatchRow =
  | { kind: 'value'; key: string; label: string; path: string; value: WatchValue; secret: boolean }
  | { kind: 'role'; key: string; label: string; path: string; slot: string; agg: RoleAgg }
  | {
      kind: 'person'
      key: string
      label: string
      /** The roster id (a guest playing the name) or the cast id; null when neither. */
      id: string | null
      guest: boolean
      online: boolean | undefined
      location: string | null
      faction: string | null
      prison: boolean
      restricted: boolean
    }

/** The guests a ROLE slot counts over: roster rows on that role (folded),
 *  else — no row carries it (an older server, a renamed role) — every row. */
export function roleMembers(roster: readonly RosterRow[], role: string): RosterRow[] {
  const k = foldKey(role)
  const on = roster.filter((r) => foldKey(r.role) === k)
  return on.length > 0 ? on : [...roster]
}

/** A ROLE slot across the guests, from their `<guestId>.<slot>` world rows:
 *  a bool counts the true ones, a number sums (and takes the max), text
 *  lists its three commonest values. */
export function roleAggregate(world: readonly WorldEntry[], guests: readonly RosterRow[], slot: string): RoleAgg {
  const byPath = new Map(world.map((w) => [w.path, w.value]))
  const values = guests.map((g) => byPath.get(`${g.id}.${slot}`)).map((v) => (v === undefined ? undefined : v.replace(/^"(.*)"$/su, '$1')))
  const set = values.filter((v): v is string => v !== undefined && v !== 'null' && v !== 'none' && v !== '')
  const total = guests.length
  if (set.every((v) => v === 'true' || v === 'false')) {
    return { type: RoleAggKind.Bool, count: set.filter((v) => v === 'true').length, total }
  }
  if (set.every((v) => /^-?\d+(\.\d+)?$/u.test(v))) {
    const nums = set.map(Number)
    return { type: RoleAggKind.Number, sum: nums.reduce((a, b) => a + b, 0), max: Math.max(...nums), total }
  }
  const counts = new Map<string, number>()
  for (const v of set) counts.set(v, (counts.get(v) ?? 0) + 1)
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([value, count]) => ({ value, count }))
  return { type: RoleAggKind.Text, top, total }
}

/** The person a name item means: the guest playing it (a program's name)
 *  first, else the cast member. */
export function resolvePerson(name: string, roster: readonly RosterRow[], cast: readonly CastSummary[]): { row: RosterRow | null; cast: CastSummary | null } {
  const k = foldKey(name)
  const row = roster.find((r) => foldKey(r.name) === k) ?? null
  if (row !== null) return { row, cast: null }
  return { row: null, cast: cast.find((c) => foldKey(c.id) === k) ?? null }
}

/** The board, row by row. A secret value is masked here: its clear text
 *  never leaves `worldValue` (the 👁 hold reads it on demand). */
export function watchRows(
  watch: readonly WatchSummary[],
  world: readonly WorldEntry[],
  roster: readonly RosterRow[],
  cast: readonly CastSummary[],
): WatchRow[] {
  return watch.map((w, i): WatchRow => {
    const key = `${i}:${w.path ?? w.person ?? w.label}`
    if (w.scope === 'person' || w.path === null) {
      const { row, cast: c } = resolvePerson(w.person ?? w.label, roster, cast)
      return {
        kind: 'person',
        key,
        label: w.label,
        id: row?.id ?? c?.id ?? null,
        guest: row !== null,
        online: row !== null ? row.online : c?.online,
        location: row?.location ?? null,
        faction: row?.faction ?? c?.faction ?? null,
        prison: row?.captured ?? false,
        restricted: row?.restricted === true,
      }
    }
    if (w.scope === 'role') {
      // The head keeps its declared spelling (`Program.cleared`): the slot
      // is everything after the first dot.
      const dot = w.path.indexOf('.')
      const head = dot < 0 ? w.path : w.path.slice(0, dot)
      const slot = dot < 0 ? '' : w.path.slice(dot + 1)
      return { kind: 'role', key, label: w.label, path: w.path, slot, agg: roleAggregate(world, roleMembers(roster, head), slot) }
    }
    const secret = w.secret === true
    return {
      kind: 'value',
      key,
      label: w.label,
      path: w.path,
      value: secret ? { text: MASK, tone: ValueTone.Text } : formatWatchValue(worldValue(world, w.path)),
      secret,
    }
  })
}

// ---------------------------------------------------------------------------
// Recently changed (no `watch:` declared)
// ---------------------------------------------------------------------------

export interface RecentRow {
  path: string
  value: WatchValue
  /** When it was last written (story ms), if the log row carries it. */
  at: number | undefined
}

/** A path the "Recently changed" list skips: the clock, `_` bookkeeping
 *  leaves, and anything on a guest or a cast member (people have their own
 *  pages — and a secret CHARACTER's slots must never surface here). */
function privatePath(path: string, people: ReadonlySet<string>): boolean {
  if (path === 'Time' || path.startsWith('Time.')) return true
  const segs = path.split('.')
  if (segs.some((s) => s.startsWith('_'))) return true
  return people.has(foldKey(segs[0]!))
}

/** The last `n` distinct global paths the log wrote, newest first, with
 *  their current value. */
export function recentGlobals(
  log: readonly LedgerEntry[],
  world: readonly WorldEntry[],
  rosterIds: Iterable<string>,
  castIds: Iterable<string>,
  n: number,
): RecentRow[] {
  const people = new Set<string>()
  for (const id of rosterIds) people.add(foldKey(id))
  for (const id of castIds) people.add(foldKey(id))
  const seen = new Set<string>()
  const out: RecentRow[] = []
  for (let k = log.length - 1; k >= 0 && out.length < n; k--) {
    const e = log[k]!.event
    if (e.type !== 'worldSet' || seen.has(e.path) || privatePath(e.path, people)) continue
    seen.add(e.path)
    out.push({ path: e.path, value: formatWatchValue(worldValue(world, e.path) ?? e.value), at: log[k]!.ts })
  }
  return out
}

/** Which paths changed when, carried snapshot to snapshot: a path seen for
 *  the first time is not "changed" (`at: -Infinity`). */
export interface Seen {
  value: string
  at: number
}

export function changedPaths(prev: ReadonlyMap<string, Seen>, next: readonly WorldEntry[], now: number): Map<string, Seen> {
  const out = new Map<string, Seen>()
  for (const w of next) {
    const was = prev.get(w.path)
    if (was === undefined) out.set(w.path, { value: w.value, at: prev.size === 0 ? -Infinity : now })
    else if (was.value !== w.value) out.set(w.path, { value: w.value, at: now })
    else out.set(w.path, was)
  }
  return out
}

/** How long a changed value keeps its ◆. */
export const CHANGED_MS = 10_000

export function changedRecently(seen: ReadonlyMap<string, Seen>, path: string, now: number): boolean {
  const s = seen.get(path)
  return s !== undefined && now - s.at < CHANGED_MS
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** "A majority" of `n` guests. */
export function majorityOf(n: number): number {
  return Math.floor(n / 2) + 1
}

export interface PeopleGlance {
  joined: number
  /** Streaming now — null where presence isn't tracked (a local run). */
  online: number | null
  prisons: Array<{ id: string; label: string; people: Array<{ id: string; name: string }> }>
  restricted: number
  factions: Array<{ id: string; count: number; joined: number; majority: number; hidden: boolean }>
  crowded: Array<{ id: string; label: string; count: number }>
}

export function peopleGlance(
  roster: readonly RosterRow[],
  factions: readonly FactionSummary[],
  locations: readonly LocationSummary[],
): PeopleGlance {
  const ids = new Set(roster.map((r) => r.id))
  const nameOf = new Map(roster.map((r) => [r.id, r.name]))
  const joined = roster.length
  const tracked = roster.some((r) => r.online !== undefined)
  return {
    joined,
    online: tracked ? roster.filter((r) => r.online === true).length : null,
    prisons: locations
      .filter((l) => l.prison)
      .map((l) => ({
        id: l.id,
        label: l.label || l.id,
        people: l.occupants.filter((o) => ids.has(o)).map((o) => ({ id: o, name: nameOf.get(o) ?? o })),
      }))
      .filter((p) => p.people.length > 0),
    restricted: roster.filter((r) => r.restricted === true).length,
    factions: factions
      .map((f) => ({
        id: f.id,
        count: f.members.filter((m) => ids.has(m)).length,
        joined,
        majority: majorityOf(joined),
        hidden: f.hidden && !f.revealed,
      }))
      .filter((f) => f.count > 0),
    crowded: locations
      .map((l) => ({ id: l.id, label: l.label || l.id, count: l.occupants.filter((o) => ids.has(o)).length }))
      .filter((l) => l.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 3),
  }
}

// ---------------------------------------------------------------------------
// Cast
// ---------------------------------------------------------------------------

export interface BoothSummary {
  dots: Array<{ id: string; presence: PartPresence }>
  signedIn: number
  offline: number
  /** The server says who holds the parts (false on a local run). */
  tracked: boolean
}

export function boothSummary(cast: readonly CastSummary[]): BoothSummary {
  const dots = performerParts(cast).map((c) => ({ id: c.id, presence: castPresence(c, true) }))
  return {
    dots,
    signedIn: dots.filter((d) => isSignedIn(d.presence)).length,
    offline: dots.filter((d) => d.presence === PartPresence.PhoneOffline).length,
    tracked: dots.some((d) => d.presence !== PartPresence.Unknown),
  }
}

export interface AgentGlance {
  id: string
  presence: PartPresence
  stage: string | null
  /** 1-based place on the declared arc; null when undeclared / unknown. */
  stageIndex: number | null
  stageCount: number
  mood: string | null
}

/** One line per agent-voiced character: its worker, and where its mind is. */
export function agentGlance(minds: readonly AgentMindSummary[], cast: readonly CastSummary[]): AgentGlance[] {
  const ids = [...new Set([...cast.filter((c) => c.agent === true).map((c) => c.id), ...minds.map((m) => m.character)])]
  return ids.map((id) => {
    const c = cast.find((x) => x.id === id)
    const mind = minds.find((m) => m.character === id)
    const segs = mind === undefined ? [] : stageSegments(mind)
    const cur = segs.findIndex((s) => s.state === 'current')
    return {
      id,
      presence: c === undefined ? PartPresence.Unknown : castPresence(c, false),
      stage: mind !== undefined && mind.stage !== '' ? mind.stage : null,
      stageIndex: mind !== undefined && mind.stages.length > 0 && cur >= 0 ? cur + 1 : null,
      stageCount: mind?.stages.length ?? 0,
      mood: mind !== undefined && mind.mood.trim() !== '' ? mind.mood.trim() : null,
    }
  })
}

// ---------------------------------------------------------------------------
// The staff room
// ---------------------------------------------------------------------------

/** The story's staff rooms (`ChannelSummary.staff`). */
export function staffChannels(channels: readonly ChannelSummary[]): ChannelSummary[] {
  return channels.filter((c) => c.staff === true)
}

/** The narrow strip's Watch chip: its first two values (`Y2K clock 23:30 ·
 *  Round 3`), a secret one masked; null with nothing live to watch. */
export function watchChipText(rows: readonly WatchRow[], n = 2): string | null {
  if (rows.length === 0) return null
  const shown = rows.slice(0, n).map((r) => {
    if (r.kind === 'value') return `${r.label} ${r.secret ? MASK : r.value.text}`
    if (r.kind === 'role') {
      const a = r.agg
      const v = a.type === RoleAggKind.Bool ? `${a.count}/${a.total}` : a.type === RoleAggKind.Number ? String(a.sum) : (a.top[0]?.value ?? '—')
      return `${r.label} ${v}`
    }
    return r.label
  })
  return `${shown.join(' · ')}${rows.length > n ? ` +${rows.length - n}` : ''}`
}

/** The last `n` messages in the staff rooms, newest first (the line a
 *  director needs is on top, never below the fold). */
export function staffFeed(messages: readonly CockpitMessage[], channels: readonly ChannelSummary[], n: number): CockpitMessage[] {
  const staff = new Set(staffChannels(channels).map((c) => c.id))
  if (staff.size === 0) return []
  const out: CockpitMessage[] = []
  for (let k = messages.length - 1; k >= 0 && out.length < n; k--) {
    const m = messages[k]!
    if (staff.has(m.channel) && m.hidden !== true) out.push(m)
  }
  return out
}

/** How long ago (story time) a line landed: `now`, `12m`, `1h05m` — a
 *  story clock past the hour never reads like a time of day (`75:45`). */
export function storyAgo(ts: number | undefined, nowMs: number | null): string {
  if (ts === undefined || nowMs === null) return '—'
  const s = Math.max(0, Math.round((nowMs - ts) / 1000))
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** The first staff-room line after `afterSeq` — the story's reason for a
 *  refused press (it lands just after the press is sent). The first, not
 *  the newest: a later `# hosts` line (another director, a scan note) is
 *  never passed off as this press's reason. */
export function staffReason(messages: readonly CockpitMessage[], channels: readonly ChannelSummary[], afterSeq: number): CockpitMessage | null {
  const staff = new Set(staffChannels(channels).map((c) => c.id))
  let first: CockpitMessage | null = null
  for (let k = messages.length - 1; k >= 0; k--) {
    const m = messages[k]!
    if (m.seq <= afterSeq) break
    if (staff.has(m.channel) && m.hidden !== true) first = m
  }
  return first
}

/** The newest message seq this console holds (what a press's reason must follow). */
export function lastSeq(messages: readonly CockpitMessage[]): number {
  return messages.length === 0 ? -1 : messages[messages.length - 1]!.seq
}

// ---------------------------------------------------------------------------
// Needs you
// ---------------------------------------------------------------------------

export const NeedKind = {
  Refused: 'refused',
  Filings: 'filings',
  Held: 'held',
  PhoneOffline: 'phone-offline',
  Free: 'free',
  NoWorker: 'no-worker',
} as const
export type NeedKind = (typeof NeedKind)[keyof typeof NeedKind]

export interface NeedItem {
  kind: NeedKind
  key: string
  text: string
  /** A second line (the `# hosts` reason for a refused press). */
  detail?: string
  link: GlanceLink
}

/** A press this console sent that the story refused. */
export interface RefusedPress {
  /** The cue as the sheet shows it (`❌ Wrong combination`). */
  cue: string
  /** Wall ms it came back refused. */
  at: number
  /** The newest message seq when it was sent: its reason follows it. */
  seq: number
}

/** How long a refused press stays under Needs you. */
export const REFUSED_NEEDS_MS = 60_000

/** How long a refusal waits for its staff-room line before saying none came. */
export const REASON_WAIT_MS = 3000

/** The second line of a refusal: the staff room's reason, or why there is none. */
export function refusalReason(why: CockpitMessage | null, channels: readonly ChannelSummary[], age: number): string {
  if (why !== null) return why.text
  if (staffChannels(channels).length === 0) return 'the story gives no reason here'
  return age < REASON_WAIT_MS ? 'waiting for the staff room…' : 'the story gave no reason'
}

export interface NeedsInput {
  refused: RefusedPress | null
  now: number
  messages: readonly CockpitMessage[]
  channels: readonly ChannelSummary[]
  world: readonly WorldEntry[]
  facts: FactsView | null
  wallet: WalletModView | null
  cast: readonly CastSummary[]
  /** The doors are open (a part nobody holds only matters then). */
  doorsOpen: boolean
}

export function needsYou(input: NeedsInput): NeedItem[] {
  const out: NeedItem[] = []
  const { refused, now } = input
  if (refused !== null && now - refused.at < REFUSED_NEEDS_MS) {
    const why = staffReason(input.messages, input.channels, refused.seq)
    const room = why?.channel ?? staffChannels(input.channels)[0]?.id
    out.push({
      kind: NeedKind.Refused,
      key: `refused:${refused.at}`,
      text: `✕ ${refused.cue} not taken`,
      detail: refusalReason(why, input.channels, now - refused.at),
      link: room !== undefined ? { kind: 'tab', tab: CockpitTab.Chat, channel: room } : { kind: 'tab', tab: CockpitTab.Log },
    })
  }
  if (input.facts !== null && judgeModeOf([...input.world], input.facts) === 'review') {
    const n = pendingFilings(input.facts).length
    if (n > 0) out.push({ kind: NeedKind.Filings, key: 'filings', text: `📝 ${n} filing${n === 1 ? '' : 's'} to review`, link: { kind: 'tab', tab: CockpitTab.Mind } })
  }
  const held = heldTransfers(input.wallet).length
  if (held > 0) out.push({ kind: NeedKind.Held, key: 'held', text: `💰 ${held} held transfer${held === 1 ? '' : 's'}`, link: { kind: 'tab', tab: CockpitTab.Run } })
  const parts = new Set(performerParts(input.cast).map((c) => c.id))
  for (const c of input.cast) {
    const p = castPresence(c, parts.has(c.id))
    if (p === PartPresence.Unvoiced) {
      out.push({ kind: NeedKind.NoWorker, key: `agent:${c.id}`, text: `🤖 ${c.id}: no worker`, link: { kind: 'tab', tab: CockpitTab.Mind } })
    } else if (input.doorsOpen && p === PartPresence.PhoneOffline) {
      out.push({ kind: NeedKind.PhoneOffline, key: `part:${c.id}`, text: `📱 ${c.id}: phone offline`, link: { kind: 'inspect', selection: { kind: SelectionKind.Character, id: c.id } } })
    } else if (input.doorsOpen && p === PartPresence.Free) {
      out.push({ kind: NeedKind.Free, key: `part:${c.id}`, text: `🎭 ${c.id}: nobody signed in`, link: { kind: 'inspect', selection: { kind: SelectionKind.Character, id: c.id } } })
    }
  }
  return out
}
