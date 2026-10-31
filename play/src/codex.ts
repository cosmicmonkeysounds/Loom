//! Pure helpers behind the Codex + People surfaces: private-thread ids
//! between two participants (mirror of the server's `Sim.pmChannel`) and
//! the `?unlock=` deep link a wall QR carries. No React, no storage —
//! unit-tested in `test/codex.test.ts`. (The alert chime lives in
//! `alerts.ts`.)

import { eventGone, guestSessionDead, performerSessionDead } from "./lifecycle.ts";
import type { CodexEntry, PersonCard } from "./types.ts";

/** The private thread between two participants — one id whoever opens it. */
export function pmChannelId(a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `pm:${x}:${y}`;
}

/** The other party of a `pm:` channel, from my point of view (null if not mine). */
export function pmOtherParty(channel: string, me: string): string | null {
  if (!channel.startsWith("pm:")) return null;
  const parties = channel.slice("pm:".length).split(":");
  if (parties.length !== 2 || !parties.includes(me)) return null;
  return parties[0] === me ? parties[1]! : parties[0]!;
}

/** The unlock code riding a scanned QR's link (`?code=…&unlock=…`). */
export function unlockFromSearch(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get("unlock");
    return v !== null && v.trim() !== "" ? v.trim() : null;
  } catch {
    return null;
  }
}

/** `search` without its `unlock` param (so a reload doesn't redeem twice). */
export function withoutUnlock(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("unlock");
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

/** What the Codex box says when a redeem fails (K-11 throttles a guest's
 *  redeems: 8 a minute, then 429). Null = say nothing — a wrong code is
 *  answered in the Codex room itself, and other failures stay quiet. */
export const REDEEM_THROTTLED = "Too many tries — wait a minute, then try again.";
/** What the typed box says when the text is no code at all. */
export const TYPED_UNKNOWN = "That isn't a code — check the sign and type it again.";
export function redeemErrorText(e: unknown): string | null {
  const status = typeof e === "object" && e !== null ? (e as { status?: unknown }).status : undefined;
  return status === 429 ? REDEEM_THROTTLED : null;
}

/** Who Share… offers an entry to: everyone in the directory except an
 *  agent-voiced character who would refuse it (the server's
 *  `Sim.agentRefusal`, 403): a `secret: true` entry, or one `about` someone
 *  or somewhere else. A guest is never offered Trabolta for a digit note.
 *  An entry the view doesn't list (an old server) filters nothing. */
export function shareTargets(people: readonly PersonCard[], entry: CodexEntry | undefined): PersonCard[] {
  if (entry === undefined) return [...people];
  return people.filter((p) => p.agent === undefined || (entry.secret !== true && (entry.about === null || entry.about === p.id)));
}

/** What a refused Share… says (T5-05): the server names the reason — an
 *  agent won't take lore about someone else, or a secret file — so the
 *  guest isn't left thinking it worked. Null for a session
 *  the app is dropping anyway (it explains itself on the join screen). */
export function shareErrorText(e: unknown): string | null {
  const status = typeof e === "object" && e !== null ? (e as { status?: unknown }).status : undefined;
  const message = e instanceof Error ? e.message : "";
  if (typeof status !== "number") return "⚠️ Not shared — check your connection and try again.";
  if (eventGone(status, message) || guestSessionDead(status, message) || performerSessionDead(status, message)) return null;
  return `⛔ Not shared: ${message || `HTTP ${status}`}`;
}
