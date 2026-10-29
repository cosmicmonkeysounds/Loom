import { describe, expect, it } from 'vitest'
import runPageSource from './RunPage.tsx?raw'
import cardSource from './LettersCard.tsx?raw'
import apiSource from '@/lib/api.ts?raw'
import {
  LETTERS_POLL_MS,
  LETTER_SUBJECT_MAX,
  LETTER_TEXT_MAX,
  anyDirty,
  draftProblem,
  editDirty,
  editStale,
  forgetConfirm,
  letterCounts,
  lettersErrorText,
  lettersViewOf,
  rowEditable,
  rowRewritable,
  rowSendable,
  sendConfirm,
  sendOff,
  sendableRows,
  stateLabel,
  writableRows,
  type LetterRow,
  type LettersView,
} from './letters'

const draft = (at = 1) => ({ subject: 'From Halifax', text: 'Dear program, …', by: 'Trabolta', at })
const row = (key: string, state: LetterRow['state'], extra: Partial<LetterRow> = {}): LetterRow => ({
  key,
  kind: 'guest',
  name: key.slice(2),
  email: `${key.slice(2).toLowerCase()}@example.com`,
  state,
  draft: state === 'waiting' || state === 'queued' ? null : draft(),
  sent: state === 'sent' ? { at: 5, ok: true } : state === 'failed' ? { at: 5, ok: false, error: 'bounced' } : null,
  ...extra,
})
const FROM = 'Jean Trabolta <letters@example.com>'
const view = (rows: LetterRow[], extra: Partial<LettersView> = {}): LettersView => ({ from: FROM, off: null, writer: { character: 'Trabolta', online: true }, sending: false, rows, ...extra })

const ROWS = [
  row('g:Winamp', 'waiting'),
  row('g:Excel', 'queued'),
  row('g:Paint', 'writing', { draft: draft() }),
  row('g:Word', 'drafted'),
  row('p:Clippy', 'sending', { kind: 'performer' }),
  row('g:Zune', 'sent'),
  row('g:Encarta', 'failed'),
  row('g:Doom', 'failed', { draft: null, sent: { at: 5, ok: false, error: 'no draft' } }),
]

describe('letters off the wire', () => {
  it('reads a LettersView and drops rows that are not rows', () => {
    const v = lettersViewOf({
      from: FROM,
      off: null,
      writer: { character: 'Trabolta', online: false },
      sending: false,
      rows: [
        { key: 'g:1', kind: 'guest', name: 'Winamp', email: 'guest@example.com', state: 'drafted', draft: { subject: 's', text: 't', by: 'Trabolta', at: 3 }, sent: null },
        { key: 'p:Clippy', kind: 'performer', name: 'Clippy', email: 'part@example.com', state: 'sent', draft: null, sent: { at: 9, ok: true } },
        { key: 'g:2', email: 'x@example.com', state: 'lost' },
        'junk',
      ],
    })
    expect(v?.rows.map((r) => r.key)).toEqual(['g:1', 'p:Clippy'])
    expect(v?.writer).toEqual({ character: 'Trabolta', online: false })
    expect(v?.rows[0]!.draft).toEqual({ subject: 's', text: 't', by: 'Trabolta', at: 3 })
    expect(v?.rows[1]!.sent).toEqual({ at: 9, ok: true })
    expect(lettersViewOf({ from: null })).toBeNull()
    expect(lettersViewOf(null)).toBeNull()
  })
})

describe('the counts and what each button takes', () => {
  it('counts on file / drafted / sent', () => {
    expect(letterCounts(view(ROWS))).toEqual({ onFile: 8, drafted: 5, sent: 1 })
  })

  it('Send takes drafted rows and a failed one with a draft, never one sent, sending or being rewritten', () => {
    expect(sendableRows(view(ROWS)).map((r) => r.key)).toEqual(['g:Word', 'g:Encarta'])
    expect(rowSendable(row('g:Zune', 'sent'))).toBe(false)
    expect(rowSendable(row('g:Paint', 'writing', { draft: draft() }))).toBe(false)
  })

  it('✍ Ask asks for rows with no draft that nobody asked for yet', () => {
    expect(writableRows(view(ROWS)).map((r) => r.key)).toEqual(['g:Winamp', 'g:Doom'])
  })

  it('a draft is editable and rewritable until it is sent or on its way', () => {
    expect(rowEditable(row('g:Word', 'drafted'))).toBe(true)
    expect(rowEditable(row('g:Zune', 'sent'))).toBe(false)
    expect(rowEditable(row('p:Clippy', 'sending'))).toBe(false)
    expect(rowEditable(row('g:Winamp', 'waiting'))).toBe(false)
    expect(rowRewritable(row('g:Word', 'drafted'))).toBe(true)
    expect(rowRewritable(row('g:Encarta', 'failed'))).toBe(true)
    expect(rowRewritable(row('g:Paint', 'writing', { draft: draft() }))).toBe(false)
  })
})

describe('Send is off, and says why', () => {
  it("the server's off first, then no mail, then a round already sending", () => {
    expect(sendOff(view(ROWS))).toBeNull()
    expect(sendOff(view(ROWS, { off: 'No Resend key on this server.' }))).toBe('No Resend key on this server.')
    expect(sendOff(view(ROWS, { from: null }))).toMatch(/Mail is off/u)
    expect(sendOff(view(ROWS, { sending: true }))).toMatch(/Sending/u)
  })
})

describe('the confirmation names N and the From line', () => {
  it('for every sendable row', () => {
    const c = sendConfirm(FROM, sendableRows(view(ROWS)))
    expect(c.title).toBe('Send 2 letters?')
    expect(c.body).toContain(`From ${FROM}`)
    expect(c.confirmLabel).toBe('✉ Send 2 letters')
  })
  it('for one row, naming who it goes to', () => {
    const c = sendConfirm(FROM, [row('g:Word', 'drafted')])
    expect(c.title).toBe('Send 1 letter?')
    expect(c.body).toContain('to Word (word@example.com)')
    expect(c.body).toContain(FROM)
  })
  it('Forget asks, as a danger', () => {
    const c = forgetConfirm(row('g:Word', 'drafted'))
    expect(c.danger).toBe(true)
    expect(c.body).toContain('word@example.com')
  })
})

describe('rows in words', () => {
  it('reads each state', () => {
    expect(ROWS.map(stateLabel)).toEqual(['waiting', 'asked', 'writing…', 'drafted', 'sending…', '✔ sent', '✖ failed: bounced', '✖ failed: no draft'])
  })
})

describe("a director's edit", () => {
  it('checks the server limits before it goes', () => {
    expect(draftProblem('Hi', 'Dear program')).toBeNull()
    expect(draftProblem('Hi', '   ')).toMatch(/empty/u)
    expect(draftProblem('Hi', 'x'.repeat(LETTER_TEXT_MAX + 1))).toMatch(String(LETTER_TEXT_MAX))
    expect(draftProblem('x'.repeat(LETTER_SUBJECT_MAX + 1), 'ok')).toMatch(String(LETTER_SUBJECT_MAX))
  })
  it('is dirty once it differs, stale once a newer draft lands, and holds Send N', () => {
    const r = row('g:Word', 'drafted')
    const same = { subject: r.draft!.subject, text: r.draft!.text, base: r.draft!.at }
    expect(editDirty(undefined, r)).toBe(false)
    expect(editDirty(same, r)).toBe(false)
    expect(editDirty({ ...same, text: 'Dear Word, …' }, r)).toBe(true)
    expect(editStale(same, r)).toBe(false)
    expect(editStale(same, { ...r, draft: draft(2) })).toBe(true)
    expect(anyDirty({}, [r])).toBe(false)
    expect(anyDirty({ [r.key]: { ...same, subject: 'New' } }, [r])).toBe(true)
  })
})

describe('refusals in plain words', () => {
  it('maps the server codes', () => {
    expect(lettersErrorText(new Error('no_writer'))).toMatch(/judge:/u)
    expect(lettersErrorText(new Error('mail_off'))).toMatch(/Mail is off/u)
    expect(lettersErrorText(new Error('busy'))).toMatch(/Already sending/u)
    expect(lettersErrorText(new Error('already_sent'))).toMatch(/already sent/u)
    expect(lettersErrorText(new Error('something new'))).toBe('something new')
  })
})

describe('wiring', () => {
  it('the card sits under Join (and its Print sheet), on server runs only, one per event', () => {
    const server = runPageSource.slice(runPageSource.indexOf('{server ? ('), runPageSource.indexOf('<LocalCard />'))
    expect(server).toContain("<LettersCard key={run.eventId ?? ''} />")
    expect(server.indexOf('<JoinCard />')).toBeLessThan(server.indexOf('<LettersCard'))
  })
  it('polls every 3 s and confirms before a send', () => {
    expect(LETTERS_POLL_MS).toBe(3000)
    expect(cardSource).toContain('confirmAction(sendConfirm(')
    expect(cardSource).toContain('setInterval(')
  })
  it('calls the five mod routes', () => {
    for (const route of ['/api/mod/letters`', '/api/mod/letters/write', '/api/mod/letters/draft', '/api/mod/letters/send', '/api/mod/letters/forget']) expect(apiSource).toContain(route)
  })
})
