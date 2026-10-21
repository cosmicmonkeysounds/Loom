//! Wave 18 (C10) — the crews + recruiting routes, their name moderation and
//! the chat lines a crew op posts.
//!
//! Guest (token) routes, doors open:
//!   POST /api/guest/crew/found {name}      → {ok, crew}
//!   POST /api/guest/crew/invite {to}       → {ok, invite, kind, target, targetName[, already]}
//!   POST /api/guest/crew/leave             → {ok}
//!   POST /api/guest/recruit {to, side?}    → like invite (side: the named one, else
//!                                            yours; with no side, your crew)
//!   POST /api/guest/recruit/answer {id, yes} → {ok, joined, kind, target, targetName}
//!   POST /api/guest/side/leave             → {ok}  (back to neither)
//!   POST /api/guest/crew/join {crew}       → {ok, crew}  (wave 18b, faction mode:
//!                                            a walk-in join from the Factions list)
//! Director routes (mod token / Run, and the host allowlist since the fix round):
//!   POST /api/mod/crew/rename {crew, name} → {ok, crew}
//!   POST /api/mod/crew/dissolve {crew}     → {ok}
//!
//! Every change is one journaled `crew` op (`Sim.crew` → `crews.ts`). A side
//! invitation's yes is the sim's switching `join` / `defect`, so it is
//! checked here exactly as `/api/guest/join` is: doors open, the guest not
//! restricted, the side declared + joinable + revealed (`guestSide`). A crew
//! never touches a side or the majority — unless the story has a `founding:`
//! line (wave 18b, **faction mode**): then a founded crew is a faction in
//! the one majority race beside the declared sides, membership is
//! exclusive (founding or joining one leaves the other), a founder's leave
//! disbands it, founding opens only inside the `founding:` window, and a
//! founder or a side's leader is never moved into another faction (the
//! routes refuse before journaling; the engine refuses on replay too).
//!
//! The chat lines a crew op posts (`crewDrafts`) are drafted by the runtime
//! right after **every** commit — a crew op's, and a `join` / `defect` /
//! story `add` that took someone out of a crew in faction mode — live and
//! at replay alike, so the seqs match.
//!
//! The invitation itself is a `widget` card of kind `invite` posted to the
//! invitee in the private thread with the inviter (`pm:<a>:<b>`), as a big
//! moment (`moment: "big"`, params `invite` / `kind` / `from` / `fromName` /
//! `target` / `targetName`); once the invitation is answered (here, on the
//! card, or made moot) the card counts as answered for that guest.

import type { IncomingMessage, ServerResponse } from "node:http";

import { Sim, type SimEvent } from "../../src/runtime/sim/index.ts";
import { CREW_NAME_MAX, CREW_NAME_MIN, MAX_CREWS, MAX_OPEN_INVITES_TO, crewRoom, type Crew, type CrewInvite, type CrewNotice, type CrewOp, type Crews } from "../../src/runtime/sim/crews.ts";
import { foldName } from "../../src/parser/names.ts";
import { cleanGuestName, nameSkeleton } from "../identity.ts";
import { sendJson, str } from "../http-util.ts";
import { guestSide } from "./sides.ts";
import type { ChannelKind, ChatMessage, DraftMessage } from "../chat.ts";
import type { FactsBook } from "../facts.ts";

/** At most this many invitations (crew + side) one guest sends a minute. */
export const INVITES_PER_MINUTE = 10;
/** At most this many crew/found attempts (taken or refused) a guest makes a
 *  minute: a name check is never a free lookup. */
export const FOUNDS_PER_MINUTE = 6;
/** At most this many walk-in joins (taken or refused) a guest makes a
 *  minute: join, leave, join again posts a line to the faction each time. */
export const JOINS_PER_MINUTE = 6;

// ───────────────────────── name moderation ─────────────────────────

/** Rude words a crew name may not carry anywhere (letters only, lower case). */
const RUDE_ANYWHERE = [
  "fuck", "shit", "cunt", "bitch", "nigg", "faggot", "whore", "slut", "retard", "pussy", "asshole",
  "wank", "twat", "hitler", "bastard", "dildo", "porn", "penis", "vagina", "jizz",
];
/** Rude words only as a whole word (they hide inside ordinary words). */
const RUDE_WORDS = new Set(["rape", "rapist", "cock", "dick", "ass", "anal", "cum", "tit", "tits", "nazi", "nazis", "spic", "kike", "fag", "fags", "coon", "chink", "sex", "boobs"]);

/** Letters and digits only, lower case — the look a containment test reads. */
function compact(s: string): string {
  return nameSkeleton(s).replace(/[+#]/gu, "");
}

/** The names a crew may not take (or look like): every declared group,
 *  character, place and authored room, every guest here tonight, and every
 *  other live crew. */
function takenNames(sim: Sim, except: string | null): string[] {
  const out: string[] = [];
  for (const id of sim.model.factions.keys()) out.push(id);
  for (const id of sim.model.characters.keys()) out.push(id);
  for (const l of sim.model.locations.values()) out.push(l.id, ...(l.label !== null ? [l.label] : []));
  for (const c of sim.model.channels.values()) out.push(c.title.replace(/^#/u, ""), c.id);
  for (const p of sim.persons.values()) out.push(p.name);
  for (const c of sim.crews.all()) if (c.id !== except) out.push(c.name);
  out.push(sim.lobbyTitle());
  return out;
}

/** Names the house uses for someone who isn't a declared character or
 *  group (the duck, the house voices, the old door part, a short brand name),
 *  as skeletons. */
const HOUSE_NAMES = ["gerald", "operator", "narrator", "norton", "mcafee", "windowsdefender", "defender", "recyclebin", "serverroom", "system", "admin", "director", "host", "hosts"];

/** Format, control and bidi characters (zero-width joiners, RTL overrides):
 *  a name carrying one is refused, never quietly stripped. */
const HIDDEN_CHARS = /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

/** A skeleton without a leading "the" (*Way Out* is *The Way Out*). */
function bare(skel: string): string {
  return skel.startsWith("the") && skel.length > 5 ? skel.slice(3) : skel;
}

/**
 * Why `raw` may not name a crew, or null when it may. `except` is the crew
 * being renamed (its own name is fine). Checks: no hidden characters or
 * markup, 2–24 characters after cleaning, a letter or digit, no rude word,
 * and not a lookalike of anything the house already calls by a name
 * (`takenNames`, `HOUSE_NAMES`; a leading "the" ignored).
 *
 * It never checks a name against the story's secrets (hunt answers, the
 * door's codes, a secret character's values): a refusal that depends on a
 * secret is an oracle any guest can walk (wave 18 fix A1). A guest who knows
 * an answer can say it in chat anyway.
 */
export function crewNameRefusal(sim: Sim, raw: string, _facts: FactsBook | null = null, except: string | null = null): string | null {
  if (HIDDEN_CHARS.test(raw) || /[<>]/u.test(raw)) return "Letters, numbers and spaces only, please.";
  const name = cleanGuestName(raw);
  const len = Array.from(name).length;
  if (len < CREW_NAME_MIN || len > CREW_NAME_MAX) return `A crew name is ${CREW_NAME_MIN} to ${CREW_NAME_MAX} characters.`;
  if (!/[\p{L}\p{N}]/u.test(name)) return "A crew name needs a letter or a number.";
  const flat = compact(name);
  const words = name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w !== "");
  if (RUDE_ANYWHERE.some((w) => flat.includes(w)) || words.some((w) => RUDE_WORDS.has(w))) return "Pick a friendlier name.";
  const folded = foldName(name);
  const skel = nameSkeleton(name);
  const mine = bare(skel);
  if (skel !== "" && HOUSE_NAMES.some((h) => h === mine || h === skel)) return "That name is taken. Try another.";
  for (const t of takenNames(sim, except)) {
    const ts = nameSkeleton(t);
    if (foldName(t) === folded || (skel !== "" && (ts === skel || (ts !== "" && bare(ts) === mine)))) return "That name is taken. Try another.";
  }
  return null;
}

// ───────────────────────── the chat a crew op posts ─────────────────────────

function nameOf(sim: Sim, id: string): string {
  return sim.persons.get(id)?.name ?? id;
}

function inviteLine(sim: Sim, i: CrewInvite): string {
  return `${nameOf(sim, i.from)} wants you in ${sim.crews.targetName(i)}`;
}

/** The messages one applied op's notices post (deterministic: a replay of
 *  the same op posts the same lines). */
export function crewDrafts(sim: Sim, notices: readonly CrewNotice[]): DraftMessage[] {
  const out: DraftMessage[] = [];
  const ts = sim.elapsed();
  const room = (crew: Crew, text: string, audience: string[]): void => {
    if (audience.length === 0) return;
    const head = sim.channelHead(crewRoom(crew.id));
    out.push({ channel: head.channel, channelKind: "faction", title: crew.name, from: "", kind: "system", text, ts, audience, parentSeq: null });
  };
  for (const n of notices) {
    switch (n.kind) {
      case "invite": {
        const i = n.invite;
        const head = sim.channelHead(Sim.pmChannel(i.from, i.to));
        const text = inviteLine(sim, i);
        const params: Record<string, string> = {
          invite: i.id,
          kind: i.kind,
          from: i.from,
          fromName: nameOf(sim, i.from),
          target: i.target,
          targetName: sim.crews.targetName(i),
          moment: "big",
        };
        // `moment: "big"` (C1) and `go` (C2) are the core lane's wave 18
        // fields; set as plain values here, they are additive on the wire.
        const card = {
          channel: head.channel,
          channelKind: head.channelKind as ChannelKind,
          title: head.title,
          from: "",
          kind: "widget" as const,
          text,
          ts,
          audience: [i.to],
          parentSeq: null,
          widget: { kind: "invite", text, params },
          moment: "big",
          go: [{ kind: "sides", label: "Sides & crews" }],
        };
        out.push(card as unknown as DraftMessage);
        break;
      }
      case "answered": {
        const i = n.invite;
        if (i.state !== "yes") break;
        const head = sim.channelHead(Sim.pmChannel(i.from, i.to));
        const text = `✓ ${nameOf(sim, i.to)} joined ${sim.crews.targetName(i)}.`;
        out.push({ channel: head.channel, channelKind: head.channelKind as ChannelKind, title: head.title, from: "", kind: "system", text, ts, audience: [i.from], parentSeq: null });
        break;
      }
      case "founded":
        room(n.crew, `◇ You founded ${n.crew.name}. Scan someone's pass to invite them.`, [n.crew.founder]);
        break;
      case "joined":
        room(n.crew, `◇ ${nameOf(sim, n.person)} joined ${n.crew.name}.`, [...n.crew.members]);
        break;
      case "left":
        room(n.crew, `◇ ${nameOf(sim, n.person)} left ${n.crew.name}.`, [...n.crew.members]);
        break;
      case "renamed":
        room(n.crew, `◇ ${n.from} is now called ${n.crew.name}.`, [...n.crew.members]);
        break;
      case "dissolved":
        room(n.crew, `◇ ${n.crew.name} was dissolved.`, n.members);
        break;
    }
  }
  return out;
}

/** `${seq}:${guest}` for every invitation card whose invitation is no
 *  longer open — the answered-widget keys a view reads, so a card answered
 *  from the Sides sheet (or made moot) never asks again, live or after a
 *  restart. */
export function answeredInviteCards(messages: readonly ChatMessage[], crews: Crews): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.kind !== "widget" || m.widget?.kind !== "invite") continue;
    const i = crews.invite(m.widget.params["invite"] ?? "");
    if (i !== null && i.state !== "open") out.push(`${m.seq}:${i.to}`);
  }
  return out;
}

// ───────────────────────── the routes ─────────────────────────

export const CREW_GUEST_ROUTES = [
  "/api/guest/crew/found",
  "/api/guest/crew/invite",
  "/api/guest/crew/leave",
  "/api/guest/recruit",
  "/api/guest/recruit/answer",
  "/api/guest/side/leave",
  "/api/guest/crew/join",
] as const;
export const CREW_MOD_ROUTES = ["/api/mod/crew/rename", "/api/mod/crew/dissolve"] as const;

/** What the routes need from their `EventRuntime` (kept narrow). */
export interface CrewHost {
  sim(): Sim | null;
  open(): boolean;
  /** The acting guest from the caller's token (sends 401 itself), or null. */
  guest(req: IncomingMessage, body: Record<string, unknown>, res: ServerResponse): string | null;
  facts(): FactsBook | null;
  now(): number;
  /** Journal + apply one op (`commit("crew", op)`). */
  apply(op: CrewOp): SimEvent[];
  /** Fan the op's sim events out (chat, snapshots). */
  fanout(events: SimEvent[]): void;
  /** Append + deliver the crew's own lines. */
  post(drafts: DraftMessage[]): void;
  /** Every chat message (the answered-card scan). */
  messages(): readonly ChatMessage[];
  /** Mark widget cards answered (`${seq}:${guest}` keys). */
  markAnswered(keys: readonly string[]): void;
}

type Refusal = { status: number; error: string };

export class CrewRoutes {
  /** guest id → wall ms of their recent invitations (the per-minute cap). */
  private readonly sent = new Map<string, number[]>();
  /** guest id → wall ms of their recent crew/found attempts. */
  private readonly founds = new Map<string, number[]>();
  /** guest id → wall ms of their recent walk-in joins. */
  private readonly walkIns = new Map<string, number[]>();

  constructor(private readonly host: CrewHost) {}

  /** Journal + apply + fan out one op, then post its lines (a host that
   *  drafts every commit's notices itself has taken them already). */
  private commit(sim: Sim, op: CrewOp): void {
    const events = this.host.apply(op);
    this.host.fanout(events);
    const notices = sim.crews.takeNotices();
    const drafts = crewDrafts(sim, notices);
    if (drafts.length > 0) this.host.post(drafts);
    if (notices.some((n) => n.kind === "answered")) this.host.markAnswered(answeredInviteCards(this.host.messages(), sim.crews));
  }

  /** "crew" or, in faction mode, "faction" (the copy's word). */
  private static word(sim: Sim): string {
    return sim.crews.factionMode ? "faction" : "crew";
  }

  /** Faction mode: why `person` may not be moved into another faction than
   *  `into` (a crew id, a side, or null = any): a live founder elsewhere, or
   *  a side's leader. Null outside faction mode. `self`: the copy speaks to
   *  them ("Disband X first.") rather than about them. */
  private static anchored(sim: Sim, person: string, into: string | null, self: boolean): Refusal | null {
    const crews = sim.crews;
    if (!crews.factionMode) return null;
    const name = nameOf(sim, person);
    const own = crews.foundedBy(person);
    if (own !== null && own.id !== into) return { status: 409, error: self ? `Disband ${own.name} first.` : `${name} founded ${own.name}. Founders stay with their faction.` };
    const led = crews.ledSide(person);
    if (led !== null && led !== into) return { status: 409, error: self ? "Leaders stay with their side." : `${name} leads ${led}. Leaders stay with their side.` };
    return null;
  }

  /** A guest named by id (a pass) or by display name. */
  private person(sim: Sim, raw: string): string | null {
    const t = raw.trim();
    if (t === "") return null;
    if (sim.persons.has(t)) return t;
    const want = foldName(t);
    for (const p of sim.persons.values()) if (foldName(p.name) === want) return p.id;
    return null;
  }

  private throttled(id: string, book: Map<string, number[]> = this.sent, max = INVITES_PER_MINUTE): boolean {
    const now = this.host.now();
    const recent = (book.get(id) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= max) {
      book.set(id, recent);
      return true;
    }
    recent.push(now);
    book.set(id, recent);
    return false;
  }

  /** Handle a guest crew / recruit route; false when `path` isn't one. */
  handleGuest(req: IncomingMessage, res: ServerResponse, path: string, body: Record<string, unknown>): boolean {
    if (!(CREW_GUEST_ROUTES as readonly string[]).includes(path)) return false;
    const id = this.host.guest(req, body, res);
    if (id === null) return true;
    const sim = this.host.sim();
    if (!this.host.open() || sim === null) {
      sendJson(res, 409, { error: "doors are closed" });
      return true;
    }
    if (!sim.persons.has(id)) {
      sendJson(res, 404, { error: "unknown guest" });
      return true;
    }
    const why = this.guestRoute(sim, id, path, body, res);
    if (why !== null) sendJson(res, why.status, { error: why.error });
    return true;
  }

  private guestRoute(sim: Sim, id: string, path: string, body: Record<string, unknown>, res: ServerResponse): Refusal | null {
    const crews = sim.crews;
    const restricted: Refusal = { status: 403, error: "Not while you're restricted." };
    switch (path) {
      case "/api/guest/crew/found": {
        if (sim.isRestricted(id)) return restricted;
        if (sim.isCaptured(id)) return { status: 409, error: "Not from the Internet." };
        const mine = crews.foundedBy(id);
        if (mine !== null) return { status: 409, error: `You already founded ${mine.name}.` };
        if (crews.all().length >= MAX_CREWS) return { status: 409, error: `The computer has room for ${MAX_CREWS} ${CrewRoutes.word(sim)}s, and they're all taken.` };
        // Faction mode: only inside the story's `founding:` window, never a
        // side's leader. Generic on purpose: the reason is story state.
        if (crews.factionMode && !crews.mayFound(id)) return { status: 403, error: "You can't found a faction right now." };
        if (this.throttled(id, this.founds, FOUNDS_PER_MINUTE)) return { status: 429, error: "slow down — wait a minute" };
        const raw = str(body, "name");
        const name = cleanGuestName(raw);
        const refusal = crewNameRefusal(sim, raw, this.host.facts());
        if (refusal !== null) return { status: 400, error: refusal };
        this.commit(sim, { op: "foundCrew", by: id, name });
        const crew = crews.foundedBy(id);
        if (crew === null) return { status: 409, error: "That name is taken. Try another." };
        sendJson(res, 200, { ok: true, crew: crews.crewView(crew) });
        return null;
      }
      case "/api/guest/crew/invite":
        return this.inviteToCrew(sim, id, body, res);
      case "/api/guest/crew/leave": {
        const crew = crews.crewOf(id);
        if (crew === null) return { status: 409, error: `You're not in a ${CrewRoutes.word(sim)}.` };
        // Faction mode: the founder's leave disbands it (the engine turns
        // the op into a dissolve; the client asks first).
        const dissolved = crews.factionMode && crew.founder === id;
        this.commit(sim, { op: "leaveCrew", person: id, crew: crew.id });
        sendJson(res, 200, dissolved ? { ok: true, dissolved: true } : { ok: true });
        return null;
      }
      case "/api/guest/crew/join":
        return this.walkIn(sim, id, body, res);
      case "/api/guest/recruit":
        return this.recruit(sim, id, body, res);
      case "/api/guest/recruit/answer":
        return this.answer(sim, id, body, res);
      case "/api/guest/side/leave": {
        if (sim.isRestricted(id)) return restricted;
        const side = crews.sideOf(id);
        if (side === null) return { status: 409, error: "You're not on a side." };
        if (crews.leads(id, side)) return { status: 403, error: "Leaders stay with their side." };
        this.commit(sim, { op: "leaveSide", person: id });
        sendJson(res, 200, { ok: true });
        return null;
      }
    }
    return { status: 404, error: "no such route" };
  }

  /** `/api/guest/crew/join {crew}` (faction mode): a walk-in join from the
   *  Factions list — leaving the guest's side or other crew. */
  private walkIn(sim: Sim, id: string, body: Record<string, unknown>, res: ServerResponse): Refusal | null {
    const crews = sim.crews;
    if (!crews.factionMode) return { status: 409, error: "A crew takes members by invitation: ask for a scan." };
    if (this.throttled(id, this.walkIns, JOINS_PER_MINUTE)) return { status: 429, error: "slow down — wait a minute" };
    if (sim.isRestricted(id)) return { status: 403, error: "Not while you're restricted." };
    if (sim.isCaptured(id)) return { status: 409, error: "Not from the Internet." };
    const crew = crews.get(str(body, "crew").trim());
    if (crew === null) return { status: 404, error: "No such faction." };
    if (crew.members.includes(id)) return { status: 409, error: `You're already in ${crew.name}.` };
    const anchored = CrewRoutes.anchored(sim, id, crew.id, true);
    if (anchored !== null) return anchored;
    this.commit(sim, { op: "joinCrew", person: id, crew: crew.id });
    const now = crews.get(crew.id);
    if (now === null || !now.members.includes(id)) return { status: 409, error: "That didn't go through." };
    sendJson(res, 200, { ok: true, crew: crews.crewView(now) });
    return null;
  }

  /** Why `to` can't be invited by `by` at all (who they are, not where). */
  private targetRefusal(sim: Sim, by: string, to: string | null): Refusal | null {
    if (to === null) return { status: 404, error: "No such program." };
    if (to === by) return { status: 400, error: "That's your own pass." };
    const name = nameOf(sim, to);
    if (sim.isCaptured(to) || sim.isRestricted(to)) return { status: 409, error: `${name} can't join anything right now.` };
    return null;
  }

  private inviteToCrew(sim: Sim, id: string, body: Record<string, unknown>, res: ServerResponse): Refusal | null {
    if (sim.isRestricted(id)) return { status: 403, error: "Not while you're restricted." };
    if (sim.isCaptured(id)) return { status: 409, error: "Not from the Internet." };
    const crew = sim.crews.crewOf(id);
    if (crew === null) return { status: 409, error: "Found a crew first." };
    const to = this.person(sim, str(body, "to"));
    const bad = this.targetRefusal(sim, id, to) ?? CrewRoutes.anchored(sim, to!, crew.id, false);
    if (bad !== null) return bad;
    return this.send(sim, id, to!, "crew", crew.id, res);
  }

  private recruit(sim: Sim, id: string, body: Record<string, unknown>, res: ServerResponse): Refusal | null {
    if (sim.isRestricted(id)) return { status: 403, error: "Not while you're restricted." };
    if (sim.isCaptured(id)) return { status: 409, error: "Not from the Internet." };
    const to = this.person(sim, str(body, "to"));
    const bad = this.targetRefusal(sim, id, to);
    if (bad !== null) return bad;
    const name = nameOf(sim, to!);
    const named = str(body, "side").trim();
    let side: string | null;
    if (named !== "") {
      side = guestSide(sim, named);
      if (side === null) return { status: 403, error: "that side isn't open" };
      if (sim.factionOf(id) !== side) return { status: 403, error: `Join ${side} first, then recruit for it.` };
    } else side = sim.crews.sideOf(id);
    if (side === null) {
      const crew = sim.crews.crewOf(id);
      if (crew !== null) {
        const anchored = CrewRoutes.anchored(sim, to!, crew.id, false);
        if (anchored !== null) return anchored;
        return this.send(sim, id, to!, "crew", crew.id, res);
      }
      return { status: 409, error: `Join a side first, then scan ${name}'s pass to recruit them.` };
    }
    if (sim.factionOf(to!) === side) return { status: 409, error: `${name} is already in ${side}.` };
    const led = sim.crews.ledSide(to!);
    if (led !== null && led !== side) return { status: 409, error: `${name} leads ${led}. Leaders stay with their side.` };
    const anchored = CrewRoutes.anchored(sim, to!, side, false);
    if (anchored !== null) return anchored;
    return this.send(sim, id, to!, "side", side, res);
  }

  private send(sim: Sim, by: string, to: string, kind: "crew" | "side", target: string, res: ServerResponse): Refusal | null {
    const crews = sim.crews;
    const name = nameOf(sim, to);
    if (kind === "crew" && crews.crewOf(to)?.id === target) return { status: 409, error: `${name} is already in ${crews.get(target)!.name}.` };
    const waiting = crews.openInvite(by, to, kind, target);
    if (waiting !== null) {
      sendJson(res, 200, { ok: true, invite: waiting.id, kind, target, targetName: crews.targetName(waiting), already: true });
      return null;
    }
    if (crews.openInvitesTo(to).length >= MAX_OPEN_INVITES_TO) return { status: 429, error: `${name} has a lot of invitations waiting. Try again in a bit.` };
    if (this.throttled(by)) return { status: 429, error: "slow down — wait a minute" };
    this.commit(sim, kind === "crew" ? { op: "crewInvite", by, to, crew: target } : { op: "recruit", by, to, side: target });
    const made = crews.openInvite(by, to, kind, target);
    if (made === null) return { status: 409, error: "That invitation didn't go through." };
    sendJson(res, 200, { ok: true, invite: made.id, kind, target, targetName: crews.targetName(made) });
    return null;
  }

  private answer(sim: Sim, id: string, body: Record<string, unknown>, res: ServerResponse): Refusal | null {
    const crews = sim.crews;
    const invite = crews.invite(str(body, "id"));
    if (invite === null || invite.to !== id) return { status: 404, error: "no such invitation for you" };
    if (invite.state !== "open") return { status: 409, error: "That invitation was already answered." };
    const yes = body["yes"] === true;
    if (yes) {
      if (sim.isRestricted(id)) return { status: 403, error: "you're restricted — the story has to lift it first" };
      if (sim.isCaptured(id)) return { status: 409, error: "Not from the Internet." };
      if (invite.kind === "side") {
        // The same rule as `/api/guest/join` (D7): a declared, joinable,
        // revealed side only.
        if (guestSide(sim, invite.target) === null) return { status: 403, error: "that side isn't open" };
        const led = crews.ledSide(id);
        if (led !== null && led !== invite.target) return { status: 409, error: "Leaders stay with their side." };
      } else if (crews.get(invite.target) === null) return { status: 409, error: `That ${CrewRoutes.word(sim)} is gone.` };
      // Faction mode: a founder or a leader says yes only into their own
      // faction (the engine voids such a yes on replay too).
      const anchored = CrewRoutes.anchored(sim, id, invite.target, true);
      if (anchored !== null) return anchored;
    }
    const targetName = crews.targetName(invite);
    this.commit(sim, invite.kind === "crew" ? { op: "crewAnswer", id: invite.id, yes } : { op: "recruitAnswer", id: invite.id, yes });
    sendJson(res, 200, { ok: true, joined: yes, kind: invite.kind, target: invite.target, targetName });
    return null;
  }

  /** Handle a director crew route (the caller is a moderator); false when
   *  `path` isn't one. */
  handleMod(res: ServerResponse, path: string, body: Record<string, unknown>): boolean {
    if (!(CREW_MOD_ROUTES as readonly string[]).includes(path)) return false;
    const sim = this.host.sim();
    if (sim === null) {
      sendJson(res, 409, { error: "no story loaded" });
      return true;
    }
    const crew = sim.crews.get(str(body, "crew").trim());
    if (crew === null) {
      sendJson(res, 404, { error: "no such crew" });
      return true;
    }
    if (path === "/api/mod/crew/dissolve") {
      this.commit(sim, { op: "dissolveCrew", crew: crew.id });
      sendJson(res, 200, { ok: true });
      return true;
    }
    const raw = str(body, "name");
    const name = cleanGuestName(raw);
    const refusal = crewNameRefusal(sim, raw, this.host.facts(), crew.id);
    if (refusal !== null) {
      sendJson(res, 400, { error: refusal });
      return true;
    }
    this.commit(sim, { op: "renameCrew", crew: crew.id, name });
    sendJson(res, 200, { ok: true, crew: sim.crews.crewView(crew) });
    return true;
  }
}
