import { describe, expect, it } from "vitest";
import { conePath, ducksOn, floorView, planDir, polyPath } from "../src/world/minimap.ts";
import { DEFAULT_SPOT_FOV, horizontalFov, validateHouse, type DuckSpot } from "@loom/house";
import { twoRooms } from "./world-fixture.ts";

describe("mini-map", () => {
  it("draws one floor's rooms in plan coordinates (north up), padded", () => {
    const v = floorView(twoRooms(), "g");
    expect(v.viewBox).toBe("-0.6 -0.6 9.2 5.2");
    expect(v.rooms.map((r) => r.id)).toEqual(["a", "b"]);
    expect(v.rooms[0]).toMatchObject({ label: "Room A", d: "M0 0 L4 0 L4 4 L0 4 Z", x: 2, y: 2, outdoor: false });
    expect(v.stairs).toEqual([]);
    // An unknown floor falls back to the first.
    expect(floorView(twoRooms(), "nope").floor).toBe("g");
  });

  it("points yaw the right way on the plan", () => {
    const close = ([x, y]: [number, number], [ex, ey]: [number, number]) => {
      expect(x).toBeCloseTo(ex);
      expect(y).toBeCloseTo(ey);
    };
    close(planDir(0), [0, -1]); // north = up
    close(planDir(-90), [1, 0]); // east = right
    close(planDir(90), [-1, 0]); // west = left
    close(planDir(180), [0, 1]); // south = down
  });

  it("draws a terminal's view cone into the room, as wide as the tablet sees across", () => {
    // `fov` is vertical (§1.1): 90° up-down on a 16:10 tablet spans 2·atan(1.6) ≈ 116° across.
    const d = conePath({ pos: [0, 1.4, 2], yaw: -90, fov: 90 }, 2);
    // Apex at the screen; both far corners east of it, one north one south.
    expect(d.startsWith("M0 2 L")).toBe(true);
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const half = Math.atan(1.6); // radians
    const [ax, ay, bx, by] = nums.slice(2) as [number, number, number, number];
    expect(ax).toBeCloseTo(2 * Math.cos(half), 2);
    expect(ay).toBeCloseTo(2 - 2 * Math.sin(half), 2);
    expect(bx).toBeCloseTo(2 * Math.cos(half), 2);
    expect(by).toBeCloseTo(2 + 2 * Math.sin(half), 2);
    expect(polyPath([[0, 0], [1, 0], [1, 1]])).toBe("M0 0 L1 0 L1 1 Z");
  });

  it("an unset fov is the contract's default (70° vertical ≈ 96.5° across)", () => {
    const wedge = (d: string) => {
      const [x0, y0, ax, ay, bx, by] = d.match(/-?\d+(\.\d+)?/g)!.map(Number) as [number, number, number, number, number, number];
      const a = Math.atan2(ay - y0, ax - x0);
      const b = Math.atan2(by - y0, bx - x0);
      return (Math.abs(b - a) * 180) / Math.PI;
    };
    const unset = conePath({ pos: [0, 1.4, 0], yaw: -90 }, 100);
    expect(unset).toBe(conePath({ pos: [0, 1.4, 0], yaw: -90, fov: DEFAULT_SPOT_FOV }, 100));
    expect(wedge(unset)).toBeCloseTo(horizontalFov(DEFAULT_SPOT_FOV), 1);
    expect(wedge(unset)).toBeCloseTo(96.5, 0);
  });

  it("draws every unfound duck on the floor shown, whatever floor its player is on", () => {
    const base = twoRooms();
    const v = validateHouse({
      ...base,
      floors: [...base.floors, { id: "bsmt", label: "Basement", elevation: -2.6, height: 2.4 }],
      rooms: [...base.rooms, { id: "tent", label: "Tent", floor: "bsmt", poly: [[0, 0], [4, 0], [4, 4], [0, 4]] }],
    });
    if (!v.ok || !v.house) throw new Error(v.problems.join("; "));
    const house = v.house;
    const upstairs: DuckSpot = { id: "s", room: "b", pos: [7, 0, 2] };
    const downstairs: DuckSpot = { id: "t", room: "tent", pos: [1, -2.6, 1] };
    const players = [
      { session: "basement", floor: "bsmt", found: false, duck: upstairs }, // just spawned in the tent
      { session: "ground", floor: "g", found: false, duck: upstairs },
      { session: "done", floor: "g", found: true, duck: upstairs },
      { session: "below", floor: "g", found: false, duck: downstairs },
    ];
    expect(ducksOn(house, "g", players).map((p) => p.session)).toEqual(["basement", "ground"]);
    expect(ducksOn(house, "bsmt", players).map((p) => p.session)).toEqual(["below"]);
  });
});
