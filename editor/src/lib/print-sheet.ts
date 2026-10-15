//! The Run → Print sheet (K-12): turns `/api/mod/codes` into the cards a
//! director prints — the join poster, one poster per codex entry (title +
//! QR + the typed code), one check-in sign per room (QR + room name only — no typed code). QRs are drawn here,
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
}

export const PrintKind = {
  Join: 'join',
  Codex: 'codex',
  Room: 'room',
} as const
export type PrintKind = (typeof PrintKind)[keyof typeof PrintKind]

export interface PrintItem {
  /** Small id printed in the corner (`J1`, `C07`, `R03`) — "which poster?". */
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
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Every card, in print order: join poster, codex posters, room signs. */
export function buildPrintItems(codes: PrintCodes): PrintItem[] {
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
  codes.codex.forEach((e, i) =>
    items.push({
      ref: `C${pad(i + 1)}`,
      kind: PrintKind.Codex,
      title: e.title,
      hint: 'Scan, or type the code into your Codex.',
      code: e.code,
      url: e.url,
      note: e.about ? `about ${e.about}` : null,
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
  return items
}

/** Cards per printed page. */
export type PerPage = 1 | 2 | 4

/** An inline SVG QR for `text` — black on white, a 2-module quiet zone,
 *  level M (a poster survives a crease or a thumb). */
export async function qrSvg(text: string): Promise<string> {
  return await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } })
}
