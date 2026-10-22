// Wave 18b (Q6, O2, O4): the reading scenes draw the screen state's
// `results` block — Trabolta's stamps on every filing, the tally's pages,
// the verdict's tiles and (the TV only) its answers and liars.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { HISTORY_T } from "../src/cutscene/clock.ts";
import { fakeReadQuestion, fakeResults, fakeState } from "../src/cutscene/fake.ts";
import { componentFor } from "../src/cutscene/pick.ts";
import { SCENES } from "../src/cutscene/registry.ts";
import {
  ROW_MS,
  STAMP_AT,
  VERDICT_MS,
  VERDICT_PLAN,
  VERDICT_WALL_MS,
  liarsLine,
  liarsSize,
  verdictHasPages,
  verdictPageAt,
  verdictTotals,
  verdictTotalsLine,
  latchResults,
  nextAfter,
  outcomeStamp,
  readQuestion,
  readingPlan,
  rowScroll,
  rowStateAt,
  rowsShown,
  rowRuling,
  rulingStamp,
  tallyGauge,
  tallyPages,
  totalsLine,
  truthStamp,
} from "../src/cutscene/kit/results.ts";
import type { SceneDef, SceneProps, SceneTarget } from "../src/cutscene/types.ts";
import { EMPTY_NIGHT, type ScreenMoment, type ScreenResults, type ScreenState } from "../src/screen.ts";
import { nightSummary } from "../src/cutscene/kit/tv2-time.ts";
import { purgatoryText } from "../src/cutscene/scenes/act2.tsx";
import { trustCallout } from "../src/cutscene/scenes/act3.tsx";

beforeAll(() => {
  const error = console.error.bind(console);
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    if (typeof a[0] === "string" && a[0].includes("useLayoutEffect")) return;
    error(...a);
  });
});

const AT = 5_000_000;
const sceneOf = (id: string): SceneDef => SCENES.find((s) => s.id === id)!;

function draw(id: string, target: SceneTarget, t: number, o: { results?: ScreenResults | null; night?: Partial<ScreenState["night"]>; moments?: ScreenMoment[]; at?: number } = {}): string {
  const def = sceneOf(id);
  const View = componentFor(def, target)!;
  const at = o.at ?? AT;
  const state = fakeState({ now: at + t, target: target === "tv" ? "tv" : "terminals", night: o.night, moments: o.moments, results: o.results ?? null });
  const w = def.when[0]!;
  const props: SceneProps = { t, at, seq: 1, value: "slide" in w ? w.slide.replace(/\*$/u, "") : w.name, state, night: state.night, who: null, target, sfx: () => false, done: () => {}, reduced: false };
  return renderToStaticMarkup(createElement(View, props));
}

/** Text only (tags out, entities back), for reading what a frame says. */
const text = (html: string) => html.replace(/<[^>]+>/gu, " ").replace(/&amp;/gu, "&").replace(/&#x27;/gu, "'").replace(/&quot;/gu, '"').replace(/\s+/gu, " ");

describe("the stamps (O4, D10)", () => {
  it("map every ruling to its stamp; none for an exact match, the house rule or a director", () => {
    expect(rulingStamp("s")?.text).toBe("🤖 SAME");
    expect(rulingStamp("n")?.text).toBe("🤖 NOT THE SAME");
    expect(rulingStamp("r")?.text).toBe("🤖 RULED");
    expect(rulingStamp("?")?.text).toBe("🤖 …");
    expect(rulingStamp("")).toBeNull();
    // A sure row draws no ruling stamp, whatever the wire says (D11); below 100 it does.
    for (const ruled of ["", "r", "?", "s", "n"] as const) expect(rowRuling({ sure: true, ruled })).toBeNull();
    expect(rowRuling({ sure: false, ruled: "s" })?.text).toBe("🤖 SAME");
    expect(rowRuling({ sure: false, ruled: "?" })?.text).toBe("🤖 …");
  });

  it("map every public outcome; never accurate versus lie", () => {
    expect(outcomeStamp("a").text).toBe("✔ ACCEPTED");
    expect(outcomeStamp("g").text).toBe("✘ GUESS");
    expect(outcomeStamp("u").text).toBe("— NOT COUNTED");
    expect(outcomeStamp("p").text).toBe("… PENDING");
    for (const o of ["a", "g", "u", "p"] as const) expect(outcomeStamp(o).text).not.toMatch(/lie|accurate/iu);
    expect(truthStamp("true").text).toBe("✔ TRUE");
    expect(truthStamp("lie").text).toBe("✘ LIE");
    expect(truthStamp("none").text).toBe("— NOBODY ANSWERED");
    expect(truthStamp(null).text).toBe("— NOBODY ANSWERED");
  });
});

describe("a reading's timeline", () => {
  it("reveals one row every ROW_MS, its stamps a beat later, and keeps the newest in view", () => {
    const plan = readingPlan(20);
    expect(rowsShown(plan, 20, plan.rows - 1)).toBe(0);
    expect(rowsShown(plan, 20, plan.rows)).toBe(1);
    expect(rowsShown(plan, 20, plan.rows + 5 * ROW_MS)).toBe(6);
    expect(rowsShown(plan, 20, HISTORY_T)).toBe(20);
    expect(rowStateAt(plan, 0, plan.rows + ROW_MS * STAMP_AT - 1).stamp).toBe(0);
    expect(rowStateAt(plan, 0, plan.rows + ROW_MS * STAMP_AT + 1).stamp).toBeGreaterThan(0);
    expect(rowStateAt(plan, 3, plan.rows).k).toBe(-1);
    // No scroll while the list fits; then it keeps the newest row in view, never backwards.
    expect(rowScroll(plan, 20, plan.rows + 6 * ROW_MS)).toBe(0);
    let last = 0;
    for (let t = plan.rows; t < plan.rows + 25 * ROW_MS; t += 300) {
      const s = rowScroll(plan, 20, t);
      expect(s).toBeGreaterThanOrEqual(last - 1e-9);
      last = s;
    }
    expect(rowScroll(plan, 20, HISTORY_T)).toBe(12);
    // The totals land after the last row's stamp.
    expect(plan.summary).toBeGreaterThan(plan.rows + 19 * ROW_MS + ROW_MS * STAMP_AT);
    expect(plan.next).toBeGreaterThan(plan.summary);
    expect(readingPlan(0).summary).toBe(readingPlan(0).rows);
  });

  it("says what is next: the next question, then truth or dare after the third (R21)", () => {
    expect(nextAfter(1)).toBe("NEXT: QUESTION 2");
    expect(nextAfter(2)).toBe("NEXT: QUESTION 3");
    expect(nextAfter(3)).toBe("NEXT: TRUTH OR DARE");
    expect(nextAfter(null)).toBe("NEXT: TRUTH OR DARE");
    expect(totalsLine({ filed: 5, accepted: 3, guesses: 1, uncounted: 0 })).toBe("ACCEPTED 3 · GUESSES 1 · PENDING 1");
  });

  it("holds the block across a poll that lost it; a new seq or the live rows win", () => {
    const a = fakeResults("read", { seq: 3 });
    const b = fakeResults("read", { seq: 4 });
    expect(latchResults(null, a, "read")).toBe(a);
    expect(latchResults(a, null, "read")).toBe(a);
    expect(latchResults(a, b, "read")).toBe(b);
    expect(latchResults(a, fakeResults("verdict"), "read")).toBe(a);
    expect(latchResults(null, a, "verdict")).toBeNull();
    expect(readQuestion(fakeResults("read", { ns: [1, 2, 3] }), 2)?.n).toBe(2);
    expect(readQuestion(fakeResults("read", { ns: [4] }), 2)?.n).toBe(4);
    expect(readQuestion(null, 1)).toBeNull();
  });
});

describe("hunt_results reads the filings off the wire", () => {
  const read = (night: { results_q: number }) => ({ night, moments: [{ seq: 50, at: AT, kind: "signal" as const, name: "read_the_results", who: null, kept: false }] });

  it("the TV: QUESTION n, the server's text, the count, then every row with its stamps", () => {
    const results = fakeResults("read", { ns: [2], rows: 4 });
    const q = results.questions[0]!;
    const plan = readingPlan(4);
    const early = text(draw("hunt_results", "tv", 2500, { results, ...read({ results_q: 2 }) }));
    expect(early).toContain("QUESTION 2");
    expect(early).not.toContain(q.rows![0]!.who);
    const mid = text(draw("hunt_results", "tv", plan.rows + ROW_MS * STAMP_AT + 400, { results, ...read({ results_q: 2 }) }));
    expect(mid).toContain(q.rows![0]!.who);
    expect(mid).toContain(`“${q.rows![0]!.said}”`);
    expect(mid).not.toContain(q.rows![1]!.who);
    const end = text(draw("hunt_results", "tv", HISTORY_T, { results, ...read({ results_q: 2 }) }));
    for (const r of q.rows!) expect(end).toContain(r.who);
    expect(end).toContain(`${q.filed} FILED`);
    expect(end).toContain(totalsLine(q));
    expect(end).toContain("NEXT: QUESTION 3");
    expect(end).not.toMatch(/filing\.txt|\bREAD\b/u);
  });

  it("a row shows its ruling beside its outcome; a sure row shows none before ⚖, whatever he ruled", () => {
    const q = { ...fakeReadQuestion(1, 0), filed: 5 };
    q.rows = [
      { who: "Winamp", said: "Blue", sure: false, out: "a", ruled: "s" },
      { who: "Excel", said: "Green", sure: false, out: "g", ruled: "n" },
      { who: "Notepad", said: "Teal", sure: true, out: "a", ruled: "r" },
      { who: "ICQ", said: "Navy", sure: false, out: "p", ruled: "?" },
      { who: "Solitaire", said: "Blue", sure: true, out: "a", ruled: "" },
    ];
    const results: ScreenResults = { kind: "read", seq: 1, at: AT, questions: [q] };
    const html = draw("hunt_results", "tv", HISTORY_T, { results, ...read({ results_q: 1 }) });
    const row = (who: string) => text(html.split(who)[1]!.split("res-row")[0]!);
    expect(row("Winamp")).toContain("🤖 SAME");
    expect(row("Excel")).toContain("🤖 NOT THE SAME");
    expect(row("Excel")).toContain("✘ GUESS");
    // Filed at 100: his ruling (`r`) and an exact match (``) look alike, or the
    // unstamped sure rows would give the key away (D11).
    expect(row("Notepad")).not.toContain("🤖");
    expect(row("Notepad")).not.toMatch(/SAME|RULED/u);
    for (const who of ["Notepad", "Solitaire"]) expect(row(who)).toMatch(/^ “[^”]+” SURE ✔ ACCEPTED (<|ACCEPTED)/u);
    expect(row("ICQ")).toContain("🤖 …");
    expect(row("Solitaire")).not.toContain("🤖");
    // The stamp changes in place on the next poll: the same frame with the ruling in.
    const ruled: ScreenResults = { ...results, questions: [{ ...q, rows: q.rows.map((r) => (r.who === "ICQ" ? { ...r, out: "a", ruled: "s" } : r)) }] };
    expect(text(draw("hunt_results", "tv", HISTORY_T, { results: ruled, ...read({ results_q: 1 }) }).split("ICQ")[1]!.split("res-row")[0]!)).toContain("🤖 SAME");
  });

  it("a consensus shows the answer in a gold banner; nobody filed says so", () => {
    const q = { ...fakeReadQuestion(1, 3), consensus: true, answer: "Placeholder answer" };
    const html = text(draw("hunt_results", "tv", HISTORY_T, { results: { kind: "read", seq: 1, at: AT, questions: [q] }, ...read({ results_q: 1 }) }));
    expect(html).toContain("CONSENSUS");
    expect(html).toContain("The answer is: Placeholder answer");
    const none = { ...fakeReadQuestion(3, 0), filed: 0 };
    const empty = text(draw("hunt_results", "tv", HISTORY_T, { results: { kind: "read", seq: 1, at: AT, questions: [none] }, ...read({ results_q: 3 }) }));
    expect(empty).toContain("NOBODY FILED");
    expect(empty).toContain("NEXT: TRUTH OR DARE");
  });

  it("the wall: counts only, never a name or what anyone said; Trabolta is reading", () => {
    const results = fakeResults("read", { ns: [1], rows: 6, tv: false });
    const html = text(draw("hunt_results", "wall", HISTORY_T, { results, ...read({ results_q: 1 }) }));
    expect(html).toContain("Trabolta is reading the results.");
    expect(html).not.toContain("Clippy is reading");
    expect(html).toContain("FILED");
    expect(html).toContain("ACCEPTED");
    for (const r of fakeResults("read", { ns: [1], rows: 6 }).questions[0]!.rows!) expect(html).not.toContain(r.who);
  });

  it("falls back with no results (an older server): the scanner, no invented filings", () => {
    for (const target of ["tv", "wall"] as const) {
      const html = draw("hunt_results", target, 8000, read({ results_q: 1 }));
      expect(html, target).not.toMatch(/filing\.txt/u);
      expect(html).not.toMatch(/>READ</u);
      expect(html).toContain("a1-scan");
    }
  });
});

describe("the tally pages H4–H6, then lands its gauge", () => {
  it("is the held `tally` slide now, not the Round Two Tally moment (it can't play twice)", () => {
    const def = sceneOf("round_two_tally");
    expect(def.when).toEqual([{ slide: "tally" }]);
    expect(def.ms).toBe("hold");
  });

  it("the TV: one page per question with its rows and stamps, then the number", () => {
    const results = fakeResults("read", { ns: [4, 5, 6], rows: 3 });
    const { pages, gauge } = tallyPages(results.questions);
    expect(pages.map((p) => p.q.n)).toEqual([4, 5, 6]);
    for (let i = 1; i < pages.length; i++) expect(pages[i]!.start).toBeGreaterThan(pages[i - 1]!.end);
    expect(gauge).toBeGreaterThan(pages[2]!.end);
    const p5 = pages[1]!;
    const html = text(draw("round_two_tally", "tv", p5.plan.summary + 100, { results }));
    expect(html).toContain("QUESTION 5");
    for (const r of results.questions[1]!.rows!) expect(html).toContain(r.who);
    expect(html).toContain(totalsLine(results.questions[1]!));
    expect(html).not.toContain("CONFIDENCE THAT WE WILL DEFEAT THE MALWARE");
    const g = tallyGauge(gauge);
    const landed = text(draw("round_two_tally", "tv", g.land + 2500, { results, night: { collection_complete: true } }));
    expect(landed).toContain("61%");
    expect(landed).not.toContain("QUESTION 6");
    // History: the number, held.
    expect(text(draw("round_two_tally", "tv", HISTORY_T, { results, night: { collection_complete: false } }))).toContain("12%");
    // A question nobody filed is a short page that says so.
    const empty = { ...fakeReadQuestion(4, 0), filed: 0 };
    const e = tallyPages([empty]);
    expect(e.pages[0]!.end - e.pages[0]!.start).toBeLessThan(7000);
    expect(text(draw("round_two_tally", "tv", e.pages[0]!.plan.filed + 1200, { results: { kind: "read", seq: 1, at: AT, questions: [empty] } }))).toContain("Nobody filed.");
  });

  it("the wall: each question's counts, never a name; then the number", () => {
    const results = fakeResults("read", { ns: [4, 5, 6], rows: 3, tv: false });
    const html = text(draw("round_two_tally", "wall", 4000, { results }));
    expect(html).toContain("Q4");
    expect(html).toContain("Q6");
    expect(html).toContain("filed");
    for (const r of fakeResults("read", { ns: [4, 5, 6], rows: 3 }).questions[0]!.rows!) expect(html).not.toContain(r.who);
    expect(text(draw("round_two_tally", "wall", HISTORY_T, { results, night: { collection_complete: true } }))).toContain("61%");
  });
});

describe("the verdict (O2, D11)", () => {
  const beat = (at: number): ScreenMoment[] => [{ seq: 80, at, kind: "beat", name: "The Verdict", who: null, kept: false }];

  it("flips eight tiles with their truth and counts, then the totals and the stamp", () => {
    const results = fakeResults("verdict");
    const html = text(draw("verdict", "tv", VERDICT_PLAN.stamp + 800, { results, moments: beat(AT) }));
    for (let n = 1; n <= 8; n++) expect(html).toContain(`Q${n}`);
    expect(html).toContain("✔ TRUE");
    expect(html).toContain("✘ LIE");
    expect(html).toContain("— NOBODY ANSWERED");
    expect(html).toContain(verdictTotalsLine(verdictTotals(results.questions)));
    expect(html).toContain("A LIE IS ON RECORD");
    const allTrue: ScreenResults = { ...results, questions: results.questions.map((q) => ({ ...q, truth: "true" as const, liars: [] })) };
    expect(text(draw("verdict", "tv", VERDICT_PLAN.stamp + 800, { results: allTrue }))).toContain("EVERY ANSWERED FACT IS TRUE");
    // Before its turn a tile shows no truth.
    const early = text(draw("verdict", "tv", VERDICT_PLAN.tiles + 100, { results }));
    expect(early).not.toContain("✘ LIE");
  });

  it("the TV pages every question: its truth, the key answer, who lied (🤖 where his ruling made it)", () => {
    const results = fakeResults("verdict");
    const q2 = results.questions[1]!;
    const page2 = text(draw("verdict", "tv", VERDICT_PLAN.pages + VERDICT_PLAN.pageMs + 800, { results }));
    expect(page2).toContain("Q2");
    expect(page2).toContain(`The answer: ${q2.answer}`);
    expect(page2).toContain(liarsLine(q2));
    expect(liarsLine(q2)).toMatch(/^Lied: .+ 🤖/u);
    const page1 = text(draw("verdict", "tv", VERDICT_PLAN.pages + 800, { results }));
    expect(page1).toContain("Nobody lied.");
    expect(liarsLine({ liars: [{ who: "A", ruled: false }], liarsMore: 3 })).toBe("Lied: A +3 more");
    // Near the server's 40-name cap the page draws 24 and folds the rest in, smaller.
    const forty = Array.from({ length: 40 }, (_, i) => ({ who: `Program Number ${i + 1}`, ruled: false }));
    const line = liarsLine({ liars: forty, liarsMore: 5 });
    expect(line.split(", ").length).toBe(24);
    expect(line).toMatch(/Program Number 24 \+21 more$/u);
    expect(liarsSize({ liars: forty })).toBe(" most");
    expect(liarsSize({ liars: forty.slice(0, 10) })).toBe(" many");
    expect(liarsSize({ liars: forty.slice(0, 3) })).toBe("");
    // It holds on the last page to its end, and its length covers all eight.
    expect(verdictPageAt(VERDICT_MS - 1, 8)).toBe(7);
    expect(verdictPageAt(VERDICT_MS - 1, 3)).toBe(2);
    expect(verdictPageAt(VERDICT_PLAN.pages - 1, 8)).toBe(-1);
    expect(sceneOf("verdict").ms).toBe(VERDICT_MS);
    expect(VERDICT_MS).toBeGreaterThanOrEqual(VERDICT_PLAN.pages + 8 * VERDICT_PLAN.pageMs);
    expect(text(draw("verdict", "tv", VERDICT_MS - 100, { results }))).toContain("Q8");
  });

  it("a wall never shows an answer or a name, even handed the TV's block", () => {
    const tv = fakeResults("verdict");
    for (const t of [VERDICT_PLAN.stamp + 800, VERDICT_PLAN.pages + 800, VERDICT_PLAN.pages + 4 * VERDICT_PLAN.pageMs]) {
      const html = text(draw("verdict", "wall", t, { results: tv }));
      expect(html).not.toContain("The answer");
      expect(html).not.toMatch(/Lied:|Nobody lied/u);
      for (const q of tv.questions) {
        if (q.answer !== null) expect(html).not.toContain(q.answer);
        for (const l of q.liars ?? []) expect(html).not.toContain(l.who);
      }
    }
    expect(VERDICT_WALL_MS).toBeLessThan(VERDICT_MS);
  });

  it("falls back: no results is the old ■ picture; a block with no answers or liars has no pages", () => {
    const bare = draw("verdict", "tv", 5000, {});
    expect(bare).toContain("■");
    expect(bare).toContain("THE VERDICT IS IN");
    expect(bare).not.toMatch(/TRUE|LIE/u);
    const old: ScreenResults = { ...fakeResults("verdict"), questions: fakeResults("verdict").questions.map((q) => ({ ...q, answer: null, liars: null })) };
    expect(verdictHasPages(old.questions)).toBe(false);
    const html = text(draw("verdict", "tv", VERDICT_PLAN.pages + 800, { results: old }));
    expect(html).not.toContain("The answer");
    expect(html).not.toContain("Lied:");
  });
});

describe("the other results scenes read the night's real numbers", () => {
  const beatAt = (name: string, at: number): ScreenMoment => ({ seq: at, at, kind: "beat", name, who: null, kept: false });

  it("Final Assessment names his most and least trusted once the assessment is final", () => {
    const moments = [beatAt("The Bag Of Truth", AT + 51_000), beatAt("Final Assessment", AT + 90_000)];
    const night = { most_trusted: "Winamp", least_trusted: "Notepad" };
    for (const target of ["tv", "wall"] as const) {
      expect(text(draw("bobbing", target, 125_000, { moments, night })), target).toContain("Most trusted: Winamp · Least trusted: Notepad");
      // Weighing: not yet.
      expect(text(draw("bobbing", target, 95_000, { moments, night })), target).not.toContain("Most trusted");
      // An older server sends neither: no call-out.
      expect(text(draw("bobbing", target, 125_000, { moments }))).not.toContain("trusted:");
    }
    expect(trustCallout({ most_trusted: null, least_trusted: "Notepad" })).toBe("Least trusted: Notepad");
    expect(trustCallout({ most_trusted: null, least_trusted: null })).toBeNull();
  });

  it("the recount and purgatory say the facts accepted and the first program reinstalled", () => {
    const night = { facts_accepted: 17, first_reinstall: "Winamp" };
    for (const id of ["recount", "purgatory"]) {
      for (const target of ["tv", "wall"] as const) {
        const html = text(draw(id, target, HISTORY_T, { night }));
        expect(html, `${id} ${target}`).toContain("17 facts accepted tonight.");
        expect(html, `${id} ${target}`).toContain("First program reinstalled: Winamp.");
        expect(text(draw(id, target, HISTORY_T, {}))).not.toMatch(/accepted tonight|reinstalled:/u);
      }
    }
    expect(nightSummary({ facts_accepted: 1, first_reinstall: null })).toEqual(["1 fact accepted tonight."]);
    expect(purgatoryText({ ...EMPTY_NIGHT })).not.toContain("tonight");
  });
});
