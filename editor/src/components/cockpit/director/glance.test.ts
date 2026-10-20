import { describe, expect, it } from 'vitest'
import type { CastSummary, ChannelSummary, CockpitMessage, FactsView, LedgerEntry, RosterRow, WatchSummary, WorldEntry } from '@/store/cockpit'
import { CockpitTab, SelectionKind } from '@/store/cockpit'
import { hostNeeds } from '@loom/core/host-board'
import {
  MASK,
  NeedKind,
  changedPaths,
  changedRecently,
  formatWatchValue,
  majorityOf,
  needLink,
  needsYou,
  peopleGlance,
  recentGlobals,
  refusalReason,
  secretHeads,
  staffFeed,
  staffReason,
  storyAgo,
  watchChipText,
  watchRows,
} from './glance'

const row = (id: string, name: string, extra: Partial<RosterRow> = {}): RosterRow => ({
  id,
  name,
  role: 'Program',
  faction: null,
  trueFaction: null,
  location: null,
  captured: false,
  score: 0,
  ...extra,
})
const w = (path: string, value: string): WorldEntry => ({ path, value })
const msg = (seq: number, channel: string, text: string): CockpitMessage => ({ seq, channel, from: 'Story', text, kind: 'line', ts: seq, audience: 'all' })
const CHANNELS: ChannelSummary[] = [
  { id: 'lobby', kind: 'lobby', title: 'Lobby', spaceId: 'story' },
  { id: 'room:hosts', kind: 'faction', title: '# hosts', spaceId: 'story', staff: true },
  { id: 'room:chatter', kind: 'open', title: '# chatter', spaceId: 'story' },
]

describe('needsYou', () => {
  it('needsYou lists refused, review filings, held transfers, offline parts, unvoiced agents', () => {
    const facts = {
      mode: 'review',
      questions: [{ id: 'Q1', filings: [{ person: 'p1', name: 'Ada', question: 'Q1', answer: 'x', confidence: 50, verdict: 'uncertain', final: null, at: 1 }] }],
    } as unknown as FactsView
    const wallet = { open: { transfers: [{ id: 't1', state: 'held' }, { id: 't2', state: 'pending' }], requests: [], offers: [] } } as never
    const cast: CastSummary[] = [
      { id: 'Clippy', faction: null, part: true, online: true, held: true },
      { id: 'Norton', faction: null, part: true, online: false, held: true },
      { id: 'McAfee', faction: null, part: true, online: false, held: false },
      { id: 'Trabolta', faction: null, agent: true, online: false },
      { id: 'Kernel', faction: null, part: false },
    ]
    const items = needsYou({
      refused: { cue: '❌ Wrong combination', at: 1000, seq: 4 },
      now: 2000,
      messages: [msg(3, 'room:hosts', 'old'), msg(5, 'room:chatter', 'chat'), msg(6, 'room:hosts', '❌ The bay is not armed.')],
      channels: CHANNELS,
      world: [],
      facts,
      wallet,
      cast,
      doorsOpen: true,
    })
    expect(items.map((i) => i.kind)).toEqual([NeedKind.Refused, NeedKind.Filings, NeedKind.Held, NeedKind.PhoneOffline, NeedKind.Free, NeedKind.NoWorker])
    expect(items[0]).toMatchObject({ text: '✕ ❌ Wrong combination not taken', detail: '❌ The bay is not armed.', link: { kind: 'tab', tab: CockpitTab.Chat, channel: 'room:hosts' } })
    expect(items[1]!.text).toBe('📝 1 filing to review')
    expect(items[2]!.text).toBe('💰 1 held transfer')
    expect(items[3]).toMatchObject({ text: '📱 Norton: phone offline', link: { kind: 'inspect', selection: { kind: 'character', id: 'Norton' } } })
    expect(items[4]!.text).toBe('🎭 McAfee: nobody signed in')
    expect(items[5]).toMatchObject({ text: '🤖 Trabolta: no worker', link: { tab: CockpitTab.Mind } })

    // A minute on, the refusal leaves; before the doors, parts say nothing;
    // auto judging asks for nobody.
    const later = needsYou({ refused: { cue: 'x', at: 0, seq: 0 }, now: 61_000, messages: [], channels: CHANNELS, world: [], facts: { ...facts, mode: 'auto' } as FactsView, wallet: null, cast, doorsOpen: false })
    expect(later.map((i) => i.kind)).toEqual([NeedKind.NoWorker])
  })

  it('wave 11: near misses in auto mode, a stalled or slow agent queue, and unseen guests with one-tap gone', () => {
    const base = { refused: null, messages: [], channels: CHANNELS, wallet: null, doorsOpen: true }
    const nearFacts = {
      mode: 'auto',
      questions: [
        {
          id: 'H2',
          filings: [
            { person: 'g-1', name: 'Excel', question: 'H2', answer: 'Mr Pickels', confidence: 100, verdict: 'lie', final: null, at: 1, near: { key: 'Mr. Pickles' } },
            { person: 'g-2', name: 'VLC', question: 'H2', answer: 'Garfield', confidence: 100, verdict: 'lie', final: 'lie', at: 2 },
          ],
        },
      ],
    } as unknown as FactsView
    const auto = needsYou({ ...base, now: 0, world: [], facts: nearFacts, cast: [] })
    expect(auto.map((i) => [i.kind, i.text])).toEqual([[NeedKind.NearMiss, '⚠ 1 near miss to judge']])
    expect(auto[0]!.link).toEqual({ kind: 'tab', tab: CockpitTab.Mind })
    // review mode folds the count into its own line
    const review = needsYou({ ...base, now: 0, world: [], facts: { ...nearFacts, mode: 'review' } as FactsView, cast: [] })
    expect(review.map((i) => i.text)).toEqual(['📝 1 filing to review (⚠ 1 near miss)'])

    const agent = (q: CastSummary['agentQueue']): CastSummary => ({ id: 'Trabolta', faction: null, agent: true, online: true, agentQueue: q })
    expect(needsYou({ ...base, now: 0, world: [], facts: null, cast: [agent({ depth: 4, oldestMs: 70_000, stalled: true })] }).map((i) => i.text)).toEqual([
      '🤖 Trabolta: ⛔ stalled · 4 waiting · oldest 1:10',
    ])
    expect(needsYou({ ...base, now: 0, world: [], facts: null, cast: [agent({ depth: 2, oldestMs: 45_000, stalled: false })] }).map((i) => i.kind)).toEqual([NeedKind.AgentQueue])
    // a short wait is no business of the director's
    expect(needsYou({ ...base, now: 0, world: [], facts: null, cast: [agent({ depth: 2, oldestMs: 5000, stalled: false })] })).toEqual([])
    // …until it has aged past the busy line on this console's clock (no new snapshot came)
    expect(needsYou({ ...base, now: 50_000, world: [], facts: null, cast: [agent({ depth: 2, oldestMs: 5000, stalled: false, receivedAt: 0 })] }).map((i) => i.text)).toEqual([
      '🤖 Trabolta: ⚠ 2 waiting · oldest 0:55',
    ])

    const now = 100 * 60_000
    const roster = [
      row('g-1', 'Excel', { lastSeen: now - 31 * 60_000 }),
      row('g-2', 'Winamp', { lastSeen: now - 50 * 60_000 }),
      row('g-3', 'VLC', { lastSeen: now - 5 * 60_000 }),
      row('g-4', 'Paint', { lastSeen: now - 50 * 60_000 }),
    ]
    const unseen = needsYou({ ...base, now, world: [w('g-4.gone', 'true')], facts: null, cast: [], roster })
    expect(unseen.map((i) => [i.kind, i.text])).toEqual([[NeedKind.Unseen, '👋 2 guests unseen 30 min — mark gone?']])
    expect(unseen[0]!.guests!.map((g) => g.id)).toEqual(['g-2', 'g-1'])
    expect(needsYou({ ...base, now, world: [], facts: null, cast: [], roster: [roster[0]!] })[0]!.text).toBe('👋 1 guest unseen 30 min — mark gone?')
  })

  it('a refusal waits 3 s for its reason, then says none came', () => {
    expect(refusalReason(null, CHANNELS, 1000)).toBe('waiting for the staff room…')
    expect(refusalReason(null, CHANNELS, 3000)).toBe('the story gave no reason')
    expect(refusalReason(msg(9, 'room:hosts', 'why'), CHANNELS, 10)).toBe('why')
  })

  it('a refusal with no staff room says the story gives no reason', () => {
    const [item] = needsYou({ refused: { cue: 'x', at: 0, seq: 0 }, now: 1, messages: [], channels: [], world: [], facts: null, wallet: null, cast: [], doorsOpen: true })
    expect(item!.detail).toBe('the story gives no reason here')
  })

  it('wave 13: every host-board target maps onto a glance link', () => {
    expect(needLink({ target: 'judge' }, CHANNELS)).toEqual({ kind: 'tab', tab: CockpitTab.Mind })
    expect(needLink({ target: 'agent', character: 'Trabolta' }, CHANNELS)).toEqual({ kind: 'tab', tab: CockpitTab.Mind })
    expect(needLink({ target: 'wallet' }, CHANNELS)).toEqual({ kind: 'tab', tab: CockpitTab.Run })
    expect(needLink({ target: 'more' }, CHANNELS)).toEqual({ kind: 'tab', tab: CockpitTab.Run })
    expect(needLink({ target: 'part', character: 'Norton' }, CHANNELS)).toEqual({ kind: 'inspect', selection: { kind: SelectionKind.Character, id: 'Norton' } })
    expect(needLink({ target: 'people' }, CHANNELS)).toEqual({ kind: 'tab', tab: CockpitTab.Roster })
    expect(needLink({ target: 'staff' }, CHANNELS)).toEqual({ kind: 'tab', tab: CockpitTab.Chat, channel: 'room:hosts' })
    expect(needLink({ target: 'staff' }, [])).toEqual({ kind: 'tab', tab: CockpitTab.Log })
  })

  it('wave 13: needsYou is the host board\'s rows (same order, copy and keys) after the refused press', () => {
    const cast: CastSummary[] = [
      { id: 'Norton', faction: null, part: true, online: false, held: true },
      { id: 'McAfee', faction: null, part: true, online: false, held: false },
      { id: 'Trabolta', faction: null, agent: true, online: false },
    ]
    const roster = [row('g1', 'Ada', { lastSeen: 0, online: false })]
    const input = { now: 40 * 60_000, world: [], facts: null, wallet: null, cast, doorsOpen: true, roster }
    const items = needsYou({ ...input, refused: { cue: '❌ Wrong', at: input.now - 10, seq: 0 }, messages: [], channels: CHANNELS })
    expect(items[0]!.kind).toBe(NeedKind.Refused)
    const rest = items.slice(1)
    const rows = hostNeeds(input)
    expect(rest.map((i) => [i.kind, i.key, i.text])).toEqual(rows.map((n) => [n.kind, n.key, n.text]))
    expect(rest.map((i) => i.key)).toEqual(['part:Norton', 'part:McAfee', 'agent:Trabolta', 'unseen'])
    expect(rest.find((i) => i.key === 'unseen')!.guests).toEqual([{ id: 'g1', name: 'Ada', lastSeen: 0 }])
  })
})

describe('watchRows', () => {
  const roster = [row('p1', 'Microsoft Excel', { online: true, location: 'The Server Room', faction: 'Unlimited Power' }), row('p2', 'Winamp'), row('p3', 'Clippy fan', { role: 'Program' })]
  const cast: CastSummary[] = [{ id: 'Microsoft Excel', faction: 'Staff' }, { id: 'MS Paint', faction: null, online: true }]
  const world = [w('p1.cleared', 'true'), w('p2.cleared', 'false'), w('p3.cleared', 'true'), w('Trabolta.cleared', 'true'), w('p1.trust', '3'), w('p2.trust', '7'), w('Night.clock', '"23:30"'), w('Kernel.door_code', '"4711"')]

  it('the narrow strip\'s Watch chip carries its first values, a secret masked', () => {
    const watch: WatchSummary[] = [
      { label: 'Y2K clock', path: 'Night.clock', person: null, scope: 'global' },
      { label: 'Door code', path: 'Kernel.door_code', person: null, scope: 'character', secret: true },
      { label: 'Cleared', path: 'Program.cleared', person: null, scope: 'role' },
    ]
    expect(watchChipText(watchRows(watch, world, roster, cast))).toBe('Y2K clock 23:30 · Door code •••• +1')
    expect(watchChipText(watchRows(watch.slice(2), world, roster, cast))).toBe('Cleared 2/3')
    expect(watchChipText([])).toBeNull()
  })

  it('a live while:-gated line comes first, above the fold, like the phone strip', () => {
    const watch: WatchSummary[] = [
      { label: 'Y2K clock', path: 'Night.clock', person: null, scope: 'global' },
      { label: 'Cleared', path: 'Program.cleared', person: null, scope: 'role' },
      { label: 'Wrong patches', path: 'Night.wrong', person: null, scope: 'global', gated: true },
      { label: 'At the heart', path: 'Night.heart', person: null, scope: 'global', gated: true },
    ]
    const rows = watchRows(watch, world, roster, cast)
    expect(rows.map((r) => r.label)).toEqual(['Wrong patches', 'At the heart', 'Y2K clock', 'Cleared'])
    // Keys stay the declared position, so a row keeps its identity as lines come and go.
    expect(rows[0]!.key).toBe('2:Night.wrong')
  })

  it('role aggregate counts bools over guests only', () => {
    const watch: WatchSummary[] = [
      { label: 'Cleared', path: 'Program.cleared', person: null, scope: 'role' },
      { label: 'Trust', path: 'Program.trust', person: null, scope: 'role' },
    ]
    const [cleared, trust] = watchRows(watch, world, roster, cast)
    expect(cleared).toMatchObject({ kind: 'role', slot: 'cleared', agg: { type: 'bool', count: 2, total: 3 } })
    expect(trust).toMatchObject({ kind: 'role', agg: { type: 'number', sum: 10, max: 7, total: 3 } })
  })

  it('person row resolves a guest by program name before the cast', () => {
    const rows = watchRows(
      [
        { label: 'Microsoft Excel', path: null, person: 'Microsoft Excel', scope: 'person' },
        { label: 'MS Paint', path: null, person: 'ms_paint', scope: 'person' },
      ],
      world,
      roster,
      cast,
    )
    expect(rows[0]).toMatchObject({ kind: 'person', id: 'p1', guest: true, online: true, location: 'The Server Room', faction: 'Unlimited Power' })
    expect(rows[1]).toMatchObject({ kind: 'person', id: 'MS Paint', guest: false, online: true })
  })

  it('secret values never formatted in clear', () => {
    const rows = watchRows(
      [
        { label: 'Y2K clock', path: 'Night.clock', person: null, scope: 'global' },
        { label: 'Door code', path: 'Kernel.door_code', person: null, scope: 'character', secret: true },
      ],
      world,
      roster,
      cast,
    )
    expect(rows[0]).toMatchObject({ kind: 'value', value: { text: '23:30' }, secret: false })
    expect(rows[1]).toMatchObject({ kind: 'value', value: { text: MASK }, secret: true })
    expect(JSON.stringify(rows)).not.toContain('4711')
  })

  it('formats bools, nothing, quotes and numbers', () => {
    expect(formatWatchValue('true')).toEqual({ text: '●', tone: 'true' })
    expect(formatWatchValue('false')).toEqual({ text: '○', tone: 'false' })
    expect(formatWatchValue(undefined).text).toBe('—')
    expect(formatWatchValue('none').text).toBe('—')
    expect(formatWatchValue('"y2k"')).toEqual({ text: 'y2k', tone: 'text' })
    expect(formatWatchValue('42').tone).toBe('number')
  })
})

describe('recentGlobals', () => {
  it('recentGlobals skips guests, cast, Time and _ leaves', () => {
    const ev = (seq: number, path: string, value: string): LedgerEntry => ({ seq, ts: seq * 1000, event: { type: 'worldSet', path, value } })
    const log = [
      ev(0, 'Night.phase', '"truth_1"'),
      ev(1, 'p1.score', '5'),
      ev(2, 'Time.hour', '23'),
      ev(3, 'Night._ask_at', '9'),
      ev(4, 'Kernel.majority', '"none"'),
      ev(5, 'Ivo_Marsh.mood', '"wry"'),
      ev(6, 'Night.round', '2'),
      ev(7, 'Night.phase', '"y2k"'),
      { seq: 8, event: { type: 'tick', elapsedMs: 1 } } as LedgerEntry,
    ]
    const rows = recentGlobals(log, [w('Night.phase', '"y2k"'), w('Night.round', '3')], ['p1'], ['Kernel', 'Ivo Marsh'], 8)
    expect(rows.map((r) => [r.path, r.value.text, r.at])).toEqual([
      ['Night.phase', 'y2k', 7000],
      ['Night.round', '3', 6000],
    ])
    expect(recentGlobals(log, [], [], [], 1)).toHaveLength(1)
  })
})

describe('peopleGlance', () => {
  it('majority tick is floor(n/2)+1', () => {
    expect([1, 2, 3, 4, 45].map(majorityOf)).toEqual([1, 2, 2, 3, 23])
    const roster = [row('p1', 'A', { online: true, restricted: true }), row('p2', 'B', { online: false }), row('p3', 'C', { online: true }), row('p4', 'D')]
    const g = peopleGlance(
      roster,
      [
        { id: 'Unlimited Power', hidden: true, revealed: false, members: ['p1', 'p2'] },
        { id: 'Hosts', hidden: false, revealed: false, members: ['Clippy'] },
        { id: 'The Way Out', hidden: true, revealed: true, members: ['p3'] },
      ],
      [
        { id: 'The Internet', label: 'The Internet', prison: true, occupants: ['p2'] },
        { id: 'Desktop', label: 'The Desktop', prison: false, occupants: ['p1', 'p3', 'p4'] },
        { id: 'RAM', label: null as unknown as string, prison: false, occupants: [] },
      ],
    )
    expect(g).toMatchObject({ joined: 4, online: 2, restricted: 1 })
    expect(g.factions).toEqual([
      { id: 'Unlimited Power', count: 2, joined: 4, majority: 3, hidden: true },
      { id: 'The Way Out', count: 1, joined: 4, majority: 3, hidden: false },
    ])
    expect(g.prisons).toEqual([{ id: 'The Internet', label: 'The Internet', people: [{ id: 'p2', name: 'B' }] }])
    expect(g.crowded).toEqual([
      { id: 'Desktop', label: 'The Desktop', count: 3 },
      { id: 'The Internet', label: 'The Internet', count: 1 },
    ])
    expect(peopleGlance([row('p1', 'A')], [], []).online).toBeNull()
  })
})

describe('the staff room', () => {
  it('staffFeed keeps only staff rooms', () => {
    const messages = [msg(1, 'room:hosts', 'one'), msg(2, 'lobby', 'hi'), msg(3, 'room:hosts', 'two'), { ...msg(4, 'room:hosts', 'gone'), hidden: true }, msg(5, 'room:hosts', 'three')]
    // Newest first: the line a director needs is on top.
    expect(staffFeed(messages, CHANNELS, 2).map((m) => m.text)).toEqual(['three', 'two'])
    expect(staffFeed(messages, CHANNELS.filter((c) => !c.staff), 5)).toEqual([])
    expect(staffReason(messages, CHANNELS, 3)?.text).toBe('three')
    expect(staffReason(messages, CHANNELS, 5)).toBeNull()
  })

  it('a refusal keeps its own reason, never a later # hosts line', () => {
    const messages = [msg(1, 'room:hosts', 'old'), msg(2, 'room:hosts', '❌ The bay is not armed…'), msg(3, 'lobby', 'hi'), msg(4, 'room:hosts', '🕊 Not yet: …')]
    expect(staffReason(messages, CHANNELS, 1)?.text).toBe('❌ The bay is not armed…')
  })
})

describe('changedPaths', () => {
  it('marks a value that moved, never one seen for the first time', () => {
    const first = changedPaths(new Map(), [w('Night.round', '1')], 1000)
    expect(changedRecently(first, 'Night.round', 1000)).toBe(false)
    const second = changedPaths(first, [w('Night.round', '2'), w('Night.new', 'x')], 5000)
    expect(changedRecently(second, 'Night.round', 6000)).toBe(true)
    expect(changedRecently(second, 'Night.new', 6000)).toBe(true)
    expect(changedRecently(second, 'Night.round', 15_001)).toBe(false)
    const same = changedPaths(second, [w('Night.round', '2')], 20_000)
    expect(same.get('Night.round')!.at).toBe(5000)
  })
})

describe('secretHeads', () => {
  it('masks a secret CHARACTER from the cast even with no live watch line on it', () => {
    const cast: CastSummary[] = [
      { id: 'Kernel', faction: null, secret: true },
      { id: 'Clippy', faction: null },
    ]
    expect([...secretHeads(cast, [])]).toEqual(['Kernel'])
    // An older server's cast carries no flag: a secret watch item still names it.
    const watch: WatchSummary[] = [{ label: 'Door code', path: 'Kernel.door_code', person: null, scope: 'character', secret: true }]
    expect([...secretHeads([{ id: 'Kernel', faction: null }], watch)]).toEqual(['Kernel'])
  })
})

describe('storyAgo', () => {
  it('reads story time since a line, never a clock past the hour', () => {
    expect(storyAgo(1000, 30_000)).toBe('now')
    expect(storyAgo(0, 12 * 60_000)).toBe('12m')
    expect(storyAgo(0, (75 * 60 + 45) * 1000)).toBe('1h15m')
    expect(storyAgo(undefined, 0)).toBe('—')
    expect(storyAgo(0, null)).toBe('—')
  })
})
