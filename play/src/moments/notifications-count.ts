//! Notifications, the eager half (wave 18, the moments lane; GUEST-SPEC
//! §4.1): which rows there are — every moment for this guest, every personal
//! `~` notice, the house `~` notices grouped per glyph + phase, newest
//! first, capped — and which are unread. The bell needs this on every
//! screen; the window's words (`notifications.ts`) and the window itself
//! (`notifications.tsx`) load with the window. Pure.

import { noticeKey } from "../../../core/src/delivery.ts";
import type { ChatMessage } from "../types.ts";
import { momentOf, phaseOf, type Moment, type Viewer } from "./model.ts";

/** At most this many rows (the newest). */
export const NOTIFICATIONS_MAX = 200;

/** A row before its words: its key, the seqs it stands for, its moment, and a fold's notices. */
export interface NotificationGroup {
  /** `m:<seq>` (a message), `o:<id>` (a loud objective), `n:<glyph>:<phase>` (folded house notices). */
  key: string;
  /** Every seq the row stands for. */
  members: number[];
  /** The moment its exits come from. */
  moment: Moment;
  /** Folded house notices (2+), newest last. */
  fold?: { glyph: string; phase: string; list: ChatMessage[] };
  at: number;
  seq: number | null;
}

/** A `~` notice as a moment (it never is one on the ladder). */
export function noticeMoment(m: ChatMessage, phase: string | null): Moment {
  return {
    key: `m:${m.seq}`,
    seq: m.seq,
    severity: "minor",
    kind: "other",
    caption: m.from.trim() !== "" && m.from.trim() !== "Narrator" ? m.from.trim() : "Notice",
    text: m.text.trim(),
    channel: m.channel,
    at: m.ts,
    phase: phaseOf(m, phase),
    ...(m.audience === "all" ? { house: true } : {}),
  };
}

/**
 * The rows for this guest: every moment (and `extra`, the client-made ones —
 * a loud objective, a beat's blue screen), every personal `~` notice, and the
 * house `~` notices grouped per glyph + phase (a lone one stays itself).
 * Newest first, capped at `NOTIFICATIONS_MAX`; `deleted` keys (and a fold's
 * deleted members) left out.
 */
export function notificationGroups(messages: Iterable<ChatMessage>, viewer: Viewer, phase: string | null, deleted: ReadonlySet<string>, extra: readonly Moment[] = []): NotificationGroup[] {
  const out: NotificationGroup[] = [];
  const keys = new Set<string>();
  const folds = new Map<string, ChatMessage[]>();
  const one = (moment: Moment, members: number[]) => {
    out.push({ key: moment.key, members, moment, at: moment.at, seq: moment.seq });
    keys.add(moment.key);
  };
  for (const m of messages) {
    if (!Number.isInteger(m.seq) || m.hidden || m.takeover === true) continue;
    if (deleted.has(`m:${m.seq}`)) continue;
    const own = momentOf(m, viewer, phase);
    if (own !== null) {
      if (own.peekOf === undefined) one(own, [m.seq]);
      continue;
    }
    if (m.notice === undefined || m.ambient === true) continue;
    if (m.audience === "all") {
      const g = `${m.notice || noticeKey(m.text)}\u0000${phaseOf(m, phase) ?? ""}`;
      const list = folds.get(g);
      if (list === undefined) folds.set(g, [m]);
      else list.push(m);
    } else if (m.audience.includes(viewer.me)) one(noticeMoment(m, phase), [m.seq]);
  }
  for (const [g, list] of folds) {
    if (list.length === 1) {
      one(noticeMoment(list[0]!, phase), [list[0]!.seq]);
      continue;
    }
    const [glyph, ph] = g.split("\u0000") as [string, string];
    const newest = list.reduce((a, b) => (b.ts > a.ts || (b.ts === a.ts && b.seq > a.seq) ? b : a));
    const key = `n:${glyph}:${ph}`;
    out.push({ key, members: list.map((m) => m.seq), moment: { ...noticeMoment(newest, phase), key }, fold: { glyph, phase: ph, list }, at: newest.ts, seq: newest.seq });
  }
  for (const m of extra) {
    if (keys.has(m.key) || deleted.has(m.key) || m.peekOf !== undefined) continue;
    one(m, m.seq !== null ? [m.seq] : []);
  }
  out.sort((a, b) => b.at - a.at || (b.seq ?? -1) - (a.seq ?? -1));
  return out.length > NOTIFICATIONS_MAX ? out.slice(0, NOTIFICATIONS_MAX) : out;
}

/** Is this row unread: never seen on screen, and (for a message) newer than the window's last read. */
export function isUnread(r: Pick<NotificationGroup, "key" | "members">, seen: ReadonlySet<string>, readMark: number): boolean {
  if (seen.has(r.key)) return false;
  if (r.members.length === 0) return true;
  return r.members.some((s) => s > readMark && !seen.has(`m:${s}`));
}

/** The bell's count: the unread rows. */
export function unreadOf(rows: readonly Pick<NotificationGroup, "key" | "members">[], seen: ReadonlySet<string>, readMark: number): number {
  let n = 0;
  for (const r of rows) if (isUnread(r, seen, readMark)) n++;
  return n;
}

/** The bell's label: "9+" above nine, nothing at zero. */
export function bellCount(n: number): string {
  return n <= 0 ? "" : n > 9 ? "9+" : String(n);
}

/** The keys deleting a row writes: the row's own, and each member's. */
export function deleteKeys(r: Pick<NotificationGroup, "key" | "members">): string[] {
  return [r.key, ...r.members.map((s) => `m:${s}`)];
}
