import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { playerOpenError } from '@/store/operate'

describe('why a Players pane could not open', () => {
  it('names a stale event server (no impersonate route) as needing a restart', () => {
    const msg = playerOpenError(new ApiError(404, { error: 'unknown mod action' }))
    expect(msg).toMatch(/restart it/)
  })
  it('passes any other server refusal through', () => {
    expect(playerOpenError(new ApiError(404, { error: 'unknown guest' }))).toBe('Could not open this participant: unknown guest')
  })
})
