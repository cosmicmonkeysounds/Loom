//! Channel plumbing shared by the guest + performer apps: grouping a flat
//! message map into threads, deriving channel headers from ids, and the
//! unread / active-thread bookkeeping that makes the list feel like a
//! Discord / Telegram inbox (badges, decision-pulls, last-seen marks).

import { useEffect, useState } from "react";
import { roomOrder } from "./presence.ts";
import type { Channel, ChannelKind, ChatMessage, MessageKind, QuestStatus } from "./types.ts";

/** `MODERATOR_PRIME` / `recruiter` → a friendly contact name. A name the
 *  story already wrote in mixed case (`WebMD`, `MS Paint`, `MS_Paint`,
 *  `Norton Anti-Virus`) keeps its casing (each word's first letter is
 *  raised: `cast_Member` → "Cast Member"); only all-caps and all-lower raw
 *  ids are recased. */
export function prettyName(raw: string): string {
  const words = raw.split(/[_\s]+/).filter(Boolean);
  const mixed = /\p{Ll}/u.test(raw) && /\p{Lu}/u.test(raw);
  if (mixed) return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/** "the Mods", but "The Way Out" as named: a group whose name already
 *  starts with an article keeps it, so a button never reads "the The …"
 *  (the server's notices use the same rule, `withThe` in core's chat.ts). */
export function withThe(name: string): string {
  return /^(the|a|an)\s/iu.test(name) ? name : `the ${name}`;
}

/** Title + kind for a channel id, used for threads with no messages yet. */
export function channelHead(id: string): { kind: ChannelKind; title: string } {
  if (id === "lobby") return { kind: "lobby", title: "Lobby" };
  if (id === CODEX_ROOM) return { kind: "codex", title: "Codex" };
  if (id === QUEST_LOG) return { kind: "quests", title: "Quest Log" };
  if (id.startsWith("faction:")) return { kind: "faction", title: `#${id.slice(8).toLowerCase()}` };
  if (id.startsWith("dm:")) return { kind: "dm", title: prettyName(id.slice(3)) };
  if (id.startsWith("loc:")) return { kind: "location", title: prettyName(id.slice(4)) };
  // A private thread between two participants — the session names it after
  // the other party once it knows who that is.
  if (id.startsWith("pm:")) return { kind: "dm", title: "Private" };
  return { kind: "dm", title: id };
}

// --- spaces (the Discord-style sidebar sections) ----------------------------

/** Sidebar space metadata. `story` holds the story's own rooms (titled after
 *  the story — nothing is baked in); the booth groups the performer's tools +
 *  per-guest threads. Authored spaces (any other id) sort between them,
 *  titled from the channel's `spaceTitle`. */
export const STORY_SPACE = "story";
/** The pinned rooms: your Codex + your Quest Log, above everything else. */
export const PINNED_SPACE = "pinned";
export const CODEX_ROOM = "codex";
export const QUEST_LOG = "quests";
export const SPACES: Record<string, { title: string; order: number }> = {
  [PINNED_SPACE]: { title: "Pinned", order: -2 },
  booth: { title: "Booth", order: -1 }, // the performer's tools, pinned on top
  [STORY_SPACE]: { title: "Story", order: 0 },
  cast: { title: "Cast", order: 0.5 }, // agent-voiced characters a performer can message
  guests: { title: "Guests", order: 1 }, // a performer's guests, right under the rooms
};
export function spaceTitle(id: string): string {
  return SPACES[id]?.title ?? id;
}
function spaceOrder(id: string): number {
  return SPACES[id]?.order ?? 5; // authored spaces: after the story, guests, and cast
}

export interface SpaceGroup {
  id: string;
  title: string;
  channels: Channel[];
}

/**
 * Fold an already-sorted channel list into ordered space sections, preserving
 * the within-list order (decisions-first / most-recent) inside each space.
 * An authored section's title rides on its channels' `spaceTitle`.
 */
export function groupBySpace(list: Channel[]): SpaceGroup[] {
  const byId = new Map<string, Channel[]>();
  for (const c of list) {
    const arr = byId.get(c.spaceId) ?? [];
    arr.push(c);
    byId.set(c.spaceId, arr);
  }
  return [...byId.entries()]
    .map(([id, channels]) => ({ id, title: channels[0]?.spaceTitle ?? spaceTitle(id), channels }))
    .sort((a, b) => spaceOrder(a.id) - spaceOrder(b.id));
}

// --- sender-run grouping (the Slack/Discord consecutive-sender banner) -------

export interface MessageRun {
  from: string;
  kind: MessageKind;
  messages: ChatMessage[];
}

/** Consecutive `line`s from one sender within this window share a banner. */
export const RUN_WINDOW_MS = 5 * 60 * 1000; // story-clock ms (deterministic)

/**
 * Coalesce consecutive same-sender messages into runs. A new run starts when
 * the sender changes, the kind isn't `line` (narration / system / signal each
 * stand alone), or the story-clock gap exceeds `RUN_WINDOW_MS`.
 */
export function groupRuns(messages: ChatMessage[]): MessageRun[] {
  const runs: MessageRun[] = [];
  for (const m of messages) {
    const last = runs[runs.length - 1];
    const prev = last?.messages[last.messages.length - 1];
    const sameRun =
      last !== undefined &&
      prev !== undefined &&
      m.kind === "line" &&
      last.kind === "line" &&
      last.from === m.from &&
      m.ts - prev.ts < RUN_WINDOW_MS;
    if (sameRun) last!.messages.push(m);
    else runs.push({ from: m.from, kind: m.kind, messages: [m] });
  }
  return runs;
}

// --- threads (Slack-style replies under a root message) ---------------------

/** Top-level messages of a channel (replies are tucked into their thread). */
export function rootsOf(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.parentSeq == null);
}
/** Replies hanging under a root message, seq-ordered. */
export function repliesFor(messages: ChatMessage[], rootSeq: number): ChatMessage[] {
  return messages.filter((m) => m.parentSeq === rootSeq).sort((a, b) => a.seq - b.seq);
}
/** How many replies a root message has. */
export function replyCountFor(messages: ChatMessage[], rootSeq: number): number {
  let n = 0;
  for (const m of messages) if (m.parentSeq === rootSeq) n += 1;
  return n;
}

/**
 * Where a quest stands, read off its thread: the last `complete` / `fail`
 * step under the card settles it; otherwise it is active.
 */
export function questStatusOf(messages: ChatMessage[], rootSeq: number): QuestStatus {
  let status: QuestStatus = "active";
  for (const m of messages) {
    if (m.parentSeq !== rootSeq || m.quest === undefined) continue;
    if (m.quest.action === "complete") status = "done";
    else if (m.quest.action === "fail") status = "failed";
  }
  return status;
}

/** "2 active · 1 done" — the Quest Log's one-line summary. */
export function questSummary(quests: ReadonlyArray<{ status: QuestStatus }>): string {
  if (quests.length === 0) return "no quests yet";
  const n = (s: QuestStatus) => quests.filter((q) => q.status === s).length;
  const parts = [`${n("active")} active`];
  if (n("done") > 0) parts.push(`${n("done")} done`);
  if (n("failed") > 0) parts.push(`${n("failed")} failed`);
  return parts.join(" · ");
}

/** Group a message map into per-channel, seq-ordered buckets. */
export function groupByChannel(messages: Map<number, ChatMessage>): Map<string, ChatMessage[]> {
  const out = new Map<string, ChatMessage[]>();
  for (const m of [...messages.values()].sort((a, b) => a.seq - b.seq)) {
    const bucket = out.get(m.channel) ?? [];
    bucket.push(m);
    out.set(m.channel, bucket);
  }
  return out;
}

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
