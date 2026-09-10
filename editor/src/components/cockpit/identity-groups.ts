//! Pure helpers behind the identity control: how the roster groups by
//! puppeteer (yours · each co-writer's · real guests) and how a lens id
//! reads as a name. Kept out of the component file for Fast Refresh.

import type { RosterRow } from '@/store/cockpit'

/** Group roster rows by who puppets them: yours, each co-writer's, real guests. */
export function groupByOwner(roster: RosterRow[], me: string): Array<{ label: string; rows: RosterRow[] }> {
  const mine = roster.filter((r) => r.owner === me)
  const others = new Map<string, RosterRow[]>()
  const guests: RosterRow[] = []
  for (const r of roster) {
    if (r.owner === me) continue
    if (r.owner) {
      const list = others.get(r.owner) ?? []
      list.push(r)
      others.set(r.owner, list)
    } else guests.push(r)
  }
  const groups: Array<{ label: string; rows: RosterRow[] }> = []
  if (mine.length > 0) groups.push({ label: 'Your personas', rows: mine })
  for (const [owner, rows] of [...others.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    groups.push({ label: `${owner}'s personas`, rows })
  }
  if (guests.length > 0) groups.push({ label: 'Guests', rows: guests })
  return groups
}

/** Display name for a lens identity (guest name, or the character id). */
export function identityName(id: string, roster: RosterRow[]): string {
  return roster.find((r) => r.id === id)?.name ?? id
}

