// The House sound card and the header's Stop button (wave 18b, Q7 / Q8),
// rendered off plain fakes of the two stores they read.

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { create } from 'zustand'
import { CockpitContext, RunBackend, RunMode, nullCockpit, type CockpitState } from '@/store/cockpit'

const fake = vi.hoisted(() => ({ audio: {} as Record<string, unknown>, terminals: {} as Record<string, unknown> }))
vi.mock('@/store/house-audio', () => ({
  useHouseAudio: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ eventId: 'ev1', status: null, reachable: true, busy: null, stopNote: null, saveError: null, savedAt: null, stop: async () => {}, setTerminal: async () => {}, saveToProject: async () => {}, ...fake.audio }),
}))
vi.mock('@/store/terminals', () => ({
  useTerminals: (sel: (s: Record<string, unknown>) => unknown) => sel({ map: null, rows: [], ...fake.terminals }),
}))
import { TerminalStatus } from '@/lib/terminals'
import { HouseSoundCard, StopSoundsButton } from './HouseSoundCard'

const status = (over: Record<string, unknown> = {}) => ({
  audio: { version: 1, announce: { to: ['everywhere'], terminals: ['tent', 'old-spot'] } },
  version: 'v2',
  source: 'director',
  router: { online: true, lastSeen: 1, name: 'house-mac' },
  problems: [],
  warnings: [],
  now: 2,
  ...over,
})

const MAP = [
  { id: 'tent', name: 'Tent laptop', room: 'tent', location: 'The Internet' },
  { id: 'desktop-tv', name: 'Desktop TV', room: 'desktop', location: 'The Desktop' },
]

const run = (backend: RunBackend) => ({ backend, mode: RunMode.Rehearsal, scratch: false, scenario: null, stale: false, codes: null, joinUrl: null, eventId: 'ev1', startedAt: null, startedBy: null })

function render(el: () => unknown, state: Partial<CockpitState> = {}): string {
  const store = create<CockpitState>(() => ({ ...nullCockpit.getState(), ...state }))
  return renderToStaticMarkup(createElement(CockpitContext.Provider, { value: store }, createElement(el as never)))
}

describe('the House sound card', () => {
  it('renders nothing before the first read (or on a server with no audio route)', () => {
    fake.audio = { status: null }
    expect(render(HouseSoundCard)).toBe('')
  })

  it('shows the router, the stop with its announcements box, and the house list off the map', () => {
    fake.audio = { status: status() }
    fake.terminals = { map: MAP, rows: [{ name: 'Tent', spot: 'tent', view: 'reinstall', room: '', status: TerminalStatus.Live, silentFor: 0, remembered: false, device: { announce: true } }] }
    const html = render(HouseSoundCard)
    expect(html).toContain('Router online · house-mac')
    expect(html).toContain('data-testid="run-house-sound-stop"')
    expect(html).toContain('Open House →')
    expect(html).toContain('+ announcements')
    expect(html).toMatch(/data-testid="run-house-sound-spot-tent"[^>]*checked=""|checked=""[^>]*data-testid="run-house-sound-spot-tent"/u)
    expect(html).not.toMatch(/checked=""[^>]*data-testid="run-house-sound-spot-desktop-tv"/u)
    expect(html).toContain('📢')
    // A listed spot the map playing now lacks is named, never silently kept.
    expect(html).toContain('not on the map playing now: old-spot')
    // A director save offers Save to project, and says it pins the whole config.
    expect(html).toContain('data-testid="run-house-sound-project"')
    expect(html).toContain('data-testid="run-house-sound-pins"')
    expect(html).toContain('does not play here')
  })

  it('a project config offers no Save to project; no router says so', () => {
    fake.audio = { status: status({ source: 'project', router: { online: false, lastSeen: null, name: null } }) }
    fake.terminals = { map: MAP, rows: [] }
    const html = render(HouseSoundCard)
    expect(html).not.toContain('run-house-sound-project')
    expect(html).not.toContain('run-house-sound-pins')
    expect(html).toContain('No router listening')
  })
})

describe('the header Stop button', () => {
  it('is there on a server run, never on a local one', () => {
    fake.audio = { status: status() }
    expect(render(StopSoundsButton, { run: run(RunBackend.Server) })).toContain('■ Stop house sounds')
    expect(render(StopSoundsButton, { run: run(RunBackend.Local) })).toBe('')
    expect(render(StopSoundsButton, { run: null })).toBe('')
  })

  it('shows the stop’s outcome for a moment: stopped, no router, or failed', () => {
    fake.audio = { stopNote: { text: '■ Stopped the house sounds', outcome: 'stopped', at: 1 } }
    expect(render(StopSoundsButton, { run: run(RunBackend.Server) })).toContain('■ Stopped')
    fake.audio = { stopNote: { text: 'No router is listening…', outcome: 'noRouter', at: 1 } }
    expect(render(StopSoundsButton, { run: run(RunBackend.Server) })).toContain('■ No router: stop it on the Desktop')
    // A failed request is never read as "no router": it is red and says retry.
    fake.audio = { stopNote: { text: 'The stop failed (Unauthorized): nothing was stopped.', outcome: 'failed', at: 1 } }
    const failed = render(StopSoundsButton, { run: run(RunBackend.Server) })
    expect(failed).toContain('■ Stop failed: retry')
    expect(failed).not.toContain('No router')
    expect(failed).toContain('border-red-600')
  })
})
