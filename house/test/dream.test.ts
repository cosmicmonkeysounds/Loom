import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DREAM_FRAMES, DREAM_SECONDS, dreamFrameIndex, dreamFrameName, dreamOffsetS, dreamPositionS } from "../src/dream.ts";

const show = (file: string) => join(import.meta.dirname, "../../core/examples/trapped-in-the-internet", file);
const spotsOf = (file: string): string[] => (JSON.parse(readFileSync(show(file), "utf8")) as { terminals: Array<{ id: string }> }).terminals.map((t) => t.id);

describe("the dream's timeline", () => {
  it("runs one hour from each terminal's own place", () => {
    const off = dreamOffsetS("hall");
    expect(off).toBeGreaterThanOrEqual(0);
    expect(off).toBeLessThan(DREAM_SECONDS);
    expect(dreamPositionS("hall", 0)).toBe(off);
    expect(dreamPositionS("hall", 10_000)).toBeCloseTo((off + 10) % DREAM_SECONDS);
  });

  it("wraps at the end of the hour and never goes negative", () => {
    const now = 1_800_000_000_123;
    for (let i = 0; i < 2000; i++) {
      const p = dreamPositionS("ram", now + i * 7_919_000);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(DREAM_SECONDS);
    }
  });

  it("has every frame in range, 1-based, on the file names the set uses", () => {
    const now = 1_800_000_000_000;
    for (let i = 0; i < 20000; i++) {
      const f = dreamFrameIndex("cpu", now + i * 113);
      expect(f).toBeGreaterThanOrEqual(1);
      expect(f).toBeLessThanOrEqual(DREAM_FRAMES);
    }
    expect(dreamFrameName(1)).toBe("000001.jpg");
    expect(dreamFrameName(DREAM_FRAMES)).toBe("010800.jpg");
  });

  it("moves the frame about three times a second", () => {
    const start = dreamFrameIndex("hall", 1_800_000_000_000);
    expect(dreamFrameIndex("hall", 1_800_000_001_000)).toBe(((start - 1 + 3) % DREAM_FRAMES) + 1);
  });

  // "Each one is randomly staggered at a different spot, so they are de-synced."
  for (const file of ["house.json", "house.shed.json"]) {
    it(`keeps every terminal in ${file} at least 110 s from every other`, () => {
      const at = spotsOf(file).map(dreamOffsetS).sort((a, b) => a - b);
      expect(at.length).toBeGreaterThanOrEqual(14);
      const gaps = at.map((v, i) => (i === 0 ? v + DREAM_SECONDS - at[at.length - 1]! : v - at[i - 1]!));
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(110);
    });
  }
});
