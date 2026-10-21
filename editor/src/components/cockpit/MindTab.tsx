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
//! Above all of it, the **Judging card** (Wave 4, lane B): the facts
//! judge's mode (`auto` / `review`, a journaled world var), the filings
//! awaiting a director's verdict in `review`, and the per-question tally
//! with the consensus flag — off `CockpitState.facts` (`ModView.facts`).
//!
//! Wave 12 (CONTRACTS C6.7): a worker on the **story mind** (`mode: "new"`)
//! runs no orchestrator — the story's phase table sets the stage and the
//! brief, the voice keeps memos. Its page swaps Survey now for **Rewrite
//! brief**, labels the brief / stage moves / revisions *set by story* or
//! *set by director*, shows each file's memos, first meeting, gifts,
//! filings, the house's trust, ⛔ and the chart, and hides the controls
//! that only steer the orchestrator. Drive sliders send one control when
//! let go; selects only on a change. Every new field is optional, so an
//! older worker's report renders as before.
//!
//! Everything here reads the cockpit contract; the page is inert on the
//! local backend (nothing voices a `mind: external` character in the
//! browser, and the judge lives on the event server) and says so.

import { Fragment, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { AgentControl, AgentMindSummary, AgentThought } from '@loom/core/views'
import { RunBackend, useCockpit } from '@/store/cockpit'
import { confirmAction, promptText } from '@/store/dialog'
import { LensGate } from './tabs'
import { useNow } from './director/clock'
import {
  ALL_KINDS,
  KIND_META,
  VERDICT_BUTTONS,
  briefLabel,
  byLabel,
  byTitle,
  driveControl,
  effortControl,
  favoursControl,
  fetchThought,
  isNewMind,
  kindChips,
  kindMeta,
  localPrefix,
  memoLabel,
  mindPhaseOf,
  personExtras,
  prefixRef,
  heldState,
  sliderHold,
  phaseTitle,
  stageFromPhase,
  stagePrompt,
  surveyButton,
  timingText,
  type MindControl,
  type SliderEvent,
  type SliderHold,
  askingText,
  ruledFilings,
  rulingText,
  confirmEvent,
  diffRows,
  driveSeries,
  filingButtons,
  filterThoughts,
  judgeModeOf,
  mindCharacters,
  agentQueueOf,
  autoJudgeCopy,
  isQueuedFiling,
  judgeModeTitle,
  judgeOf,
  judgingBadge,
  judgingQueueOf,
  queuedText,
  nearCount,
  queueBadge,
  QueueTone,
  pendingFilings,
  pickMind,
  questionFilings,
  questionTallies,
  sparklinePath,
  speakersOf,
  stageSegments,
  summarizeThought,
  timeOf,
  verdictCall,
  type FilingButton,
  type FilingHow,
  type FilingRow,
  type JudgeMode,
} from './mind'

const panel = 'rounded-xl border border-zinc-800 p-3'
const heading = 'mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400'
const btn = 'rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40'
const btnPrimary = 'rounded bg-indigo-600 px-2 py-0.5 text-xs text-white hover:bg-indigo-500 disabled:opacity-40'
const input = 'rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500'

/** The page's controls include the new mind's `rewrite`, which the base core
 *  types don't name; the server's own validator is the gate (C6.7). */
const asControl = (c: MindControl): Omit<AgentControl, 'by'> => c as unknown as Omit<AgentControl, 'by'>

export function MindTab() {
  const locked = useCockpit((s) => s.lens !== null)
  const run = useCockpit((s) => s.run)
  if (locked) return <LensGate what="see and steer an agent's mind" />
  if (run !== null && run.backend !== RunBackend.Server) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-auto">
        <div className="p-3">
          <JudgingCard local />
        </div>
        <div className="grid flex-1 place-items-center p-8 text-center text-sm text-zinc-500" data-testid="mind-local">
          <div className="max-w-md">
            <p className="text-zinc-300">Minds live on a stagehand worker.</p>
            <p className="mt-2">
              An agent-voiced character (<span className="font-mono text-zinc-300">mind: external</span>) is answered by the laptop running
              <span className="font-mono text-zinc-300"> stagehand agents</span> against an event server. This run is in your browser
              {run.scratch ? ' (a scratch run)' : ''}, so there is no worker to watch — open a server project and start its rehearsal.
            </p>
          </div>
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
      <div className="flex h-full min-h-0 flex-col overflow-auto">
        <div className="p-3">
          <JudgingCard />
        </div>
        <div className="grid flex-1 place-items-center p-8 text-center text-sm text-zinc-500" data-testid="mind-empty">
          <div className="max-w-md">
            <p className="text-zinc-300">No agent worker has reported yet.</p>
            <p className="mt-2">
              Start <span className="font-mono text-zinc-300">stagehand run --config laptop.yaml --only agents</span> on the show laptop.
              Every reply it makes will appear here, with the prompt, the model's reasoning, and the mind it leaves behind. The story
              mind makes no model call until someone speaks to the character, so an empty house stays quiet.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const selectedThought = selected === null ? null : (thoughts.find((t) => t.id === selected) ?? null)

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mind-tab">
      <div className="border-b border-zinc-800 p-3">
        <JudgingCard />
      </div>
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
            <ThoughtDetail thought={selectedThought} onBack={() => setSelected(null)} onOpenThought={setSelected} />
          ) : (
            <TraceList character={character} thoughts={thoughts} fresh={isNewMind(mind)} onOpen={setSelected} />
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Judging: the facts judge (mode, pending verdicts, per-question tallies)
// ---------------------------------------------------------------------------

/**
 * The Judging card (U10). The mode is a journaled world var (the view's
 * `modeVar`, `Night.judge_mode` by default) written through `setVar` — the
 * same `/api/mod/var` path the World page uses. In `review` every filing is
 * a proposal until a director confirms or overrides it here (the story
 * event named by `facts.json` `judge.confirm`, fired on the person with the
 * question as an argument — the hosts' booth buttons fire the same names)
 * or the round settles it by the proposal. A **near miss** (wave 11 C6: a
 * letter or a word from the key) is never judged on its own: it waits here
 * in either mode, `auto` included. Wave 11b: when the story names a
 * `judge:` character, an `auto`-mode near miss is put to it first — the row
 * reads "🤖 asking Trabolta…", then its ruling lists under the pending
 * rows ("🤖 Trabolta: same — why") with the usual buttons, so a director
 * can still override it (the later verdict wins). Wave 18b (O4): the judge
 * rules **every** non-exact filing, a plain miss too (no ⚠ near tag): each
 * waits in his queue (*🤖 queued for Trabolta*) until its frame is out
 * (*🤖 asking Trabolta…*), the header counts the queue (`agentQueue.judging`,
 * ⏳ on a judge stall), and what he can't rule falls back to the house rule.
 * The verdict never reaches a phone or the voice prompt; this card is the
 * only place it is shown.
 */
function JudgingCard({ local = false }: { local?: boolean }) {
  const facts = useCockpit((s) => s.facts)
  const world = useCockpit((s) => s.world)
  const cast = useCockpit((s) => s.cast)
  const minds = useCockpit((s) => s.minds)
  const setVar = useCockpit((s) => s.setVar)
  const fireSignal = useCockpit((s) => s.fireSignal)
  const [busy, setBusy] = useState<string | null>(null)
  const [openQ, setOpenQ] = useState<ReadonlySet<string>>(() => new Set())
  const mode = judgeModeOf(world, facts)
  if (facts === null) {
    return (
      <section className={panel} data-testid="judging-card">
        <div className={heading}>Judging (the facts judge)</div>
        <p className="text-xs text-zinc-500">
          This project has no facts.json — nothing is judged.{local ? ' Judging runs on the event server: rehearse the hunt on a server project.' : ''}
        </p>
      </section>
    )
  }
  const pending = pendingFilings(facts)
  const ruled = ruledFilings(facts)
  const near = nearCount(facts)
  const judge = judgeOf(facts)
  const queue = judge === null ? null : judgingBadge(judgingQueueOf(judge, cast, minds), judge)
  const tallies = questionTallies(facts)
  const switchMode = async (m: JudgeMode) => {
    if (m === mode || busy !== null) return
    setBusy('mode')
    try {
      await setVar(facts.modeVar, m)
    } finally {
      setBusy(null)
    }
  }
  const confirm = async (row: { person: string; question: string }, verdict: (typeof VERDICT_BUTTONS)[number]['verdict']) => {
    const call = verdictCall(facts, row, verdict)
    if (call === null || busy !== null) return
    const key = `${row.person}:${row.question}`
    setBusy(key)
    try {
      await fireSignal(call.event, call.person, call.args, null)
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className={panel} data-testid="judging-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className={clsx(heading, 'mb-0')}>Judging (the facts judge)</div>
        <span className="inline-flex overflow-hidden rounded border border-zinc-700 text-xs" role="group" aria-label="Judging mode" data-testid="judging-mode">
          {(['auto', 'review'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={clsx('px-2 py-0.5', m === mode ? 'bg-indigo-600 text-white' : 'text-zinc-300 hover:bg-zinc-800')}
              aria-pressed={m === mode}
              disabled={busy !== null}
              onClick={() => void switchMode(m)}
              title={judgeModeTitle(m, judge)}
              data-testid={`judging-mode-${m}`}
            >
              {m}
            </button>
          ))}
        </span>
        <span className="text-xs text-zinc-500">
          <span className="font-mono">{facts.modeVar}</span> · {facts.pending === 0 ? 'nothing pending' : `${facts.pending} pending`}
        </span>
        {near > 0 && (
          <span
            className="text-xs text-amber-300"
            title={
              judge !== null && mode === 'auto'
                ? `Answers a letter or a word away from the key (a typo, a plural, digits for words): proposed accurate while ${judge} rules them, as every other non-exact filing is.`
                : 'Answers a letter or a word away from the key (a typo, a plural, digits for words): never judged a lie or a guess on their own — they wait here, in either mode.'
            }
            data-testid="judging-near-count"
          >
            ⚠ {near} near miss{near === 1 ? '' : 'es'}
          </span>
        )}
        {queue !== null && (
          <span className={clsx('text-xs', queue.stalled ? 'text-amber-300' : 'text-violet-300')} title={queue.title} data-testid="judging-queue">
            {queue.text}
          </span>
        )}
      </div>
      {mode === 'auto' && judge !== null && (
        <p className="mt-1 text-xs text-zinc-500" data-testid="judging-auto-copy">
          {autoJudgeCopy(judge)}
        </p>
      )}
      {pending.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs" data-testid="judging-pending">
          {pending.map((row) => {
            const key = `${row.person}:${row.question}`
            return (
              <li key={key} className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 px-2 py-1">
                <span className="font-medium text-zinc-100">{row.name}</span>
                <span className="font-mono text-zinc-400">{row.question}</span>
                <span className="flex-1 text-zinc-200">
                  “{row.answer}”
                  {row.near !== null && (
                    <span className="ml-2 rounded bg-amber-500/15 px-1 text-amber-300" title="A near miss: the judge held it for you instead of calling it a lie or a guess" data-testid="judging-near">
                      ⚠ near “{row.near}”
                    </span>
                  )}
                  {row.asking && (
                    <span
                      className="ml-2 text-violet-300"
                      title={`${judge ?? 'The story’s judge character'} ${row.queued === true ? 'will rule on this filing when its turn comes' : 'is ruling on this filing'}; judge it yourself to decide first`}
                      data-testid={row.queued === true ? 'judging-queued' : 'judging-asking'}
                    >
                      {row.queued === true ? queuedText(facts) : askingText(facts)}
                    </span>
                  )}
                </span>
                <span className="text-zinc-500">{row.confidence}%</span>
                <span className="text-zinc-500">
                  proposed <span className="text-zinc-300">{row.proposed}</span>
                </span>
                <span className="inline-flex gap-1">
                  {VERDICT_BUTTONS.map((b) => (
                    <button
                      key={b.verdict}
                      type="button"
                      className={clsx(btn, b.verdict === row.proposed && 'border-indigo-500/60')}
                      disabled={busy !== null || confirmEvent(facts, b.verdict) === null}
                      title={`${b.verdict === row.proposed ? 'Confirm' : 'Override'}: ${b.label}`}
                      onClick={() => void confirm(row, b.verdict)}
                      data-testid={`judging-${b.verdict}`}
                    >
                      {b.glyph} {b.label}
                    </button>
                  ))}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {mode === 'review' && pending.length === 0 && <p className="mt-2 text-xs text-zinc-600">No filing is waiting for a verdict.</p>}
      {ruled.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs" data-testid="judging-rulings" aria-label="Rulings">
          {ruled.map((row) => (
            <li key={`${row.person}:${row.question}`} className="flex flex-wrap items-center gap-2 rounded border border-zinc-800/70 px-2 py-1">
              <span className="font-medium text-zinc-100">{row.name}</span>
              <span className="font-mono text-zinc-400">{row.question}</span>
              <span className="text-zinc-200">“{row.answer}”</span>
              <span className="flex-1 text-violet-300" data-testid="judging-ruling">
                {rulingText(row.ruling)}
              </span>
              <span className="text-zinc-500">
                now <span className="text-zinc-300">{row.final ?? 'pending'}</span>
                {row.by !== null && row.by !== row.ruling.by && <span className="ml-1 text-amber-300">(overridden by {row.by})</span>}
              </span>
              <span className="inline-flex gap-1">
                {filingButtons(facts, row).map((b) => (
                  <button
                    key={b.verdict}
                    type="button"
                    className={clsx(btn, 'px-1', b.current && 'border-indigo-500/60 bg-indigo-500/10')}
                    aria-pressed={b.current}
                    disabled={busy !== null || b.disabled || (b.current && row.final !== null)}
                    title={b.title}
                    onClick={() => void confirm({ person: row.person, question: row.question }, b.verdict)}
                    data-testid={`judging-ruling-${b.verdict}`}
                  >
                    {b.glyph}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {tallies.length > 0 && (
        <table className="mt-2 w-full text-xs" data-testid="judging-tallies">
          <thead className="text-zinc-500">
            <tr>
              <th className="text-left font-normal">question</th>
              <th className="text-right font-normal">filed</th>
              <th className="text-right font-normal">accurate</th>
              <th className="text-right font-normal">lie</th>
              <th className="text-right font-normal">uncertain</th>
              <th className="text-right font-normal">pending</th>
              <th className="text-right font-normal">consensus</th>
            </tr>
          </thead>
          <tbody>
            {tallies.map((t) => {
              const isOpen = openQ.has(t.id)
              const toggle = () =>
                setOpenQ((prev) => {
                  const next = new Set(prev)
                  if (next.has(t.id)) next.delete(t.id)
                  else next.add(t.id)
                  return next
                })
              return (
              <Fragment key={t.id}>
              <tr className="border-t border-zinc-800/60 text-zinc-300">
                <td className="py-0.5 pr-2">
                  <button
                    type="button"
                    className="mr-1 w-3 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                    disabled={t.filed === 0}
                    aria-expanded={isOpen}
                    title={isOpen ? 'Hide the filings' : 'Show who filed what'}
                    onClick={toggle}
                    data-testid={`judging-expand-${t.id}`}
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                  <span className="font-mono text-zinc-400">{t.id}</span>
                  {t.round !== null && <span className="ml-1 text-zinc-600">r{t.round}</span>} <span title={t.text}>{t.text.length > 48 ? `${t.text.slice(0, 45)}…` : t.text}</span>
                </td>
                <td className="text-right">{t.filed}</td>
                <td className="text-right">{t.accurate}</td>
                <td className="text-right">{t.lie}</td>
                <td className="text-right">{t.uncertain}</td>
                <td className="text-right">{t.pending}</td>
                <td className="text-right">{t.consensus ? '✓' : '—'}</td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={7} className="pb-1 pl-4">
                    <FilingRows
                      rows={questionFilings(facts, t.id)}
                      questionId={t.id}
                      queued={(person) => isQueuedFiling(facts, person, t.id)}
                      buttons={(r) => filingButtons(facts, r)}
                      busy={busy !== null}
                      onVerdict={(r, verdict) => void confirm({ person: r.person, question: t.id }, verdict)}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

const HOW_STYLE: Record<FilingHow, string> = {
  auto: 'text-zinc-400',
  confirmed: 'text-emerald-400',
  settled: 'text-zinc-400',
  kept: 'text-zinc-400',
  overridden: 'text-amber-400',
  marked: 'text-rose-400',
  pending: 'text-zinc-500',
}

/** SW-ADM-13: one question's filings — who filed what, how sure, the
 *  judge's proposal against the outcome (↺ = overridden) and when this
 *  server first saw it ("seen": a restart re-stamps every filing). Wave 9
 *  D5: every row but a marked one carries the ✅ / 😤 / 🤷 buttons (the
 *  current verdict outlined), in auto mode too — the director's one-tap
 *  fix for a filing the key misjudged. */
function FilingRows({
  rows,
  questionId,
  queued,
  buttons,
  busy,
  onVerdict,
}: {
  rows: FilingRow[]
  questionId: string
  /** Is this person's filing still waiting in the judge queue (wave 18b)? */
  queued: (person: string) => boolean
  buttons: (r: FilingRow) => FilingButton[]
  busy: boolean
  onVerdict: (r: FilingRow, verdict: FilingButton['verdict']) => void
}) {
  if (rows.length === 0) return <p className="text-zinc-600">Nobody filed this question.</p>
  return (
    <table className="w-full text-[11px]" data-testid={`judging-filings-${questionId}`}>
      <thead className="text-zinc-600">
        <tr>
          <th className="text-left font-normal" title="When this server first saw the filing — a restart re-stamps it">
            seen
          </th>
          <th className="text-left font-normal">who</th>
          <th className="text-left font-normal">answer</th>
          <th className="text-right font-normal">conf.</th>
          <th className="text-left font-normal pl-2">proposed</th>
          <th className="text-left font-normal">outcome</th>
          <th className="text-right font-normal" title="Confirm or override this filing (the story judges it by its question)">
            verdict
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.person} className="text-zinc-300">
            <td className="pr-2 font-mono text-zinc-500">{timeOf(r.at)}</td>
            <td className="pr-2">{r.name}</td>
            <td className="pr-2 text-zinc-200">
              “{r.answer}”{r.near !== null && <span className="ml-1 text-amber-300" title={`A near miss of “${r.near}”`}>⚠ “{r.near}”</span>}
              {r.asking && <span className="ml-1 text-violet-300">{queued(r.person) ? '🤖 queued…' : '🤖 asking…'}</span>}
              {r.ruling !== null && (
                <span className="ml-1 text-violet-300" title={rulingText(r.ruling)}>
                  {rulingText(r.ruling)}
                </span>
              )}
            </td>
            <td className="pr-2 text-right text-zinc-500">{r.confidence}%</td>
            <td className="pl-2 pr-2 text-zinc-400">{r.proposed}</td>
            <td className={HOW_STYLE[r.how]}>
              {r.final ?? 'pending'}
              {r.how !== 'pending' && r.how !== 'marked' && (
                <span className="ml-1 text-zinc-600" data-testid="judging-how">
                  ({r.how}
                  {r.by ? ` by ${r.by}` : ''})
                </span>
              )}
              {r.how === 'marked' && r.by && <span className="ml-1 text-zinc-600">(by {r.by})</span>}
              {r.how === 'overridden' && (
                <span className="ml-1 rounded bg-amber-500/15 px-1 text-amber-300" title={`Overridden${r.by ? ` by ${r.by}` : ''}: proposed ${r.proposed}, settled ${r.final}`} data-testid="judging-overridden">
                  ↺
                </span>
              )}
            </td>
            <td className="pl-2 text-right">
              <span className="inline-flex gap-1" data-testid="judging-filing-verdicts">
                {buttons(r).map((b) => (
                  <button
                    key={b.verdict}
                    type="button"
                    className={clsx(btn, 'px-1', b.current && 'border-indigo-500/60 bg-indigo-500/10')}
                    aria-pressed={b.current}
                    disabled={busy || b.disabled || (b.current && r.final !== null)}
                    title={b.title}
                    onClick={() => onVerdict(r, b.verdict)}
                    data-testid={`judging-filing-${b.verdict}`}
                  >
                    {b.glyph}
                  </button>
                ))}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
  const cast = useCockpit((s) => s.cast)
  const minds = useCockpit((s) => s.minds)
  // The wait ages by the second between snapshots (C6 sends it as of the send).
  const raw = character === null ? null : agentQueueOf(character, cast, minds)
  const now = useNow(raw !== null && raw.depth > 0, 1000)
  const queue = character === null ? null : agentQueueOf(character, cast, minds, now)
  const badge = queue === null ? null : queueBadge(queue)
  // Wave 12: the story mind runs no orchestrator, so its chip says what does
  // run instead (the phase table, the voice's options).
  const fresh = isNewMind(mind)
  const phase = mind === null ? null : mindPhaseOf(mind)
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
      {queue !== null && (
        <span
          className={clsx(
            'rounded-full border px-2 py-0.5',
            badge!.tone === QueueTone.Stalled ? 'border-red-700 text-red-300' : badge!.tone === QueueTone.Slow ? 'border-amber-700 text-amber-300' : 'border-zinc-800 text-zinc-400',
          )}
          title={badge!.title}
          data-testid="mind-queue"
        >
          {badge!.text}
        </span>
      )}
      {mind !== null && (
        <>
          <span className="text-zinc-500" title={`worker id ${mind.worker || '—'}`}>
            worker <span className="text-zinc-300">{typeof status['worker'] === 'string' && status['worker'] !== '' ? status['worker'] : mind.worker || '—'}</span> · {timeOf(mind.at / 1000)}
          </span>
          <ModelChip who="voice" name={typeof voice['model'] === 'string' ? voice['model'] : '?'} detail={typeof voice['effort'] === 'string' ? `effort ${voice['effort']}` : 'no reasoning'} />
          {fresh ? (
            <StoryMindChip status={status} paused={paused} />
          ) : (
            <ModelChip who="mind" name={typeof orch['model'] === 'string' ? orch['model'] : '?'} detail={`${thinking ? 'reasoning on' : 'reasoning off'}${paused ? ' · PAUSED' : ''}${running ? ' · thinking…' : pending > 0 ? ` · ${pending} queued` : ''}`} />
          )}
          <span className="text-zinc-500" data-testid="mind-counts">
            {fresh
              ? `${mind.exchanges} exchanges · rev ${mind.rev}${phase !== null ? ` · phase ${phase}` : ''}`
              : `${mind.exchanges} exchanges · ${mind.reflections} reflections · ${mind.surveys} surveys · rev ${mind.rev}`}
          </span>
        </>
      )}
      <span className="ml-auto">
        <ControlPanel character={character} mind={mind} />
      </span>
    </div>
  )
}

/** The new mind's chip: no second model — the story sets the stage from
 *  `Night.phase` and the voice keeps its own memos (`status.voice`, C5.2). */
function StoryMindChip({ status, paused }: { status: Record<string, unknown>; paused: boolean }) {
  const voice = (status['voice'] ?? {}) as Record<string, unknown>
  const flag = (v: unknown) => (v === true || v === 'on' ? 'on' : v === false || v === 'off' ? 'off' : null)
  const bits: string[] = []
  if (typeof voice['layout'] === 'string') bits.push(`layout ${voice['layout']}`)
  const memo = flag(voice['memo'])
  if (memo !== null) bits.push(`memo ${memo}`)
  const guard = flag(voice['repeatGuard'])
  if (guard !== null) bits.push(`repeat guard ${guard}`)
  const watch = status['phaseWatchS']
  if (typeof watch === 'number') bits.push(watch > 0 ? `phase watch ${watch} s` : 'phase watch off')
  if (paused) bits.push('PAUSED')
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-800 px-2 py-0.5" title="The story mind: the phase table sets his stage and brief; one voice call per line, no orchestrator" data-testid="mind-mode">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: KIND_META.reflect!.color }} aria-hidden />
      <span className="text-zinc-500">mind</span>
      <span className="text-zinc-200">story</span>
      {bits.length > 0 && <span className="text-zinc-500">· {bits.join(' · ')}</span>}
    </span>
  )
}

function ModelChip({ who, name, detail }: { who: 'voice' | 'mind'; name: string; detail: string }) {
  const color = who === 'voice' ? KIND_META.voice!.color : KIND_META.reflect!.color
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
  const fresh = isNewMind(mind)
  const send = async (c: MindControl | null) => {
    if (c === null) return
    setBusy(true)
    try {
      await control(asControl(c))
    } finally {
      setBusy(false)
    }
  }
  const disabled = busy || character === null
  const survey = character === null ? null : surveyButton(mind, character)
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
          title={
            fresh
              ? "A director's whisper: the voice obeys it on the next line; the next Rewrite brief or phase change clears it"
              : "A director's nudge: the voice obeys it at once; the next reflection folds it into the brief and clears it"
          }
        />
        <button type="submit" className={btnPrimary} disabled={disabled || nudge.trim() === ''}>
          Nudge
        </button>
      </form>
      {survey !== null && (
        <button className={btn} disabled={disabled} onClick={() => void send(survey.control)} title={survey.title} data-testid="mind-survey">
          {survey.label}
        </button>
      )}
      {/* Pause freezes the orchestrator. The story mind never starts one, so
          the button would do nothing there; it stays only to resume a mind a
          classic run left paused. */}
      {(!fresh || paused) && (
        <button className={btn} disabled={disabled} onClick={() => void send({ action: 'pause', character, on: !paused })} title="Pause: replies keep coming, but the mind stops changing" data-testid="mind-pause">
          {paused ? 'Resume mind' : 'Pause mind'}
        </button>
      )}
      {!fresh && (
        <button className={btn} disabled={disabled} onClick={() => void send({ action: 'thinking', character, on: !thinking })} title="Show the orchestrator model's reasoning in the trace (slower)">
          Mind reasoning {thinking ? 'on' : 'off'}
        </button>
      )}
      <label className="flex items-center gap-1 text-zinc-500" title="The voice model's reasoning effort (gpt-oss)">
        voice effort
        <select value={effort} disabled={disabled} className={input} onChange={(e) => {
            if (character !== null) void send(effortControl(character, e.target.value, effort))
          }} data-testid="mind-effort">
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

export function MindNow({ mind, onOpenThought }: { mind: AgentMindSummary; onOpenThought: (id: string) => void }) {
  const control = useCockpit((s) => s.mindControl)
  const c = mind.character
  const fresh = isNewMind(mind)
  const setBy = briefLabel(mind)
  return (
    <div className="flex flex-col gap-3">
      <Arc mind={mind} />
      <section className={panel} data-testid="mind-brief">
        <div className="flex items-center justify-between">
          <div className={clsx(heading, 'flex items-center gap-2')}>
            The brief (what the voice is handed)
            {setBy !== null && (
              <span className={clsx('rounded px-1 text-[10px] normal-case tracking-normal', setBy === 'set by director' ? 'bg-amber-500/15 text-amber-300' : 'bg-zinc-800 text-zinc-400')} data-testid="mind-brief-by">
                {setBy}
              </span>
            )}
          </div>
          <button
            className={btn}
            onClick={() => {
              void (async () => {
                const v = await promptText({
                  title: `Rewrite ${c}'s brief`,
                  body: fresh
                    ? 'Second-person instructions to the actor. It holds until the next phase change (when the story sets the brief again) or the next Rewrite brief.'
                    : 'Second-person instructions to the actor. The next reflection may rewrite it again.',
                  defaultValue: mind.brief,
                  confirmLabel: 'Set brief',
                })
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
  const phase = mindPhaseOf(mind)
  if (segments.length === 0) return null
  return (
    <section className={panel} data-testid="mind-arc">
      <div className={clsx(heading, 'flex items-center gap-2')}>
        The arc
        {phase !== null && (
          <span className="font-mono text-[10px] normal-case tracking-normal text-zinc-500" title={phaseTitle(mind)} data-testid="mind-phase">
            phase {phase}
            {isNewMind(mind) && !stageFromPhase(mind) && ' · stage by hand'}
          </span>
        )}
      </div>
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
                  const why = await promptText({
                    title: `Move ${mind.character} to “${seg.stage}”`,
                    body: stagePrompt(mind),
                    placeholder: 'we skipped ahead',
                    allowEmpty: true,
                  })
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
            <li key={`${h.rev}-${h.stage}`} title={byTitle(h.by)}>
              <span className="text-zinc-300">{h.stage}</span> at {timeOf(h.at)} ({byLabel(h.by)}){h.why !== '' && <> — {h.why}</>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Drives({ mind }: { mind: AgentMindSummary }) {
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
            <DriveSlider mind={mind} name={d.name} live={d.current} />
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

/** How long a sent drive value stays on the slider while the worker's
 *  mirror (debounced up to 2 s on a new worker) catches up. */
const SLIDER_GRACE_MS = 6000

/** One drive's slider (C6.7): dragging only moves it here; letting go — the
 *  pointer, an arrow / Home / End / Page key, or leaving it — sends one `set
 *  drive`, and only when the value differs from the mind's own. */
function DriveSlider({ mind, name, live }: { mind: AgentMindSummary; name: string; live: number }) {
  const control = useCockpit((s) => s.mindControl)
  // The slider's state belongs to the drive value it started from: once the
  // mirror moves (a sent value landed, or someone else set it), it lapses.
  const [held, setHeld] = useState<SliderHold | null>(null)
  const state = heldState(held, live)
  useEffect(() => {
    if (state.sent === null) return
    const t = setTimeout(() => setHeld(null), SLIDER_GRACE_MS)
    return () => clearTimeout(t)
  }, [state.sent])
  const step = (ev: SliderEvent) => {
    const r = sliderHold(held, ev, live)
    setHeld(r.held)
    if (r.send !== null) void control(asControl(driveControl(mind, name, r.send)))
  }
  const shown = state.local ?? live
  return (
    <>
      <input
        type="range"
        min={0}
        max={100}
        value={shown}
        className="w-24 accent-indigo-500"
        title="Set this drive (sent when you let go)"
        aria-label={`${name} drive`}
        data-testid={`mind-drive-${name}`}
        onChange={(e) => step({ type: 'change', value: Number(e.target.value) })}
        onPointerUp={() => step({ type: 'pointerup' })}
        onKeyUp={(e) => step({ type: 'keyup', key: e.key })}
        onBlur={() => step({ type: 'blur' })}
      />
      <span className={clsx('w-8 text-right font-mono', state.local !== null && state.local !== live ? 'text-indigo-300' : 'text-zinc-100')}>{shown}</span>
    </>
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
        <select value={p.favours} className={input} onChange={(e) => {
            const c = favoursControl(mind, e.target.value)
            if (c !== null) void control(asControl(c))
          }} data-testid="mind-favours">
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
  const [open, setOpen] = useState<string | null>(null)
  if (mind.people.length === 0) return null
  // The new mind keeps no trust number of its own: the house's (the story's
  // `them.trust`) is the one the voice is handed, so the row shows that.
  const fresh = isNewMind(mind)
  return (
    <section className={panel} data-testid="mind-people">
      <div className={heading}>Files on people</div>
      <table className="w-full text-xs">
        <tbody>
          {mind.people.map((p) => {
            const x = personExtras(p)
            const houseTrust = x.storyTrust ?? null
            return (
              <Fragment key={p.id}>
                <tr className="cursor-pointer border-b border-zinc-900 hover:bg-zinc-900/60" onClick={() => setOpen(open === p.id ? null : p.id)} data-testid="mind-person">
                  <td className="py-1 pr-2 text-zinc-200">
                    {p.name}
                    {p.kind === 'performer' && <span className="ml-1 text-[10px] text-zinc-500">cast</span>}
                    {x.marked === true && (
                      <span className="ml-1" title="Marked for the Internet" data-testid="mind-person-marked">
                        ⛔
                      </span>
                    )}
                    {(x.memos?.length ?? 0) > 0 && <span className="ml-1 text-[10px] text-zinc-500">{x.memos!.length} memo{x.memos!.length === 1 ? '' : 's'}</span>}
                  </td>
                  {fresh ? (
                    <td className="w-36 py-1 pr-2 text-zinc-400" colSpan={2} title="The story's own trust value for them (them.trust), as the voice is handed it">
                      {houseTrust !== null ? (
                        <>
                          the house's trust <span className="font-mono text-zinc-200">{houseTrust}</span>
                        </>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                  ) : (
                    <>
                      <td className="w-28 py-1 pr-2">
                        <div className="h-1.5 w-full rounded bg-zinc-800" title={`trust ${p.trust}/100`}>
                          <div className="h-1.5 rounded bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, p.trust))}%` }} />
                        </div>
                      </td>
                      <td className="w-8 py-1 pr-2 text-right font-mono text-zinc-300">{p.trust}</td>
                    </>
                  )}
                  <td className="w-10 py-1 pr-2 text-right text-zinc-500">{p.turns}×</td>
                  <td className="max-w-0 truncate py-1 text-zinc-400">{p.summary}</td>
                </tr>
                {open === p.id && (
                  <tr className="border-b border-zinc-900">
                    <td colSpan={5} className="space-y-1 py-2 pl-2 text-xs text-zinc-400" data-testid="mind-person-file">
                      <PersonFile mind={mind} person={p} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

/** One person's file, opened under their row: what the story and the voice
 *  kept (first meeting, memos, gifts, filings, the house's trust, the chart)
 *  beside today's summary / claims / asks / promises, and the file's controls. */
export function PersonFile({ mind, person: p }: { mind: AgentMindSummary; person: AgentMindSummary['people'][number] }) {
  const control = useCockpit((s) => s.mindControl)
  const fresh = isNewMind(mind)
  const x = personExtras(p)
  const houseTrust = x.storyTrust ?? null
  return (
    <>
      {p.summary !== '' && <p className="text-zinc-300">{p.summary}</p>}
      {x.firstMet !== undefined && x.firstMet !== '' && (
        <p>
          <span className="text-zinc-500">first met:</span> {x.firstMet}
        </p>
      )}
      {houseTrust !== null && (
        <p>
          <span className="text-zinc-500">the house's trust:</span> <span className="font-mono text-zinc-300">{houseTrust}</span>
        </p>
      )}
      {x.chart !== undefined && x.chart !== null && x.chart !== '' && (
        <p>
          <span className="text-zinc-500">on the Trust Chart:</span> {x.chart}
        </p>
      )}
      {(x.gifts?.length ?? 0) > 0 && (
        <p>
          <span className="text-zinc-500">gave him:</span> {x.gifts!.map((g) => `“${g}”`).join(', ')}
        </p>
      )}
      {(x.filings?.length ?? 0) > 0 && (
        <p>
          <span className="text-zinc-500">filed:</span> <span className="font-mono">{x.filings!.join(' ')}</span>
        </p>
      )}
      {(x.memos?.length ?? 0) > 0 && (
        <ul className="space-y-0.5" data-testid="mind-memos">
          {x.memos!.map((m, i) => (
            <li key={`${i}-${m.at}`} className="flex gap-2">
              <span className={clsx('shrink-0', m.heart ? 'text-rose-300' : 'text-zinc-500')}>{memoLabel(m)}</span>
              <span className="text-zinc-200">{m.text}</span>
              {m.at > 0 && <span className="text-zinc-600">{timeOf(m.at)}</span>}
            </li>
          ))}
        </ul>
      )}
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
        {!fresh && (
          <button
            className={btn}
            onClick={() => void (async () => {
              const v = await promptText({ title: `Trust in ${p.name}`, body: '0–100', defaultValue: String(p.trust) })
              if (v !== null && Number.isFinite(Number(v))) await control({ action: 'set', character: mind.character, field: 'trust', person: p.id, value: Number(v) })
            })()}
          >
            Set trust
          </button>
        )}
        <button
          className={clsx(btn, 'border-red-900 text-red-300 hover:bg-red-950')}
          onClick={() => void (async () => {
            if (await confirmAction({ title: `Forget ${p.name}?`, body: fresh ? 'The whole file goes: first meeting, memos, summary.' : 'The whole file goes: summary, claims, asks, promises, trust.', confirmLabel: 'Forget', danger: true }))
              await control({ action: 'forget', character: mind.character, person: p.id })
          })()}
        >
          Forget
        </button>
      </div>
    </>
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
            <span className={clsx('w-24 shrink-0', r.by === 'reflect' || r.by === 'survey' || r.by === 'story' ? 'text-zinc-300' : 'text-amber-300')} title={byTitle(r.by)} data-testid="mind-revision-by">
              {byLabel(r.by, r.touched)}
            </span>
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

function TraceList({ character, thoughts, fresh, onOpen }: { character: string | null; thoughts: AgentThought[]; fresh: boolean; onOpen: (id: string) => void }) {
  const [kinds, setKinds] = useState<Set<string>>(() => new Set(ALL_KINDS))
  const [person, setPerson] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const rows = useMemo(() => filterThoughts(thoughts, { character, kinds, person, query }), [thoughts, character, kinds, person, query])
  const speakers = useMemo(() => speakersOf(thoughts, character), [thoughts, character])
  const chips = useMemo(() => kindChips(thoughts, fresh), [thoughts, fresh])
  const toggle = (k: string) =>
    setKinds((prev) => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="mind-trace">
      <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
        {chips.map((k) => (
          <button
            key={k}
            onClick={() => toggle(k)}
            className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', kinds.has(k) ? 'border-zinc-700 text-zinc-200' : 'border-zinc-900 text-zinc-600 line-through')}
            data-testid={`mind-kind-${k}`}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: kindMeta(k).color, opacity: kinds.has(k) ? 1 : 0.3 }} aria-hidden />
            {kindMeta(k).label}
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

function KindBadge({ kind }: { kind: string }) {
  const m = kindMeta(kind)
  return (
    <span className="inline-flex w-16 shrink-0 items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-300">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: m.color }} aria-hidden />
      {m.label}
    </span>
  )
}

function ThoughtRow({ thought: t, onOpen }: { thought: AgentThought; onOpen: () => void }) {
  const marker = kindMeta(t.kind).who === 'marker'
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
          {timingText(t) !== '' && <> · {timingText(t)}</>}
          {t.completion_tokens !== null && <> · {t.completion_tokens} tok</>}
          {t.thinking !== '' && <> · 💭</>}
          {t.revision !== null && <> · rev #{t.revision}</>}
        </span>
      </span>
    </button>
  )
}

function ThoughtDetail({ thought: t, onBack, onOpenThought }: { thought: AgentThought; onBack: () => void; onOpenThought: (id: string) => void }) {
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
        {timingText(t) !== '' && (
          <span className="text-zinc-500" data-testid="mind-thought-timing">
            {timingText(t)}
          </span>
        )}
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
        {tab === 'input' && <Messages messages={t.messages} onOpenThought={onOpenThought} />}
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

export function Messages({ messages, onOpenThought }: { messages: AgentThought['messages']; onOpenThought?: (id: string) => void }) {
  const [openSystem, setOpenSystem] = useState(false)
  return (
    <ol className="space-y-2">
      {messages.map((m, i) => {
        const ref = prefixRef(m.content)
        if (ref !== null) return <PrefixMessage key={i} role={m.role} id={ref} onOpenThought={onOpenThought} />
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

/**
 * A message the trace stored once (C6.6): `[same prefix as th-…]`. It shows
 * as a button; pressing it shows the static prefix, from the thoughts already
 * on the page or else `GET …/api/mod/agent/trace?id=` (the server keeps the
 * full text on the thought it names).
 */
function PrefixMessage({ role, id, onOpenThought }: { role: string; id: string; onOpenThought?: (id: string) => void }) {
  const thoughts = useCockpit((s) => s.thoughts)
  const eventId = useCockpit((s) => s.run?.eventId ?? null)
  const [text, setText] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'missing' | 'failed'>('idle')
  const load = async () => {
    if (text !== null) {
      setText(null)
      return
    }
    const local = localPrefix(id, thoughts)
    if (local !== null) {
      setText(local)
      return
    }
    if (eventId === null) {
      setState('missing')
      return
    }
    setState('loading')
    try {
      const t = await fetchThought(eventId, id)
      const first = t?.messages[0]?.content
      if (typeof first === 'string' && prefixRef(first) === null) {
        setText(first)
        setState('idle')
      } else setState('missing')
    } catch {
      setState('failed')
    }
  }
  return (
    <li className="rounded border border-dashed border-zinc-800 bg-zinc-900/40 p-2" data-testid="mind-prefix">
      <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-zinc-500">
        {role}
        <button className={clsx(btn, 'normal-case tracking-normal')} onClick={() => void load()} disabled={state === 'loading'} title="This prompt's static part is the same as an earlier thought's: show it" data-testid="mind-prefix-load">
          {text !== null ? 'hide' : state === 'loading' ? 'loading…' : <>same prefix as <span className="font-mono">{id}</span></>}
        </button>
        {onOpenThought !== undefined && thoughts.some((t) => t.id === id) && (
          <button className="normal-case tracking-normal text-indigo-400 hover:underline" onClick={() => onOpenThought(id)}>
            open {id}
          </button>
        )}
        {state === 'missing' && <span className="normal-case tracking-normal text-amber-300">prefix not found</span>}
        {state === 'failed' && <span className="normal-case tracking-normal text-red-300">could not load it</span>}
        {text !== null && <span className="text-zinc-700">{text.length} chars</span>}
      </div>
      {text !== null && <pre className="mt-1 whitespace-pre-wrap font-sans text-zinc-200">{text}</pre>}
    </li>
  )
}
