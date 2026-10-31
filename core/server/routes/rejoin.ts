//! Wave 23 — getting back in. A guest whose camera opened another browser,
//! who cleared their tabs, or who tapped *Leave the event* used to need a
//! director's re-pair QR (N-02): their program stays claimed, so picking it
//! again is 409 "taken". Three ways back in now, none of them a director:
//!
//! **Badges.** The crew prints a stack of blank ID badges before the show
//! (Run → Print sheet, `POST /api/mod/badges {count}`). Badge *n* carries a
//! QR `…/?code=<guest code>&badge=<code>`, `code` = `secretCode(secret,
//! "badge:<n>", 8)`: the event's claim secret, so End → relaunch keeps every
//! printed badge good, and the server checks a badge by recomputing (no
//! table of printed badges). A guest **links** their badge when they join
//! (`register {…, badge}`) or later (`POST /api/guest/badge {badge}`, their
//! token). From then on:
//! - `POST /api/guest/enter {passcode, badge}` (no token: the badge is the
//!   credential) mints a token for the badge's Person — the same person,
//!   codex, score — unless a phone holds them (**One holder**, below).
//! - The badge is their pass: `/api/scan` and `/api/mod/scan` take a badge
//!   (code or link) as `target` and resolve it to the Person. That only
//!   reads, so a held badge still passes.
//! **Invited badges** (wave 54). Each reserved program has its own badge,
//! printed with its name: `…/?code=<guest code>&claim=<token>&badge=<code>`,
//! so the one QR opens the program to its invitee, links at join and is their
//! pass at the door. Its number sits past the blank stack (`invitedBadge`), so
//! no blank badge ever shares it. A blank link's code still works alone; a
//! claim alone (an invitation handed out before wave 54) still joins.
//!
//! One badge per Person (linking another frees the first), one Person per
//! badge. The links are persisted (`badges.json`, like the guest tokens —
//! not journaled: a badge is not a story fact) and cut by every story
//! restart, with the Persons they point at. Whoever holds a free badge can
//! sign in as its guest — it is worn, so that is the trade: the play app
//! never offers a *signed-in* guest a switch from a badge link (someone
//! else's badge reads as their pass).
//!
//! **Invitations.** A featured guest's claim QR (W-03) gets them back in
//! too: `enter {passcode, claim}` resumes the reserved program's Person once
//! it has joined (before that it answers `fresh`, and the join goes on).
//!
//! **Ask a host.** `POST /api/guest/rejoin {passcode, name}` opens a
//! request for a joined program (`POST /api/guest/rejoin/names {passcode}`
//! lists them for the picker); `{passcode, badge, claim?}`, `{passcode,
//! claim}` and `{passcode, part}` open one for what the refused card names,
//! and `{passcode: <performer code>, character}` for a part on the booth's
//! picker. It shows on every host's Needs and on the director phone
//! (`rejoins` on the host and cue-sheet views); a host taps Approve (`POST
//! /api/mod/guest/rejoin {request, approve}`, on the host allowlist), which
//! moves nothing yet. The hand-over happens when the waiting phone's `POST
//! /api/guest/rejoin/poll {request}` collects it: the old phone is signed out
//! and the poll answers a fresh token (a part's answer says `part: true`, with
//! the booth's capabilities), so an approved ask nobody is waiting on changes
//! nothing. A poll answered into thin air is asked again and gets the same
//! token for `REJOIN_RETRY_MS`. `POST /api/guest/rejoin/cancel {request}` is
//! the waiting phone giving up. Any sign-in or release of that Person or part
//! closes its open asks: they leave Needs, an Approve is refused, and the
//! phone's next poll answers `closed` once, so it goes back to its card.
//! Requests live in memory (`REJOIN_TTL_MS`, ten minutes; a newer one for the
//! same Person replaces the older; a story restart clears them).
//!
//! **The house is one IP** (wave 59). A phone's wrong code must never lock the
//! whole house out of here, as ten misses in five minutes would (the default;
//! `LOOM_RL_LOGIN_FAILURES`). So a wrong badge answers its 404 and counts
//! against nobody: it is 40 bits against a few hundred printed, a typo is the
//! likely reason, and what a lucky guess opens is one guest, who is refused if
//! a phone holds them. The lockout itself passes what guesses at nothing it
//! guards (`passesLockout`): the guest code with a badge, a name, or a part or
//! a claim that is **real**, so a staff or invited badge and Ask a host on one
//! always work, and a poll or a cancel, so a waiting phone can collect. A wrong
//! event code, a wrong part and a wrong claim still count and stay locked. Right
//! and wrong read apart in a lockout, on purpose: a part or a claim is 50 bits
//! (`secretCode`), not a speakable code, and this answer takes the guest code to
//! ask. The performer and mod codes stay behind it, right or wrong. The join
//! boxes never send a guess here: a typed code goes to `/api/resolve-code`
//! first, and *Get back in* sends only a badge's shape.
//!
//! **Cast cards.** Each part's cast card carries `…/?code=<prime
//! code>&part=<code>`, `code` = `secretCode(secret, "part:<folded name>")`.
//! `/api/prime/login {passcode, part}` signs in as that part.
//! Wave 54: the printed link carries the **guest** code (`…/?code=<guest
//! code>&part=<code>`): a `rotate: "staff"` launch mints a new performer
//! code, and a printed badge must outlive that. The login takes the guest
//! code only beside a valid `part`; a link with the old performer code
//! still works.
//!
//! **One holder** (wave 59; overrules wave 23's take-over and wave 54's
//! "the old phone's tokens stay good"). A part or a Person is one phone's:
//! a staff badge, an invited badge, a linked blank badge, a claim link, and
//! the code printed on any of them all answer `409 {error, held: true,
//! name?, ref?}` while a phone holds it (`heldAnswer`: only what is printed
//! on that card, so a blank badge never names its program). The rule lives
//! in `enter` and `/api/prime/login`, so a typed code inherits it. The
//! holder's own phone (its live `token` on the same call) carries on, and
//! no second token is minted for it. Held means a live token or session:
//! being offline is no release. Released means the holder's own Leave the
//! event (`/api/guest/logout`) or Sign out (`/api/prime/logout`), ⏏ Release
//! (`/api/mod/prime/release`, `/api/mod/guest/release`, both on the host
//! allowlist), a collected ask, a spent N-02 re-pair, or a story restart for
//! a guest (a booth survives a plain restart, as it always has, and Go live
//! frees every part). Every release signs the old phone out.
//!
//! `register` answers the same way when it is sent a card: a card that is a
//! Person's is that Person's (`joinCard`: refused while held, signed in once
//! free, never a second Person), so the loser of a race lands on the refused
//! screen. A program picked with no card keeps its plain `taken`.
//!
//! **An invited badge is its own program's** (wave 59). Its number names its
//! reserved program (`invitedProgram`, the order `Claims.links` prints), so a
//! missing claim behaves as a present one: `enter` signs in or refuses by the
//! number, and on a program nobody has joined hands the join its `claim`. It
//! never links to any other Person: `linkFor` and `register` answer `409
//! {error, reserved: true, name}`.

import { randomBytes, randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";

import { foldName } from "../../src/parser/names.ts";
import type { Sim } from "../../src/runtime/sim/index.ts";
import { sendJson, str } from "../http-util.ts";
import { codeEquals, normalizeCode, secretCode } from "../identity.ts";
import { partName } from "../unseen-directors.ts";

export const ENTER_ROUTE = "/api/guest/enter";
export const BADGE_ROUTE = "/api/guest/badge";
export const REJOIN_ROUTE = "/api/guest/rejoin";
export const REJOIN_NAMES_ROUTE = "/api/guest/rejoin/names";
export const REJOIN_POLL_ROUTE = "/api/guest/rejoin/poll";
export const REJOIN_CANCEL_ROUTE = "/api/guest/rejoin/cancel";
export const REJOIN_DECIDE_ROUTE = "/api/mod/guest/rejoin";
export const BADGES_ROUTE = "/api/mod/badges";

/** The highest blank badge number the server prints. */
export const BADGE_MAX = 600;
/** Numbers past the blank stack, one per reserved program (wave 54). */
export const INVITED_BADGES = 40;
/** Characters in a badge code (40 bits against a few hundred printed). */
export const BADGE_LENGTH = 8;
/** How long a rejoin request waits for a host. */
export const REJOIN_TTL_MS = 10 * 60_000;
/** How long a collected ask answers a retried poll. Short: hosts read
 *  request ids, and only the phone that lost its answer needs this. */
export const REJOIN_RETRY_MS = 60_000;
/** Open requests kept at once (a flood drops the oldest). */
export const REJOIN_MAX = 40;

/** Badge `n`'s code. */
export function badgeCode(secret: string, n: number): string {
  return secretCode(secret, `badge:${n}`, BADGE_LENGTH);
}

/** The number on the `i`th reserved program's badge. Never a blank's. */
export function invitedBadge(i: number): number {
  return BADGE_MAX + 1 + i;
}

/** The ref printed on the `i`th reserved program's badge. */
export function invitedRef(i: number): string {
  return `F${String(i + 1).padStart(2, "0")}`;
}

/** The ref printed on blank badge `n`. */
export function blankRef(n: number): string {
  return `B${String(n).padStart(3, "0")}`;
}

/** What is printed on a card, all a refusal may say of who it is. */
export interface Shown {
  name?: string;
  ref?: string;
}

/** The sentence a held card answers with (the phone says it its own way). */
export const HELD_ERROR = "that is signed in on another phone";

/** A `409`'s body for a card a phone holds. */
export function heldAnswer(shown: Shown, error = HELD_ERROR): { error: string; held: true } & Shown {
  return { error, held: true, ...shown };
}

/** A `409`'s body for an invited badge offered to any other program. */
export function reservedAnswer(program: string): { error: string; reserved: true; name: string } {
  return { error: `that badge is saved for ${program}`, reserved: true, name: program };
}

/** A part's cast-card code. */
export function partCode(secret: string, character: string): string {
  return secretCode(secret, `part:${foldName(character)}`);
}

/** The printed form of a code: upper case in groups of four. */
export function printedCode(code: string): string {
  return code.toUpperCase().replace(/(.{4})(?=.)/gu, "$1-");
}

/** A badge as scanned or typed — its link (`…&badge=`), or the code with
 *  any case, spaces and dashes — normalized; null when it can't be one. */
export function badgeFromText(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return null;
  let code = text;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(text) || text.startsWith("/") || text.startsWith("?")) {
    try {
      const url = new URL(text, "http://x");
      code = url.searchParams.get("badge") ?? "";
    } catch {
      return null;
    }
  }
  const n = normalizeCode(code);
  return /^[0-9a-hjkmnp-tv-z]{8}$/u.test(n) ? n : null;
}

/** A badge's printed link. */
export function badgeUrl(base: string, guestCode: string, code: string): string {
  return `${base.replace(/\/+$/u, "")}/?code=${encodeURIComponent(guestCode)}&badge=${encodeURIComponent(code)}`;
}

/** A cast card's link. */
export function partUrl(base: string, primeCode: string, code: string): string {
  return `${base.replace(/\/+$/u, "")}/?code=${encodeURIComponent(primeCode)}&part=${encodeURIComponent(code)}`;
}

/** The badge numbers ↔ the Persons they are linked to. Pure, no I/O. */
export class BadgeBook {
  private readonly byNumber = new Map<number, string>();
  private codes: Map<string, number> | null = null;

  constructor(private readonly secret: () => string) {}

  /** The badge a code (already normalized) is, or null. Constant-time per
   *  candidate; the table is built once per secret. */
  numberOf(code: string): number | null {
    if (this.codes === null) {
      this.codes = new Map();
      for (let n = 1; n <= BADGE_MAX + INVITED_BADGES; n++) this.codes.set(badgeCode(this.secret(), n), n);
    }
    const n = this.codes.get(code);
    return n !== undefined && codeEquals(code, badgeCode(this.secret(), n)) ? n : null;
  }

  holder(n: number): string | null {
    return this.byNumber.get(n) ?? null;
  }

  badgeOf(id: string): number | null {
    for (const [n, who] of this.byNumber) if (who === id) return n;
    return null;
  }

  /** Link badge `n` to `id`, freeing any other badge `id` had. */
  link(n: number, id: string): void {
    for (const [m, who] of [...this.byNumber]) if (who === id) this.byNumber.delete(m);
    this.byNumber.set(n, id);
  }

  clear(): void {
    this.byNumber.clear();
  }

  entries(): Array<[number, string]> {
    return [...this.byNumber];
  }

  load(entries: unknown): void {
    this.byNumber.clear();
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      if (Array.isArray(e) && typeof e[0] === "number" && typeof e[1] === "string") this.byNumber.set(e[0], e[1]);
    }
  }
}

/** One phone asking to be a joined program again. */
export interface RejoinRequest {
  request: string;
  /** The Person they asked to be. */
  id: string;
  name: string;
  /** Wall ms the request opened. */
  at: number;
  /** `closed`: a sign-in or a release moved the Person or part on. */
  state: "pending" | "approved" | "denied" | "closed";
  /** Who decided (a host's character, or "director"). */
  by?: string;
  /** Minted when the waiting phone collects an approved ask (`handOver`). */
  token?: string;
  /** Wave 59: `id` is a part, not a Person. */
  part?: true;
  /** What the waiting phone is told before it is in: the name on its card
   *  ("" for a blank badge), when that isn't `name`. */
  shown?: string;
  /** The booth's capabilities, set at the hand-over (a part's ask). */
  grant?: BoothGrant;
}

/** What a host sees of an open request (`rejoins` on the host view). */
export interface RejoinRow {
  request: string;
  id: string;
  name: string;
  at: number;
  /** Wave 59: a part, not a Person. */
  part?: true;
  /** Does a phone hold it now? Approving signs that phone out. */
  held?: boolean;
}

/** A booth's capabilities at sign-in (`/api/prime/login`'s answer). */
export interface BoothGrant {
  admin: boolean;
  host: boolean;
  caller: boolean;
}

/** The open requests. Pure, clock-injected. */
export class RejoinDesk {
  private readonly requests = new Map<string, RejoinRequest>();

  constructor(
    private readonly now: () => number,
    private readonly mint: () => string = () => randomBytes(12).toString("base64url"),
  ) {}

  private sweep(): void {
    const now = this.now();
    for (const [k, r] of [...this.requests]) if (r.at + (r.token !== undefined ? REJOIN_RETRY_MS : REJOIN_TTL_MS) <= now) this.requests.delete(k);
  }

  /** Open a request for Person (or part) `id`; a newer one replaces theirs. */
  open(id: string, name: string, opts: { part?: boolean; shown?: string } = {}): RejoinRequest {
    this.sweep();
    for (const [k, r] of [...this.requests]) if (r.id === id) this.requests.delete(k);
    while (this.requests.size >= REJOIN_MAX) {
      const oldest = this.requests.keys().next().value;
      if (oldest === undefined) break;
      this.requests.delete(oldest);
    }
    const r: RejoinRequest = { request: this.mint(), id, name, at: this.now(), state: "pending", ...(opts.part === true ? { part: true } : {}), ...(opts.shown !== undefined ? { shown: opts.shown } : {}) };
    this.requests.set(r.request, r);
    return r;
  }

  get(request: string): RejoinRequest | null {
    this.sweep();
    return this.requests.get(request) ?? null;
  }

  /** A host's answer, which moves nothing until the phone collects it. Null
   *  when the request is gone or already answered. */
  decide(request: string, approve: boolean, by: string): RejoinRequest | null {
    const r = this.get(request);
    if (r === null || r.state !== "pending") return null;
    r.state = approve ? "approved" : "denied";
    r.by = by;
    // The answer's own ten minutes: the waiting phone still has to collect.
    r.at = this.now();
    return r;
  }

  /** The phone heard a `denied` or `closed`: that ask is done. */
  done(request: string): void {
    this.requests.delete(request);
  }

  /** The waiting phone gave up. One that collected is past calling back. */
  cancel(request: string): boolean {
    const r = this.requests.get(request);
    return r !== undefined && r.token === undefined && this.requests.delete(request);
  }

  /** A sign-in or a release of `id`: every ask still open on it ends, an
   *  approved one nobody has collected too. True when one did. */
  close(id: string): boolean {
    let closed = false;
    for (const r of this.requests.values()) {
      if (r.id !== id || r.token !== undefined || (r.state !== "pending" && r.state !== "approved")) continue;
      r.state = "closed";
      r.at = this.now();
      closed = true;
    }
    return closed;
  }

  pending(): RejoinRow[] {
    this.sweep();
    return [...this.requests.values()].filter((r) => r.state === "pending").map(({ request, id, name, at, part }) => ({ request, id, name, at, ...(part === true ? { part } : {}) }));
  }

  clear(): void {
    this.requests.clear();
  }
}

/** What the routes need from their `EventRuntime`. */
export interface RejoinHost {
  sim(): Sim | null;
  /** The event's claim secret (badges and cast cards derive from it). */
  secret(): string;
  /** Is `passcode` the guest code? */
  guestCode(passcode: string): boolean;
  /** Is `passcode` the performer code? */
  primeCode(passcode: string): boolean;
  /** Bind a fresh guest token to `id` and persist the token table. */
  addGuestToken(token: string, id: string): void;
  /** Does a phone hold guest `id` (a live token)? */
  guestHeld(id: string): boolean;
  /** The guest a phone's own token stands for (never a play-as), or null. */
  tokenGuest(token: string | undefined): string | null;
  /** Sign guest `id`'s phone out: tokens, streams, push devices, and the
   *  Home Screen codes that would bring it back. */
  revokeGuest(id: string): number;
  /** Is `id` a director's persona (not a phone's guest)? */
  isPersona(id: string): boolean;
  /** The reserved program a claim unlocks, or null. */
  claimed(claim: string): string | null;
  /** The reserved program invited badge `n` was printed for, or null. */
  invitedProgram(n: number): string | null;
  /** The claim that opens reserved program `character`. */
  claimFor(character: string): string;
  /** The part a staff badge's code (normalized) signs in as, or null. */
  partOfCode(code: string): string | null;
  /** `name` when it is a part someone could sign in as, or null. */
  partNamed(name: string): string | null;
  /** Does a booth hold `character`? */
  partHeld(character: string): boolean;
  /** Sign whichever booth holds `character` out. */
  releasePart(character: string): void;
  /** Bind a fresh booth token to `character`. */
  signInPart(token: string, character: string): BoothGrant;
  /** Persist the badge links. */
  saveBadges(entries: Array<[number, string]>): void;
  /** Something hosts see changed (the host view's cache must rebuild). */
  changed(): void;
  /** A badge was linked: the guest's own view (`badge`) changed. */
  linked?(): void;
  joinBase(): string;
  eventCode(): string;
  now(): number;
  mint?: () => string;
}

/** The answer `enter` gives a phone. */
export type EnterAnswer = { ok: true; resumed: true; id: string; name: string; token: string; badge?: number } | { ok: true; resumed: false; badge?: number; claim?: string };

/** A presented badge or invitation: not tonight's, nobody's yet (`program`
 *  when it is printed for one), or a Person's. */
type Card = { kind: "unknown"; error: string } | { kind: "fresh"; badge?: number; program?: string } | PersonCard;
type PersonCard = { kind: "person"; id: string; badge?: number; shown: Shown };

/** What a card sent with a `register` means. */
export type JoinCard =
  /** Nothing in the way; `badge` links to the new Person. */
  | { kind: "join"; badge: number | null }
  /** It is that Person's: `resume` answers. */
  | PersonCard
  /** An invited badge, and the join is for another program. */
  | { kind: "reserved"; name: string };

export class Rejoin {
  readonly badges: BadgeBook;
  readonly desk: RejoinDesk;

  constructor(private readonly host: RejoinHost) {
    this.badges = new BadgeBook(() => host.secret());
    this.desk = new RejoinDesk(() => host.now());
  }

  private mint(): string {
    return (this.host.mint ?? randomUUID)();
  }

  /** A story restart: the Persons are gone, so are their links and asks. */
  clear(): void {
    this.badges.clear();
    this.host.saveBadges([]);
    this.desk.clear();
    this.host.changed();
  }

  /** The joined guests (never personas), by Person id. */
  private guests(): Array<{ id: string; name: string }> {
    const sim = this.host.sim();
    if (sim === null) return [];
    return [...sim.persons.values()].filter((p) => !this.host.isPersona(p.id)).map((p) => ({ id: p.id, name: p.name }));
  }

  /** The Person a badge (code or link) is linked to, or null. */
  holderOf(raw: string): string | null {
    const code = badgeFromText(raw);
    const n = code === null ? null : this.badges.numberOf(code);
    const id = n === null ? null : this.badges.holder(n);
    return id !== null && this.host.sim()?.persons.has(id) === true ? id : null;
  }

  /** `scan` targets: a Person id passes through, a linked badge becomes its Person. */
  scanTarget(target: string): string {
    if (this.host.sim()?.persons.has(target) === true) return target;
    return this.holderOf(target) ?? target;
  }

  /** The program printed on badge `n`: none for a blank. */
  private programOf(n: number): string | null {
    return n > BADGE_MAX ? this.host.invitedProgram(n) : null;
  }

  /** The claim an invited badge carries (a join sent only the badge), or null. */
  claimOn(raw: string): string | null {
    const code = badgeFromText(raw);
    const n = code === null ? null : this.badges.numberOf(code);
    const program = n === null ? null : this.programOf(n);
    return program === null ? null : this.host.claimFor(program);
  }

  /** What `register`'s card means for a join as `name`. Run it again after
   *  any await: it is what keeps two phones off one card. */
  joinCard(rawBadge: string, claim: string | null, name: string): JoinCard {
    const card = rawBadge === "" && claim === null ? null : this.cardOf(rawBadge, claim ?? "");
    if (card === null || card.kind === "unknown") return { kind: "join", badge: null };
    if (card.kind === "person") {
      // A bare invitation speaks only for its own program: a phone that kept
      // one may still pick another.
      return rawBadge === "" && foldName(card.shown.name ?? "") !== foldName(name) ? { kind: "join", badge: null } : card;
    }
    if (card.program !== undefined && foldName(card.program) !== foldName(name)) return { kind: "reserved", name: card.program };
    return { kind: "join", badge: card.badge ?? null };
  }

  link(n: number, id: string): void {
    this.badges.link(n, id);
    this.host.saveBadges(this.badges.entries());
    this.host.linked?.();
  }

  /** Does this public call pass a lockout on its IP (**The house is one IP**,
   *  above)? A poll or a cancel carries its request id, 96 random bits. A call
   *  with the guest code and a badge or a name has nothing in it the lockout
   *  guards, and one with a real part or a real claim is a printed card, not a
   *  guess. A wrong part or claim is one, and stays behind it. */
  passesLockout(path: string, body: Record<string, unknown>): boolean {
    if (path === REJOIN_POLL_ROUTE || path === REJOIN_CANCEL_ROUTE) return true;
    if (!this.host.guestCode(str(body, "passcode"))) return false;
    const part = normalizeCode(str(body, "part"));
    const claim = str(body, "claim");
    return (part === "" || this.host.partOfCode(part) !== null) && (claim === "" || this.host.claimed(claim) !== null);
  }

  /** Public routes (a phone's own `token`, if it has one, only proves it is
   *  the holder). Returns false when `path` isn't one. The caller throttles;
   *  `failed` says a wrong code was presented: a wrong event code, part or
   *  claim, never a wrong badge. */
  handlePublic(path: string, res: ServerResponse, body: Record<string, unknown>, token?: string): { handled: boolean; failed: boolean } {
    switch (path) {
      case ENTER_ROUTE:
        return { handled: true, failed: this.enter(res, body, token) };
      case REJOIN_NAMES_ROUTE:
        return { handled: true, failed: this.names(res, body) };
      case REJOIN_ROUTE:
        return { handled: true, failed: this.ask(res, body) };
      case REJOIN_POLL_ROUTE:
        this.poll(res, body);
        return { handled: true, failed: false };
      case REJOIN_CANCEL_ROUTE:
        this.cancel(res, body);
        return { handled: true, failed: false };
      default:
        return { handled: false, failed: false };
    }
  }

  /** Answers for a wrong guest code or closed doors: "wrong" / "closed", else null. */
  private closed(res: ServerResponse, body: Record<string, unknown>): "wrong" | "closed" | null {
    if (!this.host.guestCode(str(body, "passcode"))) {
      sendJson(res, 403, { error: "wrong event code" });
      return "wrong";
    }
    if (this.host.sim() === null) {
      sendJson(res, 409, { error: "doors are closed" });
      return "closed";
    }
    return null;
  }

  /** `POST /api/guest/enter {passcode, badge? , claim?}`: an invited badge
   *  sends both. True on a wrong code. */
  private enter(res: ServerResponse, body: Record<string, unknown>, token: string | undefined): boolean {
    const shut = this.closed(res, body);
    if (shut !== null) return shut === "wrong";
    const rawBadge = str(body, "badge");
    const claim = str(body, "claim");
    if (rawBadge === "" && claim === "") {
      sendJson(res, 400, { error: "a badge or an invitation, please" });
      return false;
    }
    const card = this.cardOf(rawBadge, claim);
    if (card.kind === "unknown") {
      sendJson(res, 404, { error: card.error });
      return rawBadge === "";
    }
    if (card.kind === "fresh") sendJson(res, 200, { ok: true, resumed: false, ...(card.badge !== undefined ? { badge: card.badge } : {}), ...(card.program !== undefined ? { claim: this.host.claimFor(card.program) } : {}) } satisfies EnterAnswer);
    else this.resume(res, card, token);
    return false;
  }

  /** Whose a presented badge or invitation is. */
  private cardOf(rawBadge: string, claim: string): Card {
    if (rawBadge !== "") {
      const code = badgeFromText(rawBadge);
      const n = code === null ? null : this.badges.numberOf(code);
      if (n === null) return { kind: "unknown", error: "that isn't one of tonight's badges" };
      const program = this.programOf(n);
      if (n > BADGE_MAX && program === null) return { kind: "unknown", error: "that isn't one of tonight's badges" };
      const id = this.holderOf(code!) ?? this.joinedWithoutBadge(n, program);
      if (id === null) return { kind: "fresh", badge: n, ...(program !== null ? { program } : {}) };
      return { kind: "person", id, badge: n, shown: this.printedOn(n, id) };
    }
    const character = this.host.claimed(claim);
    if (character === null) return { kind: "unknown", error: "that invitation isn't one of tonight's" };
    const hit = this.joinedAs(character);
    return hit === undefined ? { kind: "fresh" } : { kind: "person", id: hit.id, shown: { name: character } };
  }

  /** What badge `n` has printed on it: a blank only its ref. */
  private printedOn(n: number, id: string): Shown {
    if (n <= BADGE_MAX) return { ref: blankRef(n) };
    const name = this.host.sim()?.persons.get(id)?.name;
    return { ref: invitedRef(n - BADGE_MAX - 1), ...(name !== undefined ? { name } : {}) };
  }

  /** The joined guest playing `character`. */
  private joinedAs(character: string): { id: string; name: string } | undefined {
    return this.guests().find((g) => foldName(g.name) === foldName(character));
  }

  /** An invited badge `n`, unlinked, whose program joined by a bare
   *  invitation: it links now and signs in as that guest. */
  private joinedWithoutBadge(n: number, program: string | null): string | null {
    const hit = program === null ? undefined : this.joinedAs(program);
    if (hit === undefined) return null;
    this.link(n, hit.id);
    return hit.id;
  }

  /** In as `card`'s Person: the holder's own phone carries on, a free
   *  Person gets a fresh token, and a held one is refused. */
  resume(res: ServerResponse, card: PersonCard, token: string | undefined): void {
    const { id, badge } = card;
    const person = this.host.sim()!.persons.get(id)!;
    let handed = token;
    if (handed === undefined || this.host.tokenGuest(handed) !== id) {
      if (this.host.guestHeld(id)) {
        sendJson(res, 409, heldAnswer(card.shown));
        return;
      }
      handed = this.mint();
      this.host.addGuestToken(handed, id);
      this.closeAsks(id);
    }
    sendJson(res, 200, { ok: true, resumed: true, id, name: person.name, token: handed, ...(badge !== undefined ? { badge } : {}) } satisfies EnterAnswer);
  }

  /** `POST /api/guest/rejoin/names {passcode}` → the joined programs. */
  private names(res: ServerResponse, body: Record<string, unknown>): boolean {
    const shut = this.closed(res, body);
    if (shut !== null) return shut === "wrong";
    const names = this.guests()
      .map((g) => g.name)
      .sort((a, b) => a.localeCompare(b));
    sendJson(res, 200, { ok: true, names });
    return false;
  }

  /** `POST /api/guest/rejoin {passcode, name | badge | claim | part |
   *  character}` → `{ok, request, name}`. */
  private ask(res: ServerResponse, body: Record<string, unknown>): boolean {
    const part = normalizeCode(str(body, "part"));
    if (part !== "" || str(body, "character") !== "") return this.askPart(res, body, part);
    const shut = this.closed(res, body);
    if (shut !== null) return shut === "wrong";
    const rawBadge = str(body, "badge");
    const claim = str(body, "claim");
    if (rawBadge !== "" || claim !== "") {
      const card = this.cardOf(rawBadge, claim);
      if (card.kind === "unknown") {
        sendJson(res, 404, { error: card.error });
        return rawBadge === "";
      }
      if (card.kind === "fresh") {
        sendJson(res, 404, { error: "nobody has joined on that card" });
        return false;
      }
      this.opened(res, this.desk.open(card.id, this.host.sim()!.persons.get(card.id)!.name, { shown: card.shown.name ?? "" }));
      return false;
    }
    const want = foldName(str(body, "name"));
    const hit = want === "" ? undefined : this.guests().find((g) => foldName(g.name) === want);
    if (hit === undefined) {
      sendJson(res, 404, { error: "nobody has joined as that program" });
      return false;
    }
    this.opened(res, this.desk.open(hit.id, hit.name));
    return false;
  }

  /** A performer's ask: a staff badge (the guest code it prints, or an old
   *  card's performer code), or a held part on the booth's picker (the
   *  performer code). Works before the doors, as a booth's sign-in does. */
  private askPart(res: ServerResponse, body: Record<string, unknown>, part: string): boolean {
    const passcode = str(body, "passcode");
    if (!this.host.primeCode(passcode) && !(part !== "" && this.host.guestCode(passcode))) {
      sendJson(res, 403, { error: "wrong event code" });
      return true;
    }
    const named = part !== "" ? this.host.partOfCode(part) : str(body, "character");
    const character = named === null ? null : this.host.partNamed(named);
    if (character === null) {
      sendJson(res, 404, { error: "that isn't one of tonight's parts" });
      return part !== "";
    }
    this.opened(res, this.desk.open(character, character, { part: true }));
    return false;
  }

  private opened(res: ServerResponse, r: RejoinRequest): void {
    this.host.changed();
    sendJson(res, 200, { ok: true, request: r.request, name: r.shown ?? r.name, expiresAt: r.at + REJOIN_TTL_MS });
  }

  /** `POST /api/guest/rejoin/poll {request}` → its state (and, once, the token). */
  private poll(res: ServerResponse, body: Record<string, unknown>): void {
    const r = this.desk.get(str(body, "request"));
    if (r === null) {
      sendJson(res, 200, { ok: true, state: "expired" });
      return;
    }
    if (r.state === "pending") {
      sendJson(res, 200, { ok: true, state: "pending", name: r.shown ?? r.name });
      return;
    }
    if (r.state === "closed") {
      this.desk.done(r.request);
      sendJson(res, 200, { ok: true, state: "closed", name: r.shown ?? r.name });
      return;
    }
    if (r.state === "denied" || (r.part !== true && this.host.sim()?.persons.has(r.id) !== true)) {
      this.desk.done(r.request);
      sendJson(res, 200, { ok: true, state: "denied", name: r.shown ?? r.name, ...this.seenBy(r.by) });
      return;
    }
    const token = r.token ?? this.handOver(r);
    if (r.part === true) {
      sendJson(res, 200, { ok: true, state: "approved", part: true, character: r.id, name: r.name, token, ...r.grant, ...this.seenBy(r.by) });
      return;
    }
    sendJson(res, 200, { ok: true, state: "approved", id: r.id, name: r.name, token, ...this.seenBy(r.by) });
  }

  /** `POST /api/guest/rejoin/cancel {request}`: the waiting phone gave up. */
  private cancel(res: ServerResponse, body: Record<string, unknown>): void {
    if (this.desk.cancel(str(body, "request"))) this.host.changed();
    sendJson(res, 200, { ok: true });
  }

  /** A sign-in or a release of `id`: its open asks end. */
  closeAsks(id: string): void {
    if (this.desk.close(id)) this.host.changed();
  }

  /** Who decided, as the guest reads it: a host's part by name; a
   *  director never (the phone then says "A host"). */
  private seenBy(by: string | undefined): { by?: string } {
    const part = partName(by, this.host.sim()?.model ?? null);
    return part !== null ? { by: part } : {};
  }

  /** `POST /api/guest/badge {badge}` for guest `id` (their token). */
  linkFor(res: ServerResponse, id: string | null, body: Record<string, unknown>): void {
    if (id === null) {
      sendJson(res, 401, { error: "not signed in" });
      return;
    }
    const code = badgeFromText(str(body, "badge"));
    const n = code === null ? null : this.badges.numberOf(code);
    if (n === null) {
      sendJson(res, 404, { error: "that isn't one of tonight's badges" });
      return;
    }
    const program = this.programOf(n);
    const linked = this.holderOf(code!);
    if (linked === id) {
      sendJson(res, 200, { ok: true, badge: n, already: true });
      return;
    }
    // An invited badge whose program joined on a bare invitation is that
    // Person's, linked or not.
    const holder = linked ?? (program === null ? null : (this.joinedAs(program)?.id ?? null));
    if (holder !== null && holder !== id) {
      // Someone else's badge is their pass: the app opens it as one.
      sendJson(res, 409, { error: "that badge is someone else's", holder, name: this.host.sim()?.persons.get(holder)?.name ?? holder });
      return;
    }
    if (program !== null && foldName(this.host.sim()?.persons.get(id)?.name ?? "") !== foldName(program)) {
      sendJson(res, 409, reservedAnswer(program));
      return;
    }
    this.link(n, id);
    sendJson(res, 200, { ok: true, badge: n });
  }

  /** `POST /api/mod/guest/rejoin {request, approve}`; `by` names the deciding console. */
  decide(res: ServerResponse, body: Record<string, unknown>, by: string): void {
    const approve = body["approve"] === true;
    // A host booth acts as "Booth · <part>": the phone names the part.
    const r = this.desk.decide(str(body, "request"), approve, by.replace(/^Booth · /u, ""));
    if (r === null) {
      sendJson(res, 404, { error: "that request was answered or has expired" });
      return;
    }
    this.host.changed();
    sendJson(res, 200, { ok: true, request: r.request, state: r.state, name: r.name });
  }

  /** The waiting phone collects an approved ask: the old phone out, a new
   *  token in. Here and not at the Approve, so an ask nobody is waiting on
   *  changes nothing. */
  private handOver(r: RejoinRequest): string {
    const token = this.mint();
    // First: the release below closes every ask on `id` but a collected one.
    r.token = token;
    r.at = this.host.now();
    if (r.part === true) {
      this.host.releasePart(r.id);
      r.grant = this.host.signInPart(token, r.id);
    } else {
      this.host.revokeGuest(r.id);
      this.host.addGuestToken(token, r.id);
    }
    this.host.changed();
    return token;
  }

  /** The open asks for a host's view, with whether a phone holds each. */
  asks(): RejoinRow[] {
    return this.desk.pending().map((r) => ({ ...r, held: r.part === true ? this.host.partHeld(r.id) : this.host.guestHeld(r.id) }));
  }

  /** `POST /api/mod/badges {count?}` → the printable badges and who holds each. */
  printable(res: ServerResponse, body: Record<string, unknown>): void {
    const raw = Number(body["count"] ?? 60);
    const count = Number.isFinite(raw) ? Math.max(1, Math.min(BADGE_MAX, Math.floor(raw))) : 60;
    const from = Math.max(1, Math.min(BADGE_MAX, Math.floor(Number(body["from"] ?? 1)) || 1));
    const base = this.host.joinBase();
    const sim = this.host.sim();
    const badges = [];
    for (let n = from; n < from + count && n <= BADGE_MAX; n++) {
      const code = badgeCode(this.host.secret(), n);
      const holder = this.badges.holder(n);
      const name = holder === null ? null : (sim?.persons.get(holder)?.name ?? null);
      badges.push({ n, ref: blankRef(n), code: printedCode(code), url: badgeUrl(base, this.host.eventCode(), code), holder: name === null ? null : holder, name });
    }
    sendJson(res, 200, { ok: true, max: BADGE_MAX, badges });
  }
}
