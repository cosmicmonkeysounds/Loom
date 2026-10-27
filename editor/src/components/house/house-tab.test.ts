// Run → House (wave 25), rendered to static markup over the real store's
// actions with a fixture state laid on top (server rendering reads a zustand
// store's initial state, so the hook is swapped; nothing is bound: no network).

import { beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('@/store/house-desk', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/store/house-desk')>()
  const base = mod.useHouseDesk.getState()
  const now = () => ({ ...base, ...fake.state }) as ReturnType<typeof mod.useHouseDesk.getState>
  const hook = (sel: (s: ReturnType<typeof now>) => unknown) => sel(now())
  return { ...mod, useHouseDesk: Object.assign(hook, { getState: now }) }
})
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { create } from 'zustand'
import { beginRun, deskChecks } from '@loom/core/house-desk'
import { CockpitContext, RunBackend, RunMode, nullCockpit, type CockpitState } from '@/store/cockpit'
import { setCue } from '@/lib/house-desk-edit'
import { fixtureView } from '@/lib/test/desk-fixture'
import { HouseTab } from './HouseTab'
import { ChecksPanel } from './ChecksPanel'
import { checkCursor } from '@/lib/house-desk-view'

const run = (backend: RunBackend, scratch = false) => ({ backend, mode: RunMode.Rehearsal, scratch, scenario: null, stale: false, codes: null, joinUrl: null, eventId: 'ev1', startedAt: null, startedBy: null })

function render(state: Partial<CockpitState> = { run: run(RunBackend.Server) }): string {
  const store = create<CockpitState>(() => ({ ...nullCockpit.getState(), ...state }))
  return renderToStaticMarkup(createElement(CockpitContext.Provider, { value: store }, createElement(HouseTab)))
}

const setState = (st: Record<string, unknown>) => {
  fake.state = { ...fake.state, ...st }
}
beforeEach(() => {
  fake.state = {}
})

describe('Run → House', () => {
  it('explains itself on a local run', () => {
    const html = render({ run: run(RunBackend.Local, true) })
    expect(html).toContain('data-testid="house-local"')
    expect(html).toContain('a scratch run')
    expect(html).not.toContain('house-go')
  })

  it('says when the server has no desk, or while it reads', () => {
    setState({ gone: 'missing' })
    expect(render()).toContain('no house desk yet')
    setState({ gone: null, view: null })
    expect(render()).toContain('Reading the house desk')
  })

  it('draws the status strip, GO on the playhead, the cue list and the inspector', () => {
    setState({ eventId: 'ev1', view: fixtureView({ source: 'director' }), sel: 1 })
    const html = render()
    expect(html).toContain('■ STOP ALL')
    expect(html).toContain('🔊 router online (house-mac) · MOTU 828x')
    expect(html).toContain('1 sound missing')
    expect(html).toContain('data-testid="house-save-project"')
    // GO names the playhead's cue.
    expect(html).toMatch(/data-testid="house-go"[^]*1 · Pre-show/u)
    // Sections, the playhead row, planned lengths and story events.
    expect(html).toContain('>Doors<')
    expect(html).toContain('>The Heart<')
    expect(html).toMatch(/data-testid="house-cue-preshow" data-standby="true"/u)
    expect(html).toContain('≥ 4.5 s')
    expect(html).toContain('⚡ heart_reveal_done')
    // The inspector on the selected cue: fields, steps, with ↑ / then.
    expect(html).toContain('data-testid="house-inspector"')
    expect(html).toContain('value="The Heart wakes"')
    expect(html).toMatch(/data-testid="house-step-1-start"[^>]*>with ↑</u)
    expect(html).toMatch(/data-testid="house-step-2-start"[^>]*>then</u)
    expect(html).toContain('data-testid="house-timeline"')
    expect(html).not.toContain('LIVE · tests ask first')
  })

  it('shows a running cue’s progress and its Stop', () => {
    const v = fixtureView()
    v.runs = [beginRun(v.desk.cues[2]!, 4, 'Director', 'desk', v.now)]
    setState({ eventId: 'ev1', view: v })
    const html = render()
    expect(html).toContain('data-testid="house-running"')
    expect(html).toContain('data-testid="house-stop-run-4"')
    expect(html).toMatch(/data-testid="house-cue-blackout"[^]*running/u)
  })

  it('a draft shows its edits, unsaved, and its problems inline', () => {
    const v = fixtureView({ live: true })
    const draft = setCue(v.desk, 0, { id: 'room_tone', name: 'Edited' })
    setState({ eventId: 'ev1', view: v, draft, base: 'v1', baseDesk: v.desk, sel: 0 })
    const html = render()
    expect(html).toContain('Unsaved edits')
    expect(html).toContain('GO plays the saved desk')
    expect(html).toContain('value="Edited"')
    expect(html).toContain('are the screens')
    expect(html).toContain('LIVE · tests ask first')
  })
})

describe('the checks panel', () => {
  it('lists every section with tests, colours, marks, hints and progress', () => {
    const view = fixtureView({ marks: { 'speaker:sr': { mark: 'ok', by: 'Director', at: 1 }, 'out:2': { mark: 'bad', by: 'Director', at: 1 } } })
    const sections = deskChecks(view)
    setState({ eventId: 'ev1', view })
    const html = renderToStaticMarkup(createElement(ChecksPanel, { view, sections, cursor: checkCursor(sections, null), now: view.now }))
    expect(html).toMatch(/data-testid="house-checks-progress"[^]*1 ✓[^]*1 ✗[^]*6 open of 8/u)
    for (const t of ['Speakers', 'Outputs', 'Story sounds', 'Lights', 'Looks']) expect(html).toContain(`>${t}<`)
    expect(html).toContain('data-testid="house-check-speaker:sr-test"')
    expect(html).toContain('>Red<')
    expect(html).toContain('no file on the router&#x27;s machine')
    expect(html).toContain('marked by Director')
    expect(html).toContain('🔗 Pair a bulb')
    expect(html).toContain('data-testid="house-reset-marks"')
    // The cursor sits on the first open row.
    expect(html).toMatch(/ring-indigo-700" data-testid="house-check-speaker:lr"/u)
  })
})
