import { describe, expect, it } from 'vitest'
import { buildPrintItems, PrintKind, qrSvg, type PrintCodes } from './print-sheet'

const CODES: PrintCodes = {
  eventPass: 'EVT777',
  primePass: 'P',
  modPass: 'M',
  joinUrl: 'https://app.example.com',
  joinLink: 'https://app.example.com/?code=EVT777',
  codex: [
    { id: 'The Sandy File', title: 'The Sandy File', about: 'Trabolta', code: 'sandy1997', url: 'https://app.example.com/?code=EVT777&unlock=sandy1997' },
    { id: 'The Billboard', title: 'The Billboard', about: null, code: 'bill', url: 'https://app.example.com/?code=EVT777&unlock=bill' },
  ],
  checkin: [
    { id: 'The Desktop', label: 'The Desktop (living room)', slug: 'the-desktop', url: 'https://app.example.com/?code=EVT777&checkin=the-desktop', hidden: false },
    { id: 'The Cache', label: 'The Cache (kitchen)', slug: 'the-cache', url: 'https://app.example.com/?code=EVT777&checkin=the-cache', hidden: true },
  ],
}

describe('print sheet', () => {
  it('orders join → codex → rooms with stable refs and the typed fallback', () => {
    const items = buildPrintItems(CODES)
    expect(items.map((i) => [i.ref, i.kind, i.code])).toEqual([
      ['J1', PrintKind.Join, 'EVT777'],
      ['C01', PrintKind.Codex, 'sandy1997'],
      ['C02', PrintKind.Codex, 'bill'],
      // a room sign prints no code: a slug typed into the Codex is a `wrong code`
      ['R01', PrintKind.Room, ''],
      ['R02', PrintKind.Room, ''],
    ])
    expect(items[3]!.url).toContain('checkin=the-desktop')
    expect(items[0]!.url).toBe('https://app.example.com/?code=EVT777')
    expect(items[3]!.title).toBe('The Desktop (living room)')
    expect(items[4]!.note).toMatch(/hidden/)
    expect(items[1]!.note).toBe('about Trabolta')
  })

  it('falls back to building the join link on an older server (no rooms)', () => {
    const items = buildPrintItems({ ...CODES, joinLink: undefined, checkin: undefined, joinUrl: 'http://party.local:7000/' })
    expect(items[0]!.url).toBe('http://party.local:7000/?code=EVT777')
    expect(items.filter((i) => i.kind === PrintKind.Room)).toEqual([])
  })

  it('draws QRs locally as SVG — no /api/qr round-trip', async () => {
    const svg = await qrSvg(CODES.codex[0]!.url)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('#000000')
    expect(await qrSvg('a')).not.toBe(svg)
  })
})
