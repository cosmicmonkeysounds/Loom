//! Run → 🎥 Video consent (wave 44, `docs/loom-w44-contract.md` C6 / C10):
//! who said no to the video. The counts (OK / leave out / not asked yet),
//! the opted-out guests first with their picture and name, then everyone
//! else folded, and **⬇ Download CSV** (the server's `?format=csv`, saved as
//! `video-consent.csv`). It re-reads `GET /api/mod/video` every 10 s while
//! mounted and the tab is shown (server runs only; a 404 from an older
//! server hides it). The answers live in the event's journal, and End stops
//! the event: the note says to download first. Pure rules in
//! `video-consent.ts`.

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useCockpit } from '@/store/cockpit'
import { ApiError, avatarUrl, videoApi } from '@/lib/api'
import { VIDEO_CSV_FILE, VIDEO_END_NOTE, VIDEO_POLL_MS, initials, restSummary, videoErrorText, videoGroups, videoLabel, type VideoConsentRow, type VideoConsentView } from './video-consent'

const btn = 'rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40'

/** Save a text as a file in the browser (no-op outside a DOM). */
function saveText(text: string, filename: string, type: string): void {
  if (typeof document === 'undefined') return
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Face({ eventId, row, size }: { eventId: string; row: VideoConsentRow; size: 'lg' | 'sm' }) {
  const [failed, setFailed] = useState(false)
  const box = size === 'lg' ? 'h-10 w-10 text-xs' : 'h-5 w-5 text-[9px]'
  if (row.avatar === null || failed) {
    return (
      <span className={clsx('flex shrink-0 items-center justify-center rounded-full bg-zinc-800 font-medium text-zinc-300', box)} aria-hidden>
        {initials(row.name)}
      </span>
    )
  }
  return <img src={avatarUrl(eventId, row.avatar)} alt="" loading="lazy" onError={() => setFailed(true)} className={clsx('shrink-0 rounded-full bg-zinc-800 object-cover', box)} data-testid="run-video-face" />
}

/** The card's body over one reading (rendered statically in the tests). */
export function VideoConsentPanel({ eventId, view, error, busy, onDownload }: { eventId: string; view: VideoConsentView; error: string | null; busy: boolean; onDownload: () => void }) {
  const { out, rest } = videoGroups(view)
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-3" data-testid="run-video">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">🎥 Video consent</span>
        <span className="text-xs text-zinc-400" data-testid="run-video-counts">
          {view.counts.ok} OK · <span className={view.counts.out > 0 ? 'text-amber-300' : undefined}>{view.counts.out} leave out</span> · {view.counts.unasked} not asked yet
        </span>
        <button onClick={onDownload} disabled={busy || view.rows.length === 0} className={clsx(btn, 'ml-auto')} title={`Saves ${VIDEO_CSV_FILE}: every guest's answer, the ones to leave out first`} data-testid="run-video-csv">
          ⬇ Download CSV
        </button>
      </div>
      <p className="mb-2 text-xs text-zinc-500">Guests answer at the upload, and can change it from ⊞ Start. Leave these people out of anything you make from the night's video.</p>
      {error !== null && (
        <p className="mb-2 rounded bg-red-950/60 px-2 py-1 text-xs text-red-200" data-testid="run-video-error">
          {error}
        </p>
      )}
      {view.rows.length === 0 ? (
        <p className="text-xs text-zinc-600">No guests yet.</p>
      ) : (
        <>
          {out.length === 0 ? (
            <p className="text-xs text-zinc-500" data-testid="run-video-none-out">
              No one has asked to be left out.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="run-video-out">
              {out.map((row) => (
                <li key={row.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-amber-900/60 bg-amber-950/20 p-2 text-xs" data-testid="run-video-out-row">
                  <Face eventId={eventId} row={row} size="lg" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-zinc-100">{row.name}</span>
                    {row.featured !== undefined && <span className="block truncate text-[10px] text-zinc-500">featured: {row.featured}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {rest.length > 0 && (
            <details className="mt-2 text-xs" data-testid="run-video-rest">
              <summary className="cursor-pointer text-zinc-400">{restSummary(rest)}</summary>
              <ul className="mt-1 flex flex-col gap-1">
                {rest.map((row) => (
                  <li key={row.id} className="flex items-center gap-2" data-testid="run-video-rest-row" data-video={row.video}>
                    <Face eventId={eventId} row={row} size="sm" />
                    <span className="min-w-0 truncate text-zinc-200">{row.name}</span>
                    <span className={clsx('ml-auto shrink-0', row.video === 'ok' ? 'text-emerald-300' : 'text-zinc-500')}>{videoLabel(row.video)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <p className="mt-2 text-[11px] text-amber-200/80" data-testid="run-video-note">
        {VIDEO_END_NOTE}
      </p>
    </section>
  )
}

export function VideoConsentCard() {
  const eventId = useCockpit((s) => s.run?.eventId ?? null)
  const [view, setView] = useState<VideoConsentView | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Mounted per event (`key={eventId}` on the Run page), so nothing here
  // outlives a switch of event.
  useEffect(() => {
    if (eventId === null) return
    let cancelled = false
    const load = async () => {
      try {
        const v = await videoApi.view(eventId)
        if (cancelled) return
        setView(v)
        setMissing(false)
      } catch (e) {
        // An older server has no video answers: the card stays away.
        // Anything else keeps the last reading; the next poll retries.
        if (!cancelled && e instanceof ApiError && e.status === 404) setMissing(true)
      }
    }
    void load()
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void load()
    }, VIDEO_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [eventId])

  if (eventId === null || missing || view === null) return null

  const download = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      saveText(await videoApi.csv(eventId), VIDEO_CSV_FILE, 'text/csv')
    } catch (e) {
      setError(videoErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  return <VideoConsentPanel eventId={eventId} view={view} error={error} busy={busy} onDownload={() => void download()} />
}
