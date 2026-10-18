//! On hand (spec §2.4): what a director can press besides NEXT — the focus
//! act's asides (its fallbacks and machine cues), the previous act's asides
//! as a `from D ▸` line (open by default: after 🌑 the Y2K hour's 🪩 and 🔌
//! stay one click away), and every Anytime cue on the `⚡` line.

import { useState } from 'react'
import { previousActIndex, type CueRow } from '@loom/core/cue-sheet'
import { ChipDetail, CueButton } from './CueButton'
import { actName, useDirector } from './context'

function ChipLine({ rows }: { rows: CueRow[] }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {rows.map((r) => (
          <CueButton key={r.id} row={r} variant="chip" />
        ))}
      </div>
      <ChipDetail rows={rows} />
    </div>
  )
}

export function OnHand() {
  const d = useDirector()
  const [prevOpen, setPrevOpen] = useState(true)
  const focus = d.acts[d.focus]
  const prevIdx = previousActIndex(d.acts, d.focus)
  const prev = prevIdx >= 0 ? d.acts[prevIdx] : undefined
  const anytime = d.acts.filter((a) => a.state === 'anytime').flatMap((a) => a.rows)
  const own = focus?.asides ?? []
  const fromPrev = prev?.asides ?? []
  if (own.length === 0 && fromPrev.length === 0 && anytime.length === 0) return null
  const named = d.acts.some((a) => a.title !== null)
  return (
    <section className="flex flex-col gap-2" data-testid="director-onhand">
      <div className="truncate text-xs font-semibold uppercase tracking-wide text-zinc-400">
        On hand
        {focus !== undefined && named && (
          <span className="font-normal normal-case tracking-normal text-zinc-500">
            {' · '}
            {focus.code !== null && <span className="font-mono">{focus.code} </span>}
            {focus.title ?? ''}
          </span>
        )}
      </div>
      {own.length > 0 && <ChipLine rows={own} />}
      {fromPrev.length > 0 && (
        <div className="flex flex-col gap-1">
          <button onClick={() => setPrevOpen((v) => !v)} className="self-start text-[11px] text-zinc-500 hover:text-zinc-300" data-testid="director-onhand-prev">
            from {actName(prev)} {prevOpen ? '▾' : '▸'}
          </button>
          {prevOpen && <ChipLine rows={fromPrev} />}
        </div>
      )}
      {anytime.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="director-anytime">
          <div className="text-[11px] text-zinc-500">⚡ Anytime</div>
          <ChipLine rows={anytime} />
        </div>
      )}
    </section>
  )
}
