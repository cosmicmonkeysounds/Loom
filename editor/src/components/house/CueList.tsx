//! Run → House: the cue list — sections, the playhead ▶, each cue's number,
//! name, one-line steps, planned length and story events, and a running
//! cue's progress with its steps' states. Click selects (the inspector);
//! double-click GOes; the ▶ gutter puts the playhead there.

import clsx from 'clsx'
import { runProgress, type DeskConfig, type DeskDurations, type DeskView } from '@loom/core/house-desk'
import { useHouseDesk } from '@/store/house-desk'
import { cueRows, stepStateGlyph, type CueRow } from '@/lib/house-desk-view'
import { addCue, newCue } from '@/lib/house-desk-edit'
import { btn, heading } from './ui'

export function CueList({ desk, view, now, durations }: { desk: DeskConfig; view: DeskView; now: number; durations: DeskDurations }) {
  const sel = useHouseDesk((s) => s.sel)
  const edit = useHouseDesk((s) => s.edit)
  const sections = cueRows(desk, view, durations)
  const add = () => {
    const at = sel !== null ? sel + 1 : desk.cues.length
    const { desk: next, index } = addCue(desk, newCue(desk, 'New cue', view.house.looks.map((l) => l.name)), at)
    edit(next, index, null)
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2" data-testid="house-cues">
      {desk.cues.length === 0 && (
        <p className="p-4 text-center text-sm text-zinc-500">
          No cues yet. Add one, give it steps (a sound, a look, a story event…), save, then GO it here or with <span className="font-mono text-zinc-300">cue &lt;id&gt;</span> in the story.
        </p>
      )}
      {sections.map((s, si) => (
        <div key={`${s.title ?? ''}-${si}`} className="mb-2">
          {s.title !== null && <div className={clsx(heading, 'px-2 pb-1 pt-2')}>{s.title}</div>}
          <ul>
            {s.rows.map((r) => (
              <Row key={`${r.index}-${r.cue.id}`} row={r} selected={sel === r.index} now={now} />
            ))}
          </ul>
        </div>
      ))}
      <button onClick={add} className={clsx(btn, 'ml-2 mt-1')} data-testid="house-add-cue">
        + Cue
      </button>
    </div>
  )
}

function Row({ row, selected, now }: { row: CueRow; selected: boolean; now: number }) {
  const select = useHouseDesk((s) => s.select)
  const go = useHouseDesk((s) => s.go)
  const standby = useHouseDesk((s) => s.standby)
  const { cue, run } = row
  const running = run?.state === 'running'
  return (
    <li
      onClick={() => select(row.index)}
      onDoubleClick={() => void go(cue.id)}
      className={clsx(
        'group flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs',
        selected ? 'bg-indigo-950/60 ring-1 ring-indigo-700' : 'hover:bg-zinc-900',
        row.standby && 'border-l-2 border-emerald-500',
      )}
      title="Click to edit · double-click to GO"
      data-testid={`house-cue-${cue.id}`}
      data-standby={row.standby || undefined}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          void standby(cue.id)
        }}
        className={clsx('w-4 shrink-0 text-center', row.standby ? 'text-emerald-400' : 'text-transparent group-hover:text-zinc-600')}
        title="Put the playhead here"
        data-testid={`house-standby-${cue.id}`}
      >
        ▶
      </button>
      <span className="w-8 shrink-0 text-right font-mono text-zinc-500">{cue.number ?? ''}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={clsx('truncate font-medium', running ? 'text-emerald-200' : 'text-zinc-100')}>{cue.name}</span>
          <span className="truncate font-mono text-[10px] text-zinc-600">{cue.id}</span>
        </span>
        <span className="block truncate text-[11px] text-zinc-400">{row.summary}</span>
        {row.events.length > 0 && (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {row.events.map((ev, i) => (
              <span key={`${ev}-${i}`} className="rounded bg-amber-950/50 px-1 text-[10px] text-amber-200" title="A story event this cue fires (when …:)">
                ⚡ {ev}
              </span>
            ))}
          </span>
        )}
        {run !== null && (
          <span className="mt-1 flex items-center gap-2">
            {running && (
              <span className="h-1 w-24 overflow-hidden rounded bg-zinc-800">
                <span className="block h-full bg-emerald-500" style={{ width: `${Math.round(runProgress(run, now) * 100)}%` }} />
              </span>
            )}
            <span className="font-mono text-[10px] text-zinc-500" title={run.steps.map((s) => `step ${s.i + 1}: ${s.state}${s.result !== undefined ? ` (${s.result})` : ''}`).join('\n')}>
              {run.steps.map((s) => stepStateGlyph(s.state)).join(' ')}
            </span>
            <span className="text-[10px] text-zinc-500">{running ? 'running' : run.state === 'stopped' ? 'stopped' : 'done'}</span>
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-zinc-500">{row.planned}</span>
    </li>
  )
}
