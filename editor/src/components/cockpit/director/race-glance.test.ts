// Wave 18b: the glance's People section in faction mode draws one race —
// every faction, founded or declared, against the line of the programs
// present — and says "over the line", never "won".

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { create } from 'zustand'
import { CockpitContext, nullCockpit, type CockpitState, type RosterRow } from '@/store/cockpit'
// `.tsx` spelled out: on a case-insensitive disk `./Glance` resolves to `glance.ts`.
import { GlanceColumn } from './Glance.tsx'

const guest = (id: string, name: string): RosterRow => ({ id, name, role: 'Program', faction: null, trueFaction: null, location: null, captured: false, score: 0 })

function render(state: Partial<CockpitState>): string {
  const store = create<CockpitState>(() => ({ ...nullCockpit.getState(), ...state }))
  return renderToStaticMarkup(createElement(CockpitContext.Provider, { value: store }, createElement(GlanceColumn, { watching: true })))
}

describe('the race on the glance', () => {
  const roster = [guest('g1', 'Winamp'), guest('g2', 'Excel'), guest('g3', 'Napster')]

  it('draws every race faction against race.needs, the leader marked over the line', () => {
    const html = render({
      roster,
      // A declared side the roster bars would count too: faction mode shows it once, in the race.
      factions: [{ id: 'Unlimited Power', hidden: false, revealed: true, members: ['g2'] }],
      race: {
        needs: 2,
        present: 3,
        winner: 'crew-1',
        factions: [
          { id: 'crew-1', name: 'The Pirates', kind: 'founded', founder: 'Winamp', present: 2 },
          { id: 'Unlimited Power', name: 'Unlimited Power', kind: 'side', founder: 'Excel', present: 1 },
        ],
      },
    })
    expect(html).toContain('data-testid="glance-race-crew-1"')
    expect(html).toContain('data-testid="glance-race-Unlimited Power"')
    expect(html).not.toContain('glance-faction-')
    expect(html).toContain('over the line')
    expect(html).not.toMatch(/\bwon\b/)
    expect(html).toContain('the line: 2 of 3 present')
    expect(html).toContain('founded by Winamp')
  })

  it('says so when no faction has formed yet', () => {
    const html = render({ roster, race: { needs: 2, present: 3, winner: null, factions: [] } })
    expect(html).toContain('No faction yet')
  })

  it('keeps the roster bars outside faction mode', () => {
    const html = render({ roster, race: null, factions: [{ id: 'Unlimited Power', hidden: false, revealed: true, members: ['g2'] }] })
    expect(html).toContain('glance-faction-Unlimited Power')
    expect(html).not.toContain('glance-race-')
  })
})
