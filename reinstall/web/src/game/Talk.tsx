//! A talk with a prop (wave 49, C5): the Win98 window, the line it is saying
//! (spoken through `LinePlayer`) and, when it has finished, up to four
//! answers: a tap, a click, or keys 1–4. It never takes the movement keys and
//! never takes the keyboard's focus: walking away is always an answer.

import { Window } from "../wizard.tsx";

export interface TalkHud {
  /** What is talking (the prop). */
  title: string;
  /** The line it is on, null before the first. */
  line: string | null;
  /** The answers on offer, null while it speaks. */
  options: string[] | null;
}

export function Talk({ talk, touch, onPick }: { talk: TalkHud; touch: boolean; onPick: (index: number) => void }) {
  return (
    <Window title={talk.title} icon="💬" className={`talk-window${touch ? " over-sticks" : ""}`}>
      <p>{talk.line ?? "…"}</p>
      {talk.options !== null && (
        <div className="talk-options">
          {talk.options.map((text, i) => (
            <button
              key={`${i}:${text}`}
              className="w98-button talk-option"
              tabIndex={-1}
              // A click must leave the focus where it was: Space stays the King's.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(i)}
            >
              <kbd>{i + 1}</kbd> {text}
            </button>
          ))}
        </div>
      )}
    </Window>
  );
}
