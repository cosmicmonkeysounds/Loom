//! Run → House → Cue designer (wave 30), the pure side: the lights view off
//! the wire, where the story uses each look / sound / desk cue, the
//! library's rows, a look's timeline markers, and a desk cue built from a
//! sound. The page is `components/house/CueDesigner.tsx`; the store is
//! `store/cue-designer.ts`. Looks are edited with `@loom/house`'s own ops
//! (`look-edit.ts`), planned with `planLook` and drawn with `previewAt`, so
//! what the page shows is what the lights module plays.

import {
  LIGHT_COLOR_STEP_MIN_MS,
  defaultLights,
  effectivePeriod,
  lookMode,
  lookTargets,
  planLook,
  previewLength,
  resolveLightTargets,
  stepsOfLook,
  type HouseMap,
  type LightLook,
  type LightsConfig,
  type LookMode,
} from '@loom/house'
import { cueEvents, type DeskConfig, type DeskCue, type DeskHouse } from '@loom/core/house-desk'
import { addCue, addStep, newCue } from '@/lib/house-desk-edit'

// --- the wire: GET /api/mod/lights ------------------------------------------

/** The parts of the server's `LightsView` the designer reads. */
export interface DesignerLights {
  lights: LightsConfig
  version: string
  source: 'director' | 'project' | 'env' | 'default'
  /** Every story `cue X` that could be a look. */
  cued: string[]
  problems: string[]
  warnings: string[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
const SOURCES = ['director', 'project', 'env', 'default'] as const

/** A `GET /api/mod/lights` answer; null when it isn't one. Lists the server
 *  (or a hand-written file) left out are filled in. */
export function designerLightsOf(v: unknown): DesignerLights | null {
  if (!isRecord(v) || !isRecord(v['lights']) || typeof v['version'] !== 'string') return null
  const l = v['lights']
  const lights: LightsConfig = {
    ...(l as unknown as LightsConfig),
    version: 1,
    fixtures: Array.isArray(l['fixtures']) ? (l['fixtures'] as LightsConfig['fixtures']) : [],
    zones: Array.isArray(l['zones']) ? (l['zones'] as LightsConfig['zones']) : [],
    looks: isRecord(l['looks']) ? (l['looks'] as LightsConfig['looks']) : {},
  }
  return {
    lights,
    version: v['version'],
    source: SOURCES.find((s) => s === v['source']) ?? 'default',
    cued: strings(v['looks']),
    problems: strings(v['problems']),
    warnings: strings(v['warnings']),
  }
}

export const emptyDesignerLights = (): DesignerLights => ({ lights: defaultLights(), version: '', source: 'default', cued: [], problems: [], warnings: [] })

// --- the story: where it uses a name ----------------------------------------

/** One line of the story that names a look, a sound or a desk cue. */
export interface StoryUse {
  uri: string
  /** 0-based, as an LSP `Location`. */
  line: number
  character: number
  /** The line, trimmed. */
  text: string
}

export type StoryUseKind = 'cue' | 'sound' | 'when'

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The pattern a kind of use is found with: `cue X` / `sound X` as a
 *  statement (a line's first word), or a `when X:` header. */
function patternFor(kind: StoryUseKind, name: string): RegExp {
  const n = escapeRe(name)
  if (kind === 'when') return new RegExp(`^(\\s*)when\\s+${n}\\s*:`, 'i')
  return new RegExp(`^(\\s*)${kind}\\s+${n}(?![A-Za-z0-9_-])`, 'i')
}

/** Every line in `docs` that uses `name` as a `kind` (comments skipped), in uri then line order. */
export function storyUses(docs: Iterable<{ uri: string; text: string }>, kind: StoryUseKind, name: string): StoryUse[] {
  if (name.trim() === '') return []
  const re = patternFor(kind, name)
  const out: StoryUse[] = []
  for (const d of [...docs].sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0))) {
    const lines = d.text.split('\n')
    lines.forEach((raw, i) => {
      const m = re.exec(raw)
      if (m !== null) out.push({ uri: d.uri, line: i, character: m[1]!.length, text: raw.trim() })
    })
  }
  return out
}

/** "main.loom:12" for a use (the last path segment). */
export function whereOf(u: Pick<StoryUse, 'uri' | 'line'>): string {
  const path = decodeURIComponent(u.uri.replace(/^[a-z]+:\/\//i, ''))
  return `${path.split('/').pop() ?? path}:${u.line + 1}`
}

/** The story statement that plays a look or a desk cue, and a sound. */
export const cueLine = (name: string): string => `cue ${name}`
export const soundLine = (name: string): string => `sound ${name}`
/** A `when` block that listens for a desk cue's event. */
export const whenBlock = (event: string): string => `when ${event}:\n  // what the story does when the desk says ${event}`

// --- the library ------------------------------------------------------------

export const MODE_LABEL: Record<LookMode, string> = { once: 'once', repeat: 'a few times', loop: 'until the next look', restore: 'once, then give the light back' }
export const MODE_GLYPH: Record<LookMode, string> = { once: '→', repeat: '×', loop: '↻', restore: '↩' }

export interface LookRow {
  name: string
  mode: LookMode
  /** Its planned length (ms), null for a loop. */
  ms: number | null
  /** How many story lines `cue` it. */
  uses: number
  /** The desk cues with a `look` step on it. */
  inDesk: string[]
  boot: boolean
  /** Edited and not saved. */
  dirty: boolean
  /** How many fixtures it reaches (0: it lights nothing). */
  reach: number
  problems: number
}

/** The desk cues that play `look`. */
export function deskCuesWithLook(desk: DeskConfig | null, look: string): string[] {
  return (desk?.cues ?? []).filter((c) => c.steps.some((s) => s.kind === 'look' && s.look === look)).map((c) => c.id)
}

/** The desk cues that play `sound`. */
export function deskCuesWithSound(desk: DeskConfig | null, sound: string): string[] {
  return (desk?.cues ?? []).filter((c) => c.steps.some((s) => s.kind === 'sound' && s.sound === sound)).map((c) => c.id)
}

/** The validation lines about one look ( `looks["x"]…` ). */
export function lookLines(lines: readonly string[], name: string): string[] {
  return lines.filter((l) => l.startsWith(`looks["${name}"]`))
}

export function lookRows(
  lights: LightsConfig,
  saved: LightsConfig | null,
  house: HouseMap | null,
  desk: DeskConfig | null,
  docs: ReadonlyArray<{ uri: string; text: string }>,
  problems: readonly string[],
): LookRow[] {
  return Object.keys(lights.looks)
    .sort()
    .map((name) => {
      const look = lights.looks[name]!
      const plan = planLook(lights, house, name)
      return {
        name,
        mode: lookMode(look),
        ms: plan === null ? null : previewLength(plan),
        uses: storyUses(docs, 'cue', name).length,
        inDesk: deskCuesWithLook(desk, name),
        boot: lights.boot === name,
        dirty: saved === null ? true : JSON.stringify(saved.looks[name]) !== JSON.stringify(look),
        reach: resolveLightTargets(lights, house, lookTargets(look)).fixtures.length,
        problems: lookLines(problems, name).length,
      }
    })
}

/** The story cues no look answers yet (minus the desk's own cue ids). */
export function unwrittenLooks(cued: readonly string[], lights: LightsConfig, desk: DeskConfig | null): string[] {
  const desks = new Set((desk?.cues ?? []).map((c) => c.id))
  return [...new Set(cued)].filter((n) => lights.looks[n] === undefined && !desks.has(n)).sort()
}

// --- a look's timeline --------------------------------------------------------

export interface StepMarker {
  index: number
  /** 0–1 across the drawn span. */
  x: number
  /** The fade's end, 0–1. */
  fadeTo: number
  /** The step's colour (null: it doesn't set one). */
  color: string | null
  /** 0–1 (null: it doesn't set brightness). */
  level: number | null
  off: boolean
}

/** How much time the look's timeline draws (ms): one pass and the wrap. */
export function lookSpan(look: LightLook): number {
  const steps = stepsOfLook(look)
  const last = steps.reduce((m, s) => Math.max(m, s.at + (s.set.transition ?? 0) * 1000), 0)
  const mode = lookMode(look)
  return Math.max(1000, mode === 'once' ? last + 500 : Math.max(last, effectivePeriod(look) + (mode === 'restore' ? 1000 : 0)))
}

export function stepMarkers(look: LightLook): { markers: StepMarker[]; span: number } {
  const span = lookSpan(look)
  const markers = stepsOfLook(look).map((s, index) => ({
    index,
    x: s.at / span,
    fadeTo: Math.min(1, (s.at + (s.set.transition ?? 0) * 1000) / span),
    color: s.set.color ?? (s.set.color_temp !== undefined ? '#ffe2b8' : null),
    level: s.set.state === 'OFF' ? 0 : s.set.brightness !== undefined ? s.set.brightness / 254 : null,
    off: s.set.state === 'OFF',
  }))
  return { markers, span }
}

/** Where a new step goes: past the last, with room for a colour change. */
export function nextStepAt(look: LightLook): number {
  const steps = stepsOfLook(look)
  if (steps.length === 0) return 0
  const last = Math.max(...steps.map((s) => s.at))
  return Math.ceil((last + LIGHT_COLOR_STEP_MIN_MS) / 100) * 100
}

// --- desk cues built from the designer ------------------------------------------

export interface SoundCueOptions {
  name?: string
  to?: string[]
  gain?: number
  /** A look to start with the sound (`with ↑`). */
  look?: string
  /** A story event fired once both have ended. */
  done?: string
}

/** A new desk cue that plays `sound` (and a look with it), at the end of the list. */
export function soundCue(desk: DeskConfig, sound: string, o: SoundCueOptions = {}, avoid: readonly string[] = []): { desk: DeskConfig; index: number; id: string } {
  const name = o.name?.trim() || sound.replace(/_/g, ' ')
  const cue = newCue(desk, name, avoid)
  if (o.done !== undefined && o.done.trim() !== '') cue.done = o.done.trim()
  let r = addCue(desk, cue)
  const ci = r.index
  const step: Record<string, unknown> = { kind: 'sound', sound }
  if (o.to !== undefined && o.to.length > 0) step['to'] = [...o.to]
  if (o.gain !== undefined && o.gain !== 0) step['gain'] = o.gain
  r = { desk: addStep(r.desk, ci, step as unknown as DeskCue['steps'][number]).desk, index: ci }
  if (o.look !== undefined && o.look !== '') r = { desk: addStep(r.desk, ci, { kind: 'look', look: o.look, start: 'with' }).desk, index: ci }
  return { desk: r.desk, index: ci, id: r.desk.cues[ci]!.id }
}

/** A new desk cue that plays a look (and nothing else), so the story can wait on its `done`. */
export function lookCue(desk: DeskConfig, look: string, avoid: readonly string[] = []): { desk: DeskConfig; index: number; id: string } {
  // The cue's id can never equal a look's name (`cue X` would play both).
  const name = `${look.replace(/_/g, ' ')} cue`
  const cue = newCue(desk, name, [...avoid, look])
  const r = addCue(desk, cue)
  const d = addStep(r.desk, r.index, { kind: 'look', look }).desk
  return { desk: d, index: r.index, id: d.cues[r.index]!.id }
}

/** What a desk cue tells the story, and whether the story listens. */
export function cueHooks(cue: DeskCue, house: Pick<DeskHouse, 'events'> | null): Array<{ event: string; heard: boolean }> {
  const heard = new Set((house?.events ?? []).map((e) => e.toLowerCase()))
  return cueEvents(cue).map((event) => ({ event, heard: heard.has(event.toLowerCase()) }))
}
