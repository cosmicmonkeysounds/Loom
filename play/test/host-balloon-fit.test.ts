//! A host balloon in a tight room (wave 13 recheck): whole lines, never a
//! box clipped through the middle of a line.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BALLOON_GO_PX, BALLOON_HEAD_PX, BALLOON_LINE_PX, balloonFit } from "../src/host/viewport.ts";


describe("a tight balloon shows whole lines, never a box cut mid-line", () => {
  it("lines with the link while they fit, else lines alone, else the caption", () => {
    expect(balloonFit(BALLOON_HEAD_PX + BALLOON_GO_PX + BALLOON_LINE_PX * 2)).toEqual({ show: "text", lines: 2 });
    // The 390 × 844 phone with the console open: 102 px.
    expect(balloonFit(102)).toEqual({ show: "text-only", lines: 2 });
    expect(balloonFit(BALLOON_HEAD_PX + BALLOON_GO_PX + BALLOON_LINE_PX - 1)).toEqual({ show: "text-only", lines: 3 });
    expect(balloonFit(BALLOON_HEAD_PX + BALLOON_LINE_PX)).toEqual({ show: "text-only", lines: 1 });
    expect(balloonFit(BALLOON_HEAD_PX + 10)).toEqual({ show: "head", lines: 0 });
    expect(balloonFit(2000).lines).toBe(5);
  });
  it("moments.css clamps the text instead of clipping the whole tip", () => {
    const css = readFileSync(new URL("../src/css/moments.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
    expect(css).not.toMatch(/\[data-host-drawer="tight"\] \.moments-balloon \{[^}]*overflow: hidden/u);
    // The tight row's own CSS (moments-order.test.tsx) clamps the text to whole lines.
    expect(css).toMatch(/\[data-host-drawer="tight"\] \.moments-balloon-text \{[^}]*-webkit-line-clamp: 2;/u);
  });
});
