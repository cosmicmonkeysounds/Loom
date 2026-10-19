//! The Run → Print sheet (K-12): turns `/api/mod/codes` into the cards a
//! director prints — the join poster, the iPhone door sign (SW-QR-11), one
//! poster per codex entry (title + QR + the typed code; sorted and banded
//! by fact stack, K-12-stacks), one check-in sign per room (QR + room name
//! only — no typed code), one business-card cast card per performer part
//! (the performer passcode QR, SW-QR-11) and, on their own page, one
//! invitation per reserved program (wave 11 C5: the claim QR, no typed
//! code — the claim is secret). QRs are drawn here,
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
} as const
export type PrintKind = (typeof PrintKind)[keyof typeof PrintKind]

export interface PrintItem {
  /** Small id printed in the corner (`J1`, `D1`, `C07`, `R03`, `P02`, `I04`) — "which poster?". */
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
  // A cast card prints the performer passcode. A `?code=` link with the
  // performer code opens the booth's sign-in straight away (play's
  // `roleForBrand`), pre-filled, and it lists the parts. Keep them with the cast.
  const castLink = `${codes.joinUrl.replace(/\/+$/u, '')}/?code=${encodeURIComponent(codes.primePass)}`
  ;(codes.cast ?? []).forEach((name, i) =>
    items.push({
      ref: `P${pad(i + 1)}`,
      kind: PrintKind.Cast,
      title: name,
      hint: `Scan, then pick ${name}.`,
      code: codes.primePass,
      url: castLink,
      note: 'performer passcode — never post it',
    }),
  )
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

/** Cards per printed page (8 = business cards, 2 × 4). */
export type PerPage = 1 | 2 | 4 | 8

/** An inline SVG QR for `text` — black on white, a 2-module quiet zone,
 *  level M (a poster survives a crease or a thumb). */
export async function qrSvg(text: string): Promise<string> {
  return await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } })
}
