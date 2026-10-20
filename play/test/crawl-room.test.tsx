//! Wave 13, the measure: a crowded room is readable at once. Lines that
//! landed while you were away show whole when you open the room; a burst
//! that lands while you watch reaches its newest line within 1.5 s; and
//! reduced motion never crawls.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { BATCH_BUDGET_MS, createCrawl, crawlDuration } from "../src/crawl.ts";
import { PlayHostContext, browserHost, type Crawl } from "../src/host.ts";
import { MessageBubble } from "../src/stream/bubble.tsx";
import type { ChatMessage } from "../src/types.ts";

const ME = { id: "g1", name: "Ada" };
let seq = 100;
const line = (text: string): ChatMessage => ({
  seq: seq++, channel: "loc:The Desktop", channelKind: "location", title: "The Desktop", from: "Clippy", kind: "line", text, ts: 0, audience: "all", parentSeq: null, hidden: false, beat: "Computer Bingo",
});
/** The show's Computer Bingo: 15 lines, ~1,630 characters. */
const bingo = () => Array.from({ length: 15 }, (_, i) => line(`${"Bingo line ".repeat(10)}${i}`));

/** Play a crawl the way the bubbles do — one at a time, each for its tier's
 *  duration — on a fake clock; return when each line starts and ends (ms). */
function play(crawl: Crawl, lines: ChatMessage[]) {
  let t = 0;
  const shown = new Map<number, { start: number; end: number }>();
  const pending: ChatMessage[] = [];
  for (const m of lines) {
    const tier = crawl.tierOf(m.seq);
    if (tier === "none") shown.set(m.seq, { start: 0, end: 0 });
    else pending.push(m);
  }
  for (const m of pending) {
    let went = false;
    crawl.start(m.seq, () => (went = true));
    if (!went) throw new Error("the queue stalled");
    const d = crawlDuration(crawl.tierOf(m.seq), m.text.length);
    shown.set(m.seq, { start: t, end: t + d });
    t += d;
    crawl.finish(m.seq);
  }
  return shown;
}

describe("a crowded room", () => {
  it("cues fired while you were elsewhere: the whole beat is there the moment you open the room", () => {
    let now = 0;
    const crawl = createCrawl({ now: () => now });
    crawl.loaded(99);
    crawl.setOpen("codex"); // reading the Codex while the director fires cues
    const beat = bingo();
    for (const m of beat) {
      crawl.arrived(m, ME);
      now += 2;
    }
    crawl.setOpen("loc:The Desktop");
    const shown = play(crawl, beat);
    expect(Math.max(...[...shown.values()].map((s) => s.end))).toBe(0); // was 25–47 s
  });

  it("a beat landing while you watch: the newest line is on screen within 1.5 s", () => {
    let now = 0;
    const crawl = createCrawl({ now: () => now });
    crawl.loaded(99);
    crawl.setOpen("loc:The Desktop");
    const beat = bingo();
    for (const m of beat) {
      crawl.arrived(m, ME);
      now += 2;
    }
    const shown = play(crawl, beat);
    const newest = shown.get(beat[beat.length - 1]!.seq)!;
    expect(newest.start).toBeLessThanOrEqual(BATCH_BUDGET_MS);
  });

  it("a short beat still crawls, and is done inside the budget plus a line", () => {
    let now = 0;
    const crawl = createCrawl({ now: () => now });
    crawl.loaded(99);
    crawl.setOpen("loc:The Desktop");
    const beat = [line("Pencils down."), line("Programs, report to the Desktop."), line("Now.")];
    for (const m of beat) crawl.arrived(m, ME);
    expect(beat.every((m) => crawl.tierOf(m.seq) === "fast")).toBe(true);
    const shown = play(crawl, beat);
    expect(Math.max(...[...shown.values()].map((s) => s.end))).toBeLessThan(BATCH_BUDGET_MS + 700);
  });
});

describe("the bubble", () => {
  const g = globalThis as { window?: unknown };
  const had = g.window;
  afterEach(() => {
    g.window = had;
  });
  const render = (m: ChatMessage, crawl: Crawl) => renderToStaticMarkup(createElement(PlayHostContext.Provider, { value: { ...browserHost, crawl } }, createElement(MessageBubble, { msg: m })));
  const decided = (m: ChatMessage) => {
    const crawl = createCrawl();
    crawl.loaded(m.seq - 1);
    crawl.setOpen(m.channel);
    crawl.arrived(m, ME);
    return crawl;
  };

  it("a line still owed its crawl is laid out whole but unrevealed (never display: none)", () => {
    const m = line("Pencils down, programs.");
    const html = render(m, decided(m));
    expect(html).toContain("stream-queued");
    expect(html).toContain('<span class="stream-rest">Pencils down, programs.</span>');
    expect(html).toContain('<span class="stream-sr">Pencils down, programs.</span>');
    expect(html).not.toContain("pending");
  });

  it("reduced motion: shown whole at once", () => {
    g.window = { matchMedia: () => ({ matches: true }) };
    const m = line("Pencils down, programs.");
    const html = render(m, decided(m));
    expect(html).not.toContain("stream-queued");
    expect(html).not.toContain("stream-rest");
    expect(html).toContain('<span class="bubble">Pencils down, programs.</span>');
  });

  it("history and other rooms: shown whole", () => {
    const m = line("Old news.");
    const crawl = createCrawl();
    crawl.loaded(m.seq + 1);
    expect(render(m, crawl)).toContain('<span class="bubble">Old news.</span>');
  });

  it("effect text keeps its look after the crawl", () => {
    const m = { ...line("TRUTH IS A FILE"), fx: true as const, manner: "glitch" };
    const crawl = createCrawl();
    crawl.loaded(m.seq + 1);
    const html = render(m, crawl);
    expect(html).toContain("stream-fx");
    expect(html).not.toContain("stream-fx-live");
  });
});
