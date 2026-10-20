//! The booth taskbar's tray (wave 13), three items at most: the act chip
//! (the NOW objective's act, else the cue sheet's; the CRA approver's 🧾
//! held transfers take its place while any wait),
//! the soonest countdown, and the moments layer's missed count.
//! (The chrome lane's `CountdownTray` is the guest's clock; integration may
//! swap it in here once it lands.) A view with `paused: true` stops the
//! countdown and reads ⏸ (`PrimeView.paused`, set while the story clock is stopped).

import { useEffect, useRef, useState } from "react";
import { storyNow } from "../director.tsx";
import { TrayItem } from "../chrome/taskbar.tsx";
import { MissedTray } from "../moments/provider.tsx";
import type { PrimeView } from "../types.ts";
import { heldCount, soonest, trayAct, trayClock, viewPaused } from "./model.ts";

/** Seconds a countdown reads red under (the director phone's `URGENT_S`). */
const URGENT = 60;

export function BoothTray({ view, onWallet }: { view: PrimeView | null; onWallet: () => void }) {
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
  // The performer's own act (the NOW objective's): "Doors" until the show starts, never the act of NEXT ahead of time.
  const act = trayAct(view?.night?.act, view?.objectives);
  return (
    <>
      {held > 0 ? (
        <TrayItem icon="🧾" text={String(held)} title={`${held} held transfer${held === 1 ? "" : "s"} to approve — open the Wallet`} onClick={onWallet} tone="alarm" />
      ) : act !== null ? (
        <TrayItem text={act.text} title={act.title} tone="dim" />
      ) : null}
      {soon !== null && (
        <TrayItem
          text={trayClock(soon.left, paused)}
          title={paused ? `${soon.label}: the clock is stopped (${Math.ceil(soon.left / 60)} min left)` : `${soon.label} ends in ${Math.ceil(soon.left / 60)} min`}
          tone={soon.left < URGENT && !paused ? "alarm" : undefined}
        />
      )}
      <MissedTray />
    </>
  );
}
