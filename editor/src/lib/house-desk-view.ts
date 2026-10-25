//! Run → House: what the page draws, as pure functions over a `DeskView`
//! (wave 25, `docs/loom-house-desk.md` §6.1). The model itself (groups,
//! timelines, checks, chips) is `@loom/core/house-desk`; this file is the
//! editor's view on it: the refs and lengths off `house`, the cue rows, the
//! timeline bar, a cue's problems, and the page's keys.

import {
  cueEvents,
  cueTimeline,
  deskSections,
  secondsText,
  stepMs,
  stepText,
  type DeskConfig,
  type DeskCheckRow,
  type DeskCheckSection,
  type DeskCue,
  type DeskDurations,
  type DeskHouse,
  type DeskRefs,
  type DeskRun,
  type DeskView,
} from '@loom/core/house-desk'

/** What `validateDesk` checks a draft against, off the view's `house`. */
export function deskRefsOf(house: DeskHouse): DeskRefs {
  return {
    sounds: house.sounds.map((s) => s.name),
    looks: house.looks.map((l) => l.name),
    lightTargets: house.lightTargets,
    audioTargets: house.audioTargets,
    rooms: house.rooms,
    events: house.events,
  }
}

/** The planned lengths the house knows: a look's plan, a sound's file. */
export function deskDurationsOf(house: Pick<DeskHouse, 'looks' | 'sounds'> | null): DeskDurations {
  if (house === null) return {}
  const looks = new Map(house.looks.map((l) => [l.name, l.loop ? 0 : l.ms]))
  const sounds = new Map(house.sounds.map((s) => [s.name, s.ms]))
  return { lookMs: (n) => looks.get(n) ?? null, soundMs: (n) => sounds.get(n) ?? null }
}

/** A cue's planned length in words: "4.5 s", "≥ 2 s" (a step's length is
 *  only known once it plays), "—" (nothing known), "0 s" (no steps). */
export function plannedText(cue: Pick<DeskCue, 'steps'>, d: DeskDurations): string {
  const t = cueTimeline(cue, d)
  if (t.end !== null) return secondsText(t.end)
  // A lower bound: treat each unknown length as nothing.
  const floor = cueTimeline(cue, { lookMs: (n) => d.lookMs?.(n) ?? 0, soundMs: (n) => d.soundMs?.(n) ?? 0 })
  const known = floor.steps.reduce((m, s) => Math.max(m, s.end ?? s.start ?? 0), 0)
  return known > 0 ? `≥ ${secondsText(known)}` : '—'
}

/** One line for a cue: its steps' summaries, the first `max`, then "+N". */
export function cueSummary(cue: Pick<DeskCue, 'steps'>, max = 3): string {
  if (cue.steps.length === 0) return 'no steps'
  const parts = cue.steps.slice(0, max).map(stepText)
  return cue.steps.length > max ? `${parts.join(' · ')} · +${cue.steps.length - max}` : parts.join(' · ')
}

/** The run to show beside a cue: a running one first, else the newest ended one. */
export function runOf(runs: readonly DeskRun[], cue: string): DeskRun | null {
  return runs.find((r) => r.cue === cue && r.state === 'running') ?? runs.find((r) => r.cue === cue) ?? null
}

export interface CueRow {
  cue: DeskCue
  /** The cue's index in the desk. */
  index: number
  standby: boolean
  summary: string
  planned: string
  events: string[]
  run: DeskRun | null
}

/** The cue list under its sections, each row ready to draw. */
export function cueRows(desk: DeskConfig, view: Pick<DeskView, 'standby' | 'runs'> | null, d: DeskDurations): Array<{ title: string | null; rows: CueRow[] }> {
  const index = new Map(desk.cues.map((c, i) => [c, i]))
  return deskSections(desk).map((s) => ({
    title: s.title,
    rows: s.cues.map((cue) => ({
      cue,
      index: index.get(cue) ?? -1,
      standby: view?.standby === cue.id,
      summary: cueSummary(cue),
      planned: plannedText(cue, d),
      events: cueEvents(cue),
      run: view === null ? null : runOf(view.runs, cue.id),
    })),
  }))
}

/** The runs still running, newest first (as the server lists them). */
export function runningRuns(runs: readonly DeskRun[]): DeskRun[] {
  return runs.filter((r) => r.state === 'running')
}

export interface TimelineBar {
  i: number
  /** 0–100 (% of the drawn span). */
  left: number
  width: number
  /** The step's length isn't known before it plays (drawn open-ended). */
  open: boolean
}

/** The inspector's timeline bar: each step as a span of the cue. A step of
 *  unknown length gets a nominal `openMs` so it still shows. */
export function timelineBars(cue: Pick<DeskCue, 'steps'>, d: DeskDurations, openMs = 2000): { bars: TimelineBar[]; span: number } {
  const open = new Set<number>()
  cue.steps.forEach((s, i) => {
    if (stepMs(s, d) === null) open.add(i)
  })
  const filled: DeskDurations = { lookMs: (n) => d.lookMs?.(n) ?? openMs, soundMs: (n) => d.soundMs?.(n) ?? openMs }
  // A say / speech with no length: plan it as `openMs`.
  const steps = cue.steps.map((s, i) => (open.has(i) && (s.kind === 'say' || s.kind === 'speech') ? ({ kind: 'wait', ms: openMs, start: s.start, wait: s.wait } as const) : s))
  const t = cueTimeline({ steps }, filled)
  const span = Math.max(1, t.end ?? 0, ...t.steps.map((s) => s.end ?? 0))
  const minW = 1.5
  const bars = t.steps.map((s) => {
    const start = s.start ?? 0
    const end = s.end ?? start
    return { i: s.i, left: (start / span) * 100, width: Math.max(minW, ((end - start) / span) * 100), open: open.has(s.i) }
  })
  return { bars, span }
}

/** A cue's own problems and warnings out of `validateDesk`'s lists, split into
 *  the cue's and each step's (by step index). */
export function cueIssues(
  messages: readonly string[],
  cue: Pick<DeskCue, 'id'>,
  index: number,
): { cue: string[]; steps: Map<number, string[]> } {
  const out = { cue: [] as string[], steps: new Map<number, string[]>() }
  const heads = [`cue ${cue.id}`, `cues[${index}]`]
  for (const m of messages) {
    const head = heads.find((h) => m.startsWith(h))
    if (head === undefined) continue
    const rest = m.slice(head.length)
    const step = /^ step (\d+)(?=[: ])/u.exec(rest)
    if (step !== null) {
      const i = Number(step[1]) - 1
      const text = rest.slice(step[0].length).replace(/^:\s*/u, '').trim()
      out.steps.set(i, [...(out.steps.get(i) ?? []), text])
    } else if (rest.startsWith(':') || rest.startsWith(' ')) out.cue.push(rest.replace(/^:\s*/u, '').trim())
  }
  return out
}

/** Problems that name no cue (the desk as a whole). */
export function deskWideIssues(messages: readonly string[]): string[] {
  return messages.filter((m) => !/^(cue |cues\[)/u.test(m))
}

/** The source line under the status strip. */
export function sourceText(source: DeskView['source']): string {
  switch (source) {
    case 'director':
      return 'A director’s save for this event (not in the project yet)'
    case 'project':
      return 'The project’s desk.json'
    case 'default':
      return 'No desk.json yet: an empty cue list'
  }
}

/** A run's state for one step, in a word or a glyph. */
export function stepStateGlyph(state: DeskRun['steps'][number]['state']): string {
  switch (state) {
    case 'pending':
      return '·'
    case 'waiting':
      return '…'
    case 'running':
      return '▶'
    case 'ended':
      return '✓'
    case 'skipped':
      return '–'
  }
}

// ---------------------------------------------------------------------------
// The checks' cursor.

/** The row the checks' keys act on: `key`'s row, else the first open one,
 *  else the first row (null: nothing to check). */
export function checkCursor(sections: readonly DeskCheckSection[], key: string | null): DeskCheckRow | null {
  const rows = sections.flatMap((s) => s.rows)
  return rows.find((r) => r.key === key) ?? rows.find((r) => r.mark === null) ?? rows[0] ?? null
}

/** The row `delta` rows from `key` (clamped), or null when there are none. */
export function checkStep(sections: readonly DeskCheckSection[], key: string | null, delta: -1 | 1): DeskCheckRow | null {
  const rows = sections.flatMap((s) => s.rows)
  if (rows.length === 0) return null
  const at = rows.findIndex((r) => r.key === key)
  const to = at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + delta))
  return rows[to]!
}

// ---------------------------------------------------------------------------
// Keys.

/** Which side of the page the keys drive: the cue list or the checks. */
export type DeskPane = 'cues' | 'checks'

export type DeskKeyAction =
  | { kind: 'go' }
  | { kind: 'stop' }
  | { kind: 'standby'; delta: -1 | 1 }
  | { kind: 'test' }
  | { kind: 'mark'; mark: 'ok' | 'bad' }
  | { kind: 'check'; delta: -1 | 1 }
  | { kind: 'next-open' }

export interface DeskKey {
  key: string
  /** The focused element's tag (upper case, as the DOM gives it) and whether it is editable. */
  tag?: string
  editable?: boolean
  meta?: boolean
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  repeat?: boolean
}

/** What a key does on the House page, or null (typing, a modifier, a dialog
 *  open, or a key the page doesn't use). Space GOs and ↑ / ↓ move the
 *  playhead in the cue list; T / Y / N and ↓ / ↑ walk the checks; Esc stops
 *  the running cues on either side. */
export function deskKeyAction(e: DeskKey, pane: DeskPane, dialogOpen = false): DeskKeyAction | null {
  if (dialogOpen || e.meta === true || e.ctrl === true || e.alt === true) return null
  const tag = (e.tag ?? '').toUpperCase()
  if (e.editable === true || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null
  if (e.key === 'Escape') return { kind: 'stop' }
  if (pane === 'cues') {
    if (e.key === ' ' || e.key === 'Spacebar') return e.repeat === true ? null : { kind: 'go' }
    if (e.key === 'ArrowUp') return { kind: 'standby', delta: -1 }
    if (e.key === 'ArrowDown') return { kind: 'standby', delta: 1 }
    return null
  }
  if (e.repeat === true) return null
  switch (e.key.toLowerCase()) {
    case 't':
      return { kind: 'test' }
    case 'y':
      return { kind: 'mark', mark: 'ok' }
    case 'n':
      return { kind: 'mark', mark: 'bad' }
    case 'arrowdown':
      return { kind: 'next-open' }
    case 'arrowup':
      return { kind: 'check', delta: -1 }
  }
  return null
}

/** The playhead `delta` cues from `standby` (null: past the end). Off the
 *  top it stays on the first cue; down from the end stays at the end. */
export function movePlayhead(desk: DeskConfig, standby: string | null, delta: -1 | 1): string | null {
  const n = desk.cues.length
  if (n === 0) return null
  const at = standby === null ? n : desk.cues.findIndex((c) => c.id === standby)
  const from = at < 0 ? (delta > 0 ? -1 : n) : at
  const to = Math.max(0, Math.min(n, from + delta))
  return to >= n ? null : desk.cues[to]!.id
}
