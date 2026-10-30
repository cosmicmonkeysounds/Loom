import { describe, expect, it } from 'vitest'
import { DESCENT_MAX } from '@loom/house'
import { descentChoices, descentFromWire, descentLevelOf, descentValue, houseMapRoute, isHouseMapFile, mapPageUrl, serverOrigin } from './house-map-view'

describe('the ways in', () => {
  it('opens on a server run', () => {
    expect(houseMapRoute({ server: true, running: true, lens: false })).toEqual({ kind: 'open' })
  })

  it('says to start a rehearsal with no run, and takes you to the Run page', () => {
    const r = houseMapRoute({ server: true, running: false, lens: false })
    expect(r).toMatchObject({ kind: 'tell', title: 'Start a rehearsal first', toRun: true })
  })

  it('explains a browser run and a lens', () => {
    expect(houseMapRoute({ server: false, running: true, lens: false })).toMatchObject({ kind: 'tell', toRun: false })
    expect(houseMapRoute({ server: false, running: false, lens: false })).toMatchObject({ kind: 'tell', toRun: false })
    expect(houseMapRoute({ server: true, running: true, lens: true })).toMatchObject({ kind: 'tell', title: 'Switch to Operator first' })
  })
})

describe('the map’s own page', () => {
  it('sits on the event server, off the join URL', () => {
    expect(mapPageUrl('https://app.mapsandducks.com/?code=GUEST', 'M0D 1')).toBe('https://app.mapsandducks.com/reinstall/map?code=M0D%201')
    expect(mapPageUrl('http://localhost:7000/?code=G', 'M')).toBe('http://localhost:7000/reinstall/map?code=M')
    expect(serverOrigin('http://localhost:7000/?code=G')).toBe('http://localhost:7000')
  })

  it('needs a run', () => {
    expect(mapPageUrl(null, 'M')).toBeNull()
    expect(mapPageUrl('http://x/', null)).toBeNull()
    expect(mapPageUrl('http://x/', '')).toBeNull()
    expect(mapPageUrl('not a url', 'M')).toBeNull()
    expect(serverOrigin('not a url')).toBeNull()
  })
})

describe('a map file', () => {
  it('is house.json or a variant at the root, as the server has it', () => {
    for (const p of ['house.json', 'house.shed.json', 'house.rain_2.json', '/house.json']) expect(isHouseMapFile(p)).toBe(true)
    for (const p of ['audio.json', 'lights.json', 'house.loom', 'maps/house.json', 'house..json', 'house.a.b.json', 'myhouse.json', null]) expect(isHouseMapFile(p)).toBe(false)
  })
})

describe('the descent select', () => {
  it('offers by visits, then every level', () => {
    expect(descentChoices().map((c) => c.label)).toEqual(['by visits', ...Array.from({ length: DESCENT_MAX + 1 }, (_, n) => String(n))])
    expect(DESCENT_MAX).toBe(4)
  })

  it('round-trips a level, and by visits is null', () => {
    for (const level of [0, 1, 2, 3, 4]) expect(descentLevelOf(descentValue(level))).toBe(level)
    expect(descentValue(null)).toBe('')
    expect(descentLevelOf('')).toBeNull()
    expect(descentLevelOf('9')).toBeNull()
  })

  it('reads the wire', () => {
    expect(descentFromWire({ forced: 2 })).toBe(2)
    expect(descentFromWire({ forced: 0 })).toBe(0)
    expect(descentFromWire({ forced: null })).toBeNull()
    expect(descentFromWire({ forced: 7 })).toBeNull()
    expect(descentFromWire({ forced: '2' })).toBeNull()
    expect(descentFromWire(null)).toBeNull()
  })
})
