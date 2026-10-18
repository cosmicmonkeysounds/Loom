import { describe, expect, it } from "vitest";
import { heldFind, PAUSED_NOTICE } from "../src/game/hud.ts";
import { IDLE_LIMIT_MS, IDLE_WARN_MS, IdleLeash } from "../src/game/leash.ts";

describe("IdleLeash — 120 s without input, counted only while visible", () => {
  it("runs out after the limit and warns in the last 20 s", () => {
    const l = new IdleLeash(0);
    expect(l.expired(IDLE_LIMIT_MS - 1)).toBe(false);
    expect(l.warning(IDLE_LIMIT_MS - IDLE_WARN_MS - 1)).toBeNull();
    expect(l.warning(IDLE_LIMIT_MS - 5_000)).toBe(5);
    expect(l.expired(IDLE_LIMIT_MS)).toBe(true);
    l.touch(IDLE_LIMIT_MS);
    expect(l.expired(IDLE_LIMIT_MS + 1000)).toBe(false);
  });

  it("a hidden stretch doesn't count: coming back is never an instant idle kill", () => {
    const l = new IdleLeash(0);
    l.hide(30_000); // 30 s idle, then the tab goes away
    expect(l.hidden).toBe(true);
    expect(l.expired(10 * 60_000)).toBe(false); // frozen while hidden
    l.show(10 * 60_000);
    expect(l.hidden).toBe(false);
    expect(l.idleFor(10 * 60_000)).toBe(30_000); // the rest of the allowance remains
    expect(l.expired(10 * 60_000 + 89_999)).toBe(false);
    expect(l.expired(10 * 60_000 + 90_000)).toBe(true);
  });

  it("show without hide, and a second hide, change nothing", () => {
    const l = new IdleLeash(0);
    l.show(5000);
    expect(l.idleFor(5000)).toBe(5000);
    l.hide(6000);
    l.hide(9000);
    l.show(10_000);
    expect(l.idleFor(10_000)).toBe(6000);
  });
});

describe("a find held by a pause keeps the session alive (T3-reinstall-02)", () => {
  it("a player at Gerald through a long pause is never disconnected, and the leash runs again after", () => {
    const l = new IdleLeash(0);
    // Standing at Gerald, no input; every held reply touches the leash and
    // the next retry comes on the found backoff (1.5 s, 3 s, 6 s, then 10 s).
    let now = 0;
    let refusals = 0;
    let last = 0;
    while (now < 130_000) {
      const held = heldFind(now, refusals, l);
      expect(held.notice).toBe(PAUSED_NOTICE);
      last = now;
      refusals += 1;
      now = held.cooldownUntil;
      expect(l.expired(now)).toBe(false);
      expect(l.warning(now)).toBeNull();
    }
    // The doors opened (no more held replies): the usual 120 s applies.
    expect(l.expired(last + IDLE_LIMIT_MS - 1)).toBe(false);
    expect(l.expired(last + IDLE_LIMIT_MS + 10_000)).toBe(true);
  });

  it("the notice outlasts the wait, so it never blinks between retries", () => {
    const held = heldFind(5000, 3, new IdleLeash(0));
    expect(held.cooldownUntil).toBe(5000 + 10_000);
    expect(held.noticeMs).toBeGreaterThan(held.cooldownUntil - 5000);
  });
});
