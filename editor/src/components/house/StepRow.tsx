//! Run → House: one step in the inspector — its kind, how it starts (with ↑
//! the step before it, or then: after its group), its wait, the kind's own
//! fields as pickers over the house, a note, and its problems inline.

import clsx from 'clsx'
import {
  DESK_GAIN_MAX,
  DESK_GAIN_MIN,
  DESK_SPEECH_MAX_MS,
  DESK_STEP_KINDS,
  stepTiming,
  type DeskHouse,
  type DeskLightState,
  type DeskRunStep,
  type DeskStep,
  type DeskStepKind,
} from '@loom/core/house-desk'
import { stepStateGlyph } from '@/lib/house-desk-view'
import { Field, NamesField, SecondsField, SelectField, TextField } from './fields'
import { KIND_LABEL, btn, input } from './ui'


export interface StepRowProps {
  step: DeskStep
  i: number
  count: number
  house: DeskHouse
  selected: boolean
  problems: string[]
  warnings: string[]
  run: DeskRunStep | null
  onSelect: () => void
  onPatch: (patch: Record<string, unknown>) => void
  onKind: (kind: DeskStepKind) => void
  onWith: (withPrevious: boolean) => void
  onMove: (delta: -1 | 1) => void
  onDuplicate: () => void
  onDelete: () => void
}

export function StepRow(p: StepRowProps) {
  const { step, i } = p
  return (
    <li
      onClick={p.onSelect}
      className={clsx('rounded border p-2', p.selected ? 'border-indigo-700 bg-indigo-950/30' : 'border-zinc-800', p.problems.length > 0 && 'border-red-800')}
      data-testid={`house-step-${i}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-5 text-right font-mono text-[11px] text-zinc-500">{i + 1}</span>
        {i > 0 && (
          <button
            onClick={() => p.onWith(step.start !== 'with')}
            className={clsx(btn, step.start === 'with' ? 'border-sky-700 text-sky-200' : '')}
            title={step.start === 'with' ? 'Starts with the step above (parallel). Click: then (after the group above ends)' : 'Starts once every step above has ended (series). Click: with ↑ (parallel)'}
            data-testid={`house-step-${i}-start`}
          >
            {step.start === 'with' ? 'with ↑' : 'then'}
          </button>
        )}
        <SelectField value={step.kind} onChange={(k) => p.onKind(k as DeskStepKind)} options={DESK_STEP_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} testId={`house-step-${i}-kind`} />
        <span className="flex items-center gap-1 text-[11px] text-zinc-500" title="ms after its group starts">
          +<SecondsField ms={step.wait} optional onChange={(wait) => p.onPatch({ wait: wait === 0 ? undefined : wait })} testId={`house-step-${i}-wait`} /> s
        </span>
        <span className="text-[10px] text-zinc-500">{stepTiming(step, i)}</span>
        {p.run !== null && (
          <span className="font-mono text-[11px] text-emerald-300" title={p.run.result ?? p.run.state}>
            {stepStateGlyph(p.run.state)} {p.run.result ?? ''}
          </span>
        )}
        <span className="ml-auto flex gap-1">
          <button onClick={() => p.onMove(-1)} disabled={i === 0} className={btn} title="Move up">
            ↑
          </button>
          <button onClick={() => p.onMove(1)} disabled={i === p.count - 1} className={btn} title="Move down">
            ↓
          </button>
          <button onClick={p.onDuplicate} className={btn} title="Duplicate (starts with this one)">
            ⧉
          </button>
          <button onClick={p.onDelete} className={btn} title="Delete the step" data-testid={`house-step-${i}-delete`}>
            ✕
          </button>
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-end gap-2 pl-6">
        <KindFields step={step} house={p.house} onPatch={p.onPatch} i={i} />
        <Field label="note" className="w-32">
          <TextField value={step.note ?? ''} onChange={(v) => p.onPatch({ note: v === '' ? undefined : v })} />
        </Field>
      </div>
      {[...p.problems.map((m) => ['bad', m] as const), ...p.warnings.map((m) => ['warn', m] as const)].map(([tone, m], k) => (
        <p key={k} className={clsx('mt-1 pl-6 text-[11px]', tone === 'bad' ? 'text-red-300' : 'text-amber-300')}>
          {tone === 'bad' ? '✗' : '⚠'} {m}
        </p>
      ))}
    </li>
  )
}

const opt = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }))

function KindFields({ step, house, onPatch, i }: { step: DeskStep; house: DeskHouse; onPatch: (p: Record<string, unknown>) => void; i: number }) {
  switch (step.kind) {
    case 'sound':
      return (
        <>
          <Field label="sound">
            <TextField value={step.sound} onChange={(sound) => onPatch({ sound })} options={house.sounds.map((s) => s.name)} mono testId={`house-step-${i}-sound`} />
          </Field>
          <Field label="to">
            <NamesField names={step.to ?? []} onChange={(to) => onPatch({ to: to.length > 0 ? to : undefined })} options={house.audioTargets} empty="as the story routes it" />
          </Field>
          <Field label="gain dB">
            <input
              type="number"
              min={DESK_GAIN_MIN}
              max={DESK_GAIN_MAX}
              value={step.gain ?? ''}
              placeholder="0"
              onChange={(e) => onPatch({ gain: e.target.value === '' ? undefined : Number(e.target.value) })}
              className={clsx(input, 'w-16')}
            />
          </Field>
          <Field label="length s">
            <SecondsField ms={step.dur} optional onChange={(dur) => onPatch({ dur })} />
          </Field>
        </>
      )
    case 'say':
      return (
        <>
          <Field label="text" className="min-w-[14rem] flex-1">
            <TextField value={step.text} onChange={(text) => onPatch({ text })} testId={`house-step-${i}-text`} />
          </Field>
          <Field label="to">
            <NamesField names={step.to ?? []} onChange={(to) => onPatch({ to: to.length > 0 ? to : undefined })} options={house.audioTargets} empty="the announcement speakers" />
          </Field>
          <label className="flex items-center gap-1 text-[11px] text-zinc-400">
            <input type="checkbox" checked={step.chime !== false} onChange={(e) => onPatch({ chime: e.target.checked ? undefined : false })} /> chime
          </label>
          <Field label="length s">
            <SecondsField ms={step.dur} optional onChange={(dur) => onPatch({ dur })} />
          </Field>
        </>
      )
    case 'look':
      return (
        <Field label="look">
          <SelectField value={step.look} onChange={(look) => onPatch({ look })} options={house.looks.map((l) => ({ value: l.name, label: `${l.name}${l.loop ? ' (loops)' : ''}` }))} testId={`house-step-${i}-look`} />
        </Field>
      )
    case 'light':
      return (
        <>
          <Field label="to">
            <NamesField names={step.to} onChange={(to) => onPatch({ to })} options={house.lightTargets} empty="pick lights" />
          </Field>
          <LightSetFields set={step.set} onChange={(set) => onPatch({ set })} />
        </>
      )
    case 'stop':
      return (
        <label className="flex items-center gap-1 text-[11px] text-zinc-400">
          <input type="checkbox" checked={step.announce === true} onChange={(e) => onPatch({ announce: e.target.checked ? true : undefined })} /> the announcement too
        </label>
      )
    case 'event':
      return (
        <Field label="story event (when …:)">
          <TextField value={step.event} onChange={(event) => onPatch({ event })} options={house.events} mono testId={`house-step-${i}-event`} />
        </Field>
      )
    case 'speech':
      return (
        <>
          <Field label="room (LOCATION)">
            <SelectField value={step.room} onChange={(room) => onPatch({ room })} options={opt(house.rooms)} />
          </Field>
          <Field label="at most s">
            <SecondsField ms={step.max} optional max={DESK_SPEECH_MAX_MS} onChange={(max) => onPatch({ max })} />
          </Field>
        </>
      )
    case 'wait':
      return (
        <Field label="seconds">
          <SecondsField ms={step.ms} onChange={(ms) => onPatch({ ms: ms ?? 0 })} testId={`house-step-${i}-ms`} />
        </Field>
      )
  }
}

function LightSetFields({ set, onChange }: { set: DeskLightState; onChange: (s: DeskLightState) => void }) {
  const patch = (p: Partial<DeskLightState>) => {
    const next: Record<string, unknown> = { ...set, ...p }
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    onChange(next as DeskLightState)
  }
  return (
    <>
      <Field label="state">
        <SelectField value={set.state ?? ''} onChange={(v) => patch({ state: v === 'ON' || v === 'OFF' ? v : undefined })} options={[{ value: '', label: '—' }, { value: 'ON', label: 'on' }, { value: 'OFF', label: 'off' }]} />
      </Field>
      <Field label="bright 0–254">
        <input type="number" min={0} max={254} value={set.brightness ?? ''} onChange={(e) => patch({ brightness: e.target.value === '' ? undefined : Number(e.target.value) })} className={clsx(input, 'w-16')} />
      </Field>
      <Field label="colour">
        <span className="flex items-center gap-1">
          <input type="color" value={set.color ?? '#ffffff'} onChange={(e) => patch({ color: e.target.value, color_temp: undefined })} className="h-6 w-8 rounded border border-zinc-700 bg-zinc-950" />
          {set.color !== undefined && (
            <button onClick={() => patch({ color: undefined })} className="text-[11px] text-zinc-500 hover:text-zinc-200" title="No colour">
              ×
            </button>
          )}
        </span>
      </Field>
      <Field label="white mired">
        <input type="number" min={150} max={500} value={set.color_temp ?? ''} onChange={(e) => patch({ color_temp: e.target.value === '' ? undefined : Number(e.target.value), ...(e.target.value !== '' ? { color: undefined } : {}) })} className={clsx(input, 'w-16')} />
      </Field>
      <Field label="fade s">
        <input type="number" min={0} max={30} step={0.5} value={set.transition ?? ''} onChange={(e) => patch({ transition: e.target.value === '' ? undefined : Number(e.target.value) })} className={clsx(input, 'w-14')} />
      </Field>
    </>
  )
}
