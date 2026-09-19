//! Run → Mind: the visual debugger for an agent-voiced character (Trabolta).
//!
//! Left, the **mind now** as the stagehand worker last mirrored it: the
//! arc stepper (where the character is in its declared night, and why it
//! moved), the brief + mood the voice is handed, the drives as sparklines
//! over every revision, the bargain policy, the open questions, notes,
//! what it learned and what it made of it, the dossiers. Right, the
//! **trace**: every model call the worker made — the voice (gpt-oss)
//! answering a line, the orchestrator (Qwen) reflecting or surveying —
//! each opening to the exact input messages, the model's reasoning, its
//! raw output, what the worker parsed, and the diff it made to the mind.
//! Across the top, the **control panel**: reset (the same control the
//! server sends on a restart), survey now, pause/resume the mind, toggle
//! the orchestrator's visible reasoning, the voice's reasoning effort,
//! nudge (a whisper the voice obeys at once and the next reflection
//! folds in), move the stage, set a drive, edit the brief, forget a file.
//!
//! Everything here reads the cockpit contract; the page is inert on the
//! local backend (nothing voices a `mind: external` character in the
//! browser) and says so.

import { Fragment, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { AgentMindSummary, AgentThought } from '@loom/core/views'
import { RunBackend, useCockpit } from '@/store/cockpit'
import { confirmAction, promptText } from '@/store/dialog'
import { LensGate } from './tabs'
import {
  ALL_KINDS,
  KIND_META,
  diffRows,
  driveSeries,
  filterThoughts,
  formatMs,
  mindCharacters,
  pickMind,
  sparklinePath,
  speakersOf,
  stageSegments,
  summarizeThought,
  timeOf,
} from './mind'

const panel = 'rounded-xl border border-zinc-800 p-3'
const heading = 'mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400'
const btn = 'rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40'
const btnPrimary = 'rounded bg-indigo-600 px-2 py-0.5 text-xs text-white hover:bg-indigo-500 disabled:opacity-40'
const input = 'rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500'

export function MindTab() {
  const locked = useCockpit((s) => s.lens !== null)
  const run = useCockpit((s) => s.run)
  if (locked) return <LensGate what="see and steer an agent's mind" />
  if (run !== null && run.backend !== RunBackend.Server) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-sm text-zinc-500" data-testid="mind-local">
        <div className="max-w-md">
          <p className="text-zinc-300">Minds live on a stagehand worker.</p>
          <p className="mt-2">
            An agent-voiced character (<span className="font-mono text-zinc-300">mind: external</span>) is answered by the laptop running
            <span className="font-mono text-zinc-300"> stagehand agents</span> against an event server. This run is in your browser
            {run.scratch ? ' (a scratch run)' : ''}, so there is no worker to watch — open a server project and start its rehearsal.
          </p>
        </div>
      </div>
    )
  }
  return <MindDebugger />
}

function MindDebugger() {
  const minds = useCockpit((s) => s.minds)
  const thoughts = useCockpit((s) => s.thoughts)
  const loadThoughts = useCockpit((s) => s.loadThoughts)
  const [chosen, setChosen] = useState<string | null>(null)
  const characters = useMemo(() => mindCharacters(minds, thoughts), [minds, thoughts])
  const mind = pickMind(minds, chosen)
  const character = mind?.character ?? chosen ?? characters[0] ?? null
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    void loadThoughts(null)
  }, [loadThoughts])

  if (mind === null && thoughts.length === 0) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-sm text-zinc-500" data-testid="mind-empty">
        <div className="max-w-md">
          <p className="text-zinc-300">No agent worker has reported yet.</p>
          <p className="mt-2">
            Start <span className="font-mono text-zinc-300">stagehand run --config laptop.yaml --only agents</span> on the show laptop. Its
            first look at the house and every reply after that will appear here, with the prompts, the models' reasoning, and the
            mind they leave behind.
          </p>
        </div>
      </div>
    )
  }

  const selectedThought = selected === null ? null : (thoughts.find((t) => t.id === selected) ?? null)

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mind-tab">
      <Header characters={characters} character={character} onPick={setChosen} mind={mind} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-h-0 overflow-auto pr-1">
          {mind !== null ? (
            <MindNow mind={mind} onOpenThought={setSelected} />
          ) : (
            <div className="text-sm text-zinc-500">No mind mirrored for {character} yet — the trace on the right is what the worker has recorded.</div>
          )}
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden">
          {selectedThought !== null ? (
            <ThoughtDetail thought={selectedThought} onBack={() => setSelected(null)} />
          ) : (
            <TraceList character={character} thoughts={thoughts} onOpen={setSelected} />
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header: character, worker status, models, the control panel
// ---------------------------------------------------------------------------

function Header({ characters, character, onPick, mind }: { characters: string[]; character: string | null; onPick: (c: string) => void; mind: AgentMindSummary | null }) {
  const status = (mind?.status ?? {}) as Record<string, unknown>
  const voice = (status['voice'] ?? {}) as Record<string, unknown>
  const orch = (status['mind'] ?? {}) as Record<string, unknown>
  const paused = orch['paused'] === true
  const thinking = orch['thinking'] === true
  const pending = Array.isArray(orch['pending']) ? (orch['pending'] as unknown[]).length : 0
  const running = typeof orch['running'] === 'string' ? (orch['running'] as string) : null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800 px-3 py-2 text-xs">
      {characters.length > 1 ? (
        <select value={character ?? ''} onChange={(e) => onPick(e.target.value)} className={input} data-testid="mind-character">
          {characters.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-sm font-semibold text-zinc-100" data-testid="mind-character">
          {character}
        </span>
      )}
      {mind !== null && (
        <>
          <span className="text-zinc-500" title={`worker id ${mind.worker || '—'}`}>
            worker <span className="text-zinc-300">{typeof status['worker'] === 'string' && status['worker'] !== '' ? status['worker'] : mind.worker || '—'}</span> · {timeOf(mind.at / 1000)}
          </span>
          <ModelChip who="voice" name={typeof voice['model'] === 'string' ? voice['model'] : '?'} detail={typeof voice['effort'] === 'string' ? `effort ${voice['effort']}` : 'no reasoning'} />
          <ModelChip who="mind" name={typeof orch['model'] === 'string' ? orch['model'] : '?'} detail={`${thinking ? 'reasoning on' : 'reasoning off'}${paused ? ' · PAUSED' : ''}${running ? ' · thinking…' : pending > 0 ? ` · ${pending} queued` : ''}`} />
          <span className="text-zinc-500" data-testid="mind-counts">
            {mind.exchanges} exchanges · {mind.reflections} reflections · {mind.surveys} surveys · rev {mind.rev}
          </span>
        </>
      )}
      <span className="ml-auto">
        <ControlPanel character={character} mind={mind} />
      </span>
    </div>
  )
}

function ModelChip({ who, name, detail }: { who: 'voice' | 'mind'; name: string; detail: string }) {
  const color = who === 'voice' ? KIND_META.voice.color : KIND_META.reflect.color
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-800 px-2 py-0.5" title={`the ${who} model`}>
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
      <span className="text-zinc-500">{who}</span>
      <span className="font-mono text-zinc-200">{name}</span>
      <span className="text-zinc-500">· {detail}</span>
    </span>
  )
}

function ControlPanel({ character, mind }: { character: string | null; mind: AgentMindSummary | null }) {
  const control = useCockpit((s) => s.mindControl)
  const [nudge, setNudge] = useState('')
  const [busy, setBusy] = useState(false)
  const status = (mind?.status ?? {}) as Record<string, unknown>
  const orch = (status['mind'] ?? {}) as Record<string, unknown>
  const voice = (status['voice'] ?? {}) as Record<string, unknown>
  const paused = orch['paused'] === true
  const thinking = orch['thinking'] === true
  const effort = typeof voice['effort'] === 'string' ? (voice['effort'] as string) : 'none'
  const send = async (c: Parameters<typeof control>[0]) => {
    setBusy(true)
    try {
      await control(c)
    } finally {
      setBusy(false)
    }
  }
  const disabled = busy || character === null
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid="mind-controls">
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          const text = nudge.trim()
          if (text === '' || character === null) return
          setNudge('')
          void send({ action: 'nudge', character, text })
        }}
      >
        <input
          value={nudge}
          onChange={(e) => setNudge(e.target.value)}
          placeholder="whisper to the mind…"
          className={clsx(input, 'w-48')}
          disabled={disabled}
          data-testid="mind-nudge"
          title="A director's nudge: the voice obeys it at once; the next reflection folds it into the brief and clears it"
        />
        <button type="submit" className={btnPrimary} disabled={disabled || nudge.trim() === ''}>
          Nudge
        </button>
      </form>
      <button className={btn} disabled={disabled} onClick={() => void send({ action: 'survey', character })} title="Make the orchestrator look at the house now">
        Survey now
      </button>
      <button className={btn} disabled={disabled} onClick={() => void send({ action: 'pause', character, on: !paused })} title="Pause: replies keep coming, but the mind stops changing">
        {paused ? 'Resume mind' : 'Pause mind'}
      </button>
      <button className={btn} disabled={disabled} onClick={() => void send({ action: 'thinking', character, on: !thinking })} title="Show the orchestrator model's reasoning in the trace (slower)">
        Mind reasoning {thinking ? 'on' : 'off'}
      </button>
      <label className="flex items-center gap-1 text-zinc-500" title="The voice model's reasoning effort (gpt-oss)">
        voice effort
        <select value={effort} disabled={disabled} className={input} onChange={(e) => void send({ action: 'effort', character, level: e.target.value })} data-testid="mind-effort">
          {['none', 'low', 'medium', 'high'].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <button
        className={clsx(btn, 'border-red-900 text-red-300 hover:bg-red-950')}
        disabled={disabled}
        data-testid="mind-reset"
        onClick={() => {
          void (async () => {
            const ok = await confirmAction({
              title: `Reset ${character}'s mind?`,
              body: 'The character goes back to the doors: brief, drives, dossiers, everything learned tonight — gone. The story itself keeps running. (A story restart does this on its own.)',
              confirmLabel: 'Reset the mind',
              danger: true,
            })
            if (ok && character !== null) await send({ action: 'reset', character, reason: 'director' })
          })()
        }}
      >
        Reset mind
      </button>
    </span>
  )
}

// ---------------------------------------------------------------------------
// The mind now
// ---------------------------------------------------------------------------

function MindNow({ mind, onOpenThought }: { mind: AgentMindSummary; onOpenThought: (id: string) => void }) {
  const control = useCockpit((s) => s.mindControl)
  const c = mind.character
  return (
    <div className="flex flex-col gap-3">
      <Arc mind={mind} />
      <section className={panel} data-testid="mind-brief">
        <div className="flex items-center justify-between">
          <div className={heading}>The brief (what the voice is handed)</div>
          <button
            className={btn}
            onClick={() => {
              void (async () => {
                const v = await promptText({ title: `Rewrite ${c}'s brief`, body: 'Second-person instructions to the actor. The next reflection may rewrite it again.', defaultValue: mind.brief, confirmLabel: 'Set brief' })
                if (v !== null) await control({ action: 'set', character: c, field: 'brief', value: v })
              })()
            }}
          >
            Edit
          </button>
        </div>
        {mind.brief === '' ? <p className="text-xs text-zinc-600">None yet — the character is as the persona describes.</p> : <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200">{mind.brief}</pre>}
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
          <span>
            mood <span className="text-zinc-200">{mind.mood || '—'}</span>
          </span>
          {mind.director.length > 0 && (
            <span className="text-amber-300" data-testid="mind-whispers">
              whispers pending: {mind.director.join(' / ')}
            </span>
          )}
        </div>
      </section>
      <Drives mind={mind} />
      <Policy mind={mind} />
      <Questions mind={mind} />
      <section className={panel} data-testid="mind-notes">
        <div className={heading}>Decided / noticed</div>
        {mind.notes.length === 0 ? (
          <p className="text-xs text-zinc-600">Nothing yet.</p>
        ) : (
          <ul className="space-y-1 text-sm text-zinc-200">
            {mind.notes.map((n) => (
              <li key={n} className="group flex items-start gap-2">
                <span className="text-zinc-600">•</span>
                <span className="flex-1">{n}</span>
                <button className={clsx(btn, 'invisible group-hover:visible')} title="Drop this note" onClick={() => void control({ action: 'set', character: c, field: 'note', drop: n })}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className={clsx(btn, 'mt-2')} onClick={() => void (async () => {
          const v = await promptText({ title: 'Add a note to the mind', placeholder: 'Excel promised me the Coefficient by midnight.' })
          if (v !== null) await control({ action: 'set', character: c, field: 'note', add: v })
        })()}>
          + note
        </button>
      </section>
      <Learned mind={mind} />
      <People mind={mind} />
      {mind.threads.some((t) => t.summary !== '') && (
        <section className={panel}>
          <div className={heading}>Thread summaries</div>
          <ul className="space-y-2 text-xs text-zinc-300">
            {mind.threads
              .filter((t) => t.summary !== '')
              .map((t) => (
                <li key={t.key}>
                  <span className="font-mono text-zinc-500">{t.key}</span> — {t.summary}
                </li>
              ))}
          </ul>
        </section>
      )}
      <Revisions mind={mind} onOpenThought={onOpenThought} />
    </div>
  )
}

function Arc({ mind }: { mind: AgentMindSummary }) {
  const control = useCockpit((s) => s.mindControl)
  const segments = stageSegments(mind)
  if (segments.length === 0) return null
  return (
    <section className={panel} data-testid="mind-arc">
      <div className={heading}>The arc</div>
      <ol className="flex flex-wrap items-stretch gap-1">
        {segments.map((seg, i) => (
          <li key={seg.stage} className="flex items-center gap-1">
            <button
              className={clsx(
                'rounded-lg border px-2 py-1 text-left text-xs',
                seg.state === 'current' ? 'border-indigo-500/60 bg-indigo-950/40 text-zinc-100' : seg.state === 'past' ? 'border-zinc-800 text-zinc-400' : 'border-dashed border-zinc-800 text-zinc-600',
              )}
              title={seg.why !== '' ? `${seg.why}${seg.at !== null ? ` · ${timeOf(seg.at)}` : ''}` : seg.state === 'future' ? 'Click to move the character here' : ''}
              data-testid={`mind-stage-${seg.state}`}
              onClick={() => {
                if (seg.state === 'current') return
                void (async () => {
                  const why = await promptText({ title: `Move ${mind.character} to “${seg.stage}”`, body: 'Why? (goes into the stage history)', placeholder: 'we skipped ahead', allowEmpty: true })
                  if (why !== null) await control({ action: 'set', character: mind.character, field: 'stage', value: seg.stage, why })
                })()
              }}
            >
              <div className="font-medium">{seg.stage}</div>
              {seg.state !== 'future' && seg.at !== null && <div className="text-[10px] text-zinc-500">{timeOf(seg.at)}</div>}
            </button>
            {i < segments.length - 1 && <span className="text-zinc-700">→</span>}
          </li>
        ))}
      </ol>
      {mind.stageHistory.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-zinc-500">
          {mind.stageHistory.slice(-4).map((h) => (
            <li key={`${h.rev}-${h.stage}`}>
              <span className="text-zinc-300">{h.stage}</span> at {timeOf(h.at)} ({h.by}){h.why !== '' && <> — {h.why}</>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Drives({ mind }: { mind: AgentMindSummary }) {
  const control = useCockpit((s) => s.mindControl)
  const series = driveSeries(mind)
  if (series.length === 0) return null
  return (
    <section className={panel} data-testid="mind-drives">
      <div className={heading}>Drives (the mind's own dials, over the night)</div>
      <ul className="space-y-1.5">
        {series.map((d) => (
          <li key={d.name} className="flex items-center gap-2 text-xs">
            <span className="w-24 truncate text-zinc-300">{d.name}</span>
            <svg width={120} height={22} className="shrink-0" role="img" aria-label={`${d.name} over ${d.values.length} revisions`}>
              <path d={sparklinePath(d.values, 120, 22)} fill="none" stroke={KIND_META.reflect.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <input
              type="range"
              min={0}
              max={100}
              value={d.current}
              className="w-24 accent-indigo-500"
              title="Set this drive"
              onChange={(e) => void control({ action: 'set', character: mind.character, field: 'drive', name: d.name, value: Number(e.target.value) })}
            />
            <span className="w-8 text-right font-mono text-zinc-100">{d.current}</span>
            <span className={clsx('w-10 font-mono', d.delta > 0 ? 'text-emerald-400' : d.delta < 0 ? 'text-rose-400' : 'text-zinc-600')}>
              {d.delta > 0 ? '+' : ''}
              {d.delta}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Policy({ mind }: { mind: AgentMindSummary }) {
  const control = useCockpit((s) => s.mindControl)
  const p = mind.policy
  const tone = p.favours === 'loose' ? 'text-amber-300' : p.favours === 'earned' ? 'text-emerald-300' : 'text-zinc-400'
  return (
    <section className={panel} data-testid="mind-policy">
      <div className={heading}>Bargains</div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-500">favours</span>
        <select value={p.favours} className={input} onChange={(e) => void control({ action: 'set', character: mind.character, field: 'policy', value: { favours: e.target.value } })} data-testid="mind-favours">
          {['none', 'earned', 'loose'].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <span className={clsx('font-medium', tone)}>{p.favours === 'none' ? 'unthinkable' : p.favours === 'earned' ? 'only when paid for' : 'generous'}</span>
        {p.credit.length > 0 && (
          <span>
            <span className="text-zinc-500">credit:</span> {p.credit.join(', ')}
          </span>
        )}
        {p.wary.length > 0 && (
          <span>
            <span className="text-zinc-500">wary of:</span> {p.wary.join(', ')}
          </span>
        )}
      </div>
      {p.note !== '' && <p className="mt-1 text-xs text-zinc-400">{p.note}</p>}
    </section>
  )
}

function Questions({ mind }: { mind: AgentMindSummary }) {
  const control = useCockpit((s) => s.mindControl)
  if (mind.questions.length === 0) return null
  return (
    <section className={panel} data-testid="mind-questions">
      <div className={heading}>Collecting answers to</div>
      <ul className="space-y-1.5 text-sm">
        {mind.questions.map((q) => (
          <li key={q.q} className="group">
            <div className="flex items-start gap-2">
              <span className="flex-1 text-zinc-200">{q.q}</span>
              <span className="text-[10px] text-zinc-500">{q.answers.length} answer{q.answers.length === 1 ? '' : 's'}</span>
              <button className={clsx(btn, 'invisible group-hover:visible')} title="Settle this question" onClick={() => void control({ action: 'set', character: mind.character, field: 'question', drop: q.q })}>
                ×
              </button>
            </div>
            {q.answers.length > 0 && (
              <ul className="ml-4 text-xs text-zinc-400">
                {q.answers.map((a) => (
                  <li key={a}>↳ {a}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Learned({ mind }: { mind: AgentMindSummary }) {
  if (mind.learned.length === 0 && mind.world.length === 0) return null
  const verdictTone = (v: string) => (v === 'fact' ? 'text-emerald-300' : v === 'bluster' ? 'text-rose-300' : 'text-zinc-500')
  return (
    <section className={panel} data-testid="mind-learned">
      <div className={heading}>Fed to him, and what he made of it</div>
      <ul className="space-y-1 text-xs">
        {mind.learned.map((e, i) => (
          <li key={`${i}-${e.claim}`} className="flex items-start gap-2">
            <span className={clsx('w-14 shrink-0 font-mono uppercase', verdictTone(e.verdict))}>{e.verdict}</span>
            <span className="text-zinc-200">{e.claim}</span>
            {e.from !== '' && <span className="text-zinc-500">— {e.from}</span>}
          </li>
        ))}
      </ul>
      {mind.world.length > 0 && (
        <p className="mt-2 text-xs text-zinc-500">
          <span className="text-zinc-400">The house, as last noticed:</span> {mind.world.slice(-6).join('; ')}
        </p>
      )}
    </section>
  )
}

function People({ mind }: { mind: AgentMindSummary }) {
  const control = useCockpit((s) => s.mindControl)
  const [open, setOpen] = useState<string | null>(null)
  if (mind.people.length === 0) return null
  return (
    <section className={panel} data-testid="mind-people">
      <div className={heading}>Files on people</div>
      <table className="w-full text-xs">
        <tbody>
          {mind.people.map((p) => (
            <Fragment key={p.id}>
              <tr className="cursor-pointer border-b border-zinc-900 hover:bg-zinc-900/60" onClick={() => setOpen(open === p.id ? null : p.id)}>
                <td className="py-1 pr-2 text-zinc-200">
                  {p.name}
                  {p.kind === 'performer' && <span className="ml-1 text-[10px] text-zinc-500">cast</span>}
                </td>
                <td className="w-28 py-1 pr-2">
                  <div className="h-1.5 w-full rounded bg-zinc-800" title={`trust ${p.trust}/100`}>
                    <div className="h-1.5 rounded bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, p.trust))}%` }} />
                  </div>
                </td>
                <td className="w-8 py-1 pr-2 text-right font-mono text-zinc-300">{p.trust}</td>
                <td className="w-10 py-1 pr-2 text-right text-zinc-500">{p.turns}×</td>
                <td className="max-w-0 truncate py-1 text-zinc-400">{p.summary}</td>
              </tr>
              {open === p.id && (
                <tr className="border-b border-zinc-900">
                  <td colSpan={5} className="space-y-1 py-2 pl-2 text-xs text-zinc-400">
                    {p.summary !== '' && <p className="text-zinc-300">{p.summary}</p>}
                    {p.claims.length > 0 && (
                      <p>
                        <span className="text-zinc-500">told him:</span> {p.claims.join(' | ')}
                      </p>
                    )}
                    {p.asks.length > 0 && (
                      <p>
                        <span className="text-zinc-500">asked for:</span> {p.asks.join(' | ')}
                      </p>
                    )}
                    {p.promises.length > 0 && (
                      <p>
                        <span className="text-zinc-500">he promised:</span> {p.promises.join(' | ')}
                      </p>
                    )}
                    <div className="flex gap-1 pt-1">
                      <button
                        className={btn}
                        onClick={() => void (async () => {
                          const v = await promptText({ title: `Trust in ${p.name}`, body: '0–100', defaultValue: String(p.trust) })
                          if (v !== null && Number.isFinite(Number(v))) await control({ action: 'set', character: mind.character, field: 'trust', person: p.id, value: Number(v) })
                        })()}
                      >
                        Set trust
                      </button>
                      <button
                        className={clsx(btn, 'border-red-900 text-red-300 hover:bg-red-950')}
                        onClick={() => void (async () => {
                          if (await confirmAction({ title: `Forget ${p.name}?`, body: 'The whole file goes: summary, claims, asks, promises, trust.', confirmLabel: 'Forget', danger: true }))
                            await control({ action: 'forget', character: mind.character, person: p.id })
                        })()}
                      >
                        Forget
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Revisions({ mind, onOpenThought }: { mind: AgentMindSummary; onOpenThought: (id: string) => void }) {
  if (mind.revisions.length === 0) return null
  const recent = [...mind.revisions].reverse().slice(0, 30)
  return (
    <section className={panel} data-testid="mind-revisions">
      <div className={heading}>Revisions (newest first)</div>
      <ul className="space-y-0.5 text-xs">
        {recent.map((r) => (
          <li key={r.rev} className="flex items-center gap-2">
            <span className="w-8 font-mono text-zinc-500">#{r.rev}</span>
            <span className="w-16 text-zinc-500">{timeOf(r.at)}</span>
            <span className={clsx('w-14', r.by === 'reflect' || r.by === 'survey' ? 'text-zinc-300' : 'text-amber-300')}>{r.by}</span>
            <span className="flex-1 truncate text-zinc-400">
              {r.touched.join(', ')}
              {r.stage !== '' && <span className="text-zinc-600"> · {r.stage}</span>}
            </span>
            {r.thought !== null && (
              <button className={btn} onClick={() => onOpenThought(r.thought!)} title="Open the thought that made this revision">
                thought
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// The trace
// ---------------------------------------------------------------------------

function TraceList({ character, thoughts, onOpen }: { character: string | null; thoughts: AgentThought[]; onOpen: (id: string) => void }) {
  const [kinds, setKinds] = useState<Set<AgentThought['kind']>>(() => new Set(ALL_KINDS))
  const [person, setPerson] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const rows = useMemo(() => filterThoughts(thoughts, { character, kinds, person, query }), [thoughts, character, kinds, person, query])
  const speakers = useMemo(() => speakersOf(thoughts, character), [thoughts, character])
  const toggle = (k: AgentThought['kind']) =>
    setKinds((prev) => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="mind-trace">
      <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
        {ALL_KINDS.map((k) => (
          <button
            key={k}
            onClick={() => toggle(k)}
            className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', kinds.has(k) ? 'border-zinc-700 text-zinc-200' : 'border-zinc-900 text-zinc-600 line-through')}
            data-testid={`mind-kind-${k}`}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: KIND_META[k].color, opacity: kinds.has(k) ? 1 : 0.3 }} aria-hidden />
            {KIND_META[k].label}
          </button>
        ))}
        {speakers.length > 0 && (
          <select value={person ?? ''} onChange={(e) => setPerson(e.target.value === '' ? null : e.target.value)} className={input} data-testid="mind-person">
            <option value="">everyone</option>
            {speakers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search prompts, reasoning, output…" className={clsx(input, 'min-w-40 flex-1')} data-testid="mind-search" />
        <span className="text-zinc-600">{rows.length}</span>
      </div>
      <ol className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
        {rows.length === 0 && <li className="p-4 text-center text-xs text-zinc-600">No thoughts match.</li>}
        {[...rows].reverse().map((t) => (
          <li key={t.id}>
            <ThoughtRow thought={t} onOpen={() => onOpen(t.id)} />
          </li>
        ))}
      </ol>
    </div>
  )
}

function KindBadge({ kind }: { kind: AgentThought['kind'] }) {
  const m = KIND_META[kind]
  return (
    <span className="inline-flex w-16 shrink-0 items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-300">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: m.color }} aria-hidden />
      {m.label}
    </span>
  )
}

function ThoughtRow({ thought: t, onOpen }: { thought: AgentThought; onOpen: () => void }) {
  const marker = KIND_META[t.kind].who === 'marker'
  return (
    <button
      onClick={onOpen}
      className={clsx('flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left text-xs hover:bg-zinc-900/60', t.error ? 'border-red-900/60' : marker ? 'border-dashed border-zinc-800' : 'border-zinc-800')}
      data-testid={`mind-thought-${t.kind}`}
    >
      <span className="w-16 shrink-0 font-mono text-zinc-500">{timeOf(t.at)}</span>
      <KindBadge kind={t.kind} />
      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate', t.error ? 'text-red-300' : 'text-zinc-200')}>{summarizeThought(t)}</span>
        <span className="block truncate text-[10px] text-zinc-500">
          {t.speaker !== null && <>with {t.speaker.name} · </>}
          {t.model !== null && <span className="font-mono">{t.model.name}</span>}
          {t.trigger !== '' && <> · {t.trigger}</>}
          {t.ms > 0 && <> · {formatMs(t.ms)}</>}
          {t.completion_tokens !== null && <> · {t.completion_tokens} tok</>}
          {t.thinking !== '' && <> · 💭</>}
          {t.revision !== null && <> · rev #{t.revision}</>}
        </span>
      </span>
    </button>
  )
}

function ThoughtDetail({ thought: t, onBack }: { thought: AgentThought; onBack: () => void }) {
  const control = useCockpit((s) => s.mindControl)
  const [tab, setTab] = useState<'input' | 'thinking' | 'output' | 'result' | 'diff'>(t.thinking !== '' ? 'thinking' : t.messages.length > 0 ? 'input' : 'result')
  const rows = useMemo(() => diffRows(t.diff), [t.diff])
  const tabs: Array<[typeof tab, string, number]> = [
    ['input', 'Input', t.messages.length],
    ['thinking', 'Reasoning', t.thinking === '' ? 0 : 1],
    ['output', 'Raw output', t.output === '' ? 0 : 1],
    ['result', 'Parsed', t.result === null ? 0 : 1],
    ['diff', 'Mind diff', rows.length],
  ]
  const rerunnable = t.messages.length > 0 && t.kind !== 'rerun'
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="mind-thought-detail">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <button className={btn} onClick={onBack}>
          ← trace
        </button>
        <KindBadge kind={t.kind} />
        <span className="text-zinc-500">{timeOf(t.at)}</span>
        {t.model !== null && (
          <span className="text-zinc-500">
            <span className="font-mono text-zinc-300">{t.model.name}</span> · {t.model.api} · t={t.model.temperature ?? '—'} · max {t.model.max_tokens ?? '—'}
            {t.model.reasoning_effort ? ` · effort ${t.model.reasoning_effort}` : ''}
            {t.model.think !== null ? ` · think ${String(t.model.think)}` : ''}
          </span>
        )}
        {t.speaker !== null && <span className="text-zinc-500">with {t.speaker.name}</span>}
        {t.ms > 0 && <span className="text-zinc-500">{formatMs(t.ms)}</span>}
        {(t.prompt_tokens !== null || t.completion_tokens !== null) && (
          <span className="text-zinc-500">
            {t.prompt_tokens ?? '?'} in / {t.completion_tokens ?? '?'} out
          </span>
        )}
        {t.finish !== '' && <span className="text-zinc-600">stop: {t.finish}</span>}
        {t.error && <span className="text-red-300">✗ {t.error}</span>}
        {t.note !== '' && <span className="text-zinc-400">{t.note}</span>}
        {rerunnable && (
          <button
            className={clsx(btn, 'ml-auto')}
            title="Send the same messages to the model again (as it is configured now); the answer is recorded next to this one and never applied"
            onClick={() => void control({ action: 'rerun', character: t.character, thought: t.id })}
            data-testid="mind-rerun"
          >
            Re-run
          </button>
        )}
      </div>
      <div className="mb-2 flex gap-1 text-xs">
        {tabs.map(([id, label, n]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            disabled={n === 0}
            className={clsx('rounded px-2 py-0.5', tab === id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200', 'disabled:opacity-40')}
            data-testid={`mind-detail-${id}`}
          >
            {label}
            {n > 1 && <span className="ml-1 text-zinc-500">{n}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-800 p-2 text-xs">
        {tab === 'input' && <Messages messages={t.messages} />}
        {tab === 'thinking' && <pre className="whitespace-pre-wrap font-sans text-zinc-200">{t.thinking}</pre>}
        {tab === 'output' && <pre className="whitespace-pre-wrap font-mono text-zinc-200">{t.output}</pre>}
        {tab === 'result' && <pre className="whitespace-pre-wrap font-mono text-zinc-200">{JSON.stringify(t.result, null, 2)}</pre>}
        {tab === 'diff' &&
          (rows.length === 0 ? (
            <p className="text-zinc-600">This thought changed nothing in the mind.</p>
          ) : (
            <table className="w-full">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-zinc-900 last:border-b-0">
                    <td className={clsx('w-4 py-0.5 font-mono', r.sign === '+' ? 'text-emerald-400' : r.sign === '−' ? 'text-rose-400' : 'text-amber-300')}>{r.sign}</td>
                    <td className="w-40 py-0.5 pr-2 text-zinc-400">{r.field}</td>
                    <td className="py-0.5 text-zinc-200">{r.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
    </div>
  )
}

function Messages({ messages }: { messages: AgentThought['messages'] }) {
  const [openSystem, setOpenSystem] = useState(false)
  return (
    <ol className="space-y-2">
      {messages.map((m, i) => {
        const system = m.role === 'system'
        const long = system && m.content.length > 600 && !openSystem
        return (
          <li key={i} className={clsx('rounded border p-2', system ? 'border-zinc-800 bg-zinc-900/40' : m.role === 'assistant' ? 'border-indigo-900/50' : 'border-zinc-700')}>
            <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-zinc-500">
              {m.role}
              <span className="text-zinc-700">{m.content.length} chars</span>
              {system && m.content.length > 600 && (
                <button className="text-indigo-400 hover:underline" onClick={() => setOpenSystem((v) => !v)}>
                  {openSystem ? 'collapse' : 'expand'}
                </button>
              )}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-zinc-200">{long ? `${m.content.slice(0, 600)}…` : m.content}</pre>
          </li>
        )
      })}
    </ol>
  )
}

