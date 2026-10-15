import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DUCK_MAX_RISE, buildWalls, mm, normalizeHouse, polygonProblems, validateHouse } from "../src/index.ts";
import type { HouseMap } from "../src/index.ts";
import { FIXTURES, SHOW_HOUSE } from "./golden.ts";

const raw = (name: string): HouseMap => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as HouseMap;

/** Validate a fixture after `mutate`; the problems. */
function problems(name: string, mutate: (h: HouseMap) => void): string[] {
  const h = raw(name);
  mutate(h);
  const v = validateHouse(h);
  expect(v.ok).toBe(v.problems.length === 0);
  return v.problems;
}

/** The show's map after `mutate`; the problems. */
function showProblems(mutate: (h: HouseMap) => void): string[] {
  const h = JSON.parse(readFileSync(SHOW_HOUSE, "utf8")) as HouseMap;
  mutate(h);
  const v = validateHouse(h);
  expect(v.ok).toBe(v.problems.length === 0);
  return v.problems;
}

/** Exactly one problem, matching `re`. */
function refuses(name: string, mutate: (h: HouseMap) => void, re: RegExp): void {
  const p = problems(name, mutate);
  expect(p, p.join("\n")).toHaveLength(1);
  expect(p[0]).toMatch(re);
}

describe("validateHouse", () => {
  it("accepts every fixture and the show's map", () => {
    for (const name of ["two-rooms", "l-room", "yard", "stair", "tie"]) expect(problems(name, () => {})).toEqual([]);
    const show = validateHouse(JSON.parse(readFileSync(SHOW_HOUSE, "utf8")));
    expect(show.problems).toEqual([]);
    expect(show.ok).toBe(true);
  });

  it("refuses a non-object and a wrong version", () => {
    expect(validateHouse(null).problems).toEqual(["house map must be an object"]);
    expect(validateHouse([]).ok).toBe(false);
    refuses("two-rooms", (h) => ((h as { version: number }).version = 2), /^version must be 1/);
  });

  it("refuses missing required lists", () => {
    refuses("two-rooms", (h) => (h.floors = []), /floors needs at least 1/);
    refuses("two-rooms", (h) => (h.duck.spots = []), /duck\.spots needs at least 1/);
    refuses("two-rooms", (h) => delete (h as Partial<HouseMap>).spawn, /spawn must be an object/);
  });

  it("refuses duplicate ids", () => {
    refuses("two-rooms", (h) => (h.doors[1]!.id = "ab"), /duplicate door id "ab"/);
    refuses("two-rooms", (h) => (h.duck.spots[1]!.id = "in-a"), /duplicate duck spot id "in-a"/);
    // A duplicated room is also an overlap — both are reported.
    const p = problems("two-rooms", (h) => h.rooms.push({ ...h.rooms[0]!, poly: [[10, 0], [11, 0], [11, 1], [10, 1]] }));
    expect(p).toEqual(['duplicate room id "a"']);
  });

  it("refuses non-finite numbers and bad types", () => {
    refuses("two-rooms", (h) => (h.floors[0]!.elevation = Number.NaN), /floors\[0\] "f": elevation must be a finite number/);
    refuses("two-rooms", (h) => (h.terminals[0]!.pos = [7, Infinity, 1.5]), /terminals\[0\] "t": pos must be/);
    refuses("two-rooms", (h) => (h.rooms[0]!.poly[2] = [4, Number.NaN]), /rooms\[0\] "a": poly must be/);
    refuses("two-rooms", (h) => (h.doors[0]!.width = 0), /doors\[0\] "ab": width must be a finite number > 0/);
    refuses("two-rooms", (h) => (h.rooms[0]!.color = "red"), /color must be "#rrggbb"/);
    refuses("stair", (h) => ((h.stairs[0] as { up: string }).up = "up"), /up must be "n", "s", "e" or "w"/);
    refuses("stair", (h) => (h.spaces["vr"]!.scale = 0), /spaces\.vr: scale must be/);
    refuses("yard", (h) => (h.style!.fence = -1), /style\.fence must be/);
  });

  it("refuses a room on an unknown floor", () => {
    expect(problems("two-rooms", (h) => (h.rooms[1]!.floor = "nope"))).toContain('rooms[1] "b": unknown floor "nope"');
  });

  it("refuses non-rectilinear, self-intersecting and degenerate polygons", () => {
    refuses("l-room", (h) => (h.rooms[0]!.poly[1] = [4, 0.5]), /polygon is not rectilinear/);
    // A figure-eight: edge 3 crosses edge 0.
    refuses(
      "l-room",
      (h) => (h.rooms[0]!.poly = [[0, 0], [2, 0], [2, 2], [1, 2], [1, -1], [0, -1]]),
      /polygon is self-intersecting/,
    );
    expect(polygonProblems([[0, 0], [2, 0], [2, 1], [2, 0.5], [0, 0.5]])[0]).toMatch(/double back/);
    expect(polygonProblems([[0, 0], [2, 0], [2, 2]])[0]).toMatch(/at least 4 distinct points/);
    // Either winding, collinear mid-points and a repeated closing point are fine.
    expect(polygonProblems([[0, 0], [0, 2], [3, 2], [3, 0]])).toEqual([]);
    expect(polygonProblems([[0, 0], [1, 0], [2, 0], [2, 2], [0, 2], [0, 0]])).toEqual([]);
  });

  it("refuses overlapping rooms on one floor (touching is fine)", () => {
    refuses(
      "two-rooms",
      (h) => h.rooms.push({ id: "c", label: "C", floor: "f", poly: [[6, 2], [8, 2], [8, 4], [6, 4]] }),
      /^rooms "b" and "c" overlap on floor "f"$/,
    );
    // Sharing an edge or a corner is not overlapping.
    expect(problems("two-rooms", (h) => h.rooms.push({ id: "c", label: "C", floor: "f", poly: [[7, 3], [8, 3], [8, 4], [7, 4]] }))).toEqual([]);
    // The same footprint on different floors is the stair fixture — fine.
    expect(problems("stair", () => {})).toEqual([]);
  });

  it("refuses a door off its wall, past its wall, or between floors", () => {
    refuses("two-rooms", (h) => (h.doors[0]!.at = [3.9, 1.5]), /\[3\.9, 1\.5\] is not on a wall of room "a"/);
    expect(problems("two-rooms", (h) => (h.doors[0]!.at = [4.015, 1.5]))).toEqual([]); // ± 0.02
    expect(problems("two-rooms", (h) => (h.doors[0]!.width = 3.2))).toEqual([
      'doors[0] "ab": its 3.2 m gap runs past the wall of room "a"',
      'doors[0] "ab": its 3.2 m gap runs past the wall of room "b"',
    ]);
    // On a's wall, but b's wall there is shorter.
    refuses("two-rooms", (h) => (h.rooms[1]!.poly = [[4, 0], [7, 0], [7, 3], [4.5, 3], [4.5, 1], [4, 1]]), /not on a wall room "a" shares with "b"/);
    refuses("two-rooms", (h) => (h.doors[0]!.b = "zz"), /unknown room "zz"/);
    refuses("two-rooms", (h) => (h.doors[0]!.b = "a"), /joins room "a" to itself/);
    refuses("stair", (h) => h.doors.push({ id: "x", a: "cellar", b: "hall", at: [0, 1], width: 1 }), /different floors/);
  });

  it("refuses a bad stair", () => {
    // Same floor: the rooms also overlap, so both are reported.
    expect(problems("stair", (h) => (h.rooms[1]!.floor = "lower"))).toEqual([
      'rooms "cellar" and "hall" overlap on floor "lower"',
      'stairs[0] "s": rooms "cellar" and "hall" are on the same floor',
      // …and the spawn (y 0, in the hall) is no longer on its room's floor.
      'spawn: y 0 is on floor "upper", not room "hall"\'s floor "lower"',
    ]);
    expect(problems("stair", (h) => (h.stairs[0]!.rect = [1, 1, 6, 2]))).toEqual([
      'stairs[0] "s": rect [1, 1, 6, 2] is not inside room "cellar"',
      'stairs[0] "s": rect [1, 1, 6, 2] is not inside room "hall"',
    ]);
    // Inside the cellar only.
    refuses(
      "stair",
      (h) => {
        h.rooms[1]!.poly = [[0, 0], [5, 0], [5, 1.5], [0, 1.5]];
        h.spawn.pos = [4.5, 0, 0.5];
      },
      /rect \[1, 1, 4, 2\] is not inside room "hall"/,
    );
    refuses("stair", (h) => (h.stairs[0]!.rect = [4, 1, 1, 2]), /x0 < x1/);
    refuses("stair", (h) => ([h.stairs[0]!.from, h.stairs[0]!.to] = ["hall", "cellar"]), /must be on a lower floor/);
    refuses("stair", (h) => (h.stairs[0]!.to = "attic"), /unknown room "attic"/);
  });

  it("refuses a sub-millimetre stair rect, wherever it is (regression)", () => {
    refuses("stair", (h) => (h.stairs[0]!.rect = [100.0001, 7, 100.0004, 11]), /x0 < x1 and z0 < z1 by at least 1 mm/);
    refuses("stair", (h) => (h.stairs[0]!.rect = [1, 1.0001, 4, 1.0004]), /by at least 1 mm/);
  });

  it("refuses a dead-end stair: its head or foot flush against a wall", () => {
    // The head (up n → the z = 6 edge) right on the hall / bathroom wall.
    expect(showProblems((h) => (h.stairs[0]!.rect = [-3.9, 6, -2.9, 10]))).toEqual([
      'stairs[0] "basement-stairs": its head (the "n" edge) needs 0.3 m of room "hall" beyond it',
    ]);
    // The foot (the z = 12 edge) against the landing's south wall.
    expect(showProblems((h) => (h.stairs[0]!.rect = [-3.9, 8, -2.9, 12]))).toEqual([
      'stairs[0] "basement-stairs": its foot (the "s" edge) needs 0.3 m of room "landing" beyond it',
    ]);
  });

  it("refuses a stair through a floor it doesn't join", () => {
    const p = problems("stair", (h) => {
      h.floors.push({ id: "mid", label: "Mid", elevation: -1.5, height: 1.4 });
      h.rooms.push({ id: "m", label: "M", floor: "mid", poly: [[0, 0], [5, 0], [5, 4], [0, 4]] });
      h.floors[0]!.height = 1.4;
    });
    expect(p).toEqual(['stairs[0] "s": it passes through floor "mid" (room "m"), which has no hole for it']);
  });

  it("refuses a stairwell stacked flight over flight (the game can't walk it)", () => {
    // `three-floors` puts its two flights end to end in the hall; stack the
    // upper one right over the basement one (a real house's usual shape).
    const stack = (up: "n" | "s") => (h: HouseMap) => {
      h.rooms.find((r) => r.id === "tophall")!.poly = [[3, 0], [6, 0], [6, 12], [3, 12]];
      Object.assign(h.stairs[1]!, { rect: [4.4, 2.5, 5.4, 6.5], up });
    };
    for (const up of ["n", "s"] as const) {
      refuses("three-floors", stack(up), /stairs\[0\] "basement-stairs": its rect overlaps stair "upstairs" in plan .*offset the flights/);
    }
    // Side by side, or end to end (the fixture as it is), is fine.
    expect(problems("three-floors", () => {})).toEqual([]);
    // Overlapping in plan but sharing no floor (basement → main under top → attic) is left alone.
    const p = problems("three-floors", (h) => {
      h.floors.push({ id: "attic", label: "Attic", elevation: 5.2, height: 2 });
      h.rooms.push({ id: "attic", label: "Attic", floor: "attic", poly: [[3, 0], [6, 0], [6, 12], [3, 12]] });
      h.rooms.find((r) => r.id === "tophall")!.poly = [[3, 0], [6, 0], [6, 12], [3, 12]];
      h.stairs.push({ id: "attic-stairs", from: "tophall", to: "attic", rect: [4.4, 2.5, 5.4, 6.5], up: "n" });
    });
    expect(p.filter((m) => m.includes("overlaps stair"))).toEqual([]);
  });

  it("refuses floors whose elevations differ by 0.5 m or less", () => {
    const add = (elevation: number) => (h: HouseMap) => {
      h.floors.push({ id: "g2", label: "G2", elevation, height: 2.5 });
      h.rooms.push({ id: "pit", label: "Pit", floor: "g2", poly: [[100, 100], [102, 100], [102, 102], [100, 102]] });
    };
    const msg = /^floors "(f|g2)" and "(f|g2)": elevations must differ by more than 0\.5 m/;
    refuses("two-rooms", add(0), msg);
    refuses("two-rooms", add(-0.4), msg);
    refuses("two-rooms", add(-0.5), msg);
    expect(problems("two-rooms", add(-0.6))).toEqual([]);
  });

  it("refuses a room whose walls rise through the floor above", () => {
    const p = showProblems((h) => (h.floors.find((f) => f.id === "basement")!.height = 2.85));
    expect(p).toHaveLength(2); // the landing and the rec room; the tent sets its own 2.2
    expect(p[0]).toMatch(/^rooms\[6\] "landing": its top \(0\.15 m\) rises above floor "ground" \(elevation 0\) under room "(hall|bathroom)"$/);
    expect(p[1]).toMatch(/^rooms\[7\] "registry": its top \(0\.15 m\) rises above floor "ground"/);
    // Up to the floor above is fine.
    expect(showProblems((h) => (h.floors.find((f) => f.id === "basement")!.height = 2.7))).toEqual([]);
    // Away from the upper floor's rooms (a tall wing beside a lower storey) is fine.
    expect(
      problems("stair", (h) => {
        h.rooms.push({ id: "wing", label: "Wing", floor: "lower", height: 5, poly: [[20, 0], [24, 0], [24, 4], [20, 4]] });
      }),
    ).toEqual([]);
  });

  it("refuses a door to the outside on a wall another room shares (regression)", () => {
    refuses(
      "two-rooms",
      (h) => (h.doors[0]!.b = null),
      /^doors\[0\] "ab": a door to the outside \(b = null\) sits on a wall shared with room "b"/,
    );
    // The show: a hall door at a junction would cut the Living Room / Kitchen wall.
    expect(showProblems((h) => h.doors.push({ id: "fake", a: "hall", b: null, at: [0.5, 6.5], width: 1 }))).toEqual([
      'doors[9] "fake": a door to the outside (b = null) sits on a wall shared with room "living" — name it as b',
      'doors[9] "fake": a door to the outside (b = null) sits on a wall shared with room "kitchen" — name it as b',
    ]);
  });

  it("measures a door's distance from the wall's mm-rounded line, like buildWalls (regression)", () => {
    const nudge = (z: number) => (h: HouseMap) => {
      for (const r of h.rooms) r.poly = r.poly.map(([x, pz]) => [x, pz === 0 ? 0.0004 : pz]);
      h.doors.find((d) => d.id === "front")!.at = [-0.45, z];
    };
    expect(showProblems(nudge(0.0203))).toEqual([
      'doors[0] "front": [-0.45, 0.0203] is not on a wall of room "mudroom" (± 0.02 m)',
    ]);
    expect(showProblems(nudge(0.0199))).toEqual([]);
    const h = JSON.parse(readFileSync(SHOW_HOUSE, "utf8")) as HouseMap;
    nudge(0.0199)(h);
    const front = buildWalls(h).filter((w) => w.floor === "ground" && w.axis === "x" && w.c === 0);
    expect(front.some((w) => w.kind === "lintel" && w.lo === -0.9 && w.hi === 0)).toBe(true);
  });

  it("refuses doors whose gaps overlap on one wall (touching is fine)", () => {
    const door = (at: [number, number], width: number) => (h: HouseMap) =>
      h.doors.push({ id: "extra", a: "hall", b: "living", at, width });
    // hall-living: [0.5, 4.5], 1.2 m wide → z 3.9 to 5.1.
    expect(showProblems(door([0.5, 4.6], 0.4))).toEqual(['doors[9] "extra": its gap overlaps door "hall-living"']);
    expect(showProblems(door([0.5, 5.1], 0.9))).toEqual(['doors[9] "extra": its gap overlaps door "hall-living"']);
    // Within the line tolerance it is still the same wall.
    expect(showProblems(door([0.51, 5.1], 0.9))).toEqual(['doors[9] "extra": its gap overlaps door "hall-living"']);
    expect(showProblems(door([0.5, 5.4], 0.6))).toEqual([]); // 5.1 to 5.7: end to end
  });

  it("refuses duck spots, the spawn, terminals and props at the wrong height (regression)", () => {
    const spot = (id: string, pos: [number, number, number]) => (h: HouseMap) =>
      (h.duck.spots.find((s) => s.id === id)!.pos = pos);
    // A basement spot at ground level: it would locate in the kitchen.
    expect(showProblems(spot("registry-furnace", [4.6, 0, 11.5]))).toEqual([
      'duck.spots[9] "registry-furnace": y 0 is on floor "ground", not room "registry"\'s floor "basement"',
    ]);
    // The right floor but out of reach (the server refuses `found` above DUCK_MAX_RISE).
    expect(DUCK_MAX_RISE).toBe(1.2);
    expect(showProblems(spot("kitchen-counter", [5.7, 2.0, 8]))).toEqual([
      'duck.spots[4] "kitchen-counter": y 2 must be 0 to 1.2 m above room "kitchen"\'s floor (elevation 0)',
    ]);
    expect(showProblems(spot("kitchen-counter", [5.7, 1.2, 8]))).toEqual([]);
    // The spawn in the tent at ground level would stand the player in the Living Room.
    expect(showProblems((h) => (h.spawn.pos = [4, 0, 5]))).toEqual([
      'spawn: y 0 is on floor "ground", not room "tent"\'s floor "basement"',
    ]);
    expect(showProblems((h) => (h.spawn.pos = [4, -2.1, 5]))).toEqual([
      'spawn: y -2.1 must be within 0.45 m of room "tent"\'s floor (elevation -2.7)',
    ]);
    // A terminal / prop outside its room's storey.
    expect(showProblems((h) => (h.terminals.find((t) => t.id === "registry")!.pos = [6, 1.4, 9.25]))).toEqual([
      'terminals[5] "registry": y 1.4 is not within room "registry"\'s height (-2.7 to -0.3 m)',
    ]);
    expect(showProblems((h) => (h.props.find((p) => p.id === "furnace")!.pos = [5.3, 0, 11.3]))).toEqual([
      'props[22] "furnace": y 0 is not within room "registry"\'s height (-2.7 to -0.3 m)',
    ]);
  });

  it("refuses a duck spot over a stair that locates to the other room", () => {
    // A 2 m stair: a landing spot 1.1 m up, over the ramp, is nearer the hall's level.
    const p = showProblems((h) => {
      const basement = h.floors.find((f) => f.id === "basement")!;
      basement.elevation = -2;
      basement.height = 2;
      h.rooms.find((r) => r.id === "tent")!.height = 2;
      for (const x of [...h.terminals, ...h.props, ...h.duck.spots, h.spawn]) if (x.pos[1] < 0) x.pos[1] = mm(x.pos[1] + 0.7);
      h.duck.spots.find((s) => s.id === "landing-foot")!.pos = [-3.4, -0.9, 9];
    });
    expect(p).toEqual(['duck.spots[8] "landing-foot": [-3.4, -0.9, 9] locates to room "hall", not "landing"']);
  });

  it("refuses a duck spot or spawn buried in a solid prop (resting on top is fine)", () => {
    expect(showProblems((h) => (h.duck.spots.find((s) => s.id === "bathroom-tub")!.pos = [-3.2, 0.1, 5.6]))).toEqual([
      'duck.spots[5] "bathroom-tub": [-3.2, 0.1, 5.6] is inside solid prop "tub" (rest it on top at y 0.55 or move it clear)',
    ]);
    // A yawed box: the couch (2 × 0.9, yaw −90) runs along z.
    expect(showProblems((h) => (h.duck.spots.find((s) => s.id === "living-couch")!.pos = [2.8, 0, 4.1]))).toEqual([
      'duck.spots[2] "living-couch": [2.8, 0, 4.1] is inside solid prop "couch" (rest it on top at y 0.85 or move it clear)',
    ]);
    expect(showProblems((h) => (h.spawn.pos = [5.3, -2.7, 5.8]))).toEqual([]);
    expect(showProblems((h) => (h.duck.spots[0]!.pos = [-1.2, 0, 2.9]))).toEqual([
      'duck.spots[0] "mudroom-boots": [-1.2, 0, 2.9] is outside room "mudroom" (± 0.05 m)',
    ]);
    // A non-solid prop never buries anything.
    expect(problems("yard", (h) => (h.duck.spots[0]!.pos = [1, 0, 6]))).toEqual([
      'duck.spots[0] "lawn": [1, 0, 6] is inside solid prop "tree" (rest it on top at y 3 or move it clear)',
    ]);
    expect(problems("yard", (h) => {
      h.duck.spots[0]!.pos = [1, 0, 6];
      h.props[0]!.solid = false;
    })).toEqual([]);
  });

  it("refuses things outside their rooms (± 0.05 m)", () => {
    refuses("two-rooms", (h) => (h.terminals[0]!.pos = [7.06, 1.4, 1.5]), /terminals\[0\] "t": .* is outside room "b"/);
    expect(problems("two-rooms", (h) => (h.terminals[0]!.pos = [7.04, 1.4, 1.5]))).toEqual([]);
    refuses("two-rooms", (h) => (h.duck.spots[0]!.room = "b"), /duck\.spots\[0\] "in-a": .* is outside room "b"/);
    refuses("two-rooms", (h) => (h.duck.spots[0]!.room = "nope"), /unknown room "nope"/);
    refuses("two-rooms", (h) => (h.spawn.pos = [9, 0, 1]), /^spawn: .* is outside room "a"/);
    refuses("yard", (h) => (h.props[0]!.room = "house"), /props\[0\] "tree": .* is outside room "house"/);
    // The L's notch is outside it.
    refuses("l-room", (h) => (h.duck.spots[0]!.pos = [3, 0, 3]), /outside room "l"/);
  });
});

describe("normalizeHouse", () => {
  it("fills defaults without touching the input", () => {
    const h = raw("two-rooms") as Partial<HouseMap>;
    delete h.stairs;
    delete h.props;
    delete h.spaces;
    const n = normalizeHouse(h as HouseMap);
    expect(n.stairs).toEqual([]);
    expect(n.props).toEqual([]);
    expect(n.spaces).toEqual({
      vr: { offset: [0, 0, 0], yaw: 0, scale: 1 },
      web: { offset: [0, 0, 0], yaw: 0, scale: 1 },
    });
    expect(n.style).toEqual({ fence: 1, wallThickness: 0.1, doorHeight: 2 });
    expect(h.stairs).toBeUndefined();
    // Validation accepts the missing optional lists and returns the normalized map.
    const v = validateHouse(h);
    expect(v.ok).toBe(true);
    expect(v.house?.spaces["web"]?.scale).toBe(1);
  });

  it("keeps given spaces, completing partial ones", () => {
    const n = normalizeHouse({ ...raw("stair"), spaces: { vr: { yaw: 90 } as never } });
    expect(n.spaces["vr"]).toEqual({ offset: [0, 0, 0], yaw: 90, scale: 1 });
  });
});
