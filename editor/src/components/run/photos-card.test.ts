import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PHOTO_CAP_BYTES, PHOTO_HEART_ONLY, PHOTO_UNSAVED_LINE, type PhotosView } from '@loom/core/photos'
import { PHOTOS_END_NOTE, PhotosCardBody, THUMB_STEP_MS, thumbStep } from './PhotosCard'

function view(o: Partial<PhotosView> = {}): PhotosView {
  return { armed: false, since: null, now: 100_000, count: 3, bytes: 3072, capBytes: PHOTO_CAP_BYTES, stopped: null, terminals: [], ...o }
}
const noop = () => {}
const render = (v: PhotosView, confirming = false, error: string | null = null) => renderToStaticMarkup(createElement(PhotosCardBody, { view: v, eventId: 'e 1', error, confirming, onArm: noop, onDelete: noop, onConfirm: noop }))

describe('Run → Terminals: 📷 photos', () => {
  it('says SAFE, and ARMED in red', () => {
    expect(render(view())).toContain('>SAFE<')
    const armed = render(view({ armed: true }))
    expect(armed).toContain('>ARMED<')
    expect(armed).toContain('bg-red-700')
    expect(armed).toContain('aria-pressed="true"')
  })

  it('counts, and says what stopped it', () => {
    expect(render(view())).toContain('3 photos · 3 KB of 3.0 GB')
    expect(render(view({ stopped: 'cap' }))).toContain('3.0 GB cap')
    expect(render(view({ stopped: 'disk' }))).toContain('nearly full')
    expect(render(view(), false, 'moderators only')).toContain('moderators only')
  })

  it('downloads by a plain link, so the browser saves it as it comes', () => {
    const html = render(view())
    expect(html).toContain('href="/e/e%201/api/mod/photos/download"')
    expect(html).toContain('download=""')
    expect(render(view({ count: 0 }))).toContain('pointer-events-none')
  })

  it('asks before Delete all, on the page, and never with window.confirm', () => {
    expect(render(view())).not.toContain('run-photos-confirm')
    const asked = render(view(), true)
    expect(asked).toContain('Delete all 3 photos from the server, for good?')
    expect(asked).toContain('Yes, delete them')
    expect(asked).toContain('Keep them')
    expect(asked).not.toContain('data-testid="run-photos-delete"')
    const src = readFileSync(fileURLToPath(new URL('./PhotosCard.tsx', import.meta.url)), 'utf8')
    expect(src).not.toMatch(/\bconfirm\(/)
  })

  it('draws each terminal: its count, last shot, thumbnail and note', () => {
    const html = render(
      view({
        terminals: [
          { spot: 'hall', name: 'Hall', count: 12, bytes: 1, lastAt: 88_000, note: null },
          { spot: 'cpu', name: 'CPU', count: 0, bytes: 0, lastAt: null, note: 'No camera: it’s off in ⚙, refused, or missing.' },
        ],
      }),
    )
    expect(html).toContain('12 · 12 s ago')
    expect(html).toContain('/api/mod/photos/thumb?spot=hall&amp;step=2')
    expect(html).toContain('0 · never')
    expect(html).toContain('No camera')
    expect(html).toContain(PHOTOS_END_NOTE)
  })

  it('notes the Server Room as only at the heart, with no warning', () => {
    const html = render(view({ terminals: [{ spot: 'server-room', name: 'Server Room', count: 3, bytes: 1, lastAt: 88_000, note: null, only: PHOTO_HEART_ONLY }] }))
    expect(html).toContain('3 · 12 s ago · only at the heart')
    expect(html).not.toContain('⚠')
  })

  it('says when a disarm has not reached the disk, once', () => {
    const html = render(view({ unsaved: true }), false, PHOTO_UNSAVED_LINE)
    expect(html.split('a restart would arm the photos again').length).toBe(2)
    expect(html).toContain('>SAFE<')
    expect(render(view())).not.toContain('restart')
  })

  it('moves a thumbnail on at most every 30 s', () => {
    expect(thumbStep(THUMB_STEP_MS - 1)).toBe(0)
    expect(thumbStep(THUMB_STEP_MS)).toBe(1)
  })
})
