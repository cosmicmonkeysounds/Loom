// Recheck item 7: Run → Players' "Seat the cast" (and its + Performer… menu)
// opens a booth only for the parts a performer can sign in to — never a
// `playable: false` prop (the show's Night), an agent-voiced character or a
// guest's program.

import { describe, expect, it } from 'vitest'
import { Sim } from '@loom/core/sim'
import { modView } from '@loom/core/views'
import { performerParts } from '@/store/players'

const SRC = `# Parts
start: Go

TRAIT Prop
  playable: false

CHARACTER Night is Prop
  phase: text = ""

CHARACTER Clippy
  when greet for guest:
    reply Hi.

CHARACTER Norton
  when scanned by guest:
    reply Clean.

CHARACTER Trabolta
  mind: external

CHARACTER WinZip

INTERACTION greet
  who: performer

== Go
Clippy: Welcome.
`

describe('performerParts', () => {
  it('keeps only the rows marked as parts', () => {
    expect(performerParts([{ id: 'A', part: true }, { id: 'B' }, { id: 'C', part: false }]).map((c) => c.id)).toEqual(['A'])
  })

  it("the mod view's cast: Clippy and Norton, never Night, Trabolta or a program", () => {
    const sim = Sim.fromSources(SRC)
    const cast = modView(sim, 'open', 'parts').cast
    expect(cast.map((c) => c.id)).toEqual(expect.arrayContaining(['Night', 'Clippy', 'Norton', 'Trabolta', 'WinZip']))
    expect(performerParts(cast).map((c) => c.id).sort()).toEqual(['Clippy', 'Norton'])
  })
})
