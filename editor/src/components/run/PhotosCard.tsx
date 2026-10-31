//! Run → Terminals' 📷 photos (wave 59p, `docs/loom-w59-photos-contract.md`, words
//! DRAFT w59p): the same arm as a host's Desk, each terminal's count, last shot,
//! thumbnail and why it isn't shooting, and what only a director gets: ⬇ Download
//! all (a tar the browser saves as it arrives, so a big set never sits in memory)
//! and 🗑 Delete all behind its own two-step confirm. These are pictures of people.

import { photoAgo, photosState, photosStopLine, photosSummary, photosUnsavedLine, type PhotosView } from '@loom/core/photos'
import clsx from 'clsx'
import { useCallback, useEffect, useState } from 'react'
import { photosApi } from '@/lib/api'
import { useTerminals } from '@/store/terminals'

/** How often the card re-reads the panel while it is up and the page is visible. */
export const PHOTOS_POLL_MS = 5000
/** A thumbnail moves on this often at most. */
export const THUMB_STEP_MS = 30_000
/** The note under the buttons: End drops the event, and its routes with it. */
export const PHOTOS_END_NOTE = 'Download before End: End stops the event, and the files stay on the server with no button to reach them.'

/** The thumbnail's cache key: one step in `THUMB_STEP_MS`, so a screenful of them isn't a stream. */
export function thumbStep(lastAt: number): number {
  return Math.floor(lastAt / THUMB_STEP_MS)
}

/** The panel off a view. `eventId`: for the thumbnails and the download's link. */
export function PhotosCardBody({ view, eventId, error, confirming, onArm, onDelete, onConfirm }: { view: PhotosView; eventId: string; error: string | null; confirming: boolean; onArm: (armed: boolean) => void; onDelete: () => void; onConfirm: (open: boolean) => void }) {
  const stop = photosStopLine(view)
  const unsaved = photosUnsavedLine(view)
  return (
    <div className="mb-2 rounded border border-zinc-800 px-2 py-1" data-testid="run-photos">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-zinc-400" title="Each terminal with a working camera takes one photo every 15 s while armed, the Server Room only while a program is at his heart. Never the Tent or the TV. Invisible on the terminal.">
          📷 Photos
        </span>
        <button
          onClick={() => onArm(!view.armed)}
          aria-pressed={view.armed}
          className={clsx('rounded border px-3 py-1 text-sm font-bold tracking-wider', view.armed ? 'border-red-500 bg-red-700 text-white' : 'border-zinc-600 text-zinc-200 hover:bg-zinc-900')}
          title={view.armed ? 'Press to make safe: every terminal stops within a poll' : 'Press to arm'}
          data-testid="run-photos-arm"
        >
          {photosState(view)}
        </button>
        <span className="text-[11px] tabular-nums text-zinc-400" data-testid="run-photos-summary">
          {photosSummary(view)}
        </span>
        <a
          href={photosApi.downloadUrl(eventId)}
          download
          className={clsx('ml-auto rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-900', view.count === 0 && 'pointer-events-none opacity-40')}
          aria-disabled={view.count === 0}
          title="A tar of every photo, one folder per terminal"
          data-testid="run-photos-download"
        >
          ⬇ Download all
        </a>
        {!confirming && (
          <button onClick={() => onConfirm(true)} disabled={view.count === 0} className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-900 disabled:opacity-40" data-testid="run-photos-delete">
            🗑 Delete all
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-1 flex flex-wrap items-center gap-2 rounded border border-red-800 bg-red-950/40 px-2 py-1 text-[11px] text-red-100" data-testid="run-photos-confirm">
          <span>Delete all {view.count} photos from the server, for good?</span>
          <button onClick={onDelete} className="rounded border border-red-500 bg-red-800 px-2 py-0.5 font-semibold text-white" data-testid="run-photos-delete-yes">
            Yes, delete them
          </button>
          <button onClick={() => onConfirm(false)} className="rounded border border-zinc-600 px-2 py-0.5 text-zinc-200" data-testid="run-photos-delete-no">
            Keep them
          </button>
        </div>
      )}
      {stop !== null && <p className="mt-1 text-[11px] text-red-300">🛑 {stop}</p>}
      {unsaved !== null && <p className="mt-1 text-[11px] text-red-300">⚠ {unsaved}</p>}
      {error !== null && error !== unsaved && <p className="mt-1 text-[11px] text-amber-300">⚠ {error}</p>}
      <ul className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1">
        {view.terminals.map((t) => (
          <li key={t.spot} className="flex min-w-0 items-center gap-1 text-[11px]" data-testid={`run-photos-row-${t.spot}`}>
            {t.lastAt !== null ? <img src={photosApi.thumbUrl(eventId, t.spot, thumbStep(t.lastAt))} alt={`The last photo from ${t.name}`} className="h-9 w-12 shrink-0 bg-black object-cover" /> : <span className="h-9 w-12 shrink-0 bg-zinc-900" aria-hidden="true" />}
            <span className="min-w-0">
              <span className="block truncate font-medium text-zinc-200">{t.name}</span>
              <span className="block text-zinc-500">
                {t.count} · {photoAgo(view.now, t.lastAt)}
                {t.only !== undefined && ` · ${t.only}`}
              </span>
              {t.note !== null && <span className="block text-amber-300">⚠ {t.note}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-zinc-500">{PHOTOS_END_NOTE}</p>
    </div>
  )
}

/** The card: nothing until the server answers with a view (an older server has none). */
export function PhotosCard() {
  const eventId = useTerminals((s) => s.eventId)
  const [view, setView] = useState<PhotosView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const load = useCallback(async () => {
    if (eventId === null || eventId === undefined) return
    try {
      setView(await photosApi.view(eventId))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [eventId])
  useEffect(() => {
    setView(null)
    setConfirming(false)
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, PHOTOS_POLL_MS)
    return () => clearInterval(timer)
  }, [load])
  if (view === null || eventId === null || eventId === undefined) return null
  const act = (call: () => Promise<PhotosView>) => {
    call().then(
      (next) => {
        setView(next)
        setError(null)
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
        // A refused press can still have moved something: show what's true now.
        photosApi.view(eventId).then(setView, () => {})
      },
    )
  }
  return (
    <PhotosCardBody
      view={view}
      eventId={eventId}
      error={error}
      confirming={confirming}
      onArm={(armed) => act(() => photosApi.arm(eventId, armed))}
      onConfirm={setConfirming}
      onDelete={() => {
        setConfirming(false)
        act(() => photosApi.deleteAll(eventId))
      }}
    />
  )
}
