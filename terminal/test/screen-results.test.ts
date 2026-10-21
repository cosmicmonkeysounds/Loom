//! Wave 18b on the screen state: the results block (`do fact_read` /
//! `do fact_truth`, Trabolta's ruling stamps, the TV verdict's answers and
//! liars), the spot's house announcement setting, and the slide-gated night
//! vars — each read defensively, absent (an older server) as null.

import { describe, expect, it } from "vitest";
import { EMPTY_NIGHT, RESULTS_MAX_ROWS, parseScreenState, resultRowOf, resultsOf, spotOf } from "../src/screen.ts";

const base = { attract: false };

const read = {
  kind: "read",
  seq: 3,
  at: 1_700_000,
  questions: [
    {
      id: "H1",
      n: 1,
      round: 1,
      text: "  Where did   the founder work?  ",
      filed: 3,
      accepted: 2,
      guesses: 1,
      uncounted: 0,
      consensus: false,
      answer: null,
      rows: [
        ["Winamp", "the bank", 1, "a", "s"],
        ["Excel", "a bank downtown", 0, "g", "n"],
        ["Clippy", "a shop", 1, "a", "r"],
        ["Paint", "nowhere", 1, "p", "?"],
        ["Old", "server", 1, "a"],
      ],
      more: 2,
    },
  ],
};

describe("the results block (wave 18b)", () => {
  it("reads a read: counts, rows with their ruling stamps, text squashed", () => {
    const r = resultsOf(read)!;
    expect(r).toMatchObject({ kind: "read", seq: 3, at: 1_700_000 });
    const q = r.questions[0]!;
    expect(q).toMatchObject({ id: "H1", n: 1, round: 1, text: "Where did the founder work?", filed: 3, accepted: 2, guesses: 1, uncounted: 0, consensus: false, answer: null, truth: null, more: 2, liars: null, liarsMore: 0 });
    expect(q.rows!.map((x) => [x.who, x.sure, x.out, x.ruled])).toEqual([
      ["Winamp", true, "a", "s"],
      ["Excel", false, "g", "n"],
      ["Clippy", true, "a", "r"],
      ["Paint", true, "p", "?"],
      // A server from before the stamps sends four: no stamp.
      ["Old", true, "a", ""],
    ]);
  });

  it("a row never carries an accurate / lie outcome or an unknown stamp", () => {
    expect(resultRowOf(["A", "x", 1, "accurate", "s"])).toBeNull();
    expect(resultRowOf(["A", "x", 1, "lie"])).toBeNull();
    expect(resultRowOf(["A", "x", 1, "a", "why: because"])?.ruled).toBe("");
    expect(resultRowOf(["", "x", 1, "a"])).toBeNull();
    expect(resultRowOf({ who: "A" })).toBeNull();
    expect(resultRowOf(["A", "x"])).toBeNull();
  });

  it("reads a TV verdict: the truth, the key answer and the liars, a 🤖 on his", () => {
    const r = resultsOf({
      kind: "verdict",
      seq: 9,
      at: 5,
      questions: [
        { id: "H1", n: 1, round: 1, filed: 4, accepted: 3, guesses: 1, uncounted: 0, consensus: false, answer: "the key", truth: "lie", liars: [["Winamp", 0], ["Excel", 1], [""], "x"], liarsMore: 3 },
        { id: "H2", n: 2, round: 1, filed: 0, accepted: 0, guesses: 0, uncounted: 0, consensus: false, answer: "another", truth: "none", liars: [] },
        { id: "H3", n: 3, round: 1, truth: "accurate" },
      ],
    })!;
    expect(r.kind).toBe("verdict");
    expect(r.questions[0]).toMatchObject({ truth: "lie", answer: "the key", liars: [{ who: "Winamp", ruled: false }, { who: "Excel", ruled: true }], liarsMore: 3, rows: null });
    expect(r.questions[1]).toMatchObject({ truth: "none", liars: [] });
    // Not a wire value (the server maps accurate → "true"): no truth.
    expect(r.questions[2]).toMatchObject({ truth: null, filed: 0, liars: null });
  });

  it("a wall's verdict (no answers, no names) reads as nulls", () => {
    const q = resultsOf({ kind: "verdict", seq: 1, at: 1, questions: [{ id: "H1", n: 1, round: 1, filed: 2, accepted: 2, guesses: 0, uncounted: 0, consensus: true, truth: "true" }] })!.questions[0]!;
    expect(q).toMatchObject({ answer: null, liars: null, rows: null, truth: "true" });
  });

  it("malformed blocks and questions drop; history reads at 0; rows are capped", () => {
    expect(resultsOf(null)).toBeNull();
    expect(resultsOf({ kind: "reading", seq: 1, at: 1, questions: [] })).toBeNull();
    expect(resultsOf({ kind: "read", seq: "1", questions: [] })).toBeNull();
    expect(resultsOf({ kind: "read", seq: 1, at: 1 })).toBeNull();
    expect(resultsOf({ kind: "read", seq: 1, at: 0, questions: [{ n: 1 }, { id: "H2", n: 2 }, null] })).toMatchObject({ at: 0, questions: [{ id: "H2", filed: 0, rows: null }] });
    expect(resultsOf({ kind: "read", seq: 1, at: -4, questions: [] })!.at).toBe(0);
    const many = Array.from({ length: 90 }, (_, i) => [`P${i}`, "x", 0, "g", ""]);
    expect(resultsOf({ kind: "read", seq: 1, at: 1, questions: [{ id: "H1", n: 1, rows: many }] })!.questions[0]!.rows).toHaveLength(RESULTS_MAX_ROWS);
  });

  it("rides parseScreenState; absent (an older server, nothing public) is null", () => {
    expect(parseScreenState(base)!.results).toBeNull();
    expect(parseScreenState({ ...base, results: read })!.results?.questions[0]?.id).toBe("H1");
    expect(parseScreenState({ ...base, results: "soon" })!.results).toBeNull();
  });
});

describe("the spot block (wave 18b, Q8)", () => {
  it("is the house list's say for this spot; absent or malformed is null", () => {
    expect(spotOf({ announce: true })).toEqual({ announce: true });
    expect(spotOf({ announce: false })).toEqual({ announce: false });
    expect(spotOf({ announce: "yes" })).toBeNull();
    expect(spotOf(null)).toBeNull();
    expect(parseScreenState({ ...base, spot: { announce: true } })!.spot).toEqual({ announce: true });
    expect(parseScreenState(base)!.spot).toBeNull();
  });
});

describe("the slide-gated night vars (wave 18b)", () => {
  it("reads the trusted names and the recount numbers; the story's none is nobody", () => {
    const n = parseScreenState({ ...base, night: { most_trusted: " Winamp ", least_trusted: "Excel", facts_accepted: 17.6, first_reinstall: "Paint" } })!.night;
    expect(n).toMatchObject({ most_trusted: "Winamp", least_trusted: "Excel", facts_accepted: 17, first_reinstall: "Paint" });
    const none = parseScreenState({ ...base, night: { most_trusted: "", first_reinstall: "none", facts_accepted: -1 } })!.night;
    expect(none).toMatchObject({ most_trusted: null, first_reinstall: null, facts_accepted: null, least_trusted: null });
    expect(parseScreenState({ ...base, night: { facts_accepted: "9" } })!.night.facts_accepted).toBeNull();
    expect(parseScreenState(base)!.night).toEqual(EMPTY_NIGHT);
  });
});
