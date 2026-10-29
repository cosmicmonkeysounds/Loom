//! The quick tutorial over the board (`tutorial.ts` holds the cards): a
//! looping mini-board demo per card, SKIP / CLOSE always in reach, NEXT and
//! BACK, and PLAY on the last card. The demos are CSS only (`chess.css`),
//! a still frame under reduced motion.

import { useEffect, useRef, useState } from "react";
import { TUTORIAL_STEPS, type TutorialDemo } from "./tutorial.ts";

export function Tutorial({ help, onClose }: { help: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = TUTORIAL_STEPS[i]!;
  const last = i === TUTORIAL_STEPS.length - 1;
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => next.current?.focus({ preventScroll: true }), [i]);
  return (
    <div className="chess-tutorial" role="dialog" aria-modal="true" aria-labelledby="chess-tut-title">
      <div className="tut-card">
        <div className="tut-top">
          <span className="tut-count">
            {help ? "HOW TO PLAY · " : ""}
            {i + 1} / {TUTORIAL_STEPS.length}
          </span>
          <button type="button" className="tut-skip" onClick={onClose}>
            {help ? "CLOSE ✕" : "SKIP ›"}
          </button>
        </div>
        <Demo key={step.demo} kind={step.demo} />
        <h2 id="chess-tut-title" className="tut-title">
          {step.title}
        </h2>
        <p className="tut-body">{step.body}</p>
        <div className="tut-nav">
          {i > 0 ? (
            <button type="button" className="tut-back" onClick={() => setI(i - 1)}>
              ‹ BACK
            </button>
          ) : (
            <span />
          )}
          <span className="tut-dots" aria-hidden="true">
            {TUTORIAL_STEPS.map((s, n) => (
              <span key={s.demo} className={n === i ? "on" : ""} />
            ))}
          </span>
          <button ref={next} type="button" className="tut-next" onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? "PLAY ♟" : "NEXT ›"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A 3×3 corner of a board with the card's move playing on it. */
function Demo({ kind }: { kind: TutorialDemo }) {
  return (
    <div className={`tut-demo ${kind}`} aria-hidden="true">
      {Array.from({ length: 9 }, (_, n) => (
        // Placed, not flowed: the pieces share these cells.
        <span key={n} className={`tut-sq ${(Math.floor(n / 3) + (n % 3)) % 2 === 1 ? "dark" : "light"}`} style={{ gridArea: `${Math.floor(n / 3) + 1} / ${(n % 3) + 1}` }} />
      ))}
      {kind === "win" ? (
        <>
          <span className="tut-piece black king" style={{ gridArea: "1 / 2" }}>
            ♚
          </span>
          <span className="tut-piece white" style={{ gridArea: "2 / 2" }}>
            ♕
          </span>
          <span className="tut-piece white" style={{ gridArea: "3 / 2" }}>
            ♔
          </span>
        </>
      ) : (
        <>
          <span className="tut-dot one" />
          <span className="tut-dot two" />
          <span className="tut-piece white mover">♙</span>
          <span className="tut-finger">👆</span>
        </>
      )}
    </div>
  );
}
