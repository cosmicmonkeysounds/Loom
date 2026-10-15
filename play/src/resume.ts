//! Re-pair a lost guest (N-02). The director's Run Inspector mints a fresh
//! token for an existing guest and shows it as a QR:
//! `…/?code=<event>&resume=<token>`. The phone that opens it adopts that
//! token as its guest session (`loom.guest`) — the SAME Person, with their
//! codex, quests and score — and the token is stripped from the URL at once
//! so it never sits in the address bar, history, or a reload.
//! Pure helpers + an injectable fetch — unit-tested in `test/resume.test.ts`.

/** The re-pair link a scanned QR carries, or null. */
export interface ResumeLink {
  code: string;
  token: string;
}

export function resumeFromSearch(search: string): ResumeLink | null {
  try {
    const p = new URLSearchParams(search);
    const token = (p.get("resume") ?? "").trim();
    const code = (p.get("code") ?? "").trim();
    return token !== "" && code !== "" ? { code, token } : null;
  } catch {
    return null;
  }
}

/** `search` without its `resume` param (the token is a credential). */
export function withoutResume(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("resume");
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

/**
 * Turn a resume link into a guest session: resolve the event code, then ask
 * the event who the token is (`/api/state?role=guest`). Throws a sentence a
 * guest can read when the code or the token is no good.
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
  const who = await fetchFn(`/e/${encodeURIComponent(ev.eventId)}/api/state?role=guest`, { headers: { "x-loom-token": link.token } });
  if (!who.ok) throw new Error("That re-pair code has expired — ask the director for a new one.");
  const view = (await who.json()) as { id?: unknown; name?: unknown; title?: unknown };
  if (typeof view.id !== "string") throw new Error("That re-pair code has expired — ask the director for a new one.");
  const title = typeof ev.title === "string" ? ev.title : typeof view.title === "string" ? view.title : undefined;
  return {
    id: view.id,
    name: typeof view.name === "string" ? view.name : view.id,
    token: link.token,
    eventId: ev.eventId,
    ...(title !== undefined ? { title } : {}),
  };
}
