//! K-10: a project's passcodes are pinned — a relaunch after End reuses the
//! previous event's codes, so printed join / clue QRs keep working. The DB
//! half (`lastEventCodes` + the unique indexes) is in `db.test.ts`.

import { describe, expect, it } from 'vitest'

import { insertWithCodes, launchCodes, parseRotation } from '../server/events-api.ts'

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

describe('launchCodes · rotate (a leaked code)', () => {
  it('"staff" keeps the guest code and mints fresh performer + mod codes', () => {
    const codes = launchCodes(PREVIOUS, 0, mint, 'staff')
    expect(codes.event).toBe(PREVIOUS.event)
    expect(codes.prime).not.toBe(PREVIOUS.prime)
    expect(codes.mod).not.toBe(PREVIOUS.mod)
  })

  it('"all" mints three fresh codes', () => {
    const codes = launchCodes(PREVIOUS, 0, mint, 'all')
    expect([codes.event, codes.prime, codes.mod]).not.toContain(PREVIOUS.event)
    expect(codes.prime).not.toBe(PREVIOUS.prime)
  })

  it('parses the launch body flag', () => {
    expect(parseRotation(true)).toBe('all')
    expect(parseRotation('all')).toBe('all')
    expect(parseRotation('staff')).toBe('staff')
    expect(parseRotation(undefined)).toBe('none')
    expect(parseRotation('yes')).toBe('none')
  })
})

describe('insertWithCodes (the launch loop)', () => {
  it('tries the pinned codes, retries with fresh ones on a collision, and warns once', async () => {
    const tried: string[] = []
    const warnings: string[] = []
    const row = await insertWithCodes(
      PREVIOUS,
      async (codes) => {
        tried.push(codes.event)
        if (codes.event === PREVIOUS.event) throw new Error('duplicate key value violates unique constraint')
        return codes
      },
      { mint, warn: (m) => warnings.push(m) },
    )
    expect(tried[0]).toBe(PREVIOUS.event)
    expect(tried).toHaveLength(2)
    expect(row.event).toBe(tried[1])
    expect(warnings).toHaveLength(1)
  })

  it('gives up after three attempts with the last error', async () => {
    let calls = 0
    await expect(
      insertWithCodes(
        PREVIOUS,
        async () => {
          calls++
          throw new Error(`boom ${calls}`)
        },
        { mint, warn: () => {} },
      ),
    ).rejects.toThrow('boom 3')
    expect(calls).toBe(3)
  })
})
