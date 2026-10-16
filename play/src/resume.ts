//! Re-pair a lost guest (N-02). The director's Run Inspector mints a
//! single-use, ten-minute **pair code** for an existing guest and shows it as
//! a QR: `…/?code=<event>&pair=<code>`. The phone that opens it trades the
//! code at `POST /e/:id/api/guest/resume {pair}` for a fresh token and adopts
//! it as its guest session (`loom.guest`) — the SAME Person, with their
//! codex, quests and score. The code is stripped from the URL at once, and a
//! phone already signed in as someone asks before it switches.
//!
//! The same route opens an iPhone's **Home Screen app** for the first time
//! (K-31b): its `start_url` is `/?code=&pair=&home=1`, the nonce the guest's
//! Safari minted. iOS reopens an icon at its `start_url`, so a `home` link on
//! a phone already holding a session is the spent nonce coming round again —
//! dropped silently, never a "switch this phone?" question.
//! Pure helpers + an injectable fetch — unit-tested in `test/resume.test.ts`.

/** The re-pair link a scanned QR carries, or null. */
export interface ResumeLink {
  code: string;
  pair: string;
  /** The Home Screen icon's own start link (K-31b), not a director's QR. */
  home?: boolean;
}

export function resumeFromSearch(search: string): ResumeLink | null {
  try {
    const p = new URLSearchParams(search);
    const pair = (p.get("pair") ?? "").trim();
    const code = (p.get("code") ?? "").trim();
    if (pair === "" || code === "") return null;
    return p.get("home") === "1" ? { code, pair, home: true } : { code, pair };
  } catch {
    return null;
  }
}

/** `search` without its `pair` param (the code is a one-time credential). */
export function withoutResume(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("pair");
  p.delete("home");
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

/** The guest session a resume link adopts (the `loom.guest` record). */
export interface AdoptedGuest {
  id: string;
  name: string;
  token: string;
  eventId: string;
  title?: string;
}

/** The name of the guest this phone is already signed in as (`loom.guest`),
 *  or null — so the app asks before a re-pair link replaces it. */
export function storedGuestName(raw: string | null): string | null {
  if (raw === null || raw === "") return null;
  try {
    const g = JSON.parse(raw) as { name?: unknown; id?: unknown };
    if (typeof g.name === "string" && g.name !== "") return g.name;
    return typeof g.id === "string" ? g.id : "another guest";
  } catch {
    return null;
  }
}

/** The link to act on: a Home Screen relaunch on a phone that already has
 *  a session (guest or booth) is nothing to do. */
export function resumeToAdopt(link: ResumeLink | null, storedGuest: string | null, storedPrime: string | null): ResumeLink | null {
  if (link === null) return null;
  if (link.home === true && ((storedGuest ?? "") !== "" || (storedPrime ?? "") !== "")) return null;
  return link;
}

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
