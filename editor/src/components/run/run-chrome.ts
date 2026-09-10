//! Pure chrome helpers for the Run stage: which *world* the cockpit is
//! driving (tone), and the one-line status the header pill shows. Kept out
//! of the component so the strings the e2e suites read are unit-tested.

import { CockpitPhase, RunBackend, RunMode, type RunInfo } from '@/store/cockpit'

/** The world your actions land in — drives every accent colour. */
export type RunTone = 'idle' | 'local' | 'scratch' | 'rehearsal' | 'live'

export function runTone(run: RunInfo | null): RunTone {
  if (run === null) return 'idle'
  if (run.backend === RunBackend.Local) return run.scratch ? 'scratch' : 'local'
  return run.mode === RunMode.Live ? 'live' : 'rehearsal'
}

export const TONE: Record<RunTone, { border: string; tabActive: string; text: string; hint: string }> = {
  idle: {
    border: 'border-zinc-800',
    tabActive: 'border-zinc-400',
    text: 'text-zinc-500',
    hint: 'No run — start a rehearsal on the Run page',
  },
  local: {
    border: 'border-violet-800/60',
    tabActive: 'border-violet-400',
    text: 'text-violet-300/90',
    hint: 'Running in this browser — nothing reaches anyone else',
  },
  scratch: {
    border: 'border-violet-800/60',
    tabActive: 'border-violet-400',
    text: 'text-violet-300/90',
    hint: 'A private scratch run in this browser — the shared run is untouched',
  },
  rehearsal: {
    border: 'border-amber-800/60',
    tabActive: 'border-amber-400',
    text: 'text-amber-300/90',
    hint: 'Shared rehearsal on the server — every co-writer on this project sees + drives the same run',
  },
  live: {
    border: 'border-emerald-800/60',
    tabActive: 'border-emerald-400',
    text: 'text-emerald-300/90',
    hint: 'The live event — guests see what you do here',
  },
}

/** "14 min" / "2 h 05" — how long a run has been going. */
export function runAge(startedAt: number | null, now: number): string | null {
  if (startedAt === null) return null
  const mins = Math.max(0, Math.floor((now - startedAt) / 60_000))
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h} h ${String(m).padStart(2, '0')}`
}

/** The header pill's text. The first words are stable — the e2e suites
 *  match on them: `no active event` · `local · in-browser` · `scratch ·
 *  this browser` · `shared rehearsal` · `live event` · `○ reconnecting…`. */
export function runStatusText(
  run: RunInfo | null,
  phase: CockpitPhase,
  connected: boolean,
  onlineCount: number,
  now: number,
): string {
  if (run === null) return 'no active event'
  if (!connected) return '○ reconnecting…'
  const glyph = phase === CockpitPhase.Paused ? '⏸' : '●'
  const tone = runTone(run)
  const age = runAge(run.startedAt, now)
  switch (tone) {
    case 'local':
      return `local · in-browser · ${glyph} ${phase}`
    case 'scratch':
      return `scratch · this browser · ${glyph} ${phase}`
    case 'rehearsal':
      return `shared rehearsal · ${glyph} ${phase}${age !== null ? ` · ${age}` : ''}`
    case 'live':
      return `live event · ${glyph} ${phase} · ${onlineCount} online${age !== null ? ` · ${age}` : ''}`
    default:
      return 'no active event'
  }
}
