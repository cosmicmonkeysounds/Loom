//! The house sound on Run (wave 18b): the header's **■ Stop house sounds**
//! (Q7, on every Run page) and the Run page's **House sound** card — the
//! router's presence, the stop with its *+ announcements* box, and the
//! house list of map terminals whose tablets also say the announcements
//! (Q8: a tablet follows it unless its own ⚙ says Always / Never). Ticking a
//! spot is a director save for this event; **Save to project** writes it to
//! the project's `audio.json` so End → relaunch keeps it. Reads
//! `store/house-audio.ts` (bound to the server run in `App.tsx`) and the
//! terminal store's house map; a local run has no router and shows neither.

import { useState } from 'react'
import clsx from 'clsx'
import { RunBackend, useCockpit } from '@/store/cockpit'
import { useHouseAudio } from '@/store/house-audio'
import { useTerminals } from '@/store/terminals'
import { TerminalStatus } from '@/lib/terminals'
import { DIRECTOR_SAVE_PINS, StopOutcome, announceTerminalsOf, routerLine, sourceLabel, stopButtonLabel } from '@/lib/house-audio'
import { useNow } from '@/components/cockpit/director/clock'

const btn = 'rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40'

/** The header's **■ Stop house sounds**: one press, no confirm (it is the
 *  panic button), the house sounds only — the card's box adds the
 *  announcement. Server runs only. */
export function StopSoundsButton() {
  const server = useCockpit((s) => s.run?.backend === RunBackend.Server)
  const bound = useHouseAudio((s) => s.eventId !== null)
  const busy = useHouseAudio((s) => s.busy === 'stop')
  const note = useHouseAudio((s) => s.stopNote)
  const stop = useHouseAudio((s) => s.stop)
  if (!server || !bound) return null
  return (
    <button
      onClick={() => void stop(false)}
      disabled={busy}
      className={clsx(
        'shrink-0 whitespace-nowrap rounded border px-2 py-0.5 text-[11px] disabled:opacity-50',
        note === null
          ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-900'
          : note.outcome === StopOutcome.Stopped
            ? 'border-emerald-700 text-emerald-200'
            : note.outcome === StopOutcome.Failed
              ? 'border-red-600 bg-red-950/60 text-red-100 hover:bg-red-900/60'
              : 'border-amber-600 bg-amber-950/40 text-amber-100',
      )}
      title={
        note?.text ??
        'Fade out every story sound and speaker test on the house speakers now (not the TV voice, the terminals or the live mics). The House sound card on the Run page also cuts the announcement.'
      }
      data-testid="run-stop-sounds"
    >
      {busy ? '■ Stopping…' : note !== null ? stopButtonLabel(note.outcome) : '■ Stop house sounds'}
    </button>
  )
}

export function HouseSoundCard() {
  const status = useHouseAudio((s) => s.status)
  const reachable = useHouseAudio((s) => s.reachable)
  const busy = useHouseAudio((s) => s.busy)
  const note = useHouseAudio((s) => s.stopNote)
  const saveError = useHouseAudio((s) => s.saveError)
  const stop = useHouseAudio((s) => s.stop)
  const setTerminal = useHouseAudio((s) => s.setTerminal)
  const saveToProject = useHouseAudio((s) => s.saveToProject)
  const map = useTerminals((s) => s.map)
  const rows = useTerminals((s) => s.rows)
  const [withAnnounce, setWithAnnounce] = useState(false)
  const now = useNow(status !== null && !status.router.online, 30_000)
  // An older server (no audio route) or none read yet: nothing to show.
  if (status === null) return null
  const listed = new Set(announceTerminalsOf(status.audio))
  const saying = (spot: string) => rows.some((r) => r.spot === spot && r.status === TerminalStatus.Live && r.device?.announce === true)
  // A listed spot the map playing now doesn't have (the other variant's).
  const stray = [...listed].filter((id) => map !== null && !map.some((t) => t.id === id))

  return (
    <section className={clsx('rounded-xl border bg-zinc-950 p-3', status.router.online ? 'border-emerald-800/60' : 'border-zinc-800')} data-testid="run-house-sound">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">House sound</span>
        <span className={clsx('flex items-center gap-1 text-xs', status.router.online ? 'text-emerald-300' : 'text-amber-300')} data-testid="run-house-sound-router">
          <span className={clsx('h-2 w-2 rounded-full', status.router.online ? 'bg-emerald-500' : 'bg-amber-500')} />
          {routerLine(status.router, status.now ?? now)}
        </span>
      </div>
      {!reachable && <p className="mb-2 rounded bg-red-950/60 px-2 py-1 text-xs text-red-200">Can’t reach the server: the house sound may be fine.</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void stop(withAnnounce)}
          disabled={busy === 'stop'}
          className="rounded border border-red-800 bg-red-950/40 px-3 py-1 text-xs text-red-100 hover:bg-red-900/50 disabled:opacity-50"
          data-testid="run-house-sound-stop"
        >
          {busy === 'stop' ? '■ Stopping…' : '■ Stop house sounds'}
        </button>
        <label className="flex items-center gap-1 text-xs text-zinc-400">
          <input type="checkbox" checked={withAnnounce} onChange={(e) => setWithAnnounce(e.target.checked)} data-testid="run-house-sound-announce" />+ announcements (cut the one playing, drop the queue)
        </label>
      </div>
      {note !== null && (
        <p
          className={clsx('mt-1 text-xs', note.outcome === StopOutcome.Stopped ? 'text-emerald-300' : note.outcome === StopOutcome.Failed ? 'text-red-300' : 'text-amber-300')}
          data-testid="run-house-sound-note"
        >
          {note.text}
        </p>
      )}
      <p className="mt-1 text-[11px] text-zinc-500">
        Fades out every story sound and speaker test on the house speakers (0.3 s). The TV’s voice (its own mute), the terminals and the live mics
        are untouched, and stopping the dance song does not move the story’s clock. Hosts have the same button in the Play app.
      </p>

      <div className="mt-3 text-xs text-zinc-400">Tablets that also say the announcements</div>
      <p className="text-[11px] text-zinc-500">
        The house setting: a tablet on a ticked spot says them aloud unless its own ⚙ says Always or Never. Off for most tablets: the house speakers reach
        them.
      </p>
      {map === null || map.length === 0 ? (
        <p className="mt-1 text-[11px] text-zinc-600">No house map read yet: the spots come from the map playing now.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-0.5" data-testid="run-house-sound-terminals">
          {map.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-xs">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-zinc-300">
                <input
                  type="checkbox"
                  checked={listed.has(t.id)}
                  disabled={busy !== null}
                  onChange={(e) => void setTerminal(t.id, e.target.checked)}
                  data-testid={`run-house-sound-spot-${t.id}`}
                />
                <span className="truncate">{t.name}</span>
                <span className="truncate text-[10px] text-zinc-500">
                  {t.id}
                  {t.location !== '' ? ` · ${t.location}` : ''}
                </span>
              </label>
              {saying(t.id) && (
                <span className="shrink-0 text-[10px] text-zinc-500" title="A live tablet on this spot says the announcements now">
                  📢
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {stray.length > 0 && <p className="mt-1 text-[11px] text-amber-300">Also listed, not on the map playing now: {stray.join(', ')}</p>}
      {saveError !== null && (
        <p className="mt-1 rounded bg-amber-950/60 px-2 py-1 text-xs text-amber-200" data-testid="run-house-sound-error">
          {saveError}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <span data-testid="run-house-sound-source">In force: {sourceLabel(status.source)}</span>
        {status.source === 'director' && (
          <button className={btn} disabled={busy !== null} onClick={() => void saveToProject()} data-testid="run-house-sound-project">
            {busy === 'project' ? 'Saving…' : 'Save to project'}
          </button>
        )}
      </div>
      {status.source === 'director' && (
        <p className="mt-1 text-[11px] text-amber-300/90" data-testid="run-house-sound-pins">
          {DIRECTOR_SAVE_PINS}
        </p>
      )}
    </section>
  )
}
