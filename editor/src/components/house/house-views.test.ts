// Run → House's wave 30 views — Setup and the Cue designer — rendered to
// static markup over fixture states (server rendering reads a zustand
// store's initial state, so each hook is swapped; nothing is bound).

import { beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ desk: {} as Record<string, unknown>, designer: {} as Record<string, unknown>, view: {} as Record<string, unknown> }))
function swap<S extends object>(store: { getState: () => S }, over: () => Record<string, unknown>) {
  const now = () => ({ ...store.getState(), ...over() }) as S
  const hook = (sel: (s: S) => unknown) => sel(now())
  return Object.assign(hook, { getState: now, setState: () => undefined })
}
vi.mock('@/store/house-desk', async (orig) => {
  const mod = await orig<typeof import('@/store/house-desk')>()
  return { ...mod, useHouseDesk: swap(mod.useHouseDesk, () => fake.desk) }
})
vi.mock('@/store/cue-designer', async (orig) => {
  const mod = await orig<typeof import('@/store/cue-designer')>()
  return { ...mod, useCueDesigner: swap(mod.useCueDesigner, () => fake.designer) }
})
vi.mock('@/store/house-view', async (orig) => {
  const mod = await orig<typeof import('@/store/house-view')>()
  return { ...mod, useHouseView: swap(mod.useHouseView, () => fake.view) }
})
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { create } from 'zustand'
import { lookFromTemplate, type LightsConfig } from '@loom/house'
import { CockpitContext, RunBackend, RunMode, nullCockpit, type CockpitState } from '@/store/cockpit'
import { fixtureHouse, fixtureView } from '@/lib/test/desk-fixture'
import { HouseTab } from './HouseTab'

const run = { backend: RunBackend.Server, mode: RunMode.Rehearsal, scratch: false, scenario: null, stale: false, codes: null, joinUrl: null, eventId: 'ev1', startedAt: null, startedBy: null }
function render(): string {
  const store = create<CockpitState>(() => ({ ...nullCockpit.getState(), run }))
  return renderToStaticMarkup(createElement(CockpitContext.Provider, { value: store }, createElement(HouseTab)))
}

const LIGHTS: LightsConfig = {
  version: 1,
  fixtures: [{ id: 'server_room_rgb', name: 'Server room RGB', room: 'server', pos: { x: 0, y: 1, z: 0 }, kind: 'zigbee', device: 'server_room_rgb', caps: { color: true, ct: true, dim: true }, safety: true, min: 60 }],
  zones: [],
  looks: { warm: { to: ['server_room_rgb'], set: { state: 'ON', color_temp: 400, brightness: 200, transition: 1.5 } }, heart_beat: lookFromTemplate('heartbeat', { to: ['server_room_rgb'], color: '#ff2a00', floor: 60 }) },
  boot: 'warm',
}
const read = { lights: LIGHTS, version: 'v1', source: 'project' as const, cued: ['warm', 'lights_y2k'], problems: [], warnings: [] }

beforeEach(() => {
  fake.desk = { view: fixtureView(), gone: null }
  fake.designer = { read, house: null, missing: false, reachable: true, draft: null, sel: null }
  fake.view = { view: 'desk' }
})

describe('the House views', () => {
  it('switches between Desk, Cue designer and Setup, flagging a setup problem', () => {
    const html = render()
    expect(html).toContain('data-testid="house-view-desk"')
    expect(html).toContain('🎨 Cue designer')
    expect(html).toContain('data-testid="house-cues"')
    // The fixture's story sound has no file: Setup carries a ✗.
    expect(html).toMatch(/house-view-setup"[^>]*>🔌 Setup<span class="[^"]*text-red-400">✗/u)
  })
})

describe('Setup', () => {
  it('one card per system with what to do, the bring-up order and the runbooks', () => {
    fake.view = { view: 'setup' }
    fake.desk = { view: fixtureView({ house: fixtureHouse({ minds: [{ character: 'Trabolta', name: 'Trabolta', online: false, workers: [] }] }) }), gone: null }
    const html = render()
    expect(html).toContain('data-testid="house-setup"')
    expect(html).toContain('data-testid="house-setup-sound"')
    expect(html).toContain('1 story sound with no file: lobby_loop.')
    expect(html).toContain('data-testid="house-setup-lights"')
    expect(html).toContain('data-testid="house-setup-mind:Trabolta"')
    expect(html).toContain('No mind connected')
    expect(html).toContain('Bring the house up, in this order')
    expect(html).toContain('🔗 Pair a bulb')
    expect(html).toContain('Help → Setting up the house')
    expect(html).not.toContain('house-cues')
  })

  it('reads green when everything is up', () => {
    fake.view = { view: 'setup' }
    const house = fixtureHouse({ sounds: [{ name: 'server_hum', to: null, file: 'ok', ms: 4000 }], minds: [{ character: 'Trabolta', name: 'Trabolta', online: true, workers: ['macbook'] }] })
    fake.desk = { view: fixtureView({ house }), gone: null }
    const html = render()
    expect(html).toContain('The house is connected ✓')
    expect(html).toContain('Online on macbook')
  })
})

describe('the Cue designer', () => {
  it('lists looks, story sounds and desk cues, the unanswered story cues, and welcomes', () => {
    fake.view = { view: 'designer' }
    const html = render()
    expect(html).toContain('data-testid="cue-designer"')
    expect(html).toContain('data-testid="designer-look-warm"')
    expect(html).toContain('data-testid="designer-look-heart_beat"')
    expect(html).toContain('+ lights_y2k')
    expect(html).toContain('server_hum')
    expect(html).toContain('The Heart wakes')
    expect(html).toContain('data-testid="designer-welcome"')
    expect(html).toContain('the project’s lights.json')
  })

  it('edits a look: preview lamps (at the safety floor), mode, steps, and the story line', () => {
    fake.view = { view: 'designer' }
    fake.designer = { ...fake.designer, sel: { kind: 'look', name: 'heart_beat' } }
    const html = render()
    expect(html).toContain('data-testid="designer-look"')
    expect(html).toContain('data-testid="designer-lamp-server_room_rgb"')
    expect(html).toContain('Server room RGB')
    expect(html).toContain('· safety')
    expect(html).toContain('until the next look')
    expect(html).toContain('data-testid="designer-step-3"')
    expect(html).toContain('data-testid="designer-hookup-line">cue heart_beat<')
    expect(html).toContain('Not in the story yet')
    expect(html).toContain('+ Desk cue with this look')
  })

  it('a sound: its file, audition and a desk cue from it; a desk cue: its steps and events', () => {
    fake.view = { view: 'designer' }
    fake.designer = { ...fake.designer, sel: { kind: 'sound', name: 'lobby_loop' } }
    let html = render()
    expect(html).toContain('data-testid="designer-sound"')
    expect(html).toContain('No file on the router’s machine')
    expect(html).toContain('▶ Play on the house')
    expect(html).toContain('data-testid="designer-hookup-line">sound lobby_loop<')
    fake.designer = { ...fake.designer, sel: { kind: 'cue', id: 'heart_reveal' } }
    html = render()
    expect(html).toContain('data-testid="designer-cue"')
    expect(html).toContain('⚡ heart_speaks')
    expect(html).toContain('Edit in Desk →')
  })

  it('explains an older server, and an unsaved draft', () => {
    fake.view = { view: 'designer' }
    fake.designer = { ...fake.designer, missing: true }
    expect(render()).toContain('no lights route')
    fake.designer = { ...fake.designer, missing: false, draft: { ...LIGHTS, boot: 'heart_beat' }, stale: true }
    expect(render()).toContain('● unsaved · someone else saved since')
  })
})
