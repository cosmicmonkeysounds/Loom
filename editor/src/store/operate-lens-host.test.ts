// The server lens of a host part (wave 13 integration): `PrimeView.host`
// from `GET /api/state?role=prime&as=<character>` rides onto the performer
// lens, so Inspector → Their booth on Task Manager offers the other
// characters' `by:` buttons that booth's phone shows; a plain part's lens
// carries no `host`.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    modApi: {
      ...actual.modApi,
      lens: vi.fn(async (_ev: string, _role: string, id: string) => ({ character: id, guests: [], channels: [], spaces: [], interactions: [], ...(id === 'Task Manager' ? { host: true } : {}) })),
    },
  }
})

import { useOperate } from '@/store/operate'
import type { EventInfo } from '@/lib/api'

const EVENT = {
  id: 'evt-1',
  projectId: 'p-1',
  mode: 'preview',
  status: 'open',
  codes: { event: 'EVT111', prime: 'PRM111', mod: 'MOD111' },
  joinUrl: 'http://localhost/?code=EVT111',
  createdAt: new Date(0).toISOString(),
  startedBy: 'Ada',
} as unknown as EventInfo

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('the performer lens of a host part', () => {
  it('copies PrimeView.host onto the lens; a plain part has none', async () => {
    useOperate.setState({ event: EVENT, roster: [], cast: [{ id: 'Task Manager' }, { id: 'Norton' }] as never })
    useOperate.getState().setPerspective('Task Manager')
    await settle()
    const host = useOperate.getState().lens
    expect(host).toMatchObject({ kind: 'performer', id: 'Task Manager', host: true })
    useOperate.getState().setPerspective('Norton')
    await settle()
    const plain = useOperate.getState().lens
    expect(plain).toMatchObject({ kind: 'performer', id: 'Norton' })
    expect(plain !== null && 'host' in plain).toBe(false)
  })
})
