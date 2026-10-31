import { describe, expect, it } from 'vitest'
import type { InteractionSummary } from '@loom/core/views'
import { cueRows, cueValueArgs, filterCues, nightPhase, splitCode } from '@loom/core/cue-sheet'
import { NO_CUES } from '@/store/cockpit'

const ix = (id: string, label: string, who: InteractionSummary['who'] = 'admin'): InteractionSummary => ({ id, label, who, description: null })

const interactions: InteractionSummary[] = [
  ix('call_to_the_desktop', 'C1/V1 · 📣 Call everyone to the Desktop'),
  ix('accuse', '👁 Put on the watchlist', 'performer'),
  ix('start_the_bingo', 'V2 · 🎱 Start Computer Bingo (20 min)'),
  ix('introduce_trabolta', 'Clippy 2/X · 🤖 Trabolta comes online'),
  ix('truth_or_dare', '🎩 Truth or Dare from the hat'),
  ix('telephone', '(Optional) ☎️ Telephone: a mangled message · sends someone away'),
]

describe('splitCode', () => {
  it('splits a short leading code off the label', () => {
    expect(splitCode('C1/V1 · 📣 Call everyone')).toEqual({ code: 'C1/V1', title: '📣 Call everyone' })
    expect(splitCode('Clippy 2/X · 🤖 Intro')).toEqual({ code: 'Clippy 2/X', title: '🤖 Intro' })
  })
  it('leaves a codeless label whole, even with a later separator', () => {
    expect(splitCode('🎩 Truth or Dare')).toEqual({ code: null, title: '🎩 Truth or Dare' })
    expect(splitCode('(Optional) ☎️ Telephone: a mangled message · x').code).toBeNull()
  })
})

describe('cueRows', () => {
  it('lists only admin cues, in declared order, numbered', () => {
    const rows = cueRows(interactions, NO_CUES)
    expect(rows.map((r) => r.id)).toEqual(['call_to_the_desktop', 'start_the_bingo', 'introduce_trabolta', 'truth_or_dare', 'telephone'])
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3, 4, 5])
    expect(rows.map((r) => r.code)).toEqual(['C1/V1', 'V2', 'Clippy 2/X', null, null])
  })

  it('suggests the first cue before anything has fired', () => {
    const rows = cueRows(interactions, NO_CUES)
    expect(rows.filter((r) => r.next).map((r) => r.id)).toEqual(['call_to_the_desktop'])
    expect(rows.some((r) => r.last || r.fired)).toBe(false)
  })

  it('marks the last cue, the fired ones, and the next in order', () => {
    const rows = cueRows(interactions, { last: 'start_the_bingo', lastBy: 'director', fired: ['call_to_the_desktop', 'start_the_bingo'] })
    expect(rows.find((r) => r.last)!.id).toBe('start_the_bingo')
    expect(rows.find((r) => r.next)!.id).toBe('introduce_trabolta')
    expect(rows.filter((r) => r.fired).map((r) => r.id)).toEqual(['call_to_the_desktop', 'start_the_bingo'])
  })

  it('never suggests an off-sequence cue (machine-fired / hardware fallback) as NEXT', () => {
    const withDuck: InteractionSummary[] = [
      ix('start_the_bingo', 'V2 · 🎱 Start Computer Bingo'),
      { ...ix('printer_opened', '🫘 Printer opened (hardware fallback)'), sequence: false },
      ix('introduce_trabolta', 'Clippy 2/X · 🤖 Trabolta comes online'),
      { ...ix('the golden duck', 'Reinstallation: the golden duck (server)'), sequence: false },
    ]
    const rows = cueRows(withDuck, { last: 'start_the_bingo', lastBy: 'director', fired: ['start_the_bingo', 'the golden duck'] })
    expect(rows.find((r) => r.next)!.id).toBe('introduce_trabolta')
    expect(rows.find((r) => r.id === 'the golden duck')).toMatchObject({ fired: true, sequence: false, last: false })
    expect(cueRows(withDuck, { last: 'introduce_trabolta', lastBy: 'director', fired: [] }).some((r) => r.next)).toBe(false)
  })

  it('suggests nothing after the final cue', () => {
    const rows = cueRows(interactions, { last: 'telephone', lastBy: 'director', fired: ['telephone'] })
    expect(rows.some((r) => r.next)).toBe(false)
  })
})

describe('filterCues', () => {
  const rows = cueRows(interactions, NO_CUES)
  it('matches code, label and id, every word', () => {
    expect(filterCues(rows, 'v2').map((r) => r.id)).toEqual(['start_the_bingo'])
    expect(filterCues(rows, 'clippy trabolta').map((r) => r.id)).toEqual(['introduce_trabolta'])
    expect(filterCues(rows, 'truth_or').map((r) => r.id)).toEqual(['truth_or_dare'])
    expect(filterCues(rows, '  ')).toHaveLength(5)
  })
})

describe('nightPhase', () => {
  it('reads Night.phase off the world, quotes stripped', () => {
    expect(nightPhase([{ path: 'Night.phase', value: '"hunt_1"' }])).toBe('hunt_1')
    expect(nightPhase([{ path: 'Night.other', value: '1' }])).toBeNull()
    expect(nightPhase([{ path: 'Night.phase', value: 'null' }])).toBeNull()
  })
})

describe('person cues (K-25 awards)', () => {
  it('marks a cue that needs a winner, and only that one', () => {
    const rows = cueRows(
      [
        ix('start_the_ceremony', 'G1 · 🏆 Start the awards ceremony'),
        { ...ix('award_most_trusted', 'G2 · 🥇 Award: Most Trusted'), subject: true },
      ],
      NO_CUES,
    )
    expect(rows.map((r) => [r.id, r.subject])).toEqual([
      ['start_the_ceremony', false],
      ['award_most_trusted', true],
    ])
    expect(rows[1]!.code).toBe('G2')
  })

  it('turns the value box into the event arguments', () => {
    expect(cueValueArgs('')).toBeNull()
    expect(cueValueArgs('   ')).toBeNull()
    expect(cueValueArgs('3')).toEqual({ value: 3 })
    expect(cueValueArgs('-12')).toEqual({ value: -12 })
    expect(cueValueArgs(' 2:41 ')).toEqual({ value: '2:41' })
  })
})
