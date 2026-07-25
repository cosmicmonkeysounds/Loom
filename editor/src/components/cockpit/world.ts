//! Pure grouping for the World tab's live state browser: every world
//! entry (`g-1a2b.score`, `TheAdmin.captures`, `Time.elapsed`, ad-hoc
//! globals) sorted into director-meaningful sections — the story clock,
//! true globals, one group per guest, and the cast/faction/location
//! internals. Unit-tested in `world.test.ts`.

import type { CastSummary, FactionSummary, LocationSummary, RosterRow, WorldEntry } from '@/store/cockpit'

/** One display row: `name` is the path with the group prefix stripped;
 *  `path` is the full world path (the write key for inline editing). */
export interface VarRow {
  name: string
  value: string
  path: string
}

export interface WorldGroup {
  key: string
  title: string
  entries: VarRow[]
}

export interface GroupedWorld {
  clock: WorldGroup | null
  globals: WorldGroup | null
  guests: WorldGroup[]
  cast: WorldGroup[]
  world: WorldGroup[]
}

/** First path segment, or the whole path when it has no dot. */
function headOf(path: string): string {
  const dot = path.indexOf('.')
  return dot < 0 ? path : path.slice(0, dot)
}

/** Strip `prefix.` from a path (identity when it doesn't match). */
function restOf(path: string, prefix: string): string {
  return path.startsWith(`${prefix}.`) ? path.slice(prefix.length + 1) : path
}

/**
 * Group the flat world table. `filter` (case-insensitive substring over
 * the full path + value) drops non-matching entries and then empty groups.
 */
export function groupWorld(
  entries: WorldEntry[],
  roster: RosterRow[],
  cast: CastSummary[],
  factions: FactionSummary[],
  locations: LocationSummary[],
  filter = '',
): GroupedWorld {
  const q = filter.trim().toLowerCase()
  const kept = q === '' ? entries : entries.filter((e) => `${e.path} ${e.value}`.toLowerCase().includes(q))

  const guestIds = new Map(roster.map((r) => [r.id, r.name]))
  const castIds = new Set(cast.map((c) => c.id))
  const worldIds = new Set([...factions.map((f) => f.id), ...locations.map((l) => l.id)])

  const clock: WorldGroup = { key: 'time', title: 'Story clock', entries: [] }
  const globals: WorldGroup = { key: 'globals', title: 'Globals', entries: [] }
  const byGuest = new Map<string, WorldGroup>()
  const byCast = new Map<string, WorldGroup>()
  const byWorld = new Map<string, WorldGroup>()

  const groupFor = (map: Map<string, WorldGroup>, id: string, title: string): WorldGroup => {
    let g = map.get(id)
    if (g === undefined) {
      g = { key: id, title, entries: [] }
      map.set(id, g)
    }
    return g
  }

  for (const e of kept) {
    const head = headOf(e.path)
    // The bareword identity seeds (`Mods` → `Mods`) are engine plumbing,
    // not state — hide them unless the value diverges from the id.
    if (head === e.path && (e.value === e.path || e.value === `"${e.path}"`)) continue
    if (head === 'Time') clock.entries.push({ name: restOf(e.path, 'Time'), value: e.value, path: e.path })
    else if (guestIds.has(head)) {
      groupFor(byGuest, head, guestIds.get(head)!).entries.push({ name: restOf(e.path, head), value: e.value, path: e.path })
    } else if (castIds.has(head)) {
      groupFor(byCast, head, head).entries.push({ name: restOf(e.path, head), value: e.value, path: e.path })
    } else if (worldIds.has(head)) {
      groupFor(byWorld, head, head).entries.push({ name: restOf(e.path, head), value: e.value, path: e.path })
    } else {
      globals.entries.push({ name: e.path, value: e.value, path: e.path })
    }
  }

  const byTitle = (a: WorldGroup, b: WorldGroup) => a.title.localeCompare(b.title)
  return {
    clock: clock.entries.length > 0 ? clock : null,
    globals: globals.entries.length > 0 ? globals : null,
    guests: [...byGuest.values()].sort(byTitle),
    cast: [...byCast.values()].sort(byTitle),
    world: [...byWorld.values()].sort(byTitle),
  }
}

/** The variables belonging to one entity, standard fields excluded —
 *  what the guest Inspector shows under "Variables". */
export function entityVars(entries: WorldEntry[], id: string, exclude: Set<string>): VarRow[] {
  const out: VarRow[] = []
  for (const e of entries) {
    if (!e.path.startsWith(`${id}.`)) continue
    const name = e.path.slice(id.length + 1)
    if (exclude.has(name)) continue
    out.push({ name, value: e.value, path: e.path })
  }
  return out
}

/** Standard per-guest fields already rendered as Inspector controls. */
export const GUEST_STANDARD_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'role',
  'faction',
  'trueFaction',
  'location',
  'captured',
  'captured_from',
  'score',
])
