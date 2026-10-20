// Wave 13 on the local backend: a performer lens is the booth's own
// PrimeView — no admin cues, its live OBJECTIVEs — and a scan's readout
// lands in the character's Inbox (`dm:<Character>`, `@<Character>`, about
// the guest), so the cockpit's guest thread and the Inspector read it off
// the feed.

import { beforeEach, describe, expect, it } from 'vitest'
import { lspWorkspaceSync, uriFor } from '@/lib/lsp-client'
import { useSim } from '@/store/sim'
import { RunMode } from '@/store/cockpit'
import { buildRooms, performerActions, roomMessages, LensKind } from '@/components/cockpit/rooms'

const MAIN = `entry: opening

ROLE Guest
  score: 0 to 100 = 0

CHARACTER Greeter
  on scan guest
    <set: guest.score += 5>
    reply Ticket checked.

CHARACTER Rival
  on scan guest
    reply Rival here.

CHARACTER Host
  admin: true
  on scan guest
    reply Welcome.

INTERACTION wave_in
  label: 👋 Wave in
  who: performer

INTERACTION patch
  label: 🔌 Patch
  who: performer
  by: Rival

INTERACTION power_on
  label: ⚡ Power on
  who: admin

OBJECTIVE door_duty
  for: Greeter
  title: Work the door
  text:
    Scan everyone who arrives.
    - Scan a guest, done when Greeter.scans >= 1
    - Smile
  buttons: wave_in, scan

OBJECTIVE floor
  for: Host
  title: Run the floor
  text:
    Keep things moving.
  buttons: wave_in, patch

== opening
  The lights dim.
`

describe('wave 13: the performer lens on a folder run', () => {
  beforeEach(async () => {
    await useSim.getState().end()
    lspWorkspaceSync().reset()
    lspWorkspaceSync().updateMany([[uriFor('main.loom'), MAIN]])
    await useSim.getState().startRun(RunMode.Rehearsal)
  })

  it("the booth's lens has no admin cues; the mod snapshot still does (the Director page's)", () => {
    expect(useSim.getState().interactions.map((i) => i.id).sort()).toEqual(['patch', 'power_on', 'wave_in'])
    useSim.getState().setPerspective('Greeter')
    const lens = useSim.getState().lens
    expect(lens?.kind).toBe('performer')
    if (lens?.kind !== 'performer') return
    expect(lens.view.interactions.map((i) => i.id).sort()).toEqual(['patch', 'wave_in'])
    expect(performerActions(lens, 'Greeter', useSim.getState().interactions).map((i) => i.id)).toEqual(['wave_in'])
  })

  it("another character's by: button: the view keeps it flagged, the lens never offers it", () => {
    useSim.getState().setPerspective('Greeter')
    const lens = useSim.getState().lens
    if (lens?.kind !== 'performer') throw new Error('no performer lens')
    expect(lens.host).toBe(false)
    expect(lens.view.interactions.find((i) => i.id === 'patch')).toMatchObject({ only: true, actors: ['Rival'] })
    expect(performerActions(lens, 'Greeter', useSim.getState().interactions).map((i) => i.id)).toEqual(['wave_in'])
    // The character it is for gets it, resolved or not.
    useSim.getState().setPerspective('Rival')
    const rival = useSim.getState().lens
    expect(performerActions(rival, 'Rival', useSim.getState().interactions).map((i) => i.id).sort()).toEqual(['patch', 'wave_in'])
    expect(performerActions(null, 'Rival', useSim.getState().interactions).map((i) => i.id).sort()).toEqual(['patch', 'wave_in'])
  })

  it("a host part's lens is the host booth's: its objectives keep another character's by: button", () => {
    useSim.getState().setPerspective('Host')
    const lens = useSim.getState().lens
    if (lens?.kind !== 'performer') throw new Error('no performer lens')
    expect(lens.host).toBe(true)
    expect(lens.view.objectives?.find((o) => o.id === 'floor')?.buttons).toEqual(['wave_in', 'patch'])
    expect(performerActions(lens, 'Host', useSim.getState().interactions).map((i) => i.id).sort()).toEqual(['patch', 'wave_in'])
    // An ordinary booth's objective with the same buttons would drop it.
    useSim.getState().setPerspective('Greeter')
    const greeter = useSim.getState().lens
    if (greeter?.kind !== 'performer') throw new Error('no performer lens')
    expect(greeter.view.objectives?.map((o) => o.id)).toEqual(['door_duty'])
  })

  it("the booth's lens carries its live objectives", () => {
    useSim.getState().setPerspective('Greeter')
    const lens = useSim.getState().lens
    if (lens?.kind !== 'performer') throw new Error('no performer lens')
    expect(lens.view.objectives?.map((o) => [o.id, o.title])).toEqual([['door_duty', 'Work the door']])
    expect(lens.view.objectives?.[0]?.checklist.map((c) => c.label)).toEqual(['Scan a guest', 'Smile'])
  })

  it("a scan's readout lands in the Inbox, about the guest, and in that guest's thread", async () => {
    await useSim.getState().scanAs('Greeter', 'p1')
    const readouts = useSim.getState().messages.filter((m) => m.readout === true)
    expect(readouts.map((m) => [m.channel, m.audience, m.about, m.text])).toEqual([['dm:Greeter', ['@Greeter'], 'p1', 'Ticket checked.']])
    useSim.getState().setPerspective('Greeter')
    const s = useSim.getState()
    const rooms = buildRooms({ channels: s.channels, messages: s.messages, roster: s.roster, factions: s.factions, cast: s.cast, perspective: 'Greeter', lens: s.lens })
    const thread = rooms.find((r) => r.key === 'guest:p1')
    expect(roomMessages(thread, 'guest:p1', s.messages, 'Greeter', LensKind.Performer).some((m) => m.readout === true)).toBe(true)
  })
})
