//! The booth taskbar's tray (wave 13): the show clock first (K5,
//! `chrome/show-clock-tray.tsx`), then three items at most: the act chip
//! (the story's current act — the cue sheet's, the one the NEXT strip
//! shows — set in full ink; the CRA approver's held transfers take its
//! place while any wait),
//! the soonest countdown. Wave 18 (BOOTH-SPEC §3): the 🚨 Minesweeper LED
//! (marked programs still loose → the Wanted board) and 🔔 n (pop-outs
//! waiting → the Waiting window) lead; the missed count is gone.
//! (The chrome lane's `CountdownTray` is the guest's clock; integration may
//! swap it in here once it lands.) A view with `paused: true` stops the
//! countdown and reads ⏸ (`PrimeView.paused`, set while the story clock is stopped).
//! Wave 21 (P1): a player's tray has no act chip; its first `stat:` line
//! sits there as a chip instead (⭐ 120).

import { useEffect, useRef, useState } from "react";
import { storyNow } from "../director.tsx";
import { TrayItem } from "../chrome/taskbar.tsx";
import { ShowClockTray } from "../chrome/show-clock-tray.tsx";
import { showClockOf } from "../show-clock.ts";
import { Icon } from "../chrome/icons.tsx";
import { BoothIcon } from "./icons.tsx";
import type { PrimeView } from "../types.ts";
import { heldCount, soonest, trayAct, trayClock, viewPaused } from "./model.ts";
import { isPlayer, statsOf } from "./wire.ts";

/** Seconds a countdown reads red under (the director phone's `URGENT_S`). */
const URGENT = 60;

/** The Minesweeper LED's digits: "003" (three wide, capped at 999). */
export function ledDigits(n: number): string {
  return String(Math.min(999, Math.max(0, Math.floor(n)))).padStart(3, "0");
}

export function BoothTray({
  view,
  onWallet,
  loose = null,
  waiting = 0,
  onBoard,
  onWaiting,
}: {
  view: PrimeView | null;
  onWallet: () => void;
  /** Wave 18 (§3): marked programs still loose — the 🚨 LED; null = this booth gets no board. */
  loose?: number | null;
  /** Pop-outs waiting (deferred + queued): 🔔 n. */
  waiting?: number;
  onBoard?: () => void;
  onWaiting?: () => void;
}) {
  // The story clock between snapshots: the view's clock plus the wall time
  // since it arrived (a quiet stretch pushes no view).
  const got = useRef({ clock: view?.clock, at: Date.now() });
  if (got.current.clock !== view?.clock) got.current = { clock: view?.clock, at: Date.now() };
  const [tick, setTick] = useState(0);
  // A paused event's clock holds still: the countdown reads ⏸ and stops.
  const paused = viewPaused(view);
  const counting = (view?.countdowns?.length ?? 0) > 0 && !paused;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [counting]);
  void tick;
  const nowMs = storyNow(got.current.clock, got.current.at, Date.now(), !paused);
  const soon = soonest(view?.countdowns, nowMs);
  const held = heldCount(view?.wallet);
  // D2: the story's act (the cue sheet's, as the NEXT strip reads it): "Doors" until the show starts.
  const word = (view as { act?: unknown } | null)?.act;
  // Wave 21 (P1, D7): a player gets no act; its first stat stands there.
  const player = isPlayer(view);
  const act = player ? null : trayAct(view?.night?.act, view?.night?.step, typeof word === "string" ? word : null);
  const stat = player ? (statsOf(view)[0] ?? null) : null;
  return (
    <>
      {loose !== null && loose > 0 && (
        <button type="button" className="tray-item led" title={`Marked and loose: ${loose}`} aria-label={`Marked and loose: ${loose}`} onClick={onBoard}>
          <span aria-hidden>🚨</span>
          <span className="led-digits">{ledDigits(loose)}</span>
        </button>
      )}
      {waiting > 0 && <TrayItem text={`🔔 ${waiting}`} title={`${waiting} waiting for you`} onClick={onWaiting} tone="alarm" />}
      <ShowClockTray clock={showClockOf(view)} yields={soon !== null} />
      {held > 0 ? (
        <TrayItem icon={<BoothIcon name="receipt" />} text={String(held)} title={`${held} held transfer${held === 1 ? "" : "s"} to approve — open the Wallet`} onClick={onWallet} tone="alarm" />
      ) : act !== null ? (
        <span className={`tray-act${soon !== null ? " yields" : ""}`}>
          <TrayItem text={act.text} title={act.title} />
        </span>
      ) : stat !== null ? (
        <span className="tray-stat">
          <TrayItem text={`${stat.glyph} ${stat.value}`.trim()} title={`${stat.label}: ${stat.value}`} />
        </span>
      ) : null}
      {soon !== null && (
        <TrayItem
          icon={<Icon name={paused ? "pause" : "hourglass"} />}
          text={trayClock(soon.left, paused, false)}
          title={paused ? `${soon.label}: the clock is stopped (${Math.ceil(soon.left / 60)} min left)` : `${soon.label} ends in ${Math.ceil(soon.left / 60)} min`}
          tone={soon.left < URGENT && !paused ? "alarm" : undefined}
        />
      )}
    </>
  );
}
