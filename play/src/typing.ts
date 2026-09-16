//! "Trabolta is typing…" — the indicator an agent-voiced character shows
//! while a stagehand worker composes its reply. The server sends `typing`
//! frames (`{channel, from, on, audience}`) only to the people in that
//! thread; this maps one onto the thread id each app uses and keeps the
//! set of threads currently being typed into. A frame that never gets its
//! `on: false` (a dropped stream) ages out after `TYPING_TTL_MS`.

import { useCallback, useEffect, useState } from "react";

export interface TypingNotice {
  channel: string;
  from: string;
  on: boolean;
  audience: string[];
}

/** Longest a typing indicator may linger without a follow-up frame. */
export const TYPING_TTL_MS = 150_000;

/**
 * The thread a notice belongs to from the viewer's side. A guest's DM with
 * the character is its `dm:` channel; a performer's own conversation with
 * it is `cast:<Character>`; an admin performer watching a guest's thread
 * sees it on `guest:<id>`.
 */
export function typingThread(n: TypingNotice, viewer: { role: "guest" } | { role: "performer"; character: string }): string {
  if (viewer.role === "guest") return n.channel;
  const who = n.audience[0] ?? "";
  if (who === `@${viewer.character}`) return `cast:${n.from}`;
  return who.startsWith("@") ? `cast:${n.from}` : `guest:${who}`;
}

/** Fold one notice into the thread → typist map (a new map when it changes). */
export function applyTyping(prev: ReadonlyMap<string, string>, thread: string, n: TypingNotice): ReadonlyMap<string, string> {
  if (n.on) {
    if (prev.get(thread) === n.from) return prev;
    return new Map(prev).set(thread, n.from);
  }
  if (!prev.has(thread)) return prev;
  const next = new Map(prev);
  next.delete(thread);
  return next;
}

/** Live typing state for one session: `typing.get(threadId)` → who. */
export function useTyping(viewer: { role: "guest" } | { role: "performer"; character: string } | null): {
  typing: ReadonlyMap<string, string>;
  onTyping: (n: TypingNotice) => void;
} {
  const [typing, setTyping] = useState<ReadonlyMap<string, string>>(() => new Map());
  const character = viewer !== null && viewer.role === "performer" ? viewer.character : null;
  const role = viewer?.role ?? null;
  const onTyping = useCallback(
    (n: TypingNotice) => {
      if (role === null) return;
      const thread = typingThread(n, role === "guest" ? { role } : { role, character: character ?? "" });
      setTyping((prev) => applyTyping(prev, thread, n));
      if (n.on) {
        window.setTimeout(() => setTyping((prev) => applyTyping(prev, thread, { ...n, on: false })), TYPING_TTL_MS);
      }
    },
    [role, character],
  );
  // A new session (sign-in / sign-out) starts with nobody typing.
  useEffect(() => setTyping(new Map()), [role, character]);
  return { typing, onTyping };
}
