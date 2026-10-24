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
//! address bar before anything renders. Pure helpers + an injectable fetch —
//! `test/rejoin.test.ts`.

import type { AdoptedGuest } from "./resume.ts";
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

/** What `enter` gave: the guest session to adopt, or "join as usual". */
export type EnterResult = { kind: "in"; guest: AdoptedGuest } | { kind: "fresh"; eventId: string; badge?: number };

async function json(r: Response): Promise<Record<string, unknown>> {
  try {
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Thrown with a sentence a guest can read. */
export class RejoinError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export const BADGE_UNKNOWN = "That isn't one of tonight's badges. Check the code under the QR, or ask a host.";
export const INVITE_UNKNOWN = "That invitation isn't one of tonight's — ask a host.";
export const CODE_CLOSED = "That event code isn't open right now.";
export const TOO_MANY = "Too many tries — wait a few minutes, then try again.";
export const NO_SERVER = "Couldn't reach the party's server — check your Wi-Fi and try again.";

/** Resolve the event code: its event id and title. */
async function resolve(code: string, fetchFn: typeof fetch): Promise<{ eventId: string; title?: string }> {
  let r: Response;
  try {
    r = await fetchFn("/api/resolve-code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
  } catch {
    throw new RejoinError(NO_SERVER);
  }
  if (r.status === 429) throw new RejoinError(TOO_MANY, 429);
  const j = await json(r);
  if (!r.ok || str(j["eventId"]) === "") throw new RejoinError(CODE_CLOSED, r.status);
  const title = str(j["title"]);
  return { eventId: str(j["eventId"]), ...(title !== "" ? { title } : {}) };
}

async function postEvent(eventId: string, path: string, body: unknown, fetchFn: typeof fetch): Promise<{ status: number; body: Record<string, unknown> }> {
  let r: Response;
  try {
    r = await fetchFn(`/e/${encodeURIComponent(eventId)}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new RejoinError(NO_SERVER);
  }
  return { status: r.status, body: await json(r) };
}

/** Sign in by a badge or an invitation: the guest it belongs to, or "fresh"
 *  (a blank badge, an invitation not yet used) — the join goes on. */
export async function enterBy(code: string, by: { badge: string } | { claim: string }, fetchFn: typeof fetch = fetch): Promise<EnterResult> {
  const ev = await resolve(code, fetchFn);
  const r = await postEvent(ev.eventId, "/api/guest/enter", { passcode: code, ...by }, fetchFn);
  if (r.status === 429) throw new RejoinError(TOO_MANY, 429);
  if (r.status === 404 && "badge" in by) throw new RejoinError(BADGE_UNKNOWN, 404);
  if (r.status === 404) throw new RejoinError(INVITE_UNKNOWN, 404);
  if (r.status === 409) throw new RejoinError("The doors aren't open yet — try again once they are.", 409);
  if (r.status < 200 || r.status >= 300) throw new RejoinError(str(r.body["error"]) || CODE_CLOSED, r.status);
  const badge = typeof r.body["badge"] === "number" ? r.body["badge"] : undefined;
  if (r.body["resumed"] !== true) return { kind: "fresh", eventId: ev.eventId, ...(badge !== undefined ? { badge } : {}) };
  const id = str(r.body["id"]);
  const token = str(r.body["token"]);
  if (id === "" || token === "") throw new RejoinError(CODE_CLOSED, r.status);
  return { kind: "in", guest: { id, name: str(r.body["name"]) || id, token, eventId: ev.eventId, ...(ev.title !== undefined ? { title: ev.title } : {}) } };
}

/** The programs that have joined (the "ask a host" picker). */
export async function joinedNames(code: string, fetchFn: typeof fetch = fetch): Promise<{ eventId: string; title?: string; names: string[] }> {
  const ev = await resolve(code, fetchFn);
  const r = await postEvent(ev.eventId, "/api/guest/rejoin/names", { passcode: code }, fetchFn);
  if (r.status === 429) throw new RejoinError(TOO_MANY, 429);
  if (r.status < 200 || r.status >= 300) throw new RejoinError(str(r.body["error"]) || CODE_CLOSED, r.status);
  const names = Array.isArray(r.body["names"]) ? (r.body["names"] as unknown[]).filter((n): n is string => typeof n === "string") : [];
  return { ...ev, names };
}

/** An open ask, waiting for a host. */
export interface Ask {
  eventId: string;
  title?: string;
  request: string;
  name: string;
}

/** Ask the hosts to let this phone be `name` again. */
export async function askHost(code: string, name: string, known?: { eventId: string; title?: string }, fetchFn: typeof fetch = fetch): Promise<Ask> {
  const ev = known ?? (await resolve(code, fetchFn));
  const r = await postEvent(ev.eventId, "/api/guest/rejoin", { passcode: code, name }, fetchFn);
  if (r.status === 429) throw new RejoinError(TOO_MANY, 429);
  if (r.status === 404) throw new RejoinError(`Nobody has joined as ${name} yet — join as them instead.`, 404);
  if (r.status < 200 || r.status >= 300) throw new RejoinError(str(r.body["error"]) || CODE_CLOSED, r.status);
  return { eventId: ev.eventId, ...(ev.title !== undefined ? { title: ev.title } : {}), request: str(r.body["request"]), name: str(r.body["name"]) || name };
}

/** Where an ask stands. */
export type AskState = { kind: "pending" } | { kind: "approved"; guest: AdoptedGuest; by: string | null } | { kind: "denied"; by: string | null } | { kind: "expired" };

/** Poll an ask once. Network trouble reads as still pending. */
export async function pollAsk(ask: Ask, fetchFn: typeof fetch = fetch): Promise<AskState> {
  let r: { status: number; body: Record<string, unknown> };
  try {
    r = await postEvent(ask.eventId, "/api/guest/rejoin/poll", { request: ask.request }, fetchFn);
  } catch {
    return { kind: "pending" };
  }
  if (r.status < 200 || r.status >= 300) return { kind: "pending" };
  const by = str(r.body["by"]) || null;
  switch (r.body["state"]) {
    case "approved": {
      const id = str(r.body["id"]);
      const token = str(r.body["token"]);
      if (id === "" || token === "") return { kind: "expired" };
      return { kind: "approved", by, guest: { id, name: str(r.body["name"]) || ask.name, token, eventId: ask.eventId, ...(ask.title !== undefined ? { title: ask.title } : {}) } };
    }
    case "denied":
      return { kind: "denied", by };
    case "expired":
      return { kind: "expired" };
    default:
      return { kind: "pending" };
  }
}

/** How often a waiting phone asks again. */
export const ASK_POLL_MS = 3_000;

/** What the waiting screen says. */
export function askLine(state: AskState, name: string): string {
  switch (state.kind) {
    case "pending":
      return `Asking the hosts to let you back in as ${name}… Find a host (or the director) and tell them — they tap Approve on their phone.`;
    case "approved":
      return `${state.by ?? "A host"} let you back in as ${name}.`;
    case "denied":
      return `${state.by ?? "A host"} said no. If you really are ${name}, find them and ask in person.`;
    case "expired":
      return "Nobody answered in time. Ask again, and find a host to tap Approve.";
  }
}

/** The "ask a host" picker's rows: names matching `q` (folded), all when blank. */
export function filterNames(names: readonly string[], q: string): string[] {
  const want = q.trim().toLowerCase();
  if (want === "") return [...names];
  return names.filter((n) => n.toLowerCase().includes(want));
}

/** The booth sign-in a cast card gives (the `loom.prime` record). */
export interface CardBooth {
  token: string;
  character: string;
  admin: boolean;
  host: boolean;
  eventId: string;
  title?: string;
}

export const CARD_UNKNOWN = "That cast card isn't one of tonight's — ask the director.";

/** Sign in by a cast card: its part, taken back from any booth holding it. */
export async function enterPart(code: string, part: string, fetchFn: typeof fetch = fetch): Promise<CardBooth> {
  const ev = await resolve(code, fetchFn);
  const r = await postEvent(ev.eventId, "/api/prime/login", { passcode: code, part }, fetchFn);
  if (r.status === 429) throw new RejoinError(TOO_MANY, 429);
  if (r.status === 404) throw new RejoinError(CARD_UNKNOWN, 404);
  if (r.status === 409) throw new RejoinError(str(r.body["error"]) === "doors are closed" ? "The story isn't loaded yet — scan your card again once the director opens the doors." : str(r.body["error"]) || CARD_UNKNOWN, 409);
  if (r.status < 200 || r.status >= 300) throw new RejoinError(str(r.body["error"]) || CARD_UNKNOWN, r.status);
  const token = str(r.body["token"]);
  const character = str(r.body["character"]);
  if (token === "" || character === "") throw new RejoinError(CARD_UNKNOWN, r.status);
  return { token, character, admin: r.body["admin"] === true, host: r.body["host"] === true, eventId: ev.eventId, ...(ev.title !== undefined ? { title: ev.title } : {}) };
}

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
