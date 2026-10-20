//! The tray clock (wave 13): the soonest live countdown of the story's
//! guest-facing clocks (`countdown: … for guests`) as one tray item,
//! "⏳ 4:59" — the hourglass first, so it never reads as a time of day —
//! "⏳ 14 m" from ten minutes out. A tap opens a balloon with the whole
//! line ("Hunt 1 ends in 14 min 59 s"). Red under a minute; ⏸ while the
//! event is paused (the clock holds still). It replaces the old countdown
//! strip under the room header: one clock on screen, always under the thumb.
//!
//! The time is the server's (`endsAt` against the snapshot's story clock
//! plus the wall time since), read by `countdown.tsx`'s `useStoryNow`.

import { useState, type ReactElement } from "react";
import { URGENT_S } from "../director.tsx";
import { countdownItems, useStoryNow, type CountdownItem } from "../countdown.tsx";
import type { CountdownSummary } from "../types.ts";
import { TrayBalloon, TraySlot } from "./balloon.tsx";
import { TrayItem } from "./taskbar.tsx";

/** The tray's short form of `left` seconds: `4:59` under ten minutes,
 *  `14 m` under two hours, `2 h` past that. */
export function trayClockText(left: number): string {
  const s = Math.max(0, Math.floor(left));
  if (s < 600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (s < 7200) return `${Math.floor(s / 60)} m`;
  return `${Math.floor(s / 3600)} h`;
}

/** `left` seconds spelled out for the balloon: "14 min 59 s", "1 h 5 min", "40 s". */
export function spokenLeft(left: number): string {
  const s = Math.max(0, Math.floor(left));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return ss > 0 ? `${m} min ${ss} s` : `${m} min`;
  return `${ss} s`;
}

/** The balloon's line for one countdown: "Hunt 1 ends in 14 min 59 s",
 *  "Midnight in 2 h" (the show's labels carry their own verb). */
export function countdownBalloonLine(item: CountdownItem, paused: boolean): string {
  return `${item.label} in ${spokenLeft(item.left)}${paused ? " (the clock is paused)" : ""}`;
}

/** What the tray item shows for the soonest countdown (pure, tested). */
export function trayClock(item: CountdownItem, paused: boolean): { icon: string; text: string; tone?: "alarm" | "dim"; title: string } {
  const tone = paused ? ("dim" as const) : item.left < URGENT_S ? ("alarm" as const) : undefined;
  return { icon: paused ? "⏸" : "⏳", text: trayClockText(item.left), ...(tone !== undefined ? { tone } : {}), title: countdownBalloonLine(item, paused) };
}

function LiveTray({ countdowns, clock, paused, stamp }: { countdowns: readonly CountdownSummary[]; clock?: number; paused: boolean; stamp?: unknown }) {
  const nowMs = useStoryNow(clock, paused, true, stamp);
  const items = countdownItems(countdowns, nowMs);
  const [open, setOpen] = useState(false);
  const first = items[0];
  if (first === undefined) return null;
  const shown = trayClock(first, paused);
  return (
    <TraySlot>
      <TrayItem icon={shown.icon} text={shown.text} title={shown.title} tone={shown.tone} onClick={() => setOpen((v) => !v)} />
      {open && (
        <TrayBalloon title={paused ? "⏸ The clock is paused" : "⏳ The clock is running"} onClose={() => setOpen(false)} label="The story's clocks">
          {items.map((i) => (
            <div key={i.label} className={`tray-balloon-line ${!paused && i.left < URGENT_S ? "urgent" : ""}`}>
              {countdownBalloonLine(i, false)}
            </div>
          ))}
        </TrayBalloon>
      )}
    </TraySlot>
  );
}

/**
 * The tray clock. Nothing at all when the story runs no guest-facing
 * countdown (an old server sends no field) — checked before any hook runs,
 * so the stub-era callers that invoke it bare still get null.
 */
export function CountdownTray({ countdowns, clock, paused, stamp }: { countdowns?: CountdownSummary[]; clock?: number; paused?: boolean; stamp?: unknown }): ReactElement | null {
  if (countdowns === undefined || countdowns.length === 0) return null;
  return <LiveTray countdowns={countdowns} clock={clock} paused={paused === true} stamp={stamp} />;
}
