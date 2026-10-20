//! The crawl — which lines type in like game dialogue, and how fast (wave
//! 13). Each host (the page, every embedded pane) holds its own, so two
//! panes never share a crawl. The `Crawl` contract lives in `host.ts`.
//!
//! The rule is decided at ARRIVAL, not when a bubble mounts: a live message
//! crawls only if it lands while its room is the one on screen and the page
//! is visible. The backlog, other rooms, a reload, a hidden phone: instant.
//! Three tiers:
//!
//! - `none` — typed chat (no `beat`), agent replies, readouts, your own
//!   words, system lines, cards, codex / quest / wallet, the backlog.
//! - `fast` — a scripted `line` / `narration` (it has a `beat`): ≈ 5 ms a
//!   character, at most 700 ms a line, and a batch budget of 1.5 s — a line
//!   that would start later than that appears at once (with everything
//!   queued ahead of it), and so does the rest of that burst.
//! - `fx` — effect text (`msg.fx`: a glitch manner, a `crawl: fx` speaker)
//!   and `!` alert / `!!` takeover lines: the slow glyph-scramble decode,
//!   ≈ 25 ms a character, at most 2.5 s. Never dropped by the budget.
//!
//! Order is kept: when a message that does not crawl lands in a room behind
//! queued lines, those lines finish at once — nothing later ever sits under
//! a line still waiting its turn. Tap the stream → `flush`.
//!
//! Type-only import from `host.ts`: `host.ts` calls `createCrawl()` at
//! module init, so a value import back would be a TDZ cycle.

import type { Crawl, CrawlTier } from "./host.ts";
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
}

export function createCrawl(opts?: CrawlOptions): Crawl {
  const now = opts?.now ?? (() => Date.now());
  let baseline = Number.MAX_SAFE_INTEGER;
  const done = new Set<number>();
  /** Seqs decided at arrival to crawl (fast / fx), until done. */
  const decided = new Map<number, Decided>();
  /** Seqs seen at arrival at all (a re-sent frame is never re-decided). */
  const seen = new Set<number>();
  /** Per room: when its planned crawl queue ends, and the burst latch. */
  const planEnd = new Map<string, number>();
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
      decided.delete(s);
    }
    // A room with nothing left to crawl plans its next line from "now".
    for (const r of rooms) if (![...decided.values()].some((d) => d.room === r)) planEnd.delete(r);
    const gone = new Set(seqs);
    if (active !== null && gone.has(active)) active = null;
    queue = queue.filter((q) => !gone.has(q.seq));
    notify();
    pump();
  };
  const flushRoom = (room?: string) => {
    const seqs = [...decided.entries()].filter(([, d]) => room === undefined || d.room === room).map(([s]) => s);
    if (room === undefined) planEnd.clear();
    else planEnd.delete(room);
    complete(seqs);
  };
  const pump = () => {
    if (active !== null || queue.length === 0) return;
    queue.sort((a, b) => a.seq - b.seq);
    const next = queue.shift()!;
    active = next.seq;
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
  /** Which open room a message belongs to, or null when it isn't on screen. */
  const roomOf = (m: ChatMessage, me: { id: string; name: string } | null): string | null => {
    if (open === null || !page.visible) return null;
    if (open === PERSONAL_STREAM) {
      return me !== null && Array.isArray(m.audience) && m.audience.includes(me.id) ? PERSONAL_STREAM : null;
    }
    return m.channel === open ? open : null;
  };
  return {
    reset() {
      baseline = Number.MAX_SAFE_INTEGER;
      done.clear();
      decided.clear();
      seen.clear();
      planEnd.clear();
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
      if (tier === "fast") {
        const last = burst.get(room);
        const latched = last !== undefined && t - last <= BURST_QUIET_MS;
        if (latched || start - t > BATCH_BUDGET_MS) {
          // Over budget: this line, everything queued ahead of it and the
          // rest of the burst appear at once.
          burst.set(room, t);
          flushRoom(room);
          return;
        }
      }
      burst.delete(room);
      decided.set(m.seq, { tier, room });
      planEnd.set(room, start + crawlDuration(tier, m.text.length));
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
