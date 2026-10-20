//! The tray clock (wave 13; the chrome lane fills it): the soonest live
//! countdown as "⏳ 14:59". Stage A: nothing.

import type { ReactElement } from "react";
import type { CountdownSummary } from "../types.ts";

export function CountdownTray(_p: { countdowns?: CountdownSummary[]; clock?: number; paused?: boolean }): ReactElement | null {
  return null;
}
