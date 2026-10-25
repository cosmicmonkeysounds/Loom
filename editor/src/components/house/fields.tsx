//! Run → House: the inspector's small field controls (text, ms as seconds,
//! a name list with a picker over the house).

import clsx from 'clsx'
import { useId, type ReactNode } from 'react'
import { input, label as labelCls } from './ui'

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('flex min-w-0 flex-col gap-0.5', className)}>
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  )
}

/** A text input with suggestions (a datalist): free text allowed. */
export function TextField({
  value,
  onChange,
  options,
  placeholder,
  testId,
  mono,
}: {
  value: string
  onChange: (v: string) => void
  options?: readonly string[]
  placeholder?: string
  testId?: string
  mono?: boolean
}) {
  const id = useId()
  return (
    <>
      <input value={value} onChange={(e) => onChange(e.target.value)} list={options !== undefined ? id : undefined} placeholder={placeholder} className={clsx(input, mono && 'font-mono')} data-testid={testId} />
      {options !== undefined && (
        <datalist id={id}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  )
}

/** A select over `options`; a value not in them stays selectable (marked ?). */
export function SelectField({ value, onChange, options, testId }: { value: string; onChange: (v: string) => void; options: ReadonlyArray<{ value: string; label: string }>; testId?: string }) {
  const known = options.some((o) => o.value === value)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={input} data-testid={testId}>
      {!known && <option value={value}>{value === '' ? '—' : `${value} (?)`}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** Whole ms, typed as seconds ("1.5"). Blank clears it (undefined) when `optional`. */
export function SecondsField({ ms, onChange, optional, max, testId }: { ms: number | undefined; onChange: (ms: number | undefined) => void; optional?: boolean; max?: number; testId?: string }) {
  return (
    <input
      type="number"
      min={0}
      step={0.1}
      max={max !== undefined ? max / 1000 : undefined}
      value={ms === undefined ? '' : ms / 1000}
      placeholder={optional === true ? '—' : '0'}
      onChange={(e) => {
        const t = e.target.value.trim()
        if (t === '') return onChange(optional === true ? undefined : 0)
        const n = Number(t)
        if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * 1000))
      }}
      className={clsx(input, 'w-20')}
      data-testid={testId}
    />
  )
}

/** A list of names (a step's `to`) as chips, with a picker to add one. */
export function NamesField({ names, onChange, options, empty, testId }: { names: readonly string[]; onChange: (names: string[]) => void; options: readonly string[]; empty: string; testId?: string }) {
  const left = options.filter((o) => !names.includes(o))
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid={testId}>
      {names.length === 0 && <span className="text-[11px] text-zinc-500">{empty}</span>}
      {names.map((n) => (
        <span key={n} className="flex items-center gap-0.5 rounded bg-zinc-800 px-1 text-[11px] text-zinc-200">
          {n}
          <button onClick={() => onChange(names.filter((x) => x !== n))} className="text-zinc-500 hover:text-zinc-200" title={`Remove ${n}`}>
            ×
          </button>
        </span>
      ))}
      {left.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value !== '') onChange([...names, e.target.value])
          }}
          className={clsx(input, 'w-24')}
          title="Add a target"
        >
          <option value="">+ add</option>
          {left.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
    </span>
  )
}
