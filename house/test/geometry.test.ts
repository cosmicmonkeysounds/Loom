import { describe, expect, it } from "vitest";
import { buildFloors, buildRamps, buildWalls, doorGap, mm, mmi, pointInPoly, propSolid, roomById, roomElevation, roomName, styleOf, wallsByFloor } from "../src/index.ts";
import type { HouseMap, WallKind, WallSegment } from "../src/index.ts";
import { fixture, loadHouse, SHOW_HOUSE } from "./golden.ts";

describe("roomName", () => {
  const room = (label: string, location?: string) => ({ id: "r", label, floor: "f", poly: [], ...(location !== undefined ? { location } : {}) });

  it("is the story's name, else the label without the crew's bracket", () => {
    expect(roomName(room("Start Bar (kitchen)", "The Start Bar"))).toBe("The Start Bar");
    expect(roomName(room("Fan Closet (laundry)"))).toBe("Fan Closet");
    expect(roomName(room("Fan Closet (laundry)", "  "))).toBe("Fan Closet");
    expect(roomName(room("(kitchen)"))).toBe("(kitchen)");
  });
});

/** A hand-written segment: `[floor, axis, c, lo, hi, bottom, top, kind]`. */
type Row = [string, "x" | "z", number, number, number, number, number, WallKind];
const segs = (rows: Row[]): WallSegment[] =>
  rows.map(([floor, axis, c, lo, hi, bottom, top, kind]) => ({ floor, axis, c, lo, hi, bottom, top, kind }));

describe("buildWalls (hand-computed)", () => {
  it("two rooms: shared wall once, a door with its lintel, the front door's lower lintel", () => {
    expect(buildWalls(fixture("two-rooms"))).toEqual(
      segs([
        // north, both rooms merged, cut by the front door (height 2.2)
        ["f", "x", 0, 0, 1.55, 0, 2.5, "wall"],
        ["f", "x", 0, 1.55, 2.45, 2.2, 2.5, "lintel"],
        ["f", "x", 0, 2.45, 7, 0, 2.5, "wall"],
        ["f", "x", 3, 0, 7, 0, 2.5, "wall"],
        ["f", "z", 0, 0, 3, 0, 2.5, "wall"],
        // the shared wall, cut by door ab (1 m, default height 2)
        ["f", "z", 4, 0, 1, 0, 2.5, "wall"],
        ["f", "z", 4, 1, 2, 2, 2.5, "lintel"],
        ["f", "z", 4, 2, 3, 0, 2.5, "wall"],
        ["f", "z", 7, 0, 3, 0, 2.5, "wall"],
      ]),
    );
  });

  it("an L-shaped room: collinear edges merge, its own height wins", () => {
    expect(buildWalls(fixture("l-room"))).toEqual(
      segs([
        ["f", "x", 0, 0, 4, 0, 3, "wall"],
        ["f", "x", 2, 2, 4, 0, 3, "wall"],
        ["f", "x", 4, 0, 2, 0, 3, "wall"],
        ["f", "z", 0, 0, 4, 0, 3, "wall"],
        ["f", "z", 2, 2, 4, 0, 3, "wall"],
        ["f", "z", 4, 0, 2, 0, 3, "wall"],
      ]),
    );
  });

  it("a fenced yard: shared house wall at house height, fence elsewhere, a gate without lintel", () => {
    expect(buildWalls(fixture("yard"))).toEqual(
      segs([
        ["g", "x", 0, 0, 4, 0, 2.4, "wall"],
        ["g", "x", 3, 0, 1.5, 0, 2.4, "wall"],
        ["g", "x", 3, 1.5, 2.5, 2, 2.4, "lintel"],
        ["g", "x", 3, 2.5, 4, 0, 2.4, "wall"],
        ["g", "x", 3, 4, 6, 0, 1.2, "fence"],
        ["g", "x", 7, 0, 6, 0, 1.2, "fence"],
        ["g", "z", 0, 0, 3, 0, 2.4, "wall"],
        ["g", "z", 0, 3, 7, 0, 1.2, "fence"],
        ["g", "z", 4, 0, 3, 0, 2.4, "wall"],
        ["g", "z", 6, 3, 4.4, 0, 1.2, "fence"],
        ["g", "z", 6, 5.6, 7, 0, 1.2, "fence"],
      ]),
    );
  });

  it("two floors: walls at each elevation, rails on the upper floor's three non-up sides", () => {
    expect(buildWalls(fixture("stair"))).toEqual(
      segs([
        ["lower", "x", 0, 0, 5, -3, -0.5, "wall"],
        ["lower", "x", 4, 0, 5, -3, -0.5, "wall"],
        ["lower", "z", 0, 0, 4, -3, -0.5, "wall"],
        ["lower", "z", 5, 0, 4, -3, -0.5, "wall"],
        ["upper", "x", 0, 0, 5, 0, 2.5, "wall"],
        ["upper", "x", 1, 1, 4, 0, 1, "rail"],
        ["upper", "x", 2, 1, 4, 0, 1, "rail"],
        ["upper", "x", 4, 0, 5, 0, 2.5, "wall"],
        ["upper", "z", 0, 0, 4, 0, 2.5, "wall"],
        ["upper", "z", 1, 1, 2, 0, 1, "rail"],
        ["upper", "z", 5, 0, 4, 0, 2.5, "wall"],
      ]),
    );
  });

  it("two doors in one wall", () => {
    expect(buildWalls(fixture("tie")).filter((w) => w.axis === "z" && w.c === 2)).toEqual(
      segs([
        ["f", "z", 2, 0, 0.6, 0, 2.5, "wall"],
        ["f", "z", 2, 0.6, 1.4, 2, 2.5, "lintel"],
        ["f", "z", 2, 1.4, 2.6, 0, 2.5, "wall"],
        ["f", "z", 2, 2.6, 3.4, 2, 2.5, "lintel"],
        ["f", "z", 2, 3.4, 4, 0, 2.5, "wall"],
      ]),
    );
  });

  it("takes the tallest contributor and does not merge different heights", () => {
    const h = fixture("two-rooms");
    h.rooms[1]!.height = 3;
    const w = buildWalls(h);
    expect(w.filter((s) => s.axis === "x" && s.c === 3)).toEqual(
      segs([
        ["f", "x", 3, 0, 4, 0, 2.5, "wall"],
        ["f", "x", 3, 4, 7, 0, 3, "wall"],
      ]),
    );
    expect(w.filter((s) => s.axis === "z" && s.c === 4).map((s) => [s.lo, s.hi, s.bottom, s.top, s.kind])).toEqual([
      [0, 1, 0, 3, "wall"],
      [1, 2, 2, 3, "lintel"],
      [2, 3, 0, 3, "wall"],
    ]);
  });

  it("adds no lintel when the door reaches the top", () => {
    const h = fixture("two-rooms");
    h.doors[0]!.height = 2.5;
    expect(buildWalls(h).filter((s) => s.kind === "lintel")).toHaveLength(1); // the front door's only
  });

  it("is independent of winding and room order", () => {
    const a = fixture("yard");
    const b = fixture("yard");
    b.rooms.reverse();
    for (const r of b.rooms) r.poly.reverse();
    expect(buildWalls(b)).toEqual(buildWalls(a));
  });

  it("rounds to 1 mm", () => {
    expect(mmi(2.7)).toBe(2700);
    expect(mmi(-2.7 + 2.4)).toBe(-300);
    expect(mm(0.1 + 0.2)).toBe(0.3);
    expect(Object.is(mm(-0.0001), 0)).toBe(true);
    const h = fixture("two-rooms");
    h.rooms[0]!.poly = [[0, 0], [4.0004, 0], [4.0004, 3], [0, 3]];
    expect(buildWalls(h).some((s) => s.c === 4.0004)).toBe(false);
  });

  it("groups by floor", () => {
    const h = fixture("stair");
    const byFloor = wallsByFloor(h);
    expect([...byFloor.keys()]).toEqual(["lower", "upper"]);
    expect(byFloor.get("upper")!.filter((w) => w.kind === "rail")).toHaveLength(3);
  });
});

describe("buildFloors / buildRamps", () => {
  it("cuts the stair hole into the upper floor and the lower ceiling", () => {
    const planes = buildFloors(fixture("stair"));
    const hole = [
      [1, 1],
      [4, 1],
      [4, 2],
      [1, 2],
    ];
    expect(planes.map((p) => [p.room, p.kind, p.y, p.holes])).toEqual([
      ["cellar", "floor", -3, []],
      ["cellar", "ceiling", -0.5, [hole]],
      ["hall", "floor", 0, [hole]],
      ["hall", "ceiling", 2.5, []],
    ]);
  });

  it("gives outdoor rooms no ceiling", () => {
    const planes = buildFloors(fixture("yard"));
    expect(planes.map((p) => `${p.room}:${p.kind}`)).toEqual(["house:floor", "house:ceiling", "yard:floor"]);
    expect(planes[2]!.color).toBe("#3a6b35");
    expect(planes[2]!.outdoor).toBe(true);
  });

  it("slopes the ramp toward `up`", () => {
    expect(buildRamps(fixture("stair"))).toEqual([
      {
        stair: "s",
        from: "cellar",
        to: "hall",
        up: "e",
        rect: [1, 1, 4, 2],
        low: -3,
        high: 0,
        corners: [
          [1, -3, 1],
          [4, 0, 1],
          [4, 0, 2],
          [1, -3, 2],
        ],
      },
    ]);
    const h = fixture("stair");
    h.stairs[0]!.up = "w";
    expect(buildRamps(h)[0]!.corners.map((c) => c[1])).toEqual([0, -3, -3, 0]);
    h.stairs[0]!.up = "n";
    expect(buildRamps(h)[0]!.corners.map((c) => c[1])).toEqual([0, 0, -3, -3]);
  });
});

describe("plan helpers", () => {
  it("counts the boundary as inside", () => {
    const l = fixture("l-room").rooms[0]!.poly;
    expect(pointInPoly(l, [1, 3])).toBe(true);
    expect(pointInPoly(l, [3, 3])).toBe(false);
    expect(pointInPoly(l, [2, 3])).toBe(true);
    expect(pointInPoly(l, [4, 0])).toBe(true);
  });

  it("knows which props collide", () => {
    expect(propSolid({ id: "a", room: "r", kind: "box", pos: [0, 0, 0], size: [1, 1, 1] })).toBe(true);
    expect(propSolid({ id: "a", room: "r", kind: "screen", pos: [0, 0, 0], size: [1, 1, 1] })).toBe(false);
    expect(propSolid({ id: "a", room: "r", kind: "box", pos: [0, 0, 0], size: [1, 1, 1], solid: false })).toBe(false);
  });
});

describe("doorGap", () => {
  it("every show door's gap lies on a wall of room a, is `width` long, centred on `at`, floor to door top", () => {
    const house = loadHouse(SHOW_HOUSE);
    const style = styleOf(house);
    for (const door of house.doors) {
      const gap = doorGap(house, door)!;
      expect(gap, door.id).not.toBeNull();
      const a = roomById(house, door.a)!;
      expect(gap.floor).toBe(a.floor);
      expect(gap.kind).toBe("wall");
      const along = gap.axis === "x" ? door.at[0] : door.at[1];
      const across = gap.axis === "x" ? door.at[1] : door.at[0];
      expect(Math.abs(gap.c - across), door.id).toBeLessThanOrEqual(0.02 + 1e-9);
      expect(gap.hi - gap.lo, door.id).toBeCloseTo(door.width, 3);
      expect((gap.lo + gap.hi) / 2, door.id).toBeCloseTo(along, 3);
      const elevation = roomElevation(house, a);
      expect(gap.bottom).toBe(mm(elevation));
      expect(gap.top).toBe(mm(elevation + (door.height ?? style.doorHeight)));
      // The gap is where buildWalls cut: no wall piece of that floor on
      // that line overlaps it (only its lintel does).
      const overlapping = buildWalls(house).filter(
        (w) => w.floor === gap.floor && w.axis === gap.axis && Math.abs(w.c - gap.c) <= 0.02 + 1e-9 && w.kind === "wall" && Math.min(w.hi, gap.hi) - Math.max(w.lo, gap.lo) > 1e-9,
      );
      expect(overlapping, door.id).toEqual([]);
    }
  });

  it("is null for a door on no wall of its room, and the two-rooms door ab is the shared z = 4 line", () => {
    const house = fixture("two-rooms");
    expect(doorGap(house, { id: "x", a: "a", b: "b", at: [2, 1.5], width: 1 })).toBeNull();
    expect(doorGap(house, { id: "x", a: "nope", b: null, at: [2, 0], width: 1 })).toBeNull();
    expect(doorGap(house, house.doors.find((d) => d.id === "ab")!)).toEqual({ floor: "f", axis: "z", c: 4, lo: 1, hi: 2, bottom: 0, top: 2, kind: "wall" });
    expect(doorGap(house, house.doors.find((d) => d.id === "front")!)).toEqual({ floor: "f", axis: "x", c: 0, lo: 1.55, hi: 2.45, bottom: 0, top: 2.2, kind: "wall" });
  });

  it("buildWalls output is unchanged by a guard (the leaf is the games', not a wall)", () => {
    const house = loadHouse(SHOW_HOUSE);
    const bare: HouseMap = { ...house, doors: house.doors.map((d) => ({ ...d, guard: undefined })), props: house.props.filter((p) => p.kind !== "king") };
    expect(buildWalls(house)).toEqual(buildWalls(bare));
  });
});
