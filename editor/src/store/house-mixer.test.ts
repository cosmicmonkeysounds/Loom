// The Mixer's store against a fake api and fake timers (wave 40 C4): the
// poll's lifecycle (only while shown and visible; 404 / 403 stop it), the
// optimistic faders and their release on the server's seq, the throttle
// with its trailing value, and the posts every button makes.

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
vi.mock('@/store/dialog', () => ({ confirmAction: async () => true }))
import { applyMixChanges, type AudioMix, type MixChange, type MusicCommand } from '@loom/core/house-mixer'
import { ApiError } from '@/lib/api'
import { fixtureMixer } from '@/lib/test/mixer-fixture'
import { createHouseMixerStore, mixerLevels, MIXER_POLL_MS, MIX_POST_MS, type MixerApiLike } from './house-mixer'

let mix: AudioMix
let api: { [K in keyof MixerApiLike]: Mock<MixerApiLike[K]> }
let visible: boolean
let answers: boolean[]
let asked: string[]
/** Posts park here until a test lets them answer. */
let held: Array<() => void>
let hold: boolean

function store() {
  return createHouseMixerStore({
    api,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    clock: () => Date.now(),
    visible: () => visible,
    confirm: async (title) => {
      asked.push(title)
      return answers.shift() ?? true
    },
  })
}

const flush = () => vi.advanceTimersByTimeAsync(0)
const posted = (): Array<{ changes: MixChange[]; resetAll?: boolean }> => api.mix.mock.calls.map(([, changes, resetAll]) => ({ changes, ...(resetAll === true ? { resetAll } : {}) }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  mix = { seq: 1, levels: {} }
  visible = true
  answers = []
  asked = []
  held = []
  hold = false
  api = {
    get: vi.fn(async () => fixtureMixer({ seq: mix.seq, levels: mix.levels })),
    mix: vi.fn(async (_id: string, changes: MixChange[], resetAll?: boolean) => {
      const next = { seq: mix.seq + 1, levels: resetAll === true ? {} : applyMixChanges(mix.levels, changes) }
      if (hold) await new Promise<void>((r) => held.push(r))
      mix = next
      return { mix: next }
    }),
    music: vi.fn(async (_id: string, _cmd: MusicCommand) => ({ seq: 1, router: true })),
    signal: vi.fn(async (_id: string, _name: string) => ({})),
  }
})
afterEach(() => {
  vi.useRealTimers()
})

describe('wave 58: Trabolta at the stereo', () => {
  it('the lock and the unlock fire the story\'s cues, and say so', async () => {
    const s = store()
    s.getState().bind('ev1')
    await s.getState().lockDj(true)
    await s.getState().lockDj(false)
    expect(api.signal.mock.calls.map((c) => c[1])).toEqual(['trabolta_music_lock', 'trabolta_music_unlock'])
    expect(s.getState().note?.text).toContain('can reach the music')
  })

  it('a refused lock says so and lets go of busy', async () => {
    const s = store()
    s.getState().bind('ev1')
    api.signal.mockRejectedValueOnce(new Error('nope'))
    await s.getState().lockDj(true)
    expect(s.getState().busy).toBeNull()
    expect(s.getState().note?.tone).toBe('bad')
  })
})

describe('the poll', () => {
  it('reads only while the Mixer is shown, every second, and stops when it closes', async () => {
    const s = store()
    s.getState().bind('ev')
    await vi.advanceTimersByTimeAsync(3 * MIXER_POLL_MS)
    expect(api.get).not.toHaveBeenCalled()
    s.getState().watch(true)
    await flush()
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(s.getState().view!.router.name).toBe('house-desktop')
    await vi.advanceTimersByTimeAsync(MIXER_POLL_MS)
    expect(api.get).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(MIXER_POLL_MS)
    expect(api.get).toHaveBeenCalledTimes(3)
    s.getState().watch(false)
    await vi.advanceTimersByTimeAsync(5 * MIXER_POLL_MS)
    expect(api.get).toHaveBeenCalledTimes(3)
    // Shown again: one loop, not two.
    s.getState().watch(true)
    await flush()
    await vi.advanceTimersByTimeAsync(MIXER_POLL_MS)
    expect(api.get).toHaveBeenCalledTimes(5)
  })

  it('skips its reads while the tab is hidden', async () => {
    const s = store()
    s.getState().bind('ev')
    s.getState().watch(true)
    await flush()
    visible = false
    await vi.advanceTimersByTimeAsync(4 * MIXER_POLL_MS)
    expect(api.get).toHaveBeenCalledTimes(1)
    visible = true
    await vi.advanceTimersByTimeAsync(MIXER_POLL_MS)
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('nothing bound reads nothing; a new event starts over', async () => {
    const s = store()
    s.getState().watch(true)
    await vi.advanceTimersByTimeAsync(2 * MIXER_POLL_MS)
    expect(api.get).not.toHaveBeenCalled()
    s.getState().bind('ev')
    await flush()
    expect(api.get).toHaveBeenLastCalledWith('ev')
    s.getState().bind('ev2')
    expect(s.getState().view).toBe(null)
    await flush()
    expect(api.get).toHaveBeenLastCalledWith('ev2')
    await vi.advanceTimersByTimeAsync(MIXER_POLL_MS)
    expect(api.get.mock.calls.slice(-1)[0]![0]).toBe('ev2')
  })

  it('an older server (404) or a refusal (403) stops it; a dead server backs off', async () => {
    const s = store()
    api.get.mockRejectedValueOnce(new ApiError(404, { error: 'not found' }))
    s.getState().bind('ev')
    s.getState().watch(true)
    await flush()
    expect(s.getState().gone).toBe('missing')
    await vi.advanceTimersByTimeAsync(5 * MIXER_POLL_MS)
    expect(api.get).toHaveBeenCalledTimes(1)
    // Reopening the view tries again.
    api.get.mockRejectedValueOnce(new ApiError(403, { error: 'forbidden' }))
    s.getState().watch(false)
    s.getState().watch(true)
    await flush()
    expect(s.getState().gone).toBe('denied')
    s.getState().watch(false)
    api.get.mockRejectedValueOnce(new TypeError('fetch failed')).mockRejectedValueOnce(new TypeError('fetch failed'))
    s.getState().watch(true)
    await flush()
    expect(s.getState().reachable).toBe(false)
    expect(s.getState().gone).toBe(null)
    await vi.advanceTimersByTimeAsync(MIXER_POLL_MS) // retry after 1 s
    expect(api.get).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(MIXER_POLL_MS) // then 2 s
    expect(api.get).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(MIXER_POLL_MS)
    expect(api.get).toHaveBeenCalledTimes(5)
    expect(s.getState().reachable).toBe(true)
  })
})

async function shown() {
  const s = store()
  s.getState().bind('ev')
  s.getState().watch(true)
  await flush()
  return s
}

describe('the optimistic faders', () => {
  it('shows the panel’s value until a GET reaches the post’s seq', async () => {
    const s = await shown()
    // The server's GET still answers the old mix (the router path is slow).
    let stale = true
    api.get.mockImplementation(async () => fixtureMixer(stale ? { seq: 1, levels: {} } : { seq: mix.seq, levels: mix.levels }))
    s.getState().setLevel('src:music', -6.2)
    expect(mixerLevels(s.getState())['src:music']).toEqual({ db: -6, mute: false })
    await flush()
    expect(posted()).toEqual([{ changes: [{ key: 'src:music', db: -6, mute: false }] }])
    expect(s.getState().pending['src:music']!.until).toBe(2)
    await vi.advanceTimersByTimeAsync(MIXER_POLL_MS)
    // A GET at seq 1 doesn't release it: the fader stays where it was put.
    expect(s.getState().view!.mix.seq).toBe(1)
    expect(mixerLevels(s.getState())['src:music']).toEqual({ db: -6, mute: false })
    stale = false
    await vi.advanceTimersByTimeAsync(MIXER_POLL_MS)
    expect(s.getState().pending).toEqual({})
    expect(mixerLevels(s.getState())['src:music']).toEqual({ db: -6, mute: false })
  })

  it('an answer for an older move doesn’t release a newer one', async () => {
    const s = await shown()
    hold = true
    s.getState().setLevel('master', -3)
    await flush()
    s.getState().setLevel('master', -9)
    held.shift()!()
    await flush()
    expect(s.getState().pending['master']!.until).toBe(null)
    expect(mixerLevels(s.getState())['master']!.db).toBe(-9)
    await vi.advanceTimersByTimeAsync(MIX_POST_MS)
    expect(posted().map((p) => p.changes[0]!.db)).toEqual([-3, -9])
    held.shift()!()
    await flush()
    expect(s.getState().pending['master']!.until).toBe(3)
  })

  it('a refused move goes back to the server’s level, with a note', async () => {
    const s = await shown()
    api.mix.mockRejectedValueOnce(new ApiError(400, { error: 'changes[0]: key must be …' }))
    s.getState().setMute('room:living', true)
    expect(mixerLevels(s.getState())['room:living']).toEqual({ db: 0, mute: true })
    await flush()
    expect(s.getState().pending).toEqual({})
    expect(mixerLevels(s.getState())['room:living']).toBeUndefined()
    expect(s.getState().note!.tone).toBe('bad')
    api.mix.mockRejectedValueOnce(new ApiError(403, { error: 'forbidden' }))
    s.getState().setMute('room:living', true)
    await vi.advanceTimersByTimeAsync(MIX_POST_MS)
    expect(s.getState().note!.text).toContain('hosts and directors only')
  })
})

describe('the throttle', () => {
  it('posts at most every 100 ms per fader, one at a time, and always sends the last value', async () => {
    const s = await shown()
    for (let i = 1; i <= 9; i++) {
      s.getState().setLevel('src:sfx', -i)
      await vi.advanceTimersByTimeAsync(10)
    }
    // 90 ms of dragging: the first value went at once, the rest wait.
    expect(posted().map((p) => p.changes[0]!.db)).toEqual([-1])
    await vi.advanceTimersByTimeAsync(10)
    expect(posted().map((p) => p.changes[0]!.db)).toEqual([-1, -9])
    await vi.advanceTimersByTimeAsync(5 * MIX_POST_MS)
    expect(api.mix).toHaveBeenCalledTimes(2)
    expect(mix.levels['src:sfx']).toEqual({ db: -9, mute: false })
  })

  it('a steady drag reaches ≤ 10 posts a second', async () => {
    const s = await shown()
    for (let i = 0; i < 100; i++) {
      s.getState().setLevel('master', -(i % 60) / 2)
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(api.mix.mock.calls.length).toBeLessThanOrEqual(11)
    await vi.advanceTimersByTimeAsync(MIX_POST_MS)
    expect(mix.levels['master']!.db).toBe(-(99 % 60) / 2)
  })

  it('each fader has its own throttle', async () => {
    const s = await shown()
    s.getState().setLevel('master', -1)
    s.getState().setLevel('src:music', -2)
    await flush()
    expect(posted().map((p) => p.changes[0]!.key)).toEqual(['master', 'src:music'])
  })
})

describe('the posts', () => {
  it('reset one fader, a column, everything (asked first)', async () => {
    mix = { seq: 1, levels: { master: { db: -3, mute: false }, 'room:living': { db: -6, mute: false }, 'room:living/src:music': { db: 0, mute: true }, 'spk:living_sub': { db: 4, mute: false } } }
    const s = await shown()
    s.getState().resetKey('spk:living_sub')
    await flush()
    expect(posted()[0]).toEqual({ changes: [{ key: 'spk:living_sub', reset: true }] })
    await s.getState().resetKeys(['room:living', 'room:living/src:music'])
    expect(posted()[1]).toEqual({ changes: [{ key: 'room:living', reset: true }, { key: 'room:living/src:music', reset: true }] })
    expect(mixerLevels(s.getState())).toEqual({ master: { db: -3, mute: false } })
    answers = [false]
    await s.getState().resetAll()
    expect(asked).toEqual(['Reset the whole mix?'])
    expect(api.mix).toHaveBeenCalledTimes(2)
    await s.getState().resetAll()
    expect(posted()[2]).toEqual({ changes: [], resetAll: true })
    expect(mixerLevels(s.getState())).toEqual({})
    await vi.advanceTimersByTimeAsync(MIXER_POLL_MS)
    expect(s.getState().view!.mix).toEqual({ seq: 4, levels: {} })
    expect(s.getState().pending).toEqual({})
  })

  it('a column’s Reset cancels that fader’s waiting value', async () => {
    const s = await shown()
    s.getState().setLevel('master', -1)
    s.getState().setLevel('master', -2) // waits for the throttle
    await flush()
    await s.getState().resetKeys(['master'])
    await vi.advanceTimersByTimeAsync(3 * MIX_POST_MS)
    expect(posted().map((p) => p.changes)).toEqual([[{ key: 'master', db: -1, mute: false }], [{ key: 'master', reset: true }]])
    expect(mix.levels).toEqual({})
  })

  it('the music buttons', async () => {
    const s = await shown()
    await s.getState().music({ action: 'scene', scene: 'act_2' })
    await s.getState().music({ action: 'story' })
    await s.getState().music({ action: 'next', playlist: 'lounge' })
    await s.getState().music({ action: 'next' })
    expect(s.getState().note!.text).toBe('⏭ Skipped every bed.')
    api.music.mockResolvedValueOnce({ seq: 5, router: false })
    await s.getState().music({ action: 'stop' })
    expect(api.music.mock.calls.map(([, c]) => c)).toEqual([{ action: 'scene', scene: 'act_2' }, { action: 'story' }, { action: 'next', playlist: 'lounge' }, { action: 'next' }, { action: 'stop' }])
    expect(s.getState().note).toMatchObject({ tone: 'warn' })
    expect(s.getState().note!.text).toContain('no router listening')
    expect(s.getState().busy).toBe(null)
  })
})
