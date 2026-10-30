//! W-03 — reserved programs: a featured program waits for its invitee.
//!
//! A pool `CHARACTER … reserved: true` (the show's nine featured programs)
//! is locked on the guest picker. Its invitation carries a **claim**
//! (`…/?code=<guest code>&claim=<token>`, listed by `/api/mod/codes` →
//! `claims`); `/api/identities {passcode, claim}` shows that program open
//! to the holder, and `/api/guest/register {…, claim}` takes it. Without
//! the claim, register answers 409 `{error: "reserved"}`.
//!
//! The token is `identity.ts` `claimToken(secret, name)`. The secret is the
//! event's own, pinned like its codes: on the event row (`event.claim_secret`,
//! carried from the project's previous event at launch, so End → relaunch
//! keeps every printed invitation working) and in the state dir
//! (`claim-secret.json` — the LAN default event, and a row from before the
//! column, whose minted secret is written back to it).
//!
//! Wave 54: an invitation is printed as its program's **badge**: the link
//! also carries a badge code, so it links at join and is the guest's pass at
//! the door (`routes/rejoin.ts`). `links` is the one place those are built.
//!
//! A lost invitation: `POST /api/mod/claim/unlock {character, minutes?}`
//! opens one reserved program to anyone for N minutes (default 2, at most
//! 60; 0 shuts it again). The window runs on the wall clock and lives in
//! memory only — a restart shuts it, and an open window never outlives
//! its minutes.

import type { ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

import type { SimModel } from "../../src/runtime/sim/model.ts";
import { foldName } from "../../src/parser/names.ts";
import { claimMatches, claimToken, identityDefs, guestPickable } from "../identity.ts";
import { sendJson, str } from "../http-util.ts";
import { badgeCode, invitedBadge, invitedRef, INVITED_BADGES, printedCode } from "./rejoin.ts";

export const CLAIM_UNLOCK_ROUTE = "/api/mod/claim/unlock";
/** A director's open window when the call names no `minutes`. */
export const UNLOCK_DEFAULT_MINUTES = 2;
/** The longest window a director may open. */
export const UNLOCK_MAX_MINUTES = 60;

/** A fresh claim secret: 32 random bytes, base64url. */
export function mintClaimSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** One reserved program's invitation (`/api/mod/codes` → `claims`). */
export interface ClaimLink {
  character: string;
  claim: string;
  /** `${joinBase}/?code=<guest code>&claim=<token>&badge=<code>`: the
   *  invited badge's QR. */
  url: string;
  /** The badge's corner ref (`F01`). */
  ref: string;
  /** The printed badge code (`ABCD-EFGH`). */
  code: string;
}

/** What the claims need from their `EventRuntime`. */
export interface ClaimsHost {
  /** The event's claim secret (already resolved and persisted). */
  secret: string;
  /** Wall clock (ms) — the runtime's injectable clock. */
  now(): number;
}

export class Claims {
  /** reserved character id → when its open window closes (wall ms). */
  private readonly windows = new Map<string, number>();

  constructor(private readonly host: ClaimsHost) {}

  /** The token that claims `character`. */
  tokenFor(character: string): string {
    return claimToken(this.host.secret, character);
  }

  /** Is a director's window open on `character` right now? */
  unlocked(character: string): boolean {
    const until = this.windows.get(character);
    if (until === undefined) return false;
    if (until > this.host.now()) return true;
    this.windows.delete(character);
    return false;
  }

  /** May a caller holding `claim` (or none) take reserved `character`? */
  mayClaim(character: string, claim: string | null | undefined): boolean {
    return this.unlocked(character) || claimMatches(this.host.secret, character, claim);
  }

  /** The open windows (character → closes at, wall ms), expired ones dropped. */
  openWindows(): Map<string, number> {
    const out = new Map<string, number>();
    for (const c of [...this.windows.keys()]) if (this.unlocked(c)) out.set(c, this.windows.get(c)!);
    return out;
  }

  /** The reserved program `claim` opens, or null. */
  characterOf(model: SimModel | null, claim: string | null): string | null {
    if (model === null || claim === null) return null;
    return identityDefs(model).find((d) => d.reserved && claimMatches(this.host.secret, d.name, claim))?.name ?? null;
  }

  /** Every reserved program a guest could be, with its invited badge, in
   *  declaration order: a program added later takes the next number and
   *  leaves every printed one alone. */
  links(model: SimModel | null, base: string, guestCode: string): ClaimLink[] {
    if (model === null) return [];
    return identityDefs(model)
      .filter((d) => d.reserved && guestPickable(d))
      .slice(0, INVITED_BADGES)
      .map((d, i) => {
        const claim = this.tokenFor(d.name);
        const code = badgeCode(this.host.secret, invitedBadge(i));
        return { character: d.name, claim, ref: invitedRef(i), code: printedCode(code), url: `${base}/?code=${encodeURIComponent(guestCode)}&claim=${encodeURIComponent(claim)}&badge=${encodeURIComponent(code)}` };
      });
  }

  /**
   * `POST /api/mod/claim/unlock {character, minutes?}` → `{ok, character,
   * until}` (`until` null when shut). 404 for a name that is no reserved
   * program a guest may be. True once it has answered (it always does).
   */
  handleUnlock(res: ServerResponse, body: Record<string, unknown>, model: SimModel | null, changed: () => void): boolean {
    const want = foldName(str(body, "character"));
    const def = model === null ? undefined : identityDefs(model).find((d) => d.reserved && guestPickable(d) && foldName(d.name) === want);
    if (def === undefined) {
      sendJson(res, 404, { error: "no such reserved program" });
      return true;
    }
    const raw = body["minutes"];
    const minutes = raw === undefined || raw === null ? UNLOCK_DEFAULT_MINUTES : Number(raw);
    if (!Number.isFinite(minutes) || minutes < 0) {
      sendJson(res, 400, { error: "minutes must be a number ≥ 0" });
      return true;
    }
    if (minutes === 0) this.windows.delete(def.name);
    else this.windows.set(def.name, this.host.now() + Math.min(minutes, UNLOCK_MAX_MINUTES) * 60_000);
    changed();
    sendJson(res, 200, { ok: true, character: def.name, until: this.windows.get(def.name) ?? null });
    return true;
  }
}
