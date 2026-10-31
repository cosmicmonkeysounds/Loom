//! Pure per-role projections of the live `Sim` into the snapshots each
//! client renders. Kept dependency-free and side-effect-free so they're
//! unit-testable without standing up the HTTP/SSE server.

import type { FilterView } from "./language-filter.ts";
import { DEFAULT_SPACE_ID } from "../src/runtime/sim/model.ts";
import { asNumber, display, type Value } from "../src/runtime/expr.ts";
import { alertLevelOf, type AlertLevel } from "../src/delivery.ts";
import { cueActs, cueRows, focusActIndex, type CueCaller, type CueRow } from "../src/cue-sheet.ts";
import { resolveGoWord } from "../src/go.ts";
import { codexAboutKind, storyPhase, type ChatMessage } from "./chat.ts";
import { foldName } from "../src/parser/names.ts";
import { isGateFlag } from "../src/host-board.ts";
import { isSecretRoleSlot } from "../src/runtime/sim/board.ts";
import type { AgentMindReport, AgentQueue } from "./agents.ts";

export type { AgentControl, AgentControlAction, AgentMindPerson, AgentMindRevision, AgentQueue, AgentThought } from "./agents.ts";
import type { Sim, SimEvent } from "../src/runtime/sim/index.ts";
import type { CodexDef, Hook, InteractionDef, ObjectiveDef } from "../src/runtime/sim/model.ts";
import type { BodyItem } from "../src/parser/ast.ts";
import type { WalletModView, WalletQueueView, WalletView } from "./wallet.ts";
import type { FactsView } from "./facts.ts";
import { identityDefs, performerPickable } from "../src/identity-kind.ts";
import { joinableFactions } from "./routes/sides.ts";
import { crewRoom, type CrewSummary, type CrewView, type InviteView, type RaceView, type SideView } from "../src/runtime/sim/crews.ts"; // w18 crews
import { badgesOf, type NameBadge } from "../src/runtime/sim/badges.ts"; // w18b badges
import { isPrivateSlot, statsFor, type StatView } from "../src/runtime/sim/stats.ts"; // w21 stats
import type { ShowClock } from "../src/show-clock.ts";
import type { TalkView } from "../src/talk-back.ts";
import type { PrompterStatus } from "./prompter.ts";
import { CREDITS_AT_PATH, CREDITS_ROLL_PATH } from "../src/credits.ts"; // w44

export type { NameBadge } from "../src/runtime/sim/badges.ts";
export type { RaceFaction, RaceView } from "../src/runtime/sim/crews.ts";
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
  /** `secret: true` — an agent-voiced character never takes it (the heart
   *  terminal's file panel offers no Give for it). Present only when set. */
  secret?: true;
  /** `CodexDef.category`; absent when null. */
  category?: string;
  /** What `about` names: a character, a location, or anything else; absent when `about` is null. */
  aboutKind?: "character" | "location" | "topic";
}

function codexEntry(e: CodexDef, model: Sim["model"]): CodexEntryView {
  const out: CodexEntryView = { id: e.id, title: e.title, about: e.about, text: e.text };
  if (e.secret) out.secret = true;
  if (e.category !== null) out.category = e.category;
  const kind = codexAboutKind(model, e.about);
  if (kind !== null) out.aboutKind = kind;
  return out;
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
  /** w18 crews: every group as a badge (display names; a hidden one until revealed) + their crew's name.
   *  In faction mode (w18b) a race faction shows only when it is the
   *  viewer's own, or this person founded / leads it. */
  groups?: string[];
  /** Wave 18b: the header `badge:` lines true for this person now
   *  (`🚻 Bathroom Mode`), header order. Absent when none. */
  badges?: NameBadge[];
}

function peopleFor(sim: Sim, id: string, agentsOnline?: ReadonlySet<string>): PersonCard[] {
  const factionMode = sim.crews.factionMode;
  const mine = factionMode ? sim.crews.factionOf(id) : null;
  return sim.peopleFor(id).map((p) => {
    const card: PersonCard = { ...p, known: p.known.map((e) => codexEntry(e, sim.model)), location: p.kind === "guest" ? sim.locationOf(p.id) : null };
    card.groups = p.kind === "guest" ? sim.crews.groupsOf(p.id) : p.faction !== null ? [p.faction] : []; // w18 crews
    // w18b faction mode: a person's race faction shows only when it is the
    // viewer's own, or they founded / lead it ("led by X" is public) —
    // else scrolling People would count a rival faction.
    if (factionMode && p.kind === "guest") {
      const theirs = sim.crews.factionOf(p.id);
      if (theirs === null || (theirs !== mine && sim.crews.founderOf(theirs) !== p.id)) {
        const crew = sim.crews.crewOf(p.id)?.name ?? null;
        card.groups = card.groups.filter((g) => g !== crew && !sim.crews.isRaceFaction(g));
        if (card.faction !== null && sim.crews.isRaceFaction(card.faction)) card.faction = null;
      }
    }
    Object.assign(card, badgesField(sim, p.id)); // w18b badges
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
  /** True for an admin cue the sheet suggests ahead of the running order
   *  while it is live and unfired (`urgent: true`). */
  urgent?: true;
  /** Whose button this is — character ids, from the INTERACTION's `by:`
   *  (characters, or a GROUP's members) plus every character that owns a
   *  hook for it (a trait's `when vouch for program:`). Absent = anyone's.
   *  A performer's guest card leads with their own; the rest fold away. */
  actors?: string[];
  /** True when the INTERACTION declares `by:`: only its `actors` may press
   *  it (`/api/prime/act` refuses another booth, 403). A booth leaves another
   *  character's out of its More fold; a host's or moderator's booth keeps
   *  them, unless `hostHeard` is false. */
  only?: true;
  /** False on an `only` button whose event nothing outside its `actors`
   *  hears: every handler is a hook the actors own (a trait's `when send to
   *  the internet for program:` on the Antivirus), and no story rule or ROLE
   *  hook listens. A press fires as the presser's own character, so another
   *  booth's press would do nothing: a host's (or a passcode admin's) booth
   *  leaves it out like any other booth, and `/api/prime/act` refuses it
   *  (`pressRefusal`, `actorHeardOnly`). Absent = heard, or no handler at
   *  all (a press reads the same from anyone), or not `only`. */
  hostHeard?: false;
  /** False while the INTERACTION's `while:` condition is false — a guest
   *  never sees it; a performer finds it under "More"; the director's cue
   *  sheet never suggests it as NEXT. */
  live?: false;
  /** An admin cue's own `act:` line, as written (the director's view only):
   *  it opens a section of the cue sheet, carried forward to later admin
   *  cues by `cueRows`. Display only — never changes NEXT / LAST. */
  act?: string;
  /** `arm: true` — the button arms on the first tap and fires on the second
   *  (core's `tapCue` arm model), in every UI that shows it. */
  arm?: boolean;
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

/** Does every listener of INTERACTION `id` bind a subject (C4: a press
 *  with no guest would do nothing)? */
export function interactionSubjectOnly(sim: Sim, id: string): boolean {
  return subjectOnlyEvents(sim).has(foldName(id));
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

const actorHeardOnlyCache = new WeakMap<Sim["model"], Set<string>>();

/**
 * The INTERACTION ids only their own actors' hooks hear, per model: some
 * CHARACTER hook listens for the event (a trait's, merged onto each
 * deriver), and no story-level rule or ROLE hook does. A press fires as the
 * presser's own character and only that character's hooks hear it
 * (`Sim.matchHooks`); a character owning a hook for it is one of its
 * `actors` (`interactionActors`), so a press from anyone else is heard by
 * nothing. Counted as handlers: event hooks with no timer, watcher or `at`
 * filter (what `Sim.signal` can match). A button with no handler at all is
 * not here: a press reads the same whoever makes it (the journal's
 * `signal`, which stagehand may act on).
 */
export function actorHeardOnly(sim: Sim): Set<string> {
  const m = sim.model;
  const cached = actorHeardOnlyCache.get(m);
  if (cached !== undefined) return cached;
  const hears = (h: Hook) => h.verb !== "" && h.timer === null && h.condition === null && h.filter === null;
  const open = new Set<string>();
  const own = new Set<string>();
  for (const h of m.rules) if (hears(h)) open.add(foldName(h.verb));
  for (const r of m.roles.values()) for (const h of r.hooks) if (hears(h)) open.add(foldName(h.verb));
  for (const c of m.characters.values()) for (const h of c.hooks) if (hears(h)) own.add(foldName(h.verb));
  const out = new Set<string>();
  for (const i of m.interactions.values()) {
    const k = foldName(i.id);
    if (own.has(k) && !open.has(k)) out.add(i.id);
  }
  actorHeardOnlyCache.set(m, out);
  return out;
}

/**
 * Why `character`'s booth may not press performer INTERACTION `def`, or
 * null when it may. Only a button that declares `by:` is anyone's in
 * particular: its actors (`interactionActors` — the `by:` characters, a
 * GROUP's members, and every character owning a hook for it) may press it,
 * nobody else. A `by:` naming nobody the story declares (a typo) stays open,
 * as it was before it was enforced. The message never says "sign in" (a
 * booth reads that as its session gone).
 */
export function byRefusal(sim: Sim, def: InteractionDef, character: string | null): string | null {
  if (def.by.length === 0) return null;
  const actors = interactionActors(sim).get(def.id);
  if (actors === undefined || actors.length === 0) return null;
  const me = character === null ? null : foldName(character);
  if (me !== null && actors.some((a) => foldName(a) === me)) return null;
  return `not your button: “${def.label}” is for ${def.by.join(", ")}`;
}

/**
 * `byRefusal` for a booth that may be a host's (`admin: true`, or the mod
 * passcode in a booth): a host may press another character's `by:` button,
 * but not one only its actors' own hooks hear (`actorHeardOnly`): that one is refused with the same
 * message as any other booth's press, and a host's card never offers it.
 * A headless moderator token (no character) is never refused: its press
 * carries no actor, so every character's hook hears it (`Sim.matchHooks`).
 */
export function pressRefusal(sim: Sim, def: InteractionDef, character: string | null, host: boolean): string | null {
  const refusal = byRefusal(sim, def, character);
  if (refusal === null || !host) return refusal;
  if (character === null) return null;
  return actorHeardOnly(sim).has(def.id) ? refusal : null;
}

/** The INTERACTIONs `who` may fire. With `at`, each `while:` is evaluated
 *  (`subject` / `self` bound as given) and marked `live: false` when it
 *  fails; without (the director's cue sheet), only an admin cue's is, with
 *  nothing bound. */
function interactionsFor(
  sim: Sim,
  who: Array<InteractionSummary["who"]> | null,
  at?: { subject: string | null; self: string | null },
): InteractionSummary[] {
  const subjectOnly = subjectOnlyEvents(sim);
  const actors = interactionActors(sim);
  const deaf = actorHeardOnly(sim);
  return [...sim.model.interactions.values()]
    .filter((i) => who === null || who.includes(i.who))
    .map((i) => {
      const s: InteractionSummary = { id: i.id, label: i.label, who: i.who, description: i.description };
      if (subjectOnly.has(foldName(i.id))) s.subject = true;
      if (!i.sequence) s.sequence = false;
      if (i.repeat) s.repeat = true;
      if (i.urgent === true) s.urgent = true;
      if (i.arm) s.arm = true;
      const by = i.who === "performer" ? actors.get(i.id) : undefined; // a guest never learns who hears their buttons
      if (by !== undefined) s.actors = by;
      if (by !== undefined && i.by.length > 0) {
        s.only = true;
        if (deaf.has(i.id)) s.hostHeard = false;
      }
      if (at !== undefined && i.while !== null && !sim.holds(i.while, at.subject, at.self)) s.live = false;
      // The director's cue sheet: an admin cue's `while:` names the branch
      // of the night it belongs to (🏍 only after Combo A), so NEXT skips it
      // off that branch. It never gates the press itself.
      if (at === undefined && i.who === "admin" && i.while !== null && !sim.holds(i.while, null, null)) s.live = false;
      // The director's sections: only the director's own view carries them.
      if (at === undefined && i.who === "admin" && i.act !== null) s.act = i.act;
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
  /** Wave 23: the printed badge number this guest linked; null when none.
   *  Set by the event server (`routes/rejoin.ts`), absent from a bare sim view. */
  badge?: number | null;
  /** The story's title + theme — the client's chrome comes from the story. */
  title: string;
  theme: string;
  /** The story clock (ms, `Sim.elapsed()`) when this view was built — the
   *  "now" a client measures a message's `ts` against (e.g. only banner an
   *  alert it missed if it is under 10 minutes old). */
  clock?: number;
  /** The show clock (wave 13 K2: `Clock.set_to` / `Clock.set_at`, see
   *  `src/show-clock.ts`), runtime-filled; absent when the story set none. */
  showClock?: ShowClock;
  role: string | null;
  /** App-facing faction — hidden factions read `null` until revealed. */
  faction: string | null;
  score: number;
  location: string | null;
  captured: boolean;
  /** The story restricted this guest (`restrict who`): the app greys out,
   *  no buttons, only the listed rooms, read-only; DMs stay. */
  restricted: boolean;
  /** The story's `lock:` header holds for this guest (wave 26, R1): only the
   *  pass and the `restricted: allow` buttons work; every write is refused,
   *  DMs included. Independent of `restricted`. */
  locked: boolean;
  /** May a captured guest free themselves from the app (the v3 "make a
   *  break for it" button)? False when their prison is `sealed: true` —
   *  only the story lets them out. */
  canEscape: boolean;
  /** Outstanding choice options awaiting this guest, if any. */
  pendingChoice: string[] | null;
  /** Channel the pending decision docks under (`"lobby"`, a DM, …). */
  decisionChannel: string | null;
  /** Every menu awaiting this guest, oldest first (wave 20, D18): its id
   *  (answer it with `/api/guest/choose {choice: id}` wherever it sits in
   *  the queue), the beat it sits in, the channel its prompt went to and its
   *  shown options. `pendingChoice` / `decisionChannel` are the first one's. */
  choices?: GuestChoice[];
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
  /** The sides a guest may join or defect to right now (`joinableFactions`:
   *  declared, joinable, not hidden or revealed) — the side chooser's
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
  /** The header's `countdown: … for guests` items on live lines whose
   *  deadline is still ahead (`boardFor`'s rule; never a `secret: true`
   *  head) — the phone's countdown strip, ticked from `clock`. Absent when
   *  none is running. */
  countdowns?: CountdownSummary[];
  /** The story clock is stopped (the event is paused, or its doors have not
   *  opened): `clock` holds still, so a countdown must not tick on. Set by
   *  the runtime; absent while the clock runs. */
  paused?: true;
  /** Live OBJECTIVEs for this guest, model order (NOW = the first). Always filled ([] when none). */
  objectives?: ObjectiveView[];
  /** Where the night is. Always filled. */
  night?: NightView;
  /** `alertLevelOf(world[model.alerts])`. Always filled. */
  alertLevel?: AlertLevel;
  /** Characters whose `dm:` thread somebody reads: performer parts
   *  (`performerPickable`) and agent-voiced (`mind: external`) characters,
   *  canonical ids. A `dm:<C>` with C not listed (Truther Download, The
   *  Uploader) gets no composer. Always filled. */
  voiced?: string[];
  // w18 crews (C10, crews.ts): the guest's crew, the invitations waiting on them, the sides they may pick.
  crew?: CrewView | null;
  invites?: InviteView[];
  sides?: SideView[];
  /** Wave 18b, faction mode only: may this guest found a faction now? */
  canFound?: boolean;
  /** Wave 18b, faction mode only: the race side you lead (listed or still
   *  hidden); absent when none. */
  leads?: string;
  /** Wave 18b: the viewer's own badges (`badge:` lines true for them).
   *  Absent when none. */
  badges?: NameBadge[];
  /** Wave 18b: header `lobby: hidden` — the phone never lists the lobby
   *  (its lines still reach the guest as moments / Notifications). The
   *  `lobby` channel stays in `channels`. Absent otherwise. */
  lobby?: "hidden";
  /** Wave 18 (C11): the mission screen's NOW objective and the one place it
   *  sends you (its `go:`), resolved for this guest (a room they cannot see
   *  yet reads null). Filled when the story declares any OBJECTIVE. */
  mission?: GuestMission;
  /** Wave 18 (C11): channel ids the story's `archive:` lines mark done for
   *  this guest (the phone tucks them away). Absent when none. */
  archived?: string[];
}

/** `GuestView.mission` (C11). */
export interface GuestMission {
  objective: string | null;
  place: { id: string; name: string } | null;
}

/** One pending menu on a `GuestView` (wave 20, D18). */
export interface GuestChoice {
  id: number;
  beat: string;
  channel: string;
  options: string[];
}

/** `menuChannels`: each pending menu's id → the channel its prompt went to
 *  (the runtime's `menuChannelsFor` record); a menu not in it docks in the
 *  lobby. */
export function guestView(sim: Sim, id: string, decisionChannel: string | null = null, agentsOnline?: ReadonlySet<string>, menuChannels?: ReadonlyMap<number, string>): GuestView {
  const p = sim.persons.get(id);
  const pendingChoice = sim.pendingChoiceFor(id);
  const locked = isLocked(sim, id);
  const narrowed = locked || sim.isRestricted(id);
  const interactions = interactionsFor(sim, ["guest"], { subject: id, self: id }).filter(
    (i) => i.live !== false && (!narrowed || sim.model.interactions.get(i.id)?.allowRestricted === true),
  );
  const objectives = objectivesWith(sim, { guest: id }, new Set(interactions.map((i) => i.id)));
  const choices = sim.pendingChoicesFor(id);
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
    locked,
    canEscape: !(sim.model.locations.get(sim.locationOf(id) ?? "")?.sealed ?? false),
    pendingChoice,
    // The oldest menu's own channel (D18): `decisionChannel` is the newest
    // prompt's, and with menus queued the tray docks the oldest's options.
    decisionChannel: pendingChoice ? (menuChannels?.get(choices[0]?.id ?? -1) ?? decisionChannel ?? "lobby") : null,
    choices: choices.map((c) => ({ ...c, channel: menuChannels?.get(c.id) ?? "lobby" })),
    cutscene: sim.cutsceneFor(id),
    channels: sim.visibleChannelsFor(id),
    spaces: sim.spaceList(),
    roster: sim.rosterFor(id),
    // A hidden group becomes a side once the story reveals it (`reveal G`).
    // The same predicate as /api/guest/join + /defect (routes/sides.ts), so
    // the chooser never offers a side the routes refuse.
    factions: joinableFactions(sim),
    groups: sim.groupsOf(id).filter((g) => {
      const def = sim.model.factions.get(g);
      return def === undefined || !def.hidden || sim.factionRevealed(g);
    }),
    // A guest only ever sees the buttons on offer to them right now — and
    // none at all while the story has them restricted.
    // Restricted or locked (wave 26): only the `restricted: allow` buttons
    // (Bathroom Mode) stay.
    interactions,
    codex: sim.codexFor(id).map((e) => codexEntry(e, sim.model)),
    codexTotal: sim.model.codex.size,
    quests: sim.questsFor(id).map(({ def, status }) => ({ id: def.id, title: def.title, giver: def.giver, status })),
    questTotal: sim.model.quests.size,
    people: peopleFor(sim, id, agentsOnline),
    ...guestBoard(sim),
    ...guestMission(sim, id, objectives),
    objectives,
    ...sim.crews.guestFields(id), // w18 crews
    // No act for a guest: the act's title is the director's copy and names
    // what is coming; the phone reads only `phase` (wave 13 adversary).
    night: { ...nightView(sim), act: null },
    alertLevel: alertLevelNow(sim),
    voiced: voicedOf(sim, id),
    ...badgesField(sim, id),
    ...(sim.model.lobbyHidden ? { lobby: "hidden" as const } : {}),
  };
}

/** `GuestView.mission` + `archived` (C11): the NOW objective and its `go:`
 *  place for this guest, and the rooms the story's `archive:` lines tucked
 *  away for them. */
function guestMission(sim: Sim, id: string, objectives: readonly ObjectiveView[]): Pick<GuestView, "mission" | "archived"> {
  const out: Pick<GuestView, "mission" | "archived"> = {};
  if (sim.model.objectives.size > 0) {
    const now = objectives[0];
    const def = now !== undefined ? sim.model.objectives.get(now.id) : undefined;
    let place: GuestMission["place"] = null;
    const t = def?.go != null ? resolveGoWord(sim.model, def.go) : null;
    if (t !== null) {
      if (t.kind === "room") {
        if (sim.canSeeChannel(id, t.id)) {
          const title = sim.channelHead(t.id).title;
          place = { id: t.id, name: title.replace(/\s*\([^()]*\)$/u, "").trim() || title };
        }
      } else if (t.kind === "dm") place = { id: t.id, name: t.id.slice("dm:".length) };
      else if (t.kind === "act") place = { id: t.id, name: t.label };
      else if (t.kind === "codex") place = { id: t.entry !== undefined ? `codex:${t.entry}` : "codex", name: t.label };
      else if (t.kind === "quests") place = { id: t.quest !== undefined ? `quests:${t.quest}` : "quests", name: t.label };
      else place = { id: t.kind, name: t.label };
    }
    out.mission = { objective: now?.id ?? null, place };
  }
  if (sim.model.archive.length > 0) {
    const archived: string[] = [];
    for (const a of sim.model.archive) if (!archived.includes(a.channel) && sim.holds(a.when, id, id)) archived.push(a.channel);
    // Always sent when the story declares an `archive:` line, even empty:
    // a client reads an absent field as an older server and folds quiet DMs
    // on its own 15-minute rule (m1).
    out.archived = archived;
  }
  return out;
}

/** `GuestView.countdowns`, when any `for guests` countdown is running. */
function guestBoard(sim: Sim): Pick<GuestView, "countdowns"> {
  if (!sim.model.countdowns.some((l) => l.guests === true)) return {};
  const countdowns = liveCountdowns(sim, (l) => l.guests);
  return countdowns.length > 0 ? { countdowns } : {};
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
  /** When this guest was last heard from (epoch ms): a stream opened or
   *  closed, or any request on their own token. Null = not since this
   *  process started. Set only by `modView` from presence. */
  lastSeen?: number | null;
  /** A director marked them gone home (`<id>.gone`, `/api/mod/guest/gone`). */
  gone?: true;
  /** A director's Run persona (`<id>.persona`, set at `/api/mod/persona`). */
  persona?: true;
  /** Wave 18b: the header `badge:` lines true for them. Absent when none. */
  badges?: NameBadge[];
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
    ...(worldTrue(sim, `${p.id}.gone`) ? { gone: true as const } : {}),
    ...(worldTrue(sim, `${p.id}.persona`) ? { persona: true as const } : {}),
    ...badgesField(sim, p.id),
  };
}

/** Is the world value at `path` the boolean true? */
function worldTrue(sim: Sim, path: string): boolean {
  const v = sim.world.get(path);
  return v !== undefined && v.kind === "bool" && v.value;
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
  /** A staff room (`staffRoomIds`: an authored `kind: faction` CHANNEL whose
   *  GROUP no guest may join — `# hosts`): where the story says why it
   *  turned a cue down. The Director page's staff-room feed reads these. */
  staff?: true;
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
  /** An agent character's line of requests (wave 11): how many wait, how
   *  long the oldest has, and whether its worker stalled (connected, not
   *  answering — the hold line went out, a director answers by hand).
   *  Present on agent characters where connection tracking exists. */
  agentQueue?: AgentQueue;
  /** A part a performer can sign in to (`identity.ts` `performerPickable`):
   *  the Run page's sign-in list shows only these. */
  part?: boolean;
  /** `reserved: true` — a guest's program held for its invitee (a featured
   *  program): taken only with its claim (`/api/mod/codes` → `claims`). */
  reserved?: true;
  /** A reserved program a director opened to anyone until then (epoch ms,
   *  `/api/mod/claim/unlock`) — present only while the window is open. */
  unlockedUntil?: number;
  /** A part a session token holds right now, streaming or not — `held` and
   *  not `online` is a booth whose phone dropped (⏏ Release). Present on
   *  parts where connection tracking exists. */
  held?: boolean;
  /** `secret: true` (the Kernel): the Director masks its values wherever
   *  they show (a press's `did:` line), watched or not. */
  secret?: true;
  /** Wave 21 (C8): `player: true` — a performer part that plays the game
   *  (Run's roster and the host's People tag it "player"). Always set. */
  player: boolean;
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
  /** guest id → when they were last heard from (epoch ms). */
  lastSeen?: ReadonlyMap<string, number>;
  /** reserved character → when its open window closes (epoch ms; only
   *  windows still open). */
  unlocks?: ReadonlyMap<string, number>;
  /** Agent characters with a stagehand worker connected. */
  agents?: Set<string>;
  /** Each agent character's request line (`AgentHub.queue`). */
  agentQueues?: Map<string, AgentQueue>;
  /** Folded character names a performer's session token holds (streaming or
   *  not — `identity.ts` `heldCharacters`). */
  held?: Set<string>;
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
  /** Wave 32 (C5): the talk scene that is on (`Night.talk`) with Trabolta's
   *  state (`talk-back.ts` `talkView`), runtime-filled; null when none is
   *  on; absent from an older server. */
  talk?: TalkView | null;
  /** Wave 59: the teleprompter's scene (`prompter.ts`), null with none on. */
  prompter?: PrompterStatus | null;
  theme?: string;
  /** Every declared INTERACTION (the director may fire any of them). */
  interactions?: InteractionSummary[];
  phase: RuntimePhase;
  /** The doors have not opened on this run yet: its `start:` beat has not
   *  played (idle, or a restart with the doors shut — `paused`). A
   *  cue-sheet press is refused until they open. Set by the event runtime. */
  doorsClosed?: true;
  scenario: string | null;
  roster: RosterRow[];
  factions: FactionSummary[];
  /** w18 crews: every live guest-founded crew (rename / dissolve from Run). */
  crews?: CrewSummary[];
  /** Wave 18b, faction mode only: the race — the threshold, who is present
   *  and every faction's head count (directors and hosts see them all).
   *  `winner` is the faction over the line now, not the story's latch. */
  race?: RaceView;
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
  /** The show clock (wave 13 K2: `Clock.set_to` / `Clock.set_at`, see
   *  `src/show-clock.ts`), runtime-filled; absent when the story set none. */
  showClock?: ShowClock;
  /** The header's `watch:` items on lines whose `while` holds now (the
   *  Director page's glance column; values come from `world`). Absent when
   *  the story declares no `watch:` line. */
  watch?: WatchSummary[];
  /** The header's `countdown:` items on live lines whose deadline is still
   *  ahead (`endsAt` > `Time.elapsed`). Absent when there are none. */
  countdowns?: CountdownSummary[];
  /** The interrupt ladder: its world path and current level. */
  alerts?: { path: string; level: AlertLevel };
}

/** One `watch:` item the director's glance column shows. */
export interface WatchSummary {
  label: string;
  /** The world path (its head spelled as declared), or null for a person. */
  path: string | null;
  /** A person item's name as written (a character, or the guest playing it). */
  person: string | null;
  /** How the client reads it: a `character`'s or a `global`'s value off
   *  `world`, a count over guests of a ROLE slot (`program.cleared` →
   *  every guest's `<id>.cleared`), or a person row. */
  scope: "global" | "character" | "role" | "person";
  /** On a `secret: true` CHARACTER (the Kernel): masked until held open. */
  secret?: true;
  /** From a line with a `while` — shown only for a stretch of the night
   *  (`Results read` during the truth round): the phone's three-value strip
   *  carries these first. */
  gated?: true;
}

/** One live `countdown:` item. */
export interface CountdownSummary {
  label: string;
  path: string;
  /** The deadline, in story seconds (`Time.elapsed` units). */
  endsAt: number;
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
  /** Who pressed LAST, by name, when a director press moved it and the
   *  runtime noted who (`notePress`'s `by`, the journal's): a host booth's
   *  part (`Booth · Task Manager` → "Task Manager"), an author's name, a
   *  device's label, a headless mod token's "Director". Absent when the
   *  story fired LAST, or nobody was named (a bare `Sim`, the editor's
   *  in-browser rehearsal). Display only. */
  lastName?: string;
  /** Every admin cue that has fired at least once, in first-fire order. */
  fired: string[];
  /** How many admin-cue presses the story took tonight (by a director, a
   *  device, or the story's own `fire`; a refused press never counts). A
   *  repeat of LAST or of an aside moves only this: a director screen binds
   *  its arm to it, and `/api/mod/signal {presses}` refuses a press armed
   *  against an older count only when a press since fired that same cue,
   *  moved LAST or ticked a new cue (`pressMovedArm`, 409 `moved`) — never
   *  for another cue's repeat (a second duck find, a door contact). */
  presses: number;
  /** The cue the newest taken press fired (asides included), or null. */
  pressed: string | null;
  /** Who is calling the show (wave 18, C8) — the runtime's memory-only
   *  claim; a bare sim never has one. */
  caller?: CueCaller | null;
}

interface CueScan {
  model: Sim["model"];
  /** Log entries already scanned. */
  at: number;
  state: CueState;
  seen: Set<string>;
  /** `state.last`'s place in the declared order (-1 = none). */
  lastOrder: number;
  /** Every taken press in order (index = the press count before it): the
   *  cue it fired, and whether it moved LAST or ticked a cue for the first
   *  time (`pressMovedArm`). */
  pressLog: { id: string; moved: boolean }[];
}

/** Where each director press's own events end, per log: the batch one
 *  `Sim.signal` call wrote (start index → end index, exclusive). The event
 *  runtime notes every journaled signal as it commits it live *and* as
 *  `restore()` replays it, so a press is judged by exactly what it did —
 *  never by whichever input (a wallet sweep, a mod `set`, a join) happened
 *  to land after it before the next director snapshot (T7-01). */
const pressEnds = new WeakMap<object, Map<number, number>>();

/** Who made each noted press, per log: the press's start index → the
 *  display name (`pressedByName`). Fed by `notePress`'s `by`. */
const pressBys = new WeakMap<object, Map<number, string>>();

/** The journal's `by` as the host dock names a presser: a booth's part
 *  without its `Booth · ` prefix, an agent without `agent:`, else as is. */
export function pressedByName(by: string): string {
  const t = by.trim();
  if (t.startsWith("Booth · ")) return t.slice("Booth · ".length).trim();
  if (t.startsWith("agent:")) return t.slice("agent:".length).trim();
  return t;
}

/** Record a `Sim.signal` batch just returned (`out = sim.signal(…)`), and
 *  who pressed it (`by`, the journal line's) when known — the event runtime
 *  passes the same `by` live and on `restore()`, so `CueState.lastName`
 *  reads the same after a restart. */
export function notePress(sim: Sim, batch: readonly SimEvent[], by?: string | null): void {
  if (batch.length === 0) return;
  const end = sim.log.len();
  let ends = pressEnds.get(sim.log);
  if (ends === undefined) {
    ends = new Map();
    pressEnds.set(sim.log, ends);
  }
  ends.set(end - batch.length, end);
  const name = typeof by === "string" ? pressedByName(by) : "";
  if (name !== "") {
    let bys = pressBys.get(sim.log);
    if (bys === undefined) {
      bys = new Map();
      pressBys.set(sim.log, bys);
    }
    bys.set(end - batch.length, name);
  }
}

/** Was the press `batch` (a `Sim.signal` call just committed and noted)
 *  refused by the story — the same judgement the cue sheet makes, so a
 *  director's phone can say "not taken" rather than "fired". */
export function pressRefused(sim: Sim, batch: readonly SimEvent[]): boolean {
  const first = batch[0];
  if (first === undefined || first.type !== "signal") return false;
  return refusedPress(sim, sim.log.all(), sim.log.len() - batch.length, first.name);
}

/** Did the story refuse the signal logged at index `n` (the same judgement
 *  as `pressRefused`, for a press already in the log) — the screens never
 *  animate a cue the story turned down (wave 17). False for anything else. */
export function signalRefusedAt(sim: Sim, n: number): boolean {
  const events = sim.log.all();
  const e = events[n];
  return e !== undefined && e.type === "signal" && refusedPress(sim, events, n, e.name);
}

/** Was the scan `batch` (a `Sim.scan` call just committed) refused by the
 *  story (D1): it did nothing but tell a staff room why — at least one
 *  staff-only broadcast ("🗣 Not now…"), and otherwise only diagnostics or
 *  `_`-leaf bookkeeping. A scan nobody hears, or one that only greets, is
 *  never "refused": nothing said no. */
export function scanRefused(sim: Sim, batch: readonly SimEvent[]): boolean {
  if (batch[0]?.type !== "scanned") return false;
  const cm = cueModelOf(sim.model);
  let told = false;
  for (const e of batch.slice(1)) {
    if (e.type === "diagnostic") continue;
    if (e.type === "worldSet" && bookkeeping(e.path)) continue;
    if (e.type === "broadcast" && staffOnly(e.scope, cm.staff)) {
      told = true;
      continue;
    }
    return false;
  }
  return told;
}

/** Log entries that start a new input (a press, a tick, a typed line, a
 *  join, a scan) — where a press nobody noted (`notePress`: a bare `Sim`
 *  in a test; the editor's in-browser rehearsal notes its presses) is taken
 *  to end. */
const CUE_INPUTS: ReadonlySet<string> = new Set(["signal", "tick", "chat", "accountCreated", "scanned"]);

/** What `refusedPress` needs from the model, per compiled model: the named
 *  events some rule listens for, and the staff rooms (an authored
 *  `kind: faction` CHANNEL whose GROUP no guest may join — `# hosts`). */
interface CueModel {
  heard: Set<string>;
  staff: Set<string>;
}
const cueModels = new WeakMap<object, CueModel>();
function cueModelOf(model: Sim["model"]): CueModel {
  let out = cueModels.get(model);
  if (out === undefined) {
    const heard = new Set<string>();
    const collect = (hooks: readonly { verb: string; timer: unknown; condition: string | null }[]): void => {
      for (const h of hooks) if (h.timer === null && h.condition === null && h.verb !== "") heard.add(foldName(h.verb));
    };
    for (const c of model.characters.values()) collect(c.hooks);
    for (const r of model.roles.values()) collect(r.hooks);
    collect(model.rules);
    out = { heard, staff: staffRoomIds(model) };
    cueModels.set(model, out);
  }
  return out;
}

const staffRooms = new WeakMap<object, Set<string>>();

/** The story's staff rooms, folded (`roomFold`): every authored
 *  `kind: faction` CHANNEL whose GROUP no guest may join (`# hosts`) —
 *  where a phase-guarded rule says why it refused a cue (`refusedPress`),
 *  and the Director page's staff-room feed. Per compiled model. */
export function staffRoomIds(model: Sim["model"]): Set<string> {
  let staff = staffRooms.get(model);
  if (staff === undefined) {
    staff = new Set<string>();
    for (const c of model.channels.values()) {
      const group = c.kind === "faction" && c.faction !== null ? model.factions.get(c.faction) : undefined;
      if (group !== undefined && !group.joinable) staff.add(roomFold(c.id));
    }
    staffRooms.set(model, staff);
  }
  return staff;
}

/** A room name folded the way `chat.ts` matches `channel(…)` scopes. */
function roomFold(s: string): string {
  return s.replace(/^room:/u, "").toLowerCase().replace(/[#_-]/g, " ").replace(/\s+/g, " ").trim();
}

/** A broadcast scope that names only staff rooms (`channel(hosts)`). */
function staffOnly(scope: string, staff: ReadonlySet<string>): boolean {
  const terms = scope.split("|").map((t) => t.trim());
  return terms.length > 0 && terms.every((t) => {
    const m = /^channel\((.+)\)$/u.exec(t);
    return m !== null && staff.has(roomFold(m[1]!));
  });
}

/** `Night._ask_at` — a variable whose last segment starts with `_`. */
function bookkeeping(path: string): boolean {
  const leaf = path.slice(path.lastIndexOf(".") + 1);
  return leaf.startsWith("_");
}

/** Did the director's press at `events[n]` (a cue some rule listens for) do
 *  nothing but, at most, tell a staff room why? The story's phase-guarded
 *  rules refuse a cue pressed out of turn with a `# hosts` line or not at
 *  all (T1-02), and may note a `_`-leaf variable while it does (C3): such
 *  a press never becomes LAST or ticks the cue. A cue no
 *  rule hears (only stagehand reacts) always counts as fired. */
function refusedPress(sim: Sim, events: readonly SimEvent[], n: number, name: string): boolean {
  const cm = cueModelOf(sim.model);
  if (!cm.heard.has(foldName(name))) return false;
  const end = pressEnds.get(sim.log)?.get(n);
  for (let k = n + 1; k < (end ?? events.length); k++) {
    const e = events[k]!;
    if (end === undefined && CUE_INPUTS.has(e.type)) break;
    if (e.type === "diagnostic") continue;
    if (e.type === "broadcast" && staffOnly(e.scope, cm.staff)) continue;
    // A world write whose last path segment starts with `_` is cue-sheet
    // bookkeeping (G11 remembering when it asked: `Night._resurrect_ask_at`)
    // and never makes a press count.
    if (e.type === "worldSet" && bookkeeping(e.path)) continue;
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
 * A director's press the story refused (`refusedPress`) counts for nothing
 * — not LAST, not fired, in sequence or not — and a repeat of a cue that already fired never moves LAST
 * back to an earlier row (T7-01): a mis-tap is cheap.
 */
export function cueState(sim: Sim): CueState {
  const admin = new Map<string, { id: string; sequence: boolean; order: number }>();
  for (const i of sim.model.interactions.values()) if (i.who === "admin") admin.set(foldName(i.id), { id: i.id, sequence: i.sequence, order: admin.size });
  if (admin.size === 0) return { last: null, lastBy: null, fired: [], presses: 0, pressed: null };
  const events = sim.log.all();
  let scan = cueScans.get(sim.log);
  if (scan === undefined || scan.model !== sim.model || scan.at > events.length) {
    scan = { model: sim.model, at: 0, state: { last: null, lastBy: null, fired: [], presses: 0, pressed: null }, seen: new Set(), lastOrder: -1, pressLog: [] };
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
    if (by === "director" && refusedPress(sim, events, n, name)) continue;
    state.presses += 1;
    state.pressed = id;
    const lastWas = state.last;
    let moved = false;
    if (cue.sequence) {
      if (!(seen.has(id) && cue.order < scan.lastOrder)) {
        state.last = id;
        state.lastBy = by;
        const name = by === "director" ? pressBys.get(sim.log)?.get(n) : undefined;
        if (name !== undefined) state.lastName = name;
        else delete state.lastName;
        scan.lastOrder = cue.order;
        moved = lastWas !== id;
      }
    }
    if (!seen.has(id)) {
      seen.add(id);
      state.fired.push(id);
      moved = true;
    }
    scan.pressLog.push({ id, moved });
  }
  scan.at = events.length;
  return { last: state.last, lastBy: state.lastBy, ...(state.lastName !== undefined ? { lastName: state.lastName } : {}), fired: [...state.fired], presses: state.presses, pressed: state.pressed };
}

/**
 * Did the night move under an arm made at press count `presses` for cue
 * `id`? True when a press taken since then fired that same cue (a second
 * director's 📋, or 🍾 again), moved LAST, or ticked a cue for the first
 * time — what a director's screen binds its arm to (spec §4.3). Another
 * cue's repeat (a guest's second duck find, a door contact firing again,
 * an aside the other director pressed) moves nothing an arm cares about,
 * so it never vetoes the press. A count from ahead of the night (a
 * restart since) is stale too.
 */
export function pressMovedArm(sim: Sim, presses: number, id: string): boolean {
  const cues = cueState(sim);
  if (presses > cues.presses || presses < 0) return true;
  if (presses === cues.presses) return false;
  const scan = cueScans.get(sim.log);
  if (scan === undefined) return true;
  const want = foldName(id);
  for (let k = Math.floor(presses); k < scan.pressLog.length; k++) {
    const p = scan.pressLog[k]!;
    if (p.moved || foldName(p.id) === want) return true;
  }
  return false;
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
  const staff = staffRoomIds(sim.model);
  for (const id of sim.model.channels.keys()) {
    const h = sim.channelHead(id);
    out.push({ id: h.channel, kind: h.channelKind, title: h.title, spaceId: h.spaceId, ...(staff.has(roomFold(id)) ? { staff: true as const } : {}) });
  }
  // w18 crews: every live crew's members-only room (directors read its lines).
  for (const c of sim.crews.all()) {
    const h = sim.crews.head(crewRoom(c.id));
    out.push({ id: h.channel, kind: h.channelKind as ChannelSummary["kind"], title: h.title, spaceId: h.spaceId });
  }
  return out;
}

/** The parts a performer can sign in to, per compiled model (memoised: the
 *  classification walks the story, and director snapshots are frequent). */
const parts = new WeakMap<object, Set<string>>();
function partsOf(model: Sim["model"]): Set<string> {
  let out = parts.get(model);
  if (out === undefined) {
    out = new Set(identityDefs(model).filter(performerPickable).map((d) => d.name));
    parts.set(model, out);
  }
  return out;
}

/** `declared`: the story's cast while no sim exists (the doors are shut) —
 *  a terminal provisioned before the doors checks its character against it. */
export function modView(sim: Sim | null, phase: RuntimePhase, scenario: string | null, presence?: ModPresence, declared?: readonly string[], declaredSim?: Sim | null): ModView {
  if (sim === null) {
    // Before the doors: the story's own admin cues (off its compiled, never
    // played text), so the director's cue sheet is there from sign-in — not
    // "this story has no director cues".
    const before =
      declaredSim != null
        ? { title: declaredSim.lobbyTitle(), theme: declaredSim.model.theme ?? "plain", interactions: interactionsFor(declaredSim, ["admin"]), cues: { last: null, lastBy: null, fired: [], presses: 0, pressed: null } satisfies CueState }
        : {};
    return {
      ...before,
      phase,
      scenario,
      roster: [],
      factions: [],
      // The story's LOCATIONs, empty (the map editor checks its rooms against them before the doors: LA-3).
      locations: declaredSim != null ? [...declaredSim.model.locations.values()].map((l) => ({ id: l.id, label: l.label, prison: l.prison, occupants: [] })) : [],
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
      ? { ...rosterRow(sim, id)!, online: presence.guests.has(id), owner: presence.owners?.get(id) ?? null, lastSeen: presence.lastSeen?.get(id) ?? null }
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
    cast: [...sim.model.characters.values()].map((c) => {
      const part = partsOf(sim.model).has(c.id);
      return {
        id: c.id,
        faction: c.faction ?? null,
        ...(c.mind === "external" ? { agent: true } : {}),
        ...(presence !== undefined
          ? { online: c.mind === "external" ? (presence.agents?.has(c.id) ?? false) : presence.primes.has(c.id) }
          : {}),
        ...(c.mind === "external" && presence?.agentQueues?.has(c.id) === true ? { agentQueue: presence.agentQueues.get(c.id)! } : {}),
        ...(part ? { part: true } : {}),
        ...(c.reserved ? { reserved: true as const } : {}),
        ...(c.reserved && presence?.unlocks?.has(c.id) === true ? { unlockedUntil: presence.unlocks.get(c.id)! } : {}),
        ...(part && presence?.held !== undefined ? { held: presence.held.has(foldName(c.id)) } : {}),
        ...(c.secret ? { secret: true as const } : {}),
        player: c.player,
      };
    }),
    channels: operatorChannels(sim),
    spaces: sim.spaceList(),
    beats: [...sim.model.beats.keys()],
    choices: sim.allPendingChoices(),
    ledgerLen: sim.log.len(),
    world: sim.worldEntries(),
    modsOnline: presence?.mods,
    directors: presence?.directors,
    codex: [...sim.model.codex.values()].map((e) => ({ ...codexEntry(e, sim.model), code: e.code, holders: sim.codexHolders(e.id) })),
    crews: sim.crews.summaries(), // w18 crews
    ...(sim.crews.factionMode ? { race: sim.crews.raceView()! } : {}), // w18b factions
    quests: questSummaries(sim),
    ...(presence?.minds !== undefined && presence.minds.length > 0 ? { minds: presence.minds } : {}),
    ...(presence?.facts !== undefined ? { facts: presence.facts } : {}),
    cues: cueState(sim),
    clock: sim.elapsed(),
    ...modBoard(sim),
    alerts: { path: sim.model.alerts, level: alertLevelNow(sim) },
  };
}

/** `boardFor`, spread onto the `ModView`: `watch` whenever the story
 *  declares a `watch:` line, `countdowns` only while one is running. */
function modBoard(sim: Sim): Pick<ModView, "watch" | "countdowns"> {
  if (sim.model.watch.length === 0 && sim.model.countdowns.length === 0) return {};
  const b = boardFor(sim);
  return {
    ...(sim.model.watch.length > 0 ? { watch: b.watch } : {}),
    ...(b.countdowns.length > 0 ? { countdowns: b.countdowns } : {}),
  };
}

/** A board line with its items' scopes resolved against the model. */
interface ResolvedBoard {
  watch: Array<{ while: string | null; items: WatchSummary[] }>;
  countdowns: Array<{ while: string | null; guests: boolean; items: Array<{ label: string; path: string }> }>;
}
const boards = new WeakMap<object, ResolvedBoard>();

/** Resolve each board line's scopes once per compiled model (director
 *  snapshots are frequent): a path's head names a CHARACTER (its value;
 *  `secret: true` → masked; a countdown on one is dropped), a ROLE (a
 *  count over guests), or anything else (a global); an item with no dot
 *  is a person. */
function resolvedBoard(model: Sim["model"]): ResolvedBoard {
  let out = boards.get(model);
  if (out !== undefined) return out;
  const chars = new Map([...model.characters.values()].map((c) => [foldName(c.id), c]));
  const roles = new Map([...model.roles.keys()].map((id) => [foldName(id), id]));
  const scoped = (path: string): { path: string; scope: WatchSummary["scope"]; secret: boolean } => {
    const dot = path.indexOf(".");
    const head = path.slice(0, dot);
    const rest = path.slice(dot);
    const c = chars.get(foldName(head));
    // Wave 21 (C2): a character's `private:` slot is masked like a secret one.
    if (c !== undefined) return { path: c.id + rest, scope: "character", secret: c.secret || isPrivateSlot(c, rest.slice(1)) };
    const r = roles.get(foldName(head));
    if (r !== undefined) return { path: r + rest, scope: "role", secret: false };
    return { path: (model.entityIndex.get(head) ?? head) + rest, scope: "global", secret: false };
  };
  out = {
    watch: model.watch.map((l) => ({
      while: l.while,
      items: l.items.map((i): WatchSummary => {
        const gated = l.while !== null ? { gated: true as const } : {};
        if (i.path === null) return { label: i.label, path: null, person: i.name, scope: "person", ...gated };
        const s = scoped(i.path);
        return { label: i.label, path: s.path, person: null, scope: s.scope, ...(s.secret ? { secret: true as const } : {}), ...gated };
      }),
    })),
    // A countdown on a `secret: true` CHARACTER is dropped: its deadline
    // would go out raw as `endsAt` (and to the phone's lean view), and a
    // countdown has no mask. Lint L1205 says so.
    countdowns: model.countdowns.map((l) => ({
      while: l.while,
      guests: l.guests === true,
      items: l.items.flatMap((i) => {
        if (i.path === null) return [];
        const s = scoped(i.path);
        return s.secret ? [] : [{ label: i.label, path: s.path }];
      }),
    })),
  };
  boards.set(model, out);
  return out;
}

/** Does a board line's `while` hold now (nothing bound, like an admin
 *  cue's)? A condition that throws hides its line. */
function boardLineLive(sim: Sim, cond: string | null): boolean {
  if (cond === null) return true;
  try {
    return sim.holds(cond, null, null);
  } catch {
    return false;
  }
}

/**
 * The director's board right now: the `watch:` items on lines whose
 * `while` holds, and the `countdown:` items on live lines whose deadline
 * (a story time in seconds) is still ahead of the story clock — a past or
 * stale deadline never shows. Read-only and display-only.
 */
export function boardFor(sim: Sim): { watch: WatchSummary[]; countdowns: CountdownSummary[] } {
  const board = resolvedBoard(sim.model);
  const watch = board.watch.filter((l) => boardLineLive(sim, l.while)).flatMap((l) => l.items.map((i) => ({ ...i })));
  return { watch, countdowns: liveCountdowns(sim) };
}

/** The live `countdown:` items (on lines `keep` keeps): a live line, a
 *  deadline still ahead of the story clock; a secret head never (dropped
 *  by `resolvedBoard`). */
function liveCountdowns(sim: Sim, keep: (line: { guests: boolean }) => boolean = () => true): CountdownSummary[] {
  const now = sim.elapsed() / 1000;
  const countdowns: CountdownSummary[] = [];
  for (const l of resolvedBoard(sim.model).countdowns) {
    if (!keep(l) || !boardLineLive(sim, l.while)) continue;
    for (const i of l.items) {
      const endsAt = asNumber(sim.world.get(i.path));
      if (endsAt !== null && Number.isFinite(endsAt) && endsAt > now) countdowns.push({ label: i.label, path: i.path, endsAt });
    }
  }
  return countdowns;
}

// --- wave 13: objectives, where the night is, the interrupt level, flags ---

/** One live OBJECTIVE as this viewer sees it. */
export interface ObjectiveView {
  id: string;
  title: string;
  /** "" when none. Literal text (no `{…}` interpolation in v1). */
  brief: string;
  checklist: ObjectiveCheck[];
  /** What this viewer may press, in written order, plus "pass" / "scan".
   *  For a **guest**: the objective's `who: guest` ids that are also in
   *  that guest's `GuestView.interactions` (already live-filtered and
   *  restriction-filtered with subject = the guest), so an objective never
   *  offers a button `/api/guest/act` would refuse. For a **booth**: the
   *  `who: performer` ids, another character's `by:` button dropped unless
   *  the booth is host or admin and the press is heard (`pressRefusal`); not filtered by `while:` (the card asks
   *  `/api/prime/card`). */
  buttons: string[];
  /** `act:` as written, else null. Display only. */
  act: string | null;
  loud?: true;
  /** `evergreen: true` (wave 18, A7): the fallback objective — a phone never counts it as "+1". */
  evergreen?: true;
  /** A booth objective's `target:` (wave 18, C5): the guest it is about,
   *  when the expression names one now. `avatar` is runtime-filled. */
  target?: ObjectiveTarget;
  /** A booth objective's `pick:` (wave 18, C5): the guests its picker
   *  offers — ids, at most 60, those in the booth character's room first,
   *  then by name. Absent when the objective has no `pick:`. */
  pick?: string[];
}

/** The guest a booth objective names (`ObjectiveView.target`). */
export interface ObjectiveTarget {
  id: string;
  name: string;
  avatar?: string;
  location?: string | null;
}

/** How many guests a `pick:` offers at most. */
export const PICK_MAX = 60;

export interface ObjectiveCheck {
  label: string;
  /** null = a to-do with no condition; else whether `done when` holds now (same bindings as `while:`). */
  done: boolean | null;
}

/** Where the night is, for every phone. */
export interface NightView {
  /** The cue sheet's focus act (`cueActs(cueRows(adminCues, cueState(sim)))`, `focusActIndex`): its code + title. Null when no admin cue declares `act:` or there is no focus act — and always null in a `GuestView` (director copy; a booth and a host keep it). */
  act: { code: string | null; title: string | null } | null;
  /** The world `Night.phase` (quotes stripped), else null. A convention, like `cue-sheet.ts nightPhase`. */
  phase: string | null;
  /** The world `Night.step` as a number, else null. */
  step: number | null;
  /** (wave 26, T2) The story's last glitch: `Night.glitch_at` (story
   *  seconds) × 1000 as `at`, in the same unit as `GuestView.clock` (story
   *  ms); `text` from `Night.glitch_text` ("none" → null). Absent while
   *  `Night.glitch_at` is 0, unset or not a number. Wave 32 (C5): `light`
   *  when `Night.glitch_kind` is `"burst"` (a talk scene's short ad burst:
   *  phones play the look-only takeover); absent for the full one. */
  glitch?: { at: number; text: string | null; light?: true };
  /** (wave 44, C5) The credits' roll: `roll` = `Night.credits_roll`, `at` =
   *  `Night.credits_at` × 1000 (story ms, like `glitch.at`). Absent while the
   *  roll is 0 or unset. */
  credits?: { roll: number; at: number };
}

/** (wave 26, T2) The world paths `NightView.glitch` reads. */
export const GLITCH_AT_PATH = "Night.glitch_at";
export const GLITCH_TEXT_PATH = "Night.glitch_text";
/** (wave 32, C5) `"burst"` = a talk scene's light ad burst; anything else
 *  (`"full"`, unset) = the full takeover. */
export const GLITCH_KIND_PATH = "Night.glitch_kind";

/** Is this guest's phone locked (wave 26, R1)? The story's `lock:` header
 *  held for them (`sim.holds(cond, id, id)`); no header = never. */
export function isLocked(sim: Sim, id: string): boolean {
  const cond = sim.model.lock;
  return cond !== null && sim.persons.has(id) && sim.holds(cond, id, id);
}

/** A ROLE-scoped `watch:` item for one guest (the booth card's facts). */
export interface GuestFlag {
  /** The item's label (`Marked`). */
  label: string;
  /** The item's path as resolved (`Program.marked`). */
  path: string;
  /** The guest's value, display string (`true`, `3`, `"Tent"` unquoted). */
  value: string;
  /** Whether the value is truthy. A **boolean** item (the slot is declared
   *  `bool`, or the value is `true` / `false`) is always listed, false
   *  included, so a card can say "Not cleared"; a non-boolean item is
   *  listed only when truthy (falsy = 0, "", null, "none"). */
  on: boolean;
}

/** What one booth may do to one guest right now (`POST /api/prime/card`). */
export interface GuestCardView {
  guest: PrimeGuest;
  /** INTERACTION ids (`who: performer`) this booth may press on this guest
   *  now: `by:` admits this character (or the booth is host / admin) AND
   *  `while:` holds with subject = the guest, self = the character. Model order. */
  live: string[];
  /** The subset of `live` whose `while:` reads the subject (a path whose
   *  head is the ROLE id or one of its aliases — `program.marked`), i.e.
   *  buttons that are live *because of this guest*. Computed once per model
   *  from the parsed `while:` (cached), model order. */
  guestScoped: string[];
  /** This character's readouts about this guest (`readout && about === guest`, in `dm:<Character>`), oldest first, at most the last 5. */
  readouts: Array<{ seq: number; text: string; ts: number }>;
}

/** The reserved objective buttons (never an INTERACTION id). */
const OBJECTIVE_RESERVED_BUTTONS: ReadonlySet<string> = new Set(["pass", "scan"]);

/** The groups a guest shows (`GuestView.groups`): public ones, and a hidden
 *  one only once the story revealed it. */
function shownGroupsOf(sim: Sim, id: string): string[] {
  return sim.groupsOf(id).filter((g) => {
    const def = sim.model.factions.get(g);
    return def === undefined || !def.hidden || sim.factionRevealed(g);
  });
}

/** The ids a guest may press right now — `GuestView.interactions`' rule. */
function guestInteractionIds(sim: Sim, id: string): Set<string> {
  const restricted = sim.isRestricted(id) || isLocked(sim, id);
  return new Set(
    interactionsFor(sim, ["guest"], { subject: id, self: id })
      .filter((i) => i.live !== false && (!restricted || sim.model.interactions.get(i.id)?.allowRestricted === true))
      .map((i) => i.id),
  );
}

/**
 * The live OBJECTIVEs for one viewer, model order (the first is NOW, §3.1).
 * Who sees it is decided before any `while:` is evaluated (the audience
 * pre-filter); `while:` and every `done when` run with the viewer bound
 * (a guest: subject = self = the guest; a booth: self = the character, no
 * subject). Display only: never journaled, never sent to an agent.
 */
export function objectivesFor(sim: Sim, viewer: { guest: string } | { character: string; host?: boolean }): ObjectiveView[] {
  return objectivesWith(sim, viewer);
}

function objectivesWith(sim: Sim, viewer: { guest: string } | { character: string; host?: boolean }, guestIds?: ReadonlySet<string>): ObjectiveView[] {
  const m = sim.model;
  if (m.objectives.size === 0) return [];
  const out: ObjectiveView[] = [];
  if ("guest" in viewer) {
    const id = viewer.guest;
    const person = sim.persons.get(id);
    if (person === undefined) return [];
    const role = foldName(person.role);
    const groups = new Set(shownGroupsOf(sim, id).map(foldName));
    let live: ReadonlySet<string> | undefined = guestIds;
    for (const o of m.objectives.values()) {
      const a = o.audience;
      const sees = a.guests || a.roles.some((r) => foldName(r) === role) || a.groups.some((g) => groups.has(foldName(g)));
      if (!sees) continue;
      if (o.while !== null && !sim.holds(o.while, id, id)) continue;
      live ??= guestInteractionIds(sim, id);
      const buttons = o.buttons.filter((b) => OBJECTIVE_RESERVED_BUTTONS.has(b) || (m.interactions.get(b)?.who === "guest" && live!.has(b)));
      out.push(objectiveView(sim, o, buttons, id, id));
    }
    return out;
  }
  const me = viewer.character;
  const def = m.characters.get(me);
  const faction = def?.faction != null ? foldName(def.faction) : null;
  for (const o of m.objectives.values()) {
    const a = o.audience;
    const sees = a.performers || a.characters.includes(me) || (faction !== null && a.groups.some((g) => foldName(g) === faction));
    if (!sees) continue;
    if (o.while !== null && !sim.holds(o.while, null, me)) continue;
    const buttons = o.buttons.filter((b) => {
      if (OBJECTIVE_RESERVED_BUTTONS.has(b)) return true;
      const i = m.interactions.get(b);
      return i !== undefined && i.who === "performer" && pressRefusal(sim, i, me, viewer.host === true) === null;
    });
    out.push({ ...objectiveView(sim, o, buttons, null, me), ...boothTarget(sim, o, me) });
  }
  return out;
}

/** A booth objective's `target:` and `pick:` (C5) for character `me`. */
function boothTarget(sim: Sim, o: ObjectiveDef, me: string): Pick<ObjectiveView, "target" | "pick"> {
  const out: Pick<ObjectiveView, "target" | "pick"> = {};
  if (o.target !== null) {
    const id = guestNamed(sim, display(sim.valueOf(o.target, null, me)));
    const p = id !== null ? sim.persons.get(id) : undefined;
    if (p !== undefined) out.target = { id: p.id, name: p.name, location: sim.locationOf(p.id) };
  }
  if (o.pick !== null) {
    const here = sim.locationOf(me);
    const rows: Array<{ id: string; name: string; here: boolean }> = [];
    for (const p of sim.persons.values()) {
      if (!sim.holds(o.pick, p.id, me)) continue;
      rows.push({ id: p.id, name: p.name, here: here !== null && sim.locationOf(p.id) === here });
    }
    rows.sort((a, b) => (a.here !== b.here ? (a.here ? -1 : 1) : a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
    out.pick = rows.slice(0, PICK_MAX).map((r) => r.id);
  }
  return out;
}

/** A guest by id, or by display name (folded) — what a `target:` value names. */
function guestNamed(sim: Sim, raw: string): string | null {
  const v = raw.replace(/^"(.*)"$/su, "$1").trim();
  if (v === "" || v === "null") return null;
  if (sim.persons.has(v)) return v;
  const f = foldName(v);
  for (const p of sim.persons.values()) if (foldName(p.name) === f) return p.id;
  return null;
}

function objectiveView(sim: Sim, o: ObjectiveDef, buttons: string[], subject: string | null, self: string): ObjectiveView {
  return {
    id: o.id,
    title: o.title,
    brief: o.brief,
    checklist: o.checklist.map((c) => ({ label: c.label, done: c.done === null ? null : sim.holds(c.done, subject, self) })),
    buttons,
    act: o.act,
    ...(o.loud ? { loud: true as const } : {}),
    ...(o.evergreen ? { evergreen: true as const } : {}),
  };
}

/** A per-snapshot-round memo on `sim.log`: the log's length and the story
 *  clock's whole second (every view built in one fanout shares it). */
interface RoundMemo<T> {
  len: number;
  sec: number;
  model: Sim["model"];
  value: T;
}
function roundKey(sim: Sim): { len: number; sec: number } {
  return { len: sim.log.len(), sec: Math.floor(sim.elapsed() / 1000) };
}
function memoRound<T>(memo: WeakMap<object, RoundMemo<T>>, sim: Sim, build: () => T): T {
  const k = roundKey(sim);
  const hit = memo.get(sim.log);
  if (hit !== undefined && hit.len === k.len && hit.sec === k.sec && hit.model === sim.model) return hit.value;
  const value = build();
  memo.set(sim.log, { ...k, model: sim.model, value });
  return value;
}

const nightMemo = new WeakMap<object, RoundMemo<NightView>>();

/** A world value as a display string with its quotes stripped, or null. */
function worldText(sim: Sim, path: string): string | null {
  const v = sim.world.get(path);
  if (v === undefined || v.kind === "null") return null;
  const t = display(v).replace(/^"(.*)"$/su, "$1").trim();
  return t === "" || t === "null" ? null : t;
}

/** Where the night is (`NightView`), the same for every viewer — memoised
 *  per snapshot round (72 admin cues' `while:` in the show). */
export function nightView(sim: Sim): NightView {
  return memoRound(nightMemo, sim, () => {
    let act: NightView["act"] = null;
    const admin = [...sim.model.interactions.values()].filter((i) => i.who === "admin");
    if (admin.some((i) => i.act !== null)) {
      const acts = cueActs(cueRows(interactionsFor(sim, ["admin"]), cueState(sim)));
      const focus = focusActIndex(acts);
      if (focus >= 0) act = { code: acts[focus]!.code, title: acts[focus]!.title };
    }
    const step = worldText(sim, "Night.step");
    const n = step === null ? NaN : Number(step);
    // Wave 26 (T2): the glitch, in story ms like `GuestView.clock`.
    const glitchAt = Number(worldText(sim, GLITCH_AT_PATH) ?? NaN);
    const glitchText = worldText(sim, GLITCH_TEXT_PATH);
    const light = worldText(sim, GLITCH_KIND_PATH) === "burst" ? { light: true as const } : {};
    const glitch = Number.isFinite(glitchAt) && glitchAt > 0 ? { glitch: { at: Math.round(glitchAt * 1000), text: glitchText === null || glitchText === "none" ? null : glitchText, ...light } } : {};
    // Wave 44 (C5): the credits' roll.
    const roll = Number(worldText(sim, CREDITS_ROLL_PATH) ?? NaN);
    const rollAt = Number(worldText(sim, CREDITS_AT_PATH) ?? NaN);
    const credits = Number.isFinite(roll) && roll > 0 ? { credits: { roll, at: Number.isFinite(rollAt) ? Math.round(rollAt * 1000) : 0 } } : {};
    // The phase reads the same as a message's moment stamp (`chat.ts` `storyPhase`).
    return { act, phase: storyPhase(sim) ?? null, step: Number.isFinite(n) ? n : null, ...glitch, ...credits };
  });
}

/** The interrupt level now: the story's `alerts:` path read off the world. */
export function alertLevelNow(sim: Sim): AlertLevel {
  const v = sim.world.get(sim.model.alerts);
  return alertLevelOf(v === undefined ? null : display(v));
}

/** Is a display value truthy for a flag (falsy = 0, "", null, "none", false)? */
function flagOn(v: Value | undefined): boolean {
  if (v === undefined) return false;
  switch (v.kind) {
    case "null":
      return false;
    case "bool":
      return v.value;
    case "number":
      return v.value !== 0;
    default: {
      const t = display(v).replace(/^"(.*)"$/su, "$1").trim().toLowerCase();
      return t !== "" && t !== "null" && t !== "none" && t !== "false" && t !== "0";
    }
  }
}

/** One ROLE `watch:` item, resolved once per model (`flagPlan`). */
interface FlagItem {
  /** Index of its board line (`resolvedBoard(model).watch`). */
  line: number;
  label: string;
  path: string;
  /** The path after its ROLE head (`marked`, `quest.the_cold_door`). */
  rest: string;
  /** The ROLE declares the slot `bool`. */
  boolSlot: boolean;
}

/** The ROLE `watch:` items per ROLE, with their lines' `while`s, once per
 *  model: the per-round work is then only the lines' `while`s and one world
 *  read per guest and item (load test, wave 13: the old per-guest folding
 *  cost 8 ms a round at 45 guests). */
interface FlagPlan {
  /** Each board line's `while` (null = always), by line index. */
  whiles: Array<string | null>;
  /** The lines that carry at least one ROLE item. */
  lines: number[];
  /** Items per ROLE (keyed folded), line order; a ROLE `secret:` slot never. */
  byRole: Map<string, FlagItem[]>;
  /** A person's `role` string → its folded key (a handful per night). */
  folded: Map<string, string>;
  /** A line's `while` reads the story clock (`Time.*`), which moves with
   *  no log entry: the round memo then keys on the story second too. */
  clock: boolean;
}

const flagPlans = new WeakMap<object, FlagPlan>();
const CLOCK_READ = /\bTime\s*\.|\b(?:since|elapsed|now)\s*\(/u;

function flagPlan(model: Sim["model"]): FlagPlan {
  let plan = flagPlans.get(model);
  if (plan !== undefined) return plan;
  const board = resolvedBoard(model);
  const roleIds = new Map([...model.roles.keys()].map((id) => [foldName(id), id]));
  const byRole = new Map<string, FlagItem[]>();
  const lines: number[] = [];
  let clock = false;
  board.watch.forEach((l, line) => {
    let any = false;
    for (const i of l.items) {
      if (i.scope !== "role" || i.path === null) continue;
      const dot = i.path.indexOf(".");
      const roleId = roleIds.get(foldName(i.path.slice(0, dot)));
      if (roleId === undefined) continue;
      const role = model.roles.get(roleId)!;
      const rest = i.path.slice(dot + 1);
      if (isSecretRoleSlot(role.secret, rest)) continue;
      const slot = rest.split(".")[0]!;
      const list = byRole.get(foldName(roleId)) ?? [];
      list.push({ line, label: i.label, path: i.path, rest, boolSlot: role.bools?.has(slot) === true });
      byRole.set(foldName(roleId), list);
      any = true;
    }
    if (any) {
      lines.push(line);
      if (l.while !== null && CLOCK_READ.test(l.while)) clock = true;
    }
  });
  plan = { whiles: board.watch.map((l) => l.while), lines, byRole, folded: new Map(), clock };
  flagPlans.set(model, plan);
  return plan;
}

/** Which of the plan's lines hold now. */
function liveFlagLines(sim: Sim, plan: FlagPlan): Set<number> {
  const live = new Set<number>();
  for (const line of plan.lines) if (boardLineLive(sim, plan.whiles[line]!)) live.add(line);
  return live;
}

/** One guest's flags off the plan: every boolean item (false included, so a
 *  card can say "Not cleared"), a non-boolean one only when truthy. */
function flagsOf(sim: Sim, plan: FlagPlan, live: ReadonlySet<number>, id: string, role: string): GuestFlag[] {
  let key = plan.folded.get(role);
  if (key === undefined) {
    key = foldName(role);
    plan.folded.set(role, key);
  }
  const items = plan.byRole.get(key);
  if (items === undefined) return [];
  const flags: GuestFlag[] = [];
  for (const i of items) {
    if (!live.has(i.line)) continue;
    const v = sim.world.get(`${id}.${i.rest}`);
    const shown = v === undefined || v.kind === "null" ? "null" : display(v).replace(/^"(.*)"$/su, "$1");
    const on = flagOn(v);
    const boolean = i.boolSlot || (v !== undefined && v.kind === "bool") || shown === "true" || shown === "false";
    if (!boolean && !on) continue;
    flags.push({ label: i.label, path: i.path, value: shown, on });
  }
  return flags;
}

/** The flags a snapshot carries (contract C3): the ones that are on, plus a
 *  failed gate ("Not cleared") — a false boolean that is not a gate is
 *  noise every booth would download every round. The guest card
 *  (`/api/prime/card`) keeps the full list. */
export function snapshotFlags(flags: readonly GuestFlag[]): GuestFlag[] {
  return flags.filter((f) => f.on || ((f.value === "true" || f.value === "false") && isGateFlag(f.label)));
}

interface FlagsRound {
  len: number;
  sec: number;
  model: Sim["model"];
  full: Map<string, GuestFlag[]>;
  lean: Map<string, GuestFlag[]> | null;
}
const flagsMemo = new WeakMap<object, FlagsRound>();

/** Every guest's ROLE-scoped `watch:` flags this round (`guestFlags`),
 *  memoised on the log's length (and the story second only when a line's
 *  `while` reads the clock). */
function flagsRound(sim: Sim): FlagsRound {
  const plan = flagPlan(sim.model);
  const len = sim.log.len();
  const sec = plan.clock ? Math.floor(sim.elapsed() / 1000) : 0;
  const hit = flagsMemo.get(sim.log);
  if (hit !== undefined && hit.len === len && hit.sec === sec && hit.model === sim.model) return hit;
  const full = new Map<string, GuestFlag[]>();
  if (plan.byRole.size > 0) {
    const live = liveFlagLines(sim, plan);
    if (live.size > 0) {
      for (const p of sim.persons.values()) {
        const flags = flagsOf(sim, plan, live, p.id, p.role);
        if (flags.length > 0) full.set(p.id, flags);
      }
    }
  }
  const round: FlagsRound = { len, sec, model: sim.model, full, lean: null };
  flagsMemo.set(sim.log, round);
  return round;
}

/** A guest's ROLE-scoped `watch:` items (`GuestFlag`), on lines whose
 *  `while` holds, a ROLE `secret:` slot never — memoised per round. */
export function guestFlags(sim: Sim, guestId: string): GuestFlag[] {
  return flagsRound(sim).full.get(guestId) ?? [];
}

/** Every guest's flags as a snapshot carries them (`snapshotFlags`), by id —
 *  memoised per round (the host view and every booth share it). */
export function allSnapshotFlags(sim: Sim): ReadonlyMap<string, GuestFlag[]> {
  const round = flagsRound(sim);
  if (round.lean === null) {
    const lean = new Map<string, GuestFlag[]>();
    for (const [id, flags] of round.full) {
      const kept = snapshotFlags(flags);
      if (kept.length > 0) lean.set(id, kept);
    }
    round.lean = lean;
  }
  return round.lean;
}

/** One guest's full flags read fresh, without building everyone's (a scan's
 *  card, right after its commit). */
export function guestFlagsNow(sim: Sim, guestId: string): GuestFlag[] {
  const hit = flagsMemo.get(sim.log);
  if (hit !== undefined && hit.len === sim.log.len() && hit.model === sim.model && !flagPlan(sim.model).clock) return hit.full.get(guestId) ?? [];
  const p = sim.persons.get(guestId);
  if (p === undefined) return [];
  const plan = flagPlan(sim.model);
  if (plan.byRole.size === 0) return [];
  const live = liveFlagLines(sim, plan);
  return live.size === 0 ? [] : flagsOf(sim, plan, live, p.id, p.role);
}

// --- award gates: an award only one program can take (G10 is MS Paint's) ---

/** A story gate on an admin cue's subject: the hook for the cue refuses
 *  (`if program.featured != "mspaint":` with a body that sets and fires
 *  nothing) unless the subject's `slot` reads `value`. */
interface SubjectGate {
  slot: string;
  value: string;
}
const subjectGates = new WeakMap<object, Map<string, SubjectGate[]>>();
const GATE_NE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_.]*)\s*!=\s*"([^"]*)"\s*$/u;

/** Does an arm's body only explain itself (no `set`, no `fire`, no nested
 *  logic)? Then the arm is a refusal. */
function refusalBody(body: readonly BodyItem[]): boolean {
  return body.length > 0 && body.every((b) => b.kind === "directive" && !/^\s*(?:set|fire|unlock|start|complete|move|add|remove|reveal|award)\b/u.test(b.value.raw));
}

/** Every admin cue's subject gates, once per model: the arms of the
 *  top-level `if` chains in the hooks the cue fires (`when <cue> for
 *  program:`, on a ROLE, a CHARACTER or the story) that refuse unless the
 *  subject has one exact value. */
function subjectGatesOf(model: Sim["model"]): Map<string, SubjectGate[]> {
  let out = subjectGates.get(model);
  if (out !== undefined) return out;
  out = new Map();
  const hooks = [...model.rules, ...[...model.roles.values()].flatMap((r) => r.hooks), ...[...model.characters.values()].flatMap((c) => c.hooks)];
  const byVerb = new Map<string, typeof hooks>();
  for (const h of hooks) {
    if (h.param === null || h.verb === "") continue;
    const k = foldName(h.verb);
    byVerb.set(k, [...(byVerb.get(k) ?? []), h]);
  }
  for (const i of model.interactions.values()) {
    if (i.who !== "admin") continue;
    const gates: SubjectGate[] = [];
    for (const h of byVerb.get(foldName(i.id)) ?? []) {
      for (const item of h.body) {
        if (item.kind !== "conditional") continue;
        for (const arm of item.value.arms) {
          const m = arm.condition === null ? null : GATE_NE.exec(arm.condition);
          if (m === null || foldName(m[1]!) !== foldName(h.param!) || !refusalBody(arm.body)) continue;
          gates.push({ slot: m[2]!, value: m[3]! });
        }
      }
    }
    if (gates.length > 0) out.set(i.id, gates);
  }
  subjectGates.set(model, out);
  return out;
}

const awardOnlyMemo = new WeakMap<object, RoundMemo<Record<string, { id: string; name: string }>>>();

/** The admin cues only one person can take right now (`HostView.awardOnly`):
 *  their story gate names a value exactly one guest holds — G10's
 *  `program.featured != "mspaint"` → MS Paint. Memoised per round. */
export function awardOnly(sim: Sim): Record<string, { id: string; name: string }> {
  return memoRound(awardOnlyMemo, sim, () => {
    const out: Record<string, { id: string; name: string }> = {};
    for (const [cue, gates] of subjectGatesOf(sim.model)) {
      const fits = [...sim.persons.values()].filter((p) =>
        gates.every((g) => {
          // A ROLE `secret:` slot names nobody: the host view never says
          // who holds a secret value (as its flags never show one).
          const role = sim.model.roles.get(p.role);
          if (role !== undefined && isSecretRoleSlot(role.secret, g.slot)) return false;
          const v = sim.world.get(`${p.id}.${g.slot}`);
          return v !== undefined && v.kind !== "null" && display(v).replace(/^"(.*)"$/su, "$1") === g.value;
        }),
      );
      if (fits.length === 1) out[cue] = { id: fits[0]!.id, name: fits[0]!.name };
    }
    return out;
  });
}

const guestScopedCache = new WeakMap<object, Set<string>>();

/** The performer INTERACTIONs whose `while:` reads the subject (a path
 *  headed by a subject name: `guest`, `person`, `subject`, a ROLE id or its
 *  alias), per model. Quoted strings are skipped. */
function guestScopedIds(model: Sim["model"]): Set<string> {
  let out = guestScopedCache.get(model);
  if (out !== undefined) return out;
  out = new Set<string>();
  const heads = new Set(["guest", "person", "subject", ...[...model.roles.keys()].flatMap((r) => [foldName(r), r.toLowerCase().replace(/\s+/gu, "_")])]);
  for (const i of model.interactions.values()) {
    if (i.who !== "performer" || i.while === null) continue;
    const bare = i.while.replace(/"(?:[^"\\]|\\.)*"/gu, '""');
    for (const m of bare.matchAll(/(?<![\w.])([A-Za-z_][A-Za-z0-9_]*)\./gu)) {
      if (heads.has(m[1]!.toLowerCase()) || heads.has(foldName(m[1]!))) {
        out.add(i.id);
        break;
      }
    }
  }
  guestScopedCache.set(model, out);
  return out;
}

/** A booth readout index over a chat timeline: the positions of every readout
 *  per `about|channel`, extended as the timeline grows (a scan's card read
 *  it with a walk over every message — 12 ms a scan late in the night). */
interface ReadoutIndex {
  upto: number;
  byKey: Map<string, number[]>;
}
const readoutIndexes = new WeakMap<readonly ChatMessage[], ReadoutIndex>();

/** The positions in `chat` of the last 5 visible readouts in `channel`
 *  about `guestId`, oldest first (hiding is live, so it is read here). */
function readoutSeqs(chat: readonly ChatMessage[], guestId: string, channel: string): number[] {
  let ix = readoutIndexes.get(chat);
  if (ix === undefined || ix.upto > chat.length) {
    ix = { upto: 0, byKey: new Map() };
    readoutIndexes.set(chat, ix);
  }
  for (; ix.upto < chat.length; ix.upto++) {
    const m = chat[ix.upto]!;
    if (m.readout !== true || typeof m.about !== "string") continue;
    const key = `${m.about}|${m.channel}`;
    const list = ix.byKey.get(key);
    if (list === undefined) ix.byKey.set(key, [ix.upto]);
    else list.push(ix.upto);
  }
  const all = ix.byKey.get(`${guestId}|${channel}`) ?? [];
  // Keep the newest 5 visible: walk back past hidden ones.
  const out: number[] = [];
  for (let k = all.length - 1; k >= 0 && out.length < 5; k--) if (chat[all[k]!]?.hidden !== true) out.push(all[k]!);
  return out.reverse();
}

/** What `character`'s booth may do to one guest right now — the scan card.
 *  Null for an unknown guest. */
export function guestCardView(sim: Sim, chat: readonly ChatMessage[], character: string, guestId: string, host: boolean): GuestCardView | null {
  const p = sim.persons.get(guestId);
  if (p === undefined) return null;
  const scoped = guestScopedIds(sim.model);
  const live: string[] = [];
  for (const i of sim.model.interactions.values()) {
    if (i.who !== "performer") continue;
    if (pressRefusal(sim, i, character, host) !== null) continue;
    if (i.while !== null && !sim.holds(i.while, guestId, character)) continue;
    live.push(i.id);
  }
  const readouts: GuestCardView["readouts"] = [];
  for (const at of readoutSeqs(chat, guestId, `dm:${character}`)) {
    const m = chat[at];
    if (m !== undefined && !m.hidden) readouts.push({ seq: m.seq, text: m.text, ts: m.ts });
  }
  return {
    guest: primeGuest(sim, p.id, p.name, guestFlagsNow(sim, p.id)),
    live,
    guestScoped: live.filter((id) => scoped.has(id)),
    readouts,
  };
}

/** A press that sends the guest to the Internet (play's `CAPTURE`,
 *  `booth/model.ts`, which puts the same button on the card's face). */
const CAPTURE = /(\bsend(?:s)?\b[^:]*\bto the internet|\bcaptur)/iu;

/**
 * Wave 57 (C15): this booth's own capture, as a line in the filter offers
 * it: its `by:` names the character, and its `while:` is read with the guest
 * bound, so it is live on exactly the programs the guest card offers it on.
 */
export function captureFor(sim: Sim, character: string): (guest: string) => { id: string; label: string } | null {
  const me = foldName(character);
  const actors = interactionActors(sim);
  const def = [...sim.model.interactions.values()].find((i) => i.who === "performer" && CAPTURE.test(i.label) && actors.get(i.id)?.some((a) => foldName(a) === me) === true);
  if (def === undefined) return () => null;
  return (guest) => (sim.persons.has(guest) && (def.while === null || sim.holds(def.while, guest, character)) ? { id: def.id, label: def.label } : null);
}

/** The authored channel ids of the story's staff rooms (`staffRoomIds`), model order. */
export function staffRoomChannels(model: Sim["model"]): string[] {
  const staff = staffRoomIds(model);
  return [...model.channels.keys()].filter((id) => staff.has(roomFold(id)));
}

/** Characters whose `dm:` thread somebody reads (`GuestView.voiced`): the
 *  performer parts and the agent-voiced characters, model order. A
 *  `hidden: true` character stays off the list until the story reveals it
 *  to this guest (the directory's rule), so a hidden Trabolta's name is not
 *  in a phone's snapshot from the door. */
function voicedOf(sim: Sim, guestId: string): string[] {
  const parts = partsOf(sim.model);
  return [...sim.model.characters.values()]
    .filter((c) => (parts.has(c.id) || c.mind === "external") && (!c.hidden || sim.isRevealedTo(c.id, guestId)))
    .map((c) => c.id);
}

/** One booth row for a guest (`PrimeGuest`), flags included when any —
 *  a snapshot's lean list (`snapshotFlags`) unless `flags` is given (the
 *  card's full one). */
function primeGuest(sim: Sim, id: string, name: string, flags: readonly GuestFlag[] = allSnapshotFlags(sim).get(id) ?? []): PrimeGuest {
  return {
    id,
    name,
    faction: sim.publicFactionOf(id),
    captured: sim.isCaptured(id),
    restricted: sim.isRestricted(id),
    location: sim.locationOf(id),
    ...(flags.length > 0 ? { flags: [...flags] } : {}),
    ...badgesField(sim, id),
  };
}

/** `{ badges }` when `id` wears any (`badge:` lines), else nothing (w18b). */
function badgesField(sim: Sim, id: string): { badges?: NameBadge[] } {
  if (sim.model.badges.length === 0) return {};
  const badges = badgesOf(sim, id);
  return badges.length > 0 ? { badges } : {};
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
  /** ROLE-scoped `watch:` items for this guest (`GuestFlag` rule, secret slots dropped), on lines whose `while` holds. Absent when none. */
  flags?: GuestFlag[];
  /** When the server last heard from this guest (the mod roster's
   *  `lastSeen`, A1) — runtime-filled; null = not since the server started. */
  lastSeen?: number | null;
  /** Wave 18b: the header `badge:` lines true for them. Absent when none. */
  badges?: NameBadge[];
}

/** What an actor playing a character sees: their part + scannable guests. */
export interface PrimeView {
  character: string;
  title: string;
  theme: string;
  /** Wave 32 (C5): a host booth's talk panel (the same block as
   *  `HostView.talk`), runtime-filled on a host booth only (never a player's
   *  or a plain performer's); null when no talk scene is on; absent from an
   *  older server. */
  talk?: TalkView | null;
  /** Wave 48 (C2): the censor's flagged guest lines — only on the booth of
   *  the header's `censor:` part, runtime-filled; absent elsewhere and from
   *  an old server. */
  filter?: FilterView;
  /** Wave 41 (C3): this part's inbox for Trabolta's letter (`email` on
   *  file or null) and the From line it would come from (null: mail is off).
   *  Wave 53: `asked` = the part answered the upload's inbox card, so the
   *  booth's own ask stays away. Absent from an old server and from the bare
   *  sim projection. */
  letter?: { email: string | null; from: string | null; asked?: true };
  /** The story clock (ms, `Sim.elapsed()`) when this view was built — the
   *  "now" a client measures a message's `ts` against (e.g. only banner an
   *  alert it missed if it is under 10 minutes old). */
  clock?: number;
  /** The show clock (wave 13 K2: `Clock.set_to` / `Clock.set_at`, see
   *  `src/show-clock.ts`), runtime-filled; absent when the story set none. */
  showClock?: ShowClock;
  /** Wave 53 (C1): the story's `arrival:` header holds for this part: the
   *  booth reports `POST /api/prime/arrive`. Absent otherwise. */
  arrive?: true;
  /** Wave 53 (C2): the part stands in a `cutscene: true` location: the booth
   *  goes on rails, like a guest's `cutscene`. Absent otherwise. */
  cutscene?: true;
  /** Wave 53 (C2): on rails, where it stands, and the menus waiting on it
   *  (oldest first; `POST /api/prime/choose`). Absent off rails. */
  location?: string;
  choices?: Array<{ id: number; beat: string; options: string[] }>;
  faction: string | null;
  guests: PrimeGuest[];
  /** Every authored channel — performers run every room. */
  channels: ChannelSnapshot[];
  spaces: SpaceSnapshot[];
  /** `who: performer` INTERACTIONs only — never `who: admin`, for any booth
   *  (wave 13: the cue sheet is the host view's). */
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
  /** Live OBJECTIVEs for this character (its name, its GROUP, `performers`, `everyone`), model order. Always filled. */
  objectives?: ObjectiveView[];
  /** Where the night is. Always filled. */
  night?: NightView;
  /** The interrupt level now. Always filled. */
  alertLevel?: AlertLevel;
  /** Every live countdown (`liveCountdowns(sim)`, secret heads dropped) — booths are staff. Absent when none. */
  countdowns?: CountdownSummary[];
  /** Staff-room **channel ids** as authored (`staffRoomChannels(model)`, e.g.
   *  `room:hosts`) — what a client matches `m.channel` against. (The
   *  existing `staffRoomIds` returns *folded names*, `"hosts"`, for scope
   *  matching; it stays as is.) Always filled ([] when none). */
  staffRooms?: string[];
  /** The story clock is stopped (the event is paused, or its doors have not
   *  opened): `clock` holds still, so the booth's countdowns must not tick
   *  on — `GuestView.paused`'s rule. Set by the runtime; absent while the
   *  clock runs (and from a local sim). */
  paused?: true;
  /** The booth holds the host capability (its part is `admin: true`, or the
   *  sign-in holds the moderator passcode): it keeps another character's
   *  `by:` buttons on its objectives and may press them. The event server
   *  always says so (`false` too, C4: a reload that takes `admin: true` away
   *  reaches an open booth); a local sim's view leaves it out when false. */
  host?: boolean;
  /** Wave 18 (C4): this booth's live **global** buttons (`who: performer`,
   *  pressed with no guest — some listener binds no subject), the ones
   *  `/api/prime/act {name}` takes without a `guest`. Absent when none. */
  globalButtons?: string[];
  /** Wave 18 (C6): the Wanted board — every guest the header's `wanted:`
   *  flag marks, for a booth the line names (and hosts). Runtime-filled. */
  wanted?: WantedRow[];
  /** Wave 18 (C8): the admin cues this booth may call (`by:` on a `who:
   *  admin` INTERACTION names it) and the sheet's NEXT / LAST / act, read
   *  only. Absent for a booth that calls nothing. `caller` is runtime-filled. */
  calls?: PrimeCalls;
  /** Wave 21 (D1): the part is `player: true` — it plays the night's game
   *  like a guest (its own buttons only, guest countdowns, no act, its own
   *  team's staff rooms, never a caller). Always set. */
  player: boolean;
  /** Wave 21 (C4): the NOW objective (the first live one) and its `go:`
   *  room's title (a LOCATION or an authored room), else null — the booth
   *  twin of `GuestView.mission`. Absent when no objective is live. */
  mission?: BoothMission;
  /** Wave 21 (C3): the header `stat:` lines for this booth (its `for`
   *  matches, its `while` holds), header order. Absent when none. */
  stats?: StatView[];
}

/** `PrimeView.mission` (wave 21, C4). */
export interface BoothMission {
  objective: string;
  place: string | null;
}

/** One poster on the Wanted board (C6). */
export interface WantedRow {
  id: string;
  name: string;
  avatar?: string;
  /** The `wanted:` line's `as` value (why), or null. */
  reason: string | null;
  location: string | null;
  /** When the server last heard from them (wall ms), null = not since it started. */
  lastSeen: number | null;
  /** Story ms the flag turned true. */
  markedAt: number;
  /** The `by` value (who claimed the escort: a character name), or null. */
  claimedBy: string | null;
  /** Captured: the poster stays 60 s, then drops. */
  captured: boolean;
}

/** `PrimeView.calls` (C8). */
export interface PrimeCalls {
  /** Only this booth's cues, in running order, with their descriptions. */
  rows: CueRow[];
  /** The whole sheet's NEXT / LAST (INTERACTION ids), read only. */
  next: string | null;
  /** NEXT's title (its label without the code), for a booth whose own
   *  rows don't hold it (BN-F11: Clippy's bar showed raw ids). */
  nextTitle?: string | null;
  last: string | null;
  lastName: string | null;
  /** The focus act as written, or null. */
  act: string | null;
  /** `CueState.presses` — what a `POST /api/prime/cue` arms against. */
  presses: number;
  caller: CueCaller | null;
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

/** `opts.host`: the booth holds the host (or moderator) capability — it
 *  keeps another character's `by:` buttons on its objectives, except one
 *  only its actors' own hooks hear (`pressRefusal`). */
export function primeView(sim: Sim | null, character: string, agentsOnline?: ReadonlySet<string>, opts?: { host?: boolean }): PrimeView {
  if (sim === null) {
    return {
      character,
      title: "Loom",
      theme: "plain",
      faction: null,
      guests: [],
      channels: [],
      spaces: [],
      interactions: [],
      legacyCapture: false,
      codex: [],
      codexTotal: 0,
      quests: [],
      questTotal: 0,
      agents: [],
      objectives: [],
      night: { act: null, phase: null, step: null },
      alertLevel: "sticky",
      staffRooms: [],
      player: false,
    };
  }
  const c = sim.model.characters.get(character);
  const player = c?.player === true;
  const host = opts?.host === true;
  const guests: PrimeGuest[] = [...sim.persons.values()].map((p) => primeGuest(sim, p.id, p.name));
  // Wave 21 (C4, D7): a player gets only the countdowns guests are told about.
  const countdowns = player ? liveCountdowns(sim, (l) => l.guests) : liveCountdowns(sim);
  const hidden = playerHiddenRooms(sim.model, character);
  const objectives = objectivesFor(sim, { character, host });
  const stats = statsFor(sim, character);
  let interactions = interactionsFor(sim, ["performer"], { subject: null, self: character });
  if (player) {
    // The booth only learns its own buttons: another character's `by:`
    // button (which `pressRefusal` would refuse) is left out.
    interactions = interactions.filter((i) => {
      const def = sim.model.interactions.get(i.id);
      return def === undefined || pressRefusal(sim, def, character, host) === null;
    });
  }
  return {
    character,
    title: sim.lobbyTitle(),
    theme: sim.model.theme ?? "plain",
    clock: sim.elapsed(),
    faction: c?.faction ?? null,
    guests,
    channels: boothChannels(sim, character),
    spaces: sim.spaceList(),
    interactions,
    legacyCapture: [...sim.model.locations.values()].some((l) => l.prison),
    codex: sim.codexFor(character).map((e) => codexEntry(e, sim.model)),
    codexTotal: sim.model.codex.size,
    quests: sim.questsFor(character).map(({ def, status }) => ({ id: def.id, title: def.title, giver: def.giver, status })),
    questTotal: sim.model.quests.size,
    agents: agentContacts(sim, character, agentsOnline),
    objectives,
    // A player gets no act (D7): the act's title is the director's copy.
    night: player ? { ...nightView(sim), act: null } : nightView(sim),
    alertLevel: alertLevelNow(sim),
    ...(countdowns.length > 0 ? { countdowns } : {}),
    staffRooms: staffRoomChannels(sim.model).filter((id) => !hidden.has(id)),
    ...(host ? { host: true as const } : {}),
    ...boothGlobals(sim, character, host),
    ...boothCalls(sim, character),
    player,
    ...boothMission(sim, objectives),
    ...(stats.length > 0 ? { stats } : {}),
    ...boothRails(sim, character),
  };
}

/** Wave 53 (C1): does the story's `arrival:` header hold for this part? */
export function arrivalDue(sim: Sim, character: string): boolean {
  const cond = sim.model.arrival;
  return cond !== null && sim.holds(cond, character, character);
}

/** Wave 53 (C2): a part on rails, `GuestView.cutscene`'s twin. */
function boothRails(sim: Sim, character: string): Pick<PrimeView, "arrive" | "cutscene" | "location" | "choices"> {
  const arrive = arrivalDue(sim, character) ? { arrive: true as const } : {};
  const location = sim.locationOf(character);
  if (location === null || !sim.cutsceneFor(character)) return arrive;
  const choices = sim.pendingChoicesFor(character);
  return { ...arrive, cutscene: true, location, ...(choices.length > 0 ? { choices } : {}) };
}

/** `PrimeView.mission` (wave 21, C4): the first live objective and its
 *  `go:` room's title — a LOCATION or an authored room; any other `go:`
 *  (a screen, a codex entry) reads null. */
function boothMission(sim: Sim, objectives: readonly ObjectiveView[]): Pick<PrimeView, "mission"> {
  const now = objectives[0];
  if (now === undefined) return {};
  const def = sim.model.objectives.get(now.id);
  const t = def?.go != null ? resolveGoWord(sim.model, def.go) : null;
  let place: string | null = null;
  if (t !== null && t.kind === "room") {
    const title = sim.channelHead(t.id).title;
    place = title.replace(/\s*\([^()]*\)$/u, "").trim() || title;
  }
  return { mission: { objective: now.id, place } };
}

const hiddenRoomsCache = new WeakMap<Sim["model"], Map<string, ReadonlySet<string>>>();
const NO_ROOMS: ReadonlySet<string> = new Set();

/** Wave 21 (D6): the staff-room channel ids a **player** booth does not
 *  see — every staff room (`staffRoomChannels`) whose GROUP the character
 *  is not in. Empty for any other booth (a host, a plain performer). Per
 *  model and character. */
export function playerHiddenRooms(model: Sim["model"], character: string): ReadonlySet<string> {
  const c = model.characters.get(character);
  if (c === undefined || !c.player) return NO_ROOMS;
  let byChar = hiddenRoomsCache.get(model);
  if (byChar === undefined) {
    byChar = new Map();
    hiddenRoomsCache.set(model, byChar);
  }
  const hit = byChar.get(c.id);
  if (hit !== undefined) return hit;
  const mine = c.faction === null ? null : foldName(c.faction);
  const out = new Set<string>();
  for (const id of staffRoomChannels(model)) {
    const group = model.channels.get(id)?.faction ?? null;
    if (mine === null || group === null || foldName(group) !== mine) out.add(id);
  }
  byChar.set(c.id, out);
  return out;
}

/** The rooms a booth runs (`Sim.allChannelsFor`), minus a player's hidden
 *  staff rooms (D6) — also what `/api/prime/say` lets it post into. */
export function boothChannels(sim: Sim, character: string): ChannelSnapshot[] {
  const all = sim.allChannelsFor(character);
  const hidden = playerHiddenRooms(sim.model, character);
  return hidden.size === 0 ? all : all.filter((ch) => !hidden.has(ch.id));
}

/** `PrimeView.globalButtons` (C4): `who: performer` buttons this booth may
 *  press with no guest — some listener binds no subject, `by:` lets the
 *  booth press it, and its `while:` holds with `self` = the character. */
function boothGlobals(sim: Sim, character: string, host: boolean): Pick<PrimeView, "globalButtons"> {
  const subjectOnly = subjectOnlyEvents(sim);
  const ids: string[] = [];
  for (const i of sim.model.interactions.values()) {
    if (i.who !== "performer" || subjectOnly.has(foldName(i.id))) continue;
    if (pressRefusal(sim, i, character, host) !== null) continue;
    if (i.while !== null && !sim.holds(i.while, null, character)) continue;
    ids.push(i.id);
  }
  return ids.length > 0 ? { globalButtons: ids } : {};
}

const callersCache = new WeakMap<Sim["model"], Map<string, string[]>>();

/** The characters each admin cue's `by:` names (C8: those booths may also
 *  call it): a CHARACTER, or a GROUP's members. Admin cues with no `by:`
 *  are missing. Per model. */
export function cueCallers(model: Sim["model"]): Map<string, string[]> {
  const hit = callersCache.get(model);
  if (hit !== undefined) return hit;
  const out = new Map<string, string[]>();
  const chars = [...model.characters.values()];
  for (const i of model.interactions.values()) {
    if (i.who !== "admin" || i.by.length === 0) continue;
    const ids = new Set<string>();
    for (const name of i.by) {
      const k = foldName(name);
      const one = chars.find((c) => foldName(c.id) === k);
      if (one !== undefined) ids.add(one.id);
      else for (const c of chars) if (c.faction !== null && foldName(c.faction) === k) ids.add(c.id);
    }
    // Wave 21 (D5): a player never calls cues (lint L1222 says so).
    for (const id of [...ids]) if (model.characters.get(id)?.player === true) ids.delete(id);
    if (ids.size > 0) out.set(i.id, [...ids]);
  }
  callersCache.set(model, out);
  return out;
}

/** May `character`'s booth call admin cue `id` (C8)? */
export function callsCue(model: Sim["model"], character: string | null, id: string): boolean {
  if (character === null) return false;
  const k = foldName(character);
  return (cueCallers(model).get(id) ?? []).some((c) => foldName(c) === k);
}

/** Does any admin cue's `by:` name `character` (the booth is a caller)? */
export function isCaller(model: Sim["model"], character: string | null): boolean {
  if (character === null) return false;
  const k = foldName(character);
  for (const ids of cueCallers(model).values()) if (ids.some((c) => foldName(c) === k)) return true;
  return false;
}

/** `PrimeView.calls` (C8) for a caller booth; nothing for any other. */
function boothCalls(sim: Sim, character: string): Pick<PrimeView, "calls"> {
  if (!isCaller(sim.model, character)) return {};
  const cues = cueState(sim);
  const rows = cueRows(interactionsFor(sim, ["admin"]), cues);
  const acts = cueActs(rows);
  const focus = acts[focusActIndex(acts)];
  return {
    calls: {
      rows: rows.filter((r) => callsCue(sim.model, character, r.id)),
      next: rows.find((r) => r.next)?.id ?? null,
      nextTitle: rows.find((r) => r.next)?.title ?? null,
      last: cues.last,
      lastName: cues.lastName ?? null,
      act: focus?.rows[0]?.act ?? null,
      presses: cues.presses,
      caller: null,
    },
  };
}
