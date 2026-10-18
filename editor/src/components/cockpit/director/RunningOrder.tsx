//! The running order (spec §2.4): the story's admin cues by act. The focus
//! act is open (its fired rows muted, one line of each description); past
//! acts fold to `✓ n/m`, the acts ahead to their count and first cue. An
//! expanded act that On hand does not cover shows its asides as chips under
//! its spine. `/ find a cue` forces every act open and lists only matches;
//! `⇲ all` opens everything (the old flat list). With no acts, the fired
//! rows well above LAST fold into `N earlier cues ✓ ▸`. The award recap
//! tools sit on the act holding the first award.

import { forwardRef, useState, type Dispatch, type SetStateAction } from 'react'
import clsx from 'clsx'
import { cueTitleTags, filterCues, previousActIndex, type CueAct, type CueRow } from '@loom/core/cue-sheet'
import { ChipDetail, CueButton } from './CueButton'
import { useDirector } from './context'

/** Fired rows more than this many above LAST fold (a story with no acts). */
const KEEP_ABOVE_LAST = 3

function AwardTools() {
  const { awards } = useDirector()
  if (!awards.recapTools) return null
  return (
    <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => void awards.loadRecap()}
        title="re-read the recap and refresh the award suggestions (your own picks stay)"
        className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-zinc-300 hover:border-zinc-500"
        data-testid="cue-recap-refresh"
      >
        ↻ awards
      </button>
      <button
        onClick={() => void awards.copyRecap()}
        title="copy the recap text (for the cast:Trabolta paste)"
        className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-zinc-300 hover:border-zinc-500"
        data-testid="cue-recap-copy"
      >
        Copy recap
      </button>
    </span>
  )
}

function RecapNote() {
  const { awards } = useDirector()
  if (awards.recapNote === null) return null
  return (
    <div className="text-[11px] text-zinc-500" data-testid="cue-recap-note">
      {awards.recapNote}
    </div>
  )
}

function actSummary(a: CueAct): string {
  const asides = a.asides.length > 0 ? ` · asides ${a.asides.filter((r) => r.fired).length}/${a.asides.length}` : ''
  switch (a.state) {
    case 'past':
      return `✓ ${a.firedSpine}/${a.spine.length}${asides}`
    case 'skipped':
      return `– skipped${asides}`
    case 'focus':
      return `${a.firedSpine}/${a.spine.length}${asides}`
    case 'anytime':
      return `⚡ ${a.rows.length}`
    default: {
      const first = a.spine[0]
      return `${a.spine.length}${first !== undefined ? ` · next: ${cueTitleTags(first.title).title}` : ''}`
    }
  }
}

function SpineList({ rows, brief, actCode }: { rows: CueRow[]; brief: boolean; actCode?: string | null }) {
  return (
    <ol className="flex flex-col gap-1">
      {rows.map((r) => (
        <CueButton key={r.id} row={r} variant="row" brief={brief} actCode={actCode} />
      ))}
    </ol>
  )
}

function AsideChips({ rows }: { rows: CueRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-1 pl-8">
      <div className="flex flex-wrap gap-1">
        {rows.map((r) => (
          <CueButton key={r.id} row={r} variant="chip" />
        ))}
      </div>
      <ChipDetail rows={rows} />
    </div>
  )
}

/** A story with no acts: the fired rows well above LAST fold. */
function FlatList({ rows }: { rows: CueRow[] }) {
  const [unfold, setUnfold] = useState(false)
  const spine = rows.filter((r) => r.sequence)
  const lastAt = spine.findIndex((r) => r.last)
  const cut = unfold || lastAt < 0 ? 0 : Math.max(0, lastAt - KEEP_ABOVE_LAST)
  const folded = spine.slice(0, cut).filter((r) => r.fired)
  const shown = spine.filter((r, i) => i >= cut || !r.fired)
  return (
    <div className="flex flex-col gap-1">
      {folded.length > 0 && (
        <button onClick={() => setUnfold(true)} className="self-start text-[11px] text-zinc-500 hover:text-zinc-300" data-testid="director-earlier">
          {folded.length} earlier cue{folded.length === 1 ? '' : 's'} ✓ ▸
        </button>
      )}
      <SpineList rows={shown} brief />
    </div>
  )
}

export interface RunningOrderProps {
  query: string
  setQuery(q: string): void
  toggled: Record<string, boolean>
  setToggled: Dispatch<SetStateAction<Record<string, boolean>>>
  all: boolean
  setAll(v: boolean): void
}

export const RunningOrder = forwardRef<HTMLInputElement, RunningOrderProps>(function RunningOrder(
  { query, setQuery, toggled, setToggled, all, setAll },
  filterRef,
) {
  const d = useDirector()
  const filtering = query.trim() !== ''
  const matches = filtering ? new Set(filterCues(d.rows, query).map((r) => r.id)) : null
  const named = d.acts.some((a) => a.title !== null || a.code !== null)
  const prevIdx = previousActIndex(d.acts, d.focus)
  // The act holding the first award carries the recap tools.
  const awardAct = d.rows.find((r) => r.subject && r.id.startsWith('award_'))
  const awardKey = awardAct !== undefined ? d.actOf.get(awardAct.id)?.key : undefined
  if (d.rows.length === 0) return null

  return (
    <section className="flex flex-col gap-2" data-testid="cue-sheet">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Running order</div>
        {!named && <AwardTools />}
        <input
          ref={filterRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setQuery('')
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          placeholder="/ find a cue — V4, hunt, printer…"
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm outline-none focus:border-indigo-500"
          data-testid="cue-filter"
        />
        {named && (
          <button
            onClick={() => setAll(!all)}
            className={clsx('rounded border px-1.5 py-0.5 text-[11px]', all ? 'border-indigo-500/70 text-indigo-300' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500')}
            title={all ? 'fold the acts back' : 'open every act (the flat list)'}
            data-testid="director-all"
          >
            ⇲ all
          </button>
        )}
      </div>
      {!named && <RecapNote />}
      {!named && !filtering && <FlatList rows={d.acts[0]?.rows ?? d.rows} />}
      {!named && filtering && <SpineList rows={d.rows.filter((r) => matches!.has(r.id))} brief={false} />}
      {named &&
        d.acts.map((a, k) => {
          const inOnHand = k === d.focus || k === prevIdx || a.state === 'anytime'
          // Anytime acts live on On hand's ⚡ line; listed here only when searching.
          if (a.state === 'anytime' && !filtering) return null
          const rows = matches === null ? a.rows : a.rows.filter((r) => matches.has(r.id))
          if (filtering && rows.length === 0) return null
          const open = filtering || all || (toggled[a.key] ?? a.state === 'focus')
          const spine = rows.filter((r) => r.sequence)
          const asides = rows.filter((r) => !r.sequence)
          const testKey = a.code ?? String(k)
          return (
            <div key={a.key || `act-${k}`} className="flex scroll-mt-2 flex-col gap-1" data-testid={`director-act-${testKey}`} data-act-key={a.key} data-state={a.state}>
              <div
                role="button"
                tabIndex={-1}
                onClick={() => setToggled((t) => ({ ...t, [a.key]: !open }))}
                className={clsx(
                  'flex cursor-pointer flex-wrap items-center gap-2 rounded px-1 py-0.5 text-xs font-semibold uppercase tracking-wide hover:bg-zinc-900/60',
                  a.state === 'past' || a.state === 'skipped' ? 'text-zinc-500' : 'text-zinc-400',
                )}
                aria-expanded={open}
              >
                <span className="w-3 text-zinc-500">{open ? '▾' : '▸'}</span>
                {a.state === 'focus' && <span className="text-indigo-300">●</span>}
                {a.state === 'past' && <span className="text-emerald-500">✓</span>}
                <span className="min-w-0 truncate normal-case tracking-normal">
                  {a.code !== null && <span className="font-mono">{a.code} · </span>}
                  {a.title ?? (a.state === 'anytime' ? '⚡ Anytime' : 'Before the first act')}
                </span>
                {a.starting && <span className="rounded bg-indigo-500/20 px-1 text-[10px] normal-case tracking-normal text-indigo-300">starting</span>}
                <span className="font-normal normal-case tracking-normal text-zinc-500">{actSummary(a)}</span>
                {a.key === awardKey && <AwardTools />}
              </div>
              {a.key === awardKey && <RecapNote />}
              {open && (
                <div className="flex flex-col gap-1 pl-2">
                  <SpineList rows={spine} brief={a.state === 'focus' && !filtering} actCode={filtering ? a.code : undefined} />
                  {(filtering || !inOnHand) && <AsideChips rows={asides} />}
                </div>
              )}
            </div>
          )
        })}
      {filtering && matches!.size === 0 && <div className="px-2 py-1 text-xs text-zinc-600">No cue matches “{query}”.</div>}
    </section>
  )
})
