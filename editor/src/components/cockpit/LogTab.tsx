//! Run mode — the Log page: the raw ledger, one row per `SimEvent`,
//! newest at the bottom, on either backend (the local run's whole ledger,
//! or the shared event's `sim` feed since this console connected). This
//! is the super-admin's x-ray: every action line, dialogue, world write,
//! hook firing, and diagnostic the engine produced, exactly as the server
//! journals them — filterable to one participant ("everything that
//! happened to Alice"). Formatting is driven off the `SimEventType` enum
//! (`log-describe.ts`) so a new event kind fails the exhaustiveness check
//! there instead of rendering as its bare type name. The header exports the whole run (ledger + every
//! room's transcript + world state) as JSON for bug reports / post-mortems
//! — a run that just ended included. A server export pages the *whole*
//! ledger off `/api/mod/log`, not just what this console saw (T7-03).

import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { SimEventType } from '@loom/core/sim'
import { CockpitContext, useCockpit, type LedgerEntry } from '@/store/cockpit'
import { canExportRun, downloadRunExport } from '@/lib/run-export'
import { eventMentions, missingEvents } from './log-filter'
import { maskSecretWrites, pressSlice } from './director/press-effects'
import { secretHeads } from './director/glance'
import { describeEvent, logClock } from './log-describe'

/** Tone class per event type (grouped by family). */
function toneOf(type: SimEventType): string {
  switch (type) {
    case SimEventType.Dialogue:
    case SimEventType.Chat:
      return 'text-cyan-300'
    case SimEventType.Action:
    case SimEventType.Ambient:
      return 'text-zinc-300'
    case SimEventType.BeatEntered:
      return 'text-indigo-300'
    case SimEventType.ChoicePrompted:
    case SimEventType.Respond:
      return 'text-emerald-300'
    case SimEventType.Signal:
    case SimEventType.Broadcast:
    case SimEventType.Directive:
      return 'text-orange-300'
    case SimEventType.WorldSet:
    case SimEventType.RelationshipChanged:
      return 'text-amber-200/90'
    case SimEventType.Diagnostic:
      return 'text-rose-400'
    default:
      return 'text-zinc-400'
  }
}

function Row({ entry }: { entry: LedgerEntry }) {
  return (
    <div className="flex gap-2 border-b border-white/5 px-3 py-1 font-mono text-[11px] leading-[16px]">
      <span className="w-10 shrink-0 text-right text-zinc-600">{entry.seq}</span>
      <span className="w-12 shrink-0 overflow-hidden text-zinc-600">{logClock(entry.ts)}</span>
      <span className="w-36 shrink-0 truncate text-zinc-500">{entry.event.type}</span>
      <span className={clsx('min-w-0 flex-1 break-words', toneOf(entry.event.type))}>
        {describeEvent(entry.event)}
      </span>
    </div>
  )
}

export function LogTab() {
  const log = useCockpit((s) => s.log)
  const running = useCockpit((s) => s.run !== null)
  const exportable = useCockpit(canExportRun)
  const ledgerLen = useCockpit((s) => s.ledgerLen)
  const roster = useCockpit((s) => s.roster)
  const cast = useCockpit((s) => s.cast)
  const store = useContext(CockpitContext)
  const endRef = useRef<HTMLDivElement>(null)
  const [who, setWho] = useState('')
  // The Director's `did: +N more ↗ Log` focuses one press; switching tabs
  // away drops the focus (`tabSwitch` in the store, not an unmount cleanup —
  // StrictMode's dev remount would clear it, unmasking the whole ledger).
  const logPress = useCockpit((s) => s.logPress)
  const setLogPress = useCockpit((s) => s.setLogPress)
  const watch = useCockpit((s) => s.watch)
  // The press the Director's `did: +N more ↗ Log` opened: what that line
  // masks (a `secret: true` CHARACTER's values) stays masked here.
  const rows = useMemo(
    () =>
      logPress !== null
        ? maskSecretWrites(pressSlice(log, logPress), secretHeads(cast, watch))
        : who === ''
          ? log
          : log.filter((e) => eventMentions(e.event, who)),
    [log, who, logPress, cast, watch],
  )
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [rows.length])
  const missed = missingEvents(log.length, ledgerLen)
  return (
    <div className="flex h-full flex-col" data-testid="sim-log">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-1 text-[11px] text-zinc-500">
        <span className="flex items-center gap-2">
          {logPress !== null && (
            <span className="flex items-center gap-1 rounded border border-indigo-500/60 bg-indigo-500/10 px-1.5 py-0.5 text-indigo-300" data-testid="log-press">
              one press (#{logPress}) and what it did
              <button onClick={() => setLogPress(null)} className="text-zinc-400 hover:text-zinc-200" title="show the whole log">
                ✕
              </button>
            </span>
          )}
          <span className={clsx(logPress !== null && 'hidden')}>
            {who === '' ? `${log.length} of ${ledgerLen} events` : `${rows.length} of ${log.length} events mention`}
            {missed > 0 && who === '' && (
              <span className="ml-1 text-zinc-600" data-testid="log-missed">
                ({missed} earlier event{missed === 1 ? '' : 's'} predate this console — ⤓ Export run has them all)
              </span>
            )}
          </span>
          <select
            value={who}
            onChange={(e) => setWho(e.target.value)}
            disabled={logPress !== null}
            className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-300 outline-none focus:border-indigo-500"
            title="Show only the events that mention one participant"
            data-testid="log-filter"
          >
            <option value="">everyone</option>
            {roster.length > 0 && (
              <optgroup label="Guests">
                {roster.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.id})
                  </option>
                ))}
              </optgroup>
            )}
            {cast.length > 0 && (
              <optgroup label="Cast">
                {cast.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </span>
        <button
          onClick={() => void downloadRunExport(store.getState())}
          disabled={!exportable}
          className="rounded border border-zinc-800 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          title={running ? 'Download the whole ledger, every room\'s transcript, and the world state as JSON' : 'Download the run that just ended'}
          data-testid="run-export"
        >
          ⤓ Export run
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 && (
          <div className="p-4 text-sm text-zinc-600">
            {logPress !== null
              ? 'That press is no longer in this console’s log.'
              : running
                ? who === ''
                  ? missed > 0
                    ? `No events on this console yet — the run's ${missed} earlier events predate it (a reload or a late join). ⤓ Export run downloads the whole ledger.`
                    : 'No events yet on this console.'
                  : 'Nothing mentions them yet.'
                : 'The ledger is empty — start a rehearsal.'}
          </div>
        )}
        {rows.map((entry) => (
          <Row key={entry.seq} entry={entry} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
