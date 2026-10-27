// Run → House → Cue designer (wave 30), the pure side: the wire, where the
// story uses a name, the library rows, the timeline markers, desk cues
// built from a sound or a look.

import { describe, expect, it } from 'vitest'
import { lookFromTemplate, type LightsConfig } from '@loom/house'
import { validateDesk } from '@loom/core/house-desk'
import { fixtureDesk, fixtureHouse } from '@/lib/test/desk-fixture'
import {
  cueHooks,
  deskCuesWithLook,
  deskCuesWithSound,
  designerLightsOf,
  lookCue,
  lookRows,
  lookSpan,
  nextStepAt,
  soundCue,
  stepMarkers,
  storyUses,
  unwrittenLooks,
  whereOf,
} from './cue-designer'

const LIGHTS: LightsConfig = {
  version: 1,
  fixtures: [
    { id: 'server_room_rgb', name: 'Server room RGB', room: 'server', pos: { x: 0, y: 1, z: 0 }, kind: 'zigbee', device: 'server_room_rgb', caps: { color: true, ct: true, dim: true } },
    { id: 'tube', name: 'Tube strip', room: 'hall', pos: { x: 1, y: 1, z: 0 }, kind: 'wled', device: 'wled/tube', caps: { color: true, ct: false, dim: true } },
  ],
  zones: [{ id: 'heart', name: 'The Heart', fixtures: ['server_room_rgb'] }],
  looks: {
    warm: { to: ['server_room_rgb'], set: { state: 'ON', color_temp: 400, brightness: 200, transition: 1.5 } },
    pulse: lookFromTemplate('pulse', { to: ['heart'] }),
    nowhere: { to: ['attic'], set: { state: 'ON' } },
  },
  boot: 'warm',
}

const DOCS = [
  { uri: 'file:///proj/main.loom', text: '== Boot\ncue warm\n  cue warm_2\n// cue pulse\nsound lobby_loop\nwhen heart_speaks:\n  ok' },
  { uri: 'file:///proj/beats/heart%20room.loom', text: '== Heart\n    cue PULSE\ncue pulse-ish\nsound server_hum' },
]

describe('the wire', () => {
  it('reads a lights view, filling in what is missing', () => {
    const v = designerLightsOf({ lights: { version: 1, looks: { a: { to: ['x'] } } }, version: 'abc', source: 'director', looks: ['a', 'b', 3], problems: ['p'], warnings: [] })
    expect(v).toMatchObject({ version: 'abc', source: 'director', cued: ['a', 'b'], problems: ['p'], warnings: [] })
    expect(v!.lights.fixtures).toEqual([])
    expect(v!.lights.zones).toEqual([])
    expect(designerLightsOf({ version: 'x' })).toBe(null)
    expect(designerLightsOf(null)).toBe(null)
    expect(designerLightsOf({ lights: {}, version: 'v', source: 'weird' })!.source).toBe('default')
  })
})

describe('the story', () => {
  it('finds each statement that uses a name, case-blind, skipping comments and longer names', () => {
    expect(storyUses(DOCS, 'cue', 'warm').map((u) => [whereOf(u), u.line, u.character, u.text])).toEqual([['main.loom:2', 1, 0, 'cue warm']])
    expect(storyUses(DOCS, 'cue', 'pulse').map(whereOf)).toEqual(['heart room.loom:2'])
    expect(storyUses(DOCS, 'sound', 'server_hum').map(whereOf)).toEqual(['heart room.loom:4'])
    expect(storyUses(DOCS, 'when', 'heart_speaks').map(whereOf)).toEqual(['main.loom:6'])
    expect(storyUses(DOCS, 'cue', '')).toEqual([])
  })
})

describe('the library', () => {
  it('lists every look with its mode, length, story uses, desk cues, boot and dirt', () => {
    const saved: LightsConfig = { ...LIGHTS, looks: { ...LIGHTS.looks, pulse: { ...LIGHTS.looks['pulse']!, period: 5000 } } }
    const desk = fixtureDesk()
    const rows = lookRows(LIGHTS, saved, null, desk, DOCS, ['looks["nowhere"].to: x'])
    expect(rows.map((r) => [r.name, r.mode, r.uses, r.inDesk, r.boot, r.dirty, r.reach, r.problems])).toEqual([
      ['nowhere', 'once', 0, [], false, false, 0, 1],
      ['pulse', 'loop', 1, [], false, true, 1, 0],
      ['warm', 'once', 1, ['preshow', 'heart_reveal'], true, false, 1, 0],
    ])
    expect(rows.find((r) => r.name === 'pulse')!.ms).toBe(null)
    expect(rows.find((r) => r.name === 'warm')!.ms).toBe(1500)
    expect(lookRows(LIGHTS, null, null, null, [], [])[0]!.dirty).toBe(true)
  })

  it('names the story cues nothing answers (a desk cue counts as an answer)', () => {
    expect(unwrittenLooks(['warm', 'heart_reveal', 'lights_y2k', 'lights_y2k'], LIGHTS, fixtureDesk())).toEqual(['lights_y2k'])
  })

  it('finds the desk cues that play a look or a sound', () => {
    expect(deskCuesWithLook(fixtureDesk(), 'warm')).toEqual(['preshow', 'heart_reveal'])
    expect(deskCuesWithSound(fixtureDesk(), 'server_hum')).toEqual(['heart_reveal'])
    expect(deskCuesWithSound(null, 'x')).toEqual([])
  })
})

describe('a look on its timeline', () => {
  it('places each step and its fade across one pass and the wrap', () => {
    const look = { to: ['heart'], steps: [{ at: 0, set: { state: 'ON' as const, color: '#ff0000', brightness: 254, transition: 0 } }, { at: 1000, set: { brightness: 127, transition: 1 } }], loop: true, period: 4000 }
    expect(lookSpan(look)).toBe(4000)
    const { markers, span } = stepMarkers(look)
    expect(span).toBe(4000)
    expect(markers).toEqual([
      { index: 0, x: 0, fadeTo: 0, color: '#ff0000', level: 1, off: false },
      { index: 1, x: 0.25, fadeTo: 0.5, color: null, level: 0.5, off: false },
    ])
    expect(lookSpan({ to: [], set: { state: 'OFF' } })).toBe(1000)
    expect(nextStepAt(look)).toBe(1400)
    expect(nextStepAt({ to: [] })).toBe(0)
  })
})

describe('desk cues from the designer', () => {
  it('a sound, with a look alongside and an event at the end, that the desk validates', () => {
    const r = soundCue(fixtureDesk(), 'server_hum', { to: ['sr'], gain: -6, look: 'warm', done: 'hum_done' }, ['warm'])
    expect(r.index).toBe(3)
    expect(r.id).toBe('server_hum')
    expect(r.desk.cues[3]).toEqual({
      id: 'server_hum',
      name: 'server hum',
      done: 'hum_done',
      steps: [
        { kind: 'sound', sound: 'server_hum', to: ['sr'], gain: -6 },
        { kind: 'look', look: 'warm', start: 'with' },
      ],
    })
    const house = fixtureHouse()
    const v = validateDesk(r.desk, { sounds: house.sounds.map((s) => s.name), looks: house.looks.map((l) => l.name), lightTargets: house.lightTargets, audioTargets: house.audioTargets, rooms: house.rooms, events: house.events })
    expect(v.problems).toEqual([])
    expect(soundCue(fixtureDesk(), 'zip').desk.cues[3]!.steps).toEqual([{ kind: 'sound', sound: 'zip' }])
  })

  it('a look never takes the look’s own name as its id', () => {
    const r = lookCue(fixtureDesk(), 'warm', ['warm'])
    expect(r.id).toBe('warm_cue')
    expect(r.desk.cues[r.index]!.steps).toEqual([{ kind: 'look', look: 'warm' }])
  })

  it('says which of a cue’s events the story hears', () => {
    const cue = fixtureDesk().cues[1]!
    expect(cueHooks(cue, { events: ['HEART_SPEAKS'] })).toEqual([
      { event: 'heart_speaks', heard: true },
      { event: 'heart_reveal_done', heard: false },
    ])
  })
})
