//! N-02 — re-pair a lost guest; N-10 — release a performer's part.
//!
//! **Re-pair** (`POST /e/:id/api/mod/guest/pair {id}`): a guest whose phone
//! died, whose browser was cleared, or whose camera opened a different
//! browser can't get back in — tokens are minted only at `register`, and
//! re-picking their program is 409 "taken" — so they would come back as a
//! new program and leave a ghost that still counts toward the majority.
//! The director mints a **single-use pair code** for the existing Person
//! (`PAIR_TTL_MS`, ten minutes; in memory, cut by every restart; a newer
//! code for the same guest voids the older) and shows it as a QR:
//! `<join base>/?code=<event>&pair=<code>`. The phone that opens it
//! exchanges the code at **`POST /e/:id/api/guest/resume {pair}`** for a
//! **fresh token** (persisted like a registration's, cut by every restart
//! like one) and strips the code from the URL. So a guest who copies their
//! own token can't hand themselves to someone else's phone, and no
//! long-lived credential ever sits in a URL. Wave 59: a Person is one
//! phone's (`routes/rejoin.ts`, One holder), so the spent code is a release:
//! the old phone is signed out as the new one comes in.
//! **`revokeOthers: true`** cuts it at once instead, before the code is
//! spent (a phone someone else picked up: its tokens, streams and push
//! devices go). A director's persona (`p-…`) is refused with 409: personas
//! are puppeted from the cockpit, never paired to a phone. Nothing is
//! journaled — a token is not a story fact.
//!
//! **Release** (`POST /e/:id/api/mod/prime/release {character}`): a part is
//! one performer's (`/api/prime/login` refuses a held part with 409) and
//! only Go live used to free parts, so a performer whose phone died was out
//! for the night. Release drops every session holding the part (an admin
//! session keeps its admin capability, loses the character) and closes its
//! booth streams; the performer re-signs on a loaner with the prime code.
//! The character's threads and buttons are story state — untouched.
//! A booth's own **Sign out** (`POST /e/:id/api/prime/logout`, its token)
//! frees its part the same way, so a performer moving to another phone (the
//! iPhone Home Screen icon, K-31b) needs no director.
//!
//! **A guest's release** (wave 59). `POST /e/:id/api/mod/guest/release {id}`
//! (on the host allowlist) and the phone's own Leave the event (`POST
//! /e/:id/api/guest/logout`, its token) sign the guest's phone out, so their
//! badge or invitation can sign in again. The Person, codex and score stay.
//!
//! **Home Screen nonce** (K-31b, `routes/k31b.ts`): behind `LOOM_HOMESCREEN`,
//! a guest mints a pair code for *themselves* (`POST /api/guest/homescreen`)
//! that their iPhone's Home Screen app spends at the same resume route. It
//! is its own kind of code: 12 h, the guest's newest `HOMESCREEN_KEEP` stay
//! good (Safari may reload the tab — and mint again — between Add to Home
//! Screen and the icon's first open), a director's QR and this never void
//! each other, and `revokeOthers` voids both. Spending it adds a token: it is
//! the same phone in its own browser, so it is the one sign-in that doesn't
//! sign the other out. Every release voids the guest's nonces.

import { randomBytes, randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { Sim } from "../../src/runtime/sim/index.ts";
import { sendJson, str } from "../http-util.ts";
import type { SessionStore } from "../session.ts";
import { HOMESCREEN_TTL_MS, homescreenEnabled, homescreenManifestPath } from "./k31b.ts";

export const PAIR_ROUTE = "/api/mod/guest/pair";
export const RELEASE_ROUTE = "/api/mod/prime/release";
/** Wave 59: sign a guest's phone out; their badge can sign in again. */
export const GUEST_RELEASE_ROUTE = "/api/mod/guest/release";
/** The phone's side: exchange a pair code for a guest token. */
export const RESUME_ROUTE = "/api/guest/resume";
/** A booth signing itself out: frees its part. */
export const LOGOUT_ROUTE = "/api/prime/logout";
/** A guest leaving the event: frees their Person. */
export const GUEST_LOGOUT_ROUTE = "/api/guest/logout";
/** A released token's 401: the phone says why it is out. */
export const SIGNED_OUT = "signed out on this phone";
/** How long a re-pair QR stays good. */
export const PAIR_TTL_MS = 10 * 60_000;
/** Home Screen nonces kept per guest (K-31b); a fourth drops the oldest. */
export const HOMESCREEN_KEEP = 3;

/** The link a re-pair QR carries. `base` is the public join base. */
export function resumeUrl(base: string, eventCode: string, pair: string): string {
  return `${base.replace(/\/+$/u, "")}/?code=${encodeURIComponent(eventCode)}&pair=${encodeURIComponent(pair)}`;
}

/** Take `character` off every session holding it: a performer-only (or
 *  performer + host) session is deleted, a performer+admin one keeps admin
 *  (`SessionStore.dropCharacter`). Returns how many changed. */
export function releasePart(sessions: SessionStore, character: string): number {
  let n = 0;
  for (const [token, s] of sessions.entries()) {
    if (s.character !== character) continue;
    sessions.dropCharacter(token);
    n++;
  }
  return n;
}

/** What the routes need from their `EventRuntime` (kept narrow so the
 *  module merges cleanly and tests see exactly what it touches). */
export interface PairingHost {
  sim(): Sim | null;
  /** Bind a fresh guest token to `id` and persist the token table. */
  addGuestToken(token: string, id: string): void;
  /** Is `id` a director's persona (not a phone's guest)? */
  isPersona(id: string): boolean;
  /** Cut every token of guest `id` (their streams + push devices too);
   *  returns how many tokens went. */
  revokeGuest(id: string): number;
  sessions: SessionStore;
  persistSessions(): void;
  /** Close the real booth streams for a character (not directors' panes). */
  endBooths(character: string): void;
  /** A release: the Person's or part's open asks end (wave 59). */
  closeAsks?(id: string): void;
  joinBase(): string;
  eventCode(): string;
  /** Mint a token (injected for tests). */
  mint?: () => string;
  /** Mint a pair code (injected for tests). */
  mintPair?: () => string;
  /** Wall clock (injected for tests). */
  now?: () => number;
  /** Is K-31b on? Defaults to `LOOM_HOMESCREEN` (read per call). */
  homescreen?: () => boolean;
}

interface PendingPair {
  id: string;
  expiresAt: number;
  /** A director's re-pair QR, or the guest's own Home Screen nonce. */
  kind: "pair" | "homescreen";
}

export class Pairing {
  /** Outstanding pair codes → the guest each re-pairs. */
  private readonly pending = new Map<string, PendingPair>();

  constructor(private readonly host: PairingHost) {}

  private now(): number {
    return (this.host.now ?? Date.now)();
  }

  /** Forget every outstanding pair code (a story restart). */
  clear(): void {
    this.pending.clear();
  }

  /** Handle one of this module's mod routes; false when `path` isn't ours. */
  handle(path: string, res: ServerResponse, body: Record<string, unknown>): boolean {
    if (path === PAIR_ROUTE) return this.pair(res, body);
    if (path === RELEASE_ROUTE) return this.release(res, body);
    if (path === GUEST_RELEASE_ROUTE) return this.releaseGuest(res, body);
    return false;
  }

  /** The phone's `POST /api/guest/resume {pair}` (no token — the code is
   *  the credential); false when `path` isn't it. */
  handlePublic(path: string, res: ServerResponse, body: Record<string, unknown>): boolean {
    if (path !== RESUME_ROUTE) return false;
    const code = str(body, "pair").trim();
    const hit = code === "" ? undefined : this.pending.get(code);
    // Single use: a code is spent the moment it's presented.
    if (hit !== undefined) this.pending.delete(code);
    const sim = this.host.sim();
    const person = hit === undefined ? undefined : sim?.persons.get(hit.id);
    if (hit === undefined || hit.expiresAt <= this.now() || person === undefined) {
      sendJson(res, 410, { error: "that re-pair code has expired — ask the director for a new one" });
      return true;
    }
    if (hit.kind === "pair") this.cut(hit.id);
    const token = (this.host.mint ?? randomUUID)();
    this.host.addGuestToken(token, hit.id);
    sendJson(res, 200, { ok: true, id: hit.id, name: person.name, token });
    return true;
  }

  /** Void `id`'s codes of `kind` (every kind when null) and every expired one. */
  private sweep(id: string, kind: PendingPair["kind"] | null): void {
    const now = this.now();
    for (const [code, p] of [...this.pending]) if ((p.id === id && (kind === null || p.kind === kind)) || p.expiresAt <= now) this.pending.delete(code);
  }

  private mintCode(): string {
    return (this.host.mintPair ?? (() => randomBytes(12).toString("base64url")))();
  }

  /** `POST /api/guest/homescreen` for the guest `id` the caller's token
   *  stands for (undefined: no guest token, or a director's play-as). */
  homescreen(res: ServerResponse, id: string | undefined): true {
    if (!(this.host.homescreen ?? homescreenEnabled)()) {
      sendJson(res, 404, { error: "Home Screen sign-in is off on this server" });
      return true;
    }
    const person = id === undefined ? undefined : this.host.sim()?.persons.get(id);
    if (id === undefined || person === undefined) {
      sendJson(res, 401, { error: "not signed in" });
      return true;
    }
    if (this.host.isPersona(id)) {
      sendJson(res, 409, { error: "that's a director's persona — play it from the cockpit, not a phone" });
      return true;
    }
    this.sweep("", "homescreen"); // expired ones only
    const mine = [...this.pending].filter(([, p]) => p.id === id && p.kind === "homescreen");
    for (const [code] of mine.slice(0, Math.max(0, mine.length - HOMESCREEN_KEEP + 1))) this.pending.delete(code);
    const pair = this.mintCode();
    const expiresAt = this.now() + HOMESCREEN_TTL_MS;
    this.pending.set(pair, { id, expiresAt, kind: "homescreen" });
    const code = this.host.eventCode();
    sendJson(res, 200, { ok: true, pair, code, expiresAt, manifest: homescreenManifestPath(code, pair) });
    return true;
  }

  /** `POST /api/prime/logout`: the caller's own session lets go of its part
   *  (performer-only → gone, an admin keeps admin). Always 200 — signing
   *  out with a dead token is still signed out. */
  logout(res: ServerResponse, token: string | undefined): true {
    const s = this.host.sessions.get(token);
    if (token !== undefined && s !== undefined && s.character !== null) {
      this.host.sessions.dropCharacter(token);
      this.host.persistSessions();
      this.host.closeAsks?.(s.character);
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  /** `POST /api/guest/logout`: the guest `id` the caller's token stands for
   *  lets go of their Person (undefined: nothing to let go of). Always 200,
   *  like a booth's Sign out. */
  guestLogout(res: ServerResponse, id: string | undefined): true {
    if (id !== undefined) this.cut(id);
    sendJson(res, 200, { ok: true });
    return true;
  }

  /** Sign guest `id`'s phone out: its tokens, the nonce that would bring it
   *  back, and the asks made while it held them. A director's re-pair QR
   *  stays good. Every release of a guest comes through here. */
  cut(id: string): number {
    this.sweep(id, "homescreen");
    this.host.closeAsks?.(id);
    return this.host.revokeGuest(id);
  }

  /** The guest a mod route names, or null once it has answered why not. */
  private guestFor(res: ServerResponse, body: Record<string, unknown>): { id: string; name: string } | null {
    const sim = this.host.sim();
    if (sim === null) {
      sendJson(res, 409, { error: "no scenario loaded" });
      return null;
    }
    const id = str(body, "id");
    const person = sim.persons.get(id);
    if (person === undefined) {
      sendJson(res, 404, { error: "unknown guest" });
      return null;
    }
    if (this.host.isPersona(id)) {
      sendJson(res, 409, { error: "that's a director's persona — play it from the cockpit, not a phone" });
      return null;
    }
    return { id, name: person.name };
  }

  private releaseGuest(res: ServerResponse, body: Record<string, unknown>): true {
    const guest = this.guestFor(res, body);
    if (guest === null) return true;
    sendJson(res, 200, { ok: true, id: guest.id, name: guest.name, released: this.cut(guest.id) });
    return true;
  }

  private pair(res: ServerResponse, body: Record<string, unknown>): true {
    const guest = this.guestFor(res, body);
    if (guest === null) return true;
    const { id, name } = guest;
    const revokeOthers = body["revokeOthers"] === true;
    const revoked = revokeOthers ? this.cut(id) : 0;
    // Only the newest QR for a guest works; expired codes are swept here.
    // Cutting the lost phone also voids any Home Screen code it minted.
    this.sweep(id, revokeOthers ? null : "pair");
    const pair = this.mintCode();
    const expiresAt = this.now() + PAIR_TTL_MS;
    this.pending.set(pair, { id, expiresAt, kind: "pair" });
    sendJson(res, 200, {
      ok: true,
      id,
      name,
      pair,
      expiresAt,
      revoked,
      url: resumeUrl(this.host.joinBase(), this.host.eventCode(), pair),
    });
    return true;
  }

  private release(res: ServerResponse, body: Record<string, unknown>): true {
    const sim = this.host.sim();
    const character = str(body, "character");
    if (sim !== null && !sim.model.characters.has(character)) {
      sendJson(res, 404, { error: "unknown character" });
      return true;
    }
    const released = releasePart(this.host.sessions, character);
    if (released > 0) this.host.persistSessions();
    this.host.endBooths(character);
    this.host.closeAsks?.(character);
    sendJson(res, 200, { ok: true, character, released });
    return true;
  }
}
