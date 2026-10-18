//! The header's NEXT pill (every Run page): `▶ NEXT 📊 Trust Chart`, or —
//! nothing to press — the soonest countdown (`⏱ Midnight 37:52`), or
//! nothing at all. A click opens the Director page; it never fires.

import { useMemo } from 'react'
import clsx from 'clsx'
import { CockpitTab, useCockpit } from '@/store/cockpit'
import { cueRows, cueTitleTags } from '@loom/core/cue-sheet'
import { formatLeft, useCountdowns } from './clock'

export function NextCuePill() {
  const running = useCockpit((s) => s.run !== null)
  const locked = useCockpit((s) => s.lens !== null)
  const interactions = useCockpit((s) => s.interactions)
  const cues = useCockpit((s) => s.cues)
  const tab = useCockpit((s) => s.activeTab)
  const setTab = useCockpit((s) => s.setTab)
  const countdowns = useCountdowns()
  const next = useMemo(() => cueRows(interactions, cues).find((r) => r.next) ?? null, [interactions, cues])
  if (!running || locked || tab === CockpitTab.Director) return null
  const soon = countdowns[0]
  if (next === null && soon === undefined) return null
  return (
    <button
      onClick={() => setTab(CockpitTab.Director)}
      className={clsx(
        'max-w-[16rem] truncate rounded-full border px-2 py-0.5 text-[11px]',
        next !== null ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500',
        next === null && soon !== undefined && soon.left < 60 && 'text-red-400',
      )}
      title={next !== null ? 'The next cue — open the Director page to arm and fire it' : 'Nothing to press — the story runs until this'}
      data-testid="next-cue-pill"
    >
      {next !== null ? `▶ NEXT ${next.code !== null ? `${next.code} · ` : ''}${cueTitleTags(next.title).title}` : `⏱ ${soon!.label} ${formatLeft(soon!.left)}`}
    </button>
  )
}
