//! Pure per-role projections of the live `Sim` into the snapshots each
//! client renders. Kept dependency-free and side-effect-free so they're
//! unit-testable without standing up the HTTP/SSE server.

import { DEFAULT_SPACE_ID } from "../src/runtime/sim/model.ts";
import { foldName } from "../src/parser/names.ts";
import type { AgentMindReport } from "./agents.ts";

export type { AgentControl, AgentControlAction, AgentMindPerson, AgentMindRevision, AgentThought } from "./agents.ts";
import type { Sim, SimEvent } from "../src/runtime/sim/index.ts";
import type { CodexDef } from "../src/runtime/sim/model.ts";
import type { WalletModView, WalletQueueView, WalletView } from "./wallet.ts";
import type { FactsView } from "./facts.ts";

export type { WalletModView, WalletOfferView, WalletQueueView, WalletRequestView, WalletTxView, WalletView } from "./wallet.ts";
// The facts judge's ledger (`ModView.facts`, Wave 4 lane B): the editor
// imports these from `@loom/core/views` only.
export type { FactFinal, FactHow, FactVerdict, FactsFiling, FactsQuestion, FactsTally, FactsView, JudgeMode } from "./facts.ts";

export type RuntimePhase = "idle" | "open" | "paused";

/** A codex entry as a holder sees it (no unlock code — that is the secret). */
export interface CodexEntryView {
  id: string;
  title: string;
  /** The subject it concerns (a character, or a topic). */
  about: string | null;
  text: string;
}

function codexEntry(e: CodexDef): CodexEntryView {
  return { id: e.id, title: e.title, about: e.about, text: e.text };
}

/** A quest in someone's log, where it stands now. Its steps are the
 *  replies under its card in the `quests` room. */
export interface QuestView {
  id: string;
  title: string;
  /** Who handed it out (the giver character), if anyone. */
  giver: string | null;
  status: "active" | "done" | "failed";
}

/** One row of the participants directory — a guest or a listed character. */
export interface PersonCard {
  id: string;
  name: string;
  kind: "guest" | "character";
  /** Their public group (a hidden one reads null until revealed). */
  faction: string | null;
  /** What the viewer knows about them: the codex entries they hold whose
   *  `about:` is this person. Limited info unless more has been shared. */
  known: CodexEntryView[];
  /** Where they are standing (a guest's location; null for a character or
   *  before the story places them) — what lets the app show who's *here*. */
  location: string | null;
  /** A character voiced by an agent (`mind: external`); `online` says whether
   *  one is answering right now. Absent for guests and performed characters.
   *  `hold` — the character has a `hold:` line, so a guest is always
   *  answered (by the line, then a director) and the app shows no presence. */
  agent?: { online: boolean; hold?: true };
}

function peopleFor(sim: Sim, id: string, agentsOnline?: ReadonlySet<string>): PersonCard[] {
  return sim.peopleFor(id).map((p) => {
    const card: PersonCard = { ...p, known: p.known.map(codexEntry), location: p.kind === "guest" ? sim.locationOf(p.id) : null };
    const def = p.kind === "character" ? sim.model.characters.get(p.id) : undefined;
    if (def?.mind === "external") {
      card.agent = { online: agentsOnline?.has(p.id) ?? false, ...(def.hold !== null ? { hold: true as const } : {}) };
    }
    return card;
  });
}

/**
 * Best display title authored in a `.loom` source: the first `# Title`
 * heading — skipping the `# ── path ──` file-separator comments that
 * multi-file concatenation inserts (`projectSource` / `examples/load.ts`) —
 * else the first `title:` header property. Null when the source names
 * nothing; callers fall back to the project/scenario name.
 */
/** The header `theme:` property of a `.loom` source, if any (Loom 4 §11). */
export function themeOf(source: string): string | null {
  const m = /^theme:\s*(\S.*)$/mu.exec(source);
  return m !== null ? m[1]!.trim() : null;
}

/** A declared INTERACTION as the client sees it. */
export interface InteractionSummary {
  id: string;
  label: string;
  who: "performer" | "guest" | "admin" | "agent";
  description: string | null;
  /** True when every hook that hears this event binds a subject
   *  (`when x for program:`), so firing it with no one does nothing — the
   *  cue sheet asks for the person first (the ceremony's award winner). */
  subject?: boolean;
  /** False for an off-sequence cue (`sequence: false`): machine-fired or a
   *  hardware fallback — the cue sheet ticks it but never suggests it. */
  sequence?: false;
  /** True for a cue pressed again and again (`repeat: true`): the cue
   *  sheet still suggests it once it has fired. */
  repeat?: true;
  /** Whose button this is — character ids, from the INTERACTION's `by:`
   *  (characters, or a GROUP's members) plus every character that owns a
   *  hook for it (a trait's `when vouch for program:`). Absent = anyone's.
   *  A performer's guest card leads with their own; the rest fold away. */
  actors?: string[];
  /** False while the INTERACTION's `while:` condition is false — a guest
   *  never sees it; a performer finds it under "More". */
  live?: false;
}

const subjectOnlyCache = new WeakMap<Sim["model"], Set<string>>();

/** Folded event names whose every listener binds a subject (per model —
 *  every guest / performer view asks on every fanout). */
function subjectOnlyEvents(sim: Sim): Set<string> {
  const m = sim.model;
  const cached = subjectOnlyCache.get(m);
  if (cached !== undefined) return cached;
  const bound = new Map<string, boolean>();
  const hooks = [...m.rules, ...[...m.characters.values()].flatMap((c) => c.hooks), ...[...m.roles.values()].flatMap((r) => r.hooks)];
  for (const h of hooks) {
    if (h.verb === "" || h.timer !== null) continue;
    const k = foldName(h.verb);
    bound.set(k, (bound.get(k) ?? true) && h.param !== null);
  }
  const out = new Set([...bound].filter(([, all]) => all).map(([k]) => k));
  subjectOnlyCache.set(m, out);
  return out;
}

const actorsCache = new WeakMap<Sim["model"], Map<string, string[]>>();

/** Each INTERACTION's actors (see `InteractionSummary.actors`), per model;
 *  an interaction with none is missing from the map. */
export function interactionActors(sim: Sim): Map<string, string[]> {
  const m = sim.model;
  const cached = actorsCache.get(m);
  if (cached !== undefined) return cached;
  const out = new Map<string, string[]>();
  const chars = [...m.characters.values()];
  for (const i of m.interactions.values()) {
    const ids = new Set<string>();
    for (const name of i.by) {
      const k = foldName(name);
      const one = chars.find((c) => foldName(c.id) === k);
      if (one !== undefined) ids.add(one.id);
      else for (const c of chars) if (c.faction !== null && foldName(c.faction) === k) ids.add(c.id);
    }
    const verb = foldName(i.id);
    for (const c of chars) if (c.hooks.some((h) => h.timer === null && foldName(h.verb) === verb)) ids.add(c.id);
    if (ids.size > 0) out.set(i.id, [...ids]);
  }
  actorsCache.set(m, out);
  return out;
}

/** The INTERACTIONs `who` may fire. With `at`, each `while:` is evaluated
 *  (`subject` / `self` bound as given) and marked `live: false` when it
 *  fails; without, nothing is evaluated (the director's cue sheet). */
function interactionsFor(
  sim: Sim,
  who: Array<InteractionSummary["who"]> | null,
  at?: { subject: string | null; self: string | null },
): InteractionSummary[] {
  const subjectOnly = subjectOnlyEvents(sim);
  const actors = interactionActors(sim);
  return [...sim.model.interactions.values()]
    .filter((i) => who === null || who.includes(i.who))
    .map((i) => {
      const s: InteractionSummary = { id: i.id, label: i.label, who: i.who, description: i.description };
      if (subjectOnly.has(foldName(i.id))) s.subject = true;
      if (!i.sequence) s.sequence = false;
      if (i.repeat) s.repeat = true;
      const by = i.who === "performer" ? actors.get(i.id) : undefined; // a guest never learns who hears their buttons
      if (by !== undefined) s.actors = by;
      if (at !== undefined && i.while !== null && !sim.holds(i.while, at.subject, at.self)) s.live = false;
      return s;
    });
}

export function titleOf(source: string): string | null {
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("#")) {
      const rest = line.slice(1).trim();
      if (rest === "" || rest.startsWith("#") || rest.startsWith("─")) continue;
      return rest;
    }
    const m = /^([A-Za-z][A-Za-z0-9_ -]*):\s*(.*)$/.exec(line);
    if (m !== null) {
      if (m[1]!.trim().toLowerCase() === "title" && m[2]!.trim() !== "") return m[2]!.trim();
      continue; // another header property (entry:, …) — keep scanning
    }
    break; // first real content line — the header is over
  }
  return null;
}

/** An authored channel a participant can see, for the sidebar. */
export interface ChannelSnapshot {
  id: string;
  kind: string; // open | private | faction | group | dm
  title: string;
  spaceId: string;
  /** True when the viewer is an explicit member (drives leave/invite). */
  member: boolean;
  /** May the viewer post here (post policy)? Drives the composer. */
  canPost: boolean;
  /** Can messages here open threads? Drives the reply affordance. */
  threadable: boolean;
}

/** A Discord-style sidebar section title. */
export interface SpaceSnapshot {
  id: string;
  title: string;
}

/** What a single party-goer sees about themselves. */
export interface GuestView {
  id: string;
  name: string;
  /** The story's title + theme — the client's chrome comes from the story. */
  title: string;
  theme: string;
  /** The story clock (ms, `Sim.elapsed()`) when this view was built — the
   *  "now" a client measures a message's `ts` against (e.g. only banner an
   *  alert it missed if it is under 10 minutes old). */
  clock?: number;
  role: string | null;
  /** App-facing faction — hidden factions read `null` until revealed. */
  faction: string | null;
  score: number;
  location: string | null;
  captured: boolean;
  /** The story restricted this guest (`restrict who`): the app greys out,
   *  no buttons, only the listed rooms, read-only; DMs stay. */
  restricted: boolean;
  /** May a captured guest free themselves from the app (the v3 "make a
   *  break for it" button)? False when their prison is `sealed: true` —
   *  only the story lets them out. */
  canEscape: boolean;
  /** Outstanding choice options awaiting this guest, if any. */
  pendingChoice: string[] | null;
  /** Channel the pending decision docks under (`"lobby"`, a DM, …). */
  decisionChannel: string | null;
  /** Standing in a `cutscene: true` location: the app goes on rails — a
   *  full-screen stream of what is said to this guest, no rooms sidebar. */
  cutscene: boolean;
  /** Widget cards (by message seq) this guest has already answered — the
   *  runtime fills it so a reload renders them resolved and never re-asks. */
  answered?: number[];
  /** Authored channels this guest can see (open + faction + member rooms
   *  — a `hidden: true` room / place only once revealed or visited). */
  channels: ChannelSnapshot[];
  /** Titles for the authored sidebar sections. */
  spaces: SpaceSnapshot[];
  /** Other participants (id + name) — the invite picker's source. */
  roster: Array<{ id: string; name: string }>;
  /** The public (non-hidden) factions a guest may join — the side chooser's
   *  source. Empty when the story declares none (no chooser shown). */
  factions: string[];
  /** Every group this guest belongs to (public ones only — hidden until revealed). */
  groups: string[];
  /** `INTERACTION`s a guest may fire for themselves (`who: guest`). */
  interactions: InteractionSummary[];
  /** The codex entries this guest holds (knowledge as a currency). */
  codex: CodexEntryView[];
  /** How many entries exist to be found — the currency's denominator. */
  codexTotal: number;
  /** The guest's quest log, in the order the quests were handed out. */
  quests: QuestView[];
  /** How many quests the story declares (0 → no Quest Log room). */
  questTotal: number;
  /** The story's currency, when it declares one (`currency:`) — filled by
   *  the runtime's WalletBook; a local sim has none. */
  wallet?: WalletView;
  /** The participants directory: who else is here, and what one knows of them. */
  people: PersonCard[];
  /** Profile pictures by (folded) display name → serving key
   *  (`/e/:id/api/avatar/<key>`). The runtime fills it; a local sim has none. */
  avatars?: Record<string, string>;
}

export function guestView(sim: Sim, id: string, decisionChannel: string | null = null, agentsOnline?: ReadonlySet<string>): GuestView {
  const p = sim.persons.get(id);
  const pendingChoice = sim.pendingChoiceFor(id);
  return {
    id,
    name: p?.name ?? id,
    title: sim.lobbyTitle(),
    theme: sim.model.theme ?? "plain",
    clock: sim.elapsed(),
    role: p?.role ?? null,
    faction: sim.publicFactionOf(id),
    score: sim.scoreOf(id),
    location: sim.locationOf(id),
    captured: sim.isCaptured(id),
    restricted: sim.isRestricted(id),
    canEscape: !(sim.model.locations.get(sim.locationOf(id) ?? "")?.sealed ?? false),
    pendingChoice,
    decisionChannel: pendingChoice ? (decisionChannel ?? "lobby") : null,
    cutscene: sim.cutsceneFor(id),
    channels: sim.visibleChannelsFor(id),
    spaces: sim.spaceList(),
    roster: sim.rosterFor(id),
    // A hidden group becomes a side once the story reveals it (`reveal G`).
    factions: [...sim.model.factions.values()].filter((f) => (!f.hidden || sim.factionRevealed(f.id)) && f.joinable).map((f) => f.id),
    groups: sim.groupsOf(id).filter((g) => {
      const def = sim.model.factions.get(g);
      return def === undefined || !def.hidden || sim.factionRevealed(g);
    }),
    // A guest only ever sees the buttons on offer to them right now — and
    // none at all while the story has them restricted.
    // Restricted: only the `restricted: allow` buttons (Bathroom Mode) stay.
    interactions: interactionsFor(sim, ["guest"], { subject: id, self: id }).filter(
      (i) => i.live !== false && (!sim.isRestricted(id) || sim.model.interactions.get(i.id)?.allowRestricted === true),
    ),
    codex: sim.codexFor(id).map(codexEntry),
    codexTotal: sim.model.codex.size,
    quests: sim.questsFor(id).map(({ def, status }) => ({ id: def.id, title: def.title, giver: def.giver, status })),
    questTotal: sim.model.quests.size,
    people: peopleFor(sim, id, agentsOnline),
  };
}

export interface RosterRow {
  id: string;
  name: string;
  role: string;
  /** True faction (operator view — includes hidden allegiances). */
  faction: string | null;
  trueFaction: string | null;
  location: string | null;
  captured: boolean;
  /** `restrict who` is in force (the phone is greyed, buttons off). */
  restricted: boolean;
  score: number;
  /** Story position — the beat this guest is currently inside, if any. */
  beat: string | null;
  /** Their trail: every beat entered for them, with visit counts. */
  visited: Record<string, number>;
  /** Live presence: this guest has an SSE stream open right now. Absent
   *  where no connection tracking exists (local sim, journal replay). */
  online?: boolean;
  /** The director who spawned this persona (`/api/mod/persona`), by display
   *  name; null for a real guest. Set only by `modView` from presence. */
  owner?: string | null;
}

/** The operator's god-view of one guest. Null if the QR is unknown. */
export function rosterRow(sim: Sim, id: string): RosterRow | null {
  const p = sim.persons.get(id);
  if (p === undefined) return null;
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    faction: sim.factionOf(p.id),
    trueFaction: sim.trueFactionOf(p.id),
    location: sim.locationOf(p.id),
    captured: sim.isCaptured(p.id),
    restricted: sim.isRestricted(p.id),
    score: sim.scoreOf(p.id),
    beat: sim.lastBeatOf(p.id),
    visited: sim.visitedBeatsFor(p.id),
  };
}

export interface FactionSummary {
  id: string;
  hidden: boolean;
  revealed: boolean;
  ethos: string | null;
  rival: string | null;
  members: string[];
}

export interface LocationSummary {
  id: string;
  label: string | null;
  prison: boolean;
  occupants: string[];
}

/** An operator-visible room: every authored + derived channel, unscoped. */
export interface ChannelSummary {
  id: string;
  kind: string;
  title: string;
  spaceId: string;
}

/** A member of the cast (an authored CHARACTER an operator can speak/fire as). */
export interface CastSummary {
  id: string;
  faction: string | null;
  /** A performer is signed in and streaming as this character right now.
   *  Absent where no connection tracking exists (local sim). */
  online?: boolean;
  /** `mind: external` — voiced by a stagehand agents worker, not a performer
   *  (`online` then means a worker for it is connected). */
  agent?: boolean;
}

/** Who is connected to the event right now, by capability. */
export interface ModPresence {
  /** Guest ids with an open SSE stream. */
  guests: Set<string>;
  /** Character ids a signed-in performer is streaming as. */
  primes: Set<string>;
  /** Connected mod/director consoles (the editor's Run mode, each co-writer). */
  mods: number;
  /** Their display names (one entry per open console; "Director" when anonymous). */
  directors: string[];
  /** persona id → puppeteer display name (mod-spawned personas only). */
  owners?: Map<string, string>;
  /** Agent characters with a stagehand worker connected. */
  agents?: Set<string>;
  /** What each agent worker last reported about its character's evolving
   *  mind (`POST /api/agent/mind`) — the director's window into it. */
  minds?: AgentMindSummary[];
  /** The facts judge's ledger (facts.ts), present only when the event has a facts.json. */
  facts?: FactsView;
}

/** An agent-voiced character's mind as its worker last mirrored it — the
 *  whole `AgentMindReport` (arc, drives, policy, questions, dossiers,
 *  revisions, worker status) plus the server clock when it arrived. */
export type AgentMindSummary = AgentMindReport & {
  /** Server clock when it was reported. */
  at: number;
};

/** The operator's full god-view of the world. */
export interface ModView {
  /** The story's title + theme (what participants see). */
  title?: string;
  theme?: string;
  /** Every declared INTERACTION (the director may fire any of them). */
  interactions?: InteractionSummary[];
  phase: RuntimePhase;
  scenario: string | null;
  roster: RosterRow[];
  factions: FactionSummary[];
  locations: LocationSummary[];
  /** Character ids (thin list; the run panel uses `cast` for factions too). */
  characters: string[];
  /** The cast with their factions — the run panel's "speak/fire as" picker. */
  cast: CastSummary[];
  /** Every room the operator can peer into / post to (lobby + factions + authored). */
  channels: ChannelSummary[];
  /** Authored sidebar sections, for grouping the rooms list. */
  spaces: SpaceSnapshot[];
  /** Every named beat, for the "fire beat" picker. */
  beats: string[];
  /** Outstanding choices per person id (`__global` for unbound menus) —
   *  lets the run panel surface + answer a stuck decision. */
  choices: Record<string, string[]>;
  ledgerLen: number;
  /** Profile pictures by (folded) display name → serving key. */
  avatars?: Record<string, string>;
  /** The whole world state as display strings (the director's debugger). */
  world: Array<{ path: string; value: string }>;
  /** Connected director consoles (co-writers moderating this event). */
  modsOnline?: number;
  /** Who those directors are (display names, one per console). */
  directors?: string[];
  /** Every codex entry with its unlock code and current holders — the
   *  director sees the whole currency supply. */
  codex?: CodexSummary[];
  /** Every declared quest with where it stands for each person who has it —
   *  the Inspector's quest buttons (a person missing from `status` hasn't
   *  been handed it yet). */
  quests?: QuestSummary[];
  /** Agent-voiced characters' minds, as their workers last reported them. */
  minds?: AgentMindSummary[];
  /** The facts judge's ledger — every key of the project's `facts.json` with
   *  its filings, verdicts and tallies, plus the judging mode (runtime-
   *  filled; absent when the event has no `facts.json`). */
  facts?: FactsView;
  /** The director cue sheet's state: which `who: admin` cues have fired
   *  and which was last — read off the sim log, so a director who signs
   *  in mid-show (or reloads) sees the same sheet as the one who fired. */
  cues?: CueState;
  /** The director's mirror of the story's wallet (runtime-filled). */
  wallet?: WalletModView;
  /** The story clock (ms, `Sim.elapsed()`) when this view was built — what
   *  Run's Wallet card counts a transfer's `settleAt` down from. */
  clock?: number;
}

/** Where the night is on the `who: admin` cue sheet. */
export interface CueState {
  /** The most recent in-sequence admin cue to fire (an INTERACTION id), or
   *  null. Off-sequence cues (`sequence: false` — the duck game, the door
   *  contact, hardware fallbacks) never take it. */
  last: string | null;
  /** Who fired it: a director (`signal`) or the story itself (`fire`, the
   *  "auto at 15 min" cues). */
  lastBy: "director" | "story" | null;
  /** Every admin cue that has fired at least once, in first-fire order. */
  fired: string[];
}

interface CueScan {
  model: Sim["model"];
  /** Log entries already scanned. */
  at: number;
  state: CueState;
  seen: Set<string>;
  /** `state.last`'s place in the declared order (-1 = none). */
  lastOrder: number;
}

/** Log entries that start a new input (a press, a tick, a typed line, a
 *  join, a scan): what a director's press did ends at the next one. */
const CUE_INPUTS: ReadonlySet<string> = new Set(["signal", "tick", "chat", "accountCreated", "scanned"]);

/** Did the director's press at `events[n]` do nothing but (at most) tell a
 *  staff room why? The story's phase-guarded rules refuse a cue pressed out
 *  of turn with a `# hosts` line or not at all (T1-02): such a press never
 *  becomes LAST or ticks the cue. */
function refusedPress(events: readonly SimEvent[], n: number): boolean {
  for (let k = n + 1; k < events.length; k++) {
    const e = events[k]!;
    if (CUE_INPUTS.has(e.type)) break;
    if (e.type === "diagnostic") continue;
    if (e.type === "broadcast" && e.scope.startsWith("channel(")) continue;
    return false;
  }
  return true;
}

/** Per log, where the scan got to — the log only grows, so each director
 *  snapshot reads just the new entries instead of the whole night. */
const cueScans = new WeakMap<object, CueScan>();

/**
 * Scan the log for admin cues. A director's fire is a `signal` event; a
 * story's own `fire x` (an auto cue) is a `fire` directive. Names fold, so
 * `the golden duck` matches however it was spelled at the call site.
 *
 * A director's in-sequence press the story refused (`refusedPress`) counts
 * for nothing, and a repeat of a cue that already fired never moves LAST
 * back to an earlier row (T7-01): a mis-tap is cheap.
 */
export function cueState(sim: Sim): CueState {
  const admin = new Map<string, { id: string; sequence: boolean; order: number }>();
  for (const i of sim.model.interactions.values()) if (i.who === "admin") admin.set(foldName(i.id), { id: i.id, sequence: i.sequence, order: admin.size });
  if (admin.size === 0) return { last: null, lastBy: null, fired: [] };
  const events = sim.log.all();
  let scan = cueScans.get(sim.log);
  if (scan === undefined || scan.model !== sim.model || scan.at > events.length) {
    scan = { model: sim.model, at: 0, state: { last: null, lastBy: null, fired: [] }, seen: new Set(), lastOrder: -1 };
    cueScans.set(sim.log, scan);
  }
  const { state, seen } = scan;
  for (let n = scan.at; n < events.length; n++) {
    const e = events[n]!;
    let name: string | null = null;
    let by: CueState["lastBy"] = null;
    if (e.type === "signal") {
      name = e.name;
      by = "director";
    } else if (e.type === "directive" && e.verb === "fire") {
      name = e.args.split(/ (?:for|with) /u)[0] ?? "";
      by = "story";
    }
    if (name === null) continue;
    const cue = admin.get(foldName(name));
    if (cue === undefined) continue;
    const id = cue.id;
    if (cue.sequence) {
      if (by === "director" && refusedPress(events, n)) continue;
      if (!(seen.has(id) && cue.order < scan.lastOrder)) {
        state.last = id;
        state.lastBy = by;
        scan.lastOrder = cue.order;
      }
    }
    if (!seen.has(id)) {
      seen.add(id);
      state.fired.push(id);
    }
  }
  scan.at = events.length;
  return { last: state.last, lastBy: state.lastBy, fired: [...state.fired] };
}

export interface CodexSummary extends CodexEntryView {
  /** The folded unlock code, or null for a story-only entry. */
  code: string | null;
  /** Holder ids (persons + characters). */
  holders: string[];
}

/** A declared quest as the director sees it: every person's status. */
export interface QuestSummary {
  id: string;
  title: string;
  giver: string | null;
  /** Person id → where the quest stands for them. */
  status: Record<string, QuestView["status"]>;
}

/** Every declared quest in model order, with each person's status. */
function questSummaries(sim: Sim): QuestSummary[] {
  const out = [...sim.model.quests.values()].map((q): QuestSummary => ({ id: q.id, title: q.title, giver: q.giver, status: {} }));
  const byId = new Map(out.map((q) => [q.id, q]));
  for (const person of sim.persons.keys()) {
    for (const { def, status } of sim.questsFor(person)) {
      const q = byId.get(def.id);
      if (q !== undefined) q.status[person] = status;
    }
  }
  return out;
}

/**
 * Every channel an operator can moderate, unscoped by visibility: the lobby,
 * one derived broadcast channel per faction, and every authored SPACE/CHANNEL.
 * Derived per-character DM threads aren't enumerated (they appear in the feed
 * as messages land); the operator addresses a guest DM via a `guest:<id>` say.
 */
function operatorChannels(sim: Sim): ChannelSummary[] {
  const space = DEFAULT_SPACE_ID;
  const out: ChannelSummary[] = [{ id: "lobby", kind: "lobby", title: sim.lobbyTitle(), spaceId: space }];
  for (const f of sim.model.factions.values()) {
    out.push({ id: `faction:${f.id}`, kind: "faction", title: `#${f.id.toLowerCase()}`, spaceId: space });
  }
  // Every location's derived room — where a beat's setting routes its story.
  for (const l of sim.model.locations.values()) {
    out.push({ id: `loc:${l.id}`, kind: "location", title: l.label ?? l.id, spaceId: space });
  }
  for (const id of sim.model.channels.keys()) {
    const h = sim.channelHead(id);
    out.push({ id: h.channel, kind: h.channelKind, title: h.title, spaceId: h.spaceId });
  }
  return out;
}

/** `declared`: the story's cast while no sim exists (the doors are shut) —
 *  a terminal provisioned before the doors checks its character against it. */
export function modView(sim: Sim | null, phase: RuntimePhase, scenario: string | null, presence?: ModPresence, declared?: readonly string[]): ModView {
  if (sim === null) {
    return {
      phase,
      scenario,
      roster: [],
      factions: [],
      locations: [],
      characters: [...(declared ?? [])],
      cast: [],
      channels: [],
      spaces: [],
      beats: [],
      choices: {},
      ledgerLen: 0,
      world: [],
      modsOnline: presence?.mods,
    };
  }
  const roster: RosterRow[] = [...sim.persons.keys()].map((id) =>
    presence !== undefined
      ? { ...rosterRow(sim, id)!, online: presence.guests.has(id), owner: presence.owners?.get(id) ?? null }
      : rosterRow(sim, id)!,
  );
  const factions: FactionSummary[] = [...sim.model.factions.values()].map((f) => ({
    id: f.id,
    hidden: f.hidden,
    revealed: sim.factionRevealed(f.id),
    ethos: f.ethos,
    rival: f.rival,
    members: sim.factionMembers(f.id),
  }));
  const locations: LocationSummary[] = [...sim.model.locations.values()].map((l) => ({
    id: l.id,
    label: l.label,
    prison: l.prison,
    occupants: roster.filter((r) => r.location === l.id).map((r) => r.id),
  }));
  return {
    phase,
    scenario,
    roster,
    title: sim.lobbyTitle(),
    theme: sim.model.theme ?? "plain",
    interactions: interactionsFor(sim, null),
    factions,
    locations,
    characters: [...sim.model.characters.keys()],
    cast: [...sim.model.characters.values()].map((c) => ({
      id: c.id,
      faction: c.faction ?? null,
      ...(c.mind === "external" ? { agent: true } : {}),
      ...(presence !== undefined
        ? { online: c.mind === "external" ? (presence.agents?.has(c.id) ?? false) : presence.primes.has(c.id) }
        : {}),
    })),
    channels: operatorChannels(sim),
    spaces: sim.spaceList(),
    beats: [...sim.model.beats.keys()],
    choices: sim.allPendingChoices(),
    ledgerLen: sim.log.len(),
    world: sim.worldEntries(),
    modsOnline: presence?.mods,
    directors: presence?.directors,
    codex: [...sim.model.codex.values()].map((e) => ({ ...codexEntry(e), code: e.code, holders: sim.codexHolders(e.id) })),
    quests: questSummaries(sim),
    ...(presence?.minds !== undefined && presence.minds.length > 0 ? { minds: presence.minds } : {}),
    ...(presence?.facts !== undefined ? { facts: presence.facts } : {}),
    cues: cueState(sim),
    clock: sim.elapsed(),
  };
}

export interface PrimeGuest {
  id: string;
  name: string;
  faction: string | null;
  captured: boolean;
  /** `restrict who` is in force — the booth shows a ⛔ pill. */
  restricted: boolean;
  /** Where the story has them standing — the booth's "who's here" view. */
  location: string | null;
}

/** What an actor playing a character sees: their part + scannable guests. */
export interface PrimeView {
  character: string;
  title: string;
  theme: string;
  /** The story clock (ms, `Sim.elapsed()`) when this view was built — the
   *  "now" a client measures a message's `ts` against (e.g. only banner an
   *  alert it missed if it is under 10 minutes old). */
  clock?: number;
  faction: string | null;
  guests: PrimeGuest[];
  /** Every authored channel — performers run every room. */
  channels: ChannelSnapshot[];
  spaces: SpaceSnapshot[];
  /** `INTERACTION`s a performer (and, with `who: admin`, a moderator) may fire on a guest. */
  interactions: InteractionSummary[];
  /** True when the story uses the v3 prison mechanic (a `prison: true` location),
   *  so the booth still offers capture / release. */
  legacyCapture: boolean;
  /** The codex entries this character holds — their backstory, shareable. */
  codex: CodexEntryView[];
  /** How many entries the story declares (0 → no Codex room in the booth). */
  codexTotal: number;
  /** The character's quest log (`start quest X for <Character>`), in hand-out order. */
  quests: QuestView[];
  /** How many quests the story declares (0 → no Quest Log room in the booth). */
  questTotal: number;
  /** Widget cards (by message seq) this character has already answered. */
  answered?: number[];
  /** The approver's queue — only the approver character's booth (runtime-filled). */
  wallet?: WalletQueueView;
  /** Agent-voiced characters (`mind: external`) this performer can message
   *  in a `cast:<Character>` thread; `online` = a worker is answering. */
  agents: AgentContact[];
  /** Profile pictures by (folded) display name → serving key. */
  avatars?: Record<string, string>;
}

export interface AgentContact {
  id: string;
  online: boolean;
}

/** The agent-voiced characters, excluding `self`. `online` is whatever the
 *  caller knows (the runtime's hub; a local sim passes nothing → false). */
export function agentContacts(sim: Sim, self: string | null, online?: ReadonlySet<string>): AgentContact[] {
  return [...sim.model.characters.values()]
    .filter((c) => c.mind === "external" && c.id !== self)
    .map((c) => ({ id: c.id, online: online?.has(c.id) ?? false }));
}

export function primeView(sim: Sim | null, character: string, agentsOnline?: ReadonlySet<string>): PrimeView {
  if (sim === null) {
    return { character, title: "Loom", theme: "plain", faction: null, guests: [], channels: [], spaces: [], interactions: [], legacyCapture: false, codex: [], codexTotal: 0, quests: [], questTotal: 0, agents: [] };
  }
  const c = sim.model.characters.get(character);
  const guests: PrimeGuest[] = [...sim.persons.values()].map((p) => ({
    id: p.id,
    name: p.name,
    faction: sim.publicFactionOf(p.id),
    captured: sim.isCaptured(p.id),
    restricted: sim.isRestricted(p.id),
    location: sim.locationOf(p.id),
  }));
  return {
    character,
    title: sim.lobbyTitle(),
    theme: sim.model.theme ?? "plain",
    clock: sim.elapsed(),
    faction: c?.faction ?? null,
    guests,
    channels: sim.allChannelsFor(character),
    spaces: sim.spaceList(),
    interactions: interactionsFor(sim, ["performer", "admin"], { subject: null, self: character }),
    legacyCapture: [...sim.model.locations.values()].some((l) => l.prison),
    codex: sim.codexFor(character).map(codexEntry),
    codexTotal: sim.model.codex.size,
    quests: sim.questsFor(character).map(({ def, status }) => ({ id: def.id, title: def.title, giver: def.giver, status })),
    questTotal: sim.model.quests.size,
    agents: agentContacts(sim, character, agentsOnline),
  };
}
