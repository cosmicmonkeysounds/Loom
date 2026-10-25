//! Run → House: the pure edits the cue editor makes to a draft desk (wave
//! 25, `docs/loom-house-desk.md` §6.1). Every op takes a `DeskConfig` and
//! hands back a new one; nothing is mutated, so the store can compare the
//! draft against the desk it was taken from and React sees new objects.
//!
//! Indices, not ids, address cues here: an id is one of the fields being
//! edited (and may clash for a moment while it is typed).

import {
  DESK_ID_RE,
  DESK_RESERVED_PREFIXES,
  DESK_SPEECH_MS,
  type DeskConfig,
  type DeskCue,
  type DeskHouse,
  type DeskStep,
  type DeskStepKind,
} from '@loom/core/house-desk'

/** What the defaults read off the house (any part may be missing). */
export type DeskHouseLike = Partial<Pick<DeskHouse, 'sounds' | 'looks' | 'fixtures' | 'rooms' | 'events' | 'lightTargets'>>

/** Drop the keys whose value is `undefined` (a cleared optional field), so a
 *  draft compares equal to the desk it came from and saves no stray keys. */
export function clean<T extends object>(o: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v
  return out as T
}

/** A cue id from a name: lower case, runs of anything else folded to `_`,
 *  never a screens prefix, never one of `taken` (a `_2`, `_3` … suffix). */
export function idFromName(name: string, taken: readonly string[] = [], avoid: readonly string[] = []): string {
  let base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '_')
    .replace(/^[^a-z0-9]+/u, '')
    .replace(/[_-]+$/u, '')
    .slice(0, 40)
  if (base === '' || !DESK_ID_RE.test(base)) base = 'cue'
  if (DESK_RESERVED_PREFIXES.some((p) => base.startsWith(p))) base = `cue_${base}`
  const used = new Set([...taken, ...avoid])
  if (!used.has(base)) return base
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`
}

const ids = (desk: DeskConfig, except?: number): string[] => desk.cues.filter((_, i) => i !== except).map((c) => c.id)

/** A fresh cue named `name`, its id unique on `desk`. */
export function newCue(desk: DeskConfig, name = 'New cue', avoid: readonly string[] = []): DeskCue {
  return { id: idFromName(name, ids(desk), avoid), name, steps: [] }
}

/** Insert `cue` at `at` (default: the end). The section of the cue before it
 *  carries on, so a new cue joins the section it lands in. */
export function addCue(desk: DeskConfig, cue: DeskCue, at = desk.cues.length): { desk: DeskConfig; index: number } {
  const i = Math.max(0, Math.min(at, desk.cues.length))
  const cues = [...desk.cues.slice(0, i), cue, ...desk.cues.slice(i)]
  return { desk: { ...desk, cues }, index: i }
}

/** A copy of cue `i` right after it ("… copy", a fresh id). */
export function duplicateCue(desk: DeskConfig, i: number, avoid: readonly string[] = []): { desk: DeskConfig; index: number } {
  const c = desk.cues[i]
  if (c === undefined) return { desk, index: i }
  const name = `${c.name} copy`
  const copy: DeskCue = clean({ ...structuredClone(c), id: idFromName(c.id, ids(desk), avoid), name, section: undefined })
  return addCue(desk, copy, i + 1)
}

/** Remove cue `i`; the index to select next (the row that took its place, or the one above). */
export function deleteCue(desk: DeskConfig, i: number): { desk: DeskConfig; index: number | null } {
  if (desk.cues[i] === undefined) return { desk, index: null }
  const cues = desk.cues.filter((_, k) => k !== i)
  return { desk: { ...desk, cues }, index: cues.length === 0 ? null : Math.min(i, cues.length - 1) }
}

function move<T>(list: readonly T[], i: number, delta: number): { list: T[]; index: number } {
  const j = i + delta
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return { list: [...list], index: i }
  const out = [...list]
  const [x] = out.splice(i, 1)
  out.splice(j, 0, x!)
  return { list: out, index: j }
}

/** Move cue `i` up (−1) or down (+1). */
export function moveCue(desk: DeskConfig, i: number, delta: number): { desk: DeskConfig; index: number } {
  const { list, index } = move(desk.cues, i, delta)
  return { desk: { ...desk, cues: list }, index }
}

/** The cue fields an inspector edits (`undefined` or blank text clears an optional one). */
export type CuePatch = Partial<Pick<DeskCue, 'id' | 'number' | 'name' | 'section' | 'notes' | 'done'>>

/** Set cue `i`'s fields. */
export function setCue(desk: DeskConfig, i: number, patch: CuePatch): DeskConfig {
  const c = desk.cues[i]
  if (c === undefined) return desk
  const next: DeskCue = { ...c }
  for (const [k, v] of Object.entries(patch) as Array<[keyof CuePatch, string | undefined]>) {
    if (k === 'id' || k === 'name') next[k] = v ?? ''
    else if (v === undefined || v.trim() === '') delete next[k]
    else next[k] = v
  }
  return { ...desk, cues: desk.cues.map((x, k) => (k === i ? next : x)) }
}

// ---------------------------------------------------------------------------
// Steps.

const first = <T>(xs: readonly T[] | undefined): T | undefined => (xs !== undefined && xs.length > 0 ? xs[0] : undefined)

/** A new step of `kind`, with defaults off the house (the first sound, look,
 *  fixture, room or story event it knows). */
export function newStep(kind: DeskStepKind, house: DeskHouseLike = {}): DeskStep {
  switch (kind) {
    case 'sound':
      return { kind, sound: first(house.sounds)?.name ?? 'sound_name' }
    case 'say':
      return { kind, text: 'The show begins in five minutes.' }
    case 'look':
      return { kind, look: first(house.looks)?.name ?? 'look_name' }
    case 'light':
      return { kind, to: [first(house.fixtures)?.id ?? 'everywhere'], set: { state: 'ON', brightness: 254 } }
    case 'stop':
      return { kind }
    case 'event':
      return { kind, event: first(house.events) ?? 'my_event' }
    case 'speech':
      return { kind, room: first(house.rooms) ?? 'Room', max: DESK_SPEECH_MS }
    case 'wait':
      return { kind, ms: 1000 }
  }
}

function withSteps(desk: DeskConfig, ci: number, f: (steps: DeskStep[]) => DeskStep[]): DeskConfig {
  const c = desk.cues[ci]
  if (c === undefined) return desk
  return { ...desk, cues: desk.cues.map((x, k) => (k === ci ? { ...x, steps: f(x.steps) } : x)) }
}

/** Add `step` to cue `ci` at `at` (default: the end). */
export function addStep(desk: DeskConfig, ci: number, step: DeskStep, at?: number): { desk: DeskConfig; index: number } {
  const n = desk.cues[ci]?.steps.length ?? 0
  const i = Math.max(0, Math.min(at ?? n, n))
  return { desk: withSteps(desk, ci, (s) => [...s.slice(0, i), step, ...s.slice(i)]), index: i }
}

/** A copy of step `si` right after it, starting with it. */
export function duplicateStep(desk: DeskConfig, ci: number, si: number): { desk: DeskConfig; index: number } {
  const s = desk.cues[ci]?.steps[si]
  if (s === undefined) return { desk, index: si }
  return addStep(desk, ci, { ...structuredClone(s), start: 'with' }, si + 1)
}

/** Remove step `si`; the step to select next (or null). */
export function deleteStep(desk: DeskConfig, ci: number, si: number): { desk: DeskConfig; index: number | null } {
  const steps = desk.cues[ci]?.steps
  if (steps === undefined || steps[si] === undefined) return { desk, index: null }
  const left = steps.length - 1
  return { desk: withSteps(desk, ci, (s) => s.filter((_, k) => k !== si)), index: left === 0 ? null : Math.min(si, left - 1) }
}

/** Move step `si` up (−1) or down (+1). */
export function moveStep(desk: DeskConfig, ci: number, si: number, delta: number): { desk: DeskConfig; index: number } {
  const steps = desk.cues[ci]?.steps ?? []
  const { list, index } = move(steps, si, delta)
  return { desk: withSteps(desk, ci, () => list), index }
}

/** Set step `si`'s fields (`undefined` clears an optional one). The patch is
 *  the step's own shape; a kind change goes through `setStepKind`. */
export function setStep(desk: DeskConfig, ci: number, si: number, patch: Record<string, unknown>): DeskConfig {
  return withSteps(desk, ci, (steps) =>
    steps.map((s, k) => {
      if (k !== si) return s
      const { kind: _kind, ...rest } = patch
      return clean({ ...s, ...rest }) as DeskStep
    }),
  )
}

/** Turn step `si` into a `kind` step (its defaults off the house), keeping
 *  how it starts, its wait and its note. */
export function setStepKind(desk: DeskConfig, ci: number, si: number, kind: DeskStepKind, house: DeskHouseLike = {}): DeskConfig {
  return withSteps(desk, ci, (steps) =>
    steps.map((s, k) => {
      if (k !== si || s.kind === kind) return s
      return clean({ ...newStep(kind, house), start: s.start, wait: s.wait, note: s.note }) as DeskStep
    }),
  )
}

/** Start step `si` with the step before it (parallel) or after its group (series). */
export function setStepStart(desk: DeskConfig, ci: number, si: number, withPrevious: boolean): DeskConfig {
  return setStep(desk, ci, si, { start: withPrevious ? 'with' : undefined })
}

/** Two desks hold the same cues (the draft is clean). */
export function sameDesk(a: DeskConfig, b: DeskConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
