//! The reading scenes' shared pieces (wave 18b, Q6): a filing's stamps and
//! the scrolling list of filings Trabolta reads out. Pure pictures of `t`
//! (`results.ts` says where everything lands). Sizes are in `em` off the
//! TV's 16:9 stage (1 em = 1/60 of its width).

import "./results.css";
import { useRef } from "react";
import type { ResultRow, ResultOutcome, RulingStamp, ScreenResultQuestion, ScreenResults, ScreenState } from "../../screen.ts";
import { ROWS_VISIBLE, latchResults, outcomeStamp, rowRuling, rowScroll, rowStateAt, saidText, type ReadingPlan, type Stamp } from "./results.ts";

/** The screen state's results block of `kind`, held across a poll that lost it (`latchResults`). */
export function useHeldResults(state: Pick<ScreenState, "results">, kind: ScreenResults["kind"]): ScreenResults | null {
  const held = useRef<ScreenResults | null>(null);
  held.current = latchResults(held.current, state.results, kind);
  return held.current;
}

/** One row's height (em). */
export const ROW_EM = 1.9;

/** A stamp badge (`res-stamp ok|no|skip|wait`). `k` 0..1 is its landing (scale from big). */
export function StampBadge({ stamp, k = 1, reduced, className }: { stamp: Stamp; k?: number; reduced: boolean; className?: string }) {
  const s = reduced ? 1 : 2.2 - 1.2 * Math.min(1, k);
  return (
    <span className={`res-stamp ${stamp.tone}${className ? ` ${className}` : ""}`} style={{ opacity: Math.min(1, k * 2), transform: reduced ? undefined : `scale(${s.toFixed(3)}) rotate(${(-3 * Math.min(1, k)).toFixed(1)}deg)` }}>
      {stamp.text}
    </span>
  );
}

/** A filing's two stamps: the outcome, and his ruling beside it (O4) — none for an
 *  exact match, and none on a sure row before ⚖ (`rowRuling`, D11). */
export function RowStamps({ out, ruled, sure, k, reduced }: { out: ResultOutcome; ruled: RulingStamp; sure: boolean; k: number; reduced: boolean }) {
  const rule = rowRuling({ sure, ruled });
  return (
    <span className="res-stamps">
      <StampBadge stamp={outcomeStamp(out)} k={k} reduced={reduced} />
      {rule !== null && <StampBadge stamp={rule} k={k} reduced={reduced} className="rule" />}
    </span>
  );
}

function Row({ row, i, k, stampK, reduced }: { row: ResultRow; i: number; k: number; stampK: number; reduced: boolean }) {
  return (
    <div className="res-row" style={{ top: `${(i * ROW_EM).toFixed(2)}em`, opacity: Math.min(1, k * 1.5), transform: reduced ? undefined : `translate3d(${((1 - k) * 4).toFixed(2)}em, 0, 0)` }}>
      <span className="res-who">{row.who}</span>
      <span className="res-said">{saidText(row)}</span>
      <span className={`res-sure${row.sure ? " sure" : ""}`}>{row.sure ? "SURE" : "NOT SURE"}</span>
      {stampK > 0 ? <RowStamps out={row.out} ruled={row.ruled} sure={row.sure} k={stampK} reduced={reduced} /> : <span className="res-stamps" />}
    </div>
  );
}

/**
 * The filings of one question as he reads them: a row slides in every
 * `ROW_MS`, its stamps land a beat later, and the list scrolls (transform
 * only) so the newest row stays in view. Only the rows on screen are drawn.
 * Live: a row whose stamp changes on the next poll (🤖 … → 🤖 SAME)
 * changes in place.
 */
export function ReadingRows({ q, plan, t, reduced, visible = ROWS_VISIBLE, className }: { q: ScreenResultQuestion; plan: ReadingPlan; t: number; reduced: boolean; visible?: number; className?: string }) {
  const rows = q.rows ?? [];
  const scroll = rowScroll(plan, rows.length, t, visible);
  const first = Math.max(0, Math.floor(scroll));
  return (
    <div className={`res-rows${className ? ` ${className}` : ""}`} style={{ height: `${(visible * ROW_EM).toFixed(2)}em` }}>
      <div className="res-rows-list" style={{ transform: `translate3d(0, ${(-scroll * ROW_EM).toFixed(3)}em, 0)` }}>
        {rows.map((row, i) => {
          if (i < first || i > first + visible) return null;
          const s = rowStateAt(plan, i, t);
          if (s.k < 0) return null;
          return <Row key={i} row={row} i={i} k={s.k} stampK={reduced && s.stamp > 0 ? 1 : s.stamp} reduced={reduced} />;
        })}
      </div>
    </div>
  );
}

/** "n FILED" counting up from `at` (ms into the scene) over a second. */
export function filedCount(filed: number, t: number, at: number): number {
  if (t < at) return 0;
  return Math.min(filed, Math.round((filed * (t - at)) / 1000));
}

/**
 * A wall's take on a question's results: the counts only (no rows, no
 * names: the server sends a wall none), each counting up from `start`.
 */
export function CountsBoard({ q, t, start, label }: { q: Pick<ScreenResultQuestion, "filed" | "accepted" | "guesses" | "uncounted" | "consensus">; t: number; start: number; label?: string }) {
  const cells: Array<{ n: number; text: string; tone: string }> = [
    { n: q.filed, text: "FILED", tone: "" },
    { n: q.accepted, text: "ACCEPTED", tone: "ok" },
    { n: q.guesses, text: q.guesses === 1 ? "GUESS" : "GUESSES", tone: "no" },
  ];
  if (q.uncounted > 0) cells.push({ n: q.uncounted, text: "NOT COUNTED", tone: "skip" });
  return (
    <div className="res-board">
      {label !== undefined && <div className="res-board-label">{label}</div>}
      <div className="res-board-cells">
        {cells.map((c, i) => (
          <div key={c.text} className={`res-board-cell ${c.tone}`} style={{ opacity: t < start + i * 350 ? 0 : 1 }}>
            <b>{filedCount(c.n, t, start + i * 350)}</b>
            <span>{c.text}</span>
          </div>
        ))}
      </div>
      {q.consensus && q.filed > 0 && t >= start + cells.length * 350 + 600 && <div className="res-board-consensus">CONSENSUS</div>}
    </div>
  );
}
