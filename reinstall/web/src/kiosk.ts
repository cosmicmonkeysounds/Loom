//! Keep passers-by out of the tent tablet's setup (OCT31 W-15): ⚙ Setup and
//! 🗺 House map open only after a press held for `HOLD_MS` (2 s). Setup can
//! forget the device's token and the map page saves the live house map, so a
//! short tap from a curious guest must do nothing.
//!
//! A copy of the wall terminal's `LongPress` / `useLongPress`
//! (`terminal/src/kiosk.ts`), pure over injected timers so it tests without
//! a DOM.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** How long a setup control must be held before it opens. */
export const HOLD_MS = 2000;

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export class LongPress {
  private handle: unknown = null;

  constructor(
    private readonly onFire: () => void,
    private readonly ms: number = HOLD_MS,
    private readonly timers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
  ) {}

  /** Whether a press is being held (and has not fired yet). */
  get holding(): boolean {
    return this.handle !== null;
  }

  /** A finger / button went down. */
  down(): void {
    this.cancel();
    this.handle = this.timers.setTimeout(() => {
      this.handle = null;
      this.onFire();
    }, this.ms);
  }

  /** Released, left, or cancelled before the hold completed: nothing happens. */
  cancel(): void {
    if (this.handle === null) return;
    this.timers.clearTimeout(this.handle);
    this.handle = null;
  }
}

/** Pointer handlers for a long-press-only button, plus `holding` for the
 *  fill-up feedback. A plain click does nothing. */
export function useLongPress(onFire: () => void, ms: number = HOLD_MS) {
  const fire = useRef(onFire);
  fire.current = onFire;
  const [holding, setHolding] = useState(false);
  const press = useMemo(
    () =>
      new LongPress(() => {
        setHolding(false);
        fire.current();
      }, ms),
    [ms],
  );
  useEffect(() => () => press.cancel(), [press]);
  const stop = useCallback(() => {
    press.cancel();
    setHolding(false);
  }, [press]);
  return {
    holding,
    handlers: {
      onPointerDown: (e: { preventDefault(): void }) => {
        e.preventDefault();
        press.down();
        setHolding(true);
      },
      onPointerUp: stop,
      onPointerLeave: stop,
      onPointerCancel: stop,
      // Android raises a context menu on a long touch; it would steal the press.
      onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
    },
  };
}
