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
  | { op: "dissolveCrew"; crew: string };

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

/** One declared, joinable, revealed side (the Sides screen). */
export interface SideView {
  id: string;
  name: string;
  /** The leader's display name (the world's `<Side>.leader`), else null. */
  leader: string | null;
  /** Members present tonight (a gone guest and a Run persona never count,
   *  as the majority doesn't). */
  members: number;
  /** The header `majority:` threshold, when the story declares one. */
  needs?: number;
  /** The viewer is on this side. */
  mine: boolean;
}

/** The C10 fields of a `GuestView`. */
export interface CrewGuestFields {
  crew: CrewView | null;
  invites: InviteView[];
  sides: SideView[];
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
    const invites: InviteView[] = this.openInvitesTo(person).map((i) => ({
      id: i.id,
      from: i.from,
      fromName: this.name(i.from),
      kind: i.kind,
      target: i.target,
      targetName: this.targetName(i),
    }));
    return { crew: crew === null ? null : this.crewView(crew), invites, sides };
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

  /** What the last `apply` changed that the chat should say (then cleared). */
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
    this.notices = [];
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
    }
    return this.sim.log.since(from);
  }

  private found(by: string, raw: string): void {
    const name = tidyCrewName(raw);
    if (!this.sim.persons.has(by) || name === "") return;
    if (this.byId.size >= MAX_CREWS || this.foundedBy(by) !== null || this.named(name) !== null) return;
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
      if (c === undefined) {
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
    const prior = this.crewOf(person);
    if (prior !== null && prior !== c) this.leave(prior, person);
    c.members.push(person);
    this.syncMembers(c);
    this.sim.world.set(`${person}.crew`, vString(c.id));
    this.notices.push({ kind: "joined", crew: c, person });
    this.sim.signal("join", person, { crew: c.id });
  }

  private leave(c: Crew, person: string): void {
    c.members = c.members.filter((m) => m !== person);
    this.sim.world.set(`${person}.crew`, VNULL);
    this.syncMembers(c);
    this.notices.push({ kind: "left", crew: c, person });
    // An empty crew is gone (its slot of the eight is free again).
    if (c.members.length === 0) this.dissolve(c);
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
