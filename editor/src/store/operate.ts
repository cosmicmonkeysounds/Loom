//! The SERVER run backend — Run mode on a server project. The project has
//! one shared run (its active event: a `preview` rehearsal every co-writer
//! lands in, or the live event with real guests); this store drives it over
//! the control plane (`/api/projects/:id/event*` — launch / pause / resume /
//! restart / push draft / go live / end) and the per-event mod SSE +
//! `/e/:eventId/api/mod/*`, authorized by the author's session. It
//! implements the whole `CockpitState` contract (`store/cockpit.ts`),
//! lifecycle included, so the cockpit never knows which backend it is on.
//!
//! Lifetime: attached for as long as the server project is open (`App.tsx`
//! calls `attach` / `detach` on the workspace's `projectId`), never per
//! mode — so a Writing ⇄ Run hop keeps the feed, the ledger, the selection
//! and the personas, and a co-writer's launch is noticed from any mode. A
//! co-writer's transition reaches this console within a second through the
//! project's collab stream (`lib/collab.ts` `event` frames); a 30 s status
//! poll is the fallback.

import { create } from 'zustand'
import { namedEvents, type SimEvent } from '@loom/core/sim'
import type {
  AgentMindSummary,
  AgentThought,
  CodexSummary,
  CueState,
  GuestView,
  InteractionSummary,
  PrimeView,
  QuestSummary,
  WalletModView,
} from '@loom/core/views'
import { applyModPatch, type ModPatchFrame } from '@loom/core/mod-patch'
import { ApiError, eventsApi, logApi, modApi, type EventInfo } from '@/lib/api'
import { fetchWholeLedger } from '@/lib/run-export'
import { onCollabEvent, type CollabEventNotice } from '@/lib/collab'
import { reconnectDelay, streamClosed } from '@/lib/stream-retry'
import { failureText } from '@/lib/press-failure'
import { lspWorkspaceSync } from '@/lib/lsp-client'
import { useLspIndexGen } from '@/lib/lsp-index'
import { useAuth } from '@/store/auth'
import { useGraph } from '@/store/graph'
import { scratchActive, useScratch } from '@/store/run'
import {
  CockpitPhase,
  CockpitTab,
  tabSwitch,
  NO_CUES,
  OPERATOR_LENS,
  RunBackend,
  RunMode,
  storyNow,
  type CastSummary,
  type ChannelSummary,
  type CockpitMessage,
  type CockpitNotice,
  type CockpitState,
  type FactionSummary,
  type LastRun,
  type LedgerEntry,
  type Lens,
  type LocationSummary,
  type RosterRow,
  type RunInfo,
  type Selection,
  type SpaceSummary,
  type WorldEntry,
  type FactsView,
  type WatchSummary,
  type CountdownSummary,
  type FireResult,
  WalletAction,
} from '@/store/cockpit'

// The shared cockpit shapes (roster rows, messages, faction/location
// summaries, selection) live in `store/cockpit.ts` — the local backend
// renders the identical surfaces off its in-browser simulator.

interface ModSnapshot {
  phase: string
  scenario: string | null
  roster: RosterRow[]
  factions: FactionSummary[]
  locations: LocationSummary[]
  characters: string[]
  cast: CastSummary[]
  channels: ChannelSummary[]
  spaces: SpaceSummary[]
  beats: string[]
  choices: Record<string, string[]>
  ledgerLen: number
  world: WorldEntry[]
  modsOnline: number | null
  directors: string[]
  interactions?: InteractionSummary[]
  minds?: AgentMindSummary[]
  cues?: CueState
  codex?: CodexSummary[]
  quests?: QuestSummary[]
  facts?: FactsView | null
  wallet?: WalletModView
  clock?: number
  /** The Director's board (wave 10): absent from an older server, and
   *  `watch` absent when the story declares no `watch:` line. */
  watch?: WatchSummary[]
  countdowns?: CountdownSummary[]
}

/** What the server tells every console on a lifecycle transition. */
interface LifecycleNotice {
  kind: 'reset' | 'reload' | 'golive' | 'ended'
  phase?: string
  by?: string
  at?: number
}

interface OperateState extends CockpitState {
  projectId: string | null
  /** The control-plane view of the active event (null = none). */
  event: EventInfo | null
  /** LSP index generation the running snapshot was launched / pushed at. */
  compiledAt: number

  /** Attach to a project (the whole time it is open). */
  attach: (projectId: string) => void
  /** Release: stop the poll, close the stream, forget the run. */
  detach: () => void
  /** Re-fetch the event's control-plane status (a co-author may have
   *  launched, reloaded, promoted, or ended it from their own editor). */
  refresh: () => Promise<void>
}

// One live mod stream at a time.
let es: EventSource | null = null
// C8: a stream the server closed for good (a 502 / 503 while it restarts)
// is reopened on a capped backoff, each attempt probing the control plane.
let reopenTimer: ReturnType<typeof setTimeout> | null = null
let reopenAttempt = 0
// Control-plane status fallback poll (collab `event` frames are the fast path).
let poll: ReturnType<typeof setInterval> | null = null
let unsubscribeCollab: (() => void) | null = null
/** An End from this console in flight: the event it ends + the whole ledger
 *  fetched for it. The server announces the end (the mod stream's `ended`
 *  frame, the collab notice → `refresh`) *before* the End request answers,
 *  so whichever path lands first must keep this ledger, not the console's. */
let ending: { eventId: string; log: LedgerEntry[] | null } | null = null
const POLL_MS = 30_000
/** Live ledger retention per console (the raw `sim` feed). */
const LOG_CAP = 5000
/** How long an End from this console waits to keep the whole ledger for
 *  "Export that run" before ending anyway with what it saw (T7-03). */
const END_LEDGER_BUDGET_MS = 5_000
/** Thoughts kept client-side (each carries its whole prompt). */
const THOUGHT_CAP = 400

/** Merge thoughts by id, oldest first (by server seq), bounded. */
export function mergeThoughts(have: AgentThought[], more: AgentThought[]): AgentThought[] {
  if (more.length === 0) return have
  const byId = new Map<string, AgentThought>()
  for (const t of have) byId.set(t.id, t)
  for (const t of more) byId.set(t.id, t)
  return [...byId.values()].sort((a, b) => a.seq - b.seq).slice(-THOUGHT_CAP)
}
/** At most one lens fetch in flight; a snapshot landing meanwhile re-fetches after. */
let lensInFlight = false
let lensDirty = false

/** The snapshot-driven fields, reset to empty on attach/detach/end. */
const EMPTY_SNAPSHOT = {
  roster: [] as RosterRow[],
  factions: [] as FactionSummary[],
  locations: [] as LocationSummary[],
  cast: [] as CastSummary[],
  channels: [] as ChannelSummary[],
  spaces: [] as SpaceSummary[],
  beats: [] as string[],
  interactions: [] as InteractionSummary[],
  cues: NO_CUES,
  codex: [] as CodexSummary[],
  quests: [] as QuestSummary[],
  facts: null as FactsView | null,
  wallet: null as WalletModView | null,
  storyClock: null as { ms: number; at: number } | null,
  watch: [] as WatchSummary[],
  watchDeclared: false,
  countdowns: [] as CountdownSummary[],
  ledgerLen: 0,
  world: [] as WorldEntry[],
  modsOnline: null as number | null,
  directors: [] as string[],
  personas: [] as string[],
  log: [] as LedgerEntry[],
  choices: {} as Record<string, string[]>,
  lens: null as Lens,
  perspective: OPERATOR_LENS,
  minds: [] as AgentMindSummary[],
  thoughts: [] as AgentThought[],
}

function phaseOf(status: string | undefined): CockpitPhase {
  return status === 'open' ? CockpitPhase.Open : status === 'paused' ? CockpitPhase.Paused : CockpitPhase.Idle
}

/** Why a Players pane couldn't open, in words a director can act on. An
 *  event server started before `/api/mod/impersonate` existed answers the
 *  route as an unknown mod action — it needs a restart, not a retry. */
export function playerOpenError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (e instanceof ApiError && e.status === 404 && /unknown mod action/i.test(msg)) {
    return 'The event server is running older code without play-as sessions — restart it (pnpm --filter @loom/core serve), then ↻ the pane.'
  }
  return `Could not open this participant: ${msg}`
}

/** The director name this console signs as — the same name the server puts
 *  in `directors` (`user.name || user.email`). */
function myName(): string {
  const u = useAuth.getState().user
  return u ? u.name || u.email : 'Director'
}

/** Authored named events from the locally-indexed model (may be empty
 *  before the first successful compile). */
function localNamedEvents(): string[] {
  try {
    const model = lspWorkspaceSync().model()
    return model !== null ? namedEvents(model) : []
  } catch {
    return []
  }
}

/** The cockpit's `RunInfo` for a control-plane event. */
function runFrom(event: EventInfo, compiledAt: number): RunInfo {
  const created = Date.parse(event.createdAt)
  return {
    backend: RunBackend.Server,
    mode: event.mode === 'preview' ? RunMode.Rehearsal : RunMode.Live,
    scratch: false,
    scenario: null,
    stale: event.stale === true || lspWorkspaceSync().generation !== compiledAt,
    codes: event.codes,
    joinUrl: event.joinUrl,
    eventId: event.id,
    startedAt: Number.isNaN(created) ? null : created,
    startedBy: event.startedBy ?? null,
  }
}

function noticeFor(n: LifecycleNotice, mode: RunMode): CockpitNotice {
  const who = n.by ?? 'A co-writer'
  const text =
    n.kind === 'reset' ? `${who} restarted the story on the same draft.`
    : n.kind === 'reload' ? `${who} pushed the current draft — the story restarted.`
    : n.kind === 'golive' ? `${who} went live — this console switched to LIVE.`
    : `${who} ended the ${mode === RunMode.Live ? 'live event' : 'shared rehearsal'}.`
  return { text, at: n.at ?? Date.now(), tone: 'warn' }
}

/** The story-map overlay belongs to whichever backend owns the cockpit —
 *  the shared run must not repaint it while a scratch run is on screen. */
function overlay(): { reset: () => void; enter: (beat: string, subject: string | null, label: string | null) => void } {
  if (scratchActive()) return { reset: () => {}, enter: () => {} }
  const g = useGraph.getState()
  return { reset: g.runtimeReset, enter: g.runtimeEnter }
}

export const useOperate = create<OperateState>((set, get) => {
  const disconnect = () => {
    if (es) {
      es.close()
      es = null
    }
    if (reopenTimer !== null) {
      clearTimeout(reopenTimer)
      reopenTimer = null
    }
    set({ connected: false })
  }

  /** C8: the mod stream closed for good. Probe the control plane after a
   *  backoff — `refresh` reconnects a closed stream on a live event, and
   *  finds an ended one ended — and go again, slower, while it stays dead. */
  const scheduleReopen = () => {
    if (reopenTimer !== null) return
    reopenTimer = setTimeout(() => {
      reopenTimer = null
      void get()
        .refresh()
        .then(() => {
          if (get().event !== null && streamClosed(es)) scheduleReopen()
        })
    }, reconnectDelay(reopenAttempt++))
  }

  /** Apply the control-plane event to the store (run + phase + scenario). */
  const setEvent = (event: EventInfo | null, compiledAt = get().compiledAt) => {
    if (event === null) {
      set({ event: null, run: null, phase: CockpitPhase.Idle })
      return
    }
    const prev = get().run
    const run = runFrom(event, compiledAt)
    set({
      event,
      compiledAt,
      run: prev !== null && prev.scenario !== null ? { ...run, scenario: prev.scenario } : run,
      phase: phaseOf(event.status),
    })
  }

  /** Refresh the lens identity's own projection from the server. */
  const refreshLens = async (): Promise<void> => {
    const s = get()
    const ev = s.event
    if (ev === null || s.perspective === OPERATOR_LENS) {
      if (s.lens !== null) set({ lens: null })
      return
    }
    if (lensInFlight) {
      lensDirty = true
      return
    }
    const id = s.perspective
    const isGuest = s.roster.some((r) => r.id === id)
    const isCast = s.cast.some((c) => c.id === id)
    if (!isGuest && !isCast) {
      // The identity is gone (a restart, a guest who left) — back to Operator.
      set({ perspective: OPERATOR_LENS, lens: null })
      return
    }
    lensInFlight = true
    try {
      const view = await modApi.lens(ev.id, isGuest ? 'guest' : 'prime', id)
      if (get().perspective === id) {
        set({ lens: isGuest ? { kind: 'guest', id, view: view as GuestView } : { kind: 'performer', id, view: view as PrimeView } })
      }
    } catch {
      /* transient — the next snapshot retries */
    } finally {
      lensInFlight = false
      if (lensDirty) {
        lensDirty = false
        void refreshLens()
      }
    }
  }

  const withEvent = async (fn: (id: string) => Promise<unknown>) => {
    const ev = get().event
    if (!ev) return
    try {
      await fn(ev.id)
    } catch (e) {
      set({ error: (e as Error).message })
    }
  }

  /** A lifecycle request: busy while it runs; a 404 / 409 means someone
   *  else changed the run first — re-sync instead of erroring. */
  const lifecycle = async (fn: () => Promise<void>) => {
    set({ busy: true, error: null })
    try {
      await fn()
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) {
        set({ notice: { text: 'This run was changed by someone else — re-synced.', at: Date.now(), tone: 'warn' } })
        await get().refresh()
      } else {
        set({ error: (e as Error).message })
      }
    } finally {
      set({ busy: false })
    }
  }

  /** Spawn this director's own persona and land on Chat / lobby — what
   *  "start rehearsal" means on both backends. */
  const takeTheStage = async () => {
    await get().addPersona(get().me)
    set({ activeTab: CockpitTab.Chat, activeChannel: 'lobby' })
  }

  const connect = (eventId: string) => {
    disconnect()
    overlay().reset() // fresh event → fresh overlay
    if (typeof EventSource === 'undefined') return // headless tests
    // `delta=1` (W9 O1-01): a keyframe `snapshot`, then keyed `snapshotPatch`
    // frames against it — a few KB a frame instead of the whole ≈ 400 KB view.
    const source = new EventSource(`/e/${encodeURIComponent(eventId)}/events?role=mod&delta=1`)
    source.onopen = () => set({ connected: true })
    // A dropped stream is either a blip (EventSource retries) or the
    // event ending under us — ask the control plane which. A non-200 (the
    // proxy's 502 while the server restarts) closes it for good: reopen it
    // on the backoff (C8).
    source.onerror = () => {
      set({ connected: false })
      if (es === source && streamClosed(source)) scheduleReopen()
      else void get().refresh()
    }
    source.addEventListener('open', () => {
      reopenAttempt = 0
    })
    /** The last whole view this stream holds (and its frame number): what
     *  the next patch applies to. */
    let last: { frame: number | null; snap: Partial<ModSnapshot> } | null = null
    const applySnap = (snap: Partial<ModSnapshot>) => {
      const me = get().me
      const roster = snap.roster ?? []
      const sel = get().selection
      set({
        phase: snap.phase !== undefined ? phaseOf(snap.phase) : get().phase,
        run: get().run === null ? null : { ...get().run!, scenario: snap.scenario ?? null },
        roster,
        factions: snap.factions ?? [],
        locations: snap.locations ?? [],
        cast: snap.cast ?? [],
        channels: snap.channels ?? [],
        spaces: snap.spaces ?? [],
        beats: snap.beats ?? [],
        interactions: snap.interactions ?? [],
        cues: snap.cues ?? NO_CUES,
        codex: snap.codex ?? [],
        quests: snap.quests ?? [],
        facts: snap.facts ?? null,
        wallet: snap.wallet ?? null,
        storyClock: typeof snap.clock === 'number' ? { ms: snap.clock, at: Date.now() } : null,
        watch: snap.watch ?? [],
        watchDeclared: snap.watch !== undefined,
        countdowns: snap.countdowns ?? [],
        choices: snap.choices ?? {},
        ledgerLen: snap.ledgerLen ?? 0,
        world: snap.world ?? [],
        modsOnline: snap.modsOnline ?? null,
        directors: snap.directors ?? [],
        minds: snap.minds ?? [],
        // "Yours" is server truth now: every persona this director spawned.
        personas: roster.filter((r) => r.owner === me).map((r) => r.id),
        // A selection that no longer resolves (after a restart) is dropped;
        // one that does survives the snapshot.
        selection:
          sel === null ? null
          : sel.kind === 'guest' && !roster.some((r) => r.id === sel.id) ? null
          : sel,
      })
      void refreshLens()
    }
    source.addEventListener('snapshot', (e) => {
      const { _frame, ...snap } = JSON.parse((e as MessageEvent).data) as Partial<ModSnapshot> & { _frame?: number }
      last = { frame: typeof _frame === 'number' ? _frame : null, snap }
      applySnap(snap)
    })
    source.addEventListener('snapshotPatch', (e) => {
      const p = JSON.parse((e as MessageEvent).data) as ModPatchFrame
      if (last === null || last.frame === null) return // before any keyframe: nothing to patch
      if (p.base !== last.frame) {
        // A frame went missing: start over — the reopened stream's first view is whole.
        connect(eventId)
        return
      }
      last = { frame: p.frame, snap: applyModPatch(last.snap, p.patch) }
      applySnap(last.snap)
    })
    // A worker recorded a model call (the Mind page's live feed).
    source.addEventListener('agentThought', (e) => {
      const t = JSON.parse((e as MessageEvent).data) as AgentThought
      set((s) => ({ thoughts: mergeThoughts(s.thoughts, [t]) }))
    })
    // The story started over (reset / a pushed draft / go live) or the event
    // is gone. Every console gets this — including the co-author who didn't
    // click; they get a banner saying who did.
    source.addEventListener('lifecycle', (e) => {
      const n = JSON.parse((e as MessageEvent).data) as LifecycleNotice
      const s = get()
      const mine = n.by !== undefined && n.by === s.me
      if (n.kind === 'ended') {
        endedHere(n.by ?? null, n.at ?? Date.now(), !mine)
        return
      }
      overlay().reset()
      set({
        log: [],
        choices: {},
        ...(n.phase !== undefined ? { phase: phaseOf(n.phase) } : {}),
        ...(!mine && s.run !== null ? { notice: noticeFor(n, s.run.mode) } : {}),
        // A pushed draft IS the project's current text: re-base the local
        // staleness clock so every console's "draft changed" clears.
        ...(n.kind === 'reload' ? { compiledAt: lspWorkspaceSync().generation } : {}),
      })
      if (n.kind === 'reload' || n.kind === 'golive') void get().refresh() // pick up the new scenario / mode
      // A restarted rehearsal wiped every persona; put yours back so you can
      // keep playing — only if you had one (a console that never took the
      // stage stays out), and without yanking you off the page you're on.
      // Never on go-live — the show has real guests now.
      if (n.kind !== 'golive' && s.run !== null && s.run.mode === RunMode.Rehearsal && s.personas.length > 0) {
        void get().addPersona(s.me)
      }
    })
    source.addEventListener('history', (e) => {
      const msgs = JSON.parse((e as MessageEvent).data) as CockpitMessage[]
      set({ messages: msgs })
    })
    const upsert = (m: CockpitMessage) =>
      set((s) => {
        const rest = s.messages.filter((x) => x.seq !== m.seq)
        return { messages: [...rest, m].sort((a, b) => a.seq - b.seq) }
      })
    source.addEventListener('message', (e) => upsert(JSON.parse((e as MessageEvent).data) as CockpitMessage))
    source.addEventListener('messageModerated', (e) => {
      const d = JSON.parse((e as MessageEvent).data) as CockpitMessage
      if ('text' in d) upsert(d)
    })
    // Raw sim feed (mods only): drives the story-graph runtime overlay —
    // beat pulses plus each participant's live position on the map.
    // It is also retained as the Log page's ledger (capped per console).
    source.addEventListener('sim', (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as SimEvent
      if (ev.type === 'beatEntered' && typeof ev.beat === 'string') {
        const subject = typeof ev.subject === 'string' ? ev.subject : null
        const label = subject !== null ? (get().roster.find((r) => r.id === subject)?.name ?? subject) : null
        overlay().enter(ev.beat, subject, label)
      }
      set((s) => {
        const last = s.log[s.log.length - 1]
        const seq = last !== undefined ? last.seq + 1 : s.ledgerLen
        // Story time, like a folder run's rows: the last snapshot's clock
        // run on to now (never through a pause); none on an older server.
        const ts = storyNow(s.storyClock, s.phase === CockpitPhase.Open, Date.now()) ?? undefined
        const next = [...s.log, { seq, ts, event: ev }]
        return { log: next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next }
      })
    })
    es = source
  }

  /** The event is gone (ended here or elsewhere): keep what it was for
   *  Export + the empty state, then drop every trace. */
  const endedHere = (by: string | null, at: number, announce: boolean, whole: LedgerEntry[] | null = null) => {
    const s = get()
    // This console's own End, announced back before its request answered.
    if (ending !== null && s.event?.id === ending.eventId) {
      whole = whole ?? ending.log
      by = by ?? s.me
      announce = false
    }
    const lastRun: LastRun | null =
      s.run !== null
        ? { run: s.run, log: whole ?? s.log, ledgerLen: Math.max(s.ledgerLen, whole?.length ?? 0), messages: s.messages, roster: s.roster, factions: s.factions, locations: s.locations, world: s.world, choices: s.choices, endedBy: by, endedAt: at }
        : s.lastRun
    disconnect()
    overlay().reset()
    set({
      event: null,
      run: null,
      phase: CockpitPhase.Idle,
      messages: [],
      selection: null,
      activeChannel: 'lobby',
      activeTab: CockpitTab.Run,
      lastRun,
      ...(announce && s.run !== null ? { notice: noticeFor({ kind: 'ended', by: by ?? undefined, at }, s.run.mode) } : {}),
      ...EMPTY_SNAPSHOT,
    })
  }

  /** The whole ledger, fetched before this console ends the event (the
   *  server forgets it at the end), so "Export that run" has every row.
   *  Null — end with what the console saw — when it already holds it all,
   *  the server won't hand it over, or it takes longer than the budget. */
  const ledgerBeforeEnd = async (): Promise<LedgerEntry[] | null> => {
    const s = get()
    const eventId = s.event?.id ?? null
    if (eventId === null || (s.log.length >= s.ledgerLen && (s.log.length === 0 || s.log[0]!.seq === 0))) return null
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const late = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), END_LEDGER_BUDGET_MS)
      })
      return await Promise.race([fetchWholeLedger((after, limit) => logApi.page(eventId, after, limit), s.log), late])
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  const stopPoll = () => {
    if (poll !== null) {
      clearInterval(poll)
      poll = null
    }
  }
  const startPoll = () => {
    stopPoll()
    poll = setInterval(() => void get().refresh(), POLL_MS)
  }

  /** A co-writer's transition on the collab stream: re-sync now. */
  const onCollab = (_n: CollabEventNotice) => {
    void get().refresh()
  }

  return {
    projectId: null,
    event: null,
    compiledAt: -1,
    phase: CockpitPhase.Idle,
    run: null,
    busy: false,
    me: 'Director',
    connected: false,
    ...EMPTY_SNAPSHOT,
    events: [],
    messages: [],
    error: null,
    lastRun: null,
    notice: null,
    activeTab: CockpitTab.Run,
    activeChannel: 'lobby',
    selection: null,
    worldFilter: '',
    ownPress: null,
    logPress: null,

    attach: (projectId) => {
      if (get().projectId === projectId) return
      get().detach()
      set({
        projectId,
        me: myName(),
        error: null,
        messages: [],
        selection: null,
        notice: null,
        lastRun: null,
        activeTab: CockpitTab.Run,
        activeChannel: 'lobby',
        // Named events come from the locally-indexed model (best-effort —
        // the running event's code is a snapshot of the same project).
        events: localNamedEvents(),
        ...EMPTY_SNAPSHOT,
      })
      unsubscribeCollab = onCollabEvent(onCollab)
      void get().refresh()
      startPoll()
    },

    detach: () => {
      stopPoll()
      unsubscribeCollab?.()
      unsubscribeCollab = null
      disconnect()
      overlay().reset()
      set({
        projectId: null,
        event: null,
        run: null,
        phase: CockpitPhase.Idle,
        messages: [],
        selection: null,
        notice: null,
        lastRun: null,
        activeTab: CockpitTab.Run,
        activeChannel: 'lobby',
        ...EMPTY_SNAPSHOT,
      })
    },

    refresh: async () => {
      const projectId = get().projectId
      if (!projectId) return
      try {
        const event = await eventsApi.status(projectId)
        if (get().projectId !== projectId) return // the project changed under the request
        const prev = get().event
        if (event === null) {
          if (prev !== null) endedHere(null, Date.now(), true) // ended by a co-author
          return
        }
        // A run we didn't launch: its snapshot is whatever the index was
        // when we first saw it — the server's own `stale` flag still rules.
        setEvent(event, prev === null || prev.id !== event.id ? lspWorkspaceSync().generation : get().compiledAt)
        // A new (or different) event appeared — a co-author launched it.
        if (prev === null || prev.id !== event.id || streamClosed(es)) {
          set({ events: localNamedEvents(), error: null })
          connect(event.id)
        }
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    // ---- lifecycle ----
    startRun: async (mode, opts) => {
      const projectId = get().projectId
      if (!projectId) return
      set({ busy: true, error: null })
      try {
        let event: EventInfo
        try {
          event = await eventsApi.launch(projectId, mode === RunMode.Live ? 'live' : 'preview', opts?.rotateStaff ? { rotate: 'staff' } : {})
        } catch (e) {
          // Someone beat us to it: that IS the shared run — join it.
          if (e instanceof ApiError && e.status === 409 && e.data['event']) {
            event = e.data['event'] as EventInfo
            const who = event.startedBy ?? 'A co-writer'
            set({
              notice: {
                text: `${who} already started a ${event.mode === 'preview' ? 'shared rehearsal' : 'live event'} — you're in it.`,
                at: Date.now(),
                tone: 'info',
              },
            })
          } else throw e
        }
        if (get().projectId !== projectId) return // the project changed under the request
        setEvent(event, lspWorkspaceSync().generation)
        set({ events: localNamedEvents(), lastRun: null })
        connect(event.id)
        if (event.mode === 'preview') await takeTheStage()
        else set({ activeTab: CockpitTab.Run })
      } catch (e) {
        set({ error: (e as Error).message })
      } finally {
        set({ busy: false })
      }
    },

    pause: () =>
      lifecycle(async () => {
        const projectId = get().projectId
        if (!projectId) return
        setEvent(await eventsApi.pause(projectId))
      }),

    resume: () =>
      lifecycle(async () => {
        const projectId = get().projectId
        if (!projectId) return
        const event = await eventsApi.resume(projectId)
        setEvent(event)
        if (streamClosed(es)) connect(event.id)
      }),

    // Same snapshot: the stream's `lifecycle` notice + fresh `history` do the refresh.
    restart: () => lifecycle(async () => withEvent((id) => modApi.reset(id))),

    pushDraft: () =>
      lifecycle(async () => {
        const projectId = get().projectId
        if (!projectId) return
        const event = await eventsApi.reload(projectId)
        setEvent(event, lspWorkspaceSync().generation)
        set({ events: localNamedEvents() })
      }),

    goLive: () =>
      lifecycle(async () => {
        const projectId = get().projectId
        if (!projectId) return
        const event = await eventsApi.goLive(projectId)
        setEvent(event, lspWorkspaceSync().generation)
        set({ activeTab: CockpitTab.Run, perspective: OPERATOR_LENS, lens: null })
      }),

    end: () =>
      lifecycle(async () => {
        const projectId = get().projectId
        if (!projectId) return
        const eventId = get().event?.id ?? null
        const whole = await ledgerBeforeEnd()
        ending = eventId !== null ? { eventId, log: whole } : null
        try {
          await eventsApi.end(projectId)
          endedHere(get().me, Date.now(), false, whole)
        } finally {
          ending = null
        }
      }),

    // ---- the mod command surface ----
    capture: (id) => withEvent((ev) => modApi.act(ev, id, 'capture')),
    release: (id) => withEvent((ev) => modApi.act(ev, id, 'release')),
    hideMessage: (seq, hidden) => withEvent((ev) => modApi.hideMessage(ev, seq, hidden)),
    broadcast: (scope, cue) => withEvent((ev) => modApi.broadcast(ev, scope, cue)),
    say: (channel, text, as, parentSeq) => withEvent((ev) => modApi.say(ev, channel, text, as, parentSeq)),
    setStat: (id, field, value) => withEvent((ev) => modApi.setStat(ev, id, field, value)),
    fireBeat: (name, subject) => withEvent((ev) => modApi.fireBeat(ev, name, subject)),
    fireSignal: async (name, subject, args, actor, presses) => {
      const ev = get().event
      if (!ev) return { error: 'no run' }
      const was = get().ownPress
      const own = { name, at: Date.now() }
      set({ ownPress: own })
      try {
        return await modApi.fireSignal(ev.id, name, subject, args, actor, presses)
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.data['moved'] === true) {
          // Refused as moved: nothing fired, so this was not this console's
          // press — another director's LAST must still read as theirs.
          if (get().ownPress === own) set({ ownPress: was })
          // The 409's fresh cue state: the press that beat this one, and
          // the count after it (the Director holds its lock until its marks
          // show it, so the re-arm binds past that press).
          const cues = e.data['cues']
          const c = cues !== null && typeof cues === 'object' ? (cues as { pressed?: unknown; presses?: unknown }) : {}
          const out: FireResult = { moved: true }
          if (typeof c.pressed === 'string' || c.pressed === null) out.pressed = c.pressed
          if (typeof c.presses === 'number' && Number.isFinite(c.presses)) out.presses = c.presses
          return out
        }
        const error = failureText((e as Error).message)
        set({ error })
        return { error }
      }
    },
    scanAs: async (as, target) => {
      const ev = get().event
      if (!ev) return []
      try {
        return await modApi.scanAs(ev.id, as, target)
      } catch (e) {
        set({ error: (e as Error).message })
        return []
      }
    },
    reveal: (faction) => withEvent((ev) => modApi.reveal(ev, faction)),
    // The mod snapshot carries pending choices, and this answers one on a
    // guest's behalf — journaled exactly like the guest's own tap.
    choose: (person, index) => withEvent((ev) => modApi.choose(ev, person, index)),
    // A director-puppeted guest, owned by this console server-side (the
    // snapshot's `RosterRow.owner`), so "yours" survives a reload and
    // co-writers can tell whose persona is whose.
    addPersona: async (name) => {
      const ev = get().event
      if (!ev) return null
      try {
        const guest = await modApi.persona(ev.id, name)
        if (guest !== null) set((s) => ({ personas: s.personas.includes(guest.id) ? s.personas : [...s.personas, guest.id] }))
        return guest?.id ?? null
      } catch (e) {
        set({ error: (e as Error).message })
        return null
      }
    },
    openPlayer: async (role, id) => {
      const ev = get().event
      if (!ev) return null
      try {
        const s = await modApi.impersonate(ev.id, role, id)
        return s.role === 'guest'
          ? { role: 'guest', token: s.token, id: s.id, name: s.name, eventId: s.eventId, title: s.title }
          : { role: 'prime', token: s.token, character: s.id, eventId: s.eventId, title: s.title }
      } catch (e) {
        set({ error: playerOpenError(e) })
        return null
      }
    },
    mindControl: async (control) => {
      const ev = get().event
      if (!ev) return { ok: false, error: 'no run' }
      try {
        const r = await modApi.agentControl(ev.id, control)
        return { ok: r.ok }
      } catch (e) {
        const error = e instanceof ApiError && typeof e.data['error'] === 'string' ? e.data['error'] : (e as Error).message
        set({ error })
        return { ok: false, error }
      }
    },
    loadThoughts: async (character) => {
      const ev = get().event
      if (!ev) return
      try {
        const page = await modApi.agentTrace(ev.id, { character: character ?? null, limit: 400 })
        set((s) => ({ thoughts: mergeThoughts(s.thoughts, page.thoughts), minds: page.minds.length > 0 ? page.minds : s.minds }))
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },
    closePlayer: async (session) => {
      try {
        await modApi.endImpersonation(session.eventId, session.token)
      } catch {
        /* the run already ended / restarted — the session died with it */
      }
    },
    setVar: (path, value) => withEvent((ev) => modApi.setVar(ev, path, value)),
    // The server journals both with this director as `by`.
    grantCodex: (who, entry) => withEvent((ev) => modApi.grantCodex(ev, who, entry)),
    stepQuest: (who, quest, action, text) => withEvent((ev) => modApi.stepQuest(ev, who, quest, action, text)),
    pairGuest: async (id, opts) => {
      const ev = get().event
      if (!ev) return null
      try {
        const p = await modApi.pairGuest(ev.id, id, opts)
        return { url: p.url, name: p.name, expiresAt: p.expiresAt }
      } catch (e) {
        set({ error: (e as Error).message })
        return null
      }
    },
    releasePart: async (character) => {
      const ev = get().event
      if (!ev) return null
      try {
        return await modApi.releasePart(ev.id, character)
      } catch (e) {
        set({ error: (e as Error).message })
        return null
      }
    },
    // Journaled `<id>.gone` `by` this director (C5); the next snapshot's
    // world shows it on every console.
    markGone: async (id, gone) => {
      const ev = get().event
      if (!ev) return false
      try {
        await modApi.guestGone(ev.id, id, gone)
        return true
      } catch (e) {
        set({ error: (e as Error).message })
        return false
      }
    },
    walletAct: async (action, arg) => {
      const ev = get().event
      if (!ev) return false
      try {
        let view: WalletModView
        if (action === WalletAction.Stimulus) view = await modApi.wallet(ev.id, action, { amount: Number(arg) })
        else if (action !== WalletAction.ApproveHeld) view = await modApi.wallet(ev.id, action, { id: String(arg ?? '') })
        else {
          try {
            view = await modApi.wallet(ev.id, action)
          } catch (e) {
            // An event server older than the bulk route answers it as an
            // unknown mod action: approve each held transfer in turn.
            if (!(e instanceof ApiError && e.status === 404 && /unknown mod action/i.test(e.message))) throw e
            const held = (get().wallet?.open.transfers ?? []).filter((t) => t.state === 'held')
            let last = get().wallet
            for (const t of held) last = await modApi.wallet(ev.id, WalletAction.Approve, { id: t.id })
            if (last === null) return true
            view = last
          }
        }
        // Apply the answer at once; the next snapshot agrees.
        set({ wallet: view, error: null })
        return true
      } catch (e) {
        set({ error: (e as Error).message })
        return false
      }
    },

    setTab: (activeTab) => set((s) => tabSwitch(s, activeTab)),
    setWorldFilter: (worldFilter) => set({ worldFilter }),
    setLogPress: (logPress) => set({ logPress }),
    selectChannel: (activeChannel) => set({ activeChannel }),
    select: (selection: Selection) => set({ selection }),
    setPerspective: (perspective) => {
      // Never show the previous identity's projection under the new name:
      // a lens for another id is dropped and re-fetched.
      const current = get().lens
      set({ perspective, lens: current !== null && current.id === perspective ? current : null })
      void refreshLens()
    },
    dismissNotice: () => set({ notice: null }),
  }
})

// `stale` is real state on this backend too: the moment the index moves past
// the launched / pushed snapshot, the header's draft control lights up —
// the server's own `stale` flag (a co-writer's edit) still ORs in via `refresh`.
// `useLspIndexGen` is only the trigger; the comparison uses the Workspace's
// own generation, the clock `compiledAt` was taken from.
useLspIndexGen.subscribe(() => {
  const st = useOperate.getState()
  if (st.run === null || st.event === null) return
  const stale = st.event.stale === true || lspWorkspaceSync().generation !== st.compiledAt
  if (stale !== st.run.stale) useOperate.setState({ run: { ...st.run, stale } })
})

// Leaving a scratch run hands the story-map overlay back to the shared run:
// replay its retained ledger so visit badges and positions come back.
useScratch.subscribe((s, prev) => {
  if (!(prev.active && !s.active)) return
  const st = useOperate.getState()
  if (st.run === null) return
  const g = useGraph.getState()
  g.runtimeReset()
  for (const entry of st.log) {
    const ev = entry.event
    if (ev.type === 'beatEntered' && typeof ev.beat === 'string') {
      const subject = typeof ev.subject === 'string' ? ev.subject : null
      g.runtimeEnter(ev.beat, subject, subject !== null ? (st.roster.find((r) => r.id === subject)?.name ?? subject) : null)
    }
  }
})
