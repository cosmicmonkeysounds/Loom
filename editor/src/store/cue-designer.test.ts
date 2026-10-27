// The Cue designer's store against a fake api (wave 30): the first read and
// the poll that skips while editing, the draft with `base` and a 409
// `stale`, a refused save, Save to project, save-before-test, the live
// confirm on every test and play.

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
vi.mock('@/store/dialog', () => ({ confirmAction: async () => true }))
import { lookFromTemplate, type LightsConfig } from '@loom/house'
import { ApiError } from '@/lib/api'
import type { DesignerLights } from '@/lib/cue-designer'
import { createCueDesignerStore, houseOf, lookDirty, shownLights, type DesignerApiLike } from './cue-designer'

const tick = () => new Promise((r) => setTimeout(r, 0))

const LIGHTS = (): LightsConfig => ({
  version: 1,
  fixtures: [{ id: 'rgb', name: 'RGB', room: 'server', pos: { x: 0, y: 1, z: 0 }, kind: 'zigbee', device: 'rgb', caps: { color: true, ct: true, dim: true } }],
  zones: [],
  looks: { warm: { to: ['rgb'], set: { state: 'ON', brightness: 200 } } },
})

let server: DesignerLights
let api: { [K in keyof DesignerApiLike]: Mock<DesignerApiLike[K]> }
let wake: Array<() => void>
let live: boolean
let answers: boolean[]
let asked: string[]
let saved: number

function store() {
  return createCueDesignerStore({
    api,
    sleep: () => new Promise<void>((r) => wake.push(r)),
    clock: () => 1000,
    live: () => live,
    confirm: async (title) => {
      asked.push(title)
      return answers.shift() ?? true
    },
    saved: () => {
      saved++
    },
  })
}

beforeEach(() => {
  server = { lights: LIGHTS(), version: 'v1', source: 'project', cued: ['warm', 'heart_wake'], problems: [], warnings: [] }
  wake = []
  live = false
  answers = []
  asked = []
  saved = 0
  api = {
    config: vi.fn(async () => structuredClone(server)),
    house: vi.fn(async (): Promise<unknown> => ({ error: 'no house map' })),
    save: vi.fn(async (_id: string, lights: LightsConfig) => {
      server = { ...server, lights: structuredClone(lights), version: 'v2', source: 'director' }
      return { version: 'v2', warnings: [] }
    }),
    project: vi.fn(async () => undefined),
    test: vi.fn(async () => ({ seq: 1 })),
    play: vi.fn(async () => ({ seq: 2 })),
  }
})

describe('reading', () => {
  it('reads the lights and the map on bind, and re-reads only while not editing', async () => {
    api.house.mockResolvedValueOnce({ house: { version: 1, floors: [], rooms: [{ id: 'server', label: 'Server room' }] }, version: 'm1' })
    const s = store()
    s.getState().bind('ev')
    await tick()
    expect(s.getState().read!.version).toBe('v1')
    expect(s.getState().house!.rooms[0]!.id).toBe('server')
    expect(api.config).toHaveBeenCalledTimes(1)
    wake.shift()!()
    await tick()
    expect(api.config).toHaveBeenCalledTimes(2)
    expect(s.getState().house).not.toBe(null) // a failed map read keeps the last map
    s.getState().edit({ ...LIGHTS(), boot: 'warm' })
    wake.shift()!()
    await tick()
    expect(api.config).toHaveBeenCalledTimes(2)
    s.getState().bind(null)
    expect(s.getState().read).toBe(null)
  })

  it('marks an older server (no lights route) and an unreachable one', async () => {
    api.config.mockResolvedValueOnce(null)
    const s = store()
    s.getState().bind('ev')
    await tick()
    expect(s.getState().missing).toBe(true)
    api.config.mockRejectedValueOnce(new Error('down'))
    await s.getState().refresh()
    expect(s.getState().reachable).toBe(false)
  })

  it('takes a map bare or wrapped, and nothing else', () => {
    expect(houseOf({ rooms: [], floors: [] })).not.toBe(null)
    expect(houseOf({ house: { rooms: [], floors: [] } })).not.toBe(null)
    expect(houseOf({ error: 'no house map' })).toBe(null)
  })
})

describe('editing and saving', () => {
  it('a draft carries its base; an edit back to the saved lights clears it', async () => {
    const s = store()
    s.getState().bind('ev')
    await tick()
    const next = { ...LIGHTS(), looks: { ...LIGHTS().looks, pulse: lookFromTemplate('pulse', { to: ['rgb'] }) } }
    s.getState().edit(next, { kind: 'look', name: 'pulse' })
    expect(s.getState()).toMatchObject({ base: 'v1', sel: { kind: 'look', name: 'pulse' } })
    expect(shownLights(s.getState())!.looks['pulse']).toBeDefined()
    expect(lookDirty(s.getState(), 'pulse')).toBe(true)
    expect(lookDirty(s.getState(), 'warm')).toBe(false)
    s.getState().edit(LIGHTS())
    expect(s.getState().draft).toBe(null)
  })

  it('saves with base, re-reads, and tells the desk', async () => {
    const s = store()
    s.getState().bind('ev')
    await tick()
    s.getState().edit({ ...LIGHTS(), boot: 'warm' })
    expect(await s.getState().save()).toBe(true)
    expect(api.save).toHaveBeenCalledWith('ev', expect.objectContaining({ boot: 'warm' }), 'v1')
    expect(s.getState()).toMatchObject({ draft: null, base: null })
    expect(s.getState().read!.version).toBe('v2')
    expect(saved).toBe(1)
    expect(await s.getState().save()).toBe(true)
    expect(api.save).toHaveBeenCalledTimes(1)
  })

  it('refuses an invalid draft before sending it, and shows a server refusal', async () => {
    const s = store()
    s.getState().bind('ev')
    await tick()
    s.getState().edit({ ...LIGHTS(), looks: { bad: { to: ['rgb'], steps: [{ at: 0, set: { brightness: 10 } }, { at: 10, set: { brightness: 200 } }] } } })
    expect(await s.getState().save()).toBe(false)
    expect(s.getState().saveProblems.length).toBeGreaterThan(0)
    expect(api.save).not.toHaveBeenCalled()
    s.getState().edit({ ...LIGHTS(), boot: 'warm' })
    api.save.mockRejectedValueOnce(new ApiError(400, { error: 'invalid lights.json', problems: ['nope'] }))
    expect(await s.getState().save()).toBe(false)
    expect(s.getState().saveProblems).toEqual(['nope'])
  })

  it('on a stale save: load theirs, or keep yours against their version', async () => {
    const s = store()
    s.getState().bind('ev')
    await tick()
    s.getState().edit({ ...LIGHTS(), boot: 'warm' })
    server = { ...server, version: 'v9' }
    api.save.mockRejectedValueOnce(new ApiError(409, { error: 'stale', version: 'v9' }))
    answers = [false]
    expect(await s.getState().save()).toBe(false)
    expect(asked).toEqual(['Someone else saved the lights'])
    expect(s.getState().draft).not.toBe(null)
    await s.getState().refresh()
    // Kept yours: the next save goes over the version that was read.
    api.save.mockRejectedValueOnce(new ApiError(409, { error: 'stale', version: 'v9' }))
    answers = [true]
    expect(await s.getState().save()).toBe(false)
    expect(s.getState().draft).toBe(null)
    expect(s.getState().read!.version).toBe('v9')
  })

  it('Save to project saves the draft first', async () => {
    const s = store()
    s.getState().bind('ev')
    await tick()
    s.getState().edit({ ...LIGHTS(), boot: 'warm' })
    await s.getState().saveToProject()
    expect(api.save).toHaveBeenCalledTimes(1)
    expect(api.project).toHaveBeenCalledWith('ev')
    api.project.mockRejectedValueOnce(new ApiError(409, { error: 'no project' }))
    await s.getState().saveToProject()
    expect(s.getState().note!.text).toBe('This event has no project to save into.')
  })
})

describe('testing on the house', () => {
  it('a look with unsaved edits saves first (asked), then plays', async () => {
    const s = store()
    s.getState().bind('ev')
    await tick()
    s.getState().edit({ ...LIGHTS(), looks: { warm: { to: ['rgb'], set: { state: 'ON', brightness: 100 } } } })
    answers = [false]
    await s.getState().testLook('warm')
    expect(api.test).not.toHaveBeenCalled()
    await s.getState().testLook('warm')
    expect(asked).toEqual(['Save first?', 'Save first?'])
    expect(api.save).toHaveBeenCalledTimes(1)
    expect(api.test).toHaveBeenCalledWith('ev', { look: 'warm' })
  })

  it('once the doors are open, every test and play asks first', async () => {
    const s = store()
    s.getState().bind('ev')
    await tick()
    live = true
    answers = [false, true, true, true]
    await s.getState().testLook('warm')
    expect(api.test).not.toHaveBeenCalled()
    await s.getState().testLook('warm')
    await s.getState().playSound('zip', ['living'], -3)
    await s.getState().say('  Testing  ')
    expect(asked).toEqual(['The show is live', 'The show is live', 'The show is live', 'The show is live'])
    expect(api.test).toHaveBeenCalledTimes(1)
    expect(api.play.mock.calls.map((c) => c[1])).toEqual([{ sound: 'zip', to: ['living'], gain: -3 }, { say: 'Testing' }])
    live = false
    await s.getState().testState('rgb', { state: 'ON', color: '#ff0000' })
    expect(api.test).toHaveBeenLastCalledWith('ev', { fixture: 'rgb', set: { state: 'ON', color: '#ff0000' } })
    expect(asked).toHaveLength(4)
  })

  it('says what went wrong', async () => {
    const s = store()
    s.getState().bind('ev')
    await tick()
    api.play.mockRejectedValueOnce(new Error('router offline'))
    await s.getState().playSound('zip')
    expect(s.getState().note).toMatchObject({ text: 'Couldn’t play zip: router offline', tone: 'bad' })
    expect(s.getState().busy).toBe(null)
  })
})
