//! The heart's choice panel (wave 20, CONTRACT-w20 §1.4 item 3, D28): the
//! piloted program's docked heart menu under the thread, Fallout-style — a
//! numbered list, hover to light a line, click (or press its number) to say
//! it. A leading `⟦TAG⟧` is drawn as a chip. While the door is open the
//! options are greyed under *CLOSE THE DOOR*. The ⟦BACK⟧ menu of a heart to
//! heart is drawn small, under the composer.

import "./heart.css";
import { useEffect, useState } from "react";
import { panelModel, type HeartMenu } from "./heart.ts";

export function ChoicePanel({
  menu,
  doorOpen,
  onPick,
  numberKeys,
  onActivity,
}: {
  menu: HeartMenu;
  /** The door, as the panel reads it (`doorOpenNow`). */
  doorOpen: boolean | null;
  /** Say option `index` of this menu; rejects with the reason it didn't land. */
  onPick: (index: number) => Promise<void>;
  /** Number keys pick (no composer is taking the keys). */
  numberKeys: boolean;
  onActivity: () => void;
}) {
  const model = panelModel(menu, doorOpen)!;
  const [sending, setSending] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A new menu (or the same one re-docked) starts clean.
  useEffect(() => {
    setSending(null);
    setProblem(null);
  }, [menu.id]);

  const pick = (index: number) => {
    onActivity();
    if (model.greyed || sending !== null) return;
    setSending(index);
    setProblem(null);
    onPick(index).then(
      () => setSending(null),
      (e: Error) => {
        setSending(null);
        setProblem(e.message);
      },
    );
  };

  useEffect(() => {
    if (!numberKeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !/^[1-9]$/u.test(e.key)) return;
      const tag = (e.target as { tagName?: string } | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const i = Number(e.key) - 1;
      if (i < model.options.length) {
        e.preventDefault();
        pick(i);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (model.chat) {
    const o = model.options[0]!;
    return (
      <div className="heart-back" data-menu={menu.id}>
        <button type="button" className="heart-back-btn" disabled={model.greyed || sending !== null} onClick={() => pick(0)} title={o.raw}>
          {o.tag !== null && <span className="heart-tag">{o.tag}</span>}
          {o.text}
        </button>
      </div>
    );
  }

  return (
    <div className={`heart-panel${model.greyed ? " greyed" : ""}`} role="listbox" aria-label="Your answer" data-menu={menu.id}>
      {model.greyed && <div className="heart-panel-door">CLOSE THE DOOR</div>}
      <ol className="heart-options">
        {model.options.map((o) => (
          <li key={`${menu.id}:${o.index}`}>
            <button type="button" className={`heart-option${sending === o.index ? " sending" : ""}`} disabled={model.greyed || (sending !== null && sending !== o.index)} onClick={() => pick(o.index)} onMouseEnter={onActivity} aria-label={o.raw}>
              <span className="heart-num">{o.index + 1}</span>
              {o.tag !== null && <span className="heart-tag">{o.tag}</span>}
              <span className="heart-text">{o.text}</span>
            </button>
          </li>
        ))}
      </ol>
      {problem !== null && <div className="heart-problem">{problem}</div>}
    </div>
  );
}
