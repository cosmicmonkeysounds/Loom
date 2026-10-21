//! The guided tour of the app — what a `show tutorial … to guest` card
//! puts on the screen. A spotlight walks the guest over the real controls
//! (wave 18: Mission, Chats, Pass and Scan, the 🔔, Start — five steps)
//! one at a time, with a callout from the story's guide. Every step can be
//! skipped; finishing or skipping answers the card, so the story hears which.
//!
//! The steps are the app's own (they describe *this* app). Targets are
//! `data-tour` anchors on the live controls, measured against the app's
//! root — so it works inside an embedded pane too.

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { usePlayHost } from "./host.ts";
import type { WidgetResult } from "./widgets.tsx";

export interface TourStep {
  id: string;
  /** The `data-tour` anchor to spotlight, or null for a centred step. */
  target: string | null;
  title: string;
  text: string;
}

export interface TourOptions {
  /** The story's title — named in the welcome. */
  title: string;
  /** The story has a codex (knowledge as a currency). */
  hasCodex: boolean;
  /** The story declares quests (the Quest Log). */
  hasQuests?: boolean;
  /** The story declares a currency (the Wallet). */
  hasWallet?: boolean;
  /** The story has a people directory. */
  hasPeople: boolean;
  /** The guest has story buttons (`INTERACTION … who: guest`), in ⊞ Start. */
  hasActions: boolean;
  /** The story gives the guest objectives (the NOW title bar). */
  hasObjectives?: boolean;
  /** A story-supplied Bathroom Mode blurb (`with bathroom: "…"`): adds a
   *  step over ⊞ Start, where that button lives. */
  bathroom?: string | null;
}

/** Every `data-tour` anchor the guest frame renders (the tour may only
 *  point at these): the taskbar's Mission / Chats / Pass / Scan / Start, the
 *  top bar's 🔔 and your picture. `test/chrome-tour.test.ts` checks it. */
export const GUEST_TOUR_ANCHORS = ["mission", "chats", "pass", "scan", "bell", "start", "me"] as const;

/** The most steps a tour has (wave 18, G7). */
export const TOUR_MAX = 5;

/** The tour, step by step (wave 18, GUEST-SPEC §10): exactly five — your
 *  mission, Chats, Pass and Scan, Notifications, Start. A story's
 *  `with bathroom:` text replaces the Start step's. Before step 1 the app
 *  shows the Mission window with no room open. */
export function tutorialSteps(o: TourOptions): TourStep[] {
  return [
    { id: "mission", target: "mission", title: "Your mission", text: "This is home: what to do now, where to go, and what's waiting on you." },
    { id: "chats", target: "chats", title: "Chats", text: "Places and people. A yellow dot means it's your move." },
    { id: "pass", target: "pass", title: "Pass and Scan", text: "Your pass, one tap away. Scan is right beside it, for codes on walls and notes." },
    { id: "bell", target: "bell", title: "Notifications", text: "Anything you missed lands in the Recycle Bin up here." },
    { id: "start", target: "start", title: "Start", text: o.bathroom !== undefined && o.bathroom !== null && o.bathroom.trim() !== "" ? o.bathroom : "Bathroom Mode, people, help and you." },
  ];
}

/** The answer a finished or skipped tour posts back (the card's result). */
export function tourResult(steps: TourStep[], skippedAt: number | null): WidgetResult {
  return skippedAt === null ? { completed: true, steps: steps.length } : { skipped: true, step: skippedAt, steps: steps.length };
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Where a `data-tour` anchor sits, relative to the app's root (null when absent). */
function measure(root: HTMLElement, target: string): Rect | null {
  const el = root.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (el === null) return null;
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  const r = el.getBoundingClientRect();
  const base = root.getBoundingClientRect();
  return { top: r.top - base.top, left: r.left - base.left, width: r.width, height: r.height };
}

export function Tutorial({
  steps,
  root,
  guide,
  onFinish,
  onSkip,
}: {
  steps: TourStep[];
  /** The app's root element — anchors are looked up and measured inside it. */
  root: RefObject<HTMLElement | null>;
  /** The story's guide (a character name), shown on the callout. */
  guide: string | null;
  onFinish: () => void;
  onSkip: (step: number) => void;
}) {
  const [i, setI] = useState(0);
  const step = steps[Math.min(i, steps.length - 1)]!;
  const [rect, setRect] = useState<Rect | null>(null);
  // Measure the spotlight after each step renders, and again whenever the
  // pane resizes (a rotated phone, a resized Players pane).
  useLayoutEffect(() => {
    const el = root.current;
    if (el === null || step.target === null) {
      setRect(null);
      return;
    }
    const update = () => setRect(measure(el, step.target!));
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [root, step]);
  const last = i >= steps.length - 1;
  const next = () => (last ? onFinish() : setI((n) => n + 1));
  // Enter / → advance — page-wide on a phone, scoped to its pane when
  // embedded; a focused button already handles its own Enter.
  const host = usePlayHost();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
      if (e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
    };
    const target = host.keyTarget();
    target?.addEventListener("keydown", onKey as EventListener);
    return () => target?.removeEventListener("keydown", onKey as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, last, host]);
  const pad = 6;
  // A target in the lower half (the taskbar's Pass / Scan / Start) gets the
  // card above it, so the callout never covers what it points at.
  const above = rect !== null && root.current !== null && rect.top + rect.height / 2 > root.current.getBoundingClientRect().height / 2;
  return (
    <div className="tour" role="dialog" aria-modal aria-label={step.title}>
      {rect ? (
        <div className="tour-spot" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className={`tour-card ${rect ? "anchored" : "centred"}${above ? " above" : ""}`}>
        <div className="tour-guide">
          {guide && (
            <span className="tour-guide-name">
              <span className="tour-clip" aria-hidden>
                📎
              </span>{" "}
              {guide}
            </span>
          )}
          <span className="tour-progress">
            {i + 1} / {steps.length}
          </span>
        </div>
        <div className="tour-title">{step.title}</div>
        <p className="tour-text">{step.text}</p>
        <div className="tour-actions">
          <button type="button" className="choice ghost tour-skip" onClick={() => onSkip(i)}>
            Skip
          </button>
          <button type="button" className="choice primary tour-next" onClick={next}>
            {last ? "Finish" : "Next ▸"}
          </button>
        </div>
      </div>
    </div>
  );
}
