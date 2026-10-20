//! Wave 13 fix round (fguest): a guest's first load is the guest app only.
//! The booth (and the host console in it), the director's cue sheet, jsQR
//! and the Help articles are their own chunks; nothing the guest app loads
//! at start imports them statically.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

describe("the guest's first load", () => {
  it("the role chooser lazy-loads the booth and the director", () => {
    const ui = src("ui.tsx");
    expect(ui).not.toMatch(/^import [^;]*from "\.\/booth\//mu);
    expect(ui).not.toMatch(/^import [^;]*from "\.\/director\.tsx"/mu);
    expect(ui).toMatch(/lazy\(retryImport\(\(\) => import\("\.\/booth\/app\.tsx"\)/u);
    // …behind a boundary: a chunk that won't load is a Reload, never a white page.
    expect(ui).toContain("<ChunkBoundary");
  });

  it("the guest chrome reads the clock from clock.ts, never director.tsx", () => {
    expect(src("countdown.tsx")).toContain('from "./clock.ts"');
    expect(src("chrome/countdown-tray.tsx")).toContain('from "../clock.ts"');
    expect(src("countdown.tsx")).not.toContain("director.tsx");
  });

  it("jsQR is fetched only when a camera runs without a native detector", () => {
    const scanner = src("scanner.tsx");
    expect(scanner).not.toMatch(/^import jsQR/mu);
    expect(scanner).toContain('import("jsqr")');
    expect(scanner).not.toMatch(/^import [^;]*from "jsqr"/mu);
  });

  it("the Help sheet is fetched on first open", () => {
    expect(src("guest/app.tsx")).toContain('from "../help-lazy.tsx"');
    expect(src("ui.tsx")).toContain('from "./help-lazy.tsx"');
  });
});
