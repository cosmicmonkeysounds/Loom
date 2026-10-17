//! Export a run — the raw ledger, every room's transcript, the roster and
//! the world state — as one JSON document. The same shape on both backends,
//! so a local rehearsal export and a live-event export diff cleanly (bug
//! reports, post-mortems, "what did guest X actually see"). A run that just
//! ended exports from `lastRun`, so a co-writer ending the show doesn't
//! take the evidence with them.
//!
//! A server console only holds the `sim` feed since it connected (and at
//! most its cap), so a server export pages the whole ledger off
//! `GET /e/:id/api/mod/log` (T7-03). When that fails — an older server, the
//! event already gone — the export keeps what the console saw and says so
//! (`complete: false` + `warning`), never silently short.

import { logApi, type ModLogPage } from '@/lib/api'
import { notify } from '@/store/dialog'
import { RunBackend, type CockpitState, type LedgerEntry, type RunInfo } from '@/store/cockpit'

export interface RunExport {
  format: 'loom-run/1'
  exportedAt: string
  /** Where the run executed. */
  source: 'local' | 'server'
  /** Rehearsal or live. */
  mode: RunInfo['mode'] | null
  scenario: string | null
  phase: string
  ledgerLen: number
  /** The ledger: the whole of it when `complete`, else the rows this console
   *  held (a server console only has the feed since it connected). */
  log: CockpitState['log']
  /** `log` is the whole ledger (`log.length === ledgerLen`). */
  complete: boolean
  /** Why it isn't (absent when complete). */
  warning?: string
  messages: CockpitState['messages']
  roster: CockpitState['roster']
  factions: CockpitState['factions']
  locations: CockpitState['locations']
  choices: CockpitState['choices']
  world: CockpitState['world']
  /** Who started + ended it (server runs name their directors). */
  startedBy: string | null
  endedBy: string | null
}

/** The run an export describes: the live one, else the one that just ended
 *  (with the final snapshot it left behind). */
function runOf(s: CockpitState): {
  run: RunInfo | null
  log: CockpitState['log']
  ledgerLen: number
  messages: CockpitState['messages']
  roster: CockpitState['roster']
  factions: CockpitState['factions']
  locations: CockpitState['locations']
  world: CockpitState['world']
  choices: CockpitState['choices']
  endedBy: string | null
} {
  if (s.run === null && s.lastRun !== null) {
    const l = s.lastRun
    return { run: l.run, log: l.log, ledgerLen: l.ledgerLen ?? l.log.length, messages: l.messages, roster: l.roster, factions: l.factions, locations: l.locations, world: l.world, choices: l.choices, endedBy: l.endedBy }
  }
  return { run: s.run, log: s.log, ledgerLen: Math.max(s.ledgerLen, s.log.length), messages: s.messages, roster: s.roster, factions: s.factions, locations: s.locations, world: s.world, choices: s.choices, endedBy: null }
}

/** Pure projection of the cockpit state into the export document. `whole`
 *  = the whole ledger, paged off the server (`fetchWholeLedger`). */
export function buildRunExport(s: CockpitState, now: Date = new Date(), whole: LedgerEntry[] | null = null): RunExport {
  const r = runOf(s)
  const log = whole ?? r.log
  const ledgerLen = Math.max(r.ledgerLen, log.length)
  const complete = log.length >= ledgerLen
  return {
    format: 'loom-run/1',
    exportedAt: now.toISOString(),
    source: r.run?.backend ?? 'local',
    mode: r.run?.mode ?? null,
    scenario: r.run?.scenario ?? null,
    phase: s.phase,
    ledgerLen,
    log,
    complete,
    ...(complete ? {} : { warning: partialWarning(log.length, ledgerLen) }),
    messages: r.messages,
    roster: r.roster,
    factions: r.factions,
    locations: r.locations,
    choices: r.choices,
    world: r.world,
    startedBy: r.run?.startedBy ?? null,
    endedBy: r.endedBy,
  }
}

/** The note a partial export carries (and the director is shown). */
export function partialWarning(held: number, ledgerLen: number, why?: string): string {
  return `This export holds the ${held} ledger events this console saw, of ${ledgerLen}${why ? ` (${why})` : ''}. The messages, roster and world state are complete.`
}

/** Rows per ledger page (the server caps a page at 5000). */
export const LEDGER_PAGE = 5000
/** Never ask for more pages than this (a misbehaving server can't loop us). */
const MAX_PAGES = 400

/** One page of the ledger, `after` null = from the start. */
export type FetchLedgerPage = (after: number | null, limit: number) => Promise<ModLogPage>

/** A page row → a ledger entry: the sim feed's raw `SimEvent` (its index in
 *  the ledger is its seq), or an already-wrapped `{seq, ts?, event}`. `ts`
 *  comes from the row, else from when this console saw it land; a row it
 *  never saw has none (never 0, which reads as the Unix epoch). */
function ledgerEntryOf(raw: unknown, index: number, seen: ReadonlyMap<number, number>): LedgerEntry | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const at = (seq: number, own?: unknown) => {
    const ts = typeof own === 'number' ? own : seen.get(seq)
    return ts !== undefined ? { ts } : {}
  }
  if (o['event'] !== null && typeof o['event'] === 'object' && typeof (o['event'] as Record<string, unknown>)['type'] === 'string') {
    const seq = typeof o['seq'] === 'number' ? o['seq'] : index
    return { seq, ...at(seq, o['ts']), event: o['event'] as LedgerEntry['event'] }
  }
  if (typeof o['type'] === 'string') return { seq: index, ...at(index), event: raw as LedgerEntry['event'] }
  return null
}

/**
 * Page the whole ledger off the server, oldest first. `seen` = the rows this
 * console holds, whose receive times fill the pages' missing `ts`. Throws
 * when a page fails (the caller falls back to `seen`).
 */
export async function fetchWholeLedger(fetchPage: FetchLedgerPage, seen: readonly LedgerEntry[] = [], limit: number = LEDGER_PAGE): Promise<LedgerEntry[]> {
  const ts = new Map(seen.flatMap((e) => (e.ts !== undefined ? [[e.seq, e.ts] as const] : [])))
  const out: LedgerEntry[] = []
  let index = 0
  let after: number | null = null
  for (let pages = 0; pages < MAX_PAGES; pages++) {
    const page = await fetchPage(after, limit)
    const rows = Array.isArray(page.entries) ? page.entries : []
    for (const raw of rows) {
      const e = ledgerEntryOf(raw, index, ts)
      if (e !== null) out.push(e)
      index += 1
    }
    if (page.next === null || page.next === undefined || rows.length === 0) break
    if (typeof page.total === 'number' && index >= page.total) break
    after = page.next
  }
  return out
}

/** Why a ledger fetch failed, in a director's words. */
function whyNot(e: unknown): string {
  const status = (e as { status?: unknown } | null)?.status
  if (status === 404) return 'the server has no whole-ledger route, or the event has ended'
  if (status === 401 || status === 403) return 'the server refused the ledger to this console'
  return `the server didn’t hand over the whole ledger: ${(e as Error)?.message ?? String(e)}`
}

/**
 * The export, with the whole ledger when this console can get it: a running
 * server run pages it off the server (falling back to what this console saw,
 * with a warning); a local run already holds all of it; a run that ended
 * exports what was kept when it ended.
 */
export async function exportRun(s: CockpitState, now: Date = new Date(), fetchPage?: FetchLedgerPage): Promise<RunExport> {
  const r = runOf(s)
  const eventId = s.run !== null && s.run.backend === RunBackend.Server ? s.run.eventId : null
  // This console already holds every row from the first one: nothing to fetch.
  const holdsAll = r.log.length >= r.ledgerLen && (r.log.length === 0 || r.log[0]!.seq === 0)
  if (eventId === null || holdsAll) return buildRunExport(s, now)
  const page = fetchPage ?? ((after, limit) => logApi.page(eventId, after, limit))
  try {
    return buildRunExport(s, now, await fetchWholeLedger(page, r.log))
  } catch (e) {
    const doc = buildRunExport(s, now)
    return doc.complete ? doc : { ...doc, warning: partialWarning(doc.log.length, doc.ledgerLen, whyNot(e)) }
  }
}

/** File name for an export: `<scenario>-run-<timestamp>.json`. */
export function runExportFilename(s: CockpitState, now: Date = new Date()): string {
  const scenario = runOf(s).run?.scenario ?? null
  const stem = (scenario ?? 'loom').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'loom'
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${stem}-run-${stamp}.json`
}

/** Is there anything to export — a live run, or one that just ended? */
export function canExportRun(s: CockpitState): boolean {
  return s.run !== null || s.lastRun !== null
}

/** Trigger a browser download of the export (no-op outside a DOM) — the
 *  whole ledger when it can be had; a partial one says so once saved. */
export async function downloadRunExport(s: CockpitState): Promise<void> {
  if (typeof document === 'undefined') return
  const now = new Date()
  const doc = await exportRun(s, now)
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = runExportFilename(s, now)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  if (doc.warning !== undefined) void notify({ title: 'The export is partial', body: doc.warning })
}
