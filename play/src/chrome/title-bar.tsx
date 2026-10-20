//! The NOW title bar (wave 13; the chrome lane finishes it): "▣ NOW: <the
//! current objective> ›" — tap for its card — falling back to the room
//! name. Plumbing's plain version, mounted nowhere in Stage A.

import type { ObjectiveView } from "../types.ts";

export function TitleBar({
  objectives,
  fallback,
  onOpen,
  sub,
  tone,
}: {
  objectives: readonly ObjectiveView[] | undefined;
  fallback: string;
  onOpen: (o: ObjectiveView) => void;
  /** Sub-text under an objective title (📍 where you stand). */
  sub?: string;
  /** Captured / restricted: the bar turns alarm-red / restricted-ochre and the title gains ⛔. */
  tone?: "alarm" | "restricted";
}) {
  const now = objectives?.[0];
  const mark = tone !== undefined ? "⛔ " : "";
  return (
    <header className={`title-bar ${tone ?? ""}`}>
      {now !== undefined ? (
        <button type="button" className="title-bar-btn" onClick={() => onOpen(now)}>
          <span className="title-bar-title">
            {mark}▣ NOW: {now.title} ›
          </span>
          {sub !== undefined && <span className="title-bar-sub">{sub}</span>}
        </button>
      ) : (
        <div className="title-bar-btn">
          <span className="title-bar-title">
            {mark}
            {fallback}
          </span>
          {sub !== undefined && <span className="title-bar-sub">{sub}</span>}
        </div>
      )}
    </header>
  );
}
