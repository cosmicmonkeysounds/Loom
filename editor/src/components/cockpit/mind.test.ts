import { describe, expect, it } from 'vitest'
import type { AgentMindSummary, AgentThought } from '@loom/core/views'
import { agentQueueOf, confirmEvent, diffRows, driveSeries, filingButtons, filterThoughts, judgeModeOf, mindCharacters, nearCount, nearKeyOf, pendingFilings, pickMind, questionFilings, questionTallies, queueBadge, QUEUE_SLOW_MS, QueueTone, sparklinePath, speakersOf, stageSegments, summarizeThought, verdictCall, waitText } from './mind'
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
  }
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

  it('pendingFilings: only unsettled filings, oldest first', () => {
    expect(pendingFilings(view()).map((r) => [r.name, r.question, r.proposed, r.at])).toEqual([
      ['Ben', 'Q1', 'lie', 20],
      ['Ada', 'Q1', 'accurate', 30],
    ])
    expect(pendingFilings(view())[0]).toEqual({ person: 'g2', name: 'Ben', question: 'Q1', answer: 'twelve', confidence: 100, proposed: 'lie', final: null, at: 20, near: null })
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
    expect(questionFilings(v, 'Q1')[0]).toEqual({ person: 'g2', name: 'Ben', answer: 'eleven', confidence: 100, proposed: 'lie', final: 'accurate', how: 'overridden', by: null, at: 10, near: null })
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

  it('agentQueueOf: the cast row first, then the mind summary, else null', () => {
    const q = { depth: 2, oldestMs: 5000, stalled: false }
    expect(agentQueueOf('Trabolta', [{ id: 'Trabolta', faction: null, agent: true, agentQueue: q }], [])).toEqual(q)
    expect(agentQueueOf('Trabolta', [{ id: 'Trabolta', faction: null, agent: true }], [mind('Trabolta', { depth: 1, oldestMs: null, stalled: true })])).toEqual({ depth: 1, oldestMs: null, stalled: true })
    expect(agentQueueOf('Trabolta', [{ id: 'Trabolta', faction: null, agent: true }], [mind('Trabolta')])).toBeNull()
    expect(agentQueueOf('Trabolta', [], [mind('Trabolta', { depth: 'x' })])).toBeNull()
  })

  it('queueBadge: empty, waiting, slow past the busy line, stalled', () => {
    expect(queueBadge({ depth: 0, oldestMs: null, stalled: false })).toMatchObject({ text: 'queue empty', tone: QueueTone.Idle })
    expect(queueBadge({ depth: 3, oldestMs: 12_000, stalled: false })).toMatchObject({ text: '3 waiting · oldest 0:12', tone: QueueTone.Waiting })
    expect(queueBadge({ depth: 3, oldestMs: QUEUE_SLOW_MS + 40_000, stalled: false })).toMatchObject({ text: '⚠ 3 waiting · oldest 1:20', tone: QueueTone.Slow })
    expect(queueBadge({ depth: 4, oldestMs: 95_000, stalled: true })).toMatchObject({ text: '⛔ stalled · 4 waiting · oldest 1:35', tone: QueueTone.Stalled })
    expect(waitText(61_400)).toBe('1:01')
  })
})

