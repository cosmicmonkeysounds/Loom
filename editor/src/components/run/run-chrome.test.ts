import { describe, expect, it } from 'vitest'
import runPageSource from './RunPage.tsx?raw'
import { CockpitPhase, RunBackend, RunMode, type RunInfo } from '@/store/cockpit'
import { runAge, runStatusText, runTone } from './run-chrome'

const base: RunInfo = {
  backend: RunBackend.Server,
  mode: RunMode.Rehearsal,
  scratch: false,
  scenario: 'x',
  stale: false,
  codes: { event: 'E', prime: 'P', mod: 'M' },
  joinUrl: 'http://x',
  eventId: 'evt',
  startedAt: 0,
  startedBy: 'Ada',
}
const NOW = 14 * 60_000

describe('run chrome', () => {
  it('tones: idle / local / scratch / rehearsal / live', () => {
    expect(runTone(null)).toBe('idle')
    expect(runTone({ ...base, backend: RunBackend.Local })).toBe('local')
    expect(runTone({ ...base, backend: RunBackend.Local, scratch: true })).toBe('scratch')
    expect(runTone(base)).toBe('rehearsal')
    expect(runTone({ ...base, mode: RunMode.Live })).toBe('live')
  })

  it('status text starts with the stable words the e2e suites match on', () => {
    expect(runStatusText(null, CockpitPhase.Idle, false, 0, NOW)).toBe('no active event')
    expect(runStatusText({ ...base, backend: RunBackend.Local, startedAt: null }, CockpitPhase.Open, true, 0, NOW)).toBe('local · in-browser · ● open')
    expect(runStatusText({ ...base, backend: RunBackend.Local, scratch: true, startedAt: null }, CockpitPhase.Paused, true, 0, NOW)).toBe('scratch · this browser · ⏸ paused')
    expect(runStatusText(base, CockpitPhase.Open, true, 0, NOW)).toBe('shared rehearsal · ● open · 14 min')
    expect(runStatusText({ ...base, mode: RunMode.Live }, CockpitPhase.Open, true, 12, NOW)).toBe('live event · ● open · 12 online · 14 min')
    expect(runStatusText(base, CockpitPhase.Open, false, 0, NOW)).toBe('○ reconnecting…')
  })

  it('formats a run age in minutes then hours', () => {
    expect(runAge(null, NOW)).toBeNull()
    expect(runAge(0, 5 * 60_000)).toBe('5 min')
    expect(runAge(0, 125 * 60_000)).toBe('2 h 05')
  })
})

describe('the Run page is front of house only', () => {
  it('renders none of the lifecycle controls (they live once, in the stage header)', () => {
    const src: string = runPageSource
    for (const id of ['run-pause', 'run-resume', 'run-restart', 'run-push-draft', 'run-end']) {
      expect(src.includes(`'${id}'`) || src.includes(`"${id}"`), id).toBe(false)
    }
    expect(src.includes('LifecycleControls')).toBe(false)
  })
})
