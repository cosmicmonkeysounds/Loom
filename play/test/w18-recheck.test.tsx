//! Wave 18 recheck fixes (recheck/fixes.md): one regression test per finding.

import { describe, expect, it } from "vitest";
import { mergeAnswered, NO_ANSWERS } from "../src/session/shared.ts";

describe("N1: a new sign-in counts the server's answered cards", () => {
  it("merges the server's answered seqs into this device's answers", () => {
    const local = new Map([[3, { choice: "a" }]]);
    const merged = mergeAnswered(local, [3, 340, 553]);
    expect(merged.get(3)).toEqual({ choice: "a" });
    expect(merged.has(340)).toBe(true);
    expect(merged.get(553)).toEqual({});
    expect(mergeAnswered(local, [3])).toBe(local);
    expect(mergeAnswered(NO_ANSWERS, undefined)).toBe(NO_ANSWERS);
  });
});
