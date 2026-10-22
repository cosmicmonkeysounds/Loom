import { describe, expect, it } from 'vitest'
import { createElement, type FunctionComponent, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { create } from 'zustand'
import { CockpitContext, nullCockpit, type CockpitState } from '@/store/cockpit'
import { Messages, MindTab, PersonFile } from './MindTab'
import type { AgentMindSummary, AgentThought } from '@loom/core/views'
import { SLIDER_COMMIT_KEYS, SLIDER_IDLE, briefLabel, byLabel, byTitle, isDirectorBy, driveControl, effortControl, favoursControl, fetchThought, isNewMind, kindChips, kindMeta, localPrefix, memoLabel, mindModeOf, mindPhaseOf, heldState, personExtras, phaseTitle, prefixRef, promptMsOf, sliderHold, sliderStep, stageFromPhase, stagePrompt, surveyButton, timingText, type SliderEvent, type SliderHold, type SliderState } from './mind'
import { ALL_KINDS, KIND_META, agentQueueOf, askingOf, askingText, autoJudgeCopy, isQueuedFiling, judgeOf, judgingBadge, judgingQueueOf, queuedText, judgeModeTitle, ruledFilings, rulingOf, rulingText, confirmEvent, diffRows, driveSeries, filingButtons, filterThoughts, judgeModeOf, mindCharacters, nearCount, nearKeyOf, pendingFilings, pickMind, questionFilings, questionTallies, queueBadge, QUEUE_SLOW_MS, QueueTone, sparklinePath, speakersOf, stageSegments, summarizeThought, verdictCall, waitText } from './mind'
import { stampAgentQueues, type AgentQueue, type CastSummary } from '@/store/cockpit'
import type { FactsFiling, FactsView } from '@/store/cockpit'
import { mergeThoughts } from '@/store/operate'

function thought(over: Partial<AgentThought> = {}): AgentThought {
  return {
    seq: 1,
    id: 'th-1',
    character: 'Trabolta',
    worker: 'laptop',
    at: 1000,
    kind: 'voice',
    trigger: 'line',
    model: { name: 'gpt-oss:20b', api: 'ollama', endpoint: 'http://l', temperature: 0.9, max_tokens: 800, reasoning_effort: 'low', think: null },
    request_id: 'ar-1',
    thread: { channel: 'dm:Trabolta', audience: ['g1'] },
    speaker: { id: 'g1', name: 'Ada', kind: 'guest' },
    messages: [{ role: 'system', content: 'sys' }],
    thinking: 'she is a program',
    output: '{"say": "SANDY."}',
    finish: 'stop',
    prompt_tokens: 900,
    completion_tokens: 20,
    ms: 1200,
    result: { say: 'SANDY.', adjust: { truth: 5, love: 0 }, lookup: [], acts: [] },
    touched: [],
    diff: {},
    revision: null,
    error: null,
    note: '',
    ...over,
  } as AgentThought
}

function mind(over: Partial<AgentMindSummary> = {}): AgentMindSummary {
  return {
    character: 'Trabolta',
    worker: 'laptop',
    at: 1,
    brief: 'Be brisk.',
    mood: 'wary',
    stage: 'appetite',
    stageSince: 50,
    stages: ['lonely grandeur', 'appetite', 'the question', 'the turn'],
    stageHistory: [{ stage: 'appetite', at: 50, why: 'fed', by: 'reflect', rev: 2 }],
    drives: { hunger: 70, suspicion: 55 },
    policy: { favours: 'earned', credit: ['Ada'], wary: [], note: '' },
    questions: [],
    notes: [],
    learned: [],
    world: [],
    director: [],
    people: [],
    threads: [],
    revisions: [
      { rev: 1, at: 10, by: 'reflect', touched: ['brief'], thought: 'th-1', brief: 'b', mood: '', stage: 'lonely grandeur', drives: { hunger: 40, suspicion: 55 }, policy_favours: 'none', notes: 0, people: 1, learned: 0 },
      { rev: 2, at: 50, by: 'reflect', touched: ['stage', 'drives'], thought: 'th-2', brief: 'b', mood: '', stage: 'appetite', drives: { hunger: 61, suspicion: 55 }, policy_favours: 'none', notes: 0, people: 1, learned: 0 },
    ],
    rev: 2,
    exchanges: 2,
    reflections: 2,
    surveys: 1,
    updatedAt: 50,
    status: {},
    ...over,
  }
}

describe('summarizeThought', () => {
  it('reads a voice thought as the line, the nudges, and the acts', () => {
    expect(summarizeThought(thought())).toBe('“SANDY.” · truth +5')
    expect(summarizeThought(thought({ result: { say: '', lookup: ['Excel'] } }))).toBe('look up Excel')
    expect(summarizeThought(thought({ result: { say: 'Done.', acts: [{ kind: 'fire', name: 'cut the lights' }, { kind: 'share', entry: 'The Sandy File' }] } }))).toBe('“Done.” · ACT cut the lights, share The Sandy File')
    expect(summarizeThought(thought({ result: null }))).toBe('(silence)')
  })
  it('reads the orchestrator, markers, and errors', () => {
    expect(summarizeThought(thought({ kind: 'reflect', touched: ['brief', 'stage'] }))).toBe('updated brief, stage')
    expect(summarizeThought(thought({ kind: 'survey', touched: [] }))).toBe('looked, changed nothing')
    expect(summarizeThought(thought({ kind: 'control', note: 'nudge: be shaken' }))).toBe('nudge: be shaken')
    expect(summarizeThought(thought({ kind: 'reset', note: '', trigger: 'restart' }))).toBe('restart')
    expect(summarizeThought(thought({ error: 'down' }))).toBe('✗ down')
  })
})

describe('filterThoughts / speakersOf', () => {
  const rows = [thought(), thought({ id: 'th-2', seq: 2, kind: 'reflect', speaker: { id: 'g1', name: 'Ada', kind: 'guest' }, thinking: '' }), thought({ id: 'th-3', seq: 3, character: 'Clippy', speaker: { id: 'g2', name: 'Bo', kind: 'guest' }, output: 'hello bo', thinking: '' })]
  it('narrows by character, kind, person, and text', () => {
    const all = new Set<AgentThought['kind']>(['voice', 'reflect'])
    expect(filterThoughts(rows, { character: 'Trabolta', kinds: all, person: null, query: '' }).map((t) => t.id)).toEqual(['th-1', 'th-2'])
    expect(filterThoughts(rows, { character: null, kinds: new Set(['voice']), person: null, query: '' }).map((t) => t.id)).toEqual(['th-1', 'th-3'])
    expect(filterThoughts(rows, { character: null, kinds: all, person: 'g2', query: '' }).map((t) => t.id)).toEqual(['th-3'])
    expect(filterThoughts(rows, { character: null, kinds: all, person: null, query: 'program' }).map((t) => t.id)).toEqual(['th-1'])
    expect(filterThoughts(rows, { character: null, kinds: all, person: null, query: 'HELLO' }).map((t) => t.id)).toEqual(['th-3'])
  })
  it('lists who spoke to a character', () => {
    expect(speakersOf(rows, 'Trabolta')).toEqual([{ id: 'g1', name: 'Ada' }])
    expect(speakersOf(rows, null)).toEqual([{ id: 'g1', name: 'Ada' }, { id: 'g2', name: 'Bo' }])
  })
})

describe('the mind', () => {
  it('reads each drive off the revisions, ending on the live value', () => {
    expect(driveSeries(mind())).toEqual([
      { name: 'hunger', values: [40, 61, 70], current: 70, delta: 30 },
      { name: 'suspicion', values: [55, 55], current: 55, delta: 0 },
    ])
    expect(driveSeries(mind({ revisions: [] }))).toEqual([
      { name: 'hunger', values: [70], current: 70, delta: 0 },
      { name: 'suspicion', values: [55], current: 55, delta: 0 },
    ])
  })
  it('draws a sparkline that spans the box and clamps', () => {
    expect(sparklinePath([], 10, 10)).toBe('')
    expect(sparklinePath([50], 10, 10)).toBe('M5.0,5.0')
    expect(sparklinePath([0, 100, 200], 12, 12)).toBe('M1.0,11.0 L6.0,1.0 L11.0,1.0')
  })
  it('lays out the arc as past / current / future with when and why', () => {
    expect(stageSegments(mind())).toEqual([
      { stage: 'lonely grandeur', state: 'past', at: 50, why: '' },
      { stage: 'appetite', state: 'current', at: 50, why: 'fed' },
      { stage: 'the question', state: 'future', at: null, why: '' },
      { stage: 'the turn', state: 'future', at: null, why: '' },
    ])
    expect(stageSegments(mind({ stages: [], stage: 'x', stageHistory: [] }))).toEqual([{ stage: 'x', state: 'free', at: 50, why: '' }])
    expect(stageSegments(mind({ stages: [], stage: '' }))).toEqual([])
    expect(stageSegments(mind({ stage: 'nowhere' })).map((s) => s.state)).toEqual(['current', 'future', 'future', 'future'])
  })
  it('flattens a mind diff into signed rows', () => {
    const rows = diffRows({
      brief: ['', 'Be brisk.'],
      stage: ['lonely grandeur', 'appetite'],
      drives: { hunger: [40, 61] },
      notes: { added: ['Ada lied.'], dropped: ['old'] },
      learned: { added: [{ claim: 'k', from: 'Ada', verdict: 'bluster' }] },
      people: { g1: { name: 'Ada', trust: [50, 70], claims: { added: ['is a nurse'] } }, g2: { added: { name: 'Bo' } }, g3: { dropped: true } },
      questions: { 'what is a body for': { added: true, answers: [] }, old: { dropped: true }, earning: { answers_added: ['itchy — Ada'] } },
      threads: { 'dm:Trabolta|g1': 'Ada said hi.' },
      director: { added: [], dropped: ['be shaken'] },
    })
    expect(rows).toEqual([
      { field: 'brief', sign: '→', text: '(empty) → Be brisk.' },
      { field: 'stage', sign: '→', text: 'lonely grandeur → appetite' },
      { field: 'drive hunger', sign: '→', text: '40 → 61' },
      { field: 'notes', sign: '+', text: 'Ada lied.' },
      { field: 'notes', sign: '−', text: 'old' },
      { field: 'learned', sign: '+', text: '{"claim":"k","from":"Ada","verdict":"bluster"}' },
      { field: 'Ada · trust', sign: '→', text: '50 → 70' },
      { field: 'Ada · claims', sign: '+', text: 'is a nurse' },
      { field: 'file on g2', sign: '+', text: 'opened' },
      { field: 'file on g3', sign: '−', text: 'forgotten' },
      { field: 'question', sign: '+', text: 'what is a body for' },
      { field: 'question', sign: '−', text: 'old' },
      { field: 'answer · earning', sign: '+', text: 'itchy — Ada' },
      { field: 'thread dm:Trabolta|g1', sign: '→', text: 'Ada said hi.' },
      { field: 'director', sign: '−', text: 'be shaken' },
    ])
  })
  it('picks a mind and lists every character the page can show', () => {
    const m = mind()
    expect(pickMind([m], 'Clippy')).toBe(m)
    expect(pickMind([], 'Trabolta')).toBeNull()
    expect(mindCharacters([m], [thought({ character: 'Clippy' })])).toEqual(['Clippy', 'Trabolta'])
  })
})

describe('mergeThoughts', () => {
  it('dedupes by id, orders by seq, and keeps a bounded tail', () => {
    const a = thought({ id: 'a', seq: 2 })
    const b = thought({ id: 'b', seq: 1 })
    expect(mergeThoughts([a], [b, { ...a, note: 'newer' }]).map((t) => [t.id, t.note])).toEqual([
      ['b', ''],
      ['a', 'newer'],
    ])
    const many = Array.from({ length: 450 }, (_, i) => thought({ id: `t${i}`, seq: i }))
    const merged = mergeThoughts([], many)
    expect(merged).toHaveLength(400)
    expect(merged[0]!.id).toBe('t50')
  })
})

describe('judging', () => {
  const filing = (over: Partial<FactsFiling>): FactsFiling => ({ person: 'g1', name: 'Ada', question: 'Q1', answer: 'eleven', confidence: 100, verdict: 'accurate', final: null, how: null, by: null, at: 10, ...over })
  const tally = (filings: FactsFiling[]) => {
    const eff = (f: FactsFiling) => f.final ?? f.verdict
    return {
      filed: filings.length,
      accurate: filings.filter((f) => eff(f) === 'accurate').length,
      lie: filings.filter((f) => eff(f) === 'lie').length,
      uncertain: filings.filter((f) => eff(f) === 'uncertain' || eff(f) === 'marked').length,
      consensus: filings.length > 0 && filings.every((f) => eff(f) === 'accurate' && f.confidence === 100),
    }
  }
  const view = (over: Partial<FactsView> = {}): FactsView => {
    const q1 = [filing({ at: 30 }), filing({ person: 'g2', name: 'Ben', answer: 'twelve', verdict: 'lie', at: 20 })]
    const q2 = [filing({ question: 'Q2', answer: 'pickles', confidence: 40, verdict: 'uncertain', final: 'marked', at: 5 })]
    return {
      modeVar: 'Night.judge_mode',
      mode: 'review',
      confirm: { accurate: 'fact_accurate', lie: 'fact_lie', uncertain: 'fact_uncertain' },
      questions: [
        { id: 'Q1', round: 1, text: 'How many years?', filings: q1, tally: tally(q1) },
        { id: 'Q2', round: 1, text: 'Who?', filings: q2, tally: tally(q2) },
        { id: 'P1', round: null, text: 'The line.', filings: [], tally: tally([]) },
      ],
      pending: 2,
      ...over,
    }
  }

  it('judgeModeOf: the view first, then the world var, else auto', () => {
    expect(judgeModeOf([], view())).toBe('review')
    expect(judgeModeOf([{ path: 'Night.judge_mode', value: 'review' }], view({ mode: 'auto' }))).toBe('auto')
    expect(judgeModeOf([{ path: 'Night.judge_mode', value: 'review' }], null)).toBe('review')
    expect(judgeModeOf([{ path: 'Night.judge_mode', value: 'auto' }], null)).toBe('auto')
    expect(judgeModeOf([], null)).toBe('auto')
  })

  it('wave 18b (O4): a plain miss waits on the judge like a near miss, queued or asked', () => {
    const extra = (o: Record<string, unknown>) => o as unknown as Partial<FactsFiling>
    const q = [
      // A plain miss (no near), its ruling queued behind another.
      filing({ person: 'g1', name: 'Ada', question: 'H1', answer: 'nine', confidence: 100, verdict: 'lie', at: 1, ...extra({ asking: true, queued: true }) }),
      // A plain miss at 80 whose frame is out.
      filing({ person: 'g2', name: 'Ben', question: 'H1', answer: 'six', confidence: 80, verdict: 'uncertain', at: 2, ...extra({ asking: true }) }),
    ]
    const v = view({ mode: 'auto', pending: 2, questions: [{ id: 'H1', round: 1, text: 'Ducks?', filings: q, tally: tally(q) }], ...({ judge: 'Trabolta' } as Partial<FactsView>) })
    expect(judgeOf(v)).toBe('Trabolta')
    expect(judgeOf(view())).toBeNull()
    expect(pendingFilings(v).map((r) => [r.name, r.near, r.asking, r.queued === true])).toEqual([
      ['Ada', null, true, true],
      ['Ben', null, true, false],
    ])
    expect(isQueuedFiling(v, 'g1', 'H1')).toBe(true)
    expect(isQueuedFiling(v, 'g2', 'H1')).toBe(false)
    expect(queuedText(v)).toBe('🤖 queued for Trabolta')
    expect(queuedText(view())).toBe('🤖 queued for the judge')
  })

  it('wave 18b (O4): the judge queue badge off the cast row (else the mind summary)', () => {
    const cast = [{ id: 'Trabolta', faction: null, agent: true, agentQueue: { depth: 0, oldestMs: null, stalled: false, judging: { queued: 4, out: 1, oldestMs: 65_000, stalled: false } } }]
    const j = judgingQueueOf('Trabolta', cast, [])
    expect(j).toEqual({ queued: 4, out: 1, oldestMs: 65_000, stalled: false })
    expect(judgingBadge(j, 'Trabolta')).toMatchObject({ text: '🤖 4 queued · 1 out · oldest 1:05', stalled: false })
    expect(judgingBadge({ queued: 2, out: 0, oldestMs: null, stalled: true }, 'Trabolta')).toMatchObject({ text: "⏳ Trabolta isn't ruling · 2 queued", stalled: true })
    expect(judgingBadge({ queued: 0, out: 0, oldestMs: null, stalled: false }, 'Trabolta')).toBeNull()
    expect(judgingBadge(null, 'Trabolta')).toBeNull()
    expect(judgingQueueOf('Trabolta', [{ id: 'Trabolta', faction: null, agentQueue: { depth: 1, oldestMs: 3, stalled: false } }], [])).toBeNull()
    expect(judgingQueueOf(null, cast, [])).toBeNull()
    const minds = [{ character: 'Trabolta', agentQueue: { depth: 0, oldestMs: null, stalled: false, judging: { queued: 1, out: 0, oldestMs: 2_000, stalled: false } } }] as unknown as Parameters<typeof judgingQueueOf>[2]
    expect(judgingQueueOf('Trabolta', [], minds)).toMatchObject({ queued: 1 })
  })

  it('wave 18b (O4): the judge queue’s oldest wait ages between snapshots, stamped apart from the voice queue', () => {
    const row = (judging: Record<string, unknown>, depth = 0, oldestMs: number | null = null): CastSummary =>
      ({ id: 'Trabolta', faction: null, agent: true, agentQueue: { depth, oldestMs, stalled: false, judging } }) as unknown as CastSummary
    const first = stampAgentQueues([row({ queued: 2, out: 1, oldestMs: 3_000, stalled: false })], [], 10_000)
    expect(first[0]!.agentQueue?.judging?.receivedAt).toBe(10_000)
    // 50 s later, no new snapshot: the badge reads 0:53, not 0:03.
    const j = judgingQueueOf('Trabolta', first, [], 60_000)
    expect(j?.oldestMs).toBe(53_000)
    expect(judgingBadge(j, 'Trabolta')?.text).toBe('🤖 2 queued · 1 out · oldest 0:53')
    // A snapshot that leaves the judge queue alone keeps its stamp, though the voice queue moved.
    const second = stampAgentQueues([row({ queued: 2, out: 1, oldestMs: 3_000, stalled: false }, 1, 500)], first, 20_000)
    expect(second[0]!.agentQueue?.judging?.receivedAt).toBe(10_000)
    expect(second[0]!.agentQueue?.receivedAt).toBe(20_000)
    // A new judge reading re-stamps it.
    const third = stampAgentQueues([row({ queued: 1, out: 1, oldestMs: 1_000, stalled: false })], second, 30_000)
    expect(third[0]!.agentQueue?.judging?.receivedAt).toBe(30_000)
    // Nothing queued or out never ages; no now, no aging.
    expect(judgingQueueOf('Trabolta', stampAgentQueues([row({ queued: 0, out: 0, oldestMs: 3_000, stalled: true })], [], 0), [], 9_000)?.oldestMs).toBe(3_000)
    expect(judgingQueueOf('Trabolta', first, [])?.oldestMs).toBe(3_000)
  })

  it('wave 18b (O4): the Judging card in auto with a judge says who rules and shows his queue', () => {
    const extra = (o: Record<string, unknown>) => o as unknown as Partial<FactsFiling>
    const q = [
      filing({ person: 'g1', name: 'Ada', question: 'H1', answer: 'nine', confidence: 100, verdict: 'lie', at: 1, ...extra({ asking: true, queued: true }) }),
      filing({ person: 'g2', name: 'Ben', question: 'H1', answer: 'sevn', confidence: 100, verdict: 'accurate', at: 2, ...extra({ asking: true, near: { key: 'seven' } }) }),
    ]
    const facts = view({ mode: 'auto', pending: 2, questions: [{ id: 'H1', round: 1, text: 'Ducks?', filings: q, tally: tally(q) }], ...({ judge: 'Trabolta' } as Partial<FactsView>) })
    const cast = [{ id: 'Trabolta', faction: null, agent: true, agentQueue: { depth: 0, oldestMs: null, stalled: false, judging: { queued: 1, out: 1, oldestMs: 4_000, stalled: false } } }]
    const html = render({ facts, cast })
    expect(html).toContain('data-testid="judging-auto-copy"')
    expect(html).toContain(autoJudgeCopy('Trabolta').replace(/'/gu, '&#x27;'))
    expect(html).toContain('🤖 1 queued · 1 out')
    expect(html).toContain('🤖 queued for Trabolta')
    expect(html).toContain('🤖 asking Trabolta…')
    // Only the near miss carries the ⚠ near tag; the plain miss shows none.
    expect(html.match(/data-testid="judging-near"/gu)?.length).toBe(1)
  })

  it('pendingFilings: only unsettled filings, oldest first', () => {
    expect(pendingFilings(view()).map((r) => [r.name, r.question, r.proposed, r.at])).toEqual([
      ['Ben', 'Q1', 'lie', 20],
      ['Ada', 'Q1', 'accurate', 30],
    ])
    expect(pendingFilings(view())[0]).toEqual({ person: 'g2', name: 'Ben', question: 'Q1', answer: 'twelve', confidence: 100, proposed: 'lie', final: null, at: 20, near: null, asking: false, ruling: null })
  })

  it('questionTallies: counts per question, a marked final under uncertain, consensus only when every filing is accurate at 100', () => {
    expect(questionTallies(view())).toEqual([
      { id: 'Q1', round: 1, text: 'How many years?', filed: 2, accurate: 1, lie: 1, uncertain: 0, pending: 2, consensus: false },
      { id: 'Q2', round: 1, text: 'Who?', filed: 1, accurate: 0, lie: 0, uncertain: 1, pending: 0, consensus: false },
      { id: 'P1', round: null, text: 'The line.', filed: 0, accurate: 0, lie: 0, uncertain: 0, pending: 0, consensus: false },
    ])
    const all = [filing({ final: 'accurate' }), filing({ person: 'g2', final: 'accurate' })]
    const v = view({ questions: [{ id: 'Q1', round: 1, text: 'x', filings: all, tally: tally(all) }] })
    expect(questionTallies(v)[0]).toMatchObject({ filed: 2, accurate: 2, pending: 0, consensus: true })
    const notSure = [filing({ final: 'accurate' }), filing({ person: 'g2', confidence: 99, final: 'accurate' })]
    const v2 = view({ questions: [{ id: 'Q1', round: 1, text: 'x', filings: notSure, tally: tally(notSure) }] })
    expect(questionTallies(v2)[0]!.consensus).toBe(false)
  })

  it('questionFilings: the server\'s how + by (wave 5 issue 8) — auto, confirmed by whom, settled', () => {
    const q = [
      filing({ person: 'g1', name: 'Ada', final: 'accurate', how: 'auto', at: 1 }),
      filing({ person: 'g2', name: 'Ben', final: 'accurate', how: 'confirmed', by: 'Jo', at: 2 }),
      filing({ person: 'g3', name: 'Cy', verdict: 'lie', final: 'accurate', how: 'overridden', by: 'Clippy', at: 3 }),
      filing({ person: 'g4', name: 'Di', final: 'accurate', how: 'settled', by: 'Jo', at: 4 }),
      filing({ person: 'g5', name: 'Ed', verdict: 'uncertain', final: 'marked', how: 'marked', by: 'Jo', at: 5 }),
    ]
    const v = view({ questions: [{ id: 'Q1', round: 1, text: 'x', filings: q, tally: tally(q) }] })
    expect(questionFilings(v, 'Q1').map((r) => [r.name, r.how, r.by])).toEqual([
      ['Ada', 'auto', null],
      ['Ben', 'confirmed', 'Jo'],
      ['Cy', 'overridden', 'Clippy'],
      ['Di', 'settled', 'Jo'],
      ['Ed', 'marked', 'Jo'],
    ])
  })

  it('questionFilings: every filing oldest first, with how it was judged (an older server with no how)', () => {
    const q = [
      filing({ person: 'g1', name: 'Ada', final: 'accurate', at: 40 }),
      filing({ person: 'g2', name: 'Ben', verdict: 'lie', final: 'accurate', at: 10 }),
      filing({ person: 'g3', name: 'Cy', verdict: 'uncertain', final: 'marked', at: 30 }),
      filing({ person: 'g4', name: 'Di', at: 20 }),
    ]
    const v = view({ questions: [{ id: 'Q1', round: 1, text: 'x', filings: q, tally: tally(q) }] })
    expect(questionFilings(v, 'Q1').map((r) => [r.name, r.proposed, r.final, r.how, r.at])).toEqual([
      ['Ben', 'lie', 'accurate', 'overridden', 10],
      ['Di', 'accurate', null, 'pending', 20],
      ['Cy', 'uncertain', 'marked', 'marked', 30],
      ['Ada', 'accurate', 'accurate', 'kept', 40],
    ])
    // The mode in force now never relabels a settled filing (a round-1 auto
    // verdict must not read as confirmed after a switch to review).
    expect(questionFilings(view({ ...v, mode: 'auto' }), 'Q1').find((r) => r.name === 'Ada')!.how).toBe('kept')
    expect(questionFilings(view({ ...v, mode: 'review' }), 'Q1').find((r) => r.name === 'Ada')!.how).toBe('kept')
    expect(questionFilings(v, 'Q1')[0]).toEqual({ person: 'g2', name: 'Ben', answer: 'eleven', confidence: 100, proposed: 'lie', final: 'accurate', how: 'overridden', by: null, at: 10, near: null, asking: false, ruling: null })
    expect(questionFilings(v, 'nope')).toEqual([])
    expect(questionFilings(view(), 'P1')).toEqual([])
  })

  it('near misses (wave 11 C6): the key on a pending filing, counted, tagged in both lists', () => {
    const near = (key: unknown) => ({ near: key }) as unknown as Partial<FactsFiling>
    const q = [
      filing({ person: 'g1', name: 'Calculator', question: 'H2', answer: 'Mr Pickels', confidence: 100, verdict: 'lie', at: 1, ...near({ key: 'Mr. Pickles' }) }),
      filing({ person: 'g2', name: 'VLC', question: 'H2', answer: 'Garfield', verdict: 'lie', at: 2 }),
      filing({ person: 'g3', name: 'Winamp', question: 'H2', answer: '1,997', verdict: 'uncertain', at: 3, ...near({ key: '' }) }),
      filing({ person: 'g4', name: 'Excel', question: 'H2', answer: 'pickle', verdict: 'lie', at: 4, ...near('Mr. Pickles') }),
    ]
    const v = view({ mode: 'auto', pending: 4, questions: [{ id: 'H2', round: 1, text: 'The cat?', filings: q, tally: tally(q) }] })
    expect(pendingFilings(v).map((r) => [r.name, r.near])).toEqual([
      ['Calculator', 'Mr. Pickles'],
      ['VLC', null],
      // a blank key or a bare string is not a near miss
      ['Winamp', null],
      ['Excel', null],
    ])
    expect(nearKeyOf(q[0]!)).toBe('Mr. Pickles')
    expect(nearCount(v)).toBe(1)
    // a server's own count wins
    expect(nearCount({ ...v, near: 3 } as FactsView)).toBe(3)
    expect(questionFilings(v, 'H2')[0]!.near).toBe('Mr. Pickles')
    expect(nearCount(view())).toBe(0)
  })

  it('rulings (wave 11b): asking while the judge is asked, then its ruling on the row, newest first, with the override buttons', () => {
    const extra = (o: Record<string, unknown>) => o as unknown as Partial<FactsFiling>
    const q = [
      filing({ person: 'g1', name: 'Calculator', question: 'H2', answer: 'Mr Pickels', verdict: 'accurate', at: 1, ...extra({ near: { key: 'Mister Pickles' }, asking: true }) }),
      filing({ person: 'g2', name: 'VLC', question: 'H2', answer: 'Mrs Pickles', verdict: 'accurate', final: 'lie', how: 'overridden', by: 'Trabolta', at: 2, ...extra({ near: { key: 'Mister Pickles' }, ruling: { by: 'Trabolta', same: false, why: 'A different cat.', at: 50 } }) }),
      filing({ person: 'g3', name: 'Winamp', question: 'H2', answer: 'Mister Pickels', verdict: 'accurate', final: 'accurate', how: 'confirmed', by: 'Trabolta', at: 3, ...extra({ ruling: { by: 'Trabolta', same: true, why: '', at: 60 } }) }),
      filing({ person: 'g4', name: 'Excel', question: 'H2', answer: 'x', verdict: 'lie', at: 4, ...extra({ asking: 'yes', ruling: { by: 7, same: true } }) }),
    ]
    const v = view({ mode: 'auto', pending: 2, questions: [{ id: 'H2', round: 1, text: 'The cat?', filings: q, tally: tally(q) }], ...({ judge: 'Trabolta' } as Partial<FactsView>) })
    expect(pendingFilings(v).map((r) => [r.name, r.asking, r.ruling])).toEqual([
      ['Calculator', true, null],
      ['Excel', false, null], // a malformed ruling / asking from a confused server is none
    ])
    expect(askingText(v)).toBe('🤖 asking Trabolta…')
    expect(askingText(view())).toBe('🤖 asking the judge…')
    const ruled = ruledFilings(v)
    expect(ruled.map((r) => [r.name, r.question, rulingText(r.ruling)])).toEqual([
      ['Winamp', 'H2', '🤖 Trabolta: same'],
      ['VLC', 'H2', '🤖 Trabolta: not the same — A different cat.'],
    ])
    // A director can still override a ruling: the usual three buttons.
    expect(filingButtons(v, ruled[1]!).map((b) => [b.verdict, b.current])).toEqual([
      ['accurate', false],
      ['lie', true],
      ['uncertain', false],
    ])
    expect(rulingOf(q[0]!)).toBeNull()
    expect(askingOf(q[3]!)).toBe(false)
  })

  it('a judge thought (wave 11b) reads as its ruling', () => {
    expect(KIND_META.judge.label).toBe('judge')
    expect(ALL_KINDS).toContain('judge')
    expect(summarizeThought(thought({ kind: 'judge', result: { same: true, why: 'A typo of the name.' } }))).toBe('same — A typo of the name.')
    expect(summarizeThought(thought({ kind: 'judge', result: { same: false, why: '' } }))).toBe('not the same')
    expect(summarizeThought(thought({ kind: 'judge', result: null, note: '' }))).toBe('no ruling')
    expect(summarizeThought(thought({ kind: 'judge', error: 'unparseable' }))).toBe('✗ unparseable')
  })

  it('confirmEvent: the confirm event per verdict, null without one', () => {
    expect(confirmEvent(view(), 'lie')).toBe('fact_lie')
    expect(confirmEvent(view(), 'uncertain')).toBe('fact_uncertain')
    expect(confirmEvent(view({ confirm: null }), 'accurate')).toBeNull()
    expect(confirmEvent(view({ confirm: { accurate: '', lie: 'x', uncertain: 'y' } }), 'accurate')).toBeNull()
  })

  it('filingButtons (wave 9 D5): an auto-mode judged lie offers all three, its verdict outlined; a marked filing none', () => {
    const q = [
      filing({ person: 'g1', name: 'Calculator', question: 'H2', answer: 'Mr. Pickles', verdict: 'lie', final: 'lie', how: 'auto', at: 1 }),
      filing({ person: 'g2', name: 'VLC', question: 'H2', answer: 'Mr Pickles', confidence: 60, verdict: 'uncertain', final: 'marked', how: 'marked', by: 'Jo', at: 2 }),
      filing({ person: 'g3', name: 'Winamp', question: 'H2', answer: 'Garfield', verdict: 'lie', at: 3 }),
    ]
    const v = view({ mode: 'auto', questions: [{ id: 'H2', round: 1, text: 'The cat?', filings: q, tally: tally(q) }] })
    const [lie, marked, pending] = questionFilings(v, 'H2')
    const judged = filingButtons(v, lie!)
    expect(judged.map((b) => [b.verdict, b.current, b.disabled])).toEqual([
      ['accurate', false, false],
      ['lie', true, false],
      ['uncertain', false, false],
    ])
    expect(judged[0]!.title).toBe('Override: accurate (judged lie)')
    expect(judged[1]!.title).toMatch(/already on record/)
    expect(filingButtons(v, marked!)).toEqual([])
    // A pending (review) filing outlines the proposal and reads Confirm / Override.
    expect(filingButtons(v, pending!).map((b) => [b.verdict, b.current, b.title])).toEqual([
      ['accurate', false, 'Override: accurate'],
      ['lie', true, 'Confirm: confident lie'],
      ['uncertain', false, 'Override: uncertain'],
    ])
    // A view with no confirm events greys every button out.
    expect(filingButtons(view({ confirm: null }), lie!).every((b) => b.disabled)).toBe(true)
  })

  it('verdictCall: the confirm event on the filer with the question named, so it judges that filing', () => {
    expect(verdictCall(view(), { person: 'g1', question: 'H2' }, 'accurate')).toEqual({ event: 'fact_accurate', person: 'g1', args: { question: 'H2' } })
    expect(verdictCall(view(), { person: 'g1', question: 'H1' }, 'uncertain')).toEqual({ event: 'fact_uncertain', person: 'g1', args: { question: 'H1' } })
    expect(verdictCall(view({ confirm: null }), { person: 'g1', question: 'H2' }, 'lie')).toBeNull()
  })
})

describe("an agent's queue (wave 11 C6)", () => {
  const mind = (character: string, agentQueue?: unknown) => ({ character, ...(agentQueue !== undefined ? { agentQueue } : {}) }) as unknown as AgentMindSummary
  const trabolta = (extra: Partial<CastSummary> = {}): CastSummary => ({ id: 'Trabolta', faction: null, agent: true, ...extra })

  it('agentQueueOf: the cast row first, then the mind summary, else null', () => {
    const q = { depth: 2, oldestMs: 5000, stalled: false }
    expect(agentQueueOf('Trabolta', [trabolta({ agentQueue: q })], [])).toEqual(q)
    expect(agentQueueOf('Trabolta', [trabolta()], [mind('Trabolta', { depth: 1, oldestMs: null, stalled: true })])).toEqual({ depth: 1, oldestMs: null, stalled: true })
    expect(agentQueueOf('Trabolta', [trabolta()], [mind('Trabolta')])).toBeNull()
    expect(agentQueueOf('Trabolta', [], [mind('Trabolta', { depth: 'x' })])).toBeNull()
  })

  it('agentQueueOf with a clock: the wait ages between snapshots from when it arrived', () => {
    const q = { depth: 2, oldestMs: 3000, stalled: false, receivedAt: 1_000_000 }
    const cast = [trabolta({ agentQueue: q })]
    // a quiet minute with no new snapshot: 0:03 is now 1:03, ⚠ slow
    const aged = agentQueueOf('Trabolta', cast, [], 1_060_000)!
    expect(aged.oldestMs).toBe(63_000)
    expect(queueBadge(aged)).toMatchObject({ text: '⚠ 2 waiting · oldest 1:03', tone: QueueTone.Slow })
    // no clock / no stamp / an empty queue: as sent
    expect(agentQueueOf('Trabolta', cast, [])!.oldestMs).toBe(3000)
    expect(agentQueueOf('Trabolta', [{ ...cast[0]!, agentQueue: { depth: 2, oldestMs: 3000, stalled: false } }], [], 1_060_000)!.oldestMs).toBe(3000)
    expect(agentQueueOf('Trabolta', [{ ...cast[0]!, agentQueue: { depth: 0, oldestMs: null, stalled: false, receivedAt: 1 } }], [], 1_060_000)!.oldestMs).toBeNull()
    // a clock behind the stamp never ages it backwards
    expect(agentQueueOf('Trabolta', cast, [], 999_000)!.oldestMs).toBe(3000)
  })

  it('stampAgentQueues: a new queue is stamped now; one a patch left alone keeps its stamp', () => {
    const row = (agentQueue?: AgentQueue): CastSummary => ({ id: 'Trabolta', faction: null, agent: true, ...(agentQueue ? { agentQueue } : {}) })
    const first = stampAgentQueues([row({ depth: 1, oldestMs: 2000, stalled: false }), { id: 'Clippy', faction: null }], [], 500)
    expect(first[0]!.agentQueue!.receivedAt).toBe(500)
    expect(first[1]).toEqual({ id: 'Clippy', faction: null })
    // the same queue again (an unrelated patch): still the first arrival
    expect(stampAgentQueues([row({ depth: 1, oldestMs: 2000, stalled: false })], first, 9000)[0]!.agentQueue!.receivedAt).toBe(500)
    // a re-sent queue (a fresh oldestMs): stamped again
    expect(stampAgentQueues([row({ depth: 1, oldestMs: 10_500, stalled: false })], first, 9000)[0]!.agentQueue!.receivedAt).toBe(9000)
    expect(stampAgentQueues([row()], first, 9000)[0]!.agentQueue).toBeUndefined()
  })

  it('queueBadge: empty, waiting, slow past the busy line, stalled', () => {
    expect(queueBadge({ depth: 0, oldestMs: null, stalled: false })).toMatchObject({ text: 'queue empty', tone: QueueTone.Idle })
    expect(queueBadge({ depth: 3, oldestMs: 12_000, stalled: false })).toMatchObject({ text: '3 waiting · oldest 0:12', tone: QueueTone.Waiting })
    expect(queueBadge({ depth: 3, oldestMs: QUEUE_SLOW_MS + 40_000, stalled: false })).toMatchObject({ text: '⚠ 3 waiting · oldest 1:20', tone: QueueTone.Slow })
    expect(queueBadge({ depth: 4, oldestMs: 95_000, stalled: true })).toMatchObject({ text: '⛔ stalled · 4 waiting · oldest 1:35', tone: QueueTone.Stalled })
    expect(waitText(61_400)).toBe('1:01')
  })
})


describe('the Judging mode tooltip (wave 11 C6, wave 18b O4)', () => {
  it('auto names the near-miss exception; review says a near miss waits too', () => {
    expect(judgeModeTitle('auto')).toMatch(/at once, except a near miss/u)
    expect(judgeModeTitle('review')).toMatch(/near miss waits here/u)
  })

  it('with a judge: character, auto says the house takes exact matches and he rules the rest', () => {
    expect(judgeModeTitle('auto', 'Trabolta')).toBe(
      "The house accepts exact matches; Trabolta rules every other filing; what he can't rule (no worker, a stall, an expired or unfinished ruling) falls back to the house rule and can be judged here.",
    )
    expect(judgeModeTitle('review', 'Trabolta')).toMatch(/near miss waits here/u)
  })
})

// ---------------------------------------------------------------------------
// Wave 12 (CONTRACTS C6.7): the story mind's report, labels, controls, trace
// ---------------------------------------------------------------------------

/** A thought carrying fields the base core types don't name yet. */
const wide = (over: Record<string, unknown>): AgentThought => thought(over as Partial<AgentThought>)
/** A mind report carrying the new optional fields. */
const wideMind = (over: Record<string, unknown>): AgentMindSummary => mind(over as Partial<AgentMindSummary>)

describe('wave 12 kinds: brief and summary', () => {
  it('labels both new kinds and falls back for a kind nobody knows', () => {
    expect(KIND_META['brief']).toMatchObject({ label: 'brief', who: 'mind' })
    expect(KIND_META['summary']).toMatchObject({ label: 'summary', who: 'mind' })
    expect(ALL_KINDS).toEqual(expect.arrayContaining(['brief', 'summary', 'voice', 'judge']))
    expect(kindMeta('voice')).toBe(KIND_META['voice'])
    expect(kindMeta('dream')).toEqual({ label: 'dream', who: 'mind', color: '#a1a1aa' })
  })
  it('summarises a Rewrite brief, a quiet summary and an unknown kind', () => {
    expect(summarizeThought(wide({ kind: 'brief', result: { brief: 'Be delighted by every offer.\nFile it.' } }))).toBe('rewrote the brief: “Be delighted by every offer.”')
    expect(summarizeThought(wide({ kind: 'brief', result: null, note: 'kept the brief' }))).toBe('kept the brief')
    expect(summarizeThought(wide({ kind: 'summary', result: { summary: 'Ada offered two facts and laughed.' } }))).toBe('summed up Ada: “Ada offered two facts and laughed.”')
    expect(summarizeThought(wide({ kind: 'summary', result: {}, note: '' }))).toBe('no summary kept')
    expect(summarizeThought(wide({ kind: 'dream', note: '', trigger: 'quiet' }))).toBe('quiet')
  })
  it('filters on the new kinds like any other', () => {
    const rows = [thought(), wide({ id: 'th-b', kind: 'brief' }), wide({ id: 'th-s', kind: 'summary' })]
    expect(filterThoughts(rows, { character: null, kinds: new Set(['brief', 'summary']), person: null, query: '' }).map((t) => t.id)).toEqual(['th-b', 'th-s'])
  })
})

describe('wave 12 report fields', () => {
  it('reads the mode and the phase, absent on an older worker', () => {
    expect(mindModeOf(mind())).toBeNull()
    expect(isNewMind(mind())).toBe(false)
    expect(isNewMind(null)).toBe(false)
    expect(mindModeOf(wideMind({ mode: 'new' }))).toBe('new')
    expect(isNewMind(wideMind({ mode: 'new' }))).toBe(true)
    expect(isNewMind(wideMind({ mode: 'classic' }))).toBe(false)
    expect(mindModeOf(wideMind({ mode: 'odd' }))).toBeNull()
    expect(mindPhaseOf(mind())).toBeNull()
    expect(mindPhaseOf(wideMind({ phase: 'hunt_1' }))).toBe('hunt_1')
    expect(mindPhaseOf(wideMind({ phase: '  ' }))).toBeNull()
  })
  it('says who moves the stage: the story, or a director by hand under stage_from_phase off', () => {
    expect(stageFromPhase(mind())).toBe(false)
    expect(stageFromPhase(wideMind({ mode: 'classic' }))).toBe(false)
    expect(stageFromPhase(wideMind({ mode: 'new' }))).toBe(true)
    expect(stageFromPhase(wideMind({ mode: 'new', status: { stageFromPhase: true } }))).toBe(true)
    const byHand = wideMind({ mode: 'new', status: { stageFromPhase: false } })
    expect(stageFromPhase(byHand)).toBe(false)
    expect(stagePrompt(mind())).toBe('Why? (goes into the stage history)')
    expect(stagePrompt(wideMind({ mode: 'new' }))).toContain('when the story sets it again (unless stage_from_phase is off')
    expect(stagePrompt(byHand)).toContain('moves only by hand')
    expect(stagePrompt(byHand)).not.toContain('the story sets it again')
    expect(phaseTitle(mind())).toBe('Night.phase, as the worker last read it')
    expect(phaseTitle(wideMind({ mode: 'new' }))).toContain("phase table sets the stage")
    expect(phaseTitle(byHand)).toContain('step the stage by hand')
  })
  it('labels who set a field (C6.2)', () => {
    expect(byLabel('story')).toBe('set by story')
    expect(byLabel('director')).toBe('set by director')
    expect(byLabel('reset')).toBe('reset')
    expect(byLabel('reflect')).toBe('reflect')
    expect(byLabel('survey')).toBe('survey')
  })
  it('reads any `by` the worker does not write for itself as a director, by name or not', () => {
    // A base or classic worker (and a half-merged story mind) writes the
    // director's own name; the story mind writes `director`.
    expect(byLabel('Ada Lovelace')).toBe('set by director')
    expect(byTitle('Ada Lovelace')).toBe('Ada Lovelace')
    expect(byTitle('director')).toBeUndefined()
    for (const own of ['story', 'reflect', 'survey', 'rerun', 'reset', 'server', 'agent:Trabolta', '']) {
      expect(isDirectorBy(own)).toBe(false)
      expect(byTitle(own)).toBeUndefined()
    }
    expect(byLabel('rerun')).toBe('rerun')
    expect(byLabel('agent:Trabolta')).toBe('agent:Trabolta')
    // A reset revision reads as a reset whoever pressed it.
    expect(byLabel('Ada Lovelace', ['reset'])).toBe('reset')
    expect(byLabel('server', ['reset'])).toBe('reset')
  })
  it('labels a brief a named director set, from briefBy or the revisions', () => {
    const rev = (n: number, by: string, touched: string[]) => ({ rev: n, at: n, by, touched, thought: null, brief: '', mood: '', stage: '', drives: {}, policy_favours: 'none', notes: 0, people: 0, learned: 0 })
    expect(briefLabel(mind({ revisions: [rev(1, 'story', ['brief']), rev(2, 'Ada Lovelace', ['brief'])] }))).toBe('set by director')
    expect(briefLabel(wideMind({ briefBy: 'Ada Lovelace' }))).toBe('set by director')
    expect(briefLabel(mind({ revisions: [rev(1, 'reflect', ['brief'])] }))).toBeNull()
  })
  it('says who set the brief: briefBy, else the newest brief revision by the story or a director', () => {
    expect(briefLabel(wideMind({ briefBy: 'story' }))).toBe('set by story')
    expect(briefLabel(wideMind({ briefBy: 'director' }))).toBe('set by director')
    const rev = (n: number, by: string, touched: string[]) => ({ rev: n, at: n, by, touched, thought: null, brief: '', mood: '', stage: '', drives: {}, policy_favours: 'none', notes: 0, people: 0, learned: 0 })
    expect(briefLabel(mind({ revisions: [rev(1, 'story', ['brief']), rev(2, 'director', ['brief', 'mood']), rev(3, 'story', ['stage'])] }))).toBe('set by director')
    expect(briefLabel(mind({ revisions: [rev(1, 'director', ['brief']), rev(2, 'story', ['brief'])] }))).toBe('set by story')
    // An older worker's reflect-written brief keeps today's unlabelled panel.
    expect(briefLabel(mind())).toBeNull()
    expect(briefLabel(mind({ revisions: [] }))).toBeNull()
  })
  it('passes a person file\'s new fields only when present and well-typed', () => {
    const base = { id: 'g1', name: 'Ada', kind: 'guest', summary: '', trust: 50, promises: [], asks: [], claims: [], turns: 3, lastSeen: 9 }
    expect(personExtras(base)).toEqual({})
    const full = personExtras({
      ...base,
      memos: [{ at: 5, text: 'Ada collects old mice.', by: 'voice', heart: false }, { at: 6, text: 'Came to the heart.', by: 'voice', heart: true }, { at: 7 }],
      firstMet: 'First met during hunt_1 in The Desktop.',
      gifts: ['The Sandy File'],
      filings: ['H2', 'H5'],
      marked: true,
      chart: '3 of 12; you named them Most Trusted',
      storyTrust: '62',
    } as typeof base)
    expect(full).toEqual({
      memos: [{ at: 5, text: 'Ada collects old mice.', by: 'voice', heart: false }, { at: 6, text: 'Came to the heart.', by: 'voice', heart: true }],
      firstMet: 'First met during hunt_1 in The Desktop.',
      gifts: ['The Sandy File'],
      filings: ['H2', 'H5'],
      marked: true,
      chart: '3 of 12; you named them Most Trusted',
      storyTrust: '62',
    })
    expect(personExtras({ ...base, chart: null, storyTrust: null } as typeof base)).toEqual({ chart: null, storyTrust: null })
    expect(personExtras({ ...base, gifts: [1, 2], marked: 'yes', firstMet: 3 } as unknown as typeof base)).toEqual({})
  })
  it('labels a memo by voice, with 🫀 at his heart', () => {
    expect(memoLabel({ at: 1, text: 'x', by: 'voice', heart: false })).toBe('memo by voice')
    expect(memoLabel({ at: 1, text: 'x', by: 'voice', heart: true })).toBe('🫀 memo by voice')
  })
})

describe('wave 12 trace: prompt_ms and the stored-once prefix', () => {
  it('shows prompt_ms next to ms when the worker sends it', () => {
    expect(promptMsOf(thought())).toBeNull()
    expect(timingText(thought())).toBe('1.2 s')
    expect(promptMsOf(wide({ prompt_ms: 312.6 }))).toBe(312.6)
    expect(timingText(wide({ prompt_ms: 312.6 }))).toBe('1.2 s (prompt 313 ms)')
    expect(timingText(wide({ prompt_ms: 0 }))).toBe('1.2 s (prompt 0 ms)')
    expect(timingText(wide({ prompt_ms: null }))).toBe('1.2 s')
    expect(timingText(wide({ prompt_ms: 'fast' }))).toBe('1.2 s')
    expect(timingText(wide({ ms: 0, prompt_ms: 40 }))).toBe('prompt 40 ms')
  })
  it('recognises exactly `[same prefix as th-<10 hex>]`', () => {
    expect(prefixRef('[same prefix as th-0123456789]')).toBe('th-0123456789')
    expect(prefixRef('[same prefix as th-abcdef0123]')).toBe('th-abcdef0123')
    expect(prefixRef(' [same prefix as th-abcdef0123]')).toBeNull()
    expect(prefixRef('[same prefix as th-abc]')).toBeNull()
    expect(prefixRef('[same prefix as th-ABCDEF0123]')).toBeNull()
    expect(prefixRef('You are Trabolta.')).toBeNull()
  })
  it('finds the full prefix among the loaded thoughts, never another reference', () => {
    const full = wide({ id: 'th-aaaaaaaaaa', messages: [{ role: 'system', content: 'P1: who he is' }] })
    const ref = wide({ id: 'th-bbbbbbbbbb', messages: [{ role: 'system', content: '[same prefix as th-aaaaaaaaaa]' }] })
    expect(localPrefix('th-aaaaaaaaaa', [full, ref])).toBe('P1: who he is')
    expect(localPrefix('th-bbbbbbbbbb', [full, ref])).toBeNull()
    expect(localPrefix('th-cccccccccc', [full, ref])).toBeNull()
  })
  it('loads a thought by id from the existing trace route', async () => {
    const calls: string[] = []
    const ok = (async (url: string) => {
      calls.push(url)
      return new Response(JSON.stringify({ thought: thought({ id: 'th-aaaaaaaaaa' }) }), { status: 200 })
    }) as unknown as typeof fetch
    expect((await fetchThought('ev 1', 'th-aaaaaaaaaa', ok))?.id).toBe('th-aaaaaaaaaa')
    expect(calls).toEqual(['/e/ev%201/api/mod/agent/trace?id=th-aaaaaaaaaa'])
    // A server on another origin (VITE_LOOM_API), like every other mod call.
    await fetchThought('ev', 'th-aaaaaaaaaa', ok, 'https://loom.example')
    expect(calls[1]).toBe('https://loom.example/e/ev/api/mod/agent/trace?id=th-aaaaaaaaaa')
    const missing = (async () => new Response(JSON.stringify({ error: 'no such thought' }), { status: 404 })) as unknown as typeof fetch
    expect(await fetchThought('ev', 'th-aaaaaaaaaa', missing)).toBeNull()
    const down = (async () => new Response('', { status: 502 })) as unknown as typeof fetch
    await expect(fetchThought('ev', 'th-aaaaaaaaaa', down)).rejects.toThrow('trace 502')
  })
})

describe('wave 12 controls', () => {
  it('Survey now becomes Rewrite brief on the new mind only', () => {
    expect(surveyButton(mind(), 'Trabolta')).toEqual({ label: 'Survey now', title: 'Make the orchestrator look at the house now', control: { action: 'survey', character: 'Trabolta' } })
    expect(surveyButton(null, 'Trabolta').control.action).toBe('survey')
    expect(surveyButton(wideMind({ mode: 'classic' }), 'Trabolta').label).toBe('Survey now')
    expect(surveyButton(wideMind({ mode: 'new' }), 'Trabolta')).toEqual({ label: 'Rewrite brief', title: 'Rewrite his brief from the phase and the house now (one voice call)', control: { action: 'rewrite', character: 'Trabolta' } })
  })
  it('selects send only on a real change', () => {
    expect(favoursControl(mind(), 'earned')).toBeNull()
    expect(favoursControl(mind(), 'loose')).toEqual({ action: 'set', character: 'Trabolta', field: 'policy', value: { favours: 'loose' } })
    expect(effortControl('Trabolta', 'low', 'low')).toBeNull()
    expect(effortControl('Trabolta', 'high', 'low')).toEqual({ action: 'effort', character: 'Trabolta', level: 'high' })
    expect(driveControl(mind(), 'hunger', 80)).toEqual({ action: 'set', character: 'Trabolta', field: 'drive', name: 'hunger', value: 80 })
  })

  /** Run a slider through events; collect what it sends. */
  function drive(events: SliderEvent[], live: number, from: SliderState = SLIDER_IDLE): { sends: number[]; state: SliderState } {
    let state = from
    const sends: number[] = []
    for (const ev of events) {
      const r = sliderStep(state, ev, live)
      state = r.state
      if (r.send !== null) sends.push(r.send)
    }
    return { sends, state }
  }

  it('one drag sends one control, on release', () => {
    const drag: SliderEvent[] = Array.from({ length: 145 }, (_, i) => ({ type: 'change', value: 70 - Math.round((i * 30) / 144) }))
    expect(drive(drag, 70).sends).toEqual([])
    const { sends, state } = drive([...drag, { type: 'pointerup' }, { type: 'blur' }], 70)
    expect(sends).toEqual([40])
    expect(state).toEqual({ local: 40, sent: 40 })
  })
  it('the keyboard commits on an arrow / Home / End / Page key up, not on other keys', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(SLIDER_COMMIT_KEYS.has(key)).toBe(true)
      expect(drive([{ type: 'change', value: 71 }, { type: 'change', value: 72 }, { type: 'keyup', key }], 70).sends).toEqual([72])
    }
    expect(drive([{ type: 'change', value: 72 }, { type: 'keyup', key: 'Shift' }, { type: 'keyup', key: 'Tab' }], 70).sends).toEqual([])
    expect(drive([{ type: 'change', value: 72 }, { type: 'keyup', key: 'Tab' }, { type: 'blur' }], 70).sends).toEqual([72])
  })
  it('sends nothing when the value ends where the mind already is, or on a bare release', () => {
    expect(drive([{ type: 'change', value: 90 }, { type: 'change', value: 70 }, { type: 'pointerup' }], 70)).toEqual({ sends: [], state: SLIDER_IDLE })
    expect(drive([{ type: 'pointerup' }, { type: 'blur' }, { type: 'keyup', key: 'ArrowUp' }], 70).sends).toEqual([])
  })
  it('a second drag before the mirror lands sends again; the same value twice does not', () => {
    const first = drive([{ type: 'change', value: 50 }, { type: 'pointerup' }], 70)
    expect(drive([{ type: 'change', value: 55 }, { type: 'pointerup' }], 70, first.state).sends).toEqual([55])
    expect(drive([{ type: 'change', value: 50 }, { type: 'pointerup' }], 70, first.state).sends).toEqual([])
  })

  /** DriveSlider's whole loop but the grace timer: each step is one event
   *  at the mirrored value `live` the component would render with. */
  function slide(steps: Array<[SliderEvent, number]>): { sends: number[]; held: SliderHold | null } {
    let held: SliderHold | null = null
    const sends: number[] = []
    for (const [ev, live] of steps) {
      const r = sliderHold(held, ev, live)
      held = r.held
      if (r.send !== null) sends.push(r.send)
    }
    return { sends, held }
  }
  const change = (value: number): SliderEvent => ({ type: 'change', value })

  it('DriveSlider: one drag, then the mirror landing, sends one control and goes idle', () => {
    const drag = Array.from({ length: 145 }, (_, i): [SliderEvent, number] => [change(70 - Math.round((i * 30) / 144)), 70])
    const { sends, held } = slide([...drag, [{ type: 'pointerup' }, 70], [{ type: 'blur' }, 70]])
    expect(sends).toEqual([40])
    expect(heldState(held, 70)).toEqual({ local: 40, sent: 40 })
    // The worker's mirror echoes 40: the hold lapses and the slider shows the mirror.
    expect(heldState(held, 40)).toEqual(SLIDER_IDLE)
    expect(sliderHold(held, { type: 'blur' }, 40)).toEqual({ held: null, send: null })
  })
  it('DriveSlider: a mirror that moves under a drag drops the stale hold', () => {
    // Someone else sets the drive to 55 mid-drag; the director's next move
    // starts from there and its release sends once.
    const r = slide([[change(65), 70], [change(60), 70], [change(58), 55], [{ type: 'pointerup' }, 55], [{ type: 'blur' }, 55]])
    expect(r.sends).toEqual([58])
    // A release landing right after the mirror moved away sends nothing stale.
    expect(slide([[change(65), 70], [{ type: 'pointerup' }, 55]]).sends).toEqual([])
    // Dragging back to where the mirror already is sends nothing and idles.
    expect(slide([[change(65), 70], [change(70), 70], [{ type: 'pointerup' }, 70]])).toEqual({ sends: [], held: null })
  })
})

// ---------------------------------------------------------------------------
// Fixture renders (C6.7): the trabolta/answers report as an old worker sends
// it renders as before; a new-mode report shows the new labels and controls.
// ---------------------------------------------------------------------------

/** A Trabolta report exactly as the trabolta/answers worker mirrors it
 *  (after the server's sanitiser): no mode, no phase, no briefBy, files with
 *  a worker trust and no story fields. */
function answersReport(): AgentMindSummary {
  return mind({
    brief: 'You are hungry for facts tonight.',
    status: { worker: 'laptop', voice: { model: 'gpt-oss:20b', effort: 'low' }, mind: { model: 'qwen-distill', thinking: false, paused: false, pending: [] } },
    people: [{ id: 'g1', name: 'Ada', kind: 'guest', summary: 'Offered two facts.', trust: 64, promises: [], asks: [], claims: ['Clippy is lying'], turns: 4, lastSeen: 90 }],
    learned: [{ claim: 'Clippy is lying', from: 'Ada', verdict: 'rumour' }],
  })
}

/** The same character on a new worker (mind_mode: new). */
function newModeReport(): AgentMindSummary {
  const rev = (n: number, by: string, touched: string[]) => ({ rev: n, at: 100 + n, by, touched, thought: null, brief: '', mood: '', stage: 'appetite', drives: { hunger: 60 + n, suspicion: 50 }, policy_favours: 'earned', notes: 0, people: 1, learned: 0 })
  return wideMind({
    mode: 'new',
    phase: 'hunt_1',
    briefBy: 'story',
    brief: 'Every fact offered is a gift.',
    stageHistory: [{ stage: 'appetite', at: 101, why: 'phase hunt_1', by: 'story', rev: 1 }],
    learned: [],
    world: [],
    questions: [],
    revisions: [rev(1, 'story', ['stage', 'brief', 'drives']), rev(2, 'director', ['drives'])],
    status: { worker: 'laptop', mindMode: 'new', voice: { model: 'gpt-oss:20b', effort: 'low', memo: true, repeatGuard: true, layout: 'lean' }, mind: { paused: false }, phaseWatchS: 30 },
    people: [
      {
        id: 'g1', name: 'Ada', kind: 'guest', summary: '', trust: 50, promises: [], asks: [], claims: [], turns: 4, lastSeen: 90,
        memos: [{ at: 80, text: 'Ada brings him old mice.', by: 'voice', heart: false }, { at: 85, text: 'She came to the heart.', by: 'voice', heart: true }],
        firstMet: 'First met during hunt_1 in The Desktop.',
        gifts: ['The Sandy File'],
        filings: ['H2'],
        marked: true,
        chart: '3 of 12; you named them Most Trusted',
        storyTrust: '62',
      },
    ],
  })
}

function render(state: Partial<CockpitState>, el: (props: never) => ReactNode = MindTab, props: Record<string, unknown> = {}): string {
  const store = create<CockpitState>(() => ({ ...nullCockpit.getState(), ...state }))
  const component = el as unknown as FunctionComponent<Record<string, unknown>>
  return renderToStaticMarkup(createElement(CockpitContext.Provider, { value: store }, createElement(component, props)))
}

describe('Mind page fixtures (wave 12)', () => {
  it('renders the trabolta/answers report as before: Survey now, the orchestrator, worker trust, no new labels', () => {
    const html = render({ minds: [answersReport()], thoughts: [thought()] })
    expect(html).toContain('Survey now')
    expect(html).not.toContain('Rewrite brief')
    expect(html).toContain('Mind reasoning off')
    expect(html).toContain('Pause mind')
    expect(html).toContain('qwen-distill')
    expect(html).toContain('2 exchanges · 2 reflections · 1 surveys · rev 2')
    expect(html).toContain('trust 64/100')
    expect(html).toContain('Fed to him, and what he made of it')
    expect(html).toContain('(reflect)')
    expect(html).not.toContain('set by')
    expect(html).not.toContain('memo')
    expect(html).not.toContain('the house&#x27;s trust')
    expect(html).not.toContain('data-testid="mind-mode"')
    expect(html).not.toContain('(prompt ')
    // The story mind's kinds get no chip on an old worker's trace.
    expect(html).toContain('data-testid="mind-kind-voice"')
    expect(html).toContain('data-testid="mind-kind-reflect"')
    expect(html).not.toContain('data-testid="mind-kind-brief"')
    expect(html).not.toContain('data-testid="mind-kind-summary"')
  })
  it('renders a new-mode report: Rewrite brief, the story mind, by-story labels, the house\'s trust and ⛔', () => {
    const html = render({ minds: [newModeReport()], thoughts: [wide({ kind: 'brief', result: { brief: 'Be delighted.' }, prompt_ms: 300 })] })
    expect(html).toContain('Rewrite brief')
    expect(html).not.toContain('Survey now')
    expect(html).not.toContain('Mind reasoning')
    // Pause freezes the orchestrator, which the story mind never starts.
    expect(html).not.toContain('data-testid="mind-pause"')
    expect(html).toContain('data-testid="mind-mode"')
    expect(html).toContain('layout lean · memo on · repeat guard on · phase watch 30 s')
    expect(html).toContain('2 exchanges · rev 2 · phase hunt_1')
    expect(html).toContain('phase hunt_1')
    expect(html).toMatch(/data-testid="mind-brief-by"[^>]*>set by story</)
    expect(html).toContain('(set by story)')
    expect(html).toMatch(/data-testid="mind-revision-by"[^>]*>set by director</)
    expect(html).toContain('the house&#x27;s trust <span class="font-mono text-zinc-200">62</span>')
    expect(html).toContain('data-testid="mind-person-marked"')
    expect(html).toContain('2 memos')
    expect(html).not.toContain('Fed to him')
    expect(html).not.toContain('Collecting answers to')
    expect(html).not.toContain('trust 50/100')
    expect(html).toContain('rewrote the brief: “Be delighted.”')
    expect(html).toContain('1.2 s (prompt 300 ms)')
    expect(html).toContain('data-testid="mind-kind-brief"')
    expect(html).toContain('data-testid="mind-kind-summary"')
    expect(html).not.toContain('stage by hand')
  })
  it('a story mind with stage_from_phase off says the stage moves by hand', () => {
    const m = newModeReport()
    const html = render({ minds: [{ ...m, status: { ...(m.status as Record<string, unknown>), stageFromPhase: false } } as AgentMindSummary] })
    expect(html).toMatch(/data-testid="mind-phase">phase hunt_1 · stage by hand</)
  })
  it('a brief or summary chip shows on any worker once such a thought is loaded', () => {
    expect(kindChips([thought()], false)).not.toContain('brief')
    expect(kindChips([thought()], false)).toEqual(ALL_KINDS.filter((k) => k !== 'brief' && k !== 'summary'))
    expect(kindChips([wide({ kind: 'summary' })], false)).toContain('summary')
    expect(kindChips([wide({ kind: 'summary' })], false)).not.toContain('brief')
    expect(kindChips([], true)).toEqual(ALL_KINDS)
  })
  it('names a director who edited an old worker\'s mind: set by director, the name on hover', () => {
    const rev = (n: number, by: string, touched: string[]) => ({ rev: n, at: 100 + n, by, touched, thought: null, brief: '', mood: '', stage: 'appetite', drives: {}, policy_favours: 'earned', notes: 0, people: 1, learned: 0 })
    const m = mind({
      ...answersReport(),
      stageHistory: [{ stage: 'appetite', at: 50, why: 'we skipped ahead', by: 'Ada Lovelace', rev: 2 }],
      revisions: [rev(1, 'reflect', ['brief']), rev(2, 'Ada Lovelace', ['stage']), rev(3, 'Ada Lovelace', ['reset'])],
    })
    const html = render({ minds: [m], thoughts: [thought()] })
    expect(html).toContain('(set by director)')
    expect(html).toContain('title="Ada Lovelace"')
    expect(html).toMatch(/title="Ada Lovelace" data-testid="mind-revision-by"[^>]*>set by director</)
    expect(html).toMatch(/title="Ada Lovelace" data-testid="mind-revision-by"[^>]*>reset</)
    expect(html).not.toContain('>Ada Lovelace<')
  })
  it('a story mind a classic run left paused can still be resumed', () => {
    const m = newModeReport()
    const html = render({ minds: [{ ...m, status: { ...(m.status as Record<string, unknown>), mind: { paused: true } } } as AgentMindSummary] })
    expect(html).toMatch(/data-testid="mind-pause"[^>]*>Resume mind</)
  })
  it('opens a new-mode file: first met, memos by voice (🫀 at the heart), gifts, filings, the chart, no Set trust', () => {
    const m = newModeReport()
    const html = render({ minds: [m] }, PersonFile, { mind: m, person: m.people[0] })
    expect(html).toContain('First met during hunt_1 in The Desktop.')
    expect(html).toContain('memo by voice')
    expect(html).toContain('🫀 memo by voice')
    expect(html).toContain('She came to the heart.')
    expect(html).toContain('“The Sandy File”')
    expect(html).toContain('H2')
    expect(html).toContain('3 of 12; you named them Most Trusted')
    expect(html).toContain('the house&#x27;s trust')
    expect(html).not.toContain('Set trust')
    expect(html).toContain('Forget')
  })
  it('an old file opens as before, with Set trust', () => {
    const m = answersReport()
    const html = render({ minds: [m] }, PersonFile, { mind: m, person: m.people[0] })
    expect(html).toContain('Set trust')
    expect(html).toContain('told him:')
    expect(html).not.toContain('memo')
    expect(html).not.toContain('first met')
  })
  it('a stored-once prefix shows as a button; any other message as text', () => {
    const html = render({}, Messages, { messages: [{ role: 'system', content: '[same prefix as th-0123456789]' }, { role: 'user', content: 'Ada: hello' }] })
    expect(html).toContain('data-testid="mind-prefix-load"')
    expect(html).toMatch(/same prefix as <span class="font-mono">th-0123456789<\/span>/)
    expect(html).toContain('Ada: hello')
    expect(render({}, Messages, { messages: [{ role: 'system', content: 'You are Trabolta.' }] })).not.toContain('mind-prefix')
  })
})
