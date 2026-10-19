//! The Mind page's pure logic: how a worker's trace (thoughts) and its
//! mirrored mind (arc, drives, policy, revisions) become rows, segments,
//! and sparklines. No React here — `MindTab.tsx` renders these.

import type { AgentMindSummary, AgentThought } from '@loom/core/views'
import type { AgentQueue, CastSummary, FactVerdict, FactsFiling, FactsView, WorldEntry } from '@/store/cockpit'

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

// ---------------------------------------------------------------------------
// Judging — the facts judge's card (Wave 4, lane B; decision U10)
// ---------------------------------------------------------------------------

export type JudgeMode = 'auto' | 'review'

/** The world path the mode is read from when the view names none. */
export const DEFAULT_JUDGE_MODE_VAR = 'Night.judge_mode'

/** The judging mode: the view's own reading first, else the mode var on
 *  the world (`review` exactly), else `auto`. */
export function judgeModeOf(world: WorldEntry[], facts: FactsView | null): JudgeMode {
  if (facts !== null) return facts.mode === 'review' ? 'review' : 'auto'
  const path = DEFAULT_JUDGE_MODE_VAR
  return world.find((w) => w.path === path)?.value === 'review' ? 'review' : 'auto'
}

/** One filing awaiting a verdict (review mode, or a near miss in auto). */
export interface JudgingRow {
  person: string
  name: string
  question: string
  answer: string
  confidence: number
  /** The judge's proposal. */
  proposed: FactVerdict
  final: string | null
  at: number
  /** Wave 11 C6: the answer is a near miss of this key answer (a typo, a
   *  plural, digits for words) — the judge held it for a director instead
   *  of calling it a lie or a guess. Null for any other filing. */
  near: string | null
}

/** A filing's near-miss key (`near: {key}`, wave 11 C6; the server sets it
 *  on a pending filing), else null — an older server sends none. */
export function nearKeyOf(f: FactsFiling): string | null {
  const near = (f as FactsFiling & { near?: unknown }).near
  if (near === null || typeof near !== 'object') return null
  const key = (near as { key?: unknown }).key
  return typeof key === 'string' && key.trim() !== '' ? key : null
}

/** Every filing with no `final` yet, oldest first (ties keep the ledger's
 *  question order). */
export function pendingFilings(facts: FactsView): JudgingRow[] {
  const rows: JudgingRow[] = []
  for (const q of facts.questions) {
    for (const f of q.filings) {
      if (f.final !== null) continue
      rows.push({ person: f.person, name: f.name, question: f.question, answer: f.answer, confidence: f.confidence, proposed: f.verdict, final: f.final, at: f.at, near: nearKeyOf(f) })
    }
  }
  return rows.sort((a, b) => a.at - b.at)
}

/** How many filings wait as near misses: the view's own `near` count when
 *  a server sends one, else the pending filings carrying a near key. */
export function nearCount(facts: FactsView): number {
  const n = (facts as FactsView & { near?: unknown }).near
  if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return n
  return pendingFilings(facts).filter((r) => r.near !== null).length
}

export interface QuestionTally {
  id: string
  round: number | null
  text: string
  filed: number
  accurate: number
  lie: number
  uncertain: number
  pending: number
  /** U11: every filing matches the key and every confidence is 100. */
  consensus: boolean
}

/** The per-question tally table. */
export function questionTallies(facts: FactsView): QuestionTally[] {
  return facts.questions.map((q) => ({
    id: q.id,
    round: q.round,
    text: q.text,
    filed: q.tally.filed,
    accurate: q.tally.accurate,
    lie: q.tally.lie,
    uncertain: q.tally.uncertain,
    pending: q.filings.filter((f) => f.final === null).length,
    consensus: q.tally.consensus,
  }))
}

/** How a filing got its outcome (SW-ADM-13; wave 5 issue 8): the server's
 *  `FactsFiling.how` — `auto` (the judge's verdict stood at filing),
 *  `confirmed` / `overridden` (a confirm event — the Run card's or a
 *  booth's 📝 buttons — kept / changed the proposal), `settled` (a reveal
 *  took a review-mode proposal), `marked` (a guess marked at a reveal) —
 *  or `pending`. `kept` / `overridden` is the fallback for an older server
 *  that sends no `how`: it compares final with the proposal only (never the
 *  mode in force now, which would relabel old filings). */
export type FilingHow = 'auto' | 'confirmed' | 'overridden' | 'settled' | 'marked' | 'pending' | 'kept'

export interface FilingRow {
  person: string
  name: string
  answer: string
  confidence: number
  proposed: FactVerdict
  final: string | null
  how: FilingHow
  /** Who confirmed / overrode / settled it (a director, a booth's
   *  character); null for `auto`, a story clock, or an older server. */
  by: string | null
  /** When the server first saw the filing — a restart re-stamps every one. */
  at: number
  /** The key answer it nearly matched (wave 11 C6), else null. */
  near: string | null
}

/** One question's filings, oldest first, for the provenance rows under the
 *  tally table. Empty for an unknown question. */
export function questionFilings(facts: FactsView, id: string): FilingRow[] {
  const q = facts.questions.find((x) => x.id === id)
  if (q === undefined) return []
  const howOf = (f: (typeof q.filings)[number]): FilingHow => {
    if (f.final === null) return 'pending'
    if (f.how != null) return f.how
    if (f.final === 'marked') return 'marked'
    return f.final === f.verdict ? 'kept' : 'overridden'
  }
  return q.filings
    .map((f) => ({ person: f.person, name: f.name, answer: f.answer, confidence: f.confidence, proposed: f.verdict, final: f.final, how: howOf(f), by: f.by ?? null, at: f.at, near: nearKeyOf(f) }))
    .sort((a, b) => a.at - b.at)
}

/** The story event the Run card fires to confirm / override a filing as
 *  `verdict` (`facts.json` `judge.confirm`); null when the view names none. */
export function confirmEvent(facts: FactsView, verdict: FactVerdict): string | null {
  const name = facts.confirm?.[verdict]
  return typeof name === 'string' && name !== '' ? name : null
}

/** The verdict buttons on a filing (pending or judged), in order, with
 *  their glyphs. */
export const VERDICT_BUTTONS: ReadonlyArray<{ verdict: FactVerdict; glyph: string; label: string }> = [
  { verdict: 'accurate', glyph: '✅', label: 'accurate' },
  { verdict: 'lie', glyph: '😤', label: 'confident lie' },
  { verdict: 'uncertain', glyph: '🤷', label: 'uncertain' },
]

/** One verdict button on a filing row of the who-filed-what table. */
export interface FilingButton {
  verdict: FactVerdict
  glyph: string
  label: string
  /** The verdict the filing reads now (its final, else the proposal) —
   *  outlined, so a director sees what a press would change. */
  current: boolean
  /** No confirm event for this verdict in `facts.json`. */
  disabled: boolean
  title: string
}

/** Wave 9 D5: the ✅ / 😤 / 🤷 buttons on one filing row — on every row in
 *  both modes, so an auto-mode verdict the key got wrong (a phrasing it did
 *  not know) is one tap to fix. A `marked` filing is closed (a guess marked
 *  at the round's reveal — the story answers "no open filing"), so it
 *  offers none. The story honours the override by question
 *  (`fact_accurate` / `fact_lie` / `fact_uncertain` with `question:`). */
export function filingButtons(facts: FactsView, row: Pick<FilingRow, 'final' | 'proposed' | 'how'>): FilingButton[] {
  if (row.how === 'marked' || row.final === 'marked') return []
  const now = row.final ?? row.proposed
  return VERDICT_BUTTONS.map((b) => {
    const current = b.verdict === now
    const title =
      row.final === null
        ? `${b.verdict === row.proposed ? 'Confirm' : 'Override'}: ${b.label}`
        : current
          ? `Judged ${b.label} — already on record`
          : `Override: ${b.label} (judged ${row.final})`
    return { ...b, current, disabled: confirmEvent(facts, b.verdict) === null, title }
  })
}

/** The story call a verdict button makes for one filing: the confirm event,
 *  on the filer, with the question named — so it judges that filing, never
 *  the program's latest one. Null when `facts.json` names no event. */
export function verdictCall(facts: FactsView, row: { person: string; question: string }, verdict: FactVerdict): { event: string; person: string; args: { question: string } } | null {
  const event = confirmEvent(facts, verdict)
  if (event === null) return null
  return { event, person: row.person, args: { question: row.question } }
}

// ---------------------------------------------------------------------------
// Trabolta's queue (wave 11 C6): depth, oldest wait, a stalled worker
// ---------------------------------------------------------------------------

/** A wait worth a director's eye: the story's busy line goes out at 40 s. */
export const QUEUE_SLOW_MS = 40_000

const isQueue = (v: unknown): v is AgentQueue =>
  v !== null &&
  typeof v === 'object' &&
  typeof (v as AgentQueue).depth === 'number' &&
  ((v as AgentQueue).oldestMs === null || typeof (v as AgentQueue).oldestMs === 'number') &&
  typeof (v as AgentQueue).stalled === 'boolean'

/** A character's request queue: the cast row's `agentQueue`, else the mind
 *  summary's (C6 allows either); null on an older server. With `now`, a
 *  waiting queue's `oldestMs` is aged by the time since it arrived
 *  (`receivedAt`): the server works it out at send time, and a quiet
 *  stretch sends no new snapshot. */
export function agentQueueOf(character: string, cast: readonly CastSummary[], minds: readonly AgentMindSummary[], now?: number): AgentQueue | null {
  const c = cast.find((x) => x.id === character)?.agentQueue
  if (isQueue(c)) return aged(c, now)
  const m = (minds.find((x) => x.character === character) as (AgentMindSummary & { agentQueue?: unknown }) | undefined)?.agentQueue
  return isQueue(m) ? aged(m, now) : null
}

function aged(q: AgentQueue, now: number | undefined): AgentQueue {
  if (now === undefined || q.receivedAt === undefined || q.oldestMs === null || q.depth === 0) return q
  return { ...q, oldestMs: q.oldestMs + Math.max(0, now - q.receivedAt) }
}

/** `1:20` — a wait in minutes and seconds. */
export function waitText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const QueueTone = { Idle: 'idle', Waiting: 'waiting', Slow: 'slow', Stalled: 'stalled' } as const
export type QueueTone = (typeof QueueTone)[keyof typeof QueueTone]

/** The queue badge: `queue 0`, `3 waiting · oldest 0:12`, ⚠ slow past the
 *  busy line's 40 s, ⛔ stalled (the worker's head request went unanswered
 *  > 60 s: no new dispatch until it answers or reconnects). */
export function queueBadge(q: AgentQueue): { text: string; tone: QueueTone; title: string } {
  const oldest = q.oldestMs !== null && q.oldestMs > 0 ? ` · oldest ${waitText(q.oldestMs)}` : ''
  if (q.stalled) {
    return { text: `⛔ stalled · ${q.depth} waiting${oldest}`, tone: QueueTone.Stalled, title: 'The worker stopped answering (a request unanswered over a minute). Nothing new is sent to it; every waiting guest got the hold line once. It clears on its next reply or a reconnect — restart the worker, or answer from the performer lens.' }
  }
  if (q.depth === 0) return { text: 'queue empty', tone: QueueTone.Idle, title: 'No conversation is waiting for a reply.' }
  const slow = q.oldestMs !== null && q.oldestMs >= QUEUE_SLOW_MS
  return {
    text: `${slow ? '⚠ ' : ''}${q.depth} waiting${oldest}`,
    tone: slow ? QueueTone.Slow : QueueTone.Waiting,
    title: slow ? 'A guest has waited past the busy line (40 s): the worker is behind.' : 'Conversations waiting for the worker, oldest first.',
  }
}


/** The Judging card's mode button tooltip. Auto judges at once — except a
 *  near miss, which waits on the card for a director in either mode (C6). */
export function judgeModeTitle(mode: 'auto' | 'review'): string {
  return mode === 'auto'
    ? 'Every filed fact gets its verdict at once, except a near miss (a letter or a word from the key), which waits here for you'
    : 'Every verdict is a proposal until you (or a host) confirm it; a round closing settles the rest. A near miss waits here too.'
}
