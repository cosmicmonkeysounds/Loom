import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Board } from "../src/Board.tsx";
import { bannerOf, newGame, play } from "../src/rules.ts";

describe("Board", () => {
  it("draws 64 squares with the selection, targets and last move — and no hint", () => {
    const g = newGame("grandmaster");
    play(g, "e2", "e4");
    const html = renderToStaticMarkup(
      createElement(Board, { game: g, selected: "g1", targets: ["f3", "h3"], lastMove: { from: "e2", to: "e4" }, disabled: false, onSquare: () => {} }),
    );
    expect(html.match(/role="gridcell"/g)).toHaveLength(64);
    expect(html).toContain('aria-label="g1, white knight"');
    expect(html.match(/class="square [a-z]+ target"/g)).toHaveLength(2);
    expect(html.match(/ last"/g)).toHaveLength(2);
    expect(html).toMatch(/selected/);
    expect(html).not.toMatch(/hint/);
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
