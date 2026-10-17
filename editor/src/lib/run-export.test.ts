import { describe, expect, it } from 'vitest'
import { nullCockpit, RunBackend, RunMode, type RunInfo } from '@/store/cockpit'
import { ApiError, type ModLogPage } from '@/lib/api'
import { buildRunExport, canExportRun, exportRun, fetchWholeLedger, runExportFilename, type FetchLedgerPage } from './run-export'

const serverRun: RunInfo = {
  backend: RunBackend.Server,
  mode: RunMode.Live,
  scratch: false,
  scenario: 'Glass Orchard',
  stale: false,
  codes: { event: 'E', prime: 'P', mod: 'M' },
  joinUrl: 'http://x/?code=E',
  eventId: 'evt',
  startedAt: 0,
  startedBy: 'Ada',
}

describe('run export', () => {
  const base = nullCockpit.getState()
  it('projects the cockpit state into a versioned document', () => {
    const s = { ...base, run: serverRun, phase: 'open' as const, ledgerLen: 2, modsOnline: 2 }
    const doc = buildRunExport(s, new Date('2026-09-09T12:00:00Z'))
    expect(doc).toMatchObject({ format: 'loom-run/1', source: 'server', mode: 'live', scenario: 'Glass Orchard', ledgerLen: 2, startedBy: 'Ada' })
    expect(buildRunExport(base).source).toBe('local')
    expect(buildRunExport(base).mode).toBeNull()
  })
  it('exports the run that just ended — with its final snapshot — when nothing is running', () => {
    const log = [{ seq: 0, ts: 0, event: { type: 'tick', elapsedMs: 1000 } as never }]
    const roster = [{ id: 'p1', name: 'Writer', role: 'Guest', faction: null, trueFaction: null, location: null, captured: false, score: 5 }]
    const world = [{ path: 'p1.score', value: '5' }]
    const s = {
      ...base,
      run: null,
      lastRun: { run: { ...serverRun, mode: RunMode.Rehearsal }, log, messages: [], roster, factions: [], locations: [], world, choices: {}, endedBy: 'Bo', endedAt: 5 },
    }
    const doc = buildRunExport(s)
    expect(doc).toMatchObject({ source: 'server', mode: 'rehearsal', endedBy: 'Bo', ledgerLen: 1 })
    expect(doc.log).toBe(log)
    expect(doc.roster).toEqual(roster)
    expect(doc.world).toEqual(world)
    expect(canExportRun(s)).toBe(true)
    expect(canExportRun(base)).toBe(false)
  })
  it('names the file after the scenario and the timestamp', () => {
    const s = { ...base, run: { ...serverRun, scenario: 'Glass Orchard!' } }
    expect(runExportFilename(s, new Date('2026-09-09T12:34:56Z'))).toBe('glass-orchard-run-2026-09-09T12-34-56.json')
    expect(runExportFilename(base, new Date('2026-09-09T12:34:56Z'))).toBe('loom-run-2026-09-09T12-34-56.json')
  })
})

/** A fake `/api/mod/log` over `n` raw sim events: `after` = the last index
 *  already handed over (exclusive), pages of `limit`. */
function fakeLog(n: number): { page: FetchLedgerPage; calls: Array<number | null> } {
  const ledger = Array.from({ length: n }, (_, i) => ({ type: 'tick', elapsedMs: i }))
  const calls: Array<number | null> = []
  const page: FetchLedgerPage = async (after, limit) => {
    calls.push(after)
    const from = after === null ? 0 : after + 1
    const entries = ledger.slice(from, from + limit)
    const last = from + entries.length - 1
    const done: ModLogPage = { entries, next: last + 1 < n ? last : null, total: n }
    return done
  }
  return { page, calls }
}

describe('the whole ledger (T7-03)', () => {
  const base = nullCockpit.getState()
  const seen = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ seq: from + i, ts: 1000 + from + i, event: { type: 'tick', elapsedMs: from + i } as never }))

  it('pages every row, in order, keeping the times this console saw', async () => {
    const { page, calls } = fakeLog(12_001)
    const rows = await fetchWholeLedger(page, seen(11_990, 12_001))
    expect(rows).toHaveLength(12_001)
    expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 12_001 }, (_, i) => i))
    expect(calls).toEqual([null, 4999, 9999])
    // A row this console never saw land carries no time (not 0, the Unix epoch).
    expect(rows[0]!.ts).toBeUndefined()
    expect('ts' in rows[0]!).toBe(false)
    expect(rows[12_000]!.ts).toBe(1000 + 12_000)
  })

  it('takes wrapped {seq, ts, event} rows too', async () => {
    const page: FetchLedgerPage = async () => ({ entries: [{ seq: 0, ts: 7, event: { type: 'tick', elapsedMs: 0 } }], next: null, total: 1 })
    expect(await fetchWholeLedger(page)).toEqual([{ seq: 0, ts: 7, event: { type: 'tick', elapsedMs: 0 } }])
  })

  it('a late console exports the whole ledger, not the rows it saw', async () => {
    const s = { ...base, run: serverRun, phase: 'open' as const, ledgerLen: 1977, log: seen(1970, 1977) }
    const doc = await exportRun(s, new Date(), fakeLog(1977).page)
    expect(doc).toMatchObject({ ledgerLen: 1977, complete: true })
    expect(doc.log).toHaveLength(1977)
    expect(doc.warning).toBeUndefined()
  })

  it('falls back to what this console saw, with a warning, when the server has no ledger route', async () => {
    const s = { ...base, run: serverRun, phase: 'open' as const, ledgerLen: 1977, log: seen(1970, 1977) }
    const missing: FetchLedgerPage = async () => {
      throw new ApiError(404, { error: 'not found' })
    }
    const doc = await exportRun(s, new Date(), missing)
    expect(doc).toMatchObject({ ledgerLen: 1977, complete: false })
    expect(doc.log).toHaveLength(7)
    expect(doc.warning).toContain('7 ledger events this console saw, of 1977')
    expect(doc.warning).toContain('no whole-ledger route')
  })

  it('a console that holds every row asks nothing; a local run never asks', async () => {
    const never: FetchLedgerPage = async () => {
      throw new Error('should not be called')
    }
    const whole = { ...base, run: serverRun, phase: 'open' as const, ledgerLen: 5, log: seen(0, 5) }
    expect((await exportRun(whole, new Date(), never)).complete).toBe(true)
    const local = { ...base, run: { ...serverRun, backend: RunBackend.Local, eventId: null }, phase: 'open' as const, ledgerLen: 5, log: seen(0, 5) }
    expect((await exportRun(local, new Date(), never)).log).toHaveLength(5)
  })

  it('a run that ended exports what it kept, and warns when that is short of its ledger', async () => {
    const kept = { run: serverRun, log: seen(10, 12), ledgerLen: 12, messages: [], roster: [], factions: [], locations: [], world: [], choices: {}, endedBy: 'Bo', endedAt: 5 }
    const doc = await exportRun({ ...base, run: null, lastRun: kept })
    expect(doc).toMatchObject({ ledgerLen: 12, complete: false })
    expect(doc.warning).toContain('2 ledger events this console saw, of 12')
  })
})
