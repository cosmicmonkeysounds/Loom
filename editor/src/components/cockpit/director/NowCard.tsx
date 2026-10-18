//! The NOW card — the one large accent on the Director page (spec §1.2,
//! §2.4, §4.4, §4.5). NEXT with its full description and the arm / fire
//! button, then "then:" (the cue after it); a repeat cue reads "Again? …
//! or move on: …"; with no NEXT, "nothing to press" and the countdowns
//! that explain why. Under a rule: LAST, who moved it, and what it did.
//! The result banner says whether this console's last press was taken.
//! In Watching mode it shrinks to one line.

import { useMemo } from 'react'
import clsx from 'clsx'
import { CockpitTab, useCockpit, storyNow, CockpitPhase } from '@/store/cockpit'
import { cueTitleTags, onDeck, type CueRow } from '@loom/core/cue-sheet'
import { ArmBar, SubjectPicker, TagChips } from './CueButton'
import { outOfTurn, useDirector, useNameOf } from './context'
import { DirectorMode } from './director-keys'
import { pressEffects } from './press-effects'
import { formatLeft, useCountdowns, useNow, type LiveCountdown } from './clock'
import { PressKind } from './useArmed'
import { refusalReason, secretHeads, staffReason } from './glance'

/** The taken banner's life, the refusal's. */
const TAKEN_MS = 5000
const REFUSED_MS = 15_000

function rowName(r: CueRow): string {
  return `${r.code ?? r.n} ${cueTitleTags(r.title).title}`
}

function Countdowns({ items }: { items: LiveCountdown[] }) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-0.5 pt-1">
      {items.map((c) => (
        <li key={c.path} className="flex items-center gap-2 text-sm">
          <span className={clsx('tabular-nums', c.left < 60 ? 'text-red-400' : 'text-zinc-100')}>⏱ {c.label} in {formatLeft(c.left)}</span>
        </li>
      ))}
    </ul>
  )
}

/** "22 min ago" in story time. */
function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`
}

function ResultBanner() {
  const { arm } = useDirector()
  const messages = useCockpit((s) => s.messages)
  const channels = useCockpit((s) => s.channels)
  const r = arm.result
  const wall = useNow(r !== null)
  if (r === null) return null
  const age = wall - r.at
  if (r.kind === PressKind.Taken && age > TAKEN_MS) return null
  if (r.kind !== PressKind.Taken && age > REFUSED_MS) return null
  if (r.kind === PressKind.Taken) {
    return (
      <div className="rounded border border-emerald-600/60 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300" data-testid="director-result">
        ✓ Taken · {r.cue}
      </div>
    )
  }
  if (r.kind === PressKind.Failed) {
    return (
      <div className="rounded border border-red-600/60 bg-red-500/10 px-2 py-1 text-xs text-red-400" data-testid="director-result">
        ✕ Failed: {r.message}
      </div>
    )
  }
  const why = staffReason(messages, channels, r.seq)
  return (
    <div className="rounded border border-red-600/60 bg-red-500/10 px-2 py-1 text-xs text-red-400" data-testid="director-result">
      ✕ Not taken · {r.cue}
      <div className="text-zinc-300">
        {why !== null ? `${why.title ?? 'staff room'}: “${why.text}”` : refusalReason(null, channels, age)}
      </div>
    </div>
  )
}

function LastLine() {
  const d = useDirector()
  const cues = useCockpit((s) => s.cues)
  const log = useCockpit((s) => s.log)
  const roster = useCockpit((s) => s.roster)
  const watch = useCockpit((s) => s.watch)
  const cast = useCockpit((s) => s.cast)
  const channels = useCockpit((s) => s.channels)
  const clock = useCockpit((s) => s.storyClock)
  const running = useCockpit((s) => s.phase === CockpitPhase.Open)
  const setTab = useCockpit((s) => s.setTab)
  const wall = useNow(true, 30_000)
  const last = d.rows.find((r) => r.last) ?? null
  const fx = useMemo(() => {
    if (last === null) return null
    return pressEffects(log, last.id, {
      persons: new Set(roster.map((r) => r.id)),
      secretHeads: secretHeads(cast, watch),
      staffRooms: channels.filter((c) => c.staff === true).map((c) => c.id),
    })
  }, [last, log, roster, cast, watch, channels])
  if (last === null) {
    return (
      <div className="text-xs text-zinc-500" data-testid="cue-last">
        LAST — nothing fired yet
      </div>
    )
  }
  const now = storyNow(clock, running, wall)
  const by = cues.lastBy === 'story' ? ' (auto)' : ''
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <div className={clsx('flex flex-wrap items-baseline gap-x-2', d.arm.moved !== null && 'rounded bg-amber-500/10 px-1')} data-testid="cue-last">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">Last</span>
        <span className="font-mono text-zinc-500">{last.n}</span>
        <span className="text-zinc-100">{rowName(last)}{by}</span>
        {fx !== null && fx.ts !== undefined && now !== null && <span className="text-zinc-500">· {ago(now - fx.ts)}</span>}
        {d.arm.moved !== null && (
          <span className="text-amber-300" data-testid="director-moved">
            {d.arm.moved.by === 'story' ? '(auto)' : 'moved by another director'}
          </span>
        )}
      </div>
      <div className="pl-1 text-zinc-400" data-testid="director-did">
        {fx === null ? (
          <span className="text-zinc-600">did: (before this console connected)</span>
        ) : fx.items.length === 0 ? (
          <span className="text-zinc-600">did: nothing visible</span>
        ) : (
          <span>
            did: {fx.items.join(' · ')}
            {fx.more > 0 && (
              <button onClick={() => setTab(CockpitTab.Log)} className="ml-1 text-indigo-300 hover:underline">
                +{fx.more} more ↗ Log
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

/** What NEXT reads like, and its arm / fire button. */
function NextBlock({ flash }: { flash: boolean }) {
  const d = useDirector()
  const { arm } = d
  const countdowns = useCountdowns()
  const next = d.rows.find((r) => r.next) ?? null
  const last = d.rows.find((r) => r.last) ?? null
  const deck = onDeck(d.rows)
  const nameOf = useNameOf()
  if (next === null) {
    // What the running order holds after LAST, even off tonight's branch.
    const lastIdx = last === null ? -1 : d.rows.indexOf(last)
    const after = d.rows.find((r, i) => i > lastIdx && r.sequence && !r.fired) ?? null
    return (
      <div className={clsx('flex flex-col gap-0.5', flash && 'animate-pulse')}>
        <div className="text-base font-semibold text-zinc-100" data-testid="director-next">
          NEXT — nothing to press. The story runs.
        </div>
        <Countdowns items={countdowns} />
        {after !== null && (
          <div className="text-xs text-zinc-500">
            on the running order after it: {after.n} {rowName(after)}
            {!after.live && <span title="Its `while:` is false right now"> ·not on offer·</span>}
          </div>
        )}
      </div>
    )
  }
  const { title, tags } = cueTitleTags(next.title)
  const armed = arm.armed !== null && arm.armed.id === next.id
  const again = next.last
  const warn = armed ? outOfTurn(next, d) : null
  // An armed subject cue names who it goes to on the button itself.
  const pick = armed ? (arm.armed?.subject ?? null) : null
  const fireLabel =
    pick !== null
      ? `Fire ${next.code !== null ? `${next.code} ` : ''}${title} → ${nameOf(pick)}${arm.armed?.value ? ` (${arm.armed.value})` : ''}`
      : 'Fire ▶ again'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-indigo-500 px-1 text-[10px] font-bold text-white">NEXT</span>
        <span className="font-mono text-xs text-zinc-500">{next.n}</span>
        <span className="text-base font-semibold text-zinc-100" data-testid="director-next">
          {again ? 'Again? ' : ''}
          {next.code !== null && <span className="font-mono">{next.code} · </span>}
          {title}
        </span>
        <TagChips tags={tags} />
      </div>
      {next.description !== null && <p className="whitespace-pre-wrap text-sm text-zinc-300">{next.description}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={() => arm.tap(next)}
          disabled={arm.pending !== null || arm.cooling}
          className={clsx(
            'rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50',
            armed ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-indigo-600 text-white hover:bg-indigo-500',
            arm.pending === next.id && 'animate-pulse',
          )}
          title={armed ? 'press again to fire · Esc disarms' : 'press to arm, press again to fire (Space, Space)'}
          data-testid="director-next-fire"
          data-cue-press={next.id}
        >
          {armed ? fireLabel : next.subject ? 'Pick who…' : 'Arm ▶'}
        </button>
        <span className="text-[11px] text-zinc-500">{armed ? 'Esc to disarm' : 'Space · Space'}</span>
      </div>
      {armed && <ArmBar at={arm.armed!.at} />}
      {warn !== null && <div className="text-xs text-amber-300">{warn}</div>}
      {next.subject && (arm.picking === next.id || armed) && <SubjectPicker row={next} />}
      {deck !== null && (
        <div className={clsx('text-xs', deck.live ? 'text-zinc-400' : 'text-zinc-600')}>
          {again ? 'or move on: ' : 'then: '}
          {deck.n} {rowName(deck)}
          {!deck.live && <span title="Its `while:` is false right now"> ·not on offer·</span>}
        </div>
      )}
    </div>
  )
}

/** Watching mode: one line. */
function NowLine() {
  const d = useDirector()
  const countdowns = useCountdowns()
  const next = d.rows.find((r) => r.next) ?? null
  const last = d.rows.find((r) => r.last) ?? null
  return (
    <section className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-indigo-500/70 bg-indigo-500/10 px-3 py-2 text-sm" data-testid="director-now">
      <span data-testid="cue-last" className="text-zinc-300">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">Last </span>
        {last === null ? '—' : rowName(last)}
      </span>
      <span className="text-zinc-100" data-testid="director-next">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">Next </span>
        {next === null ? '—' : rowName(next)}
      </span>
      {countdowns[0] !== undefined && (
        <span className={clsx('tabular-nums', countdowns[0].left < 60 ? 'text-red-400' : 'text-zinc-200')}>
          ⏱ {countdowns[0].label} {formatLeft(countdowns[0].left)}
        </span>
      )}
      <ResultBanner />
    </section>
  )
}

export function NowCard({ flash }: { flash: boolean }) {
  const d = useDirector()
  if (d.mode === DirectorMode.Watching) return <NowLine />
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-indigo-500/70 bg-indigo-500/10 p-3" data-testid="director-now">
      <ResultBanner />
      {d.arm.stale !== null && (
        <div className="rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-xs text-amber-300" data-testid="director-stale">
          {d.arm.stale}
        </div>
      )}
      <NextBlock flash={flash} />
      <div className="border-t border-indigo-500/30" />
      <LastLine />
    </section>
  )
}

