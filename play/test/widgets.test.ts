import { describe, expect, it } from "vitest";

import { createCrawl } from "../src/host.ts";
import { ANSWER_MAX_DEFAULT, CAPTCHA_TILES, CONFIDENCE_LABEL, FACT_MAX, WIDGETS, answerMax, answerResult, captchaGrid, captchaPassed, defaultFactQuestion, factFileHint, factQuestionOf, factQuestions, factResult, supersededCards, widgetLabel } from "../src/widgets.tsx";

describe("captcha grid", () => {
  it("is deterministic per seed and always has 2–4 target squares", () => {
    for (let seed = 0; seed < 50; seed++) {
      const g = captchaGrid("traffic light", seed);
      expect(g.tiles).toHaveLength(9);
      expect(g.answer.length).toBeGreaterThanOrEqual(2);
      expect(g.answer.length).toBeLessThanOrEqual(4);
      for (let i = 0; i < 9; i++) expect(g.tiles[i] === "traffic light").toBe(g.answer.includes(i));
      expect(captchaGrid("traffic light", seed)).toEqual(g);
    }
    expect(captchaGrid("traffic light", 1)).not.toEqual(captchaGrid("traffic light", 2));
  });

  it("matches a target loosely and tolerates an unknown one (no right squares)", () => {
    expect(captchaGrid("Traffic Lights", 3).target).toBe("traffic light");
    const none = captchaGrid("a submarine", 3);
    expect(none.answer).toEqual([]);
    expect(none.tiles.every((t) => CAPTCHA_TILES.some((c) => c.key === t))).toBe(true);
  });

  it("passes only an exact selection", () => {
    const g = captchaGrid("bus", 7);
    expect(captchaPassed(g, g.answer)).toBe(true);
    expect(captchaPassed(g, [...g.answer].reverse())).toBe(true);
    expect(captchaPassed(g, [])).toBe(false);
    expect(captchaPassed(g, g.answer.slice(1))).toBe(false);
    const extra = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((i) => !g.answer.includes(i))!;
    expect(captchaPassed(g, [...g.answer, extra])).toBe(false);
  });
});

describe("widget registry", () => {
  it("labels known kinds and falls back for unknown ones", () => {
    expect(WIDGETS["captcha"]?.answerable).toBe(true);
    expect(WIDGETS["image"]?.answerable).toBe(false);
    expect(widgetLabel({ kind: "captcha", text: "Pick the lights", params: {} })).toBe("🛡️ security check — Pick the lights");
    expect(widgetLabel({ kind: "minesweeper", text: "", params: {} })).toBe("🧩 minesweeper");
  });
});

describe("typewriter crawl policy", () => {
  it("never crawls the backlog, crawls a fresh line once, and resets per sign-in", () => {
    const crawl = createCrawl();
    crawl.reset();
    expect(crawl.claim(5)).toBe(false); // nothing loaded yet: nothing is "new"
    crawl.loaded(10);
    expect(crawl.claim(10)).toBe(false);
    expect(crawl.claim(11)).toBe(true);
    expect(crawl.claim(11)).toBe(false); // re-opening the room must not replay it
    crawl.reset();
    crawl.loaded(-1);
    expect(crawl.claim(0)).toBe(true);
  });

  it("crawls lines one after another, in seq order, and releases the next when one leaves the screen", () => {
    const crawl = createCrawl();
    const order: number[] = [];
    crawl.start(12, () => order.push(12));
    crawl.start(10, () => order.push(10));
    crawl.start(11, () => order.push(11));
    expect(order).toEqual([12]); // the first to ask starts at once
    crawl.finish(12);
    expect(order).toEqual([12, 10]); // then the earliest waiting line
    crawl.finish(11); // a waiting bubble unmounted: dropped, not started
    crawl.finish(10);
    expect(order).toEqual([12, 10]);
    crawl.start(13, () => order.push(13));
    expect(order).toEqual([12, 10, 13]);
    crawl.reset();
    crawl.start(14, () => order.push(14));
    expect(order).toEqual([12, 10, 13, 14]); // a reset forgets the active line
  });

  it("is per host — one embedded pane crawling a line doesn't spend it for another", () => {
    const a = createCrawl();
    const b = createCrawl();
    a.loaded(3);
    b.loaded(3);
    expect(a.claim(4)).toBe(true);
    expect(b.claim(4)).toBe(true);
  });
});

describe("📝 fact card", () => {
  it("parses the question picker from `with questions:`", () => {
    expect(factQuestions("H4: Round 2 Q1. What extension? | H5: Round 2 Q2. Which song? |  ")).toEqual([
      { id: "H4", label: "Round 2 Q1. What extension?" },
      { id: "H5", label: "Round 2 Q2. Which song?" },
    ]);
    expect(factQuestions(undefined)).toEqual([]);
    expect(factQuestions("F1")).toEqual([{ id: "F1", label: "F1" }]);
  });

  it("files only a picked question, a trimmed answer within the limit, and a whole-number confidence 1–100", () => {
    expect(factResult("H5", "  Clippy ", 73)).toEqual({ question: "H5", answer: "Clippy", confidence: 73 });
    expect(factResult("H5", "Clippy", 100)).toEqual({ question: "H5", answer: "Clippy", confidence: 100 });
    expect(factResult("H5", "Clippy", 1)).toEqual({ question: "H5", answer: "Clippy", confidence: 1 });
    expect(factResult("", "Clippy", 100)).toBeNull();
    expect(factResult("H5", "   ", 100)).toBeNull();
    expect(factResult("H5", "Clippy", 0)).toBeNull();
    expect(factResult("H5", "Clippy", 101)).toBeNull();
    expect(factResult("H5", "Clippy", 50.5)).toBeNull();
    expect(factResult("H5", "Clippy", Number.NaN)).toBeNull();
    expect(factResult("H5", "x".repeat(FACT_MAX + 1), 100)).toBeNull();
    expect(CONFIDENCE_LABEL).toBe("Please select your confidence level in this response");
    expect(WIDGETS["fact"]?.answerable).toBe(true);
    expect(widgetLabel({ kind: "fact", text: "📝 File a fact", params: {} })).toBe("📝 File a fact");
    expect(widgetLabel({ kind: "fact", text: "Round 2", params: {} })).toBe("📝 file a fact — Round 2");
  });

  it("a lone open question is already picked; File it says why it is off (T5-04)", () => {
    const one = factQuestions("H3: Round 1 Q3. Who wrote it?");
    const two = factQuestions("H2: Q2 | H3: Q3");
    expect(defaultFactQuestion(one)).toBe("H3");
    expect(defaultFactQuestion(two)).toBe("");
    // Typing an answer is enough with one question left.
    expect(factResult(factQuestionOf("", one), "Clippy", 100)).toEqual({ question: "H3", answer: "Clippy", confidence: 100 });
    // A pick survives while open; a list shrinking to one lands on the lone one.
    expect(factQuestionOf("H2", two)).toBe("H2");
    expect(factQuestionOf("H2", one)).toBe("H3");
    expect(factQuestionOf("", two)).toBe("");
    expect(factFileHint("", "Clippy")).toBe("Pick a question above");
    expect(factFileHint("H3", "  ")).toBe("Type your answer");
    expect(factFileHint("H3", "x".repeat(FACT_MAX + 1))).toContain(String(FACT_MAX));
    expect(factFileHint("H3", "Clippy")).toBeNull();
  });
});

describe("💬 answer card", () => {
  it("is an answerable, never-superseded kind with its own label", () => {
    expect(WIDGETS["answer"]?.answerable).toBe(true);
    expect(WIDGETS["answer"]?.supersedes).toBeUndefined();
    expect(widgetLabel({ kind: "answer", text: "Give me a pickup line.", params: {} })).toBe("💬 your answer — Give me a pickup line.");
    expect(widgetLabel({ kind: "answer", text: "", params: {} })).toBe("💬 your answer");
    // two answer cards in one room both stay live (only re-dealt kinds fold)
    const msgs = [
      { seq: 1, channel: "dm:X", kind: "widget", widget: { kind: "answer", text: "a", params: {} } },
      { seq: 2, channel: "dm:X", kind: "widget", widget: { kind: "answer", text: "b", params: {} } },
      { seq: 3, channel: "dm:X", kind: "widget", widget: { kind: "fact", text: "f", params: {} } },
      { seq: 4, channel: "dm:X", kind: "widget", widget: { kind: "fact", text: "g", params: {} } },
    ];
    expect([...supersededCards(msgs as never)]).toEqual([3]);
  });

  it("sends a trimmed non-empty text within the card's max (`with max:`, else the default)", () => {
    expect(answerMax({})).toBe(ANSWER_MAX_DEFAULT);
    expect(answerMax({ max: "120" })).toBe(120);
    expect(answerMax({ max: "0" })).toBe(ANSWER_MAX_DEFAULT);
    expect(answerMax({ max: "lots" })).toBe(ANSWER_MAX_DEFAULT);
    expect(answerResult("  You're the one that I want ", 120)).toEqual({ text: "You're the one that I want" });
    expect(answerResult("   ", 120)).toBeNull();
    expect(answerResult("x".repeat(121), 120)).toBeNull();
    expect(answerResult("x".repeat(120), 120)).toEqual({ text: "x".repeat(120) });
  });
});
