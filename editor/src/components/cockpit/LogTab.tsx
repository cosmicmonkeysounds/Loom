//! Run mode — the Log page: the raw ledger, one row per `SimEvent`,
//! newest at the bottom, on either backend (the local run's whole ledger,
//! or the shared event's `sim` feed since this console connected). This
//! is the super-admin's x-ray: every action line, dialogue, world write,
//! hook firing, and diagnostic the engine produced, exactly as the server
//! journals them — filterable to one participant ("everything that
//! happened to Alice"). Formatting is driven off the `SimEventType` enum
//! so a new event kind fails the exhaustiveness check here instead of
//! rendering blank. The header exports the whole run (ledger + every
//! room's transcript + world state) as JSON for bug reports / post-mortems
//! — a run that just ended included.

import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { SimEventType, type SimEvent } from '@loom/core/sim'
import { CockpitContext, useCockpit, type LedgerEntry } from '@/store/cockpit'
import { canExportRun, downloadRunExport } from '@/lib/run-export'
import { eventMentions } from './log-filter'

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

/** One-line human rendering of a sim event. */
function describe(e: SimEvent): string {
  switch (e.type) {
    case SimEventType.AccountCreated:
      return `${e.name} joined as ${e.role} (${e.person})`
    case SimEventType.Joined:
      return `${e.person} joined ${e.faction}`
    case SimEventType.Defected:
      return `${e.person} defected ${e.from ?? 'unaligned'} → ${e.to}`
    case SimEventType.Betrayed:
      return `${e.person} secretly serves ${e.secret}`
    case SimEventType.FactionRevealed:
      return `${e.faction} exposed`
    case SimEventType.Scanned:
      return `${e.scanner} scanned ${e.person}`
    case SimEventType.Captured:
      return `${e.person} captured → ${e.location}${e.by ? ` by ${e.by}` : ''}`
    case SimEventType.Released:
      return `${e.person} released from ${e.location}`
    case SimEventType.Escaped:
      return `${e.person} escaped`
    case SimEventType.Arrived:
      return `${e.person} → ${e.location}${e.from ? ` (from ${e.from})` : ''}`
    case SimEventType.Cast:
      return `${e.person} cast as ${e.role}`
    case SimEventType.Promoted:
      return `${e.person} promoted to ${e.role}`
    case SimEventType.WorldSet:
      return `${e.path} = ${e.value}`
    case SimEventType.RelationshipChanged:
      return `${e.subject}.${e.relation}.${e.object} = ${e.value}`
    case SimEventType.Broadcast:
      return `broadcast "${e.cue}" → ${e.scope || 'all'} (${e.audience.length || 'all'})`
    case SimEventType.Dialogue:
      return `${e.speaker}: ${e.text}`
    case SimEventType.Chat:
      return `${e.from} #${e.channel}: ${e.text}`
    case SimEventType.ChannelInvited:
      return `${e.person} invited to ${e.channel} by ${e.by}`
    case SimEventType.ChannelLeft:
      return `${e.person} left ${e.channel}`
    case SimEventType.Action:
      return e.text
    case SimEventType.Directive:
      return `<${e.verb}: ${e.args}>`
    case SimEventType.BeatEntered:
      return `== ${e.beat}`
    case SimEventType.ChoicePrompted:
      return `choice for ${e.person ?? 'story'}: ${e.options.join(' | ')}`
    case SimEventType.Respond:
      return `${e.to} ⇐ ${e.text}`
    case SimEventType.Signal:
      return `signal "${e.name}"${e.subject ? ` on ${e.subject}` : ''}`
    case SimEventType.CodexUnlocked:
      return `${e.person} learned ${e.entry} (${e.via}${e.from ? ` from ${e.from}` : ''})`
    case SimEventType.CodexMissed:
      return `${e.person} tried the code "${e.code}" — nothing`
    case SimEventType.Ambient:
      return `${e.source}: ${e.text}`
    case SimEventType.Tick:
      return `tick +${e.elapsedMs}ms`
    case SimEventType.Diagnostic:
      return e.message
    default:
      return e.type
  }
}

function clock(ts: number): string {
  const s = Math.floor(ts / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function Row({ entry }: { entry: LedgerEntry }) {
  return (
    <div className="flex gap-2 border-b border-white/5 px-3 py-1 font-mono text-[11px] leading-[16px]">
      <span className="w-10 shrink-0 text-right text-zinc-600">{entry.seq}</span>
      <span className="w-12 shrink-0 text-zinc-600">{clock(entry.ts)}</span>
      <span className="w-36 shrink-0 truncate text-zinc-500">{entry.event.type}</span>
      <span className={clsx('min-w-0 flex-1 break-words', toneOf(entry.event.type))}>
        {describe(entry.event)}
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
  const rows = useMemo(() => (who === '' ? log : log.filter((e) => eventMentions(e.event, who))), [log, who])
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [rows.length])
  const missed = log.length > 0 ? Math.max(0, ledgerLen - log.length) : 0
  return (
    <div className="flex h-full flex-col" data-testid="sim-log">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-1 text-[11px] text-zinc-500">
        <span className="flex items-center gap-2">
          <span>
            {who === '' ? `${log.length} of ${ledgerLen} events` : `${rows.length} of ${log.length} events mention`}
            {missed > 0 && who === '' && <span className="ml-1 text-zinc-600">(earlier events predate this console)</span>}
          </span>
          <select
            value={who}
            onChange={(e) => setWho(e.target.value)}
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
          onClick={() => downloadRunExport(store.getState())}
          disabled={!exportable}
          className="rounded border border-zinc-800 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          title={running ? 'Download the ledger, every room\'s transcript, and the world state as JSON' : 'Download the run that just ended'}
          data-testid="run-export"
        >
          ⤓ Export run
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 && (
          <div className="p-4 text-sm text-zinc-600">
            {running ? (who === '' ? 'No events yet on this console.' : 'Nothing mentions them yet.') : 'The ledger is empty — start a rehearsal.'}
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
