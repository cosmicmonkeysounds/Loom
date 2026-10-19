import { describe, expect, it } from 'vitest'
import { buildPrintItems, DIGIT_CLUE_STACK, doorWording, isDigitClue, PrintKind, qrSvg, stackInk, stackLine, stackRank, STACK_ORDER, unlockButton, unlockOpenUntil, UnlockPhase, type PrintCodes } from './print-sheet'

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

  it('prints one cast card per part with the performer passcode link, last', () => {
    const items = buildPrintItems({ ...CODES, joinUrl: 'https://app.example.com/', primePass: 'PERF 9', cast: ['Clippy', 'Task Manager'] })
    const cast = items.filter((i) => i.kind === PrintKind.Cast)
    expect(cast.map((i) => [i.ref, i.title, i.hint, i.code, i.url])).toEqual([
      ['P01', 'Clippy', 'Scan, then pick Clippy.', 'PERF 9', 'https://app.example.com/?code=PERF%209'],
      ['P02', 'Task Manager', 'Scan, then pick Task Manager.', 'PERF 9', 'https://app.example.com/?code=PERF%209'],
    ])
    expect(items.at(-1)!.ref).toBe('P02')
    expect(cast[0]!.note).toMatch(/never post/)
    // never the moderator code
    expect(items.some((i) => i.code === CODES.modPass || i.url.includes(`code=${CODES.modPass}`))).toBe(false)
  })

  it('sorts codex posters by stack gold → green → blue → red → unstacked, stable within a stack', () => {
    const entry = (id: string) => ({ id, title: id, about: null, code: id.toLowerCase(), url: `u/${id}` })
    const items = buildPrintItems({
      ...CODES,
      codex: ['Lore', 'Red1', 'Blue1', 'Green1', 'Gold1', 'Green2', 'Odd', 'Gold2'].map(entry),
      stacks: {
        Red1: { colour: 'red', stack: 'deepest', where: null },
        Blue1: { colour: 'blue', stack: 'deep', where: null },
        Green1: { colour: 'green', stack: 'shelf', where: 'already placed' },
        Green2: { colour: 'Green', stack: 'shelf', where: null },
        Gold1: { colour: 'gold', stack: 'hunt answers', where: 'volume B' },
        Gold2: { colour: 'gold', stack: 'hunt answers', where: 'the atlas' },
        Odd: { colour: 'purple', stack: 'elsewhere', where: null },
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
    expect(stackLine(items[0]!.stack!)).toBe('GOLD · hunt answers · volume B')
    expect(stackLine(items[5]!.stack!)).toBe('RED · deepest')
    expect(stackInk('gold')).not.toBe(stackInk('purple'))
    expect(stackRank(null)).toBeGreaterThan(stackRank({ colour: 'purple', stack: '', where: null }))
  })

  it('wave 11: the door code\'s digit clues sit on their own silver stack and print title + QR only', () => {
    const entry = (id: string, code: string) => ({ id, title: id, about: null, code, url: `https://app.example.com/?code=EVT777&unlock=${code}` })
    const items = buildPrintItems({
      ...CODES,
      codex: [entry('The First Note', 'first-note'), entry('Red1', 'red1'), entry('Lore', 'lore'), entry('The Second Note', 'second-note')],
      stacks: {
        'The First Note': { colour: 'silver', stack: 'the cold door', where: 'behind the fridge magnet 4' },
        'The Second Note': { colour: 'Silver', stack: 'the cold door', where: 'under the stairs' },
        Red1: { colour: 'red', stack: 'deepest', where: null },
      },
    }).filter((i) => i.kind === PrintKind.Codex)
    // silver prints after red, before an unstacked poster
    expect(items.map((i) => i.title)).toEqual(['Red1', 'The First Note', 'The Second Note', 'Lore'])
    expect(STACK_ORDER.indexOf(DIGIT_CLUE_STACK)).toBeGreaterThan(STACK_ORDER.indexOf('red'))
    const clues = items.filter((i) => isDigitClue(i.stack))
    expect(clues).toHaveLength(2)
    for (const c of clues) {
      expect(c.code).toBe('')
      expect(c.hint).not.toMatch(/type/)
      // nothing printed holds a digit (the QR's link is the only way in)
      expect([c.title, c.hint, c.code, stackLine(c.stack!)].join(' ')).not.toMatch(/\d/)
    }
    expect(stackLine(clues[0]!.stack!)).toBe('SILVER · the cold door')
    expect(stackLine(clues[1]!.stack!)).toBe('SILVER · the cold door · under the stairs')
    expect(stackInk('silver')).not.toBe(stackInk('purple'))
    // every other poster keeps its typed code
    expect(items.find((i) => i.title === 'Red1')!.code).toBe('red1')
  })

  it('wave 11: one invitation per reserved program, last, with the claim link and no typed code', () => {
    const items = buildPrintItems({
      ...CODES,
      cast: ['Clippy'],
      claims: [
        { character: 'Microsoft Excel', claim: 'tok-excel', url: 'https://app.example.com/?code=EVT777&claim=tok-excel' },
        { character: 'MS Paint', claim: 'tok-paint', url: 'https://app.example.com/?code=EVT777&claim=tok-paint' },
      ],
    })
    const invites = items.filter((i) => i.kind === PrintKind.Invite)
    expect(invites.map((i) => [i.ref, i.title, i.code, i.url, i.character])).toEqual([
      ['I01', 'Microsoft Excel', '', 'https://app.example.com/?code=EVT777&claim=tok-excel', 'Microsoft Excel'],
      ['I02', 'MS Paint', '', 'https://app.example.com/?code=EVT777&claim=tok-paint', 'MS Paint'],
    ])
    expect(items.at(-1)!.ref).toBe('I02')
    // the claim token is never printed as text
    for (const i of invites) expect([i.title, i.hint, i.code].join(' ')).not.toMatch(/tok-/)
    expect(invites[0]!.hint).toMatch(/join as Microsoft Excel/)
    // an older server: no invitations
    expect(buildPrintItems(CODES).filter((i) => i.kind === PrintKind.Invite)).toEqual([])
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
