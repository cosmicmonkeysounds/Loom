//! The guest's countdown strip (W11, SW-PLAY-05): the story's
//! guest-facing clocks (`countdown: Night.summons_end as Summons for
//! guests`) ticking under the room header — Bingo, both hunts, the
//! filings, the summons, Midnight — so a guest in the tent or a far
//! bedroom knows a clock is running before the `!` warning.
//!
//! The deadline is the server's (`endsAt`, story seconds) against the
//! snapshot's story `clock` plus the wall time since it arrived — never the
//! phone's own date. While the event is paused (`paused`) the clock holds
//! still and the strip says ⏸. No countdowns → no strip at all.

import { useEffect, useRef, useState } from "react";
import { countdownLeft } from "../../core/src/cue-sheet.ts";
import { URGENT_S, formatLeft, storyNow } from "./director.tsx";
import type { CountdownSummary } from "./types.ts";

export interface CountdownItem {
  label: string;
  /** Whole seconds left. */
  left: number;
  /** Under a minute: the strip reads red. */
  urgent?: true;
}

/** The countdowns still ahead at story time `nowMs`, soonest first (one
 *  that ran out on the phone drops before the next snapshot says so). */
export function countdownItems(countdowns: readonly CountdownSummary[] | undefined, nowMs: number | null): CountdownItem[] {
  const out: CountdownItem[] = [];
  for (const c of countdowns ?? []) {
    const left = countdownLeft(c.endsAt, nowMs);
    if (left !== null) out.push({ label: c.label, left, ...(left < URGENT_S ? { urgent: true as const } : {}) });
  }
  return out.sort((a, b) => a.left - b.left || a.label.localeCompare(b.label));
}

/** One item as the strip reads it: `⏳ Summons 1:40`. */
export function countdownItemText(item: CountdownItem): string {
  return `⏳ ${item.label} ${formatLeft(item.left)}`;
}

/** What the strip says while the clock is stopped. */
export const COUNTDOWN_PAUSED = "⏸ paused";

/**
 * The story clock now (ms) on the phone: the snapshot's `clock` plus the
 * wall time since it arrived (re-based by every new reading), re-read once
 * a second while `ticking` — or the snapshot's own while `paused`.
 */
export function useStoryNow(clock: number | undefined, paused: boolean, ticking: boolean): number | null {
  const arrived = useRef({ clock, at: Date.now() });
  if (arrived.current.clock !== clock) arrived.current = { clock, at: Date.now() };
  const [wall, setWall] = useState(() => Date.now());
  const runs = !paused;
  useEffect(() => {
    if (!ticking || !runs) return;
    setWall(Date.now());
    const t = setInterval(() => setWall(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking, runs]);
  return storyNow(clock, arrived.current.at, Math.max(wall, arrived.current.at), runs);
}

/** The strip itself (pure render: the caller owns the clock). */
export function CountdownStripView({ items, paused }: { items: readonly CountdownItem[]; paused: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className={`countdown-strip ${paused ? "held" : ""}`} role="timer" aria-label="The story's clocks">
      {paused && <span className="countdown-paused">{COUNTDOWN_PAUSED}</span>}
      {items.map((i) => (
        <span key={i.label} className={`countdown-item ${i.urgent ? "urgent" : ""}`}>
          {countdownItemText(i)}
        </span>
      ))}
    </div>
  );
}

/** The ticking strip for a guest view's `countdowns` / `clock` / `paused`. */
export function CountdownStrip({ countdowns, clock, paused }: { countdowns: readonly CountdownSummary[] | undefined; clock: number | undefined; paused: boolean }) {
  const ticking = (countdowns?.length ?? 0) > 0;
  const nowMs = useStoryNow(clock, paused, ticking);
  return <CountdownStripView items={countdownItems(countdowns, nowMs)} paused={paused} />;
}
