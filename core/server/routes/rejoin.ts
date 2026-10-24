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
//!   credential) mints a fresh token for the badge's Person — the same
//!   person, codex, score; the old phone's tokens stay good (like N-02).
//! - The badge is their pass: `/api/scan` and `/api/mod/scan` take a badge
//!   (code or link) as `target` and resolve it to the Person.
//! One badge per Person (linking another frees the first), one Person per
//! badge. The links are persisted (`badges.json`, like the guest tokens —
//! not journaled: a badge is not a story fact) and cut by every story
//! restart, with the Persons they point at. Anyone holding the badge can
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
//! lists them for the picker). It shows on every host's Needs and on the
//! director phone (`rejoins` on the host and cue-sheet views); a host taps
//! Approve (`POST /api/mod/guest/rejoin {request, approve}`, on the host
//! allowlist) and the waiting phone's `POST /api/guest/rejoin/poll
//! {request}` picks up a fresh token once. Requests live in memory
//! (`REJOIN_TTL_MS`, ten minutes; a newer one for the same Person replaces
//! the older; a story restart clears them).
//!
//! **Cast cards.** Each part's cast card carries `…/?code=<prime
//! code>&part=<code>`, `code` = `secretCode(secret, "part:<folded name>")`.
//! `/api/prime/login {passcode, part}` signs in as that part and takes it
//! from whichever booth held it (that booth is signed out, as by a
//! director's ⏏ Release). The passcode picker still can't take a held part.

import { randomBytes, randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";

import { foldName } from "../../src/parser/names.ts";
import type { Sim } from "../../src/runtime/sim/index.ts";
import { sendJson, str } from "../http-util.ts";
import { codeEquals, normalizeCode, secretCode } from "../identity.ts";

export const ENTER_ROUTE = "/api/guest/enter";
export const BADGE_ROUTE = "/api/guest/badge";
export const REJOIN_ROUTE = "/api/guest/rejoin";
export const REJOIN_NAMES_ROUTE = "/api/guest/rejoin/names";
export const REJOIN_POLL_ROUTE = "/api/guest/rejoin/poll";
export const REJOIN_DECIDE_ROUTE = "/api/mod/guest/rejoin";
export const BADGES_ROUTE = "/api/mod/badges";

/** The highest badge number the server recognises (and prints). */
export const BADGE_MAX = 600;
/** Characters in a badge code (40 bits; wrong guesses are throttled). */
export const BADGE_LENGTH = 8;
/** How long a rejoin request waits for a host. */
export const REJOIN_TTL_MS = 10 * 60_000;
/** Open requests kept at once (a flood drops the oldest). */
export const REJOIN_MAX = 40;

/** Badge `n`'s code. */
export function badgeCode(secret: string, n: number): string {
  return secretCode(secret, `badge:${n}`, BADGE_LENGTH);
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
      for (let n = 1; n <= BADGE_MAX; n++) this.codes.set(badgeCode(this.secret(), n), n);
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
  state: "pending" | "approved" | "denied";
  /** Who decided (a host's character, or "director"). */
  by?: string;
  /** Minted on approve; handed to the polling phone once. */
  token?: string;
}

/** What a host sees of an open request (`rejoins` on the host view). */
export interface RejoinRow {
  request: string;
  id: string;
  name: string;
  at: number;
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
    for (const [k, r] of [...this.requests]) if (r.at + REJOIN_TTL_MS <= now) this.requests.delete(k);
  }

  /** Open a request for Person `id` (a newer one replaces theirs). */
  open(id: string, name: string): RejoinRequest {
    this.sweep();
    for (const [k, r] of [...this.requests]) if (r.id === id) this.requests.delete(k);
    while (this.requests.size >= REJOIN_MAX) {
      const oldest = this.requests.keys().next().value;
      if (oldest === undefined) break;
      this.requests.delete(oldest);
    }
    const r: RejoinRequest = { request: this.mint(), id, name, at: this.now(), state: "pending" };
    this.requests.set(r.request, r);
    return r;
  }

  get(request: string): RejoinRequest | null {
    this.sweep();
    return this.requests.get(request) ?? null;
  }

  /** A host's answer. Null when the request is gone or already answered. */
  decide(request: string, approve: boolean, by: string, token: () => string): RejoinRequest | null {
    const r = this.get(request);
    if (r === null || r.state !== "pending") return null;
    r.state = approve ? "approved" : "denied";
    r.by = by;
    if (approve) r.token = token();
    return r;
  }

  /** The phone picked up its answer: an approved or denied request is done. */
  collect(request: string): void {
    const r = this.requests.get(request);
    if (r !== undefined && r.state !== "pending") this.requests.delete(request);
  }

  pending(): RejoinRow[] {
    this.sweep();
    return [...this.requests.values()].filter((r) => r.state === "pending").map(({ request, id, name, at }) => ({ request, id, name, at }));
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
  /** Bind a fresh guest token to `id` and persist the token table. */
  addGuestToken(token: string, id: string): void;
  /** Is `id` a director's persona (not a phone's guest)? */
  isPersona(id: string): boolean;
  /** The reserved program a claim unlocks, or null. */
  claimed(claim: string): string | null;
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
export type EnterAnswer = { ok: true; resumed: true; id: string; name: string; token: string; badge?: number } | { ok: true; resumed: false; badge?: number };

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

  /** The badge number for register's `badge` field when it is free, else null. */
  freeBadge(raw: string): number | null {
    const code = badgeFromText(raw);
    const n = code === null ? null : this.badges.numberOf(code);
    if (n === null) return null;
    const holder = this.badges.holder(n);
    return holder === null || this.host.sim()?.persons.has(holder) !== true ? n : null;
  }

  link(n: number, id: string): void {
    this.badges.link(n, id);
    this.host.saveBadges(this.badges.entries());
    this.host.linked?.();
  }

  /** Public routes (no token). Returns false when `path` isn't one. The
   *  caller throttles; `failed` says a wrong code was presented. */
  handlePublic(path: string, res: ServerResponse, body: Record<string, unknown>): { handled: boolean; failed: boolean } {
    switch (path) {
      case ENTER_ROUTE:
        return { handled: true, failed: this.enter(res, body) };
      case REJOIN_NAMES_ROUTE:
        return { handled: true, failed: this.names(res, body) };
      case REJOIN_ROUTE:
        return { handled: true, failed: this.ask(res, body) };
      case REJOIN_POLL_ROUTE:
        this.poll(res, body);
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

  /** `POST /api/guest/enter {passcode, badge? | claim?}`. True on a wrong code. */
  private enter(res: ServerResponse, body: Record<string, unknown>): boolean {
    const shut = this.closed(res, body);
    if (shut !== null) return shut === "wrong";
    const rawBadge = str(body, "badge");
    if (rawBadge !== "") {
      const code = badgeFromText(rawBadge);
      const n = code === null ? null : this.badges.numberOf(code);
      if (n === null) {
        sendJson(res, 404, { error: "that isn't one of tonight's badges" });
        return true;
      }
      const id = this.holderOf(code!);
      if (id === null) {
        sendJson(res, 200, { ok: true, resumed: false, badge: n } satisfies EnterAnswer);
        return false;
      }
      this.resume(res, id, n);
      return false;
    }
    const claim = str(body, "claim");
    if (claim !== "") {
      const character = this.host.claimed(claim);
      if (character === null) {
        sendJson(res, 404, { error: "that invitation isn't one of tonight's" });
        return true;
      }
      const hit = this.guests().find((g) => foldName(g.name) === foldName(character));
      if (hit === undefined) sendJson(res, 200, { ok: true, resumed: false } satisfies EnterAnswer);
      else this.resume(res, hit.id);
      return false;
    }
    sendJson(res, 400, { error: "a badge or an invitation, please" });
    return false;
  }

  private resume(res: ServerResponse, id: string, badge?: number): void {
    const person = this.host.sim()!.persons.get(id)!;
    const token = this.mint();
    this.host.addGuestToken(token, id);
    sendJson(res, 200, { ok: true, resumed: true, id, name: person.name, token, ...(badge !== undefined ? { badge } : {}) } satisfies EnterAnswer);
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

  /** `POST /api/guest/rejoin {passcode, name}` → `{ok, request, name}`. */
  private ask(res: ServerResponse, body: Record<string, unknown>): boolean {
    const shut = this.closed(res, body);
    if (shut !== null) return shut === "wrong";
    const want = foldName(str(body, "name"));
    const hit = want === "" ? undefined : this.guests().find((g) => foldName(g.name) === want);
    if (hit === undefined) {
      sendJson(res, 404, { error: "nobody has joined as that program" });
      return false;
    }
    const r = this.desk.open(hit.id, hit.name);
    this.host.changed();
    sendJson(res, 200, { ok: true, request: r.request, name: r.name, expiresAt: r.at + REJOIN_TTL_MS });
    return false;
  }

  /** `POST /api/guest/rejoin/poll {request}` → its state (and, once, the token). */
  private poll(res: ServerResponse, body: Record<string, unknown>): void {
    const r = this.desk.get(str(body, "request"));
    if (r === null) {
      sendJson(res, 200, { ok: true, state: "expired" });
      return;
    }
    if (r.state === "pending") {
      sendJson(res, 200, { ok: true, state: "pending", name: r.name });
      return;
    }
    this.desk.collect(r.request);
    if (r.state === "denied" || this.host.sim()?.persons.has(r.id) !== true) {
      sendJson(res, 200, { ok: true, state: "denied", name: r.name, ...(r.by !== undefined ? { by: r.by } : {}) });
      return;
    }
    sendJson(res, 200, { ok: true, state: "approved", id: r.id, name: r.name, token: r.token, ...(r.by !== undefined ? { by: r.by } : {}) });
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
    const holder = this.holderOf(code!);
    if (holder === id) {
      sendJson(res, 200, { ok: true, badge: n, already: true });
      return;
    }
    if (holder !== null) {
      // Someone else's badge is their pass: the app opens it as one.
      sendJson(res, 409, { error: "that badge is someone else's", holder, name: this.host.sim()?.persons.get(holder)?.name ?? holder });
      return;
    }
    this.link(n, id);
    sendJson(res, 200, { ok: true, badge: n });
  }

  /** `POST /api/mod/guest/rejoin {request, approve}`; `by` names the deciding console. */
  decide(res: ServerResponse, body: Record<string, unknown>, by: string): void {
    const approve = body["approve"] === true;
    // A host booth acts as "Booth · <part>": the phone names the part.
    const r = this.desk.decide(str(body, "request"), approve, by.replace(/^Booth · /u, ""), () => this.mint());
    if (r === null) {
      sendJson(res, 404, { error: "that request was answered or has expired" });
      return;
    }
    if (approve && r.token !== undefined) this.host.addGuestToken(r.token, r.id);
    this.host.changed();
    sendJson(res, 200, { ok: true, request: r.request, state: r.state, name: r.name });
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
      badges.push({ n, ref: `B${String(n).padStart(3, "0")}`, code: printedCode(code), url: badgeUrl(base, this.host.eventCode(), code), holder: name === null ? null : holder, name });
    }
    sendJson(res, 200, { ok: true, max: BADGE_MAX, badges });
  }
}
