import { describe, expect, it } from "vitest";
import { parseScreenState, watchWhileAsleep } from "../src/screen.ts";

const base = { attract: true, character: { id: "Trabolta", hidden: true, awake: false, online: false, hold: false } };

describe("watchWhileAsleep — the reinstallation shows from the first capture", () => {
  it("reads the server's count (0 from an older server)", () => {
    expect(parseScreenState({ ...base, reinstalling: 2 })?.reinstalling).toBe(2);
    expect(parseScreenState(base)?.reinstalling).toBe(0);
    expect(parseScreenState({ ...base, reinstalling: -1 })?.reinstalling).toBe(0);
  });
  it("a house terminal that can show the world watches while a program plays", () => {
    const s = parseScreenState({ ...base, reinstalling: 1 });
    for (const v of ["auto", "world", "mirror", "shadow"]) expect(watchWhileAsleep(s, v, false)).toBe(true);
  });
  it("nobody playing, a room terminal, the TV, the board, the casino, the face: the screensaver", () => {
    const s = parseScreenState({ ...base, reinstalling: 1 });
    expect(watchWhileAsleep(parseScreenState({ ...base, reinstalling: 0 }), "auto", false)).toBe(false);
    expect(watchWhileAsleep(s, "auto", true)).toBe(false);
    for (const v of ["tv", "chess", "casino", "face"]) expect(watchWhileAsleep(s, v, false)).toBe(false);
    expect(watchWhileAsleep(null, "auto", false)).toBe(false);
  });
});
