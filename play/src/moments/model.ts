//! The moments model (wave 13; the moments lane fills it): the pure queue
//! of moments rendered by the interrupt ladder. Stage A: types only.

import type { AlertLevel, MomentClass } from "../types.ts";

/** One moment waiting to be shown. */
export interface Moment {
  /** The message it came from (its seq), or a client-made key. */
  key: string;
  seq: number | null;
  severity: MomentClass;
  text: string;
  /** "Take me there": the room it belongs to, when it has one. */
  channel: string | null;
  /** The story clock (ms) when it arrived. */
  at: number;
}

/** How a moment renders at a level (`lowerRung` for a minor one). */
export interface MomentRender {
  moment: Moment;
  level: AlertLevel;
}
