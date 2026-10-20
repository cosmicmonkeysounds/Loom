// The Inspector's objectives (wave 13): the exact lens's `objectives` as rows.

import { describe, expect, it } from 'vitest'
import type { ObjectiveView } from '@loom/core/views'
import { CheckState, objectiveButtonLabels, objectiveRows } from './objectives'

const obj = (id: string, extra: Partial<ObjectiveView> = {}): ObjectiveView => ({ id, title: id, brief: '', checklist: [], buttons: [], act: null, ...extra })

describe('objectiveRows', () => {
  it('an older server sends none: no rows', () => {
    expect(objectiveRows(undefined)).toEqual([])
    expect(objectiveRows([])).toEqual([])
  })

  it('the first objective is NOW; model order is kept', () => {
    const rows = objectiveRows([obj('Clear the door'), obj('Watch the bar')])
    expect(rows.map((r) => [r.id, r.now])).toEqual([
      ['Clear the door', true],
      ['Watch the bar', false],
    ])
  })

  it('checks read done / open / to-do; progress counts only the ones with a condition', () => {
    const [row] = objectiveRows([
      obj('Hunt', {
        act: 'C',
        brief: 'Find the facts.',
        loud: true,
        buttons: ['scan', 'vouch'],
        checklist: [
          { label: 'Scan every arrival', done: true },
          { label: 'File a fact', done: false },
          { label: 'Say hello', done: null },
        ],
      }),
    ])
    expect(row!.checks.map((c) => c.state)).toEqual([CheckState.Done, CheckState.Open, CheckState.Todo])
    expect(row!.checks.map((c) => c.glyph)).toEqual(['☑', '☐', '·'])
    expect(row!.progress).toBe('1 of 2')
    expect(row).toMatchObject({ act: 'C', brief: 'Find the facts.', loud: true, buttons: ['scan', 'vouch'] })
  })

  it('a checklist of to-dos has no progress', () => {
    expect(objectiveRows([obj('x', { checklist: [{ label: 'a', done: null }] })])[0]!.progress).toBeNull()
  })
})

describe('objectiveButtonLabels', () => {
  it('names the built-ins, the interactions by label, and falls back to the id', () => {
    expect(objectiveButtonLabels(['scan', 'pass', 'vouch', 'gone'], [{ id: 'vouch', label: '🤝 Vouch' }])).toEqual(['📷 Scan', '🎟 Pass', '🤝 Vouch', 'gone'])
  })
})
