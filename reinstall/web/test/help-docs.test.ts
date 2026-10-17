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

describe("the help and the board say what a lost game does (OCT31 decision 6)", () => {
  it("a loss or a draw re-deals; Give up, then hit him — never \"hit him again\" at an open board", () => {
    const guest = help("play/11-reinstallation.md");
    expect(guest).not.toContain("Lose, and he holds; hit him again");
    expect(guest).toContain("deals you a new game at the same strength");
    expect(guest).toContain("**Give up** closes the board");
    const cold = help("authoring/38-cold-lock.md");
    expect(cold).not.toContain("The King holds. Hit him again.");
    expect(cold).not.toMatch(/draw changes nothing/);
    expect(cold).toContain("THE KING WINS. AGAIN.");
    expect(cold).toContain("**stays open**");
  });

  it("a re-dealt board points the player back at ⚔ until he is down to his pawns", async () => {
    const { redealTip } = await import("../src/game/fight.ts");
    expect(redealTip(0, "grandmaster")).toBeNull(); // the first deal
    expect(redealTip(1, "grandmaster")).toContain("Give up, then hit him more");
    expect(redealTip(2, "dizzy")).not.toBeNull();
    expect(redealTip(1, "pawns")).toBeNull(); // he can't get weaker
  });
});
