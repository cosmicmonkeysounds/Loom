// A press the server refuses as `moved` (409: another director's press
// landed since the arm) fired nothing: the store names the server's newest
// press (the 409's fresh `cues.pressed`) and gives back the console's own
// press marker, so another director's LAST still reads as theirs. A taken
// press passes the server's press count through.

import { afterEach, describe, expect, it, vi } from 'vitest'

const fireSignal = vi.fn()
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, modApi: { ...actual.modApi, fireSignal: (...a: unknown[]) => fireSignal(...a) } }
})

import { ApiError } from '@/lib/api'
import { useOperate } from '@/store/operate'

const event = { id: 'evt-1', projectId: 'p-1', mode: 'live', status: 'open', codes: { event: 'E', prime: 'P', mod: 'M' }, joinUrl: '', createdAt: new Date(0).toISOString() }

afterEach(() => {
  fireSignal.mockReset()
})

describe('operate.fireSignal and a 409 moved', () => {
  it("names the server's newest press and keeps the earlier own press", async () => {
    const before = { name: 'read_the_results', at: 1 }
    useOperate.setState({ event: event as never, ownPress: before })
    fireSignal.mockRejectedValueOnce(new ApiError(409, { error: 'the cues moved', moved: true, cues: { last: 'call_c7', fired: ['call_c7'], presses: 7, pressed: 'call_c7' } }))
    const res = await useOperate.getState().fireSignal('call_c7', undefined, null, null, 6)
    expect(res).toEqual({ moved: true, pressed: 'call_c7' })
    // Not this console's press: B's LAST = C7 must flash "moved by another director".
    expect(useOperate.getState().ownPress).toBe(before)
  })

  it('a taken press passes the press count through and stays this console\'s own', async () => {
    useOperate.setState({ event: event as never, ownPress: null })
    fireSignal.mockResolvedValueOnce({ presses: 8 })
    const res = await useOperate.getState().fireSignal('spin_the_bottle', undefined, null, null, 7)
    expect(res).toEqual({ presses: 8 })
    expect(useOperate.getState().ownPress?.name).toBe('spin_the_bottle')
  })
})
