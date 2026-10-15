//! K-10: a project's passcodes are pinned — a relaunch after End reuses the
//! previous event's codes, so printed join / clue QRs keep working. The DB
//! half (`lastEventCodes` + the unique indexes) is in `db.test.ts`.

import { describe, expect, it } from 'vitest'

import { launchCodes } from '../server/events-api.ts'

const PREVIOUS = { event: 'EVT123', prime: 'PRM456', mod: 'MOD789' }
let n = 0
const mint = () => ({ event: `NEW${++n}E`, prime: `NEW${n}P`, mod: `NEW${n}M` })

describe('launchCodes', () => {
  it('reuses the previous event codes on the first attempt', () => {
    const codes = launchCodes(PREVIOUS, 0, mint)
    expect(codes).toEqual(PREVIOUS)
    expect(codes).not.toBe(PREVIOUS)
  })

  it('mints fresh codes on a first-ever launch', () => {
    const codes = launchCodes(null, 0, mint)
    expect(codes.event).toMatch(/^NEW/)
  })

  it('falls back to fresh codes when the pinned set collided', () => {
    const codes = launchCodes(PREVIOUS, 1, mint)
    expect(codes.event).not.toBe(PREVIOUS.event)
    expect(codes.prime).not.toBe(PREVIOUS.prime)
  })

  it('mints real passcodes by default', () => {
    const a = launchCodes(null, 0)
    const b = launchCodes(null, 0)
    expect(a.event).not.toBe(b.event)
    expect(new Set([a.event, a.prime, a.mod]).size).toBe(3)
  })
})
