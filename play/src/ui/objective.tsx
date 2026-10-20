//! An objective card (wave 13; the chrome lane finishes it): the title, the
//! brief and the checklist with done states, and the buttons the viewer can
//! press. The guest's NOW sheet opens it; the booth pins it compact.

import { Fragment, useState, type ReactNode } from "react";
import type { ObjectiveView } from "../types.ts";

/**
 * "1/3", "3/3 ✓" — how much of a checklist is done. Every to-do counts in
 * the total, including one with no `done when` (`done: null`, nothing the
 * story can tick), which is never done; the ✓ shows only once every to-do
 * is. "" when the objective has no checklist. The guest's card and the
 * booth's NOW line both read this, so they never disagree.
 */
export function checkCount(o: Pick<ObjectiveView, "checklist">): string {
  const total = o.checklist.length;
  if (total === 0) return "";
  const done = o.checklist.filter((c) => c.done === true).length;
  return done === total ? `${done}/${total} ✓` : `${done}/${total}`;
}

export function ObjectiveCard({
  objective,
  compact,
  renderButton,
}: {
  objective: ObjectiveView;
  /** Title + "n/m ✓" on one 44 px line until tapped. */
  compact?: boolean;
  /** Render one button per objective button the viewer can press (≤ 3). */
  renderButton?: (id: string) => ReactNode;
}) {
  const [open, setOpen] = useState(!compact);
  const count = checkCount(objective);
  return (
    <section className="objective-card" aria-label={objective.title}>
      <button type="button" className="objective-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="objective-mark" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="objective-title">{objective.title}</span>
        {count !== "" && <span className="objective-count">{count}</span>}
      </button>
      {open && objective.brief !== "" && <p className="objective-brief">{objective.brief}</p>}
      {open && objective.checklist.length > 0 && (
        <ul className="objective-list">
          {objective.checklist.map((c, i) => (
            <li key={i} className={`objective-check ${c.done === true ? "done" : ""}`}>
              {c.done === true ? "☑" : "☐"} {c.label}
            </li>
          ))}
        </ul>
      )}
      {open && renderButton !== undefined && objective.buttons.length > 0 && (
        <div className="objective-buttons">{objective.buttons.slice(0, 3).map((id) => <Fragment key={id}>{renderButton(id)}</Fragment>)}</div>
      )}
    </section>
  );
}
