//! The 30-second leash. A piloted session ends when nobody has touched the
//! terminal for `IDLE_MS` — but not while the character is still answering
//! (a reply being composed, or being spoken): cutting a line off mid-word
//! because the guest stood still listening would be absurd. The clock
//! pauses while `busy`, and the 30 s runs again from the moment it clears.
//!
//! Pure: `IdleClock` is fed timestamps, the hook around it owns the timers.

import { useCallback, useEffect, useRef, useState } from "react";

export const IDLE_MS = 30_000;
/** Show the countdown once this much is left. */
export const WARN_MS = 10_000;
/** The heart terminal's file panel: choosing a file takes a while, so the
 *  leash runs this long while it is open — but it still runs (a guest who
 *  walks away from an open panel must not leave their identity piloted). */
export const FILES_IDLE_MS = 120_000;
/** …with the countdown for its last 20 s. */
export const FILES_WARN_MS = 20_000;

/** The heart (wave 20): a menu docked, or a heart to heart — reading four
 *  layers of a hard conversation and choosing takes a while. */
export const HEART_IDLE_MS = 180_000;
/** …with the countdown for its last 30 s. */
export const HEART_WARN_MS = 30_000;

/**
 * The piloted line's leash: held while the character is answering
 * (`answering`: composing, speaking, a room line playing). The heart
 * (`heart`: a heart menu docked, or a heart to heart), a server-room door
 * the talk is waiting on (`doorOpen`: the program is told to shut it, never
 * their fault) and an open file panel lengthen it instead. An open door
 * never holds the line for good: a program who opened it on their way out,
 * or a door that reads open with nobody there, still frees the terminal.
 */
export function lineLeash(o: { answering: boolean; filesOpen: boolean; heart?: boolean; doorOpen?: boolean }): { busy: boolean; limit: number; warnMs: number } {
  const busy = o.answering;
  if (o.heart === true || o.doorOpen === true) return { busy, limit: HEART_IDLE_MS, warnMs: HEART_WARN_MS };
  return o.filesOpen ? { busy, limit: FILES_IDLE_MS, warnMs: FILES_WARN_MS } : { busy, limit: IDLE_MS, warnMs: WARN_MS };
}

/** Is the talk at his heart waiting on the door (`Night.heart_stage` door /
 *  scan / talk)? Sealed or done, an open door is nothing to wait for. */
export function talkWaitsOnDoor(stage: string | null | undefined): boolean {
  return stage === "door" || stage === "scan" || stage === "talk";
}

export class IdleClock {
  private lastInput: number;
  private busySince: number | null = null;
  constructor(
    now: number,
    private readonly limit = IDLE_MS,
  ) {
    this.lastInput = now;
  }
  /** The person did something (typed, tapped, scrolled). */
  touch(now: number): void {
    this.lastInput = now;
  }
  /** The character is answering / speaking — hold the clock. */
  setBusy(busy: boolean, now: number): void {
    if (busy) {
      this.busySince ??= now;
    } else if (this.busySince !== null) {
      // Time spent busy doesn't count: the leash restarts when the line
      // goes quiet again.
      this.lastInput = now;
      this.busySince = null;
    }
  }
  get busy(): boolean {
    return this.busySince !== null;
  }
  /** Milliseconds until the session times out (never below 0). */
  remaining(now: number): number {
    if (this.busySince !== null) return this.limit;
    return Math.max(0, this.limit - (now - this.lastInput));
  }
  expired(now: number): boolean {
    return this.remaining(now) <= 0;
  }
}

/**
 * Run the leash while `active` (`limit` long, the countdown shown for the
 * last `warnMs`; the chess board's is longer). `busy` holds it. Returns `touch` to feed
 * inputs and the seconds left once inside the warning window (else null).
 */
export function useIdleTimeout(opts: { active: boolean; busy: boolean; onTimeout: () => void; limit?: number; warnMs?: number }): {
  touch: () => void;
  /** Seconds left, once inside the warning window (else null). */
  warning: number | null;
  /** Whole seconds left while active (null when not) — for chrome + tests. */
  remaining: number | null;
} {
  const clock = useRef<IdleClock | null>(null);
  const [warning, setWarning] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const onTimeout = useRef(opts.onTimeout);
  onTimeout.current = opts.onTimeout;
  const busyNow = useRef(opts.busy);
  busyNow.current = opts.busy;
  const limit = opts.limit ?? IDLE_MS;
  const warnMs = opts.warnMs ?? WARN_MS;

  useEffect(() => {
    if (!opts.active) {
      clock.current = null;
      setWarning(null);
      setRemaining(null);
      return;
    }
    clock.current = new IdleClock(Date.now(), limit);
    // A new limit mid-session (the file panel opening) keeps a hold that is on.
    clock.current.setBusy(busyNow.current, Date.now());
    let fired = false;
    const tick = window.setInterval(() => {
      const c = clock.current;
      if (c === null || fired) return;
      const now = Date.now();
      const left = c.remaining(now);
      setRemaining(c.busy ? null : Math.ceil(left / 1000));
      setWarning(left <= warnMs ? Math.ceil(left / 1000) : null);
      if (c.expired(now)) {
        fired = true;
        onTimeout.current();
      }
    }, 250);
    return () => window.clearInterval(tick);
  }, [opts.active, limit, warnMs]);

  useEffect(() => {
    clock.current?.setBusy(opts.busy, Date.now());
  }, [opts.busy]);

  const touch = useCallback(() => clock.current?.touch(Date.now()), []);
  return { touch, warning, remaining };
}
