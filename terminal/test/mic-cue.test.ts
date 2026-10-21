import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The 🎤 cue shows exactly while a player is near — when the world view's
// "REINSTALLATION IN PROGRESS" title fills the top-left corner. Seen live
// (wave 19 integration): pinned to the corner, it covered the title's first
// letter. It sits at the left edge, half way down.
const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const rule = (selector: string): string => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`, "u").exec(css);
  if (m === null) throw new Error(`no rule for ${selector}`);
  return m[1]!;
};

describe("the 🎤 cue's place", () => {
  it("is off the top-left corner every view uses for its own title", () => {
    const cue = rule(".mic-cue");
    expect(cue).toMatch(/position:\s*fixed/u);
    expect(cue).toMatch(/left:\s*8px/u);
    expect(cue).toMatch(/top:\s*50%/u);
    expect(cue).toMatch(/transform:\s*translateY\(-50%\)/u);
    expect(cue).not.toMatch(/top:\s*\d+px/u);
  });
});
