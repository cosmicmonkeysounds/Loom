//! Wave 43: the King's board on a phone (an iPhone 12) — the measured
//! board, the quick tutorial and ? HELP.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { boardSide } from "../src/chess/fit.ts";
import { TUTORIAL_STEPS, teachesFirst } from "../src/chess/tutorial.ts";
import { Tutorial } from "../src/chess/Tutorial.tsx";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("the board's size", () => {
  it("takes the largest square the pane holds, in whole-pixel squares, border included", () => {
    // An iPhone 12 in Safari, portrait: the pane is ~382 x 430.
    expect(boardSide(382, 430)).toBe(380);
    expect((boardSide(382, 430)! - 4) % 8).toBe(0);
    // Landscape: the height is the limit.
    expect(boardSide(560, 300)).toBe(300);
    expect(boardSide(1000, 707)).toBe(700);
  });

  it("gives up under 8 px a square (the CSS fallback sizes it then)", () => {
    expect(boardSide(60, 600)).toBeNull();
    expect(boardSide(0, 0)).toBeNull();
  });
});

describe("the quick tutorial", () => {
  it("is three cards: drag, tap, win", () => {
    expect(TUTORIAL_STEPS.map((s) => s.demo)).toEqual(["drag", "tap", "win"]);
    expect(TUTORIAL_STEPS[0]!.title).toMatch(/DRAG/u);
  });

  it("is a how-to, never a hint (no suggested move, no word on his strength)", () => {
    const copy = TUTORIAL_STEPS.map((s) => `${s.title} ${s.body}`).join(" ");
    expect(copy).not.toMatch(/hint|tip|try |best move|weaker|stronger|strength|health|full strength|rattled|reeling|dizzy|pawns only|grandmaster|easier|harder/iu);
  });

  it("opens by itself once per challenger on this page", () => {
    const taught = new Set<string>();
    expect(teachesFirst(taught, "g-a")).toBe(true);
    taught.add("g-a");
    expect(teachesFirst(taught, "g-a")).toBe(false);
    expect(teachesFirst(taught, "g-b")).toBe(true);
  });

  it("always offers a way out: SKIP at a first game, CLOSE from help", () => {
    const first = renderToStaticMarkup(createElement(Tutorial, { help: false, onClose: () => {} }));
    expect(first).toContain("SKIP");
    expect(first).toContain("NEXT");
    expect(first).toContain('role="dialog"');
    expect(first).toContain("1 / 3");
    const help = renderToStaticMarkup(createElement(Tutorial, { help: true, onClose: () => {} }));
    expect(help).toContain("CLOSE");
    expect(help).toContain("HOW TO PLAY");
  });

  it("the demos move by transform and opacity, and stand still under reduced motion", () => {
    const css = read("../src/chess/chess.css");
    for (const name of ["tut-drag-piece", "tut-drag-finger", "tut-dots-drag", "tut-tap-piece", "tut-tap-finger", "tut-dots-tap", "tut-mate"]) {
      const k = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n?\\}\\n`, "u").exec(css)?.[1] ?? "";
      expect(k, name).not.toBe("");
      expect(k, name).not.toMatch(/\b(top|left|width|height|color|box-shadow)\s*:/u);
    }
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\n  \.tut-demo \.tut-piece, \.tut-demo \.tut-finger, \.tut-demo \.tut-dot \{ animation: none !important; \}/u);
  });
});

describe("the chess terminal on a phone", () => {
  const src = read("../src/chess/ChessTerminal.tsx");
  const css = read("../src/chess/chess.css");

  it("has ? HELP beside GIVE UP, and the tutorial holds the leash and locks the board", () => {
    expect(src).toMatch(/className="chess-help" onClick=\{\(\) => setTutorial\("help"\)\}/u);
    expect(src).toMatch(/busy: thinking \|\| takeover \|\| tutorial !== null/u);
    expect(src).toMatch(/disabled=\{s\.kind !== "playing" \|\| thinking \|\| tutorial !== null\}/u);
  });

  it("measures the board rather than trusting 100vh (a phone's browser bars)", () => {
    expect(src).toContain("new ResizeObserver(measure)");
    expect(css).toMatch(/\.chess-board-pane\[data-fit\] \.board \{ width: var\(--chess-fit\); height: var\(--chess-fit\);/u);
  });

  it("keeps clear of the notch and the home bar, and its buttons are 44 px tall", () => {
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toMatch(/\.chess-help,\n\.chess-giveup \{\n  min-height: 44px;/u);
  });
});
