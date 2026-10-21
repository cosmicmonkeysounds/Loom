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
  latchResults,
  nextAfter,
  outcomeStamp,
  readQuestion,
  readingPlan,
  rowScroll,
  rowStateAt,
  rowsShown,
  rulingStamp,
  totalsLine,
  truthStamp,
} from "../src/cutscene/kit/results.ts";
import type { SceneDef, SceneProps, SceneTarget } from "../src/cutscene/types.ts";
import type { ScreenMoment, ScreenResults, ScreenState } from "../src/screen.ts";

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

  it("a row shows its ruling beside its outcome; a ruled row at 100 never says same or not the same", () => {
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
    expect(row("Notepad")).toContain("🤖 RULED");
    expect(row("Notepad")).not.toMatch(/SAME/u);
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
