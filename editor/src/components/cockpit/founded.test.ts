// Wave 18b: in faction mode a guest-founded faction is no declared side, so
// its members' roster rows read faction null. The cockpit joins
// `ModView.crews` onto the rows (`withFoundedFactions`) and the Roster,
// Stage and Inspector show ◇ its name instead of "unaligned".

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { withFoundedFactions, type RosterRow } from '@/store/cockpit'
import { FactionPill } from './ui'

const row = (id: string, faction: string | null = null): RosterRow => ({ id, name: id, role: 'guest', faction, trueFaction: faction, location: null, captured: false, score: 0 })
const CREWS = [{ id: 'crew-1', name: 'The Pirates', members: ['g1', 'g2'] }]

describe('founded factions on the roster', () => {
  it('joins each member to its founded faction in faction mode only', () => {
    const rows = [row('g1'), row('g2'), row('g3', 'Unlimited Power')]
    const joined = withFoundedFactions(rows, CREWS, true)
    expect(joined.map((r) => r.founded?.name ?? null)).toEqual(['The Pirates', 'The Pirates', null])
    // Outside faction mode a crew is a friends' club, not a faction.
    expect(withFoundedFactions(rows, CREWS, false)).toBe(rows)
    expect(withFoundedFactions(rows, undefined, true)).toBe(rows)
  })

  it('the pill reads ◇ the founded faction, never "unaligned"; a declared side wins', () => {
    const html = renderToStaticMarkup(createElement(FactionPill, { faction: null, founded: { name: 'The Pirates' } }))
    expect(html).toContain('◇ The Pirates')
    expect(html).not.toContain('unaligned')
    expect(renderToStaticMarkup(createElement(FactionPill, { faction: null, founded: null }))).toContain('unaligned')
    expect(renderToStaticMarkup(createElement(FactionPill, { faction: 'Unlimited Power', founded: { name: 'The Pirates' } }))).toContain('Unlimited Power')
  })
})
