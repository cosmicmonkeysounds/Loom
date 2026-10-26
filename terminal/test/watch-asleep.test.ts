import { describe, expect, it } from "vitest";
import { parseScreenState, watchWhileAsleep } from "../src/screen.ts";

const base = { attract: true, character: { id: "Trabolta", hidden: true, awake: false, online: false, hold: false } };

describe("watchWhileAsleep — the reinstallation shows from the first capture", () => {
  it("reads the server's count (0 from an older server)", () => {
    expect(parseScreenState({ ...base, reinstalling: 2 })?.reinstalling).toBe(2);
    expect(parseScreenState(base)?.reinstalling).toBe(0);
    expect(parseScreenState({ ...base, reinstalling: -1 })?.reinstalling).toBe(0);
  });
  it("a placed house terminal that can show the world watches while a program plays (an older server: house-wide)", () => {
    const s = parseScreenState({ ...base, reinstalling: 1 });
    for (const v of ["auto", "world", "mirror", "shadow"]) expect(watchWhileAsleep(s, v, false, "hall")).toBe(true);
  });
  it("nobody playing, a room terminal, the TV, the board, the casino, the face: the screensaver", () => {
    const s = parseScreenState({ ...base, reinstalling: 1 });
    expect(watchWhileAsleep(parseScreenState({ ...base, reinstalling: 0 }), "auto", false, "hall")).toBe(false);
    expect(watchWhileAsleep(s, "auto", true, "hall")).toBe(false);
    for (const v of ["tv", "chess", "casino", "face", "reinstall"]) expect(watchWhileAsleep(s, v, false, "hall")).toBe(false);
    expect(watchWhileAsleep(null, "auto", false, "hall")).toBe(false);
  });
  it("wave 26 (R5): a wall watches only while a player is in its room in the game", () => {
    const here = (n: number) => parseScreenState({ ...base, reinstalling: 3, spot: { announce: false, here: n } });
    expect(watchWhileAsleep(here(0), "auto", false, "hall")).toBe(false); // someone elsewhere: the screensaver
    expect(watchWhileAsleep(here(1), "auto", false, "hall")).toBe(true);
    expect(watchWhileAsleep(here(2), "world", false, "hall")).toBe(true);
    // The spectator screens stay house-wide.
    expect(watchWhileAsleep(here(0), "mirror", false, "hall")).toBe(true);
    expect(watchWhileAsleep(here(0), "shadow", false, "")).toBe(true);
    // No spot: never linked (nowhere in the game).
    expect(watchWhileAsleep(parseScreenState({ ...base, reinstalling: 3 }), "auto", false, "")).toBe(false);
    expect(watchWhileAsleep(here(2), "auto", false, " ")).toBe(false);
  });
});
