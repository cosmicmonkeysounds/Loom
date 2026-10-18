// The local run backend end-to-end against a real in-memory project: start
// (persona + entry beat + overlay + named-event enumeration + landing on
// Chat), choices resuming the story, the mod-command surface mapped onto
// the local engine (scan / setStat / fireSignal with an actor → composed
// messages), speaking as a persona (attributed), the lifecycle (restart
// keeps the snapshot, push draft recompiles, `stale` is live state, end
// keeps the run for export), and the identity lens.

import { beforeEach, describe, expect, it } from 'vitest'
import { lspWorkspaceSync, uriFor } from '@/lib/lsp-client'
import { useLspIndexGen } from '@/lib/lsp-index'
import { LOCAL_DIRECTOR, useSim } from '@/store/sim'
import { CockpitPhase, CockpitTab, GLOBAL_CHOICE_KEY, OPERATOR_LENS, QuestAction, RunBackend, RunMode } from '@/store/cockpit'
import { useGraph } from '@/store/graph'

const MAIN = `entry: opening

FACTION Mods
  ethos: order

LOCATION Party
  label: The Party

ROLE Guest
  score: 0 to 100 = 0

CHARACTER Greeter
  faction: Mods
  on lockdown
    <broadcast: lockdown_siren to faction(Mods)>
  on scan guest
    <set: guest.score += 5>
  when whisper for guest:
    set guest.score += 1

CHARACTER Bouncer
  faction: Mods
  when whisper for guest:
    set guest.score += 10

== opening
  The lights dim.
  GREETER
    Welcome, traveler.
  * Take the stairs
    -> stairs
  * Take the lift
    -> lift

== stairs
  You climb.

== lift
  You ride.
`

async function start(): Promise<void> {
  await useSim.getState().startRun(RunMode.Rehearsal)
}

describe('local run store', () => {
  beforeEach(async () => {
    await useSim.getState().end()
    lspWorkspaceSync().reset()
    lspWorkspaceSync().updateMany([[uriFor('main.loom'), MAIN]])
  })

  it('startRun(Rehearsal): a persona named after you, the entry beat, the overlay, named events, Chat', async () => {
    await start()
    const s = useSim.getState()
    expect(s.phase).toBe(CockpitPhase.Open)
    expect(s.run).toMatchObject({ backend: RunBackend.Local, mode: RunMode.Rehearsal, scratch: false, stale: false, codes: null })
    expect(s.run?.startedBy).toBe(LOCAL_DIRECTOR)
    expect(s.me).toBe(LOCAL_DIRECTOR)
    // One auto-persona named after the director, owned by this console.
    expect(s.personas).toEqual(['p1'])
    expect(s.roster.map((r) => [r.id, r.name, r.owner])).toEqual([['p1', LOCAL_DIRECTOR, LOCAL_DIRECTOR]])
    // The cockpit lands where the action is.
    expect(s.activeTab).toBe(CockpitTab.Chat)
    expect(s.activeChannel).toBe('lobby')
    // The model's authored events + interactions are enumerated for the director.
    expect(s.events).toEqual(['lockdown', 'whisper'])
    expect(s.beats).toContain('opening')
    // The entry beat fired → the story canvas overlay lights up.
    expect(useGraph.getState().runtime.visits['opening']).toBe(1)
    // Its menu suspended unbound → a global pending choice.
    expect(s.choices[GLOBAL_CHOICE_KEY]).toEqual(['Take the stairs', 'Take the lift'])
    // Un-addressed entry dialogue is stage voice: it lands in the lobby.
    const greet = s.messages.find((m) => m.from === 'Greeter')
    expect(greet).toMatchObject({ channel: 'lobby', audience: 'all' })
    const narration = s.messages.find((m) => m.kind === 'narration')
    expect(narration).toMatchObject({ from: 'Narrator', text: 'The lights dim.', channel: 'lobby', beat: 'opening' })
  })

  it('re-pair (N-02) and release (N-10) are server-only and say so', async () => {
    await start()
    expect(await useSim.getState().pairGuest(useSim.getState().personas[0]!)).toBeNull()
    expect(useSim.getState().error).toMatch(/event server/)
    expect(await useSim.getState().releasePart('Greeter')).toBeNull()
    expect(useSim.getState().error).toMatch(/event server/)
  })

  it('startRun(Live) is refused on a folder', async () => {
    await useSim.getState().startRun(RunMode.Live)
    expect(useSim.getState().run).toBeNull()
    expect(useSim.getState().error).toMatch(/server project/)
  })

  it('choose(): resumes the story and records the traversal', async () => {
    await start()
    await useSim.getState().choose(GLOBAL_CHOICE_KEY, 0)
    expect(useGraph.getState().runtime.visits['stairs']).toBe(1)
    expect(useGraph.getState().runtime.traversed['opening→stairs']).toBe(1)
    expect(useSim.getState().choices[GLOBAL_CHOICE_KEY]).toBeUndefined()
    expect(useSim.getState().log.some((l) => l.event.type === 'beatEntered')).toBe(true)
  })

  it("release / setStat captured:false are the story's release, like the server (W6 B3)", async () => {
    const jail = MAIN.replace(
      'ROLE Guest\n  score: 0 to 100 = 0\n',
      'LOCATION Jail\n  prison: true\n\nROLE Guest\n  score: 0 to 100 = 0\n  when released:\n    set guest.score += 7\n  when escape:\n    set guest.score += 50\n',
    )
    expect(jail).not.toBe(MAIN)
    lspWorkspaceSync().updateMany([[uriFor('main.loom'), jail]])
    await start()
    const released = () => useSim.getState().log.filter((l) => l.event.type === 'released').length
    await useSim.getState().capture('p1')
    expect(useSim.getState().roster[0]!.captured).toBe(true)
    await useSim.getState().release('p1')
    expect(useSim.getState().roster[0]).toMatchObject({ captured: false, score: 7, location: 'Party' })
    expect(released()).toBe(1)
    // The World browser's write takes the same path.
    await useSim.getState().capture('p1')
    await useSim.getState().setStat('p1', 'captured', false)
    expect(useSim.getState().roster[0]).toMatchObject({ captured: false, score: 14 })
    expect(released()).toBe(2)
    expect(useSim.getState().log.some((l) => l.event.type === 'escaped')).toBe(false)
  })

  it('mod-command surface maps onto the local engine', async () => {
    await start()
    // Scan as a character → its scan hook fires on the persona; readouts come back.
    const readouts = await useSim.getState().scanAs('Greeter', 'p1')
    expect(Array.isArray(readouts)).toBe(true)
    expect(useSim.getState().roster[0]!.score).toBe(5)
    // setStat routes faction → defect, location → arrive.
    await useSim.getState().setStat('p1', 'faction', 'Mods')
    expect(useSim.getState().roster[0]!.faction).toBe('Mods')
    await useSim.getState().setStat('p1', 'location', 'Party')
    expect(useSim.getState().roster[0]!.location).toBe('Party')
    // Firing the enumerated named event runs its hook → faction broadcast.
    await useSim.getState().fireSignal('lockdown')
    expect(useSim.getState().messages.some((m) => m.channel === 'faction:Mods')).toBe(true)
    // Typed chat lands in the lobby with a seq the hide toggle can target.
    await useSim.getState().say('lobby', 'mic check')
    const chat = useSim.getState().messages.find((m) => m.text === 'mic check')
    expect(chat).toBeDefined()
    expect(chat!.via).toBeUndefined() // the Operator's own voice
    await useSim.getState().hideMessage(chat!.seq, true)
    expect(useSim.getState().messages.find((m) => m.seq === chat!.seq)!.hidden).toBe(true)
  })

  it('setStat restricted marks and unmarks a guest, like /api/mod/set restricted', async () => {
    await start()
    const row = () => useSim.getState().roster[0]!
    expect(row().restricted).toBe(false)
    await useSim.getState().setStat('p1', 'restricted', true)
    expect(row().restricted).toBe(true)
    expect(useSim.getState().log.some((l) => l.event.type === 'restricted' && l.event.person === 'p1')).toBe(true)
    // Idempotent, then lifted.
    await useSim.getState().setStat('p1', 'restricted', 'true')
    expect(row().restricted).toBe(true)
    await useSim.getState().setStat('p1', 'restricted', false)
    expect(row().restricted).toBe(false)
    expect(useSim.getState().log.some((l) => l.event.type === 'unrestricted' && l.event.person === 'p1')).toBe(true)
  })

  it('fireSignal with an actor reaches only that character (the performer-lens path)', async () => {
    await start()
    const score = () => useSim.getState().roster[0]!.score
    await useSim.getState().fireSignal('whisper', 'p1', null, 'Greeter')
    expect(score()).toBe(1)
    await useSim.getState().fireSignal('whisper', 'p1', null, 'Bouncer')
    expect(score()).toBe(11)
    await useSim.getState().fireSignal('whisper', 'p1')
    expect(score()).toBe(22) // both listeners
  })

  it('narrative routes into the setting room; personas speak as themselves, attributed', async () => {
    lspWorkspaceSync().updateMany([[uriFor('main.loom'), MAIN.replace('== stairs\n', '== stairs\n  setting: Party\n')]])
    await start()
    await useSim.getState().choose(GLOBAL_CHOICE_KEY, 0)
    const climb = useSim.getState().messages.find((m) => m.text === 'You climb.')
    expect(climb).toMatchObject({ channel: 'loc:Party', from: 'Narrator', kind: 'narration', beat: 'stairs' })
    expect(useSim.getState().channels.some((c) => c.id === 'loc:Party' && c.kind === 'location')).toBe(true)
    // A persona speaks as themselves through the same journaled say path
    // the play app uses — the message carries their display name AND who
    // really typed it (never shown to guests).
    await useSim.getState().say('lobby', 'hi from me', 'p1')
    const line = useSim.getState().messages.find((m) => m.text === 'hi from me')
    expect(line?.from).toBe(LOCAL_DIRECTOR)
    expect(line?.via).toBe(LOCAL_DIRECTOR)
    // A persona can't post where the engine says they can't (not standing in the room).
    await useSim.getState().say('loc:Party', 'from afar', 'p1')
    expect(useSim.getState().messages.some((m) => m.text === 'from afar')).toBe(false)
    expect(useSim.getState().error).toMatch(/can't post here/)
    // An unknown speaker is a typo, not a voice.
    await useSim.getState().say('lobby', '?', 'Nobody')
    expect(useSim.getState().error).toMatch(/unknown speaker/)
  })

  it('the identity lens is the server projection of that participant', async () => {
    await start()
    expect(useSim.getState().perspective).toBe(OPERATOR_LENS)
    expect(useSim.getState().lens).toBeNull()
    useSim.getState().setPerspective('p1')
    const guest = useSim.getState().lens
    expect(guest?.kind).toBe('guest')
    expect(guest?.kind === 'guest' && guest.view.id).toBe('p1')
    // The lens follows the world: a scan gives the persona a pending choice? (no —
    // but their public faction reads through) and the projection refreshes.
    await useSim.getState().setStat('p1', 'faction', 'Mods')
    expect(useSim.getState().lens?.kind === 'guest' && useSim.getState().lens?.view.faction).toBe('Mods')
    useSim.getState().setPerspective('Greeter')
    const prime = useSim.getState().lens
    expect(prime?.kind).toBe('performer')
    expect(prime?.kind === 'performer' && prime.view.character).toBe('Greeter')
    expect(prime?.kind === 'performer' && prime.view.guests.map((g) => g.id)).toEqual(['p1'])
    // An unknown identity falls back to the Operator.
    useSim.getState().setPerspective('nobody')
    expect(useSim.getState().perspective).toBe(OPERATOR_LENS)
    expect(useSim.getState().lens).toBeNull()
  })

  it('restart() keeps the snapshot; pushDraft() recompiles; stale is live state; end() keeps the run', async () => {
    await start()
    const compiledAt = useSim.getState().compiledAt
    expect(compiledAt).toBe(lspWorkspaceSync().generation)
    expect(useSim.getState().run?.stale).toBe(false)

    // An edit lands in the index → the run is stale, instantly.
    lspWorkspaceSync().updateMany([[uriFor('main.loom'), MAIN.replace('The lights dim.', 'The lights flare.')]])
    useLspIndexGen.getState().bump()
    expect(useSim.getState().run?.stale).toBe(true)

    // Restart replays the SAME snapshot: still the old line, still stale.
    await useSim.getState().restart()
    expect(useSim.getState().messages.some((m) => m.text === 'The lights dim.')).toBe(true)
    expect(useSim.getState().compiledAt).toBe(compiledAt)
    expect(useSim.getState().run?.stale).toBe(true)
    expect(useSim.getState().personas).toEqual(['p1']) // your persona is back

    // Push draft picks the edit up and clears stale.
    await useSim.getState().pushDraft()
    expect(useSim.getState().messages.some((m) => m.text === 'The lights flare.')).toBe(true)
    expect(useSim.getState().compiledAt).toBe(lspWorkspaceSync().generation)
    expect(useSim.getState().run?.stale).toBe(false)

    // End clears the session but keeps the run for export.
    await useSim.getState().end()
    const s = useSim.getState()
    expect(s.run).toBeNull()
    expect(s.phase).toBe(CockpitPhase.Idle)
    expect(s.roster).toEqual([])
    expect(s.activeTab).toBe(CockpitTab.Run)
    expect(useGraph.getState().runtime.visits['opening']).toBeUndefined()
    expect(s.lastRun?.run.backend).toBe(RunBackend.Local)
    expect(s.lastRun?.endedBy).toBe(LOCAL_DIRECTOR)
    expect(s.lastRun?.log.length).toBeGreaterThan(0)
  })

  it('stale follows the Workspace generation, not the trigger counter', async () => {
    await start()
    // Trigger without an index change: nothing moved, so not stale.
    useLspIndexGen.getState().bump()
    useLspIndexGen.getState().bump()
    expect(useSim.getState().run?.stale).toBe(false)
    // A real index change, however the trigger counter lines up: stale.
    lspWorkspaceSync().updateMany([[uriFor('main.loom'), MAIN.replace('The lights dim.', 'The lights flare.')]])
    useLspIndexGen.getState().bump()
    expect(useSim.getState().run?.stale).toBe(true)
  })

  it('pause / resume flip the phase only', async () => {
    await start()
    await useSim.getState().pause()
    expect(useSim.getState().phase).toBe(CockpitPhase.Paused)
    expect(useSim.getState().run).not.toBeNull()
    await useSim.getState().resume()
    expect(useSim.getState().phase).toBe(CockpitPhase.Open)
  })

  it('a scratch run is flagged as such', async () => {
    await useSim.getState().startRun(RunMode.Rehearsal, { scratch: true })
    expect(useSim.getState().run?.scratch).toBe(true)
  })

  it('fireSignal returns refused for an out-of-turn cue', async () => {
    lspWorkspaceSync().updateMany([[uriFor('cues.loom'), CUES]])
    await start()
    const st = () => useSim.getState()
    // Out of turn: the rule only tells # hosts why — not taken, never LAST.
    expect(await st().fireSignal('last_call')).toEqual({ refused: true })
    expect(st().cues.last).toBeNull()
    expect(await st().fireSignal('open_doors')).toEqual({})
    expect(st().cues.last).toBe('open_doors')
    // In its turn the same cue is taken.
    expect(await st().fireSignal('last_call')).toEqual({})
    expect(st().cues.last).toBe('last_call')
    // The board and the clock ride the local snapshot like a server one.
    expect(st().watchDeclared).toBe(true)
    expect(st().watch.map((w) => w.label)).toEqual(['Step'])
    expect(st().storyClock).not.toBeNull()
    expect(st().channels.find((c) => c.id.includes('hosts'))?.staff).toBe(true)
  })

  it('grants a codex entry and steps a quest (S4), firing the story rules like the server routes', async () => {
    lspWorkspaceSync().updateMany([[uriFor('extras.loom'), GRANTS]])
    await start()
    const st = () => useSim.getState()
    expect(st().codex.map((e) => [e.id, e.holders])).toEqual([['The Sandy File', []]])
    expect(st().quests.map((q) => [q.id, q.status])).toEqual([['The Hunt', {}]])

    await st().grantCodex('p1', 'The Sandy File')
    expect(st().codex[0]!.holders).toEqual(['p1'])
    expect(st().roster[0]!.score).toBe(3) // its `learns` rule ran
    expect(st().messages.some((m) => m.kind === 'codex' && m.codex?.entry === 'The Sandy File')).toBe(true)

    await st().stepQuest('p1', 'The Hunt', QuestAction.Start, null)
    expect(st().quests[0]!.status).toEqual({ p1: 'active' })
    await st().stepQuest('p1', 'The Hunt', QuestAction.Update, '  One down.  ')
    expect(st().messages.some((m) => m.kind === 'quest' && m.text.includes('One down.'))).toBe(true)
    await st().stepQuest('p1', 'The Hunt', QuestAction.Complete)
    expect(st().quests[0]!.status).toEqual({ p1: 'done' })
    expect(st().roster[0]!.score).toBe(13) // `when guest completes quest` ran
    // A settled quest never restarts; an unknown guest is refused.
    await st().stepQuest('p1', 'The Hunt', QuestAction.Start)
    expect(st().quests[0]!.status).toEqual({ p1: 'done' })
    await st().stepQuest('nobody', 'The Hunt', QuestAction.Start)
    expect(st().error).toMatch(/unknown guest/)
    await st().grantCodex('nobody', 'The Sandy File')
    expect(st().error).toMatch(/unknown holder/)
  })
})

const GRANTS = `CODEX The Sandy File
  text: She kept the receipts.

QUEST The Hunt
  text: Find three facts.

when guest learns The Sandy File:
  set guest.score += 3

when guest completes quest The Hunt:
  set guest.score += 10
`

const CUES = `watch: Night.step as Step

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

INTERACTION open_doors
  label: A1 · 🚪 Open the doors
  who: admin
  act: A · Doors

INTERACTION last_call
  label: B1 · 🔔 Last call
  who: admin
  act: B · Close

when open_doors:
  set Night.step = 1

when last_call:
  if Night.step == 1:
    set Night.step = 2
  else:
    broadcast "🔔 Not yet: open the doors first." to channel(hosts)
`
