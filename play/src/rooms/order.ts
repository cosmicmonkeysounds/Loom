//! The room list's order (moved out of `presence.ts` in wave 13). The
//! sessions pass it as `ThreadsOptions.order`; `presence.ts` re-exports it.

import type { Channel } from "../types.ts";

/**
 * Sort a space's rooms the way a person looks for them: the room you are
 * standing in first, then anything asking for a decision or an answer (an
 * unanswered card), then unread, then
 * rooms with people in them, then most recent. Empty, quiet rooms sink.
 */
export function roomOrder(a: Channel, b: Channel): number {
  // Pinned rooms come first and keep their place (Quest Log, then Codex),
  // whatever is new — a tier of their own, so the order stays consistent.
  const pa0 = a.spaceId === "pinned";
  const pb0 = b.spaceId === "pinned";
  if (pa0 !== pb0) return pa0 ? -1 : 1;
  if (pa0) return (a.order ?? 0) - (b.order ?? 0);
  if (!!a.here !== !!b.here) return a.here ? -1 : 1;
  const asksA = !!a.decision || !!a.needsYou;
  const asksB = !!b.decision || !!b.needsYou;
  if (asksA !== asksB) return asksA ? -1 : 1;
  if ((a.unread > 0) !== (b.unread > 0)) return a.unread > 0 ? -1 : 1;
  const pa = a.people?.length ?? 0;
  const pb = b.people?.length ?? 0;
  if ((pa > 0) !== (pb > 0)) return pa > 0 ? -1 : 1;
  return b.lastTs - a.lastTs;
}
