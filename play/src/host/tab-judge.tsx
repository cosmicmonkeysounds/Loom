//! Judge: the facts judge's queue (`HostJudging`) — every filing waiting on
//! a verdict (review mode, and every ⚠ near miss in auto) with ✅ / 😤 / 🤷,
//! then the latest judged filings, each overridable (wave 9 D5). A verdict
//! is the story's confirm event on the filer (`verdictCall`).

import { useEffect, useState } from "react";
import { askingText, filingButtons, rulingText, type FactVerdictLike, type FilingButton, type JudgingRow } from "../../../core/src/host-board.ts";
import type { HostJudging } from "../types.ts";
import type { JudgeMode } from "./api.ts";
import { ActButton, HostEmpty, HostSection, useHost } from "./kit.tsx";
import { optimisticValue, type Optimistic } from "./model.ts";

/** The two options (BOOTH-SPEC §5.4, the copy deck). */
export const JUDGE_MODE_OPTIONS: ReadonlyArray<{ mode: JudgeMode; label: string }> = [
  { mode: "auto", label: "Auto: the house judges; near misses wait here" },
  { mode: "review", label: "Review: every filing waits for a host" },
];

/** The judge's mode as the view says it: `auto` unless it says `review`. */
export function judgeModeOf(mode: string | null | undefined): JudgeMode {
  return mode === "review" ? "review" : "auto";
}

/** The judging header: `auto · judge Trabolta · ⚠ 2 near`. */
export function judgeHead(j: HostJudging): string {
  return [j.mode, j.judge !== null ? `judge ${j.judge}` : null, j.near > 0 ? `⚠ ${j.near} near` : null].filter((x) => x !== null).join(" · ");
}

/** A filing's answer line: `“Mr Pickels” · 100%`. */
export function answerLine(r: Pick<JudgingRow, "answer" | "confidence">): string {
  return `“${r.answer}” · ${r.confidence}%`;
}

export function JudgeTab() {
  const { view } = useHost();
  const [recentOpen, setRecentOpen] = useState(false);
  const j = view.judging;
  if (j === null) return <HostEmpty>This event has no facts to judge.</HostEmpty>;
  return (
    <div className="host-judge">
      <JudgeModeSwitch mode={judgeModeOf(j.mode)} />
      <p className="host-note">{judgeHead(j)}</p>
      <HostSection id="pending" title={`Waiting (${j.pending.length})`}>
        {j.pending.length === 0 ? (
          <HostEmpty>{j.mode === "auto" ? "Nothing to judge. In auto mode only a near miss waits here; judge every ⚠ before 📋." : "Nothing to review."}</HostEmpty>
        ) : (
          <ul className="host-rows">
            {j.pending.map((r) => (
              <FilingItem key={`${r.person}:${r.question}:${r.at}`} who={r.name} question={r.question} person={r.person} row={r} buttons={filingButtons({ confirm: j.confirm, questions: [] }, { final: null, proposed: r.proposed, how: "pending" })} judge={j} />
            ))}
          </ul>
        )}
      </HostSection>
      {j.recent.length > 0 && (
        <HostSection
          id="recent"
          title="Judged (override)"
          aside={
            <button type="button" className="w95-btn host-fold" aria-expanded={recentOpen} onClick={() => setRecentOpen((o) => !o)}>
              {recentOpen ? "Hide" : `Show ${j.recent.length}`}
            </button>
          }
        >
          {recentOpen && (
            <ul className="host-rows">
              {j.recent.map((r) => (
                <FilingItem key={`${r.person}:${r.question}:${r.at}`} who={r.name} question={r.question} person={r.person} row={r} buttons={r.buttons} judge={j} judged={r.final} />
              ))}
            </ul>
          )}
        </HostSection>
      )}
    </div>
  );
}

function FilingItem({ who, question, person, row, buttons, judge, judged }: { who: string; question: string; person: string; row: Pick<JudgingRow, "answer" | "confidence" | "near" | "asking" | "ruling" | "proposed">; buttons: FilingButton[]; judge: HostJudging; judged?: string | null }) {
  const { calls, run } = useHost();
  const press = (v: FactVerdictLike, label: string) => run(`${label}: ${who} · ${question}`, () => calls.verdict(judge.confirm, { person, question }, v));
  return (
    <li className="host-filing">
      <div className="host-filing-head">
        <strong>{who}</strong>
        <span className="host-filing-q">{question}</span>
        {judged != null && <span className="host-filing-final">{judged}</span>}
      </div>
      <div className="host-filing-answer">{answerLine(row)}</div>
      {row.near !== null && <div className="host-filing-near">⚠ near “{row.near}”</div>}
      {row.ruling !== null ? <div className="host-filing-ruling">{rulingText(row.ruling)}</div> : row.asking ? <div className="host-filing-ruling">{askingText({ questions: [], ...(judge.judge !== null ? { judge: judge.judge } : {}) })}</div> : null}
      {buttons.length > 0 && (
        <div className="host-verdicts">
          {buttons.map((b) => (
            <ActButton key={b.verdict} className={`host-verdict ${b.current ? "current" : ""}`} pressed={b.current} disabled={b.disabled || (judged != null && b.current)} title={b.title} label={
                <>
                  <span className="host-radio" aria-hidden="true" />
                  {`${b.glyph} ${b.label}`}
                </>
              }
              onClick={() => press(b.verdict, `${b.glyph} ${b.label}`)} />
          ))}
        </div>
      )}
      {buttons.length === 0 && judged === "marked" && <div className="host-note">Marked: no verdict to change.</div>}
      {row.proposed !== undefined && judged == null && <div className="host-filing-proposed">proposed: {row.proposed}</div>}
    </li>
  );
}

/** Judging: auto ⇄ review (wave 18 §5.4) — `Night.judge_mode` through the
 *  host `/api/mod/var` path. The switch turns at once and trusts itself
 *  until the view agrees (or `OPTIMISTIC_MS`). */
function JudgeModeSwitch({ mode }: { mode: JudgeMode }) {
  const { calls, run, now } = useHost();
  const [flip, setFlip] = useState<Optimistic<JudgeMode> | null>(null);
  useEffect(() => {
    if (flip !== null && flip.value === mode) setFlip(null);
  }, [mode, flip]);
  const shown = optimisticValue(mode, flip, Math.max(now, Date.now()));
  return (
    <HostSection id="judge-mode" title="Judging">
      <div className="host-dial host-judge-mode" role="group" aria-label="How filings are judged">
        {JUDGE_MODE_OPTIONS.map((o) => (
          <ActButton
            key={o.mode}
            className={`host-dial-step ${o.mode === shown ? "current" : ""}`}
            pressed={o.mode === shown}
            label={
              <>
                <span className="host-radio" aria-hidden="true" />
                <span className="host-dial-words">
                  <span className="host-dial-label">{o.label}</span>
                </span>
              </>
            }
            onClick={async () => {
              if (o.mode === shown) return;
              const at = Date.now();
              setFlip({ value: o.mode, at });
              if (!(await run(o.mode === "auto" ? "⚖ Auto judging" : "⚖ Every filing waits for review", () => calls.setJudgeMode(o.mode)))) setFlip(null);
            }}
          />
        ))}
      </div>
    </HostSection>
  );
}

