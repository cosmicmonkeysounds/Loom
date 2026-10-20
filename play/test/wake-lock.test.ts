//! Wave 13 (chrome): the full-screen pass holds the screen awake while it is
//! up — taken at once, taken again when the page comes back, released on
//! close (even a lock the browser hands over after the close).

import { describe, expect, it } from "vitest";
import { holdWakeLock, type WakeLockSentinelLike } from "../src/wake-lock.ts";

function fakes(visible = true) {
  const doc = {
    visibilityState: (visible ? "visible" : "hidden") as DocumentVisibilityState,
    listeners: new Set<() => void>(),
    addEventListener(_: string, f: () => void) {
      this.listeners.add(f);
    },
    removeEventListener(_: string, f: () => void) {
      this.listeners.delete(f);
    },
    show(v: boolean) {
      this.visibilityState = v ? "visible" : "hidden";
      for (const f of this.listeners) f();
    },
  };
  const locks: Array<{ released: boolean; drop: () => void }> = [];
  let pending: Array<(s: WakeLockSentinelLike) => void> = [];
  const api = {
    request: () =>
      new Promise<WakeLockSentinelLike>((resolve) => {
        pending.push(resolve);
      }),
  };
  /** The browser grants every request made so far. */
  const grant = async () => {
    const now = pending;
    pending = [];
    for (const resolve of now) {
      const handlers: Array<() => void> = [];
      const lock = {
        released: false,
        release: async () => void (lock.released = true),
        addEventListener: (_: string, f: () => void) => handlers.push(f),
        drop: () => handlers.forEach((f) => f()),
      };
      locks.push(lock);
      resolve(lock as unknown as WakeLockSentinelLike);
    }
    await Promise.resolve();
  };
  return { doc, api, locks, grant, asked: () => pending.length };
}

describe("holdWakeLock", () => {
  it("takes the lock at once and releases it on stop", async () => {
    const f = fakes();
    const stop = holdWakeLock(f.api, f.doc as unknown as Document);
    expect(f.asked()).toBe(1);
    await f.grant();
    stop();
    expect(f.locks[0]!.released).toBe(true);
    expect(f.doc.listeners.size).toBe(0);
  });

  it("takes it again when the page comes back after the browser dropped it", async () => {
    const f = fakes();
    const stop = holdWakeLock(f.api, f.doc as unknown as Document);
    await f.grant();
    f.locks[0]!.drop(); // the screen locked: the browser releases it
    f.doc.show(false);
    expect(f.asked()).toBe(0);
    f.doc.show(true);
    expect(f.asked()).toBe(1);
    stop();
  });

  it("asks nothing while the page is hidden", () => {
    const f = fakes(false);
    const stop = holdWakeLock(f.api, f.doc as unknown as Document);
    expect(f.asked()).toBe(0);
    stop();
  });

  it("a lock that arrives after the pass closed is released straight away", async () => {
    const f = fakes();
    const stop = holdWakeLock(f.api, f.doc as unknown as Document);
    stop();
    await f.grant();
    await Promise.resolve();
    expect(f.locks[0]!.released).toBe(true);
  });
});
