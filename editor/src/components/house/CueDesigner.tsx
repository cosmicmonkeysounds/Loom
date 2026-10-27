//! Run → House → Cue designer (wave 30): where the house's lighting looks
//! and sound cues are designed and tied to the story.
//!
//! - **Left, the library**: 💡 the looks (`lights.json`: how each plays, its
//!   length, how often the story cues it, ● unsaved, ⛔ problems), the story
//!   cues no look answers yet, and + New look (from a template); 🔊 the
//!   story's sounds (file on the router's machine, length, ▶ audition);
//!   🎬 the desk cues (a sound with lights, or anything the story should
//!   wait on), each opening its story hookup.
//! - **Right, the selection**: a look in `LookEditor` (preview, steps,
//!   ▶ Test on the house); a sound (play it anywhere at any gain, *Make a
//!   desk cue*); a desk cue (its steps and timeline, ▶ GO, *Edit in Desk*).
//!   Each shows how the story fires it (`StoryHookup`).
//!
//! Looks save to the event's lights (`POST /api/mod/lights`, `base`) with
//! the save bar on top; Save to project writes `lights.json`. Desk cues are
//! made here and finished in the Desk view's inspector (one desk draft:
//! `store/house-desk.ts`). Pure side: `lib/cue-designer.ts`; store:
//! `store/cue-designer.ts`.

import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { LOOK_TEMPLATES, LOOK_TEMPLATE_INFO, lookFloor, lookFromTemplate, lookNameError, lookNameOf, validateLights, type LightsConfig, type LookTemplate } from '@loom/house'
import { DESK_GAIN_MAX, DESK_GAIN_MIN, secondsText, stepText, type DeskConfig, type DeskView } from '@loom/core/house-desk'
import { shownLights, useCueDesigner } from '@/store/cue-designer'
import { shownDesk, useHouseDesk } from '@/store/house-desk'
import { cueHooks, cueLine, deskCuesWithSound, lookCue, lookRows, MODE_GLYPH, MODE_LABEL, soundCue, soundLine, unwrittenLooks, type LookRow } from '@/lib/cue-designer'
import { deskDurationsOf, timelineBars } from '@/lib/house-desk-view'
import { LookEditor } from './LookEditor'
import { StoryHookup } from './StoryHookup'
import { useStoryDocs } from '@/lib/story-docs'
import { NamesField, SelectField } from './fields'
import { btn, btnPrimary, heading, input, TONE_TEXT } from './ui'

export function CueDesigner({ view, onOpenDesk }: { view: DeskView; onOpenDesk: (cueIndex: number) => void }) {
  const read = useCueDesigner((s) => s.read)
  const draft = useCueDesigner((s) => s.draft)
  const missing = useCueDesigner((s) => s.missing)
  const reachable = useCueDesigner((s) => s.reachable)
  const house = useCueDesigner((s) => s.house)
  const sel = useCueDesigner((s) => s.sel)
  const deskDraft = useHouseDesk((s) => s.draft)
  const desk = shownDesk({ draft: deskDraft, view })
  const docs = useStoryDocs()
  const lights = shownLights({ draft, read })
  const check = useMemo(() => (lights === null ? null : validateLights(lights, house)), [lights, house])

  if (missing) return <Centered title="This event server has no lights route.">It is running older code: update and restart the server.</Centered>
  if (lights === null || read === null) return <Centered title={reachable ? 'Reading the lights…' : 'Can’t reach the server: retrying…'} />

  const openCue = (id: string) => {
    const i = desk?.cues.findIndex((c) => c.id === id) ?? -1
    if (i >= 0) useCueDesigner.getState().select({ kind: 'cue', id })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="cue-designer">
      <DesignerSaveBar lights={lights} problems={check?.problems ?? []} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
        <Library lights={lights} view={view} desk={desk} docs={docs} problems={check?.problems ?? []} />
        <section className="min-h-0 overflow-auto" data-testid="designer-detail">
          {sel === null && <Welcome />}
          {sel?.kind === 'look' && (
            <LookEditor lights={lights} house={house} deskHouse={view.house} desk={desk} name={sel.name} problems={check?.problems ?? []} warnings={check?.warnings ?? []} docs={docs} onOpenCue={openCue} onMakeCue={() => makeLookCue(sel.name, lights, onOpenDesk)} />
          )}
          {sel?.kind === 'sound' && <SoundPanel name={sel.name} view={view} desk={desk} docs={docs} lights={lights} onOpenDesk={onOpenDesk} />}
          {sel?.kind === 'cue' && <DeskCuePanel id={sel.id} view={view} desk={desk} docs={docs} onOpenDesk={onOpenDesk} />}
        </section>
      </div>
    </div>
  )
}

function Centered({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="grid flex-1 place-items-center p-8 text-center text-sm text-zinc-500">
      <div className="max-w-md">
        <p className="text-zinc-300">{title}</p>
        {children !== undefined && <p className="mt-2">{children}</p>}
      </div>
    </div>
  )
}

function Welcome() {
  return (
    <div className="mx-auto max-w-xl space-y-3 p-6 text-sm text-zinc-400" data-testid="designer-welcome">
      <h2 className="text-base text-zinc-100">The Cue designer</h2>
      <p>Design what the house does, and tie it to the story:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <b className="text-zinc-200">💡 A look</b> is a lighting animation: one colour, or timed steps that play once, a few times, until the next look, or once and then give the light back. The story plays it with <code className="text-emerald-200">cue &lt;name&gt;</code>.
        </li>
        <li>
          <b className="text-zinc-200">🔊 A sound</b> is a file on the router's machine. The story plays it with <code className="text-emerald-200">sound &lt;name&gt;</code>; audition it here on any speaker.
        </li>
        <li>
          <b className="text-zinc-200">🎬 A desk cue</b> runs sounds, looks, announcements and story events together or one after another, and tells the story when it's done. The story plays it with <code className="text-emerald-200">cue &lt;id&gt;</code> too.
        </li>
      </ul>
      <p>Pick one on the left, or start a new look from a template. Every look previews here first; ▶ Test on the house sends it to the real lights.</p>
    </div>
  )
}

// --- the save bar -----------------------------------------------------------------

function DesignerSaveBar({ lights, problems }: { lights: LightsConfig; problems: readonly string[] }) {
  const read = useCueDesigner((s) => s.read)
  const draft = useCueDesigner((s) => s.draft)
  const stale = useCueDesigner((s) => s.stale)
  const busy = useCueDesigner((s) => s.busy)
  const note = useCueDesigner((s) => s.note)
  const saveProblems = useCueDesigner((s) => s.saveProblems)
  const save = useCueDesigner((s) => s.save)
  const discard = useCueDesigner((s) => s.discard)
  const saveToProject = useCueDesigner((s) => s.saveToProject)
  const dirty = draft !== null
  const looks = Object.keys(lights.looks).length
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs" data-testid="designer-savebar">
      <span className="text-zinc-400">
        💡 {lights.fixtures.length} light{lights.fixtures.length === 1 ? '' : 's'} · {looks} look{looks === 1 ? '' : 's'} · from{' '}
        {read?.source === 'director' ? 'a director’s save for this event' : read?.source === 'project' ? 'the project’s lights.json' : read?.source === 'env' ? 'the server’s fallback file' : 'nothing yet'}
      </span>
      {dirty && <span className="text-amber-300">● unsaved{stale ? ' · someone else saved since' : ''}</span>}
      {problems.length > 0 && <span className="text-red-300">⛔ {problems.length} problem{problems.length === 1 ? '' : 's'}</span>}
      {note !== null && <span className={TONE_TEXT[note.tone]}>{note.text}</span>}
      <span className="ml-auto flex gap-1">
        <button className={btn} disabled={!dirty || busy !== null} onClick={discard}>
          Discard
        </button>
        <button className={btnPrimary} disabled={!dirty || busy !== null || problems.length > 0} onClick={() => void save()} title="Save to this event: the lights module plays it at once" data-testid="designer-save">
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button className={btn} disabled={busy !== null || read?.source === 'project' && !dirty} onClick={() => void saveToProject()} title="Write the lights into the project as lights.json (keeps them past End and relaunch)">
          Save to project
        </button>
      </span>
      {saveProblems.length > 0 && (
        <ul className="basis-full text-[11px] text-red-300">
          {saveProblems.slice(0, 6).map((p) => (
            <li key={p}>⛔ {p}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// --- the library --------------------------------------------------------------------

function Library({ lights, view, desk, docs, problems }: { lights: LightsConfig; view: DeskView; desk: DeskConfig | null; docs: ReadonlyArray<{ uri: string; text: string }>; problems: readonly string[] }) {
  const read = useCueDesigner((s) => s.read)
  const house = useCueDesigner((s) => s.house)
  const sel = useCueDesigner((s) => s.sel)
  const select = useCueDesigner((s) => s.select)
  const [adding, setAdding] = useState<string | null>(null)
  const rows = useMemo(() => lookRows(lights, read?.lights ?? null, house, desk, docs, problems), [lights, read, house, desk, docs, problems])
  const unwritten = unwrittenLooks(read?.cued ?? [], lights, desk)
  return (
    <aside className="min-h-0 overflow-auto border-r border-zinc-800 p-2" data-testid="designer-library">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className={heading}>💡 Lighting looks</span>
        <button className={btn} onClick={() => setAdding('')} data-testid="designer-new-look">
          + New look
        </button>
      </div>
      {adding !== null && <NewLook lights={lights} view={view} initial={adding} onDone={() => setAdding(null)} />}
      {lights.fixtures.length === 0 && <p className="px-1 py-1 text-[11px] text-amber-300/90">No lights are placed yet: pair them, then place them on the house map's 💡 Lights tab (see Setup). You can still write looks.</p>}
      <ul className="mb-2">
        {rows.map((r) => (
          <LookItem key={r.name} row={r} selected={sel?.kind === 'look' && sel.name === r.name} onClick={() => select({ kind: 'look', name: r.name })} />
        ))}
        {rows.length === 0 && <li className="px-1 text-[11px] text-zinc-500">No looks yet.</li>}
      </ul>
      {unwritten.length > 0 && (
        <details className="mb-3 px-1 text-[11px] text-zinc-400" data-testid="designer-unwritten">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
            {unwritten.length} more story cue{unwritten.length === 1 ? '' : 's'} with no look here
          </summary>
          <p className="mt-1">The story cues these, and no look or desk cue here answers them. The house’s show rules (stagehand’s <code>show</code> job: Zigbee scenes, WLED presets) may play them already; write a look to light them from here instead:</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {unwritten.map((n) => (
              <button key={n} className={clsx(btn, 'font-mono')} onClick={() => setAdding(n)} title={`Write the look the story's “cue ${n}” plays`}>
                + {n}
              </button>
            ))}
          </div>
        </details>
      )}

      <div className={clsx(heading, 'px-1 pb-1 pt-2')}>🔊 Story sounds</div>
      <ul className="mb-2">
        {view.house.sounds.map((s) => (
          <li key={s.name}>
            <button onClick={() => select({ kind: 'sound', name: s.name })} className={clsx('flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs', sel?.kind === 'sound' && sel.name === s.name ? 'bg-indigo-950/60 ring-1 ring-indigo-700' : 'hover:bg-zinc-900')}>
              <span className="min-w-0 flex-1 truncate font-mono text-zinc-200">{s.name}</span>
              <span className={clsx('text-[10px]', s.file === 'missing' ? 'text-red-300' : s.file === 'placeholder' ? 'text-amber-300' : 'text-zinc-500')}>
                {s.file === 'missing' ? 'no file' : s.file === 'placeholder' ? 'placeholder' : s.ms !== null ? secondsText(s.ms) : ''}
              </span>
            </button>
          </li>
        ))}
        {view.house.sounds.length === 0 && <li className="px-1 text-[11px] text-zinc-500">The story plays no sounds yet (write <code>sound &lt;name&gt;</code> in a beat).</li>}
      </ul>

      <div className={clsx(heading, 'px-1 pb-1 pt-2')}>🎬 Desk cues</div>
      <ul>
        {(desk?.cues ?? []).map((c) => (
          <li key={c.id}>
            <button onClick={() => select({ kind: 'cue', id: c.id })} className={clsx('flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs', sel?.kind === 'cue' && sel.id === c.id ? 'bg-indigo-950/60 ring-1 ring-indigo-700' : 'hover:bg-zinc-900')}>
              {c.number !== undefined && <span className="w-6 shrink-0 text-right text-zinc-500">{c.number}</span>}
              <span className="min-w-0 flex-1 truncate text-zinc-200">{c.name}</span>
              <span className="font-mono text-[10px] text-zinc-500">{c.id}</span>
            </button>
          </li>
        ))}
        {(desk?.cues ?? []).length === 0 && <li className="px-1 text-[11px] text-zinc-500">No desk cues yet: make one from a sound or a look.</li>}
      </ul>
    </aside>
  )
}

function LookItem({ row, selected, onClick }: { row: LookRow; selected: boolean; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className={clsx('flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs', selected ? 'bg-indigo-950/60 ring-1 ring-indigo-700' : 'hover:bg-zinc-900')} data-testid={`designer-look-${row.name}`}>
        <span className="w-3 text-center text-zinc-500" title={MODE_LABEL[row.mode]}>
          {MODE_GLYPH[row.mode]}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-zinc-200">
          {row.name}
          {row.boot && <span className="ml-1 text-[10px] text-sky-300" title="The resting look (boot)">★</span>}
          {row.dirty && <span className="ml-1 text-amber-300" title="Unsaved">●</span>}
        </span>
        {row.problems > 0 && <span className="text-[10px] text-red-300">⛔</span>}
        {row.reach === 0 && <span className="text-[10px] text-amber-300" title="Reaches no light">∅</span>}
        <span className={clsx('text-[10px]', row.uses + row.inDesk.length > 0 ? 'text-emerald-300' : 'text-zinc-600')} title={`${row.uses} story line(s), ${row.inDesk.length} desk cue(s)`}>
          {row.uses + row.inDesk.length > 0 ? `⚡${row.uses + row.inDesk.length}` : '—'}
        </span>
        <span className="w-10 text-right text-[10px] text-zinc-500">{row.ms === null ? '↻' : secondsText(row.ms)}</span>
      </button>
    </li>
  )
}

/** + New look: a name, a template, its lights, a colour (and a second one, a speed). */
function NewLook({ lights, view, initial, onDone }: { lights: LightsConfig; view: DeskView; initial: string; onDone: () => void }) {
  const edit = useCueDesigner((s) => s.edit)
  const house = useCueDesigner((s) => s.house)
  const [name, setName] = useState(initial)
  const [tpl, setTpl] = useState<LookTemplate>('pulse')
  const [to, setTo] = useState<string[]>(lights.zones[0] !== undefined ? [lights.zones[0].id] : lights.fixtures[0] !== undefined ? [lights.fixtures[0].id] : ['everywhere'])
  const [color, setColor] = useState('#00e5ff')
  const [color2, setColor2] = useState('#ff2a00')
  const [speed, setSpeed] = useState(1)
  const id = lookNameOf(name)
  const deskIds = new Set(view.house.looks.map((l) => l.name))
  const err = name.trim() === '' ? null : lookNameError(lights, id) ?? (useHouseDesk.getState().view?.desk.cues.some((c) => c.id === id) && !deskIds.has(id) ? `“${id}” is a desk cue's id` : null)
  const info = LOOK_TEMPLATE_INFO[tpl]
  const create = () => {
    if (id === '' || err !== null) return
    const look = lookFromTemplate(tpl, { to, color, color2, speed, floor: lookFloor(lights, house, to) })
    edit({ ...lights, looks: { ...lights.looks, [id]: look } }, { kind: 'look', name: id })
    onDone()
  }
  return (
    <div className="mb-2 space-y-2 rounded-lg border border-indigo-900 bg-indigo-950/20 p-2" data-testid="designer-new-look-form">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="name, e.g. heart_wake" className={clsx(input, 'w-full font-mono')} onKeyDown={(e) => e.key === 'Enter' && create()} aria-label="Look name" />
      {err !== null && <p className="text-[11px] text-red-300">{err}</p>}
      {id !== '' && id !== name.trim() && err === null && <p className="text-[11px] text-zinc-500">The story will write <code>cue {id}</code></p>}
      <div className="grid grid-cols-3 gap-1">
        {LOOK_TEMPLATES.map((t) => (
          <button key={t} onClick={() => setTpl(t)} className={clsx('rounded border px-1 py-1 text-[11px]', tpl === t ? 'border-indigo-500 bg-indigo-950 text-zinc-100' : 'border-indigo-900/60 text-indigo-200/80 hover:bg-indigo-950/60')}>
            {LOOK_TEMPLATE_INFO[t].label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-zinc-400">{info.blurb}</p>
      <NamesField names={to} onChange={setTo} options={view.house.lightTargets} empty="pick its lights" />
      <span className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
        colour <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-6 w-8 rounded border border-zinc-700 bg-transparent" aria-label="Colour" />
        {info.color2 && (
          <>
            then <input type="color" value={color2} onChange={(e) => setColor2(e.target.value)} className="h-6 w-8 rounded border border-zinc-700 bg-transparent" aria-label="Second colour" />
          </>
        )}
        {info.speed && (
          <SelectField
            value={String(speed)}
            onChange={(v) => setSpeed(Number(v))}
            options={[
              { value: '0.5', label: 'slow' },
              { value: '1', label: 'normal' },
              { value: '2', label: 'fast' },
            ]}
          />
        )}
      </span>
      <span className="flex gap-1">
        <button className={btnPrimary} disabled={id === '' || err !== null} onClick={create} data-testid="designer-create-look">
          Create
        </button>
        <button className={btn} onClick={onDone}>
          Cancel
        </button>
      </span>
    </div>
  )
}

// --- a sound --------------------------------------------------------------------------

function SoundPanel({ name, view, desk, docs, lights, onOpenDesk }: { name: string; view: DeskView; desk: DeskConfig | null; docs: ReadonlyArray<{ uri: string; text: string }>; lights: LightsConfig; onOpenDesk: (i: number) => void }) {
  const playSound = useCueDesigner((s) => s.playSound)
  const busy = useCueDesigner((s) => s.busy)
  const sound = view.house.sounds.find((s) => s.name === name)
  const [to, setTo] = useState<string[]>([])
  const [gain, setGain] = useState(0)
  const [look, setLook] = useState('')
  const [done, setDone] = useState('')
  const inDesk = deskCuesWithSound(desk, name)
  if (sound === undefined) return <p className="p-4 text-sm text-zinc-500">The story no longer plays {name}.</p>
  const makeCue = () => {
    const d = useHouseDesk.getState()
    const base = shownDesk(d)
    if (base === null) return
    const r = soundCue(base, name, { to, gain, look, done }, Object.keys(lights.looks))
    d.edit(r.desk, r.index, null)
    onOpenDesk(r.index)
  }
  return (
    <div className="space-y-3 p-3" data-testid="designer-sound">
      <h2 className="font-mono text-base text-zinc-100">🔊 {name}</h2>
      <p className="text-xs text-zinc-400">
        {sound.file === 'missing'
          ? '⛔ No file on the router’s machine: put it in stagehand/media/sounds/ there (any name.wav / .mp3 / .ogg).'
          : sound.file === 'placeholder'
            ? '⚠ Still the generated placeholder: replace it with the real file in stagehand/media/sounds/ on the router’s machine.'
            : sound.file === 'ok'
              ? `On the router’s machine${sound.ms !== null ? `, ${secondsText(sound.ms)} long` : ''}.`
              : 'The router hasn’t reported its files yet.'}{' '}
        The story routes it to {sound.to === null ? 'the rooms it plays in (else everywhere)' : sound.to.join(', ')} (the house map’s 🔊 Audio tab sets that).
      </p>
      <div className="space-y-2 rounded-lg border border-zinc-800 p-2">
        <div className={heading}>Audition</div>
        <span className="flex flex-wrap items-center gap-2">
          <NamesField names={to} onChange={setTo} options={view.house.audioTargets} empty="as the story routes it" />
          <label className="flex items-center gap-1 text-[11px] text-zinc-400">
            gain
            <input type="range" min={DESK_GAIN_MIN} max={DESK_GAIN_MAX} value={gain} onChange={(e) => setGain(Number(e.target.value))} className="w-28" />
            <span className="w-12 font-mono">{gain > 0 ? '+' : ''}{gain} dB</span>
          </label>
          <button className={btnPrimary} disabled={busy !== null || !view.house.router.online} onClick={() => void playSound(name, to, gain)} title={view.house.router.online ? 'Play it on the house speakers' : 'The sound router is offline'} data-testid="designer-play-sound">
            ▶ Play on the house
          </button>
        </span>
        {!view.house.router.online && <p className="text-[11px] text-amber-300">The sound router is offline: see Setup.</p>}
      </div>
      <div className="space-y-2 rounded-lg border border-zinc-800 p-2">
        <div className={heading}>Make a desk cue</div>
        <p className="text-[11px] text-zinc-400">A desk cue plays this sound (on the speakers and at the gain above) with a look at the same time, and can tell the story when both have finished.</p>
        <span className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
          with the look
          <SelectField value={look} onChange={setLook} options={[{ value: '', label: '— none' }, ...Object.keys(lights.looks).sort().map((n) => ({ value: n, label: n }))]} />
          then tell the story
          <input value={done} onChange={(e) => setDone(e.target.value)} placeholder="event (optional)" className={clsx(input, 'w-36 font-mono')} />
          <button className={btn} onClick={makeCue} data-testid="designer-make-sound-cue">
            + Desk cue
          </button>
        </span>
        {inDesk.length > 0 && <p className="text-[11px] text-zinc-500">Already in desk cue{inDesk.length === 1 ? '' : 's'}: {inDesk.join(', ')}</p>}
      </div>
      <StoryHookup kind="sound" name={name} line={soundLine(name)} docs={docs} />
    </div>
  )
}

// --- a desk cue -------------------------------------------------------------------------

function DeskCuePanel({ id, view, desk, docs, onOpenDesk }: { id: string; view: DeskView; desk: DeskConfig | null; docs: ReadonlyArray<{ uri: string; text: string }>; onOpenDesk: (i: number) => void }) {
  const go = useHouseDesk((s) => s.go)
  const deskDirty = useHouseDesk((s) => s.draft !== null)
  const index = desk?.cues.findIndex((c) => c.id === id) ?? -1
  const cue = index >= 0 ? desk!.cues[index]! : null
  const durations = useMemo(() => deskDurationsOf(view.house), [view.house])
  if (cue === null) return <p className="p-4 text-sm text-zinc-500">That desk cue is gone.</p>
  const { bars, span } = timelineBars(cue, durations)
  const saved = view.desk.cues.some((c) => c.id === id)
  return (
    <div className="space-y-3 p-3" data-testid="designer-cue">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base text-zinc-100">
          🎬 {cue.number !== undefined && <span className="text-zinc-500">{cue.number} · </span>}
          {cue.name} <span className="font-mono text-xs text-zinc-500">{cue.id}</span>
        </h2>
        <span className="ml-auto flex gap-1">
          <button className={btnPrimary} disabled={!saved} onClick={() => void go(cue.id)} title={saved ? 'GO it now' : 'Save the desk first (Desk view)'}>
            ▶ GO
          </button>
          <button className={btn} onClick={() => onOpenDesk(index)} data-testid="designer-edit-in-desk">
            Edit in Desk →
          </button>
        </span>
      </div>
      {(!saved || deskDirty) && <p className="text-[11px] text-amber-300">The desk has unsaved edits: save them in the Desk view (Cue pane) before the story or GO can play this cue.</p>}
      <div className="relative h-auto rounded border border-zinc-800 bg-zinc-950 p-2">
        {bars.map((b) => (
          <div key={b.i} className="relative mb-0.5 h-4">
            <div className={clsx('absolute h-4 overflow-hidden rounded-sm text-[10px] leading-4 text-zinc-900', b.open ? 'bg-zinc-600' : 'bg-indigo-400')} style={{ left: `${b.left}%`, width: `${b.width}%` }} title={stepText(cue.steps[b.i]!)}>
              <span className="truncate whitespace-nowrap px-1">{stepText(cue.steps[b.i]!)}</span>
            </div>
          </div>
        ))}
        <div className="mt-1 text-right font-mono text-[10px] text-zinc-500">{secondsText(span)}</div>
      </div>
      <ol className="list-decimal space-y-0.5 pl-5 text-xs text-zinc-300">
        {cue.steps.map((s, i) => (
          <li key={i}>
            <span className="text-zinc-500">{i > 0 && (s.start === 'with' ? 'with ↑ ' : 'then ')}</span>
            {stepText(s)}
          </li>
        ))}
      </ol>
      <StoryHookup kind="cue" name={cue.id} line={cueLine(cue.id)} docs={docs} events={cueHooks(cue, view.house)} />
    </div>
  )
}

/** A look turned into a desk cue (the Desk view opens on it). */
function makeLookCue(look: string, lights: LightsConfig, onOpenDesk: (i: number) => void): void {
  const d = useHouseDesk.getState()
  const base = shownDesk(d)
  if (base === null) return
  const r = lookCue(base, look, Object.keys(lights.looks))
  d.edit(r.desk, r.index, null)
  onOpenDesk(r.index)
}
