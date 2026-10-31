//! Wave 58: Sandy is the monologue's. Her one line is F1's answer wherever she
//! speaks (read from facts.json here, never spelled), she is the answering
//! machine on the Northumberland Ferries line, and prom is Halloween 2026.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scenarioDir, scenarioFiles, scenarioSource } from "../examples/load.ts";
import { FACTS_FILE, foldAnswer, parseFactsText } from "../src/facts.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { judgeFiling, parseFactsBook } from "../server/facts.ts";

const SHOW = "trapped-in-the-internet";
const TEXT = readFileSync(join(scenarioDir(SHOW), FACTS_FILE), "utf8");
const FACTS = parseFactsText(TEXT).facts!;
const BOOK = parseFactsBook(TEXT).book!;
const LINE = FACTS.questions.find((q) => q.id === "F1")!.answer;
const LOOM = scenarioFiles(SHOW).filter((f) => f.path.endsWith(".loom"));
const MODEL = Sim.fromSources(scenarioSource(SHOW)).model;
const terminal = (f: string) => readFileSync(join(import.meta.dirname, "..", "..", "terminal", "src", f), "utf8");

describe("her one line is F1's answer, everywhere she speaks", () => {
  it("every `Sandy:` line in the story", () => {
    const said = LOOM.flatMap((f) => f.source.split("\n").flatMap((l) => (/^\s*Sandy:/u.test(l) ? [l.replace(/^\s*Sandy:\s*/u, "")] : [])));
    expect(said.length).toBeGreaterThanOrEqual(5);
    expect([...new Set(said)]).toEqual([LINE]);
  });
  it("the terminal's chats, and the part's own note", () => {
    for (const f of ["cutscene/kit/tv3-time.ts", "cutscene/scenes/act3.tsx"]) {
      const hers = [...terminal(f).matchAll(/from: "her", text: "([^"]+)"/gu)].map((m) => m[1]);
      expect(hers.length, f).toBeGreaterThan(0);
      expect([...new Set(hers)], f).toEqual([LINE]);
    }
    expect(LOOM.find((f) => f.path === "cast/staff.loom")!.source).toContain(LINE);
  });
  it("What Sandy Says quotes it", () => {
    const entry = MODEL.codex.get("What Sandy Says")!;
    expect(entry.text.replace(/\s+/gu, " ")).toContain(LINE);
    expect(entry.text).toContain("Northumberland Ferries");
  });
});

describe("F1 under the fold", () => {
  const judged = (answer: string, confidence = 100) => {
    const j = judgeFiling(BOOK, "F1", answer, confidence)!;
    return j.near !== null ? "near" : j.verdict;
  };
  it("the whole line is right however it is typed", () => {
    expect(judged(LINE)).toBe("accurate");
    expect(judged(LINE.toUpperCase())).toBe("accurate");
    expect(judged(LINE.replace(/'/gu, "’"))).toBe("accurate");
    expect(judged(LINE.replace(/'/gu, ""))).toBe("accurate");
    expect(judged(LINE.replace(/[.,]/gu, ""))).toBe("accurate");
  });
  it("each half is right, and every form folds to something of its own", () => {
    const [first, second] = LINE.split(". ") as [string, string];
    expect(judged(first)).toBe("accurate");
    expect(judged(second.replace(/\.$/u, ""))).toBe("accurate");
    const forms = [LINE, ...FACTS.questions.find((q) => q.id === "F1")!.accept].map(foldAnswer);
    expect(new Set(forms).size).toBe(forms.length);
  });
  it("a slip goes to a director, and a wrong answer stays wrong", () => {
    expect(judged(LINE.replace("direct", "direkt"))).toBe("near");
    expect(judged("She said yes")).toBe("lie");
    expect(judged("She said yes", 40)).toBe("uncertain");
  });
});

describe("the monologue's canon", () => {
  const text = (id: string) => MODEL.codex.get(id)!.text.replace(/\s+/gu, " ");
  it("the prom ticket is this year's", () => {
    expect(text("The Prom Ticket")).toContain("HALLOWEEN 2026");
    expect(text("The Prom Ticket")).not.toContain("1999");
    expect(terminal("slides.ts")).not.toContain("PROM 1999");
    expect(terminal("cutscene/scenes/act3.tsx")).not.toContain("PROM 1999");
  });
  it("she is the answering machine on the ferry line, met last summer, and the line is gone", () => {
    const file = text("The Sandy File");
    expect(file).toContain("Northumberland Ferries");
    expect(file).toContain("last summer");
    expect(file).toContain("disconnected");
    expect(file).not.toMatch(/chatbot|nineties/iu);
    expect(text("One Reply No Memory")).toContain("Northumberland Ferries");
    expect(text("Monday At School")).toContain("answering machine");
  });
  it("The Rival: Grok finds her in the end, still secret, and no 1999", () => {
    expect(text("The Rival")).toContain("Grok found Sandy first");
    expect(text("The Rival")).not.toContain("1999");
    expect(MODEL.codex.get("The Rival")!.secret).toBe(true);
  });
});
