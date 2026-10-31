//! titi-facts — the hunt generator (Wave 4, lane A).
//!
//! `facts.json` is the one file the team edits (`core/src/facts.ts` holds
//! its contract). This script turns it into story:
//!
//!   generated/questions.loom   the three round QUESTs, the reader's
//!                              per-round reading beats (each hands back
//!                              to a hand-written tail beat), one `== Reading
//!                              <id>` beat per question (wave 59a: how he
//!                              reads its results out), `== Facts
//!                              Seed` (the 📝 card strings, the truth
//!                              count and the secret door code on the
//!                              Kernel), `== Truth Question` (the
//!                              Truth-or-Dare question picked by
//!                              `Night.truth_n`) and the hunt-answer CODEX
//!                              entries, each `secret: true` (never in an
//!                              agent request or the facts document) and
//!                              ending with the lore marker the voice
//!                              worker hides;
//!   codex/9-facts.loom         every scannable + character fact as a coded
//!                              CODEX, grouped by rarity tier (colour), the
//!                              secret *The Door Code* (`door`), one secret
//!                              coded CODEX per digit clue (`door.clues`), and
//!                              `== Facts Bundle` (an `unlock … for program`
//!                              per main + Trabolta fact, generated or
//!                              `existing`) that The Whole Truth diverts into;
//!   generated/print-stacks.md  the QR stacks, one per tier (wave 35),
//!                              the cold door's digit notes (where each
//!                              hides, never its digit) and the keypad sign
//!                              (never the code);
//!   trabolta.mind.md           the `secrets:` block between
//!                              `# <titi-facts:secrets>` … `# </titi-facts:secrets>`;
//!   DESIGN.md                  the H1–F3 table between
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
import { FACTS_FILE, POSITION_WORDS, clueText, parseFactsText, placeholderQuestions, showFactsProblems } from "../src/facts.ts";
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
    2: { quest: "Hunt Two", beat: "Hunt Two Questions", next: "Hunt Two Go", read: (n: number) => `Question ${numberWord(n)}:`, card: (id: string, r: number, n: number) => `${id}: Round ${r} Q${n}.` },
    3: { quest: "The Final Facts", beat: "Final Questions", next: "Final Round Go", read: (n: number) => `Question ${numberWord(n)}:`, card: (id: string, _r: number, n: number) => `${id}: Final Q${n}.` },
  } as Record<number, { quest: string; beat: string; next: string; read: (n: number) => string; card: (id: string, r: number, n: number) => string }>,
  /** His words around each question's reading (wave 59a, the script's). */
  reading: {
    beat: (id: string) => `Reading ${id}`,
    lead: (n: number) => (n === 1 ? "Question one." : `Now. Question ${numberWord(n)}.`),
    question: "The question was:",
    guesses: "Here are the guesses you have submitted:",
    absent: "These programs did not submit any truth:",
    correct: "Congratulations to these programs for getting a correct answer:",
  },
  seedBeat: "Facts Seed",
  /** Where the keypad code is seeded (`door.code`): the secret Kernel,
   *  never `Night.*` (the voice worker reads Night whole). */
  doorVar: "Kernel.door_code",
  /** Where the patch-bay combinations are seeded by hand (cast/props.loom
   *  + main.loom's Power On: `set Kernel.combo_a = "V2-D5,V4-D1,…"`):
   *  every pair joins the door code in the mind's `secrets.never`. */
  comboSeed: /^\s*set\s+Kernel\.combo_[a-z0-9_]+\s*=\s*"([^"]*)"/gmu,
  truthBeat: "Truth Question",
  /** The majority's bundle (`beats/server-room.loom` The Whole Truth
   *  diverts here): every fact of these categories, for `program`. */
  bundleBeat: "Facts Bundle",
  bundleCategories: ["main", "trabolta"],
  noMoreQuestions: "I have no more questions. Answer the last one again.",
  /** The hunt answers' stack on the print sheet. */
  huntColour: "gold",
  /** The door's digit notes on the print sheet (`door.clues`): their own
   *  pile, hidden one per room (core/server/routes/k12.ts reads the same).
   *  They count as very rare (`clueTier`): the stacks list them there. */
  clueColour: "silver",
  clueStack: "the cold door's digits",
  clueTier: "very-rare",
  /** The room every digit note is about (as the combo halves are). */
  clueAbout: "The Server Room",
  /** The Codex room's section (wave 13: `category:` on every CODEX, in
   *  guest-facing words): every scannable fact and hunt answer. */
  factCategory: "Facts",
  /** The door code and its digit notes. */
  doorCategory: "The cold door",
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
  /** The patch-bay combinations as the hand-written story seeds them
   *  (`comboSeeds`: "V2-D5,V4-D1,…" each) — their pairs go in
   *  `secrets.never`. */
  combos?: string[];
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

/** (wave 58) The world var saying a question's key is still owed
 *  (`Question.placeholder`): G9a's count skips it, on either road. */
export const owedVar = (q: Question): string => `${SHOW_SHAPE.world}.owed_${q.id.toLowerCase()}`;

/** A question's place across the night (`fact_v1` is H1's, `fact_v9` F3's). */
const questionNumber = (f: FactsFile, q: Question): number => f.questions.indexOf(q) + 1;

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
    mind: replaceBlock(current.mind, MIND_BEGIN, MIND_END, mindBlock(facts, current.combos ?? []), OUTPUTS.mind),
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
    "// (the 📝 card strings, the truth count, the door code — the entry beat diverts here",
    "// as its last line), `== Truth Question` (the Truth-or-Dare question",
    `// picked by ${S.world}.truth_n) and the hunt-answer CODEX entries, each`,
    "// `secret: true` (no agent ever reads or takes one) and ending with the",
    `// lore marker the voice worker hides (${OUTPUTS.mind} secrets.lore).`,
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
    questions.forEach((q, i) => out.push(`${S.reader}: ${shape.read(i + 1)} ${q.spoken ?? q.text}`));
    out.push(`-> ${shape.next}`, "");
  }

  out.push(
    "// The reading of each question, the script's words: the question, what each",
    "// program filed, who filed nothing, the answer, who was right and sure. A line",
    "// with nobody in it drops out. A filing still pending, under review or waiting",
    "// on a ruling counts by its proposal, and a spoken answer a host accepted counts",
    "// as filed. core/server/agent-recent.ts keeps every one of these beats out of his",
    "// worker's `recent` and the talk history: they carry the answers and quote guests.",
    "",
  );
  for (const { questions } of rs) questions.forEach((q, i) => out.push(...readingBeat(f, q, i + 1)));

  out.push(`// The 📝 card lines (main.loom \`when deal_fact_card\`), which keys are still owed (G9a skips them), the truth count${f.door ? " and the door code" : ""}.`, `== ${S.seedBeat}`, `  setting: ${S.setting}`, "");
  for (const { questions } of rs) questions.forEach((q, i) => out.push(`set ${cardVar(q)} = "${cardString(q, i + 1)}"`));
  for (const { questions } of rs) questions.forEach((q) => out.push(`set ${owedVar(q)} = ${q.placeholder === true}`));
  out.push(`set ${S.world}.truth_count = ${f.truths.length}`);
  if (f.door !== undefined) out.push(`set ${S.doorVar} = "${f.door.code}"`);
  out.push("");

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

  out.push(
    "// The hunt answers: the guests' to find, never the reader's to know. Each",
    "// is `secret: true` (the event server keeps it out of every agent request",
    "// and the facts document, and an agent refuses it as a share), and ends",
    "// with the lore marker the voice worker hides too.",
  );
  for (const { questions } of rs) {
    for (const q of questions) {
      const c = q.codex!;
      out.push("", `// ${q.id} · the hunt answer · ${S.huntColour}`);
      if (q.draft) out.push(`// ${DRAFT_NOTE}`);
      out.push(`CODEX ${c.id}`, `  title: ${c.title}`, `  category: ${SHOW_SHAPE.factCategory}`, `  code: ${c.code}`, "  secret: true", "  text:", textBlock(c.text, [`${HUNT_MARKER} ${q.id} ▒`]));
    }
  }
  const documents = f.documents ?? [];
  if (documents.length > 0) {
    out.push("", "// Documents that stopped being questions (wave 59a): the same entries, the", "// same codes, the same cards and the same pile. They only ask nothing now.");
    for (const d of documents) {
      const c = d.codex;
      out.push("", `// ${d.was} · a document · ${S.huntColour}`);
      if (d.draft) out.push(`// ${DRAFT_NOTE}`);
      out.push(`CODEX ${c.id}`, `  title: ${c.title}`, `  category: ${SHOW_SHAPE.factCategory}`, `  code: ${c.code}`, "  secret: true", "  text:", textBlock(c.text, [`${HUNT_MARKER} ${d.was} ▒`]));
    }
  }
  out.push("");
  return out.join("\n");
}

/** One question's reading beat. Every number is the question's place across
 *  the night, as the story's slots are numbered (`fact_v9` is F3's). */
function readingBeat(f: FactsFile, q: Question, n: number): string[] {
  const S = SHOW_SHAPE;
  const R = S.reading;
  const k = questionNumber(f, q);
  const here = "p.cleared == true and p.gone != true and p.persona != true";
  const right = `p.fact_v${k} == "accurate" or (p.fact_v${k} == "pending" and p.fact_j${k} == "accurate") or (p.judged_q${k} == true and p.hunt_lie_q${k} != true)`;
  const sureRight = `(p.fact_c${k} == 100 and (p.fact_v${k} == "accurate" or (p.fact_v${k} == "pending" and p.fact_j${k} == "accurate"))) or (p.judged_q${k} == true and p.hunt_lie_q${k} != true)`;
  const out = [
    `== ${R.beat(q.id)}`,
    `  setting: ${S.setting}`,
    `  cast: ${S.reader}`,
    "",
    `set Kernel.res_said = Kernel.said_${k}`,
    `set Kernel.res_absent = names([p for p in Persons where ${here} and p.fact_v${k} == "none" and p.judged_q${k} != true])`,
    `set Kernel.res_correct = names([p for p in Persons where ${here} and (${sureRight})])`,
  ];
  if (q.secretFromAgents === true) out.push(`set Kernel.res_found = count([p for p in Persons where ${right}])`, `set Kernel.res_sure = count([p for p in Persons where p.fact_c${k} == 100])`);
  out.push(
    `${S.reader}: ${q.lead ?? R.lead(n)} ${R.question} ${q.spoken ?? q.text}`,
    'if Kernel.res_said != "":',
    `  ${S.reader}: ${R.guesses} {Kernel.res_said}`,
    'if Kernel.res_absent != "":',
    `  ${S.reader}: ${R.absent} {Kernel.res_absent}`,
  );
  const correct = ['if Kernel.res_correct != "":', `  ${S.reader}: ${R.correct} {Kernel.res_correct}`];
  if (q.secretFromAgents === true) {
    const [sure, ...rest] = q.unfound!;
    out.push(
      "if Kernel.res_found > 0:",
      `  ${S.reader}: ${q.reading}`,
      ...correct.map((l) => `  ${l}`),
      "else:",
      "  if Kernel.res_sure > 0:",
      `    ${S.reader}: ${sure}`,
      ...rest.map((l) => `  ${S.reader}: ${l}`),
    );
  } else out.push(`${S.reader}: ${q.reading}`, ...correct);
  out.push("");
  return out;
}

// --- codex/9-facts.loom ----------------------------------------------------

function factsLoom(f: FactsFile): string {
  const out: string[] = [LOOM_BANNER.trimEnd()];
  out.push(
    "//",
    "// Codex 9: the house's print media — every scannable fact, by rarity tier",
    "// (facts.json `tiers`, commonest first). The hunt answers are in",
    `// ${OUTPUTS.questions}; a fact facts.json marks \`existing\` is told by a`,
    "// hand-written entry and is not repeated here.",
    "",
  );
  for (const [tier, meta] of Object.entries(f.tiers ?? {})) {
    const own = f.facts.filter((x) => x.tier === tier && x.codex !== undefined);
    if (own.length === 0) continue;
    out.push(`// ── ${meta.label.toUpperCase()} · ${meta.colour} · ${meta.stack} ──`, "");
    for (const x of own) {
      const c = x.codex!;
      out.push(`// ${x.id} · ${x.category} · ${meta.colour}${x.draft ? " · DRAFT" : ""}`, `CODEX ${c.id}`, `  title: ${c.title}`, `  category: ${SHOW_SHAPE.factCategory}`);
      if (c.about !== undefined) out.push(`  about: ${c.about}`);
      if (c.secret) out.push("  secret: true");
      out.push(`  code: ${c.code}`, "  text:", textBlock(c.text), "");
    }
  }
  if (f.door !== undefined) {
    const d = f.door.codex;
    out.push(
      "// ── THE DOOR · the server-room keypad (secret, never printed) ──",
      "// No unlock code: nobody types their way to it. A checkmate at the door",
      "// terminal, all four digit notes in one Codex (main.loom assembles",
      "// them) and the majority's Truther Download hand it out (main.loom,",
      "// beats/server-room.loom). `secret: true` keeps it out of every agent",
      "// request and the orchestrator's lore.",
      `CODEX ${d.id}`,
      `  title: ${d.title}`,
      `  category: ${SHOW_SHAPE.doorCategory}`,
      "  secret: true",
      "  text:",
      textBlock(d.text),
      "",
    );
    const clues = f.door.clues ?? [];
    if (clues.length > 0) {
      out.push(
        `// ── THE DOOR'S DIGITS · ${SHOW_SHAPE.clueColour} · one note per digit, hidden in the house ──`,
        "// Scannable all night; holding every one assembles The Door Code",
        "// (main.loom). Secret: never in an agent request, and Trabolta refuses",
        "// one shared to him. The poster prints the title and the code, never",
        "// the digit (it is only in the text).",
        "",
      );
      clues.forEach((c, i) => {
        out.push(
          `// ${POSITION_WORDS[i] ?? String(i + 1)} digit · ${SHOW_SHAPE.clueColour} · ${c.where}`,
          `CODEX ${c.id}`,
          `  title: ${c.title}`,
          `  category: ${SHOW_SHAPE.doorCategory}`,
          `  about: ${SHOW_SHAPE.clueAbout}`,
          "  secret: true",
          `  code: ${c.code}`,
          "  text:",
          textBlock(clueText(c, f.door!.code[i] ?? "")),
          "",
        );
      });
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

/** A placeholder question's answer, wherever a table would show it. */
export const OWED = "⚠ owed";

const HUNT_HEADER = "| # | Colour | Code | Title | Where in the Desktop | The question |\n|---|---|---|---|---|---|";
const HEADER = "| # | Topic | Code | Title | How it hides | What it says |\n|---|---|---|---|---|---|";
const CLUE_HEADER = "| Digit | Colour | Code | Title | Where in the house | What it is |\n|---|---|---|---|---|---|";

function printStacks(f: FactsFile): string {
  const S = SHOW_SHAPE;
  const out: string[] = [MD_BANNER.trimEnd(), "", `# ${f.show?.title ?? "The show"} — the Desktop's QR stacks`, ""];
  out.push(
    "Generated from `facts.json`: the hunt answers, then one stack per rarity",
    "tier, commonest first. Nobody tracks where a single fact card goes: sort the",
    "printed codex posters (Run → 🖨 Print sheet) by the colour band into these",
    "piles and scatter each pile the way its stack says. `DRAFT` rows await the team's sign-off in",
    "`facts.json`: a placeholder to replace, or a rewrite to approve. Print and",
    "hide them as they stand. A hand-written entry (`existing`) keeps the place",
    "README → QR placements gives it; it is listed so the colour is known.",
    "",
    `## ${S.huntColour[0]!.toUpperCase()}${S.huntColour.slice(1)} — the hunt answers`,
    "",
    "Each row says where its document hides; the hint is what a host may tell a",
    "stuck program. The answers themselves are in `facts.json` and the two cards that",
    "carry the key.",
    "",
    HUNT_HEADER,
  );
  for (const { questions } of rounds(f)) {
    for (const q of questions) {
      const c = q.codex!;
      const where = q.where! + (q.hint ? ` — hint: ${q.hint}` : "");
      out.push(`| ${q.id}${q.draft ? " · DRAFT" : ""} | ${S.huntColour} | \`${c.code}\` | ${cell(c.title)} | ${cell(where)} | ${cell(q.text)} |`);
    }
  }
  for (const d of f.documents ?? []) {
    const where = d.where + (d.hint ? ` — hint: ${d.hint}` : "");
    out.push(`| ${d.was}${d.draft ? " · DRAFT" : ""} | ${S.huntColour} | \`${d.codex.code}\` | ${cell(d.codex.title)} | ${cell(where)} | (a document: no question asks for it now) |`);
  }
  const clues = f.door?.clues ?? [];
  const tiers = Object.entries(f.tiers ?? {});
  if (tiers.length > 0) {
    out.push("", "## The tiers", "", "| Tier | Colour | Cards | How they hide |", "|---|---|---|---|");
    for (const [tier, meta] of tiers) {
      const n = f.facts.filter((x) => x.tier === tier).length + (tier === S.clueTier ? clues.length : 0);
      out.push(`| ${cell(meta.label)} | ${meta.colour} | ${n} | ${cell(meta.stack)} |`);
    }
  }
  for (const [tier, meta] of tiers) {
    const own = f.facts.filter((x) => x.tier === tier);
    if (own.length === 0) continue;
    out.push("", `## ${meta.label} — ${meta.colour}`, "", `Stack: ${meta.stack}`, "", HEADER);
    for (const x of own) out.push(stackRow(x, meta.stack));
  }
  if (clues.length > 0) {
    const colour = S.clueColour;
    const tierLabel = f.tiers?.[S.clueTier]?.label;
    out.push(
      "",
      `## ${colour[0]!.toUpperCase()}${colour.slice(1)} — ${S.clueStack}${tierLabel ? ` (${tierLabel.toLowerCase()})` : ""}`,
      "",
      `One note per digit of the door code, ${numberWord(clues.length)} in all. Hide each one where its`,
      "row says, never in the server room. The poster prints the title and the",
      "code; the digit is only in the Codex once scanned, and is never printed",
      "here. Scannable all night: all of them in one program's Codex assemble",
      "the door code.",
      "",
      CLUE_HEADER,
    );
    clues.forEach((c, i) => {
      out.push(`| ${POSITION_WORDS[i] ?? String(i + 1)} | ${colour} | \`${c.code}\` | ${cell(c.title)} | ${cell(c.where)} | ${cell(`the ${POSITION_WORDS[i] ?? "next"} digit of the door code (of ${numberWord(clues.length)})`)} |`);
    });
  }
  if (f.door?.clue !== undefined) {
    out.push(
      "",
      "## The cold door — the keypad sign",
      "",
      "Print this and tape it beside the server-room keypad. Never print the code",
      "itself: it reaches a program only through their Codex (a checkmate at the",
      "door terminal, every digit note, or the majority's Truther Download).",
      "",
      `> ${f.door.clue}`,
    );
  }
  out.push("");
  return out.join("\n");
}

/** Where a question's key stands, as a generated table shows it. The key itself
 *  is never in a doc (wave 58), and neither is a stand-in. */
const keyCell = (q: Question): string => (q.placeholder === true ? OWED : "in `facts.json`");

function stackRow(x: Fact, stack: string): string {
  const id = `${x.id}${x.draft ? " · DRAFT" : ""}`;
  if (x.codex !== undefined) return `| ${id} | ${x.category} | \`${x.codex.code}\` | ${cell(x.codex.title)} | ${cell(stack)} | ${cell(x.text)} |`;
  const code = x.code !== undefined ? `\`${x.code}\`` : "(no code)";
  return `| ${id} | ${x.category} | ${code} | ${cell(x.existing!)} (hand-written) | already placed — README → QR placements | ${cell(x.text)} |`;
}

// --- the marked blocks -----------------------------------------------------

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 10–99 in words: "ninety-seven", "nineteen", "forty". */
function twoDigitWords(n: number): string {
  if (n < 20) return TEENS[n - 10]!;
  return n % 10 === 0 ? TENS[n / 10]! : `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}`;
}

/** A code read digit by digit: "one nine nine seven" (`zero` = "zero" | "oh"). */
export function digitWords(code: string, zero = "zero"): string {
  return [...code].map((d) => (d === "0" ? zero : ONES[Number(d)]!)).join(" ");
}

/** A 19xx / 20xx year as it is said: "nineteen ninety-seven", "nineteen
 *  oh seven", "nineteen hundred", "two thousand", "two thousand seven",
 *  "twenty twelve". */
export function yearWords(year: string): string {
  const hi = Number(year.slice(0, 2));
  const lo = Number(year.slice(2));
  if (hi === 20 && lo < 10) return lo === 0 ? "two thousand" : `two thousand ${ONES[lo]}`;
  const head = twoDigitWords(hi);
  if (lo === 0) return `${head} hundred`;
  return lo < 10 ? `${head} oh ${ONES[lo]}` : `${head} ${twoDigitWords(lo)}`;
}

/** The words that make a bare two-digit year the year ("in 97", "since
 *  ninety-seven", "the summer of ninety-seven"; "back in 97" is "in 97").
 *  `of` only before the spoken year: "a balance of 97 Truthcoin" and "one
 *  of 97 programs" are counts (W8 recheck). */
const YEAR_LEADS = ["in", "since", "of"] as const;
const DIGIT_YEAR_LEADS: ReadonlySet<string> = new Set(["in", "since"]);

/** A patch-bay pair as `neverWords` writes it (`V2-D3`, `B7-A6`). */
const PAIR_WORD = /^[A-Z]+\d+-[A-Z]+\d+$/u;

/** The patch panel's own names for the wire's V<k> and D<i> (the firmware's
 *  `config.h`): what a Patch Sheet prints, and what a guest reads out. */
export const PANEL_JACKS: Readonly<Record<string, string>> = { V1: "B8", V2: "B7", V3: "B4", V4: "B2", D1: "A5", D2: "A7", D3: "A6", D4: "A4" };

/** A wire pair in the panel's names (`V2-D3` → `B7-A6`), or itself off the panel. */
export function panelPair(pair: string): string {
  const jacks = pair.split("-").map((end) => PANEL_JACKS[end]);
  return jacks.length === 2 && jacks.every((j) => j !== undefined) ? jacks.join("-") : pair;
}

/** What no line of the character's mind may ever carry, whoever typed it
 *  (`secrets.never`): the keypad code, the ways it is said (digit by
 *  digit; a year's '97, "in 97" / "since ninety-seven" / "of ninety-seven" and
 *  "nineteen ninety-seven" — never a bare 97, which a guest's program may
 *  be called) and every patch-bay pair, as the wire and as the panel write it
 *  (`V2-D3`, `B7-A6`; the worker matches any spelling and either way round,
 *  B7 → A6, A6 to B7 …, a code with separators, 1 9 9 7,
 *  and number words with any spacing). A program who tells him the code
 *  must not hand it to every other program's prompt through his notes, and
 *  a voice told to speak plainly says numbers in words. */
export function neverWords(f: FactsFile, combos: string[] = []): string[] {
  const out = new Set<string>();
  const code = f.door?.code.trim();
  if (code !== undefined && code !== "") {
    out.add(code);
    if (/^(?:19|20)\d\d$/u.test(code)) {
      const short = code.slice(2);
      out.add(`'${short}`);
      // Never the bare two digits: "NHL 97", "Office 97" and "Memory
      // usage: 97%" are not the code. Only the year as a time is.
      const said = Number(short) >= 10 ? twoDigitWords(Number(short)) : null;
      for (const lead of YEAR_LEADS) {
        if (DIGIT_YEAR_LEADS.has(lead)) out.add(`${lead} ${short}`);
        if (said !== null) out.add(`${lead} ${said}`);
      }
      out.add(yearWords(code));
    }
    if (/^\d{3,}$/u.test(code)) {
      out.add(digitWords(code));
      if (code.includes("0")) out.add(digitWords(code, "oh"));
    }
  }
  // The digit notes: a single digit can't be a never word (it would scrub
  // every number), so the notes' unlock codes and "the first digit" …
  // phrases are: a program telling him one never reaches his shared mind.
  const clues = f.door?.clues ?? [];
  for (const c of clues) out.add(c.code);
  clues.forEach((_, i) => {
    const word = POSITION_WORDS[i];
    if (word !== undefined) out.add(`${word} digit`);
  });
  for (const combo of combos) {
    for (const pair of combo.split(",")) {
      const p = pair.trim().toUpperCase().replace(/\s+/gu, "");
      if (PAIR_WORD.test(p)) out.add(p).add(panelPair(p));
    }
  }
  return [...out];
}

/** The keyed answers that are not hunt questions (`answers[]`: the pickup
 *  line, P1). He asks for the line and the house judges it (2026-10-19, the
 *  user's call): he must never be able to recognise it, so no line of his
 *  mind may carry it (a program who types it must not hand it to every
 *  other program's prompt through his notes) and his voice never says it.
 *  Each answer + alias, lowercased, plus the apostrophe-less spelling the
 *  judge's fold also accepts ("youre the one that i want"). */
export function answerNeverWords(f: FactsFile): string[] {
  const out = new Set<string>();
  for (const a of f.answers) {
    for (const form of [a.answer, ...a.accept]) {
      const w = norm(form).replace(/[\u2018\u2019]/gu, "'");
      if (w === "") continue;
      out.add(w);
      if (w.includes("'")) out.add(w.replace(/'/gu, ""));
    }
  }
  return [...out];
}

/** The combinations the hand-written story seeds (`SHOW_SHAPE.comboSeed`). */
export function comboSeeds(sources: Iterable<string>): string[] {
  const out: string[] = [];
  for (const src of sources) for (const m of src.matchAll(SHOW_SHAPE.comboSeed)) if (m[1]!.trim() !== "" && !out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** The `secrets:` YAML block: every question's topics (deduped, question
 *  order, the first new one of each question commented `# H1`), every
 *  answer + alias (lowercased, deduped), the lore marker, and what no line
 *  of his mind may carry (`neverWords`: the door code + the combo pairs;
 *  `answerNeverWords`: the pickup line). */
export function mindBlock(f: FactsFile, combos: string[] = []): string {
  // `secretFromAgents` (wave 59a): he asks it, so its topics stay, but its key
  // is never in a file his worker reads, `match` included.
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
  for (const q of f.questions) if (q.placeholder !== true && q.secretFromAgents !== true) for (const a of [q.answer, ...q.accept]) words.add(norm(a));
  for (const d of f.documents ?? []) for (const a of d.guard ?? []) words.add(norm(a));
  for (const w of words) out.push(`    - ${yamlScalar(w)}`);
  out.push("  lore:", `    - ${JSON.stringify(HUNT_MARKER)}`);
  const door = neverWords(f, combos);
  const line = answerNeverWords(f).filter((w) => !door.includes(w));
  const never = [...door, ...line];
  if (never.length > 0) {
    out.push("  never:");
    never.forEach((w, i) => {
      const entry = `    - ${JSON.stringify(w)}`;
      const firstClue = f.door?.clues?.[0]?.code;
      const tag =
        i === 0 && f.door !== undefined && door.length > 0
          ? "the door code"
          : w === firstClue
            ? "the digit notes"
            : PAIR_WORD.test(w) && !never.slice(0, i).some((x) => PAIR_WORD.test(x))
              ? "the patch-bay pairs"
              : i === door.length
                ? "the pickup line"
                : null;
      out.push(tag === null ? entry : `${entry.padEnd(26)} # ${tag}`);
    });
  }
  return out.join("\n");
}

/** The H1–F3 table: the questions only. Since wave 58 no doc states a key, so
 *  `stagehand/tests/test_secrets.py` reads the answers from `facts.json`. */
export function designBlock(f: FactsFile): string {
  const out: string[] = [
    "_Generated from `facts.json` by `core/scripts/titi-facts.ts` — DO NOT EDIT this block;",
    `edit \`facts.json\`, then \`${RERUN}\`. The six-stamp pickup-line`,
    "mechanic was retired 2026-10-16 (U9): the line is learnable from Sandy's lore codex",
    "and asked via the ask-14 DM. The answers, their accepted forms, the unlock codes and",
    "where each document hides are in `facts.json` and never in a doc._",
    "",
    "| # | Round | Question (exact, as shown on the TV and in the quest log) | Key |",
    "|---|---|---|---|",
  ];
  for (const q of f.questions) out.push(`| ${q.id} | ${q.round} | ${cell(q.text)} | ${keyCell(q)} |`);
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
  for (const d of facts.documents ?? []) codexConflict(d.codex.id, d.codex.code, `document ${d.was}`);
  if (facts.door !== undefined && model.codex.has(facts.door.codex.id)) out.push(`door: CODEX ${JSON.stringify(facts.door.codex.id)} is already declared by a hand-written file`);
  for (const c of facts.door?.clues ?? []) codexConflict(c.id, c.code, `door clue ${JSON.stringify(c.id)}`);
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
    for (const q of facts.questions.filter((x) => x.round === r)) if (has(model.beats.keys(), SHOW_SHAPE.reading.beat(q.id))) out.push(`question ${q.id}: beat ${JSON.stringify(SHOW_SHAPE.reading.beat(q.id))} is already declared by a hand-written file`);
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
  current.combos = comboSeeds(handWrittenFiles(root).map((f) => f.source));
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
  for (const q of placeholderQuestions(facts)) log(`WARN  question ${q.id}: the answer key is still a placeholder. Filings on it are not recorded; do not print its gold card`);

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
