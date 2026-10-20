//! The unread / active-thread bookkeeping that makes the room list feel
//! like a Discord / Telegram inbox (moved out of `threads.ts` in wave 13):
//! badges, decision-pulls, last-seen marks, open / back.

import { useEffect, useState } from "react";
import { roomOrder } from "./order.ts";
import { groupBySpace, type SpaceGroup } from "./spaces.ts";
import type { Channel, ChatMessage } from "../types.ts";

/** The highest seq across a channel's messages (−1 when empty). */
function maxSeq(c: Channel): number {
  return c.messages.length ? c.messages[c.messages.length - 1]!.seq : -1;
}

export interface Threads {
  /** Channels, decisions + unread first, then most-recent — ready to render. */
  list: Channel[];
  /** The same channels folded into ordered Discord-style space sections. */
  spaces: SpaceGroup[];
  activeId: string | null;
  active: Channel | null;
  open: (id: string) => void;
  back: () => void;
  /** The root `seq` of the open Slack-style thread panel, if any. */
  activeThreadRoot: number | null;
  openThread: (rootSeq: number) => void;
  closeThread: () => void;
  /** Mark these messages read (each room up to its newest one listed) —
   *  what the guest already read somewhere else, like the cutscene stage. */
  markRead: (messages: Iterable<Pick<ChatMessage, "channel" | "seq">>) => void;
}

/** Where a session keeps its read marks, so a reload doesn't turn the
 *  whole backlog back into badges: one storage `slot`, holding the marks of
 *  the current sign-in (`session`; null = signed out, nothing kept). */
export interface ReadMarkStore {
  load<T>(key: string): T | null;
  save(key: string, value: unknown): void;
}
export interface ReadMarkPersist {
  store: ReadMarkStore;
  slot: string;
  session: string | null;
}

/** Fold `messages` into `marks`: each room's mark moves up to the newest
 *  listed seq (never back). Returns `marks` itself when nothing moved. */
export function advanceMarks(marks: ReadonlyMap<string, number>, messages: Iterable<Pick<ChatMessage, "channel" | "seq">>): ReadonlyMap<string, number> {
  let next: Map<string, number> | null = null;
  for (const m of messages) {
    const cur = (next ?? marks).get(m.channel) ?? -1;
    if (m.seq <= cur) continue;
    next ??= new Map(marks);
    next.set(m.channel, m.seq);
  }
  return next ?? marks;
}

/**
 * Layer unread counts + open/close navigation over a freshly-built channel
 * set. A thread is "unread" when it has messages past the last-seen mark or
 * a pending decision; the list is ordered by `roomOrder` (where you stand,
 * decisions, unread, populated rooms, recency) so an unanswered choice
 * always pulls focus and an empty room never crowds the top.
 */
export function useThreads(channels: Channel[], persist?: ReadMarkPersist): Threads {
  const storeKey = persist?.session ?? null;
  const load = (): ReadonlyMap<string, number> => {
    if (persist === undefined || storeKey === null) return new Map();
    const raw = persist.store.load<{ session?: unknown; marks?: Record<string, unknown> }>(persist.slot);
    if (raw === null || raw.session !== storeKey || typeof raw.marks !== "object" || raw.marks === null) return new Map();
    return new Map(Object.entries(raw.marks).flatMap(([k, v]) => (typeof v === "number" ? [[k, v] as [string, number]] : [])));
  };
  const [marks, setMarks] = useState<{ key: string | null; marks: ReadonlyMap<string, number> }>(() => ({ key: storeKey, marks: load() }));
  // A new sign-in reads its own marks (a fresh one starts with none).
  const readMarks = marks.key === storeKey ? marks.marks : load();
  if (marks.key !== storeKey) setMarks({ key: storeKey, marks: readMarks });
  const setReadMarks = (fn: (prev: ReadonlyMap<string, number>) => ReadonlyMap<string, number>) =>
    setMarks((prev) => {
      const next = fn(prev.marks);
      if (next === prev.marks) return prev;
      if (persist !== undefined && prev.key !== null) persist.store.save(persist.slot, { session: prev.key, marks: Object.fromEntries(next) });
      return { key: prev.key, marks: next };
    });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeThreadRoot, setActiveThreadRoot] = useState<number | null>(null);

  const active = channels.find((c) => c.id === activeId) ?? null;
  const activeMax = active ? maxSeq(active) : -1;

  // Reading a thread (or new messages landing while it's open) advances its
  // last-seen mark, clearing the badge.
  useEffect(() => {
    if (activeId === null) return;
    setReadMarks((prev) => advanceMarks(prev, [{ channel: activeId, seq: activeMax }]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeMax, storeKey]);

  const list = channels
    .map((c) => {
      const seen = readMarks.get(c.id) ?? -1;
      const fresh = c.messages.filter((m) => m.seq > seen).length;
      return { ...c, unread: c.decision ? Math.max(1, fresh) : fresh };
    })
    .sort(roomOrder);

  return {
    list,
    spaces: groupBySpace(list),
    activeId,
    active: list.find((c) => c.id === activeId) ?? active,
    open: (id) => {
      setActiveId(id);
      setActiveThreadRoot(null); // opening a channel closes any thread panel
    },
    back: () => {
      setActiveId(null);
      setActiveThreadRoot(null);
    },
    activeThreadRoot,
    openThread: (rootSeq) => setActiveThreadRoot(rootSeq),
    closeThread: () => setActiveThreadRoot(null),
    markRead: (messages) => setReadMarks((prev) => advanceMarks(prev, messages)),
  };
}
