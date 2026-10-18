import { describe, expect, it } from 'vitest'
import runPageSource from './RunPage.tsx?raw'
import { CockpitPhase, RunBackend, RunMode, type RunInfo } from '@/store/cockpit'
import { TAB_FADE_PX, overflowEdges, recapPath, revealScrollLeft, runAge, runStatusText, runTone, tabFadeMask } from './run-chrome'

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

describe('the recap link', () => {
  it('points at the event\'s text recap, same-origin, with the id escaped', () => {
    expect(recapPath('evt_1')).toBe('/e/evt_1/api/mod/recap?format=text')
    expect(recapPath('a/b')).toBe('/e/a%2Fb/api/mod/recap?format=text')
    const src: string = runPageSource
    expect(src.includes('recapPath(run.eventId)')).toBe(true)
    expect(src.includes('run-recap')).toBe(true)
  })
})

describe('the header tab strip when it scrolls', () => {
  it('names the edges that hide tabs', () => {
    expect(overflowEdges(0, 500, 500)).toEqual({ left: false, right: false })
    expect(overflowEdges(0, 300, 500)).toEqual({ left: false, right: true })
    expect(overflowEdges(100, 300, 500)).toEqual({ left: true, right: true })
    expect(overflowEdges(200, 300, 500)).toEqual({ left: true, right: false })
  })

  it('fades only an edge that hides tabs', () => {
    expect(tabFadeMask({ left: false, right: false })).toBeUndefined()
    expect(tabFadeMask({ left: false, right: true })).toBe(`linear-gradient(to right, black, black, black calc(100% - ${TAB_FADE_PX}px), transparent)`)
    expect(tabFadeMask({ left: true, right: false })).toBe(`linear-gradient(to right, transparent, black ${TAB_FADE_PX}px, black, black)`)
  })

  it('scrolls just enough to show the open tab clear of the fades', () => {
    // Already in view: stays put.
    expect(revealScrollLeft(0, 300, 100, 60)).toBe(0)
    // Off the right edge (the header narrowed under it): its right end plus the fade.
    expect(revealScrollLeft(0, 300, 400, 60)).toBe(400 + 60 + TAB_FADE_PX - 300)
    // Off the left edge.
    expect(revealScrollLeft(300, 300, 100, 60)).toBe(100 - TAB_FADE_PX)
    expect(revealScrollLeft(300, 300, 10, 60)).toBe(0)
  })
})
