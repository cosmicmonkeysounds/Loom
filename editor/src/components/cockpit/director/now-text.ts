//! How the NOW card names cues and says "nothing to press" (pure).

import { cueTitleTags, type CueRow } from '@loom/core/cue-sheet'

/** A cue after its number: its code (if any) and title — `V3 ⏰ Bingo time`,
 *  `⏱ Close round-one filings`. The card prints the number in front, so a
 *  cue with no code never reads `8 8 ⏱ …`. */
export function rowName(r: Pick<CueRow, 'code' | 'title'>): string {
  const { title } = cueTitleTags(r.title)
  return r.code !== null ? `${r.code} ${title}` : title
}

/** A cue on its own (Watching's one line, no number column): its code,
 *  else its number, then the title. */
export function shortName(r: Pick<CueRow, 'code' | 'n' | 'title'>): string {
  return `${r.code ?? r.n} ${cueTitleTags(r.title).title}`
}

/** NEXT's line when nothing is on offer: the story still runs (a countdown,
 *  or cues ahead on the running order), or the running order is done. */
export function nothingToPress(opts: { last: CueRow | null; after: CueRow | null; countdowns: number; paused?: boolean }): string {
  if (opts.paused === true) return 'NEXT — nothing to press. The story clock is stopped.'
  if (opts.last !== null && opts.after === null && opts.countdowns === 0) return 'NEXT — nothing left: the running order is done.'
  return 'NEXT — nothing to press. The story runs.'
}
