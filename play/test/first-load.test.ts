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

  it("wave 18: the sides chunk, the Notifications bin, the Me sheet and Mission load lazily", () => {
    const app = src("guest/app.tsx");
    expect(app).not.toMatch(/^import (?!type )[^;]*from "\.\.\/sides\/index\.tsx"/mu);
    expect(app).not.toMatch(/^import (?!type )[^;]*from "\.\.\/sides\/(doors|invite)\.tsx"/mu);
    expect(app).not.toMatch(/^import (?!type )[^;]*from "\.\.\/moments\/notifications\.tsx"/mu);
    expect(app).not.toMatch(/^import (?!type )[^;]*from "\.\/me\.tsx"/mu);
    expect(app).not.toMatch(/^import (?!type )[^;]*from "\.\/mission\.tsx"/mu);
    expect(src("sides/lazy.tsx")).toContain('import("./index.tsx")');
    expect(src("sides/lazy.tsx")).toContain('import("./doors.tsx")');
    expect(src("guest/notifications-lazy.tsx")).toContain('import("../moments/notifications.tsx")');
    expect(src("guest/me-lazy.tsx")).toContain('import("./me.tsx")');
    // Wave 26: the 📷 Scan sheet (its classifiers and the camera) is its own chunk.
    expect(src("guest-scan-sheet-lazy.tsx")).toContain('import("./guest-scan-sheet.tsx")');
    for (const f of ["guest/app.tsx", "guest-scan.tsx", "app-role.ts", "ui.tsx"]) expect(src(f), f).not.toMatch(/^import (?!type )[^;]*from "[./]*guest-scan-sheet\.tsx"/mu);
    // the widgets' registration is eager, its render lazy
    expect(src("sides/widgets.tsx")).not.toMatch(/^import (?!type )[^;]*from "\.\/(doors|invite|index)\.tsx"/mu);
  });

  it("wave 18: the pass's QR encoder is its own chunk", () => {
    const qr = src("pass-qr.tsx");
    expect(qr).toContain('import("qrcode")');
    expect(qr).not.toMatch(/^import (?!type )[^;]*from "qrcode"/mu);
  });
});
