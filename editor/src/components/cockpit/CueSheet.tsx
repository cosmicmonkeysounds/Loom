//! Run → Director's cue sheet (K-21): the story's `who: admin`
//! INTERACTIONs in running order, one click each, the last cue marked
//! and the next suggested, `Night.phase` up top, and a filter. The state
//! (`cues`) comes off the server's sim log, so a second director signing
//! in mid-show sees the same marks. Desktop only — the phone fallback is
//! the radio.

import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useCockpit } from '@/store/cockpit'
import { cueRows, filterCues, nightPhase, type CueRow } from './cue-sheet'

export function CueSheet() {
  const interactions = useCockpit((s) => s.interactions)
  const cues = useCockpit((s) => s.cues)
  const world = useCockpit((s) => s.world)
  const fireSignal = useCockpit((s) => s.fireSignal)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const rows = useMemo(() => cueRows(interactions, cues), [interactions, cues])
  const shown = useMemo(() => filterCues(rows, query), [rows, query])
  const phase = nightPhase(world)
  const last = rows.find((r) => r.last) ?? null

  // Keep the next cue in view as the night moves down the sheet.
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('[data-next="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cues.last])

  if (rows.length === 0) return null

  const fire = async (row: CueRow) => {
    if (pending !== null) return // one cue in flight at a time — no double fires
    setPending(row.id)
    setFailed(null)
    try {
      await fireSignal(row.id)
    } catch (e) {
      setFailed(`${row.code ?? row.title}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 p-3" data-testid="cue-sheet">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Cue sheet</div>
        <span
          className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300"
          title="Night.phase — the story's own idea of where the night is"
          data-testid="cue-phase"
        >
          phase: {phase ?? '—'}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500" data-testid="cue-last">
          {last === null ? 'nothing fired yet' : `last: ${last.code ?? '#' + last.n} ${last.title}${cues.lastBy === 'story' ? ' (auto)' : ''}`}
        </span>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="filter cues — V4, hunt, printer…"
        className="mb-2 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
        data-testid="cue-filter"
      />
      {failed !== null && <div className="mb-2 rounded bg-red-950/60 px-2 py-1 text-xs text-red-300">{failed}</div>}
      <ol ref={listRef} className="flex max-h-[28rem] flex-col gap-1 overflow-auto">
        {shown.map((r) => (
          <li key={r.id} data-next={r.next ? 'true' : undefined}>
            <button
              onClick={() => void fire(r)}
              disabled={pending !== null}
              title={`fire ${r.id}`}
              className={clsx(
                'flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-sm disabled:cursor-wait',
                r.last ? 'border-amber-500 bg-amber-950/40 text-amber-100'
                : r.next ? 'border-indigo-500 bg-indigo-950/40 text-zinc-100'
                : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600',
                pending === r.id && 'animate-pulse',
              )}
              data-testid={`cue-${r.id}`}
            >
              <span className="w-6 shrink-0 text-right font-mono text-[11px] text-zinc-600">{r.n}</span>
              <span className="w-20 shrink-0 truncate font-mono text-xs font-semibold text-zinc-200">{r.code ?? ''}</span>
              <span className={clsx('min-w-0 flex-1 truncate', r.fired && !r.last && 'text-zinc-500')}>{r.title}</span>
              {r.last && <span className="shrink-0 rounded bg-amber-500 px-1 text-[10px] font-bold text-black">LAST</span>}
              {r.next && <span className="shrink-0 rounded bg-indigo-500 px-1 text-[10px] font-bold text-white">NEXT</span>}
              {r.fired && !r.last && <span className="shrink-0 text-xs text-emerald-500" title="fired tonight">✓</span>}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-2 py-1 text-xs text-zinc-600">No cue matches “{query}”.</li>}
      </ol>
    </section>
  )
}
