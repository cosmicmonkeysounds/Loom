//! The server calls behind getting back in (wave 23, see `rejoin.ts`):
//! enter by badge / invitation / cast card, and the ask-a-host round. A
//! chunk of its own (`loadRejoinCalls`): only a page opened by a badge, an
//! invitation or a cast card, or the join screen's *Get back in* panel,
//! fetches it — never a guest's first load. Injectable fetch —
//! `test/rejoin.test.ts`.

import type { AdoptedGuest, ResumeLink } from "./resume.ts";
import { rememberClaim } from "./claim.ts";
import { BADGE_UNKNOWN, OWED_RETRY_MS, owedReleases, rememberBadge, setOwed, type HeldCard, type HeldShown } from "./rejoin.ts";
import type { SessionStorage } from "./host.ts";

/** What `enter` gave: the guest session to adopt, or "join as usual" (with
 *  the invitation an invited badge carries, when it was scanned without one). */
export type EnterResult = { kind: "in"; guest: AdoptedGuest } | { kind: "fresh"; eventId: string; badge?: number; claim?: string };

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
  readonly status: number;
  /** Wave 59: refused because a phone holds it (the refused screen). */
  readonly held: HeldShown | null;
  constructor(message: string, status = 0, held: HeldShown | null = null) {
    super(message);
    this.status = status;
    this.held = held;
  }
}

/** The refused screen's headline: only what is printed on the card. */
export function heldLine(shown: HeldShown): string {
  if (shown.name !== null) return `${shown.name} is already signed in on a phone.`;
  if (shown.ref !== null) return `Badge ${shown.ref} is already signed in on a phone.`;
  return "That badge is already signed in on a phone.";
}

export const HELD_HINT = "Is that this phone, in another browser? Go back to that one: it's still you there. Lost it, or moved to a new phone? Ask a host to move you here.";

/** The `409 {held: true, name?, ref?}` as an error, or null when it's another 409. */
function heldError(body: Record<string, unknown>): RejoinError | null {
  if (body["held"] !== true) return null;
  const shown = { name: str(body["name"]) || null, ref: str(body["ref"]) || null };
  return new RejoinError(heldLine(shown), 409, shown);
}

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
 *  (a blank badge, an invitation not yet used) — the join goes on. The token
 *  this phone `holding` proves it is the holder; a held card throws `held`. */
export async function enterBy(code: string, by: { badge: string; claim?: string } | { claim: string }, fetchFn: typeof fetch = fetch, holding?: string): Promise<EnterResult> {
  const ev = await resolve(code, fetchFn);
  const r = await postEvent(ev.eventId, "/api/guest/enter", { passcode: code, ...by, ...(holding !== undefined ? { token: holding } : {}) }, fetchFn);
  if (r.status === 429) throw new RejoinError(TOO_MANY, 429);
  if (r.status === 404 && "badge" in by) throw new RejoinError(BADGE_UNKNOWN, 404);
  if (r.status === 404) throw new RejoinError(INVITE_UNKNOWN, 404);
  if (r.status === 409) throw heldError(r.body) ?? new RejoinError("The doors aren't open yet — try again once they are.", 409);
  if (r.status < 200 || r.status >= 300) throw new RejoinError(str(r.body["error"]) || CODE_CLOSED, r.status);
  const badge = typeof r.body["badge"] === "number" ? r.body["badge"] : undefined;
  const claim = str(r.body["claim"]);
  if (r.body["resumed"] !== true) return { kind: "fresh", eventId: ev.eventId, ...(badge !== undefined ? { badge } : {}), ...(claim !== "" ? { claim } : {}) };
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
  return asked(ev, r, name);
}

/** Ask the hosts for what a refused card names. A blank badge names nobody:
 *  the waiting screen reads "your program" until a host has said yes. */
export async function askHeld(card: HeldCard, fetchFn: typeof fetch = fetch): Promise<Ask> {
  const ev = await resolve(card.code, fetchFn);
  const r = await postEvent(ev.eventId, "/api/guest/rejoin", { passcode: card.code, ...card.by }, fetchFn);
  if (r.status === 429) throw new RejoinError(TOO_MANY, 429);
  return asked(ev, r, card.name ?? "your program");
}

function asked(ev: { eventId: string; title?: string }, r: { status: number; body: Record<string, unknown> }, name: string): Ask {
  if (r.status < 200 || r.status >= 300) throw new RejoinError(str(r.body["error"]) || CODE_CLOSED, r.status);
  return { eventId: ev.eventId, ...(ev.title !== undefined ? { title: ev.title } : {}), request: str(r.body["request"]), name: str(r.body["name"]) || name };
}

/** The waiting phone gave up: the ask leaves Needs. Never waits, never
 *  throws: a Cancel that doesn't arrive only leaves a row nobody can move. */
export function cancelAsk(ask: Ask, fetchFn: typeof fetch = fetch): void {
  void postEvent(ask.eventId, "/api/guest/rejoin/cancel", { request: ask.request }, fetchFn).catch(() => {});
}

/** Where an ask stands. `closed`: a sign-in or a release moved it on, so its
 *  card may be free. */
export type AskState = { kind: "pending" } | { kind: "approved"; guest: AdoptedGuest; by: string | null } | { kind: "booth"; booth: CardBooth; by: string | null } | { kind: "denied"; by: string | null } | { kind: "expired" } | { kind: "closed" };

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
      const token = str(r.body["token"]);
      if (r.body["part"] === true) {
        const character = str(r.body["character"]);
        if (character === "" || token === "") return { kind: "expired" };
        return { kind: "booth", by, booth: { token, character, admin: r.body["admin"] === true, host: r.body["host"] === true, eventId: ask.eventId, ...(ask.title !== undefined ? { title: ask.title } : {}) } };
      }
      const id = str(r.body["id"]);
      if (id === "" || token === "") return { kind: "expired" };
      return { kind: "approved", by, guest: { id, name: str(r.body["name"]) || ask.name, token, eventId: ask.eventId, ...(ask.title !== undefined ? { title: ask.title } : {}) } };
    }
    case "denied":
      return { kind: "denied", by };
    case "expired":
      return { kind: "expired" };
    case "closed":
      return { kind: "closed" };
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
      return `Asking the hosts to let you back in as ${name}… Find a host (or the director) and tell them — they tap Let them in on their phone.`;
    case "approved":
    case "booth":
      return `${state.by ?? "A host"} let you back in as ${name}.`;
    case "denied":
      return `${state.by ?? "A host"} said no. If you really are ${name}, find them and ask in person.`;
    case "expired":
      return "Nobody answered in time. Ask again, and find a host to tap Approve.";
    case "closed":
      return `${name} was signed in or out while you waited. If it's still you, ask again.`;
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

export const CARD_UNKNOWN = "That staff badge isn't one of tonight's — ask the director.";

/** Sign in by a cast card. The token this phone's booth is `holding` keeps
 *  its own part signed in, or moves it to a free one; a held part throws `held`. */
export function enterPart(code: string, part: string, fetchFn: typeof fetch = fetch, holding?: string): Promise<CardBooth> {
  return boothLogin(code, { part }, fetchFn, holding);
}

async function boothLogin(code: string, who: { part: string } | { character: string }, fetchFn: typeof fetch, holding?: string): Promise<CardBooth> {
  const ev = await resolve(code, fetchFn);
  const r = await postEvent(ev.eventId, "/api/prime/login", { passcode: code, ...who, ...(holding !== undefined ? { token: holding } : {}) }, fetchFn);
  if (r.status === 429) throw new RejoinError(TOO_MANY, 429);
  if (r.status === 404) throw new RejoinError(CARD_UNKNOWN, 404);
  if (r.status === 409) throw heldError(r.body) ?? new RejoinError(str(r.body["error"]) === "doors are closed" ? "The story isn't loaded yet — scan your badge again once the director opens the doors." : str(r.body["error"]) || CARD_UNKNOWN, 409);
  if (r.status < 200 || r.status >= 300) throw new RejoinError(str(r.body["error"]) || CARD_UNKNOWN, r.status);
  const token = str(r.body["token"]);
  const character = str(r.body["character"]);
  if (token === "" || character === "") throw new RejoinError(CARD_UNKNOWN, r.status);
  return { token, character, admin: r.body["admin"] === true, host: r.body["host"] === true, eventId: ev.eventId, ...(ev.title !== undefined ? { title: ev.title } : {}) };
}

/** How long one try may hang: a sign-in waits on it. */
export const OWED_TIMEOUT_MS = 4_000;

let paying: Promise<void> | null = null;
let payAgain: ReturnType<typeof setTimeout> | null = null;

/** Tell the server every release this phone owes. Resolves once tried (a
 *  sign-in waits for it, or its own badge would still read as held), and
 *  tries again while the page lives. Never throws. */
export function payOwed(storage: SessionStorage, fetchFn: typeof fetch = fetch): Promise<void> {
  if (paying !== null) return paying;
  const owed = owedReleases(storage);
  if (owed.length === 0) return Promise.resolve();
  paying = (async () => {
    for (const o of owed) {
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), OWED_TIMEOUT_MS);
      try {
        const r = await fetchFn(`/e/${encodeURIComponent(o.eventId)}/api/${o.role}/logout`, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": o.token }, body: "{}", signal: stop.signal });
        if (r.status < 500) setOwed(storage, owedReleases(storage).filter((x) => x.token !== o.token));
      } catch {
        /* still away */
      } finally {
        clearTimeout(timer);
      }
    }
  })().finally(() => {
    paying = null;
    if (owedReleases(storage).length === 0 || payAgain !== null) return;
    payAgain = setTimeout(() => {
      payAgain = null;
      void payOwed(storage, fetchFn);
    }, OWED_RETRY_MS);
  });
  return paying;
}

/** A badge read on the join screen, by camera or typed: what the page does with
 *  its QR's link (`ui.tsx`, entry `badge`). An owed release goes first, or this
 *  phone's own badge reads as held. The stored token proves a holder. A fresh
 *  badge rides into the join, an invited one with its invitation. A held one
 *  throws `held` (wave 59). */
export async function enterBadge(storage: SessionStorage, code: string, badge: string, fetchFn: typeof fetch = fetch): Promise<EnterResult> {
  await payOwed(storage, fetchFn);
  const token = storage.load<{ token?: unknown }>("loom.guest")?.token;
  const r = await enterBy(code, { badge }, fetchFn, typeof token === "string" ? token : undefined);
  if (r.kind === "fresh") {
    rememberBadge(storage, code, badge);
    rememberClaim(storage, code, r.claim);
  }
  return r;
}

/** What trying a refused card again gave. */
export type CardTry = { kind: "guest"; guest: AdoptedGuest } | { kind: "booth"; booth: CardBooth } | { kind: "fresh" };

/** An ask on this card closed: it may be free now, so try it as a scan
 *  would. One still held throws `held`. */
export async function tryCard(card: HeldCard, fetchFn: typeof fetch = fetch): Promise<CardTry> {
  if ("part" in card.by || "character" in card.by) return { kind: "booth", booth: await boothLogin(card.code, card.by, fetchFn) };
  const r = await enterBy(card.code, card.by, fetchFn);
  return r.kind === "in" ? { kind: "guest", guest: r.guest } : { kind: "fresh" };
}

// --- N-02 re-pair (moved from resume.ts: only a `?pair=` page needs it) ---

const EXPIRED = "That re-pair code has expired or was already used — ask the director for a new one.";
const HOME_EXPIRED = "This Home Screen icon's sign-in has run out. Delete the icon, open the party in Safari, and add it to your Home Screen again.";

/**
 * Turn a resume link into a guest session: resolve the event code, then
 * trade the pair code for a token. Throws a sentence a guest can read when
 * the event code or the pair code is no good.
 */
export async function adoptResume(link: ResumeLink, fetchFn: typeof fetch = fetch): Promise<AdoptedGuest> {
  const resolved = await fetchFn("/api/resolve-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: link.code }),
  });
  if (!resolved.ok) throw new Error("That link's event code isn't open any more.");
  const ev = (await resolved.json()) as { eventId?: unknown; title?: unknown };
  if (typeof ev.eventId !== "string") throw new Error("That link's event code isn't open any more.");
  const traded = await fetchFn(`/e/${encodeURIComponent(ev.eventId)}/api/guest/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pair: link.pair }),
  });
  const expired = link.home === true ? HOME_EXPIRED : EXPIRED;
  if (traded.status === 429) throw new Error("Too many tries — wait a few minutes, then scan again.");
  if (!traded.ok) throw new Error(expired);
  const who = (await traded.json()) as { id?: unknown; name?: unknown; token?: unknown };
  if (typeof who.id !== "string" || typeof who.token !== "string") throw new Error(expired);
  const title = typeof ev.title === "string" ? ev.title : undefined;
  return {
    id: who.id,
    name: typeof who.name === "string" ? who.name : who.id,
    token: who.token,
    eventId: ev.eventId,
    ...(title !== undefined ? { title } : {}),
  };
}
