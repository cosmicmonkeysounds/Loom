//! The live event's control core — the backend behind Run mode's Live
//! source AND the whole Deploy mode.
//!
//! One store drives the live cockpit (chat per room · roster · world ·
//! director tools · the Inspector tray) and the Deploy stage (launch /
//! codes / lifecycle / guest lookup). The "run panel" and the "admin
//! tools" are the same capability, so they share this state.
//! Launch/lifecycle go through the control plane
//! (`/api/projects/:id/event`); the live view + moderation ride the
//! per-event mod SSE + `/e/:eventId/api/mod/*`, authorized by the
//! author's session.

import { create } from 'zustand'
import { namedEvents, type SimEvent } from '@loom/core/sim'
import { eventsApi, modApi, type EventInfo } from '@/lib/api'
import { lspWorkspaceSync } from '@/lib/lsp-client'
import { useGraph } from '@/store/graph'
import {
  CockpitTab,
  OPERATOR_LENS,
  type CastSummary,
  type ChannelSummary,
  type CockpitMessage,
  type CockpitState,
  type FactionSummary,
  type LedgerEntry,
  type LocationSummary,
  type RosterRow,
  type Selection,
  type SpaceSummary,
  type WorldEntry,
} from '@/store/cockpit'

// The shared cockpit shapes (roster rows, messages, faction/location
// summaries, selection) live in `store/cockpit.ts` — Sim mode renders
// the identical surfaces off its local simulator.

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
}

/** What the server tells every console on a lifecycle transition. */
interface LifecycleNotice {
  kind: 'reset' | 'reload' | 'ended'
  phase?: string
}

interface OperateState extends CockpitState {
  projectId: string | null
  event: EventInfo | null
  busy: boolean

  /** Attach to a project's event (ref-counted — Run and Deploy may both
   *  be mounted; the stream survives a mode switch). */
  init: (projectId: string) => Promise<void>
  /** Release one attachment; the stream closes once nobody holds it. */
  teardown: () => void
  /** Re-fetch the event's control-plane status (a co-author may have
   *  launched, reloaded, or ended it from their own editor). */
  refresh: () => Promise<void>
  launch: (mode: 'live' | 'preview') => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  end: () => Promise<void>
  reset: () => Promise<void>
  /** Push the project's current text into the running event (the story
   *  restarts on the new draft; guests keep their codes). */
  pushDraft: () => Promise<void>
}

// One live mod stream at a time (Operate mode is a single surface).
let es: EventSource | null = null
// How many stages (Run / Deploy) currently hold the store open.
let holders = 0
let releaseTimer: ReturnType<typeof setTimeout> | null = null
// Control-plane status poll — the only way another author's launch/end
// reaches this editor (the project's collab stream carries files only).
let poll: ReturnType<typeof setInterval> | null = null
const POLL_MS = 10_000
/** Live ledger retention per console (the raw `sim` feed). */
const LOG_CAP = 5000

/** The snapshot-driven fields, reset to empty on init/teardown/end. */
const EMPTY_SNAPSHOT = {
  roster: [] as RosterRow[],
  factions: [] as FactionSummary[],
  locations: [] as LocationSummary[],
  cast: [] as CastSummary[],
  channels: [] as ChannelSummary[],
  spaces: [] as SpaceSummary[],
  beats: [] as string[],
  ledgerLen: 0,
  world: [] as WorldEntry[],
  modsOnline: null as number | null,
  directors: [] as string[],
  // Not snapshot-driven, but scoped to one event — reset alongside.
  personas: [] as string[],
  log: [] as LedgerEntry[],
}

export const useOperate = create<OperateState>((set, get) => {
  const disconnect = () => {
    if (es) {
      es.close()
      es = null
    }
    set({ connected: false })
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

  const connect = (eventId: string) => {
    disconnect()
    useGraph.getState().runtimeReset() // fresh event → fresh overlay
    const source = new EventSource(`/e/${encodeURIComponent(eventId)}/events?role=mod`)
    source.onopen = () => set({ connected: true })
    // A dropped stream is either a blip (EventSource retries) or the
    // event ending under us — ask the control plane which.
    source.onerror = () => {
      set({ connected: false })
      void get().refresh()
    }
    source.addEventListener('snapshot', (e) => {
      const snap = JSON.parse((e as MessageEvent).data) as Partial<ModSnapshot>
      set({
        phase: snap.phase ?? get().phase,
        scenario: snap.scenario ?? null,
        roster: snap.roster ?? [],
        factions: snap.factions ?? [],
        locations: snap.locations ?? [],
        cast: snap.cast ?? [],
        channels: snap.channels ?? [],
        spaces: snap.spaces ?? [],
        beats: snap.beats ?? [],
        choices: snap.choices ?? {},
        ledgerLen: snap.ledgerLen ?? 0,
        world: snap.world ?? [],
        modsOnline: snap.modsOnline ?? null,
        directors: snap.directors ?? [],
      })
    })
    // The story started over (reset / a pushed draft) or the event is gone.
    // Every console gets this — including the co-author who didn't click.
    source.addEventListener('lifecycle', (e) => {
      const n = JSON.parse((e as MessageEvent).data) as LifecycleNotice
      if (n.kind === 'ended') {
        clearEvent()
        return
      }
      useGraph.getState().runtimeReset()
      set({ log: [], selection: null, choices: {}, ...(n.phase !== undefined ? { phase: n.phase } : {}) })
      if (n.kind === 'reload') void get().refresh() // pick up the new scenario + clear `stale`
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
        useGraph.getState().runtimeEnter(ev.beat, subject, label)
      }
      set((s) => {
        const last = s.log[s.log.length - 1]
        const seq = last !== undefined ? last.seq + 1 : s.ledgerLen
        const next = [...s.log, { seq, ts: Date.now(), event: ev }]
        return { log: next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next }
      })
    })
    es = source
  }

  /** The event is gone (ended here or elsewhere) — drop every trace. */
  const clearEvent = () => {
    disconnect()
    useGraph.getState().runtimeReset()
    set({
      event: null,
      live: false,
      phase: 'idle',
      scenario: null,
      messages: [],
      selection: null,
      choices: {},
      activeChannel: 'lobby',
      ...EMPTY_SNAPSHOT,
    })
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

  return {
    projectId: null,
    event: null,
    phase: 'idle',
    scenario: null,
    roster: [],
    factions: [],
    locations: [],
    cast: [],
    channels: [],
    spaces: [],
    beats: [],
    events: [],
    ledgerLen: 0,
    messages: [],
    world: [],
    modsOnline: null,
    directors: [],
    log: [],
    personas: [],
    connected: false,
    live: false,
    busy: false,
    error: null,
    activeTab: CockpitTab.Chat,
    activeChannel: 'lobby',
    selection: null,
    choices: {},
    perspective: OPERATOR_LENS,

    init: async (projectId) => {
      holders += 1
      if (releaseTimer !== null) {
        clearTimeout(releaseTimer)
        releaseTimer = null
      }
      if (get().projectId === projectId) {
        // Already attached (the other stage holds it) — just make sure the
        // status is current; never tear the stream down for a mode switch.
        if (poll === null) startPoll()
        if (!get().event) await get().refresh()
        return
      }
      set({
        projectId,
        error: null,
        messages: [],
        selection: null,
        perspective: OPERATOR_LENS,
        activeTab: CockpitTab.Chat,
        activeChannel: 'lobby',
        // Named events come from the locally-indexed model (best-effort —
        // the running event's code is a snapshot of the same project).
        events: localNamedEvents(),
        ...EMPTY_SNAPSHOT,
      })
      await get().refresh()
      startPoll()
    },

    teardown: () => {
      holders = Math.max(0, holders - 1)
      if (holders > 0) return
      // React unmounts the old stage before mounting the next one, so a
      // Run ⇄ Deploy switch would otherwise drop + re-open the stream —
      // and lose the feed. Defer, and let a fresh init cancel it.
      if (releaseTimer !== null) clearTimeout(releaseTimer)
      releaseTimer = setTimeout(() => {
        releaseTimer = null
        if (holders > 0) return
        stopPoll()
        disconnect()
        useGraph.getState().runtimeReset()
        set({
          projectId: null,
          event: null,
          live: false,
          phase: 'idle',
          scenario: null,
          messages: [],
          selection: null,
          perspective: OPERATOR_LENS,
          activeTab: CockpitTab.Chat,
          activeChannel: 'lobby',
          ...EMPTY_SNAPSHOT,
        })
      }, 250)
    },

    refresh: async () => {
      const projectId = get().projectId
      if (!projectId) return
      try {
        const event = await eventsApi.status(projectId)
        const prev = get().event
        if (event === null) {
          if (prev !== null) clearEvent() // ended by a co-author
          return
        }
        set({ event, live: true, phase: event.status })
        // A new (or different) event appeared — a co-author launched it.
        if (prev === null || prev.id !== event.id || !es) {
          set({ events: localNamedEvents() })
          connect(event.id)
        }
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },

    launch: async (mode) => {
      const projectId = get().projectId
      if (!projectId) return
      set({ busy: true, error: null })
      try {
        const event = await eventsApi.launch(projectId, mode)
        set({ event, live: true, phase: event.status, events: localNamedEvents() })
        connect(event.id)
      } catch (e) {
        set({ error: (e as Error).message })
      } finally {
        set({ busy: false })
      }
    },

    pause: async () => {
      const projectId = get().projectId
      if (!projectId) return
      set({ busy: true })
      try {
        const event = await eventsApi.pause(projectId)
        set({ event, phase: event.status })
      } finally {
        set({ busy: false })
      }
    },

    resume: async () => {
      const projectId = get().projectId
      if (!projectId) return
      set({ busy: true })
      try {
        const event = await eventsApi.resume(projectId)
        set({ event, phase: event.status })
        if (!es && event) connect(event.id)
      } finally {
        set({ busy: false })
      }
    },

    end: async () => {
      const projectId = get().projectId
      if (!projectId) return
      set({ busy: true })
      try {
        await eventsApi.end(projectId)
        clearEvent()
      } finally {
        set({ busy: false })
      }
    },

    reset: async () => {
      // The stream's `lifecycle` notice + fresh `history` do the refresh.
      await withEvent((id) => modApi.reset(id))
    },

    pushDraft: async () => {
      const projectId = get().projectId
      if (!projectId) return
      set({ busy: true, error: null })
      try {
        const event = await eventsApi.reload(projectId)
        set({ event, phase: event.status, events: localNamedEvents() })
      } catch (e) {
        set({ error: (e as Error).message })
      } finally {
        set({ busy: false })
      }
    },

    capture: (id) => withEvent((ev) => modApi.act(ev, id, 'capture')),
    release: (id) => withEvent((ev) => modApi.act(ev, id, 'release')),
    hideMessage: (seq, hidden) => withEvent((ev) => modApi.hideMessage(ev, seq, hidden)),
    broadcast: (scope, cue) => withEvent((ev) => modApi.broadcast(ev, scope, cue)),
    say: (channel, text, as, parentSeq) => withEvent((ev) => modApi.say(ev, channel, text, as, parentSeq)),
    setStat: (id, field, value) => withEvent((ev) => modApi.setStat(ev, id, field, value)),
    fireBeat: (name, subject) => withEvent((ev) => modApi.fireBeat(ev, name, subject)),
    fireSignal: (name, subject, args) => withEvent((ev) => modApi.fireSignal(ev, name, subject, args)),
    scanAs: (as, target) => withEvent((ev) => modApi.scanAs(ev, as, target)),
    reveal: (faction) => withEvent((ev) => modApi.reveal(ev, faction)),
    // The mod snapshot carries pending choices, and this answers one on a
    // guest's behalf — journaled exactly like the guest's own tap.
    choose: (person, index) => withEvent((ev) => modApi.choose(ev, person, index)),
    // A director-puppeted guest — the shared-rehearsal path on a preview
    // event (each co-writer spawns + plays their own), and an emergency
    // stand-in guest on a live one. The created id is remembered as
    // "yours" (session-local), so the rail can badge your personas.
    addPersona: async (name) => {
      const ev = get().event
      if (!ev) return
      try {
        const guest = await modApi.persona(ev.id, name)
        if (guest !== null) set((s) => ({ personas: [...s.personas, guest.id] }))
      } catch (e) {
        set({ error: (e as Error).message })
      }
    },
    setVar: (path, value) => withEvent((ev) => modApi.setVar(ev, path, value)),

    setTab: (activeTab) => set({ activeTab }),
    selectChannel: (activeChannel) => set({ activeChannel }),
    select: (selection: Selection) => set({ selection }),
    setPerspective: (perspective) => set({ perspective }),
  }
})

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
