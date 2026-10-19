//! `core/server/facts.ts` — the facts judge's pure parts (Wave 4, lane B,
//! stage 1): the book built off `facts.json`, `judgeAnswer`'s three
//! verdicts, the mode read off the world, the project-file helpers, the
//! fresh show-file read, and `FactsWatch` folding `do fact_filed` /
//! `do fact_judged` directives off a sim log into `ModView.facts`.

import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  CONFIDENCE_MAX,
  DEFAULT_CONFIRM,
  DEFAULT_MODE_VAR,
  FACTS_FILE,
  FactsWatch,
  bookOf,
  factsFileOf,
  factsKey,
  factsOf,
  judgeAnswer,
  judgeMode,
  parseFactFiled,
  parseFactJudged,
  parseFactsBook,
  readFactsFile,
  tallyFilings,
  worldReader,
  type FactsFiling,
} from "../server/facts.ts";
import { Sim } from "../src/runtime/sim/index.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-facts-"));
  dirs.push(d);
  return d;
}

/** A generic key file (no story names): two questions, one free-text answer. */
const FILE = {
  version: 1,
  judge: { mode_var: "Night.judge_mode", confirm: { accurate: "fact_accurate", lie: "fact_lie", uncertain: "fact_uncertain" } },
  questions: [
    { id: "Q1", round: 1, text: "How many years?", answer: "Eleven years", accept: ["11 years", "eleven", "11"] },
    { id: "Q2", round: 2, text: "Who wrote it?", answer: "Mister Pickles!", accept: [] },
  ],
  answers: [{ id: "P1", text: "The line.", answer: "You're the one that I want", accept: ["you are the one that i want"] }],
};
const TEXT = JSON.stringify(FILE);
const book = () => parseFactsBook(TEXT).book!;

describe("the book", () => {
  it("folds every key's answer + aliases, fills the judge defaults, keeps the raw file", () => {
    const b = book();
    expect(b.version).toBe(1);
    expect(b.modeVar).toBe("Night.judge_mode");
    expect(b.confirm).toEqual({ accurate: "fact_accurate", lie: "fact_lie", uncertain: "fact_uncertain" });
    expect(b.questions.map((k) => [k.id, k.round])).toEqual([
      ["Q1", 1],
      ["Q2", 2],
    ]);
    expect([...b.questions[0]!.folded]).toEqual(["eleven years", "11 years", "eleven", "11"]);
    expect([...b.questions[1]!.folded]).toEqual(["mister pickles"]);
    expect(b.answers.map((k) => [k.id, k.round])).toEqual([["P1", null]]);
    expect([...b.answers[0]!.folded]).toEqual(["youre the one that i want", "you are the one that i want"]);
    expect(b.raw.questions).toHaveLength(2);
    expect(factsKey(b, "P1")?.text).toBe("The line.");
    expect(factsKey(b, "Q9")).toBeNull();
  });

  it("defaults the mode var + confirm events when the file has no judge block", () => {
    const b = bookOf(parseFactsBook(JSON.stringify({ version: 1, questions: FILE.questions })).book!.raw);
    expect(b.modeVar).toBe(DEFAULT_MODE_VAR);
    expect(b.confirm).toEqual(DEFAULT_CONFIRM);
    expect(b.answers).toEqual([]);
    const partial = parseFactsBook(JSON.stringify({ version: 1, questions: [], judge: { confirm: { lie: "caught_lying" } } })).book!;
    expect(partial.confirm).toEqual({ ...DEFAULT_CONFIRM, lie: "caught_lying" });
  });

  it("refuses a broken file with its problems", () => {
    expect(parseFactsBook("{").book).toBeNull();
    expect(parseFactsBook("{").problems[0]).toMatch(/not JSON/u);
    const bad = parseFactsBook(JSON.stringify({ version: 2, questions: [{ id: "Q1", round: 1, text: "x", answer: "" }] }));
    expect(bad.book).toBeNull();
    expect(bad.problems.join("\n")).toMatch(/version must be 1/u);
    expect(bad.problems.join("\n")).toMatch(/answer must be a non-empty string/u);
  });
});

describe("judgeAnswer (U10)", () => {
  it("is accurate on the answer or any alias, exact after folding", () => {
    const b = book();
    expect(judgeAnswer(b, "Q1", "Eleven years", 100)).toBe("accurate");
    expect(judgeAnswer(b, "Q1", "  ELEVEN  ", 40)).toBe("accurate");
    expect(judgeAnswer(b, "Q1", "11", 1)).toBe("accurate");
    expect(judgeAnswer(b, "Q2", "the mister pickles", 100)).toBe("accurate");
    expect(judgeAnswer(b, "Q2", "Mister Pickles", 100)).toBe("accurate");
    expect(judgeAnswer(b, "P1", "you're the one that i want", 100)).toBe("accurate");
    expect(judgeAnswer(b, "P1", "YOURE the one that I want!", 100)).toBe("accurate");
    // never a substring: an essay containing the answer is not the answer
    expect(judgeAnswer(b, "Q1", "I think it was eleven years or so", 100)).toBe("lie");
  });

  it("is a confident lie at 100 and uncertain below, on a miss", () => {
    const b = book();
    expect(judgeAnswer(b, "Q1", "twelve", CONFIDENCE_MAX)).toBe("lie");
    expect(judgeAnswer(b, "Q1", "twelve", 99)).toBe("uncertain");
    expect(judgeAnswer(b, "Q1", "twelve", 1)).toBe("uncertain");
    expect(judgeAnswer(b, "P1", "roses are red", 100)).toBe("lie");
  });

  it("is null for a key the book lacks", () => {
    expect(judgeAnswer(book(), "Q9", "eleven", 100)).toBeNull();
    expect(judgeAnswer(book(), "", "eleven", 100)).toBeNull();
  });
});

describe("judgeMode", () => {
  it("reads the book's mode var: `review` exactly, anything else is auto", () => {
    const b = book();
    expect(judgeMode(b, () => undefined)).toBe("auto");
    expect(judgeMode(b, (p) => (p === "Night.judge_mode" ? "review" : undefined))).toBe("review");
    expect(judgeMode(b, () => "REVIEW")).toBe("auto");
    expect(judgeMode(b, () => "auto")).toBe("auto");
    const other = parseFactsBook(JSON.stringify({ ...FILE, judge: { mode_var: "Show.judging" } })).book!;
    expect(judgeMode(other, (p) => (p === "Show.judging" ? "review" : undefined))).toBe("review");
    expect(judgeMode(other, (p) => (p === "Night.judge_mode" ? "review" : undefined))).toBe("auto");
  });
});

describe("the project file", () => {
  it("factsFileOf picks exactly the root facts.json; factsOf reads it off a data-file record", () => {
    expect(factsFileOf([{ path: "main.loom", content: "x" }, { path: FACTS_FILE, content: TEXT }])).toBe(TEXT);
    expect(factsFileOf([{ path: "sub/facts.json", content: TEXT }])).toBeNull();
    expect(factsFileOf([])).toBeNull();
    expect(factsOf({ "house.json": "{}", "facts.json": TEXT })).toBe(TEXT);
    expect(factsOf({ "house.json": "{}" })).toBeNull();
    expect(factsOf({ "facts.json": 7 })).toBeNull();
    expect(factsOf(null)).toBeNull();
    expect(factsOf([TEXT])).toBeNull();
    expect(factsOf("x")).toBeNull();
  });

  it("readFactsFile reads fresh — a rewrite (new mtime) is seen on the next read, a broken one reports", () => {
    const dir = freshDir();
    const path = join(dir, FACTS_FILE);
    writeFileSync(path, TEXT);
    const t0 = new Date(Date.now() - 60_000);
    utimesSync(path, t0, t0);
    expect(readFactsFile(path).book?.questions.map((k) => k.id)).toEqual(["Q1", "Q2"]);
    writeFileSync(path, JSON.stringify({ ...FILE, questions: [FILE.questions[0]] }));
    expect(readFactsFile(path).book?.questions.map((k) => k.id)).toEqual(["Q1"]);
    writeFileSync(path, "{ nope");
    const broken = readFactsFile(path);
    expect(broken.book).toBeNull();
    expect(broken.problems[0]).toMatch(/not JSON/u);
    const missing = readFactsFile(join(dir, "nope.json"));
    expect(missing.book).toBeNull();
    expect(missing.problems[0]).toMatch(/unreadable/u);
  });
});

describe("the directive lines", () => {
  it("parses fact_filed (answer = the rest of the line) and fact_judged", () => {
    expect(parseFactFiled("g1 Q1 73 uncertain Eleven years, I think")).toEqual({ person: "g1", question: "Q1", confidence: 73, verdict: "uncertain", answer: "Eleven years, I think" });
    expect(parseFactFiled("g1 Q1 100 accurate 11")).toEqual({ person: "g1", question: "Q1", confidence: 100, verdict: "accurate", answer: "11" });
    expect(parseFactFiled("g1 Q1 100 accurate")).toEqual({ person: "g1", question: "Q1", confidence: 100, verdict: "accurate", answer: "" });
    expect(parseFactFiled("g1 Q1 lots accurate x")).toBeNull();
    expect(parseFactFiled("g1 Q1 100 maybe x")).toBeNull();
    expect(parseFactFiled("g1 Q1")).toBeNull();
    expect(parseFactJudged("g1 Q1 lie")).toEqual({ person: "g1", question: "Q1", final: "lie" });
    expect(parseFactJudged("g1 Q1 marked")).toEqual({ person: "g1", question: "Q1", final: "marked" });
    expect(parseFactJudged("g1 Q1 pending")).toBeNull();
    expect(parseFactJudged("g1 Q1")).toBeNull();
  });

  it("tallies: a marked final counts as uncertain; consensus needs every filing accurate at 100 (U11)", () => {
    const f = (over: Partial<FactsFiling>): FactsFiling => ({ person: "g1", name: "A", question: "Q1", answer: "x", confidence: 100, verdict: "accurate", final: null, how: null, by: null, at: 0, ...over });
    expect(tallyFilings([])).toEqual({ filed: 0, accurate: 0, lie: 0, uncertain: 0, consensus: false });
    expect(tallyFilings([f({}), f({ person: "g2" })])).toEqual({ filed: 2, accurate: 2, lie: 0, uncertain: 0, consensus: true });
    expect(tallyFilings([f({}), f({ person: "g2", confidence: 99 })]).consensus).toBe(false);
    expect(tallyFilings([f({ verdict: "uncertain", final: "marked" }), f({ person: "g2", verdict: "lie" }), f({ person: "g3", verdict: "lie", final: "accurate" })])).toEqual({
      filed: 3,
      accurate: 1,
      lie: 1,
      uncertain: 1,
      consensus: false,
    });
  });
});

// ───────────────────────── FactsWatch over a sim ─────────────────────────

/** A tiny story: a `fact answered` is told to the ledger with its verdict
 *  (`{program}` interpolates to the person's id), and a `judge` event
 *  settles one. Auto mode judges at once. */
const SOURCE = `# Facts
start: Boot

LOCATION Lobby
  label: The Lobby

ROLE Program
  when someone joins:
    -> Boot
  when fact answered for program:
    do fact_filed {program} {question} {confidence} {verdict} {answer}
    if Night.judge_mode != "review":
      do fact_judged {program} {question} {verdict}
  when judged for program:
    do fact_judged {program} {question} {final}

== Boot
  setting: Lobby
Nothing yet.
`;

function sim(mode: "auto" | "review" = "auto"): Sim {
  const s = Sim.fromSources(SOURCE);
  s.setVar("Night.judge_mode", mode);
  s.createPerson("g1", "Ada");
  s.createPerson("g2", "Ben");
  return s;
}

describe("FactsWatch", () => {
  it("folds fact_filed / fact_judged off the sim log: filings, finals, tallies, consensus, pending", () => {
    const s = sim("auto");
    const watch = new FactsWatch({ now: () => 1234 });
    const b = book();
    expect(watch.view(s, b)).toEqual({
      modeVar: "Night.judge_mode",
      mode: "auto",
      confirm: DEFAULT_CONFIRM,
      questions: [
        { id: "Q1", round: 1, text: "How many years?", filings: [], tally: { filed: 0, accurate: 0, lie: 0, uncertain: 0, consensus: false } },
        { id: "Q2", round: 2, text: "Who wrote it?", filings: [], tally: { filed: 0, accurate: 0, lie: 0, uncertain: 0, consensus: false } },
        { id: "P1", round: null, text: "The line.", filings: [], tally: { filed: 0, accurate: 0, lie: 0, uncertain: 0, consensus: false } },
      ],
      pending: 0,
    });
    s.signal("fact answered", "g1", { question: "Q1", answer: "Eleven years", confidence: 100, verdict: "accurate", card: 1 });
    s.signal("fact answered", "g2", { question: "Q1", answer: "eleven", confidence: 100, verdict: "accurate", card: 2 });
    s.signal("fact answered", "g1", { question: "Q2", answer: "Doctor Seuss", confidence: 60, verdict: "uncertain", card: 3 });
    const v = watch.view(s, b);
    expect(v.questions[0]!.filings).toEqual([
      { person: "g1", name: "Ada", question: "Q1", answer: "Eleven years", confidence: 100, verdict: "accurate", final: "accurate", how: "auto", by: null, at: 1234 },
      { person: "g2", name: "Ben", question: "Q1", answer: "eleven", confidence: 100, verdict: "accurate", final: "accurate", how: "auto", by: null, at: 1234 },
    ]);
    expect(v.questions[0]!.tally).toEqual({ filed: 2, accurate: 2, lie: 0, uncertain: 0, consensus: true });
    expect(v.questions[1]!.filings).toEqual([{ person: "g1", name: "Ada", question: "Q2", answer: "Doctor Seuss", confidence: 60, verdict: "uncertain", final: "uncertain", how: "auto", by: null, at: 1234 }]);
    expect(v.questions[1]!.tally).toEqual({ filed: 1, accurate: 0, lie: 0, uncertain: 1, consensus: false });
    expect(v.pending).toBe(0);
    // a later settle (the guess is marked) lands on the same filing
    s.signal("judged", "g1", { question: "Q2", final: "marked" });
    expect(watch.view(s, b).questions[1]!.filings[0]).toMatchObject({ final: "marked", how: "marked" });
  });

  it("records how each final was reached and who settled it (wave 5 issue 8): auto, confirmed, overridden, settled, marked", () => {
    const s = Sim.fromSources(SOURCE.replace("  when judged for program:", "  when fact_accurate for program:\n    do fact_judged {program} {question} accurate\n  when fact_lie for program:\n    do fact_judged {program} {question} lie\n  when judged for program:"));
    s.setVar("Night.judge_mode", "review");
    for (const [id, name] of [["g1", "Ada"], ["g2", "Ben"], ["g3", "Cy"], ["g4", "Di"]] as const) s.createPerson(id, name);
    const watch = new FactsWatch({ now: () => 1 });
    const b = book();
    // What the runtime does before every mutation: name who does it.
    const act = (by: string | null, name: string, subject: string, args: Record<string, string | number>) => {
      watch.mark(s, by);
      s.signal(name, subject, args);
    };
    act(null, "fact answered", "g1", { question: "Q1", answer: "eleven", confidence: 100, verdict: "accurate", card: 1 });
    act(null, "fact answered", "g2", { question: "Q1", answer: "twelve", confidence: 100, verdict: "lie", card: 2 });
    act(null, "fact answered", "g3", { question: "Q1", answer: "11", confidence: 100, verdict: "accurate", card: 3 });
    act(null, "fact answered", "g4", { question: "Q1", answer: "nine", confidence: 40, verdict: "uncertain", card: 4 });
    expect(watch.all(s, b.confirm).map((f) => [f.person, f.final, f.how, f.by])).toEqual([
      ["g1", null, null, null],
      ["g2", null, null, null],
      ["g3", null, null, null],
      ["g4", null, null, null],
    ]);
    act("Jo (director)", "fact_accurate", "g1", { question: "Q1" }); // confirms the proposal
    act("Clippy", "fact_accurate", "g2", { question: "Q1" }); // a booth overrides the lie
    act("Jo (director)", "judged", "g3", { question: "Q1", final: "accurate" }); // a reveal settles it
    act("Jo (director)", "judged", "g4", { question: "Q1", final: "marked" });
    // auto: judged in the filing's own step, even with a director's mark on it
    s.setVar("Night.judge_mode", "auto");
    act("Jo (director)", "fact answered", "g1", { question: "Q2", answer: "Mister Pickles", confidence: 100, verdict: "accurate", card: 5 });
    const rows = watch.view(s, b).questions.flatMap((q) => q.filings.map((f) => [f.person, f.question, f.final, f.how, f.by]));
    expect(rows).toEqual([
      ["g1", "Q1", "accurate", "confirmed", "Jo (director)"],
      ["g2", "Q1", "accurate", "overridden", "Clippy"],
      ["g3", "Q1", "accurate", "settled", "Jo (director)"],
      ["g4", "Q1", "marked", "marked", "Jo (director)"],
      ["g1", "Q2", "accurate", "auto", null],
    ]);
    // with no marks the fold still splits steps at each external signal
    const bare = new FactsWatch({ now: () => 1 });
    expect(bare.view(s, b).questions[0]!.filings.map((f) => [f.how, f.by])).toEqual([
      ["confirmed", null],
      ["overridden", null],
      ["settled", null],
      ["marked", null],
    ]);
  });

  it("quiet ticks (marks that log nothing) collapse into one pending mark; the newest names the next step", () => {
    const s = Sim.fromSources(SOURCE.replace("  when judged for program:", "  when fact_accurate for program:\n    do fact_judged {program} {question} accurate\n  when judged for program:"));
    s.setVar("Night.judge_mode", "review");
    s.createPerson("g1", "Ada");
    const watch = new FactsWatch({ now: () => 1 });
    const b = book();
    watch.mark(s, null);
    s.signal("fact answered", "g1", { question: "Q1", answer: "twelve", confidence: 100, verdict: "lie", card: 1 });
    // an hour of ticks that fire nothing, nobody looking at the view
    for (let i = 0; i < 3600; i++) watch.mark(s, null);
    const pending = (watch as unknown as { marks: unknown[] }).marks;
    expect(pending.length).toBeLessThanOrEqual(2);
    watch.mark(s, "Jo (director)");
    s.signal("fact_accurate", "g1", { question: "Q1" });
    expect(watch.view(s, b).questions[0]!.filings.map((f) => [f.final, f.how, f.by])).toEqual([["accurate", "overridden", "Jo (director)"]]);
    expect((watch as unknown as { marks: unknown[] }).marks.length).toBe(0);
  });

  it("review mode: filings stay pending until judged; the mode follows the world var", () => {
    const s = sim("review");
    const watch = new FactsWatch({ now: () => 5 });
    const b = book();
    s.signal("fact answered", "g1", { question: "Q1", answer: "twelve", confidence: 100, verdict: "lie", card: 1 });
    s.signal("fact answered", "g2", { question: "Q1", answer: "11 years", confidence: 100, verdict: "accurate", card: 2 });
    let v = watch.view(s, b);
    expect(v.mode).toBe("review");
    expect(v.pending).toBe(2);
    expect(v.questions[0]!.filings.map((f) => f.final)).toEqual([null, null]);
    // the tally counts the proposals meanwhile
    expect(v.questions[0]!.tally).toEqual({ filed: 2, accurate: 1, lie: 1, uncertain: 0, consensus: false });
    // a director overrides the lie to accurate, confirms the other
    s.signal("judged", "g1", { question: "Q1", final: "accurate" });
    v = watch.view(s, b);
    expect(v.pending).toBe(1);
    expect(v.questions[0]!.filings[0]!.final).toBe("accurate");
    expect(v.questions[0]!.tally).toEqual({ filed: 2, accurate: 2, lie: 0, uncertain: 0, consensus: true });
    s.signal("judged", "g2", { question: "Q1", final: "accurate" });
    expect(watch.view(s, b).pending).toBe(0);
    s.setVar("Night.judge_mode", "auto");
    expect(watch.view(s, b).mode).toBe("auto");
    expect(judgeMode(b, worldReader(s))).toBe("auto");
  });

  it("keeps one filing per (person, question), lists an unknown key, survives a second look, resets on a new sim", () => {
    const s = sim("auto");
    const watch = new FactsWatch({ now: () => 9 });
    const b = book();
    s.signal("fact answered", "g1", { question: "Q1", answer: "twelve", confidence: 100, verdict: "lie", card: 1 });
    s.signal("fact answered", "g1", { question: "Q1", answer: "eleven", confidence: 100, verdict: "accurate", card: 2 });
    s.signal("fact answered", "g2", { question: "Q7", answer: "what", confidence: 50, verdict: "uncertain", card: 3 });
    const v = watch.view(s, b);
    expect(v.questions[0]!.filings).toHaveLength(1);
    expect(v.questions[0]!.filings[0]!.answer).toBe("eleven");
    expect(v.questions.map((q) => q.id)).toEqual(["Q1", "Q2", "P1", "Q7"]);
    expect(v.questions[3]).toMatchObject({ round: null, text: "Q7", tally: { filed: 1, uncertain: 1 } });
    // the cursor: a second look re-reads nothing and agrees
    expect(watch.view(s, b)).toEqual(v);
    // a fresh sim (a restart) starts the fold over
    const fresh = sim("auto");
    expect(watch.view(fresh, b).questions.every((q) => q.filings.length === 0)).toBe(true);
    expect(watch.all(fresh)).toEqual([]);
  });

  it("ignores malformed directive lines and unrelated directives", () => {
    const s = Sim.fromSources(`# Odd
start: Boot

ROLE Program
  when someone joins:
    -> Boot

== Boot
do fact_filed g1
do fact_judged g1 Q1 pending
do cue screens_hunt_results
do fact_filed g1 Q1 100 accurate Eleven years
`);
    s.createPerson("g1", "Ada");
    const watch = new FactsWatch({ now: () => 1 });
    const v = watch.view(s, book());
    expect(v.questions[0]!.filings).toHaveLength(1);
    expect(v.questions[0]!.filings[0]).toMatchObject({ person: "g1", name: "Ada", answer: "Eleven years", final: null });
    expect(v.pending).toBe(1);
  });
});
