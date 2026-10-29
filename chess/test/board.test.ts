import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Board } from "../src/Board.tsx";
import { bannerOf, newGame, play } from "../src/rules.ts";

describe("Board", () => {
  it("draws 64 squares with the picked-up piece, its legal squares and the last move — and no hint", () => {
    const g = newGame("grandmaster");
    play(g, "e2", "e4");
    play(g, "e7", "e5");
    const html = renderToStaticMarkup(createElement(Board, { game: g, initialSelected: "g1", lastMove: { from: "e7", to: "e5" }, disabled: false, onMove: () => {} }));
    expect(html.match(/role="gridcell"/g)).toHaveLength(64);
    expect(html).toContain('aria-label="g1, white knight"');
    // The knight's three squares (e2 is free after e4).
    expect([...html.matchAll(/class="square [a-z]+ target" data-sq="([a-h][1-8])"/g)].map((m) => m[1]).sort()).toEqual(["e2", "f3", "h3"]);
    expect(html.match(/ last"/g)).toHaveLength(2);
    expect(html).toMatch(/selected/);
    expect(html).not.toMatch(/hint/);
  });

  it("takes every touch itself and names each square for the pointer maths", () => {
    const html = renderToStaticMarkup(createElement(Board, { game: newGame("grandmaster"), lastMove: null, disabled: false, onMove: () => {} }));
    expect(html.match(/data-sq="[a-h][1-8]"/g)).toHaveLength(64);
    expect(html.indexOf('data-sq="a8"')).toBeLessThan(html.indexOf('data-sq="h1"'));
    expect(html).not.toMatch(/ghost|selected"/);
    const css = readFileSync(fileURLToPath(new URL("../src/board.css", import.meta.url)), "utf8");
    expect(/\.board \{[^}]*touch-action: none;/u.test(css)).toBe(true);
    expect(/\.board \{[^}]*-webkit-touch-callout: none;/u.test(css)).toBe(true);
  });
});

describe("bannerOf", () => {
  it("never promises another board (one game per scan)", () => {
    const g = newGame("grandmaster");
    expect(bannerOf(g, "won")).toBe("CHECKMATE");
    expect(bannerOf(g, "lost")).toBe("THE KING WINS.");
    expect(bannerOf(g, "drawn")).toBe("DRAW.");
  });
});
