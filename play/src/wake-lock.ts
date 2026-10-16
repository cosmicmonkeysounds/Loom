//! "Keep screen on" (K-06): an opt-in Screen Wake Lock so a phone left on a
//! table — an Antivirus booth, a guest waiting for the next alert — never
//! sleeps through a `!` alert. The browser drops the lock whenever the page
//! is hidden, so it is re-requested each time the page becomes visible.
//! The choice is remembered per device (`loom.wakeLock`).

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionStorage } from "./host.ts";

const KEY = "loom.wakeLock";

interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock ?? null;
}

/** Does this browser offer a screen wake lock? (Safari: iOS 16.4+.) */
export function wakeLockSupported(): boolean {
  return wakeLockApi() !== null;
}

export interface WakeLock {
  /** The browser offers a screen wake lock at all. */
  supported: boolean;
  on: boolean;
  toggle: () => void;
}

export function useWakeLock(storage: SessionStorage): WakeLock {
  const api = wakeLockApi();
  const [on, setOn] = useState<boolean>(() => {
    try {
      return storage.load<boolean>(KEY) === true;
    } catch {
      return false;
    }
  });
  const held = useRef<WakeLockSentinelLike | null>(null);

  const acquire = useCallback(() => {
    if (api === null || held.current !== null) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    api.request("screen").then(
      (s) => {
        held.current = s;
        // The browser released it (page hidden): forget it so it is re-taken.
        (s as unknown as EventTarget).addEventListener?.("release", () => {
          if (held.current === s) held.current = null;
        });
      },
      () => {
        /* refused (battery saver, no gesture yet) — the next visible retries */
      },
    );
  }, [api]);
  const release = useCallback(() => {
    const s = held.current;
    held.current = null;
    void s?.release().catch(() => {});
  }, []);

  useEffect(() => {
    if (!on) {
      release();
      return;
    }
    acquire();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        held.current = null;
        acquire();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [on, acquire, release]);

  const toggle = useCallback(() => {
    const next = !on;
    try {
      storage.save(KEY, next);
    } catch {
      /* fine */
    }
    // Ask inside the tap: some browsers want a user gesture for the first lock.
    if (next) acquire();
    setOn(next);
  }, [on, storage, acquire]);

  return { supported: api !== null, on, toggle };
}
