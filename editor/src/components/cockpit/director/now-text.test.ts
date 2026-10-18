import { describe, expect, it } from 'vitest'
import { cueRows } from '@loom/core/cue-sheet'
import { nothingToPress, rowName, shortName } from './now-text'

const rows = cueRows(
  [
    { id: 'bingo', label: 'V3 · ⏰ Bingo time (auto at 15 min)', who: 'admin' },
    { id: 'close', label: '⏱ Close round-one filings', who: 'admin' },
  ],
  { last: 'bingo', fired: ['bingo'] },
)

describe('the NOW card names', () => {
  it('never prints a codeless cue\'s number twice', () => {
    // The card puts `{n}` in front: `8 ⏱ Close…`, never `8 8 ⏱ Close…`.
    expect(rowName(rows[1]!)).toBe('⏱ Close round-one filings')
    expect(rowName(rows[0]!)).toBe('V3 ⏰ Bingo time')
    // Watching's one line has no number column: the number stands in.
    expect(shortName(rows[1]!)).toBe('2 ⏱ Close round-one filings')
    expect(shortName(rows[0]!)).toBe('V3 ⏰ Bingo time')
  })

  it('says the running order is done once nothing is left after LAST', () => {
    const [bingo, close] = rows
    expect(nothingToPress({ last: bingo!, after: close!, countdowns: 0 })).toBe('NEXT — nothing to press. The story runs.')
    expect(nothingToPress({ last: bingo!, after: null, countdowns: 1 })).toBe('NEXT — nothing to press. The story runs.')
    expect(nothingToPress({ last: bingo!, after: null, countdowns: 0 })).toBe('NEXT — nothing left: the running order is done.')
    expect(nothingToPress({ last: null, after: null, countdowns: 0, paused: true })).toMatch(/clock is stopped/u)
  })
})
