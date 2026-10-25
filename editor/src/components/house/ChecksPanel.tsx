//! Run → House: the checks — walk every speaker, output, story sound, light
//! and look (`deskChecks`): Test (and a bulb's colours), ✓ / ✗ marks, the
//! progress, *Test next*. Keys while this side is open: T tests the cursor
//! row, Y marks ✓, N marks ✗ (each then moves on to the next open check),
//! ↓ the next open check, ↑ the row above. Once the show is live a test asks
//! first (`testNeedsConfirm`). Zigbee pairing and Reset marks are the
//! director's (every editor session is an author's, so always here).

import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import { checkProgress, nextOpenCheck, type DeskCheckRow, type DeskCheckSection, type DeskView } from '@loom/core/house-desk'
import { useHouseDesk } from '@/store/house-desk'
import { btn, btnDanger, heading } from './ui'

export function ChecksPanel({ view, sections, cursor, now }: { view: DeskView; sections: DeskCheckSection[]; cursor: DeskCheckRow | null; now: number }) {
  const busy = useHouseDesk((s) => s.busy)
  const test = useHouseDesk((s) => s.test)
  const setCheck = useHouseDesk((s) => s.setCheck)
  const resetMarks = useHouseDesk((s) => s.resetMarks)
  const pair = useHouseDesk((s) => s.pair)
  const p = checkProgress(sections)
  const pairing = view.house.pairUntil !== null && view.house.pairUntil > now
  const hasLights = view.house.fixtures.length > 0 || view.house.lightsModule !== null
  const testNext = () => {
    const next = cursor !== null && cursor.mark === null ? cursor : nextOpenCheck(sections, cursor?.key ?? null)
    if (next !== null) {
      setCheck(next.key)
      void test(next, next.test)
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="house-checks">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 p-2">
        <span className="text-xs text-zinc-300" data-testid="house-checks-progress">
          <span className="text-emerald-300">{p.ok} ✓</span> · <span className="text-red-300">{p.bad} ✗</span> · {p.open} open of {p.total}
        </span>
        <span className="h-1.5 w-24 overflow-hidden rounded bg-zinc-800">
          <span className="block h-full bg-emerald-500" style={{ width: `${p.total === 0 ? 0 : Math.round(((p.ok + p.bad) / p.total) * 100)}%` }} />
        </span>
        <button onClick={testNext} disabled={p.open === 0} className={btn} title="Test the next unmarked check" data-testid="house-test-next">
          ▶ Test next
        </button>
        <span className="ml-auto flex gap-1">
          {hasLights && (
            <button onClick={() => void pair(!pairing)} disabled={busy !== null} className={btn} title="Let a new Zigbee bulb join (2 min)" data-testid="house-pair">
              {pairing ? `Close pairing (${Math.max(0, Math.round(((view.house.pairUntil ?? now) - now) / 1000))} s)` : '🔗 Pair a bulb'}
            </button>
          )}
          <button onClick={() => void resetMarks()} disabled={busy !== null || p.ok + p.bad === 0} className={btnDanger} data-testid="house-reset-marks">
            Reset marks
          </button>
        </span>
      </div>
      <p className="px-2 pt-1 text-[10px] text-zinc-500">Keys: T test · Y ✓ heard / seen · N ✗ nothing · ↓ next open · ↑ back</p>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {sections.length === 0 && <p className="p-4 text-center text-sm text-zinc-500">Nothing to check: place speakers and lights on the house map first.</p>}
        {sections.map((s) => (
          <div key={s.id} className="mb-3">
            <div className={clsx(heading, 'pb-1')}>{s.title}</div>
            <ul className="space-y-0.5">
              {s.rows.map((r) => (
                <CheckRow key={r.key} row={r} on={cursor?.key === r.key} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function CheckRow({ row, on }: { row: DeskCheckRow; on: boolean }) {
  const testing = useHouseDesk((s) => s.testing === row.key)
  const test = useHouseDesk((s) => s.test)
  const mark = useHouseDesk((s) => s.mark)
  const setCheck = useHouseDesk((s) => s.setCheck)
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (on) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [on])
  return (
    <li
      ref={ref}
      onClick={() => setCheck(row.key)}
      className={clsx('flex flex-wrap items-center gap-2 rounded px-1.5 py-1 text-xs', on ? 'bg-indigo-950/60 ring-1 ring-indigo-700' : 'hover:bg-zinc-900')}
      data-testid={`house-check-${row.key}`}
    >
      <span className={clsx('w-4 text-center', row.mark?.mark === 'ok' ? 'text-emerald-400' : row.mark?.mark === 'bad' ? 'text-red-400' : 'text-zinc-600')}>
        {row.mark?.mark === 'ok' ? '✓' : row.mark?.mark === 'bad' ? '✗' : '○'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-zinc-100">{row.label}</span>
        <span className="block truncate text-[11px] text-zinc-500">{row.detail}</span>
        {row.hints.map((h) => (
          <span key={h} className="block text-[10px] text-amber-300">
            ⚠ {h}
          </span>
        ))}
        {row.mark !== null && <span className="block text-[10px] text-zinc-600">marked by {row.mark.by}</span>}
      </span>
      <span className="flex flex-wrap gap-1">
        <button onClick={() => void test(row, row.test)} disabled={testing} className={btn} data-testid={`house-check-${row.key}-test`}>
          {testing ? '…' : 'Test'}
        </button>
        {row.extra.map((x) => (
          <button key={x.label} onClick={() => void test(row, x.test)} className={btn}>
            {x.label}
          </button>
        ))}
        <button onClick={() => void mark(row.key, row.mark?.mark === 'ok' ? null : 'ok')} className={clsx(btn, row.mark?.mark === 'ok' && 'border-emerald-700 text-emerald-200')} title="Heard / seen it (Y)">
          ✓
        </button>
        <button onClick={() => void mark(row.key, row.mark?.mark === 'bad' ? null : 'bad')} className={clsx(btn, row.mark?.mark === 'bad' && 'border-red-700 text-red-200')} title="Nothing (N)">
          ✗
        </button>
      </span>
    </li>
  )
}
