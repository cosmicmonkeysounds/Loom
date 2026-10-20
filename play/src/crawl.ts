//! The crawl — which lines type in like game dialogue (moved out of
//! `host.ts` in wave 13; the `Crawl` contract stays there). Each host
//! (the page, every embedded pane) holds its own, so two panes never share
//! a crawl.
//!
//! Wave 13 Stage A keeps the legacy behaviour exactly: a line crawls when
//! its bubble claims it (it arrived after the backlog and never crawled
//! before), one at a time in seq order. The v2 seams — `setOpen`,
//! `arrived`, `tierOf`, `flush`, `subscribe` and the page-visibility
//! watch — are wired but do nothing yet; the stream lane implements them.
//!
//! Type-only import from `host.ts`: `host.ts` calls `createCrawl()` at
//! module init, so a value import back would be a TDZ cycle.

import type { Crawl, CrawlTier } from "./host.ts";

export interface CrawlOptions {
  /** Listen to `document.visibilitychange` and treat a hidden page as "no
   *  room open" (the standalone page; an embedded pane counts as visible). */
  watchVisibility?: boolean;
}

export function createCrawl(opts?: CrawlOptions): Crawl {
  let baseline = Number.MAX_SAFE_INTEGER;
  const done = new Set<number>();
  let active: number | null = null;
  let queue: Array<{ seq: number; go: () => void }> = [];
  // The page's visibility, kept for the v2 arrival rule (unused in Stage A).
  const page = { visible: true };
  if (opts?.watchVisibility === true && typeof document !== "undefined" && typeof document.addEventListener === "function") {
    page.visible = document.visibilityState !== "hidden";
    document.addEventListener("visibilitychange", () => {
      page.visible = document.visibilityState !== "hidden";
    });
  }
  const pump = () => {
    if (active !== null || queue.length === 0) return;
    queue.sort((a, b) => a.seq - b.seq);
    const next = queue.shift()!;
    active = next.seq;
    next.go();
  };
  return {
    reset() {
      baseline = Number.MAX_SAFE_INTEGER;
      done.clear();
      active = null;
      queue = [];
    },
    loaded(maxSeq) {
      baseline = maxSeq;
    },
    claim(seq) {
      if (seq <= baseline || done.has(seq)) return false;
      done.add(seq);
      return true;
    },
    start(seq, go) {
      queue.push({ seq, go });
      pump();
    },
    finish(seq) {
      if (active === seq) active = null;
      else queue = queue.filter((q) => q.seq !== seq);
      pump();
    },
    setOpen(_channelId) {},
    arrived(_m, _me) {},
    tierOf(seq): CrawlTier {
      // Legacy: a seq `claim` would accept crawls at the one speed there is.
      return seq > baseline && !done.has(seq) ? "fast" : "none";
    },
    flush(_channelId) {},
    subscribe(_fn) {
      return () => {};
    },
  };
}
