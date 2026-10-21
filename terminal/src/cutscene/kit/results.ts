//! The results the story reads out (wave 18b, Q6), pure: what the reading
//! scenes (`hunt_results`, the `tally`, The Verdict) draw off the screen
//! state's `results` block (`screen.ts`, the server's `screenResultsOf`).
//!
//! - **The stamps.** A filing's public outcome (✔ ACCEPTED, ✘ GUESS, —
//!   NOT COUNTED, … PENDING) and Trabolta's ruling beside it (O4, D10):
//!   🤖 SAME / 🤖 NOT THE SAME below 100, 🤖 RULED at 100 (the result held
//!   until ⚖: same / not the same there would tell an accurate filing from
//!   a confident lie, D11), 🤖 … while he is asking, nothing for an exact
//!   match, the house rule or a director. Never his `why`.
//! - **The timelines.** A reading reveals one row every `ROW_MS`; the tally
//!   pages the round's questions, then lands its gauge; the verdict flips
//!   eight tiles, then (the TV only, O2) one page per question: the truth,
//!   the key answer and who lied.
//!
//! Every time here is ms into the scene (`t`); a scene from history is drawn
//! far in (`HISTORY_T`), so it lands on its final frame.

import type { ResultOutcome, ResultRow, ResultTruth, RulingStamp, ScreenResultQuestion, ScreenResults } from "../../screen.ts";

// --- the stamps ----------------------------------------------------------------------------

export type StampTone = "ok" | "no" | "skip" | "wait";

export interface Stamp {
  text: string;
  tone: StampTone;
}

/** A filing's public outcome as its stamp. */
export function outcomeStamp(out: ResultOutcome): Stamp {
  switch (out) {
    case "a":
      return { text: "✔ ACCEPTED", tone: "ok" };
    case "g":
      return { text: "✘ GUESS", tone: "no" };
    case "u":
      return { text: "— NOT COUNTED", tone: "skip" };
    default:
      return { text: "… PENDING", tone: "wait" };
  }
}

/** Trabolta's ruling stamp (O4, D10), or null: an exact match, the house rule, a director. */
export function rulingStamp(ruled: RulingStamp): Stamp | null {
  switch (ruled) {
    case "s":
      return { text: "🤖 SAME", tone: "ok" };
    case "n":
      return { text: "🤖 NOT THE SAME", tone: "no" };
    case "r":
      // At 100 his ruling decides accurate versus a confident lie: held until ⚖ (D11).
      return { text: "🤖 RULED", tone: "skip" };
    case "?":
      return { text: "🤖 …", tone: "wait" };
    default:
      return null;
  }
}

/** A question's truth at ⚖, as its tile says it. */
export function truthStamp(truth: ResultTruth | null): Stamp {
  if (truth === "true") return { text: "✔ TRUE", tone: "ok" };
  if (truth === "lie") return { text: "✘ LIE", tone: "no" };
  return { text: "— NOBODY ANSWERED", tone: "skip" };
}

// --- picking the block ----------------------------------------------------------------------

/** The block if it is of `kind`, else null. */
export function resultsOfKind(results: ScreenResults | null | undefined, kind: ScreenResults["kind"]): ScreenResults | null {
  return results !== null && results !== undefined && results.kind === kind ? results : null;
}

/**
 * The block a scene draws: the live one when it is of `kind`, else the last
 * one it saw (`held`) — the block rides every poll while its slide is up,
 * so a poll that lost it (a restart's gap) never blanks a reading half-way.
 * A new seq replaces the held one; the live block's rows (a stamp that
 * changes in place: 🤖 … → 🤖 SAME) always win over the held copy.
 */
export function latchResults(held: ScreenResults | null, live: ScreenResults | null | undefined, kind: ScreenResults["kind"]): ScreenResults | null {
  const now = resultsOfKind(live, kind);
  if (now !== null) return now;
  return held !== null && held.kind === kind ? held : null;
}

/** The question a reading of question `n` shows: the one numbered `n`, else the block's first. */
export function readQuestion(results: ScreenResults | null, n: number | null): ScreenResultQuestion | null {
  if (results === null || results.questions.length === 0) return null;
  if (n !== null) {
    // `n` is the round's question (1–3); the book's own `n` runs on through the night (H1–H3 = 1–3).
    const hit = results.questions.find((q) => q.n === n);
    if (hit !== undefined) return hit;
  }
  return results.questions[0]!;
}

// --- a reading (hunt_results, one tally page) ----------------------------------------------

/** One filing row every this long (≈ the time the TV takes to say one: "X said Y, certain."). */
export const ROW_MS = 2800;
/** A row's stamp lands this far into its turn (a fraction of `ROW_MS`). */
export const STAMP_AT = 0.6;
/** Rows on screen at once (the list scrolls by transform past this). */
export const ROWS_VISIBLE = 8;

/** Where a reading's parts land (ms into the scene), for a question with `rows` rows shown. */
export interface ReadingPlan {
  /** QUESTION n slams. */
  slam: number;
  /** The question's text types. */
  text: number;
  /** "n FILED" counts up. */
  filed: number;
  /** The first row. */
  rows: number;
  /** The last row's stamp has landed: the totals. */
  summary: number;
  /** NEXT … */
  next: number;
}

/** The reading of one question, starting at `start` (ms into the scene). */
export function readingPlan(rows: number, start = 0): ReadingPlan {
  const n = Math.max(0, Math.floor(rows));
  const rowsAt = start + 5200;
  const summary = n === 0 ? rowsAt : rowsAt + (n - 1) * ROW_MS + Math.round(ROW_MS * STAMP_AT) + 600;
  return { slam: start, text: start + 1200, filed: start + 3600, rows: rowsAt, summary, next: summary + 2000 };
}

/** How far row `i` is at `t`: `k` −1 not yet, then 0..1 (its slide-in); `stamp` 0 until its stamps land, then 0..1 (their landing). */
export function rowStateAt(plan: ReadingPlan, i: number, t: number): { k: number; stamp: number } {
  const at = plan.rows + i * ROW_MS;
  if (t < at) return { k: -1, stamp: 0 };
  const stampAt = at + ROW_MS * STAMP_AT;
  return { k: Math.min(1, (t - at) / 400), stamp: t < stampAt ? 0 : Math.max(0.001, Math.min(1, (t - stampAt) / 260)) };
}

/** Rows revealed by `t` (0..rows). */
export function rowsShown(plan: ReadingPlan, rows: number, t: number): number {
  if (t < plan.rows) return 0;
  return Math.min(rows, Math.floor((t - plan.rows) / ROW_MS) + 1);
}

/** The list's scroll (in rows) at `t`: the newest row stays in view, gliding over its slide-in. */
export function rowScroll(plan: ReadingPlan, rows: number, t: number, visible = ROWS_VISIBLE): number {
  const shown = rowsShown(plan, rows, t);
  if (shown <= visible) return 0;
  const last = rowStateAt(plan, shown - 1, t);
  return shown - visible - 1 + Math.max(0, last.k);
}

/** The reading's totals line: "ACCEPTED a · GUESSES g" (+ not counted, + pending). */
export function totalsLine(q: Pick<ScreenResultQuestion, "accepted" | "guesses" | "uncounted" | "filed">): string {
  const parts = [`ACCEPTED ${q.accepted}`, `GUESSES ${q.guesses}`];
  if (q.uncounted > 0) parts.push(`NOT COUNTED ${q.uncounted}`);
  const pending = q.filed - q.accepted - q.guesses - q.uncounted;
  if (pending > 0) parts.push(`PENDING ${pending}`);
  return parts.join(" · ");
}

/** What comes after round one's question `n` (wave 18b R21: the bottle after the third). */
export function nextAfter(n: number | null): string {
  if (n !== null && n >= 1 && n < 3) return `NEXT: QUESTION ${n + 1}`;
  return "NEXT: TRUTH OR DARE";
}

/** A row's answer as the screen quotes it (the server clips it already). */
export function saidText(row: Pick<ResultRow, "said">): string {
  return `“${row.said}”`;
}

// --- the tally (round two) ------------------------------------------------------------------

/** A page with no filings to read holds this long (its "Nobody filed." lands after the count). */
export const EMPTY_PAGE_MS = 6500;
/** After a page's NEXT, the next page this much later. */
const PAGE_GAP_MS = 600;

/** One tally page: its question and where it runs (ms into the scene). */
export interface TallyPage {
  q: ScreenResultQuestion;
  start: number;
  end: number;
  plan: ReadingPlan;
}

/** The round-two tally's pages, in book order, from `start`; then the gauge at `gauge`. */
export function tallyPages(questions: readonly ScreenResultQuestion[], start = 900): { pages: TallyPage[]; gauge: number } {
  const pages: TallyPage[] = [];
  let at = start;
  for (const q of questions) {
    const rows = q.rows?.length ?? 0;
    const plan = readingPlan(rows, at);
    const end = rows === 0 && q.filed === 0 ? at + EMPTY_PAGE_MS : plan.next;
    pages.push({ q, start: at, end, plan });
    at = end + PAGE_GAP_MS;
  }
  return { pages, gauge: at };
}

/** The tally page up at `t` (the last once they are all read), or null with none. */
export function tallyPageAt(pages: readonly TallyPage[], t: number): TallyPage | null {
  if (pages.length === 0) return null;
  for (const p of pages) if (t < p.end) return p;
  return pages[pages.length - 1]!;
}

/** The tally's gauge, after its pages: the needle hunts, then lands. */
export function tallyGauge(gauge: number): { gauge: number; land: number } {
  return { gauge, land: gauge + 3400 };
}

// --- the verdict ----------------------------------------------------------------------------

/** The verdict's timeline (ms into the scene; O2 / D11). */
export const VERDICT_PLAN = {
  /** The eight tiles begin to flip, one every `tileEvery`. */
  tiles: 800,
  tileEvery: 700,
  /** "x TRUE · y LIES · z UNANSWERED". */
  totals: 7000,
  /** EVERY ANSWERED FACT IS TRUE / A LIE IS ON RECORD. */
  stamp: 8400,
  /** The TV's pages: one per question, from here. */
  pages: 11_000,
  pageMs: 2500,
} as const;

/** The verdict scene's length: the pages for all eight questions, then it holds on the last. */
export const VERDICT_PAGES_MAX = 8;
export const VERDICT_MS = VERDICT_PLAN.pages + VERDICT_PAGES_MAX * VERDICT_PLAN.pageMs + 2500;
/** A wall's verdict (tiles + totals + stamp) ends here. */
export const VERDICT_WALL_MS = VERDICT_PLAN.pages + 1500;

/** The verdict's totals (questions with a truth). */
export function verdictTotals(questions: readonly Pick<ScreenResultQuestion, "truth">[]): { true: number; lies: number; none: number } {
  let t = 0;
  let l = 0;
  let n = 0;
  for (const q of questions) {
    if (q.truth === "true") t += 1;
    else if (q.truth === "lie") l += 1;
    else n += 1;
  }
  return { true: t, lies: l, none: n };
}

/** "x TRUE · y LIES · z UNANSWERED" (singulars kept plain). */
export function verdictTotalsLine(v: { true: number; lies: number; none: number }): string {
  return `${v.true} TRUE · ${v.lies} ${v.lies === 1 ? "LIE" : "LIES"} · ${v.none} UNANSWERED`;
}

/** The verdict's stamp: a lie on record, or every answered fact true. */
export function verdictStamp(v: { lies: number }): { text: string; win: boolean } {
  return v.lies > 0 ? { text: "A LIE IS ON RECORD", win: false } : { text: "EVERY ANSWERED FACT IS TRUE", win: true };
}

/** Does a TV verdict block carry the pages (O2: the key answers, the liars)? An older server's doesn't. */
export function verdictHasPages(questions: readonly Pick<ScreenResultQuestion, "answer" | "liars">[]): boolean {
  return questions.some((q) => q.answer !== null || q.liars !== null);
}

/** Which verdict page is up at `t` (0-based; the last one holds), or -1 before the pages. */
export function verdictPageAt(t: number, pages: number): number {
  if (pages <= 0 || t < VERDICT_PLAN.pages) return -1;
  return Math.min(pages - 1, Math.floor((t - VERDICT_PLAN.pages) / VERDICT_PLAN.pageMs));
}

/** A page's who-lied line: "Lied: A, B 🤖, C" (+N more), or "Nobody lied." Names only (D11). */
export function liarsLine(q: Pick<ScreenResultQuestion, "liars" | "liarsMore">): string {
  const list = q.liars ?? [];
  if (list.length === 0 && q.liarsMore === 0) return "Nobody lied.";
  const names = list.map((l) => (l.ruled ? `${l.who} 🤖` : l.who)).join(", ");
  return `Lied: ${names}${q.liarsMore > 0 ? ` +${q.liarsMore} more` : ""}`;
}

/** A round's chip on a tile ("R1"), or "" when the book has none. */
export function roundChip(round: number | null): string {
  return round !== null && round > 0 ? `R${round}` : "";
}
