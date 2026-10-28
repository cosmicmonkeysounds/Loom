//! `core/src/facts.ts` — the facts.json contract (Wave 4, lane A, stage 0):
//! the unified answer fold, the generic validation any project gets, the
//! show-shaped rules, and the show's own seed file against both.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODE,
  POSITION_WORDS,
  clueText,
  FACTS_FILE,
  SHOW_MIN_TRUTHS,
  SHOW_QUESTION_LAYOUT,
  factsProblems,
  foldAnswer,
  isFactsFile,
  parseFactsText,
  showFactsProblems,
  validateFacts,
} from "../src/facts.ts";
import type { FactsFile } from "../src/facts.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { foldCode } from "../src/runtime/sim/model.ts";
import { scenarioDir, scenarioSource } from "../examples/load.ts";

const SHOW = "trapped-in-the-internet";

// ───────────────────────── fixtures ─────────────────────────

/** The smallest file the generic rules accept. */
const minimal = (): Record<string, unknown> => ({
  version: 1,
  questions: [{ id: "H1", round: 1, text: "How many?", answer: "Eleven" }],
});

/** A show-shaped file every show rule accepts (no story names needed). */
function showFixture(): FactsFile {
  const q = (id: string, round: number, n: number) => ({
    id,
    round,
    text: `Question ${n} asks about thing ${n}?`,
    answer: `answer ${n}`,
    accept: [`alias ${n}`],
    topics: [`thing ${n}`],
    where: `The room: document ${n}`,
    codex: { id: `Doc ${n}`, title: `Doc ${n}`, code: `DOC-${n}`, text: `The document ${n}.` },
  });
  const raw = {
    version: 1,
    show: { title: "A Show" },
    categories: { main: { label: "the world" }, character: { label: "the programs" } },
    tiers: {
      common: { label: "Common", colour: "green", stack: "in the open" },
      rare: { label: "Rare", colour: "blue", stack: "odd places" },
      "very-rare": { label: "Very rare", colour: "purple", stack: "tucked away" },
      legendary: { label: "Legendary", colour: "black", stack: "the hardest place" },
    },
    rounds: { 1: { questTitle: "R1", brief: "b1" }, 2: { questTitle: "R2", brief: "b2" }, 3: { questTitle: "R3", brief: "b3" } },
    questions: SHOW_QUESTION_LAYOUT.map((l, i) => q(l.id, l.round, i + 1)),
    answers: [{ id: "P1", text: "Say it", answer: "the line", accept: [] }],
    facts: [
      { id: "M01", category: "main", tier: "common", text: "a fact", codex: { id: "Fact One", title: "Fact One", code: "FACT-ONE", text: "…" } },
      { id: "M02", category: "main", tier: "common", text: "told already", existing: "Old Entry", code: "OLD-ENTRY" },
      { id: "C01", category: "character", tier: "rare", text: "a person", codex: { id: "Her Secret", title: "Her Secret", code: "HER-SECRET", about: "Someone", text: "…" } },
    ],
    truths: Array.from({ length: SHOW_MIN_TRUTHS }, (_, i) => ({ id: `TD${i + 1}`, text: `Truth ${i + 1}?` })),
  };
  const v = validateFacts(raw);
  if (!v.ok) throw new Error(v.problems.join("\n"));
  return v.facts;
}

const problemsOf = (raw: unknown): string[] => {
  const v = validateFacts(raw);
  return v.ok ? [] : v.problems;
};

// ───────────────────────── the fold ─────────────────────────

describe("foldAnswer — the one fold every judge shares", () => {
  it("drops apostrophes: You're ≡ youre", () => {
    expect(foldAnswer("You're")).toBe("youre");
    expect(foldAnswer("youre")).toBe("youre");
    expect(foldAnswer("you’re")).toBe("youre");
    expect(foldAnswer("you‘re")).toBe("youre");
    expect(foldAnswer("you`re")).toBe("youre");
  });
  it("strips punctuation and one leading article: Mister Pickles! ≡ the mister pickles", () => {
    expect(foldAnswer("Mister Pickles!")).toBe("mister pickles");
    expect(foldAnswer("the mister pickles")).toBe("mister pickles");
    expect(foldAnswer("A Harbour Tabby")).toBe("harbour tabby");
    expect(foldAnswer("An answer")).toBe("answer");
    expect(foldAnswer("the the end")).toBe("the end");
  });
  it("turns every other non-alphanumeric run into one space: 9:00 a.m. → 9 00 a m", () => {
    expect(foldAnswer("9:00 a.m.")).toBe("9 00 a m");
    expect(foldAnswer("  Hopelessly   Devoted -- to You ")).toBe("hopelessly devoted to you");
    expect(foldAnswer("Appendix Z: Loose Ends (Do Not Print)")).toBe("appendix z loose ends do not print");
  });
  it("strips diacritics and compatibility forms (NFKD)", () => {
    expect(foldAnswer("Café Zürich")).toBe("cafe zurich");
    expect(foldAnswer("ﬁne")).toBe("fine");
  });
  it("folds the empty and the all-punctuation to nothing", () => {
    expect(foldAnswer("")).toBe("");
    expect(foldAnswer("!!! ???")).toBe("");
    expect(foldAnswer("the")).toBe("the");
  });
  it("never matches by substring: the caller compares folded strings for equality", () => {
    expect(foldAnswer("I think it is Grok")).not.toBe(foldAnswer("Grok"));
  });
});

// ───────────────────────── the file name ─────────────────────────

describe("isFactsFile", () => {
  it("is exactly facts.json at the project root", () => {
    expect(FACTS_FILE).toBe("facts.json");
    expect(isFactsFile("facts.json")).toBe(true);
    expect(isFactsFile("sub/facts.json")).toBe(false);
    expect(isFactsFile("facts.json.bak")).toBe(false);
    expect(isFactsFile("Facts.json")).toBe(false);
    expect(isFactsFile("house.json")).toBe(false);
  });
});

// ───────────────────────── generic validation ─────────────────────────

describe("validateFacts — the generic rules", () => {
  it("accepts a minimal file and fills the optional sections", () => {
    const v = validateFacts(minimal());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.facts.version).toBe(1);
    expect(v.facts.questions[0]!.accept).toEqual([]);
    expect(v.facts.answers).toEqual([]);
    expect(v.facts.facts).toEqual([]);
    expect(v.facts.truths).toEqual([]);
  });
  it("keeps unknown keys, never drops them", () => {
    const raw = { ...minimal(), extra: { kept: true }, questions: [{ ...(minimal().questions as unknown[])[0] as object, note: "mine" }] };
    const v = validateFacts(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.facts["extra"]).toEqual({ kept: true });
    expect((v.facts.questions[0] as unknown as Record<string, unknown>)["note"]).toBe("mine");
  });
  it("refuses a non-object and a wrong version", () => {
    expect(problemsOf(null)).toEqual(["facts.json must be a JSON object"]);
    expect(problemsOf([])).toEqual(["facts.json must be a JSON object"]);
    expect(problemsOf({ ...minimal(), version: 2 })).toEqual(["version must be 1 (got 2)"]);
    expect(problemsOf({ questions: [] })[0]).toMatch(/^version must be 1/u);
  });
  it("needs arrays for the sections", () => {
    expect(problemsOf({ ...minimal(), questions: {} })).toEqual(["questions must be an array"]);
    expect(problemsOf({ ...minimal(), answers: "no" })).toContain("answers must be an array");
    expect(problemsOf({ ...minimal(), facts: 1 })).toContain("facts must be an array");
    expect(problemsOf({ ...minimal(), truths: null })).toContain("truths must be an array");
  });
  it("needs a well-formed id on every question and answer", () => {
    for (const bad of ["", "1H", "has space", "a".repeat(17), "ö", 7, undefined]) {
      const p = problemsOf({ ...minimal(), questions: [{ id: bad, round: 1, text: "t", answer: "a" }] });
      expect(p.some((x) => x.includes("id must match"))).toBe(true);
    }
    expect(problemsOf({ ...minimal(), questions: [{ id: "a".repeat(16), round: 1, text: "t", answer: "a" }] })).toEqual([]);
    expect(problemsOf({ ...minimal(), questions: [{ id: "Q_1-b", round: 1, text: "t", answer: "a" }] })).toEqual([]);
    expect(problemsOf({ ...minimal(), questions: ["H1"] })).toEqual(["questions[0] must be an object"]);
  });
  it("ids are unique across questions ∪ answers (the judge looks both up)", () => {
    const dupQ = { ...minimal(), questions: [{ id: "H1", round: 1, text: "t", answer: "a" }, { id: "H1", round: 1, text: "t", answer: "b" }] };
    expect(problemsOf(dupQ)).toEqual(['questions[1]: duplicate id "H1"']);
    const dupA = { ...minimal(), answers: [{ id: "H1", text: "t", answer: "a" }] };
    expect(problemsOf(dupA)).toEqual(['answers[0]: duplicate id "H1"']);
  });
  it("needs a non-empty answer that folds to something, and string aliases", () => {
    expect(problemsOf({ ...minimal(), questions: [{ id: "H1", round: 1, text: "t", answer: "" }] })).toEqual(["questions H1: answer must be a non-empty string"]);
    expect(problemsOf({ ...minimal(), questions: [{ id: "H1", round: 1, text: "t" }] })).toEqual(["questions H1: answer must be a non-empty string"]);
    expect(problemsOf({ ...minimal(), questions: [{ id: "H1", round: 1, text: "t", answer: "?!" }] })).toEqual(['questions H1: answer "?!" folds to nothing']);
    expect(problemsOf({ ...minimal(), questions: [{ id: "H1", round: 1, text: "t", answer: "a", accept: "b" }] })).toEqual(["questions H1: accept must be an array of strings"]);
    expect(problemsOf({ ...minimal(), questions: [{ id: "H1", round: 1, text: "t", answer: "a", accept: [1] }] })).toEqual(["questions H1: accept must be an array of strings"]);
    expect(problemsOf({ ...minimal(), questions: [{ id: "H1", round: 1, text: "t", answer: "a", accept: ["ok", "..."] }] })).toEqual(['questions H1: alias "..." folds to nothing']);
  });
  it("needs a string text and an integer round ≥ 1 on a question", () => {
    expect(problemsOf({ ...minimal(), questions: [{ id: "H1", round: 1, answer: "a" }] })).toEqual(["questions H1: text must be a string"]);
    for (const bad of [0, -1, 1.5, "1", undefined]) {
      const p = problemsOf({ ...minimal(), questions: [{ id: "H1", round: bad, text: "t", answer: "a" }] });
      expect(p).toEqual([`questions H1: round must be an integer ≥ 1 (got ${JSON.stringify(bad)})`]);
    }
    expect(problemsOf({ ...minimal(), questions: [{ id: "H1", round: 9, text: "t", answer: "a" }] })).toEqual([]);
  });
  it("checks a question's optional topics / where / hint / codex shape", () => {
    const base = { id: "H1", round: 1, text: "t", answer: "a" };
    expect(problemsOf({ ...minimal(), questions: [{ ...base, topics: "x" }] })).toEqual(["questions H1: topics must be an array of strings"]);
    expect(problemsOf({ ...minimal(), questions: [{ ...base, where: 3 }] })).toEqual(["questions H1: where must be a string"]);
    expect(problemsOf({ ...minimal(), questions: [{ ...base, hint: [] }] })).toEqual(["questions H1: hint must be a string"]);
    expect(problemsOf({ ...minimal(), questions: [{ ...base, codex: "no" }] })).toEqual(["questions H1: codex must be an object"]);
    expect(problemsOf({ ...minimal(), questions: [{ ...base, codex: { id: "X", title: "X", code: "", text: "t" } }] })).toEqual(["questions H1: codex.code must be a non-empty string"]);
  });
  it("answers need text + answer like questions, but no round", () => {
    expect(problemsOf({ ...minimal(), answers: [{ id: "P1", text: "t", answer: "a" }] })).toEqual([]);
    expect(problemsOf({ ...minimal(), answers: [{ id: "P1", answer: "a" }] })).toEqual(["answers P1: text must be a string"]);
    expect(problemsOf({ ...minimal(), answers: [{ id: "P1", text: "t", answer: "" }] })).toEqual(["answers P1: answer must be a non-empty string"]);
  });
  it("checks the judge block: a dotted mode_var and event-name confirms", () => {
    expect(problemsOf({ ...minimal(), judge: { mode_var: "Night.judge_mode", confirm: { accurate: "fact_accurate", lie: "fact_lie", uncertain: "fact_uncertain" } } })).toEqual([]);
    expect(problemsOf({ ...minimal(), judge: {} })).toEqual([]);
    expect(problemsOf({ ...minimal(), judge: "auto" })).toEqual(["judge must be an object"]);
    expect(problemsOf({ ...minimal(), judge: { mode_var: "judge_mode" } })).toEqual(['judge.mode_var must be a dotted world path (got "judge_mode")']);
    expect(problemsOf({ ...minimal(), judge: { mode_var: "Night.judge mode" } })).toHaveLength(1);
    expect(problemsOf({ ...minimal(), judge: { confirm: [] } })).toEqual(["judge.confirm must be an object"]);
    expect(problemsOf({ ...minimal(), judge: { confirm: { maybe: "x" } } })).toEqual(["judge.confirm.maybe: unknown verdict (one of accurate, lie, uncertain)"]);
    expect(problemsOf({ ...minimal(), judge: { confirm: { lie: "fact lie" } } })).toEqual(['judge.confirm.lie must be an event name (got "fact lie")']);
  });
  it("checks show / rounds / categories when present", () => {
    expect(problemsOf({ ...minimal(), show: { title: "T" } })).toEqual([]);
    expect(problemsOf({ ...minimal(), show: {} })).toEqual(["show.title must be a string"]);
    expect(problemsOf({ ...minimal(), rounds: { 1: { questTitle: "a", brief: "b" } } })).toEqual([]);
    expect(problemsOf({ ...minimal(), rounds: [] })).toEqual(["rounds must be an object keyed by round number"]);
    expect(problemsOf({ ...minimal(), rounds: { one: { questTitle: "a", brief: "b" } } })).toEqual(["rounds.one: the key must be a round number"]);
    expect(problemsOf({ ...minimal(), rounds: { 1: { questTitle: "a" } } })).toEqual(["rounds.1 needs questTitle + brief strings"]);
    expect(problemsOf({ ...minimal(), categories: { main: { colour: "green" } } })).toEqual(["categories.main needs a label string"]);
    expect(problemsOf({ ...minimal(), tiers: { common: { label: "Common", colour: "green" } } })).toEqual(["tiers.common needs label + colour + stack strings"]);
    expect(problemsOf({ ...minimal(), tiers: [] })).toEqual(["tiers must be an object keyed by tier"]);
    expect(problemsOf({ ...minimal(), categories: "x" })).toEqual(["categories must be an object keyed by category"]);
  });
  it("checks the facts section's shape and that a category is declared", () => {
    const fact = { id: "M01", category: "main", text: "t", codex: { id: "X", title: "X", code: "X", text: "t" } };
    expect(problemsOf({ ...minimal(), facts: [fact] })).toEqual([]);
    expect(problemsOf({ ...minimal(), facts: [fact, { ...fact }] })).toEqual(['facts[1]: duplicate fact id "M01"']);
    expect(problemsOf({ ...minimal(), facts: [{ ...fact, id: "" }] })).toEqual(["facts[0]: id must be a non-empty string"]);
    expect(problemsOf({ ...minimal(), facts: [{ ...fact, category: "" }] })).toEqual(["fact M01: category must be a non-empty string"]);
    expect(problemsOf({ ...minimal(), facts: [{ ...fact, text: 1 }] })).toEqual(["fact M01: text must be a string"]);
    expect(problemsOf({ ...minimal(), facts: [{ ...fact, existing: "" }] })).toEqual(["fact M01: existing must name a codex entry"]);
    expect(problemsOf({ ...minimal(), facts: [{ ...fact, code: 1 }] })).toEqual(["fact M01: code must be a string"]);
    expect(problemsOf({ ...minimal(), facts: [{ ...fact, codex: { ...fact.codex, about: "" } }] })).toEqual(["fact M01: codex.about must be a non-empty string"]);
    expect(problemsOf({ ...minimal(), facts: [{ ...fact, codex: { ...fact.codex, secret: false } }] })).toEqual(["fact M01: codex.secret must be true when present"]);
    expect(problemsOf({ ...minimal(), facts: ["x"] })).toEqual(["facts[0] must be an object"]);
    expect(problemsOf({ ...minimal(), categories: { main: { label: "l" } }, facts: [{ ...fact, category: "other" }] })).toEqual(['fact M01: category "other" is not declared in categories']);
    const tiers = { common: { label: "Common", colour: "green", stack: "s" } };
    expect(problemsOf({ ...minimal(), tiers, facts: [{ ...fact, tier: "common" }] })).toEqual([]);
    expect(problemsOf({ ...minimal(), tiers, facts: [fact] })).toEqual(["fact M01: needs a tier (the file declares tiers)"]);
    expect(problemsOf({ ...minimal(), tiers, facts: [{ ...fact, tier: "mythic" }] })).toEqual(['fact M01: tier "mythic" is not declared in tiers']);
    expect(problemsOf({ ...minimal(), facts: [{ ...fact, tier: "" }] })).toEqual(["fact M01: tier must be a non-empty string"]);
  });
  it("checks the truths section's shape", () => {
    expect(problemsOf({ ...minimal(), truths: [{ id: "TD1", text: "Why?" }] })).toEqual([]);
    expect(problemsOf({ ...minimal(), truths: [{ id: "TD1", text: "Why?" }, { id: "TD1", text: "Again?" }] })).toEqual(['truths[1]: duplicate truth id "TD1"']);
    expect(problemsOf({ ...minimal(), truths: [{ id: "TD1", text: " " }] })).toEqual(["truth TD1: text must be a non-empty string"]);
    expect(problemsOf({ ...minimal(), truths: [{ text: "x" }] })).toEqual(["truths[0]: id must be a non-empty string"]);
    expect(problemsOf({ ...minimal(), truths: [null] })).toEqual(["truths[0] must be an object"]);
  });
  it("reports every problem at once", () => {
    const p = problemsOf({ version: 3, questions: [{ id: "", round: 0, answer: "" }], judge: { mode_var: "x" } });
    expect(p.length).toBeGreaterThanOrEqual(5);
  });
});

describe("parseFactsText / factsProblems", () => {
  it("parses JSON then validates", () => {
    const p = parseFactsText(JSON.stringify(minimal()));
    expect(p.problems).toEqual([]);
    expect(p.facts?.questions[0]?.id).toBe("H1");
  });
  it("reports non-JSON and invalid files as problems, never throws", () => {
    expect(parseFactsText("{").facts).toBeNull();
    expect(parseFactsText("{").problems[0]).toMatch(/^not JSON: /u);
    expect(factsProblems("")[0]).toMatch(/^not JSON: /u);
    expect(factsProblems(JSON.stringify({ version: 1 }))).toEqual([]);
    expect(factsProblems(JSON.stringify({ version: 0 }))).toEqual(["version must be 1 (got 0)"]);
    expect(factsProblems(JSON.stringify(minimal()))).toEqual([]);
  });
});

// ───────────────────────── the show's rules ─────────────────────────

describe("showFactsProblems — the show-shaped rules", () => {
  it("accepts the fixture", () => {
    expect(showFactsProblems(showFixture())).toEqual([]);
  });
  it("wants exactly H1–H6 / F1–F2 in rounds 3 / 3 / 2, in order", () => {
    const f = showFixture();
    f.questions = [...f.questions].reverse();
    expect(showFactsProblems(f)).toEqual(["questions must be exactly H1@1 H2@1 H3@1 H4@2 H5@2 H6@2 F1@3 F2@3 in that order (got F2@3 F1@3 H6@2 H5@2 H4@2 H3@1 H2@1 H1@1)"]);
    const g = showFixture();
    g.questions[3]!.round = 1;
    expect(showFactsProblems(g)[0]).toMatch(/^questions must be exactly/u);
    const h = showFixture();
    h.questions = h.questions.slice(0, 7);
    expect(showFactsProblems(h)[0]).toMatch(/\(got H1@1 .* F1@3\)$/u);
    const e = showFixture();
    e.questions = [];
    expect(showFactsProblems(e)[0]).toMatch(/\(got none\)$/u);
  });
  it("wants every used round declared and a show title", () => {
    const f = showFixture();
    delete f.rounds!["2"];
    expect(showFactsProblems(f)).toEqual(["rounds.2 is not declared"]);
    const g = showFixture();
    delete g.show;
    expect(showFactsProblems(g)).toEqual(["show.title is missing"]);
  });
  it("wants ≥ 1 topic per question, each in its text and in no answer of any question", () => {
    const f = showFixture();
    f.questions[0]!.topics = [];
    expect(showFactsProblems(f)).toEqual(["question H1: needs at least one topic"]);
    const g = showFixture();
    g.questions[0]!.topics = ["elsewhere"];
    expect(showFactsProblems(g)).toEqual(['question H1: topic "elsewhere" does not occur in its text']);
    const h = showFixture();
    h.questions[0]!.topics = ["Thing 1"]; // case-insensitive
    expect(showFactsProblems(h)).toEqual([]);
    const k = showFixture();
    k.questions[1]!.text = "Does alias 1 answer thing 2?";
    k.questions[1]!.topics = ["alias 1"];
    expect(showFactsProblems(k)).toEqual(['question H2: topic "alias 1" occurs in an answer of H1 ("alias 1")']);
    const m = showFixture();
    m.questions[0]!.topics = [" "];
    expect(showFactsProblems(m)).toEqual(["question H1: empty topic"]);
  });
  it("wants a where and a codex on every question", () => {
    const f = showFixture();
    delete f.questions[2]!.where;
    delete f.questions[2]!.codex;
    expect(showFactsProblems(f)).toEqual(["question H3: where is missing", "question H3: codex is missing"]);
  });
  it("refuses \" { } | in a question's or a truth's text", () => {
    for (const ch of ['"', "{", "}", "|"]) {
      const f = showFixture();
      f.questions[0]!.text = `Thing 1 ${ch} what?`;
      expect(showFactsProblems(f)).toEqual([`question H1: text must not contain " { } or |`]);
      const g = showFixture();
      g.truths[0]!.text = `Why ${ch}?`;
      expect(showFactsProblems(g)).toEqual([`truth TD1: text must not contain " { } or |`]);
    }
    const ok = showFixture();
    ok.questions[0]!.text = "Thing 1's time: 9:00 a.m. (sharp)?";
    ok.questions[0]!.topics = ["thing 1"];
    expect(showFactsProblems(ok)).toEqual([]);
  });
  it("wants codes of capitals, digits and hyphens — no apostrophes", () => {
    expect(CODE.test("BILLBOARD-LEASE-11")).toBe(true);
    for (const bad of ["grok", "GROK'S", "-LEAD", "A B", "", "É"]) expect(CODE.test(bad)).toBe(false);
    const f = showFixture();
    f.questions[0]!.codex!.code = "doc-1";
    expect(showFactsProblems(f)).toEqual([`question H1: code "doc-1" must match ${CODE.source}`]);
    const g = showFixture();
    g.facts[1]!.code = "OLD'ENTRY";
    expect(showFactsProblems(g)).toEqual([`fact M02: code "OLD'ENTRY" must match ${CODE.source}`]);
  });
  it("wants every codex id and every code unique — codes compared folded like the model", () => {
    const f = showFixture();
    f.facts[0]!.codex!.id = "Doc 2";
    expect(showFactsProblems(f)).toEqual(['fact M01: codex id "Doc 2" is also used by question H2']);
    const g = showFixture();
    g.facts[0]!.codex!.code = "DOC2"; // folds like DOC-2
    expect(foldCode("DOC2")).toBe(foldCode("DOC-2"));
    expect(showFactsProblems(g)).toEqual(['fact M01: code "doc2" is also used by question H2']);
    const h = showFixture();
    h.facts[1]!.code = "HER-SECRET"; // an existing fact's recorded code vs a generated one
    expect(showFactsProblems(h)).toEqual(['fact C01: code "hersecret" is also used by fact M02']);
  });
  it("a fact is existing xor codex; a recorded code belongs on an existing fact", () => {
    const f = showFixture();
    f.facts[0]!.existing = "Old Entry";
    expect(showFactsProblems(f)).toEqual(["fact M01: existing and codex are exclusive"]);
    const g = showFixture();
    delete g.facts[0]!.codex;
    expect(showFactsProblems(g)).toEqual(["fact M01: needs existing or codex"]);
    const h = showFixture();
    h.facts[0]!.code = "FACT-ONE-TOO";
    expect(showFactsProblems(h)).toEqual(["fact M01: code belongs on an existing fact (a generated fact's code is codex.code)"]);
    const k = showFixture();
    k.facts[1]!.category = "ghost";
    expect(showFactsProblems(k)).toEqual(['fact M02: category "ghost" is not declared in categories']);
  });
  it("declares the four tiers in order, each smaller than the one before", () => {
    expect(showFactsProblems(showFixture())).toEqual([]);
    const f = showFixture();
    f.facts[0]!.tier = "rare";
    expect(showFactsProblems(f)).toEqual(["tiers: rare must hold fewer facts than common (2 ≥ 1)"]);
    const g = showFixture();
    const { legendary, ...rest } = g.tiers!;
    g.tiers = { legendary: legendary!, ...rest };
    expect(showFactsProblems(g)).toEqual(["tiers: must declare common, rare, very-rare, legendary, in that order (got legendary, common, rare, very-rare)"]);
    const h = showFixture();
    delete h.facts[2]!.tier;
    expect(showFactsProblems(h)).toEqual(["fact C01: tier null is not declared in tiers"]);
  });
  it("a character fact's codex needs an about", () => {
    const f = showFixture();
    delete f.facts[2]!.codex!.about;
    expect(showFactsProblems(f)).toEqual(["fact C01: a character fact's codex needs an about"]);
  });
  it(`wants at least ${SHOW_MIN_TRUTHS} truths`, () => {
    const f = showFixture();
    f.truths = f.truths.slice(0, SHOW_MIN_TRUTHS - 1);
    expect(showFactsProblems(f)).toEqual([`truths: need at least ${SHOW_MIN_TRUTHS} (got ${SHOW_MIN_TRUTHS - 1})`]);
  });
});

// ───────────────────────── the show's seed file ─────────────────────────

describe("Trapped in the Internet — facts.json (the seed)", () => {
  const text = readFileSync(join(scenarioDir(SHOW), FACTS_FILE), "utf8");
  const parsed = parseFactsText(text);
  const facts = parsed.facts!;
  const sim = Sim.fromSources(scenarioSource(SHOW));
  const m = sim.model;

  it("passes the generic rules", () => {
    expect(parsed.problems).toEqual([]);
    expect(facts).not.toBeNull();
  });
  it("the door code is in no entry an agent or a curious guest can read (a bio once said it as a year)", () => {
    const code = facts.door!.code;
    const open = [...m.codex.values()].filter((c) => !c.secret && `${c.title} ${c.text}`.includes(code)).map((c) => c.id);
    expect(open).toEqual([]);
  });
  it("passes the show's rules", () => {
    expect(showFactsProblems(facts)).toEqual([]);
  });
  it("carries the eight placeholder questions, every one a draft, with The Prom Ticket as F2", () => {
    expect(facts.questions.map((q) => q.id)).toEqual(["H1", "H2", "H3", "H4", "H5", "H6", "F1", "F2"]);
    expect(facts.questions.every((q) => q.draft === true)).toBe(true);
    expect(facts.questions.every((q) => q.where!.startsWith("The Desktop: "))).toBe(true);
    expect(facts.questions.find((q) => q.id === "F2")!.codex!.id).toBe("The Prom Ticket");
    expect(facts.questions.find((q) => q.id === "H4")!.text).toMatch(/^What extension/u);
    for (const q of facts.questions) expect(q.codex!.text).not.toContain("▒");
  });
  it("carries the P1 pickup line with its accept alias", () => {
    expect(facts.answers).toHaveLength(1);
    const p1 = facts.answers[0]!;
    expect(p1.id).toBe("P1");
    expect(p1.answer).toBe("You're the one that I want");
    expect(p1.accept).toEqual(["you are the one that i want"]);
    expect(foldAnswer("youre the one that i want")).toBe(foldAnswer(p1.answer));
  });
  it("carries the judge defaults", () => {
    expect(facts.judge).toEqual({ mode_var: "Night.judge_mode", confirm: { accurate: "fact_accurate", lie: "fact_lie", uncertain: "fact_uncertain" } });
  });
  it("carries 30 main + 6 trabolta + 24 character facts, three colour stacks and three round briefs", () => {
    const by = (c: string) => facts.facts.filter((f) => f.category === c);
    expect(by("main").map((f) => f.id)).toEqual(Array.from({ length: 30 }, (_, i) => `M${String(i + 1).padStart(2, "0")}`));
    expect(by("trabolta").map((f) => f.id)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6"]);
    expect(by("character").map((f) => f.id)).toEqual(Array.from({ length: 24 }, (_, i) => `C${String(i + 1).padStart(2, "0")}`));
    expect(Object.keys(facts.categories!)).toEqual(["main", "trabolta", "character"]);
    expect(Object.keys(facts.rounds!)).toEqual(["1", "2", "3"]);
    expect(facts.rounds!["1"]!.questTitle).toBe("The Truth Scavenger Hunt · Round 1");
    expect(facts.rounds!["3"]!.questTitle).toBe("The Final Fact-Finding Round");
  });
  it("carries the team's seventeen truths, the four originals first, none a draft", () => {
    expect(facts.truths).toHaveLength(17);
    expect(facts.truths.slice(0, 4).map((t) => t.text)).toEqual([
      "What is the name of the first person you kissed?",
      "What is something you’re afraid of?",
      "What is love?",
      "What colour are your underwear?",
    ]);
    expect(facts.truths.every((t) => t.draft === undefined)).toBe(true);
  });
  it("every existing fact names a codex entry in today's story, with its recorded code where it has one", () => {
    for (const f of facts.facts) {
      if (f.existing === undefined) continue;
      const entry = m.codex.get(f.existing);
      expect(entry, `${f.id} → ${f.existing}`).toBeDefined();
      if (f.code !== undefined && entry!.code !== null) expect(entry!.code, `${f.id} → ${f.existing}`).toBe(foldCode(f.code));
    }
  });
  it("the story pass added every hand-added code on the existing entries (none left to add)", () => {
    const toAdd = facts.facts.filter((f) => f.existing !== undefined && f.code !== undefined && m.codex.get(f.existing)!.code === null).map((f) => `${f.existing} → ${f.code}`);
    expect(toAdd).toEqual([]);
    for (const code of ["UNIFIED-FIELD", "TARGET-SELECTION", "TRUST-CHART", "SANDY-FILE", "ALL-FOR-HER"]) expect(m.codexCodes.has(foldCode(code)), code).toBe(true);
  });
  it("every generated fact's codex id and code is in the story (codex/9-facts.loom), once", () => {
    for (const f of facts.facts) {
      if (!f.codex) continue;
      expect(m.codex.has(f.codex.id), `${f.id}: id ${f.codex.id}`).toBe(true);
      expect(m.codexCodes.get(foldCode(f.codex.code)), `${f.id}: code ${f.codex.code}`).toBe(f.codex.id);
      expect(m.codex.get(f.codex.id)!.about, f.id).toBe(f.codex.about ?? null);
      expect(m.codex.get(f.codex.id)!.secret, f.id).toBe(f.codex.secret === true);
    }
  });
  it("every question's codex replaces an entry of today's story with the same id and code", () => {
    for (const q of facts.questions) {
      const entry = m.codex.get(q.codex!.id);
      expect(entry, q.id).toBeDefined();
      expect(entry!.code, q.id).toBe(foldCode(q.codex!.code));
    }
  });
  it("every character fact is about a declared CHARACTER, and the trabolta facts about him", () => {
    for (const f of facts.facts) {
      if (!f.codex?.about) continue;
      expect(m.characters.has(f.codex.about), `${f.id}: about ${f.codex.about}`).toBe(true);
      if (f.category === "trabolta") expect(f.codex.about).toBe("Trabolta");
      if (f.category === "character") expect(f.codex.about).not.toBe("Trabolta");
    }
    const abouts = facts.facts.filter((f) => f.category === "character").map((f) => f.codex!.about!);
    expect(new Set(abouts).size).toBe(12);
    for (const a of new Set(abouts)) expect(abouts.filter((x) => x === a)).toHaveLength(2);
  });
  it("the facts that name his nature, his heart or his shutdown are secret; the rest are not", () => {
    const secret = facts.facts.filter((f) => f.codex?.secret === true).map((f) => f.id);
    expect(secret).toEqual(["M01", "M10", "M11", "M12", "M14", "M22", "M28", "M30"]);
  });
  it("every character fact's third entry ends on why he chose them", () => {
    const thirds = facts.facts.filter((f) => f.category === "character").filter((_, i) => i % 2 === 1);
    expect(thirds).toHaveLength(12);
    for (const f of thirds) expect(f.codex!.text, f.id).toMatch(/Why Trabolta chose you: /u);
  });
});

describe("showFactsProblems — the server-room door (wave 7)", () => {
  const door = (over: Record<string, unknown> = {}) => ({ code: "1997", clue: "FOUR DIGITS. THE YEAR.", codex: { id: "The Door Code", title: "The Door Code", text: "The code is 1997." }, ...over });
  it("is optional, and a well-formed door passes", () => {
    expect(showFactsProblems(showFixture())).toEqual([]);
    expect(showFactsProblems({ ...showFixture(), door: door() } as FactsFile)).toEqual([]);
    expect(showFactsProblems({ ...showFixture(), door: door({ code: "0042", codex: { id: "D", title: "D", text: "0042" } }) } as FactsFile)).toEqual([]);
  });
  it("wants a 4–8 digit string code", () => {
    for (const code of ["97", "123456789", "19a7", 1997, ""]) {
      expect(showFactsProblems({ ...showFixture(), door: door({ code }) } as FactsFile), String(code)).toContain(`door.code must be a string of 4–8 digits (got ${JSON.stringify(code)})`);
    }
  });
  it("refuses a clue that gives the code away, a codex without the code, a missing or a taken codex id", () => {
    expect(showFactsProblems({ ...showFixture(), door: door({ clue: "It is 1997." }) } as FactsFile)).toEqual(["door.clue gives the code away"]);
    expect(showFactsProblems({ ...showFixture(), door: door({ codex: { id: "D", title: "D", text: "No digits here." } }) } as FactsFile)).toEqual(["door.codex.text must carry the code"]);
    expect(showFactsProblems({ ...showFixture(), door: door({ codex: undefined }) } as FactsFile)).toEqual(["door.codex is missing"]);
    expect(showFactsProblems({ ...showFixture(), door: door({ codex: { id: "Doc 1", title: "D", text: "1997" } }) } as FactsFile)).toEqual(['door: codex id "Doc 1" is also used by question H1']);
    expect(showFactsProblems({ ...showFixture(), door: door({ codex: { id: "", title: "D", text: "1997" } }) } as FactsFile)).toEqual(["door.codex.id is missing"]);
  });
  const clue = (i: number, over: Record<string, unknown> = {}) => ({
    id: `Digit ${["One", "Two", "Three", "Four"][i]}`,
    title: `Cold Door · the ${POSITION_WORDS[i]} digit`,
    code: `NOTE-${["ONE", "TWO", "THREE", "FOUR"][i]}`,
    where: "the kitchen",
    text: `The ${POSITION_WORDS[i]} digit is {digit}.`,
    ...over,
  });
  const clues = () => [0, 1, 2, 3].map((i) => clue(i));
  it("digit clues (wave 11): one per digit, each a well-formed note", () => {
    expect(showFactsProblems({ ...showFixture(), door: door({ clues: clues() }) } as FactsFile)).toEqual([]);
    expect(showFactsProblems({ ...showFixture(), door: door({ clues: clues().slice(0, 3) }) } as FactsFile)).toEqual(["door.clues: need one per digit of the code (4, got 3)"]);
    expect(showFactsProblems({ ...showFixture(), door: door({ clues: "1997" }) } as FactsFile)).toEqual(["door.clues must be an array"]);
  });
  it("digit clues: nothing printed or read aloud holds a digit; the text names its position and carries {digit} once", () => {
    const withClue = (i: number, over: Record<string, unknown>) => {
      const cs: unknown[] = clues();
      cs[i] = clue(i, over);
      return showFactsProblems({ ...showFixture(), door: door({ clues: cs }) } as FactsFile);
    };
    expect(withClue(0, { title: "Cold Door 1/4" })).toEqual(['door.clues[0].title must not contain a digit (write the position in words): "Cold Door 1/4"']);
    expect(withClue(1, { id: "Digit 2" })).toEqual(['door.clues[1].id must not contain a digit (write the position in words): "Digit 2"']);
    expect(withClue(2, { code: "NOTE-3" })).toEqual(['door.clues[2].code must not contain a digit (write the position in words): "NOTE-3"']);
    expect(withClue(3, { where: "bedroom 2" })).toEqual(['door.clues[3].where must not contain a digit (write the position in words): "bedroom 2"']);
    expect(withClue(0, { text: "The first digit is 1." })).toEqual(["door.clues[0].text must carry {digit} exactly once (got 0)", "door.clues[0].text must not contain a digit but its own {digit}"]);
    expect(withClue(0, { text: "The first digit is {digit}, then {digit}." })).toEqual(["door.clues[0].text must carry {digit} exactly once (got 2)"]);
    expect(withClue(0, { text: "The first digit is {digit}; the code has 4." })).toEqual(["door.clues[0].text must not contain a digit but its own {digit}"]);
    expect(withClue(1, { text: "The first digit is {digit}." })).toEqual(['door.clues[1].text must name its position ("second")']);
    expect(withClue(0, { text: 'The first digit is "{digit}".' })).toEqual(['door.clues[0].text must not contain " { } or | (but its {digit})']);
    expect(withClue(0, { where: "" })).toEqual(["door.clues[0].where is missing"]);
  });
  it("digit clues: codes and ids are nobody else's, and never each other's", () => {
    const withClue = (i: number, over: Record<string, unknown>) => {
      const cs: unknown[] = clues();
      cs[i] = clue(i, over);
      return showFactsProblems({ ...showFixture(), door: door({ clues: cs }) } as FactsFile);
    };
    const fx = showFixture();
    const taken = fx.facts[0]!.codex!;
    expect(withClue(0, { code: taken.code })).toEqual([`door.clues[0]: code ${JSON.stringify(taken.code)} is also used by fact M01`]);
    expect(withClue(1, { code: "note one" })).toEqual(['door.clues[1]: code "note one" must match ' + CODE.source, 'door.clues[1]: code "note one" is used twice']);
    expect(withClue(0, { id: taken.id })).toEqual([`door.clues[0]: codex id ${JSON.stringify(taken.id)} is also used by fact M01`]);
    expect(withClue(0, { id: "The Door Code" })).toEqual(['door.clues[0]: codex id "The Door Code" is used twice']);
    expect(withClue(1, { id: "Digit One" })).toEqual(['door.clues[1]: codex id "Digit One" is used twice']);
  });
  it("clueText fills the digit in", () => {
    expect(clueText(clue(2), "9")).toBe("The third digit is 9.");
  });
  it("the show's door: 4826 (a number with no story behind it, never a hunt answer), on its sign never", () => {
    const d = parseFactsText(readFileSync(join(scenarioDir(SHOW), FACTS_FILE), "utf8")).facts!.door!;
    expect(d.code).toBe("4826");
    // Wave 11: the sign points at the four notes and the King's terminal;
    // it no longer asks for the year.
    expect(d.clue).toBe("FOUR DIGITS. FOUR NOTES ARE HIDDEN IN THE HOUSE, ONE DIGIT ON EACH. OR BEAT THE KING AT THE TERMINAL BY THIS DOOR.");
    expect(d.clue).not.toMatch(/year|met her/iu);
    expect(d.clues).toHaveLength(4);
    d.clues!.forEach((c, i) => {
      expect(clueText(c, d.code[i]!), c.id).toContain(`${POSITION_WORDS[i]!.toUpperCase()} DIGIT IS ${d.code[i]}`);
      expect(c.where, c.id).not.toMatch(/server room/iu);
    });
    // Four different rooms (the LOCATION before the parenthesis).
    expect(new Set(d.clues!.map((c) => c.where.split(" (")[0])).size).toBe(4);
    const qs = parseFactsText(readFileSync(join(scenarioDir(SHOW), FACTS_FILE), "utf8")).facts!.questions;
    for (const q of qs) for (const a of [q.answer, ...q.accept]) expect(a, q.id).not.toContain(d.code);
  });
});
