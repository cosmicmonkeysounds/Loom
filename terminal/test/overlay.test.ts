import { describe, expect, it } from "vitest";
import { countsLine, windowCounts } from "../src/world/overlay.ts";

describe("world view — the counts line", () => {
  const spot = { room: "a" };
  it("counts everyone reinstalling and who is in this terminal's room", () => {
    const players = [{ room: "a" }, { room: "b" }, { room: null }];
    expect(windowCounts(players, spot)).toEqual({ total: 3, here: 1 });
    expect(countsLine(windowCounts(players, spot), true)).toBe("3 REINSTALLING · 1 HERE");
  });
  it("says 0 HERE when everyone plays elsewhere, so an empty window isn't silent", () => {
    const c = windowCounts([{ room: "b" }, { room: "b" }], spot);
    expect(countsLine(c, true)).toBe("2 REINSTALLING · 0 HERE");
  });
  it("an unplaced terminal has no HERE; nobody playing is no line", () => {
    const c = windowCounts([{ room: "a" }], null);
    expect(c).toEqual({ total: 1, here: 0 });
    expect(countsLine(c, false)).toBe("1 REINSTALLING");
    expect(countsLine(windowCounts([], spot), true)).toBe("");
  });
});
