import { afterEach, describe, expect, it, vi } from 'vitest'
import { mapApi } from './api'
import { canSwitchTo, freshTarget, switchBase, switchConfirm, variantLabel, variantName, variantTitle, type MapVariant, type MapVariantsResponse } from './map-variants'

const tent: MapVariant = { file: 'house.json', name: 'The house', active: true, ok: true, problems: [] }
const shed: MapVariant = { file: 'house.shed.json', name: 'The house (shed)', active: false, ok: true, problems: [] }
const broken: MapVariant = { file: 'house.wet.json', name: 'house.wet.json', active: false, ok: false, problems: ['rooms must be an array'] }
const resp = (over: Partial<MapVariantsResponse> = {}): MapVariantsResponse => ({ variants: [tent, shed], from: 'project', edited: false, project: true, ...over })

describe('map variants (the map page rule, ported)', () => {
  it('labels: the map’s own variant field, a suffix, the one word only its name has, else Main', () => {
    expect(variantLabel(shed)).toBe('Shed')
    expect(variantLabel({ ...shed, file: 'house.rain_night.json' })).toBe('Rain night')
    expect(variantLabel(tent, [tent, shed])).toBe('Main')
    expect(variantLabel({ ...tent, name: 'The house (tent)' }, [tent, shed])).toBe('Tent')
    expect(variantLabel({ ...tent, file: 'trapped.json' })).toBe('trapped')
    expect(variantLabel({ ...tent, name: 'Renamed', label: ' Tent ' }, [tent, shed])).toBe('Tent')
    expect(variantLabel({ ...tent, label: '  ' }, [tent, shed])).toBe('Main')
    expect(variantName(shed)).toBe('Shed (house.shed.json)')
  })

  it('the show’s own maps read Tent | Shed', () => {
    const t: MapVariant = { ...tent, name: 'Trapped in the Internet — the house (PLACEHOLDER layout until the real house is measured; the Internet in the tent)' }
    const s: MapVariant = { ...shed, name: 'Trapped in the Internet — the house, rain variant (PLACEHOLDER layout until the real house is measured; the Internet in the shed)' }
    expect([variantLabel(t, [t, s]), variantLabel(s, [t, s])]).toEqual(['Tent', 'Shed'])
  })

  it('titles, and only another valid variant can be switched to', () => {
    expect(variantTitle(tent)).toBe('house.json — The house (playing now)')
    expect(variantTitle(shed)).toBe('Play house.shed.json — The house (shed)')
    expect(variantTitle(broken)).toContain('rooms must be an array')
    expect([canSwitchTo(tent), canSwitchTo(shed), canSwitchTo(broken)]).toEqual([false, true, false])
  })

  it('the confirm always asks, and names the dropped edits when the map was edited', () => {
    const plain = switchConfirm(shed, resp())
    expect(plain.title).toBe('Switch the house map to Shed (house.shed.json)?')
    expect(plain.body).toContain('goes back to its start')
    expect(plain.body).not.toContain('drops them')
    expect(switchConfirm(shed, resp({ edited: true })).body).toContain('drops them')
  })
  it('a switch confirms off a list fetched just now, not the card’s old one', () => {
    // the card loaded clean; another director has since saved edits
    const now = resp({ edited: true })
    const t = freshTarget('house.shed.json', now)!
    expect(t).toEqual(shed)
    expect(switchConfirm(t, now).body).toContain('drops them')
    // someone else already switched to the shed: nothing to confirm
    expect(freshTarget('house.shed.json', resp({ variants: [{ ...tent, active: false }, { ...shed, active: true }] }))).toBeNull()
    // gone, or no longer valid
    expect(freshTarget('house.shed.json', resp({ variants: [tent] }))).toBeNull()
    expect(freshTarget('house.wet.json', resp({ variants: [tent, broken] }))).toBeNull()
  })
})

describe('mapApi', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists the variants and switches with {file} only when no base is given (an older server)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, version: 'v2', warnings: [], file: 'house.shed.json', dropped: false }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await mapApi.variants('ev1')
    const r = await mapApi.switchVariant('ev1', 'house.shed.json')
    expect(r.file).toBe('house.shed.json')
    expect(fetchMock.mock.calls[0]![0]).toBe('/e/ev1/api/mod/spatial/variants')
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('GET')
    expect(fetchMock.mock.calls[1]![0]).toBe('/e/ev1/api/mod/spatial/variant')
    expect(fetchMock.mock.calls[1]![1]!.method).toBe('POST')
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual({ file: 'house.shed.json' })
    expect(fetchMock.mock.calls[1]![1]!.credentials).toBe('include')
  })

  it('a switch confirmed off a list sends that list’s version as base; a stale one surfaces the 409 (wave 5 issue 7)', async () => {
    expect(switchBase(resp({ version: 'abc12345' }))).toBe('abc12345')
    expect(switchBase(resp())).toBeUndefined()
    expect(switchBase(resp({ version: '' }))).toBeUndefined()
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ error: 'the map changed — reload', version: 'v3' }), { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(mapApi.switchVariant('ev1', 'house.shed.json', switchBase(resp({ version: 'v1' })))).rejects.toMatchObject({ status: 409 })
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ file: 'house.shed.json', base: 'v1' })
  })

  it('the House map card switches with the re-read list’s base and explains a 409', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../components/run/HouseMapCard.tsx', import.meta.url), 'utf8')
    expect(src).toContain('mapApi.switchVariant(eventId, target.file, switchBase(now))')
    expect(src).toMatch(/e\.status === 409/)
  })

  it('a refusal surfaces the server’s error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'no such map variant' }), { status: 404 })))
    await expect(mapApi.switchVariant('ev1', 'house.x.json')).rejects.toMatchObject({ status: 404, message: 'no such map variant' })
  })
})
