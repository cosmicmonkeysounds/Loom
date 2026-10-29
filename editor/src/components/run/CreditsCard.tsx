//! Run → 🎬 Credits (wave 44, `docs/loom-w44-contract.md` C5 / C10): the
//! roll as the server would send it now, as text (core's `creditsRows`, so
//! in the TV's and the phones' order), where the file came from, what is
//! wrong with it, and how many times the story has rolled it. *No
//! credits.json in this project* on a 404 `no_credits`; any other 404 (an
//! older server) hides the card. It re-reads `GET /api/credits` every 15 s
//! while mounted and the tab is shown, so an edit to the project's file
//! shows here (and on the next roll) with no reload. No editing here: the
//! file is edited in Writing like any other. Pure rules in `credits-card.ts`.

import { useEffect, useState } from 'react'
import type { CreditsView } from '@loom/core/credits'
import { useCockpit } from '@/store/cockpit'
import { ApiError, creditsApi } from '@/lib/api'
import { CREDITS_AGAIN_NOTE, CREDITS_POLL_MS, NO_CREDITS, creditsCardRows, creditsSourceLabel, rollLabel } from './credits-card'

/** What the card knows: nothing yet, no file, or the roll. */
export type CreditsCardState = { kind: 'none' } | { kind: 'view'; view: CreditsView }

/** The card's body over one reading (rendered statically in the tests). */
export function CreditsPanel({ state }: { state: CreditsCardState }) {
  const view = state.kind === 'view' ? state.view : null
  const source = view === null ? null : creditsSourceLabel(view.source)
  const problems = view?.problems ?? []
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-3" data-testid="run-credits">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">🎬 Credits</span>
        {view !== null && (
          <span className="text-xs text-zinc-400" data-testid="run-credits-roll">
            {rollLabel(view.roll)}
          </span>
        )}
      </div>
      {view === null ? (
        <p className="text-xs text-zinc-500" data-testid="run-credits-none">
          {NO_CREDITS}. Add one in Writing to roll the credits at the end.
        </p>
      ) : (
        <>
          {source !== null && (
            <p className="mb-2 text-xs text-zinc-500" data-testid="run-credits-source">
              From {source}. Edit it in Writing; the next roll shows the change.
            </p>
          )}
          {problems.length > 0 && (
            <ul className="mb-2 flex flex-col gap-0.5 rounded bg-amber-950/50 px-2 py-1 text-xs text-amber-200" data-testid="run-credits-problems">
              {problems.map((p, i) => (
                <li key={i}>⚠ {p}</li>
              ))}
            </ul>
          )}
          <div className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-center text-xs" data-testid="run-credits-text">
            {creditsCardRows(view).map((r, i) => {
              switch (r.kind) {
                case 'gap':
                  return <div key={i} className="h-3" />
                case 'title':
                  return (
                    <div key={i} className="text-sm font-semibold text-zinc-100">
                      {r.text}
                    </div>
                  )
                case 'subtitle':
                  return (
                    <div key={i} className="text-zinc-400">
                      {r.text}
                    </div>
                  )
                case 'heading':
                  return (
                    <div key={i} className="text-[10px] uppercase tracking-widest text-zinc-500">
                      {r.text}
                    </div>
                  )
                case 'person':
                  return (
                    <div key={i} className="text-zinc-200">
                      <span className="text-zinc-500">{r.role}</span> {r.name}
                    </div>
                  )
                case 'line':
                  return (
                    <div key={i} className="text-zinc-300">
                      {r.text}
                    </div>
                  )
              }
            })}
          </div>
        </>
      )}
      <p className="mt-2 text-[11px] text-zinc-500" data-testid="run-credits-note">
        {CREDITS_AGAIN_NOTE}
      </p>
    </section>
  )
}

export function CreditsCard() {
  const eventId = useCockpit((s) => s.run?.eventId ?? null)
  const [state, setState] = useState<CreditsCardState | null>(null)
  const [missing, setMissing] = useState(false)

  // Mounted per event (`key={eventId}` on the Run page).
  useEffect(() => {
    if (eventId === null) return
    let cancelled = false
    const load = async () => {
      try {
        const view = await creditsApi.view(eventId)
        if (cancelled) return
        setState({ kind: 'view', view })
        setMissing(false)
      } catch (e) {
        if (cancelled || !(e instanceof ApiError) || e.status !== 404) return
        // `no_credits`: the project has no file. Any other 404 is an older
        // server with no route: the card stays away. Anything else keeps the
        // last reading; the next poll retries.
        if (e.message === 'no_credits') setState({ kind: 'none' })
        else setMissing(true)
      }
    }
    void load()
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void load()
    }, CREDITS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [eventId])

  if (eventId === null || missing || state === null) return null
  return <CreditsPanel state={state} />
}
