//! Wave 59 — a printed text code does what its QR does. Every printed QR
//! carries a code a person can read off it (Run → Print sheet, `/cards`):
//! the guest code, a badge's (`routes/rejoin.ts`), a room's and a sign's
//! (`routes/k12.ts`), a codex entry's own. `printedHit` turns what someone
//! typed back into **the link that QR carries**, so a typed code takes the
//! scan's whole path: the phone hands the link to the classifier its camera
//! uses, or opens it. Nothing here acts.
//!
//! Who asks: `/api/resolve-code` for a code typed on a join screen (no
//! session yet), `POST /api/guest/printed` and `POST /api/prime/printed` for
//! the Scan sheets, before anything goes to the Codex: a miss there fires the
//! story's `wrong code`, so a room's, a badge's or a sign's code must never
//! reach it. A codex code is left to the redeem routes, which hold the miss
//! rules, so this never tells a phone whether a code is one (`null` both ways).
//!
//! Forgiving: case, spaces, hyphens and underscores are noise (`foldCode`), so
//! are the letters a printed code never holds (`o` is `0`, `i` and `l` are
//! `1`), a room or sign code reads with or without its `R-` / `S-`, and a
//! room's own name (`the start bar`, with or without `the`) finds its sign, so
//! a name typed for a hidden room hears *not open yet* rather than a miss.
//!
//! Pure over its `PrintedSource`.

import { foldCode, type SimModel } from "../../src/runtime/sim/model.ts";
import { passOk } from "../auth.ts";
import { codeEquals } from "../identity.ts";
import type { ClaimLink } from "./claims.ts";
import { actionSigns, checkinSigns, checkinSlug } from "./k12.ts";
import { BADGE_LENGTH, BADGE_MAX, badgeUrl, partCode, partUrl } from "./rejoin.ts";

export const PRINTED_GUEST_ROUTE = "/api/guest/printed";
export const PRINTED_PRIME_ROUTE = "/api/prime/printed";

/** What a printed code is. */
export type PrintedKind = "join" | "badge" | "invited" | "staff" | "room" | "sign";

export interface PrintedHit {
  kind: PrintedKind;
  /** The link its QR carries. */
  url: string;
}

/** What the lookup reads from its `EventRuntime`. */
export interface PrintedSource {
  secret: string;
  base: string;
  guestCode: string;
  model: SimModel | null;
  /** The performer parts (`EventRuntime.performerParts`). */
  parts: readonly string[];
  /** The badge number a normalized code is, or null. */
  badgeNumber(code: string): number | null;
  /** The invited badges, in number order (`Claims.links`). */
  invited(): ClaimLink[];
}

/** A typed code in the printed alphabet: Crockford's, where `o`, `i` and `l`
 *  can only be a misread `0` and `1`. */
function printedFold(text: string): string {
  return foldCode(text).replace(/o/gu, "0").replace(/[il]/gu, "1");
}

/** A room's name as compared: its fold, a leading `the` gone. */
function nameKey(name: string): string {
  return foldCode(checkinSlug(name)).replace(/^the/u, "");
}

/** Does `typed` (`printedFold`ed) read as `code` (`R-K7QM`), with or without its prefix? */
function sameCode(typed: string, code: string): boolean {
  const want = printedFold(code);
  return typed === want || typed === want.slice(1);
}

/** The printed code `raw` is, as the link its QR carries, or null: not one,
 *  or a codex code (see the header). */
export function printedHit(raw: string, src: PrintedSource): PrintedHit | null {
  const text = raw.trim();
  const fold = foldCode(text);
  if (fold === "") return null;
  const { base, guestCode, model, secret } = src;
  if (model !== null && model.codexCodes.has(fold)) return null;
  if (passOk(text, guestCode)) return { kind: "join", url: `${base}/?code=${encodeURIComponent(guestCode)}` };
  const typed = printedFold(text);
  if (typed.length === BADGE_LENGTH) {
    const n = src.badgeNumber(typed);
    if (n !== null) {
      if (n <= BADGE_MAX) return { kind: "badge", url: badgeUrl(base, guestCode, typed) };
      const invited = src.invited()[n - BADGE_MAX - 1];
      return invited === undefined ? null : { kind: "invited", url: invited.url };
    }
  }
  for (const part of src.parts) {
    const code = partCode(secret, part);
    if (codeEquals(typed, code)) return { kind: "staff", url: partUrl(base, guestCode, code) };
  }
  if (model === null) return null;
  const rooms = checkinSigns(model, base, guestCode, secret);
  const room = rooms.find((r) => sameCode(typed, r.code));
  if (room !== undefined) return { kind: "room", url: room.url };
  const sign = actionSigns(model, base, guestCode, secret).find((a) => sameCode(typed, a.code));
  if (sign !== undefined) return { kind: "sign", url: sign.url };
  // A room's own name, a sign or no sign: the check-in route says what it may.
  const key = nameKey(text);
  if (key === "") return null;
  for (const loc of model.locations.values()) {
    if (nameKey(loc.id) === key) return { kind: "room", url: `${base}/?code=${encodeURIComponent(guestCode)}&checkin=${encodeURIComponent(checkinSlug(loc.id))}` };
  }
  return null;
}
