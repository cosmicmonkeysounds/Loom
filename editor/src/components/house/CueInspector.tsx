//! Run → House: the inspector — the save bar (Save with `base`, Discard,
//! a stale warning, the server's refusal), then the selected cue: its
//! fields, its steps as rows, a timeline bar, and its problems inline.

import clsx from 'clsx'
import { DESK_STEP_KINDS, type DeskConfig, type DeskDurations, type DeskStepKind, type DeskValidation, type DeskView } from '@loom/core/house-desk'
import { useHouseDesk } from '@/store/house-desk'
import {
  addStep,
  deleteCue,
  deleteStep,
  duplicateCue,
  duplicateStep,
  idFromName,
  moveCue,
  moveStep,
  newStep,
  setCue,
  setStep,
  setStepKind,
  setStepStart,
} from '@/lib/house-desk-edit'
import { cueIssues, deskWideIssues, runOf, timelineBars } from '@/lib/house-desk-view'
import { Field, TextField } from './fields'
import { StepRow } from './StepRow'
import { KIND_LABEL, btn, btnPrimary, heading, input } from './ui'

export function SaveBar({ validation }: { validation: DeskValidation }) {
  const dirty = useHouseDesk((s) => s.draft !== null)
  const stale = useHouseDesk((s) => s.stale)
  const busy = useHouseDesk((s) => s.busy)
  const saveProblems = useHouseDesk((s) => s.saveProblems)
  const saveWarnings = useHouseDesk((s) => s.saveWarnings)
  const save = useHouseDesk((s) => s.save)
  const discard = useHouseDesk((s) => s.discard)
  const wide = [...deskWideIssues(validation.problems), ...deskWideIssues(saveProblems)]
  return (
    <div className="border-b border-zinc-800 p-2" data-testid="house-savebar">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void save()} disabled={!dirty || busy !== null} className={btnPrimary} data-testid="house-save">
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button onClick={discard} disabled={!dirty || busy !== null} className={btn} data-testid="house-discard">
          Discard
        </button>
        <span className="text-[11px] text-zinc-500">
          {dirty ? 'Unsaved edits' : 'Saved'}
          {validation.problems.length > 0 && <span className="text-red-300"> · {validation.problems.length} problem{validation.problems.length === 1 ? '' : 's'}</span>}
          {validation.warnings.length > 0 && <span className="text-amber-300"> · {validation.warnings.length} warning{validation.warnings.length === 1 ? '' : 's'}</span>}
        </span>
      </div>
      {stale && <p className="mt-1 text-[11px] text-amber-300">Someone saved the desk since you started editing: Save asks what to keep.</p>}
      {wide.map((m) => (
        <p key={m} className="mt-1 text-[11px] text-red-300">
          ✗ {m}
        </p>
      ))}
      {saveProblems.length > 0 && <p className="mt-1 text-[11px] text-red-300">The server refused the save: {saveProblems.length} problem{saveProblems.length === 1 ? '' : 's'} (shown on their cues).</p>}
      {saveWarnings.length > 0 && !dirty && <p className="mt-1 text-[11px] text-amber-300">Saved with warnings: {saveWarnings.join(' · ')}</p>}
    </div>
  )
}

export function CueInspector({ desk, view, durations, validation }: { desk: DeskConfig; view: DeskView; durations: DeskDurations; validation: DeskValidation }) {
  const sel = useHouseDesk((s) => s.sel)
  const stepSel = useHouseDesk((s) => s.step)
  const saveProblems = useHouseDesk((s) => s.saveProblems)
  const edit = useHouseDesk((s) => s.edit)
  const selectStep = useHouseDesk((s) => s.selectStep)
  const cue = sel !== null ? desk.cues[sel] : undefined
  if (sel === null || cue === undefined) {
    return <p className="p-4 text-center text-sm text-zinc-500">Select a cue to edit it.</p>
  }
  const house = view.house
  const looks = house.looks.map((l) => l.name)
  const problems = cueIssues([...validation.problems, ...saveProblems], cue, sel)
  const warnings = cueIssues(validation.warnings, cue, sel)
  const run = runOf(view.runs, cue.id)
  const { bars, span } = timelineBars(cue, durations)

  return (
    <div className="space-y-3 p-3" data-testid="house-inspector">
      <div className="flex flex-wrap items-center gap-1">
        <span className={heading}>Cue</span>
        <span className="ml-auto flex gap-1">
          <button onClick={() => edit(moveCue(desk, sel, -1).desk, Math.max(0, sel - 1))} disabled={sel === 0} className={btn} title="Move the cue up">
            ↑
          </button>
          <button onClick={() => edit(moveCue(desk, sel, 1).desk, Math.min(desk.cues.length - 1, sel + 1))} disabled={sel === desk.cues.length - 1} className={btn} title="Move the cue down">
            ↓
          </button>
          <button
            onClick={() => {
              const r = duplicateCue(desk, sel, looks)
              edit(r.desk, r.index, null)
            }}
            className={btn}
            data-testid="house-duplicate-cue"
          >
            Duplicate
          </button>
          <button
            onClick={() => {
              const r = deleteCue(desk, sel)
              edit(r.desk, r.index, null)
            }}
            className={btn}
            data-testid="house-delete-cue"
          >
            Delete
          </button>
        </span>
      </div>

      <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
        <Field label="number">
          <TextField value={cue.number ?? ''} onChange={(number) => edit(setCue(desk, sel, { number }))} testId="house-cue-number" />
        </Field>
        <Field label="name">
          <TextField value={cue.name} onChange={(name) => edit(setCue(desk, sel, { name }))} testId="house-cue-name" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="id (the story’s cue <id>)">
          <span className="flex gap-1">
            <TextField value={cue.id} onChange={(id) => edit(setCue(desk, sel, { id }))} mono testId="house-cue-id" />
            <button
              onClick={() => edit(setCue(desk, sel, { id: idFromName(cue.name, desk.cues.filter((_, k) => k !== sel).map((c) => c.id), looks) }))}
              className={btn}
              title="Make the id from the name"
            >
              ↻
            </button>
          </span>
        </Field>
        <Field label="section heading">
          <TextField value={cue.section ?? ''} onChange={(section) => edit(setCue(desk, sel, { section }))} placeholder="(joins the one above)" />
        </Field>
        <Field label="when it ends, fire (done)">
          <TextField value={cue.done ?? ''} onChange={(done) => edit(setCue(desk, sel, { done }))} options={house.events} mono placeholder="a story event" testId="house-cue-done" />
        </Field>
        <Field label="notes for the operator">
          <TextField value={cue.notes ?? ''} onChange={(notes) => edit(setCue(desk, sel, { notes }))} />
        </Field>
      </div>
      {[...problems.cue.map((m) => ['bad', m] as const), ...warnings.cue.map((m) => ['warn', m] as const)].map(([tone, m]) => (
        <p key={`${tone}${m}`} className={clsx('text-[11px]', tone === 'bad' ? 'text-red-300' : 'text-amber-300')}>
          {tone === 'bad' ? '✗' : '⚠'} {m}
        </p>
      ))}

      {cue.steps.length > 0 && (
        <div title="The cue as planned: open bars wait on the router or a terminal">
          <div className="mb-0.5 flex justify-between text-[10px] text-zinc-500">
            <span>0</span>
            <span>{(span / 1000).toFixed(1)} s</span>
          </div>
          <div className="relative rounded bg-zinc-900" style={{ height: `${Math.max(1, cue.steps.length) * 6 + 4}px` }} data-testid="house-timeline">
            {bars.map((b) => (
              <span
                key={b.i}
                onClick={() => selectStep(b.i)}
                className={clsx('absolute h-1 cursor-pointer rounded', b.open ? 'bg-zinc-500/60' : 'bg-sky-500', stepSel === b.i && 'ring-1 ring-indigo-300')}
                style={{ left: `${b.left}%`, width: `${Math.min(100 - b.left, b.width)}%`, top: `${2 + b.i * 6}px` }}
                title={`step ${b.i + 1}`}
              />
            ))}
          </div>
        </div>
      )}

      <ol className="space-y-1.5">
        {cue.steps.map((step, i) => (
          <StepRow
            key={i}
            step={step}
            i={i}
            count={cue.steps.length}
            house={house}
            selected={stepSel === i}
            problems={problems.steps.get(i) ?? []}
            warnings={warnings.steps.get(i) ?? []}
            run={run?.state === 'running' ? (run.steps.find((s) => s.i === i) ?? null) : null}
            onSelect={() => selectStep(i)}
            onPatch={(patch) => edit(setStep(desk, sel, i, patch))}
            onKind={(kind) => edit(setStepKind(desk, sel, i, kind, house))}
            onWith={(w) => edit(setStepStart(desk, sel, i, w))}
            onMove={(delta) => {
              const r = moveStep(desk, sel, i, delta)
              edit(r.desk, undefined, r.index)
            }}
            onDuplicate={() => {
              const r = duplicateStep(desk, sel, i)
              edit(r.desk, undefined, r.index)
            }}
            onDelete={() => {
              const r = deleteStep(desk, sel, i)
              edit(r.desk, undefined, r.index)
            }}
          />
        ))}
      </ol>
      <AddStep
        onAdd={(kind) => {
          const at = stepSel !== null ? stepSel + 1 : cue.steps.length
          const r = addStep(desk, sel, newStep(kind, house), at)
          edit(r.desk, undefined, r.index)
        }}
      />
    </div>
  )
}

function AddStep({ onAdd }: { onAdd: (kind: DeskStepKind) => void }) {
  return (
    <select
      value=""
      onChange={(e) => {
        if (e.target.value !== '') onAdd(e.target.value as DeskStepKind)
      }}
      className={input}
      data-testid="house-add-step"
    >
      <option value="">+ Step…</option>
      {DESK_STEP_KINDS.map((k) => (
        <option key={k} value={k}>
          {KIND_LABEL[k]}
        </option>
      ))}
    </select>
  )
}
