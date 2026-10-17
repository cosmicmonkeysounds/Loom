//! Wave 7: the server-room door has a standalone keypad lock that nothing in
//! the house drives. The King's tablet copy must never promise that a win
//! opens, unlocks or disarms the real door: from the Y2K hour a checkmate
//! puts the door code in the winner's Codex (the story unlocks it on
//! `chess won`), before that it is practice. In the simulation he still
//! falls and his (virtual) door still opens.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
/** The string literals and JSX text of a source file (comments stripped). */
function copyOf(path: string): string {
  return src(path)
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "")
    .replace(/\s\/\/ .*$/gmu, "");
}

describe("the King's tablet copy (wave 7)", () => {
  const files = ["game/engine.ts", "game/fight.ts", "game/Play.tsx", "chess/ChessWindow.tsx", "app.tsx"];

  it("no on-screen line promises the real door opens, unlocks or disarms", () => {
    for (const f of files) {
      const text = copyOf(f);
      expect(text, f).not.toMatch(/the door opens|DOOR OPEN|disarm|Cold Lock/iu);
      expect(text, f).not.toMatch(/"ARMED"/u);
    }
  });

  it("checkmate says the King falls; the board's badge reads FOR THE CODE / PRACTICE", () => {
    expect(copyOf("game/engine.ts")).toContain('"CHECKMATE — the King falls."');
    const board = copyOf("chess/ChessWindow.tsx");
    expect(board).toContain('"FOR THE CODE"');
    expect(board).toContain('"PRACTICE"');
    expect(board).toContain("stakesLine(armed)");
    expect(copyOf("app.tsx")).toContain("In the simulation the King guards the Server Room's door");
  });
});
