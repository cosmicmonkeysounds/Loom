import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { creditsView, parseCredits, type CreditsView } from '@loom/core/credits'
import runPageSource from './RunPage.tsx?raw'
import cardSource from './CreditsCard.tsx?raw'
import apiSource from '@/lib/api.ts?raw'
import { CreditsPanel } from './CreditsCard'
import { CREDITS_AGAIN_NOTE, CREDITS_POLL_MS, NO_CREDITS, creditsCardRows, creditsSourceLabel, creditsText, creditsViewOf, rollLabel } from './credits-card'

const FILE = JSON.stringify({
  title: 'Trapped in the Internet',
  subtitle: 'Halloween 2026',
  sections: [
    { heading: 'Cast', people: [{ role: 'Clippy', name: 'Brooke' }, { role: 'Norton', name: '' }] },
    { heading: 'Starring the programs', programs: true },
    { heading: 'Thanks', lines: ['Everyone who came.'] },
  ],
  end: ['Thank you for playing.'],
})
const served = (extra: Partial<CreditsView> = {}): CreditsView => ({ ...creditsView(parseCredits(FILE).file!, ['Winamp', 'Excel'], 2), source: 'project', problems: [], ...extra })

describe('the credits off the wire', () => {
  it('reads the mod answer, source and problems included', () => {
    const v = served({ problems: ['sections[3]: needs a "heading" string'] })
    expect(creditsViewOf(JSON.parse(JSON.stringify(v)))).toEqual(v)
  })
  it('drops what is not a section or a person, and an unknown source', () => {
    const v = creditsViewOf({ title: 'T', subtitle: null, sections: [{ heading: 'A', people: [{ role: 'r' }, { role: 'r', name: 'n' }], lines: ['x', 3] }, 'junk'], end: 'nope', roll: 'x', source: 'disk' })
    expect(v).toEqual({ title: 'T', subtitle: null, sections: [{ heading: 'A', people: [{ role: 'r', name: 'n' }], lines: ['x'] }], end: [], roll: 0 })
  })
  it('is null for anything that is not one', () => {
    expect(creditsViewOf(null)).toBeNull()
    expect(creditsViewOf({ title: 'T' })).toBeNull()
    expect(creditsViewOf({ sections: [] })).toBeNull()
  })
})

describe('the roll as text', () => {
  it("is core's creditsRows, then the end card", () => {
    const rows = creditsCardRows(served())
    expect(rows[0]).toEqual({ kind: 'title', text: 'Trapped in the Internet' })
    expect(rows.at(-1)).toEqual({ kind: 'line', text: 'Thank you for playing.' })
    expect(creditsText(served())).toBe(
      ['Trapped in the Internet', 'Halloween 2026', '', 'CAST', 'Clippy: Brooke', '', 'STARRING THE PROGRAMS', 'Excel', 'Winamp', '', 'THANKS', 'Everyone who came.', '', 'Thank you for playing.'].join('\n'),
    )
  })
  it('names the source and the rolls', () => {
    expect(creditsSourceLabel('project')).toMatch(/project's credits\.json/u)
    expect(creditsSourceLabel('env')).toMatch(/LOOM_CREDITS/u)
    expect(creditsSourceLabel('scenario')).toMatch(/default scenario/u)
    expect(creditsSourceLabel(undefined)).toBeNull()
    expect(rollLabel(0)).toBe('Not rolled yet tonight.')
    expect(rollLabel(1)).toBe('Rolled once tonight.')
    expect(rollLabel(3)).toBe('Rolled 3 times tonight.')
  })
})

describe('the card', () => {
  const render = (state: Parameters<typeof CreditsPanel>[0]['state']) => renderToStaticMarkup(createElement(CreditsPanel, { state }))
  it('shows the roll, its source, its problems and the G12 note', () => {
    const html = render({ kind: 'view', view: served({ problems: ['end: must be a list of strings'] }) })
    expect(html).toContain('Rolled 2 times tonight.')
    expect(html).toContain('Brooke')
    expect(html).not.toContain('Norton')
    expect(html).toContain('Winamp')
    expect(html).toContain('Thank you for playing.')
    expect(html).toContain('end: must be a list of strings')
    expect(html).toContain("project&#x27;s credits.json")
    expect(html).toContain(CREDITS_AGAIN_NOTE)
    expect(CREDITS_AGAIN_NOTE).toContain('G12')
  })
  it('says when the project has no credits.json', () => {
    const html = render({ kind: 'none' })
    expect(html).toContain(NO_CREDITS)
    expect(NO_CREDITS).toBe('No credits.json in this project')
    expect(html).toContain(CREDITS_AGAIN_NOTE)
  })
})

describe('wiring', () => {
  it('sits beside Letters, on server runs only, one per event', () => {
    const server = runPageSource.slice(runPageSource.indexOf('{server ? ('), runPageSource.indexOf('<LocalCard />'))
    expect(server).toContain('<CreditsCard key={`credits:${run.eventId ?? \'\'}`} />')
    expect(server.indexOf('<LettersCard')).toBeLessThan(server.indexOf('<CreditsCard'))
  })
  it('reads GET /api/credits, tells no_credits from an older server, and never writes', () => {
    expect(apiSource).toContain('/api/credits`')
    expect(cardSource).toContain("e.message === 'no_credits'")
    expect(cardSource).toContain('setInterval(')
    expect(CREDITS_POLL_MS).toBe(15_000)
    const api = apiSource.slice(apiSource.indexOf('export const creditsApi'))
    expect(api).not.toMatch(/'(POST|PUT|DELETE)'/u)
  })
})
