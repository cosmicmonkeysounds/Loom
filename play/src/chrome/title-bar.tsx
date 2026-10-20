//! The NOW title bar (wave 13): the caption of the window the guest is
//! trapped in. "▣ NOW: <the current objective> ›" — tap for its card —
//! falling back to the open room's name, else the story's title. Under the
//! title, a sub-line (📍 where you stand). Captured turns the caption
//! alarm-red, restricted turns it ochre, and either adds ⛔ to the title.
//! It owns the top safe-area inset.

import type { ObjectiveView } from "../types.ts";

/** What the bar says (pure — `test/title-bar.test.ts`). */
export function titleBarText(objectives: readonly ObjectiveView[] | undefined, fallback: string, tone?: "alarm" | "restricted"): { title: string; now: ObjectiveView | null } {
  const now = objectives?.[0] ?? null;
  const mark = tone !== undefined ? "⛔ " : "";
  return { title: now !== null ? `${mark}▣ NOW: ${now.title} ›` : `${mark}${fallback}`, now };
}

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
  const { title, now } = titleBarText(objectives, fallback, tone);
  const more = (objectives?.length ?? 0) - 1;
  return (
    <header className={`title-bar ${tone ?? ""}`}>
      {now !== null ? (
        <button type="button" className="title-bar-btn" data-tour="now" aria-haspopup="dialog" onClick={() => onOpen(now)}>
          <span className="title-bar-title">{title}</span>
          {(sub !== undefined || more > 0) && (
            <span className="title-bar-sub">
              {sub}
              {sub !== undefined && more > 0 && " · "}
              {more > 0 && `+${more} more`}
            </span>
          )}
        </button>
      ) : (
        <div className="title-bar-btn" data-tour="now">
          <span className="title-bar-title">{title}</span>
          {sub !== undefined && <span className="title-bar-sub">{sub}</span>}
        </div>
      )}
    </header>
  );
}
