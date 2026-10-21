//! Where the reinstallation flow starts for a scanned program — pure, so
//! both devices decide the same way (wave 18b): the standalone wizard
//! (`app.tsx`, always the choose card) and the tent laptop's terminal
//! (`view=reinstall`, which skips the card when there is nothing to choose).

import { programState, type Program } from "./program.ts";
import type { DeviceRole } from "./config.ts";

/**
 * - `refuse` — the server's begin would turn them away (healthy, or held by
 *   a director and not marked): nothing to start, never a begin;
 * - `choose` — the choose card: a headset is online to send to (a device
 *   that may send) or the headsets aren't known yet (`onlineVr` null: no
 *   station poll has answered, so one may be ready — D8), the device only
 *   sends (`station`), or this browser can't draw the game (the card says
 *   why Play here is off);
 * - `play`   — straight to Play here: nothing else this device could do.
 */
export type FirstStep = "choose" | "play" | "refuse";

export function firstStep(program: Pick<Program, "captured" | "restricted" | "eligible" | "marked" | "favour">, ended: boolean, role: DeviceRole, onlineVr: number | null, canDraw: boolean): FirstStep {
  const state = programState(program, ended);
  if (state === "healthy" || state === "held") return "refuse";
  if (role === "station") return "choose";
  if (role === "both" && (onlineVr === null || onlineVr > 0)) return "choose";
  return canDraw ? "play" : "choose";
}

/** What `armIdleTimeout` needs of `window` (a fake in the tests). */
export interface TimeoutHost {
  addEventListener(type: string, fn: () => void, opts?: AddEventListenerOptions): void;
  removeEventListener(type: string, fn: () => void, opts?: AddEventListenerOptions): void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** The input that counts as someone still at the card. */
export const IDLE_INPUTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

/**
 * Calls `onTimeout` once after `ms` with no touch, click, key or wheel on
 * `host` (any input restarts the count). The unattended tent laptop's
 * choose card (wave 18b): a guest who walks away from it must not hold the
 * station busy all night. Returns the disarm.
 */
export function armIdleTimeout(host: TimeoutHost, ms: number, onTimeout: () => void): () => void {
  let timer = 0;
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    disarm();
    onTimeout();
  };
  const restart = () => {
    if (done) return;
    host.clearTimeout(timer);
    timer = host.setTimeout(fire, ms);
  };
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  const disarm = () => {
    host.clearTimeout(timer);
    for (const t of IDLE_INPUTS) host.removeEventListener(t, restart, opts);
  };
  for (const t of IDLE_INPUTS) host.addEventListener(t, restart, opts);
  restart();
  return () => {
    done = true;
    disarm();
  };
}
