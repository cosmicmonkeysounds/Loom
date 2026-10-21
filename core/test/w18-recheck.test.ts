//! Wave 18 recheck fixes (recheck/fixes.md), the show's side.

import { describe, expect, it } from "vitest";
import { scenarioFiles } from "../examples/load.ts";

const FILES = scenarioFiles("trapped-in-the-internet");

describe("N9: a house banner that sends everyone to the living room carries the way there", () => {
  it("every such broadcast has `with go: The Desktop`", () => {
    const lines = FILES.flatMap((f) => f.source.split("\n").filter((l) => /^\s*broadcast "!/u.test(l) && /to the living room/iu.test(l)));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const l of lines) expect(l, l).toMatch(/with go: The Desktop/u);
  });
});
