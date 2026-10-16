import { describe, expect, it } from 'vitest'
import {
  AWARD_SOURCES,
  awardSuggestion,
  fillAwards,
  nightEnded,
  pickWinner,
  suggestionHint,
  type AwardFields,
  type RecapRowWire,
  type RecapWire,
} from './award-suggest'

const row = (id: string, name: string, value: number, persona = false): RecapRowWire => ({ id, name, value, persona })

const recap: RecapWire = {
  ending: 'song',
  text: 'Most trusted (trust)\n1. Ada 82',
  lists: {
    // High → low, ties by name — the server's order.
    trust: [row('p1', 'Director', 99, true), row('g1', 'Ada', 82), row('g2', 'Bob', 82), row('g3', 'Cy', 40), row('g4', 'Dee', 10), row('g5', 'Eve', 10)],
    truths: [row('g1', 'Ada', 3)],
    lies: [row('g3', 'Cy', 0), row('g1', 'Ada', 0)],
    internetVisits: [row('g4', 'Dee', 4), row('g1', 'Ada', 1)],
    codex: [row('p1', 'Director', 40, true), row('g2', 'Bob', 12)],
    quests: [],
    truthcoin: [row('g5', 'Eve', 310)],
  },
  duck: [
    { id: 'p1', name: 'Director', ms: 30_000, time: '0:30', persona: true },
    { id: 'g3', name: 'Cy', ms: 83_400, time: '1:23', persona: false },
    { id: 'g1', name: 'Ada', ms: 83_400, time: '1:23', persona: false },
    { id: 'g2', name: 'Bob', ms: 99_000, time: '1:39', persona: false },
  ],
}

describe('awardSuggestion', () => {
  it('maps every ceremony award cue to a recap list', () => {
    expect(Object.keys(AWARD_SOURCES).sort()).toEqual([
      'award_best_liar',
      'award_duck_speedrun',
      'award_frequent_flyer',
      'award_least_trusted',
      'award_lore_hoarder',
      'award_most_trusted',
      'award_quest_completionist',
      'award_truthcoin_tycoon',
    ])
  })
  it('skips personas and lists ties at the top', () => {
    expect(awardSuggestion('award_most_trusted', recap)).toEqual({
      id: 'g1',
      name: 'Ada',
      value: '82',
      ties: [{ id: 'g2', name: 'Bob' }],
    })
    expect(awardSuggestion('award_lore_hoarder', recap)).toMatchObject({ id: 'g2', value: '12', ties: [] })
  })
  it('reads Least Trusted off the bottom of the trust list, ties included', () => {
    expect(awardSuggestion('award_least_trusted', recap)).toEqual({
      id: 'g4',
      name: 'Dee',
      value: '10',
      ties: [{ id: 'g5', name: 'Eve' }],
    })
  })
  it('suggests nobody for a count award where the top is 0, or an empty list', () => {
    expect(awardSuggestion('award_best_liar', recap)).toBeNull()
    expect(awardSuggestion('award_quest_completionist', recap)).toBeNull()
    expect(awardSuggestion('award_frequent_flyer', recap)).toMatchObject({ id: 'g4', value: '4' })
    expect(awardSuggestion('award_truthcoin_tycoon', recap)).toMatchObject({ id: 'g5', value: '310' })
  })
  it('reads the duck board as m:ss, skipping personas, with ties', () => {
    expect(awardSuggestion('award_duck_speedrun', recap)).toEqual({
      id: 'g3',
      name: 'Cy',
      value: '1:23',
      ties: [{ id: 'g1', name: 'Ada' }],
    })
    expect(awardSuggestion('award_duck_speedrun', { ...recap, duck: [] })).toBeNull()
    expect(awardSuggestion('award_duck_speedrun', { ...recap, duck: undefined })).toBeNull()
  })
  it('is null for a non-award cue, no recap, or a missing list', () => {
    expect(awardSuggestion('award_the_ribbon', recap)).toBeNull()
    expect(awardSuggestion('award_most_trusted', null)).toBeNull()
    expect(awardSuggestion('award_most_trusted', { ...recap, lists: {} })).toBeNull()
  })
  it('hints the winner, the value and the ties', () => {
    expect(suggestionHint(awardSuggestion('award_most_trusted', recap)!)).toBe('suggested: Ada (82) · tied: Bob')
    expect(suggestionHint(awardSuggestion('award_lore_hoarder', recap)!)).toBe('suggested: Bob (12)')
  })
})

describe('fillAwards', () => {
  const empty: AwardFields = { winners: {}, values: {}, auto: {} }
  const roster = new Set(['g1', 'g2', 'g3', 'g4', 'g5'])
  const s1 = { award_most_trusted: awardSuggestion('award_most_trusted', recap), award_best_liar: null }

  it('fills empty pickers and value boxes', () => {
    const f = fillAwards(empty, s1, roster)
    expect(f.winners).toEqual({ award_most_trusted: 'g1' })
    expect(f.values).toEqual({ award_most_trusted: '82' })
    expect(f.auto).toEqual({ award_most_trusted: { winner: 'g1', value: '82' } })
  })
  it('never overwrites a winner the director picked (nor its value)', () => {
    const mine: AwardFields = { winners: { award_most_trusted: 'g3' }, values: {}, auto: {} }
    expect(fillAwards(mine, s1, roster)).toEqual(mine)
  })
  it('keeps a typed value but still fills an empty picker', () => {
    const typed: AwardFields = { winners: {}, values: { award_most_trusted: '90' }, auto: {} }
    const f = fillAwards(typed, s1, roster)
    expect(f.winners.award_most_trusted).toBe('g1')
    expect(f.values.award_most_trusted).toBe('90')
  })
  it('a refresh replaces its own earlier guess, not an edit', () => {
    const first = fillAwards(empty, s1, roster)
    const later = { award_most_trusted: { id: 'g2', name: 'Bob', value: '95', ties: [] } }
    expect(fillAwards(first, later, roster).winners.award_most_trusted).toBe('g2')
    expect(fillAwards(first, later, roster).values.award_most_trusted).toBe('95')
    const edited = { ...first, values: { award_most_trusted: '70' } }
    const f = fillAwards(edited, later, roster)
    expect(f.winners.award_most_trusted).toBe('g2')
    expect(f.values.award_most_trusted).toBe('70')
  })
  it('a director picking another winner clears the suggested winner\'s number', () => {
    const first = fillAwards(empty, s1, roster)
    const bob = pickWinner(first, 'award_most_trusted', 'g2')
    expect(bob.winners.award_most_trusted).toBe('g2')
    expect(bob.values.award_most_trusted).toBeUndefined()
    expect(bob.auto.award_most_trusted).toBeUndefined()
    // …and the row is the director's now: a refresh leaves it alone
    expect(fillAwards(bob, s1, roster)).toEqual(bob)
    // a value the director typed survives the pick
    const typed = { ...first, values: { award_most_trusted: '70' } }
    expect(pickWinner(typed, 'award_most_trusted', 'g2').values.award_most_trusted).toBe('70')
    // re-picking the suggestion keeps everything
    expect(pickWinner(first, 'award_most_trusted', 'g1')).toEqual(first)
  })
  it('skips a winner the roster does not list', () => {
    expect(fillAwards(empty, s1, new Set(['g2']))).toEqual(empty)
  })
})

describe('nightEnded', () => {
  it('reads Night.ended', () => {
    expect(nightEnded([{ path: 'Night.ended', value: 'true' }])).toBe(true)
    expect(nightEnded([{ path: 'Night.ended', value: 'false' }])).toBe(false)
    expect(nightEnded([])).toBe(false)
  })
})
