//! Getting back in (wave 23, `core/server/routes/rejoin.ts`). A guest who
//! lost this phone's session — another browser, cleared tabs, *Leave the
//! event* — comes back as the SAME program three ways, no director needed:
//!
//! - **Their badge.** The crew prints blank ID badges; each QR is
//!   `…/?code=<guest code>&badge=<code>`. Scanned at join it links to the
//!   program picked (`register {…, badge}`), or later from Me
//!   (`/api/guest/badge`). Opened in a browser with no session it signs in
//!   (`/api/guest/enter {passcode, badge}`); a blank badge carries on into
//!   the join and links there. Opened by a signed-in guest it links (their
//!   own) or reads as a pass (someone else's) — never a switch.
//! - **Their invitation** (a featured guest's `?claim=`): the same `enter`
//!   once their program has joined.
//! - **Ask a host.** Pick your program from the joined ones; a host taps
//!   Approve on Needs (or the director phone) and this phone is in.
//!
//! A performer's **cast card** (`…/?code=<prime code>&part=<code>`) signs in
//! as that part and takes it back from a lost booth (`/api/prime/login
//! {passcode, part}`).
//!
//! The badge and part codes are credentials: `main.tsx` strips them from the
//! address bar before anything renders. This file is the links and the
//! answers (pure, in the first load); the server calls are their own chunk,
//! `rejoin-calls.ts`. Both are tested in `test/rejoin.test.ts`.

import type { SessionStorage } from "./host.ts";

/** A badge code once normalized: 8 Crockford base32 characters. */
const BADGE_CODE = /^[0-9a-hjkmnp-tv-z]{8}$/;

/** A badge as scanned or typed — its link, or the code with any case,
 *  spaces and dashes — normalized; null when it can't be one. Mirrors the
 *  server's `badgeFromText`. */
export function badgeFromText(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return null;
  let code = text;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || text.startsWith("/") || text.startsWith("?")) {
    try {
      code = new URL(text, "http://x").searchParams.get("badge") ?? "";
    } catch {
      return null;
    }
  }
  const n = code.toLowerCase().replace(/[\s-]+/g, "");
  return BADGE_CODE.test(n) ? n : null;
}

/** The link a badge or cast card opened this page with. */
export interface CardLink {
  /** The event code the link carries (`?code=`). */
  code: string;
  badge?: string;
  part?: string;
}

/** `?badge=` / `?part=` on the address, with its `?code=`; null when neither. */
export function cardFromSearch(search: string): CardLink | null {
  try {
    const p = new URLSearchParams(search);
    const code = (p.get("code") ?? "").trim();
    const badge = badgeFromText(p.get("badge") ?? "");
    const part = (p.get("part") ?? "").trim();
    if (code === "" || (badge === null && part === "")) return null;
    return { code, ...(badge !== null ? { badge } : {}), ...(part !== "" ? { part } : {}) };
  } catch {
    return null;
  }
}

/** `search` without its credentials (`badge`, `part`); the code stays. */
export function withoutCard(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("badge");
  p.delete("part");
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

/** Where the join screen keeps a blank badge until the guest has joined. */
export const BADGE_KEY = "loom.guest.badge";

interface StoredBadge {
  code: string;
  badge: string;
}

const foldCode = (code: string): string => code.trim().toUpperCase();

/** Keep a blank badge for event code `code` (linked at register). */
export function rememberBadge(storage: SessionStorage, code: string, badge: string): void {
  try {
    storage.save(BADGE_KEY, { code: foldCode(code), badge } satisfies StoredBadge);
  } catch {
    /* storage blocked: the badge links from Me later */
  }
}

/** The blank badge kept for event code `code`, or null. */
export function storedBadge(storage: SessionStorage, code: string): string | null {
  try {
    const s = storage.load<StoredBadge>(BADGE_KEY);
    return s !== null && typeof s.badge === "string" && s.code === foldCode(code) ? s.badge : null;
  } catch {
    return null;
  }
}

export function forgetBadge(storage: SessionStorage): void {
  try {
    storage.drop(BADGE_KEY);
  } catch {
    /* fine */
  }
}

/** The printed form of a badge code (`ABCD-EFGH`). */
export function printedBadge(code: string): string {
  return code.toUpperCase().replace(/(.{4})(?=.)/g, "$1-");
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const BADGE_UNKNOWN = "That isn't one of tonight's badges. Check the code under the QR, or ask a host.";

/** What a badge / cast card link does on this phone, given what it holds. */
export type CardPlan =
  /** Nothing to do (a badge opened on a booth's phone). */
  | { kind: "none" }
  /** No session: sign in by the badge (or carry a blank one into the join). */
  | { kind: "enter"; code: string; badge: string }
  /** A guest is signed in here: link it (theirs) or read it as a pass. */
  | { kind: "link"; badge: string }
  /** Sign this phone in as the card's part; `confirm` names the guest it
   *  would sign out first, null when nothing is lost. */
  | { kind: "part"; code: string; part: string; confirm: string | null };

export function cardPlan(card: CardLink | null, guestName: string | null, hasBooth: boolean): CardPlan {
  if (card === null) return { kind: "none" };
  if (card.part !== undefined) return { kind: "part", code: card.code, part: card.part, confirm: guestName };
  if (card.badge === undefined) return { kind: "none" };
  if (guestName !== null) return { kind: "link", badge: card.badge };
  if (hasBooth) return { kind: "none" };
  return { kind: "enter", code: card.code, badge: card.badge };
}

/** What linking a badge from a signed-in guest's phone did. */
export type BadgeLink =
  | { kind: "linked"; n: number }
  | { kind: "already"; n: number }
  /** Someone else's badge: it is their pass (the Recruit sheet). */
  | { kind: "theirs"; id: string; name: string }
  | { kind: "unknown" };

/** The `/api/guest/badge` answer (or its refusal's status + body) as a `BadgeLink`. */
export function badgeLinkOf(status: number, body: Record<string, unknown>): BadgeLink | null {
  if (status >= 200 && status < 300 && typeof body["badge"] === "number") return body["already"] === true ? { kind: "already", n: body["badge"] } : { kind: "linked", n: body["badge"] };
  if (status === 409 && typeof body["holder"] === "string") return { kind: "theirs", id: body["holder"], name: str(body["name"]) || body["holder"] };
  if (status === 404) return { kind: "unknown" };
  return null;
}

/** What the guest sees after a link (null for someone else's: the sheet opens). */
export function badgeLinkText(r: BadgeLink): string | null {
  switch (r.kind) {
    case "linked":
      return "🪪 Badge linked. Lost your phone? Scan your badge with any phone's camera to get back in.";
    case "already":
      return "🪪 That's your badge — it's already linked to you.";
    case "theirs":
      return null;
    case "unknown":
      return BADGE_UNKNOWN;
  }
}
