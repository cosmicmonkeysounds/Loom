//! Re-pair a lost guest (N-02). The director's Run Inspector mints a
//! single-use, ten-minute **pair code** for an existing guest and shows it as
//! a QR: `…/?code=<event>&pair=<code>`. The phone that opens it trades the
//! code at `POST /e/:id/api/guest/resume {pair}` for a fresh token and adopts
//! it as its guest session (`loom.guest`) — the SAME Person, with their
//! codex, quests and score. The code is stripped from the URL at once, and a
//! phone already signed in as someone asks before it switches.
//! Pure helpers + an injectable fetch — unit-tested in `test/resume.test.ts`.

/** The re-pair link a scanned QR carries, or null. */
export interface ResumeLink {
  code: string;
  pair: string;
}

export function resumeFromSearch(search: string): ResumeLink | null {
  try {
    const p = new URLSearchParams(search);
    const pair = (p.get("pair") ?? "").trim();
    const code = (p.get("code") ?? "").trim();
    return pair !== "" && code !== "" ? { code, pair } : null;
  } catch {
    return null;
  }
}

/** `search` without its `pair` param (the code is a one-time credential). */
export function withoutResume(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("pair");
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

const EXPIRED = "That re-pair code has expired or was already used — ask the director for a new one.";

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
  if (traded.status === 429) throw new Error("Too many tries — wait a few minutes, then scan again.");
  if (!traded.ok) throw new Error(EXPIRED);
  const who = (await traded.json()) as { id?: unknown; name?: unknown; token?: unknown };
  if (typeof who.id !== "string" || typeof who.token !== "string") throw new Error(EXPIRED);
  const title = typeof ev.title === "string" ? ev.title : undefined;
  return {
    id: who.id,
    name: typeof who.name === "string" ? who.name : who.id,
    token: who.token,
    eventId: ev.eventId,
    ...(title !== undefined ? { title } : {}),
  };
}
