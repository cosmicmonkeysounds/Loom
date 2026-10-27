//! A pick at the heart, shown at once (wave 28 follow-up). Since picks became
//! the server's own `pick` lines the terminal keeps no echo, so on slow venue
//! wifi a pick showed nothing until the stream brought it back. A pending
//! pick stands in for it — the YOU line, dimmed — from the moment of the pick
//! until the server's matching pick line arrives (same room, same words, past
//! the pick), then gives way to it: never shown twice. Mirrors play's
//! `withEchoes` (`play/src/session/guest.ts`).

import { echoOf } from "./heart.ts";
import type { Line } from "../pilot.ts";

export interface PendingPick {
  /** Unique per pick (menu id + option + a counter). */
  key: string;
  /** The menu's room: the server posts its pick line there. */
  channel: string;
  /** The words the server's pick line will carry (`echoOf`). */
  text: string;
  act: boolean;
  /** The newest seq when it was picked: the server's line lands past it. */
  after: number;
  /** The newest line's time (story time, like every line's `ts`). */
  ts: number;
}

/** A pending pick for option `option` of a menu in `channel`, made with `lines` on screen. */
export function pendingPickOf(key: string, channel: string, option: string, lines: readonly Pick<Line, "seq" | "ts">[]): PendingPick {
  const echo = echoOf(option);
  let after = -1;
  let ts = 0;
  for (const l of lines) {
    if (l.seq > after) {
      after = l.seq;
      ts = l.ts;
    }
  }
  return { key, channel, text: echo.text, act: echo.action, after, ts };
}

/** The server's pick lines, by room + words → their seqs (built once per call). */
function pickIndex(lines: readonly Pick<Line, "seq" | "channel" | "text" | "pick">[]): Map<string, number[]> {
  const ix = new Map<string, number[]>();
  for (const l of lines) {
    if (l.pick !== true) continue;
    const k = `${l.channel}\u0000${l.text}`;
    const list = ix.get(k);
    if (list === undefined) ix.set(k, [l.seq]);
    else list.push(l.seq);
  }
  return ix;
}

/** The pending picks the stream has not answered yet (a pick line in the same
 *  room with the same words, past the pick). One line answers one pick: the
 *  picks, oldest first, each take the earliest unclaimed matching line past
 *  them, so two same-word picks each wait for their own line. A pick still
 *  open comes back with `after` raised past the lines its twins claimed, so
 *  once those twins are dropped (the terminal prunes its list) the claimed
 *  lines never answer it a second time. */
export function unansweredPicks(pending: readonly PendingPick[], lines: readonly Pick<Line, "seq" | "channel" | "text" | "pick">[]): PendingPick[] {
  if (pending.length === 0) return [];
  const ix = pickIndex(lines);
  for (const list of ix.values()) list.sort((a, b) => a - b);
  const answered = new Set<PendingPick>();
  const claimed = new Map<string, number>();
  const order = pending.map((p, i) => ({ p, i })).sort((a, b) => a.p.after - b.p.after || a.i - b.i);
  for (const { p } of order) {
    const k = `${p.channel}\u0000${p.text}`;
    const list = ix.get(k);
    if (list === undefined) continue;
    const at = list.findIndex((s) => s > p.after);
    if (at < 0) continue;
    claimed.set(k, Math.max(claimed.get(k) ?? -Infinity, list[at]!));
    list.splice(at, 1);
    answered.add(p);
  }
  return pending
    .filter((p) => !answered.has(p))
    .map((p) => {
      const last = claimed.get(`${p.channel}\u0000${p.text}`);
      return last !== undefined && last > p.after ? { ...p, after: last } : p;
    });
}

/**
 * The thread with this page's unanswered picks folded in, each as the
 * program's own pick line marked `pending` (drawn dimmed), right after the
 * line it followed. `answeredBy` is every line the stream has (the visit's
 * thread may be narrower), so a pick answered off screen is still dropped.
 */
export function withPendingPicks(lines: readonly Line[], pending: readonly PendingPick[], from: string, answeredBy: readonly Line[] = lines): Line[] {
  const open = unansweredPicks(pending, answeredBy);
  if (open.length === 0) return [...lines];
  const rows: Line[] = open.map((p, i) => ({
    seq: p.after + 0.5 + i / 1000,
    channel: p.channel,
    channelKind: "dm",
    title: p.channel,
    from,
    kind: "line",
    text: p.text,
    ts: p.ts,
    audience: [],
    parentSeq: null,
    hidden: false,
    theirs: false,
    pick: true,
    ...(p.act ? { act: true as const } : {}),
    pending: true,
  }));
  return [...lines, ...rows].sort((a, b) => a.seq - b.seq);
}
