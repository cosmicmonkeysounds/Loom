// Sticky notices (`pin "…"` / `unpin …`): the server stores them as
// ordinary messages carrying `pin` (the key) or `unpin`; the client keeps
// the newest pin per (channel, key) above the stream until an unpin with
// the same key lands. Pure, so a replayed backlog rebuilds the rail.

import type { ChatMessage } from "./types.ts";

/**
 * The pins still up: per (channel, key) the newest `pin` message not
 * followed (by seq) by an `unpin` with the same key. Hidden messages and
 * thread replies never pin. Seq-ordered; `channel` narrows to one room.
 */
export function activePins(messages: Iterable<ChatMessage>, channel?: string): ChatMessage[] {
  const live = new Map<string, ChatMessage>();
  for (const m of [...messages].sort((a, b) => a.seq - b.seq)) {
    if (m.hidden || m.parentSeq !== null || (channel !== undefined && m.channel !== channel)) continue;
    if (m.pin !== undefined) live.set(`${m.channel}\u0000${m.pin}`, m);
    else if (m.unpin !== undefined) live.delete(`${m.channel}\u0000${m.unpin}`);
  }
  return [...live.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * The takeover still up (`pin "!!…"`): the newest active pin carrying
 * `takeover`, or null. Read from every message the guest received — not
 * just the rooms listed — so a restricted guest whose list hides the lobby
 * still gets it.
 */
export function activeTakeover(messages: Iterable<ChatMessage>): ChatMessage | null {
  const up = activePins(messages).filter((m) => m.takeover === true);
  return up.length > 0 ? up[up.length - 1]! : null;
}

/** The seqs of `!` pins a later `unpin` (or a newer pin with the same key)
 *  already took down — the 🩹 after a mis-tapped mark, the dance lifting a
 *  `!!` takeover. Such a pin is no longer news: it is never a moment (not on
 *  wake, not after a reload), and one still queued or missed goes away. */
export function retractedPinSeqs(messages: Iterable<ChatMessage>): Set<number> {
  const list = [...messages];
  const live = new Set(activePins(list).map((m) => m.seq));
  const out = new Set<number>();
  for (const m of list) if (m.alert === true && m.pin !== undefined && !live.has(m.seq)) out.add(m.seq);
  return out;
}
