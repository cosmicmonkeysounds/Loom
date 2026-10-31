// Getting back in (wave 23, `core/server/routes/rejoin.ts`). A guest who
// lost this phone's session — another browser, cleared tabs, *Leave the
// event* — comes back as the SAME program three ways, no director needed.
// Wave 59: only while no other phone holds it. A held card is refused
// (`held.tsx`, the refused screen), and a host moves it here (Ask a host).
//
// - **Their badge.** The crew prints blank ID badges; each QR is
//   `…/?code=<guest code>&badge=<code>`. Scanned at join it links to the
//   program picked (`register {…, badge}`), or later from Me
//   (`/api/guest/badge`). Opened in a browser with no session it signs in
//   (`/api/guest/enter {passcode, badge}`); a blank badge carries on into
//   the join and links there. Opened by a signed-in guest it links (their
//   own) or reads as a pass (someone else's) — never a switch.
// - **Their invitation** (a featured guest's `?claim=`): the same `enter`
//   once their program has joined.
// - **Ask a host.** Pick your program from the joined ones; a host taps
//   Approve on Needs (or the director phone) and this phone is in.
//
// An **invited badge** (wave 54, `…&claim=<token>&badge=<code>`) is both: the
// claim opens its program, the badge links at join and is the guest's pass.
//
// A performer's **staff badge** (`…/?code=<guest code>&part=<code>`) signs in
// as that part (`/api/prime/login {passcode, part}`), the same one-holder rule.
//
// A phone that stops being someone lets go on the server (`letGo`); offline,
// the release is owed and paid when the server is back (`payOwed`), or the
// phone could never prove it left and would be refused on its own badge.
//
// The badge and part codes are credentials: `main.tsx` strips them from the
// address bar before anything renders. This file is the links and the
// answers (pure, in the first load); the server calls are their own chunk,
// `rejoin-calls.ts`. Both are tested in `test/rejoin.test.ts`.

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

/** What a refused card may say of who holds it: what is printed on it. */
export interface HeldShown {
  name: string | null;
  ref: string | null;
}

/** A refused card: what to ask a host for. */
export interface HeldCard extends HeldShown {
  /** The event code it carries (the performer code on the booth's picker). */
  code: string;
  by: { badge: string; claim?: string } | { claim: string } | { part: string } | { character: string };
}

/** The `held` a refused sign-in threw (`RejoinError`), or null. */
export function heldOf(e: unknown): HeldShown | null {
  const held = (e as { held?: HeldShown | null } | null)?.held;
  return held === undefined ? null : held;
}

/** A refusal's body (an `ApiError`'s `data`), or nothing. */
const refusalBody = (e: unknown): Record<string, unknown> => (e as { data?: Record<string, unknown> } | null)?.data ?? {};

/** The refused screen for a join that lost its card to another phone, or
 *  null for any other refusal. */
export function joinHeld(e: unknown, code: string, badge: string | null, claim: string | null): HeldCard | null {
  const body = refusalBody(e);
  if (body["held"] !== true) return null;
  const by = badge !== null ? { badge, ...(claim !== null ? { claim } : {}) } : claim !== null ? { claim } : null;
  return by === null ? null : { code, by, name: str(body["name"]) || null, ref: str(body["ref"]) || null };
}

/** A join refused because the badge it carried is another program's. */
export function joinReserved(e: unknown): boolean {
  return refusalBody(e)["reserved"] === true;
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
  /** An invited badge printed for another program, which nobody has joined. */
  | { kind: "reserved"; name: string }
  | { kind: "unknown" };

/** The `/api/guest/badge` answer (or its refusal's status + body) as a `BadgeLink`. */
export function badgeLinkOf(status: number, body: Record<string, unknown>): BadgeLink | null {
  if (status >= 200 && status < 300 && typeof body["badge"] === "number") return body["already"] === true ? { kind: "already", n: body["badge"] } : { kind: "linked", n: body["badge"] };
  if (status === 409 && typeof body["holder"] === "string") return { kind: "theirs", id: body["holder"], name: str(body["name"]) || body["holder"] };
  if (status === 409 && body["reserved"] === true) return { kind: "reserved", name: str(body["name"]) };
  if (status === 404) return { kind: "unknown" };
  return null;
}

/** What the guest sees after a link (null for someone else's: the sheet opens). */
export function badgeLinkText(r: BadgeLink): string | null {
  switch (r.kind) {
    case "linked":
      return "🪪 Badge linked. Lost your phone? Scan your badge with any phone's camera, and a host can move you there.";
    case "already":
      return "🪪 That's your badge — it's already linked to you.";
    case "theirs":
      return null;
    case "reserved":
      return `🪪 That badge is saved for ${r.name}. Yours is the one with your own program on it.`;
    case "unknown":
      return BADGE_UNKNOWN;
  }
}

/** A sign-out the server hasn't heard yet. */
export interface OwedRelease {
  role: "guest" | "prime";
  eventId: string;
  token: string;
}

/** Where a phone keeps the releases it owes. */
export const OWED_KEY = "loom.owed.release";
/** How often a page still owing a release tries again. */
export const OWED_RETRY_MS = 15_000;

export function owedReleases(storage: SessionStorage): OwedRelease[] {
  try {
    const list = storage.load<OwedRelease[]>(OWED_KEY);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function setOwed(storage: SessionStorage, list: OwedRelease[]): void {
  try {
    if (list.length > 0) storage.save(OWED_KEY, list);
    else storage.drop(OWED_KEY);
  } catch {
    /* storage blocked: the try in hand is the only one */
  }
}

let settleAgain: ReturnType<typeof setTimeout> | null = null;

/** Tell the server every release this phone owes (`rejoin-calls.ts`'s
 *  `payOwed`, the lazy chunk). Resolves once tried. Never throws: a chunk that
 *  won't load is a phone with no signal, so it stays owed and tries again
 *  while the page lives (a phone on dead Wi-Fi never says it's back online). */
export async function settleOwed(storage: SessionStorage, load: () => Promise<{ payOwed: (storage: SessionStorage) => Promise<void> }> = () => import("./rejoin-calls.ts")): Promise<void> {
  if (owedReleases(storage).length === 0) return;
  try {
    await (await load()).payOwed(storage);
  } catch {
    if (settleAgain !== null) return;
    settleAgain = setTimeout(() => {
      settleAgain = null;
      void settleOwed(storage, load);
    }, OWED_RETRY_MS);
  }
}

/** This phone stops being a guest or a booth: let go of it on the server, so
 *  their card signs in again. Never waits, never throws. */
export function letGo(storage: SessionStorage, who: { token?: unknown; eventId?: unknown } | null, role: "guest" | "prime"): void {
  if (who === null || typeof who.token !== "string" || typeof who.eventId !== "string") return;
  const { token, eventId } = who;
  setOwed(storage, [...owedReleases(storage).filter((o) => o.token !== token), { role, eventId, token }].slice(-4));
  void settleOwed(storage);
}
