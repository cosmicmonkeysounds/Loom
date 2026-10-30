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
//! Wave 26 (P2): a windowed booth (a player's or a host's window buttons on
//! the bar) lays the tray out in priority order (`boothTrayOrder`: 🔔 → 🚨
//! → held receipt → countdown → ⭐ / act → clock), so the guest-style cap
//! (two items under 430 px, `css/booth.css`) drops the least important.
//! Wave 48 (C5): the censor's `🔑 n` (flagged lines to judge → the filter
//! window) follows 🚨, only while n > 0.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { storyNow } from "../director.tsx";
import { TrayItem } from "../chrome/taskbar.tsx";
import { ShowClockTray } from "../chrome/show-clock-tray.tsx";
import { showClockOf } from "../show-clock.ts";
import { Icon } from "../chrome/icons.tsx";
import { BoothIcon } from "./icons.tsx";
import type { PrimeView } from "../types.ts";
import { heldCount, soonest, trayAct, trayClock, viewPaused } from "./model.ts";
import { isPlayer, statsOf } from "./wire.ts";
import { FILTER_COPY } from "./filter/model.ts";

/** Seconds a countdown reads red under (the director phone's `URGENT_S`). */
const URGENT = 60;

/** The Minesweeper LED's digits: "003" (three wide, capped at 999). */
export function ledDigits(n: number): string {
  return String(Math.min(999, Math.max(0, Math.floor(n)))).padStart(3, "0");
}

/** A tray item's id, in the order `boothTrayOrder` gives. */
export type TrayId = "waiting" | "loose" | "filter" | "held" | "countdown" | "stat" | "act" | "clock";

/** Wave 26 (P2): the windowed booth's tray, most important first; the show
 *  clock always last (the Win95 place), and only what is present. Wave 48:
 *  the censor's 🔑 after 🚨. */
export function boothTrayOrder(o: { waiting: boolean; loose: boolean; filter?: boolean; held: boolean; soon: boolean; stat: boolean; act: boolean; clock: boolean }): TrayId[] {
  const order: TrayId[] = ["waiting", "loose", "filter", "held", "countdown", "stat", "act", "clock"];
  const has: Record<TrayId, boolean> = { waiting: o.waiting, loose: o.loose, filter: o.filter === true, held: o.held, countdown: o.soon, stat: o.stat, act: o.act, clock: o.clock };
  return order.filter((id) => has[id]);
}

export function BoothTray({
  view,
  onWallet,
  loose = null,
  waiting = 0,
  onBoard,
  onWaiting,
  filter = null,
  onFilter,
  windowed = false,
}: {
  view: PrimeView | null;
  onWallet: () => void;
  /** Wave 18 (§3): marked programs still loose — the 🚨 LED; null = this booth gets no board. */
  loose?: number | null;
  /** Pop-outs waiting (deferred + queued): 🔔 n. */
  waiting?: number;
  onBoard?: () => void;
  onWaiting?: () => void;
  /** Wave 48 (C5): the censor's flagged lines to judge — `🔑 n` while n > 0; null = not the censor. */
  filter?: number | null;
  onFilter?: () => void;
  /** Wave 26 (P2): a windowed booth — priority order, the clock last. */
  windowed?: boolean;
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
  const clock = showClockOf(view);
  const led =
    loose !== null && loose > 0 ? (
      <button key="loose" type="button" className="tray-item led" title={`Marked and loose: ${loose}`} aria-label={`Marked and loose: ${loose}`} onClick={onBoard}>
        <span aria-hidden>🚨</span>
        <span className="led-digits">{ledDigits(loose)}</span>
      </button>
    ) : null;
  const bell = waiting > 0 ? <TrayItem key="waiting" text={`🔔 ${waiting}`} title={`${waiting} waiting for you`} onClick={onWaiting} tone="alarm" /> : null;
  // Wave 48 (C5): calm, no alarm tone: a flood of flags is expected.
  const flagged = filter !== null && filter > 0 ? <TrayItem key="filter" text={`${FILTER_COPY.glyph} ${filter}`} title={FILTER_COPY.trayTitle(filter)} onClick={onFilter} /> : null;
  const receipt = held > 0 ? <TrayItem key="held" icon={<BoothIcon name="receipt" />} text={String(held)} title={`${held} held transfer${held === 1 ? "" : "s"} to approve — open the Wallet`} onClick={onWallet} tone="alarm" /> : null;
  const actChip = (yields: boolean) =>
    act !== null ? (
      <span key="act" className={`tray-act${yields ? " yields" : ""}`}>
        <TrayItem text={act.text} title={act.title} />
      </span>
    ) : null;
  const statChip =
    stat !== null ? (
      <span key="stat" className="tray-stat">
        <TrayItem text={`${stat.glyph} ${stat.value}`.trim()} title={`${stat.label}: ${stat.value}`} />
      </span>
    ) : null;
  const countdown =
    soon !== null ? (
      <TrayItem
        key="countdown"
        icon={<Icon name={paused ? "pause" : "hourglass"} />}
        text={trayClock(soon.left, paused, false)}
        title={paused ? `${soon.label}: the clock is stopped (${Math.ceil(soon.left / 60)} min left)` : `${soon.label} ends in ${Math.ceil(soon.left / 60)} min`}
        tone={soon.left < URGENT && !paused ? "alarm" : undefined}
      />
    ) : null;
  if (windowed) {
    const ids = boothTrayOrder({ waiting: bell !== null, loose: led !== null, filter: flagged !== null, held: receipt !== null, soon: countdown !== null, stat: statChip !== null, act: act !== null, clock: clock !== null && clock !== undefined });
    const others = ids.some((id) => id !== "clock");
    const item: Record<TrayId, ReactNode> = { waiting: bell, loose: led, filter: flagged, held: receipt, countdown, stat: statChip, act: actChip(false), clock: <ShowClockTray key="clock" clock={clock} yields={others} /> };
    return <>{ids.map((id) => item[id])}</>;
  }
  return (
    <>
      {led}
      {bell}
      {flagged}
      <ShowClockTray clock={clock} yields={soon !== null} />
      {receipt ?? actChip(soon !== null) ?? statChip}
      {countdown}
    </>
  );
}
