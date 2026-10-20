//! The show clock (wave 13 K5): the party's own time of day, "7:43 PM",
//! that every phone, booth and host shows in its taskbar tray and the
//! director phone in its strip. The story keeps it as two journaled world
//! values (`Clock.set_to` show minutes after midnight, `Clock.set_at` story
//! seconds); the server sends the time it works out as a view's `showClock`
//! `{minutes, running}`. The client re-bases on every new view and ticks on
//! from its own receive time while `running` (story time: it holds still
//! while the show is paused). No `showClock` → no clock anywhere.
//!
//! The field is `showClock` because every view already has `clock` (the
//! story clock in ms the countdowns tick from). `showClockOf` also accepts a
//! `clock` that is an object of this shape, so either server spelling works.

import { useEffect, useRef, useState } from "react";

/** A view's show clock: the show minutes after midnight when the view was
 *  built (may pass 1440 = past midnight), and whether it runs. */
export interface ShowClock {
  minutes: number;
  running: boolean;
}

function asShowClock(v: unknown): ShowClock | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o["minutes"] !== "number" || !Number.isFinite(o["minutes"])) return null;
  // The view's own object, never a copy: `useShowClock` re-bases on identity.
  return v as ShowClock;
}

/** The show clock a view carries, or null (an old server, a story that never set one). */
export function showClockOf(view: unknown): ShowClock | null {
  if (view === null || typeof view !== "object") return null;
  const o = view as Record<string, unknown>;
  return asShowClock(o["showClock"]) ?? asShowClock(o["clock"]);
}

/** Show minutes as a 12-hour Win95 tray clock: 1140 → "7:00 PM", 1439 →
 *  "11:59 PM", 1440 → "12:00 AM", 1445 → "12:05 AM", 720 → "12:00 PM". */
export function clockText(minutes: number): string {
  const whole = Math.floor(minutes);
  const m = ((whole % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** The show minutes now: the view's minutes plus the wall time since it
 *  arrived while the clock runs, the view's minutes as they are while it is
 *  stopped (pure — the hook's math). */
export function showMinutesAt(clock: ShowClock, receivedAt: number, now: number): number {
  return clock.running === true ? clock.minutes + Math.max(0, now - receivedAt) / 60_000 : clock.minutes;
}

/** A host's "Set to…" entry as the route's `time`: "7:05" + "PM" → "7:05 PM";
 *  null unless it is a 12-hour time (1–12, two-digit minutes). */
export function setToTime(hm: string, half: "AM" | "PM"): string | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/u.exec(hm);
  if (m === null) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 1 || h > 12 || mm > 59) return null;
  return `${h}:${m[2]} ${half}`;
}

/** The show minutes as a host's Set to… fields: 1150 → {hm: "7:10", half: "PM"}. */
export function setToFields(minutes: number): { hm: string; half: "AM" | "PM" } {
  const [hm, half] = clockText(minutes).split(" ") as [string, "AM" | "PM"];
  return { hm, half };
}

/**
 * The show clock now, ticking once a second while it runs. Re-bases on every
 * new clock object (each snapshot or poll builds one), so a host's nudge
 * lands on the next view. Null when the view has no clock.
 */
export function useShowClock(clock: ShowClock | null | undefined): { minutes: number; running: boolean } | null {
  const base = useRef<{ clock: ShowClock | null | undefined; at: number }>({ clock, at: Date.now() });
  if (base.current.clock !== clock) base.current = { clock, at: Date.now() };
  const [now, setNow] = useState(() => Date.now());
  const running = clock?.running === true;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, clock]);
  if (clock === null || clock === undefined) return null;
  return { minutes: showMinutesAt(clock, base.current.at, Math.max(now, base.current.at)), running };
}
