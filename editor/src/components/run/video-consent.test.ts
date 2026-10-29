import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import runPageSource from './RunPage.tsx?raw'
import cardSource from './VideoConsentCard.tsx?raw'
import apiSource from '@/lib/api.ts?raw'
import { avatarUrl } from '@/lib/api'
import { VideoConsentPanel } from './VideoConsentCard'
import {
  VIDEO_CSV_FILE,
  VIDEO_END_NOTE,
  VIDEO_POLL_MS,
  initials,
  restSummary,
  videoConsentViewOf,
  videoCounts,
  videoErrorText,
  videoGroups,
  videoLabel,
  type VideoConsentRow,
  type VideoConsentView,
} from './video-consent'

const row = (name: string, video: VideoConsentRow['video'], extra: Partial<VideoConsentRow> = {}): VideoConsentRow => ({ id: `g-${name.toLowerCase()}`, name, video, avatar: null, ...extra })
const ROWS = [row('Winamp', 'ok'), row('Zune', 'out', { avatar: '0123456789abcdef' }), row('Excel', 'unasked'), row('Clippy Jr', 'out', { featured: 'excel' }), row('Paint', 'ok'), row('Doom', 'unasked')]
const view = (rows: VideoConsentRow[] = ROWS): VideoConsentView => ({ rows, counts: videoCounts(rows) })

describe('video consent off the wire', () => {
  it('reads a VideoConsentView and drops rows that are not rows', () => {
    const v = videoConsentViewOf({
      rows: [
        { id: 'g1', name: 'Winamp', video: 'out', avatar: 'abc', featured: 'winamp' },
        { id: 'g2', name: 'Zune', video: 'ok', avatar: null },
        { name: 'no id' },
        'junk',
        { id: 'g3', video: 'maybe', featured: 'none' },
      ],
      counts: { ok: 1, out: 1, unasked: 1 },
    })
    expect(v).toEqual({
      rows: [
        { id: 'g1', name: 'Winamp', video: 'out', avatar: 'abc', featured: 'winamp' },
        { id: 'g2', name: 'Zune', video: 'ok', avatar: null },
        // An answer the card doesn't know is never read as consent.
        { id: 'g3', name: 'g3', video: 'unasked', avatar: null },
      ],
      counts: { ok: 1, out: 1, unasked: 1 },
    })
  })
  it('counts the rows itself when the server sends no counts', () => {
    expect(videoConsentViewOf({ rows: [{ id: 'a', video: 'out' }, { id: 'b', video: 'ok' }, { id: 'c' }] })?.counts).toEqual({ ok: 1, out: 1, unasked: 1 })
    expect(videoConsentViewOf({ rows: [{ id: 'a', video: 'out' }], counts: { ok: 'x' } })?.counts).toEqual({ ok: 0, out: 1, unasked: 0 })
  })
  it('is null for anything that is not one', () => {
    expect(videoConsentViewOf(null)).toBeNull()
    expect(videoConsentViewOf({ rows: 'nope' })).toBeNull()
    expect(videoConsentViewOf([])).toBeNull()
  })
})

describe('the opted-out first, the rest folded', () => {
  it('puts the outs first by name, then the unasked, then the OKs', () => {
    const g = videoGroups(view())
    expect(g.out.map((r) => r.name)).toEqual(['Clippy Jr', 'Zune'])
    expect(g.rest.map((r) => r.name)).toEqual(['Doom', 'Excel', 'Paint', 'Winamp'])
    expect(restSummary(g.rest)).toBe('4 more: 2 OK · 2 not asked yet')
  })
  it('says each answer in words', () => {
    expect(videoLabel('ok')).toBe('video OK')
    expect(videoLabel('out')).toBe('leave out')
    expect(videoLabel('unasked')).toBe('not asked yet')
  })
  it('draws initials for a guest with no picture', () => {
    expect(initials('Microsoft Excel')).toBe('ME')
    expect(initials('Winamp')).toBe('WI')
    expect(initials('Adobe Acrobat Reader')).toBe('AR')
    expect(initials('  ')).toBe('?')
  })
})

describe('the card', () => {
  const render = (v: VideoConsentView, error: string | null = null) => renderToStaticMarkup(createElement(VideoConsentPanel, { eventId: 'ev 1', view: v, error, busy: false, onDownload: () => {} }))
  it('shows the counts, the outs with their pictures, the rest folded, and the End note', () => {
    const html = render(view())
    expect(html).toContain('2 OK')
    expect(html).toContain('2 leave out')
    expect(html).toContain('2 not asked yet')
    expect(html.match(/data-testid="run-video-out-row"/gu)).toHaveLength(2)
    expect(html.indexOf('Clippy Jr')).toBeLessThan(html.indexOf('Zune'))
    expect(html).toContain('featured: excel')
    // Zune's picture is the event server's avatar route, as play draws it.
    expect(html).toContain(`src="${avatarUrl('ev 1', '0123456789abcdef')}"`)
    expect(avatarUrl('ev 1', '0123456789abcdef')).toMatch(/\/e\/ev%201\/api\/avatar\/0123456789abcdef$/u)
    expect(html).toContain('<details')
    expect(html.match(/data-testid="run-video-rest-row"/gu)).toHaveLength(4)
    expect(html).toContain('⬇ Download CSV')
    expect(html).toContain(VIDEO_END_NOTE)
    expect(VIDEO_END_NOTE).toBe('Download before End: End stops the event.')
  })
  it('says when no one opted out, and when there are no guests', () => {
    expect(render(view([row('Paint', 'ok')]))).toContain('No one has asked to be left out.')
    const empty = render(view([]))
    expect(empty).toContain('No guests yet.')
    expect(empty).not.toContain('<details')
  })
  it('shows a failed download', () => {
    const html = render(view(), videoErrorText(new Error('HTTP 500')))
    expect(html).toContain("Couldn&#x27;t download the list: HTTP 500")
  })
})

describe('wiring', () => {
  it('sits beside Letters, on server runs only, one per event', () => {
    const server = runPageSource.slice(runPageSource.indexOf('{server ? ('), runPageSource.indexOf('<LocalCard />'))
    expect(server).toContain('<VideoConsentCard key={`video:${run.eventId ?? \'\'}`} />')
    expect(server.indexOf('<LettersCard')).toBeLessThan(server.indexOf('<VideoConsentCard'))
  })
  it('polls every 10 s and saves video-consent.csv', () => {
    expect(VIDEO_POLL_MS).toBe(10_000)
    expect(VIDEO_CSV_FILE).toBe('video-consent.csv')
    expect(cardSource).toContain('setInterval(')
    expect(cardSource).toContain('VIDEO_POLL_MS')
    expect(cardSource).toContain('videoApi.csv(eventId)')
  })
  it('calls the mod route and its csv with the session cookie', () => {
    expect(apiSource).toContain('/api/mod/video`')
    expect(apiSource).toContain('/api/mod/video?format=csv`')
    const csv = apiSource.slice(apiSource.indexOf('async csv('))
    expect(csv.slice(0, 300)).toContain("credentials: 'include'")
  })
})
