//! What the guest has seen of the Codex (wave 18, GUEST-SPEC §11 rule 6):
//! Mission's tile dot reads it at once, so it lives apart from the Codex
//! room itself (a lazy chunk, fix round: the guest's first load).

import type { SessionStorage } from "../host.ts";
import type { ChatMessage } from "../types.ts";
import { codexRows, newEntries } from "./codex-groups.ts";

function seenKey(meId: string | null | undefined): string {
  return `loom.stream.codex-seen.${meId ?? "booth"}`;
}

/** How long the Codex must be on screen before what it shows counts as seen
 *  (wave 18, GUEST-SPEC §11 rule 6). */
export const CODEX_SEEN_MS = 2_000;

/** The seen records this page holds, so Mission's tile reads a save at once. */
const SEEN_CACHE = new Map<string, ReadonlySet<string>>();

export function loadSeen(storage: SessionStorage, meId: string | null | undefined): ReadonlySet<string> | null {
  const key = seenKey(meId);
  const cached = SEEN_CACHE.get(key);
  if (cached !== undefined) return cached;
  try {
    const list = storage.load<string[]>(key);
    return Array.isArray(list) ? new Set(list) : null;
  } catch {
    return null;
  }
}

export function saveSeen(storage: SessionStorage, meId: string | null | undefined, list: readonly string[]): void {
  SEEN_CACHE.set(seenKey(meId), new Set(list));
  try {
    storage.save(seenKey(meId), list);
  } catch {
    /* a full or blocked store: the record lives for this visit */
  }
}

/** Does the Codex hold an entry the guest hasn't seen (Mission's tile dot)? */
export function codexUnseen(storage: SessionStorage, meId: string | null | undefined, messages: readonly ChatMessage[]): boolean {
  return newEntries(codexRows(messages), loadSeen(storage, meId)).size > 0;
}

