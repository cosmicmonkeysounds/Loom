//! The room list's order (wave 13: a fixed order that stops jumping). The
//! sessions pass `roomOrder` as `ThreadsOptions.order`; `presence.ts`
//! re-exports it; the booth reuses it and `foldRooms` (never a copy).
//!
//! Rooms sort into fixed tiers, and inside a tier they keep a stable order
//! (the session's `order` key, then the name) — a new line never lifts a
//! room past its neighbours. A room only moves when its tier changes: you
//! walk into it, it starts asking you something, a badge appears.
//!
//!   0  pinned — Quest Log, Codex, Wallet (their own fixed order)
//!   1  staff rooms (a booth's `# hosts`, `# quarantine`)
//!   2  the room you stand in
//!   3  rooms that ask (a decision, a card waiting on you)
//!   4  agent-voiced DMs (Trabolta)
//!   5  the lobby (the one announcement home)
//!   6  other DMs with a badge
//!   7  rooms with someone in them, or something unread
//!   8  everything else — folded into "Other rooms (n)"

import type { Channel } from "../types.ts";

/** The tier a room sorts in (lower first). */
export function roomTier(c: Channel): number {
  if (c.spaceId === "pinned") return 0;
  if (c.staff === true) return 1;
  if (c.here === true) return 2;
  if (c.decision !== null && c.decision !== undefined) return 3;
  if (c.needsYou === true) return 3;
  if (c.agent === true) return 4;
  if (c.kind === "lobby") return 5;
  const dm = c.kind === "dm" || c.kind === "guest";
  if (dm && c.unread > 0) return 6;
  if (c.unread > 0) return 7;
  if (c.kind === "location") return (c.people?.length ?? 0) > 0 ? 7 : 8;
  // A chatroom or a DM: someone in it, or a conversation to go back to.
  if ((c.people?.length ?? 0) > 0 || c.messages.length > 0) return 7;
  return 8;
}

/** The tier past which rooms fold away. */
export const FOLD_TIER = 8;

/** A stable name for the in-tier order (the title, without "the"). */
function sortName(c: Channel): string {
  return c.title.replace(/^(the|a|an)\s+/iu, "").toLowerCase();
}

/**
 * Sort rooms the way a person looks for them, in fixed tiers (above) with a
 * stable order inside each: the session's `order` key, then the name.
 */
export function roomOrder(a: Channel, b: Channel): number {
  const ta = roomTier(a);
  const tb = roomTier(b);
  if (ta !== tb) return ta - tb;
  const oa = a.order ?? 0;
  const ob = b.order ?? 0;
  if (oa !== ob) return oa - ob;
  const na = sortName(a);
  const nb = sortName(b);
  return na < nb ? -1 : na > nb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Split a sorted room list into what the sidebar shows and what folds into
 * "Other rooms (n)": the empty, quiet rooms. The open room (`activeId`)
 * never folds away, and a list with only a couple of quiet rooms keeps
 * them (a fold of one is just another tap).
 */
export function foldRooms<T extends Channel>(list: readonly T[], activeId?: string | null, minFold = 2): { shown: T[]; folded: T[] } {
  const shown: T[] = [];
  const folded: T[] = [];
  for (const c of list) (roomTier(c) >= FOLD_TIER && c.id !== activeId ? folded : shown).push(c);
  if (folded.length < minFold) return { shown: [...list], folded: [] };
  return { shown, folded };
}
