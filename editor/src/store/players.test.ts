import { beforeEach, describe, expect, it } from 'vitest'
import { PlayerRole } from '@/store/cockpit'
import { PaneWidth, reseatTarget, usePlayers, type PlayerSlot } from '@/store/players'

const mem = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage

describe('the Players lineup', () => {
  beforeEach(() => {
    mem.clear()
    usePlayers.setState({ scope: null, slots: [], width: PaneWidth.Phone })
  })

  it('seats each participant once and persists per project', () => {
    const p = usePlayers.getState()
    p.bind('proj-a')
    const k1 = p.add(PlayerRole.Guest, 'p-1', 'Ada')
    expect(usePlayers.getState().add(PlayerRole.Guest, 'p-1', 'Ada')).toBe(k1)
    usePlayers.getState().add(PlayerRole.Performer, 'Clippy', 'Clippy')
    usePlayers.getState().setWidth(PaneWidth.Wide)
    expect(usePlayers.getState().slots).toHaveLength(2)

    usePlayers.getState().bind('proj-b')
    expect(usePlayers.getState().slots).toHaveLength(0)
    usePlayers.getState().bind('proj-a')
    expect(usePlayers.getState().slots.map((s) => s.id)).toEqual(['p-1', 'Clippy'])
    expect(usePlayers.getState().width).toBe(PaneWidth.Wide)
  })

  it('re-seats a pane onto a new persona id, keeping its key', () => {
    usePlayers.getState().bind('proj')
    const key = usePlayers.getState().add(PlayerRole.Guest, 'p-old', 'Ada')
    usePlayers.getState().rebind(key, 'p-new')
    expect(usePlayers.getState().slots).toEqual([{ key, role: PlayerRole.Guest, id: 'p-new', name: 'Ada' }])
  })

  it('tolerates a corrupt saved lineup', () => {
    mem.set('loom.players.bad', '{"slots":[{"key":1},{"key":"k","role":"guest","id":"p-1","name":"A"}],"width":"huge"}')
    usePlayers.getState().bind('bad')
    expect(usePlayers.getState().slots.map((s) => s.key)).toEqual(['k'])
    expect(usePlayers.getState().width).toBe(PaneWidth.Phone)
  })
})

describe('reseatTarget', () => {
  const slot: PlayerSlot = { key: 'a', role: PlayerRole.Guest, id: 'p-dead', name: 'Ada' }

  it('reuses a same-named persona you own that no other pane holds', () => {
    const roster = [
      { id: 'g-1', name: 'Ada', owner: null },
      { id: 'p-2', name: 'Ada', owner: 'Bo' },
      { id: 'p-3', name: 'Ada', owner: 'Me' },
    ]
    expect(reseatTarget(slot, roster, 'Me', [slot])).toBe('p-3')
    const other: PlayerSlot = { key: 'b', role: PlayerRole.Guest, id: 'p-3', name: 'Ada' }
    expect(reseatTarget(slot, roster, 'Me', [slot, other])).toBeNull()
  })

  it('never re-seats onto a real guest', () => {
    expect(reseatTarget(slot, [{ id: 'g-9', name: 'Ada' }], 'Me', [slot])).toBeNull()
  })
})
