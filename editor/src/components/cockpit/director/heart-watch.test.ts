// Wave 20 (§3.10): the story's new `watch:` lines for Trabolta's heart read
// on the Director glance with no glance change — the stage and the door as
// text, the override as a bool, the talker's values only while the stage is
// `talk` (a `while:`-gated line, so they lead the board while it holds).
// Driven through the local run store against a real in-memory project.

import { beforeEach, describe, expect, it } from 'vitest'
import { lspWorkspaceSync, uriFor } from '@/lib/lsp-client'
import { useSim } from '@/store/sim'
import { RunMode } from '@/store/cockpit'
import { watchRows } from './glance'

const HEART = `watch: Night.heart_stage as The Heart, Night.server_door as Server door, Night.door_override as Door on buttons, program.at_the_heart as At the heart, while Night.awake == true and Night.ended != true
watch: Night.heart_talker as At his heart, Night.heart_talker_layer as Heart progress, Night.heart_talker_suspicion as Heart suspicion, while Night.heart_stage == "talk"

ROLE Program
  at_the_heart: bool = false

INTERACTION wake
  label: 🌅 Wake
  who: admin

INTERACTION talk
  label: 🫀 Talk
  who: admin

when wake:
  set Night.awake = true
  set Night.heart_stage = "door"
  set Night.server_door = "open"
  set Night.door_override = true

when talk:
  set Night.heart_stage = "talk"
  set Night.server_door = "closed"
  set Night.heart_talker = "Calculator"
  set Night.heart_talker_layer = 2
  set Night.heart_talker_suspicion = 35
`

const st = () => useSim.getState()
const board = () => watchRows(st().watch, st().world, st().roster, st().cast).map((r) => [r.label, r.kind === 'value' ? r.value.text : r.kind])

describe('the heart on the Director glance (wave 20, §3.10)', () => {
  beforeEach(async () => {
    await st().end()
    lspWorkspaceSync().reset()
    lspWorkspaceSync().updateMany([[uriFor('main.loom'), HEART]])
  })

  it('shows nothing before he wakes, then the stage, the door and the override, then the talker while talking', async () => {
    await st().startRun(RunMode.Rehearsal)
    expect(st().watchDeclared).toBe(true)
    expect(board()).toEqual([])

    await st().fireSignal('wake')
    const asleep = board()
    expect(asleep.map(([l]) => l)).toEqual(['The Heart', 'Server door', 'Door on buttons', 'At the heart'])
    expect(asleep[0]![1]).toMatch(/door/)
    expect(asleep[1]![1]).toMatch(/open/)
    expect(asleep[2]![1]).toBe('●') // a true bool's dot
    expect(asleep[3]![1]).toBe('role')

    await st().fireSignal('talk')
    const talking = board()
    expect(talking.map(([l]) => l)).toEqual(['The Heart', 'Server door', 'Door on buttons', 'At the heart', 'At his heart', 'Heart progress', 'Heart suspicion'])
    expect(Object.fromEntries(talking)).toMatchObject({ 'At his heart': expect.stringMatching(/Calculator/), 'Heart progress': '2', 'Heart suspicion': '35' })
  })
})
