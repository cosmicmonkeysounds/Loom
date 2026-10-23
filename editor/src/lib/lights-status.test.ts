import { describe, expect, it } from 'vitest'
import { lightsLine, lightsShown, lightsStatusOf, moduleTitle, pairDeadline, pairText, problemsText } from '@/lib/lights-status'

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
    expect(s).toMatchObject({ version: 'abc12345', source: 'project', fixtures: 1, devices: 2, module: { name: 'house-mac', online: true }, problems: ['p'], warnings: ['w1', 'w2'], serverNow: 1000 })
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
  it('counts down from the answer’s newest server stamp, on this editor’s clock', () => {
    // Opened at 10 000 for 120 s; the module last polled at 40 000 → at most 90 s left.
    const s = lightsStatusOf(view({ pair: { seq: 1, at: 10_000, seconds: 120, until: 130_000, by: 'Ada' }, module: { name: 'm', at: 40_000, online: true } }))!
    const deadline = pairDeadline(s, 500_000)
    expect(deadline).toBe(590_000)
    expect(pairText(deadline, 500_000)).toBe('pairing 90 s')
    expect(pairText(deadline, 589_001)).toBe('pairing 1 s')
    expect(pairText(deadline, 590_000)).toBeNull()
  })

  it('a server `now` wins over the stamps; never more than the seconds asked for', () => {
    const withNow = lightsStatusOf(view({ now: 100_000, pair: { seq: 1, at: 10_000, seconds: 120, until: 130_000, by: 'Ada' } }))!
    expect(pairDeadline(withNow, 0)).toBe(30_000)
    const fresh = lightsStatusOf(view({ pair: { seq: 1, at: 10_000, seconds: 120, until: 130_000, by: 'Ada' } }))!
    expect(pairDeadline(fresh, 0)).toBe(120_000)
  })

  it('no pair, no deadline', () => {
    expect(pairDeadline(lightsStatusOf(view())!, 0)).toBeNull()
    expect(pairText(null, 0)).toBeNull()
  })
})
