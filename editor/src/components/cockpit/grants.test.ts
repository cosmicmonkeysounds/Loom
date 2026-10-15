// The Inspector's codex + quest grants (S4): which entries a guest can still
// be handed, and which quest steps would do something — the same rule the
// engine applies (start only a new quest; update / complete / fail only an
// active one; a settled quest takes nothing).

import { describe, expect, it } from 'vitest'
import type { CodexSummary, QuestSummary } from '@loom/core/views'
import { QuestAction } from '@/store/cockpit'
import {
  codexGrantOptions,
  codexHeldCount,
  codexOptionLabel,
  questActionNeedsText,
  questActions,
  questRows,
  questStatusLabel,
} from './grants'

const entry = (id: string, holders: string[], about: string | null = null): CodexSummary => ({
  id,
  title: id,
  about,
  text: '',
  code: null,
  holders,
})

const quest = (id: string, status: QuestSummary['status']): QuestSummary => ({ id, title: id, giver: null, status })

describe('codex grants', () => {
  const codex = [entry('The Sandy File', ['g1']), entry('The Y2K Clock', [], 'Trabolta'), entry('The Cold Lock', ['g2', 'Clippy'])]

  it('offers only what the holder lacks, in declared order', () => {
    expect(codexGrantOptions(codex, 'g1').map((e) => e.id)).toEqual(['The Y2K Clock', 'The Cold Lock'])
    expect(codexGrantOptions(codex, 'g3').map((e) => e.id)).toEqual(['The Sandy File', 'The Y2K Clock', 'The Cold Lock'])
    expect(codexHeldCount(codex, 'g2')).toBe(1)
    expect(codexHeldCount(codex, 'g3')).toBe(0)
  })

  it('labels an entry with whom it is about', () => {
    expect(codexOptionLabel(codex[0]!)).toBe('The Sandy File')
    expect(codexOptionLabel(codex[1]!)).toBe('The Y2K Clock · about Trabolta')
  })
})

describe('quest steps', () => {
  it('follows the engine: start a new one, step an active one, leave a settled one', () => {
    expect(questActions(null)).toEqual([QuestAction.Start])
    expect(questActions('active')).toEqual([QuestAction.Update, QuestAction.Complete, QuestAction.Fail])
    expect(questActions('done')).toEqual([])
    expect(questActions('failed')).toEqual([])
  })

  it('lists handed-out quests first, then the rest, each with its status', () => {
    const rows = questRows(
      [quest('Orientation', { g1: 'done' }), quest('The Hunt', {}), quest('Unplug', { g1: 'active', g2: 'failed' })],
      'g1',
    )
    expect(rows.map((r) => [r.id, r.status, r.actions])).toEqual([
      ['Orientation', 'done', []],
      ['Unplug', 'active', ['update', 'complete', 'fail']],
      ['The Hunt', null, ['start']],
    ])
    expect(rows.map((r) => questStatusLabel(r.status))).toEqual(['✓ done', 'active', 'not given'])
  })

  it('only an update insists on a line', () => {
    expect(questActionNeedsText(QuestAction.Update)).toBe(true)
    expect([QuestAction.Start, QuestAction.Complete, QuestAction.Fail].some(questActionNeedsText)).toBe(false)
  })
})
