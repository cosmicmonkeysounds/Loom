import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { playerOpenError, playerSessionOf } from '@/store/operate'

describe('why a Players pane could not open', () => {
  it('names a stale event server (no impersonate route) as needing a restart', () => {
    const msg = playerOpenError(new ApiError(404, { error: 'unknown mod action' }))
    expect(msg).toMatch(/restart it/)
  })
  it('passes any other server refusal through', () => {
    expect(playerOpenError(new ApiError(404, { error: 'unknown guest' }))).toBe('Could not open this participant: unknown guest')
  })
})

describe('the session a Players pane opens on', () => {
  const minted = { token: 't', id: 'Task Manager', name: 'Task Manager', eventId: 'e', title: 'T' }
  it("a host part's booth pane carries host (the NEXT bar from the first frame)", () => {
    expect(playerSessionOf({ ...minted, role: 'prime', host: true })).toEqual({ role: 'prime', token: 't', character: 'Task Manager', eventId: 'e', title: 'T', host: true })
  })
  it('a plain part, an older server and a guest carry none', () => {
    expect(playerSessionOf({ ...minted, role: 'prime', host: false })).not.toHaveProperty('host')
    expect(playerSessionOf({ ...minted, role: 'prime' })).not.toHaveProperty('host')
    expect(playerSessionOf({ ...minted, role: 'guest', id: 'g1', name: 'Winamp' })).toEqual({ role: 'guest', token: 't', id: 'g1', name: 'Winamp', eventId: 'e', title: 'T' })
  })
})
