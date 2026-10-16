//! The Run → Print sheet (K-12): turns `/api/mod/codes` into the cards a
//! director prints — the join poster, the iPhone door sign (SW-QR-11), one
//! poster per codex entry (title + QR + the typed code; sorted and banded
//! by fact stack, K-12-stacks), one check-in sign per room (QR + room name
//! only — no typed code) and one business-card cast card per performer part
//! (the performer passcode QR, SW-QR-11). QRs are drawn here,
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
} as const
export type PrintKind = (typeof PrintKind)[keyof typeof PrintKind]

export interface PrintItem {
  /** Small id printed in the corner (`J1`, `D1`, `C07`, `R03`, `P02`) — "which poster?". */
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

/** Print order of the stacks (gold = the hunt answers first); any other
 *  colour after these, unstacked posters last. */
export const STACK_ORDER = ['gold', 'green', 'blue', 'red'] as const

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
    default:
      return '#a1a1aa'
  }
}

/** The printed pile line: `GOLD · hunt answers · <where>`. */
export function stackLine(stack: PrintStack): string {
  return [stack.colour.toUpperCase(), stack.stack, stack.where].filter((s) => s !== null && s !== '').join(' · ')
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
  codex.forEach((e, i) =>
    items.push({
      ref: `C${pad(i + 1)}`,
      kind: PrintKind.Codex,
      title: e.title,
      hint: 'Scan, or type the code into your Codex.',
      code: e.code,
      url: e.url,
      note: e.about ? `about ${e.about}` : null,
      stack: stackOf(e.id),
    }),
  )
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
  return items
}

/** Cards per printed page (8 = business cards, 2 × 4). */
export type PerPage = 1 | 2 | 4 | 8

/** An inline SVG QR for `text` — black on white, a 2-module quiet zone,
 *  level M (a poster survives a crease or a thumb). */
export async function qrSvg(text: string): Promise<string> {
  return await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } })
}
