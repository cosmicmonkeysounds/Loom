//! The Run page's House map card (wave 5 E9): the tent ⇄ shed switch from
//! the editor, over the same `/api/mod/spatial/variant{s}` routes the map
//! page's project bar uses. The editor has no `@loom/house` dependency, so
//! the wire types and the label rule are a small local copy — keep
//! `variantLabel` in step with `reinstall/web/src/map/project.ts`, or the
//! buttons here read "Main" where the map page reads "Tent".

/** One whole-map variant (`@loom/house` `MapVariant`). */
export interface MapVariant {
  file: string
  name: string
  /** The map's own `variant` field, when it has one. */
  label?: string
  active: boolean
  ok: boolean
  problems: string[]
}

/** `GET /api/mod/spatial/variants` (`@loom/house` `MapVariantsResponse`).
 *  `edited`: a director's save is in force over the active variant (a
 *  switch drops it). `version`: the map playing now — the switch sends it
 *  back as `base` (absent on an older server). */
export interface MapVariantsResponse {
  variants: MapVariant[]
  from: 'project' | 'show'
  edited: boolean
  project: boolean
  version?: string
}

/** `POST /api/mod/spatial/variant` (200). `dropped`: a director's save was in force and is gone. */
export interface SwitchVariantResult {
  ok: true
  version: string
  warnings: string[]
  file: string
  dropped: boolean
}

const MAP_FILE = /^house(\.[A-Za-z0-9_-]{1,40})?\.json$/
const FILLER = new Set(['the', 'and', 'for', 'with', 'until', 'not', 'yet', 'but', 'its', 'house', 'map', 'layout', 'variant', 'version', 'copy'])
const wordsOf = (name: string): Set<string> => new Set(name.toLowerCase().match(/[a-z][a-z0-9]*/g) ?? [])
const titleOf = (word: string): string => {
  const w = word.replace(/[_-]+/g, ' ').trim()
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
}

/** A variant button's label (the map page's rule): the map's own `variant`
 *  field; else `house.shed.json` → "Shed"; the default `house.json` → the
 *  one word only its map's name has among the variants ("Tent"), else
 *  "Main"; a show sibling not named like a project map keeps its stem. */
export function variantLabel(v: MapVariant, all: readonly MapVariant[] = []): string {
  const given = v.label?.trim()
  if (given) return given
  const m = MAP_FILE.exec(v.file)
  if (m === null) return v.file.replace(/\.json$/i, '')
  if (m[1] !== undefined) return titleOf(m[1].slice(1))
  const others = all.filter((o) => o.file !== v.file)
  if (v.ok && others.length > 0) {
    const theirs = new Set<string>()
    for (const o of others) {
      for (const w of wordsOf(o.name)) theirs.add(w)
      const sfx = MAP_FILE.exec(o.file)?.[1]
      if (sfx !== undefined) for (const w of wordsOf(sfx.slice(1))) theirs.add(w)
    }
    const own = [...wordsOf(v.name)].filter((w) => w.length >= 3 && !FILLER.has(w) && !theirs.has(w))
    if (own.length === 1) return titleOf(own[0]!)
  }
  return 'Main'
}

/** A button's tooltip: its file and the map's name, or why it can't be played. */
export function variantTitle(v: MapVariant): string {
  if (!v.ok) return `${v.file} does not validate:\n${v.problems.slice(0, 5).join('\n')}${v.problems.length > 5 ? `\n… ${v.problems.length - 5} more` : ''}`
  return v.active ? `${v.file} — ${v.name} (playing now)` : `Play ${v.file} — ${v.name}`
}

/** "Shed (house.shed.json)" — what the confirm calls a variant. */
export function variantName(v: MapVariant, all: readonly MapVariant[] = []): string {
  const label = variantLabel(v, all)
  return label === v.file ? label : `${label} (${v.file})`
}

/** Can the card switch to `v`? Only another valid variant. */
export function canSwitchTo(v: MapVariant): boolean {
  return v.ok && !v.active
}

/** The variant to switch to, looked up in a list fetched just now (the
 *  card's list may be half an hour old: another director may have saved
 *  edits or switched since). Null when it is gone, invalid or already
 *  playing. The switch then sends this list's `version` as `base`
 *  (`switchBase`), so a switch or save made while the confirm was open is
 *  refused (409) rather than silently undone. */
export function freshTarget(file: string, fresh: MapVariantsResponse): MapVariant | null {
  const v = fresh.variants.find((x) => x.file === file)
  return v !== undefined && canSwitchTo(v) ? v : null
}

/** The `base` a switch confirmed off `fresh` sends: its map version, or
 *  undefined (no check) when an older server sent none. */
export function switchBase(fresh: MapVariantsResponse): string | undefined {
  return typeof fresh.version === 'string' && fresh.version !== '' ? fresh.version : undefined
}

/** The confirm before a switch. It always asks (the switch moves every
 *  device's map at once); the edited warning names the save it drops. */
export function switchConfirm(to: MapVariant, r: MapVariantsResponse): { title: string; body: string } {
  const name = variantName(to, r.variants)
  const lines = [
    `Every tablet, headset and wall terminal switches to ${name} now. Programs mid-game keep playing from where they stand; anyone standing where ${name} has no floor goes back to its start, and a duck whose spot is not on it is dealt a new one.`,
  ]
  if (r.edited) lines.push(`This event's map has edits that are not in the project — the switch drops them. To keep them, Save to project in Run → House → 🗺 Map first.`)
  return { title: `Switch the house map to ${name}?`, body: lines.join('\n\n') }
}
