//! Run → ✉ Letters (wave 41, `docs/loom-w41-contract.md` C5): Jean
//! Trabolta's letters to everyone who left an email (a guest at the upload,
//! a performer at their booth). The counts (on file / drafted / sent),
//! **✍ Ask Trabolta to write them** with the writer's online dot, each row
//! with its draft open to edit (Save edits → `/draft`) and **↻ Rewrite**
//! (`/write {keys, redo}`), **✉ Send N letters** behind a confirmation that
//! names N and the From line, and a per-row Send / Forget. Nothing goes out
//! by itself: a director presses Send. It re-reads `GET /api/mod/letters`
//! every 3 s while mounted (server runs only; a 404 from an older server
//! hides it). Pure rules in `letters.ts`.

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useCockpit } from '@/store/cockpit'
import { confirmAction } from '@/store/dialog'
import { ApiError, lettersApi } from '@/lib/api'
import {
  LETTERS_POLL_MS,
  anyDirty,
  LETTER_SUBJECT_MAX,
  LETTER_TEXT_MAX,
  draftProblem,
  editDirty,
  editStale,
  forgetConfirm,
  letterCounts,
  letterWord,
  lettersErrorText,
  rowEditable,
  rowRewritable,
  rowSendable,
  sendConfirm,
  sendOff,
  sendableRows,
  stateLabel,
  writableRows,
  type LetterEdit,
  type LetterRow,
  type LettersView,
} from './letters'

const btn = 'rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40'

export function LettersCard() {
  const eventId = useCockpit((s) => s.run?.eventId ?? null)
  const [view, setView] = useState<LettersView | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, LetterEdit>>({})
  // Bumped after every action: re-read at once (and restart the 3 s poll).
  const [tick, setTick] = useState(0)

  // Mounted per event (`key={eventId}` on the Run page), so nothing here
  // outlives a switch of event.
  useEffect(() => {
    if (eventId === null) return
    let cancelled = false
    const load = async () => {
      try {
        const v = await lettersApi.view(eventId)
        if (cancelled) return
        setView(v)
        setMissing(false)
      } catch (e) {
        // An older server has no letters: the card stays away. Anything
        // else keeps the last reading; the next poll retries.
        if (!cancelled && e instanceof ApiError && e.status === 404) setMissing(true)
      }
    }
    void load()
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void load()
    }, LETTERS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [eventId, tick])

  if (eventId === null || missing || view === null) return null

  const act = async (key: string, fn: () => Promise<string | null>) => {
    if (busy !== null) return
    setBusy(key)
    setError(null)
    setNote(null)
    try {
      setNote(await fn())
    } catch (e) {
      setError(lettersErrorText(e))
    } finally {
      setBusy(null)
      setTick((n) => n + 1)
    }
  }
  const dropEdit = (key: string) =>
    setEdits((all) => {
      const next = { ...all }
      delete next[key]
      return next
    })

  const counts = letterCounts(view)
  const sendable = sendableRows(view)
  const writable = writableRows(view)
  const off = sendOff(view)
  const dirty = anyDirty(edits, view.rows)

  const askWrite = () =>
    act('write', async () => {
      const r = await lettersApi.write(eventId)
      return `Asked ${view.writer?.character ?? 'Trabolta'} for ${r.queued} ${letterWord(r.queued)}.`
    })
  const sendRows = (rows: LetterRow[], key: string) =>
    act(key, async () => {
      if (view.from === null || rows.length === 0) return null
      if (!(await confirmAction(sendConfirm(view.from, rows)))) return null
      const r = await lettersApi.send(eventId, rows.map((x) => x.key))
      return `Sending ${r.sending} ${letterWord(r.sending)}…`
    })
  const rewrite = (row: LetterRow) =>
    act(`rewrite:${row.key}`, async () => {
      const r = await lettersApi.write(eventId, [row.key], true)
      dropEdit(row.key)
      return r.queued > 0 ? `Asked for a new draft for ${row.name}.` : null
    })
  const save = (row: LetterRow) =>
    act(`save:${row.key}`, async () => {
      const edit = edits[row.key]
      if (edit === undefined) return null
      const problem = draftProblem(edit.subject, edit.text)
      if (problem !== null) throw new Error(problem)
      await lettersApi.draft(eventId, row.key, edit.subject, edit.text)
      dropEdit(row.key)
      return `Saved ${row.name}'s letter.`
    })
  const forget = (row: LetterRow) =>
    act(`forget:${row.key}`, async () => {
      if (!(await confirmAction(forgetConfirm(row)))) return null
      await lettersApi.forget(eventId, row.key)
      dropEdit(row.key)
      return `${row.name} is off file.`
    })
  const edit = (row: LetterRow, patch: Partial<Pick<LetterEdit, 'subject' | 'text'>>) => {
    if (row.draft === null) return
    const d = row.draft
    setEdits((all) => ({ ...all, [row.key]: { subject: all[row.key]?.subject ?? d.subject, text: all[row.key]?.text ?? d.text, base: all[row.key]?.base ?? d.at, ...patch } }))
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-3" data-testid="run-letters">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">✉ Letters</span>
        <span className="text-xs text-zinc-400" data-testid="run-letters-counts">
          {counts.onFile} on file · {counts.drafted} drafted · {counts.sent} sent
        </span>
      </div>
      <p className="mb-2 text-xs text-zinc-500">
        Guests and performers who left an email get a letter from Jean Trabolta after the night. He drafts each one; you read it, edit it, and press Send.
        {view.from !== null && <> From <span className="text-zinc-300">{view.from}</span>.</>}
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void askWrite()}
          disabled={busy !== null || view.writer === null || writable.length === 0}
          className={btn}
          title={view.writer === null ? 'No one to write them: the story has no judge: character (or one mind: external).' : writable.length === 0 ? 'Every letter on file has a draft or is being written.' : `Asks ${view.writer.character} to draft ${writable.length} ${letterWord(writable.length)}`}
          data-testid="run-letters-write"
        >
          ✍ Ask Trabolta to write them
        </button>
        {view.writer !== null && (
          <span className="flex items-center gap-1 text-[11px] text-zinc-400" data-testid="run-letters-writer" data-online={view.writer.online}>
            <span className={clsx('h-1.5 w-1.5 rounded-full', view.writer.online ? 'bg-emerald-400' : 'border border-zinc-600')} />
            {view.writer.character} {view.writer.online ? 'online' : 'offline'}
          </span>
        )}
        <button
          onClick={() => void sendRows(sendable, 'send')}
          disabled={busy !== null || off !== null || sendable.length === 0 || dirty}
          className={clsx(btn, 'ml-auto border-indigo-700 text-indigo-100')}
          title={off ?? (sendable.length === 0 ? 'Nothing drafted to send.' : dirty ? 'Save (or discard) your edits first' : undefined)}
          data-testid="run-letters-send"
        >
          ✉ Send {sendable.length} {letterWord(sendable.length)}
        </button>
      </div>
      {off !== null && (
        <p className="mb-2 rounded bg-amber-950/50 px-2 py-1 text-xs text-amber-200" data-testid="run-letters-off">
          {off}
        </p>
      )}
      {error !== null && (
        <p className="mb-2 rounded bg-red-950/60 px-2 py-1 text-xs text-red-200" data-testid="run-letters-error">
          {error}
        </p>
      )}
      {note !== null && <p className="mb-2 text-xs text-zinc-400">{note}</p>}
      {view.rows.length === 0 ? (
        <p className="text-xs text-zinc-600">No one has left an email yet.</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="run-letters-rows">
          {view.rows.map((row) => {
            const e = edits[row.key]
            const subject = e?.subject ?? row.draft?.subject ?? ''
            const text = e?.text ?? row.draft?.text ?? ''
            const editable = rowEditable(row)
            return (
              <li key={row.key} className="rounded-lg border border-zinc-800 p-2 text-xs" data-testid="run-letter-row" data-state={row.state}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-200">{row.name}</span>
                  {row.kind === 'performer' && <span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">performer</span>}
                  <span className="min-w-0 truncate text-zinc-500">{row.email}</span>
                  <span className={clsx('ml-auto shrink-0', row.state === 'sent' ? 'text-emerald-300' : row.state === 'failed' ? 'text-red-300' : 'text-zinc-400')}>{stateLabel(row)}</span>
                </div>
                {row.draft === null ? (
                  <p className="mt-1 text-zinc-600">No draft yet.</p>
                ) : (
                  <div className="mt-1 flex flex-col gap-1">
                    <input
                      value={subject}
                      maxLength={LETTER_SUBJECT_MAX}
                      disabled={!editable}
                      onChange={(ev) => edit(row, { subject: ev.target.value })}
                      placeholder="Subject"
                      className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-100 disabled:opacity-60"
                      data-testid="run-letter-subject"
                    />
                    <textarea
                      value={text}
                      maxLength={LETTER_TEXT_MAX}
                      disabled={!editable}
                      onChange={(ev) => edit(row, { text: ev.target.value })}
                      rows={row.state === 'sent' ? 3 : 8}
                      className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-serif text-zinc-100 disabled:opacity-60"
                      data-testid="run-letter-text"
                    />
                    <span className="text-[10px] text-zinc-600">by {row.draft.by}</span>
                    {editStale(e, row) && (
                      <p className="text-[11px] text-amber-300">
                        A newer draft arrived while you were editing.{' '}
                        <button className="underline" onClick={() => dropEdit(row.key)}>
                          Discard my edits
                        </button>
                      </p>
                    )}
                  </div>
                )}
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {editable && (
                    <button onClick={() => void save(row)} disabled={busy !== null || !editDirty(e, row)} className={btn} data-testid="run-letter-save">
                      Save edits
                    </button>
                  )}
                  {rowRewritable(row) && (
                    <button onClick={() => void rewrite(row)} disabled={busy !== null || view.writer === null} className={btn} title="Ask for a new draft (replaces this one)" data-testid="run-letter-rewrite">
                      ↻ Rewrite
                    </button>
                  )}
                  {rowSendable(row) && (
                    <button onClick={() => void sendRows([row], `send:${row.key}`)} disabled={busy !== null || off !== null || editDirty(e, row)} className={btn} title={off ?? (editDirty(e, row) ? 'Save your edits first' : undefined)} data-testid="run-letter-send">
                      ✉ Send
                    </button>
                  )}
                  <button onClick={() => void forget(row)} disabled={busy !== null || row.state === 'sending'} className={clsx(btn, 'text-zinc-400')} data-testid="run-letter-forget">
                    Forget
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
