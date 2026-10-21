//! Picking a terminal from the Run page (wave 14): every choice a director
//! makes about a wall terminal is an enum off real data, never a typed
//! string — the spots from the event's house map (`GET /api/spatial/house`,
//! read with the author's session), the views from `TERMINAL_VIEWS`, the
//! rooms from the story's LOCATIONs, the characters from the cast. Pure, so
//! the link and the claims are tested without a server.
//!
//! Two consumers on the Terminals card: the **Set up a terminal** builder
//! (spot → name / view / room suggestions → the `/terminal/?code=…` link the
//! tablet opens once) and the heartbeat rows' **spot claims** (which map spot
//! each live terminal says it hangs on, one off the current map flagged, and
//! the map's spots no live terminal claims).
//!
//! Keep `TERMINAL_VIEWS` in step with `terminal/src/config.ts` `VIEWS` (the
//! editor has no dependency on the terminal app).

import { ROOM_TERMINAL_SPOT } from './terminals'

/** A terminal's `view=` (terminal/src/config.ts `TerminalView`). */
export const TerminalView = {
  Auto: 'auto',
  World: 'world',
  Face: 'face',
  Mirror: 'mirror',
  Tv: 'tv',
  Chess: 'chess',
  Shadow: 'shadow',
  Casino: 'casino',
  Reinstall: 'reinstall',
} as const
export type TerminalView = (typeof TerminalView)[keyof typeof TerminalView]

export interface TerminalViewOption {
  id: TerminalView
  label: string
  /** One line: what the screen shows. */
  help: string
}

/** Every view a terminal can be provisioned with, in picker order. */
export const TERMINAL_VIEWS: readonly TerminalViewOption[] = [
  { id: TerminalView.Auto, label: 'Auto', help: 'The face and a pass scanner; the world view while a program is in the reinstallation.' },
  { id: TerminalView.World, label: 'World', help: 'Always the virtual house, seen from where this tablet hangs, plus the scanner.' },
  { id: TerminalView.Face, label: 'Face', help: 'The character’s face and the scanner, never the world view.' },
  { id: TerminalView.Mirror, label: 'Mirror', help: 'A full-screen spectator of the reinstallation: no scanner, no chat.' },
  { id: TerminalView.Tv, label: 'TV', help: 'The house Mac on the TV: the face full screen speaking the character’s lines in its room.' },
  { id: TerminalView.Chess, label: 'Chess', help: 'The King’s board at the server-room door: scan a pass, play him. No character, no room.' },
  { id: TerminalView.Shadow, label: 'Shadow', help: 'This tablet’s own camera full screen, the reinstallation players drawn over it as ghosts.' },
  { id: TerminalView.Casino, label: 'Casino', help: 'Scan a pass, bet Truthcoin on the coin, the dice and the slots. No character, no room.' },
  {
    id: TerminalView.Reinstall,
    label: 'Reinstall',
    help: 'The tent laptop: the idle show like any wall terminal; a marked pass plays the reinstallation here (or sends it to a headset). No character, no room.',
  },
]

/** A view that runs a station of its own (the King's board, the casino, the
 *  tent's reinstallation station, wave 18b): no character, no room. */
export function isStationView(view: TerminalView): boolean {
  return view === TerminalView.Chess || view === TerminalView.Casino || view === TerminalView.Reinstall
}

export function isTerminalView(v: unknown): v is TerminalView {
  return typeof v === 'string' && TERMINAL_VIEWS.some((o) => o.id === v)
}

export function viewOption(v: string): TerminalViewOption | null {
  return TERMINAL_VIEWS.find((o) => o.id === v) ?? null
}

/** One terminal spot of the house map, with the LOCATION its room plays. */
export interface MapTerminal {
  id: string
  name: string
  /** The house room id it hangs in. */
  room: string
  /** That room's story LOCATION ("" when the map names none). */
  location: string
  /** The map's screen for this spot (`TerminalSpot.view`), when it names one. */
  view?: TerminalView
  /** The map marks it a room terminal (`TerminalSpot.speaks`), when it says. */
  speaks?: boolean
}

/** The terminal spots of a `GET /api/spatial/house` answer (or a bare
 *  `house.json`), in map order. Anything malformed is skipped. */
export function mapTerminals(wire: unknown): MapTerminal[] {
  const w = wire as { house?: unknown } | null
  const house = (w !== null && typeof w === 'object' && 'house' in w ? w.house : wire) as {
    terminals?: unknown
    rooms?: unknown
  } | null
  if (house === null || typeof house !== 'object') return []
  const locations = new Map<string, string>()
  for (const r of Array.isArray(house.rooms) ? house.rooms : []) {
    const room = r as { id?: unknown; location?: unknown }
    if (typeof room?.id === 'string') locations.set(room.id, typeof room.location === 'string' ? room.location : '')
  }
  const out: MapTerminal[] = []
  const seen = new Set<string>()
  for (const t of Array.isArray(house.terminals) ? house.terminals : []) {
    const spot = t as { id?: unknown; name?: unknown; room?: unknown; view?: unknown; speaks?: unknown }
    if (typeof spot?.id !== 'string' || spot.id === '' || seen.has(spot.id)) continue
    seen.add(spot.id)
    const room = typeof spot.room === 'string' ? spot.room : ''
    out.push({
      id: spot.id,
      name: typeof spot.name === 'string' && spot.name.trim() !== '' ? spot.name : spot.id,
      room,
      location: locations.get(room) ?? '',
      ...(isTerminalView(spot.view) ? { view: spot.view } : {}),
      ...(typeof spot.speaks === 'boolean' ? { speaks: spot.speaks } : {}),
    })
  }
  return out
}

/** The spot the tent laptop hangs on (the show's map, both variants). */
export const TENT_SPOT = 'tent'

/** The view a spot most likely wants (when the map names none): the TV spot
 *  plays `tv`, the server door `chess`, the tent `reinstall`, the server
 *  room's own terminal `face`, the rest `auto`. */
export function suggestView(spot: string): TerminalView {
  if (/(^|[-_])tv$/i.test(spot)) return TerminalView.Tv
  if (spot === `${ROOM_TERMINAL_SPOT}-door`) return TerminalView.Chess
  if (spot === TENT_SPOT) return TerminalView.Reinstall
  if (spot === ROOM_TERMINAL_SPOT) return TerminalView.Face
  return TerminalView.Auto
}

/** The room a spot + view wants. A room makes any view but the TV a **room
 *  terminal** (asleep until that LOCATION opens), so only the server-room
 *  spot and the TV (the room whose lines it speaks) get one; chess never. */
export function suggestRoom(spot: MapTerminal | null, view: TerminalView): string {
  if (spot === null || isStationView(view)) return ''
  if (view === TerminalView.Tv) return spot.location
  // The map says (the house map editor's "room terminal" box).
  if (spot.speaks !== undefined) return spot.speaks ? spot.location : ''
  if (spot.id === ROOM_TERMINAL_SPOT) return spot.location
  return ''
}

/** What the `room` select means for a view (its empty option's words). */
export function roomHelp(view: TerminalView): string {
  if (view === TerminalView.Chess) return 'The chess board belongs to no room.'
  if (view === TerminalView.Casino) return 'The casino belongs to no room.'
  if (view === TerminalView.Reinstall) return 'The reinstallation station belongs to no room (the Internet’s lines are private messages).'
  if (view === TerminalView.Tv) return 'The room whose lines the TV speaks (none = The Desktop).'
  return 'A room makes this a room terminal: asleep until that room is open to everyone, then it speaks that room’s lines.'
}

/** Does this view speak for a character? (Chess plays the King, the casino
 *  deals, the reinstallation station runs the game: no one speaks.) */
export function viewHasCharacter(view: TerminalView): boolean {
  return !isStationView(view)
}

/** The room options: the map's LOCATIONs, then the story's other ones, unique, in order. */
export function roomOptions(map: readonly MapTerminal[], mapLocations: readonly string[], storyLocations: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const l of [...mapLocations, ...map.map((t) => t.location), ...storyLocations]) {
    const k = l.trim()
    if (k === '' || seen.has(k.toLowerCase())) continue
    seen.add(k.toLowerCase())
    out.push(k)
  }
  return out
}

/** Every LOCATION a house map's rooms name (a `GET /api/spatial/house` answer or a bare map). */
export function mapLocations(wire: unknown): string[] {
  const w = wire as { house?: unknown } | null
  const house = (w !== null && typeof w === 'object' && 'house' in w ? w.house : wire) as { rooms?: unknown } | null
  if (house === null || typeof house !== 'object' || !Array.isArray(house.rooms)) return []
  return house.rooms.map((r) => (r as { location?: unknown })?.location).filter((l): l is string => typeof l === 'string' && l.trim() !== '')
}

export interface CharacterOption {
  id: string
  agent: boolean
}

/** The character options, agent-voiced first (a terminal is a line to one), then the rest, each by name. */
export function characterOptions(cast: ReadonlyArray<{ id: string; agent?: boolean }>): CharacterOption[] {
  return cast
    .map((c) => ({ id: c.id, agent: c.agent === true }))
    .sort((a, b) => (a.agent === b.agent ? a.id.localeCompare(b.id) : a.agent ? -1 : 1))
}

export interface TerminalSetup {
  name: string
  spot: string
  view: TerminalView
  room: string
  character: string
  /** Always say the house announcements, whatever the house setting says
   *  (wave 18b, Q8: unticked, the link names none and the tablet follows
   *  `audio.json`'s `announce.terminals` for its spot). */
  announce: boolean
}

/** The builder's state after picking a spot: its name, suggested view + room, the rest kept. */
export function pickSpot(prev: TerminalSetup, spot: MapTerminal | null): TerminalSetup {
  const view = spot === null ? prev.view : (spot.view ?? suggestView(spot.id))
  return { ...prev, spot: spot?.id ?? '', name: spot?.name ?? prev.name, view, room: suggestRoom(spot, view) }
}

/** The builder's state after picking a view: the room follows the view's rule for the spot. */
export function pickView(prev: TerminalSetup, view: TerminalView, spot: MapTerminal | null): TerminalSetup {
  return { ...prev, view, room: suggestRoom(spot, view) }
}

/** The terminal app's base off the event's join URL (`<base>/?code=…` → `<base>/terminal/`). */
export function terminalBase(joinUrl: string): string | null {
  try {
    const u = new URL(joinUrl)
    return `${u.origin}/terminal/`
  } catch {
    return null
  }
}

/** The provisioning link a tablet opens once
 *  (`/terminal/?code=&name=&character=&spot=&view=&room=&announce=1`). A
 *  station (the chess board, the casino, the reinstallation station) carries
 *  no character and no room; a blank room or spot is left out. `announce=1`
 *  only when ticked: with none the tablet follows the house setting (wave
 *  18b — an `announce=0` would pin it to Never). */
export function terminalLink(base: string, modCode: string, s: TerminalSetup): string {
  const p = new URLSearchParams()
  p.set('code', modCode)
  if (s.name.trim() !== '') p.set('name', s.name.trim())
  if (viewHasCharacter(s.view) && s.character !== '') p.set('character', s.character)
  if (s.spot !== '') p.set('spot', s.spot)
  p.set('view', s.view)
  if (!isStationView(s.view) && s.room.trim() !== '') p.set('room', s.room.trim())
  if (s.announce) p.set('announce', '1')
  return `${base}?${p.toString().replace(/\+/g, '%20')}`
}

/** A heartbeat row's spot against the current map. */
export const SpotClaim = {
  /** On the map. */
  OnMap: 'on-map',
  /** Not on the current map (an old spot id, or the other variant's). */
  OffMap: 'off-map',
  /** Provisioned with no spot. */
  Unplaced: 'unplaced',
  /** The map isn't known (no map, or not read yet). */
  Unknown: 'unknown',
} as const
export type SpotClaim = (typeof SpotClaim)[keyof typeof SpotClaim]

export function spotClaim(spot: string, map: readonly MapTerminal[] | null): SpotClaim {
  if (spot === '') return SpotClaim.Unplaced
  if (map === null) return SpotClaim.Unknown
  return map.some((t) => t.id === spot) ? SpotClaim.OnMap : SpotClaim.OffMap
}

/** The map's spots no live terminal claims (silent ones don't count: a dead
 *  tablet leaves its spot dark). */
export function unclaimedSpots(map: readonly MapTerminal[], rows: ReadonlyArray<{ spot: string; status: string }>): MapTerminal[] {
  const claimed = new Set(rows.filter((r) => r.status === 'live').map((r) => r.spot))
  return map.filter((t) => !claimed.has(t.id))
}

/** Spots two or more live terminals claim (a copied link left unedited). */
export function doubleClaims(rows: ReadonlyArray<{ spot: string; status: string }>): Set<string> {
  const n = new Map<string, number>()
  for (const r of rows) if (r.status === 'live' && r.spot !== '') n.set(r.spot, (n.get(r.spot) ?? 0) + 1)
  return new Set([...n].filter(([, c]) => c > 1).map(([s]) => s))
}
