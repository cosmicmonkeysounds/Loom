import { describe, expect, it } from 'vitest'
import { entityVars, groupWorld, GUEST_STANDARD_FIELDS } from './world'
import type { CastSummary, FactionSummary, LocationSummary, RosterRow, WorldEntry } from '@/store/cockpit'

const roster: RosterRow[] = [
  { id: 'g-1', name: 'Alice', role: 'Guest', faction: 'Mods', trueFaction: 'Mods', location: 'Party', captured: false, score: 3 },
]
const cast: CastSummary[] = [{ id: 'TheAdmin', faction: 'Mods' }]
const factions: FactionSummary[] = [{ id: 'Mods', hidden: false, revealed: false, ethos: null, rival: null, members: ['g-1'] }]
const locations: LocationSummary[] = [{ id: 'Party', label: null, prison: false, occupants: ['g-1'] }]

const entries: WorldEntry[] = [
  { path: 'Mods', value: '"Mods"' }, // identity seed — hidden
  { path: 'Mods.hidden', value: 'false' },
  { path: 'Party.ambient', value: '"disco"' },
  { path: 'TheAdmin.captures', value: '2' },
  { path: 'Time.elapsed', value: '90' },
  { path: 'alarm_level', value: '3' },
  { path: 'g-1.name', value: '"Alice"' },
  { path: 'g-1.score', value: '3' },
  { path: 'g-1.suspicion', value: '7' },
]

describe('groupWorld', () => {
  it('sorts entries into clock / globals / per-guest / cast / world groups', () => {
    const g = groupWorld(entries, roster, cast, factions, locations)
    expect(g.clock!.entries).toEqual([{ name: 'elapsed', value: '90', path: 'Time.elapsed' }])
    expect(g.globals!.entries).toEqual([{ name: 'alarm_level', value: '3', path: 'alarm_level' }])
    expect(g.guests.map((x) => x.title)).toEqual(['Alice'])
    expect(g.guests[0]!.entries.map((e) => e.name).sort()).toEqual(['name', 'score', 'suspicion'])
    expect(g.cast[0]).toMatchObject({ key: 'TheAdmin', entries: [{ name: 'captures', value: '2' }] })
    expect(g.world.map((x) => x.key).sort()).toEqual(['Mods', 'Party'])
  })

  it('hides bareword identity seeds but keeps real top-level globals', () => {
    const g = groupWorld(entries, roster, cast, factions, locations)
    expect(g.world.find((x) => x.key === 'Mods')!.entries).toEqual([{ name: 'hidden', value: 'false', path: 'Mods.hidden' }])
  })

  it('filters across path and value, dropping empty groups', () => {
    const g = groupWorld(entries, roster, cast, factions, locations, 'suspicion')
    expect(g.clock).toBeNull()
    expect(g.globals).toBeNull()
    expect(g.guests).toHaveLength(1)
    expect(g.guests[0]!.entries).toEqual([{ name: 'suspicion', value: '7', path: 'g-1.suspicion' }])
    expect(g.cast).toHaveLength(0)
  })
})

describe('entityVars', () => {
  it('lists an entity’s variables minus the standard fields', () => {
    expect(entityVars(entries, 'g-1', new Set(GUEST_STANDARD_FIELDS))).toEqual([{ name: 'suspicion', value: '7', path: 'g-1.suspicion' }])
  })
})
