//! The Night bar (spec §1.2, §3.3): where the night is. The act stepper
//! (✓ past · – skipped · ● the focus act · the rest ahead; hidden with
//! fewer than two acts that are not Anytime) — a chip opens that act in
//! the running order — `Night.phase`, the two soonest countdowns, and a
//! full-width PAUSED strip while the story clock stands still.

import clsx from 'clsx'
import { CockpitPhase, useCockpit } from '@/store/cockpit'
import { nightPhase, type CueAct } from '@loom/core/cue-sheet'
import { useDirector } from './context'
import { formatLeft, useCountdowns } from './clock'

function glyph(a: CueAct): string {
  switch (a.state) {
    case 'past':
      return '✓'
    case 'skipped':
      return '–'
    case 'focus':
      return '●'
    default:
      return ''
  }
}

export function NightBar() {
  const d = useDirector()
  const world = useCockpit((s) => s.world)
  const paused = useCockpit((s) => s.phase === CockpitPhase.Paused)
  const countdowns = useCountdowns()
  const phase = nightPhase(world)
  const steps = d.acts.filter((a) => a.state !== 'anytime')
  const stepper = steps.length >= 2
  return (
    <div className="flex flex-col gap-1" data-testid="director-night">
      {paused && (
        <div className="rounded bg-amber-500/15 px-2 py-0.5 text-center text-xs font-semibold text-amber-300" data-testid="director-paused">
          PAUSED: story clock stopped
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">Night</span>
        {stepper && (
          <ol className="flex flex-wrap items-center gap-1" data-testid="director-stepper">
            {steps.map((a, k) => (
              <li key={a.key}>
                <button
                  onClick={() => d.showAct(a.key)}
                  title={`${a.code ?? ''} ${a.title ?? ''} — ${a.firedSpine}/${a.spine.length}${a.starting ? ' · starting' : ''}`}
                  className={clsx(
                    'flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]',
                    a.state === 'focus' ? 'border-indigo-500/70 bg-indigo-500/10 text-zinc-100' : 'border-zinc-800 hover:border-zinc-600',
                    (a.state === 'past' || a.state === 'skipped') && 'text-zinc-500',
                    a.state === 'future' && 'text-zinc-400',
                  )}
                  data-testid={`director-step-${a.code ?? k}`}
                  data-state={a.state}
                >
                  {glyph(a) !== '' && <span className={clsx(a.state === 'past' && 'text-emerald-500', a.state === 'focus' && 'text-indigo-300')}>{glyph(a)}</span>}
                  <span className="font-mono font-semibold">{a.code ?? k + 1}</span>
                  {a.title !== null && <span className="hidden max-w-[10rem] truncate @6xl:inline">{a.title}</span>}
                  <span className="tabular-nums text-zinc-500">
                    {a.firedSpine}/{a.spine.length}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300" title="Night.phase — the story's own idea of where the night is" data-testid="cue-phase">
          phase: {phase ?? '—'}
        </span>
        {countdowns.slice(0, 2).map((c) => (
          <span
            key={c.path}
            className={clsx('rounded px-1.5 py-0.5 text-[11px] tabular-nums', c.left < 60 ? 'bg-red-500/10 text-red-400' : 'bg-zinc-800 text-zinc-200')}
            data-testid="director-countdown"
          >
            ⏱ {c.label} {formatLeft(c.left)}
          </span>
        ))}
      </div>
    </div>
  )
}
