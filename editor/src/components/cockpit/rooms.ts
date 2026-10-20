//! Shared room model for the cockpit. The rooms rail (left) and the Chat
//! page (center) both need the same derived list — authored/derived
//! channels (incl. `loc:` location rooms) plus one room per (character ×
//! guest) DM seen in the feed — so it lives here as a hook over whichever
//! cockpit store the enclosing provider supplies.
//!
//! Everything is perspective-aware. Under the **Operator** lens the list
//! is every room the mod snapshot enumerates (+ DM threads from traffic).
//! Under a **guest** or **performer** lens the list is EXACT: it comes
//! from that identity's own server projection (`CockpitState.lens` —
//! `GuestView.channels` / `PrimeView.channels`, the literal data the play
//! app renders, with real `member` / `canPost` / `threadable`), plus the
//! derived rooms the play app itself derives from the feed (the lobby,
//! their faction room, their DM threads; a performer's per-guest threads).
//! The old traffic heuristic survives only for a lens id with no
//! projection yet (the first render after switching).

import { useMemo } from 'react'
import { foldName } from '@loom/core/parser'
import type { InteractionSummary } from '@loom/core/views'
import {
  OPERATOR_LENS,
  useCockpit,
  type CastSummary,
  type ChannelSummary,
  type CockpitMessage,
  type FactionSummary,
  type Lens,
  type RosterRow,
} from '@/store/cockpit'

export interface Room {
  key: string
  channel: string
  kind: string
  title: string
  /** For a per-guest DM room (or a performer's guest thread), the single guest on the other end. */
  dmGuest: string | null
  /** For a DM room, the character (as it appears in the channel id) whose thread this is. */
  character: string | null
  /** From the lens projection, when known: may the identity post here? */
  canPost?: boolean
  /** From the lens projection, when known: explicit membership. */
  member?: boolean
  /** From the lens projection, when known: can messages open threads? */
  threadable?: boolean
  /** A sidebar slot that overrides `roomOrder(kind)` (a booth's own pinned rooms). */
  order?: number
}

/** What the lens id resolves to. */
export const LensKind = {
  Operator: 'operator',
  Guest: 'guest',
  Performer: 'performer',
} as const

export type LensKind = (typeof LensKind)[keyof typeof LensKind]

export function lensKindOf(perspective: string, roster: RosterRow[], cast: CastSummary[]): LensKind {
  if (perspective !== OPERATOR_LENS) {
    if (roster.some((r) => r.id === perspective)) return LensKind.Guest
    if (cast.some((c) => c.id === perspective)) return LensKind.Performer
  }
  return LensKind.Operator
}

/** Is a message inside the lens's view? Operator + performers see the full
 *  feed (they run the event, hidden rows greyed); a guest lens applies the
 *  audience rule AND never sees a hidden message — exactly the play app. */
export function messageInLens(m: CockpitMessage, perspective: string, lens: LensKind): boolean {
  if (lens !== LensKind.Guest) return true
  if (m.hidden === true) return false
  return m.audience === 'all' || (Array.isArray(m.audience) && m.audience.includes(perspective))
}

/** A guest's own pinned room — their Codex, Quest Log or Wallet (one id for
 *  everyone, every message addressed to one guest — or `@<Character>` for a
 *  booth's own). */
export function isPinnedRoom(channel: string): boolean {
  return channel === 'codex' || channel === 'quests' || channel === 'wallet'
}

/** Room kinds nobody types into from the cockpit: a person's own Codex /
 *  Quest Log / Wallet, and a booth's Inbox (what the story dealt it). */
export const READ_ONLY_ROOMS: ReadonlySet<string> = new Set(['codex', 'quests', 'wallet', 'inbox'])

/** A booth's own rooms sit right after the lobby (`roomOrder` lobby = 0). */
const BOOTH_PINNED_ORDER = 0.5

/** The single guest on the far side of a DM message (or of their own Codex /
 *  Quest Log), or null if it isn't one guest's thread. */
export function dmGuestOf(m: CockpitMessage): string | null {
  const isDm = m.channelKind === 'dm' || m.channel.startsWith('dm:') || isPinnedRoom(m.channel)
  if (isDm && Array.isArray(m.audience) && m.audience.length === 1) return m.audience[0]!
  return null
}

/** Sidebar sort: lobby, factions, locations, announcements, guest threads, then the rest. */
export function roomOrder(kind: string | undefined): number {
  switch (kind) {
    case 'lobby':
      return 0
    case 'faction':
      return 1
    case 'location':
      return 2
    case 'announcement':
      return 3
    case 'guest':
      return 5
    default:
      return 4
  }
}

/** The room key a message belongs to (per-guest for DMs, else the channel id). */
export function roomKeyOf(m: CockpitMessage): string {
  const gid = dmGuestOf(m)
  return gid ? `${m.channel}#${gid}` : m.channel
}

export interface RoomsInput {
  channels: ChannelSummary[]
  messages: CockpitMessage[]
  roster: RosterRow[]
  factions: FactionSummary[]
  cast: CastSummary[]
  perspective: string
  /** The identity's own projection (null under the Operator lens, or
   *  before it has resolved). */
  lens?: Lens
}

/** Can the lens open a listed channel? Operator/performer: everything.
 *  A guest with no projection yet: the lobby, locations + open rooms, their
 *  faction's channel, and any gated room where some message is addressed to
 *  them (traffic proxy for membership). */
function channelInLens(c: ChannelSummary, input: RoomsInput, lens: LensKind): boolean {
  if (lens !== LensKind.Guest) return true
  switch (c.kind) {
    case 'lobby':
    case 'location':
    case 'open':
    case 'announcement':
      return true
    case 'faction': {
      const derived = c.id.startsWith('faction:') ? c.id.slice('faction:'.length) : null
      if (derived !== null) {
        return input.factions.some((f) => f.id === derived && f.members.includes(input.perspective))
      }
      return hasVisibleTraffic(c.id, input)
    }
    default:
      return hasVisibleTraffic(c.id, input)
  }
}

function hasVisibleTraffic(channel: string, input: RoomsInput): boolean {
  return input.messages.some(
    (m) => m.channel === channel && messageInLens(m, input.perspective, LensKind.Guest),
  )
}

/** Add the feed-derived rooms (DM threads) a lens can see. */
function addTrafficRooms(map: Map<string, Room>, input: RoomsInput, lens: LensKind): void {
  const { messages, roster, perspective } = input
  // `@<Character>` is a booth's own pinned room (an approver's Wallet, a
  // character's Quest Log): name it after the character.
  const nameOf = (gid: string) => roster.find((r) => r.id === gid)?.name ?? (gid.startsWith('@') ? gid.slice(1).replace(/_/gu, ' ') : gid)
  for (const m of messages) {
    if (!messageInLens(m, perspective, lens)) continue
    const gid = dmGuestOf(m)
    const character = m.channel.startsWith('dm:') ? m.channel.slice(3) : (m.title ?? m.channel)
    if (gid) {
      // A guest lens folds their own DM threads to just the character name.
      const key = `${m.channel}#${gid}`
      if (!map.has(key)) {
        // A pinned room is the guest's own log, not a conversation with anyone.
        const pinned = isPinnedRoom(m.channel)
        // A character's own `dm:<C>` addressed `@<C>` is that booth's Inbox
        // (the cards the story deals it and, since wave 13, its readouts).
        if (!pinned && isInboxOf(m.channel, gid)) {
          map.set(key, { key, channel: m.channel, kind: 'inbox', title: `${character} · Inbox`, dmGuest: gid, character: null })
          continue
        }
        const title = lens === LensKind.Guest && gid === perspective ? character : `${character} · ${nameOf(gid)}`
        map.set(key, { key, channel: m.channel, kind: pinned ? (m.channelKind ?? 'dm') : 'dm', title, dmGuest: gid, character: pinned ? null : character })
      }
    } else if (!map.has(m.channel)) {
      const kind = m.channelKind ?? 'dm'
      map.set(m.channel, {
        key: m.channel,
        channel: m.channel,
        kind,
        title: m.title ?? m.channel,
        dmGuest: null,
        character: kind === 'dm' ? character : null,
      })
    }
  }
}

/** A room title's comparison key: `# hosts`, `#hosts` and `Hosts` are one name. */
function roomNameKey(title: string): string {
  return foldName(title.replace(/^#\s*/u, ''))
}

/** The suffix a GROUP's derived room wears when a declared room shares its name. */
export const SIDE_SUFFIX = ' (side)'

/**
 * A GROUP's derived room (`faction:Hosts`, `#hosts`) beside a declared
 * CHANNEL of the same name (`# hosts`): two rooms a director can't tell
 * apart, and the story's readouts land only in the declared one. Keep both
 * — the side's broadcasts are real traffic — but label the derived one
 * `#hosts (side)`.
 */
function labelTwinSides(map: Map<string, Room>): void {
  const declared = new Set<string>()
  for (const r of map.values()) if (!r.channel.startsWith('faction:') && r.dmGuest === null) declared.add(roomNameKey(r.title))
  for (const r of map.values()) {
    if (!r.channel.startsWith('faction:') || r.dmGuest !== null) continue
    if (declared.has(roomNameKey(r.title))) r.title = `${r.title}${SIDE_SUFFIX}`
  }
}

/** The derived rooms list, sorted for the sidebar. Pure — unit-testable. */
export function buildRooms(input: RoomsInput): Room[] {
  const { channels, roster, cast, factions, perspective } = input
  const lens = lensKindOf(perspective, roster, cast)
  const projection = input.lens ?? null
  const map = new Map<string, Room>()

  if (projection !== null && projection.id === perspective) {
    // EXACT: the identity's own channel list, as the play app renders it.
    const lobby = channels.find((c) => c.kind === 'lobby')
    if (lobby !== undefined) map.set(lobby.id, { key: lobby.id, channel: lobby.id, kind: 'lobby', title: lobby.title, dmGuest: null, character: null, canPost: true })
    if (projection.kind === 'guest') {
      // The derived faction room: broadcasts reach members only — and a
      // hidden, unrevealed allegiance has no room on the phone yet (it
      // appears only once a broadcast lands there, via the feed below).
      for (const f of factions) {
        if (!f.members.includes(perspective)) continue
        if (f.hidden && !f.revealed) continue
        const c = channels.find((ch) => ch.id === `faction:${f.id}`)
        if (c !== undefined) map.set(c.id, { key: c.id, channel: c.id, kind: 'faction', title: c.title, dmGuest: null, character: null, canPost: true, member: true })
      }
    }
    for (const c of projection.view.channels) {
      map.set(c.id, {
        key: c.id,
        channel: c.id,
        kind: c.kind,
        title: c.title,
        dmGuest: null,
        character: null,
        canPost: c.canPost,
        member: c.member,
        threadable: c.threadable,
      })
    }
    if (projection.kind === 'performer') {
      // One thread per guest — every message addressed to them — where the
      // performer scans, fires interactions, and DMs as the character.
      for (const g of projection.view.guests) {
        const key = `guest:${g.id}`
        map.set(key, { key, channel: key, kind: 'guest', title: g.name, dmGuest: g.id, character: projection.id, canPost: true })
      }
      // The character's own pinned rooms, as the booth lists them (play
      // `buildPrimeChannels`): rows addressed `@<Character>`, read-only.
      const me = `@${projection.view.character}`
      const pin = (channel: string, kind: string, title: string) =>
        map.set(`${channel}#${me}`, { key: `${channel}#${me}`, channel, kind, title, dmGuest: me, character: null, canPost: false, order: BOOTH_PINNED_ORDER })
      if (projection.view.questTotal > 0) pin('quests', 'quests', 'Quest Log')
      if (projection.view.codexTotal > 0) pin('codex', 'codex', 'Codex')
      if (projection.view.wallet !== undefined) pin('wallet', 'wallet', 'Wallet')
      // The Inbox: cards and notes the story deals the character (`dm:<me>`).
      pin(`dm:${projection.view.character}`, 'inbox', 'Inbox')
    } else {
      addTrafficRooms(map, input, lens)
    }
  } else {
    for (const c of channels) {
      if (!channelInLens(c, input, lens)) continue
      map.set(c.id, { key: c.id, channel: c.id, kind: c.kind, title: c.title, dmGuest: null, character: null })
    }
    addTrafficRooms(map, input, lens)
  }
  labelTwinSides(map)
  const orderOf = (r: Room) => r.order ?? roomOrder(r.kind)
  return [...map.values()].sort((a, b) => orderOf(a) - orderOf(b) || a.title.localeCompare(b.title))
}

/** Is `channel` / `gid` a character's own Inbox (`dm:<C>` addressed `@<C>`)? */
export function isInboxOf(channel: string, gid: string): boolean {
  return channel.startsWith('dm:') && gid === `@${channel.slice(3)}`
}

/** A booth readout (wave 13: in the character's own `dm:<Character>`) about one guest. */
export function isReadoutAbout(m: CockpitMessage, character: string, guest: string): boolean {
  return m.readout === true && m.about === guest && m.channel === `dm:${character}`
}

/** A character's readouts (its Inbox's `readout` rows), oldest first. */
export function readoutsOf(messages: readonly CockpitMessage[], character: string): CockpitMessage[] {
  return messages.filter((m) => m.readout === true && m.channel === `dm:${character}`).sort((a, b) => a.seq - b.seq)
}

/** The story's buttons a performer lens offers on an open guest thread:
 *  `who: performer` only (admin cues are the Director page's, never a
 *  booth's). With the lens resolved, off the booth's own
 *  `PrimeView.interactions`; before it resolves, off the mod snapshot's.
 *  Either way another character's `by:` button (`only: true`, this
 *  character not among its `actors`) is dropped — the view keeps it
 *  flagged and the play booth drops it on the client
 *  (`play/src/booth/card.tsx` `splitInteractions`) — unless the lens is a
 *  host part's (`host`), whose booth may press it. */
export function performerActions(lens: Lens | undefined, perspective: string, interactions: readonly InteractionSummary[]): InteractionSummary[] {
  const resolved = lens != null && lens.kind === 'performer' && lens.id === perspective ? lens : null
  const host = resolved?.host === true
  const me = foldName(perspective)
  const pressable = (i: InteractionSummary): boolean =>
    i.who === 'performer' && (host || i.only !== true || (i.actors ?? []).some((a) => foldName(a) === me))
  return (resolved !== null ? resolved.view.interactions : interactions).filter(pressable)
}

/** The messages that belong to a room, in the lens's view. A performer's
 *  guest thread is "everything addressed to that guest" (like the play
 *  app's booth); a DM room is that character's thread with that guest. */
export function roomMessages(room: Room | undefined, active: string, messages: CockpitMessage[], perspective: string, lens: LensKind): CockpitMessage[] {
  const ch = room?.channel ?? active
  const g = room?.dmGuest ?? null
  return messages
    .filter((m) => {
      if (room?.kind === 'guest' && g !== null) {
        // The performer's readouts about this guest ride their Inbox
        // (`dm:<C>`, `@<C>`, `about: <guest>`) — shown here too, where the
        // scan or the press that caused them happened.
        if (room.character !== null && isReadoutAbout(m, room.character, g)) return true
        return Array.isArray(m.audience) && m.audience.includes(g)
      }
      if (g !== null) return m.channel === ch && Array.isArray(m.audience) && m.audience.includes(g)
      return m.channel === ch
    })
    .filter((m) => messageInLens(m, perspective, lens))
    .sort((a, b) => a.seq - b.seq)
}

function roomsInput(
  channels: ChannelSummary[],
  messages: CockpitMessage[],
  roster: RosterRow[],
  factions: FactionSummary[],
  cast: CastSummary[],
  perspective: string,
  lens: Lens,
): RoomsInput {
  return { channels, messages, roster, factions, cast, perspective, lens }
}

/** The derived rooms list for the current lens, sorted for the sidebar. */
export function useRooms(): Room[] {
  const channels = useCockpit((s) => s.channels)
  const messages = useCockpit((s) => s.messages)
  const roster = useCockpit((s) => s.roster)
  const factions = useCockpit((s) => s.factions)
  const cast = useCockpit((s) => s.cast)
  const perspective = useCockpit((s) => s.perspective)
  const lens = useCockpit((s) => s.lens)
  return useMemo(
    () => buildRooms(roomsInput(channels, messages, roster, factions, cast, perspective, lens)),
    [channels, messages, roster, factions, cast, perspective, lens],
  )
}

/** Count of lens-visible messages per room key, for the sidebar badges. */
export function useRoomCounts(): Map<string, number> {
  const messages = useCockpit((s) => s.messages)
  const roster = useCockpit((s) => s.roster)
  const cast = useCockpit((s) => s.cast)
  const perspective = useCockpit((s) => s.perspective)
  return useMemo(() => {
    const lens = lensKindOf(perspective, roster, cast)
    const c = new Map<string, number>()
    for (const m of messages) {
      if (!messageInLens(m, perspective, lens)) continue
      const key = roomKeyOf(m)
      c.set(key, (c.get(key) ?? 0) + 1)
    }
    return c
  }, [messages, roster, cast, perspective])
}
