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
import type { SimEvent, WalletCard } from '@loom/core/sim'
import type { WidgetCard } from '@loom/core/chat'
import type {
  AgentControl,
  AgentMindSummary,
  AgentThought,
  CodexSummary,
  CueState,
  GuestView,
  InteractionSummary,
  PrimeView,
  QuestSummary,
  WalletModView,
  WatchSummary,
  CountdownSummary,
} from '@loom/core/views'
// The facts judge's ledger view (`ModView.facts`, Wave 4 lane B); every
// editor surface reads it through this re-export.
import type { FactVerdict, FactsFiling, FactsQuestion, FactsView } from '@loom/core/views'

export type { FactVerdict, FactsFiling, FactsQuestion, FactsView }
// The Director page's board (`ModView.watch` / `ModView.countdowns`, wave 10).
export type { WatchSummary, CountdownSummary }

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** The cockpit's center pages. `Run` is the front-of-house page (start /
 *  join codes + QR / directors / guest lookup); `Players` embeds one real
 *  play app per participant you're playing; `Log` is the raw ledger. */
export const CockpitTab = {
  Run: 'run',
  Stage: 'stage',
  Chat: 'chat',
  Players: 'players',
  Story: 'story',
  Roster: 'roster',
  World: 'world',
  Director: 'director',
  Mind: 'mind',
  Log: 'log',
} as const

export type CockpitTab = (typeof CockpitTab)[keyof typeof CockpitTab]

/** The patch a tab switch makes: the new tab, and — when it leaves the Log —
 *  the Director's `+N more ↗ Log` press focus dropped, so the tab bar's Log
 *  is the whole ledger again. Cleared here on explicit navigation, never on
 *  the Log page's unmount: React StrictMode unmounts + remounts every page
 *  right after mount in dev, which used to drop the focus (and the secret
 *  masking with it) the moment the Log opened. */
export function tabSwitch(
  s: { logPress: number | null },
  activeTab: CockpitTab,
): { activeTab: CockpitTab; logPress: number | null } {
  return { activeTab, logPress: activeTab === CockpitTab.Log ? s.logPress : null }
}

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

/** Which play app a Players pane runs: a guest's (for a persona or a real
 *  guest) or a performer's booth (for a character). Values are the server's
 *  role names (`/api/mod/impersonate`). */
export const PlayerRole = {
  Guest: 'guest',
  Performer: 'prime',
} as const

export type PlayerRole = (typeof PlayerRole)[keyof typeof PlayerRole]

/** A director's step on one person's quest — the server's `/api/mod/quest`
 *  actions, the same steps `start / update / complete / fail quest` take. */
export const QuestAction = {
  Start: 'start',
  Update: 'update',
  Complete: 'complete',
  Fail: 'fail',
} as const

export type QuestAction = (typeof QuestAction)[keyof typeof QuestAction]

/** A director's hand on the story's wallet — the server's
 *  `/api/mod/wallet/<action>` routes. `approve` / `deny` / `cancel` take an
 *  open item's id, `stimulus` an amount, `approve-held` nothing, `unfreeze`
 *  a freeze's id (lifts the minter's 🧊 early). */
export const WalletAction = {
  Approve: 'approve',
  Deny: 'deny',
  Cancel: 'cancel',
  Stimulus: 'stimulus',
  ApproveHeld: 'approve-held',
  Unfreeze: 'unfreeze',
} as const

export type WalletAction = (typeof WalletAction)[keyof typeof WalletAction]

/** The story clock as last read off a snapshot (`ModView.clock`, story ms)
 *  and the wall time it arrived — a countdown ticks from it between
 *  snapshots (the clock stands still while the run is paused). */
export interface StoryClock {
  ms: number
  at: number
}

/** The story clock now: the last snapshot's reading plus the wall time since
 *  — unless the run is paused, when the story clock stands still. */
export function storyNow(clock: StoryClock | null, running: boolean, wallNow: number): number | null {
  if (clock === null) return null
  return running ? clock.ms + Math.max(0, wallNow - clock.at) : clock.ms
}

/** A live play-as session, shaped for `@loom/play/embed`'s `PlayEmbed`. */
export type PlayerSession =
  | { role: 'guest'; token: string; id: string; name: string; eventId: string; title?: string }
  | { role: 'prime'; token: string; character: string; eventId: string; title?: string; host?: boolean }

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
  /** Marked: `restrict who` is in force (their phone is greyed, buttons
   *  off). Optional so older fixtures / servers compile. */
  restricted?: boolean
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
  /** The guest's last activity (stream open, any authenticated guest
   *  request), epoch ms — null when never seen. Server only (wave 11 C5);
   *  absent on the local sim and an older server. */
  lastSeen?: number | null
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
  /** The card a `widget` message carries (a CAPTCHA, a picture, a poll…). */
  widget?: WidgetCard
  /** A Codex-room entry card (`kind: 'codex'`). */
  codex?: { entry: string; title: string; via: string; from: string | null }
  /** A Quest Log step (`kind: 'quest'`): the card is `start`, the rest reply to it. */
  quest?: { quest: string; title: string; action: string }
  /** A Wallet-room card (`kind: 'wallet'`), from its viewer's side. */
  wallet?: WalletCard
  /** A booth readout (the story's `reply` to a scan or a press). Since wave
   *  13 it lands in the character's own Inbox (`dm:<Character>`, addressed
   *  `@<Character>`), not the lobby. */
  readout?: true
  /** A booth readout's subject guest id (the guest the scan or press was on). */
  about?: string
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
  /** A staff room (`# hosts`: an authored `kind: faction` CHANNEL whose
   *  GROUP no guest may join) — where the story says why it refused a cue. */
  staff?: true
}

/** What a `fireSignal` press came to. `refused`: the story heard the cue
 *  and did nothing but, at most, tell a staff room why (the server's
 *  `/api/mod/signal` `refused: true`, the local `pressRefused`) — the cue
 *  is not taken. `error`: the press never landed (network / engine error;
 *  also put in `error`). An empty result is a press the story took. */
export interface FireResult {
  refused?: true
  error?: string
  /** The press was sent with the press count its arm was bound to, and
   *  another press had landed since (a second director): the server never
   *  fired it (`/api/mod/signal` 409 `moved`). Re-arm. */
  moved?: true
  /** With `moved`: the cue the newest press fired (the 409's fresh
   *  `cues.pressed`) — what the banner names, never this console's own. */
  pressed?: string | null
  /** The cue state's press count once this press landed (the server's 200),
   *  or, with `moved`, the count after the press that beat it (the 409's
   *  `cues.presses`); absent from the local backend and an older server.
   *  The Director keeps its lock until its marks show it, so the next arm
   *  binds past it. */
  presses?: number
}

/** This console's newest press of a named event, from any surface (the
 *  Director, the header QuickFire, Tools, the Inspector, the Mind page):
 *  the event's name and the wall ms it was sent. The Director tells its
 *  own LAST from another director's by it. */
export interface OwnPress {
  name: string
  at: number
}

export interface CastSummary {
  id: string
  faction: string | null
  /** A performer (or, for an agent, a worker) is streaming as this character right now. */
  online?: boolean
  /** Voiced by an agent worker (`mind: external`), never a performer. */
  agent?: boolean
  /** A part a performer can sign in to (the server's `performerPickable`);
   *  absent on an older server, which flags no row. */
  part?: boolean
  /** A sign-in token holds the part — true even while its phone's stream is down. */
  held?: boolean
  /** `secret: true` (the Kernel): its values are masked on the Director. */
  secret?: true
  /** A guest's program held for its invitee (wave 11 C5): taken only with
   *  its claim. */
  reserved?: true
  /** A reserved program a director opened to anyone until then (epoch ms,
   *  `/api/mod/claim/unlock`): present only while that window is open. */
  unlockedUntil?: number
  /** An agent-voiced character's request queue (wave 11 C6): how many
   *  threads wait, the oldest wait (ms), and whether its worker stalled (a
   *  head request unanswered > 60 s). Absent on an older server / locally. */
  agentQueue?: AgentQueue
}

/** `CastSummary.agentQueue` (or the agent mind summary's), wave 11 C6. */
export interface AgentQueue {
  depth: number
  /** The oldest wait as of the server's send (it never ages on the wire). */
  oldestMs: number | null
  stalled: boolean
  /** Client only: the wall ms this console received `oldestMs`, so the
   *  wait keeps aging between snapshots (`agentQueueOf(…, now)`). */
  receivedAt?: number
}

/** Stamp each cast row's `agentQueue` with when it arrived. A queue the
 *  snapshot did not change (a keyed patch left the row alone) keeps its
 *  earlier stamp: its `oldestMs` is still that earlier send's. */
export function stampAgentQueues(next: readonly CastSummary[], prev: readonly CastSummary[], at: number): CastSummary[] {
  const before = new Map(prev.map((c) => [c.id, c.agentQueue]))
  return next.map((c) => {
    const q = c.agentQueue
    if (q === undefined || q === null || typeof q !== 'object') return c
    const old = before.get(c.id)
    const same = old !== undefined && old.depth === q.depth && old.oldestMs === q.oldestMs && old.stalled === q.stalled
    return { ...c, agentQueue: { ...q, receivedAt: same && old.receivedAt !== undefined ? old.receivedAt : at } }
  })
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
 *  landed, with its position and when this console saw it. */
export interface LedgerEntry {
  seq: number
  /** When the event landed, in story-clock ms on both backends (a server
   *  run reads it off the last snapshot's clock, run on to the receive
   *  time). Absent on a row this console never saw land — one back-filled
   *  off `/api/mod/log` for an export — or from a server that sends no
   *  clock. */
  ts?: number
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
  /** `host`: the character is a host part (`admin: true`), whose booth
   *  holds the host capability — it may press another character's `by:`
   *  button. Absent: not known to be one (a server lens; the booth is
   *  then treated as an ordinary performer's). */
  | { kind: 'performer'; id: string; view: PrimeView; host?: boolean }
  | null

/** A run that ended (here or by a co-writer) — kept so "Export run" still
 *  works and the empty state can say who ended it. */
export interface LastRun {
  run: RunInfo
  /** The ledger this console held when it ended — the whole ledger when the
   *  end was this console's own and the server handed it over. */
  log: LedgerEntry[]
  /** The ledger's length when it ended (absent: `log.length`). */
  ledgerLen?: number
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
   *  buttons under a guest lens (`who: guest`) and the Director page's cue
   *  sheet (`who: admin`). A performer lens offers its booth's own
   *  `PrimeView.interactions` instead (`performerActions` in `rooms.ts`). */
  interactions: InteractionSummary[]
  /** The cue sheet's state (`ModView.cues`): which `who: admin` cues have
   *  fired and which was last — off the sim log, so every director agrees. */
  cues: CueState
  /** Every declared codex entry with its holders (`ModView.codex`) — the
   *  Inspector's "Grant codex entry…" picker. */
  codex: CodexSummary[]
  /** Every declared quest with each person's status (`ModView.quests`) —
   *  the Inspector's quest buttons. */
  quests: QuestSummary[]
  /** The facts judge's ledger (`ModView.facts`): every key of the project's
   *  `facts.json` with its filings, verdicts and tallies, plus the judging
   *  mode. Null when the project has no `facts.json` (nothing is judged)
   *  and on the local backend (the judge lives on the event server). */
  facts: FactsView | null
  /** The story's wallet as the director sees it (`ModView.wallet`): the
   *  currency, approver, minter, stimulus uses and every open transfer /
   *  request / offer. Null when the story declares no `currency:` and on
   *  the local backend (the WalletBook lives on the event server). */
  wallet: WalletModView | null
  /** The story clock off the last snapshot (null on an older server) — the
   *  Wallet card's and the Director's countdowns. */
  storyClock: StoryClock | null
  /** The Director's glance board: the story's live `watch:` items
   *  (`ModView.watch`); empty when none is live or none is declared. */
  watch: WatchSummary[]
  /** The story declares at least one `watch:` line (the server sends
   *  `watch`, maybe empty) — else the Director shows "Recently changed". */
  watchDeclared: boolean
  /** The live countdowns still ahead (`ModView.countdowns`, story seconds). */
  countdowns: CountdownSummary[]
  /** The World page's variable filter — shared so the Director's glance
   *  can open World filtered to one watched path. */
  worldFilter: string
  /** This console's newest `fireSignal` (null before its first). */
  ownPress: OwnPress | null
  /** The Log page shows one press and what it did: the ledger seq of that
   *  press (the Director's `did: +N more ↗ Log`), else null (the whole log). */
  logPress: number | null
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
  /** Set the World page's variable filter (`worldFilter`). */
  setWorldFilter(q: string): void
  /** Focus the Log page on one press (`logPress`), or clear it with null. */
  setLogPress(seq: number | null): void
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
   *  in-browser run entered from a server project. `opts.rotateStaff` (server
   *  only) mints fresh performer + moderator codes for this launch — codes
   *  are otherwise pinned across End → relaunch; the guest code always stays. */
  startRun(mode: RunMode, opts?: { scratch?: boolean; rotateStaff?: boolean }): Promise<void>
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
   *  character's hooks hear it (the performer-lens interaction path).
   *  `presses`: the Director's arm's press count — a server refuses the
   *  press if another landed since (`FireResult.moved`).
   *  Resolves to what the press came to (`FireResult`); never rejects. */
  fireSignal(name: string, subject?: string, args?: SignalArgs | null, actor?: string | null, presses?: number): Promise<FireResult>
  /** Scan a guest as a character. Resolves to that character's `respond`
   *  readouts (the booth's scan responses). */
  scanAs(as: string, target: string): Promise<string[]>
  reveal(faction: string): Promise<void>
  /** Answer a pending choice — the local engine's saved continuation, or
   *  the journaled `/api/mod/choose` on a guest's behalf. */
  choose(person: string, index: number): Promise<void>
  /** Spawn a persona to act as (a local guest, or a journaled
   *  `/api/mod/persona` guest owned by `me` on the server). Resolves to the
   *  new guest id (null when none was created). */
  addPersona(name?: string): Promise<string | null>
  /** Players page: open the participant's OWN play-app session — a guest /
   *  persona's, or a character's performer booth — to embed and drive from
   *  the editor. Server runs only (the play app talks to an event server);
   *  the local backend resolves null and says why in `error`. */
  openPlayer(role: PlayerRole, id: string): Promise<PlayerSession | null>
  /** End a session `openPlayer` opened (its pane closed). Never throws. */
  closePlayer(session: PlayerSession): Promise<void>
  /** Write any world variable (the World browser's inline editing). */
  setVar(path: string, value: string): Promise<void>
  /** Hand a codex entry to a holder (a guest or a character) — the story's
   *  `unlock X for who`, server `/api/mod/codex` (journaled `by` you) or
   *  `Sim.unlock` locally. Fires their `learns` hooks like any unlock. */
  grantCodex(who: string, entry: string): Promise<void>
  /** Move one person's quest (`/api/mod/quest` / `Sim.quest`): start one
   *  they haven't got, or update / complete / fail an active one, with an
   *  optional line for the quest's thread. A step that doesn't apply does
   *  nothing, like the story's own statement. */
  stepQuest(who: string, quest: string, action: QuestAction, text?: string | null): Promise<void>
  /** Re-pair a lost guest (N-02): mint a single-use, ten-minute pair code
   *  for the SAME guest and resolve to the link their new phone scans. Server runs only (the
   *  local backend has no phones — null, reason in `error`). `revokeOthers`
   *  also signs out the guest's other phones (a lost phone someone found). */
  pairGuest(id: string, opts?: { revokeOthers?: boolean }): Promise<{ url: string; name: string; expiresAt: number } | null>
  /** Mark a guest as gone home (👋, wave 11 C5) or back: a journaled world
   *  set of `<id>.gone`, `by` you (`/api/mod/guest/gone` on the server, the
   *  same world var locally). Resolves true when it landed; a refusal lands
   *  in `error`. */
  markGone(id: string, gone: boolean): Promise<boolean>
  /** Release a performer's part (N-10) so they can re-sign on a loaner.
   *  Resolves to how many sessions held it (null on failure / local runs). */
  releasePart(character: string): Promise<number | null>
  /** Act on the wallet as the director (`/api/mod/wallet/*`, journaled `by`
   *  you): approve / deny / cancel an open item by id, pay the stimulus
   *  (`arg` = the amount), or approve every held transfer. Resolves true
   *  when it landed; a refusal lands in `error`. Local runs: false + why. */
  walletAct(action: WalletAction, arg?: string | number): Promise<boolean>
  /** Agent-voiced characters' minds as their stagehand workers last mirrored
   *  them (`ModView.minds`) — the Mind page's live state. Empty on the local
   *  backend (nothing voices a `mind: external` character in the browser). */
  minds: AgentMindSummary[]
  /** The workers' recorded model calls (`agentThought` frames + the paged
   *  `/api/mod/agent/trace`), oldest first, bounded. */
  thoughts: AgentThought[]
  /** Send a control to the worker voicing a character (reset / survey /
   *  nudge / set / forget / thinking / effort / pause / rerun). Resolves to
   *  the server's answer; a refusal lands in `error` too. */
  mindControl(control: Omit<AgentControl, 'by'>): Promise<{ ok: boolean; error?: string }>
  /** (Re)load the trace from the server — on opening the page, or to page
   *  back past what the stream delivered. */
  loadThoughts(character?: string | null): Promise<void>
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

/** The cue sheet before anything has fired. */
export const NO_CUES: CueState = { last: null, lastBy: null, fired: [], presses: 0, pressed: null }

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
  cues: NO_CUES,
  codex: [],
  quests: [],
  facts: null,
  wallet: null,
  storyClock: null,
  watch: [],
  watchDeclared: false,
  countdowns: [],
  worldFilter: '',
  ownPress: null,
  logPress: null,
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
  setTab: (activeTab) => set((s) => tabSwitch(s, activeTab)),
  setWorldFilter: (worldFilter) => set({ worldFilter }),
  setLogPress: (logPress) => set({ logPress }),
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
  fireSignal: async () => ({}),
  scanAs: async () => [],
  reveal: noop,
  choose: noop,
  addPersona: async () => null,
  openPlayer: async () => null,
  closePlayer: noop,
  setVar: noop,
  grantCodex: noop,
  stepQuest: noop,
  pairGuest: async () => null,
  releasePart: async () => null,
  markGone: async () => false,
  walletAct: async () => false,
  minds: [],
  thoughts: [],
  mindControl: async () => ({ ok: false, error: 'no run' }),
  loadThoughts: noop,
}))

export const CockpitContext = createContext<CockpitStore>(nullCockpit)

/** Read a slice of whichever cockpit store the enclosing provider supplies. */
export function useCockpit<T>(selector: (s: CockpitState) => T): T {
  const store = useContext(CockpitContext)
  return useStore(store, selector)
}
