//! The editable variable table — the write half of the live state
//! browser. Renders `VarRow`s (name · value); double-clicking a value
//! opens an inline editor whose commit flows through the cockpit's
//! `setVar` (`Sim.setVar` locally, the journaled `/api/mod/var` on an
//! event — person-standard fields route through the real mutators, so
//! editing `<guest>.location` genuinely moves them and fires hooks).
//! Shared by the World tab's groups and the Inspector's Variables card.
//! Under a non-Operator lens the table is read-only — you are a
//! participant right now, not the director.

import { useState } from 'react'
import { useCockpit } from '@/store/cockpit'
import type { VarRow } from './world'

function ValueCell({ row }: { row: VarRow }) {
  const setVar = useCockpit((s) => s.setVar)
  const locked = useCockpit((s) => s.lens !== null)
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <td
        onDoubleClick={() => !locked && setDraft(row.value)}
        title={locked ? `${row.path} — switch to Operator to edit` : `${row.path} — double-click to edit`}
        className={locked ? 'px-2 py-1 text-right font-mono text-emerald-200/90' : 'cursor-text px-2 py-1 text-right font-mono text-emerald-200/90'}
        data-testid={`var-value-${row.path}`}
      >
        {row.value}
      </td>
    )
  }
  const commit = () => {
    if (draft.trim() !== row.value) void setVar(row.path, draft)
    setDraft(null)
  }
  return (
    <td className="px-1 py-0.5 text-right">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') setDraft(null)
        }}
        className="w-full rounded border border-indigo-500 bg-zinc-950 px-1 py-0.5 text-right font-mono text-xs text-zinc-100 outline-none"
        data-testid={`var-input-${row.path}`}
      />
    </td>
  )
}

/** Rows of name → editable value. `className` styles the outer table. */
export function VarTable({ rows, className }: { rows: VarRow[]; className?: string }) {
  return (
    <table className={className ?? 'w-full text-xs'}>
      <tbody>
        {rows.map((row) => (
          <tr key={row.path} className="border-b border-zinc-900 last:border-b-0">
            <td className="px-2 py-1 font-mono text-zinc-400">{row.name}</td>
            <ValueCell row={row} />
          </tr>
        ))}
      </tbody>
    </table>
  )
}
