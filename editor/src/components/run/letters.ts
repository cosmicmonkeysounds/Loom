//! Run's letters (wave 41, `docs/loom-w41-contract.md` C5): the pure half
//! of `LettersCard.tsx`. The wire shapes (`LettersView`, `LetterRow`,
//! mirrored by hand from core's `/api/mod/letters`), reading them off the
//! wire, the counts, which rows Send takes, the confirmation's words and
//! the refusals in plain words.

export type LetterState = 'waiting' | 'queued' | 'writing' | 'drafted' | 'sending' | 'sent' | 'failed'

export interface LetterDraft {
  subject: string
  text: string
  by: string
  at: number
}

export interface LetterRow {
  key: string
  kind: 'guest' | 'performer'
  /** The program's name or the part's. */
  name: string
  email: string
  state: LetterState
  draft: LetterDraft | null
  sent: { at: number; ok: boolean; error?: string } | null
}

export interface LettersView {
  /** The From line, or null when mail is off (no Resend key). */
  from: string | null
  /** Why Send is off, or null. */
  off: string | null
  writer: { character: string; online: boolean } | null
  sending: boolean
  rows: LetterRow[]
}

/** How often the card re-reads `GET /api/mod/letters` while it is open. */
export const LETTERS_POLL_MS = 3000
/** The server's limits on a director's edit (C5 `/draft`). */
export const LETTER_TEXT_MAX = 6000
export const LETTER_SUBJECT_MAX = 120

const STATES: readonly LetterState[] = ['waiting', 'queued', 'writing', 'drafted', 'sending', 'sent', 'failed']
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function draftOf(raw: unknown): LetterDraft | null {
  if (!isRecord(raw) || typeof raw['text'] !== 'string') return null
  return { subject: str(raw['subject']) ?? '', text: raw['text'], by: str(raw['by']) ?? '', at: typeof raw['at'] === 'number' ? raw['at'] : 0 }
}

function sentOf(raw: unknown): LetterRow['sent'] {
  if (!isRecord(raw) || typeof raw['ok'] !== 'boolean') return null
  const error = str(raw['error'])
  return { at: typeof raw['at'] === 'number' ? raw['at'] : 0, ok: raw['ok'], ...(error !== null ? { error } : {}) }
}

/** A `LettersView` off the wire, or null when it isn't one. Rows that
 *  aren't rows are dropped. */
export function lettersViewOf(raw: unknown): LettersView | null {
  if (!isRecord(raw) || !Array.isArray(raw['rows'])) return null
  const rows: LetterRow[] = []
  for (const r of raw['rows']) {
    if (!isRecord(r)) continue
    const key = str(r['key'])
    const email = str(r['email'])
    const state = STATES.find((s) => s === r['state'])
    if (key === null || email === null || state === undefined) continue
    rows.push({ key, kind: r['kind'] === 'performer' ? 'performer' : 'guest', name: str(r['name']) ?? key, email, state, draft: draftOf(r['draft']), sent: sentOf(r['sent']) })
  }
  const w = raw['writer']
  const writer = isRecord(w) && typeof w['character'] === 'string' ? { character: w['character'], online: w['online'] === true } : null
  return { from: str(raw['from']), off: str(raw['off']), writer, sending: raw['sending'] === true, rows }
}

/** The card's head: on file / drafted / sent. */
export function letterCounts(view: LettersView): { onFile: number; drafted: number; sent: number } {
  return {
    onFile: view.rows.length,
    drafted: view.rows.filter((r) => r.draft !== null).length,
    sent: view.rows.filter((r) => r.state === 'sent').length,
  }
}

/** A row Send takes: a draft, not sent, not on its way, not being rewritten
 *  (a failed send may go again). */
export function rowSendable(row: LetterRow): boolean {
  return row.draft !== null && (row.state === 'drafted' || row.state === 'failed')
}

export function sendableRows(view: LettersView): LetterRow[] {
  return view.rows.filter(rowSendable)
}

/** The rows ✍ Ask Trabolta asks for: no draft and not already asked. */
export function writableRows(view: LettersView): LetterRow[] {
  return view.rows.filter((r) => r.draft === null && (r.state === 'waiting' || r.state === 'failed'))
}

/** Why Send is off (the server's own `off` first), or null when it can go. */
export function sendOff(view: LettersView): string | null {
  if (view.off !== null) return view.off
  if (view.from === null) return 'Mail is off on this server (no Resend key).'
  if (view.sending) return 'Sending now…'
  return null
}

/** `↻ Rewrite` is for a row with a draft that is not sent or on its way. */
export function rowRewritable(row: LetterRow): boolean {
  return row.draft !== null && (row.state === 'drafted' || row.state === 'failed')
}

/** A row's draft can be edited until it is sent or sending. */
export function rowEditable(row: LetterRow): boolean {
  return row.draft !== null && row.state !== 'sent' && row.state !== 'sending'
}

export function letterWord(n: number): string {
  return n === 1 ? 'letter' : 'letters'
}

/** `✉ Send N letters`'s confirmation: it names N and the From line. One
 *  row's Send names who it goes to. */
export function sendConfirm(from: string, rows: readonly Pick<LetterRow, 'name' | 'email'>[]): { title: string; body: string; confirmLabel: string } {
  const n = rows.length
  const to = n === 1 ? ` to ${rows[0]!.name} (${rows[0]!.email})` : ''
  return {
    title: `Send ${n} ${letterWord(n)}?`,
    body: `From ${from}${to}. Each goes out once, by email, and can't be taken back.`,
    confirmLabel: `✉ Send ${n} ${letterWord(n)}`,
  }
}

export function forgetConfirm(row: Pick<LetterRow, 'name' | 'email'>): { title: string; body: string; confirmLabel: string; danger: true } {
  return {
    title: `Forget ${row.name}'s letter?`,
    body: `Takes ${row.email} off file, with its draft. No letter goes to them.`,
    confirmLabel: 'Forget',
    danger: true,
  }
}

/** A row's state, in words. */
export function stateLabel(row: Pick<LetterRow, 'state' | 'sent'>): string {
  switch (row.state) {
    case 'waiting':
      return 'waiting'
    case 'queued':
      return 'asked'
    case 'writing':
      return 'writing…'
    case 'drafted':
      return 'drafted'
    case 'sending':
      return 'sending…'
    case 'sent':
      return '✔ sent'
    case 'failed':
      return `✖ failed${row.sent?.error ? `: ${row.sent.error}` : ''}`
  }
}

/** What's wrong with a director's edit before it goes (the server's own
 *  400s), or null. */
export function draftProblem(subject: string, text: string): string | null {
  if (text.trim() === '') return 'The letter is empty.'
  if (text.length > LETTER_TEXT_MAX) return `Keep the letter under ${LETTER_TEXT_MAX} characters.`
  if (subject.length > LETTER_SUBJECT_MAX) return `Keep the subject under ${LETTER_SUBJECT_MAX} characters.`
  return null
}

/** A director's unsaved edit of one row, and the draft it started from. */
export interface LetterEdit {
  subject: string
  text: string
  /** The draft's `at` when the edit began: a newer one means it changed underneath. */
  base: number
}

export function editDirty(edit: LetterEdit | undefined, row: LetterRow): boolean {
  return edit !== undefined && row.draft !== null && (edit.subject !== row.draft.subject || edit.text !== row.draft.text)
}

/** Some row has an unsaved edit: Send N waits for Save (it would send the old draft). */
export function anyDirty(edits: Readonly<Record<string, LetterEdit>>, rows: readonly LetterRow[]): boolean {
  return rows.some((r) => editDirty(edits[r.key], r))
}

/** Trabolta's draft changed (a rewrite landed) under an unsaved edit. */
export function editStale(edit: LetterEdit | undefined, row: LetterRow): boolean {
  return edit !== undefined && row.draft !== null && row.draft.at !== edit.base
}

const ERRORS: Record<string, string> = {
  no_writer: 'No one to write them: the story has no judge: character (or one mind: external).',
  mail_off: 'Mail is off on this server (no Resend key).',
  nothing_to_send: 'Nothing drafted to send.',
  busy: 'Already sending. Wait for this round to finish.',
  already_sent: 'That letter is already sent.',
  no_such_letter: 'That letter is gone (forgotten, or the story restarted).',
  empty: 'The letter is empty.',
  too_long: `Too long (the letter ≤ ${LETTER_TEXT_MAX} characters, the subject ≤ ${LETTER_SUBJECT_MAX}).`,
}

/** A refusal in plain words (the server's `error` code, else its message). */
export function lettersErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return ERRORS[msg] ?? msg
}
