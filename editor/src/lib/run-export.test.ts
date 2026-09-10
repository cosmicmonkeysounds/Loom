import { describe, expect, it } from 'vitest'
import { nullCockpit, RunBackend, RunMode, type RunInfo } from '@/store/cockpit'
import { buildRunExport, canExportRun, runExportFilename } from './run-export'

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
