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
 * Run the leash while `active`. `busy` holds it. Returns `touch` to feed
 * inputs and the seconds left once inside the warning window (else null).
 */
export function useIdleTimeout(opts: { active: boolean; busy: boolean; onTimeout: () => void; limit?: number }): {
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
  const limit = opts.limit ?? IDLE_MS;

  useEffect(() => {
    if (!opts.active) {
      clock.current = null;
      setWarning(null);
      setRemaining(null);
      return;
    }
    clock.current = new IdleClock(Date.now(), limit);
    let fired = false;
    const tick = window.setInterval(() => {
      const c = clock.current;
      if (c === null || fired) return;
      const now = Date.now();
      const left = c.remaining(now);
      setRemaining(c.busy ? null : Math.ceil(left / 1000));
      setWarning(left <= WARN_MS ? Math.ceil(left / 1000) : null);
      if (c.expired(now)) {
        fired = true;
        onTimeout.current();
      }
    }, 250);
    return () => window.clearInterval(tick);
  }, [opts.active, limit]);

  useEffect(() => {
    clock.current?.setBusy(opts.busy, Date.now());
  }, [opts.busy]);

  const touch = useCallback(() => clock.current?.touch(Date.now()), []);
  return { touch, warning, remaining };
}
