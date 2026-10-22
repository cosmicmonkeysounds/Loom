//! Wave 18 (C10) — guest-founded **crews** and **recruiting**.
//!
//! The story's declared sides (`GROUP … joinable`) stay exactly what they
//! were: one switching `join` per guest, and the majority counts only them.
//! A **crew** is a second, additive layer on top: a guest founds one (a
//! moderated name), invites people by scanning their pass, and gets a
//! members-only room (`crew:<id>`). A crew is never a side: it never
//! touches `Sim.membership`, `who.faction` / `who.group` / `who.groups` or
//! any `<Side>.members`, so nothing a crew does can move a majority.
//!
//! **Recruiting** is an invitation the target answers. A crew invitation's
//! yes joins the crew; a side invitation's yes runs the sim's own switching
//! `join` (or `defect` from the other side) — the server checks the same
//! doors / restricted / `guestSide` rules as `/api/guest/join` before it
//! journals the answer.
//!
//! Everything changes through one journaled op (`Mutation` `crew`, one
//! `CrewOp` argument), applied by `Sim.crew(op)` → `Crews.apply`, so a
//! replay of the journal rebuilds every crew, member and invitation. Ids are
//! namespaced and counted (`crew-<n>`, `inv-<n>`): a typed name can never
//! become a world path head (`Night`, `Kernel`, a person, a group).
//!
//! World mirror (for a story that wants it): `crew-<n>.name`,
//! `crew-<n>.founder`, `crew-<n>.members` (a collection of ids) and
//! `<person>.crew` (the crew id, null when none). Every `crew-*` path and
//! `<person>.crew` are masked from agent requests (`event-runtime.ts`).
//!
//! Story events (all `Sim.signal`, so `when founded for program:` reads
//! them): `founded` (subject = the founder, args `crew`), `join` (subject =
//! a new crew member, args `crew` — a declared side's `when who joins
//! Unlimited Power:` never hears it, its filter doesn't match), `recruited`
//! (subject = the recruit, args `side` or `crew`, and `by` = the recruiter,
//! bound as a person) and `unaligned` (subject left their side, args `side`).

import type { Sim, ChannelView } from "./sim.ts";
import type { SimEvent } from "./event.ts";
import { DEFAULT_SPACE_ID } from "./model.ts";
import { VNULL, evaluate, parseExprCached, truthy, vList, vNumber, vString, type CallArg, type Value } from "../expr.ts";
import { foldName } from "../../parser/names.ts";

/** At most this many live crews in one event. */
export const MAX_CREWS = 8;
/** A crew name's length bounds (code points, after cleaning). */
export const CREW_NAME_MIN = 2;
export const CREW_NAME_MAX = 24;
/** At most this many open invitations waiting on one guest. */
export const MAX_OPEN_INVITES_TO = 6;
/** Every crew id starts with this (`crew-1`). */
export const CREW_ID_PREFIX = "crew-";
/** A crew room's channel id is `crew:<crew id>`. */
export const CREW_ROOM_PREFIX = "crew:";

export interface Crew {
  id: string;
  name: string;
  /** The founder's guest id. */
  founder: string;
  /** Member ids in join order (the founder first). */
  members: string[];
  /** Story time (ms) it was founded. */
  at: number;
}

export type InviteKind = "crew" | "side";
export type InviteState = "open" | "yes" | "no" | "void";

export interface CrewInvite {
  id: string;
  kind: InviteKind;
  /** The inviter's guest id. */
  from: string;
  /** The invitee's guest id. */
  to: string;
  /** A crew id (`kind: "crew"`) or a declared side id (`kind: "side"`). */
  target: string;
  /** Story time (ms) it was sent. */
  at: number;
  state: InviteState;
}

/** The journaled ops — the contract's mutation names, one `crew` journal
 *  line each. */
export type CrewOp =
  | { op: "foundCrew"; by: string; name: string }
  | { op: "crewInvite"; by: string; to: string; crew: string }
  | { op: "crewAnswer"; id: string; yes: boolean }
  | { op: "leaveCrew"; person: string; crew: string }
  | { op: "recruit"; by: string; to: string; side: string }
  | { op: "recruitAnswer"; id: string; yes: boolean }
  | { op: "leaveSide"; person: string }
  | { op: "renameCrew"; crew: string; name: string }
  | { op: "dissolveCrew"; crew: string }
  /** Wave 18b: a walk-in join from the Factions list (no invitation). */
  | { op: "joinCrew"; person: string; crew: string };

export const CREW_OPS: readonly CrewOp["op"][] = [
  "foundCrew",
  "crewInvite",
  "crewAnswer",
  "leaveCrew",
  "recruit",
  "recruitAnswer",
  "leaveSide",
  "renameCrew",
  "dissolveCrew",
  "joinCrew",
];

/** What one applied op changed that the chat should say (the server turns
 *  these into messages: the invite card, a crew room's system lines). */
export type CrewNotice =
  | { kind: "invite"; invite: CrewInvite }
  | { kind: "founded"; crew: Crew }
  | { kind: "joined"; crew: Crew; person: string }
  | { kind: "left"; crew: Crew; person: string }
  | { kind: "renamed"; crew: Crew; from: string }
  | { kind: "dissolved"; crew: Crew; members: string[] }
  | { kind: "answered"; invite: CrewInvite };

/** A crew as a view shows it. */
export interface CrewView {
  id: string;
  name: string;
  /** The founder's guest id. */
  founder: string;
  founderName: string;
  /** Member guest ids in join order. */
  members: string[];
  memberNames: string[];
  /** The crew's room (`crew:<id>`). */
  room: string;
}

/** An open invitation as the invitee's view shows it. */
export interface InviteView {
  id: string;
  from: string;
  fromName: string;
  kind: InviteKind;
  target: string;
  targetName: string;
}

/** What a race faction is (wave 18b): a declared side, or a crew a
 *  program founded tonight. */
export type FactionKind = "side" | "founded";

/** One declared, joinable, revealed side (the Sides screen) — and, in
 *  **faction mode** (wave 18b, header `founding:`), every live founded
 *  faction too. */
export interface SideView {
  id: string;
  name: string;
  /** The leader's display name (the world's `<Side>.leader`; a founded
   *  faction's founder), else null. */
  leader: string | null;
  /** Members present tonight (a gone guest and a Run persona never count,
   *  as the majority doesn't). Every row outside faction mode; in faction
   *  mode **only on the viewer's own row** (`mine`): nobody counts a rival. */
  members?: number;
  /** The header `majority:` threshold, when the story declares one (in
   *  faction mode only on the viewer's own row). */
  needs?: number;
  /** Faction mode, the viewer's own row, with a threshold: how many more
   *  present members it needs to win (`max(0, needs − members)`). */
  more?: number;
  /** The viewer is on this side. */
  mine: boolean;
  /** Faction mode only: a declared side or a founded faction. */
  kind?: FactionKind;
  /** Faction mode only: a declared side's `ethos:`, when it has one. */
  ethos?: string;
  /** Faction mode only: who founded it (a founded faction's founder, a
   *  side's leader), by display name, when there is one. */
  founder?: string;
}

/** The C10 fields of a `GuestView`. */
export interface CrewGuestFields {
  crew: CrewView | null;
  invites: InviteView[];
  sides: SideView[];
  /** Faction mode only (wave 18b): may this guest found a faction now
   *  (`mayFound`)? A boolean, never the reason. */
  canFound?: boolean;
  /** Faction mode only: the race side this guest leads (its name), listed
   *  or still hidden — a hidden side is no row, so without this its leader
   *  reads unaligned and is offered Joins that answer 409. Absent when none. */
  leads?: string;
}

/** One race faction as a director sees it (`ModView.race`). */
export interface RaceFaction {
  id: string;
  name: string;
  kind: FactionKind;
  /** The founder's (a side's leader's) display name, else null. */
  founder: string | null;
  /** Its members present tonight. */
  present: number;
}

/**
 * The race as a director sees it (`ModView.race`, wave 18b, faction mode):
 * the threshold, the programs present, every race faction's head count and
 * `winner` — the faction over the line **now**. That is not the story's
 * latch: founding opens at the Truther Download, so a faction can be over
 * the line before the story starts counting (the show counts only in the
 * Y2K hour), and the story decides when it wins.
 */
export interface RaceView {
  /** The header `majority:` value now, or null when there is none. */
  needs: number | null;
  /** Programs present (not gone, not a Run persona). */
  present: number;
  winner: string | null;
  factions: RaceFaction[];
}

/** One crew as a director sees it (`ModView.crews`). */
export interface CrewSummary extends CrewView {
  at: number;
}

/** Does this id name a crew (`crew-<n>`)? */
export function isCrewId(id: string): boolean {
  return id.startsWith(CREW_ID_PREFIX);
}

/** The room of a crew. */
export function crewRoom(crew: string): string {
  return `${CREW_ROOM_PREFIX}${crew}`;
}

/** Is this channel a crew room? */
export function isCrewRoom(channel: string): boolean {
  return channel.startsWith(CREW_ROOM_PREFIX);
}

/** A crew name as stored: whitespace collapsed, trimmed. (The server's
 *  moderation cleans and refuses before it journals; this keeps a replay
 *  honest.) */
export function tidyCrewName(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/** Can a sim's guest pick this group as a side right now? (`routes/sides.ts`
 *  `guestMayJoin`, repeated here so the sim layer needs no server import.) */
function sideOpen(sim: Sim, id: string): boolean {
  const def = sim.model.factions.get(id);
  return def !== undefined && def.joinable && (!def.hidden || sim.factionRevealed(def.id));
}

/** The sim internals a crew op needs that `Sim` keeps private. */
export interface CrewSimHooks {
  /** Take `person` off `group` (the primary moves to the next membership). */
  removeFromGroup(person: string, group: string): void;
  /** Run pending hooks and watchers to a fixpoint (faction mode: a leave or
   *  a disband raises no signal, but it can move a majority). */
  drain(): void;
}

/**
 * The crews of one sim. Owned by the `Sim` (`sim.crews`) so it lives and
 * dies — and replays — with it.
 */
export class Crews {
  private readonly byId = new Map<string, Crew>();
  private readonly invites = new Map<string, CrewInvite>();
  private crewSeq = 0;
  private inviteSeq = 0;
  private notices: CrewNotice[] = [];
  /** The header `majority: <expr>` (the side's threshold), or null. */
  majority: string | null = null;
  /** The header `founding: <cond>` (wave 18b), or null: set = faction mode. */
  founding: string | null = null;

  private readonly sim: Sim;
  private readonly hooks: CrewSimHooks;

  // Plain fields, no parameter properties: the editor's typecheck reads this
  // file (play's wire types import its views) under `erasableSyntaxOnly`.
  constructor(sim: Sim, hooks: CrewSimHooks) {
    this.sim = sim;
    this.hooks = hooks;
  }

  /** Read the story header's `majority:` line (first file that has one). */
  configure(headers: Iterable<{ lines?: Array<{ key: string; value: string }> }>): void {
    for (const h of headers) {
      for (const line of h.lines ?? []) {
        if (line.key === "majority" && line.value.trim() !== "" && this.majority === null) this.majority = line.value.trim();
        if (line.key === "founding" && line.value.trim() !== "" && this.founding === null) this.founding = line.value.trim();
      }
    }
  }

  // -- reads ---------------------------------------------------------------

  all(): Crew[] {
    return [...this.byId.values()];
  }

  get(id: string): Crew | null {
    return this.byId.get(id) ?? null;
  }

  /** The crew a person is in, or null (a guest is in at most one). */
  crewOf(person: string): Crew | null {
    for (const c of this.byId.values()) if (c.members.includes(person)) return c;
    return null;
  }

  /** The live crew this guest founded and is still in, or null (a founder
   *  who left a crew that lives on may found another). */
  foundedBy(person: string): Crew | null {
    for (const c of this.byId.values()) if (c.founder === person && c.members.includes(person)) return c;
    return null;
  }

  /** A live crew whose name folds to this one, or null. */
  named(name: string): Crew | null {
    const want = foldName(tidyCrewName(name));
    for (const c of this.byId.values()) if (foldName(c.name) === want) return c;
    return null;
  }

  invite(id: string): CrewInvite | null {
    return this.invites.get(id) ?? null;
  }

  /** Open invitations waiting on `person`, oldest first. */
  openInvitesTo(person: string): CrewInvite[] {
    return [...this.invites.values()].filter((i) => i.state === "open" && i.to === person);
  }

  /** The open invitation from `by` to `to` for `target`, if one waits. */
  openInvite(by: string, to: string, kind: InviteKind, target: string): CrewInvite | null {
    for (const i of this.invites.values()) if (i.state === "open" && i.from === by && i.to === to && i.kind === kind && i.target === target) return i;
    return null;
  }

  /** Every invitation (the server's answered-card rebuild reads it). */
  allInvites(): CrewInvite[] {
    return [...this.invites.values()];
  }

  /** The side `person` is on (their primary group), when it is a side a
   *  guest may pick (declared, joinable, revealed); else null. */
  sideOf(person: string): string | null {
    const f = this.sim.factionOf(person);
    return f !== null && sideOpen(this.sim, f) ? f : null;
  }

  /** The display name of a side's leader (`<Side>.leader`: a person id →
   *  their name, any other string as written), else null. */
  leaderOf(side: string): string | null {
    const v = this.sim.world.peek(`${side}.leader`);
    if (v === null || v.kind !== "string" || v.value.trim() === "") return null;
    return this.sim.persons.get(v.value)?.name ?? v.value;
  }

  /** Is `person` the leader of `side`? (by id or by display name) */
  leads(person: string, side: string): boolean {
    const v = this.sim.world.peek(`${side}.leader`);
    if (v === null || v.kind !== "string") return false;
    const name = this.sim.persons.get(person)?.name;
    return v.value === person || (name !== undefined && foldName(v.value) === foldName(name));
  }

  /** The side `person` leads, if any (a declared group naming them). */
  ledSide(person: string): string | null {
    for (const id of this.sim.model.factions.keys()) if (this.leads(person, id)) return id;
    return null;
  }

  /** The header `majority:` value, evaluated now (floored: a story writes
   *  `Night.present / 2 + 1` for "strictly more than half"), or null. */
  needs(): number | null {
    if (this.majority === null) return null;
    let v: Value;
    try {
      v = evaluate(parseExprCached(this.majority), this.sim.world, this.callFn, new Map());
    } catch {
      return null;
    }
    if (v.kind !== "number" || !Number.isFinite(v.value)) return null;
    return Math.max(0, Math.floor(v.value));
  }

  private readonly callFn = (name: string, args: CallArg[]): Value => {
    switch (name) {
      case "members":
        return vList(this.sim.factionMembers(args[0]?.asName() ?? "").map(vString));
      case "count":
      case "len": {
        const v = args[0]?.value;
        return vNumber(v !== undefined && v.kind === "list" ? v.items.length : 0);
      }
      case "sum":
      case "max": {
        const v = args[0]?.value;
        const nums = v !== undefined && v.kind === "list" ? v.items.map((x) => (x.kind === "number" ? x.value : 0)) : [];
        if (name === "sum") return vNumber(nums.reduce((a, b) => a + b, 0));
        return nums.length === 0 ? VNULL : vNumber(Math.max(...nums));
      }
      default:
        return VNULL;
    }
  };

  /** Members of a side who count tonight: real guests, not gone, not a Run
   *  persona (the show's present-only majority). */
  presentMembers(side: string): string[] {
    return this.sim.factionMembers(side).filter(
      (p) => this.sim.persons.has(p) && !truthy(this.sim.world.get(`${p}.gone`)) && !truthy(this.sim.world.get(`${p}.persona`)),
    );
  }

  // -- faction mode (wave 18b) ---------------------------------------------

  /** The header has a `founding:` line: crews are factions in the race,
   *  one faction at a time. */
  get factionMode(): boolean {
    return this.founding !== null;
  }

  /** Is `id` a declared joinable group (a side that races in faction mode,
   *  revealed or not)? A `joinable: false` caste (`Hosts`) never is. */
  private isRaceSide(id: string): boolean {
    return this.sim.model.factions.get(id)?.joinable === true;
  }

  /** Is `id` a race faction: a live crew, or a declared joinable group? */
  isRaceFaction(id: string): boolean {
    return this.byId.has(id) || this.isRaceSide(id);
  }

  /** Every faction in the race now: the open sides (declared, joinable,
   *  revealed) in declaration order, then the live crews in founding order.
   *  Empty outside faction mode. */
  raceFactions(): string[] {
    if (!this.factionMode) return [];
    const sides = [...this.sim.model.factions.keys()].filter((id) => sideOpen(this.sim, id));
    return [...sides, ...this.byId.keys()];
  }

  /** Does `person` count tonight: a real guest, not gone, not a Run persona? */
  private isPresent(person: string): boolean {
    return this.sim.persons.has(person) && !truthy(this.sim.world.get(`${person}.gone`)) && !truthy(this.sim.world.get(`${person}.persona`));
  }

  /** Programs present tonight (not gone, not a Run persona). */
  presentTotal(): number {
    let n = 0;
    for (const id of this.sim.persons.keys()) if (this.isPresent(id)) n += 1;
    return n;
  }

  /** A race faction's present members (a side's or a crew's); 0 for
   *  anything else. */
  presentCount(id: string): number {
    const c = this.byId.get(id);
    if (c !== undefined) return c.members.filter((m) => this.isPresent(m)).length;
    return this.isRaceSide(id) ? this.presentMembers(id).length : 0;
  }

  /** The race faction over the `majority:` line now, else null (null
   *  outside faction mode or with no threshold). Membership is exclusive
   *  in faction mode, so at most one can be over a line above half. */
  winner(): string | null {
    if (!this.factionMode) return null;
    const needs = this.needs();
    if (needs === null || needs <= 0) return null;
    for (const id of this.raceFactions()) if (this.presentCount(id) >= needs) return id;
    return null;
  }

  /** The race side `person` is in (a declared joinable group they belong
   *  to, primary or not), revealed or not; else null. */
  private raceSideOf(person: string): string | null {
    const primary = this.sim.factionOf(person);
    if (primary !== null && this.isRaceSide(primary)) return primary;
    for (const g of this.sim.groupsOf(person)) if (this.isRaceSide(g)) return g;
    return null;
  }

  /** The race faction `person` is in: their crew, else their open side,
   *  else null. */
  factionOf(person: string): string | null {
    const crew = this.crewOf(person);
    if (crew !== null) return crew.id;
    const side = this.raceSideOf(person);
    return side !== null && sideOpen(this.sim, side) ? side : null;
  }

  /** A race faction's name (a crew's, a side's id), else null. */
  displayName(id: string): string | null {
    const c = this.byId.get(id);
    if (c !== undefined) return c.name;
    return this.sim.model.factions.has(id) ? id : null;
  }

  /** A race faction's founder as a person id (a crew's founder, a side's
   *  `<Side>.leader` when it names a person), else null. */
  founderOf(id: string): string | null {
    const c = this.byId.get(id);
    if (c !== undefined) return c.founder;
    if (!this.sim.model.factions.has(id)) return null;
    const v = this.sim.world.peek(`${id}.leader`);
    if (v === null || v.kind !== "string" || v.value.trim() === "") return null;
    if (this.sim.persons.has(v.value)) return v.value;
    const want = foldName(v.value);
    for (const p of this.sim.persons.values()) if (foldName(p.name) === want) return p.id;
    return null;
  }

  /** May `person` found a faction now? Faction mode, the `founding:`
   *  condition holds for them (`program` / `self` bound), not restricted or
   *  captured, no live crew of their own, under `MAX_CREWS`, and not a
   *  side's leader. */
  mayFound(person: string): boolean {
    if (this.founding === null || !this.sim.persons.has(person)) return false;
    if (this.sim.isRestricted(person) || this.sim.isCaptured(person)) return false;
    if (this.foundedBy(person) !== null || this.byId.size >= MAX_CREWS || this.ledSide(person) !== null) return false;
    return this.sim.holds(this.founding, person);
  }

  /** The sim moves `person` onto `group` (`setFaction` / `addToGroup`
   *  call this first). In faction mode, when `group` is a race side, they
   *  leave their crew (a founder's disbands) and every other race side. A
   *  non-race group (`Hosts`, a `joinable: false` caste) never touches a
   *  crew. Raises no signal: the side's own `joined` / `defected` says it. */
  onSide(person: string, group: string): void {
    if (!this.factionMode || !this.isRaceSide(group)) return;
    const crew = this.crewOf(person);
    if (crew !== null) this.leave(crew, person);
    for (const g of this.sim.groupsOf(person)) if (g !== group && this.isRaceSide(g)) this.hooks.removeFromGroup(person, g);
  }

  /** `ModView.race`, or null outside faction mode. */
  raceView(): RaceView | null {
    if (!this.factionMode) return null;
    return {
      needs: this.needs(),
      present: this.presentTotal(),
      winner: this.winner(),
      factions: this.raceFactions().map((id) => {
        const founder = this.founderOf(id);
        return {
          id,
          name: this.displayName(id) ?? id,
          kind: this.byId.has(id) ? ("founded" as const) : ("side" as const),
          founder: founder !== null ? this.name(founder) : this.byId.has(id) ? null : this.leaderOf(id),
          present: this.presentCount(id),
        };
      }),
    };
  }

  // -- the crew room -------------------------------------------------------

  /** May `person` see (and post in) a crew room? Members only. */
  canSee(person: string, channel: string): boolean {
    const c = this.byId.get(channel.slice(CREW_ROOM_PREFIX.length));
    return c !== undefined && c.members.includes(person);
  }

  /** Who hears a line typed into a crew room: its members, now. */
  audience(channel: string): string[] {
    return [...(this.byId.get(channel.slice(CREW_ROOM_PREFIX.length))?.members ?? [])];
  }

  /** A crew room's channel head (a dissolved crew's keeps its id). */
  head(channel: string): { channel: string; channelKind: string; title: string; spaceId: string } {
    const c = this.byId.get(channel.slice(CREW_ROOM_PREFIX.length));
    return { channel, channelKind: "faction", title: c?.name ?? "a crew", spaceId: DEFAULT_SPACE_ID };
  }

  /** The crew room a person sees, as a channel snapshot. */
  rooms(person: string): ChannelView[] {
    const c = this.crewOf(person);
    if (c === null) return [];
    return [{ id: crewRoom(c.id), kind: "faction", title: c.name, spaceId: DEFAULT_SPACE_ID, member: true, canPost: true, threadable: true }];
  }

  // -- views ---------------------------------------------------------------

  private name(id: string): string {
    return this.sim.persons.get(id)?.name ?? id;
  }

  crewView(c: Crew): CrewView {
    return {
      id: c.id,
      name: c.name,
      founder: c.founder,
      founderName: this.name(c.founder),
      members: [...c.members],
      memberNames: c.members.map((m) => this.name(m)),
      room: crewRoom(c.id),
    };
  }

  /** The `GuestView` fields for `person`. */
  guestFields(person: string): CrewGuestFields {
    if (this.factionMode) return this.factionFields(person);
    const crew = this.crewOf(person);
    const needs = this.needs();
    const mine = this.sim.factionOf(person);
    const sides: SideView[] = [...this.sim.model.factions.values()]
      .filter((f) => sideOpen(this.sim, f.id))
      .map((f) => ({
        id: f.id,
        name: f.id,
        leader: this.leaderOf(f.id),
        members: this.presentMembers(f.id).length,
        ...(needs !== null ? { needs } : {}),
        mine: mine === f.id,
      }));
    const invites = this.inviteViews(person);
    return { crew: crew === null ? null : this.crewView(crew), invites, sides };
  }

  /** Faction mode's `GuestView` fields: one list, the open sides then the
   *  founded factions; the head count, threshold and "more to win" only on
   *  the viewer's own row (nobody counts a rival), and `canFound`. */
  private factionFields(person: string): CrewGuestFields {
    const crew = this.crewOf(person);
    const needs = this.needs();
    const mine = this.factionOf(person);
    const counts = (id: string): Pick<SideView, "members" | "needs" | "more"> => {
      if (id !== mine) return {};
      const members = this.presentCount(id);
      return needs !== null ? { members, needs, more: Math.max(0, needs - members) } : { members };
    };
    const sides: SideView[] = this.raceFactions().map((id) => {
      const c = this.byId.get(id);
      if (c !== undefined) {
        const founder = this.name(c.founder);
        return { id, name: c.name, leader: founder, ...counts(id), mine: mine === id, kind: "founded" as const, founder };
      }
      const leader = this.leaderOf(id);
      const ethos = this.sim.model.factions.get(id)?.ethos ?? null;
      return {
        id,
        name: id,
        leader,
        ...counts(id),
        mine: mine === id,
        kind: "side" as const,
        ...(ethos !== null && ethos.trim() !== "" ? { ethos } : {}),
        ...(leader !== null ? { founder: leader } : {}),
      };
    });
    const led = this.ledSide(person);
    return {
      crew: crew === null ? null : this.crewView(crew),
      invites: this.inviteViews(person),
      sides,
      canFound: this.mayFound(person),
      ...(led !== null && this.isRaceFaction(led) ? { leads: led } : {}),
    };
  }

  private inviteViews(person: string): InviteView[] {
    return this.openInvitesTo(person).map((i) => ({
      id: i.id,
      from: i.from,
      fromName: this.name(i.from),
      kind: i.kind,
      target: i.target,
      targetName: this.targetName(i),
    }));
  }

  /** An invitation's target as people read it (a crew's name, a side's id). */
  targetName(i: CrewInvite): string {
    return i.kind === "crew" ? (this.byId.get(i.target)?.name ?? "a crew") : i.target;
  }

  /** Every group a person card shows as a badge: their visible declared
   *  groups (a hidden one until revealed) plus their crew's name. */
  groupsOf(person: string): string[] {
    const out = this.sim.groupsOf(person).filter((g) => {
      const def = this.sim.model.factions.get(g);
      return def === undefined || !def.hidden || this.sim.factionRevealed(g);
    });
    const crew = this.crewOf(person);
    if (crew !== null) out.push(crew.name);
    return out;
  }

  summaries(): CrewSummary[] {
    return this.all().map((c) => ({ ...this.crewView(c), at: c.at }));
  }

  // -- the op --------------------------------------------------------------

  /** What changed since the last call that the chat should say (then
   *  cleared): every `apply`'s notices, plus faction mode's `onSide` ones. */
  takeNotices(): CrewNotice[] {
    const out = this.notices;
    this.notices = [];
    return out;
  }

  /** Apply one journaled op; returns the sim events it caused. An op that
   *  no longer fits the state (a crew gone, an invitation answered) changes
   *  nothing — the server refuses those before journaling, and a replay
   *  lands the same either way. */
  apply(op: CrewOp): SimEvent[] {
    const from = this.sim.log.len();
    // Notices are never cleared here: a story `join` / `add` between ops
    // (faction mode's `onSide`) raises "left" / "dissolved" ones too, and
    // `takeNotices` is the one reset, so they reach the chat live and on
    // replay alike.
    switch (op.op) {
      case "foundCrew":
        this.found(op.by, op.name);
        break;
      case "crewInvite":
        this.addInvite("crew", op.by, op.to, op.crew);
        break;
      case "recruit":
        this.addInvite("side", op.by, op.to, op.side);
        break;
      case "crewAnswer":
      case "recruitAnswer":
        this.answer(op.id, op.yes);
        break;
      case "leaveCrew": {
        const c = this.byId.get(op.crew);
        if (c !== undefined && c.members.includes(op.person)) this.leave(c, op.person);
        break;
      }
      case "leaveSide":
        this.leaveSide(op.person);
        break;
      case "renameCrew": {
        const c = this.byId.get(op.crew);
        const name = tidyCrewName(op.name);
        if (c === undefined || name === "" || (this.named(name) !== null && this.named(name) !== c)) break;
        const prior = c.name;
        c.name = name;
        this.sim.world.set(`${c.id}.name`, vString(name));
        this.notices.push({ kind: "renamed", crew: c, from: prior });
        break;
      }
      case "dissolveCrew": {
        const c = this.byId.get(op.crew);
        if (c !== undefined) this.dissolve(c);
        break;
      }
      case "joinCrew": {
        const c = this.byId.get(op.crew);
        if (c === undefined || !this.mayJoin(op.person, c)) break;
        this.joinCrew(c, op.person);
        this.settleOthers(op.person, (o) => o.kind === "crew" && o.target === c.id);
        break;
      }
    }
    // Faction mode: a leave or a disband raises no signal, yet it can move
    // a majority, so the story's watchers get their pass now.
    if (this.factionMode) this.hooks.drain();
    return this.sim.log.since(from);
  }

  /** May `person` walk into crew `c` (the `joinCrew` op)? A guest not
   *  already in it; in faction mode not restricted or captured, not a
   *  side's leader and not the founder of another live crew (the server
   *  answers each of these before it journals). */
  private mayJoin(person: string, c: Crew): boolean {
    if (!this.sim.persons.has(person) || c.members.includes(person)) return false;
    if (!this.factionMode) return true;
    if (this.sim.isRestricted(person) || this.sim.isCaptured(person) || this.ledSide(person) !== null) return false;
    const own = this.foundedBy(person);
    return own === null || own === c;
  }

  private found(by: string, raw: string): void {
    const name = tidyCrewName(raw);
    if (!this.sim.persons.has(by) || name === "") return;
    if (this.byId.size >= MAX_CREWS || this.foundedBy(by) !== null || this.named(name) !== null) return;
    // Faction mode: only inside the `founding:` window, and a founder
    // leaves their side first (one faction at a time).
    if (this.factionMode && !this.mayFound(by)) return;
    if (this.factionMode) this.leaveRaceSides(by);
    const prior = this.crewOf(by);
    if (prior !== null) this.leave(prior, by);
    this.crewSeq += 1;
    const crew: Crew = { id: `${CREW_ID_PREFIX}${this.crewSeq}`, name, founder: by, members: [by], at: this.sim.elapsed() };
    this.byId.set(crew.id, crew);
    this.sim.world.set(`${crew.id}.name`, vString(name));
    this.sim.world.set(`${crew.id}.founder`, vString(by));
    this.syncMembers(crew);
    this.sim.world.set(`${by}.crew`, vString(crew.id));
    this.notices.push({ kind: "founded", crew });
    // Faction mode: a founder's open invitations (crew or side) are moot —
    // a yes to either would disband the faction just founded.
    if (this.factionMode) this.settleOthers(by, () => true);
    this.sim.signal("founded", by, { crew: crew.id });
  }

  private addInvite(kind: InviteKind, by: string, to: string, target: string): void {
    if (!this.sim.persons.has(by) || !this.sim.persons.has(to) || by === to) return;
    if (kind === "crew" && !this.byId.has(target)) return;
    if (kind === "side" && !this.sim.model.factions.has(target)) return;
    if (this.openInvite(by, to, kind, target) !== null) return;
    if (this.openInvitesTo(to).length >= MAX_OPEN_INVITES_TO) return;
    this.inviteSeq += 1;
    const invite: CrewInvite = { id: `inv-${this.inviteSeq}`, kind, from: by, to, target, at: this.sim.elapsed(), state: "open" };
    this.invites.set(invite.id, invite);
    this.notices.push({ kind: "invite", invite });
  }

  private answer(id: string, yes: boolean): void {
    const i = this.invites.get(id);
    if (i === undefined || i.state !== "open") return;
    if (!yes) {
      i.state = "no";
      this.notices.push({ kind: "answered", invite: i });
      return;
    }
    if (i.kind === "crew") {
      const c = this.byId.get(i.target);
      // Faction mode: a yes arrives after its invitation, so it is held to
      // the walk-in join's rules now (a founder of another faction, a
      // side's leader, a restricted or captured program can't take it).
      if (c === undefined || (this.factionMode && !c.members.includes(i.to) && !this.mayJoin(i.to, c))) {
        i.state = "void";
        this.notices.push({ kind: "answered", invite: i });
        return;
      }
      i.state = "yes";
      this.notices.push({ kind: "answered", invite: i });
      if (!c.members.includes(i.to)) this.joinCrew(c, i.to);
      this.sim.signal("recruited", i.to, { crew: c.id, by: i.from });
      this.settleOthers(i.to, (o) => o.kind === "crew" && o.target === c.id);
      return;
    }
    // A side: the sim's own switching join (the server checked the doors,
    // the restriction and that the side is open before journaling this).
    // Faction mode: a founder (it would disband their faction) or another
    // side's leader can't take it.
    if (this.factionMode && (this.foundedBy(i.to) !== null || (this.ledSide(i.to) ?? i.target) !== i.target)) {
      i.state = "void";
      this.notices.push({ kind: "answered", invite: i });
      return;
    }
    i.state = "yes";
    this.notices.push({ kind: "answered", invite: i });
    const prior = this.sim.factionOf(i.to);
    if (prior !== i.target) {
      if (prior === null) this.sim.join(i.to, i.target);
      else this.sim.defect(i.to, i.target);
    }
    this.sim.signal("recruited", i.to, { side: i.target, by: i.from });
    this.settleOthers(i.to, (o) => o.kind === "side" && o.target === i.target);
  }

  /** Other open invitations to `person` the answer made moot. */
  private settleOthers(person: string, moot: (o: CrewInvite) => boolean): void {
    for (const o of this.invites.values()) {
      if (o.state === "open" && o.to === person && moot(o)) {
        o.state = "void";
        this.notices.push({ kind: "answered", invite: o });
      }
    }
  }

  private joinCrew(c: Crew, person: string): void {
    if (this.factionMode) this.leaveRaceSides(person);
    const prior = this.crewOf(person);
    if (prior !== null && prior !== c) this.leave(prior, person);
    c.members.push(person);
    this.syncMembers(c);
    this.sim.world.set(`${person}.crew`, vString(c.id));
    this.notices.push({ kind: "joined", crew: c, person });
    this.sim.signal("join", person, { crew: c.id });
  }

  private leave(c: Crew, person: string): void {
    // Faction mode: a founder leaving disbands the faction (its members go
    // back to neither) — no faction is left without its founder.
    if (this.factionMode && person === c.founder) {
      this.dissolve(c);
      return;
    }
    c.members = c.members.filter((m) => m !== person);
    this.sim.world.set(`${person}.crew`, VNULL);
    this.syncMembers(c);
    this.notices.push({ kind: "left", crew: c, person });
    // An empty crew is gone (its slot of the eight is free again).
    if (c.members.length === 0) this.dissolve(c);
  }

  /** Faction mode: take `person` off every race side they are on (a crew
   *  is joined or founded), each with its `unaligned` signal. */
  private leaveRaceSides(person: string): void {
    for (const g of this.sim.groupsOf(person)) {
      if (!this.isRaceSide(g)) continue;
      this.hooks.removeFromGroup(person, g);
      this.sim.signal("unaligned", person, { side: g });
    }
  }

  private leaveSide(person: string): void {
    const side = this.sim.factionOf(person);
    if (side === null || !this.sim.model.factions.has(side)) return;
    this.hooks.removeFromGroup(person, side);
    this.sim.signal("unaligned", person, { side });
  }

  private dissolve(c: Crew): void {
    const members = [...c.members];
    for (const m of members) this.sim.world.set(`${m}.crew`, VNULL);
    c.members = [];
    this.byId.delete(c.id);
    this.sim.world.unset(`${c.id}.name`);
    this.sim.world.unset(`${c.id}.founder`);
    this.sim.world.setCollection(`${c.id}.members`, vList([]));
    for (const i of this.invites.values()) {
      if (i.state === "open" && i.kind === "crew" && i.target === c.id) {
        i.state = "void";
        this.notices.push({ kind: "answered", invite: i });
      }
    }
    this.notices.push({ kind: "dissolved", crew: c, members });
  }

  private syncMembers(c: Crew): void {
    this.sim.world.setCollection(`${c.id}.members`, vList(c.members.map(vString)));
  }
}
