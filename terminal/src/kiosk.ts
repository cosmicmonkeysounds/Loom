//! Kiosk basics (OCT31 K-15): keep the screen on, and keep passers-by out of
//! setup.
//!
//! - **`ScreenWake`** holds a Screen Wake Lock while the terminal wants one.
//!   The browser drops the lock whenever the page is hidden (screen off,
//!   app switched, Fully Kiosk's screensaver), so it is asked for again on
//!   every `visibilitychange` back to visible. A tablet without the API
//!   (Chrome < 84) just reports `false` — Fully Kiosk's *Keep Screen On* is
//!   the belt to these braces (`docs/trapped/kiosk.md`).
//! - **`LongPress`** fires only after a press held for `HOLD_MS` (2 s): the
//!   ⚙ on a wall tablet opens setup, which can forget the terminal's token,
//!   so a short tap from a curious guest must do nothing.
//!
//! Both are pure over injected browser seams so they test without a DOM.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** How long the ⚙ must be held before setup opens. */
export const HOLD_MS = 2000;

// --- wake lock -----------------------------------------------------------------

export interface WakeSentinel {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}
export interface WakeLockApi {
  request(type: "screen"): Promise<WakeSentinel>;
}
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export class ScreenWake {
  private sentinel: WakeSentinel | null = null;
  private wanted = false;
  private pending: Promise<boolean> | null = null;
  private readonly onVisibility = (): void => {
    if (this.wanted && this.doc.visibilityState === "visible") void this.acquire();
  };

  constructor(
    private readonly api: WakeLockApi | null,
    private readonly doc: VisibilitySource,
    /** Told whenever the lock is taken (true) or lost (false). */
    private readonly onChange: (held: boolean) => void = () => {},
  ) {
    doc.addEventListener("visibilitychange", this.onVisibility);
  }

  /** Whether this browser has a Screen Wake Lock at all. */
  get supported(): boolean {
    return this.api !== null;
  }

  /** Whether a lock is held right now. */
  get held(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  /** Want the screen on from now on: take the lock (now if visible, else on
   *  the next return to visible). Resolves to whether a lock is held. */
  keepOn(): Promise<boolean> {
    this.wanted = true;
    return this.acquire();
  }

  /** Let the screen sleep again and stop listening. */
  async dispose(): Promise<void> {
    this.wanted = false;
    this.doc.removeEventListener("visibilitychange", this.onVisibility);
    const s = this.sentinel;
    this.sentinel = null;
    if (s !== null && !s.released) await s.release().catch(() => {});
    if (s !== null) this.onChange(false);
  }

  private acquire(): Promise<boolean> {
    if (this.api === null || this.doc.visibilityState !== "visible") return Promise.resolve(false);
    if (this.held) return Promise.resolve(true);
    if (this.pending !== null) return this.pending;
    const api = this.api;
    this.pending = api
      .request("screen")
      .then((s) => {
        this.sentinel = s;
        s.addEventListener("release", () => {
          if (this.sentinel !== s) return;
          this.sentinel = null;
          this.onChange(false);
        });
        this.onChange(true);
        return true;
      })
      // NotAllowedError (hidden, battery saver, no permission): try again on
      // the next visibility change or wake tap.
      .catch(() => false)
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
}

/** The page's wake lock seam, or null where the API is missing. */
export function browserWakeLock(): WakeLockApi | null {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { wakeLock?: WakeLockApi });
  return nav?.wakeLock && typeof nav.wakeLock.request === "function" ? nav.wakeLock : null;
}

let shared: ScreenWake | null = null;

/** The one wake lock for this page. Its state rides on `<html
 *  data-wake-lock="held|off|unsupported">`, so a device check can read it
 *  from a remote console (`scripts/accept/K-15.md`). */
export function screenWake(): ScreenWake {
  if (shared === null) {
    const root = document.documentElement;
    const api = browserWakeLock();
    root.dataset.wakeLock = api === null ? "unsupported" : "off";
    shared = new ScreenWake(api, document, (held) => {
      root.dataset.wakeLock = held ? "held" : "off";
    });
  }
  return shared;
}

// --- long press ----------------------------------------------------------------

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
