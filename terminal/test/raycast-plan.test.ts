import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateHouse, type HouseMap } from "@loom/house";
import {
  celebrationHeadline,
  chooseFloor,
  fitTransform,
  floorCounts,
  guestColor,
  holdFloor,
  kingOnFloor,
  labelAt,
  mainFloor,
  planFloor,
  rosterTellsToasts,
  rosterToasts,
  statusLine,
  toScreen,
} from "../src/raycast/plan.ts";
import { twoRooms, wallsOf } from "./world-fixture.ts";

/** Three stacked one-room floors; a terminal on the top floor. */
function threeFloors(): HouseMap {
  const room = (id: string, floor: string) => ({ id, label: id.toUpperCase(), floor, poly: [[0, 0], [4, 0], [4, 4], [0, 4]] });
  const v = validateHouse({
    version: 1,
    name: "t",
    origin: "t",
    floors: [
      { id: "base", label: "Basement", elevation: -2.7, height: 2.4 },
      { id: "main", label: "Main", elevation: 0, height: 2.5 },
      { id: "top", label: "Top", elevation: 2.8, height: 2.4 },
    ],
    rooms: [room("b", "base"), room("m", "main"), room("t", "top")],
    doors: [],
    stairs: [],
    terminals: [{ id: "tt", name: "T", room: "t", pos: [0, 4.2, 2], yaw: -90 }],
    duck: { spots: [{ id: "s", room: "m", pos: [2, 0, 2] }] },
    spawn: { room: "m", pos: [1, 0, 1], yaw: 0 },
    props: [],
    spaces: {},
  });
  if (!v.ok || !v.house) throw new Error(v.problems.join("; "));
  return v.house;
}

const on = (...floors: string[]) => floors.map((floor) => ({ floor }));

describe("the floor to show", () => {
  const house = threeFloors();

  it("knows the main floor", () => {
    expect(mainFloor(house)).toBe("main");
  });

  it("follows the most players", () => {
    expect(chooseFloor(house, on("base", "base", "top"), "top")).toBe("base");
    expect(chooseFloor(house, on("top"), null)).toBe("top");
  });

  it("breaks a tie toward this terminal's floor, then the main floor", () => {
    expect(chooseFloor(house, on("base", "top"), "top")).toBe("top");
    expect(chooseFloor(house, on("base", "main"), "top")).toBe("main");
    expect(chooseFloor(house, on("base", "top"), null)).toBe("top"); // neither: the first tied, top-down
  });

  it("with nobody playing shows the terminal's floor, else the main floor", () => {
    expect(chooseFloor(house, [], "base")).toBe("base");
    expect(chooseFloor(house, [], null)).toBe("main");
  });

  it("counts players per floor, top floor first", () => {
    expect(floorCounts(house, on("base", "base", "main"))).toEqual([
      { id: "top", label: "Top", count: 0 },
      { id: "main", label: "Main", count: 1 },
      { id: "base", label: "Basement", count: 2 },
    ]);
  });
});

describe("fitting the floor to the screen", () => {
  it("scales the bounds to fit with padding, centred, north up", () => {
    const fit = fitTransform([0, 0, 8, 4], 1000, 600, 50);
    expect(fit.scale).toBeCloseTo(112.5); // min(900/8, 500/4)
    expect(toScreen(fit, 0, 0)).toEqual([50, 75]); // centred vertically: (600 − 450) / 2
    expect(toScreen(fit, 8, 4)).toEqual([950, 525]);
    // +z is south = down the screen.
    expect(toScreen(fit, 0, 1)[1]).toBeGreaterThan(toScreen(fit, 0, 0)[1]);
  });

  it("handles a negative origin and a tall box", () => {
    const fit = fitTransform([-2, -3, 2, 3], 200, 800, 0);
    expect(fit.scale).toBeCloseTo(50);
    expect(toScreen(fit, 0, 0)).toEqual([100, 400]);
  });

  it("never divides by zero on a degenerate box", () => {
    const fit = fitTransform([1, 1, 1, 1], 100, 100, 10);
    expect(Number.isFinite(fit.scale) && Number.isFinite(fit.ox)).toBe(true);
  });
});

describe("one floor's plan", () => {
  it("lists the rooms (label point inside), walls without lintels, doors and bounds", () => {
    const house = twoRooms();
    const plan = planFloor(house, wallsOf(house), "g");
    expect(plan.bounds).toEqual([0, 0, 8, 4]);
    expect(plan.rooms.map((r) => [r.id, r.label, r.at])).toEqual([
      ["a", "Room A", [2, 2]],
      ["b", "Room B", [6, 2]],
    ]);
    expect(plan.walls.length).toBeGreaterThan(4);
    expect(plan.walls.every((w) => w.kind !== "lintel")).toBe(true);
    expect(plan.doors).toEqual([{ id: "d", at: [4, 2], guard: null }]);
  });

  it("puts an L-shaped room's label inside it", () => {
    const L: Array<[number, number]> = [[0, 0], [6, 0], [6, 1], [1, 1], [1, 6], [0, 6]];
    const [x, z] = labelAt(L);
    expect(x < 1 || z < 1).toBe(true);
  });
});

describe("a guest's colour", () => {
  it("is stable per guest and differs between guests", () => {
    expect(guestColor("g-1")).toBe(guestColor("g-1"));
    expect(guestColor("g-1")).not.toBe(guestColor("g-2"));
    expect(guestColor("g-1")).toMatch(/^hsl\(\d+, 80%, 58%\)$/);
  });
});

describe("the King", () => {
  it("shows the King on his floor with the shared bar (or his own max with none)", () => {
    const base = twoRooms();
    const house: HouseMap = { ...base, props: [{ id: "k", room: "b", kind: "king", pos: [6, 0, 3], size: [0.6, 1.8, 0.6], hp: 15 }] };
    expect(kingOnFloor(house, "g", null)).toEqual({ id: "k", x: 6, z: 3, hp: 15, max: 15, fallen: false });
    expect(kingOnFloor(house, "g", { id: "k", hp: 0, max: 15, fallen: true })).toMatchObject({ hp: 0, fallen: true });
    expect(kingOnFloor(house, "elsewhere", null)).toBeNull();
  });
});

describe("words", () => {
  it("says how many are playing, or that the line is down", () => {
    expect(statusLine(1, true)).toBe("LIVE · 1 REINSTALLING");
    expect(statusLine(3, true)).toBe("LIVE · 3 REINSTALLING");
    expect(statusLine(3, false)).toBe("OFFLINE · RECONNECTING…");
  });

  it("headlines a find like the world view (a kept one is Gerald's)", () => {
    expect(celebrationHeadline({ name: "Winamp", released: true, kept: false })).toBe("REINSTALLED: WINAMP");
    expect(celebrationHeadline({ name: "Winamp", released: false, kept: false })).toBe("WINAMP FOUND THE GOLDEN DUCK");
    expect(celebrationHeadline({ name: "Winamp", released: false, kept: true })).toBe("WINAMP · GERALD CAN'T HELP");
  });

  it("toasts joins and leaves, but not a found player's leave", () => {
    const a = new Map([["1", { name: "Winamp", found: false }]]);
    const b = new Map([["2", { name: "Excel", found: false }]]);
    expect(rosterToasts(a, b)).toEqual(["EXCEL ENTERED THE SIMULATION", "WINAMP LEFT THE SIMULATION"]);
    expect(rosterToasts(new Map([["1", { name: "Winamp", found: true }]]), new Map())).toEqual([]);
  });

  it("toasts only real joins / leaves, never a reconnect's hello, a dropped line or a reset", () => {
    expect(rosterTellsToasts({ awaitingHello: false, connected: true, resetChanged: false })).toBe(true);
    expect(rosterTellsToasts({ awaitingHello: true, connected: true, resetChanged: false })).toBe(false);
    expect(rosterTellsToasts({ awaitingHello: false, connected: false, resetChanged: false })).toBe(false);
    expect(rosterTellsToasts({ awaitingHello: false, connected: true, resetChanged: true })).toBe(false);
  });
});

describe("following the players between floors", () => {
  it("shows the first floor at once, then switches only after the players want another floor for the hold", () => {
    let h = holdFloor({ shown: null, want: null, since: 0 }, "main", 0, 2500);
    expect(h.shown).toBe("main");
    h = holdFloor(h, "top", 1000, 2500);
    expect(h.shown).toBe("main");
    h = holdFloor(h, "top", 3400, 2500);
    expect(h.shown).toBe("main");
    h = holdFloor(h, "top", 3500, 2500);
    expect(h.shown).toBe("top");
  });

  it("a brief step to another floor and back never flips the plan, even long after the last switch", () => {
    let h = holdFloor({ shown: null, want: null, since: 0 }, "main", 0, 2500);
    h = holdFloor(h, "top", 60_000, 2500);
    expect(h.shown).toBe("main");
    h = holdFloor(h, "main", 61_000, 2500);
    h = holdFloor(h, "top", 62_000, 2500);
    h = holdFloor(h, "top", 64_000, 2500);
    expect(h.shown).toBe("main");
    h = holdFloor(h, "top", 64_500, 2500);
    expect(h.shown).toBe("top");
  });
});

describe("the raycast chunk", () => {
  it("never imports three.js, nor the world files that do (it is the no-WebGL2 path)", () => {
    const dir = new URL("../src/raycast/", import.meta.url);
    for (const f of readdirSync(dir)) {
      if (!/\.(ts|tsx)$/.test(f)) continue;
      const src = readFileSync(new URL(f, dir), "utf8");
      expect(src, f).not.toMatch(/from\s+["'](three|@loom\/house\/three)["']/);
      expect(src, f).not.toMatch(/from\s+["']\.\.\/world\/(WorldView|MiniMap|director|minimap)/);
    }
  });
});
