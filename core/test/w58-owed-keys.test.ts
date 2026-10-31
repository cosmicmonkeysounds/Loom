//! Wave 58: the three hunt keys the script's questions are still owed. The
//! story, the generator and the screens run on stand-ins that no guest can
//! be judged by and no doc or screen shows. Reads the stand-ins from
//! facts.json, so it never spells one, and passes untouched once they go.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scenarioDir } from "../examples/load.ts";
import { FACTS_FILE, parseFactsText, placeholderQuestions, type Question } from "../src/facts.ts";
import { bookOf, isPlaceholderKey, screenResultsOf, type FactsFiling, type FactsView } from "../server/facts.ts";

const DIR = scenarioDir("trapped-in-the-internet");
const read = (f: string) => readFileSync(join(DIR, f), "utf8");
const SHOW = parseFactsText(read(FACTS_FILE)).facts!;
const OWED = placeholderQuestions(SHOW);

const filing = (over: Partial<FactsFiling>): FactsFiling => ({ person: "g1", name: "Ada", question: "Q1", answer: "x", confidence: 100, verdict: "accurate", final: "accurate", how: "auto", by: null, at: 0, ...over });
const FILE = {
  version: 1 as const,
  questions: [
    { id: "Q1", round: 1, text: "Owed?", answer: "PLACEHOLDER Q1", accept: [], placeholder: true },
    { id: "Q2", round: 1, text: "Known?", answer: "Known", accept: [] },
  ] as Question[],
  answers: [],
  facts: [],
  truths: [],
};
const view = (id: string): FactsView => ({
  modeVar: "Night.judge_mode",
  mode: "auto",
  confirm: null,
  pending: 0,
  questions: [{ id, round: 1, text: "t", filings: [filing({ question: id })], tally: { filed: 1, accurate: 1, lie: 0, uncertain: 0, consensus: true } }],
});

describe("a key still owed never reaches a screen", () => {
  const book = bookOf(FILE);
  it("the book knows which keys are stand-ins", () => {
    expect(isPlaceholderKey(book, "Q1")).toBe(true);
    expect(isPlaceholderKey(book, "Q2")).toBe(false);
    expect(isPlaceholderKey(book, "nope")).toBe(false);
  });
  it("neither the TV's verdict nor a consensus reading shows it; a real key still shows", () => {
    expect(screenResultsOf(view("Q1"), book, ["Q1"], { kind: "verdict", tv: true })[0]!.answer).toBeNull();
    expect(screenResultsOf(view("Q1"), book, ["Q1"], { kind: "read", tv: true })[0]!.answer).toBeNull();
    expect(screenResultsOf(view("Q2"), book, ["Q2"], { kind: "verdict", tv: true })[0]!.answer).toBe("Known");
    expect(screenResultsOf(view("Q2"), book, ["Q2"], { kind: "read", tv: true })[0]!.answer).toBe("Known");
  });
});

describe("the show's generated files", () => {
  const generated = ["generated/print-stacks.md", "DESIGN.md", "trabolta.mind.md", "SHOW.html", "README.md"];
  it.each(generated)("%s carries no stand-in", (f) => {
    const text = read(f);
    for (const q of OWED) expect(text, q.id).not.toContain(q.answer);
  });
  it("the reader says the spoken form; the card, the Quest Log and the slide keep the blanks", () => {
    const loom = read("generated/questions.loom");
    for (const q of SHOW.questions.filter((x) => x.spoken !== undefined && x.round === 1)) {
      expect(q.text, q.id).toContain("_");
      expect(q.spoken, q.id).not.toContain("_");
      expect(loom, q.id).toContain(`Trabolta: Question ${q.id === "H2" ? "two" : "three"}. ${q.spoken}`);
      expect(loom, q.id).not.toContain(`Trabolta: Question ${q.id === "H2" ? "two" : "three"}. ${q.text}`);
      expect(loom, q.id).toContain(`set Night.q_${q.id.toLowerCase()} = "${q.id}: Round 1 Q${q.id === "H2" ? 2 : 3}. ${q.text}"`);
      expect(loom, q.id).toContain(`- Q${q.id === "H2" ? 2 : 3}. ${q.text}`);
    }
    expect(SHOW.questions.find((q) => q.id === "H1")!.spoken).toBeUndefined();
  });
  it("the three old hunt documents are gone from the story", () => {
    const ids = SHOW.questions.map((q) => q.codex!.id);
    for (const old of ["The Billboard Lease", "The First Pet", "The Ribbon Cutting"]) {
      expect(ids).not.toContain(old);
      expect(read("generated/questions.loom")).not.toContain(old);
      expect(read("beats/server-room.loom")).not.toContain(old);
    }
  });
});

describe("the docs carry no digit note's code (wave 58)", () => {
  it("README and DESIGN name the notes by room and point at facts.json", () => {
    const codes = SHOW.door!.clues!.map((c) => c.code);
    expect(codes).toHaveLength(4);
    for (const doc of ["README.md", "DESIGN.md"]) {
      const text = read(doc);
      for (const [i, code] of codes.entries()) expect(text.includes(code), `${doc}: note ${i + 1}`).toBe(false);
    }
  });
});
