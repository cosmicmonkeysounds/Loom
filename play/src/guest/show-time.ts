//! A story moment's time on the show clock (wave 18: a Notifications row's
//! "9:41 PM"). The view carries the show minutes at its own story clock;
//! a moment at story ms `at` was that many minutes earlier. No show clock
//! (an old server, a story that never set one) → no time at all.

import { clockText, showClockOf } from "../show-clock.ts";

/** Nothing to say without a show clock. */
export function showClockText(): string {
  return "";
}

/** `(at) → "9:41 PM"` for a view, or the empty clock. */
export function rowClockOf(view: { clock?: number } & Record<string, unknown>): (at: number) => string {
  const sc = showClockOf(view);
  const now = typeof view.clock === "number" ? view.clock : null;
  if (sc === null || now === null) return showClockText;
  return (at) => clockText(sc.minutes - Math.max(0, now - at) / 60_000);
}
