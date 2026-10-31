import { describe, expect, it } from 'vitest'
import { BADGE_DEFAULT_COUNT, BADGE_KINDS, badgeRange, buildBadgeItems, buildPrintItems, defaultFactCount, DIGIT_CLUE_STACK, doorWording, factLine, factStacks, isDigitClue, limitFacts, LOCATION_KINDS, nextBadgeFrom, printBaseProblem, PrintKind, qrSvg, SHEET_3X2, SHEET_FACTS, sheetsOf, SIGN_DEFAULT_COPIES, STACK_ORDER, stackInk, stackRank, unlockButton, unlockOpenUntil, UnlockPhase, type PrintBadge, type PrintCodes } from './print-sheet'

const CODES: PrintCodes = {
  eventPass: 'EVT777',
  primePass: 'P',
  modPass: 'M',
  joinUrl: 'https://app.example.com',
  joinLink: 'https://app.example.com/?code=EVT777',
  codex: [
    { id: 'The Sandy File', title: 'The Sandy File', about: 'Trabolta', code: 'sandy1997', url: 'https://app.example.com/?code=EVT777&unlock=sandy1997' },
    { id: 'The Billboard', title: 'The Billboard', about: null, code: 'bill', url: 'https://app.example.com/?code=EVT777&unlock=bill' },
  ],
  checkin: [
    { id: 'The Desktop', label: 'The Desktop (living room)', slug: 'the-desktop', url: 'https://app.example.com/?code=EVT777&checkin=the-desktop', hidden: false },
    { id: 'The Cache', label: 'The Cache (kitchen)', slug: 'the-cache', url: 'https://app.example.com/?code=EVT777&checkin=the-cache', hidden: true },
  ],
}

describe('print sheet', () => {
  it('orders join → door → codex → rooms with stable refs and the typed fallback', () => {
    const items = buildPrintItems(CODES)
    expect(items.map((i) => [i.ref, i.kind, i.code])).toEqual([
      ['J1', PrintKind.Join, 'EVT777'],
      ['D1', PrintKind.Door, 'EVT777'],
      ['C01', PrintKind.Codex, 'sandy1997'],
      ['C02', PrintKind.Codex, 'bill'],
      // a room sign prints no code: a slug typed into the Codex is a `wrong code`
      ['R01', PrintKind.Room, ''],
      ['R02', PrintKind.Room, ''],
    ])
    expect(items[4]!.url).toContain('checkin=the-desktop')
    expect(items[0]!.url).toBe('https://app.example.com/?code=EVT777')
    expect(items[4]!.title).toBe('The Desktop (living room)')
    expect(items[5]!.note).toMatch(/hidden/)
    expect(items[2]!.note).toBe('about Trabolta')
    expect(items[2]!.stack).toBeNull()
  })

  it('words the door sign off the push config: Scan to join by default, Add to Home Screen when K-31b is on', () => {
    const off = buildPrintItems(CODES).find((i) => i.kind === PrintKind.Door)!
    expect(off.title).toBe('Scan to join')
    expect(off.url).toBe('https://app.example.com/?code=EVT777')
    expect(off.steps!.join(' ')).toMatch(/keep this page open/)
    expect(buildPrintItems(CODES, { homescreen: false }).find((i) => i.kind === PrintKind.Door)!.title).toBe('Scan to join')
    const on = buildPrintItems(CODES, { homescreen: true }).find((i) => i.kind === PrintKind.Door)!
    expect(on.title).toBe('iPhone? Join, then Add to Home Screen')
    expect(on.steps).toEqual(doorWording(true).steps)
    expect(on.steps!.join(' ')).toMatch(/Add to Home Screen/)
    // play's own order: join in Safari FIRST, then add (joining again in the
    // Home Screen app would claim the name twice) — and no show name
    expect(on.steps![0]).toMatch(/join with the code/)
    expect(on.steps!.slice(1).join(' ')).not.toMatch(/\bjoin\b/i)
    for (const w of [doorWording(true), doorWording(false)]) expect([w.title, w.hint, ...w.steps].join(' ')).not.toMatch(/Trapped/)
    // the speakable fallback is the event code, never a codex code
    expect(on.code).toBe('EVT777')
    expect(on.url).toBe(off.url)
  })

  it('wave 54: one staff badge per part: its own link, no passcode and no part code in print', () => {
    const items = buildPrintItems({
      ...CODES,
      primePass: 'PERF9',
      castLinks: [
        { character: 'Clippy', part: 'pc-clippy', url: 'https://app.example.com/?code=EVT777&part=pc-clippy' },
        { character: 'Task Manager', part: 'pc-task', url: 'https://app.example.com/?code=EVT777&part=pc-task' },
      ],
    })
    const cast = items.filter((i) => i.kind === PrintKind.Cast)
    expect(cast.map((i) => [i.ref, i.title, i.code, i.url])).toEqual([
      ['P01', 'Clippy', '', 'https://app.example.com/?code=EVT777&part=pc-clippy'],
      ['P02', 'Task Manager', '', 'https://app.example.com/?code=EVT777&part=pc-task'],
    ])
    expect(cast[0]!.hint).toMatch(/Lost your phone/)
    expect(cast[0]!.note).toMatch(/Clippy/)
    for (const c of cast) expect([c.title, c.hint, c.code].join(' ')).not.toMatch(/pc-|PERF9/)
    // no moderator or performer code anywhere on any card
    expect(items.some((i) => i.code === CODES.modPass || i.code === 'PERF9')).toBe(false)
  })

  it('sorts codex posters by stack gold → green → blue → purple → unstacked, stable within a stack', () => {
    const entry = (id: string) => ({ id, title: id, about: null, code: id.toLowerCase(), url: `u/${id}` })
    const items = buildPrintItems({
      ...CODES,
      codex: ['Lore', 'Red1', 'Blue1', 'Green1', 'Gold1', 'Green2', 'Odd', 'Gold2'].map(entry),
      stacks: {
        Red1: { colour: 'purple', stack: 'deepest', where: null },
        Blue1: { colour: 'blue', stack: 'deep', where: null },
        Green1: { colour: 'green', stack: 'shelf', where: 'already placed' },
        Green2: { colour: 'Green', stack: 'shelf', where: null },
        Gold1: { colour: 'gold', stack: 'hunt answers', where: 'volume B' },
        Gold2: { colour: 'gold', stack: 'hunt answers', where: 'the atlas' },
        Odd: { colour: 'orange', stack: 'elsewhere', where: null },
      },
    }).filter((i) => i.kind === PrintKind.Codex)
    expect(items.map((i) => [i.ref, i.title])).toEqual([
      ['C01', 'Gold1'],
      ['C02', 'Gold2'],
      ['C03', 'Green1'],
      ['C04', 'Green2'],
      ['C05', 'Blue1'],
      ['C06', 'Red1'],
      ['C07', 'Odd'],
      ['C08', 'Lore'],
    ])
    expect(factLine(items[0]!.stack!)).toMatch(/^GOLD · /u)
    expect(factLine(items[5]!.stack!)).toBe('PURPLE')
    expect(stackInk('gold')).not.toBe(stackInk('purple'))
    expect(stackInk('black')).not.toBe(stackInk('orange'))
    expect(stackRank(null)).toBeGreaterThan(stackRank({ colour: 'orange', stack: '', where: null }))
  })

  it('wave 11: the door code\'s digit clues sit on their own silver stack and print title + QR only', () => {
    const entry = (id: string, code: string) => ({ id, title: id, about: null, code, url: `https://app.example.com/?code=EVT777&unlock=${code}` })
    const items = buildPrintItems({
      ...CODES,
      codex: [entry('The First Note', 'first-note'), entry('Red1', 'red1'), entry('Lore', 'lore'), entry('The Second Note', 'second-note')],
      stacks: {
        'The First Note': { colour: 'silver', stack: 'the cold door', where: 'behind the fridge magnet 4' },
        'The Second Note': { colour: 'Silver', stack: 'the cold door', where: 'under the stairs' },
        Red1: { colour: 'purple', stack: 'deepest', where: null },
      },
    }).filter((i) => i.kind === PrintKind.Codex)
    // silver prints after purple (very rare), before an unstacked poster
    expect(items.map((i) => i.title)).toEqual(['Red1', 'The First Note', 'The Second Note', 'Lore'])
    expect(STACK_ORDER.indexOf(DIGIT_CLUE_STACK)).toBeGreaterThan(STACK_ORDER.indexOf('purple'))
    const clues = items.filter((i) => isDigitClue(i.stack))
    expect(clues).toHaveLength(2)
    for (const c of clues) {
      expect(c.code).not.toBe('')
      // nothing printed holds a digit (the schema keeps one out of the code)
      expect([c.title, c.hint, c.code, factLine(c.stack!)].join(' ')).not.toMatch(/\d/)
    }
    expect(factLine(clues[0]!.stack!)).toBe('SILVER')
    expect(factLine(clues[1]!.stack!)).toBe('SILVER · under the stairs')
    expect(stackInk('silver')).not.toBe(stackInk('purple'))
    // every other poster keeps its typed code
    expect(items.find((i) => i.title === 'Red1')!.code).toBe('red1')
  })

  it('wave 54: one invited badge per reserved program, last: the printed code is the badge\'s, the claim stays in the QR', () => {
    const items = buildPrintItems({
      ...CODES,
      claims: [
        { character: 'Microsoft Excel', claim: 'tok-excel', ref: 'F01', code: 'AAAA-BBBB', url: 'https://app.example.com/?code=EVT777&claim=tok-excel&badge=aaaabbbb' },
        { character: 'MS Paint', claim: 'tok-paint', ref: 'F02', code: 'CCCC-DDDD', url: 'https://app.example.com/?code=EVT777&claim=tok-paint&badge=ccccdddd' },
      ],
    })
    const invites = items.filter((i) => i.kind === PrintKind.Invite)
    expect(invites.map((i) => [i.ref, i.title, i.code, i.character])).toEqual([
      ['F01', 'Microsoft Excel', 'AAAA-BBBB', 'Microsoft Excel'],
      ['F02', 'MS Paint', 'CCCC-DDDD', 'MS Paint'],
    ])
    expect(items.at(-1)!.ref).toBe('F02')
    for (const i of invites) expect([i.title, i.hint, i.code].join(' ')).not.toMatch(/tok-/)
    expect(buildPrintItems(CODES).filter((i) => i.kind === PrintKind.Invite)).toEqual([])
  })

  it('wave 54: a sign per `qr:` line, as many copies as doors, with the location cards', () => {
    const actions = [{ name: 'go to the bathroom', label: '🚻 Bathroom Mode', line: 'Scan on your way in.', url: 'https://app.example.com/?code=EVT777&act=go%20to%20the%20bathroom' }]
    const two = buildPrintItems({ ...CODES, actions }).filter((i) => i.kind === PrintKind.Sign)
    expect(SIGN_DEFAULT_COPIES).toBe(2)
    expect(two.map((i) => [i.ref, i.title, i.hint, i.code])).toEqual([
      ['S1', '🚻 Bathroom Mode', 'Scan on your way in.', ''],
      ['S2', '🚻 Bathroom Mode', 'Scan on your way in.', ''],
    ])
    expect(buildPrintItems({ ...CODES, actions }, { signCopies: 3 }).filter((i) => i.kind === PrintKind.Sign)).toHaveLength(3)
    expect(LOCATION_KINDS).toEqual([PrintKind.Room, PrintKind.Sign])
  })

  it('wave 54: every badge kind prints on the one 3 × 2 run: staff, invited, blank', () => {
    expect(BADGE_KINDS).toEqual([PrintKind.Cast, PrintKind.Invite, PrintKind.Badge])
  })

  it('wave 54: sheets hold exactly their cards', () => {
    const cards = Array.from({ length: 23 }, (_, i) => i)
    expect(sheetsOf(cards, SHEET_3X2).map((s) => s.length)).toEqual([10, 10, 3])
    expect(sheetsOf(cards, SHEET_FACTS).map((s) => s.length)).toEqual([20, 3])
    expect(sheetsOf([], SHEET_3X2)).toEqual([])
  })

  it('wave 54: a few of each fact stack: all of the show\'s own piles, a sample of the rest, and the count is the director\'s', () => {
    const entry = (id: string) => ({ id, title: id, about: null, code: id, url: `https://app.example.com/?code=EVT777&unlock=${id}` })
    const ids = ['g1', 'g2', 'g3', 'g4', 'g5', 's1', 's2', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']
    const stacks = Object.fromEntries(ids.map((id) => [id, { colour: id.startsWith('g') ? 'gold' : id.startsWith('s') ? 'silver' : 'green', stack: 'pile', where: null }]))
    const items = buildPrintItems({ ...CODES, codex: ids.map(entry), stacks, checkin: undefined })
    expect(factStacks(items).map((r) => [r.colour, r.total])).toEqual([['gold', 5], ['green', 6], ['silver', 2]])
    const facts = (counts: Record<string, number>) => limitFacts(items, counts).filter((i) => i.kind === PrintKind.Codex).map((i) => i.title)
    expect(facts({})).toEqual(['g1', 'g2', 'g3', 'g4', 'g5', 'c1', 'c2', 'c3', 'c4', 's1', 's2'])
    expect(defaultFactCount('green', 2)).toBe(2)
    expect(facts({ green: 6 })).toHaveLength(13)
    expect(facts({ gold: 0, green: 1 })).toEqual(['c1', 's1', 's2'])
    // nothing else is touched
    expect(limitFacts(items, { gold: 0 }).some((i) => i.kind === PrintKind.Join)).toBe(true)
  })

  it('wave 54: a local address is called out before anything prints', () => {
    expect(printBaseProblem('https://app.example.com')).toBeNull()
    for (const u of ['http://localhost:7000', 'http://192.168.1.20:7000', 'https://127.0.0.1', 'http://party.local', 'nope']) expect(printBaseProblem(u)).not.toBeNull()
  })

  it('falls back to building the join link on an older server (no rooms)', () => {
    const items = buildPrintItems({ ...CODES, joinLink: undefined, checkin: undefined, joinUrl: 'http://party.local:7000/' })
    expect(items[0]!.url).toBe('http://party.local:7000/?code=EVT777')
    expect(items.filter((i) => i.kind === PrintKind.Room)).toEqual([])
    expect(items.filter((i) => i.kind === PrintKind.Cast)).toEqual([])
  })

  it('draws QRs locally as SVG — no /api/qr round-trip', async () => {
    const svg = await qrSvg(CODES.codex[0]!.url)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('#000000')
    expect(await qrSvg('a')).not.toBe(svg)
  })
})

describe('badges (wave 23)', () => {
  const badge = (n: number, holder: string | null = null, name: string | null = null): PrintBadge => ({
    n,
    ref: `B${String(n).padStart(3, '0')}`,
    code: `CODE-${String(n).padStart(4, '0')}`,
    url: `https://app.example.com/?code=EVT777&badge=c${n}`,
    holder,
    name,
  })

  it('one badge card per badge: QR of its link, the printed code, the ref; who holds it on screen only', () => {
    const items = buildBadgeItems([badge(1), badge(2, 'g-7', 'Microsoft Excel'), badge(3, 'g-9', null)])
    expect(items.map((i) => [i.ref, i.kind, i.code, i.url])).toEqual([
      ['B001', PrintKind.Badge, 'CODE-0001', 'https://app.example.com/?code=EVT777&badge=c1'],
      ['B002', PrintKind.Badge, 'CODE-0002', 'https://app.example.com/?code=EVT777&badge=c2'],
      ['B003', PrintKind.Badge, 'CODE-0003', 'https://app.example.com/?code=EVT777&badge=c3'],
    ])
    expect(items[0]!.note).toBeNull()
    expect(items[1]!.note).toBe('linked to Microsoft Excel')
    expect(items[2]!.note).toBe('linked to g-9')
    expect(items[0]!.hint).toMatch(/Scan to start/)
    expect(items[0]!.hint).toMatch(/Lost your phone/)
    expect(buildBadgeItems([])).toEqual([])
  })

  it('clamps the asked range like the server and names the next batch', () => {
    expect(BADGE_DEFAULT_COUNT).toBe(60)
    expect(badgeRange(1, 60)).toEqual({ from: 1, count: 60 })
    expect(badgeRange(61.7, 20.2)).toEqual({ from: 61, count: 20 })
    expect(badgeRange(0, 0)).toEqual({ from: 1, count: 1 })
    expect(badgeRange(590, 60)).toEqual({ from: 590, count: 11 })
    expect(badgeRange(Number.NaN, Number.NaN)).toEqual({ from: 1, count: 60 })
    expect(badgeRange(9999, 5)).toEqual({ from: 600, count: 1 })
    expect(nextBadgeFrom([badge(61), badge(120), badge(62)])).toBe(121)
    expect(nextBadgeFrom([])).toBe(1)
  })
})

describe('🔓 a lost invitation (wave 11 C5)', () => {
  const NOW = 1_000_000
  it('the window is the cast row’s unlockedUntil, else this console’s answer; a closed one is shut', () => {
    expect(unlockOpenUntil(NOW + 90_000, null, NOW)).toBe(NOW + 90_000)
    expect(unlockOpenUntil(undefined, NOW + 30_000, NOW)).toBe(NOW + 30_000)
    expect(unlockOpenUntil(undefined, null, NOW)).toBeNull()
    // the window closed: back to idle even with no new snapshot
    expect(unlockOpenUntil(NOW - 1, null, NOW)).toBeNull()
    expect(unlockOpenUntil(undefined, NOW - 1, NOW)).toBeNull()
  })

  it('the label counts the real window down and never says open once it closed', () => {
    expect(unlockButton('Excel', UnlockPhase.Idle, null, NOW).label).toBe('🔓 lost? open 2 min')
    expect(unlockButton('Excel', UnlockPhase.Armed, null, NOW).label).toBe('tap again: anyone may take Excel for 2 min')
    expect(unlockButton('Excel', UnlockPhase.Idle, NOW + 102_000, NOW).label).toBe('🔓 open · 1:42 left')
    expect(unlockButton('Excel', UnlockPhase.Armed, NOW + 102_000, NOW).label).toBe('tap again: shut Excel now')
    expect(unlockButton('Excel', UnlockPhase.Failed, null, NOW).label).toBe('🔓 failed — again?')
    // after the window: the same button reads idle, not "open"
    const after = unlockButton('Excel', UnlockPhase.Idle, unlockOpenUntil(NOW + 1000, null, NOW + 5000), NOW + 5000)
    expect(after.label).toBe('🔓 lost? open 2 min')
  })
})
