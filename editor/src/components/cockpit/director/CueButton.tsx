//! One cue, as a running-order row or an On hand chip: its number / code /
//! title, the label's parentheticals lifted into muted tags, NEXT / LAST /
//! ✓, `·not on offer·` when its `while:` is false, an ⓘ for its
//! description, and the arm state — "Fire ▶ again · Esc", a 4 s bar, the
//! out-of-turn warning and the full description. A subject cue (👤) opens
//! its who? picker instead of arming; the picker arms it for the person.

import { useState, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import { useCockpit } from '@/store/cockpit'
import { ARM_MS, cueTitleTags, takesValue, type CueRow } from '@loom/core/cue-sheet'
import { suggestionHint } from '../award-suggest'
import { outOfTurn, useDirector } from './context'
import { DirectorMode } from './director-keys'

const NOT_ON_OFFER = 'Its `while:` is false right now — not suggested, still pressable'

/** The parenthetical tags as muted chips. */
export function TagChips({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null
  return (
    <>
      {tags.map((t) => (
        <span key={t} className={clsx('max-w-[12rem] shrink-0 truncate rounded bg-zinc-800 px-1 text-[10px] text-zinc-400', className)} title={t}>
          {t}
        </span>
      ))}
    </>
  )
}

/** The 4 s bar under an armed cue (restarts with each new arm). */
export function ArmBar({ at }: { at: number }) {
  return (
    <div className="h-0.5 w-full overflow-hidden rounded bg-amber-500/20">
      <div key={at} className="h-0.5 bg-amber-500" style={{ animation: `director-arm ${ARM_MS}ms linear forwards` }} />
    </div>
  )
}

/** Who a subject cue is armed for, by name. */
export function useNameOf() {
  const roster = useCockpit((s) => s.roster)
  return (id: string | null) => (id === null ? '' : (roster.find((r) => r.id === id)?.name ?? id))
}

/** The armed detail: what a second press does, the warning, the full description. */
export function ArmedDetail({ row }: { row: CueRow }) {
  const d = useDirector()
  const nameOf = useNameOf()
  const a = d.arm.armed
  if (a === null || a.id !== row.id) return null
  const warn = outOfTurn(row, d)
  return (
    <div className="mt-1 flex flex-col gap-1 rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-xs" data-testid={`cue-armed-${row.id}`}>
      {a.subject !== null && (
        <div className="text-amber-300">
          Fire {row.code ?? ''} {row.title} → {nameOf(a.subject)}
          {a.value ? ` (${a.value})` : ''} · Esc
        </div>
      )}
      <ArmBar at={a.at} />
      {warn !== null && <div className="text-amber-300">{warn}</div>}
      {row.description !== null && <div className="whitespace-pre-wrap text-zinc-300">{row.description}</div>}
    </div>
  )
}

/** The who? picker for a subject cue: the roster (people in the cue's room
 *  first), the value box for an award, the recap's suggestion; Enter (or
 *  Arm) arms it for the pick, Enter again fires. */
export function SubjectPicker({ row }: { row: CueRow }) {
  const d = useDirector()
  const roster = useCockpit((s) => s.roster)
  const { awards, arm } = d
  const who = awards.winners[row.id] ?? ''
  const value = awards.values[row.id] ?? ''
  const suggestion = awards.suggestions[row.id] ?? null
  const armedHere = arm.armed !== null && arm.armed.id === row.id
  // By name (a cue names no room the view carries, so there is no
  // "people in the cue's room first" to sort by).
  const sorted = [...roster].sort((a, b) => a.name.localeCompare(b.name))
  const onKey = (e: KeyboardEvent) => {
    // Enter on the picker's own buttons (Arm, ✕) is that button's click:
    // ✕ closes, it never arms the pick.
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault()
      e.stopPropagation()
      if (armedHere) arm.tap(row)
      else arm.armFor(row, who, takesValue(row.id) ? value : undefined)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (armedHere) arm.disarm()
      else arm.setPicking(null)
    }
  }
  return (
    <div className="mt-1 flex flex-col gap-1 pl-8" onKeyDown={onKey}>
      <div className="flex flex-wrap gap-1">
        <select
          value={who}
          onChange={(e) => {
            awards.pick(row.id, e.target.value)
            if (armedHere) arm.disarm()
          }}
          autoFocus
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
          data-testid={`cue-who-${row.id}`}
        >
          <option value="">— who? —</option>
          {sorted.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {takesValue(row.id) && (
          <input
            value={value}
            onChange={(e) => {
              awards.setValue(row.id, e.target.value)
              if (armedHere) arm.disarm()
            }}
            placeholder="value (optional)"
            className="w-32 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs outline-none focus:border-indigo-500"
            data-testid={`cue-value-${row.id}`}
          />
        )}
        {!armedHere && (
          <button
            onClick={() => arm.armFor(row, who, takesValue(row.id) ? value : undefined)}
            disabled={who === ''}
            className="rounded border border-amber-500/70 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
            data-testid={`cue-arm-${row.id}`}
          >
            Arm
          </button>
        )}
        <button onClick={() => arm.setPicking(null)} className="rounded px-1.5 text-xs text-zinc-500 hover:text-zinc-200" title="close the picker">
          ✕
        </button>
      </div>
      {suggestion !== null && (
        <div className="truncate text-[11px] text-zinc-500" data-testid={`cue-suggest-${row.id}`}>
          {suggestionHint(suggestion)}
        </div>
      )}
    </div>
  )
}

export function CueButton({
  row,
  variant,
  brief,
  actCode,
}: {
  row: CueRow
  variant: 'row' | 'chip'
  /** One truncated description line under the row (the focus act). */
  brief?: boolean
  /** Show the act's code (a filtered list). */
  actCode?: string | null
}) {
  const d = useDirector()
  const { arm } = d
  const [info, setInfo] = useState(false)
  const { title, tags } = cueTitleTags(row.title)
  const armed = arm.armed !== null && arm.armed.id === row.id
  const picking = arm.picking === row.id
  const cursor = d.cursor === row.id
  const busy = arm.pending !== null
  const nameOf = useNameOf()
  const suggestion = row.subject ? (d.awards.suggestions[row.id] ?? null) : null
  // NEXT's picker lives on the NOW card (Calling mode): one picker, one
  // autofocus, one set of testids.
  const nowHolds = row.next && d.mode === DirectorMode.Calling
  const tone = armed
    ? 'border-amber-500 bg-amber-500/10 text-zinc-100'
    : row.last
      ? 'border-amber-500/60 bg-amber-500/5 text-zinc-100'
      : row.next
        ? 'border-indigo-500/70 bg-indigo-500/10 text-zinc-100'
        : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600'
  const tip = !row.live ? NOT_ON_OFFER : row.subject ? 'pick who, arm, then fire' : armed ? 'press again to fire · Esc disarms' : 'press to arm, press again to fire'

  if (variant === 'chip') {
    return (
      <span className="inline-flex min-w-0 max-w-full" data-cue-nav={row.id} data-next={row.next ? 'true' : undefined}>
        <button
          onClick={() => arm.tap(row)}
          disabled={busy}
          title={row.description !== null ? `${tip}\n\n${row.description}` : tip}
          className={clsx(
            'flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-left text-xs disabled:cursor-wait @md:max-w-[18rem]',
            tone,
            !row.live && !armed && 'opacity-50',
            cursor && 'ring-1 ring-indigo-400',
            arm.pending === row.id && 'animate-pulse',
          )}
          data-testid={`cue-${row.id}`}
          data-cue-press={row.id}
        >
          {row.code !== null && <span className="shrink-0 font-mono text-[10px] text-zinc-500">{row.code}</span>}
          <span className="min-w-0 truncate">{title}</span>
          {row.subject && <span className="shrink-0" title="names a person">👤</span>}
          <TagChips tags={tags} className="hidden @md:inline-block" />
          {row.fired && <span className="shrink-0 text-emerald-500">✓</span>}
          {armed && <span className="shrink-0 font-semibold text-amber-300">Fire ▶</span>}
        </button>
      </span>
    )
  }

  return (
    <li data-cue-nav={row.id} data-next={row.next ? 'true' : undefined} className="list-none">
      <div className="flex items-stretch gap-1">
        <button
          onClick={() => arm.tap(row)}
          disabled={busy}
          title={tip}
          className={clsx(
            'flex min-w-0 flex-1 items-center gap-2 rounded border px-2 py-1.5 text-left text-sm disabled:cursor-wait',
            tone,
            !row.live && !armed && 'opacity-50',
            cursor && 'ring-1 ring-indigo-400',
            arm.pending === row.id && 'animate-pulse',
          )}
          data-testid={`cue-${row.id}`}
          data-cue-press={row.id}
        >
          <span className="w-6 shrink-0 text-right font-mono text-[11px] text-zinc-600">{row.n}</span>
          {actCode !== undefined && actCode !== null && <span className="shrink-0 font-mono text-[10px] text-zinc-500">{actCode}</span>}
          <span className="w-12 shrink-0 truncate font-mono text-xs font-semibold text-zinc-200 @xl:w-20" title={row.code ?? undefined}>{row.code ?? ''}</span>
          <span className={clsx('min-w-0 flex-1 truncate', row.fired && !row.last && !row.next && 'text-zinc-500')}>{title}</span>
          {row.subject && <span className="shrink-0" title="names a person">👤</span>}
          <TagChips tags={tags} className="hidden @xl:inline-block" />
          {!row.live && <span className="hidden shrink-0 text-[10px] text-zinc-500 @xl:inline" title={NOT_ON_OFFER}>·not on offer·</span>}
          {armed && (
            <span className="shrink-0 text-[11px] font-semibold text-amber-300">
              {arm.armed?.subject ? `Fire → ${nameOf(arm.armed.subject)}` : 'Fire ▶ again · Esc'}
            </span>
          )}
          {row.last && <span className="shrink-0 rounded bg-amber-500 px-1 text-[10px] font-bold text-black">LAST</span>}
          {row.next && <span className="shrink-0 rounded bg-indigo-500 px-1 text-[10px] font-bold text-white">NEXT</span>}
          {row.fired && !row.last && <span className="shrink-0 text-xs text-emerald-500" title="fired tonight">✓</span>}
        </button>
        {row.description !== null && (
          <button
            onClick={() => setInfo((v) => !v)}
            className={clsx('shrink-0 rounded px-1.5 text-xs', info ? 'text-indigo-300' : 'text-zinc-600 hover:text-zinc-300')}
            title={info ? 'hide what this cue does' : 'what this cue does'}
            aria-expanded={info}
          >
            ⓘ
          </button>
        )}
      </div>
      {brief === true && !info && !armed && row.description !== null && (
        <div className="truncate pl-8 text-[11px] text-zinc-500">{row.description}</div>
      )}
      {info && !armed && row.description !== null && <div className="whitespace-pre-wrap pl-8 pt-0.5 text-xs text-zinc-400">{row.description}</div>}
      {armed && (
        <div className="pl-8">
          <ArmedDetail row={row} />
        </div>
      )}
      {row.subject && (picking || armed) && !nowHolds && <SubjectPicker row={row} />}
      {row.subject && !picking && !armed && suggestion !== null && (
        <div className="truncate pl-8 text-[11px] text-zinc-500" data-testid={`cue-suggest-${row.id}`}>
          {suggestionHint(suggestion)}
        </div>
      )}
    </li>
  )
}

/** Under a chip line: the picker / armed detail of the chip in it. */
export function ChipDetail({ rows }: { rows: CueRow[] }) {
  const { arm } = useDirector()
  const row = rows.find((r) => r.id === arm.picking || r.id === arm.armed?.id)
  if (row === undefined) return null
  return (
    <div className="w-full">
      <div className="pl-0 text-[11px] text-zinc-400">{row.code ?? ''} {cueTitleTags(row.title).title}</div>
      {arm.armed?.id === row.id && <ArmedDetail row={row} />}
      {row.subject && <SubjectPicker row={row} />}
    </div>
  )
}
