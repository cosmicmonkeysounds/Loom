// The one lifecycle contract, both backends: `startRun` → a run with a
// persona you own and the cockpit on Chat; pause / resume; `end` → no run,
// but the run kept for export. The server backend runs against a mocked
// control plane (no SSE in node), so this pins the *shape* of the contract —
// the local backend's behaviour is covered in depth in `sim.test.ts`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The director's wallet mirror the mocked `/api/mod/wallet/*` routes answer.
const WALLET = {
  name: 'Truthcoin',
  slot: 'score',
  approver: 'CRA_Agent_Software',
  minter: 'Runescape',
  minterPerson: null,
  counter: 3,
  stimulus: { uses: 0, limit: 3 },
  grants: { uses: 0, limit: 3 },
  frozen: [],
  open: { transfers: [], requests: [], offers: [] },
}

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
      grantCodex: vi.fn(async () => {}),
      stepQuest: vi.fn(async () => {}),
      wallet: vi.fn(async (_ev: string, action: string) => ({ ...WALLET, counter: action === 'stimulus' ? 9 : WALLET.counter })),
    },
  }
})

import { lspWorkspaceSync, uriFor } from '@/lib/lsp-client'
import { useAuth } from '@/store/auth'
import { CockpitPhase, CockpitTab, QuestAction, RunMode, WalletAction, type CockpitStore } from '@/store/cockpit'
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
    // No snapshot has carried a wallet yet (and the local backend never has one).
    expect(s.wallet).toBeNull()
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

describe('launch code rotation (server)', () => {
  it('pins codes by default; rotateStaff asks the control plane for fresh staff codes', async () => {
    const { eventsApi } = await import('@/lib/api')
    const launch = vi.mocked(eventsApi.launch)
    useAuth.setState({ user: { id: 'u1', name: 'Ada', email: 'ada@example.test' } })
    useOperate.getState().detach()
    useOperate.getState().attach('p-1')
    launch.mockClear()
    await useOperate.getState().startRun(RunMode.Rehearsal)
    expect(launch).toHaveBeenLastCalledWith('p-1', 'preview', {})
    await useOperate.getState().end()
    await useOperate.getState().startRun(RunMode.Live, { rotateStaff: true })
    expect(launch).toHaveBeenLastCalledWith('p-1', 'live', { rotate: 'staff' })
    useOperate.getState().detach()
  })
})

describe('codex + quest grants (server, S4)', () => {
  it('post to the event mod routes', async () => {
    const { modApi } = await import('@/lib/api')
    useAuth.setState({ user: { id: 'u1', name: 'Ada', email: 'ada@example.test' } })
    useOperate.getState().detach()
    useOperate.getState().attach('p-1')
    await useOperate.getState().startRun(RunMode.Rehearsal)
    await useOperate.getState().grantCodex('g-1', 'The Sandy File')
    expect(modApi.grantCodex).toHaveBeenLastCalledWith('evt-1', 'g-1', 'The Sandy File')
    await useOperate.getState().stepQuest('g-1', 'The Hunt', QuestAction.Fail, 'Too slow.')
    expect(modApi.stepQuest).toHaveBeenLastCalledWith('evt-1', 'g-1', 'The Hunt', 'fail', 'Too slow.')
    expect(useOperate.getState().error).toBeNull()
    useOperate.getState().detach()
  })
})

describe('the director wallet (E2)', () => {
  const tx = (id: string, state: 'held' | 'pending') => ({ id, from: 'g-1', fromName: 'Excel', to: 'g-2', toName: 'Winamp', amount: 5, state, settleAt: 1, via: 'send' as const, at: 0 })

  it('server: each action posts its route and applies the answer at once', async () => {
    const { modApi } = await import('@/lib/api')
    const wallet = vi.mocked(modApi.wallet)
    useAuth.setState({ user: { id: 'u1', name: 'Ada', email: 'ada@example.test' } })
    useOperate.getState().detach()
    useOperate.getState().attach('p-1')
    await useOperate.getState().startRun(RunMode.Rehearsal)
    expect(await useOperate.getState().walletAct(WalletAction.Approve, 't4')).toBe(true)
    expect(wallet).toHaveBeenLastCalledWith('evt-1', 'approve', { id: 't4' })
    expect(await useOperate.getState().walletAct(WalletAction.Stimulus, 25)).toBe(true)
    expect(wallet).toHaveBeenLastCalledWith('evt-1', 'stimulus', { amount: 25 })
    expect(useOperate.getState().wallet?.counter).toBe(9)
    await useOperate.getState().walletAct(WalletAction.ApproveHeld)
    expect(wallet).toHaveBeenLastCalledWith('evt-1', 'approve-held')
    expect(await useOperate.getState().walletAct(WalletAction.Unfreeze, 'f2')).toBe(true)
    expect(wallet).toHaveBeenLastCalledWith('evt-1', 'unfreeze', { id: 'f2' })
    expect(useOperate.getState().error).toBeNull()
    useOperate.getState().detach()
  })

  it('server: an older server without approve-held gets one approve per held transfer', async () => {
    const { ApiError, modApi } = await import('@/lib/api')
    const wallet = vi.mocked(modApi.wallet)
    useAuth.setState({ user: { id: 'u1', name: 'Ada', email: 'ada@example.test' } })
    useOperate.getState().detach()
    useOperate.getState().attach('p-1')
    await useOperate.getState().startRun(RunMode.Rehearsal)
    useOperate.setState({ wallet: { ...WALLET, open: { transfers: [tx('t1', 'held'), tx('t2', 'pending'), tx('t3', 'held')], requests: [], offers: [] } } })
    wallet.mockClear()
    wallet.mockRejectedValueOnce(new ApiError(404, { error: 'unknown mod action' }))
    expect(await useOperate.getState().walletAct(WalletAction.ApproveHeld)).toBe(true)
    expect(wallet.mock.calls.map((c) => c.slice(1))).toEqual([['approve-held'], ['approve', { id: 't1' }], ['approve', { id: 't3' }]])
    // A real refusal (no currency) is not papered over.
    wallet.mockRejectedValueOnce(new ApiError(404, { error: 'this story has no currency' }))
    expect(await useOperate.getState().walletAct(WalletAction.ApproveHeld)).toBe(false)
    expect(useOperate.getState().error).toBe('this story has no currency')
    useOperate.getState().detach()
  })

  it('local: no wallet, and an action says why', async () => {
    await useSim.getState().end()
    lspWorkspaceSync().reset()
    lspWorkspaceSync().updateMany([[uriFor('main.loom'), MAIN]])
    await useSim.getState().startRun(RunMode.Rehearsal)
    expect(useSim.getState().wallet).toBeNull()
    expect(await useSim.getState().walletAct(WalletAction.Stimulus, 10)).toBe(false)
    expect(useSim.getState().error).toMatch(/event server/)
    await useSim.getState().end()
  })
})
