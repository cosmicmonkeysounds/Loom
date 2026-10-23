import { describe, expect, it } from 'vitest'
import { lightsLine, lightsReadFor, lightsShown, lightsStatusOf, moduleTitle, pairDeadline, pairText, problemsText } from '@/lib/lights-status'

const view = (over: Record<string, unknown> = {}) => ({
  lights: { version: 1, fixtures: [{ id: 'server-room-rgb' }], zones: [], looks: {} },
  version: 'abc12345',
  source: 'project',
  looks: [],
  locations: [],
  tests: [],
  pair: null,
  devices: [],
  devicesAt: null,
  module: null,
  problems: [],
  warnings: [],
  ...over,
})

describe('lightsStatusOf (wave 20)', () => {
  it('reads the parts the 💡 row needs', () => {
    const s = lightsStatusOf(view({ module: { name: 'house-mac', at: 1000, online: true }, devices: [{}, {}], problems: ['p'], warnings: ['w1', 'w2'] }))
    expect(s).toMatchObject({ version: 'abc12345', source: 'project', fixtures: 1, devices: 2, module: { name: 'house-mac', online: true }, problems: ['p'], warnings: ['w1', 'w2'], serverNow: null })
    expect(lightsStatusOf(view({ now: 4321 }))?.serverNow).toBe(4321)
  })

  it('anything that isn’t a lights view is null; a stray source reads default', () => {
    expect(lightsStatusOf(null)).toBeNull()
    expect(lightsStatusOf({ version: 'x' })).toBeNull()
    expect(lightsStatusOf({ lights: {}, version: 3 })).toBeNull()
    expect(lightsStatusOf(view({ source: 'nope' }))?.source).toBe('default')
  })

  it('a close (seconds 0) is no pairing', () => {
    expect(lightsStatusOf(view({ pair: { seq: 2, at: 5000, seconds: 0, until: 5000, by: 'Ada' } }))?.pair).toBeNull()
  })

  it('the row hides with nothing placed and no module ever seen', () => {
    expect(lightsShown(lightsStatusOf(view({ lights: { version: 1, fixtures: [], zones: [], looks: {} } })))).toBe(false)
    expect(lightsShown(lightsStatusOf(view()))).toBe(true)
    expect(lightsShown(lightsStatusOf(view({ lights: { version: 1, fixtures: [], zones: [], looks: {} }, module: { name: '', at: 1, online: false } })))).toBe(true)
    expect(lightsShown(null)).toBe(false)
  })
})

describe('the 💡 line', () => {
  it('module online / offline / never, with the fixture count', () => {
    expect(lightsLine(lightsStatusOf(view({ module: { name: 'm', at: 1, online: true } }))!)).toBe('💡 lights module online · 1 fixture')
    const off = lightsStatusOf(view({ module: { name: 'm', at: 1, online: false }, lights: { version: 1, fixtures: [{}, {}], zones: [], looks: {} } }))!
    expect(lightsLine(off)).toBe('💡 lights module offline · 2 fixtures')
    expect(moduleTitle(off)).toContain('stopped polling')
    const never = lightsStatusOf(view())!
    expect(lightsLine(never)).toBe('💡 lights module never connected · 1 fixture')
    expect(moduleTitle(never)).toContain('has not polled')
  })

  it('problems and warnings counted, null when clean', () => {
    expect(problemsText(lightsStatusOf(view({ problems: ['a', 'b'], warnings: ['c'] }))!)).toBe('2 problems · 1 warning')
    expect(problemsText(lightsStatusOf(view({ warnings: ['c', 'd'] }))!)).toBe('2 warnings')
    expect(problemsText(lightsStatusOf(view())!)).toBeNull()
  })
})

describe('the pairing countdown', () => {
  it('counts down from the server’s `now`, on this editor’s clock', () => {
    // Opened at 10 000 for 120 s; the server answered at 40 000 → 90 s left.
    const s = lightsStatusOf(view({ now: 40_000, pair: { seq: 1, at: 10_000, seconds: 120, until: 130_000, by: 'Ada' }, module: { name: 'm', at: 15_000, online: true } }))!
    const clock = pairDeadline(s, 500_000)
    expect(clock).toEqual({ closesAt: 590_000 })
    expect(pairText(clock, 500_000)).toBe('pairing 90 s')
    expect(pairText(clock, 589_001)).toBe('pairing 1 s')
    expect(pairText(clock, 590_000)).toBeNull()
  })

  it('never more than the seconds asked for; run out reads closed', () => {
    const early = lightsStatusOf(view({ now: 0, pair: { seq: 1, at: 10_000, seconds: 120, until: 130_000, by: 'Ada' } }))!
    expect(pairDeadline(early, 0)).toEqual({ closesAt: 120_000 })
    const late = lightsStatusOf(view({ now: 131_000, pair: { seq: 1, at: 10_000, seconds: 120, until: 130_000, by: 'Ada' } }))!
    expect(pairDeadline(late, 0)).toBeNull()
  })

  it('with no server `now`, no number: the stamps are old and would count high', () => {
    // The module's stamp is from when its long poll began, up to ≈ 25 s ago:
    // until − that stamp would show more time than is left.
    const s = lightsStatusOf(view({ pair: { seq: 1, at: 10_000, seconds: 120, until: 130_000, by: 'Ada' }, module: { name: 'm', at: 40_000, online: true }, devicesAt: 41_000 }))!
    const clock = pairDeadline(s, 500_000)
    expect(clock).toEqual({ closesAt: null })
    expect(pairText(clock, 999_999)).toBe('pairing open')
  })

  it('no pair, no clock', () => {
    expect(pairDeadline(lightsStatusOf(view({ now: 1 }))!, 0)).toBeNull()
    expect(pairText(null, 0)).toBeNull()
  })
})

describe('a read belongs to its event', () => {
  it('a run switched to another shows nothing until its own answer lands', () => {
    const status = lightsStatusOf(view({ module: { name: 'm', at: 1, online: true } }))!
    const read = { eventId: 'ev-a', status, deadline: { closesAt: null } }
    expect(lightsReadFor(read, 'ev-a')).toEqual({ status, deadline: { closesAt: null } })
    expect(lightsReadFor(read, 'ev-b')).toEqual({ status: null, deadline: null })
    expect(lightsReadFor(read, null)).toEqual({ status: null, deadline: null })
  })
})
