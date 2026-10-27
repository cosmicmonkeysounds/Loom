// Which server the bots may touch, and how carefully. Pure.

import { isLocal } from "./http.ts";

/** The server to run against: `--base`, else `LOOM_SERVER`. There is no
 *  default: a run must name its server. Null when neither is given. */
export function resolveBase(flag: string | undefined, env: string | undefined): string | null {
  const b = (flag ?? env ?? "").trim().replace(/\/+$/u, "");
  return b === "" ? null : b;
}

/** Port 7000 on this laptop is the user's own dev server (`pnpm dev`, the
 *  `loom_dev` database with their own events), never a scratch server. */
export function isDevServer(base: string): boolean {
  if (!isLocal(base)) return false;
  try {
    const u = new URL(base);
    return (u.port === "" ? (u.protocol === "https:" ? "443" : "80") : u.port) === "7000";
  } catch {
    return false;
  }
}

/** A scratch server: on this laptop and not the dev server. Only a scratch
 *  server skips the guard's y/N and may be reset. */
export const isScratch = (base: string): boolean => isLocal(base) && !isDevServer(base);

/** The guard first, always; the reset only after it passed (the guard
 *  exits the process on a refusal or a "no", so a refused run never
 *  resets). Returns whether it reset. */
export async function guardThenReset(guard: () => Promise<void>, reset: () => Promise<void>, wantReset: boolean): Promise<boolean> {
  await guard();
  if (!wantReset) return false;
  await reset();
  return true;
}

/** `--reset-after` only on a scratch server, and only once the night this
 *  run played actually started: a run that stopped before (the doors found
 *  a night already under way, a failed login, a crash) leaves the event as
 *  it found it, for inspection. */
export function mayResetAfter(opts: { flag: boolean; scratch: boolean; nightStarted: boolean }): boolean {
  return opts.flag && opts.scratch && opts.nightStarted;
}

/** What the doors may do, read before anything is pressed. Only a fresh
 *  night opens: never started (`idle`, the world still empty or at step 0)
 *  gets Power On; already open at step 0 just takes the codes. Anything
 *  else (a night under way, or a paused event, which Power On would
 *  resume) is refused with nothing pressed. */
export type Doors = { kind: "start" } | { kind: "open" } | { kind: "refuse"; why: string };
export function doorsDecision(phase: string | undefined, step: string): Doors {
  const fresh = step === "0" || step === "none";
  if (!fresh) return { kind: "refuse", why: `Night.step is ${step}: not a fresh night` };
  if (phase === "idle") return { kind: "start" };
  if (phase === "open" && step === "0") return { kind: "open" };
  return { kind: "refuse", why: `the event is ${phase ?? "in an unknown phase"} at Night.step ${step}: not a fresh night (Power On would ${phase === "paused" ? "resume it" : "touch it"})` };
}
