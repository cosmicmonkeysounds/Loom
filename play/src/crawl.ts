// The crawl — which lines type in like game dialogue, and how fast (wave
// 13). Each host (the page, every embedded pane) holds its own, so two
// panes never share a crawl. The `Crawl` contract lives in `host.ts`.
//
// The rule is decided at ARRIVAL, not when a bubble mounts: a live message
// crawls only if it lands while its room is the one on screen and the page
// is visible. The backlog, other rooms, a reload, a hidden phone: instant.
// Three tiers:
//
// - `none` — typed chat (no `beat`), agent replies, readouts, your own
//   words, system lines, cards, codex / quest / wallet, the backlog.
// - `fast` — a scripted `line` / `narration` (it has a `beat`): ≈ 5 ms a
//   character, at most 700 ms a line, and a batch budget of 1.5 s — a line
//   that would start later than that appears at once (with everything
//   queued ahead of it), and so does the rest of that burst.
// - `fx` — effect text (`msg.fx`: a glitch manner, a `crawl: fx` speaker)
//   and `!` alert / `!!` takeover lines: the slow glyph-scramble decode,
//   ≈ 25 ms a character, at most 2.5 s. Never dropped by the budget: the
//   budget counts only the fast lines' time, and a fast line over it that
//   lands behind an fx line still decoding waits its turn and then shows
//   whole, so the effect is never cut short by the narration after it.
//
// Order is kept: when a message that does not crawl lands in a room behind
// queued lines, those lines finish at once — nothing later ever sits under
// a line still waiting its turn. Tap the stream → `flush`.
//
// Type-only import from `host.ts`: `host.ts` calls `createCrawl()` at
// module init, so a value import back would be a TDZ cycle.

import type { Crawl, CrawlTier } from "./host.ts";
import { CODEX_ROOM, QUEST_LOG, WALLET_ROOM } from "./rooms/spaces.ts";
import type { ChatMessage } from "./types.ts";

export interface CrawlOptions {
  /** Listen to `document.visibilitychange` and treat a hidden page as "no
   *  room open" (the standalone page; an embedded pane counts as visible). */
  watchVisibility?: boolean;
  /** The clock (ms) the batch budget reads; tests pass a fake one. */
  now?: () => number;
}

/** The open "room" of the cutscene stage: everything said to the viewer,
 *  whatever channel it lands in (`personalStream`). */
export const PERSONAL_STREAM = "@personal";

/** The guest's pinned rooms (`isPinnedRoom`): never on the cutscene stage. */
const PINNED_ROOMS: ReadonlySet<string> = new Set([CODEX_ROOM, QUEST_LOG, WALLET_ROOM]);

/** ms per character and the per-line cap, by tier. */
export const FAST_CHAR_MS = 5;
export const FAST_LINE_MAX_MS = 700;
export const FX_CHAR_MS = 25;
export const FX_LINE_MAX_MS = 2500;
/** An fx line is never quicker than this, however short ("!ERROR"). */
export const FX_LINE_MIN_MS = 600;
/** A fast line that would start later than this after it lands shows at once. */
export const BATCH_BUDGET_MS = 1500;
/** Once a burst overflows the budget, lines landing within this of the last
 *  one in the same room are instant too (the rest of the burst). */
export const BURST_QUIET_MS = 1000;

/** How long a line of `chars` characters takes to crawl in `tier`. */
export function crawlDuration(tier: CrawlTier, chars: number): number {
  if (tier === "fast") return Math.min(FAST_LINE_MAX_MS, FAST_CHAR_MS * chars);
  if (tier === "fx") return Math.max(FX_LINE_MIN_MS, Math.min(FX_LINE_MAX_MS, FX_CHAR_MS * chars));
  return 0;
}

/** The tier a message would crawl in if it arrived in the open room — pure,
 *  no arrival / room / budget rules (those are the crawl's). */
export function tierFor(m: ChatMessage, me: { id: string; name: string } | null): CrawlTier {
  if (m.parentSeq != null || m.hidden) return "none"; // replies live in their thread panel
  if (m.ambient || m.notice !== undefined || m.readout) return "none";
  if (me !== null && m.from !== "" && (m.from === me.name || m.from === me.id)) return "none"; // your own words
  if (m.kind === "signal") return m.alert || m.takeover ? "fx" : "none";
  if (m.kind !== "line" && m.kind !== "narration") return "none";
  if (m.text.length === 0) return "none";
  if (m.fx || m.alert) return "fx";
  // No beat = typed chat, an agent's reply, a director's line: instant.
  return m.beat ? "fast" : "none";
}

interface Decided {
  tier: CrawlTier;
  room: string;
  /** Over the budget behind an fx line: shown whole the moment its turn
   *  comes (it keeps its place, so it never sits under the decode). */
  instant?: boolean;
}

export function createCrawl(opts?: CrawlOptions): Crawl {
  const now = opts?.now ?? (() => Date.now());
  let baseline = Number.MAX_SAFE_INTEGER;
  const done = new Set<number>();
  /** Seqs decided at arrival to crawl (fast / fx), until done. */
  const decided = new Map<number, Decided>();
  /** Seqs seen at arrival at all (a re-sent frame is never re-decided). */
  const seen = new Set<number>();
  /** Seqs decided to crawl, then completed (finished, flushed): never queued again. */
  const settled = new Set<number>();
  /** Per room: when its planned crawl queue ends, when its fast lines alone
   *  would end (the batch budget's measure), and the burst latch. */
  const planEnd = new Map<string, number>();
  const fastEnd = new Map<string, number>();
  const burst = new Map<string, number>(); // room → last arrival of an overflowed burst
  let active: number | null = null;
  let queue: Array<{ seq: number; go: () => void }> = [];
  let open: string | null = null;
  const page = { visible: true };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of [...listeners]) fn();
  };
  /** Mark seqs done (shown in full) and drop them from the queue. */
  const complete = (seqs: number[]) => {
    if (seqs.length === 0) return;
    const rooms = new Set<string>();
    for (const s of seqs) {
      const d = decided.get(s);
      if (d !== undefined) rooms.add(d.room);
      done.add(s);
      if (decided.delete(s)) settled.add(s);
    }
    // A room with nothing left to crawl plans its next line from "now".
    for (const r of rooms) {
      if ([...decided.values()].some((d) => d.room === r)) continue;
      planEnd.delete(r);
      fastEnd.delete(r);
    }
    const gone = new Set(seqs);
    if (active !== null && gone.has(active)) active = null;
    queue = queue.filter((q) => !gone.has(q.seq));
    notify();
    pump();
  };
  const flushRoom = (room?: string) => {
    const seqs = [...decided.entries()].filter(([, d]) => room === undefined || d.room === room).map(([s]) => s);
    if (room === undefined) {
      planEnd.clear();
      fastEnd.clear();
    } else {
      planEnd.delete(room);
      fastEnd.delete(room);
    }
    complete(seqs);
  };
  /**
   * A fast line over the budget. With no fx line pending in the room:
   * everything queued shows at once (returns false: show this one at once
   * too). With one: the fast lines ahead of it show now, the ones behind it
   * show whole when their turn comes, and the fx line keeps its decode
   * (returns true: queue this one the same way).
   */
  const overflow = (room: string, t: number): boolean => {
    const inRoom = [...decided.entries()].filter(([, d]) => d.room === room);
    const fx = inRoom.filter(([, d]) => d.tier === "fx").map(([s]) => s);
    if (fx.length === 0) {
      flushRoom(room);
      return false;
    }
    const firstFx = Math.min(...fx);
    const ahead: number[] = [];
    for (const [s, d] of inRoom) {
      if (d.tier !== "fast") continue;
      if (s < firstFx) ahead.push(s);
      else d.instant = true;
    }
    fastEnd.set(room, t);
    complete(ahead);
    return true;
  };
  const pump = () => {
    if (active !== null || queue.length === 0) return;
    queue.sort((a, b) => a.seq - b.seq);
    const next = queue.shift()!;
    active = next.seq;
    if (decided.get(next.seq)?.instant === true) {
      complete([next.seq]); // its turn: shown whole (and the next released)
      return;
    }
    next.go();
  };
  if (opts?.watchVisibility === true && typeof document !== "undefined" && typeof document.addEventListener === "function") {
    page.visible = document.visibilityState !== "hidden";
    document.addEventListener("visibilitychange", () => {
      page.visible = document.visibilityState !== "hidden";
      // A phone put away mid-crawl comes back to the whole line.
      if (!page.visible) flushRoom();
    });
  }
  /** Which open room a message is a ROW of, or null when it isn't on
   *  screen. Only rows decide anything: an ambient bark (the ticker), a
   *  thread reply (its panel), a hidden line and — on the cutscene stage —
   *  the pinned rooms' cards never crawl and never flush what is queued. */
  const roomOf = (m: ChatMessage, me: { id: string; name: string } | null): string | null => {
    if (open === null || !page.visible) return null;
    if (m.ambient || m.parentSeq != null || m.hidden) return null;
    if (open === PERSONAL_STREAM) {
      // `personalStream`'s own filter (session/channels.ts).
      if (me === null || !Array.isArray(m.audience) || !m.audience.includes(me.id)) return null;
      return PINNED_ROOMS.has(m.channel) ? null : PERSONAL_STREAM;
    }
    return m.channel === open ? open : null;
  };
  return {
    reset() {
      baseline = Number.MAX_SAFE_INTEGER;
      done.clear();
      decided.clear();
      seen.clear();
      settled.clear();
      planEnd.clear();
      fastEnd.clear();
      burst.clear();
      active = null;
      queue = [];
      notify();
    },
    loaded(maxSeq) {
      baseline = maxSeq;
      // A fresh backlog (a reconnect) shows in full; nothing it held is still owed a crawl.
      flushRoom();
    },
    claim(seq) {
      if (seq <= baseline || done.has(seq)) return false;
      done.add(seq);
      decided.delete(seq);
      return true;
    },
    start(seq, go) {
      // A line flushed before its bubble got here is shown whole, never
      // crawled from nothing (it would hold the queue behind what flushed it).
      if (settled.has(seq)) return;
      queue.push({ seq, go });
      pump();
    },
    finish(seq) {
      if (decided.has(seq)) {
        complete([seq]);
        return;
      }
      if (active === seq) active = null;
      else queue = queue.filter((q) => q.seq !== seq);
      pump();
    },
    setOpen(channelId) {
      if (channelId === open) return;
      // Leaving a room: whatever it still owed shows in full when you come back.
      if (open !== null) flushRoom(open);
      open = channelId;
    },
    arrived(m, me) {
      if (seen.has(m.seq) || done.has(m.seq) || m.seq <= baseline) return;
      seen.add(m.seq);
      const room = roomOf(m, me);
      if (room === null) return; // not on screen: instant
      const tier = tierFor(m, me);
      const t = now();
      if (tier === "none") {
        // Order: nothing visible ever sits below a line still waiting.
        if ([...decided.values()].some((d) => d.room === room)) flushRoom(room);
        return;
      }
      const start = Math.max(t, planEnd.get(room) ?? t);
      const dur = crawlDuration(tier, m.text.length);
      if (tier === "fast") {
        const last = burst.get(room);
        const latched = last !== undefined && t - last <= BURST_QUIET_MS;
        // The budget is the fast lines' own time: an fx decode ahead never counts.
        const fastStart = Math.max(t, fastEnd.get(room) ?? t);
        if (latched || fastStart - t > BATCH_BUDGET_MS) {
          // Over budget: this line, everything queued ahead of it and the
          // rest of the burst appear at once — behind an fx line, in turn.
          burst.set(room, t);
          if (overflow(room, t)) decided.set(m.seq, { tier, room, instant: true });
          return;
        }
        burst.delete(room);
        decided.set(m.seq, { tier, room });
        planEnd.set(room, start + dur);
        fastEnd.set(room, fastStart + dur);
        return;
      }
      burst.delete(room);
      decided.set(m.seq, { tier, room });
      planEnd.set(room, start + dur);
    },
    tierOf(seq) {
      if (done.has(seq)) return "none";
      return decided.get(seq)?.tier ?? "none";
    },
    flush(channelId) {
      flushRoom(channelId);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
