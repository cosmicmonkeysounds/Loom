// Wave 18b's cockpit fields on the local backend, played on the Stage B
// fixture story (`core/test/fixtures/w18b-mini`): a roster row carries the
// story's `badge:` lines while they hold (🚻 Bathroom Mode), and a
// `founding:` story has a race (`ModView.race`) — empty while the declared
// sides are hidden, both sides with their head counts once they are revealed.

import { beforeEach, describe, expect, it } from 'vitest'
import MINI from '../../../core/test/fixtures/w18b-mini/main.loom?raw'
import { lspWorkspaceSync, uriFor } from '@/lib/lsp-client'
import { useSim } from '@/store/sim'
import { RunMode } from '@/store/cockpit'

describe('wave 18b cockpit fields (local run, the w18b-mini fixture)', () => {
  beforeEach(async () => {
    await useSim.getState().end()
    lspWorkspaceSync().reset()
    lspWorkspaceSync().updateMany([[uriFor('main.loom'), MINI]])
    await useSim.getState().startRun(RunMode.Rehearsal)
  })

  it('a roster row wears a badge only while its badge: line holds', async () => {
    const me = useSim.getState().roster[0]!
    expect(me.badges).toBeUndefined()
    await useSim.getState().fireSignal('bathroom', me.id)
    expect(useSim.getState().roster.find((r) => r.id === me.id)?.badges).toEqual([{ glyph: '🚻', label: 'Bathroom Mode' }])
    await useSim.getState().fireSignal('back', me.id)
    expect(useSim.getState().roster.find((r) => r.id === me.id)?.badges).toBeUndefined()
  })

  it('a founding: story carries the race; the sides join it once revealed', async () => {
    const race = useSim.getState().race
    expect(race).not.toBeNull()
    expect(race!.factions).toEqual([])
    // A Run persona never counts toward the race (`<id>.persona`).
    expect(race!.present).toBe(0)
    const me = useSim.getState().roster[0]!.id
    await useSim.getState().fireSignal('make_leaders', me)
    await useSim.getState().fireSignal('the_clock')
    const after = useSim.getState().race!
    expect(after.factions.map((f) => f.id).sort()).toEqual(['The Way Out', 'Unlimited Power'].sort())
    expect(after.factions.every((f) => f.kind === 'side')).toBe(true)
    expect(after.factions.find((f) => f.id === 'Unlimited Power')?.founder).not.toBeNull()
  })
})
