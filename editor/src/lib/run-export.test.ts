import { describe, expect, it } from 'vitest'
import { nullCockpit } from '@/store/cockpit'
import { buildRunExport, runExportFilename } from './run-export'

describe('run export', () => {
  const base = nullCockpit.getState()
  it('projects the cockpit state into a versioned document', () => {
    const s = { ...base, scenario: 'Glass Orchard', phase: 'open', ledgerLen: 2, modsOnline: 2 }
    const doc = buildRunExport(s, new Date('2026-09-09T12:00:00Z'))
    expect(doc).toMatchObject({ format: 'loom-run/1', source: 'live', scenario: 'Glass Orchard', ledgerLen: 2 })
    expect(buildRunExport(base).source).toBe('sim')
  })
  it('names the file after the scenario and the timestamp', () => {
    const s = { ...base, scenario: 'Glass Orchard!' }
    expect(runExportFilename(s, new Date('2026-09-09T12:34:56Z'))).toBe('glass-orchard-run-2026-09-09T12-34-56.json')
    expect(runExportFilename(base, new Date('2026-09-09T12:34:56Z'))).toBe('loom-run-2026-09-09T12-34-56.json')
  })
})
