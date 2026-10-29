//! The phone's credits roll (wave 44, C7): a lazy chunk, never in the
//! guest's first load (`credits/lazy.tsx` mounts it once the story has
//! rolled them). `CreditsHost` opens it by itself when the roll rises live
//! (`creditsDue`, remembered per event in the host storage), keeps an open
//! roll waiting behind the pass, a `!!` takeover or the glitch, and holds
//! the moments' dialogs while it is on screen. `CreditsRoll` fetches `GET
//! /api/credits` once per open, rolls core's `creditsRows` up the screen
//! over `creditsRollMs`, then holds the `end` lines. A tap pauses / goes on;
//! the ✕ (44 px), Escape and the phone's Back (the app's own `useSystemBack`)
//! close it at any time. Reduced motion: no roll, a list the guest scrolls.
//! Not ready (403 `not_yet`, 404, offline): a short card with the ✕.
//! While `hidden` (the pass, a `!!` takeover or the glitch is up) it stays
//! mounted, out of sight, its clock stopped. CSS: `css/credits.css`.

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { usePlayHost } from "../host.ts";
import { useMomentsEngineContext, useMomentsHold } from "../moments/provider.tsx";
import { creditsDue, creditsKey, creditsShown, seenRollOf, type CreditsCover, type NightCredits } from "./credits-model.ts";
import type { Credits } from "./lazy.tsx";
import { fetchCredits, rollElapsed, rollOver, rollPaused, rollPlan, rollResume, rollPause, rollToggle, rollY, type CreditsLoad, type CreditsRow, type CreditsUnready, type RollClock, type RollPlan } from "./roll-model.ts";

// DRAFT w44: the roll's words.
export const CREDITS_COPY = {
  close: "Close the credits",
  loading: "Loading the credits…",
  unready: "The credits aren't ready",
  why: {
    not_yet: "They roll at the very end of the night.",
    no_credits: "Check back in a minute.",
    offline: "Check the connection, then try again.",
  } satisfies Record<CreditsUnready, string>,
  tap: "Tap to pause",
  paused: "Paused · tap to go on",
} as const;

export interface CreditsHostProps {
  c: Credits;
  credits: NightCredits;
  clock: number | undefined;
  eventId: string;
  token: string;
  /** This phone opens the roll by itself (a guest, a player booth). */
  auto: boolean;
  /** What else covers the screen now (the glitch is read here). */
  cover: Omit<CreditsCover, "glitch">;
}

/** The auto-open, the wait, and the roll while open. */
export function CreditsHost({ c, credits, clock, eventId, token, auto, cover }: CreditsHostProps) {
  const host = usePlayHost();
  // The roll last seen: the first view's (a reload mid-roll never opens it).
  const prev = useRef<number | null>(c.first ?? credits.roll);
  useEffect(() => {
    let seen: number | null = null;
    try {
      seen = seenRollOf(host.storage.load<unknown>(creditsKey(eventId)));
    } catch {
      seen = null;
    }
    const due = auto && creditsDue(prev.current, credits, clock, false, host.embedded, seen);
    prev.current = credits.roll;
    if (!due) return;
    try {
      host.storage.save(creditsKey(eventId), credits.roll);
    } catch {
      /* kept for this page only */
    }
    c.set(Date.now());
    // Only a new roll decides; the clock is read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credits.roll]);
  const glitch = useMomentsEngineContext()?.takeover != null;
  const shown = creditsShown(c.open !== null, { ...cover, glitch });
  useMomentsHold(shown);
  if (c.open === null) return null;
  return <CreditsRoll key={c.open} eventId={eventId} token={token} hidden={!shown} onClose={() => c.set(null)} />;
}

export interface CreditsRollProps {
  eventId: string;
  token: string;
  /** Out of sight for now (it waits, its clock stopped). */
  hidden: boolean;
  onClose: () => void;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function CreditsRoll({ eventId, token, hidden, onClose }: CreditsRollProps) {
  const host = usePlayHost();
  const [load, setLoad] = useState<CreditsLoad>({ kind: "loading" });
  const [reduced] = useState(reducedMotion);
  const [paused, setPaused] = useState(false);
  const [over, setOver] = useState(false);
  const clock = useRef<RollClock>({ since: null, banked: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // One fetch per open (this mount).
  useEffect(() => {
    let live = true;
    void fetchCredits(eventId, token).then((l) => {
      if (live) setLoad(l);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes it while it is on screen.
  useEffect(() => {
    if (hidden) return;
    const target = host.keyTarget();
    if (target === null) return;
    const on = (e: Event) => {
      if ((e as KeyboardEvent).key === "Escape") close.current();
    };
    target.addEventListener("keydown", on);
    return () => target.removeEventListener("keydown", on);
  }, [hidden, host]);

  // The ✕ takes the focus when the roll comes on screen.
  useEffect(() => {
    if (!hidden) closeBtn.current?.focus({ preventScroll: true });
  }, [hidden, load.kind]);

  const plan = useMemo(() => (load.kind === "ready" ? rollPlan(load.view) : null), [load]);
  const running = plan !== null && !reduced && !hidden && !paused && !over;

  // The roll: a frame loop moves the rows (a transform, no re-render) while it runs.
  useEffect(() => {
    if (plan === null || reduced) return;
    if (!running) {
      clock.current = rollPause(clock.current, Date.now());
      return;
    }
    clock.current = rollResume(clock.current, Date.now());
    let frame = 0;
    const step = () => {
      const el = rollElapsed(clock.current, Date.now());
      const box = stage.current;
      const list = rows.current;
      if (box !== null && list !== null) {
        const viewH = box.clientHeight;
        list.style.transform = `translate3d(0, ${rollY(el, plan.ms, viewH, list.offsetHeight) - viewH}px, 0)`;
      }
      if (rollOver(el, plan.ms)) {
        setOver(true);
        return;
      }
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, plan?.ms, reduced]);

  const tap = () => {
    if (!running && !paused) return;
    clock.current = rollToggle(clock.current, Date.now());
    setPaused(rollPaused(clock.current));
  };

  return (
    <CreditsFrame hidden={hidden} onClose={onClose} closeRef={closeBtn}>
      <CreditsBody load={load} plan={plan} reduced={reduced} over={over} paused={paused} onTap={tap} stageRef={stage} rowsRef={rows} />
    </CreditsFrame>
  );
}

/** The full-screen frame and its ✕ (also the lazy fallback's, `lazy.tsx`). */
export function CreditsFrame({ hidden = false, onClose, closeRef, children }: { hidden?: boolean; onClose: () => void; closeRef?: RefObject<HTMLButtonElement | null>; children: ReactNode }) {
  return (
    <div className="credits-roll" role="dialog" aria-modal="true" aria-label="Credits" hidden={hidden}>
      <button type="button" className="credits-x" aria-label={CREDITS_COPY.close} onClick={onClose} ref={closeRef as RefObject<HTMLButtonElement> | undefined}>
        ✕
      </button>
      {children}
    </div>
  );
}

/** The roll's insides for one state (pure render; `test/w44-credits.test.tsx`). */
export function CreditsBody({
  load,
  plan,
  reduced,
  over,
  paused,
  onTap,
  stageRef,
  rowsRef,
}: {
  load: CreditsLoad;
  plan: RollPlan | null;
  reduced: boolean;
  over: boolean;
  paused: boolean;
  onTap?: () => void;
  stageRef?: RefObject<HTMLDivElement | null>;
  rowsRef?: RefObject<HTMLDivElement | null>;
}) {
  if (load.kind === "loading") return <p className="credits-note">{CREDITS_COPY.loading}</p>;
  if (load.kind === "unready" || plan === null) {
    const why: CreditsUnready = load.kind === "unready" ? load.why : "offline";
    return (
      <div className="credits-card" role="alert">
        <p className="credits-card-title">{CREDITS_COPY.unready}</p>
        <p className="credits-card-sub">{CREDITS_COPY.why[why]}</p>
      </div>
    );
  }
  if (reduced) {
    return (
      <div className="credits-list">
        {plan.rows.map((r, i) => (
          <CreditsRowView key={i} row={r} />
        ))}
        <div className="credits-gap" aria-hidden />
        <EndLines lines={plan.end} />
      </div>
    );
  }
  if (over) {
    return (
      <div className="credits-end">
        <EndLines lines={plan.end} />
      </div>
    );
  }
  return (
    <div className="credits-stage" ref={stageRef as RefObject<HTMLDivElement> | undefined} onClick={onTap}>
      <div className="credits-rows" ref={rowsRef as RefObject<HTMLDivElement> | undefined}>
        {plan.rows.map((r, i) => (
          <CreditsRowView key={i} row={r} />
        ))}
      </div>
      <p className={`credits-hint${paused ? " paused" : ""}`} aria-live="polite">
        {paused ? CREDITS_COPY.paused : CREDITS_COPY.tap}
      </p>
    </div>
  );
}

function EndLines({ lines }: { lines: readonly string[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <p key={i} className="credits-end-line">
          {l}
        </p>
      ))}
    </>
  );
}

export function CreditsRowView({ row }: { row: CreditsRow }) {
  switch (row.kind) {
    case "title":
      return <h1 className="credits-title">{row.text}</h1>;
    case "subtitle":
      return <p className="credits-subtitle">{row.text}</p>;
    case "heading":
      return <h2 className="credits-heading">{row.text}</h2>;
    case "person":
      return (
        <div className="credits-person">
          <span className="credits-role">{row.role}</span>
          <span className="credits-name">{row.name}</span>
        </div>
      );
    case "line":
      return <p className="credits-line">{row.text}</p>;
    case "gap":
      return <div className="credits-gap" aria-hidden />;
  }
}
