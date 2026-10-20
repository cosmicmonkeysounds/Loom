//! The show clock in the taskbar tray (wave 13 K5): the party's time of day,
//! "7:43 PM", the tray's leftmost item on the guest's, the booth's and the
//! host's taskbar — the way Win95 kept its clock at the tray's edge. Grey
//! with ⏸ while the show is paused (the clock holds still, as the story's
//! does). Nothing at all when the view carries no clock.

import type { ReactElement } from "react";
import { clockText, useShowClock, type ShowClock } from "../show-clock.ts";
import { Icon } from "./icons.tsx";
import { TrayItem } from "./taskbar.tsx";

/** What the tray item shows (pure, tested). */
export function showClockTray(now: { minutes: number; running: boolean }): { text: string; paused: boolean; title: string } {
  const text = clockText(now.minutes);
  return now.running ? { text, paused: false, title: `The party's clock: ${text}` } : { text, paused: true, title: `The party's clock: ${text} (paused)` };
}

/** The tray item for a clock already worked out (the hook's answer). */
export function ShowClockItem({ now }: { now: { minutes: number; running: boolean } }): ReactElement {
  const shown = showClockTray(now);
  return (
    <span className={`tray-clock${shown.paused ? " paused" : ""}`} data-testid="tray-show-clock">
      <TrayItem icon={shown.paused ? <Icon name="pause" /> : undefined} text={shown.text} title={shown.title} tone={shown.paused ? "dim" : undefined} />
    </span>
  );
}

function Live({ clock }: { clock: ShowClock }) {
  const now = useShowClock(clock);
  return now === null ? null : <ShowClockItem now={now} />;
}

/** The tray clock. Null before any hook runs when the view has no clock. */
export function ShowClockTray({ clock }: { clock: ShowClock | null | undefined }): ReactElement | null {
  if (clock === null || clock === undefined) return null;
  return <Live clock={clock} />;
}
