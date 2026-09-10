//! Export a run — the raw ledger, every room's transcript, the roster and
//! the world state — as one JSON document. The same shape on both backends,
//! so a local rehearsal export and a live-event export diff cleanly (bug
//! reports, post-mortems, "what did guest X actually see"). A run that just
//! ended exports from `lastRun`, so a co-writer ending the show doesn't
//! take the evidence with them.

import type { CockpitState, RunInfo } from '@/store/cockpit'

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
  /** Ledger rows this console holds (a server console only has the feed since it connected). */
  log: CockpitState['log']
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
    return { run: l.run, log: l.log, messages: l.messages, roster: l.roster, factions: l.factions, locations: l.locations, world: l.world, choices: l.choices, endedBy: l.endedBy }
  }
  return { run: s.run, log: s.log, messages: s.messages, roster: s.roster, factions: s.factions, locations: s.locations, world: s.world, choices: s.choices, endedBy: null }
}

/** Pure projection of the cockpit state into the export document. */
export function buildRunExport(s: CockpitState, now: Date = new Date()): RunExport {
  const r = runOf(s)
  return {
    format: 'loom-run/1',
    exportedAt: now.toISOString(),
    source: r.run?.backend ?? 'local',
    mode: r.run?.mode ?? null,
    scenario: r.run?.scenario ?? null,
    phase: s.phase,
    ledgerLen: s.run !== null ? s.ledgerLen : r.log.length,
    log: r.log,
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
