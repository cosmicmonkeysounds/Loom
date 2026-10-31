import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { create } from 'zustand'
import { CockpitContext, RunBackend, RunMode, nullCockpit, type CockpitState } from '@/store/cockpit'

// zustand's SSR snapshot is a store's *initial* state, so a render would never
// see `setState`: the card reads a plain fake instead.
const fake = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('@/store/terminals', () => ({
  useTerminals: (sel: (s: Record<string, unknown>) => unknown) => sel({ ack: () => {}, forget: () => {}, setVoiceMuted: async () => {}, setVoiceFx: async () => {}, setCostume: async () => {}, fireVoiceShot: async () => {}, identify: async () => {}, loadMap: async () => {}, ...fake.state }),
}))
import { VOICE_FLAVOURS } from '@loom/core/voice-fx'
import { TerminalStatus, type TerminalRow } from '@/lib/terminals'
import { mapTerminals } from '@/lib/terminal-setup'
import { TerminalsCard } from './TerminalsCard'

const MAP = mapTerminals({
  house: {
    rooms: [
      { id: 'desktop', location: 'The Desktop' },
      { id: 'server-room', location: 'The Server Room' },
    ],
    terminals: [
      { id: 'desktop-tv', name: 'Desktop TV', room: 'desktop' },
      { id: 'server-room', name: 'Server Room', room: 'server-room' },
    ],
  },
})

const row = (name: string, spot: string, status: TerminalStatus = TerminalStatus.Live): TerminalRow => ({
  name,
  spot,
  view: 'auto',
  room: '',
  status,
  silentFor: 0,
  remembered: false,
  device: null,
})

function render(rows: TerminalRow[], map = MAP, extra: Record<string, unknown> = {}): string {
  fake.state = { costume: null, ...extra, rows, map, mapRooms: ['The Desktop', 'The Server Room'], reachable: true, voiceMuted: false, acked: new Set(), muteError: null, identifyError: null }
  const store = create<CockpitState>(() => ({
    ...nullCockpit.getState(),
    run: {
      backend: RunBackend.Server,
      mode: RunMode.Rehearsal,
      scratch: false,
      scenario: null,
      stale: false,
      codes: { event: 'EVT', prime: 'PRM', mod: 'MODC' },
      joinUrl: 'https://loom.test/?code=EVT',
      eventId: 'e1',
      startedAt: null,
      startedBy: null,
    },
    cast: [
      { id: 'Clippy', faction: null },
      { id: 'Trabolta', faction: null, agent: true },
    ],
    locations: [{ id: 'The Cloud', label: null, prison: false, occupants: [] }],
  }))
  return renderToStaticMarkup(createElement(CockpitContext.Provider, { value: store }, createElement(TerminalsCard)))
}

afterEach(() => {
  fake.state = {}
})

describe('TerminalsCard (wave 14 spot claims + set up)', () => {
  it('names each row’s map spot, flags one off the map, lists the unclaimed spots', () => {
    const html = render([row('TV', 'desktop-tv'), row('Kitchen', 'kitchen'), row('Spare', '')])
    expect(html).toContain('📍 Desktop TV')
    expect(html).toContain('⚠ kitchen not on map')
    expect(html).toContain('no spot')
    const unclaimed = /data-testid="run-terminals-unclaimed">(.*?)<\/p>/.exec(html)?.[1] ?? ''
    expect(unclaimed).toContain('Server Room')
    expect(unclaimed).not.toContain('Desktop TV')
  })

  it('flags a spot two live terminals claim', () => {
    const html = render([row('A', 'server-room'), row('B', 'server-room')])
    expect(html.match(/data-doubled="true"/g)).toHaveLength(2)
  })

  it('the builder offers every view, the map spots, the rooms and the cast — agent first — and a link with the mod code', () => {
    const html = render([])
    for (const v of ['auto', 'world', 'face', 'mirror', 'tv', 'chess', 'shadow', 'casino', 'reinstall']) expect(html).toContain(`value="${v}"`)
    expect(html).toContain('value="desktop-tv"')
    expect(html).toContain('value="The Cloud"')
    expect(html.indexOf('value="Trabolta"')).toBeLessThan(html.indexOf('value="Clippy"'))
    // No announce: the tablet follows the house setting (wave 18b, Q8).
    expect(html).toContain('https://loom.test/terminal/?code=MODC&amp;character=Trabolta&amp;view=auto</p>')
    expect(html).toContain('Always (ignore the house setting)')
    // Wave 20: a keyboard by default (no keys key), the door sensor offered unticked.
    expect(html).toMatch(/data-testid="run-terminal-setup-keys"/)
    expect(html).toMatch(/<input type="checkbox"[^>]*data-testid="run-terminal-setup-door"/)
    expect(html).not.toMatch(/checked=""[^>]*data-testid="run-terminal-setup-door"/)
  })

  it('no map: rows carry no off-map flag and the builder says the spot list is empty', () => {
    const html = render([row('Kitchen', 'kitchen')], null as never)
    expect(html).not.toContain('not on map')
    expect(html).toContain('No house map read yet')
  })
})

describe('TerminalsCard (wave 59 costume)', () => {
  it('shows the switch and the copy button, and never prints the link', () => {
    const url = 'https://loom.test/costume?e=e1&k=secrettoken'
    const on = render([], MAP, { costume: { on: true, url } })
    expect(on).toContain('run-terminals-costume-switch')
    expect(on).toContain('aria-pressed="true"')
    expect(on).not.toContain('secrettoken')
    expect(render([], MAP, { costume: { on: false, url } })).toContain('>Off<')
  })

  it('has no row on an older server', () => {
    expect(render([], MAP, { costume: null })).not.toContain('run-terminals-costume')
  })
})

describe('TerminalsCard (wave 20 door sensor)', () => {
  const doorRow = (device: TerminalRow['device']): TerminalRow => ({ ...row('Server Room', 'server-room'), view: 'face', device })

  it('shows the 🚪 badge green when shut, with the level, and no override by default', () => {
    const html = render([doorRow({ door: 'closed', doorLevel: 3900 })])
    expect(html).toMatch(/data-testid="run-terminal-badge-door"[^>]*>🚪 shut 3900</)
    expect(html).toContain('data-tone="ok"')
    expect(html).not.toContain('run-terminal-badge-door-override')
  })

  it('a fault reads red; the override and a warning read amber', () => {
    const html = render([doorRow({ door: 'fault', doorFault: 'stale', doorWarn: 'ldr_open' })], MAP, { doorOverride: true })
    expect(html).toMatch(/data-tone="red"[^>]*>🚪 fault: stale</)
    expect(html).toMatch(/data-tone="amber"[^>]*>⚠ ldr_open</)
    expect(html).toMatch(/data-testid="run-terminal-badge-door-override"[^>]*>override</)
  })

  it('a terminal with no sensor shows no door badge, even under an override', () => {
    const html = render([doorRow({ door: 'none' }), { ...row('TV', 'desktop-tv'), device: {} }], MAP, { doorOverride: true })
    expect(html).not.toContain('run-terminal-badge-door')
  })
})

describe('TerminalsCard (wave 56 his voice)', () => {
  const tv = (): TerminalRow => ({ ...row('TV', 'desktop-tv'), view: 'tv' })

  it('offers Auto, Clean and Broken with a TV up, the mode marked, and every flavour to fire', () => {
    const html = render([tv()], MAP, { voiceFx: 'clean' })
    for (const m of ['auto', 'clean', 'broken']) expect(html).toContain(`run-terminals-voicefx-${m}`)
    expect(html).toMatch(/aria-pressed="true"[^>]*>Clean/)
    expect(html).toMatch(/aria-pressed="false"[^>]*>Auto/)
    for (const f of VOICE_FLAVOURS) expect(html).toContain(`run-terminals-voicefx-shot-${f}`)
  })
  it('stays out of the way with no TV, unless it is left off Auto', () => {
    expect(render([row('Kitchen', 'server-room')], MAP, { voiceFx: 'auto' })).not.toContain('run-terminals-voicefx')
    expect(render([row('Kitchen', 'server-room')], MAP, { voiceFx: 'broken' })).toContain('run-terminals-voicefx')
  })
  it('shows nothing from an older server, which names no mode', () => {
    expect(render([tv()], MAP, { voiceFx: null })).not.toContain('run-terminals-voicefx')
  })
})
