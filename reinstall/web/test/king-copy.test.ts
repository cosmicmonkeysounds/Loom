//! The King's tablet copy (wave 11): the chess game left the tablet for
//! the real terminal outside the server-room door, so nothing on the tablet
//! offers a board, a challenge or a win — and, as since wave 7, nothing
//! promises that the real door opens (it has a standalone keypad lock). In
//! the simulation every program hits him once per reinstallation, the bar
//! is shared, and at 0 he kneels and his (virtual) door opens.
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

describe("the King's tablet copy (wave 11)", () => {
  const files = ["game/engine.ts", "game/fight.ts", "game/Play.tsx", "app.tsx", "flow.tsx", "api.ts", "map/Inspector.tsx"];

  it("no on-screen line promises the real door opens, unlocks or disarms", () => {
    for (const f of files) {
      const text = copyOf(f);
      expect(text, f).not.toMatch(/the door opens|DOOR OPEN|disarm|Cold Lock/iu);
      expect(text, f).not.toMatch(/"ARMED"/u);
    }
  });

  it("no chess on the tablet: no board, no challenge, no win line, no 'this tablet only'", () => {
    for (const f of files.filter((f) => f !== "map/Inspector.tsx")) {
      const text = copyOf(f);
      expect(text, f).not.toMatch(/CHALLENGE|CHECKMATE|ChessWindow|(?<!@loom\/)chess\/|FOR THE CODE|PRACTICE|challenges him|on this tablet only|Headsets can't/u);
      // The one thing the tablet takes from @loom/chess is the stage ladder
      // (pure, no chess.js): never the board, the rules or the AI.
      for (const m of text.matchAll(/from "(@loom\/chess[^"]*)"/gu)) expect(m[1], f).toBe("@loom/chess/stage");
      expect(text, f).not.toMatch(/\/api\/mod\/signal|chess won|chess lost|chess drawn/u);
    }
    expect(src("game/Play.tsx")).not.toMatch(/import\(.*chess/u);
    expect(readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8")).not.toMatch(/chess/u);
  });

  it("the hit is once per reinstallation, shared, and the King kneels at 0", () => {
    // Wave 26 (G1, C12): the choose screen no longer states the rule up
    // front — no King note, no "once per reinstallation", no "weakens him".
    expect(copyOf("flow.tsx")).not.toMatch(/king-note|guards the Server Room|once per reinstallation|weakens him/u);
    expect(copyOf("game/fight.ts")).toContain('"You hit him this reinstallation. Find Gerald before you hit him again."');
    expect(copyOf("game/engine.ts")).toContain('"The King kneels. His door stands open."');
    expect(copyOf("game/Play.tsx")).toContain("⚔ HIT");
  });
});
