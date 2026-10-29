//! Run's video consent (wave 44, `docs/loom-w44-contract.md` C6 / C10): the
//! pure half of `VideoConsentCard.tsx`. The wire shapes (`VideoConsentView`,
//! `VideoConsentRow`, mirrored by hand from core's `GET /api/mod/video`),
//! reading them off the wire, the opted-out guests first and the rest
//! folded, a row's answer in words, the csv's file name.

export type VideoChoice = 'ok' | 'out' | 'unasked'

export interface VideoConsentRow {
  id: string
  name: string
  video: VideoChoice
  /** `ModView.avatars`' serving key for this guest, or null. */
  avatar: string | null
  /** `<id>.featured` when not "none". */
  featured?: string
}

export interface VideoConsentView {
  /** Every guest but personas, by name. */
  rows: VideoConsentRow[]
  counts: { ok: number; out: number; unasked: number }
}

/** How often the card re-reads `GET /api/mod/video` while it is open. */
export const VIDEO_POLL_MS = 10_000
/** What `⬇ Download CSV` saves as (the server's own `content-disposition`). */
export const VIDEO_CSV_FILE = 'video-consent.csv'
/** The note under the card: End drops the event and its answers with it. */
export const VIDEO_END_NOTE = 'Download before End: End stops the event.'

const CHOICES: readonly VideoChoice[] = ['ok', 'out', 'unasked']
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)

/** Count the rows' answers (when the server's own counts are missing). */
export function videoCounts(rows: readonly Pick<VideoConsentRow, 'video'>[]): VideoConsentView['counts'] {
  return {
    ok: rows.filter((r) => r.video === 'ok').length,
    out: rows.filter((r) => r.video === 'out').length,
    unasked: rows.filter((r) => r.video === 'unasked').length,
  }
}

/** A `VideoConsentView` off the wire, or null when it isn't one. Rows that
 *  aren't rows are dropped; an answer the card doesn't know reads as
 *  `unasked` (never as consent). */
export function videoConsentViewOf(raw: unknown): VideoConsentView | null {
  if (!isRecord(raw) || !Array.isArray(raw['rows'])) return null
  const rows: VideoConsentRow[] = []
  for (const r of raw['rows']) {
    if (!isRecord(r)) continue
    const id = str(r['id'])
    if (id === null) continue
    const video = CHOICES.find((c) => c === r['video']) ?? 'unasked'
    const featured = str(r['featured'])
    rows.push({ id, name: str(r['name']) ?? id, video, avatar: str(r['avatar']), ...(featured !== null && featured !== '' && featured !== 'none' ? { featured } : {}) })
  }
  const c = raw['counts']
  const own = isRecord(c) ? { ok: count(c['ok']), out: count(c['out']), unasked: count(c['unasked']) } : null
  const counts = own !== null && own.ok !== null && own.out !== null && own.unasked !== null ? { ok: own.ok, out: own.out, unasked: own.unasked } : videoCounts(rows)
  return { rows, counts }
}

const byName = (a: VideoConsentRow, b: VideoConsentRow): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

/** The card's two lists: the opted-out guests first (shown with their
 *  pictures), then everyone else, folded: the unasked before the ok (they
 *  are the ones a host may still need to ask), each by name. */
export function videoGroups(view: VideoConsentView): { out: VideoConsentRow[]; rest: VideoConsentRow[] } {
  const out = view.rows.filter((r) => r.video === 'out').sort(byName)
  const unasked = view.rows.filter((r) => r.video === 'unasked').sort(byName)
  const ok = view.rows.filter((r) => r.video === 'ok').sort(byName)
  return { out, rest: [...unasked, ...ok] }
}

/** A row's answer, in words. */
export function videoLabel(video: VideoChoice): string {
  switch (video) {
    case 'ok':
      return 'video OK'
    case 'out':
      return 'leave out'
    case 'unasked':
      return 'not asked yet'
  }
}

/** The folded list's summary line. */
export function restSummary(rest: readonly VideoConsentRow[]): string {
  const c = videoCounts(rest)
  return `${rest.length} more: ${c.ok} OK · ${c.unasked} not asked yet`
}

/** Up to two initials for a guest with no picture. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter((w) => w !== '')
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!].map((w) => [...w][0] ?? '') : [...(words[0] ?? '?')].slice(0, 2)
  return letters.join('').toUpperCase() || '?'
}

/** A failed CSV download in plain words. */
export function videoErrorText(e: unknown): string {
  return `Couldn't download the list: ${e instanceof Error ? e.message : String(e)}`
}
