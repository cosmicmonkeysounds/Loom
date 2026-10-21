// Wave 18 fix round, old devices: Safari before 15.4 drops a whole rule list
// that names :focus-visible (OD-F6); Chrome 87 has no aspect-ratio (OD-F7);
// small phones keep Mission's buttons above the fold (OD-F3).
import { describe, expect, it } from "vitest";
import { readBundledCss } from "./css.ts";

const css = readBundledCss().replace(/\/\*[\s\S]*?\*\//gu, "");

describe("rules an old phone can read", () => {
  it("never a selector list that mixes :focus-visible with plain selectors", () => {
    for (const rule of css.split("}")) {
      const sel = rule.split("{")[0] ?? "";
      if (!sel.includes(":focus-visible") || !sel.includes(",")) continue;
      for (const part of sel.split(",")) expect(part, sel.trim()).toContain(":focus-visible");
    }
  });
  it("the booth camera has a height without aspect-ratio", () => {
    expect(css).toMatch(/@supports not \(aspect-ratio: 1 \/ 1\) \{\s*\.booth-cam \{ height: 75vw; \}/u);
  });
  it("Mission's brief clamps to three lines on a small phone", () => {
    expect(css).toMatch(/@media \(max-width: 379px\) \{\s*\.mission-brief \{ -webkit-line-clamp: 3; \}/u);
  });
});
