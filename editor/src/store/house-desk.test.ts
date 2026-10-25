// The house desk store against a fake api (wave 25): the long poll on `rev`
// and its backoff, the draft with `base` and a 409 `stale`, GO with the
// playhead shown and a 409 `moved`, the panic, tests with a live confirm,
// marks, pairing.

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
const dialog = vi.hoisted(() => ({ answer: true, asked: [] as { title: string }[] }))
vi.mock('@/store/dialog', () => ({
  confirmAction: async (o: { title: string }) => {
    dialog.asked.push(o)
    return dialog.answer
  },
}))
import { ApiError } from '@/lib/api'
import { addCue, newCue, setCue } from '@/lib/house-desk-edit'
import { beginRun, type DeskView } from '@loom/core/house-desk'
import { fixtureView } from '@/lib/test/desk-fixture'
import { createHouseDeskStore, isDirty, shownDesk, type DeskApiLike } from './house-desk'

/** A promise and its resolvers. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

let server: DeskView
let gets: Array<{ after?: number; wait?: number }>
let parked: Array<ReturnType<typeof deferred<DeskView>>>
let failNext: unknown[]
let api: { [K in keyof DeskApiLike]: Mock<DeskApiLike[K]> }
let slept: number[]
let now: number

function make() {
  return createHouseDeskStore({ api, sleep: async (ms) => void slept.push(ms), clock: () => now })
}

beforeEach(() => {
  server = fixtureView()
  gets = []
  parked = []
  failNext = []
  slept = []
  now = 5_000
  dialog.answer = true
  dialog.asked = []
  api = {
    get: vi.fn(async (_ev: string, after?: number, wait?: number) => {
      gets.push({ after, wait })
      const fail = failNext.shift()
      if (fail !== undefined) throw fail
      if (after !== undefined && after >= server.rev) {
        const d = deferred<DeskView>()
        parked.push(d)
        return d.promise
      }
      return structuredClone(server)
    }),
    save: vi.fn(async () => ({ version: 'v2', source: 'director' as const, warnings: [] })),
    project: vi.fn(async () => {}),
    go: vi.fn(async () => ({ run: 1, standby: 'heart_reveal' })),
    standby: vi.fn(async (_ev: string, cue: string | null) => ({ standby: cue })),
    stop: vi.fn(async () => ({ stopped: 1 })),
    check: vi.fn(async () => {}),
    checkReset: vi.fn(async () => {}),
    test: vi.fn(async () => {}),
    pair: vi.fn(async () => ({ until: 99_000 })),
  } as unknown as typeof api
})

/** Answer the parked long poll with the server's view, rev bumped. */
async function push(change: (v: DeskView) => void = () => {}) {
  change(server)
  server.rev += 1
  parked.shift()?.resolve(structuredClone(server))
  await tick()
}

describe('the long poll', () => {
  it('reads at once, then parks on rev and applies each change', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    expect(s.getState().view?.rev).toBe(1)
    expect(gets).toEqual([{ after: undefined, wait: undefined }, { after: 1, wait: 25 }])
    expect(s.getState().skew).toBe(10_000 - 5_000)
    await push((v) => (v.standby = 'blackout'))
    expect(s.getState().view?.standby).toBe('blackout')
    expect(gets.at(-1)).toEqual({ after: 2, wait: 25 })
  })

  it('backs off on a dead server and stops on a missing route', async () => {
    const s = make()
    failNext = [new TypeError('network'), new ApiError(502, {}), new ApiError(404, { error: 'unknown mod action' })]
    s.getState().bind('ev1')
    for (let i = 0; i < 5; i++) await tick()
    expect(slept).toEqual([1000, 2000])
    expect(s.getState().gone).toBe('missing')
    expect(gets).toHaveLength(3)
  })

  it('waits a floor when a server answers at once with no new rev', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    // An old server: ignores `after`, answers the same rev immediately.
    parked.shift()?.resolve(structuredClone(server))
    await tick()
    expect(slept).toContain(1000)
  })

  it('a rebind drops the old loop', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    s.getState().bind(null)
    await push((v) => (v.standby = 'blackout'))
    expect(s.getState().view).toBeNull()
  })
})

describe('the draft', () => {
  it('tracks dirty against the desk it was taken from, and comes clean again', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    const desk = shownDesk(s.getState())!
    const edited = setCue(desk, 0, { name: 'Doors open' })
    s.getState().edit(edited, 0)
    expect(isDirty(s.getState())).toBe(true)
    expect(s.getState().base).toBe('v1')
    expect(shownDesk(s.getState())?.cues[0]?.name).toBe('Doors open')
    s.getState().edit(setCue(edited, 0, { name: 'Pre-show' }))
    expect(isDirty(s.getState())).toBe(false)
  })

  it('saves with base and shows the saved desk', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    const { desk } = addCue(shownDesk(s.getState())!, newCue(shownDesk(s.getState())!, 'Bows'))
    s.getState().edit(desk)
    await s.getState().save()
    expect(api.save).toHaveBeenCalledWith('ev1', desk, 'v1')
    expect(isDirty(s.getState())).toBe(false)
    expect(s.getState().view?.desk.cues.map((c) => c.id)).toContain('bows')
    expect(s.getState().view?.source).toBe('director')
  })

  it('shows a 400’s problems and keeps the draft', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    s.getState().edit(setCue(shownDesk(s.getState())!, 0, { id: 'room_x' }))
    api.save.mockRejectedValueOnce(new ApiError(400, { error: 'bad desk', problems: ['cue room_x: ids starting … are the screens’ cues'] }))
    await s.getState().save()
    expect(s.getState().saveProblems).toHaveLength(1)
    expect(isDirty(s.getState())).toBe(true)
  })

  it('marks the draft stale when the server’s version moves on', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    s.getState().edit(setCue(shownDesk(s.getState())!, 0, { name: 'Mine' }))
    await push((v) => (v.version = 'v9'))
    expect(s.getState().stale).toBe(true)
    expect(shownDesk(s.getState())?.cues[0]?.name).toBe('Mine')
  })

  it('a 409 stale asks: Load theirs drops the edits', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    s.getState().edit(setCue(shownDesk(s.getState())!, 0, { name: 'Mine' }))
    api.save.mockRejectedValueOnce(new ApiError(409, { error: 'stale', version: 'v9' }))
    server.version = 'v9'
    await s.getState().save()
    expect(dialog.asked.map((d) => d.title)).toEqual(['The desk changed on the server'])
    expect(isDirty(s.getState())).toBe(false)
    expect(s.getState().busy).toBeNull()
  })

  it('a 409 stale, kept: the next save is based on theirs', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    s.getState().edit(setCue(shownDesk(s.getState())!, 0, { name: 'Mine' }))
    api.save.mockRejectedValueOnce(new ApiError(409, { error: 'stale', version: 'v9' }))
    server.version = 'v9'
    dialog.answer = false
    await s.getState().save()
    expect(isDirty(s.getState())).toBe(true)
    expect(s.getState().base).toBe('v9')
    await s.getState().save()
    expect(api.save).toHaveBeenLastCalledWith('ev1', expect.anything(), 'v9')
  })

  it('Save to project refuses while there are unsaved edits', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    s.getState().edit(setCue(shownDesk(s.getState())!, 0, { name: 'Mine' }))
    await s.getState().saveToProject()
    expect(api.project).not.toHaveBeenCalled()
    s.getState().discard()
    await s.getState().saveToProject()
    expect(api.project).toHaveBeenCalledWith('ev1')
  })
})

describe('GO and the playhead', () => {
  it('GO sends the playhead it showed and takes the new one', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    await s.getState().go()
    expect(api.go).toHaveBeenCalledWith('ev1', { standby: 'preshow' })
    expect(s.getState().view?.standby).toBe('heart_reveal')
    await s.getState().go('blackout')
    expect(api.go).toHaveBeenLastCalledWith('ev1', { cue: 'blackout' })
  })

  it('a 409 moved fires nothing, takes the server’s playhead and says press again', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    api.go.mockRejectedValueOnce(new ApiError(409, { error: 'moved', standby: 'blackout' }))
    await s.getState().go()
    expect(s.getState().view?.standby).toBe('blackout')
    expect(s.getState().note?.text).toBe('Standby moved — press GO again')
  })

  it('at the end of the list GO says so without asking the server', async () => {
    server.standby = null
    const s = make()
    s.getState().bind('ev1')
    await tick()
    await s.getState().go()
    expect(api.go).not.toHaveBeenCalled()
    expect(s.getState().note?.tone).toBe('warn')
  })

  it('↑ / ↓ move the playhead over the saved desk', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    await s.getState().moveStandby(1)
    expect(api.standby).toHaveBeenCalledWith('ev1', 'heart_reveal')
    expect(s.getState().view?.standby).toBe('heart_reveal')
  })
})

describe('stopping', () => {
  it('Esc stops each running run; STOP ALL is the panic', async () => {
    const cue = server.desk.cues[2]!
    server.runs = [beginRun(cue, 7, 'Director', 'desk', 1), { ...beginRun(cue, 6, 'Director', 'desk', 0), state: 'done', endedAt: 5 }]
    const s = make()
    s.getState().bind('ev1')
    await tick()
    await s.getState().stopRunning()
    expect(api.stop).toHaveBeenCalledTimes(1)
    expect(api.stop).toHaveBeenCalledWith('ev1', { run: 7 })
    await s.getState().stopAll()
    expect(api.stop).toHaveBeenLastCalledWith('ev1', { all: true })
    await s.getState().stopAll(true)
    expect(api.stop).toHaveBeenLastCalledWith('ev1', { all: true, announce: true })
    expect(s.getState().busy).toBeNull()
  })
})

describe('the checks', () => {
  const row = { key: 'speaker:sr', label: 'Server room speaker' }
  const call = { route: '/api/mod/audio/test' as const, body: { speaker: 'sr' } }

  it('tests without asking before the doors open', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    await s.getState().test(row, call)
    expect(dialog.asked).toEqual([])
    expect(api.test).toHaveBeenCalledWith('ev1', call)
    expect(s.getState().check).toBe('speaker:sr')
  })

  it('asks first once the show is live, and a no tests nothing', async () => {
    server.live = true
    const s = make()
    s.getState().bind('ev1')
    await tick()
    dialog.answer = false
    await s.getState().test(row, call)
    expect(dialog.asked.map((d) => d.title)).toEqual(['The show is live'])
    expect(api.test).not.toHaveBeenCalled()
  })

  it('marks at once and puts a refused mark back', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    await s.getState().mark('speaker:sr', 'ok')
    expect(s.getState().view?.marks['speaker:sr']?.mark).toBe('ok')
    expect(api.check).toHaveBeenCalledWith('ev1', 'speaker:sr', 'ok')
    api.check.mockRejectedValueOnce(new ApiError(404, { error: 'no such check' }))
    await s.getState().mark('out:1', 'bad')
    expect(s.getState().view?.marks['out:1']).toBeUndefined()
    expect(s.getState().note?.tone).toBe('bad')
  })

  it('Reset marks asks, then clears', async () => {
    server.marks = { 'speaker:sr': { mark: 'ok', by: 'Director', at: 1 } }
    const s = make()
    s.getState().bind('ev1')
    await tick()
    await s.getState().resetMarks()
    expect(api.checkReset).toHaveBeenCalled()
    expect(s.getState().view?.marks).toEqual({})
  })

  it('opens and closes Zigbee pairing', async () => {
    const s = make()
    s.getState().bind('ev1')
    await tick()
    await s.getState().pair(true)
    expect(api.pair).toHaveBeenCalledWith('ev1', 120)
    expect(s.getState().view?.house.pairUntil).toBe(99_000)
    await s.getState().pair(false)
    expect(api.pair).toHaveBeenLastCalledWith('ev1', 0)
    expect(s.getState().view?.house.pairUntil).toBeNull()
  })
})
