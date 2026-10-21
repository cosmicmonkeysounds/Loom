//! Notifications, the window's words (wave 18, the moments lane; GUEST-SPEC
//! §4, the user's Q3: "a notifications tab would be useful (nothing is
//! sticky…)"): every row the night gave this guest (`notifications-count.ts`
//! decides which), with its glyph, its title (the first sentence), its
//! caption and the rest, and "● IN USE" on an unacknowledged big one. House
//! `~` notices fold into one row ("🎀 4 updates about others"). Pure —
//! tested in `test/moments-notifications.test.ts`; `notifications.tsx`
//! renders it.

import type { ChatMessage } from "../types.ts";
import { bigParts } from "./big-parts.ts";
import type { Moment, Viewer } from "./model.ts";
import { notificationGroups, type NotificationGroup } from "./notifications-count.ts";

export { NOTIFICATIONS_MAX, bellCount, deleteKeys, isUnread, unreadOf } from "./notifications-count.ts";

/** One row of the Notifications window. */
export interface NotificationRow {
  /** `m:<seq>` (a message), `o:<id>` (a loud objective), `n:<glyph>:<phase>` (folded house notices). */
  key: string;
  /** The row's newest seq (null for a client-made moment). */
  seq: number | null;
  /** Every seq the row stands for (one, or a fold's members). */
  members: number[];
  glyph: string;
  /** The first sentence (no glyph). */
  title: string;
  /** Who / what it is from. */
  caption: string;
  /** The rest of the text. */
  rest: string;
  /** Story time (ms). */
  at: number;
  /** The moment its exits come from (`exitsOf`). */
  moment: Moment;
  /** A big moment. */
  big: boolean;
  /** An unacknowledged big moment: "● IN USE", never deleted. */
  inUse: boolean;
  /** Sent to the whole house. */
  house: boolean;
  /** How many house notices it folds (2+), when it is a fold. */
  folded?: number;
}

/** A group's words. */
export function rowOfGroup(g: NotificationGroup, acked: ReadonlySet<string>): NotificationRow {
  const m = g.moment;
  if (g.fold !== undefined) {
    const n = g.fold.list.length;
    const title = `${n} updates about others`;
    return { key: g.key, seq: g.seq, members: g.members, glyph: g.fold.glyph, title, caption: m.caption, rest: "", at: g.at, moment: { ...m, text: `${g.fold.glyph} ${title}` }, big: false, inUse: false, house: true, folded: n };
  }
  const parts = bigParts(m.text, m.kind);
  const big = m.severity === "big";
  return { key: g.key, seq: g.seq, members: g.members, glyph: parts.glyph, title: parts.headline, caption: m.caption, rest: parts.body, at: g.at, moment: m, big, inUse: big && !acked.has(m.key), house: m.house === true };
}

/**
 * The rows for this guest (§4.1), newest first, capped; `deleted` keys (and
 * a fold's deleted members) left out; `acked` bigs no longer in use.
 */
export function notificationsOf(
  messages: Iterable<ChatMessage>,
  viewer: Viewer,
  phase: string | null,
  deleted: ReadonlySet<string>,
  acked: ReadonlySet<string>,
  extra: readonly Moment[] = [],
): NotificationRow[] {
  return notificationGroups(messages, viewer, phase, deleted, extra).map((g) => rowOfGroup(g, acked));
}
