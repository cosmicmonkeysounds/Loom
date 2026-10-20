import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { create } from 'zustand'
import { CockpitContext, RunBackend, RunMode, nullCockpit, type CockpitState } from '@/store/cockpit'

// zustand's SSR snapshot is a store's *initial* state, so a render would never
// see `setState`: the card reads a plain fake instead.
const fake = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('@/store/terminals', () => ({
  useTerminals: (sel: (s: Record<string, unknown>) => unknown) => sel({ ack: () => {}, forget: () => {}, setVoiceMuted: async () => {}, identify: async () => {}, loadMap: async () => {}, ...fake.state }),
}))
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

function render(rows: TerminalRow[], map = MAP): string {
  fake.state = { rows, map, mapRooms: ['The Desktop', 'The Server Room'], reachable: true, voiceMuted: false, acked: new Set(), muteError: null, identifyError: null }
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
    for (const v of ['auto', 'world', 'face', 'mirror', 'tv', 'chess', 'shadow']) expect(html).toContain(`value="${v}"`)
    expect(html).toContain('value="desktop-tv"')
    expect(html).toContain('value="The Cloud"')
    expect(html.indexOf('value="Trabolta"')).toBeLessThan(html.indexOf('value="Clippy"'))
    expect(html).toContain('https://loom.test/terminal/?code=MODC&amp;character=Trabolta&amp;view=auto&amp;announce=0')
  })

  it('no map: rows carry no off-map flag and the builder says the spot list is empty', () => {
    const html = render([row('Kitchen', 'kitchen')], null as never)
    expect(html).not.toContain('not on map')
    expect(html).toContain('No house map read yet')
  })
})
