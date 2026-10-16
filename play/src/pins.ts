//! Sticky notices (`pin "…"` / `unpin …`): the server stores them as
//! ordinary messages carrying `pin` (the key) or `unpin`; the client keeps
//! the newest pin per (channel, key) above the stream until an unpin with
//! the same key lands. Pure, so a replayed backlog rebuilds the rail.

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
