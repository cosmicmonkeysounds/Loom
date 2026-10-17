//! titi-facts — the hunt generator (Wave 4, lane A).
//!
//! `facts.json` is the one file the team edits (`core/src/facts.ts` holds
//! its contract). This script turns it into story:
//!
//!   generated/questions.loom   the three round QUESTs, the reader's
//!                              per-round reading beats (each hands back
//!                              to a hand-written tail beat), `== Facts
//!                              Seed` (the 📝 card strings + the truth
//!                              count), `== Truth Question` (the
//!                              Truth-or-Dare question picked by
//!                              `Night.truth_n`) and the hunt-answer CODEX
//!                              entries, each ending with the lore marker
//!                              the voice worker hides;
//!   codex/9-facts.loom         every scannable + character fact as a coded
//!                              CODEX, grouped by category (colour), and
//!                              `== Facts Bundle` (an `unlock … for program`
//!                              per main + Trabolta fact, generated or
//!                              `existing`) that The Whole Truth diverts into;
//!   generated/print-stacks.md  the colour-coded QR stacks for the Desktop;
//!   trabolta.mind.md           the `secrets:` block between
//!                              `# <titi-facts:secrets>` … `# </titi-facts:secrets>`;
//!   DESIGN.md                  the H1–F2 table between
//!                              `<!-- titi-facts:questions -->` … `<!-- /titi-facts:questions -->`.
//!
//!   pnpm --filter @loom/core titi:facts [<example dir>] [--check] [--quiet]
//!
//! `--check` writes nothing and exits 1 when any output differs from disk
//! (the predeploy gate). Generated files carry a DO NOT EDIT banner. The
//! model check (ids / codes against the hand-written `.loom` files, the
//! tail beats) prints warnings; `core/test/trapped-in-the-internet.test.ts`
//! is the hard gate after the story pass.
//!
//! The show-specific part is `SHOW_SHAPE` below (who reads, where, the
//! beat and quest names); everything else is driven by the file.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FACTS_FILE, parseFactsText, showFactsProblems } from "../src/facts.ts";
import type { Fact, FactsFile, Question } from "../src/facts.ts";
import { parse } from "../src/parser/index.ts";
import { foldName } from "../src/parser/names.ts";
import { Sim, foldCode } from "../src/runtime/sim/index.ts";

// ───────────────────────── the show's shape ─────────────────────────

/** The hunt as the hand-written story expects it: the reader, the room,
 *  the world object the card strings live on, one entry per round (its
 *  QUEST, its reading beat and the hand-written beat that reading hands
 *  back to), the seed / question beats and the fallback line. */
export const SHOW_SHAPE = {
  reader: "Trabolta",
  setting: "The Desktop",
  world: "Night",
  rounds: {
    1: { quest: "Hunt One", beat: "Hunt One Questions", next: "Hunt One Go", read: (n: number) => `Question ${numberWord(n)}.`, card: (id: string, r: number, n: number) => `${id}: Round ${r} Q${n}.` },
    2: { quest: "Hunt Two", beat: "Hunt Two Questions", next: "Hunt Two Go", read: (n: number) => `Round two, question ${numberWord(n)}.`, card: (id: string, r: number, n: number) => `${id}: Round ${r} Q${n}.` },
    3: { quest: "The Final Facts", beat: "Final Questions", next: "Overshare Go", read: (n: number) => `Final fact ${numberWord(n)}.`, card: (id: string, _r: number, n: number) => `${id}: Final Q${n}.` },
  } as Record<number, { quest: string; beat: string; next: string; read: (n: number) => string; card: (id: string, r: number, n: number) => string }>,
  seedBeat: "Facts Seed",
  truthBeat: "Truth Question",
  /** The majority's bundle (`beats/server-room.loom` The Whole Truth
   *  diverts here): every fact of these categories, for `program`. */
  bundleBeat: "Facts Bundle",
  bundleCategories: ["main", "trabolta"],
  noMoreQuestions: "I have no more questions. Answer the last one again.",
  /** The hunt answers' stack on the print sheet. */
  huntColour: "gold",
} as const;

/** The lore marker on every hunt-answer entry (`trabolta.mind.md`
 *  `secrets.lore`); the worker hides any entry carrying it. */
export const HUNT_MARKER = "▒ HUNT ANSWER";

export const MIND_BEGIN = "# <titi-facts:secrets>";
export const MIND_END = "# </titi-facts:secrets>";
export const DESIGN_BEGIN = "<!-- titi-facts:questions -->";
export const DESIGN_END = "<!-- /titi-facts:questions -->";

/** Project-relative outputs. */
export const OUTPUTS = {
  questions: "generated/questions.loom",
  codex: "codex/9-facts.loom",
  stacks: "generated/print-stacks.md",
  mind: "trabolta.mind.md",
  design: "DESIGN.md",
} as const;

const RERUN = "pnpm --filter @loom/core titi:facts";
export const LOOM_BANNER = `// GENERATED by core/scripts/titi-facts.ts from facts.json — DO NOT EDIT.\n// Edit facts.json, then: ${RERUN}\n`;
export const MD_BANNER = `<!-- GENERATED by core/scripts/titi-facts.ts from facts.json — DO NOT EDIT.\n     Edit facts.json, then: ${RERUN} -->\n`;

/** The width of a wrapped `text:` line, after its 4-space indent. */
export const WRAP = 72;
const INDENT = "    ";

export class TitiFactsError extends Error {}

// ───────────────────────── text helpers ─────────────────────────

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
export function numberWord(n: number): string {
  return WORDS[n] ?? String(n);
}

/** A wrapped line may not start like dialogue (`Name:`), a bullet or a
 *  comment — a performer's codex rides into prompts, and a `- ` line is a
 *  bullet to the parser. */
const BAD_START = /^(?:\S+:|-|\/\/)(?:\s|$)/u;

/** Greedy hard-wrap at `width` columns. `atomic` words are never split
 *  across a line. When a wrapped line would start with `Word:` (or `- `,
 *  `//`) the previous line's last word is pulled down until it does not;
 *  a text that *starts* that way is refused. */
export function wrapText(text: string, width = WRAP, atomic: string[] = []): string[] {
  const words = text.split(/\s+/u).filter((w) => w.length > 0).concat(atomic);
  const lines: string[][] = [];
  let line: string[] = [];
  let len = 0;
  for (const w of words) {
    if (line.length > 0 && len + 1 + w.length > width) {
      lines.push(line);
      line = [];
      len = 0;
    }
    len += (line.length > 0 ? 1 : 0) + w.length;
    line.push(w);
  }
  if (line.length > 0) lines.push(line);
  // Pull words down so no line starts like dialogue.
  for (let i = 0; i < lines.length; i++) {
    for (;;) {
      const cur = lines[i]!;
      if (!BAD_START.test(cur.join(" "))) break;
      if (i === 0) throw new TitiFactsError(`text may not start with a name and a colon, a bullet or a comment: ${JSON.stringify(cur.slice(0, 3).join(" "))}`);
      const prev = lines[i - 1]!;
      cur.unshift(prev.pop()!);
      if (prev.length === 0) {
        lines.splice(i - 1, 1);
        i -= 1;
      }
    }
  }
  return lines.map((l) => l.join(" "));
}

const textBlock = (text: string, atomic: string[] = []): string => wrapText(text, WRAP, atomic).map((l) => INDENT + l).join("\n");

/** Markdown table cell: pipes escaped, newlines flattened. */
const cell = (s: string): string => s.replace(/\s+/gu, " ").replace(/\|/gu, "\\|").trim();

/** A YAML sequence entry: plain when it is unmistakably a string, else
 *  double-quoted (numbers, times like `9:00`, `yes`/`no`/`null`, anything
 *  with punctuation YAML could read as structure). */
export function yamlScalar(s: string): string {
  const plain = /^[a-z][a-z0-9 '.-]*[a-z0-9.]$/u.test(s) && !/^(?:y|yes|n|no|true|false|on|off|null)$/u.test(s);
  return plain ? s : JSON.stringify(s);
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/gu, " ").trim();

/** Everything between the `begin` and `end` marker lines replaced with
 *  `body` (the markers stay, each on its own line). */
export function replaceBlock(text: string, begin: string, end: string, body: string, file: string): string {
  const lines = text.split("\n");
  const starts = lines.flatMap((l, i) => (l.trim() === begin ? [i] : []));
  const ends = lines.flatMap((l, i) => (l.trim() === end ? [i] : []));
  if (starts.length !== 1 || ends.length !== 1) {
    throw new TitiFactsError(`${file}: expected exactly one \`${begin}\` and one \`${end}\` line (found ${starts.length} / ${ends.length})`);
  }
  const [a, b] = [starts[0]!, ends[0]!];
  if (b <= a) throw new TitiFactsError(`${file}: \`${end}\` comes before \`${begin}\``);
  return [...lines.slice(0, a + 1), ...body.split("\n"), ...lines.slice(b)].join("\n");
}

// ───────────────────────── the generator ─────────────────────────

export interface GenerateInput {
  /** The current `trabolta.mind.md` (its marked block is replaced). */
  mind: string;
  /** The current `DESIGN.md` (its marked block is replaced). */
  design: string;
}

export interface Generated {
  /** Whole generated files, by project-relative path. */
  files: Record<string, string>;
  /** `trabolta.mind.md` with its block regenerated. */
  mind: string;
  /** `DESIGN.md` with its block regenerated. */
  design: string;
}

interface Round {
  r: number;
  questions: Question[];
}

function rounds(f: FactsFile): Round[] {
  const by = new Map<number, Question[]>();
  for (const q of f.questions) {
    const list = by.get(q.round) ?? [];
    list.push(q);
    by.set(q.round, list);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([r, questions]) => ({ r, questions }));
}

function shapeOf(r: number): (typeof SHOW_SHAPE.rounds)[number] {
  const s = SHOW_SHAPE.rounds[r];
  if (s === undefined) throw new TitiFactsError(`round ${r}: the show has no shape for it (rounds ${Object.keys(SHOW_SHAPE.rounds).join(", ")})`);
  return s;
}

/** The 📝 card string for a question: `"<id>: Round <r> Q<n>. <text>"`,
 *  `"F<n>: Final Q<n>. <text>"` for the final round. */
export function cardString(q: Question, n: number): string {
  return `${shapeOf(q.round).card(q.id, q.round, n)} ${q.text}`;
}

/** The world var a question's card string is set on. */
export const cardVar = (q: Question): string => `${SHOW_SHAPE.world}.q_${q.id.toLowerCase()}`;

/** Pure: the generated outputs for a validated file. Throws
 *  `TitiFactsError` on a marker problem or an unwrappable text. */
export function generate(facts: FactsFile, current: GenerateInput): Generated {
  const problems = showFactsProblems(facts);
  if (problems.length > 0) throw new TitiFactsError(`facts.json: ${problems.join("; ")}`);
  const files: Record<string, string> = {
    [OUTPUTS.questions]: questionsLoom(facts),
    [OUTPUTS.codex]: factsLoom(facts),
    [OUTPUTS.stacks]: printStacks(facts),
  };
  return {
    files,
    mind: replaceBlock(current.mind, MIND_BEGIN, MIND_END, mindBlock(facts), OUTPUTS.mind),
    design: replaceBlock(current.design, DESIGN_BEGIN, DESIGN_END, designBlock(facts), OUTPUTS.design),
  };
}

// --- generated/questions.loom ---------------------------------------------

function questionsLoom(f: FactsFile): string {
  const S = SHOW_SHAPE;
  const out: string[] = [LOOM_BANNER.trimEnd()];
  out.push(
    "//",
    `// The hunt: the round QUESTs, ${S.reader}'s reading beats (each hands`,
    "// back to a hand-written tail beat, so the chain is the same under the",
    "// Sim, which resumes the caller, and a true divert), `== Facts Seed`",
    "// (the 📝 card strings + the truth count — the entry beat diverts here",
    "// as its last line), `== Truth Question` (the Truth-or-Dare question",
    `// picked by ${S.world}.truth_n) and the hunt-answer CODEX entries, each`,
    `// ending with the lore marker the voice worker hides (${OUTPUTS.mind}`,
    "// secrets.lore).",
    "",
  );

  const rs = rounds(f);
  for (const { r, questions } of rs) {
    const shape = shapeOf(r);
    const meta = f.rounds?.[String(r)];
    if (meta === undefined) throw new TitiFactsError(`rounds.${r} is not declared`);
    out.push(`QUEST ${shape.quest}`, `  title: ${meta.questTitle}`, `  from: ${S.reader}`, "  text:", textBlock(meta.brief));
    questions.forEach((q, i) => out.push(`${INDENT}- Q${i + 1}. ${q.text}`));
    out.push("");
  }

  for (const { r, questions } of rs) {
    const shape = shapeOf(r);
    out.push(`== ${shape.beat}`, `  setting: ${S.setting}`, `  cast: ${S.reader}`, "");
    questions.forEach((q, i) => out.push(`${S.reader}: ${shape.read(i + 1)} ${q.text}`));
    out.push(`-> ${shape.next}`, "");
  }

  out.push(`// The 📝 card lines (main.loom \`when deal_fact_card\`) and the truth count.`, `== ${S.seedBeat}`, `  setting: ${S.setting}`, "");
  for (const { questions } of rs) questions.forEach((q, i) => out.push(`set ${cardVar(q)} = "${cardString(q, i + 1)}"`));
  out.push(`set ${S.world}.truth_count = ${f.truths.length}`, "");

  out.push(
    `// Truth or Dare: the bottle lane sets ${S.world}.truth_n and fires this beat;`,
    "// the arm with that number is the question (match has no fallback arm,",
    "// so the guard around it is the fallback).",
    `== ${S.truthBeat}`,
    `  setting: ${S.setting}`,
    `  cast: ${S.reader}`,
    "",
    `if ${S.world}.truth_n >= 1 and ${S.world}.truth_n <= ${f.truths.length}:`,
    `  match ${S.world}.truth_n:`,
  );
  f.truths.forEach((t, i) => {
    out.push(`    ${i + 1}:${t.draft ? " // DRAFT" : ""}`, `      ${S.reader}: ${t.text}`);
  });
  out.push("else:", `  ${S.reader}: ${S.noMoreQuestions}`, "");

  out.push("// The hunt answers. Each ends with the lore marker the worker hides.");
  for (const { questions } of rs) {
    for (const q of questions) {
      const c = q.codex!;
      out.push("", `// ${q.id} · the hunt answer · ${S.huntColour}`);
      if (q.draft) out.push(`// ${DRAFT_NOTE}`);
      out.push(`CODEX ${c.id}`, `  title: ${c.title}`, `  code: ${c.code}`, "  text:", textBlock(c.text, [`${HUNT_MARKER} ${q.id} ▒`]));
    }
  }
  out.push("");
  return out.join("\n");
}

// --- codex/9-facts.loom ----------------------------------------------------

function factsLoom(f: FactsFile): string {
  const out: string[] = [LOOM_BANNER.trimEnd()];
  out.push(
    "//",
    "// Codex 9: the Desktop's print media — every scannable fact, colour-coded",
    "// in facts.json (`categories`). The hunt answers are in",
    `// ${OUTPUTS.questions}; a fact facts.json marks \`existing\` is told by a`,
    "// hand-written entry and is not repeated here.",
    "",
  );
  const cats = Object.entries(f.categories ?? {});
  for (const [cat, meta] of cats) {
    const own = f.facts.filter((x) => x.category === cat && x.codex !== undefined);
    if (own.length === 0) continue;
    out.push(`// ── ${cat.toUpperCase()} · ${meta.colour} · ${meta.stack} ──`, "");
    for (const x of own) {
      const c = x.codex!;
      out.push(`// ${x.id} · ${cat} · ${meta.colour}${x.draft ? " · DRAFT" : ""}`, `CODEX ${c.id}`, `  title: ${c.title}`);
      if (c.about !== undefined) out.push(`  about: ${c.about}`);
      if (c.secret) out.push("  secret: true");
      out.push(`  code: ${c.code}`, "  text:", textBlock(c.text), "");
    }
  }
  const S = SHOW_SHAPE;
  const bundle = [...new Set(f.facts.filter((x) => (S.bundleCategories as readonly string[]).includes(x.category)).map((x) => x.codex?.id ?? x.existing!))];
  out.push(
    `// The majority's bundle: every ${S.bundleCategories.join(" + ")} fact (a hand-written`,
    "// `existing` entry by its own name), in facts.json order. The Whole Truth",
    "// (beats/server-room.loom) diverts here and carries on after it.",
    `== ${S.bundleBeat}`,
    ...bundle.map((id) => `unlock ${id} for program`),
    "",
  );
  return out.join("\n");
}

// --- generated/print-stacks.md ---------------------------------------------

/** What a `draft: true` row means: not yet signed off — a placeholder to
 *  replace or a rewrite to approve, never "not decided yet, skip it". */
export const DRAFT_NOTE = "DRAFT — awaiting sign-off in facts.json";

const HEADER = "| # | Colour | Code | Title | Where in the Desktop | What it says |\n|---|---|---|---|---|---|";

function printStacks(f: FactsFile): string {
  const S = SHOW_SHAPE;
  const out: string[] = [MD_BANNER.trimEnd(), "", `# ${f.show?.title ?? "The show"} — the Desktop's QR stacks`, ""];
  out.push(
    "Generated from `facts.json`: one table per stack, in colour order. Sort the",
    "printed codex posters (Run → 🖨 Print sheet) into these piles and hide each",
    "pile where its stack says. `DRAFT` rows await the team's sign-off in",
    "`facts.json`: a placeholder to replace, or a rewrite to approve. Print and",
    "hide them as they stand. A hand-written entry (`existing`) keeps the place",
    "README → QR placements gives it; it is listed so the colour is known.",
    "",
    `## ${S.huntColour[0]!.toUpperCase()}${S.huntColour.slice(1)} — the hunt answers`,
    "",
    "Each row says where its document hides; the hint is what a host may tell a",
    "stuck program.",
    "",
    HEADER,
  );
  for (const { questions } of rounds(f)) {
    for (const q of questions) {
      const c = q.codex!;
      const where = q.where! + (q.hint ? ` — hint: ${q.hint}` : "");
      out.push(`| ${q.id}${q.draft ? " · DRAFT" : ""} | ${S.huntColour} | \`${c.code}\` | ${cell(c.title)} | ${cell(where)} | ${cell(`Q: ${q.text} → A: ${q.answer}`)} |`);
    }
  }
  for (const [cat, meta] of Object.entries(f.categories ?? {})) {
    const own = f.facts.filter((x) => x.category === cat);
    if (own.length === 0) continue;
    out.push("", `## ${meta.colour[0]!.toUpperCase()}${meta.colour.slice(1)} — ${cat}`, "", `Stack: ${meta.stack}`, "", HEADER);
    for (const x of own) out.push(stackRow(x, meta.colour, meta.stack));
  }
  out.push("");
  return out.join("\n");
}

function stackRow(x: Fact, colour: string, stack: string): string {
  const id = `${x.id}${x.draft ? " · DRAFT" : ""}`;
  if (x.codex !== undefined) return `| ${id} | ${colour} | \`${x.codex.code}\` | ${cell(x.codex.title)} | ${cell(stack)} | ${cell(x.text)} |`;
  const code = x.code !== undefined ? `\`${x.code}\`` : "(no code)";
  return `| ${id} | ${colour} | ${code} | ${cell(x.existing!)} (hand-written) | already placed — README → QR placements | ${cell(x.text)} |`;
}

// --- the marked blocks -----------------------------------------------------

/** The `secrets:` YAML block: every question's topics (deduped, question
 *  order, the first new one of each question commented `# H1`), every
 *  answer + alias (lowercased, deduped) and the lore marker. */
export function mindBlock(f: FactsFile): string {
  const out: string[] = [
    `# generated from facts.json by core/scripts/titi-facts.ts — DO NOT EDIT this block (${RERUN}).`,
    "secrets:",
    "  topics:",
  ];
  const seen = new Set<string>();
  for (const q of f.questions) {
    let tagged = false;
    for (const t of q.topics ?? []) {
      const key = norm(t);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = `    - ${yamlScalar(key)}`;
      out.push(tagged ? entry : `${entry.padEnd(26)} # ${q.id}`);
      tagged = true;
    }
  }
  out.push("  match:");
  const words = new Set<string>();
  for (const q of f.questions) for (const a of [q.answer, ...q.accept]) words.add(norm(a));
  for (const w of words) out.push(`    - ${yamlScalar(w)}`);
  out.push("  lore:", `    - ${JSON.stringify(HUNT_MARKER)}`);
  return out.join("\n");
}

/** The H1–F2 table. The first four columns keep the shape
 *  `stagehand/tests/test_secrets.py` parses: `| id | round | question | answer |`. */
export function designBlock(f: FactsFile): string {
  const out: string[] = [
    "_Generated from `facts.json` by `core/scripts/titi-facts.ts` — DO NOT EDIT this block;",
    `edit \`facts.json\`, then \`${RERUN}\`. The six-stamp pickup-line`,
    "mechanic was retired 2026-10-16 (U9): the line is learnable from Sandy's lore codex",
    "and asked via the ask-14 DM._",
    "",
    "| # | Round | Question (exact, as shown on the TV and in the quest log) | Answer | Accept | CODEX (code) | Found in |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const q of f.questions) {
    const c = q.codex!;
    const accept = q.accept.length > 0 ? q.accept.map(cell).join(" · ") : "—";
    out.push(`| ${q.id} | ${q.round} | ${cell(q.text)} | ${cell(q.answer)} | ${accept} | ${cell(c.id)} (\`${c.code}\`) | ${cell(q.where ?? "")}${q.draft ? " · DRAFT" : ""} |`);
  }
  return out.join("\n");
}

// ───────────────────────── the model check ─────────────────────────

/** The project's `.loom` files, main first then by path (as the server
 *  concatenates them), minus the generator's own outputs. */
function handWrittenFiles(dir: string): Array<{ path: string; source: string }> {
  const walk = (d: string): string[] => {
    const out: string[] = [];
    for (const n of readdirSync(d)) {
      const full = join(d, n);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (n.endsWith(".loom")) out.push(full);
    }
    return out;
  };
  const generated = new Set<string>([OUTPUTS.questions, OUTPUTS.codex]);
  return walk(dir)
    .map((full) => ({ path: relative(dir, full).split(sep).join("/"), source: readFileSync(full, "utf8") }))
    .filter((f) => !generated.has(f.path))
    .sort((a, b) => (a.path === "main.loom" ? 0 : 1) - (b.path === "main.loom" ? 0 : 1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** What the generated story would collide with, or miss, in the
 *  hand-written files of `dir`: a generated CODEX id / code / QUEST / beat
 *  already declared, an `existing` fact naming no entry (or one without
 *  the recorded code), a tail beat the reading beats hand back to that
 *  does not exist. Empty when the story is ready for the outputs. */
export function modelProblems(facts: FactsFile, dir: string): string[] {
  const files = handWrittenFiles(dir);
  if (files.length === 0) return [`no .loom files under ${dir}`];
  let model: Sim["model"];
  try {
    model = Sim.fromSources(...files).model;
  } catch (err) {
    return [`the project does not compile: ${err instanceof Error ? err.message : String(err)}`];
  }
  const has = (keys: Iterable<string>, name: string): boolean => {
    const want = foldName(name);
    for (const k of keys) if (foldName(k) === want) return true;
    return false;
  };
  const out: string[] = [];
  const codexConflict = (id: string, code: string, by: string) => {
    if (model.codex.has(id)) out.push(`${by}: CODEX ${JSON.stringify(id)} is already declared by a hand-written file`);
    const owner = model.codexCodes.get(foldCode(code));
    if (owner !== undefined) out.push(`${by}: code ${code} is already carried by CODEX ${JSON.stringify(owner)}`);
  };
  for (const q of facts.questions) codexConflict(q.codex!.id, q.codex!.code, `question ${q.id}`);
  for (const x of facts.facts) {
    if (x.codex !== undefined) codexConflict(x.codex.id, x.codex.code, `fact ${x.id}`);
    if (x.existing !== undefined) {
      const entry = model.codex.get(x.existing);
      if (entry === undefined) out.push(`fact ${x.id}: existing ${JSON.stringify(x.existing)} names no CODEX entry`);
      else if (x.code !== undefined && entry.code !== foldCode(x.code)) out.push(`fact ${x.id}: CODEX ${JSON.stringify(x.existing)} must carry \`code: ${x.code}\` (has ${entry.code ?? "none"})`);
    }
  }
  for (const { r } of rounds(facts)) {
    const shape = shapeOf(r);
    if (has(model.quests.keys(), shape.quest)) out.push(`round ${r}: QUEST ${JSON.stringify(shape.quest)} is still declared by a hand-written file`);
    if (has(model.beats.keys(), shape.beat)) out.push(`round ${r}: beat ${JSON.stringify(shape.beat)} is already declared by a hand-written file`);
    if (!has(model.beats.keys(), shape.next)) out.push(`round ${r}: the tail beat ${JSON.stringify(shape.next)} (where ${JSON.stringify(shape.beat)} hands back) is not declared`);
  }
  for (const b of [SHOW_SHAPE.seedBeat, SHOW_SHAPE.truthBeat, SHOW_SHAPE.bundleBeat]) if (has(model.beats.keys(), b)) out.push(`beat ${JSON.stringify(b)} is already declared by a hand-written file`);
  return out;
}

// ───────────────────────── the CLI ─────────────────────────

export interface RunOptions {
  /** Compare with disk, write nothing, exit 1 on any difference. */
  check?: boolean;
  /** Where lines go (default `console.log`); `null` silences everything but errors. */
  log?: ((line: string) => void) | null;
  /** Error lines (default `console.error`). */
  error?: (line: string) => void;
}

/** Generate (or check) the project at `dir`. Returns the exit code. */
export function run(dir: string, opts: RunOptions = {}): number {
  const log = opts.log === undefined ? (l: string) => console.log(l) : opts.log ?? (() => {});
  const error = opts.error ?? ((l: string) => console.error(l));
  const root = resolve(dir);
  const factsPath = join(root, FACTS_FILE);
  if (!existsSync(factsPath)) {
    error(`titi-facts: no ${FACTS_FILE} in ${root}`);
    return 1;
  }
  const parsed = parseFactsText(readFileSync(factsPath, "utf8"));
  if (parsed.facts === null) {
    error(`titi-facts: ${FACTS_FILE} does not validate:`);
    for (const p of parsed.problems) error(`  ${p}`);
    return 1;
  }
  const facts = parsed.facts;
  const showProblems = showFactsProblems(facts);
  if (showProblems.length > 0) {
    error(`titi-facts: ${FACTS_FILE} breaks the show's rules:`);
    for (const p of showProblems) error(`  ${p}`);
    return 1;
  }
  const current: Partial<GenerateInput> = {};
  for (const [key, file] of [
    ["mind", OUTPUTS.mind],
    ["design", OUTPUTS.design],
  ] as const) {
    const p = join(root, file);
    if (!existsSync(p)) {
      error(`titi-facts: ${file} is missing (it must carry the ${key === "mind" ? MIND_BEGIN : DESIGN_BEGIN} … block)`);
      return 1;
    }
    current[key] = readFileSync(p, "utf8");
  }
  let gen: Generated;
  try {
    gen = generate(facts, current as GenerateInput);
  } catch (err) {
    if (err instanceof TitiFactsError) {
      error(`titi-facts: ${err.message}`);
      return 1;
    }
    throw err;
  }
  // Every generated .loom must parse clean before anything is compared or written.
  for (const file of [OUTPUTS.questions, OUTPUTS.codex]) {
    const errs = parse(gen.files[file]!)[1].filter((d) => d.severity === "error");
    if (errs.length > 0) {
      error(`titi-facts: ${file} has ${errs.length} parse error(s): ${errs.map((d) => d.message).join("; ")}`);
      return 1;
    }
  }
  for (const w of modelProblems(facts, root)) log(`WARN  ${w}`);

  const outputs: Array<[string, string]> = [...Object.entries(gen.files), [OUTPUTS.mind, gen.mind], [OUTPUTS.design, gen.design]];
  const stale: string[] = [];
  const same: string[] = [];
  for (const [file, text] of outputs) {
    const p = join(root, file);
    const onDisk = existsSync(p) ? readFileSync(p, "utf8") : null;
    if (onDisk === text) same.push(file);
    else stale.push(onDisk === null ? `${file} (missing)` : file);
  }
  if (opts.check) {
    if (stale.length === 0) {
      log(`titi-facts: ${outputs.length} outputs up to date with ${FACTS_FILE}`);
      return 0;
    }
    error(`titi-facts: ${stale.length} output(s) differ from ${FACTS_FILE} — run ${RERUN}:`);
    for (const s of stale) error(`  ${s}`);
    return 1;
  }
  for (const [file, text] of outputs) {
    if (same.includes(file)) continue;
    const p = join(root, file);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
    log(`wrote ${file}`);
  }
  if (stale.length === 0) log("titi-facts: nothing to do (all outputs up to date)");
  else log(`titi-facts: ${stale.length} written, ${same.length} unchanged`);
  return 0;
}

export function main(argv: string[]): number {
  const check = argv.includes("--check");
  const quiet = argv.includes("--quiet");
  const dir = argv.find((a) => !a.startsWith("--")) ?? fileURLToPath(new URL("../examples/trapped-in-the-internet", import.meta.url));
  return run(dir, { check, log: quiet ? null : undefined });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
