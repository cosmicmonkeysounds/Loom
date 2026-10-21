//! The NOW title bar (wave 13): the caption of the window the guest is
//! trapped in. "▣ NOW: <the current objective> ›" — tap for its card —
//! falling back to the open room's name, else the story's title. Under the
//! title, a sub-line (📍 where you stand). Captured turns the caption
//! alarm-red, restricted turns it ochre, and either adds ⛔ to the title.
//! It owns the top safe-area inset.

import type { ReactNode } from "react";
import type { NightView, ObjectiveView } from "../types.ts";

/** What the bar falls back to with no objective (D4): the open room's
 *  name, else the story's title (the room list is open). */
export function titleFallback(room: string | null | undefined, story: string | null | undefined): string {
  return room !== null && room !== undefined && room !== "" ? room : (story ?? "");
}

// --- a paused show, on every caption bar (D3) --------------------------------
// The guest's NOW bar, a booth's NOW card and a host's NOW bar grey out the
// same way while the show is paused — Win95's inactive caption — and say so
// after their title. Booths and hosts import these instead of their own copy.

/** The word a paused caption carries after its title. */
export const PAUSED_WORD = "(Paused)";
/** The class that greys a caption bar while paused (`chrome.css`): add it
 *  beside the bar's own class (`booth-now-bar`, the host's NOW bar); it
 *  wins over that bar's background and turns its pale sub-ink white. */
export const PAUSED_CLASS = "title-bar-paused";
/** A caption's title while paused: "Hunt" → "Hunt (Paused)". */
export function pausedTitle(title: string, paused: boolean): string {
  return paused ? `${title} ${PAUSED_WORD}` : title;
}
/** The bar's class list with the paused class when paused (`"booth-now-bar"` → `"booth-now-bar title-bar-paused"`). */
export function pausedClass(base: string, paused: boolean): string {
  return paused ? `${base} ${PAUSED_CLASS}` : base;
}
/** "(Paused)" as markup, for a bar that renders its title in parts. */
export function PausedTag({ paused }: { paused: boolean }) {
  return paused ? <span className="title-bar-paused-tag"> {PAUSED_WORD}</span> : null;
}

/** The chevron after a tappable title, bound to its last word by a
 *  no-break space, so a title that wraps never leaves it alone on the
 *  second line. */
export const TITLE_CHEVRON = "\u00a0›";

/** What the bar says (pure — `test/title-bar.test.ts`). A paused show
 *  says so the Win95 way, after the caption: "… (Paused)". */
export function titleBarText(objectives: readonly ObjectiveView[] | undefined, fallback: string, tone?: "alarm" | "restricted", paused = false): { title: string; now: ObjectiveView | null } {
  const now = objectives?.[0] ?? null;
  const mark = tone !== undefined ? "⛔ " : "";
  return { title: now !== null ? `${mark}▣ NOW: ${pausedTitle(now.title, paused)}${TITLE_CHEVRON}` : `${mark}${pausedTitle(fallback, paused)}`, now };
}

/** Mission's caption (wave 18, GUEST-SPEC §1.1): the act on screen,
 *  "▣ ACT B · The Desktop"; either part may be missing; both → the story's
 *  title (`fallback`). */
export function actLine(act: NightView["act"] | null | undefined, fallback: string): string {
  const code = act?.code?.trim() ?? "";
  const title = act?.title?.trim() ?? "";
  if (code === "" && title === "") return fallback;
  return `▣ ${code !== "" ? `ACT ${code}` : ""}${code !== "" && title !== "" ? " · " : ""}${title}`;
}

/** Mission's line 1 when the server sends no act (a guest never gets one:
 *  the act's title is director copy): "▣ MISSION · {the NOW objective}",
 *  never the story's title (GN-F6: the home screen read "Trapped in the
 *  Internet" all night). */
export function missionLine(objectives: readonly ObjectiveView[] | undefined): string {
  const now = objectives?.[0]?.title.trim() ?? "";
  return now !== "" ? `▣ MISSION · ${now}` : "▣ MISSION";
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
  act,
  lead,
  trail,
}: {
  objectives: readonly ObjectiveView[] | undefined;
  fallback: string;
  onOpen: (o: ObjectiveView) => void;
  /** Sub-text under the title (📍 where you stand). Never a count of objectives (wave 18). */
  sub?: string;
  /** Captured / restricted: the bar turns alarm-red / restricted-ochre and the title gains ⛔. */
  tone?: "alarm" | "restricted";
  /** The show is paused: the caption greys (Win95's inactive caption) and says "(Paused)". */
  paused?: boolean;
  /** A loud objective just went live (the moments layer's NOW flash): the
   *  bar blinks like a Win95 window asking for attention and unfolds its
   *  brief, instead of a second copy of it in a banner. */
  flash?: { id: string; title: string; brief: string } | null;
  /** The guest's Mission window is on screen: line 1 is the act
   *  (`actLine`), not a button (wave 18). */
  act?: string;
  /** The left slot: the guest's picture (→ Me). */
  lead?: ReactNode;
  /** The right slot: the 🔔 (→ Notifications). */
  trail?: ReactNode;
}) {
  const { title, now } = titleBarText(objectives, fallback, tone, paused);
  const sub = titleBarSub(rawSub, tone);
  const news = flash !== null ? flashLine(flash, now) : null;
  const mark = tone !== undefined ? "⛔ " : "";
  const shown = act !== undefined ? `${mark}${pausedTitle(act, paused)}` : title;
  return (
    <header className={`title-bar ${tone ?? ""}${paused ? ` paused ${PAUSED_CLASS}` : ""}${news !== null ? " flash" : ""}${lead !== undefined || trail !== undefined ? " slotted" : ""}`}>
      {lead}
      {now !== null && act === undefined ? (
        <button type="button" className="title-bar-btn" data-tour="now" aria-haspopup="dialog" onClick={() => onOpen(now)}>
          <span className="title-bar-title">{shown}</span>
          {news !== null ? (
            <span className="title-bar-news" role="status">
              {news}
            </span>
          ) : (
            sub !== undefined && <span className="title-bar-sub">{sub}</span>
          )}
        </button>
      ) : (
        <div className="title-bar-btn" data-tour="now">
          <span className="title-bar-title">{shown}</span>
          {news !== null ? (
            <span className="title-bar-news" role="status">
              {news}
            </span>
          ) : (
            sub !== undefined && <span className="title-bar-sub">{sub}</span>
          )}
        </div>
      )}
      {trail}
    </header>
  );
}
