//! The Mind page's pure logic: how a worker's trace (thoughts) and its
//! mirrored mind (arc, drives, policy, revisions) become rows, segments,
//! and sparklines. No React here — `MindTab.tsx` renders these.

import type { AgentControl, AgentMindPerson, AgentMindSummary, AgentThought } from '@loom/core/views'
import type { AgentQueue, CastSummary, FactVerdict, FactsFiling, FactsView, WorldEntry } from '@/store/cockpit'

/** How the page labels one kind of thought. */
export interface KindMeta {
  label: string
  who: 'voice' | 'mind' | 'marker'
  color: string
}

/** The kinds of thought a worker records, with how the page labels them.
 *  Colours are the reference dark palette's categorical slots, in fixed
 *  order (voice / lookup / reflect / survey / rerun); markers (reset /
 *  control / error) are neutral ink — they are not a series. Every badge
 *  also carries its label text, so identity is never colour-alone.
 *
 *  Keyed by plain string (wave 12, CONTRACTS C6.7): a newer worker sends
 *  `brief` (a director's Rewrite brief) and `summary` (the quiet-
 *  conversation summary), which the base core types don't name yet, and a
 *  kind nobody knows still renders through `kindMeta`'s fallback. */
export const KIND_META: Record<string, KindMeta> = {
  voice: { label: 'voice', who: 'voice', color: '#3987e5' },
  lookup: { label: 'lookup', who: 'voice', color: '#d95926' },
  reflect: { label: 'reflect', who: 'mind', color: '#199e70' },
  survey: { label: 'survey', who: 'mind', color: '#c98500' },
  rerun: { label: 're-run', who: 'mind', color: '#d55181' },
  judge: { label: 'judge', who: 'voice', color: '#8a6fd8' },
  brief: { label: 'brief', who: 'mind', color: '#1fa3b5' },
  summary: { label: 'summary', who: 'mind', color: '#9e8a3a' },
  reset: { label: 'reset', who: 'marker', color: '#a1a1aa' },
  control: { label: 'control', who: 'marker', color: '#a1a1aa' },
  error: { label: 'error', who: 'marker', color: '#a1a1aa' },
}

export const ALL_KINDS: string[] = Object.keys(KIND_META)

/** The kinds only the story mind records (C6.7). */
const NEW_MIND_KINDS: ReadonlySet<string> = new Set(['brief', 'summary'])

/** The trace's filter chips: every kind an old worker had, plus the story
 *  mind's `brief` / `summary` only on a story-mind worker or once a loaded
 *  thought has that kind — so an old worker's trace reads as it always did. */
export function kindChips(thoughts: readonly AgentThought[], fresh: boolean): string[] {
  if (fresh) return ALL_KINDS
  const seen = new Set(thoughts.map((t) => t.kind as string))
  return ALL_KINDS.filter((k) => !NEW_MIND_KINDS.has(k) || seen.has(k))
}

/** A kind's label, falling back to the kind itself in neutral ink. */
export function kindMeta(kind: string): KindMeta {
  return KIND_META[kind] ?? { label: kind, who: 'mind', color: '#a1a1aa' }
}

const clip = (text: string, max = 120): string => (text.length > max ? `${text.slice(0, max - 3)}…` : text)

/** One line for the trace list: what this thought amounted to. */
export function summarizeThought(t: AgentThought): string {
  if (t.error !== null && t.error !== '') return `✗ ${t.error}`
  const kind: string = t.kind
  switch (kind) {
    case 'voice':
    case 'lookup': {
      const r = t.result ?? {}
      const say = typeof r['say'] === 'string' ? r['say'] : ''
      const lookup = Array.isArray(r['lookup']) ? (r['lookup'] as unknown[]).filter((x): x is string => typeof x === 'string') : []
      const acts = Array.isArray(r['acts']) ? (r['acts'] as Array<Record<string, unknown>>) : []
      const adjust = r['adjust'] !== null && typeof r['adjust'] === 'object' ? (r['adjust'] as Record<string, number>) : {}
      const parts: string[] = []
      if (say !== '') parts.push(`“${clip(say)}”`)
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
    case 'judge': {
      // A ruling on a near miss (wave 11b): {same, why}, or nothing parsed.
      const r = t.result ?? {}
      if (typeof r['same'] !== 'boolean') return t.note || 'no ruling'
      const why = typeof r['why'] === 'string' ? r['why'] : ''
      return `${r['same'] ? 'same' : 'not the same'}${why !== '' ? ` — ${why}` : ''}`
    }
    case 'brief': {
      // A director's Rewrite brief (wave 12): one voice call, the new brief.
      const r = t.result ?? {}
      const brief = typeof r['brief'] === 'string' ? r['brief'].trim() : ''
      if (brief !== '') return `rewrote the brief: “${clip(brief.split('\n')[0]!)}”`
      return t.note || (t.touched.length > 0 ? `updated ${t.touched.join(', ')}` : 'brief unchanged')
    }
    case 'summary': {
      // The quiet-conversation summary (wave 12): a file on one person.
      const r = t.result ?? {}
      const text = typeof r['summary'] === 'string' ? r['summary'].trim() : ''
      const who = t.speaker !== null ? (t.speaker.name || t.speaker.id) : ''
      if (text !== '') return `summed up ${who !== '' ? who : 'a conversation'}: “${clip(text)}”`
      return t.note || 'no summary kept'
    }
    case 'reset':
    case 'control':
    case 'error':
      return t.note || t.trigger || kind
    default:
      return t.note || t.trigger || kind
  }
}

export interface ThoughtFilter {
  character: string | null
  kinds: ReadonlySet<string>
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
  /** Wave 11b: the story's `judge:` character is being asked to rule. */
  asking: boolean
  /** Wave 11b: its ruling, once given (null before, or from an older server). */
  ruling: FilingRuling | null
}

/** A `judge:` character's ruling on a near miss (wave 11b, contract J). */
export interface FilingRuling {
  by: string
  same: boolean
  why: string
  at: number
}

/** A filing's ruling (`ruling: {by, same, why, at}`), else null — an older
 *  server sends none. */
export function rulingOf(f: FactsFiling): FilingRuling | null {
  const r = (f as FactsFiling & { ruling?: unknown }).ruling
  if (r === null || typeof r !== 'object') return null
  const { by, same, why, at } = r as unknown as Record<string, unknown>
  if (typeof by !== 'string' || typeof same !== 'boolean') return null
  return { by, same, why: typeof why === 'string' ? why : '', at: typeof at === 'number' ? at : 0 }
}

/** Is a ruling being asked for this filing right now (`asking: true`)? */
export function askingOf(f: FactsFiling): boolean {
  return (f as FactsFiling & { asking?: unknown }).asking === true
}

/** The Judging card's line for a ruling: "🤖 Trabolta: same — why". */
export function rulingText(r: FilingRuling): string {
  return `🤖 ${r.by}: ${r.same ? 'same' : 'not the same'}${r.why !== '' ? ` — ${r.why}` : ''}`
}

/** The Judging card's line while a ruling is out: "🤖 asking Trabolta…". */
export function askingText(facts: FactsView): string {
  const judge = (facts as FactsView & { judge?: unknown }).judge
  return `🤖 asking ${typeof judge === 'string' && judge !== '' ? judge : 'the judge'}…`
}

/** Every filing a `judge:` character ruled on, newest first — with the
 *  usual override buttons on the card (a director's later verdict wins). */
export function ruledFilings(facts: FactsView): Array<FilingRow & { question: string; ruling: FilingRuling }> {
  const out: Array<FilingRow & { question: string; ruling: FilingRuling }> = []
  for (const q of facts.questions) {
    for (const row of questionFilings(facts, q.id)) if (row.ruling !== null) out.push({ ...row, question: q.id, ruling: row.ruling })
  }
  return out.sort((a, b) => b.ruling.at - a.ruling.at)
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
      rows.push({ person: f.person, name: f.name, question: f.question, answer: f.answer, confidence: f.confidence, proposed: f.verdict, final: f.final, at: f.at, near: nearKeyOf(f), asking: askingOf(f), ruling: rulingOf(f) })
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
  /** Wave 11b: a ruling is being asked. */
  asking: boolean
  /** Wave 11b: the `judge:` character's ruling, else null. */
  ruling: FilingRuling | null
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
    .map((f) => ({ person: f.person, name: f.name, answer: f.answer, confidence: f.confidence, proposed: f.verdict, final: f.final, how: howOf(f), by: f.by ?? null, at: f.at, near: nearKeyOf(f), asking: askingOf(f), ruling: rulingOf(f) }))
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

// ---------------------------------------------------------------------------
// Wave 12: the story mind's report, its labels, and the controls that changed
// (CONTRACTS C1.5, C6.2, C6.7). Every field below is optional on the wire and
// absent from the base core types, so each is read through a typed accessor:
// an older worker's report renders exactly as before.
// ---------------------------------------------------------------------------

/** Which mind the worker runs: `new` (the story mind: one voice call per
 *  line, the phase table sets the stage) or `classic` (the orchestrator).
 *  Null from an older worker, which is classic. */
export type MindMode = 'new' | 'classic'

const field = (o: object, k: string): unknown => (o as Record<string, unknown>)[k]

export function mindModeOf(mind: AgentMindSummary): MindMode | null {
  const m = field(mind, 'mode')
  return m === 'new' || m === 'classic' ? m : null
}

/** True only for a worker that says it runs the story mind. */
export const isNewMind = (mind: AgentMindSummary | null): boolean => mind !== null && mindModeOf(mind) === 'new'

/** True when the story moves this mind's stage (the story mind's phase
 *  table). False on a classic or old worker, and on a story mind whose YAML
 *  turns `mind.stage_from_phase` off (DESIGN's kill-switch rung 4) — when the
 *  worker says so in `status.stageFromPhase`; directors then step the stage
 *  by hand, as in classic. */
export function stageFromPhase(mind: AgentMindSummary): boolean {
  if (!isNewMind(mind)) return false
  const status = field(mind, 'status')
  return !(status !== null && typeof status === 'object' && (status as Record<string, unknown>)['stageFromPhase'] === false)
}

/** The stage stepper's question, worded for who moves the stage next. */
export function stagePrompt(mind: AgentMindSummary): string {
  if (stageFromPhase(mind)) return 'Why? (goes into the stage history). The stage holds until the next phase change, when the story sets it again (unless stage_from_phase is off in the worker\'s YAML: then it moves only by hand).'
  if (isNewMind(mind)) return 'Why? (goes into the stage history). stage_from_phase is off in the worker\'s YAML, so the stage moves only by hand.'
  return 'Why? (goes into the stage history)'
}

/** The phase chip's hover text. */
export function phaseTitle(mind: AgentMindSummary): string {
  if (stageFromPhase(mind)) return "Night.phase, as the worker last read it; the story's phase table sets the stage from it"
  if (isNewMind(mind)) return 'Night.phase, as the worker last read it; stage_from_phase is off, so step the stage by hand'
  return 'Night.phase, as the worker last read it'
}

/** The story's `Night.phase` as the worker last saw it, else null. */
export function mindPhaseOf(mind: AgentMindSummary): string | null {
  const p = field(mind, 'phase')
  return typeof p === 'string' && p.trim() !== '' ? p : null
}

/** The `by` values a worker writes for itself. Any other `by` is a
 *  director: the story mind writes `director` (C6.2), but a base or classic
 *  worker writes the director's own name ("Ada"), and a half-merged one may
 *  still. */
const MIND_BYS: ReadonlySet<string> = new Set(['story', 'reflect', 'survey', 'rerun', 'reset', 'server', 'phase', 'hello', 'timer', 'exchange', 'voice'])

/** True when a revision's or a stage move's `by` names a director. */
export function isDirectorBy(by: string): boolean {
  const b = by.trim()
  return b !== '' && !MIND_BYS.has(b) && !b.startsWith('agent:')
}

/** What a revision's or a stage move's `by` reads as on the page (C6.2):
 *  "set by story", "set by director" (whatever name the worker wrote — the
 *  name goes in `byTitle`), and a reset revision as "reset", whoever
 *  pressed it. Everything else as the worker wrote it. */
export function byLabel(by: string, touched: readonly string[] = []): string {
  if (touched.includes('reset')) return 'reset'
  if (by === 'story') return 'set by story'
  if (isDirectorBy(by)) return 'set by director'
  return by
}

/** The hover text naming the director behind a "set by director" (or a
 *  reset), when the worker wrote a name rather than `director`. */
export function byTitle(by: string): string | undefined {
  return isDirectorBy(by) && by.trim() !== 'director' ? by.trim() : undefined
}

/** Who set the brief now in force — "set by story" or "set by director":
 *  the report's `briefBy`, else the newest revision that touched the brief
 *  when that was the story or a director. Null otherwise (an older worker's
 *  reflect-written brief keeps today's unlabelled panel). */
export function briefLabel(mind: AgentMindSummary): string | null {
  const b = field(mind, 'briefBy')
  if (b === 'story' || (typeof b === 'string' && isDirectorBy(b))) return byLabel(b)
  for (let i = mind.revisions.length - 1; i >= 0; i--) {
    const r = mind.revisions[i]!
    if (r.touched.includes('brief')) return r.by === 'story' || isDirectorBy(r.by) ? byLabel(r.by) : null
  }
  return null
}

/** One memo the voice kept on a person (C2.3: `by: "voice"`; `heart` = it
 *  was written while they stood at his heart). */
export interface PersonMemo {
  at: number
  text: string
  by: string
  heart: boolean
}

/** The story-kept parts of a file on a person (C1.5), each present only when
 *  the worker sent it well-typed — absent fields stay absent. */
export interface PersonExtras {
  memos?: PersonMemo[]
  firstMet?: string
  gifts?: string[]
  filings?: string[]
  marked?: boolean
  chart?: string | null
  storyTrust?: string | null
}

const strList = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined)

export function personExtras(p: AgentMindPerson): PersonExtras {
  const out: PersonExtras = {}
  const memos = field(p, 'memos')
  if (Array.isArray(memos)) {
    out.memos = memos
      .filter((m): m is Record<string, unknown> => m !== null && typeof m === 'object' && typeof (m as Record<string, unknown>)['text'] === 'string')
      .map((m) => ({ at: typeof m['at'] === 'number' ? m['at'] : 0, text: m['text'] as string, by: typeof m['by'] === 'string' ? m['by'] : 'voice', heart: m['heart'] === true }))
  }
  const firstMet = field(p, 'firstMet')
  if (typeof firstMet === 'string') out.firstMet = firstMet
  const gifts = strList(field(p, 'gifts'))
  if (gifts !== undefined) out.gifts = gifts
  const filings = strList(field(p, 'filings'))
  if (filings !== undefined) out.filings = filings
  const marked = field(p, 'marked')
  if (typeof marked === 'boolean') out.marked = marked
  const chart = field(p, 'chart')
  if (typeof chart === 'string' || chart === null) out.chart = chart
  const storyTrust = field(p, 'storyTrust')
  if (typeof storyTrust === 'string' || storyTrust === null) out.storyTrust = storyTrust
  return out
}

/** A memo's line in People: "memo by voice", with 🫀 for one kept at his heart. */
export function memoLabel(m: PersonMemo): string {
  return `${m.heart ? '🫀 ' : ''}memo by ${m.by || 'voice'}`
}

/** The time the voice's prompt took to read (Ollama's prompt eval), when
 *  the worker sent it (`prompt_ms`, C6.6); null otherwise. */
export function promptMsOf(t: AgentThought): number | null {
  const v = field(t, 'prompt_ms')
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

/** "1.2 s" or "1.2 s (prompt 300 ms)" — the call's time, with how much of it
 *  went on reading the prompt when known. */
export function timingText(t: AgentThought): string {
  const total = formatMs(t.ms)
  const prompt = promptMsOf(t)
  if (prompt === null) return total
  const p = prompt === 0 ? '0 ms' : formatMs(Math.round(prompt))
  return total === '' ? `prompt ${p}` : `${total} (prompt ${p})`
}

/** The trace stores a voice prompt's static part once (C6.6): a message whose
 *  content is exactly `[same prefix as th-<10 hex>]` points at the thought
 *  holding the full text. The id, or null for an ordinary message. */
export function prefixRef(content: string): string | null {
  const m = /^\[same prefix as (th-[0-9a-f]{10})\]$/.exec(content)
  return m === null ? null : m[1]!
}

/** The full static prefix a reference points at, from the thoughts already
 *  loaded (its first message), else null — the page then asks the server. */
export function localPrefix(id: string, thoughts: readonly AgentThought[]): string | null {
  const t = thoughts.find((x) => x.id === id)
  const first = t?.messages[0]?.content
  return typeof first === 'string' && prefixRef(first) === null ? first : null
}

/** The API origin every other mod call uses (`lib/api.ts`'s `BASE`): empty
 *  when the editor is served by the server it talks to. */
const API_BASE: string = import.meta.env.VITE_LOOM_API ?? ''

/** Load one thought by id (`GET /e/:id/api/mod/agent/trace?id=`, directors
 *  only, the author's session cookie), on the same API base as every other
 *  mod call. Null when the server has no such thought; throws on any other
 *  failure. */
export async function fetchThought(eventId: string, id: string, fetchFn: typeof fetch = fetch, base: string = API_BASE): Promise<AgentThought | null> {
  const res = await fetchFn(`${base}/e/${encodeURIComponent(eventId)}/api/mod/agent/trace?id=${encodeURIComponent(id)}`, { credentials: 'include', headers: { accept: 'application/json' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`trace ${res.status}`)
  const body = (await res.json()) as { thought?: AgentThought }
  return body.thought ?? null
}

/** A control the page sends. `rewrite` is the new mind's Rewrite brief
 *  (C6.1); the base core types don't name it yet, so it is cast at the one
 *  place it leaves the page. */
export type Action = AgentControl['action'] | 'rewrite'
export type MindControl = { action: Action; character: string | null; [extra: string]: unknown }

/** Survey now (classic, or an older worker) or Rewrite brief (the new mind). */
export function surveyButton(mind: AgentMindSummary | null, character: string): { label: string; title: string; control: MindControl } {
  if (isNewMind(mind)) {
    return { label: 'Rewrite brief', title: 'Rewrite his brief from the phase and the house now (one voice call)', control: { action: 'rewrite', character } }
  }
  return { label: 'Survey now', title: 'Make the orchestrator look at the house now', control: { action: 'survey', character } }
}

/** A select's control, only when the choice actually changed. */
export function favoursControl(mind: AgentMindSummary, value: string): MindControl | null {
  return value === mind.policy.favours ? null : { action: 'set', character: mind.character, field: 'policy', value: { favours: value } }
}

export function effortControl(character: string, level: string, current: string): MindControl | null {
  return level === current ? null : { action: 'effort', character, level }
}

/** The keys whose release commits a drive slider moved from the keyboard. */
export const SLIDER_COMMIT_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

/** What happens on a drive slider (C6.7: one drag sends one control). */
export type SliderEvent = { type: 'change'; value: number } | { type: 'pointerup' } | { type: 'keyup'; key: string } | { type: 'blur' }

/** A drive slider's local state: the value under the director's hand while
 *  it differs from the mirrored drive (else null: the slider shows `live`),
 *  and the value last sent, so a blur after a pointer-up never sends twice. */
export interface SliderState {
  local: number | null
  sent: number | null
}

export const SLIDER_IDLE: SliderState = { local: null, sent: null }

/**
 * The drive slider's reducer. A change only moves the local value; a release
 * (pointer up, an arrow / Home / End / Page key up, blur) sends `set drive`
 * once — and only when the value differs from the mind's own drive and from
 * what this slider already sent. The component resets it to `SLIDER_IDLE`
 * when the mirrored drive moves (or after a grace period), so the sent value
 * stays on the slider until the worker's mirror catches up.
 */
export function sliderStep(state: SliderState, ev: SliderEvent, live: number): { state: SliderState; send: number | null } {
  if (ev.type === 'change') return { state: { local: ev.value, sent: state.sent }, send: null }
  if (ev.type === 'keyup' && !SLIDER_COMMIT_KEYS.has(ev.key)) return { state, send: null }
  if (state.local === null || state.local === live) return { state: SLIDER_IDLE, send: null }
  if (state.local === state.sent) return { state, send: null }
  return { state: { local: state.local, sent: state.local }, send: state.local }
}

export function driveControl(mind: AgentMindSummary, name: string, value: number): MindControl {
  return { action: 'set', character: mind.character, field: 'drive', name, value }
}
