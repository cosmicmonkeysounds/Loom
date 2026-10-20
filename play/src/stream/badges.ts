//! The room list's badge rule (wave 13 seam; the stream lane owns it).
//! Stage A keeps today's rule exactly: every message past the read mark
//! counts, and a docked decision counts at least one. `me` is unused until
//! the stream lane counts only what is for the viewer.

import type { Viewer } from "../rooms/threads-state.ts";
import type { Channel } from "../types.ts";

/** How many badge-worthy messages `c` has past `seen` (its read mark). */
export function unreadOf(c: Channel, seen: number, _me: Viewer | undefined): number {
  const fresh = c.messages.filter((m) => m.seq > seen).length;
  return c.decision ? Math.max(1, fresh) : fresh;
}
