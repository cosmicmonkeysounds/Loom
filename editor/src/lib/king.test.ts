import { describe, expect, it } from 'vitest'
import { KingReadOrder, kingConfirm, kingFill, kingFromScreen, kingFromWire, kingHpText, kingStatusLine, parseKingHp } from './king'

describe('the shared King (wave 11 C2)', () => {
  it('reads the screen state king, and no King off an older server or a map without one', () => {
    expect(kingFromScreen({ king: { hp: 12, max: 15, fallen: false, armed: true } })).toEqual({ hp: 12, max: 15, fallen: false, armed: true })
    expect(kingFromScreen({ king: null })).toBeNull()
    expect(kingFromScreen({ night: {}, cues: {} })).toBeNull()
    expect(kingFromScreen(null)).toBeNull()
    expect(kingFromScreen({ king: { hp: '3', max: 15 } })).toBeNull()
    expect(kingFromScreen({ king: { hp: 3, max: 0 } })).toBeNull()
  })

  it('reads the route answer (a KingState, no armed), clamps, and calls 0 fallen', () => {
    expect(kingFromWire({ id: 'cold-lock-king', hp: 0, max: 15, fallen: true })).toEqual({ hp: 0, max: 15, fallen: true, armed: null })
    expect(kingFromWire({ id: 'k', hp: -2, max: 15, fallen: false })).toEqual({ hp: 0, max: 15, fallen: true, armed: null })
    expect(kingFromWire({ id: 'k', hp: 40, max: 15, fallen: false })!.hp).toBe(15)
  })

  it('reads n / max and fills the bar', () => {
    const k = { hp: 9, max: 15, fallen: false, armed: true }
    expect(kingHpText(k)).toBe('9 / 15')
    expect(kingFill(k)).toBeCloseTo(0.6)
    expect(kingFill({ ...k, hp: 0 })).toBe(0)
  })

  it('takes only a whole number 0..max for Set…', () => {
    expect(parseKingHp(' 7 ', 15)).toBe(7)
    expect(parseKingHp('0', 15)).toBe(0)
    expect(parseKingHp('15', 15)).toBe(15)
    expect(parseKingHp('16', 15)).toBeNull()
    expect(parseKingHp('-1', 15)).toBeNull()
    expect(parseKingHp('7.5', 15)).toBeNull()
    expect(parseKingHp('', 15)).toBeNull()
    expect(parseKingHp('seven', 15)).toBeNull()
  })

  it('says what the bar means — kneeling, hits so far, not armed — and never hints at play', () => {
    expect(kingStatusLine({ hp: 0, max: 15, fallen: true, armed: true })).toMatch(/Kneeling/)
    expect(kingStatusLine({ hp: 15, max: 15, fallen: false, armed: true })).toMatch(/Full health/)
    expect(kingStatusLine({ hp: 14, max: 15, fallen: false, armed: true })).toMatch(/1 hit so far/)
    expect(kingStatusLine({ hp: 10, max: 15, fallen: false, armed: false })).toMatch(/does not count/)
  })

  it('confirms a restore, a fell and a stand-up in their own words', () => {
    const k = { hp: 3, max: 15, fallen: false, armed: true }
    expect(kingConfirm(k, 15).title).toMatch(/Restore the King to full health \(15\)/)
    expect(kingConfirm(k, 0).body).toMatch(/kneels/)
    expect(kingConfirm({ ...k, hp: 0, fallen: true }, 5).body).toMatch(/stands up/)
    expect(kingConfirm(k, 8).body).toMatch(/3 \/ 15 to 8 \/ 15/)
  })
})

describe('the King poll against a Set… / Restore', () => {
  it('drops a poll begun before a write was adopted; keeps one begun after', () => {
    const order = new KingReadOrder()
    const before = order.begin() // a poll in flight while the restore POST runs
    order.adopt() // the restore's answer lands: 8 / 8
    expect(order.fresh(before)).toBe(false) // its 3 / 8 reading would flash back
    const after = order.begin()
    expect(order.fresh(after)).toBe(true)
    // with no write, every poll counts
    const plain = new KingReadOrder()
    expect(plain.fresh(plain.begin())).toBe(true)
  })
})
