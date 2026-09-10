//! The identity control — "who am I right now" for the whole cockpit. Lives
//! in the Run header on every page: `👁 Operator` (the god view) or any
//! participant — your personas, a co-writer's personas, real guests, the
//! cast. A non-Operator choice recolours the strip and states the rule:
//! actions here happen *as* that identity (the composer speaks as them,
//! their choices dock in Chat, their interactions become buttons), and what
//! you see is the server's own projection of them (`CockpitState.lens`).
//! Esc (outside a text field) returns to the Operator.

import { useEffect } from 'react'
import clsx from 'clsx'
import { OPERATOR_LENS, useCockpit } from '@/store/cockpit'
import { useContextMenu } from '@/store/context-menu'
import { useDialog } from '@/store/dialog'
import { useGraph } from '@/store/graph'
import { useHelp } from '@/store/help'
import { groupByOwner, identityName } from './identity-groups'

/** Another Esc-driven surface is open — that Esc is theirs, not the lens's. */
function escapeClaimedElsewhere(): boolean {
  if (useContextMenu.getState().items !== null) return true
  if (useHelp.getState().open) return true
  if (useDialog.getState().queue.length > 0) return true
  const g = useGraph.getState()
  return g.view.kind === 'beat' || g.editingNode !== null
}

export function IdentityControl() {
  const roster = useCockpit((s) => s.roster)
  const cast = useCockpit((s) => s.cast)
  const me = useCockpit((s) => s.me)
  const perspective = useCockpit((s) => s.perspective)
  const run = useCockpit((s) => s.run)
  const setPerspective = useCockpit((s) => s.setPerspective)

  // Esc anywhere that isn't a text field → back to the Operator.
  useEffect(() => {
    if (perspective === OPERATOR_LENS) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable || t.closest('.cm-editor'))) return
      if (escapeClaimedElsewhere()) return
      setPerspective(OPERATOR_LENS)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [perspective, setPerspective])

  if (run === null) return null
  const active = perspective !== OPERATOR_LENS
  const row = roster.find((r) => r.id === perspective)
  const name = active ? identityName(perspective, roster) : 'Operator'
  const owner = row?.owner ?? null
  const groups = groupByOwner(roster, me)

  return (
    <div className="flex items-center gap-2" data-testid="cockpit-identity">
      <label className="flex items-center gap-1 text-xs text-zinc-500">
        <span className={clsx(active ? 'text-indigo-300' : 'text-zinc-400')}>👁</span>
        <select
          value={perspective}
          onChange={(e) => setPerspective(e.target.value)}
          className={clsx(
            'rounded border bg-zinc-950 px-2 py-0.5 text-xs outline-none focus:border-indigo-500',
            active ? 'border-indigo-500/70 text-indigo-200' : 'border-zinc-700 text-zinc-200',
          )}
          title="Who you are in this cockpit — view and act as the Operator, a persona, a guest, or a character"
          data-testid="cockpit-perspective"
        >
          <optgroup label="Story">
            <option value={OPERATOR_LENS}>Operator (everything)</option>
          </optgroup>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.id})
                </option>
              ))}
            </optgroup>
          ))}
          {cast.length > 0 && (
            <optgroup label="Cast">
              {cast.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {active && (
        <span
          className="hidden items-center gap-1 rounded-full border border-indigo-800/70 bg-indigo-950/40 px-2 py-0.5 text-[10px] text-indigo-200 lg:flex"
          data-testid="cockpit-identity-chip"
          title="Everything you see is what they see; everything you do here happens as them. Esc → Operator."
        >
          <span>
            Viewing as <span className="font-semibold">{name}</span>
            {owner !== null && owner !== me ? ` (${owner}'s persona)` : owner === me ? ' (your persona)' : ''}
          </span>
          <span className="text-indigo-400/70">· actions happen as {name} · Esc → Operator</span>
        </span>
      )}
    </div>
  )
}
