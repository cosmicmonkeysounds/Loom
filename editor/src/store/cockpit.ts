//! The cockpit contract — the shared state + action surface behind Run
//! mode. There is ONE cockpit (header lifecycle + identity · rooms rail ·
//! Run / Stage / Chat / Story / Roster / World / Director / Log pages ·
//! entity inspector) and the backend behind it is resolved from the open
//! workspace, never picked by the user (`store/run.ts`): a **server
//! project** runs on the server — the project's single shared event, over
//! the mod SSE + `/e/:eventId/api/mod/*` (`store/operate.ts`) — and a
//! **local folder** runs the in-browser `@loom/core` `Sim`
//! (`store/sim.ts`). Both stores implement this whole surface, *including
//! the run lifecycle*, so no component under `RunCockpit` ever reaches for
//! a concrete store: shared components read through `useCockpit`, which
//! resolves to whichever store the enclosing `CockpitContext.Provider`
//! supplies.
//!
//! Every closed vocabulary here is an enum (const-object form — the
//! workspace compiles with `erasableSyntaxOnly`, which forbids runtime
//! TS `enum` syntax): tabs, backends, run modes, selection kinds, phases.

import { createContext, useContext } from 'react'
import { create, useStore } from 'zustand'
import type { SignalArgs, StatField } from '@/lib/api'
import type { SimEvent } from '@loom/core/sim'
import type { GuestView, InteractionSummary, PrimeView } from '@loom/core/views'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** The cockpit's center pages. `Run` is the front-of-house page (start /
 *  join codes + QR / directors / guest lookup); `Log` is the raw ledger. */
export const CockpitTab = {
  Run: 'run',
  Stage: 'stage',
  Chat: 'chat',
  Story: 'story',
  Roster: 'roster',
  World: 'world',
  Director: 'director',
  Log: 'log',
} as const

export type CockpitTab = (typeof CockpitTab)[keyof typeof CockpitTab]

/** Where a run executes. Resolved from the workspace kind (`store/run.ts`):
 *  a server project → `Server`, a local folder → `Local`. */
export const RunBackend = {
  Local: 'local',
  Server: 'server',
} as const

export type RunBackend = (typeof RunBackend)[keyof typeof RunBackend]

/** What a run is for. A `Rehearsal` is private to the writing team (the
 *  server's `preview` event, or the in-browser sim); `Live` has real
 *  guests joining by code (server only). */
export const RunMode = {
  Rehearsal: 'rehearsal',
  Live: 'live',
} as const

export type RunMode = (typeof RunMode)[keyof typeof RunMode]

/** What the Inspector tray is bound to. */
export const SelectionKind = {
  Guest: 'guest',
  Character: 'character',
  Faction: 'faction',
  Location: 'location',
} as const

export type SelectionKind = (typeof SelectionKind)[keyof typeof SelectionKind]

export type Selection = { kind: SelectionKind; id: string } | null

/** Lifecycle phase, shared vocabulary with the event server's `RuntimePhase`.
 *  `run !== null` ⇔ `phase !== Idle`. */
export const CockpitPhase = {
  Idle: 'idle',
  Open: 'open',
  Paused: 'paused',
} as const

export type CockpitPhase = (typeof CockpitPhase)[keyof typeof CockpitPhase]

/** The god-view lens — the cockpit's default `perspective`. Any other value
 *  is a guest/persona id (their room set + feed) or a character id (the
 *  performer view). */
export const OPERATOR_LENS = 'operator'

/** The key unbound (no-participant) choice menus queue under — the same
 *  sentinel the server's `ModView.choices` uses. */
export const GLOBAL_CHOICE_KEY = '__global'

/** A mod-spawned persona id (`/api/mod/persona`, or the local sim) starts
 *  with `p`; a human who registered through the play app is `g-…`. The
 *  composer uses this to tell "my puppet" from "a real person". */
export function isPersonaId(id: string): boolean {
  return id.startsWith('p')
}

// ---------------------------------------------------------------------------
// Shared data shapes (the server's view projections / their local twins)
// ---------------------------------------------------------------------------

export interface RosterRow {
  id: string
  name: string
  role: string
  faction: string | null
  trueFaction: string | null
  location: string | null
  captured: boolean
  score: number
  /** Story position — the beat this guest is currently inside, if any. */
  beat?: string | null
  /** Their trail: every beat entered for them, with visit counts. */
  visited?: Record<string, number>
  /** Live presence (SSE stream open right now). Only the live event
   *  tracks this — undefined on the local sim, where it has no meaning. */
  online?: boolean
  /** The director who spawned this persona (display name), null/undefined
   *  for a real guest. Server: `ModPresence.owners`; local: `me`. */
  owner?: string | null
}

export interface CockpitMessage {
  seq: number
  channel: string
  channelKind?: string
  title?: string
  from: string
  text: string
  kind: string
  ts: number
  hidden?: boolean
  audience: 'all' | string[]
  parentSeq?: number | null
  /** The beat a scripted line was spoken in — links a message to the map. */
  beat?: string | null
  /** The director who posted this *as* a participant (mod `say` with `as`
   *  naming a person). Never shown to guests. */
  via?: string
}

export interface FactionSummary {
  id: string
  hidden: boolean
  revealed: boolean
  ethos?: string | null
  rival?: string | null
  members: string[]
}

export interface LocationSummary {
  id: string
  label: string | null
  prison: boolean
  occupants: string[]
}

export interface ChannelSummary {
  id: string
  kind: string
  title: string
  spaceId: string
}

export interface CastSummary {
  id: string
  faction: string | null
  /** A performer is signed in and streaming as this character right now. */
  online?: boolean
}

/** One live world-state entry (`g-1a2b.score` → `42`), display-stringed. */
export interface WorldEntry {
  path: string
  value: string
}

export interface SpaceSummary {
  id: string
  title: string
}

/** One raw ledger row (the Log page) — the engine's `SimEvent` as it
 *  landed, with its position and the story clock. */
export interface LedgerEntry {
  seq: number
  /** Story-clock ms when the event landed. */
  ts: number
  event: SimEvent
}

/** The run that exists right now (null = nothing running). */
export interface RunInfo {
  backend: RunBackend
  mode: RunMode
  /** An in-browser run entered from a *server* project (the guarded
   *  "test privately" lane) — never persisted, always `backend: Local`. */
  scratch: boolean
  scenario: string | null
  /** The project's text has moved on since this run was compiled / launched
   *  — "Push current draft" would change what plays. Real store state on
   *  both backends (the local store watches the LSP index generation). */
  stale: boolean
  /** Join codes — server runs only. */
  codes: { event: string; prime: string; mod: string } | null
  /** Guest join URL — server runs only. */
  joinUrl: string | null
  /** The server event id (for `/e/:id/…` links); null locally. */
  eventId: string | null
  /** Epoch ms the run started (server: `EventInfo.createdAt`). */
  startedAt: number | null
  /** Display name of whoever started it (server: `EventInfo.startedBy`;
   *  local: `me`). */
  startedBy: string | null
}

/** The identity the cockpit is "being" — the server's own projection of a
 *  participant (`GuestView` / `PrimeView`, the literal types the play app
 *  renders), so what you see is exactly what they see. Null under the
 *  Operator lens. */
export type Lens =
  | { kind: 'guest'; id: string; view: GuestView }
  | { kind: 'performer'; id: string; view: PrimeView }
  | null

/** A run that ended (here or by a co-writer) — kept so "Export run" still
 *  works and the empty state can say who ended it. */
export interface LastRun {
  run: RunInfo
  log: LedgerEntry[]
  messages: CockpitMessage[]
  /** The final snapshot, so an export after the end is complete. */
  roster: RosterRow[]
  factions: FactionSummary[]
  locations: LocationSummary[]
  world: WorldEntry[]
  choices: Record<string, string[]>
  endedBy: string | null
  endedAt: number
}

/** A dismissable header banner: a lifecycle transition someone else
 *  caused ("Restarted by Ana on the current draft"), or an adopted run. */
export interface CockpitNotice {
  text: string
  at: number
  tone: 'info' | 'warn'
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

export interface CockpitState {
  phase: CockpitPhase
  /** The run that exists right now; null = nothing running. */
  run: RunInfo | null
  /** A lifecycle request is in flight (disables the header controls). */
  busy: boolean
  /** This console's director name — matches the server's `directors`
   *  entry (`user.name || user.email`); `'Writer'` on the local backend. */
  me: string
  /** Backend link is up (SSE connected / local sim instantiated). */
  connected: boolean
  roster: RosterRow[]
  factions: FactionSummary[]
  locations: LocationSummary[]
  cast: CastSummary[]
  channels: ChannelSummary[]
  spaces: SpaceSummary[]
  /** Every named beat (the "fire beat" picker). */
  beats: string[]
  /** Model-enumerated authored events (`on lockdown`, …) for the director. */
  events: string[]
  /** Every declared `INTERACTION` (`ModView.interactions`) — rendered as
   *  buttons under a guest lens (`who: guest`) / performer lens
   *  (`who: performer | admin`, on a target guest). */
  interactions: InteractionSummary[]
  ledgerLen: number
  messages: CockpitMessage[]
  error: string | null
  /** The whole live world state (the director's debugger view). */
  world: WorldEntry[]
  /** Connected director consoles (co-writers on this event); null = untracked. */
  modsOnline: number | null
  /** Those directors by display name (empty when untracked). */
  directors: string[]
  /** The raw event ledger — every `SimEvent` the engine emitted, in order
   *  (the local sim's whole run; a live event's feed since this console
   *  connected, capped). */
  log: LedgerEntry[]
  /** Guest ids THIS console puppets — the local sim's personas, or every
   *  roster row whose `owner === me` on the server. */
  personas: string[]
  /** The most recently ended run (for Export + the empty state). */
  lastRun: LastRun | null
  /** A dismissable header banner, if any. */
  notice: CockpitNotice | null

  activeTab: CockpitTab
  /** The room the Chat page is peering into (channel id / room key). */
  activeChannel: string
  selection: Selection
  /** Outstanding choices per person id (`__global` for unbound menus). */
  choices: Record<string, string[]>
  /** The identity lens the cockpit views + speaks through: `OPERATOR_LENS`
   *  (god view), a guest/persona id, or a character id. */
  perspective: string
  /** The server-projected view of the lens identity (null for Operator).
   *  Refreshed on every snapshot while a lens is active. */
  lens: Lens

  setTab(tab: CockpitTab): void
  selectChannel(channel: string): void
  select(selection: Selection): void
  /** Switch the lens. Resolves `lens` (async on the server) — `perspective`
   *  flips immediately, `lens` follows. */
  setPerspective(id: string): void
  dismissNotice(): void

  // ---- lifecycle (identical semantics on both backends) ----
  /** Start a run. `Rehearsal` on the server = `launch('preview')`, then a
   *  persona named `me` is spawned and the cockpit lands on Chat / lobby;
   *  locally = compile the indexed sources + the same persona + entry beat.
   *  `Live` is server-only (locally: sets `error`). `opts.scratch` marks an
   *  in-browser run entered from a server project. */
  startRun(mode: RunMode, opts?: { scratch?: boolean }): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  /** Start the story over on the SAME snapshot (server `/api/mod/reset`;
   *  local: rebuild from the sources captured at `startRun`). */
  restart(): Promise<void>
  /** Restart on the project's CURRENT text (server `…/event/reload`;
   *  local: recompile from the LSP index). Clears `run.stale`. */
  pushDraft(): Promise<void>
  /** Promote a server rehearsal to a live event in place (codes kept, story
   *  restarted fresh). Locally: sets `error`. */
  goLive(): Promise<void>
  /** End the run (server `…/event/end`; local: tear the sim down). What
   *  ended moves into `lastRun`. */
  end(): Promise<void>

  // ---- the mod / operator command surface ----
  say(channel: string, text: string, as?: string, parentSeq?: number | null): Promise<void>
  hideMessage(seq: number, hidden: boolean): Promise<void>
  capture(id: string): Promise<void>
  release(id: string): Promise<void>
  broadcast(scope: string, cue: string): Promise<void>
  setStat(id: string, field: StatField, value: string | number | boolean): Promise<void>
  fireBeat(name: string, subject?: string): Promise<void>
  /** Fire an `on <name>` signal — globally or on one subject, with optional
   *  `key: value` args, optionally *as* a character (`actor`) so only that
   *  character's hooks hear it (the performer-lens interaction path). */
  fireSignal(name: string, subject?: string, args?: SignalArgs | null, actor?: string | null): Promise<void>
  /** Scan a guest as a character. Resolves to that character's `respond`
   *  readouts (the booth's scan responses). */
  scanAs(as: string, target: string): Promise<string[]>
  reveal(faction: string): Promise<void>
  /** Answer a pending choice — the local engine's saved continuation, or
   *  the journaled `/api/mod/choose` on a guest's behalf. */
  choose(person: string, index: number): Promise<void>
  /** Spawn a persona to act as (a local guest, or a journaled
   *  `/api/mod/persona` guest owned by `me` on the server). */
  addPersona(name?: string): Promise<void>
  /** Write any world variable (the World browser's inline editing). */
  setVar(path: string, value: string): Promise<void>
}

/**
 * The read surface `useCockpit` needs. Deliberately the *readonly*
 * store API so a store whose full state is a superset of
 * `CockpitState` (`useOperate`, `useSim`) is assignable as-is —
 * `setState`'s contravariant partial would forbid that.
 */
export type CockpitStore = {
  getState(): CockpitState
  getInitialState(): CockpitState
  subscribe(listener: (state: CockpitState, prevState: CockpitState) => void): () => void
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const noop = async (): Promise<void> => {}

/**
 * The inert default cockpit — every surface empty, every action a no-op.
 * Lets cockpit-aware components (e.g. the story canvas's "Fire beat")
 * mount outside a provider (Writing mode's canvas) without special-casing.
 */
export const nullCockpit: CockpitStore = create<CockpitState>((set) => ({
  phase: CockpitPhase.Idle,
  run: null,
  busy: false,
  me: '',
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
  error: null,
  world: [],
  modsOnline: null,
  directors: [],
  log: [],
  personas: [],
  lastRun: null,
  notice: null,
  activeTab: CockpitTab.Run,
  activeChannel: 'lobby',
  selection: null,
  choices: {},
  perspective: OPERATOR_LENS,
  lens: null,
  setTab: (activeTab) => set({ activeTab }),
  selectChannel: (activeChannel) => set({ activeChannel }),
  select: (selection) => set({ selection }),
  setPerspective: (perspective) => set({ perspective }),
  dismissNotice: () => set({ notice: null }),
  startRun: noop,
  pause: noop,
  resume: noop,
  restart: noop,
  pushDraft: noop,
  goLive: noop,
  end: noop,
  say: noop,
  hideMessage: noop,
  capture: noop,
  release: noop,
  broadcast: noop,
  setStat: noop,
  fireBeat: noop,
  fireSignal: noop,
  scanAs: async () => [],
  reveal: noop,
  choose: noop,
  addPersona: noop,
  setVar: noop,
}))

export const CockpitContext = createContext<CockpitStore>(nullCockpit)

/** Read a slice of whichever cockpit store the enclosing provider supplies. */
export function useCockpit<T>(selector: (s: CockpitState) => T): T {
  const store = useContext(CockpitContext)
  return useStore(store, selector)
}
