//! The NOW title bar (wave 13): the caption of the window the guest is
//! trapped in. "▣ NOW: <the current objective> ›" — tap for its card —
//! falling back to the open room's name, else the story's title. Under the
//! title, a sub-line (📍 where you stand). Captured turns the caption
//! alarm-red, restricted turns it ochre, and either adds ⛔ to the title.
//! It owns the top safe-area inset.

import type { ObjectiveView } from "../types.ts";

/** What the bar falls back to with no objective (D4): the open room's
 *  name, else the story's title (the room list is open). */
export function titleFallback(room: string | null | undefined, story: string | null | undefined): string {
  return room !== null && room !== undefined && room !== "" ? room : (story ?? "");
}

/** What the bar says (pure — `test/title-bar.test.ts`). A paused show
 *  says so the Win95 way, after the caption: "… (Paused)". */
export function titleBarText(objectives: readonly ObjectiveView[] | undefined, fallback: string, tone?: "alarm" | "restricted", paused = false): { title: string; now: ObjectiveView | null } {
  const now = objectives?.[0] ?? null;
  const mark = tone !== undefined ? "⛔ " : "";
  const wait = paused ? " (Paused)" : "";
  return { title: now !== null ? `${mark}▣ NOW: ${now.title}${wait} ›` : `${mark}${fallback}${wait}`, now };
}

/** "+1 objective", "+2 objectives": what waits behind the first. */
export function moreObjectives(n: number): string {
  return `+${n} ${n === 1 ? "objective" : "objectives"}`;
}

/** A loud objective just went live: what the bar unfolds to say. Its own
 *  brief when it is the one the bar names, else its title (and brief). */
export function flashLine(flash: { id: string; title: string; brief: string }, now: ObjectiveView | null): string {
  if (now !== null && now.id === flash.id) return flash.brief.trim() !== "" ? flash.brief.trim() : flash.title;
  return flash.brief.trim() !== "" ? `${flash.title} — ${flash.brief.trim()}` : flash.title;
}

/** The sub-line: where you stand — without a second ⛔ when the title
 *  already carries one ("⛔ restricted" → "restricted"). */
export function titleBarSub(sub: string | undefined, tone?: "alarm" | "restricted"): string | undefined {
  return sub !== undefined && tone !== undefined && sub.startsWith("⛔ ") ? sub.slice("⛔ ".length) : sub;
}

export function TitleBar({
  objectives,
  fallback,
  onOpen,
  sub: rawSub,
  tone,
  paused = false,
  flash = null,
}: {
  objectives: readonly ObjectiveView[] | undefined;
  fallback: string;
  onOpen: (o: ObjectiveView) => void;
  /** Sub-text under an objective title (📍 where you stand). */
  sub?: string;
  /** Captured / restricted: the bar turns alarm-red / restricted-ochre and the title gains ⛔. */
  tone?: "alarm" | "restricted";
  /** The show is paused: the caption greys (Win95's inactive caption) and says "(Paused)". */
  paused?: boolean;
  /** A loud objective just went live (the moments layer's NOW flash): the
   *  bar blinks like a Win95 window asking for attention and unfolds its
   *  brief, instead of a second copy of it in a banner. */
  flash?: { id: string; title: string; brief: string } | null;
}) {
  const { title, now } = titleBarText(objectives, fallback, tone, paused);
  const sub = titleBarSub(rawSub, tone);
  const more = (objectives?.length ?? 0) - 1;
  const news = flash !== null ? flashLine(flash, now) : null;
  return (
    <header className={`title-bar ${tone ?? ""}${paused ? " paused" : ""}${news !== null ? " flash" : ""}`}>
      {now !== null ? (
        <button type="button" className="title-bar-btn" data-tour="now" aria-haspopup="dialog" onClick={() => onOpen(now)}>
          <span className="title-bar-title">{title}</span>
          {news !== null ? (
            <span className="title-bar-news" role="status">
              {news}
            </span>
          ) : (
            (sub !== undefined || more > 0) && (
              <span className="title-bar-sub">
                {sub}
                {sub !== undefined && more > 0 && " · "}
                {more > 0 && moreObjectives(more)}
              </span>
            )
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
