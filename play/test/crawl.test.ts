//! Wave 13: the crawl decides at arrival, in three tiers, inside a batch
//! budget, and never inverts the order of a room.

import { describe, expect, it } from "vitest";
import {
  BATCH_BUDGET_MS,
  FAST_LINE_MAX_MS,
  FX_LINE_MAX_MS,
  PERSONAL_STREAM,
  createCrawl,
  crawlDuration,
  tierFor,
} from "../src/crawl.ts";
import type { ChatMessage } from "../src/types.ts";

const ME = { id: "g-1", name: "Ada" };

let nextSeq = 100;
function msg(extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    seq: nextSeq++,
    channel: "loc:The Desktop",
    channelKind: "location",
    title: "The Desktop",
    from: "Clippy",
    kind: "line",
    text: "Pencils down, programs.",
    ts: 0,
    audience: "all",
    parentSeq: null,
    hidden: false,
    beat: "Hunt Over",
    ...extra,
  };
}

/** A crawl on a fake clock, the backlog loaded and the Desktop open. */
function setup(open: string | null = "loc:The Desktop") {
  let t = 0;
  const crawl = createCrawl({ now: () => t });
  crawl.loaded(50);
  crawl.setOpen(open);
  return { crawl, tick: (ms: number) => (t += ms) };
}

describe("tiers", () => {
  it("scripted speech + narration crawl fast; typed chat, agents, readouts, system, cards don't", () => {
    expect(tierFor(msg(), ME)).toBe("fast");
    expect(tierFor(msg({ kind: "narration", from: "Narrator" }), ME)).toBe("fast");
    expect(tierFor(msg({ beat: undefined }), ME)).toBe("none"); // typed chat / an agent's reply
    expect(tierFor(msg({ beat: null, from: "Trabolta" }), ME)).toBe("none");
    expect(tierFor(msg({ kind: "narration", from: "", readout: true }), ME)).toBe("none");
    expect(tierFor(msg({ kind: "system" }), ME)).toBe("none");
    expect(tierFor(msg({ kind: "widget", widget: { kind: "poll", text: "?", params: {} } }), ME)).toBe("none");
    expect(tierFor(msg({ kind: "codex" }), ME)).toBe("none");
    expect(tierFor(msg({ ambient: true, kind: "narration" }), ME)).toBe("none");
    expect(tierFor(msg({ notice: "✅", kind: "signal" }), ME)).toBe("none");
    expect(tierFor(msg({ parentSeq: 3 }), ME)).toBe("none");
  });

  it("your own words never crawl", () => {
    expect(tierFor(msg({ from: "Ada", beat: "Login" }), ME)).toBe("none");
  });

  it("effect text, alerts and takeovers crawl in the fx tier", () => {
    expect(tierFor(msg({ fx: true, from: "Truther Download", manner: "glitch" }), ME)).toBe("fx");
    expect(tierFor(msg({ kind: "signal", alert: true, text: "!📣 ALL PROGRAMS" }), ME)).toBe("fx");
    expect(tierFor(msg({ kind: "signal", alert: true, takeover: true }), ME)).toBe("fx");
    expect(tierFor(msg({ kind: "signal" }), ME)).toBe("none"); // a plain notice pops in
    expect(tierFor(msg({ kind: "line", fx: true, beat: undefined }), ME)).toBe("fx");
  });

  it("~5 ms a character, capped at 700 ms a line; fx is slower and capped at 2.5 s", () => {
    expect(crawlDuration("fast", 40)).toBe(200);
    expect(crawlDuration("fast", 6000)).toBe(FAST_LINE_MAX_MS);
    expect(crawlDuration("fx", 40)).toBe(1000);
    expect(crawlDuration("fx", 6000)).toBe(FX_LINE_MAX_MS);
    expect(crawlDuration("fx", 3)).toBeGreaterThanOrEqual(600); // a short glitch still reads as one
    expect(crawlDuration("none", 40)).toBe(0);
  });
});

describe("the arrival claim", () => {
  it("a line landing in the open room crawls", () => {
    const { crawl } = setup();
    const m = msg();
    crawl.arrived(m, ME);
    expect(crawl.tierOf(m.seq)).toBe("fast");
  });

  it("another room, history, a closed list, a hidden page → instant", () => {
    const { crawl } = setup();
    const other = msg({ channel: "dm:Clippy" });
    crawl.arrived(other, ME);
    expect(crawl.tierOf(other.seq)).toBe("none");
    const old = msg({ seq: 40 });
    crawl.arrived(old, ME); // at or below the backlog
    expect(crawl.tierOf(40)).toBe("none");
    crawl.setOpen(null); // the rooms list
    const m = msg();
    crawl.arrived(m, ME);
    expect(crawl.tierOf(m.seq)).toBe("none");
    // Nothing loaded yet (a fresh sign-in): nothing crawls.
    const fresh = createCrawl();
    fresh.setOpen("loc:The Desktop");
    const f = msg();
    fresh.arrived(f, ME);
    expect(fresh.tierOf(f.seq)).toBe("none");
  });

  it("a reload: a line decided before a new backlog shows in full", () => {
    const { crawl } = setup();
    const m = msg();
    crawl.arrived(m, ME);
    crawl.loaded(m.seq + 5);
    expect(crawl.tierOf(m.seq)).toBe("none");
  });

  it("a frame re-sent with the same seq is never decided twice", () => {
    const { crawl } = setup();
    const m = msg();
    crawl.arrived(m, ME);
    crawl.finish(m.seq);
    crawl.arrived(m, ME);
    expect(crawl.tierOf(m.seq)).toBe("none");
  });

  it("leaving the room shows what it owed in full when you come back", () => {
    const { crawl } = setup();
    const m = msg();
    crawl.arrived(m, ME);
    crawl.setOpen("dm:Clippy");
    expect(crawl.tierOf(m.seq)).toBe("none");
  });

  it("the cutscene stage opens everything said to the viewer, whatever its channel", () => {
    const { crawl } = setup(PERSONAL_STREAM);
    const mine = msg({ channel: "dm:The Uploader", audience: ["g-1"] });
    const house = msg({ channel: "loc:The Desktop", audience: "all" });
    crawl.arrived(mine, ME);
    crawl.arrived(house, ME);
    expect(crawl.tierOf(mine.seq)).toBe("fast");
    expect(crawl.tierOf(house.seq)).toBe("none");
    crawl.flush(PERSONAL_STREAM);
    expect(crawl.tierOf(mine.seq)).toBe("none");
  });
});

describe("the batch budget", () => {
  it("a crowded beat: the first lines crawl inside 1.5 s, the rest of the burst lands at once", () => {
    const { crawl, tick } = setup();
    const beat = Array.from({ length: 16 }, () => msg({ text: "x".repeat(300) })); // 700 ms each
    for (const m of beat) {
      crawl.arrived(m, ME);
      tick(1);
    }
    // Lines 1–3 would start at 0, 0.7 s and 1.4 s; the 4th at 2.1 s is over
    // budget, so it, the three ahead of it and the rest of the burst are shown.
    expect(beat.map((m) => crawl.tierOf(m.seq)).filter((t) => t !== "none")).toHaveLength(0);
  });

  it("what crawls finishes within the budget plus one line", () => {
    const { crawl, tick } = setup();
    const beat = Array.from({ length: 3 }, () => msg({ text: "y".repeat(100) })); // 500 ms each
    for (const m of beat) crawl.arrived(m, ME);
    expect(beat.every((m) => crawl.tierOf(m.seq) === "fast")).toBe(true);
    const total = beat.reduce((n, m) => n + crawlDuration("fast", m.text.length), 0);
    expect(total).toBeLessThanOrEqual(BATCH_BUDGET_MS + FAST_LINE_MAX_MS);
    // After a quiet second the next beat crawls again.
    for (const m of beat) crawl.finish(m.seq);
    tick(2000);
    const next = msg();
    crawl.arrived(next, ME);
    expect(crawl.tierOf(next.seq)).toBe("fast");
  });

  it("an fx line still decoding is never cut short by the narration after it", () => {
    const { crawl, tick } = setup();
    const fx = msg({ fx: true, text: "x".repeat(63) }); // ≈ 1.6 s of decode
    crawl.arrived(fx, ME);
    tick(2);
    const after = msg({ kind: "narration", from: "Narrator", text: "The screens go dark." });
    crawl.arrived(after, ME);
    expect(crawl.tierOf(fx.seq)).toBe("fx");
    expect(crawl.tierOf(after.seq)).toBe("fast"); // the budget counts fast lines only
  });

  it("a burst over the budget behind an fx line waits its turn, then shows whole", () => {
    const { crawl, tick } = setup();
    const ahead = msg({ text: "a".repeat(300) });
    const fx = msg({ fx: true, text: "TRUTH IS A FILE ".repeat(4) });
    crawl.arrived(ahead, ME);
    crawl.arrived(fx, ME);
    const burst = Array.from({ length: 6 }, () => msg({ text: "b".repeat(300) })); // 700 ms each
    for (const m of burst) {
      crawl.arrived(m, ME);
      tick(1);
    }
    // The fast line ahead of the decode was shown; the fx line keeps its decode.
    expect(crawl.tierOf(ahead.seq)).toBe("none");
    expect(crawl.tierOf(fx.seq)).toBe("fx");
    // The burst stays queued behind it (never shown under a line still decoding)…
    expect(burst.every((m) => crawl.tierOf(m.seq) !== "none")).toBe(true);
    const went: number[] = [];
    crawl.start(fx.seq, () => went.push(fx.seq));
    for (const m of burst) crawl.start(m.seq, () => went.push(m.seq));
    expect(went).toEqual([fx.seq]);
    // …and the moment the decode ends, every over-budget line shows whole, never crawled.
    crawl.finish(fx.seq);
    expect(went).toEqual([fx.seq]);
    expect(burst.map((m) => crawl.tierOf(m.seq))).toEqual(burst.map(() => "none"));
  });

  it("fx lines are never dropped by the budget", () => {
    const { crawl } = setup();
    for (let i = 0; i < 6; i++) crawl.arrived(msg({ text: "z".repeat(300) }), ME);
    const fx = msg({ fx: true, text: "TRUTH IS A FILE" });
    crawl.arrived(fx, ME);
    expect(crawl.tierOf(fx.seq)).toBe("fx");
  });
});

describe("order and tap-to-finish", () => {
  it("a card landing behind queued lines finishes them at once (never sits above a hidden line)", () => {
    const { crawl } = setup();
    const a = msg();
    const b = msg();
    crawl.arrived(a, ME);
    crawl.arrived(b, ME);
    let notified = 0;
    crawl.subscribe(() => notified++);
    crawl.arrived(msg({ kind: "widget", widget: { kind: "captcha", text: "", params: {} } }), ME);
    expect(crawl.tierOf(a.seq)).toBe("none");
    expect(crawl.tierOf(b.seq)).toBe("none");
    expect(notified).toBeGreaterThan(0);
  });

  it("what is never a row here doesn't flush it: a bark, a thread reply, a hidden line", () => {
    const { crawl } = setup();
    const a = msg();
    crawl.arrived(a, ME);
    crawl.arrived(msg({ kind: "narration", ambient: true, beat: undefined, text: "The screensaver changes." }), ME);
    crawl.arrived(msg({ parentSeq: a.seq, beat: undefined, from: "Bob" }), ME);
    crawl.arrived(msg({ hidden: true, beat: undefined }), ME);
    expect(crawl.tierOf(a.seq)).toBe("fast");
  });

  it("the cutscene stage: a card in the Codex / Quest Log / Wallet is not on the stage", () => {
    const { crawl } = setup(PERSONAL_STREAM);
    const last = msg({ channel: "dm:The Uploader", from: "The Uploader", audience: ["g-1"] });
    crawl.arrived(last, ME);
    for (const channel of ["codex", "quests", "wallet"]) {
      crawl.arrived(msg({ channel, kind: "codex", beat: undefined, from: "", audience: ["g-1"] }), ME);
    }
    expect(crawl.tierOf(last.seq)).toBe("fast");
    // The pass card on the stage itself still keeps the order.
    crawl.arrived(msg({ channel: "dm:The Uploader", kind: "widget", widget: { kind: "pass", text: "", params: {} }, audience: ["g-1"] }), ME);
    expect(crawl.tierOf(last.seq)).toBe("none");
  });

  it("a line in another room doesn't flush this one", () => {
    const { crawl } = setup();
    const a = msg();
    crawl.arrived(a, ME);
    crawl.arrived(msg({ channel: "dm:Clippy", beat: undefined }), ME);
    expect(crawl.tierOf(a.seq)).toBe("fast");
  });

  it("flush completes the active line and everything queued, and wakes the bubbles", () => {
    const { crawl } = setup();
    const a = msg();
    const b = msg();
    crawl.arrived(a, ME);
    crawl.arrived(b, ME);
    const went: number[] = [];
    crawl.start(a.seq, () => went.push(a.seq));
    crawl.start(b.seq, () => went.push(b.seq));
    expect(went).toEqual([a.seq]); // one at a time
    let woke = 0;
    const off = crawl.subscribe(() => woke++);
    crawl.flush("loc:The Desktop");
    off();
    expect([crawl.tierOf(a.seq), crawl.tierOf(b.seq)]).toEqual(["none", "none"]);
    expect(woke).toBe(1);
    expect(went).toEqual([a.seq]); // b never had to start: it is shown whole
  });

  it("a bubble that finishes releases the next in seq order", () => {
    const { crawl } = setup();
    const a = msg();
    const b = msg();
    crawl.arrived(a, ME);
    crawl.arrived(b, ME);
    const went: number[] = [];
    crawl.start(b.seq, () => went.push(b.seq));
    crawl.finish(b.seq);
    crawl.start(a.seq, () => went.push(a.seq));
    expect(went).toEqual([b.seq, a.seq]);
    expect(crawl.tierOf(b.seq)).toBe("none");
  });
});
