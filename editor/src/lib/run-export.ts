//! Export a run — the raw ledger, every room's transcript, the roster and
//! the world state — as one JSON document. The same shape on both Run
//! sources, so a rehearsal export and a live-event export diff cleanly
//! (bug reports, post-mortems, "what did guest X actually see").

import type { CockpitState } from '@/store/cockpit'

export interface RunExport {
  format: 'loom-run/1'
  exportedAt: string
  source: 'sim' | 'live'
  scenario: string | null
  phase: string
  ledgerLen: number
  /** Ledger rows this console holds (a live console only has the feed since it connected). */
  log: CockpitState['log']
  messages: CockpitState['messages']
  roster: CockpitState['roster']
  factions: CockpitState['factions']
  locations: CockpitState['locations']
  choices: CockpitState['choices']
  world: CockpitState['world']
}

/** Pure projection of the cockpit state into the export document. */
export function buildRunExport(s: CockpitState, now: Date = new Date()): RunExport {
  return {
    format: 'loom-run/1',
    exportedAt: now.toISOString(),
    // The live store tracks named directors; the local sim never does.
    source: s.modsOnline !== null ? 'live' : 'sim',
    scenario: s.scenario,
    phase: s.phase,
    ledgerLen: s.ledgerLen,
    log: s.log,
    messages: s.messages,
    roster: s.roster,
    factions: s.factions,
    locations: s.locations,
    choices: s.choices,
    world: s.world,
  }
}

/** File name for an export: `<scenario>-run-<timestamp>.json`. */
export function runExportFilename(s: CockpitState, now: Date = new Date()): string {
  const stem = (s.scenario ?? 'loom').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'loom'
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${stem}-run-${stamp}.json`
}

/** Trigger a browser download of the export (no-op outside a DOM). */
export function downloadRunExport(s: CockpitState): void {
  if (typeof document === 'undefined') return
  const now = new Date()
  const blob = new Blob([JSON.stringify(buildRunExport(s, now), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = runExportFilename(s, now)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
