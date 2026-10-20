//! The chost review round (wave 13 recheck): a compact row armed by its own
//! tap is brought into view (it grows, and its "Tap again to fire" and the
//! drain sat under the NEXT bar), a compact row's tags show whole or not at
//! all, and an arm stays loud on a paused bar.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { revealOnArm } from "../src/director.tsx";

const css = readFileSync(new URL("../src/css/host.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
const rule = (sel: string): string => {
  const at = css.indexOf(`${sel} {`);
  expect(at, sel).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
};

describe("an armed row in view", () => {
  it("only an arm this row's own tap made scrolls the list", () => {
    expect(revealOnArm(true, true)).toBe(true);
    expect(revealOnArm(true, false)).toBe(false); // armed from the NEXT bar
    expect(revealOnArm(false, true)).toBe(false); // a subject cue's picker opened, nothing armed yet
  });
  it("CueButton calls it on the row's own button", () => {
    const src = readFileSync(new URL("../src/director.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/revealOnArm\(isArmed, tapped\.current\)\) btn\.current\?\.scrollIntoView/u);
    expect(src).toMatch(/tapped\.current = true;\s*onTap\(\);/u);
  });
});

describe("a compact row's tags", () => {
  it("wrap onto a hidden second line rather than each cut to a stub", () => {
    const r = rule(".host-compact .cue-tags");
    expect(r).toMatch(/flex-wrap: wrap/u);
    expect(r).toMatch(/height: 16px/u);
    expect(r).toMatch(/overflow: hidden/u);
  });
});
