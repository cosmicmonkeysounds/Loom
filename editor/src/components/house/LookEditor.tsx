//! Run → House → Cue designer: one lighting look, edited. The preview on
//! top; then its name (the story's `cue` name), targets and how it ends
//! (once / a few times / until the next look / once then give the light
//! back) with its period; then the steps as rows (when, on / off,
//! brightness, colour or white, fade, effect, own targets), each with
//! ▶ Try on one light; problems in red, warnings in amber; and how the story
//! fires it. Every edit is an `@loom/house` look op on the draft, so the
//! spacing Zigbee needs and a period that wraps safely are kept as you type.

import clsx from 'clsx'
import { useState } from 'react'
import {
  LIGHT_EFFECTS,
  LIGHT_MAX_REPEAT,
  LIGHT_MAX_STEPS,
  duplicateLook,
  lookMode,
  lookNameError,
  lookNameOf,
  lookTargets,
  minPeriod,
  minStepAt,
  patchLookStep,
  removeLook,
  removeLookStep,
  renameLook,
  resolveLightTargets,
  setBoot,
  setLookMode,
  setLookNote,
  setLookPeriod,
  setLookTargets,
  stepsOfLook,
  addLookStep,
  type HouseMap,
  type LightEffect,
  type LightStep,
  type LightsConfig,
  type LookMode,
  type StatePatch,
} from '@loom/house'
import type { DeskConfig, DeskHouse } from '@loom/core/house-desk'
import { confirmAction } from '@/store/dialog'
import { lookDirty, useCueDesigner } from '@/store/cue-designer'
import { cueLine, deskCuesWithLook, lookLines, MODE_LABEL } from '@/lib/cue-designer'
import { Field, NamesField, SecondsField, SelectField } from './fields'
import { LookPreview } from './LookPreview'
import { StoryHookup } from './StoryHookup'
import { btn, btnDanger, btnPrimary, heading, input } from './ui'

const MODES: LookMode[] = ['once', 'repeat', 'loop', 'restore']

export function LookEditor({
  lights,
  house,
  deskHouse,
  desk,
  name,
  problems,
  warnings,
  docs,
  onOpenCue,
  onMakeCue,
}: {
  lights: LightsConfig
  house: HouseMap | null
  deskHouse: DeskHouse | null
  desk: DeskConfig | null
  name: string
  problems: readonly string[]
  warnings: readonly string[]
  docs: ReadonlyArray<{ uri: string; text: string }>
  onOpenCue: (id: string) => void
  /** A new desk cue that plays this look (the Desk view opens on it). */
  onMakeCue: () => void
}) {
  const edit = useCueDesigner((s) => s.edit)
  const step = useCueDesigner((s) => s.step)
  const selectStep = useCueDesigner((s) => s.selectStep)
  const testLook = useCueDesigner((s) => s.testLook)
  const busy = useCueDesigner((s) => s.busy)
  const dirty = useCueDesigner((s) => lookDirty(s, name))
  const [rename, setRename] = useState<string | null>(null)
  const look = lights.looks[name]
  if (look === undefined) return <p className="p-4 text-sm text-zinc-500">That look is gone.</p>

  const steps = stepsOfLook(look)
  const mode = lookMode(look)
  const min = minPeriod(look, lights)
  const mine = lookLines(problems, name)
  const warn = lookLines(warnings, name)
  const targets = deskHouse?.lightTargets ?? ['everywhere', ...lights.fixtures.map((f) => f.id), ...lights.zones.map((z) => z.id)]
  const reached = resolveLightTargets(lights, house, lookTargets(look)).fixtures
  const desks = deskCuesWithLook(desk, name)
  const renameErr = rename === null ? null : lookNameError(lights, lookNameOf(rename), name)

  return (
    <div className="space-y-3 p-3" data-testid="designer-look">
      <div className="flex flex-wrap items-center gap-2">
        {rename === null ? (
          <h2 className="font-mono text-base text-zinc-100">
            💡 {name}
            {dirty && <span className="ml-1 text-amber-300" title="Unsaved">●</span>}
          </h2>
        ) : (
          <span className="flex items-center gap-1">
            <input autoFocus value={rename} onChange={(e) => setRename(e.target.value)} className={clsx(input, 'font-mono')} aria-label="New name" />
            <button
              className={btnPrimary}
              disabled={renameErr !== null}
              onClick={() => {
                const to = lookNameOf(rename)
                edit(renameLook(lights, name, to), { kind: 'look', name: to })
                setRename(null)
              }}
            >
              Rename
            </button>
            <button className={btn} onClick={() => setRename(null)}>
              Cancel
            </button>
            {renameErr !== null && <span className="text-[11px] text-red-300">{renameErr}</span>}
          </span>
        )}
        <span className="ml-auto flex flex-wrap gap-1">
          <button className={btnPrimary} onClick={() => void testLook(name)} disabled={busy !== null || reached.length === 0} title="Play it on the real lights (saves first if edited)" data-testid="designer-test-look">
            ▶ Test on the house
          </button>
          {rename === null && (
            <button className={btn} onClick={() => setRename(name)} title="The story's cue lines must follow a rename">
              Rename
            </button>
          )}
          <button
            className={btn}
            onClick={() => {
              const r = duplicateLook(lights, name)
              if (r !== null) edit(r.lights, { kind: 'look', name: r.name })
            }}
          >
            Duplicate
          </button>
          <button
            className={btnDanger}
            onClick={() => {
              void confirmAction({ title: `Delete ${name}?`, body: 'The story’s cue lines and desk steps that play it will find nothing. You can Discard before saving.', confirmLabel: 'Delete', danger: true }).then((ok) => {
                if (ok) edit(removeLook(lights, name), null)
              })
            }}
          >
            Delete
          </button>
        </span>
      </div>

      <LookPreview key={name} lights={lights} house={house} name={name} step={step} onStep={(i) => selectStep(i)} />

      {mine.length > 0 && (
        <ul className="rounded border border-red-900 bg-red-950/30 p-2 text-[11px] text-red-200">
          {mine.map((p) => (
            <li key={p}>⛔ {p.replace(`looks["${name}"]`, '').replace(/^[.:\s]+/, '') || p}</li>
          ))}
        </ul>
      )}
      {warn.length > 0 && (
        <ul className="rounded border border-amber-900 bg-amber-950/20 p-2 text-[11px] text-amber-200">
          {warn.map((p) => (
            <li key={p}>⚠ {p.replace(`looks["${name}"]`, '').replace(/^[.:\s]+/, '') || p}</li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        <span className={heading}>Lights</span>
        <span className="flex flex-wrap items-center gap-2">
          <NamesField names={look.to ?? []} onChange={(to) => edit(setLookTargets(lights, name, to))} options={targets} empty="no light yet" testId="designer-targets" />
          <span className="text-[11px] text-zinc-500">reaches {reached.length === 0 ? 'nothing' : reached.map((id) => lights.fixtures.find((f) => f.id === id)?.name ?? id).join(', ')}</span>
        </span>

        <span className={heading}>Plays</span>
        <span className="flex flex-wrap items-center gap-2">
          <SelectField value={mode} onChange={(v) => edit(setLookMode(lights, name, v as LookMode, look.repeat ?? 2))} options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))} testId="designer-mode" />
          {mode === 'repeat' && (
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              ×
              <input type="number" min={2} max={LIGHT_MAX_REPEAT} value={look.repeat ?? 2} onChange={(e) => edit(setLookMode(lights, name, 'repeat', Number(e.target.value)))} className={clsx(input, 'w-14')} />
            </label>
          )}
          {mode !== 'once' && (
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              {mode === 'restore' ? 'give it back after' : 'every'}
              <SecondsField ms={look.period} optional onChange={(ms) => edit(setLookPeriod(lights, name, ms ?? null))} />
              s{min !== null && <span className="text-zinc-600">(at least {(min / 1000).toFixed(1)})</span>}
            </label>
          )}
          <label className="ml-auto flex items-center gap-1 text-[11px] text-zinc-400" title="Played when the lights module starts and after a story reset">
            <input type="checkbox" checked={lights.boot === name} onChange={(e) => edit(setBoot(lights, e.target.checked ? name : null))} />
            the house's resting look (boot)
          </label>
        </span>

        <span className={heading}>Note</span>
        <input value={look.note ?? ''} onChange={(e) => edit(setLookNote(lights, name, e.target.value))} placeholder="What it is for (only directors see it)" className={input} />
      </div>

      <div>
        <div className="flex items-center gap-2 pb-1">
          <span className={heading}>Steps</span>
          <span className="text-[10px] text-zinc-500">Zigbee bulbs need ≥ 0.15 s between steps (0.4 s for a colour change); a repeat on them ≥ 1.5 s.</span>
        </div>
        <ul className="space-y-1">
          {steps.map((_, i) => (
            <StepLine key={i} lights={lights} name={name} steps={steps} i={i} selected={step === i} targets={targets} />
          ))}
        </ul>
        <button className={clsx(btn, 'mt-1')} disabled={steps.length >= LIGHT_MAX_STEPS} onClick={() => edit(addLookStep(lights, name), undefined, steps.length)} data-testid="designer-add-step">
          + Step
        </button>
      </div>

      <StoryHookup
        kind="cue"
        name={name}
        line={cueLine(name)}
        docs={docs}
        extra={
          desks.length > 0 ? (
            <p className="text-[11px] text-zinc-400">
              Also played by desk cue{desks.length === 1 ? '' : 's'}{' '}
              {desks.map((id) => (
                <button key={id} onClick={() => onOpenCue(id)} className="mr-1 font-mono text-indigo-300 hover:underline">
                  {id}
                </button>
              ))}
            </p>
          ) : (
            <p className="text-[11px] text-zinc-500">
              To run it with a sound, or make the story wait until it has played, put it in a desk cue:{' '}
              <button className={btn} onClick={onMakeCue} data-testid="designer-make-look-cue">
                + Desk cue with this look
              </button>
            </p>
          )
        }
      />
    </div>
  )
}

const hexOk = (v: string) => /^#[0-9a-f]{6}$/i.test(v)

function StepLine({ lights, name, steps, i, selected, targets }: { lights: LightsConfig; name: string; steps: LightStep[]; i: number; selected: boolean; targets: readonly string[] }) {
  const edit = useCueDesigner((s) => s.edit)
  const selectStep = useCueDesigner((s) => s.selectStep)
  const testState = useCueDesigner((s) => s.testState)
  const busy = useCueDesigner((s) => s.busy)
  const s = steps[i]!
  const set = s.set
  const patch = (p: StatePatch) => edit(patchLookStep(lights, name, i, { set: p }), undefined, i)
  const floor = minStepAt(steps, i)
  const colourKind = set.color !== undefined ? 'color' : set.color_temp !== undefined ? 'white' : 'keep'
  const firstFixture = resolveLightTargets(lights, null, s.to ?? lights.looks[name]?.to ?? []).fixtures[0]
  return (
    <li onClick={() => selectStep(i)} className={clsx('flex flex-wrap items-end gap-2 rounded border px-2 py-1.5', selected ? 'border-indigo-700 bg-indigo-950/30' : 'border-zinc-800 bg-zinc-950')} data-testid={`designer-step-${i}`}>
      <span className="w-5 pb-1 text-[11px] text-zinc-500">{i + 1}</span>
      <Field label="at (s)">
        <SecondsField ms={s.at} onChange={(ms) => edit(patchLookStep(lights, name, i, { at: Math.max(ms ?? 0, i === 0 ? 0 : floor) }), undefined, i)} />
      </Field>
      <Field label="power">
        <SelectField value={set.state ?? ''} onChange={(v) => patch({ state: v === '' ? null : (v as 'ON' | 'OFF') })} options={[{ value: '', label: '—' }, { value: 'ON', label: 'on' }, { value: 'OFF', label: 'off' }]} />
      </Field>
      <Field label={`bright ${set.brightness ?? '—'}`}>
        <span className="flex items-center gap-1">
          <input type="range" min={0} max={254} value={set.brightness ?? 0} onChange={(e) => patch({ brightness: Number(e.target.value) })} className={clsx('w-24', set.brightness === undefined && 'opacity-40')} aria-label="Brightness" />
          {set.brightness !== undefined && (
            <button className="text-[11px] text-zinc-500 hover:text-zinc-200" onClick={() => patch({ brightness: null })} title="Leave brightness as it is">
              ×
            </button>
          )}
        </span>
      </Field>
      <Field label="colour">
        <span className="flex items-center gap-1">
          <SelectField
            value={colourKind}
            onChange={(v) => patch(v === 'color' ? { color: set.color ?? '#00e5ff' } : v === 'white' ? { color_temp: set.color_temp ?? 300 } : { color: null, color_temp: null })}
            options={[
              { value: 'keep', label: 'keep' },
              { value: 'color', label: 'colour' },
              { value: 'white', label: 'white' },
            ]}
          />
          {colourKind === 'color' && <input type="color" value={hexOk(set.color ?? '') ? set.color : '#ffffff'} onChange={(e) => patch({ color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent" aria-label="Colour" />}
          {colourKind === 'white' && (
            <input type="range" min={150} max={500} value={set.color_temp ?? 300} onChange={(e) => patch({ color_temp: Number(e.target.value) })} className="w-20" title={`${set.color_temp} mireds (left cold, right warm)`} aria-label="White temperature" />
          )}
        </span>
      </Field>
      <Field label="fade (s)">
        <input type="number" min={0} max={30} step={0.1} value={set.transition ?? ''} placeholder="—" onChange={(e) => patch({ transition: e.target.value === '' ? null : Math.max(0, Math.min(30, Number(e.target.value))) })} className={clsx(input, 'w-16')} />
      </Field>
      <Field label="effect">
        <SelectField value={set.effect ?? ''} onChange={(v) => patch({ effect: v === '' ? null : (v as LightEffect) })} options={[{ value: '', label: '—' }, ...LIGHT_EFFECTS.map((e) => ({ value: e, label: e.replace('_', ' ') }))]} />
      </Field>
      <Field label="only on" className="min-w-28">
        <NamesField names={s.to ?? []} onChange={(to) => edit(patchLookStep(lights, name, i, { to: to.length === 0 ? null : to }), undefined, i)} options={targets} empty="the look's lights" />
      </Field>
      <span className="ml-auto flex gap-1 pb-0.5">
        {firstFixture !== undefined && (
          <button className={btn} disabled={busy !== null} onClick={() => void testState(firstFixture, set)} title={`Send just this step to ${firstFixture}`}>
            ▶ Try
          </button>
        )}
        <button className={btn} disabled={steps.length <= 1} onClick={() => edit(removeLookStep(lights, name, i), undefined, null)} title="Delete the step">
          ×
        </button>
      </span>
    </li>
  )
}
