import { describe, expect, it } from 'vitest'
import type { RosterRow, WorldEntry } from '@/store/cockpit'
import { UNSEEN_MS, goneCount, isGone, isPersonaRow, seenAgo, unseenGuests } from './guests'

const row = (id: string, name: string, extra: Partial<RosterRow> = {}): RosterRow => ({
  id,
  name,
  role: 'Program',
  faction: null,
  trueFaction: null,
  location: null,
  captured: false,
  score: 0,
  ...extra,
})
const w = (path: string, value: string): WorldEntry => ({ path, value })
const NOW = 10_000_000

describe('who is still here (wave 11 C5)', () => {
  it('seenAgo: just now, minutes, hours; never seen; nothing where untracked', () => {
    expect(seenAgo(NOW - 20_000, NOW)).toBe('seen just now')
    expect(seenAgo(NOW - 12 * 60_000, NOW)).toBe('seen 12 m ago')
    expect(seenAgo(NOW - 65 * 60_000, NOW)).toBe('seen 1 h 05 m ago')
    expect(seenAgo(null, NOW)).toBe('never seen')
    expect(seenAgo(undefined, NOW)).toBeNull()
  })

  it('isGone / isPersonaRow read the world vars (quoted or bare), an owner, a p… id', () => {
    const world = [w('g-1.gone', 'true'), w('g-2.gone', 'false'), w('g-3.persona', '"true"')]
    expect(isGone(world, 'g-1')).toBe(true)
    expect(isGone(world, 'g-2')).toBe(false)
    expect(isGone(world, 'g-9')).toBe(false)
    expect(isPersonaRow(row('g-3', 'Puppet'), world)).toBe(true)
    expect(isPersonaRow(row('p4', 'Writer'), world)).toBe(true)
    expect(isPersonaRow(row('g-5', 'Ana’s', { owner: 'Ana' }), world)).toBe(true)
    expect(isPersonaRow(row('g-1', 'Excel'), world)).toBe(false)
    expect(goneCount([row('g-1', 'a'), row('g-2', 'b')], world)).toBe(1)
  })

  it('unseenGuests: real guests silent for 30 min, longest first — never online, gone, personas, or untracked rows', () => {
    const roster = [
      row('g-1', 'Excel', { lastSeen: NOW - UNSEEN_MS - 1 }),
      row('g-2', 'Winamp', { lastSeen: NOW - 2 * UNSEEN_MS }),
      row('g-3', 'VLC', { lastSeen: NOW - UNSEEN_MS + 1 }),
      row('g-4', 'Pong', { lastSeen: NOW - 2 * UNSEEN_MS, online: true }),
      row('g-5', 'Paint', { lastSeen: NOW - 2 * UNSEEN_MS }),
      row('g-6', 'Puppet', { lastSeen: NOW - 2 * UNSEEN_MS }),
      row('p7', 'Writer', { lastSeen: NOW - 2 * UNSEEN_MS }),
      row('g-8', 'Clippy fan', { lastSeen: null }),
      row('g-9', 'Local'),
    ]
    const world = [w('g-5.gone', 'true'), w('g-6.persona', 'true')]
    expect(unseenGuests(roster, world, NOW).map((g) => g.name)).toEqual(['Winamp', 'Excel'])
    expect(unseenGuests(roster, world, NOW, 60_000).map((g) => g.name)).toEqual(['Winamp', 'Excel', 'VLC'])
  })
})
