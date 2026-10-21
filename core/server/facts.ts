//! The facts judge (Wave 4, lane B; decision U10): the server-side half of
//! `facts.json`.
//!
//! The pure module `core/src/facts.ts` owns the file's types, the one
//! answer fold and the generic validation. This module turns a validated
//! file into a **book** the event runtime holds in memory (`FactsBook` —
//! every key's answer + aliases pre-folded), judges one filing against it
//! (`judgeAnswer`: accurate = fold-match; lie = no match at confidence 100;
//! uncertain = no match below; `judgeFiling` adds the **near miss** — a
//! filing `nearMatch` puts close to the key is never judged a lie or a guess
//! by itself: it is proposed accurate and goes to a director, in `auto`
//! mode too), reads the judging **mode** off the world
//! (`judgeMode`: `Night.judge_mode` = `auto` | `review`), and folds the
//! director's **ledger view** (`FactsWatch` → `ModView.facts`) off the sim
//! log, from two generic directives the story emits — `do fact_filed …` and
//! `do fact_judged …`. Nothing here names a program, a slot or a cue; the
//! key is never written to the world, the journal or a chat message.
//!
//! Mirrors `house-maps.ts`: the project-file helpers (`factsFileOf`,
//! `factsOf`), a fresh show-file read (`readFactsFile`, the LAN fallback).

import { readFileSync } from "node:fs";

import { nearMatch, spellOut } from "../src/answer-match.ts";
import { FACTS_FILE, isFactsFile, foldAnswer, parseFactsText, type FactVerdictKind, type FactsFile } from "../src/facts.ts";
import type { Sim } from "../src/runtime/sim/index.ts";
import type { ScreenOutcome, ScreenResultQuestion, ScreenRuled } from "./routes/screen.ts";

export { FACTS_FILE, isFactsFile, foldAnswer, parseFactsText, validateFacts, factsProblems } from "../src/facts.ts";
export type { FactsFile } from "../src/facts.ts";

/** What the judge says about one filing. */
export type FactVerdict = FactVerdictKind;
export const FACT_VERDICTS: readonly FactVerdict[] = ["accurate", "lie", "uncertain"];
export const isFactVerdict = (s: unknown): s is FactVerdict => typeof s === "string" && (FACT_VERDICTS as readonly string[]).includes(s);

/** The world path the mode is read from when `judge.mode_var` is absent. */
export const DEFAULT_MODE_VAR = "Night.judge_mode";
/** The confirm / override events when `judge.confirm` is absent. */
export const DEFAULT_CONFIRM: Readonly<Record<FactVerdict, string>> = { accurate: "fact_accurate", lie: "fact_lie", uncertain: "fact_uncertain" };

/** The judging mode: `auto` (every filing gets its verdict at once) or
 *  `review` (the verdict is a proposal until a director / host confirms). */
export type JudgeMode = "auto" | "review";

/** The highest confidence a filing carries; at it, a miss is a lie. */
export const CONFIDENCE_MAX = 100;

// ───────────────────────── the project file ─────────────────────────

/** The `facts.json` text among a project's files, or null. */
export function factsFileOf(files: Iterable<{ path: string; content: string }>): string | null {
  for (const f of files) if (isFactsFile(f.path)) return f.content;
  return null;
}

/** The `facts.json` string inside an untrusted data-file record (the
 *  event row's `house_maps` jsonb, a `/api/mod/load` body) — the only
 *  reader of that extra key, so every map reader stays unchanged. */
export function factsOf(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>)[FACTS_FILE];
  return typeof v === "string" ? v : null;
}

// ───────────────────────── the book ─────────────────────────

/** One key: a hunt question or a free-text answer, its answer + aliases folded. */
export interface FactsKey {
  id: string;
  /** The question's round; null for an `answers[]` key. */
  round: number | null;
  text: string;
  /** The key's canonical answer, as written (an accurate filing carries it
   *  to the story as `key_answer`, so a read-out never echoes an alias). */
  answer: string;
  folded: Set<string>;
  /** `folded` with abbreviations spelled out (`spellOut`): the second exact
   *  look, so `Mr. Pickles` / `11 yrs` / `extension 1978` are right. */
  spelled: Set<string>;
  /** The answer then every alias, as written (the near-miss look). */
  forms: string[];
}

export interface FactsBook {
  version: 1;
  /** The world path holding the mode. */
  modeVar: string;
  /** The story events a director fires to confirm / override a filing. */
  confirm: Record<FactVerdict, string>;
  questions: FactsKey[];
  answers: FactsKey[];
  /** The validated file (the generator's sections ride along, unread here). */
  raw: FactsFile;
}

export interface ParsedFactsBook {
  book: FactsBook | null;
  problems: string[];
}

/** A validated file as a book. */
export function bookOf(facts: FactsFile): FactsBook {
  const key = (id: string, round: number | null, text: string, answer: string, accept: readonly string[]): FactsKey => ({
    id,
    round,
    text,
    answer,
    folded: new Set([answer, ...accept].map(foldAnswer).filter((s) => s !== "")),
    spelled: new Set([answer, ...accept].map((f) => spellOut(foldAnswer(f))).filter((s) => s !== "")),
    forms: [answer, ...accept],
  });
  return {
    version: 1,
    modeVar: facts.judge?.mode_var ?? DEFAULT_MODE_VAR,
    confirm: { ...DEFAULT_CONFIRM, ...(facts.judge?.confirm ?? {}) },
    questions: facts.questions.map((q) => key(q.id, q.round, q.text, q.answer, q.accept)),
    answers: facts.answers.map((a) => key(a.id, null, a.text, a.answer, a.accept)),
    raw: facts,
  };
}

/** JSON + `validateFacts` → a book, or why not. */
export function parseFactsBook(text: string): ParsedFactsBook {
  const { facts, problems } = parseFactsText(text);
  return facts === null ? { book: null, problems } : { book: bookOf(facts), problems: [] };
}

/** Read a show-side file fresh (the LAN fallback, re-read on mtime change). */
export function readFactsFile(path: string): ParsedFactsBook {
  try {
    return parseFactsBook(readFileSync(path, "utf8"));
  } catch (err) {
    return { book: null, problems: [`unreadable: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

/** The key with this id among questions ∪ answers, or null. */
export function factsKey(book: FactsBook, keyId: string): FactsKey | null {
  return book.questions.find((k) => k.id === keyId) ?? book.answers.find((k) => k.id === keyId) ?? null;
}

// ───────────────────────── the verdict ─────────────────────────

/** An exact hit: the folded answer is a key form, or is one once both have
 *  their abbreviations spelled out (`Mr. Pickles` for `Mister Pickles`). */
function exactly(key: FactsKey, answer: string): boolean {
  const folded = foldAnswer(answer);
  return key.folded.has(folded) || key.spelled.has(spellOut(folded));
}

/**
 * Judge one filing (U10): `accurate` when the folded answer equals the key's
 * answer or one of its aliases (exact after folding, or after spelling out
 * abbreviations on both sides — `exactly` — never a substring);
 * `lie` when it doesn't and the filer was `CONFIDENCE_MAX` sure; `uncertain`
 * when it doesn't and they were less sure. Null for a key the book lacks.
 */
export function judgeAnswer(book: FactsBook, keyId: string, answer: string, confidence: number): FactVerdict | null {
  const key = factsKey(book, keyId);
  if (key === null) return null;
  if (exactly(key, answer)) return "accurate";
  return confidence >= CONFIDENCE_MAX ? "lie" : "uncertain";
}

/**
 * The key form (the answer or an alias, as written) a filing is a **near
 * miss** of — not an exact match after folding, but `nearMatch` puts it
 * close (`Mr Pickels` for `Mister Pickles`, `1,997` for `1997`). Null for an
 * exact match, a clear miss, or a key the book lacks.
 */
export function nearKey(book: FactsBook, keyId: string, answer: string): string | null {
  const key = factsKey(book, keyId);
  if (key === null || exactly(key, answer)) return null;
  return key.forms.find((f) => nearMatch(f, answer)) ?? null;
}

/** A 📝 filing's verdict and, for a near miss, the key form it is near. */
export interface FilingJudgement {
  verdict: FactVerdict;
  near: string | null;
  /** (wave 18b, O4) Not an exact match (the fold, an alias, `spellOut`):
   *  a near miss or a plain miss — the story's `judge:` character is asked
   *  to rule on it in `auto` mode. False for an exact match. */
  ask: boolean;
}

/**
 * Judge a 📝 filing (wave 11, C6; wave 18b, O4): `judgeAnswer`, except that a near miss
 * (`nearKey`) is never a lie or a guess by itself — it is **proposed
 * accurate** with `near` set, and the runtime routes that one filing down
 * the review path whatever the mode, so a director decides; left alone, a
 * round's settle takes the proposal, so a mistyped right answer is never
 * marked. Every filing that is not an exact match carries `ask` (wave 18b:
 * the `judge:` character rules on all of them in `auto` mode, not only on
 * the near misses). Null for a key the book lacks.
 */
export function judgeFiling(book: FactsBook, keyId: string, answer: string, confidence: number): FilingJudgement | null {
  const verdict = judgeAnswer(book, keyId, answer, confidence);
  if (verdict === null) return null;
  if (verdict === "accurate") return { verdict, near: null, ask: false };
  const near = nearKey(book, keyId, answer);
  return near === null ? { verdict, near: null, ask: true } : { verdict: "accurate", near, ask: true };
}

/** Is `answer` an exact match of the key (wave 18b: the one case nobody
 *  rules on)? False for a key the book lacks. */
export function isExact(book: FactsBook, keyId: string, answer: string): boolean {
  const key = factsKey(book, keyId);
  return key !== null && exactly(key, answer);
}

/** The mode the world holds at the book's `modeVar`: `review` exactly, else `auto`. */
export function judgeMode(book: FactsBook, read: (path: string) => string | undefined): JudgeMode {
  return read(book.modeVar) === "review" ? "review" : "auto";
}

/** A reader over a sim's world for `judgeMode`: strings as-is, numbers / bools rendered. */
export function worldReader(sim: Sim): (path: string) => string | undefined {
  return (path) => {
    const v = sim.world.peek(path);
    if (v === null) return undefined;
    switch (v.kind) {
      case "string":
        return v.value;
      case "number":
        return String(v.value);
      case "bool":
        return v.value ? "true" : "false";
      default:
        return undefined;
    }
  };
}

// ───────────────────────── the ledger view ─────────────────────────

/** The directive verbs the ledger view reads (`do fact_filed …`, `do fact_judged …`). */
export const FACT_FILED_VERB = "fact_filed";
export const FACT_JUDGED_VERB = "fact_judged";

/** A settled filing's outcome: the verdict, or `marked` (a guess settled at a reveal). */
export type FactFinal = FactVerdict | "marked";

/**
 * How a filing got its `final` (wave 5 issue 8), read off where its
 * `do fact_judged` line landed in the sim log:
 * - `auto` — in the same step as its filing (the judge's verdict stood at once);
 * - `confirmed` / `overridden` — in a step started by one of the book's
 *   confirm events (`judge.confirm`, the Run card's / a booth's 📝 buttons)
 *   for this person, final = / ≠ the judge's proposal;
 * - `settled` — any other later step (a review-mode proposal a reveal
 *   settled, a story rule) — `overridden` when it changed the proposal;
 * - `marked` — a guess marked at a reveal.
 */
export type FactHow = "auto" | "confirmed" | "overridden" | "settled" | "marked";

export interface FactsFiling {
  person: string;
  name: string;
  question: string;
  answer: string;
  confidence: number;
  /** The judge's proposal, journaled with the filing. */
  verdict: FactVerdict;
  /** Null while the filing is pending (review mode, not yet confirmed or settled). */
  final: FactFinal | null;
  /** How `final` was reached; null while pending. */
  how: FactHow | null;
  /** Who settled it: the director (a mod route's `by`), the booth's
   *  character, or the device that fired the step; null for the judge
   *  itself (`auto`), a story clock, or a step nobody is named for. */
  by: string | null;
  /** When this server first saw the filing (epoch ms) — re-stamped by a
   *  restart's replay, so it orders nothing after one (`logAt` does). */
  at: number;
  /** The sim log position of this filing's newest step (its filing, or the
   *  verdict that judged it): a restart replays the same log, so it keeps
   *  the night's order where `at` can't (the host's Judge tab sorts on it). */
  logAt?: number;
  /** A near miss (`nearKey`): the key form it is close to, for the director
   *  deciding it on the Judging card. Absent for an exact match or a clear
   *  miss; set by `FactsWatch.view` against the book in force. */
  near?: { key: string };
  /** The `judge:` character's ruling on this near miss (wave 11b, contract
   *  J): who ruled, same as the key or not, its one-line reason, when this
   *  server saw it. Kept after a director overrides it (the later verdict
   *  wins — `final` / `how` say so). Absent when nobody ruled. */
  ruling?: FactRuling;
  /** A ruling is asked and not yet given (the runtime's overlay): out with
   *  the judge's worker, or (wave 18b) still waiting in the judge queue. */
  asking?: true;
  /** (wave 18b) The ruling is still in the hub's judge queue, not yet sent. */
  queued?: true;
  /** (wave 18b) A `marked` filing: the final the mark replaced and how it
   *  was reached (a settle marks a guess, or a round-2 filing with no cup,
   *  after a ruling or a director already judged it). Absent when the
   *  filing was still pending at the mark, and on every other final. */
  before?: { final: FactVerdict; how: FactHow | null; by: string | null };
}

/** A `judge:` character's ruling on a filing (`FactsFiling.ruling`). */
export interface FactRuling {
  by: string;
  same: boolean;
  why: string;
  at: number;
}

/** The confirm-event arguments that mark a verdict as a ruling: journaled
 *  with the signal (`{question, ruling: "same" | "not", ruling_why}`), so a
 *  replay rebuilds the ruling off the journal alone. */
export const RULING_ARG = "ruling";
export const RULING_WHY_ARG = "ruling_why";

/** The ruling a confirm signal's journaled args carry, or null. */
export function rulingOfArgs(args: unknown): { same: boolean; why: string } | null {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return null;
  const r = (args as Record<string, unknown>)[RULING_ARG];
  if (r !== "same" && r !== "not") return null;
  const why = (args as Record<string, unknown>)[RULING_WHY_ARG];
  return { same: r === "same", why: typeof why === "string" ? why : "" };
}

/** The step a `fact_judged` line landed in (internal to the fold). */
interface FactsStep {
  /** Increments on every step boundary (a mutation mark, an external signal). */
  id: number;
  /** The external signal that started it, with its subject; null otherwise. */
  signal: string | null;
  subject: string | null;
  /** Who the runtime named for the mutation (`FactsWatch.mark`). */
  by: string | null;
  /** The mutation was a `judge:` character's ruling (`FactsWatch.mark`). */
  ruling: { same: boolean; why: string } | null;
}

/** A filing as the fold holds it: the public shape + where it was filed / judged. */
interface FoldedFiling extends FactsFiling {
  filedStep: number;
  judged: FactsStep | null;
  /** The final + step a `marked` replaced (`FactsFiling.before`). */
  premark: { final: FactVerdict; judged: FactsStep | null } | null;
}

export interface FactsTally {
  filed: number;
  accurate: number;
  lie: number;
  uncertain: number;
  /** U11: every filing matches the key and every confidence is 100. */
  consensus: boolean;
}

export interface FactsQuestion {
  id: string;
  round: number | null;
  text: string;
  filings: FactsFiling[];
  tally: FactsTally;
}

export interface FactsView {
  modeVar: string;
  mode: JudgeMode;
  confirm: Record<FactVerdict, string> | null;
  questions: FactsQuestion[];
  /** Filings with no `final` yet. */
  pending: number;
  /** The story's `judge:` character (wave 11b), who rules on near misses
   *  in `auto` mode — set by the runtime; absent when the story names none. */
  judge?: string;
}

/** `do fact_filed <personId> <keyId> <confidence> <verdict> <answer…>` → its parts, or null. */
export function parseFactFiled(args: string): { person: string; question: string; confidence: number; verdict: FactVerdict; answer: string } | null {
  const m = /^\s*(\S+)\s+(\S+)\s+(\d+)\s+(\S+)(?:\s+([\s\S]*?))?\s*$/u.exec(args);
  if (m === null) return null;
  const confidence = Number(m[3]);
  if (!Number.isInteger(confidence) || !isFactVerdict(m[4])) return null;
  return { person: m[1]!, question: m[2]!, confidence, verdict: m[4], answer: m[5] ?? "" };
}

/** `do fact_judged <personId> <keyId> <verdict|marked>` → its parts, or null. */
export function parseFactJudged(args: string): { person: string; question: string; final: FactFinal } | null {
  const m = /^\s*(\S+)\s+(\S+)\s+(\S+)\s*$/u.exec(args);
  if (m === null) return null;
  const final = m[3]!;
  if (!isFactVerdict(final) && final !== "marked") return null;
  return { person: m[1]!, question: m[2]!, final };
}

/** The tally over a question's filings (a `marked` final counts as uncertain). */
export function tallyFilings(filings: readonly FactsFiling[]): FactsTally {
  const t: FactsTally = { filed: filings.length, accurate: 0, lie: 0, uncertain: 0, consensus: false };
  for (const f of filings) {
    const effective = f.final ?? f.verdict;
    if (effective === "accurate") t.accurate += 1;
    else if (effective === "lie") t.lie += 1;
    else t.uncertain += 1;
  }
  t.consensus = filings.length > 0 && filings.every((f) => (f.final ?? f.verdict) === "accurate" && f.confidence === CONFIDENCE_MAX);
  return t;
}

/**
 * The director's ledger of filings, folded off the sim log like
 * `ScreenWatch`: a cursor over `sim.log` that advances on every look and
 * starts over when the sim object changes (a restart replays the journal
 * into a fresh one, so the replayed `fact_filed` lines rebuild it). One
 * filing per (person, question): a repeat replaces the earlier one in place.
 */
export class FactsWatch {
  private sim: Sim | null = null;
  private cursor = 0;
  private readonly filings = new Map<string, FoldedFiling>();
  private readonly now: () => number;
  /** Mutation boundaries the runtime reported (`mark`) not yet folded past:
   *  each starts a step at its log index. */
  private marks: Array<{ at: number; by: string | null; ruling: { same: boolean; why: string } | null }> = [];
  private step: FactsStep = { id: 0, signal: null, subject: null, by: null, ruling: null };
  /** `nearKey` per book, per (key, answer): a filing's near key never
   *  changes while the book stays the same, and `view` runs on every mod
   *  snapshot and director-phone poll. */
  private readonly nearCache = new WeakMap<FactsBook, Map<string, string | null>>();

  constructor(o: { now?: () => number } = {}) {
    this.now = o.now ?? Date.now;
  }

  private static key(person: string, question: string): string {
    return `${person}\u0000${question}`;
  }

  /** Follow `sim`, starting the fold over when it is a new one (a restart). */
  private bind(sim: Sim): void {
    if (sim === this.sim) return;
    this.sim = sim;
    this.cursor = 0;
    this.filings.clear();
    this.marks = [];
    this.step = { id: 0, signal: null, subject: null, by: null, ruling: null };
  }

  /**
   * The runtime is about to apply one mutation to `sim` (live, or replaying
   * the journal): what it logs from here on is one step, done by `by` (a
   * director's name, a booth's character, a device; null = nobody named).
   * Without marks the fold still splits steps at every external signal.
   * `ruling`: the mutation is a `judge:` character's ruling (`rulingOfArgs`
   * on its journaled args) — a filing it judges keeps it.
   */
  mark(sim: Sim, by: string | null, ruling: { same: boolean; why: string } | null = null): void {
    this.bind(sim);
    const at = sim.log.len();
    // A mark at the same index as the last one (the mutation before it
    // logged nothing — a quiet tick) starts an empty step: only the newest
    // names who does what is logged next. Collapsing keeps a quiet hour of
    // ticks from piling up a mark a second that no event ever folds past.
    const last = this.marks[this.marks.length - 1];
    if (last !== undefined && last.at === at) {
      last.by = by;
      last.ruling = ruling;
    } else this.marks.push({ at, by, ruling });
    // Fold as we go when nobody looks (a story with no key): the marks stay few.
    if (this.marks.length >= 512) this.sync(sim);
  }

  private sync(sim: Sim): void {
    this.bind(sim);
    const events = sim.log.all();
    let m = 0;
    for (; this.cursor < events.length; this.cursor++) {
      while (m < this.marks.length && this.marks[m]!.at <= this.cursor) {
        this.step = { id: this.step.id + 1, signal: null, subject: null, by: this.marks[m]!.by, ruling: this.marks[m]!.ruling };
        m++;
      }
      const e = events[this.cursor]!;
      if (e.type === "signal") {
        this.step = { id: this.step.id + 1, signal: e.name, subject: e.subject, by: this.step.by, ruling: this.step.ruling };
        continue;
      }
      if (e.type !== "directive") continue;
      if (e.verb === FACT_FILED_VERB) {
        const f = parseFactFiled(e.args);
        if (f === null) continue;
        const k = FactsWatch.key(f.person, f.question);
        const prev = this.filings.get(k);
        this.filings.set(k, {
          person: f.person,
          name: sim.persons.get(f.person)?.name ?? f.person,
          question: f.question,
          answer: f.answer,
          confidence: f.confidence,
          verdict: f.verdict,
          final: null,
          how: null,
          by: null,
          at: prev?.at ?? this.now(),
          logAt: this.cursor,
          filedStep: this.step.id,
          judged: null,
          premark: null,
        });
      } else if (e.verb === FACT_JUDGED_VERB) {
        const j = parseFactJudged(e.args);
        if (j === null) continue;
        const prev = this.filings.get(FactsWatch.key(j.person, j.question));
        if (prev !== undefined) {
          if (j.final !== "marked") prev.premark = null;
          else if (prev.final !== null && prev.final !== "marked") prev.premark = { final: prev.final, judged: prev.judged };
          prev.final = j.final;
          prev.logAt = this.cursor;
          prev.judged = { ...this.step };
          const r = this.step.ruling;
          if (r !== null && this.step.by !== null) prev.ruling = { by: this.step.by, same: r.same, why: r.why, at: this.now() };
        }
      }
    }
    // Marks at or before the cursor are folded; keep the rest (a mark taken
    // just before a mutation whose events are not logged yet).
    this.marks = this.marks.slice(m);
  }

  /** How a judged filing got its final, against the book's confirm events. */
  private static provenance(f: FoldedFiling, confirm: ReadonlySet<string>): Pick<FactsFiling, "how" | "by"> {
    const j = f.judged;
    if (f.final === null || j === null) return { how: null, by: null };
    if (f.final === "marked") return { how: "marked", by: j.by };
    if (j.id === f.filedStep) return { how: "auto", by: null };
    const changed = f.final !== f.verdict;
    if (j.signal !== null && confirm.has(j.signal) && (j.subject === null || j.subject === f.person)) {
      return { how: changed ? "overridden" : "confirmed", by: j.by };
    }
    return { how: changed ? "overridden" : "settled", by: j.by };
  }

  /** Every filing the sim has logged, in filing order (`confirm`: the
   *  book's confirm events, default `DEFAULT_CONFIRM`). */
  all(sim: Sim, confirm: Readonly<Record<FactVerdict, string>> = DEFAULT_CONFIRM): FactsFiling[] {
    this.sync(sim);
    const names = new Set(Object.values(confirm));
    return [...this.filings.values()].map((f) => {
      const { filedStep: _s, judged: _j, premark, ...pub } = f;
      const out: FactsFiling = { ...pub, ...FactsWatch.provenance(f, names) };
      if (f.final === "marked" && premark !== null) out.before = { final: premark.final, ...FactsWatch.provenance({ ...f, final: premark.final, judged: premark.judged }, names) };
      return out;
    });
  }

  /** `nearKey`, memoised per book. */
  nearOf(book: FactsBook, keyId: string, answer: string): string | null {
    let cache = this.nearCache.get(book);
    if (cache === undefined) {
      cache = new Map();
      this.nearCache.set(book, cache);
    }
    const k = FactsWatch.key(keyId, answer);
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    const near = nearKey(book, keyId, answer);
    cache.set(k, near);
    return near;
  }

  /** The view: the book's keys in order (questions, then answers), each
   *  with its filings + tally; a filing for a key the book lacks is listed
   *  after them under its own id, never dropped. */
  view(sim: Sim, book: FactsBook): FactsView {
    const filings = this.all(sim, book.confirm);
    const byQuestion = new Map<string, FactsFiling[]>();
    for (const f of filings) {
      const list = byQuestion.get(f.question);
      if (list === undefined) byQuestion.set(f.question, [f]);
      else list.push(f);
    }
    const questions: FactsQuestion[] = [];
    const seen = new Set<string>();
    for (const k of [...book.questions, ...book.answers]) {
      seen.add(k.id);
      const list = (byQuestion.get(k.id) ?? []).map((f) => {
        const near = this.nearOf(book, k.id, f.answer);
        return near === null ? f : { ...f, near: { key: near } };
      });
      questions.push({ id: k.id, round: k.round, text: k.text, filings: list, tally: tallyFilings(list) });
    }
    for (const [id, list] of byQuestion) {
      if (seen.has(id)) continue;
      questions.push({ id, round: null, text: id, filings: list, tally: tallyFilings(list) });
    }
    return {
      modeVar: book.modeVar,
      mode: judgeMode(book, worldReader(sim)),
      confirm: book.confirm,
      questions,
      pending: filings.filter((f) => f.final === null).length,
    };
  }
}

// ───────────────────────── the screens' results (wave 18b) ─────────────────────────

/** Rows (and liars) per question on the TV; `more` / `liarsMore` beyond. */
export const MAX_RESULT_ROWS = 40;

/** What `screenResultsOf` builds: a reading (`read`, the ids the story
 *  read) or the verdict (`verdict`, every book question with its truth). */
export interface ScreenResultsOptions {
  kind: "read" | "verdict";
  /** The poller is the TV (rows, the verdict's answers and liars). */
  tv: boolean;
  /** `verdict`: the story's `do fact_truth` per question id. */
  truths?: ReadonlyMap<string, "true" | "lie" | "none">;
}

/**
 * The public results of `ids` (book order) off the director's ledger view
 * (`FactsWatch.view` with the runtime's asking overlay). Never carries a
 * verdict, a confidence number, a ruling's `why` or `near`; see
 * `ScreenResults` for what each kind holds.
 */
export function screenResultsOf(view: FactsView, book: FactsBook, ids: readonly string[] | null, o: ScreenResultsOptions): ScreenResultQuestion[] {
  const byId = new Map(view.questions.map((q) => [q.id, q]));
  const want = ids === null ? book.questions.map((k) => k.id) : book.questions.map((k) => k.id).filter((id) => ids.includes(id));
  const out: ScreenResultQuestion[] = [];
  for (const id of want) {
    const n = book.questions.findIndex((k) => k.id === id) + 1;
    const key = book.questions[n - 1]!;
    const filings = byId.get(id)?.filings ?? [];
    const counts = { filed: filings.length, accepted: 0, guesses: 0, uncounted: 0 };
    for (const f of filings) {
      const out = screenOutcome(f);
      if (out === "a") counts.accepted += 1;
      else if (out === "g") counts.guesses += 1;
      else if (out === "u") counts.uncounted += 1;
    }
    const consensus = tallyFilings(filings).consensus;
    if (o.kind === "verdict") {
      const q: ScreenResultQuestion = { id, n, round: key.round, ...counts, consensus, answer: o.tv ? key.answer : null };
      const truth = o.truths?.get(id);
      if (truth !== undefined) q.truth = truth;
      if (o.tv) {
        // O2: the programs who lied — a final lie (the house, a ruling or a
        // director), or a pending filing proposed a lie. Names only.
        const liars = filings.filter((f) => f.final === "lie" || (f.final === null && f.verdict === "lie"));
        q.liars = liars.slice(0, MAX_RESULT_ROWS).map((f) => [clipText(f.name, 24), rulingMadeIt(f) && f.final === "lie" ? 1 : 0]);
        if (liars.length > MAX_RESULT_ROWS) q.liarsMore = liars.length - MAX_RESULT_ROWS;
      }
      out.push(q);
      continue;
    }
    const q: ScreenResultQuestion = { id, n, round: key.round, text: clipText(key.text, 140), ...counts, consensus, answer: consensus ? key.answer : null };
    if (o.tv) {
      q.rows = filings.slice(0, MAX_RESULT_ROWS).map((f) => [clipText(f.name, 24), clipText(f.answer, 40), f.confidence >= CONFIDENCE_MAX ? 1 : 0, screenOutcome(f), screenRuled(f)]);
      if (filings.length > MAX_RESULT_ROWS) q.more = filings.length - MAX_RESULT_ROWS;
    }
    out.push(q);
  }
  return out;
}

/** One line, at most `n` characters (newlines and runs of space → one space). */
function clipText(s: string, n: number): string {
  const one = s.replace(/\s+/gu, " ").trim();
  return Array.from(one).slice(0, n).join("");
}

/** A filing's public outcome (`ScreenOutcome`): never accurate vs lie. */
export function screenOutcome(f: FactsFiling): ScreenOutcome {
  if (f.final === null) return "p";
  if (f.final === "accurate" || f.final === "lie") return "a";
  if (f.final === "uncertain") return "g";
  // Marked: a guess stays a guess; an accepted filing with no cup is not
  // counted. Judge off the final the mark replaced (his ruling or a
  // director's), else the proposal (the filing was pending at the mark).
  return (f.before?.final ?? f.verdict) === "uncertain" ? "g" : "u";
}

/** Did the `judge:` character's ruling set this filing's final (not a
 *  director's later verdict)? */
function rulingMadeIt(f: FactsFiling): boolean {
  // A settle's mark keeps the stamp of the verdict it replaced.
  const s = f.final === "marked" ? f.before : f;
  return f.ruling !== undefined && s !== undefined && s.final !== null && s.final !== "marked" && s.by === f.ruling.by;
}

/** Trabolta's stamp on a filing (`ScreenRuled`, O4 / D10). */
export function screenRuled(f: FactsFiling): ScreenRuled {
  if (f.asking === true && f.final === null) return "?";
  if (!rulingMadeIt(f)) return "";
  if (f.confidence >= CONFIDENCE_MAX) return "r"; // held until the verdict (D11)
  return f.ruling!.same ? "s" : "n";
}
