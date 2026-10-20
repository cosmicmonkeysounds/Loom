//! Who is really still here (wave 11 C5): a guest's last activity
//! (`RosterRow.lastSeen` — a stream open or any authenticated guest
//! request), the director's 👋 *went home* mark (the journaled world var
//! `<id>.gone`, `POST /api/mod/guest/gone`) and the persona flag (a Run
//! persona's `<id>.persona`, or its owner / `p…` id). Generic — no story
//! names: a story may leave gone guests and personas out of its own counts
//! (a majority), and the Director's Needs you offers to mark the guests
//! nobody has seen for half an hour. Pure, tested in `guests.test.ts`.

import { isGone } from '@loom/core/host-board'
import type { RosterRow, WorldEntry } from '@/store/cockpit'

// Wave 13: `UNSEEN_MS`, `isGone`, `isPersonaRow` and `unseenGuests` moved
// verbatim to `@loom/core/host-board` (a Play host booth's Needs share them).
export { UNSEEN_MS, isGone, isPersonaRow, unseenGuests } from '@loom/core/host-board'

/** The server's `lastSeen: null` means "no request since this process
 *  started" — after a restart or a release that is every guest who has not
 *  touched their phone yet, so it never reads as "never came". */
export const NOT_SINCE_RESTART = 'not seen since the server started'

/** `seen just now` · `seen 12 m ago` · `seen 1 h 05 m ago`; for a null,
 *  `not seen since the server started`; null where nothing is tracked
 *  (undefined: a local run, an older server). */
export function seenAgo(lastSeen: number | null | undefined, now: number): string | null {
  if (lastSeen === undefined) return null
  if (lastSeen === null) return NOT_SINCE_RESTART
  const s = Math.max(0, Math.round((now - lastSeen) / 1000))
  if (s < 60) return 'seen just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `seen ${m} m ago`
  return `seen ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m ago`
}

/** The seen line for a roster row: `online now`, else `seenAgo` — and
 *  nothing for a Run persona (it has no phone; the server never stamps it). */
export function seenLine(row: Pick<RosterRow, 'online' | 'lastSeen'>, persona: boolean, now: number): string | null {
  if (persona) return null
  return row.online === true ? 'online now' : seenAgo(row.lastSeen, now)
}

/** The Roster's Seen column: `online` · `just now` · `12 m ago` ·
 *  `since restart?` (a null) · `—` (a persona, or nothing tracked). */
export function seenCell(row: Pick<RosterRow, 'online' | 'lastSeen'>, persona: boolean, now: number): string {
  if (persona) return '—'
  if (row.online === true) return 'online'
  if (row.lastSeen === null) return 'not since restart'
  return seenAgo(row.lastSeen, now)?.replace(/^seen /u, '') ?? '—'
}

/** How many guests the director marked gone (the People glance's 👋). */
export function goneCount(roster: readonly RosterRow[], world: readonly WorldEntry[]): number {
  const byPath = new Map(world.map((w) => [w.path, w.value]))
  return roster.filter((r) => isGone(byPath, r.id)).length
}
