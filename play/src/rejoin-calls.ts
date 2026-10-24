//! The server calls behind getting back in (wave 23, see `rejoin.ts`):
//! enter by badge / invitation / cast card, and the ask-a-host round. A
//! chunk of its own (`loadRejoinCalls`): only a page opened by a badge, an
//! invitation or a cast card, or the join screen's *Get back in* panel,
//! fetches it — never a guest's first load. Injectable fetch —
//! `test/rejoin.test.ts`.

import type { AdoptedGuest, ResumeLink } from "./resume.ts";
import { BADGE_UNKNOWN } from "./rejoin.ts";

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
