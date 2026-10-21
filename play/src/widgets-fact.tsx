//! The 📝 fact card (`show fact …`), its own chunk since wave 18b: fetched
//! just after the first paint (and on first render), so the guest's first
//! load stays under its gate. The pure helpers it reads (`factResult`,
//! `factMissing`, the slider rules) stay in `widgets.tsx`, which the tests
//! and the `closed` rule read without this chunk.

import { useEffect, useRef, useState } from "react";
import {
  CONFIDENCE_LABEL,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  CONFIDENCE_REST,
  CONFIDENCE_UNSET,
  FACT_CLOSED_NOTE,
  FACT_MAX,
  confidenceFrom,
  factFileHint,
  factQuestionOf,
  factQuestions,
  factQuestionsShown,
  factResult,
  footInViewSoon,
  keepFootInView,
  setsConfidence,
  type WidgetProps,
} from "./widgets.tsx";

/** The first piece a fact card still needs, top to bottom (null = it can
 *  be filed). Wave 18b (R2): a tap on File it while one is missing points
 *  at it instead of doing nothing. */
export type FactMissing = "question" | "answer" | "confidence";
export function factMissing(question: string, answer: string, confidence: number | null): FactMissing | null {
  if (question === "") return "question";
  const a = answer.trim();
  if (a === "" || a.length > FACT_MAX) return "answer";
  if (confidence === null || confidenceFrom(String(confidence)) === null) return "confidence";
  return null;
}

/** What the card says, in red, after File it was tapped with a piece missing. */
export function factRequiredHint(missing: FactMissing, answer = ""): string {
  if (missing === "question") return "⚠ Pick a question first.";
  if (missing === "answer") return answer.trim().length > FACT_MAX ? `⚠ Keep it under ${FACT_MAX} characters.` : "⚠ Type your answer first.";
  return "⚠ Set how sure you are before filing — drag the slider (1–100%).";
}

/**
 * `show fact "📝 File a fact" to program with thread: Trabolta, questions:
 * "H1: … | H2: …"` — file an answer to one of tonight's questions with a
 * character, and say how sure you are (a 1–100 slider). The server judges
 * it (when the project has a `facts.json`) and the story decides what the
 * verdict does; the character's reply is the same whether the answer was
 * right, a confident lie or a guess. The answer is
 * `{question, answer, confidence}` → `fact answered`.
 */
export function FactCard({ card, onAnswer, answered, superseded }: WidgetProps) {
  const questions = factQuestions(card.params["questions"]);
  const [picked, setQuestion] = useState("");
  const question = factQuestionOf(picked, questions);
  const [answer, setAnswer] = useState("");
  // Unset until the guest touches the slider: File it stays off.
  const [confidence, setConfidence] = useState<number | null>(null);
  // Once a question is picked the others fold away (the card fits the tray:
  // the answer box and the slider stay on screen); its button reopens them.
  const [choosing, setChoosing] = useState(false);
  const answerBox = useRef<HTMLTextAreaElement>(null);
  const sureBox = useRef<HTMLLabelElement>(null);
  const sureInput = useRef<HTMLInputElement>(null);
  const questionList = useRef<HTMLDivElement>(null);
  const done = answered !== null && answered !== undefined;
  const result = factResult(question, answer, confidence);
  // Wave 18b (R2): File it stays tappable. A tap with a piece missing turns
  // the hint red and moves to that piece — focusing the slider never sets it
  // (only its change, pointer-up and value keys do: W11).
  const [tried, setTried] = useState(false);
  const missing = factMissing(question, answer, confidence);
  useEffect(() => {
    if (missing === null && tried) setTried(false);
  }, [missing, tried]);
  const pointAt = (m: FactMissing) => {
    const el: HTMLElement | null =
      m === "question" ? (questionList.current?.querySelector<HTMLElement>("button") ?? null) : m === "answer" ? answerBox.current : sureInput.current;
    const box: HTMLElement | null = m === "confidence" ? sureBox.current : el;
    box?.scrollIntoView?.({ block: "nearest" });
    el?.focus?.({ preventScroll: true });
  };
  const fileIt = () => {
    if (result !== null) {
      onAnswer?.(result);
      return;
    }
    setTried(true);
    if (missing !== null) pointAt(missing);
  };
  const flagged = tried && missing !== null;
  const filedFor = done && typeof answered["question"] === "string" ? questions.find((q) => q.id === answered["question"])?.label ?? String(answered["question"]) : null;
  // "Sent", not "filed": the story still has to accept it (a question from
  // a round that hasn't opened, a second filing… is refused in its reply).
  const sentSure = done && typeof answered["confidence"] === "number" ? ` · ${answered["confidence"]}%` : "";
  const sent = filedFor ? `✔ sent: ${filedFor}${sentSure}` : `✔ sent${sentSure}`;
  if (!done && questions.length === 0) {
    // Dealt after a round closed with nothing left to file (B14): a note.
    return (
      <div className="widget fact done folded closed" role="note">
        <span className="widget-glyph" aria-hidden>
          📝
        </span>{" "}
        <span className="widget-state">{FACT_CLOSED_NOTE}</span>
      </div>
    );
  }
  if (superseded) {
    return (
      <div className="widget fact done folded" role="note">
        <span className="widget-glyph" aria-hidden>
          📝
        </span>{" "}
        <span className="widget-state">{done ? sent : "An earlier card — use the newest one below."}</span>
      </div>
    );
  }
  return (
    <div className={`widget fact ${done ? "done" : ""}${question !== "" && !choosing ? " picked" : ""}`} role="group" aria-label={card.text || "File a fact"}>
      <div className="widget-head">
        <span className="widget-glyph" aria-hidden>
          📝
        </span>
        <div>
          <div className="widget-title">{card.text || "File a fact"}</div>
          <div className="widget-sub">Pick a question, type the answer, say how sure you are. One filing per question.</div>
        </div>
      </div>
      {!done && onAnswer && (
        <>
          <div ref={questionList} className={`poll-options fact-questions${flagged && missing === "question" ? " missing" : ""}`}>
            {factQuestionsShown(questions, question, choosing).map((q) => (
              <button
                key={q.id}
                type="button"
                className={`choice ${question === q.id ? "primary" : "ghost"}`}
                aria-pressed={question === q.id}
                aria-expanded={questions.length > 1 && question === q.id ? choosing : undefined}
                onClick={() => {
                  // The picked one, tapped again, opens the list to change it.
                  if (question === q.id && !choosing && questions.length > 1) {
                    setChoosing(true);
                    return;
                  }
                  setQuestion(q.id);
                  setChoosing(false);
                  // The answer box next, in view (the tray scrolls).
                  window.setTimeout(() => answerBox.current?.scrollIntoView?.({ block: "nearest" }), 0);
                }}
              >
                {question === q.id && (
                  <span className="fact-picked" aria-hidden>
                    ✔{" "}
                  </span>
                )}
                {q.label}
                {question === q.id && !choosing && questions.length > 1 && <span className="fact-change">change</span>}
              </button>
            ))}
          </div>
          <textarea
            ref={answerBox}
            className={`fact-answer${flagged && missing === "answer" ? " missing" : ""}`}
            aria-invalid={flagged && missing === "answer" ? true : undefined}
            rows={2}
            maxLength={FACT_MAX}
            placeholder="Your answer"
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value);
              keepFootInView(e.currentTarget);
            }}
            onFocus={(e) => footInViewSoon(e.currentTarget)}
            // Done typing (the keyboard goes down): the slider next, in view.
            onBlur={() => sureBox.current?.scrollIntoView?.({ block: "nearest" })}
          />
          <label ref={sureBox} className={`fact-confidence ${confidence === null ? "unset" : ""}${flagged && missing === "confidence" ? " missing" : ""}`}>
            <span>
              {CONFIDENCE_LABEL} <span className="req">required</span>
            </span>
            {/* A range always has a value, so an unset one rests greyed in
                the middle. A tap on the thumb itself changes nothing, so
                pointer-up and the value keys set it too (never Tab). */}
            <input
              ref={sureInput}
              type="range"
              aria-required="true"
              aria-invalid={flagged && missing === "confidence" ? true : undefined}
              min={CONFIDENCE_MIN}
              max={CONFIDENCE_MAX}
              step={1}
              value={confidence ?? CONFIDENCE_REST}
              onChange={(e) => setConfidence(confidenceFrom(e.target.value))}
              onPointerUp={(e) => setConfidence(confidenceFrom(e.currentTarget.value))}
              onKeyUp={(e) => {
                if (setsConfidence(e.key)) setConfidence(confidenceFrom(e.currentTarget.value));
              }}
              aria-valuetext={confidence === null ? CONFIDENCE_UNSET : `${confidence}%`}
            />
            <output>{confidence === null ? CONFIDENCE_UNSET : `${confidence}%`}</output>
          </label>
        </>
      )}
      <div className="widget-foot">
        {done ? (
          <span className="widget-state">{sent} — the reply says whether it's accepted</span>
        ) : onAnswer ? (
          <>
            {flagged && missing !== null ? (
              <span className="widget-state fact-hint error" role="alert">
                {factRequiredHint(missing, answer)}
              </span>
            ) : (
              result === null && factFileHint(question, answer, confidence) !== null && <span className="widget-state fact-hint">{factFileHint(question, answer, confidence)}</span>
            )}
            <button type="button" className={`choice primary widget-go${result === null ? " waiting" : ""}`} aria-disabled={result === null ? true : undefined} onClick={fileIt}>
              File it
            </button>
          </>
        ) : (
          <span className="widget-state">shown to a guest</span>
        )}
      </div>
    </div>
  );
}
