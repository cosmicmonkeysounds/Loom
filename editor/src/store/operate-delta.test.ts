// W9 O1-01 (C7): the operate store opens the mod stream with `delta=1` and
// rebuilds each view from the keyframe + `snapshotPatch` frames — the store
// ends exactly where a whole snapshot of the same view would put it. A patch
// before any keyframe is ignored; one against the wrong base reopens the
// stream (the server's first frame on it is whole).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { modPatch } from '@loom/core/mod-patch'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  const event = {
    id: 'evt-1',
    projectId: 'p-1',
    mode: 'live' as const,
    status: 'open' as const,
    codes: { event: 'EVT111', prime: 'PRM111', mod: 'MOD111' },
    joinUrl: 'http://localhost/?code=EVT111',
    createdAt: new Date(0).toISOString(),
    startedBy: 'Ada',
  }
  return {
    ...actual,
    eventsApi: { ...actual.eventsApi, status: vi.fn(async () => null), launch: vi.fn(async () => event) },
    modApi: { ...actual.modApi, lens: vi.fn(async () => ({})) },
  }
})

import { useAuth } from '@/store/auth'
import { RunMode } from '@/store/cockpit'
import { useOperate } from '@/store/operate'

/** The browser's EventSource, as far as the store uses it. */
class FakeEventSource {
  static opened: FakeEventSource[] = []
  url: string
  closed = false
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private listeners = new Map<string, Array<(e: { data: string }) => void>>()
  constructor(url: string) {
    this.url = url
    FakeEventSource.opened.push(this)
  }
  addEventListener(type: string, fn: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close() {
    this.closed = true
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) })
  }
}

const row = (id: string, name: string, score: number) => ({ id, name, role: 'Program', faction: null, trueFaction: null, score, location: null, captured: false })
const v0 = {
  phase: 'open',
  scenario: 'show',
  ledgerLen: 1,
  roster: [row('g-1', 'Ada', 0), row('g-2', 'Bo', 0)],
  world: [
    { path: 'g-1.score', value: '0' },
    { path: 'g-2.score', value: '0' },
  ],
  codex: [{ id: 'The LiveJournal', title: 'The LiveJournal', about: null, text: '…', code: 'trabolta4ever', holders: [] }],
  choices: {},
  beats: ['Power On'],
}
const v1 = {
  ...v0,
  ledgerLen: 4,
  roster: [row('g-1', 'Ada', 5), row('g-2', 'Bo', 0), row('g-3', 'Cy', 0)],
  world: [
    { path: 'g-1.score', value: '5' },
    { path: 'g-2.score', value: '0' },
    { path: 'g-3.score', value: '0' },
  ],
  codex: [{ ...v0.codex[0]!, holders: ['g-1'] }],
}
const v2 = { ...v1, ledgerLen: 6, roster: [v1.roster[0]!, v1.roster[2]!], world: [v1.world[0]!, v1.world[2]!], choices: { 'g-1': ['Stay', 'Go'] } }

/** Everything a snapshot writes into the store. */
const picked = () => {
  const s = useOperate.getState()
  return { roster: s.roster, world: s.world, codex: s.codex, choices: s.choices, ledgerLen: s.ledgerLen, beats: s.beats, phase: s.phase }
}

beforeEach(async () => {
  FakeEventSource.opened = []
  vi.stubGlobal('EventSource', FakeEventSource)
  useAuth.setState({ user: { id: 'u1', name: 'Ada', email: 'ada@example.test' } })
  useOperate.getState().detach()
  useOperate.getState().attach('p-1')
  await useOperate.getState().startRun(RunMode.Live)
})
afterEach(() => {
  useOperate.getState().detach()
  vi.unstubAllGlobals()
})

const stream = () => FakeEventSource.opened.at(-1)!

describe('the operate store on the delta mod stream', () => {
  it('opts in, and keyframe + patches land the store where the whole view would', () => {
    expect(stream().url).toBe('/e/evt-1/events?role=mod&delta=1')
    stream().emit('snapshot', { _frame: 7, ...v0 })
    stream().emit('snapshotPatch', { base: 7, frame: 8, patch: modPatch(v0, v1) })
    stream().emit('snapshotPatch', { base: 8, frame: 9, patch: modPatch(v1, v2) })
    const patched = picked()
    expect(patched.roster.map((r) => r.id)).toEqual(['g-1', 'g-3'])
    expect(patched.codex[0]!.holders).toEqual(['g-1'])
    // The same view, sent whole.
    stream().emit('snapshot', v2)
    expect(picked()).toEqual(patched)
    expect(FakeEventSource.opened.length).toBe(1)
  })

  it('ignores a patch before any keyframe, and reopens on a base it does not hold', () => {
    stream().emit('snapshotPatch', { base: 1, frame: 2, patch: modPatch(v0, v1) })
    expect(useOperate.getState().roster).toEqual([])
    stream().emit('snapshot', { _frame: 3, ...v0 })
    const first = stream()
    first.emit('snapshotPatch', { base: 5, frame: 6, patch: modPatch(v1, v2) })
    // Nothing applied; the stream was reopened — and it is the only one open.
    expect(picked().roster.map((r) => r.id)).toEqual(['g-1', 'g-2'])
    expect(first.closed).toBe(true)
    expect(FakeEventSource.opened.length).toBe(2)
    expect(stream().closed).toBe(false)
    expect(stream().url).toBe('/e/evt-1/events?role=mod&delta=1')
  })
})
