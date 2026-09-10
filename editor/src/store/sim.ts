//! The LOCAL run backend — Run mode on a local folder (and the guarded
//! "scratch" lane on a server project). Builds a real `@loom/core` `Sim`
//! from the LSP-indexed `.loom` project and drives it entirely in the
//! browser: no server, no event, no account. It implements the whole
//! `CockpitState` contract (`store/cockpit.ts`) — lifecycle included — so
//! every cockpit surface (header, rail, pages, inspector) works against it
//! unchanged, and it feeds the story canvas's `RuntimeOverlay` exactly the
//! way the server backend's mod SSE feed does.
//!
//! Message composition + snapshot projection reuse the event server's pure
//! modules (`@loom/core/chat`, `@loom/core/views`) verbatim, so a local run
//! reads exactly like the shared one — and the identity lens is the same
//! `guestView` / `primeView` projection the play app renders.

import { create } from 'zustand'
import { Sim, SimEventType, namedEvents, type SimEvent } from '@loom/core/sim'
import { ChatStore, composeGuestMessages } from '@loom/core/chat'
import { guestView, modView, primeView, type RuntimePhase } from '@loom/core/views'
import type { StatField } from '@/lib/api'
import { lspWorkspaceSync, pathForUri } from '@/lib/lsp-client'
import { useLspIndexGen } from '@/lib/lsp-index'
import { useGraph } from '@/store/graph'
import { useWorkspace } from '@/store/workspace'
import {
  CockpitPhase,
  CockpitTab,
  OPERATOR_LENS,
  RunBackend,
  RunMode,
  type CockpitState,
  type Lens,
  type RunInfo,
  type Selection,
} from '@/store/cockpit'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** The local console's director name (there is no account on a folder). */
const ME = 'Writer'

interface SimState extends CockpitState {
  /** LSP index generation the running sim was compiled at (stale check). */
  compiledAt: number
  /** The model's `entry:` beat, when it resolves. */
  entryBeat: string | null
}

/** One compiled source file, as handed to `Sim.fromSources`. */
interface CompiledSource {
  path: string
  source: string
}

// The live engine objects are module-level (non-reactive) — the store
// holds only their projections, refreshed after every command.
let sim: Sim | null = null
let chat: ChatStore | null = null
let ticker: number | null = null
let personaSeq = 0
/** The exact sources the current run was compiled from: `restart()` rebuilds
 *  from these (same snapshot), `pushDraft()` re-reads the index. */
let compiledSources: CompiledSource[] = []

const TICK_MS = 1000

const PHASE_FOR: Record<CockpitPhase, RuntimePhase> = {
  [CockpitPhase.Idle]: 'idle',
  [CockpitPhase.Open]: 'open',
  [CockpitPhase.Paused]: 'paused',
}

/** Read every indexed `.loom` document as a compile input. */
function indexedSources(): CompiledSource[] {
  const ws = lspWorkspaceSync()
  return [...ws.docs].map(([uri, doc]) => ({ path: pathForUri(uri), source: doc.text }))
}

/** Every field a finished run leaves behind — reset on end / rebuilt on boot. */
function empty(): Pick<
  SimState,
  | 'phase' | 'run' | 'connected' | 'roster' | 'factions' | 'locations' | 'cast' | 'channels' | 'spaces'
  | 'beats' | 'events' | 'interactions' | 'ledgerLen' | 'messages' | 'world' | 'personas' | 'log'
  | 'choices' | 'selection' | 'perspective' | 'lens' | 'error' | 'entryBeat'
> {
  return {
    phase: CockpitPhase.Idle,
    run: null,
    connected: false,
    roster: [],
    factions: [],
    locations: [],
    cast: [],
    channels: [],
    spaces: [],
    beats: [],
    events: [],
    interactions: [],
    ledgerLen: 0,
    messages: [],
    world: [],
    personas: [],
    log: [],
    choices: {},
    selection: null,
    perspective: OPERATOR_LENS,
    lens: null,
    error: null,
    entryBeat: null,
  }
}

export const useSim = create<SimState>((set, get) => {
  /** The lens identity's own projection, if a non-operator lens is active. */
  const lensFor = (perspective: string): Lens => {
    if (sim === null || perspective === OPERATOR_LENS) return null
    if (sim.persons.has(perspective)) return { kind: 'guest', id: perspective, view: guestView(sim, perspective, null) }
    if (sim.model.characters.has(perspective)) return { kind: 'performer', id: perspective, view: primeView(sim, perspective) }
    return null
  }

  /** Re-project every snapshot surface out of the live sim. */
  const snapshot = (): void => {
    if (sim === null || chat === null) return
    const s = get()
    const view = modView(sim, PHASE_FOR[s.phase], s.run?.scenario ?? null)
    // Every pending choice — personas, story-created guests, and the
    // unbound global menu — exactly what the live `ModView.choices` carries.
    const choices = sim.allPendingChoices()
    // The lens follows the roster: an identity that vanished (a restart)
    // drops back to the Operator instead of showing a stale view.
    const lens = lensFor(s.perspective)
    const perspective = s.perspective === OPERATOR_LENS || lens !== null ? s.perspective : OPERATOR_LENS
    set({
      roster: view.roster.map((r) => ({ ...r, owner: s.personas.includes(r.id) ? ME : null })),
      factions: view.factions,
      locations: view.locations,
      cast: view.cast,
      channels: view.channels,
      spaces: view.spaces,
      beats: view.beats,
      interactions: view.interactions ?? [],
      ledgerLen: view.ledgerLen,
      messages: [...chat.all()],
      choices,
      world: view.world,
      lens,
      perspective,
    })
  }

  /** Compose + project a freshly-drained batch (ledger rows from `from`). */
  const ingest = (from: number, via?: string): void => {
    if (sim === null || chat === null) return
    const events = sim.log.since(from)
    if (events.length > 0) {
      const drafts = composeGuestMessages(sim, events)
      // A director speaking *as* a participant: the room sees the persona's
      // name, the cockpit additionally sees who really typed it.
      if (via !== undefined) for (const d of drafts) if (d.kind === 'line') d.via = via
      chat.append(drafts)
      const ts = sim.elapsed()
      const rows = events.map((event, i) => ({ seq: from + i, ts, event }))
      set((s) => ({ log: [...s.log, ...rows] }))
      // The runtime overlay lights the story map exactly like the server
      // backend — beat pulses plus each persona's live position chip.
      for (const e of events) {
        if (e.type === SimEventType.BeatEntered) {
          const label = e.subject !== null ? (sim.persons.get(e.subject)?.name ?? e.subject) : null
          useGraph.getState().runtimeEnter(e.beat, e.subject, label)
        }
      }
    }
    snapshot()
  }

  /** Run one command against the live sim and ingest what it produced. */
  const run = (fn: (s: Sim) => void, via?: string): SimEvent[] => {
    if (sim === null) return []
    const from = sim.log.len()
    try {
      fn(sim)
      set({ error: null })
    } catch (e) {
      set({ error: (e as Error).message })
    }
    const produced = sim.log.since(from)
    ingest(from, via)
    return produced
  }

  // The autonomous clock only runs in a browser; headless tests drive
  // the sim through the command surface instead.
  const stopTicker = (): void => {
    if (ticker !== null) {
      window.clearInterval(ticker)
      ticker = null
    }
  }

  const startTicker = (): void => {
    if (typeof window === 'undefined') return
    stopTicker()
    ticker = window.setInterval(() => {
      if (sim !== null && get().phase === CockpitPhase.Open) {
        run((s) => void s.tick(TICK_MS))
      }
    }, TICK_MS)
  }

  /**
   * Boot a fresh engine from `sources` (the shared core of start / restart /
   * push draft): compile, spawn the director's persona, fire the entry beat,
   * land on Chat / lobby. `compiledAt` is the caller's business.
   */
  const boot = (sources: CompiledSource[], scratch: boolean): void => {
    sim = Sim.fromSources(...sources)
    chat = new ChatStore()
    personaSeq = 0
    useGraph.getState().runtimeReset()
    const entry = sim.model.entry !== null && sim.model.beats.has(sim.model.entry) ? sim.model.entry : null
    const startedAt = Date.now()
    const info: RunInfo = {
      backend: RunBackend.Local,
      mode: RunMode.Rehearsal,
      scratch,
      scenario: useWorkspace.getState().projectName ?? useWorkspace.getState().root?.name ?? 'workspace',
      stale: false,
      codes: null,
      joinUrl: null,
      eventId: null,
      startedAt,
      startedBy: ME,
    }
    set({
      ...empty(),
      phase: CockpitPhase.Open,
      run: info,
      connected: true,
      events: namedEvents(sim.model),
      entryBeat: entry,
      activeTab: CockpitTab.Chat,
      activeChannel: 'lobby',
      notice: null,
    })
    // A persona named after you so scans / DMs / per-guest beats have a
    // subject, then the entry beat (when authored) so the story starts
    // playing. Each command ingests its own ledger slice.
    void get().addPersona(ME)
    if (entry !== null) run((s) => void s.fireBeat(entry))
    snapshot()
    startTicker()
  }

  const teardown = (): void => {
    stopTicker()
    sim = null
    chat = null
    compiledSources = []
    useGraph.getState().runtimeReset()
  }

  return {
    // ---- CockpitState ----
    ...empty(),
    busy: false,
    me: ME,
    modsOnline: null,
    directors: [],
    lastRun: null,
    notice: null,
    activeTab: CockpitTab.Run,
    activeChannel: 'lobby',
    compiledAt: -1,

    setTab: (activeTab) => set({ activeTab }),
    selectChannel: (activeChannel) => set({ activeChannel }),
    select: (selection: Selection) => set({ selection }),
    setPerspective: (perspective) => {
      const lens = lensFor(perspective)
      set({ perspective: lens === null ? OPERATOR_LENS : perspective, lens })
    },
    dismissNotice: () => set({ notice: null }),

    // ---- lifecycle ----
    startRun: async (mode, opts) => {
      if (mode === RunMode.Live) {
        set({ error: 'A live event needs a server project — this folder runs in the browser only.' })
        return
      }
      const sources = indexedSources()
      if (sources.length === 0) {
        set({ error: 'No .loom files indexed yet.' })
        return
      }
      compiledSources = sources
      boot(sources, opts?.scratch === true)
      set({ compiledAt: lspWorkspaceSync().generation })
    },

    pause: async () => {
      if (get().phase !== CockpitPhase.Open) return
      set({ phase: CockpitPhase.Paused })
    },

    resume: async () => {
      if (get().phase !== CockpitPhase.Paused) return
      set({ phase: CockpitPhase.Open })
    },

    // Same snapshot: the sources this run was compiled from. `compiledAt`
    // (and therefore `stale`) is untouched — nothing new was picked up.
    restart: async () => {
      const current = get().run
      if (current === null) return
      stopTicker()
      boot(compiledSources, current.scratch)
      set((s) => ({ run: s.run === null ? null : { ...s.run, stale: current.stale } }))
    },

    // The project's current text: re-read the index, then the same fresh start.
    pushDraft: async () => {
      const current = get().run
      if (current === null) return
      const sources = indexedSources()
      if (sources.length === 0) {
        set({ error: 'No .loom files indexed yet.' })
        return
      }
      compiledSources = sources
      stopTicker()
      boot(sources, current.scratch)
      set({ compiledAt: lspWorkspaceSync().generation })
    },

    goLive: async () => {
      set({ error: 'Going live needs a server project — this run is in the browser only.' })
    },

    end: async () => {
      const s = get()
      const lastRun =
        s.run !== null
          ? { run: s.run, log: s.log, messages: s.messages, roster: s.roster, factions: s.factions, locations: s.locations, world: s.world, choices: s.choices, endedBy: ME, endedAt: Date.now() }
          : s.lastRun
      teardown()
      set({ ...empty(), lastRun, activeTab: CockpitTab.Run, activeChannel: 'lobby', notice: null, compiledAt: -1 })
    },

    // The operator/mod command surface, mirrored onto the local sim with
    // the exact semantics of the server's `/api/mod/*` routes.
    say: async (channel, text, as, parentSeq) => {
      const t = text.trim()
      if (t.length === 0 || sim === null) return
      const speaker = as !== undefined && as !== '' ? as : 'Operator'
      const isPerson = sim.persons.has(speaker)
      const isCharacter = sim.model.characters.has(speaker)
      if (!isPerson && !isCharacter && speaker !== 'Operator' && speaker !== 'Narrator') {
        set({ error: `unknown speaker: ${speaker}` })
        return
      }
      let ch = channel || 'lobby'
      let audience: 'all' | string[] | undefined
      if (ch.startsWith('guest:')) {
        const gid = ch.slice('guest:'.length)
        if (!sim.persons.has(gid)) return
        if (isPerson) {
          set({ error: `${sim.persons.get(speaker)!.name} can't DM a guest — speak in a room` })
          return
        }
        ch = `dm:${speaker}`
        audience = [gid]
      }
      // Speaking as a participant obeys their post policy, like the server.
      if (isPerson && !sim.canPost(speaker, ch)) {
        set({ error: `you can't post here as ${sim.persons.get(speaker)!.name}` })
        return
      }
      const parent = sim.threadableOf(ch) && parentSeq != null ? parentSeq : null
      run((s) => void s.say(speaker, ch, t, parent, audience), isPerson ? ME : undefined)
    },
    hideMessage: async (seq, hidden) => {
      if (chat === null) return
      chat.setHidden(seq, hidden)
      snapshot()
    },
    capture: async (id) => void run((s) => void s.capture(id)),
    release: async (id) => void run((s) => void s.escape(id)),
    broadcast: async (scope, cue) => {
      // Like the server: a mod broadcast is composed straight to chat
      // (it is not a journaled sim event).
      if (sim === null || chat === null) return
      const synthetic: SimEvent = {
        type: SimEventType.Broadcast,
        cue,
        audience: sim.audienceFor(scope),
        scope,
      }
      chat.append(composeGuestMessages(sim, [synthetic]))
      snapshot()
    },
    setStat: async (id, field: StatField, value) => {
      run((s) => {
        switch (field) {
          case 'score':
            s.setScore(id, Number(value ?? 0))
            break
          case 'faction':
            if (typeof value === 'string' && value !== '') s.defect(id, value)
            break
          case 'location':
            if (typeof value === 'string' && value !== '') s.arrive(id, value)
            break
          case 'captured':
            if (value === true || value === 'true') s.capture(id)
            else s.escape(id)
            break
        }
      })
    },
    setVar: async (path, value) => void run((s) => void s.setVar(path, value)),
    fireBeat: async (name, subject) => void run((s) => void s.fireBeat(name, subject)),
    fireSignal: async (name, subject, args, actor) =>
      void run((s) => void s.signal(name, subject, args ?? null, actor ?? null)),
    scanAs: async (as, target) => {
      const produced = run((s) => void s.scan(as, target))
      return produced
        .filter((e): e is Extract<SimEvent, { type: 'respond' }> => e.type === SimEventType.Respond && e.to === as)
        .map((e) => e.text)
    },
    reveal: async (faction) => void run((s) => void s.reveal(faction)),
    choose: async (person, index) => void run((s) => void s.choose(person, index)),

    addPersona: async (name) => {
      if (sim === null) return
      personaSeq += 1
      const id = `p${personaSeq}`
      const label = name !== undefined && name.trim() !== '' ? name.trim() : `Guest ${personaSeq}`
      set((s) => ({ personas: [...s.personas, id] }))
      run((s) => void s.createPerson(id, label))
    },
  }
})

// `stale` is real state: the moment the LSP index moves past what the run
// was compiled from, the header's draft control lights up — no polling.
// `useLspIndexGen` is only the trigger; the comparison uses the Workspace's
// own generation, the clock `compiledAt` was taken from.
useLspIndexGen.subscribe(() => {
  const st = useSim.getState()
  if (st.run === null) return
  const stale = lspWorkspaceSync().generation !== st.compiledAt
  if (stale !== st.run.stale) useSim.setState({ run: { ...st.run, stale } })
})

/** The director name this console's own persona speech is attributed to. */
export const LOCAL_DIRECTOR = ME
