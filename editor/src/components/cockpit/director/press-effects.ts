//! What the last press did (wave 10, spec §4.5): the ledger rows a cue's
//! press produced, from its `signal` (a director's press) or its `fire`
//! directive (the story's own auto cue) up to the next input — or to the
//! first row of a later story moment (`Sim.tick` records no row of its own,
//! so a timer's or an auto cue's rows would otherwise run on into it) —
//! summarised
//! for the NOW card's `did:` line — global writes as `path → value`,
//! per-guest writes aggregated (`cleared → true ×41`), beats, reveals,
//! broadcasts, codex unlocks and quest steps. Pure.

import type { LedgerEntry } from '@/store/cockpit'

/** Log rows that start a new input — where a press's effects end (the
 *  server's `CUE_INPUTS`). */
const INPUTS: ReadonlySet<string> = new Set(['signal', 'tick', 'chat', 'accountCreated', 'scanned'])

/** How far apart (story ms) two rows may land and still be one moment. A
 *  press's rows share its moment (the same `ts` on a folder run; a server
 *  run stamps each on arrival, a few ms apart), while the story's clock
 *  moves a second per tick — a timer's rows land at least that much later. */
export const SAME_MOMENT_MS = 500

/** Where the press at `log[at]` stops: the next input, or the first row of
 *  a later story moment (rows with no `ts` never split). */
export function pressEnd(log: readonly LedgerEntry[], at: number): number {
  const ts = log[at]?.ts
  let end = at + 1
  while (end < log.length) {
    const r = log[end]!
    if (INPUTS.has(r.event.type)) break
    if (ts !== undefined && r.ts !== undefined && Math.abs(r.ts - ts) > SAME_MOMENT_MS) break
    end++
  }
  return end
}

/** One press and what it did: the ledger rows from the press at `seq` to
 *  `pressEnd` (the Log page focused by `did: +N more ↗ Log`). Empty when the
 *  log no longer holds it. */
export function pressSlice(log: readonly LedgerEntry[], seq: number): LedgerEntry[] {
  const at = log.findIndex((r) => r.seq === seq)
  if (at < 0) return []
  return log.slice(at, pressEnd(log, at))
}

/** `rows` with every world write under a secret head (`Kernel.majority`)
 *  masked — the press-focused Log, which the `did:` line's `+N more` opens,
 *  must not print what that line masks. */
export function maskSecretWrites(rows: readonly LedgerEntry[], secretHeads: ReadonlySet<string>): LedgerEntry[] {
  const secret = new Set([...secretHeads].map(fold))
  if (secret.size === 0) return [...rows]
  return rows.map((r) => {
    const e = r.event
    if (e.type !== 'worldSet' || !secret.has(fold(e.path.split('.')[0] ?? ''))) return r
    return { ...r, event: { ...e, value: '••••' } }
  })
}

/** How many items the `did:` line shows before `+N more`. */
export const EFFECTS_SHOWN = 4

export interface PressEffects {
  /** The ledger seq of the press itself (the Log link). */
  seq: number
  /** When it landed (story ms), if the row carries it. */
  ts: number | undefined
  /** The first `EFFECTS_SHOWN` items. */
  items: string[]
  /** How many more the Log holds. */
  more: number
}

export interface PressEffectsOpts {
  /** Guest ids: their writes aggregate per slot. */
  persons?: ReadonlySet<string>
  /** Path heads whose values never show (a `secret: true` CHARACTER). */
  secretHeads?: ReadonlySet<string>
  /** Items to show (default `EFFECTS_SHOWN`). */
  max?: number
  /** The staff rooms (`ChannelSummary.staff` ids): a press that only told
   *  them why is a refused one, never the press described. */
  staffRooms?: Iterable<string>
  /** Countdown deadlines (path → label, the board's `countdown:` items): a
   *  write reads `⏱ Bingo ends 20:00` (from the press), never raw story
   *  seconds. */
  deadlines?: ReadonlyMap<string, string>
}

/** Seconds as `m:ss` (or `h:mm:ss`). */
function clockText(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** A deadline write as the `did:` line reads it. */
function deadlineText(label: string, raw: string, pressTs: number | undefined): string {
  const at = Number(unquote(raw))
  if (!Number.isFinite(at)) return `⏱ ${label} → ${unquote(raw)}`
  if (pressTs === undefined) return `⏱ ${label} set`
  const left = at - pressTs / 1000
  return left > 0 ? `⏱ ${label} ${clockText(left)}` : `⏱ ${label} off`
}

function fold(s: string): string {
  return s.trim().toLowerCase().replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function unquote(v: string): string {
  return v.replace(/^"(.*)"$/su, '$1')
}

/** A room name folded the way the server matches `channel(…)` scopes. */
export function roomFold(s: string): string {
  return s.replace(/^room:/u, '').toLowerCase().replace(/[#_-]/gu, ' ').replace(/\s+/gu, ' ').trim()
}

/** A broadcast scope that names only staff rooms (`channel(hosts)`). */
function staffOnly(scope: string, staff: ReadonlySet<string>): boolean {
  if (staff.size === 0) return false
  return scope.split('|').every((t) => {
    const m = /^channel\((.+)\)$/u.exec(t.trim())
    return m !== null && staff.has(roomFold(m[1]!))
  })
}

/** Did the press at `log[at]` do nothing but, at most, tell a staff room
 *  why (or note a `_` leaf)? The server's refusal rule, read off the log:
 *  such a press never became LAST, so `did:` never describes it. */
function refusedLooking(log: readonly LedgerEntry[], at: number, staff: ReadonlySet<string>): boolean {
  const end = pressEnd(log, at)
  for (let k = at + 1; k < end; k++) {
    const e = log[k]!.event
    if (e.type === 'diagnostic') continue
    if (e.type === 'broadcast' && staffOnly(e.scope, staff)) continue
    if (e.type === 'worldSet' && e.path.slice(e.path.lastIndexOf('.') + 1).startsWith('_')) continue
    return false
  }
  return true
}

/** Does ledger row `e` press the cue `key` (folded)? */
function presses(e: LedgerEntry['event'], key: string): boolean {
  if (e.type === 'signal') return fold(e.name) === key
  if (e.type === 'directive' && e.verb === 'fire') return fold(e.args.split(/ (?:for|with) /u)[0] ?? '') === key
  return false
}

/** Count-aggregated items in first-seen order. */
class Tally {
  private readonly n = new Map<string, number>()
  add(k: string): void {
    this.n.set(k, (this.n.get(k) ?? 0) + 1)
  }
  lines(): string[] {
    return [...this.n.entries()].map(([k, c]) => (c > 1 ? `${k} ×${c}` : k))
  }
}

/**
 * The newest press of `cueId` in `log` and what it did — null when the log
 * holds no press of it (pressed before this console connected).
 */
export function pressEffects(log: readonly LedgerEntry[], cueId: string, opts: PressEffectsOpts = {}): PressEffects | null {
  const key = fold(cueId)
  if (key === '') return null
  // The newest press that was taken; a refused re-press (its only effect a
  // # hosts line) is skipped. A cue whose every press looks refused (no rule
  // hears it — stagehand only) falls back to its newest press.
  const staff = new Set([...(opts.staffRooms ?? [])].map(roomFold))
  let newest = -1
  let at = -1
  for (let k = log.length - 1; k >= 0; k--) {
    if (!presses(log[k]!.event, key)) continue
    if (newest < 0) newest = k
    if (!refusedLooking(log, k, staff)) {
      at = k
      break
    }
  }
  if (at < 0) at = newest
  if (at < 0) return null
  const persons = opts.persons ?? new Set<string>()
  const secret = new Set([...(opts.secretHeads ?? [])].map(fold))
  const globals = new Map<string, string>()
  const perGuest = new Tally()
  const beats = new Tally()
  const reveals: string[] = []
  const broadcasts: string[] = []
  const codex = new Tally()
  const quests = new Tally()
  const deadlines = opts.deadlines ?? new Map<string, string>()
  const pressTs = log[at]!.ts
  const end = pressEnd(log, at)
  for (let k = at + 1; k < end; k++) {
    const e = log[k]!.event
    switch (e.type) {
      case 'worldSet': {
        if (e.path === 'Time' || e.path.startsWith('Time.')) break
        const segs = e.path.split('.')
        if (segs.some((s) => s.startsWith('_'))) break
        const head = segs[0]!
        if (persons.has(head)) {
          if (segs.length > 1) perGuest.add(`${segs.slice(1).join('.')} → ${unquote(e.value)}`)
          break
        }
        // A later write to the same path wins; the path keeps its first place.
        const label = deadlines.get(e.path)
        if (label !== undefined && !secret.has(fold(head))) {
          globals.set(e.path, deadlineText(label, e.value, pressTs))
          break
        }
        globals.set(e.path, secret.has(fold(head)) ? '••••' : unquote(e.value))
        break
      }
      case 'beatEntered':
        beats.add(`⤷ ${e.beat}`)
        break
      case 'revealed':
        reveals.push(`📂 ${e.target} open`)
        break
      case 'factionRevealed':
        reveals.push(`📂 ${e.faction} revealed`)
        break
      case 'broadcast':
        broadcasts.push(`📣 ${e.cue}`)
        break
      case 'codexUnlocked':
        codex.add(`📓 ${e.entry}`)
        break
      case 'quest':
        quests.add(`🧭 ${e.action} ${e.quest}`)
        break
      default:
        break
    }
  }
  const all = [
    ...[...globals.entries()].map(([p, v]) => (deadlines.has(p) && v.startsWith('⏱') ? v : `${p} → ${v}`)),
    ...perGuest.lines(),
    ...beats.lines(),
    ...reveals,
    ...broadcasts.slice(0, 2),
    ...(broadcasts.length > 2 ? [`+${broadcasts.length - 2} broadcasts`] : []),
    ...codex.lines(),
    ...quests.lines(),
  ]
  const max = opts.max ?? EFFECTS_SHOWN
  return { seq: log[at]!.seq, ts: log[at]!.ts, items: all.slice(0, max), more: Math.max(0, all.length - max) }
}
