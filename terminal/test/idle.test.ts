import { describe, expect, it } from "vitest";
import { IDLE_MS, IdleClock } from "../src/idle.ts";

describe("IdleClock — the 30-second leash", () => {
  it("runs out 30 s after the last input", () => {
    const c = new IdleClock(0);
    expect(c.remaining(0)).toBe(IDLE_MS);
    expect(c.remaining(10_000)).toBe(20_000);
    expect(c.expired(29_999)).toBe(false);
    expect(c.expired(30_000)).toBe(true);
    expect(c.remaining(40_000)).toBe(0);
  });
  it("an input restarts it", () => {
    const c = new IdleClock(0);
    c.touch(25_000);
    expect(c.expired(30_000)).toBe(false);
    expect(c.remaining(30_000)).toBe(25_000);
    expect(c.expired(55_000)).toBe(true);
  });
  it("holds while the character is answering, and restarts when the line goes quiet", () => {
    const c = new IdleClock(0);
    c.setBusy(true, 20_000); // a reply starts composing at 20 s
    expect(c.busy).toBe(true);
    expect(c.expired(45_000)).toBe(false); // would have expired at 30 s
    expect(c.remaining(45_000)).toBe(IDLE_MS);
    c.setBusy(false, 50_000); // spoken; quiet again
    expect(c.busy).toBe(false);
    expect(c.remaining(50_000)).toBe(IDLE_MS); // a fresh 30 s from the end of the reply
    expect(c.expired(79_999)).toBe(false);
    expect(c.expired(80_000)).toBe(true);
  });
  it("setting busy twice keeps the first start; clearing when not busy is a no-op", () => {
    const c = new IdleClock(0);
    c.setBusy(false, 5_000);
    expect(c.remaining(5_000)).toBe(25_000); // untouched
    c.setBusy(true, 10_000);
    c.setBusy(true, 12_000);
    c.setBusy(false, 20_000);
    expect(c.remaining(20_000)).toBe(IDLE_MS);
  });
  it("honours a custom limit", () => {
    const c = new IdleClock(0, 5_000);
    expect(c.expired(4_999)).toBe(false);
    expect(c.expired(5_000)).toBe(true);
  });
});
