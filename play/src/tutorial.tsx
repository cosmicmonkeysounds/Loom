//! The guided tour of the app — what a `show tutorial … to guest` card
//! puts on the screen. A spotlight walks the guest over the real controls
//! (the NOW bar, the rooms list, the Quest Log, the Codex, the taskbar's
//! Pass / Scan / Start) one step at a time, with a callout from the story's guide. Every step can be skipped;
//! finishing or skipping answers the card, so the story hears which.
//!
//! The steps are the app's own (they describe *this* app), trimmed to the
//! features the story actually uses (no Codex step for a story with no
//! codex). Targets are `data-tour` anchors on the live controls, measured
//! against the app's root — so it works inside an embedded pane too.

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
 *  point at these): the title bar, the room list and its pinned rows, the
 *  taskbar's Start / Pass / Scan. `test/chrome-tour.test.ts` checks it. */
export const GUEST_TOUR_ANCHORS = ["now", "rooms", "wallet", "quests", "codex", "start", "pass", "scan"] as const;

/** The tour, step by step, for what this story turns on. */
export function tutorialSteps(o: TourOptions): TourStep[] {
  const steps: TourStep[] = [
    {
      id: "welcome",
      target: null,
      title: "This is your window into the night",
      text: `Everything ${o.title} says to you, and every place it takes you, shows up here. Here's how to read it.`,
    },
  ];
  if (o.hasObjectives) {
    steps.push({
      id: "now",
      target: "now",
      title: "Now",
      text: "The bar on top says what to do right now. Tap it for the details and a checklist.",
    });
  }
  steps.push({
    id: "rooms",
    target: "rooms",
    title: "Rooms",
    text: "Every conversation you can hear is a room: places, chatrooms, and people talking to you. The place you're standing in comes first, tagged YOU ARE HERE. Empty rooms wait under Other rooms at the bottom.",
  });
  if (o.hasWallet) {
    steps.push({
      id: "wallet",
      target: "wallet",
      title: "Your wallet",
      text: "Your balance lives here and in the corner of the taskbar. Send coin to another program, ask them for some, or trade a fact you hold for coin. Some transfers wait for an audit.",
    });
  }
  if (o.hasQuests) {
    steps.push({
      id: "quests",
      target: "quests",
      title: "The Quest Log",
      text: "Pinned at the top: what the story has asked of you. Every quest is a card — open it to follow its progress in its own thread.",
    });
  }
  if (o.hasCodex) {
    steps.push({
      id: "codex",
      target: "codex",
      title: "The Codex",
      text: "Pinned too: what you know. Scan or type a code from a wall, a puzzle or a person to unlock an entry. Knowledge is the currency — share it carefully.",
    });
  }
  steps.push({
    id: "pass",
    target: "pass",
    title: "Your pass",
    text: "Your QR code, one tap away on every screen. A performer scans it — hold it up, the screen stays bright.",
  });
  steps.push({
    id: "scan",
    target: "scan",
    title: "Scan",
    text: "Codes hide on walls, signs and notes. Tap Scan to read one here: it lands in your Codex, or checks you into the room. Never use the phone's own camera app.",
  });
  const startBits = [o.hasActions ? "the story's own buttons" : null, o.hasPeople ? "who's here" : null, "help, your picture and settings", "and Leave"].filter((x): x is string => x !== null);
  steps.push({
    id: "start",
    target: "start",
    title: "Start",
    text: `Everything else is under Start: ${startBits.join(", ")}.`,
  });
  if (o.bathroom) steps.push({ id: "bathroom", target: "start", title: "Bathroom Mode", text: o.bathroom });
  steps.push({
    id: "cards",
    target: null,
    title: "When the story asks",
    text: "A decision or a card lands right in the conversation. Answer with the buttons (or the number keys). Anything waiting on you moves up the list.",
  });
  steps.push({ id: "done", target: null, title: "That's it", text: "The story is happening in the room, not just on the screen. When the app says something is happening somewhere — go." });
  return steps;
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
