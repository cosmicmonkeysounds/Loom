//! Run mode — center stage: one cockpit, two sources. A **Sim ⇄ Live**
//! switch in the header picks the backend: Sim drives the local
//! in-browser `@loom/core` simulator (rehearsal — personas, lifecycle,
//! the raw ledger), Live drives the launched event over the mod SSE
//! (moderation — a real live event, or a server-hosted **shared
//! rehearsal** the whole writing team directs together). Both render
//! the same cockpit pages (Stage / Chat / Story / Roster / World /
//! Director from `components/cockpit/`); Sim adds its Setup + Log
//! pages. The chrome is color-keyed per tone — violet sim, amber shared
//! rehearsal, emerald live — so it's always obvious which world your
//! actions land in. Launching/ending the event itself lives in Deploy
//! mode (⌘3). Owns the mod-stream lifecycle while Run mode is open.

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useWorkspace } from '@/store/workspace'
import { useOperate } from '@/store/operate'
import { useSim, SimStatus } from '@/store/sim'
import { RunSource, useLiveRun, useRun } from '@/store/run'
import { useMode } from '@/store/mode'
import { CockpitTab, useCockpit } from '@/store/cockpit'
import { StoryGraphPanel } from '@/components/graph/StoryGraphPanel'
import { ChatTab, DirectorTab, RosterTab, WorldTab } from '@/components/cockpit/tabs'
import { StageTab } from '@/components/cockpit/StageTab'
import { RunCockpit } from '@/components/cockpit/providers'
import { SimSetupTab } from '@/components/sim/SimSetupTab'
import { LogTab } from '@/components/cockpit/LogTab'
import { LiveSetupTab } from '@/components/run/LiveSetupTab'

interface TabSpec {
  id: CockpitTab
  label: string
  /** One-line "what this page does", surfaced as the tab tooltip. */
  hint: string
}

// The shared cockpit pages. (The first Sim-source page is labelled
// "Setup", never "Sim" — the source switch already says Sim, and two
// controls with the same name read as duplicates.)
const PAGE_TABS: TabSpec[] = [
  { id: CockpitTab.Stage, label: 'Stage', hint: 'The floor plan — every location, who is standing in it, and their story position' },
  { id: CockpitTab.Chat, label: 'Chat', hint: 'Every room’s feed — read and speak as anyone' },
  { id: CockpitTab.Story, label: 'Story', hint: 'The story map, lighting up with live positions as beats fire' },
  { id: CockpitTab.Roster, label: 'Roster', hint: 'All guests and the cast as a sortable table, with moderation actions' },
  { id: CockpitTab.World, label: 'World', hint: 'The world state — factions and every live variable, global and per-person' },
  { id: CockpitTab.Director, label: 'Director', hint: 'Fire named events, beats, and broadcasts' },
]

const SIM_TABS: TabSpec[] = [
  { id: CockpitTab.Sim, label: 'Setup', hint: 'Start/reset the simulator and manage personas' },
  ...PAGE_TABS,
  { id: CockpitTab.Log, label: 'Log', hint: 'The raw simulator ledger, event by event' },
]

const LIVE_TABS: TabSpec[] = [
  { id: CockpitTab.Sim, label: 'Setup', hint: 'Pause / restart / push the current draft, who is directing, your personas' },
  ...PAGE_TABS,
  { id: CockpitTab.Log, label: 'Log', hint: 'The live event’s raw ledger, event by event — export the run' },
]

/** The Sim ⇄ Live segmented switch. Live needs a server project; the
 *  green dot marks a launched event waiting to be moderated. */
function SourceSwitch() {
  const source = useRun((s) => s.source)
  const setSource = useRun((s) => s.setSource)
  const projectId = useWorkspace((s) => s.projectId)
  const hasEvent = useOperate((s) => s.event !== null)

  return (
    <div className="flex items-center rounded-md border border-zinc-800 p-0.5" role="group" aria-label="Run source">
      {(
        [
          [RunSource.Sim, 'Sim', true],
          [RunSource.Live, 'Live', projectId !== null],
        ] as Array<[RunSource, string, boolean]>
      ).map(([id, label, enabled]) => (
        <button
          key={id}
          type="button"
          disabled={!enabled}
          aria-pressed={source === id}
          data-testid={`run-source-${id}`}
          onClick={() => setSource(id)}
          title={
            id === RunSource.Live && !enabled
              ? 'Live events need a server project (local folders rehearse in Sim)'
              : id === RunSource.Live
                ? 'Moderate the live event'
                : 'Rehearse on the local in-browser simulator'
          }
          className={clsx(
            'flex items-center gap-1.5 rounded px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide transition-colors',
            source === id
              ? id === RunSource.Live
                ? 'bg-emerald-500/20 text-emerald-200'
                : 'bg-violet-500/20 text-violet-200'
              : 'text-zinc-500 hover:text-zinc-200',
            !enabled && 'cursor-not-allowed opacity-40',
          )}
        >
          {label}
          {id === RunSource.Live && hasEvent && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-label="event live" />}
        </button>
      ))}
    </div>
  )
}

/** Compact "fire a named event from anywhere" control (header-resident).
 *  Reads whichever cockpit hosts it — the local sim or the live event. */
function QuickFire() {
  const events = useCockpit((s) => s.events)
  const live = useCockpit((s) => s.live)
  const fireSignal = useCockpit((s) => s.fireSignal)
  const [name, setName] = useState('')
  if (!live || events.length === 0) return null
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

/** Which world the cockpit's actions land in — drives all the chrome color:
 *  violet = the local in-browser simulator, amber = a server-hosted shared
 *  rehearsal (preview event, the whole writing team on it together),
 *  emerald = the real live event with real guests. */
export type RunTone = 'sim' | 'shared' | 'live'

const TONE = {
  sim: {
    border: 'border-violet-800/60',
    tabActive: 'border-violet-400',
    text: 'text-violet-300/90',
    hint: 'Rehearsing on the in-browser simulator — nothing reaches anyone else',
  },
  shared: {
    border: 'border-amber-800/60',
    tabActive: 'border-amber-400',
    text: 'text-amber-300/90',
    hint: 'Shared rehearsal on the server — every co-writer on this project sees + drives the same run',
  },
  live: {
    border: 'border-emerald-800/60',
    tabActive: 'border-emerald-400',
    text: 'text-emerald-300/90',
    hint: 'Moderating the live event — guests see what you do here',
  },
} as const satisfies Record<RunTone, { border: string; tabActive: string; text: string; hint: string }>

/** Header chrome shared by both sources: source switch · pages · status. */
function StageChrome({
  tabs,
  status,
  tone,
  children,
}: {
  tabs: TabSpec[]
  status: string
  tone: RunTone
  children: React.ReactNode
}) {
  const tab = useCockpit((s) => s.activeTab)
  const setTab = useCockpit((s) => s.setTab)
  const t = TONE[tone]
  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      <div className={clsx('flex items-center justify-between gap-2 border-b px-2', t.border)}>
        <div className="flex items-center gap-2">
          <SourceSwitch />
          <div role="tablist" className="flex items-stretch">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                role="tab"
                aria-selected={tab === tb.id}
                onClick={() => setTab(tb.id)}
                title={tb.hint}
                className={clsx(
                  'border-b-2 px-3 py-2 text-sm transition-colors',
                  tab === tb.id
                    ? clsx('text-zinc-100', t.tabActive)
                    : 'border-transparent text-zinc-500 hover:text-zinc-200',
                )}
              >
                {tb.label}
              </button>
            ))}
          </div>
        </div>
        <span className="flex items-center gap-3 pr-1 text-xs text-zinc-500">
          <QuickFire />
          <span className={t.text} title={t.hint} data-testid="run-stage-status">
            {status}
          </span>
        </span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function SimPane() {
  const status = useSim((s) => s.status)
  const tab = useSim((s) => s.activeTab)
  const statusText =
    status === SimStatus.Running ? '▶ rehearsal running'
    : status === SimStatus.Paused ? '⏸ rehearsal paused'
    : 'no rehearsal — start one in Setup'
  return (
    <StageChrome tabs={SIM_TABS} status={statusText} tone="sim">
      {tab === CockpitTab.Sim && <SimSetupTab />}
      {tab === CockpitTab.Stage && <StageTab />}
      {tab === CockpitTab.Chat && <ChatTab />}
      {tab === CockpitTab.Roster && <RosterTab />}
      {tab === CockpitTab.World && <WorldTab />}
      {tab === CockpitTab.Story && <StoryGraphPanel variant="run" />}
      {tab === CockpitTab.Director && <DirectorTab />}
      {tab === CockpitTab.Log && <LogTab />}
    </StageChrome>
  )
}

function LivePane() {
  const event = useOperate((s) => s.event)
  const connected = useOperate((s) => s.connected)
  const tab = useOperate((s) => s.activeTab)
  const setMode = useMode((s) => s.setMode)
  const preview = event?.mode === 'preview'
  const stale = event?.stale === true ? ' · draft changed' : ''
  const statusText = event
    ? connected
      ? (preview ? '◉ shared rehearsal' : '● live event') + stale
      : '○ reconnecting…'
    : 'no active event'

  return (
    <StageChrome tabs={LIVE_TABS} status={statusText} tone={preview ? 'shared' : 'live'}>
      {event === null ? (
        <div className="grid h-full w-full place-items-center p-8 text-center text-sm text-zinc-500">
          <div>
            <p>No live event for this project.</p>
            <button
              onClick={() => setMode('deploy')}
              className="mt-3 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
              data-testid="run-goto-deploy"
            >
              Launch one in Deploy (⌘3) →
            </button>
          </div>
        </div>
      ) : (
        <>
          {tab === CockpitTab.Sim && <LiveSetupTab />}
          {tab === CockpitTab.Stage && <StageTab />}
          {tab === CockpitTab.Chat && <ChatTab />}
          {tab === CockpitTab.Roster && <RosterTab />}
          {tab === CockpitTab.World && <WorldTab />}
          {tab === CockpitTab.Story && <StoryGraphPanel variant="run" />}
          {tab === CockpitTab.Director && <DirectorTab />}
          {tab === CockpitTab.Log && <LogTab />}
        </>
      )}
    </StageChrome>
  )
}

export function RunStage() {
  const live = useLiveRun()
  const projectId = useWorkspace((s) => s.projectId)
  const init = useOperate((s) => s.init)
  const teardown = useOperate((s) => s.teardown)

  // The mod-stream lifecycle rides the *stage*, not the Live pane, so
  // flipping Sim ⇄ Live never reconnects — and the Live badge on the
  // source switch knows about the event while rehearsing.
  useEffect(() => {
    if (!projectId) return
    void init(projectId)
    return () => teardown()
  }, [projectId, init, teardown])

  return <RunCockpit>{live ? <LivePane /> : <SimPane />}</RunCockpit>
}
