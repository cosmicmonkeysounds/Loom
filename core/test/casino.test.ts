import { describe, expect, it } from "vitest";
import { CASINO_INFO, expectedReturn, isPick, multiplier, payoutOf, rollFor, rollText, validRoll } from "../src/casino.ts";

/** A rand that replays a fixed list. */
function seq(...xs: number[]) {
  let i = 0;
  return (n: number) => {
    const x = xs[i++] ?? 0;
    expect(x).toBeLessThan(n);
    return x;
  };
}

describe("casino games", () => {
  it("the coin: a call pays 2×, the edge is the house's", () => {
    expect(rollFor("coin", seq(5, 0))).toEqual([0]);
    expect(rollFor("coin", seq(0))).toEqual([2]);
    expect(payoutOf("coin", "heads", [0], 10)).toBe(20);
    expect(payoutOf("coin", "tails", [0], 10)).toBe(0);
    expect(payoutOf("coin", "heads", [2], 10)).toBe(0);
    expect(payoutOf("coin", "tails", [2], 10)).toBe(0);
    expect(rollText("coin", [2])).toBe("ON ITS EDGE");
    expect(expectedReturn("coin", "heads")).toBeCloseTo(0.95, 5);
  });

  it("under / over 7: a seven beats under and over", () => {
    expect(rollFor("dice", seq(3, 2))).toEqual([4, 3]);
    expect(payoutOf("dice", "under", [1, 5], 10)).toBe(20);
    expect(payoutOf("dice", "over", [4, 3], 10)).toBe(0);
    expect(payoutOf("dice", "under", [4, 3], 10)).toBe(0);
    expect(payoutOf("dice", "seven", [4, 3], 10)).toBe(50);
    expect(payoutOf("dice", "over", [6, 2], 10)).toBe(20);
    expect(rollText("dice", [6, 2])).toBe("6 + 2 = 8");
    expect(expectedReturn("dice", "over")).toBeCloseTo(15 / 18, 5);
    expect(expectedReturn("dice", "seven")).toBeCloseTo(5 / 6, 5);
  });

  it("the bandit pays the table and returns about 97 %", () => {
    expect(multiplier("slots", "pull", [0, 0, 0])).toBe(40);
    expect(multiplier("slots", "pull", [4, 4, 4])).toBe(4);
    expect(multiplier("slots", "pull", [0, 3, 0])).toBe(5);
    expect(multiplier("slots", "pull", [2, 2, 1])).toBe(2);
    expect(multiplier("slots", "pull", [3, 0, 1])).toBe(1);
    expect(multiplier("slots", "pull", [3, 4, 1])).toBe(0);
    expect(rollText("slots", [0, 2, 4])).toBe("7 ★ ♣");
    const ev = expectedReturn("slots", "pull");
    expect(ev).toBeGreaterThan(0.9);
    expect(ev).toBeLessThan(1);
  });

  it("weighted reels land on every symbol", () => {
    // 16 stops: 7 ×1, $ ×2, ★ ×3, ♦ ×4, ♣ ×6.
    expect(rollFor("slots", seq(0, 1, 15))).toEqual([0, 1, 4]);
    expect(rollFor("slots", seq(3, 6, 9))).toEqual([2, 3, 3]);
  });

  it("checks picks and journaled rolls", () => {
    expect(isPick("coin", "heads")).toBe(true);
    expect(isPick("coin", "pull")).toBe(false);
    expect(isPick("slots", "pull")).toBe(true);
    expect(validRoll("dice", [7, 1])).toBe(false);
    expect(validRoll("coin", [2])).toBe(true);
    expect(validRoll("slots", [0, 1])).toBe(false);
    for (const g of Object.values(CASINO_INFO)) expect(g.picks.length).toBeGreaterThan(0);
  });
});
