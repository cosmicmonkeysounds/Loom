//! Run's credits (wave 44, `docs/loom-w44-contract.md` C5 / C10): the pure
//! half of `CreditsCard.tsx`. Reads the mod answer of `GET /api/credits`
//! (a `CreditsView` plus `source` and `problems`) off the wire, lays the
//! roll out as text with core's own `creditsRows` (so it reads in the same
//! order as the TV and the phones), and names where the file came from.

import { creditsRows, type CreditsPerson, type CreditsRow, type CreditsSection, type CreditsView } from '@loom/core/credits'

/** How often the card re-reads `GET /api/credits` while it is open (the
 *  server reads the project's file live, cached ≤ 5 s). */
export const CREDITS_POLL_MS = 15_000

/** What the card says when the server has no `credits.json` (404 `no_credits`). */
export const NO_CREDITS = 'No credits.json in this project'

/** The note under the card. */
export const CREDITS_AGAIN_NOTE = 'G12 (🎬 Roll the credits again) rolls them on every screen.'

const SOURCES: readonly NonNullable<CreditsView['source']>[] = ['project', 'env', 'scenario']
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function sectionOf(raw: unknown): CreditsSection | null {
  if (!isRecord(raw)) return null
  const people: CreditsPerson[] = Array.isArray(raw['people'])
    ? raw['people'].flatMap((p) => (isRecord(p) && typeof p['role'] === 'string' && typeof p['name'] === 'string' ? [{ role: p['role'], name: p['name'] }] : []))
    : []
  return { heading: str(raw['heading']) ?? '', people, lines: strings(raw['lines']), ...(raw['programs'] === true ? { programs: true as const } : {}) }
}

/** A `CreditsView` off the wire, or null when it isn't one. */
export function creditsViewOf(raw: unknown): CreditsView | null {
  if (!isRecord(raw) || typeof raw['title'] !== 'string' || !Array.isArray(raw['sections'])) return null
  const source = SOURCES.find((s) => s === raw['source'])
  return {
    title: raw['title'],
    subtitle: str(raw['subtitle']),
    sections: raw['sections'].map(sectionOf).filter((s): s is CreditsSection => s !== null),
    end: strings(raw['end']),
    roll: typeof raw['roll'] === 'number' ? raw['roll'] : 0,
    ...(source !== undefined ? { source } : {}),
    ...(Array.isArray(raw['problems']) ? { problems: strings(raw['problems']) } : {}),
  }
}

/** The roll as the card shows it: `creditsRows`, then the end card (held
 *  after the roll on every screen). */
export function creditsCardRows(view: CreditsView): CreditsRow[] {
  const rows = creditsRows(view)
  if (view.end.length > 0) {
    rows.push({ kind: 'gap' })
    for (const text of view.end) rows.push({ kind: 'line', text })
  }
  return rows
}

/** The roll as plain text (one line a row, a blank line a gap): what the
 *  card's box holds, and what a director can copy. */
export function creditsText(view: CreditsView): string {
  return creditsCardRows(view)
    .map((r) => {
      switch (r.kind) {
        case 'gap':
          return ''
        case 'person':
          return `${r.role}: ${r.name}`
        case 'heading':
          return r.text.toUpperCase()
        default:
          return r.text
      }
    })
    .join('\n')
}

/** Where the server read the file, in words. */
export function creditsSourceLabel(source: CreditsView['source']): string | null {
  switch (source) {
    case 'project':
      return "the project's credits.json"
    case 'env':
      return 'the server’s LOOM_CREDITS file'
    case 'scenario':
      return "the show's own credits.json (the default scenario)"
    default:
      return null
  }
}

/** How many times the story has rolled them tonight, in words. */
export function rollLabel(roll: number): string {
  if (roll <= 0) return 'Not rolled yet tonight.'
  return roll === 1 ? 'Rolled once tonight.' : `Rolled ${roll} times tonight.`
}
