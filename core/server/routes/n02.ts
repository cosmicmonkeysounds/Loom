//! N-02 — re-pair a lost guest; N-10 — release a performer's part.
//!
//! **Re-pair** (`POST /e/:id/api/mod/guest/pair {id}`): a guest whose phone
//! died, whose browser was cleared, or whose camera opened a different
//! browser can't get back in — tokens are minted only at `register`, and
//! re-picking their program is 409 "taken" — so they would come back as a
//! new program and leave a ghost that still counts toward the majority.
//! The director mints a **fresh token for the existing Person** (persisted
//! like a registration's, cut by every restart like one) and shows it as a
//! QR: `<join base>/?code=<event>&resume=<token>`. The play app adopts it
//! as its guest session and strips it from the URL. The guest's old tokens
//! stay valid (it also moves a guest onto a loaner phone; the old one is
//! gone or harmless). Nothing is journaled — a token is not a story fact.
//!
//! **Release** (`POST /e/:id/api/mod/prime/release {character}`): a part is
//! one performer's (`/api/prime/login` refuses a held part with 409) and
//! only Go live used to free parts, so a performer whose phone died was out
//! for the night. Release drops every session holding the part (an admin
//! session keeps its admin capability, loses the character) and closes its
//! booth streams; the performer re-signs on a loaner with the prime code.
//! The character's threads and buttons are story state — untouched.

import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { Sim } from "../../src/runtime/sim/index.ts";
import { sendJson, str } from "../http-util.ts";
import type { SessionStore } from "../session.ts";

export const PAIR_ROUTE = "/api/mod/guest/pair";
export const RELEASE_ROUTE = "/api/mod/prime/release";

/** The link a re-pair QR carries. `base` is the public join base. */
export function resumeUrl(base: string, eventCode: string, token: string): string {
  return `${base.replace(/\/+$/u, "")}/?code=${encodeURIComponent(eventCode)}&resume=${encodeURIComponent(token)}`;
}

/** Take `character` off every session holding it: a performer-only session
 *  is deleted, a performer+admin one keeps admin. Returns how many changed. */
export function releasePart(sessions: SessionStore, character: string): number {
  let n = 0;
  for (const [token, s] of sessions.entries()) {
    if (s.character !== character) continue;
    if (s.admin) sessions.set(token, { character: null, admin: true });
    else sessions.delete(token);
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
  sessions: SessionStore;
  persistSessions(): void;
  /** Close the real booth streams for a character (not directors' panes). */
  endBooths(character: string): void;
  joinBase(): string;
  eventCode(): string;
  /** Mint a token (injected for tests). */
  mint?: () => string;
}

export class Pairing {
  constructor(private readonly host: PairingHost) {}

  /** Handle one of this module's mod routes; false when `path` isn't ours. */
  handle(path: string, res: ServerResponse, body: Record<string, unknown>): boolean {
    if (path === PAIR_ROUTE) return this.pair(res, body);
    if (path === RELEASE_ROUTE) return this.release(res, body);
    return false;
  }

  private pair(res: ServerResponse, body: Record<string, unknown>): true {
    const sim = this.host.sim();
    if (sim === null) {
      sendJson(res, 409, { error: "no scenario loaded" });
      return true;
    }
    const id = str(body, "id");
    const person = sim.persons.get(id);
    if (person === undefined) {
      sendJson(res, 404, { error: "unknown guest" });
      return true;
    }
    const token = (this.host.mint ?? randomUUID)();
    this.host.addGuestToken(token, id);
    sendJson(res, 200, {
      ok: true,
      id,
      name: person.name,
      token,
      url: resumeUrl(this.host.joinBase(), this.host.eventCode(), token),
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
    sendJson(res, 200, { ok: true, character, released });
    return true;
  }
}
