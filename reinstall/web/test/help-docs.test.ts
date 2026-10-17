//! The in-app help (`docs/help/`) against what the tablet really does — the
//! director and the guest read these mid-show, so a promise the game no
//! longer keeps is a bug.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const help = (path: string): string => readFileSync(new URL(`../../../docs/help/${path}`, import.meta.url), "utf8").replace(/\s+/g, " ");

describe("the help says what the King's tablet does", () => {
  it("Cold Lock: after \"tell a host\", a reload sends nothing — only ♟ opens the door (B20)", () => {
    const cold = help("authoring/38-cold-lock.md");
    expect(cold).not.toMatch(/reloaded within 60 seconds of the checkmate sends the win/);
    expect(cold).toContain("Once that notice shows, only ♟ opens the door");
    expect(cold).toContain("reloading it sends nothing");
  });
});
