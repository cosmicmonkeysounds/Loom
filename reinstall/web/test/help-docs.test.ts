//! The in-app help (`docs/help/`) against what the tablet really does — the
//! director and the guest read these mid-show, so a promise the game no
//! longer keeps is a bug.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const help = (path: string): string => readFileSync(new URL(`../../../docs/help/${path}`, import.meta.url), "utf8").replace(/\s+/g, " ");

describe("the help says what the King's tablet does", () => {
  it("the server room: after \"tell a host\", a reload sends nothing — only ♟ hands over the code (B20)", () => {
    const room = help("authoring/38-server-room.md");
    expect(room).not.toMatch(/reloaded within 60 seconds of the checkmate sends the win/);
    expect(room).toContain("Once that notice shows, only ♟ hands over the code");
    expect(room).toContain("reloading it sends nothing");
  });

  it("the server room: a checkmate gives the code (wave 7), never a door window — and the tablet's words are quoted right", async () => {
    const room = help("authoring/38-server-room.md");
    const { WIN_CODE, WIN_PRACTICE, stakesLine } = await import("../src/game/fight.ts");
    expect(room).toContain(WIN_CODE);
    expect(room).toContain(WIN_PRACTICE);
    expect(room).toContain("**FOR THE CODE**");
    expect(room).toContain("CHECKMATE — the King falls.");
    expect(stakesLine(true)).toContain("door code");
    expect(room).not.toMatch(/90 seconds|disarm|re-arm|Cold Lock|ARMED\*\*/u);
    const guest = help("play/11-reinstallation.md");
    expect(guest).toContain("FOR THE CODE");
    expect(guest).not.toContain("Checkmate him and the door opens");
  });
});

describe("the help and the board say what a lost game does (OCT31 decision 6)", () => {
  it("a loss or a draw re-deals; Give up, then hit him — never \"hit him again\" at an open board", () => {
    const guest = help("play/11-reinstallation.md");
    expect(guest).not.toContain("Lose, and he holds; hit him again");
    expect(guest).toContain("deals you a new game at the same strength");
    expect(guest).toContain("**Give up** closes the board");
    const room = help("authoring/38-server-room.md");
    expect(room).not.toContain("The King holds. Hit him again.");
    expect(room).not.toMatch(/draw changes nothing/);
    expect(room).toContain("THE KING WINS. AGAIN.");
    expect(room).toContain("**stays open**");
  });

  it("a re-dealt board points the player back at ⚔ until he is down to his pawns", async () => {
    const { redealTip } = await import("../src/game/fight.ts");
    expect(redealTip(0, "grandmaster")).toBeNull(); // the first deal
    expect(redealTip(1, "grandmaster")).toContain("Give up, then hit him more");
    expect(redealTip(2, "dizzy")).not.toBeNull();
    expect(redealTip(1, "pawns")).toBeNull(); // he can't get weaker
  });
});

describe("the house docs say what the map page and the trail do", () => {
  const spec = readFileSync(new URL("../../../docs/loom-reinstall.md", import.meta.url), "utf8").replace(/\s+/g, " ");

  it("§1.2: a fallen King's door is routed over trailMap, not shut because \"no duck sits behind a guard\" (B17)", () => {
    expect(spec).not.toContain("no duck sits behind a guard");
    expect(spec).toContain("`trailMap`");
    expect(spec).toContain("a player can be behind his door");
  });

  it("a save's 409 is a changed map (a save or a variant switch), not only another director's save (B18)", () => {
    const map = help("authoring/39-house-map.md");
    expect(map).not.toContain("If another director saved since you loaded it");
    expect(map).toContain("If the map changed since you loaded it (a save or a variant switch)");
  });
});
