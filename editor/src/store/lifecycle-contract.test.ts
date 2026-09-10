// The one lifecycle contract, both backends: `startRun` → a run with a
// persona you own and the cockpit on Chat; pause / resume; `end` → no run,
// but the run kept for export. The server backend runs against a mocked
// control plane (no SSE in node), so this pins the *shape* of the contract —
// the local backend's behaviour is covered in depth in `sim.test.ts`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  let status: 'open' | 'paused' = 'open'
  const event = () => ({
    id: 'evt-1',
    projectId: 'p-1',
    mode: 'preview' as const,
    status,
    codes: { event: 'EVT111', prime: 'PRM111', mod: 'MOD111' },
    joinUrl: 'http://localhost/?code=EVT111',
    createdAt: new Date(0).toISOString(),
    startedBy: 'Ada',
  })
  return {
    ...actual,
    eventsApi: {
      status: vi.fn(async () => null),
      launch: vi.fn(async () => {
        status = 'open'
        return event()
      }),
      pause: vi.fn(async () => {
        status = 'paused'
        return event()
      }),
      resume: vi.fn(async () => {
        status = 'open'
        return event()
      }),
      end: vi.fn(async () => {}),
      reload: vi.fn(async () => event()),
      goLive: vi.fn(async () => ({ ...event(), mode: 'live' as const })),
    },
    modApi: {
      ...actual.modApi,
      persona: vi.fn(async () => ({ id: 'p-abc', owner: 'Ada' })),
      lens: vi.fn(async () => ({})),
      reset: vi.fn(async () => {}),
    },
  }
})

import { lspWorkspaceSync, uriFor } from '@/lib/lsp-client'
import { useAuth } from '@/store/auth'
import { CockpitPhase, CockpitTab, RunMode, type CockpitStore } from '@/store/cockpit'
import { useOperate } from '@/store/operate'
import { useSim } from '@/store/sim'

const MAIN = `entry: opening

ROLE Guest
  score: 0 to 100 = 0

== opening
  The lights dim.
`

const backends: Array<[string, CockpitStore, () => Promise<void>, () => Promise<void>]> = [
  [
    'local',
    useSim,
    async () => {
      await useSim.getState().end()
      lspWorkspaceSync().reset()
      lspWorkspaceSync().updateMany([[uriFor('main.loom'), MAIN]])
    },
    async () => useSim.getState().end(),
  ],
  [
    'server',
    useOperate,
    async () => {
      useAuth.setState({ user: { id: 'u1', name: 'Ada', email: 'ada@example.test' } })
      useOperate.getState().detach()
      useOperate.getState().attach('p-1')
    },
    async () => useOperate.getState().detach(),
  ],
]

describe.each(backends)('lifecycle contract · %s backend', (_name, store, setup, teardown) => {
  beforeEach(setup)

  it('startRun(Rehearsal) → an open run, a persona you own, the cockpit on Chat', async () => {
    await store.getState().startRun(RunMode.Rehearsal)
    const s = store.getState()
    expect(s.run).not.toBeNull()
    expect(s.run?.mode).toBe(RunMode.Rehearsal)
    expect(s.phase).toBe(CockpitPhase.Open)
    expect(s.personas.length).toBe(1)
    expect(s.activeTab).toBe(CockpitTab.Chat)
    expect(s.activeChannel).toBe('lobby')
    expect(s.busy).toBe(false)
    expect(s.error).toBeNull()
    await teardown()
  })

  it('pause / resume flip the phase and keep the run', async () => {
    await store.getState().startRun(RunMode.Rehearsal)
    await store.getState().pause()
    expect(store.getState().phase).toBe(CockpitPhase.Paused)
    expect(store.getState().run).not.toBeNull()
    await store.getState().resume()
    expect(store.getState().phase).toBe(CockpitPhase.Open)
    await teardown()
  })

  it('end → no run, phase idle, the run kept as lastRun for export', async () => {
    await store.getState().startRun(RunMode.Rehearsal)
    await store.getState().end()
    const s = store.getState()
    expect(s.run).toBeNull()
    expect(s.phase).toBe(CockpitPhase.Idle)
    expect(s.lastRun).not.toBeNull()
    expect(s.lastRun?.run.mode).toBe(RunMode.Rehearsal)
    expect(s.activeTab).toBe(CockpitTab.Run)
    await teardown()
  })
})
