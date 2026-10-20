//! Message runs + Slack-style threads (moved out of `threads.ts` in wave
//! 13): coalescing same-sender lines, roots and replies, a quest's status
//! read off its thread, and grouping a message map per channel.

import type { ChatMessage, MessageKind, QuestStatus } from "../types.ts";

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
