//! The Run → Print sheet (K-12): turns `/api/mod/codes` into the cards a
//! director prints — the join poster, the iPhone door sign (SW-QR-11), one
//! poster per codex entry (title + QR + the typed code; sorted and banded
//! by fact stack, K-12-stacks), one check-in sign per room (QR + room name
//! only — no typed code), one business-card cast card per performer part
//! (wave 23: that part's own `castLinks` QR, which signs in as it and takes
//! it back from a lost phone; the performer passcode QR on an older server,
//! SW-QR-11), on their own page one invitation per reserved program (wave
//! 11 C5: the claim QR, no typed code — the claim is secret) and, from
//! `/api/mod/badges`, the blank ID **badges** (wave 23, `B001`…: QR + the
//! printed badge code + a write-in Program line; a guest links one when
//! they join and it gets them back in on any phone). QRs are drawn here,
//! in the browser (`qrcode` → inline SVG): `/api/qr` allows 60/min per IP
//! and a full sheet needs 60–80. Pure, unit-tested in `print-sheet.test.ts`.

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
  checkin?: Array<{ id: string; label: string; slug: string; url: string; hidden: boolean }>
  /** The performer parts (SW-QR-11). Absent on an older server → no cast cards. */
  cast?: string[]
  /** Codex id → its fact stack (`facts.json`). Absent → posters unsorted. */
  stacks?: Record<string, PrintStack>
  /** Wave 11 C5: one claim link per reserved program (`?code=<guest
   *  code>&claim=<token>`) — the invitations. Absent on an older server. */
  claims?: Array<{ character: string; claim: string; url: string }>
  /** Wave 23: each part's own cast-card link (`?code=<prime code>&part=
   *  <code>`) — signs in as that part, taking it from a lost phone. Absent
   *  on an older server → the cast cards carry the performer passcode link. */
  castLinks?: Array<{ character: string; part: string; url: string }>
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
}

export const PrintKind = {
  Join: 'join',
  Door: 'door',
  Codex: 'codex',
  Room: 'room',
  Cast: 'cast',
  Invite: 'invite',
  Badge: 'badge',
} as const
export type PrintKind = (typeof PrintKind)[keyof typeof PrintKind]

export interface PrintItem {
  /** Small id printed in the corner (`J1`, `D1`, `C07`, `R03`, `P02`, `I04`, `B001`) — "which poster?". */
  ref: string
  kind: PrintKind
  title: string
  /** The line under the title (what to do with it). */
  hint: string
  /** The speakable fallback, printed big under the QR — empty for a room
   *  sign: a slug looks like a codex code, and typed into the Codex it
   *  fires `wrong code` (doubt + a spent miss). */
  code: string
  /** What the QR encodes. */
  url: string
  /** Shown on screen only: a note for the director (e.g. a hidden room). */
  note: string | null
  /** Numbered instructions under the title (the door sign). */
  steps?: string[]
  /** A codex poster's fact stack: a coloured band + the pile, printed. */
  stack?: PrintStack | null
  /** An invitation's reserved program (the screen-only 🔓 unlock names it). */
  character?: string
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

/** Print order of the stacks (gold = the hunt answers first, silver = the
 *  door's digit clues last of the named piles); any other colour after
 *  these, unstacked posters last. */
export const STACK_ORDER = ['gold', 'green', 'blue', 'red', 'silver'] as const

/** The stack the door code's digit clues print in (wave 11: one clue = one
 *  digit, `facts.json` → `codexStacks`). Their posters print the title and
 *  the QR only — never a typed code, and never a digit in the pile line —
 *  so nothing printed gives a digit away. */
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
    case 'red':
      return '#dc2626'
    case 'silver':
      return '#8b98a5'
    default:
      return '#a1a1aa'
  }
}

/** The printed pile line: `GOLD · hunt answers · <where>`. On the
 *  digit-clue stack any part holding a digit is left off (a hiding place
 *  like "shelf 9" must not read as a digit of the code). */
export function stackLine(stack: PrintStack): string {
  const parts = [stack.colour.toUpperCase(), stack.stack, stack.where].filter((s): s is string => s !== null && s !== '')
  return (isDigitClue(stack) ? parts.filter((p) => !/\d/u.test(p)) : parts).join(' · ')
}

/** Every card, in print order: join poster, door sign, codex posters (by
 *  stack: gold → green → blue → red → the rest, model order within one),
 *  room signs, cast cards. */
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
    const clue = isDigitClue(stack)
    items.push({
      ref: `C${pad(i + 1)}`,
      kind: PrintKind.Codex,
      title: e.title,
      hint: clue ? 'Scan it into your Codex.' : 'Scan, or type the code into your Codex.',
      // A digit clue prints its title + QR only (`DIGIT_CLUE_STACK`).
      code: clue ? '' : e.code,
      url: e.url,
      note: clue ? 'a digit clue — title + QR only' : e.about ? `about ${e.about}` : null,
      stack,
    })
  })
  ;(codes.checkin ?? []).forEach((r, i) =>
    items.push({
      ref: `R${pad(i + 1)}`,
      kind: PrintKind.Room,
      title: r.label,
      hint: "Scan to enter this room's chat.",
      code: '',
      url: r.url,
      note: r.hidden ? 'hidden until the story opens it' : null,
    }),
  )
  // A cast card prints the performer passcode. On an older server its QR
  // is the `?code=` link with the performer code: it opens the booth's
  // sign-in straight away (play's `roleForBrand`), pre-filled, and lists
  // the parts. Wave 23: the QR is the part's own link instead — it signs in
  // as that part and takes it back from a lost phone, so each card is one
  // performer's (its part code is never printed as text). Keep them with the cast.
  const castLink = `${codes.joinUrl.replace(/\/+$/u, '')}/?code=${encodeURIComponent(codes.primePass)}`
  const links = codes.castLinks
  const partLink = new Map((links ?? []).map((l) => [l.character, l.url]))
  ;(codes.cast ?? links?.map((l) => l.character) ?? []).forEach((name, i) => {
    const own = partLink.get(name)
    items.push({
      ref: `P${pad(i + 1)}`,
      kind: PrintKind.Cast,
      title: name,
      hint: own !== undefined ? `Scan to sign in as ${name}. Lost your phone? Scan it again to take ${name} back.` : `Scan, then pick ${name}.`,
      code: codes.primePass,
      url: own ?? castLink,
      note: own !== undefined ? `signs in as ${name} — this performer's only` : 'performer passcode — never post it',
    })
  })
  // An invitation's QR claims one reserved program (C5). The claim is
  // secret: no typed code, and the link is shown on screen only.
  ;(codes.claims ?? []).forEach((c, i) =>
    items.push({
      ref: `I${pad(i + 1)}`,
      kind: PrintKind.Invite,
      title: c.character,
      hint: `You're invited — scan to join as ${c.character}. This card is yours alone.`,
      code: '',
      url: c.url,
      note: `invitation for ${c.character} — the QR claims the name`,
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

/** The badge cards (wave 23): the event title, the QR, the printed code (a
 *  guest can type it on the join screen), a write-in Program line (the
 *  component draws it) and the ref. A badge is blank until a guest links
 *  it; who holds one is a screen-only note. */
export function buildBadgeItems(badges: PrintBadge[], title: string): PrintItem[] {
  return badges.map((b) => ({
    ref: b.ref,
    kind: PrintKind.Badge,
    title,
    hint: 'Scan when you join. Lost your phone? Scan this to get back in.',
    code: b.code,
    url: b.url,
    note: b.holder !== null ? `linked to ${b.name ?? b.holder}` : null,
  }))
}

/** The next unprinted badge number after a printed batch (1 for none). */
export function nextBadgeFrom(badges: PrintBadge[]): number {
  return badges.reduce((m, b) => Math.max(m, b.n), 0) + 1
}

/** Cards per printed page (8 = business cards, 2 × 4). */
export type PerPage = 1 | 2 | 4 | 8

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
