//! The Run → Print sheet (K-12, wave 54): turns `/api/mod/codes` and
//! `/api/mod/badges` into what a director prints on Letter paper.
//!
//! **Badges** (3 × 2 in, 10 to a sheet) are one QR per person: a staff badge
//! per performer part (`castLinks`: signs in as it; a new phone is refused and
//! asks a host), an invited badge per reserved program (`claims`: the claim and
//! a badge in one link) and the numbered blank badges (`B001`…, for everyone
//! else, with a write-in Program line). **Location cards** (3 × 2 in) are a
//! check-in card per room and the signs the story's `qr:` lines ask for (the
//! show: 🚻 Bathroom Mode, one per bathroom). **Fact cards** (four to a row, 20
//! to a sheet) are the codex entries by fact stack, banded in the stack's
//! colour. The **join poster** and the iPhone **door sign** stay posters.
//!
//! Wave 59: every card carries a text code, so nobody needs a camera to
//! "scan": typing it in the app does what the QR does (the server's
//! `routes/printed.ts`). The printed words are in-world: a room's real name is
//! a screen-only note, and a digit clue prints its code too (the schema keeps a
//! digit out of it). The hints are `DRAFT w59`.
//!
//! QRs are drawn here, in the browser (`qrcode` → inline SVG): `/api/qr`
//! allows 60/min per IP and a full run needs over 200. Pure, unit-tested in
//! `print-sheet.test.ts`.

import QRCode from 'qrcode'

/** `POST /e/:id/api/mod/codes` — the server's printable links. */
export interface PrintCodes {
  eventPass: string
  primePass: string
  modPass: string
  joinUrl: string
  /** `<base>/?code=<event>` (K-12). Absent on an older server. */
  joinLink?: string
  codex: Array<{ id: string; title: string; about: string | null; code: string; url: string }>
  /** Room check-in signs (K-12 → K-13's `?checkin=`). */
  checkin?: Array<{ id: string; label: string; slug: string; url: string; hidden: boolean; code?: string; place?: string | null }>
  /** Signs that press a guest's button (wave 54: the story's `qr:`). */
  actions?: Array<{ name: string; label: string; line: string; url: string; code?: string }>
  /** Codex id → its fact stack (`facts.json`). Absent → posters unsorted. */
  stacks?: Record<string, PrintStack>
  /** Each reserved program's invited badge (`?code=<guest code>&claim=
   *  <token>&badge=<code>`, wave 54). */
  claims?: Array<{ character: string; claim: string; url: string; ref: string; code: string }>
  /** Each part's staff badge (`?code=<guest code>&part=<code>`, wave 54):
   *  signs in as that part, taking it from a lost phone. */
  castLinks?: Array<{ character: string; part: string; url: string; code?: string }>
}

/** One printable badge (`POST /e/:id/api/mod/badges`, wave 23). */
export interface PrintBadge {
  n: number
  /** `B001`. */
  ref: string
  /** The printed code (`ABCD-EFGH`). */
  code: string
  /** `<base>/?code=<guest code>&badge=<code>`. */
  url: string
  /** The Person it is linked to, or null while blank. */
  holder: string | null
  name: string | null
}

/** `POST /e/:id/api/mod/badges {from, count}`. */
export interface PrintBadges {
  ok: boolean
  /** The highest badge number the server prints. */
  max: number
  badges: PrintBadge[]
}

/** Which printed pile a codex poster goes in (`routes/k12.ts` `CodexStack`). */
export interface PrintStack {
  /** `gold` / `green` / `blue` / `red` (whatever `facts.json` names). */
  colour: string
  /** The pile: `hunt answers`, or where the category's stack hides. */
  stack: string
  /** The document's own hiding place, `already placed`, or null. */
  where: string | null
}

/** The sheet's options beyond the codes. */
export interface PrintOptions {
  /** `/api/push/config`'s `homescreen` (K-31b on): the door sign tells an
   *  iPhone to Add to Home Screen first. Absent / false → "Scan to join". */
  homescreen?: boolean
  /** How many of each sign to print (`SIGN_DEFAULT_COPIES`). */
  signCopies?: number
}

/** The show's signs go on two bathroom doors. */
export const SIGN_DEFAULT_COPIES = 2

export const PrintKind = {
  Join: 'join',
  Door: 'door',
  Codex: 'codex',
  Room: 'room',
  Sign: 'sign',
  Cast: 'cast',
  Invite: 'invite',
  Badge: 'badge',
} as const
export type PrintKind = (typeof PrintKind)[keyof typeof PrintKind]

export interface PrintItem {
  /** Small id printed in the corner (`J1`, `D1`, `C07`, `R03`, `S1`, `P02`, `F04`, `B001`) — "which card?". */
  ref: string
  kind: PrintKind
  title: string
  /** The line under the title (what to do with it). */
  hint: string
  /** The text code, printed under the QR: typing it does what the QR does. */
  code: string
  /** What the QR encodes. */
  url: string
  /** Shown on screen only: a note for the director (e.g. a hidden room). */
  note: string | null
  /** Numbered instructions under the title (the door sign). */
  steps?: string[]
  /** A codex poster's fact stack: a coloured band + the pile, printed. */
  stack?: PrintStack | null
  /** An invited badge's reserved program (the screen-only 🔓 unlock names it). */
  character?: string
}

/** Every 3 × 2 in badge kind, in print order. */
export const BADGE_KINDS: readonly PrintKind[] = [PrintKind.Cast, PrintKind.Invite, PrintKind.Badge]
/** The location sheet's kinds, in print order. */
export const LOCATION_KINDS: readonly PrintKind[] = [PrintKind.Room, PrintKind.Sign]
/** The last line of every badge. One holder (wave 59): the card alone is
 *  refused on a new phone, and a host moves it. `DRAFT w59` */
export const LOST_PHONE = 'Lost your phone? Do it again, and a host can move you.'
/** A 3 × 2 in card sheet: two across, five down. */
export const SHEET_3X2 = 10
/** A fact card sheet: four across, five down. */
export const SHEET_FACTS = 20

/** `items` cut into sheets of `per`. */
export function sheetsOf<T>(items: readonly T[], per: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per))
  return out
}

/** Why these codes won't work on a phone at the party, or null. A printed
 *  QR can't be fixed later, so a console opened against a local server says
 *  so before anyone prints. */
export function printBaseProblem(joinUrl: string): string | null {
  let url: URL
  try {
    url = new URL(joinUrl)
  } catch {
    return `These codes point at "${joinUrl}", which is no address.`
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/u.test(url.hostname)
  return url.protocol !== 'https:' || local ? `These codes point at ${url.origin}. Phones at the party can't count on that: print from the live server.` : null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The door sign's words, in play's own order (`iosPushCopy`): K-31b on →
 *  join in Safari, then Add to Home Screen and open the icon (the session
 *  rides across, so joining again would make a second guest); off → a
 *  plain join sign that tells an iPhone to keep the page open. No show
 *  name: the sheet prints for any project. */
export function doorWording(homescreen: boolean): { title: string; hint: string; steps: string[] } {
  if (homescreen) {
    return {
      title: 'iPhone? Join, then Add to Home Screen',
      hint: '',
      steps: [
        'Scan with your Camera, open it in Safari and join with the code below.',
        'Tap Share, then Add to Home Screen.',
        "Open the new icon on your Home Screen. You'll still be you.",
        'Tap 🔔 Get alerts there.',
      ],
    }
  }
  return {
    title: 'Scan to join',
    hint: 'Open your camera, scan, and pick who you are.',
    steps: ['iPhone: keep this page open with the screen on (☰ → Keep my screen on) so you see every alert.'],
  }
}

/** Print order of the stacks: gold = the hunt answers first, then the
 *  rarity tiers commonest first (wave 35: green common, blue rare, purple
 *  very rare with the silver door digit clues, black legendary); any other
 *  colour after these, unstacked posters last. */
export const STACK_ORDER = ['gold', 'green', 'blue', 'purple', 'silver', 'black'] as const

/** The stack the door code's digit clues print in (wave 11: one clue = one
 *  digit, `facts.json` → `codexStacks`). Their pile line never holds a digit,
 *  and neither does their code (`core/src/facts.ts`), so nothing printed
 *  gives a digit away. */
export const DIGIT_CLUE_STACK = 'silver'

/** A poster on the digit-clue stack. */
export function isDigitClue(stack: PrintStack | null | undefined): boolean {
  return stack !== null && stack !== undefined && stack.colour.toLowerCase() === DIGIT_CLUE_STACK
}

export function stackRank(stack: PrintStack | null | undefined): number {
  if (!stack) return STACK_ORDER.length + 1
  const i = (STACK_ORDER as readonly string[]).indexOf(stack.colour.toLowerCase())
  return i < 0 ? STACK_ORDER.length : i
}

/** The band's ink: the named colours print true; anything else is grey
 *  (the colour name is printed as text either way). */
export function stackInk(colour: string): string {
  switch (colour.toLowerCase()) {
    case 'gold':
      return '#d4a017'
    case 'green':
      return '#16a34a'
    case 'blue':
      return '#2563eb'
    case 'purple':
      return '#7c3aed'
    case 'black':
      return '#111111'
    case 'silver':
      return '#8b98a5'
    default:
      return '#a1a1aa'
  }
}

/** Every card but the blank badges, in print order: join poster, door sign,
 *  fact cards (by stack: `STACK_ORDER`, then the rest, model order within
 *  one), room cards, signs, staff badges, invited badges. */
export function buildPrintItems(codes: PrintCodes, opts: PrintOptions = {}): PrintItem[] {
  const join = codes.joinLink ?? `${codes.joinUrl.replace(/\/+$/u, '')}/?code=${encodeURIComponent(codes.eventPass)}`
  const items: PrintItem[] = [
    {
      ref: 'J1',
      kind: PrintKind.Join,
      title: 'Scan to join',
      hint: 'Open your camera, scan, and pick who you are.',
      code: codes.eventPass,
      url: join,
      note: null,
    },
  ]
  const door = doorWording(opts.homescreen === true)
  items.push({ ref: 'D1', kind: PrintKind.Door, title: door.title, hint: door.hint, steps: door.steps, code: codes.eventPass, url: join, note: null })
  const stacks = codes.stacks ?? {}
  const stackOf = (id: string): PrintStack | null => (Object.hasOwn(stacks, id) ? stacks[id]! : null)
  // `sort` is stable, so model order holds within a stack.
  const codex = [...codes.codex].sort((a, b) => stackRank(stackOf(a.id)) - stackRank(stackOf(b.id)))
  codex.forEach((e, i) => {
    const stack = stackOf(e.id)
    items.push({
      ref: `C${pad(i + 1)}`,
      kind: PrintKind.Codex,
      title: e.title,
      hint: '',
      code: e.code,
      url: e.url,
      note: isDigitClue(stack) ? 'a digit clue' : e.about ? `about ${e.about}` : null,
      stack,
    })
  })
  ;(codes.checkin ?? []).forEach((r, i) =>
    items.push({
      ref: `R${pad(i + 1)}`,
      kind: PrintKind.Room,
      title: r.label,
      hint: 'Scan to enter this room. No camera? Type the code in 📷 Scan.',
      code: r.code ?? '',
      url: r.url,
      note: [r.place, r.hidden ? 'hidden until the story opens it' : null].filter((n): n is string => typeof n === 'string' && n !== '').join(' · ') || null,
    }),
  )
  // A sign presses a guest's button. The story's `qr:` line is its hint.
  const copies = opts.signCopies ?? SIGN_DEFAULT_COPIES
  ;(codes.actions ?? []).forEach((a, i) => {
    for (let n = 0; n < copies; n++) {
      items.push({
        ref: `S${(codes.actions ?? []).length > 1 ? `${i + 1}-` : ''}${n + 1}`,
        kind: PrintKind.Sign,
        title: a.label,
        hint: a.line,
        code: a.code ?? '',
        url: a.url,
        note: null,
      })
    }
  })
  // A staff badge is its performer's only: the QR or its code signs in as that
  // part (a lost phone's is refused and asks a host: one holder, wave 59), and
  // it carries the guest code, so new performer + moderator codes leave it good.
  ;(codes.castLinks ?? []).forEach((c, i) =>
    items.push({
      ref: `P${pad(i + 1)}`,
      kind: PrintKind.Cast,
      title: c.character,
      hint: `Scan to sign in, or type the code on the join screen. ${LOST_PHONE}`,
      code: c.code ?? '',
      url: c.url,
      note: `signs in as ${c.character} — this performer's only`,
    }),
  )
  // An invited badge opens one reserved program and links at join. The code
  // under it is the badge's own, and typed it finds the same program.
  ;(codes.claims ?? []).forEach((c) =>
    items.push({
      ref: c.ref,
      kind: PrintKind.Invite,
      title: c.character,
      hint: `Scan to start, or type the code on the join screen. ${LOST_PHONE}`,
      code: c.code,
      url: c.url,
      note: `invited badge — the QR claims ${c.character}`,
      character: c.character,
    }),
  )
  return items
}

/** How many badges the sheet asks for by default. */
export const BADGE_DEFAULT_COUNT = 60

/** The badge range to ask for: whole numbers, `from` in 1…max, `count` at
 *  least 1 and never past `max` (the server clamps the same way). */
export function badgeRange(from: number, count: number, max = 600): { from: number; count: number } {
  const f = Number.isFinite(from) ? Math.max(1, Math.min(max, Math.floor(from))) : 1
  const c = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : BADGE_DEFAULT_COUNT
  return { from: f, count: Math.min(c, max - f + 1) }
}

/** The blank badges (wave 23): the QR, the printed code (a guest can type
 *  it on the join screen), a write-in Program line (the component draws it)
 *  and the ref. A badge is blank until a guest links it; who holds one is a
 *  screen-only note. */
export function buildBadgeItems(badges: PrintBadge[]): PrintItem[] {
  return badges.map((b) => ({
    ref: b.ref,
    kind: PrintKind.Badge,
    title: 'Program',
    hint: `Scan to start, or type the code on the join screen. ${LOST_PHONE}`,
    code: b.code,
    url: b.url,
    note: b.holder !== null ? `linked to ${b.name ?? b.holder}` : null,
  }))
}

/** The next unprinted badge number after a printed batch (1 for none). */
export function nextBadgeFrom(badges: PrintBadge[]): number {
  return badges.reduce((m, b) => Math.max(m, b.n), 0) + 1
}

/** A fact stack's row in the toolbar: how many it holds, how many to print. */
export interface FactStackRow {
  colour: string
  label: string
  total: number
}

/** The fact stacks, in print order. */
export function factStacks(items: readonly PrintItem[]): FactStackRow[] {
  const rows = new Map<string, FactStackRow>()
  for (const i of items) {
    if (i.kind !== PrintKind.Codex) continue
    const colour = i.stack?.colour ?? 'none'
    const row = rows.get(colour)
    if (row === undefined) rows.set(colour, { colour, label: i.stack?.colour ?? 'unstacked', total: 1 })
    else row.total += 1
  }
  return [...rows.values()]
}

/** A few of each stack: the hunt answers and the digit notes are the show's,
 *  so they all print; a sample of the rest. */
export const FACT_SAMPLE = 4
export function defaultFactCount(colour: string, total: number): number {
  return colour.toLowerCase() === 'gold' || colour.toLowerCase() === DIGIT_CLUE_STACK ? total : Math.min(FACT_SAMPLE, total)
}

/** `items` with only the first `counts[colour]` cards of each fact stack
 *  (its default when unset); everything else passes through. */
export function limitFacts(items: readonly PrintItem[], counts: Readonly<Record<string, number>>): PrintItem[] {
  const totals = new Map(factStacks(items).map((r) => [r.colour, r.total]))
  const seen = new Map<string, number>()
  return items.filter((i) => {
    if (i.kind !== PrintKind.Codex) return true
    const colour = i.stack?.colour ?? 'none'
    const n = seen.get(colour) ?? 0
    seen.set(colour, n + 1)
    return n < (counts[colour] ?? defaultFactCount(colour, totals.get(colour) ?? 0))
  })
}

/** What sits in brackets is the crew's: the real room, on nothing printed. */
const inWorld = (text: string): string => text.replace(/\s*\([^()]*\)/gu, '')

/** The small line on a fact card: the colour, and the card's own hiding
 *  place when it has one, in-world. As on a poster, a digit clue keeps
 *  nothing that holds a digit. */
export function factLine(stack: PrintStack): string {
  const parts = [stack.colour.toUpperCase(), stack.where === null ? null : inWorld(stack.where)].filter((s): s is string => s !== null && s !== '')
  return (isDigitClue(stack) ? parts.filter((p) => !/\d/u.test(p)) : parts).join(' · ')
}

/** Cards per printed page, for the two posters. */
export type PerPage = 1 | 2 | 4

/** An inline SVG QR for `text` — black on white, a 2-module quiet zone,
 *  level M (a poster survives a crease or a thumb). */
export async function qrSvg(text: string): Promise<string> {
  return await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } })
}

// ---------------------------------------------------------------------------
// 🔓 A lost invitation's unlock (screen only)
// ---------------------------------------------------------------------------

export const UnlockPhase = { Idle: 'idle', Armed: 'armed', Busy: 'busy', Failed: 'failed' } as const
export type UnlockPhase = (typeof UnlockPhase)[keyof typeof UnlockPhase]

/** When a reserved program's open window closes: the live cast row's
 *  `unlockedUntil` (the server's truth), else this console's own unlock
 *  answer until the next snapshot lands; null = shut (or already closed). */
export function unlockOpenUntil(castUntil: number | undefined, local: number | null, now: number): number | null {
  const until = castUntil ?? local
  return until !== null && until > now ? until : null
}

/** The 🔓 button: the real window (a countdown, back to idle once it
 *  closes or a restart shuts it), a two-tap open, a two-tap shut. */
export function unlockButton(character: string, phase: UnlockPhase, openUntil: number | null, now: number): { label: string; title: string } {
  if (phase === UnlockPhase.Busy) return { label: '…', title: '' }
  if (openUntil !== null) {
    const s = Math.max(0, Math.ceil((openUntil - now) / 1000))
    const left = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    return phase === UnlockPhase.Armed
      ? { label: `tap again: shut ${character} now`, title: `Only its invitation takes ${character} again.` }
      : { label: `🔓 open · ${left} left`, title: `Anyone who picks ${character} now gets it. Tap twice to shut it early.` }
  }
  if (phase === UnlockPhase.Armed) return { label: `tap again: anyone may take ${character} for 2 min`, title: '' }
  return {
    label: phase === UnlockPhase.Failed ? '🔓 failed — again?' : '🔓 lost? open 2 min',
    title: `For a lost invitation: anyone who picks ${character} in the next two minutes gets it — do it with the guest beside you.`,
  }
}
