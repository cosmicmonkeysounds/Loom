// The perspective-aware room model: which rooms each lens lists, how DM
// threads fold, which messages count toward a lens's feed — and, with a
// lens projection in hand, the EXACT room set the play app would render.

import { describe, expect, it } from 'vitest'
import type { GuestView, PrimeView } from '@loom/core/views'
import { buildRooms, lensKindOf, LensKind, messageInLens, READ_ONLY_ROOMS, roomKeyOf, roomMessages, type RoomsInput } from './rooms'
import type { CockpitMessage, RosterRow } from '@/store/cockpit'

const g1: RosterRow = { id: 'g1', name: 'Ada', role: 'Guest', faction: 'Mods', trueFaction: 'Mods', location: 'Party', captured: false, score: 0 }
const g2: RosterRow = { id: 'g2', name: 'Bo', role: 'Guest', faction: null, trueFaction: null, location: null, captured: false, score: 0 }

function msg(partial: Partial<CockpitMessage> & Pick<CockpitMessage, 'seq' | 'channel' | 'audience'>): CockpitMessage {
  return { from: '', text: 'x', kind: 'line', ts: 0, ...partial }
}

const INPUT: RoomsInput = {
  channels: [
    { id: 'lobby', kind: 'lobby', title: 'The Internet', spaceId: 'internet' },
    { id: 'faction:Mods', kind: 'faction', title: '#mods', spaceId: 'internet' },
    { id: 'loc:Party', kind: 'location', title: 'The Party', spaceId: 'internet' },
    { id: 'room:backroom', kind: 'private', title: '# the-backroom', spaceId: 'internet' },
  ],
  messages: [
    msg({ seq: 0, channel: 'lobby', audience: 'all', kind: 'narration', from: 'Narrator' }),
    msg({ seq: 1, channel: 'dm:GREETER', channelKind: 'dm', audience: ['g1'], from: 'GREETER' }),
    msg({ seq: 2, channel: 'dm:GREETER', channelKind: 'dm', audience: ['g2'], from: 'GREETER' }),
    msg({ seq: 3, channel: 'room:backroom', channelKind: 'private', audience: ['g1'] }),
  ],
  roster: [g1, g2],
  factions: [{ id: 'Mods', hidden: false, revealed: false, members: ['g1'] }],
  cast: [{ id: 'Greeter', faction: 'Mods' }],
  perspective: 'operator',
}

describe('lens resolution', () => {
  it('maps ids to operator / guest / performer lenses', () => {
    expect(lensKindOf('operator', INPUT.roster, INPUT.cast)).toBe(LensKind.Operator)
    expect(lensKindOf('g1', INPUT.roster, INPUT.cast)).toBe(LensKind.Guest)
    expect(lensKindOf('Greeter', INPUT.roster, INPUT.cast)).toBe(LensKind.Performer)
    expect(lensKindOf('nobody', INPUT.roster, INPUT.cast)).toBe(LensKind.Operator)
  })

  it('applies the audience rule only to guest lenses', () => {
    const m = msg({ seq: 9, channel: 'lobby', audience: ['g2'] })
    expect(messageInLens(m, 'operator', LensKind.Operator)).toBe(true)
    expect(messageInLens(m, 'Greeter', LensKind.Performer)).toBe(true)
    expect(messageInLens(m, 'g1', LensKind.Guest)).toBe(false)
    expect(messageInLens(m, 'g2', LensKind.Guest)).toBe(true)
  })

  it('a guest lens never sees a hidden message; the operator does (greyed)', () => {
    const m = msg({ seq: 9, channel: 'lobby', audience: 'all', hidden: true })
    expect(messageInLens(m, 'g1', LensKind.Guest)).toBe(false)
    expect(messageInLens(m, 'operator', LensKind.Operator)).toBe(true)
    expect(messageInLens(m, 'Greeter', LensKind.Performer)).toBe(true)
  })
})

describe('buildRooms', () => {
  it('operator: every channel plus one room per (character × guest) DM thread', () => {
    const rooms = buildRooms(INPUT)
    const keys = rooms.map((r) => r.key)
    expect(keys).toContain('lobby')
    expect(keys).toContain('faction:Mods')
    expect(keys).toContain('loc:Party')
    expect(keys).toContain('room:backroom')
    expect(keys).toContain('dm:GREETER#g1')
    expect(keys).toContain('dm:GREETER#g2')
    // Per-guest DM titles carry both ends for the operator.
    expect(rooms.find((r) => r.key === 'dm:GREETER#g1')?.title).toBe('GREETER · Ada')
    // Sidebar order: lobby → faction → location → the rest.
    expect(keys.indexOf('lobby')).toBeLessThan(keys.indexOf('faction:Mods'))
    expect(keys.indexOf('faction:Mods')).toBeLessThan(keys.indexOf('loc:Party'))
    expect(keys.indexOf('loc:Party')).toBeLessThan(keys.indexOf('room:backroom'))
  })

  it("guest lens: their faction, every location, their DMs (folded), traffic-gated private rooms", () => {
    const rooms = buildRooms({ ...INPUT, perspective: 'g1' })
    const keys = rooms.map((r) => r.key)
    expect(keys).toContain('faction:Mods') // member
    expect(keys).toContain('loc:Party') // locations are open
    expect(keys).toContain('room:backroom') // has a message addressed to g1
    expect(keys).toContain('dm:GREETER#g1')
    expect(keys).not.toContain('dm:GREETER#g2') // another guest's thread
    // Their own DM folds to just the character's name.
    expect(rooms.find((r) => r.key === 'dm:GREETER#g1')?.title).toBe('GREETER')
  })

  it('guest lens: a non-member sees no faction channel and no gated room', () => {
    const rooms = buildRooms({ ...INPUT, perspective: 'g2' })
    const keys = rooms.map((r) => r.key)
    expect(keys).not.toContain('faction:Mods')
    expect(keys).not.toContain('room:backroom')
    expect(keys).toContain('dm:GREETER#g2')
    expect(keys).toContain('lobby')
  })

  it('performer lens (no projection yet): the full room set (they run every room)', () => {
    const rooms = buildRooms({ ...INPUT, perspective: 'Greeter' })
    const keys = rooms.map((r) => r.key)
    expect(keys).toContain('faction:Mods')
    expect(keys).toContain('room:backroom')
    expect(keys).toContain('dm:GREETER#g1')
    expect(keys).toContain('dm:GREETER#g2')
  })
})

describe('buildRooms with the identity projection (exact)', () => {
  const guestView = (over: Partial<GuestView>): GuestView => ({
    id: 'g2',
    name: 'Bo',
    title: 'The Internet',
    theme: 'plain',
    role: 'Guest',
    faction: null,
    score: 0,
    location: null,
    captured: false,
    restricted: false,
    canEscape: true,
    pendingChoice: null,
    decisionChannel: null,
    channels: [],
    spaces: [],
    roster: [],
    factions: [],
    groups: [],
    interactions: [],
    codex: [],
    codexTotal: 0,
    quests: [],
    questTotal: 0,
    people: [],
    cutscene: false,
    ...over,
  })

  it("guest: exactly the projection's channels (real member/canPost), the lobby, their faction, their DMs", () => {
    // Bo is NOT a Mods member and has no backroom traffic, but the server
    // says the backroom is visible to them (an invite the feed never showed).
    const lens = {
      kind: 'guest' as const,
      id: 'g2',
      view: guestView({
        channels: [
          { id: 'loc:Party', kind: 'location', title: 'The Party', spaceId: 'internet', member: false, canPost: false, threadable: true },
          { id: 'room:backroom', kind: 'private', title: '# the-backroom', spaceId: 'internet', member: true, canPost: true, threadable: true },
        ],
      }),
    }
    const rooms = buildRooms({ ...INPUT, perspective: 'g2', lens })
    const keys = rooms.map((r) => r.key)
    expect(keys).toContain('lobby')
    expect(keys).toContain('room:backroom') // exact, not traffic-gated
    expect(keys).not.toContain('faction:Mods') // not a member
    expect(keys).toContain('dm:GREETER#g2')
    expect(keys).not.toContain('dm:GREETER#g1')
    // The engine's post policy rides along: Bo is not standing in the Party.
    expect(rooms.find((r) => r.key === 'loc:Party')?.canPost).toBe(false)
    expect(rooms.find((r) => r.key === 'room:backroom')?.canPost).toBe(true)
    expect(rooms.find((r) => r.key === 'room:backroom')?.member).toBe(true)
  })

  it("guest: a secret allegiance's room stays hidden until revealed (no god-view leak)", () => {
    const lens = { kind: 'guest' as const, id: 'g1', view: guestView({ id: 'g1', channels: [] }) }
    const secret = { ...INPUT, factions: [{ id: 'Mods', hidden: true, revealed: false, members: ['g1'] }], perspective: 'g1', lens }
    expect(buildRooms(secret).map((r) => r.key)).not.toContain('faction:Mods')
    const exposed = { ...secret, factions: [{ id: 'Mods', hidden: true, revealed: true, members: ['g1'] }] }
    expect(buildRooms(exposed).map((r) => r.key)).toContain('faction:Mods')
  })

  it('guest: a projection for a different id is ignored (stale lens)', () => {
    const lens = { kind: 'guest' as const, id: 'g1', view: guestView({ id: 'g1', channels: [] }) }
    const rooms = buildRooms({ ...INPUT, perspective: 'g2', lens })
    // Falls back to the heuristic for g2.
    expect(rooms.map((r) => r.key)).toContain('dm:GREETER#g2')
  })

  it("performer: the projection's rooms plus one thread per guest (the booth)", () => {
    const view: PrimeView = {
      character: 'Greeter',
      title: 'The Internet',
      theme: 'plain',
      faction: 'Mods',
      guests: [
        { id: 'g1', name: 'Ada', faction: 'Mods', captured: false, restricted: false, location: null },
        { id: 'g2', name: 'Bo', faction: null, captured: false, restricted: false, location: null },
      ],
      channels: [{ id: 'room:backroom', kind: 'private', title: '# the-backroom', spaceId: 'internet', member: true, canPost: true, threadable: true }],
      spaces: [],
      interactions: [],
      legacyCapture: false,
      codex: [],
      codexTotal: 0,
      quests: [],
      questTotal: 0,
      agents: [],
    }
    const rooms = buildRooms({ ...INPUT, perspective: 'Greeter', lens: { kind: 'performer', id: 'Greeter', view } })
    const keys = rooms.map((r) => r.key)
    expect(keys).toContain('lobby')
    expect(keys).toContain('room:backroom')
    expect(keys).toContain('guest:g1')
    expect(keys).toContain('guest:g2')
    const thread = rooms.find((r) => r.key === 'guest:g1')!
    expect(thread).toMatchObject({ kind: 'guest', dmGuest: 'g1', character: 'Greeter', title: 'Ada' })
    // A guest thread is everything addressed to that guest, any channel.
    const msgs = roomMessages(thread, 'guest:g1', INPUT.messages, 'Greeter', LensKind.Performer)
    expect(msgs.map((m) => m.seq)).toEqual([1, 3])
    // Guest threads sort after the rooms.
    expect(keys.indexOf('room:backroom')).toBeLessThan(keys.indexOf('guest:g1'))
  })
})

describe('pinned rooms (Codex + Quest Log)', () => {
  it("each guest's own log is a room of its own, never a DM with a character", () => {
    const messages = [
      msg({ seq: 10, channel: 'quests', channelKind: 'quests', title: 'Quest Log', audience: ['g1'], kind: 'quest', from: 'Clippy' }),
      msg({ seq: 11, channel: 'quests', channelKind: 'quests', title: 'Quest Log', audience: ['g2'], kind: 'quest', from: 'Clippy' }),
      msg({ seq: 12, channel: 'codex', channelKind: 'codex', title: 'Codex', audience: ['g1'], kind: 'codex' }),
    ]
    const input = { ...INPUT, messages }
    const op = buildRooms(input).filter((r) => r.channel === 'quests' || r.channel === 'codex')
    expect(op.map((r) => [r.key, r.kind, r.dmGuest, r.character])).toEqual([
      ['codex#g1', 'codex', 'g1', null],
      ['quests#g1', 'quests', 'g1', null],
      ['quests#g2', 'quests', 'g2', null],
    ])
    const room = op.find((r) => r.key === 'quests#g2')
    expect(roomMessages(room, 'quests', messages, 'operator', LensKind.Operator).map((m) => m.seq)).toEqual([11])
  })
})

describe('wallet rows', () => {
  it("split per person under the operator lens — each guest's Wallet, and the approver booth's", () => {
    const messages = [
      msg({ seq: 20, channel: 'wallet', channelKind: 'wallet', title: 'Wallet', audience: ['g1'], kind: 'wallet' }),
      msg({ seq: 21, channel: 'wallet', channelKind: 'wallet', title: 'Wallet', audience: ['g2'], kind: 'wallet' }),
      msg({ seq: 22, channel: 'wallet', channelKind: 'wallet', title: 'Wallet', audience: ['@CRA_Agent_Software'], kind: 'wallet' }),
    ]
    const op = buildRooms({ ...INPUT, messages }).filter((r) => r.channel === 'wallet')
    expect(op.map((r) => [r.key, r.kind, r.title, r.dmGuest])).toEqual([
      ['wallet#g1', 'wallet', 'Wallet · Ada', 'g1'],
      ['wallet#g2', 'wallet', 'Wallet · Bo', 'g2'],
      ['wallet#@CRA_Agent_Software', 'wallet', 'Wallet · CRA Agent Software', '@CRA_Agent_Software'],
    ])
    expect(roomMessages(op[1], 'wallet', messages, 'operator', LensKind.Operator).map((m) => m.seq)).toEqual([21])
    expect(roomKeyOf(messages[2]!)).toBe('wallet#@CRA_Agent_Software')
  })

  it('a guest lens folds its own Wallet to one room', () => {
    const messages = [
      msg({ seq: 20, channel: 'wallet', channelKind: 'wallet', title: 'Wallet', audience: ['g1'], kind: 'wallet' }),
      msg({ seq: 21, channel: 'wallet', channelKind: 'wallet', title: 'Wallet', audience: ['g2'], kind: 'wallet' }),
    ]
    const mine = buildRooms({ ...INPUT, messages, perspective: 'g1' }).filter((r) => r.channel === 'wallet')
    expect(mine.map((r) => [r.key, r.title])).toEqual([['wallet#g1', 'Wallet']])
  })

  it('wallet, codex, quest and inbox rooms are read-only in the composer', () => {
    for (const k of ['wallet', 'codex', 'quests', 'inbox']) expect(READ_ONLY_ROOMS.has(k)).toBe(true)
    expect(READ_ONLY_ROOMS.has('dm')).toBe(false)
    expect(READ_ONLY_ROOMS.has('guest')).toBe(false)
  })
})

describe("performer lens: the booth's own pinned rooms", () => {
  const base: PrimeView = {
    character: 'Clippy',
    title: 'The Internet',
    theme: 'plain',
    faction: null,
    guests: [{ id: 'g1', name: 'Ada', faction: 'Mods', captured: false, restricted: false, location: null }],
    channels: [],
    spaces: [],
    interactions: [],
    legacyCapture: false,
    codex: [],
    codexTotal: 0,
    quests: [],
    questTotal: 0,
    agents: [],
  }
  const cast = [{ id: 'Clippy', faction: null }]
  const messages = [
    msg({ seq: 30, channel: 'quests', channelKind: 'quests', audience: ['@Clippy'], kind: 'quest' }),
    msg({ seq: 31, channel: 'quests', channelKind: 'quests', audience: ['g1'], kind: 'quest' }),
    msg({ seq: 32, channel: 'codex', channelKind: 'codex', audience: ['@Clippy'], kind: 'codex' }),
    msg({ seq: 33, channel: 'wallet', channelKind: 'wallet', audience: ['@Clippy'], kind: 'wallet' }),
    msg({ seq: 34, channel: 'wallet', channelKind: 'wallet', audience: ['@Norton'], kind: 'wallet' }),
    msg({ seq: 35, channel: 'dm:Clippy', channelKind: 'dm', audience: ['@Clippy'], kind: 'widget' }),
    msg({ seq: 36, channel: 'dm:Clippy', channelKind: 'dm', audience: ['g1'], from: 'Clippy' }),
  ]

  it('lists Quest Log / Codex / Wallet / Inbox right after the lobby, each holding only its @Clippy rows', () => {
    const view: PrimeView = { ...base, questTotal: 7, codexTotal: 3, wallet: { name: 'Truthcoin', queue: [], every: 3, windowMs: 60_000 } }
    const rooms = buildRooms({ ...INPUT, cast, messages, perspective: 'Clippy', lens: { kind: 'performer', id: 'Clippy', view } })
    expect(rooms.slice(0, 5).map((r) => r.key)).toEqual(['lobby', 'codex#@Clippy', 'dm:Clippy#@Clippy', 'quests#@Clippy', 'wallet#@Clippy'])
    const byKey = new Map(rooms.map((r) => [r.key, r]))
    expect(byKey.get('dm:Clippy#@Clippy')).toMatchObject({ kind: 'inbox', title: 'Inbox', dmGuest: '@Clippy', character: null, canPost: false })
    const seqs = (key: string) => roomMessages(byKey.get(key), key, messages, 'Clippy', LensKind.Performer).map((m) => m.seq)
    expect(seqs('quests#@Clippy')).toEqual([30])
    expect(seqs('codex#@Clippy')).toEqual([32])
    expect(seqs('wallet#@Clippy')).toEqual([33])
    expect(seqs('dm:Clippy#@Clippy')).toEqual([35])
    // Each room's key is the one its rows count toward (the rail badges).
    expect(messages.filter((m) => roomKeyOf(m) === 'wallet#@Clippy').map((m) => m.seq)).toEqual([33])
  })

  it('with no quests, no codex and no wallet, only the Inbox is added', () => {
    const rooms = buildRooms({ ...INPUT, cast, messages, perspective: 'Clippy', lens: { kind: 'performer', id: 'Clippy', view: base } })
    const keys = rooms.map((r) => r.key)
    expect(keys.filter((k) => k.endsWith('#@Clippy'))).toEqual(['dm:Clippy#@Clippy'])
    expect(keys).not.toContain('wallet#@Norton')
  })
})
