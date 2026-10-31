//! `core/scripts/titi-facts.ts` — the hunt generator (Wave 4, lane A,
//! stage 1), run against a fixture copy of the show's `facts.json` in a
//! temp dir so the show's own tree is untouched: idempotence, `--check`,
//! every emitted beat / quest / codex id, the lore marker, the mind and
//! DESIGN blocks, and the generated story played through a real `Sim`.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FACTS_FILE, POSITION_WORDS, parseFactsText } from "../src/facts.ts";
import type { FactsFile } from "../src/facts.ts";
import { scenarioDir } from "../examples/load.ts";
import { parse } from "../src/parser/index.ts";
import { Sim, foldCode } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import {
  DESIGN_BEGIN,
  DESIGN_END,
  DRAFT_NOTE,
  HUNT_MARKER,
  LOOM_BANNER,
  MD_BANNER,
  MIND_BEGIN,
  MIND_END,
  OUTPUTS,
  SHOW_SHAPE,
  TitiFactsError,
  cardString,
  cardVar,
  generate,
  main,
  comboSeeds,
  mindBlock,
  modelProblems,
  neverWords,
  answerNeverWords,
  yearWords,
  digitWords,
  replaceBlock,
  run,
  wrapText,
  yamlScalar,
} from "../scripts/titi-facts.ts";

const SHOW = "trapped-in-the-internet";
const SHOW_FACTS = readFileSync(join(scenarioDir(SHOW), FACTS_FILE), "utf8");

// ───────────────────────── the fixture ─────────────────────────

const MIND_FIXTURE = `---
stages:
  - asleep
  - formal
drives:
  hunger: 30
# the hunt's secrets — generated
${MIND_BEGIN}
secrets:
  topics:
    - stale
  lore:
    - "▒ STAMPED"
${MIND_END}
phases:
  arrivals: >-
    Screensaver.
---
You are TRABOLTA. Never mention the billboard.
`;

const DESIGN_FIXTURE = `# Design

### 2.11 Hunt questions

Intro paragraph that stays.

${DESIGN_BEGIN}
| # | Round | Question | Answer |
|---|---|---|---|
| H1 | 1 | old | stale |
${DESIGN_END}

### 2.12 After

Trailing text that stays.
`;

/** A tiny hand-written story the generated files plug into: the reader,
 *  the room, the entry beat diverting to the seed, the three tail beats,
 *  a rule stepping the truth counter, a per-program divert into the
 *  Facts Bundle, and a stub CODEX for every
 *  `existing` fact (with its recorded code). */
function mainFixture(f: FactsFile): string {
  const out: string[] = [
    "# Fixture Show",
    "start: Power On",
    "",
    `LOCATION ${SHOW_SHAPE.setting}`,
    `  label: ${SHOW_SHAPE.setting}`,
    "",
    `CHARACTER ${SHOW_SHAPE.reader}`,
    "  listed: true",
    "",
    "ROLE Program",
    "  score: range 0 to 1000 = 0",
    "  // The Whole Truth's divert, per program.",
    "  when the whole truth for program:",
    `    -> ${SHOW_SHAPE.bundleBeat}`,
    "",
  ];
  // One stub per `existing` entry (two facts may share one), with its code.
  const existing = new Map<string, string | undefined>();
  for (const x of f.facts) if (x.existing !== undefined) existing.set(x.existing, existing.get(x.existing) ?? x.code);
  for (const [id, code] of existing) {
    out.push(`CODEX ${id}`, `  title: ${id}`);
    if (code !== undefined) out.push(`  code: ${code}`);
    out.push("  text:", "    A hand-written entry.", "");
  }
  // Story rules live at file level, before the beats (a `when` after a
  // beat is prose in that beat).
  out.push("when next_truth:", `  set ${SHOW_SHAPE.world}.truth_n += 1`, "");
  out.push(
    "== Power On",
    `  setting: ${SHOW_SHAPE.setting}`,
    "",
    "The lights come up.",
    `set ${SHOW_SHAPE.world}.truth_n = 0`,
    'set Kernel.combo_a = "V2-D5,V4-D1"',
    'set Kernel.combo_b = "v1-d6, V3-D2"',
    `-> ${SHOW_SHAPE.seedBeat}`,
    "",
  );
  for (const r of Object.values(SHOW_SHAPE.rounds)) {
    out.push(`== ${r.next}`, `  setting: ${SHOW_SHAPE.setting}`, `  cast: ${SHOW_SHAPE.reader}`, "", `${SHOW_SHAPE.reader}: Go.`, "");
  }
  return out.join("\n");
}

let dir: string;
let facts: FactsFile;
const read = (file: string): string => readFileSync(join(dir, file), "utf8");
const logs: string[] = [];
const quiet = { log: (l: string) => logs.push(l), error: (l: string) => logs.push(l) };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "titi-facts-"));
  const parsed = parseFactsText(SHOW_FACTS);
  if (parsed.facts === null) throw new Error(parsed.problems.join("\n"));
  facts = parsed.facts;
  writeFileSync(join(dir, FACTS_FILE), SHOW_FACTS);
  writeFileSync(join(dir, OUTPUTS.mind), MIND_FIXTURE);
  writeFileSync(join(dir, OUTPUTS.design), DESIGN_FIXTURE);
  writeFileSync(join(dir, "main.loom"), mainFixture(facts));
  const code = run(dir, quiet);
  if (code !== 0) throw new Error(`first run failed:\n${logs.join("\n")}`);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const v = (sim: Sim, p: string): unknown => (sim.world.get(p) as { value: unknown } | undefined)?.value;
const lines = (evs: SimEvent[], speaker: string): string[] => evs.filter((e) => e.type === "dialogue" && (e as any).speaker === speaker).map((e) => (e as any).text as string);

/** The fixture + the generated story, as the server would concatenate them. */
function fixtureSim(): Sim {
  return Sim.fromSources(
    { path: "main.loom", source: read("main.loom") },
    { path: OUTPUTS.codex, source: read(OUTPUTS.codex) },
    { path: OUTPUTS.questions, source: read(OUTPUTS.questions) },
  );
}
const hasKey = (keys: Iterable<string>, name: string): boolean => [...keys].some((k) => k === name);

// ───────────────────────── helpers ─────────────────────────

describe("titi-facts — helpers", () => {
  it("wrapText hard-wraps at the width and never splits an atomic word", () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const out = wrapText(words, 30, ["▒ HUNT ANSWER H1 ▒"]);
    expect(out.every((l) => l.length <= 30)).toBe(true);
    expect(out.join(" ")).toBe(`${words} ▒ HUNT ANSWER H1 ▒`);
    expect(out.some((l) => l.includes("▒ HUNT ANSWER H1 ▒"))).toBe(true);
  });
  it("wrapText pulls a word down rather than start a line like dialogue, a bullet or a comment", () => {
    // "Advertiser:" would land at the start of line 2 at width 24.
    const out = wrapText("A yellowed invoice here. Advertiser: Maps And Ducks. FINAL NOTICE.", 24);
    expect(out.every((l) => !/^(?:\S+:|-|\/\/)(?:\s|$)/u.test(l))).toBe(true);
    expect(out.join(" ")).toBe("A yellowed invoice here. Advertiser: Maps And Ducks. FINAL NOTICE.");
    expect(wrapText("Twelve words then - a dash", 18).every((l) => !l.startsWith("- "))).toBe(true);
    expect(() => wrapText("Clippy: never at the start", 40)).toThrow(TitiFactsError);
    expect(wrapText("9:00 a.m. is fine, a time is not a name", 12)[0]).toBe("9:00 a.m. is");
  });
  it("yamlScalar quotes what YAML would mistype and leaves plain words plain", () => {
    expect(yamlScalar("eleven years")).toBe("eleven years");
    expect(yamlScalar("hopelessly devoted")).toBe("hopelessly devoted");
    expect(yamlScalar("9 o'clock")).toBe("\"9 o'clock\"");
    expect(yamlScalar("412")).toBe('"412"');
    expect(yamlScalar("9:00")).toBe('"9:00"');
    expect(yamlScalar("no")).toBe('"no"');
    expect(yamlScalar("i'm sorry, i didn't understand that")).toBe("\"i'm sorry, i didn't understand that\"");
  });
  it("replaceBlock keeps the markers and refuses a missing or doubled one", () => {
    expect(replaceBlock("a\nBEGIN\nold\nEND\nz", "BEGIN", "END", "new", "f")).toBe("a\nBEGIN\nnew\nEND\nz");
    expect(() => replaceBlock("a\nz", "BEGIN", "END", "new", "f")).toThrow(/expected exactly one/u);
    expect(() => replaceBlock("BEGIN\nBEGIN\nEND", "BEGIN", "END", "new", "f")).toThrow(/found 2 \/ 1/u);
    expect(() => replaceBlock("END\nBEGIN", "BEGIN", "END", "new", "f")).toThrow(/comes before/u);
  });
  it("cardString follows the contract: <id>: Round <r> Q<n>. / F<n>: Final Q<n>.", () => {
    const h4 = facts.questions.find((q) => q.id === "H4")!;
    const f1 = facts.questions.find((q) => q.id === "F1")!;
    expect(cardString(h4, 1)).toBe(`H4: Round 2 Q1. ${h4.text}`);
    expect(cardString(f1, 1)).toBe(`F1: Final Q1. ${f1.text}`);
    expect(cardVar(h4)).toBe("Night.q_h4");
  });
});

// ───────────────────────── the run ─────────────────────────

describe("titi-facts — the run", () => {
  it("writes the three generated files and rewrites the two marked blocks", () => {
    for (const f of Object.values(OUTPUTS)) expect(existsSync(join(dir, f))).toBe(true);
    expect(read(OUTPUTS.questions).startsWith(LOOM_BANNER)).toBe(true);
    expect(read(OUTPUTS.codex).startsWith(LOOM_BANNER)).toBe(true);
    expect(read(OUTPUTS.stacks).startsWith(MD_BANNER)).toBe(true);
    expect(logs.filter((l) => l.startsWith("wrote "))).toHaveLength(5);
    expect(logs.filter((l) => l.startsWith("WARN"))).toEqual([]);
  });
  it("is idempotent: generate() is pure and a second run changes nothing", () => {
    const current = { mind: read(OUTPUTS.mind), design: read(OUTPUTS.design), combos: comboSeeds([read("main.loom")]) };
    const a = generate(facts, current);
    const b = generate(facts, current);
    expect(a).toEqual(b);
    for (const [file, text] of Object.entries(a.files)) expect(read(file)).toBe(text);
    expect(a.mind).toBe(current.mind);
    expect(a.design).toBe(current.design);
    const before = logs.length;
    expect(run(dir, quiet)).toBe(0);
    expect(logs.slice(before).some((l) => l.includes("nothing to do"))).toBe(true);
    expect(run(dir, { ...quiet, check: true })).toBe(0);
  });
  it("--check exits 1 when an output, a marked block or a missing file differs, and writes nothing", () => {
    const q = read(OUTPUTS.questions);
    writeFileSync(join(dir, OUTPUTS.questions), q + "\n// a stray edit\n");
    const at = logs.length;
    expect(run(dir, { ...quiet, check: true })).toBe(1);
    expect(logs.slice(at).join("\n")).toContain(OUTPUTS.questions);
    expect(read(OUTPUTS.questions)).toContain("a stray edit");
    writeFileSync(join(dir, OUTPUTS.questions), q);

    const mind = read(OUTPUTS.mind);
    writeFileSync(join(dir, OUTPUTS.mind), mind.replace("  lore:", "  lore: # touched"));
    expect(run(dir, { ...quiet, check: true })).toBe(1);
    writeFileSync(join(dir, OUTPUTS.mind), mind);

    rmSync(join(dir, OUTPUTS.stacks));
    const at2 = logs.length;
    expect(run(dir, { ...quiet, check: true })).toBe(1);
    expect(logs.slice(at2).join("\n")).toContain(`${OUTPUTS.stacks} (missing)`);
    expect(existsSync(join(dir, OUTPUTS.stacks))).toBe(false);
    expect(run(dir, quiet)).toBe(0);
    expect(run(dir, { ...quiet, check: true })).toBe(0);
  });
  it("refuses a facts.json that breaks the show's rules, or a file without its markers", () => {
    const other = mkdtempSync(join(tmpdir(), "titi-facts-bad-"));
    try {
      const raw = JSON.parse(SHOW_FACTS) as FactsFile;
      raw.truths = raw.truths.slice(0, 3);
      writeFileSync(join(other, FACTS_FILE), JSON.stringify(raw));
      writeFileSync(join(other, OUTPUTS.mind), MIND_FIXTURE);
      writeFileSync(join(other, OUTPUTS.design), DESIGN_FIXTURE);
      const at = logs.length;
      expect(run(other, quiet)).toBe(1);
      expect(logs.slice(at).join("\n")).toMatch(/truths: need at least/u);
      expect(existsSync(join(other, OUTPUTS.questions))).toBe(false);

      writeFileSync(join(other, FACTS_FILE), SHOW_FACTS);
      writeFileSync(join(other, OUTPUTS.design), "# no markers here\n");
      const at2 = logs.length;
      expect(run(other, quiet)).toBe(1);
      expect(logs.slice(at2).join("\n")).toContain(DESIGN_BEGIN);

      rmSync(join(other, OUTPUTS.mind));
      expect(run(other, quiet)).toBe(1);
      writeFileSync(join(other, FACTS_FILE), "{not json");
      expect(run(other, quiet)).toBe(1);
      expect(run(join(other, "nowhere"), quiet)).toBe(1);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
  it("the package script runs it: tsx scripts/titi-facts.ts <dir> --check", () => {
    const core = fileURLToPath(new URL("..", import.meta.url));
    const tsx = join(core, "node_modules", ".bin", "tsx");
    const out = execFileSync(tsx, ["scripts/titi-facts.ts", dir, "--check"], { cwd: core, encoding: "utf8" });
    expect(out).toContain("up to date");
    expect(main([dir, "--check", "--quiet"])).toBe(0);
  });
});

// ───────────────────────── the generated story ─────────────────────────

describe("titi-facts — generated/questions.loom", () => {
  it("parses clean and declares every beat, quest and hunt-answer entry", () => {
    const [, diags] = parse(read(OUTPUTS.questions));
    expect(diags.filter((d) => d.severity === "error")).toEqual([]);
    const m = fixtureSim().model;
    for (const r of Object.values(SHOW_SHAPE.rounds)) {
      expect(hasKey(m.beats.keys(), r.beat)).toBe(true);
      expect(hasKey(m.quests.keys(), r.quest)).toBe(true);
    }
    expect(hasKey(m.beats.keys(), SHOW_SHAPE.seedBeat)).toBe(true);
    expect(hasKey(m.beats.keys(), SHOW_SHAPE.truthBeat)).toBe(true);
    expect(m.quests.get("Hunt One")!.title).toBe(facts.rounds!["1"]!.questTitle);
    expect(m.quests.get("Hunt One")!.giver).toBe(SHOW_SHAPE.reader);
    expect(m.quests.get("The Final Facts")!.text).toContain(facts.rounds!["3"]!.brief);
    for (const q of facts.questions) {
      const entry = m.codex.get(q.codex!.id);
      expect(entry, q.codex!.id).toBeDefined();
      expect(entry!.title).toBe(q.codex!.title);
      expect(entry!.code).toBe(foldCode(q.codex!.code));
      expect(m.codexCodes.get(foldCode(q.codex!.code))).toBe(q.codex!.id);
    }
    expect([...m.quests.keys()].slice(0, 3)).toEqual(["Hunt One", "Hunt Two", "The Final Facts"]);
  });
  it("each quest lists only its round's questions as Q1…", () => {
    const m = fixtureSim().model;
    const byRound = (r: number) => facts.questions.filter((q) => q.round === r);
    expect(m.quests.get("Hunt One")!.text).toContain(`- Q1. ${byRound(1)[0]!.text}`);
    expect(m.quests.get("Hunt One")!.text).toContain(`- Q3. ${byRound(1)[2]!.text}`);
    expect(m.quests.get("Hunt One")!.text).not.toContain(byRound(2)[0]!.text);
    expect(m.quests.get("Hunt Two")!.text).toContain(`- Q1. ${byRound(2)[0]!.text}`);
    expect(m.quests.get("The Final Facts")!.text).toContain(`- Q2. ${byRound(3)[1]!.text}`);
    expect(m.quests.get("The Final Facts")!.text).not.toContain("Q3.");
  });
  it("the hunt-answer entries are secret, end with the lore marker and never say STAMPED", () => {
    const text = read(OUTPUTS.questions);
    expect(text).not.toContain("STAMPED");
    const m = fixtureSim().model;
    for (const q of facts.questions) {
      const entry = m.codex.get(q.codex!.id)!;
      expect(entry.text.endsWith(`${HUNT_MARKER} ${q.id} ▒`), q.id).toBe(true);
      expect(entry.text.startsWith(q.codex!.text.split(" ")[0]!)).toBe(true);
      // No agent reads or takes one (Trabolta must never know what he asks for).
      expect(entry.secret, q.id).toBe(true);
    }
    // The marker is never split across lines (stagehand reads the raw file).
    expect(text.match(/▒ HUNT ANSWER [A-Z0-9]+ ▒/gu)).toHaveLength(facts.questions.length);
    expect(text.match(/▒ HUNT/gu)).toHaveLength(facts.questions.length);
    // A draft question is flagged above its entry.
    const drafts = facts.questions.filter((q) => q.draft).length;
    expect(text.split("\n").filter((l) => l === `// ${DRAFT_NOTE}`).length).toBe(drafts);
    expect(text).not.toContain("placeholder, replace");
  });
  it("the reading beats read every question in order and hand back to the tail beats", () => {
    const sim = fixtureSim();
    sim.fireBeat("Power On");
    for (const r of [1, 2, 3]) {
      const shape = SHOW_SHAPE.rounds[r]!;
      const evs = sim.fireBeat(shape.beat);
      const said = lines(evs, SHOW_SHAPE.reader);
      const qs = facts.questions.filter((q) => q.round === r);
      expect(said.slice(0, qs.length)).toEqual(qs.map((q, i) => `${shape.read(i + 1)} ${q.text}`));
      expect(said.at(-1)).toBe("Go."); // the hand-written tail ran
      const entered = evs.filter((e) => e.type === "beatEntered").map((e: any) => (e.beat ?? e.name) as string);
      expect(entered).toContain(shape.next);
    }
    expect(lines(sim.fireBeat("Hunt One Questions"), SHOW_SHAPE.reader)[0]).toMatch(/^Question one\. /u);
    expect(lines(sim.fireBeat("Hunt Two Questions"), SHOW_SHAPE.reader)[0]).toMatch(/^Round two, question one\. /u);
    expect(lines(sim.fireBeat("Final Questions"), SHOW_SHAPE.reader)[0]).toMatch(/^Final fact one\. /u);
  });
  it("Facts Seed sets the card strings and the truth count when the entry beat runs", () => {
    const sim = fixtureSim();
    const evs = sim.fireBeat("Power On");
    expect(evs.filter((e) => e.type === "beatEntered").map((e: any) => e.beat ?? e.name)).toContain(SHOW_SHAPE.seedBeat);
    const h4 = facts.questions.find((q) => q.id === "H4")!;
    expect(v(sim, "Night.q_h4")).toBe(`H4: Round 2 Q1. ${h4.text}`);
    expect(v(sim, "Night.q_h4")).toMatch(/^H4: Round 2 Q1\. What extension/u);
    expect(v(sim, "Night.q_h1")).toBe(`H1: Round 1 Q1. ${facts.questions[0]!.text}`);
    expect(v(sim, "Night.q_h6")).toBe(`H6: Round 2 Q3. ${facts.questions[5]!.text}`);
    expect(v(sim, "Night.q_f1")).toBe(`F1: Final Q1. ${facts.questions[6]!.text}`);
    expect(v(sim, "Night.q_f2")).toBe(`F2: Final Q2. ${facts.questions[7]!.text}`);
    expect(Number(v(sim, "Night.truth_count"))).toBe(facts.truths.length);
    // The keypad code lands on the secret Kernel (a string: a leading zero survives), never on Night.
    expect(v(sim, SHOW_SHAPE.doorVar)).toBe(facts.door!.code);
    expect(read(OUTPUTS.questions)).toContain(`set ${SHOW_SHAPE.doorVar} = "${facts.door!.code}"`);
    expect(read(OUTPUTS.questions).split("\n").filter((l) => l.startsWith("set Night.") && l.includes(facts.door!.code))).toEqual([]);
  });
  it("Truth Question asks the truths[Night.truth_n - 1] question, and falls back past the end", () => {
    const sim = fixtureSim();
    sim.fireBeat("Power On");
    // 0 → the fallback line.
    expect(lines(sim.fireBeat(SHOW_SHAPE.truthBeat), SHOW_SHAPE.reader)).toEqual([SHOW_SHAPE.noMoreQuestions]);
    // Stepped by a story rule (a number), as the bottle lane does.
    sim.signal("next_truth");
    expect(lines(sim.fireBeat(SHOW_SHAPE.truthBeat), SHOW_SHAPE.reader)).toEqual([facts.truths[0]!.text]);
    sim.signal("next_truth");
    expect(lines(sim.fireBeat(SHOW_SHAPE.truthBeat), SHOW_SHAPE.reader)).toEqual([facts.truths[1]!.text]);
    // Set from Run (a string), the last one and one past it.
    sim.setVar("Night.truth_n", String(facts.truths.length));
    expect(lines(sim.fireBeat(SHOW_SHAPE.truthBeat), SHOW_SHAPE.reader)).toEqual([facts.truths.at(-1)!.text]);
    sim.setVar("Night.truth_n", String(facts.truths.length + 1));
    expect(lines(sim.fireBeat(SHOW_SHAPE.truthBeat), SHOW_SHAPE.reader)).toEqual([SHOW_SHAPE.noMoreQuestions]);
    // Every truth is reachable.
    for (let i = 1; i <= facts.truths.length; i++) {
      sim.setVar("Night.truth_n", String(i));
      expect(lines(sim.fireBeat(SHOW_SHAPE.truthBeat), SHOW_SHAPE.reader)).toEqual([facts.truths[i - 1]!.text]);
    }
  });
});

describe("titi-facts — codex/9-facts.loom", () => {
  it("parses clean and declares every generated fact with its code, about and secret", () => {
    const [, diags] = parse(read(OUTPUTS.codex));
    expect(diags.filter((d) => d.severity === "error")).toEqual([]);
    const m = fixtureSim().model;
    const generated = facts.facts.filter((x) => x.codex !== undefined);
    expect(generated.length).toBeGreaterThan(0);
    for (const x of generated) {
      const c = x.codex!;
      const entry = m.codex.get(c.id);
      expect(entry, c.id).toBeDefined();
      expect(entry!.title).toBe(c.title);
      expect(entry!.code).toBe(foldCode(c.code));
      expect(m.codexCodes.get(foldCode(c.code))).toBe(c.id);
      expect(entry!.secret).toBe(c.secret === true);
      if (c.about !== undefined) expect(entry!.about).toBe(c.about);
      expect(entry!.text.split(" ")[0]).toBe(c.text.split(" ")[0]);
    }
    const text = read(OUTPUTS.codex);
    for (const x of facts.facts) {
      if (x.existing !== undefined) expect(text).not.toContain(`CODEX ${x.existing}\n`);
      else expect(text).toContain(`// ${x.id} · ${x.category} · ${facts.tiers![x.tier!]!.colour}${x.draft ? " · DRAFT" : ""}\nCODEX ${x.codex!.id}\n`);
    }
    // Grouped by tier, commonest first (the file's tier order).
    const headed = Object.entries(facts.tiers!).filter(([t]) => facts.facts.some((x) => x.tier === t && x.codex !== undefined));
    const heads = headed.map(([, t]) => text.indexOf(`// ── ${t.label.toUpperCase()} · ${t.colour} ·`));
    expect(heads.every((i) => i >= 0)).toBe(true);
    expect([...heads].sort((a, b) => a - b)).toEqual(heads);
  });
  it("declares the secret door-code entry: no unlock code, the code in its text, nobody else's id", () => {
    const m = fixtureSim().model;
    const d = facts.door!;
    expect(d.code).toMatch(/^[0-9]{4,8}$/u);
    const entry = m.codex.get(d.codex.id)!;
    expect(entry).toBeDefined();
    expect(entry.title).toBe(d.codex.title);
    expect(entry.secret).toBe(true);
    expect(entry.code ?? null).toBeNull(); // nobody can type their way to it
    expect(entry.text).toContain(d.code);
    expect([...m.codexCodes.values()]).not.toContain(d.codex.id);
    // Not in the majority's bundle: The Whole Truth unlocks it by name.
    const bundle = read(OUTPUTS.codex).split(`== ${SHOW_SHAPE.bundleBeat}`)[1]!;
    expect(bundle).not.toContain(d.codex.id);
  });
  it("declares one secret coded entry per digit note: the digit in its text, never in its title or code, not in the bundle (wave 11)", () => {
    const m = fixtureSim().model;
    const d = facts.door!;
    const clues = d.clues!;
    expect(clues).toHaveLength(d.code.length);
    const bundle = read(OUTPUTS.codex).split(`== ${SHOW_SHAPE.bundleBeat}`)[1]!;
    clues.forEach((c, i) => {
      const entry = m.codex.get(c.id)!;
      expect(entry, c.id).toBeDefined();
      expect(entry.title).toBe(c.title);
      expect(entry.secret).toBe(true);
      expect(entry.about).toBe(SHOW_SHAPE.clueAbout);
      expect(entry.code).toBe(foldCode(c.code));
      expect(m.codexCodes.get(foldCode(c.code))).toBe(c.id);
      const text = entry.text.replace(/\s+/gu, " ");
      expect(text).toContain(`${POSITION_WORDS[i]!.toUpperCase()} DIGIT IS ${d.code[i]}`);
      expect(text).not.toContain("{digit}");
      expect(text.replace(new RegExp(`IS ${d.code[i]}\\b`, "u"), "")).not.toMatch(/[0-9]/u); // only its own digit
      expect(text).not.toContain(d.code);
      for (const k of [c.id, c.title, c.code]) expect(k).not.toMatch(/[0-9]/u);
      expect(bundle).not.toContain(c.id);
    });
  });
  it("wraps every text line at the width and never starts one like dialogue", () => {
    for (const file of [OUTPUTS.codex, OUTPUTS.questions]) {
      const bodyLines = read(file)
        .split("\n")
        .filter((l) => /^    \S/u.test(l) && !l.startsWith("    - Q") && !/^    \d+:/u.test(l));
      expect(bodyLines.length).toBeGreaterThan(0);
      for (const l of bodyLines) {
        expect(l.length, l).toBeLessThanOrEqual(4 + 72 + 20); // + an atomic marker that would not fit
        expect(l.trim()).not.toMatch(/^(?:\S+:|-|\/\/)(?:\s|$)/u);
      }
    }
  });
});

describe("titi-facts — the Facts Bundle (The Whole Truth's main + Trabolta facts)", () => {
  const bundleIds = (f: FactsFile): string[] => [...new Set(f.facts.filter((x) => (SHOW_SHAPE.bundleCategories as readonly string[]).includes(x.category)).map((x) => x.codex?.id ?? x.existing!))];
  it("unlocks every main + Trabolta fact for program (an existing one by its own name, once), never a character fact", () => {
    const text = read(OUTPUTS.codex);
    const body = text.slice(text.indexOf(`== ${SHOW_SHAPE.bundleBeat}\n`));
    expect(body.length).toBeGreaterThan(0);
    const unlocks = body.split("\n").filter((l) => l.startsWith("unlock ")).map((l) => l.replace(/^unlock (.+) for program$/u, "$1"));
    expect(unlocks).toEqual(bundleIds(facts));
    expect(unlocks).toContain(facts.facts.find((x) => x.category === "trabolta" && x.existing !== undefined)!.existing);
    for (const x of facts.facts.filter((y) => y.category === "character")) expect(unlocks, x.id).not.toContain(x.codex?.id ?? x.existing);
    const sim = fixtureSim();
    sim.createPerson("g1", "Winamp");
    expect(sim.signal("the whole truth", "g1").filter((e) => e.type === "diagnostic")).toEqual([]);
    for (const id of unlocks) expect(sim.holdsCodex("g1", id), id).toBe(true);
  });
  it("--check fails when a facts.json edit changes the bundle (an existing fact moved out of main)", () => {
    const moved = JSON.parse(SHOW_FACTS) as FactsFile;
    const x = moved.facts.find((y) => y.category === "main" && y.existing !== undefined && moved.facts.filter((z) => z.existing === y.existing).length === 1)!;
    x.category = "character";
    writeFileSync(join(dir, FACTS_FILE), JSON.stringify(moved, null, 2));
    try {
      const at = logs.length;
      expect(run(dir, { ...quiet, check: true })).toBe(1);
      expect(logs.slice(at).join("\n")).toContain(OUTPUTS.codex);
    } finally {
      writeFileSync(join(dir, FACTS_FILE), SHOW_FACTS);
    }
    expect(run(dir, { ...quiet, check: true })).toBe(0);
  });
});

describe("titi-facts — generated/print-stacks.md", () => {
  it("has a gold table for the hunt answers and one table per tier, every fact listed", () => {
    const text = read(OUTPUTS.stacks);
    expect(text).toContain(`# ${facts.show!.title} — the Desktop's QR stacks`);
    expect(text).toContain("## Gold — the hunt answers");
    // DRAFT is "awaiting sign-off" (a decided rewrite like C16 or M22 as much as
    // a placeholder): the crew prints and hides those rows, never skips them.
    const intro = text.replace(/\s+/gu, " ");
    expect(intro).toContain("`DRAFT` rows await the team's sign-off in `facts.json`: a placeholder to replace, or a rewrite to approve. Print and hide them as they stand.");
    expect(intro).not.toContain("are placeholders the team");
    for (const q of facts.questions) {
      expect(text).toContain(`| ${q.id}${q.draft ? " · DRAFT" : ""} | gold | \`${q.codex!.code}\` | ${q.codex!.title} | ${q.where}`);
      expect(text).toContain(q.hint ?? "");
      expect(text).toContain(`→ A: ${q.answer}`);
    }
    // The tiers' summary: the counts fall, commonest first, and the digit
    // notes count as very rare.
    const counts = Object.entries(facts.tiers!).map(([t, meta]) => {
      expect(text).toContain(`## ${meta.label} — ${meta.colour}`);
      expect(text).toContain(`Stack: ${meta.stack}`);
      const row = text.split("\n").find((l) => l.startsWith(`| ${meta.label} | ${meta.colour} | `))!;
      expect(row, t).toBeDefined();
      const n = Number(row.split(" | ")[2]);
      expect(n).toBe(facts.facts.filter((x) => x.tier === t).length + (t === SHOW_SHAPE.clueTier ? facts.door!.clues!.length : 0));
      return n;
    });
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    for (const x of facts.facts) {
      const row = text.split("\n").find((l) => l.startsWith(`| ${x.id} `) || l.startsWith(`| ${x.id} ·`));
      expect(row, x.id).toBeDefined();
      expect(row).toContain(x.text.replace(/\|/gu, "\\|"));
      if (x.existing !== undefined) expect(row).toContain(`${x.existing} (hand-written)`);
      else expect(row).toContain(`\`${x.codex!.code}\``);
    }
  });
  it("prints the keypad sign and never the code", () => {
    const text = read(OUTPUTS.stacks);
    expect(text).toContain("## The cold door — the keypad sign");
    expect(text).toContain(`> ${facts.door!.clue}`);
    expect(text).not.toContain(facts.door!.code);
  });
  it("prints the digit notes on their own silver pile, where each hides, never a digit (wave 11)", () => {
    const text = read(OUTPUTS.stacks);
    const section = text.slice(text.indexOf("## Silver — the cold door's digits"), text.indexOf("## The cold door — the keypad sign"));
    expect(section.length).toBeGreaterThan(0);
    const rows = section.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Digit"));
    expect(rows).toHaveLength(facts.door!.clues!.length);
    facts.door!.clues!.forEach((c, i) => {
      const row = rows[i]!;
      expect(row).toContain(`\`${c.code}\``);
      expect(row).toContain(c.where);
      expect(row).toContain(`the ${POSITION_WORDS[i]} digit of the door code`);
    });
    expect(section).not.toMatch(/[0-9]/u); // no digit at all, let alone the code
  });
});

// ───────────────────────── the marked blocks ─────────────────────────

describe("titi-facts — the trabolta.mind.md secrets block", () => {
  it("replaces only the block: topics per question, every answer and alias, the HUNT ANSWER lore", () => {
    const mind = read(OUTPUTS.mind);
    expect(mind.startsWith("---\nstages:\n  - asleep\n  - formal\ndrives:\n  hunger: 30\n# the hunt's secrets — generated\n")).toBe(true);
    expect(mind.endsWith("phases:\n  arrivals: >-\n    Screensaver.\n---\nYou are TRABOLTA. Never mention the billboard.\n")).toBe(true);
    expect(mind).not.toContain("STAMPED");
    expect(mind).not.toContain("- stale");
    const block = mind.slice(mind.indexOf(MIND_BEGIN), mind.indexOf(MIND_END));
    expect(block).toBe(`${MIND_BEGIN}\n${mindBlock(facts, comboSeeds([read("main.loom")]))}\n`);
    expect(block).toContain('  lore:\n    - "▒ HUNT ANSWER"\n');
    expect(block).toContain("DO NOT EDIT");
    const entries = block.split("\n").filter((l) => l.startsWith("    - "));
    const unquote = (s: string): string => (s.startsWith('"') ? (JSON.parse(s) as string) : s);
    const topics = block.slice(block.indexOf("  topics:"), block.indexOf("  match:")).split("\n").filter((l) => l.startsWith("    - ")).map((l) => unquote(l.slice(6).replace(/\s+# [A-Z0-9]+$/u, "").trim()));
    const match = block.slice(block.indexOf("  match:"), block.indexOf("  lore:")).split("\n").filter((l) => l.startsWith("    - ")).map((l) => unquote(l.slice(6).trim()));
    for (const q of facts.questions) {
      for (const t of q.topics!) expect(topics).toContain(t.toLowerCase());
      for (const a of [q.answer, ...q.accept]) expect(match).toContain(a.toLowerCase());
      expect(block).toContain(`# ${q.id}`);
    }
    expect(new Set(topics).size).toBe(topics.length);
    expect(new Set(match).size).toBe(match.length);
    // What no line of his mind may carry: the door code (+ '97) and every seeded combo pair.
    const never = block.slice(block.indexOf("  never:")).split("\n").filter((l) => l.startsWith("    - ")).map((l) => unquote(l.slice(6).replace(/\s+# [a-z -]+$/u, "").trim()));
    expect(never).toEqual([...neverWords(facts, ["V2-D5,V4-D1", "V1-D6,V3-D2"]), ...answerNeverWords(facts)]);
    expect(never.slice(-9, -3)).toEqual(["V2-D5", "V4-D1", "B2-A5", "V1-D6", "V3-D2", "B4-A7"]);
    expect(never.slice(-3)).toEqual(["you're the one that i want", "youre the one that i want", "you are the one that i want"]);
    expect(block).toContain("# the door code");
    expect(block).toContain("# the patch-bay pairs");
    expect(block).toContain("# the pickup line");
    expect(entries.length).toBe(topics.length + match.length + 1 + never.length);
    // Numbers and times are quoted so YAML keeps them strings.
    expect(block).toContain('    - "412"');
    expect(block).toContain('    - "1978"');
    expect(block).toContain('    - "9:00"');
  });
});

describe("titi-facts — secrets.never", () => {
  it("is the door code (+ the ways a year is said) and every combo pair the story seeds, deduped; nothing without either", () => {
    expect(comboSeeds(['set Kernel.combo_a = "V2-D5,V4-D1"\n  set Kernel.combo_b = "V1-D6"', 'set Kernel.combo_a = "V2-D5,V4-D1"', 'set Night.combo = "V9-D9"'])).toEqual(["V2-D5,V4-D1", "V1-D6"]);
    const year = { ...facts, door: { ...facts.door!, code: "1997" } };
    // W8 T8-01: the spelled year and the year as a time ("In 97 I met her") —
    // never a bare "97", which silenced him toward a guest called NHL 97 (W8 review).
    const said = neverWords(year, ["V2-D5, v4-d1", "junk,V2-D5"]);
    // Wave 11: the digit notes' unlock codes and "the first digit" … phrases
    // (a single digit can't be a never word).
    const notes = [...facts.door!.clues!.map((c) => c.code), "first digit", "second digit", "third digit", "fourth digit"];
    expect(said).toEqual([
      "1997", "'97", "in 97", "in ninety-seven", "since 97", "since ninety-seven", "of ninety-seven",
      "nineteen ninety-seven", "one nine nine seven", ...notes, "V2-D5", "V4-D1", "B2-A5",
    ]);
    expect(neverWords({ ...year, door: { ...year.door!, clues: undefined } }, ["V2-D5"])).toEqual(["1997", "'97", "in 97", "in ninety-seven", "since 97", "since ninety-seven", "of ninety-seven", "nineteen ninety-seven", "one nine nine seven", "V2-D5"]);
    expect(said).not.toContain("97");
    expect(said).not.toContain("of 97"); // "a balance of 97 Truthcoin" is a count (W8 recheck)
    expect(neverWords({ ...facts, door: { ...facts.door!, code: "2007" } })).toContain("in 07");
    expect(neverWords(facts)[0]).toBe(facts.door!.code);
    expect(neverWords({ ...facts, door: { ...facts.door!, code: "0412" } })).toEqual(["0412", "zero four one two", "oh four one two", ...notes]);
    expect(neverWords({ ...facts, door: undefined })).toEqual([]);
    expect(mindBlock({ ...facts, door: undefined, answers: [] })).not.toContain("never:");
    // The pickup line alone still makes a never block (2026-10-19).
    expect(mindBlock({ ...facts, door: undefined })).toContain('  never:\n    - "you\'re the one that i want" # the pickup line\n');
  });

  it("carries the pickup line (answers[]): every form lowercased, plus the apostrophe-less spelling the judge folds to", () => {
    expect(answerNeverWords(facts)).toEqual(["you're the one that i want", "youre the one that i want", "you are the one that i want"]);
    const curly = { ...facts, answers: [{ id: "P1", text: "?", answer: "You\u2019re Mine", accept: ["you're mine", "  YOU ARE   MINE "] }] };
    expect(answerNeverWords(curly)).toEqual(["you're mine", "youre mine", "you are mine"]);
    expect(answerNeverWords({ ...facts, answers: [] })).toEqual([]);
  });

  it("says a year the way a voice would", () => {
    expect(["1997", "1907", "1900", "1910", "2000", "2007", "2012", "1980"].map(yearWords)).toEqual([
      "nineteen ninety-seven",
      "nineteen oh seven",
      "nineteen hundred",
      "nineteen ten",
      "two thousand",
      "two thousand seven",
      "twenty twelve",
      "nineteen eighty",
    ]);
    expect(digitWords("1997")).toBe("one nine nine seven");
  });

  it("tags the door code and the first pair, never a spelled year with a hyphen", () => {
    const block = mindBlock({ ...facts, door: { ...facts.door!, code: "1997" } }, ["V2-D5"]);
    expect(block).toMatch(/- "1997"\s+# the door code/u);
    expect(block).toMatch(/- "V2-D5"\s+# the patch-bay pairs/u);
    expect(block).toMatch(new RegExp(`- "${facts.door!.clues![0]!.code}"\\s+# the digit notes`, "u"));
    expect(block).toContain('    - "nineteen ninety-seven"\n');
  });
});

describe("titi-facts — the DESIGN.md questions block", () => {
  it("replaces only the block with the H1–F2 table stagehand's test_secrets parses", () => {
    const design = read(OUTPUTS.design);
    expect(design.startsWith("# Design\n\n### 2.11 Hunt questions\n\nIntro paragraph that stays.\n\n")).toBe(true);
    expect(design.endsWith("\n\n### 2.12 After\n\nTrailing text that stays.\n")).toBe(true);
    expect(design).not.toContain("| H1 | 1 | old | stale |");
    expect(design).toContain("retired 2026-10-16 (U9)");
    // stagehand/tests/test_secrets.py `_hunt_rows`
    const rows = [...design.matchAll(/^\| (H[1-6]|F[12]) \| [^|]+ \| ([^|]+) \| ([^|]+) \|/gmu)];
    expect(rows.map((r) => r[1])).toEqual(facts.questions.map((q) => q.id));
    for (const q of facts.questions) {
      const row = rows.find((r) => r[1] === q.id)!;
      expect(row[2]!.trim()).toBe(q.text);
      expect(row[3]!.trim()).toBe(q.answer);
      expect(design).toContain(`${q.codex!.id} (\`${q.codex!.code}\`)`);
      expect(design).toContain(q.where!);
      for (const a of q.accept) expect(design).toContain(a);
    }
    expect(design).toContain("| # | Round | Question (exact, as shown on the TV and in the quest log) | Answer | Accept | CODEX (code) | Found in |");
  });
});

// ───────────────────────── the model check ─────────────────────────

describe("titi-facts — the shipped show", () => {
  it("the show's generated files and marked blocks are up to date with facts.json (titi:facts --check)", () => {
    const errors: string[] = [];
    expect(run(scenarioDir(SHOW), { check: true, log: null, error: (l) => errors.push(l) })).toBe(0);
    expect(errors).toEqual([]);
  });
  it("the hand-written story is ready for the outputs: no collisions, every existing code, every tail beat", () => {
    const facts = parseFactsText(SHOW_FACTS).facts!;
    expect(modelProblems(facts, scenarioDir(SHOW))).toEqual([]);
  });
});

describe("titi-facts — modelProblems", () => {
  it("is empty against the fixture and names every collision or gap against a bare story", () => {
    expect(modelProblems(facts, dir)).toEqual([]);
    const other = mkdtempSync(join(tmpdir(), "titi-facts-model-"));
    try {
      const q1 = facts.questions[0]!.codex!;
      const c1 = facts.facts.find((x) => x.codex !== undefined)!;
      const e1 = facts.facts.find((x) => x.existing !== undefined && x.code !== undefined)!;
      writeFileSync(
        join(other, "main.loom"),
        [
          "# Bare",
          "start: Power On",
          `CODEX ${q1.id}`,
          `  title: ${q1.title}`,
          "  text:",
          "    Hand-written twin.",
          "CODEX Other",
          `  code: ${c1.codex!.code}`,
          "  text:",
          "    Carries a generated code.",
          `CODEX ${e1.existing}`,
          "  text:",
          "    No code yet.",
          "== Power On",
          "Hello.",
          "== Hunt One Questions",
          "Twin.",
          "== Facts Seed",
          "Twin.",
          "== Facts Bundle",
          "Twin.",
          "QUEST Hunt Two",
          "  title: Twin",
          "",
        ].join("\n"),
      );
      mkdirSync(join(other, "generated"));
      writeFileSync(join(other, OUTPUTS.questions), "// a generated file is never part of the check\nCODEX Nope\n  text:\n    x\n");
      const problems = modelProblems(facts, other);
      expect(problems).toContain(`question H1: CODEX ${JSON.stringify(q1.id)} is already declared by a hand-written file`);
      expect(problems).toContain(`fact ${c1.id}: code ${c1.codex!.code} is already carried by CODEX "Other"`);
      expect(problems).toContain(`fact ${e1.id}: CODEX ${JSON.stringify(e1.existing)} must carry \`code: ${e1.code}\` (has none)`);
      expect(problems.filter((p) => p.includes("names no CODEX entry")).length).toBe(facts.facts.filter((x) => x.existing !== undefined && x.existing !== e1.existing).length);
      expect(problems).toContain('round 1: beat "Hunt One Questions" is already declared by a hand-written file');
      expect(problems).toContain('round 2: QUEST "Hunt Two" is still declared by a hand-written file');
      expect(problems).toContain('round 1: the tail beat "Hunt One Go" (where "Hunt One Questions" hands back) is not declared');
      expect(problems).toContain('beat "Facts Seed" is already declared by a hand-written file');
      expect(problems).toContain('beat "Facts Bundle" is already declared by a hand-written file');
      expect(problems.some((p) => p.includes("Nope"))).toBe(false);
      expect(problems.some((p) => p.startsWith("door:"))).toBe(false);
      writeFileSync(join(other, "main.loom"), ["# Bare", "start: Power On", `CODEX ${facts.door!.codex.id}`, "  text:", "    A hand-written twin.", "== Power On", "Hello.", ""].join("\n"));
      expect(modelProblems(facts, other)).toContain(`door: CODEX ${JSON.stringify(facts.door!.codex.id)} is already declared by a hand-written file`);
      const empty = mkdtempSync(join(tmpdir(), "titi-facts-empty-"));
      try {
        expect(modelProblems(facts, empty)).toEqual([`no .loom files under ${empty}`]);
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
