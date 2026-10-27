//! The terminal's always-on CSS motion stays cheap on the old tablets:
//! animate transform / opacity, never layout or a blurred shadow, and no
//! full-screen blend group (wave 17 integration, OB-4 / OB-5).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const keyframes = (name: string): string => new RegExp(`@keyframes ${name} \\{([^\\n]*)\\}`, "u").exec(css)?.[1] ?? "";

describe("the scan box and the scanner's sweep", () => {
  it("breathe by opacity and move by transform", () => {
    expect(keyframes("scan-box-glow")).toContain("opacity");
    expect(keyframes("scan-box-glow")).not.toContain("box-shadow");
    expect(keyframes("sweep")).toContain("transform");
    expect(keyframes("sweep")).not.toMatch(/\btop\b/u);
  });

  it("the scanlines blend plainly (no full-screen multiply group)", () => {
    const block = /\.scanlines \{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(block).not.toContain("mix-blend-mode");
  });
});

describe("the ⚡ flicker (wave 32 review)", () => {
  it("two dips over its second, never to full black", () => {
    const k = /@keyframes screen-flicker \{([\s\S]*?)\n\}/u.exec(css)?.[1] ?? "";
    const peaks = [...k.matchAll(/opacity: ([\d.]+)/gu)].map((m) => Number(m[1]));
    expect(peaks.filter((o) => o > 0.3)).toHaveLength(2);
    expect(Math.max(...peaks)).toBeLessThan(1);
  });

  it("with reduced motion, one soft dim rather than nothing (the house's cue still lands)", () => {
    const reduce = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/u.exec(css.slice(css.indexOf(".screen-gear")))?.[1] ?? "";
    expect(reduce).toMatch(/\.screen-flicker \{ animation: screen-flicker-soft 1s/u);
    expect(reduce).not.toMatch(/\.screen-flicker[^{]*\{ animation: none/u);
    const soft = [...keyframes("screen-flicker-soft").matchAll(/opacity: ([\d.]+)/gu)].map((m) => Number(m[1]));
    expect(soft.filter((o) => o > 0)).toHaveLength(1);
    expect(Math.max(...soft)).toBeLessThanOrEqual(0.4);
  });
});
