//! Run mode — the center stage: ONE cockpit for the project's one run.
//! The header on every page carries the run pill (which world: local ·
//! scratch · shared rehearsal · LIVE — colour-keyed), the lifecycle
//! controls, the page tabs, the identity control ("who am I right now"),
//! quick-fire, and a decisions pill; a banner under it reports what a
//! co-writer just did. The pages — Run (front of house) / Stage / Chat /
//! Story / Roster / World / Director / Log — read the cockpit contract
//! only, so this stage is identical on both backends. Nothing here owns a
//! backend lifetime: the server-run store is attached at the app level.

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { CockpitTab, useCockpit } from '@/store/cockpit'
import { StoryGraphPanel } from '@/components/graph/StoryGraphPanel'
import { ChatTab, DirectorTab, RosterTab, WorldTab } from '@/components/cockpit/tabs'
import { StageTab } from '@/components/cockpit/StageTab'
import { LogTab } from '@/components/cockpit/LogTab'
import { RunCockpit } from '@/components/cockpit/providers'
import { IdentityControl } from '@/components/cockpit/Identity'
import { RunPage } from './RunPage'
import { LifecycleControls } from './LifecycleControls'
import { LifecycleBanner } from './LifecycleBanner'
import { TONE, runStatusText, runTone } from './run-chrome'

interface TabSpec {
  id: CockpitTab
  label: string
  /** One-line "what this page does", surfaced as the tab tooltip. */
  hint: string
  /** Usable with no run (the static story map is). */
  idle?: boolean
  /** Closed under a non-Operator identity (the director's editors). */
  operatorOnly?: boolean
}

const TABS: TabSpec[] = [
  { id: CockpitTab.Run, label: 'Run', hint: 'Start a rehearsal or go live; join codes + QR, who is directing, guest lookup', idle: true },
  { id: CockpitTab.Stage, label: 'Stage', hint: 'The floor plan — every location, who is standing in it, and their story position' },
  { id: CockpitTab.Chat, label: 'Chat', hint: 'Every room’s feed — read and speak as anyone' },
  { id: CockpitTab.Story, label: 'Story', hint: 'The story map, lighting up with live positions as beats fire', idle: true },
  { id: CockpitTab.Roster, label: 'Roster', hint: 'All guests and the cast as a sortable table, with moderation actions' },
  { id: CockpitTab.World, label: 'World', hint: 'The world state — factions and every live variable, global and per-person', operatorOnly: true },
  { id: CockpitTab.Director, label: 'Director', hint: 'Fire named events, beats, and broadcasts', operatorOnly: true },
  { id: CockpitTab.Log, label: 'Log', hint: 'The raw ledger, event by event — filter to one participant, export the run' },
]

/** Compact "fire a named event from anywhere" control (header-resident). */
function QuickFire() {
  const events = useCockpit((s) => s.events)
  const running = useCockpit((s) => s.run !== null)
  const locked = useCockpit((s) => s.lens !== null)
  const fireSignal = useCockpit((s) => s.fireSignal)
  const [name, setName] = useState('')
  if (!running || locked || events.length === 0) return null
  return (
    <span className="flex items-center gap-1">
      <select
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-300 outline-none focus:border-indigo-500"
        title="Fire a named event"
        data-testid="sim-quickfire-select"
      >
        <option value="">— event —</option>
        {events.map((ev) => (
          <option key={ev} value={ev}>
            {ev}
          </option>
        ))}
      </select>
      <button
        onClick={() => name && void fireSignal(name)}
        disabled={!name}
        className="rounded bg-indigo-600/80 px-2 py-0.5 text-[11px] text-white hover:bg-indigo-500 disabled:opacity-40"
        data-testid="sim-quickfire-button"
      >
        ⚡ fire
      </button>
    </span>
  )
}

/** `⏳ N` — pending decisions across the run; click → Chat. */
function DecisionsPill() {
  const count = useCockpit((s) => Object.keys(s.choices).length)
  const setTab = useCockpit((s) => s.setTab)
  if (count === 0) return null
  return (
    <button
      onClick={() => setTab(CockpitTab.Chat)}
      className="rounded-full border border-indigo-800/70 bg-indigo-950/40 px-2 py-0.5 text-[11px] text-indigo-200 hover:bg-indigo-900/40"
      title="Pending decisions — open Chat to answer them"
      data-testid="run-decisions"
    >
      ⏳ {count}
    </button>
  )
}

/** The run pill: which world, what state, how long. */
function RunPill() {
  const run = useCockpit((s) => s.run)
  const phase = useCockpit((s) => s.phase)
  const connected = useCockpit((s) => s.connected)
  const online = useCockpit((s) => s.roster.filter((r) => r.online === true).length)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const tone = TONE[runTone(run)]
  return (
    <span className={clsx('shrink-0 text-xs', tone.text)} title={tone.hint} data-testid="run-stage-status">
      {runStatusText(run, phase, connected, online, now)}
    </span>
  )
}

function StageChrome() {
  const run = useCockpit((s) => s.run)
  const tab = useCockpit((s) => s.activeTab)
  const setTab = useCockpit((s) => s.setTab)
  const locked = useCockpit((s) => s.lens !== null)
  const tone = TONE[runTone(run)]
  const running = run !== null

  // A page that just became unavailable (run ended, lens engaged) yields
  // to the Run page rather than rendering a dead surface.
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]
  const available = (t: TabSpec) => (running || t.idle === true) && !(locked && t.operatorOnly === true)
  useEffect(() => {
    if (!available(current)) setTab(CockpitTab.Run)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, locked, current.id])

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      <div className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-2 py-1', tone.border)}>
        <RunPill />
        <LifecycleControls />
        <div role="tablist" className="flex items-stretch">
          {TABS.map((tb) => {
            const enabled = available(tb)
            return (
              <button
                key={tb.id}
                role="tab"
                aria-selected={tab === tb.id}
                disabled={!enabled}
                onClick={() => setTab(tb.id)}
                title={!running && tb.idle !== true ? 'starts with the rehearsal' : locked && tb.operatorOnly ? 'switch to Operator to edit' : tb.hint}
                className={clsx(
                  'border-b-2 px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  tab === tb.id ? clsx('text-zinc-100', tone.tabActive) : 'border-transparent text-zinc-500 hover:text-zinc-200',
                )}
                data-testid={`run-tab-${tb.id}`}
              >
                {tb.label}
              </button>
            )
          })}
        </div>
        <span className="ml-auto flex items-center gap-3 pr-1">
          <IdentityControl />
          <QuickFire />
          <DecisionsPill />
        </span>
      </div>
      <LifecycleBanner />
      <div className="min-h-0 flex-1">
        {tab === CockpitTab.Run && <RunPage />}
        {tab === CockpitTab.Stage && <StageTab />}
        {tab === CockpitTab.Chat && <ChatTab />}
        {tab === CockpitTab.Story && <StoryGraphPanel variant="run" />}
        {tab === CockpitTab.Roster && <RosterTab />}
        {tab === CockpitTab.World && <WorldTab />}
        {tab === CockpitTab.Director && <DirectorTab />}
        {tab === CockpitTab.Log && <LogTab />}
      </div>
    </div>
  )
}

export function RunStage() {
  return (
    <RunCockpit>
      <StageChrome />
    </RunCockpit>
  )
}
