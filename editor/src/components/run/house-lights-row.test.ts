import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { lightsStatusOf, type LightsStatus, type PairClock } from '@/lib/lights-status'
import { LightsRow } from './HouseMapCard'

const status = (over: Record<string, unknown> = {}): LightsStatus =>
  lightsStatusOf({ lights: { version: 1, fixtures: [{ id: 'server-room-rgb' }], zones: [], looks: {} }, version: 'v', source: 'project', module: null, pair: null, devices: [], problems: [], warnings: [], ...over })!

const render = (s: LightsStatus, deadline: PairClock | null = null) => renderToStaticMarkup(createElement(LightsRow, { status: s, deadline }))

describe('the House map card’s 💡 row (wave 20)', () => {
  it('says the module is online and counts the fixtures', () => {
    const html = render(status({ module: { name: 'house-mac', at: 1, online: true } }))
    expect(html).toContain('💡 lights module online · 1 fixture')
    expect(html).toContain('data-online="true"')
    expect(html).not.toContain('run-house-lights-pair')
    expect(html).not.toContain('run-house-lights-issues')
  })

  it('an offline module reads amber; problems are counted with their text on hover', () => {
    const html = render(status({ module: { name: 'house-mac', at: 1, online: false }, problems: ['fixture x is outside its room'], warnings: ['w'] }))
    expect(html).toContain('lights module offline')
    expect(html).toContain('data-online="false"')
    expect(html).toMatch(/title="fixture x is outside its room\nw"[^>]*>1 problem · 1 warning</)
  })

  it('shows the pairing countdown while joining is open', () => {
    const html = render(status({ module: { name: 'm', at: 1, online: true } }), { closesAt: Date.now() + 87_400 })
    expect(html).toMatch(/run-house-lights-pair"[^>]*>pairing 8[78] s</)
  })

  it('says only *pairing open* when the server sent no clock to count from', () => {
    const html = render(status({ module: { name: 'm', at: 1, online: true } }), { closesAt: null })
    expect(html).toMatch(/run-house-lights-pair"[^>]*>pairing open</)
  })
})
