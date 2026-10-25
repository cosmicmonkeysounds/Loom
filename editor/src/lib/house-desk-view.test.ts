// Run → House: the page's view model over a fixture DeskView (wave 25).

import { describe, expect, it } from 'vitest'
import { beginRun, deskChecks, validateDesk, type DeskCue } from '@loom/core/house-desk'
import {
  checkCursor,
  checkStep,
  cueIssues,
  cueRows,
  cueSummary,
  deskDurationsOf,
  deskKeyAction,
  deskRefsOf,
  deskWideIssues,
  movePlayhead,
  plannedText,
  runOf,
  runningRuns,
  timelineBars,
} from './house-desk-view'
import { fixtureDesk, fixtureHouse, fixtureView } from './test/desk-fixture'

describe('refs and lengths off the house', () => {
  it('checks a draft against the house the server described', () => {
    const refs = deskRefsOf(fixtureHouse())
    expect(validateDesk(fixtureDesk(), refs)).toEqual({ ok: true, problems: [], warnings: [] })
    const bad = fixtureDesk()
    bad.cues[2]!.steps.push({ kind: 'look', look: 'nope' })
    expect(validateDesk(bad, refs).problems).toEqual(['cue blackout step 2: lights.json has no look nope'])
  })

  it('plans a cue: known, a lower bound, or nothing known', () => {
    const d = deskDurationsOf(fixtureHouse())
    const [pre, heart, black] = fixtureDesk().cues as [DeskCue, DeskCue, DeskCue]
    // lobby_loop has no length (missing on the house Mac).
    expect(plannedText(pre, d)).toBe('≥ 1.5 s')
    // The speech step waits on a terminal.
    expect(plannedText(heart, d)).toBe('≥ 4.5 s')
    expect(plannedText(black, d)).toBe('2 s')
    expect(plannedText({ steps: [] }, d)).toBe('0 s')
    expect(plannedText({ steps: [{ kind: 'speech', room: 'x' }] }, d)).toBe('—')
    expect(deskDurationsOf(null)).toEqual({})
  })
})

describe('the cue list', () => {
  it('rows under sections, the playhead, summaries and story events', () => {
    const view = fixtureView()
    const sections = cueRows(view.desk, view, deskDurationsOf(view.house))
    expect(sections.map((s) => s.title)).toEqual(['Doors', 'The Heart'])
    expect(sections[1]!.rows.map((r) => r.cue.id)).toEqual(['heart_reveal', 'blackout'])
    expect(sections[0]!.rows[0]!.standby).toBe(true)
    expect(sections[1]!.rows[0]!.events).toEqual(['heart_speaks', 'heart_reveal_done'])
    expect(sections[1]!.rows[1]!.index).toBe(2)
    expect(sections[1]!.rows[0]!.summary).toBe('💡 look warm · 🔊 server_hum → Server room speaker · ⚡ story: heart_speaks · +1')
    expect(cueSummary({ steps: [] })).toBe('no steps')
  })

  it('shows a running run before an ended one', () => {
    const cue = fixtureDesk().cues[2]!
    const done = { ...beginRun(cue, 1, 'Director', 'desk', 0), state: 'done' as const, endedAt: 2000 }
    const live = beginRun(cue, 2, 'Director', 'desk', 5000)
    expect(runOf([done, live], 'blackout')?.run).toBe(2)
    expect(runOf([done], 'blackout')?.run).toBe(1)
    expect(runOf([done], 'preshow')).toBeNull()
    expect(runningRuns([done, live]).map((r) => r.run)).toEqual([2])
  })
})

describe('the timeline bar', () => {
  it('lays steps out in series and parallel, open-ended ones nominal', () => {
    const heart = fixtureDesk().cues[1]!
    const { bars, span } = timelineBars(heart, deskDurationsOf(fixtureHouse()), 2000)
    // look 0–1.5 s, hum 0.5–4.5 s; event at 4.5 s; speech 4.5–6.5 s (nominal).
    expect(span).toBe(6500)
    expect(bars[1]!.left).toBeCloseTo((500 / 6500) * 100)
    expect(bars[2]!.left).toBeCloseTo((4500 / 6500) * 100)
    expect(bars[3]!.open).toBe(true)
    expect(bars[0]!.open).toBe(false)
  })
})

describe('problems inline', () => {
  it('splits a cue’s messages from its steps’, step 1 never catching step 10', () => {
    const msgs = [
      'cue heart_reveal: name must be text',
      'cue heart_reveal step 1: lights.json has no look x',
      'cue heart_reveal step 10: wait must be whole ms',
      'cue heart_reveal step 2 set: brightness out of range',
      'cue other step 1: no',
      'cues[4]: id must match',
      'version must be 1',
    ]
    const r = cueIssues(msgs, { id: 'heart_reveal' }, 1)
    expect(r.cue).toEqual(['name must be text'])
    expect(r.steps.get(0)).toEqual(['lights.json has no look x'])
    expect(r.steps.get(9)).toEqual(['wait must be whole ms'])
    expect(r.steps.get(1)).toEqual(['set: brightness out of range'])
    expect(cueIssues(msgs, { id: '' }, 4).cue).toEqual(['id must match'])
    expect(deskWideIssues(msgs)).toEqual(['version must be 1'])
  })
})

describe('keys', () => {
  it('Space GOs and the arrows move the playhead in the cue list', () => {
    expect(deskKeyAction({ key: ' ' }, 'cues')).toEqual({ kind: 'go' })
    expect(deskKeyAction({ key: ' ', repeat: true }, 'cues')).toBeNull()
    expect(deskKeyAction({ key: 'ArrowUp' }, 'cues')).toEqual({ kind: 'standby', delta: -1 })
    expect(deskKeyAction({ key: 'ArrowDown' }, 'cues')).toEqual({ kind: 'standby', delta: 1 })
    expect(deskKeyAction({ key: 'Escape' }, 'cues')).toEqual({ kind: 'stop' })
    expect(deskKeyAction({ key: 't' }, 'cues')).toBeNull()
  })

  it('T / Y / N / ↓ walk the checks; Space never GOs there', () => {
    expect(deskKeyAction({ key: 't' }, 'checks')).toEqual({ kind: 'test' })
    expect(deskKeyAction({ key: 'Y' }, 'checks')).toEqual({ kind: 'mark', mark: 'ok' })
    expect(deskKeyAction({ key: 'n' }, 'checks')).toEqual({ kind: 'mark', mark: 'bad' })
    expect(deskKeyAction({ key: 'ArrowDown' }, 'checks')).toEqual({ kind: 'next-open' })
    expect(deskKeyAction({ key: 'ArrowUp' }, 'checks')).toEqual({ kind: 'check', delta: -1 })
    expect(deskKeyAction({ key: ' ' }, 'checks')).toBeNull()
    expect(deskKeyAction({ key: 'Escape' }, 'checks')).toEqual({ kind: 'stop' })
  })

  it('never while typing, with a modifier, or under a dialog', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) expect(deskKeyAction({ key: ' ', tag }, 'cues')).toBeNull()
    expect(deskKeyAction({ key: 't', editable: true }, 'checks')).toBeNull()
    expect(deskKeyAction({ key: ' ', meta: true }, 'cues')).toBeNull()
    expect(deskKeyAction({ key: 'y', ctrl: true }, 'checks')).toBeNull()
    expect(deskKeyAction({ key: 'Escape' }, 'cues', true)).toBeNull()
    expect(deskKeyAction({ key: ' ', tag: 'BUTTON' }, 'cues')).toEqual({ kind: 'go' })
  })

  it('moves the playhead within the list, to the end and back', () => {
    const desk = fixtureDesk()
    expect(movePlayhead(desk, 'preshow', 1)).toBe('heart_reveal')
    expect(movePlayhead(desk, 'preshow', -1)).toBe('preshow')
    expect(movePlayhead(desk, 'blackout', 1)).toBeNull()
    expect(movePlayhead(desk, null, -1)).toBe('blackout')
    expect(movePlayhead(desk, null, 1)).toBeNull()
    expect(movePlayhead(desk, 'gone', 1)).toBe('preshow')
    expect(movePlayhead({ version: 1, cues: [] }, null, 1)).toBeNull()
  })
})

describe('the checks’ cursor', () => {
  it('stays on its row, else the first open one, and steps clamped', () => {
    const view = fixtureView({ marks: { 'speaker:sr': { mark: 'ok', by: 'Director', at: 1 } } })
    const sections = deskChecks(view)
    expect(checkCursor(sections, null)?.key).toBe('speaker:lr')
    expect(checkCursor(sections, 'out:2')?.key).toBe('out:2')
    expect(checkCursor(sections, 'gone')?.key).toBe('speaker:lr')
    expect(checkStep(sections, 'speaker:sr', -1)?.key).toBe('speaker:sr')
    expect(checkStep(sections, 'speaker:sr', 1)?.key).toBe('speaker:lr')
    expect(checkStep(sections, 'look:warm', 1)?.key).toBe('look:warm')
    expect(checkCursor([], null)).toBeNull()
    expect(checkStep([], null, 1)).toBeNull()
  })
})
