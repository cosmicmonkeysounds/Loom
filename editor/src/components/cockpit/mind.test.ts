import { describe, expect, it } from 'vitest'
import type { AgentMindSummary, AgentThought } from '@loom/core/views'
import { diffRows, driveSeries, filterThoughts, mindCharacters, pickMind, sparklinePath, speakersOf, stageSegments, summarizeThought } from './mind'
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
