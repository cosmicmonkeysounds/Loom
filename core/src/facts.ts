//! `facts.json` — a project's answer key + fact sheet (Wave 4, lane A).
//!
//! One file the team edits, a project file next to the `.loom` story
//! (like `house.json`): the hunt questions with their answers and
//! aliases, the free-text answer keys, the scannable facts the generator
//! turns into coded CODEX entries, and the Truth-or-Dare personal
//! questions. This module is pure (no I/O, no story names): the types,
//! the one answer fold every judge shares, the generic validation any
//! project gets, and the show-shaped rules the generator + its test apply
//! on top. The server's judge (`core/server/facts.ts`) builds its book
//! from `validateFacts`; the generator (`core/scripts/titi-facts.ts`)
//! reads the parsed file.

import { foldCode } from "./runtime/sim/model.ts";

/** The file's name, at the project root. */
export const FACTS_FILE = "facts.json";

/** Is `path` the project's facts file (exactly `facts.json` at the root)? */
export function isFactsFile(path: string): boolean {
  return path === FACTS_FILE;
}

// ───────────────────────── types ─────────────────────────

/** A fact category's key in `categories` (the file declares them — a
 *  colour + where that stack hides — so the engine never names one). */
export type FactCategory = string;

export interface CategoryMeta {
  /** The QR stack's colour, for the print sheet. */
  colour: string;
  /** Where that stack is hidden. */
  stack: string;
}

export interface RoundMeta {
  /** The round's QUEST title (pinned by the quests test). */
  questTitle: string;
  /** The QUEST text above the question bullets. */
  brief: string;
}

/** The printed document carrying a hunt answer. */
export interface QuestionCodex {
  id: string;
  title: string;
  code: string;
  text: string;
}

/** One hunt question: the key the judge matches a filing against. */
export interface Question {
  /** `/^[A-Za-z][A-Za-z0-9_-]{0,15}$/`, unique across `questions` ∪ `answers`. */
  id: string;
  /** Integer ≥ 1. */
  round: number;
  /** Exact words the reader speaks and the screens show. */
  text: string;
  /** The canonical answer. */
  answer: string;
  /** Aliases a filing may use instead (exact after `foldAnswer`). */
  accept: string[];
  /** Distinctive phrases of `text` a worker must never judge; never an answer word. */
  topics?: string[];
  /** The physical document + where it hides (print stacks, the design doc). */
  where?: string;
  /** What a host may tell a stuck program (print stacks only). */
  hint?: string;
  /** The printed document carrying the answer (generated as a CODEX). */
  codex?: QuestionCodex;
  /** Placeholder content the team must replace. */
  draft?: true;
}

/** A free-text answer key (an `answer` card), never listed on a card. */
export interface Answer {
  id: string;
  text: string;
  answer: string;
  accept: string[];
}

/** The generated CODEX for a scannable fact. */
export interface FactCodex {
  id: string;
  title: string;
  code: string;
  about?: string;
  secret?: true;
  text: string;
}

/** A scannable fact: told by an existing hand-written entry, or generated. */
export interface Fact {
  id: string;
  category: FactCategory;
  /** The team's own fact line, verbatim. */
  text: string;
  /** Already told by a hand-written CODEX: emit nothing; the id must exist. */
  existing?: string;
  /** With `existing`: the code that entry carries (or must gain) — cross-checked. */
  code?: string;
  /** The generated CODEX (required unless `existing`). */
  codex?: FactCodex;
  draft?: true;
}

/** A Truth-or-Dare personal question. */
export interface Truth {
  id: string;
  text: string;
  draft?: true;
}

/** One hidden note carrying one digit of the door code (wave 11): a
 *  `secret: true` CODEX with a QR code, scannable all night. Nothing a
 *  poster prints (the title, the code) and nothing the crew reads (the
 *  id, `where`) holds a digit; the generator writes the digit into the
 *  text in place of `{digit}`. */
export interface DoorClue {
  /** The CODEX id (no digit: the position in words). */
  id: string;
  /** The poster's title, e.g. `The Cold Door · the first digit` (no digit). */
  title: string;
  /** The QR unlock code (no digit, nothing like another clue's). */
  code: string;
  /** Where the crew hides it (a room of the house, never the server room). */
  where: string;
  /** The note's words: names its position in words and carries `{digit}`
   *  once (the generator fills it in); no other digit. */
  text: string;
}

/** The server-room door's keypad code (wave 7): set by hand on a
 *  standalone lock, never networked. The generator seeds it onto the secret
 *  Kernel and emits the secret CODEX that hands it out (a checkmate against
 *  the King at the door terminal, the majority's Truther Download, or all
 *  of the `clues` in one program's Codex — main.loom assembles them), plus
 *  one secret coded CODEX per clue. Changing it = this one edit +
 *  regenerate + reprogram the keypad by hand. */
export interface DoorConfig {
  /** 4–8 digits (a string, so a leading zero survives). */
  code: string;
  /** The printed sign by the keypad. Must not contain the code. */
  clue?: string;
  /** The secret CODEX carrying the code (no unlock code: nobody can type
   *  their way to it). Its text must contain the code. */
  codex: { id: string; title: string; text: string };
  /** One note per digit, in order (exactly `code.length` of them). */
  clues?: DoorClue[];
}

export type FactVerdictKind = "accurate" | "lie" | "uncertain";

/** How the server judges (every field optional; these are read by the judge). */
export interface JudgeConfig {
  /** The world path holding `auto` | `review`. */
  mode_var?: string;
  /** Story events a director fires to confirm / override a filing. */
  confirm?: Partial<Record<FactVerdictKind, string>>;
}

export interface FactsFile {
  version: 1;
  show?: { title: string };
  judge?: JudgeConfig;
  categories?: Record<FactCategory, CategoryMeta>;
  /** Keyed by round number (`"1"`, `"2"`, …). */
  rounds?: Record<string, RoundMeta>;
  questions: Question[];
  answers: Answer[];
  facts: Fact[];
  truths: Truth[];
  /** The server-room keypad (the show's; optional for any other project). */
  door?: DoorConfig;
  /** Unknown keys are kept, never dropped. */
  [extra: string]: unknown;
}

// ───────────────────────── the fold ─────────────────────────

/** The one fold every judge shares: NFKD, strip marks, lowercase, curly
 *  apostrophes to `'`, delete `'`, every other non-`[a-z0-9]` run to one
 *  space, trim, then one leading article. So `You're` ≡ `youre`,
 *  `Mister Pickles!` ≡ `the mister pickles`, `9:00 a.m.` → `9 00 a m`
 *  (authors add aliases). Exact equality after folding is a match; never a
 *  substring. */
export function foldAnswer(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[’‘`]/gu, "'")
    .replace(/'/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/^(?:the|a|an) /u, "");
}

// ───────────────────────── generic validation ─────────────────────────

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,15}$/u;
const WORD = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const DOTTED_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/u;
const VERDICTS: readonly FactVerdictKind[] = ["accurate", "lie", "uncertain"];

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";

export type ValidatedFacts = { ok: true; facts: FactsFile } | { ok: false; problems: string[] };

/** The rules any project gets: `version` 1; every question / answer has a
 *  well-formed unique id, a non-empty `answer` (non-empty after folding
 *  too), string `accept` aliases, a string `text`; a question's `round` is
 *  an integer ≥ 1; `judge.mode_var` is a dotted path and `judge.confirm`
 *  names events; the `facts` / `truths` / `rounds` / `categories` sections
 *  are well-shaped when present. Unknown keys are kept. */
export function validateFacts(raw: unknown): ValidatedFacts {
  const problems: string[] = [];
  if (!isRec(raw)) return { ok: false, problems: ["facts.json must be a JSON object"] };
  if (raw["version"] !== 1) problems.push(`version must be 1 (got ${JSON.stringify(raw["version"])})`);

  const list = (key: string): unknown[] => {
    const v = raw[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      problems.push(`${key} must be an array`);
      return [];
    }
    return v;
  };

  const ids = new Set<string>();
  const key = (kind: "questions" | "answers", x: unknown, i: number): Question | Answer | null => {
    const at = `${kind}[${i}]`;
    if (!isRec(x)) {
      problems.push(`${at} must be an object`);
      return null;
    }
    const id = x["id"];
    if (!isStr(id) || !ID.test(id)) problems.push(`${at}: id must match ${ID.source} (got ${JSON.stringify(id)})`);
    else if (ids.has(id)) problems.push(`${at}: duplicate id ${JSON.stringify(id)}`);
    else ids.add(id);
    const label = isStr(id) ? `${kind} ${id}` : at;
    if (!isStr(x["text"])) problems.push(`${label}: text must be a string`);
    const answer = x["answer"];
    if (!isStr(answer) || answer.trim() === "") problems.push(`${label}: answer must be a non-empty string`);
    else if (foldAnswer(answer) === "") problems.push(`${label}: answer ${JSON.stringify(answer)} folds to nothing`);
    let accept: string[] = [];
    if (x["accept"] !== undefined) {
      if (!Array.isArray(x["accept"]) || !x["accept"].every(isStr)) problems.push(`${label}: accept must be an array of strings`);
      else {
        accept = x["accept"];
        for (const a of accept) if (foldAnswer(a) === "") problems.push(`${label}: alias ${JSON.stringify(a)} folds to nothing`);
      }
    }
    if (kind === "questions") {
      const r = x["round"];
      if (!Number.isInteger(r) || (r as number) < 1) problems.push(`${label}: round must be an integer ≥ 1 (got ${JSON.stringify(r)})`);
      if (x["topics"] !== undefined && (!Array.isArray(x["topics"]) || !x["topics"].every(isStr))) problems.push(`${label}: topics must be an array of strings`);
      for (const k of ["where", "hint"] as const) if (x[k] !== undefined && !isStr(x[k])) problems.push(`${label}: ${k} must be a string`);
      if (x["codex"] !== undefined) checkCodex(x["codex"], `${label}: codex`, problems, false);
    }
    return { ...x, accept } as Question | Answer;
  };

  const questions = list("questions").map((x, i) => key("questions", x, i)).filter((q): q is Question => q !== null);
  const answers = list("answers").map((x, i) => key("answers", x, i)).filter((a): a is Answer => a !== null);

  const factIds = new Set<string>();
  const facts = list("facts").flatMap((x, i): Fact[] => {
    const at = `facts[${i}]`;
    if (!isRec(x)) {
      problems.push(`${at} must be an object`);
      return [];
    }
    const id = x["id"];
    if (!isStr(id) || id.trim() === "") problems.push(`${at}: id must be a non-empty string`);
    else if (factIds.has(id)) problems.push(`${at}: duplicate fact id ${JSON.stringify(id)}`);
    else factIds.add(id);
    const label = isStr(id) ? `fact ${id}` : at;
    if (!isStr(x["category"]) || x["category"] === "") problems.push(`${label}: category must be a non-empty string`);
    if (!isStr(x["text"])) problems.push(`${label}: text must be a string`);
    if (x["existing"] !== undefined && (!isStr(x["existing"]) || x["existing"] === "")) problems.push(`${label}: existing must name a codex entry`);
    if (x["code"] !== undefined && !isStr(x["code"])) problems.push(`${label}: code must be a string`);
    if (x["codex"] !== undefined) checkCodex(x["codex"], `${label}: codex`, problems, true);
    return [x as unknown as Fact];
  });

  const truthIds = new Set<string>();
  const truths = list("truths").flatMap((x, i): Truth[] => {
    const at = `truths[${i}]`;
    if (!isRec(x)) {
      problems.push(`${at} must be an object`);
      return [];
    }
    const id = x["id"];
    if (!isStr(id) || id.trim() === "") problems.push(`${at}: id must be a non-empty string`);
    else if (truthIds.has(id)) problems.push(`${at}: duplicate truth id ${JSON.stringify(id)}`);
    else truthIds.add(id);
    if (!isStr(x["text"]) || x["text"].trim() === "") problems.push(`${isStr(id) ? `truth ${id}` : at}: text must be a non-empty string`);
    return [x as unknown as Truth];
  });

  const judge = raw["judge"];
  if (judge !== undefined) {
    if (!isRec(judge)) problems.push("judge must be an object");
    else {
      if (judge["mode_var"] !== undefined && (!isStr(judge["mode_var"]) || !DOTTED_PATH.test(judge["mode_var"]))) problems.push(`judge.mode_var must be a dotted world path (got ${JSON.stringify(judge["mode_var"])})`);
      const confirm = judge["confirm"];
      if (confirm !== undefined) {
        if (!isRec(confirm)) problems.push("judge.confirm must be an object");
        else {
          for (const [k, v] of Object.entries(confirm)) {
            if (!(VERDICTS as readonly string[]).includes(k)) problems.push(`judge.confirm.${k}: unknown verdict (one of ${VERDICTS.join(", ")})`);
            else if (!isStr(v) || !WORD.test(v)) problems.push(`judge.confirm.${k} must be an event name (got ${JSON.stringify(v)})`);
          }
        }
      }
    }
  }

  const show = raw["show"];
  if (show !== undefined && (!isRec(show) || !isStr(show["title"]))) problems.push("show.title must be a string");

  const rounds = raw["rounds"];
  if (rounds !== undefined) {
    if (!isRec(rounds)) problems.push("rounds must be an object keyed by round number");
    else {
      for (const [k, v] of Object.entries(rounds)) {
        if (!/^[1-9][0-9]*$/u.test(k)) problems.push(`rounds.${k}: the key must be a round number`);
        if (!isRec(v) || !isStr(v["questTitle"]) || !isStr(v["brief"])) problems.push(`rounds.${k} needs questTitle + brief strings`);
      }
    }
  }

  const categories = raw["categories"];
  if (categories !== undefined) {
    if (!isRec(categories)) problems.push("categories must be an object keyed by category");
    else {
      for (const [k, v] of Object.entries(categories)) {
        if (!isRec(v) || !isStr(v["colour"]) || !isStr(v["stack"])) problems.push(`categories.${k} needs colour + stack strings`);
      }
      for (const f of facts) if (isStr(f.category) && !(f.category in categories)) problems.push(`fact ${f.id}: category ${JSON.stringify(f.category)} is not declared in categories`);
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, facts: { ...raw, version: 1, questions, answers, facts, truths } as FactsFile };
}

function checkCodex(x: unknown, label: string, problems: string[], allowAbout: boolean): void {
  if (!isRec(x)) {
    problems.push(`${label} must be an object`);
    return;
  }
  for (const k of ["id", "title", "code", "text"] as const) if (!isStr(x[k]) || x[k] === "") problems.push(`${label}.${k} must be a non-empty string`);
  if (allowAbout) {
    if (x["about"] !== undefined && (!isStr(x["about"]) || x["about"] === "")) problems.push(`${label}.about must be a non-empty string`);
    if (x["secret"] !== undefined && x["secret"] !== true) problems.push(`${label}.secret must be true when present`);
  }
}

/** The parsed file, or why not. */
export interface ParsedFacts {
  facts: FactsFile | null;
  problems: string[];
}

/** JSON + `validateFacts`. */
export function parseFactsText(text: string): ParsedFacts {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { facts: null, problems: [`not JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const v = validateFacts(raw);
  return v.ok ? { facts: v.facts, problems: [] } : { facts: null, problems: v.problems };
}

/** Every generic problem with a file's text (empty when it validates). */
export function factsProblems(text: string): string[] {
  return parseFactsText(text).problems;
}

// ───────────────────────── the show's rules ─────────────────────────

/** The hunt's shape: three rounds of 3 / 3 / 2, in this order. */
export const SHOW_QUESTION_LAYOUT: ReadonlyArray<{ id: string; round: number }> = [
  { id: "H1", round: 1 },
  { id: "H2", round: 1 },
  { id: "H3", round: 1 },
  { id: "H4", round: 2 },
  { id: "H5", round: 2 },
  { id: "H6", round: 2 },
  { id: "F1", round: 3 },
  { id: "F2", round: 3 },
];

/** At least this many Truth-or-Dare questions. */
export const SHOW_MIN_TRUTHS = 15;

/** Unlock codes: capitals, digits and hyphens, no apostrophes. */
export const CODE = /^[A-Z0-9][A-Z0-9-]*$/u;

/** A keypad code: 4–8 digits. */
export const DOOR_CODE = /^[0-9]{4,8}$/u;

/** A door clue's position in words, 1-based (`first` … `eighth`). */
export const POSITION_WORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"] as const;

/** The placeholder a clue's text carries for its digit. */
export const DIGIT_SLOT = "{digit}";

/** A door clue's text with its digit filled in. */
export function clueText(clue: DoorClue, digit: string): string {
  return clue.text.split(DIGIT_SLOT).join(digit);
}

const ANY_DIGIT = /[0-9]/u;

/** Characters that break a generated string literal / `match` arm line. */
const BAD_TEXT = /["{}|]/u;

/** The rules the generator and its test apply to the show's file (on top
 *  of `validateFacts`): exactly the 8 questions H1–H6 / F1–F2 in rounds
 *  3 / 3 / 2, each with a `where`, a `codex` and ≥ 1 topic that occurs
 *  in its text and in no answer or alias of any question; every round and
 *  category used is declared; `show.title` present; ≥ 15 truths; every
 *  codex id and every code (questions', facts', the codes recorded on
 *  `existing` facts) unique, codes matching `CODE`; no `"`, `{`, `}` or
 *  `|` in a question's or a truth's text; a `character` fact's codex has
 *  an `about`; a fact is `existing` xor has a `codex`; a `door`, when
 *  present, has a 4–8 digit `code`, a clue that never contains it, a
 *  codex (unique id) whose text does, and — with `clues` — one note per
 *  digit (`doorProblems`). */
export function showFactsProblems(f: FactsFile): string[] {
  const problems: string[] = [];

  if (!f.show || !f.show.title) problems.push("show.title is missing");

  const layout = SHOW_QUESTION_LAYOUT.map((q) => `${q.id}@${q.round}`).join(" ");
  const got = f.questions.map((q) => `${q.id}@${q.round}`).join(" ");
  if (got !== layout) problems.push(`questions must be exactly ${layout} in that order (got ${got || "none"})`);

  const rounds = f.rounds ?? {};
  for (const r of new Set(f.questions.map((q) => String(q.round)))) if (!(r in rounds)) problems.push(`rounds.${r} is not declared`);

  const codexIds = new Map<string, string>();
  const codes = new Map<string, string>();
  const claim = (map: Map<string, string>, k: string, by: string, what: string) => {
    const prev = map.get(k);
    if (prev !== undefined) problems.push(`${by}: ${what} ${JSON.stringify(k)} is also used by ${prev}`);
    else map.set(k, by);
  };
  const checkCode = (code: string, by: string) => {
    if (!CODE.test(code)) problems.push(`${by}: code ${JSON.stringify(code)} must match ${CODE.source}`);
    claim(codes, foldCode(code), by, "code");
  };

  const keys = f.questions.map((q) => [q.answer, ...q.accept].map((a) => a.toLowerCase()));
  for (const q of f.questions) {
    const by = `question ${q.id}`;
    if (BAD_TEXT.test(q.text)) problems.push(`${by}: text must not contain " { } or |`);
    if (!q.where) problems.push(`${by}: where is missing`);
    if (!q.codex) problems.push(`${by}: codex is missing`);
    else {
      claim(codexIds, q.codex.id, by, "codex id");
      checkCode(q.codex.code, by);
    }
    const topics = q.topics ?? [];
    if (topics.length === 0) problems.push(`${by}: needs at least one topic`);
    const text = q.text.toLowerCase();
    for (const t of topics) {
      const needle = t.toLowerCase();
      if (needle.trim() === "") {
        problems.push(`${by}: empty topic`);
        continue;
      }
      if (!text.includes(needle)) problems.push(`${by}: topic ${JSON.stringify(t)} does not occur in its text`);
      f.questions.forEach((other, i) => {
        for (const a of keys[i]!) if (a.includes(needle)) problems.push(`${by}: topic ${JSON.stringify(t)} occurs in an answer of ${other.id} (${JSON.stringify(a)})`);
      });
    }
  }

  const categories = f.categories ?? {};
  for (const fact of f.facts) {
    const by = `fact ${fact.id}`;
    if (!(fact.category in categories)) problems.push(`${by}: category ${JSON.stringify(fact.category)} is not declared in categories`);
    if (fact.existing !== undefined && fact.codex !== undefined) problems.push(`${by}: existing and codex are exclusive`);
    if (fact.existing === undefined && fact.codex === undefined) problems.push(`${by}: needs existing or codex`);
    if (fact.code !== undefined) {
      if (fact.existing === undefined) problems.push(`${by}: code belongs on an existing fact (a generated fact's code is codex.code)`);
      else checkCode(fact.code, by);
    }
    if (fact.codex) {
      claim(codexIds, fact.codex.id, by, "codex id");
      checkCode(fact.codex.code, by);
      if (fact.category === "character" && !fact.codex.about) problems.push(`${by}: a character fact's codex needs an about`);
    }
  }

  if (f.truths.length < SHOW_MIN_TRUTHS) problems.push(`truths: need at least ${SHOW_MIN_TRUTHS} (got ${f.truths.length})`);
  for (const t of f.truths) if (BAD_TEXT.test(t.text)) problems.push(`truth ${t.id}: text must not contain " { } or |`);

  if (f.door !== undefined) problems.push(...doorProblems(f.door, codexIds, codes));

  return problems;
}

/** The keypad's rules: a 4–8 digit string code; a codex with a non-empty
 *  id / title / text whose text carries the code and whose id is nobody
 *  else's; a clue (the printed sign) that never gives the code away; and
 *  `clues`, when present: exactly one per digit, each with an id, title,
 *  code and `where` holding no digit (a poster prints the title + code),
 *  a code matching `CODE` that no other entry carries, an id nobody else
 *  uses, and a text naming its own position in words with `{digit}` once
 *  and no other digit. */
function doorProblems(raw: unknown, codexIds: Map<string, string>, codes: Map<string, string>): string[] {
  const problems: string[] = [];
  if (!isRec(raw)) return ["door must be an object"];
  const code = raw["code"];
  if (!isStr(code) || !DOOR_CODE.test(code)) problems.push(`door.code must be a string of 4–8 digits (got ${JSON.stringify(code)})`);
  const clue = raw["clue"];
  if (clue !== undefined) {
    if (!isStr(clue) || clue.trim() === "") problems.push("door.clue must be a non-empty string");
    else if (isStr(code) && code !== "" && clue.includes(code)) problems.push("door.clue gives the code away");
  }
  const c = raw["codex"];
  if (!isRec(c)) {
    problems.push("door.codex is missing");
  } else {
    for (const k of ["id", "title", "text"] as const) if (!isStr(c[k]) || (c[k] as string).trim() === "") problems.push(`door.codex.${k} is missing`);
    if (isStr(c["id"]) && codexIds.has(c["id"])) problems.push(`door: codex id ${JSON.stringify(c["id"])} is also used by ${codexIds.get(c["id"])}`);
    if (isStr(c["text"]) && isStr(code) && DOOR_CODE.test(code) && !c["text"].includes(code)) problems.push("door.codex.text must carry the code");
  }
  const clues = raw["clues"];
  if (clues !== undefined) problems.push(...clueProblems(clues, isStr(code) && DOOR_CODE.test(code) ? code : null, isRec(c) && isStr(c["id"]) ? c["id"] : null, codexIds, codes));
  return problems;
}

function clueProblems(raw: unknown, code: string | null, doorId: string | null, codexIds: Map<string, string>, codes: Map<string, string>): string[] {
  if (!Array.isArray(raw)) return ["door.clues must be an array"];
  const problems: string[] = [];
  if (code !== null && raw.length !== code.length) problems.push(`door.clues: need one per digit of the code (${code.length}, got ${raw.length})`);
  const ids = new Set<string>();
  const own = new Set<string>();
  raw.forEach((x, i) => {
    const at = `door.clues[${i}]`;
    if (!isRec(x)) {
      problems.push(`${at} must be an object`);
      return;
    }
    for (const k of ["id", "title", "code", "where", "text"] as const) {
      const val = x[k];
      if (!isStr(val) || val.trim() === "") problems.push(`${at}.${k} is missing`);
      else if (k !== "text" && ANY_DIGIT.test(val)) problems.push(`${at}.${k} must not contain a digit (write the position in words): ${JSON.stringify(val)}`);
    }
    const id = x["id"];
    if (isStr(id) && id.trim() !== "") {
      if (codexIds.has(id)) problems.push(`${at}: codex id ${JSON.stringify(id)} is also used by ${codexIds.get(id)}`);
      if (id === doorId || ids.has(id)) problems.push(`${at}: codex id ${JSON.stringify(id)} is used twice`);
      ids.add(id);
    }
    const cc = x["code"];
    if (isStr(cc) && cc.trim() !== "") {
      if (!CODE.test(cc)) problems.push(`${at}: code ${JSON.stringify(cc)} must match ${CODE.source}`);
      const k = foldCode(cc);
      if (codes.has(k)) problems.push(`${at}: code ${JSON.stringify(cc)} is also used by ${codes.get(k)}`);
      if (own.has(k)) problems.push(`${at}: code ${JSON.stringify(cc)} is used twice`);
      own.add(k);
    }
    const text = x["text"];
    if (isStr(text) && text.trim() !== "") {
      const slots = text.split(DIGIT_SLOT).length - 1;
      if (slots !== 1) problems.push(`${at}.text must carry ${DIGIT_SLOT} exactly once (got ${slots})`);
      if (ANY_DIGIT.test(text.split(DIGIT_SLOT).join(""))) problems.push(`${at}.text must not contain a digit but its own ${DIGIT_SLOT}`);
      const word = POSITION_WORDS[i];
      if (word !== undefined && !new RegExp(`\\b${word}\\b`, "iu").test(text)) problems.push(`${at}.text must name its position (${JSON.stringify(word)})`);
      if (/["{}|]/u.test(text.split(DIGIT_SLOT).join(""))) problems.push(`${at}.text must not contain " { } or | (but its ${DIGIT_SLOT})`);
    }
  });
  return problems;
}
