// Run → House's views — Setup and the Cue designer (wave 30), the Mixer
// (wave 40) — rendered to
// static markup over fixture states (server rendering reads a zustand
// store's initial state, so each hook is swapped; nothing is bound).

import { beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ desk: {} as Record<string, unknown>, designer: {} as Record<string, unknown>, view: {} as Record<string, unknown>, mixer: {} as Record<string, unknown> }))
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
vi.mock('@/store/house-mixer', async (orig) => {
  const mod = await orig<typeof import('@/store/house-mixer')>()
  return { ...mod, useHouseMixer: swap(mod.useHouseMixer, () => fake.mixer) }
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
import { fixtureMixer } from '@/lib/test/mixer-fixture'
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
  fake.mixer = { view: fixtureMixer(), gone: null, reachable: true, pending: {}, note: null, busy: null }
})

describe('the House views', () => {
  it('switches between Desk, Cue designer, Setup, Mixer and Map, flagging a setup problem', () => {
    const html = render()
    expect(html).toContain('data-testid="house-view-desk"')
    expect(html).toContain('🎨 Cue designer')
    expect([...html.matchAll(/data-testid="house-view-([a-z]+)"/gu)].map((m) => m[1])).toEqual(['desk', 'designer', 'setup', 'mixer', 'map'])
    expect(html).toContain('🎚 Mixer')
    expect(html).toContain('🗺 Map')
    expect(html).not.toContain('house-mixer')
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
    expect(html).toContain('1 more story cue with no look here')
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

describe('the Mixer', () => {
  beforeEach(() => {
    fake.view = { view: 'mixer' }
  })

  it('the strip, Now playing and one column per scope', () => {
    const html = render()
    expect(html).toContain('data-testid="house-mixer"')
    expect(html).not.toContain('house-cues')
    expect(html).toContain('🔊 router online (house-desktop)')
    expect(html).toContain('every level at 0 dB')
    // Now playing: the scene picker, each bed with its rooms, track, progress and Skip.
    expect(html).toMatch(/data-testid="mixer-scene"[^]*<option value="act_1" selected="">act_1/u)
    expect(html).toMatch(/data-testid="mixer-bed-lounge"[^]*lounge[^]*Living room[^]*Dial-up Dreams[^]*width:25.0%[^]*0:30 \/ 2:00/u)
    expect(html).toContain('data-testid="mixer-skip-lounge"')
    expect(html).toContain('(between tracks)')
    expect(html).toContain('⏭ Skip all')
    expect(html).toContain('■ Stop music')
    expect(html).toMatch(/data-testid="mixer-missing"[^]*heart/u)
    expect(html).not.toContain('mixer-hand')
    // The console: Everywhere, then each room, scrolling across.
    expect([...html.matchAll(/data-testid="mixer-scope-([^"]+)"/gu)].map((m) => m[1])).toEqual(['all', 'room:living', 'room:kitchen'])
    expect(html).toContain('data-testid="mixer-strip-master"')
    expect(html).toContain('data-testid="mixer-strip-src:in:trabolta"')
    expect(html).toContain('data-testid="mixer-strip-room:living/src:music"')
    expect(html).toContain('data-testid="mixer-strip-spk:living_sub"')
    expect(html.match(/data-testid="mixer-strip-spk:kitchen"/gu)?.length).toBe(1) // a speaker only in its own room
    // Clippy's mic is a meter only, with its note, in every column.
    expect(html.match(/data-testid="mixer-strip-meter-in:clippy"/gu)?.length).toBe(3)
    expect(html).toContain('Mixed outside the router (CueMix): meter only')
    // A fader: −60 … +10 on a 0.5 grid, labelled for a screen reader.
    expect(html).toMatch(/type="range" min="-60" max="10" step="0.5" aria-label="Master \(Everywhere\) level"[^>]*value="0"/u)
    // Nothing moved: every Reset is off.
    expect(html).toMatch(/disabled=""[^>]*data-testid="mixer-reset-all"/u)
    expect(html).toMatch(/disabled=""[^>]*data-testid="mixer-reset-room:living"/u)
  })

  it('moved levels: dB labels, mutes, “plays at”, “silent”, and the Resets', () => {
    fake.mixer = {
      ...fake.mixer,
      view: fixtureMixer({ levels: { 'src:music': { db: -6, mute: false }, 'room:kitchen': { db: 0, mute: true } } }),
      pending: { 'spk:living_sub': { change: { key: 'spk:living_sub', db: 3, mute: false }, version: 1, until: null } },
    }
    const html = render()
    expect(html).toContain('2 levels moved')
    expect(html).toMatch(/data-testid="mixer-strip-src:music"[^]*?−6.0/u)
    // The panel's own value shows while the post is pending.
    expect(html).toMatch(/data-testid="mixer-strip-spk:living_sub"[^]*?\+3.0/u)
    expect(html).toMatch(/data-testid="mixer-strip-room:living\/src:music"[^]*?plays at −6.0 dB/u)
    expect(html).toMatch(/data-testid="mixer-strip-room:kitchen"[^]*?aria-pressed="true"/u)
    expect(html).toMatch(/data-testid="mixer-strip-room:kitchen\/src:sfx"[^]*?silent: a level above is muted or down/u)
    expect(html).not.toMatch(/disabled=""[^>]*data-testid="mixer-reset-room:kitchen"/u)
    expect(html).toMatch(/disabled=""[^>]*data-testid="mixer-reset-room:living"/u)
    expect(html).not.toMatch(/disabled=""[^>]*data-testid="mixer-reset-all"/u)
  })

  it('a hand scene, no soundtrack, no router, an older server, a refusal', () => {
    const v = fixtureMixer()
    fake.mixer = { ...fake.mixer, view: { ...v, music: { ...v.music!, hand: true } } }
    let html = render()
    expect(html).toContain('by hand: the story’s music cues are held')
    expect(html).toContain('data-testid="mixer-follow"')
    fake.mixer = { ...fake.mixer, view: fixtureMixer({ music: null, router: { online: false, lastSeen: null, name: null }, meters: null }) }
    html = render()
    expect(html).toContain('No soundtrack reported yet')
    expect(html).toContain('no router listening: the mix is kept and applies when it connects')
    fake.mixer = { ...fake.mixer, gone: 'missing' }
    expect(render()).toContain('This event server has no mixer yet: update and restart it.')
    fake.mixer = { ...fake.mixer, gone: 'denied' }
    expect(render()).toContain('The server refused the mixer.')
    fake.mixer = { ...fake.mixer, gone: null, view: null }
    expect(render()).toContain('Reading the mixer…')
  })
})
