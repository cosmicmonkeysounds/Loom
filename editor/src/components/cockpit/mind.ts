//! The Mind page's pure logic: how a worker's trace (thoughts) and its
//! mirrored mind (arc, drives, policy, revisions) become rows, segments,
//! and sparklines. No React here — `MindTab.tsx` renders these.

import type { AgentMindSummary, AgentThought } from '@loom/core/views'

/** The kinds of thought a worker records, with how the page labels them.
 *  Colours are the reference dark palette's categorical slots, in fixed
 *  order (voice / lookup / reflect / survey / rerun); markers (reset /
 *  control / error) are neutral ink — they are not a series. Every badge
 *  also carries its label text, so identity is never colour-alone. */
export const KIND_META: Record<AgentThought['kind'], { label: string; who: 'voice' | 'mind' | 'marker'; color: string }> = {
  voice: { label: 'voice', who: 'voice', color: '#3987e5' },
  lookup: { label: 'lookup', who: 'voice', color: '#d95926' },
  reflect: { label: 'reflect', who: 'mind', color: '#199e70' },
  survey: { label: 'survey', who: 'mind', color: '#c98500' },
  rerun: { label: 're-run', who: 'mind', color: '#d55181' },
  reset: { label: 'reset', who: 'marker', color: '#a1a1aa' },
  control: { label: 'control', who: 'marker', color: '#a1a1aa' },
  error: { label: 'error', who: 'marker', color: '#a1a1aa' },
}

export const ALL_KINDS = Object.keys(KIND_META) as AgentThought['kind'][]

/** One line for the trace list: what this thought amounted to. */
export function summarizeThought(t: AgentThought): string {
  if (t.error !== null && t.error !== '') return `✗ ${t.error}`
  switch (t.kind) {
    case 'voice':
    case 'lookup': {
      const r = t.result ?? {}
      const say = typeof r['say'] === 'string' ? r['say'] : ''
      const lookup = Array.isArray(r['lookup']) ? (r['lookup'] as unknown[]).filter((x): x is string => typeof x === 'string') : []
      const acts = Array.isArray(r['acts']) ? (r['acts'] as Array<Record<string, unknown>>) : []
      const adjust = r['adjust'] !== null && typeof r['adjust'] === 'object' ? (r['adjust'] as Record<string, number>) : {}
      const parts: string[] = []
      if (say !== '') parts.push(`“${say.length > 120 ? `${say.slice(0, 117)}…` : say}”`)
      else if (lookup.length > 0) parts.push(`look up ${lookup.join(', ')}`)
      else parts.push('(silence)')
      const deltas = Object.entries(adjust)
        .filter(([, v]) => typeof v === 'number' && v !== 0)
        .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`)
      if (deltas.length > 0) parts.push(deltas.join(' '))
      if (acts.length > 0) parts.push(`ACT ${acts.map((a) => (typeof a['name'] === 'string' ? a['name'] : typeof a['entry'] === 'string' ? `share ${a['entry']}` : a['kind'])).join(', ')}`)
      return parts.join(' · ')
    }
    case 'reflect':
    case 'survey':
      return t.touched.length > 0 ? `updated ${t.touched.join(', ')}` : 'looked, changed nothing'
    case 'rerun':
      return t.note || 're-run'
    case 'reset':
    case 'control':
    case 'error':
      return t.note || t.trigger || t.kind
  }
}

export interface ThoughtFilter {
  character: string | null
  kinds: ReadonlySet<AgentThought['kind']>
  /** A speaker id, or null for everyone. */
  person: string | null
  /** Free text over summary / thinking / output. */
  query: string
}

export function filterThoughts(thoughts: AgentThought[], f: ThoughtFilter): AgentThought[] {
  const q = f.query.trim().toLowerCase()
  return thoughts.filter((t) => {
    if (f.character !== null && t.character !== f.character) return false
    if (!f.kinds.has(t.kind)) return false
    if (f.person !== null && t.speaker?.id !== f.person) return false
    if (q !== '' && !(summarizeThought(t).toLowerCase().includes(q) || t.thinking.toLowerCase().includes(q) || t.output.toLowerCase().includes(q))) return false
    return true
  })
}

/** The people who spoke to a character across the trace (for the filter). */
export function speakersOf(thoughts: AgentThought[], character: string | null): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>()
  for (const t of thoughts) {
    if (character !== null && t.character !== character) continue
    if (t.speaker !== null && t.speaker.id !== '' && !seen.has(t.speaker.id)) seen.set(t.speaker.id, t.speaker.name || t.speaker.id)
  }
  return [...seen].map(([id, name]) => ({ id, name }))
}

export interface DriveSeries {
  name: string
  /** Oldest first, ending on the current value. */
  values: number[]
  current: number
  /** Change since the first recorded revision. */
  delta: number
}

/** Each declared drive's path through the night, read off the revision
 *  log (every revision snapshots the drives) and ending on the live value. */
export function driveSeries(mind: AgentMindSummary): DriveSeries[] {
  return Object.entries(mind.drives).map(([name, current]) => {
    const values = mind.revisions.map((r) => r.drives[name]).filter((v): v is number => typeof v === 'number')
    if (values.length === 0 || values[values.length - 1] !== current) values.push(current)
    return { name, values, current, delta: current - values[0]! }
  })
}

/** An SVG path for a sparkline over `values` (0–100 unless `max` given). */
export function sparklinePath(values: number[], width: number, height: number, max = 100): string {
  if (values.length === 0) return ''
  const pad = 1
  const w = Math.max(1, width - pad * 2)
  const h = Math.max(1, height - pad * 2)
  const step = values.length > 1 ? w / (values.length - 1) : 0
  return values
    .map((v, i) => {
      const x = pad + (values.length > 1 ? i * step : w / 2)
      const y = pad + h - (Math.max(0, Math.min(max, v)) / max) * h
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

export interface StageSegment {
  stage: string
  state: 'past' | 'current' | 'future' | 'free'
  /** When the character entered it (from the history), unix seconds. */
  at: number | null
  why: string
}

/** The declared arc as a stepper: what's behind, where he is, what's
 *  ahead. A mind with no declared stages but a free-form stage shows it
 *  alone. */
export function stageSegments(mind: AgentMindSummary): StageSegment[] {
  const entered = new Map<string, { at: number; why: string }>()
  for (const h of mind.stageHistory) entered.set(h.stage, { at: h.at, why: h.why })
  if (mind.stages.length === 0) {
    return mind.stage === '' ? [] : [{ stage: mind.stage, state: 'free', at: entered.get(mind.stage)?.at ?? (mind.stageSince || null), why: entered.get(mind.stage)?.why ?? '' }]
  }
  const cur = mind.stages.indexOf(mind.stage)
  return mind.stages.map((stage, i) => ({
    stage,
    state: cur === -1 ? (i === 0 ? 'current' : 'future') : i < cur ? 'past' : i === cur ? 'current' : 'future',
    at: entered.get(stage)?.at ?? (i === 0 ? (mind.stageSince || null) : null),
    why: entered.get(stage)?.why ?? '',
  }))
}

export interface DiffRow {
  field: string
  /** `+` added / `−` dropped / `→` changed. */
  sign: '+' | '−' | '→'
  text: string
}

const isPair = (v: unknown): v is [unknown, unknown] => Array.isArray(v) && v.length === 2

/** Flatten a thought's mind diff (`Mind.diff` on the worker) into rows. */
export function diffRows(diff: Record<string, unknown>): DiffRow[] {
  const out: DiffRow[] = []
  const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : JSON.stringify(v))
  for (const [field, value] of Object.entries(diff)) {
    if (field === 'drives' && value !== null && typeof value === 'object') {
      for (const [name, pair] of Object.entries(value as Record<string, unknown>)) if (isPair(pair)) out.push({ field: `drive ${name}`, sign: '→', text: `${str(pair[0])} → ${str(pair[1])}` })
    } else if (field === 'people' && value !== null && typeof value === 'object') {
      for (const [pid, change] of Object.entries(value as Record<string, Record<string, unknown>>)) {
        const who = typeof change['name'] === 'string' ? change['name'] : pid
        if (change['added'] !== undefined) out.push({ field: `file on ${who}`, sign: '+', text: 'opened' })
        else if (change['dropped'] === true) out.push({ field: `file on ${who}`, sign: '−', text: 'forgotten' })
        else {
          for (const [k, v] of Object.entries(change)) {
            if (k === 'name') continue
            if (isPair(v)) out.push({ field: `${who} · ${k}`, sign: '→', text: `${str(v[0])} → ${str(v[1])}` })
            else if (v !== null && typeof v === 'object' && Array.isArray((v as Record<string, unknown>)['added']))
              for (const x of (v as Record<string, unknown[]>)['added']!) out.push({ field: `${who} · ${k}`, sign: '+', text: str(x) })
          }
        }
      }
    } else if (field === 'questions' && value !== null && typeof value === 'object') {
      for (const [q, change] of Object.entries(value as Record<string, Record<string, unknown>>)) {
        if (change['added'] === true) out.push({ field: 'question', sign: '+', text: q })
        else if (change['dropped'] === true) out.push({ field: 'question', sign: '−', text: q })
        for (const a of (Array.isArray(change['answers_added']) ? change['answers_added'] : Array.isArray(change['answers']) ? change['answers'] : []) as unknown[]) out.push({ field: `answer · ${q}`, sign: '+', text: str(a) })
      }
    } else if (field === 'threads' && value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out.push({ field: `thread ${k}`, sign: '→', text: str(v) })
    } else if (isPair(value)) {
      out.push({ field, sign: '→', text: field === 'policy' ? `${str(value[0])} → ${str(value[1])}` : `${str(value[0]) || '(empty)'} → ${str(value[1])}` })
    } else if (value !== null && typeof value === 'object') {
      const v = value as Record<string, unknown>
      for (const x of (Array.isArray(v['added']) ? v['added'] : []) as unknown[]) out.push({ field, sign: '+', text: str(x) })
      for (const x of (Array.isArray(v['dropped']) ? v['dropped'] : []) as unknown[]) out.push({ field, sign: '−', text: str(x) })
    }
  }
  return out
}

export function formatMs(ms: number): string {
  if (ms <= 0) return ''
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function timeOf(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return ''
  const ms = at > 1e12 ? at : at * 1000
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Which mind the page shows: the chosen one if it exists, else the first. */
export function pickMind(minds: AgentMindSummary[], chosen: string | null): AgentMindSummary | null {
  if (minds.length === 0) return null
  return minds.find((m) => m.character === chosen) ?? minds[0]!
}

/** The character names the page can switch between: every mirrored mind
 *  plus every character with thoughts in the trace. */
export function mindCharacters(minds: AgentMindSummary[], thoughts: AgentThought[]): string[] {
  const out = new Set<string>()
  for (const m of minds) out.add(m.character)
  for (const t of thoughts) out.add(t.character)
  return [...out].sort()
}
