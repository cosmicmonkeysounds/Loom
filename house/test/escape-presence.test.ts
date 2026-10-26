import { describe, expect, it } from "vitest";
import {
  ESCAPE_COOLDOWN_MS,
  ESCAPE_M,
  ESCAPE_SIGNAL,
  ESCAPE_SLACK,
  OUTSIDE_GROUND_MARGIN,
  PATH_REVEAL_MS,
  PRESENCE_HYSTERESIS_M,
  PRESENCE_LINGER_MS,
  linkedSpots,
  locate,
  outsideGround,
  presenceRoom,
  voidDistance,
} from "../src/index.ts";
import { distanceToBoundary } from "../src/geometry.ts";
import type { HouseMap } from "../src/index.ts";
import { SHOW_HOUSE, SHOW_SHED_HOUSE, fixture, loadHouse } from "./golden.ts";

describe("the contract's constants (wave 26)", () => {
  it("escape, presence and the path reveal", () => {
    expect([ESCAPE_M, ESCAPE_SLACK, ESCAPE_COOLDOWN_MS, OUTSIDE_GROUND_MARGIN]).toEqual([5, 0.5, 20_000, 30]);
    expect(ESCAPE_SIGNAL).toBe("simulation escape attempt");
    expect([PRESENCE_HYSTERESIS_M, PRESENCE_LINGER_MS]).toEqual([0.75, 3000]);
    expect(PATH_REVEAL_MS).toBe(60_000);
  });
});

describe("outsideGround", () => {
  it("is the exterior door's floor, its elevation and the rooms' bounds grown by the margin", () => {
    expect(outsideGround(fixture("two-rooms"))).toEqual({ floor: "f", y: 0, rect: [-30, -30, 37, 33] });
    expect(outsideGround(fixture("yard"))).toEqual({ floor: "g", y: 0, rect: [-30, -30, 36, 37] });
    expect(outsideGround(fixture("two-rooms"), 2)!.rect).toEqual([-2, -2, 9, 5]);
  });

  it("is null without an exterior door", () => {
    expect(outsideGround(fixture("stair"))).toBeNull();
    expect(outsideGround(fixture("props"))).toBeNull();
  });

  it("on the show maps: the main floor, past the mud room's front door", () => {
    for (const path of [SHOW_HOUSE, SHOW_SHED_HOUSE]) {
      const h = loadHouse(path);
      const g = outsideGround(h)!;
      const front = h.doors.find((d) => d.b === null)!;
      expect(front.id).toBe("front");
      expect(h.rooms.find((r) => r.id === front.a)!.id).toBe("optical-drive");
      expect(g.floor).toBe("main");
      expect(g.y).toBe(0);
      // The front door's outside is on the ground, well inside the margin.
      expect(front.at[0]).toBeGreaterThan(g.rect[0]);
      expect(front.at[1] - ESCAPE_M - 1).toBeGreaterThan(g.rect[1]);
    }
  });
});

describe("voidDistance", () => {
  const two = fixture("two-rooms");

  it("is null in a room (the boundary counts)", () => {
    expect(voidDistance(two, [1, 0, 1])).toBeNull();
    expect(voidDistance(two, [2, 0, 0])).toBeNull();
    expect(voidDistance(two, [7, 0, 3])).toBeNull();
  });

  it("is the plan distance to the nearest room on the point's floor", () => {
    expect(voidDistance(two, [2, 0, -5])).toBeCloseTo(5, 12);
    expect(voidDistance(two, [10, 0, 1.5])).toBeCloseTo(3, 12);
    expect(voidDistance(two, [10, 0, 7])).toBeCloseTo(5, 12);
    // Height decides the floor, never the distance.
    expect(voidDistance(two, [2, 0.3, -5])).toBeCloseTo(5, 12);
  });

  it("is Infinity on a floor with no rooms", () => {
    const h: HouseMap = { ...two, floors: [...two.floors, { id: "roof", label: "Roof", elevation: 10, height: 2 }] };
    expect(voidDistance(h, [2, 10, -5])).toBe(Infinity);
  });

  it("on the show: 5 m north of the front door is an escape; the backyard is not the void", () => {
    const h = loadHouse(SHOW_HOUSE);
    const front = h.doors.find((d) => d.id === "front")!;
    expect(voidDistance(h, [front.at[0], 0, front.at[1] - 0.2])).toBeCloseTo(0.2, 9);
    expect(voidDistance(h, [front.at[0], 0, front.at[1] - ESCAPE_M])!).toBeGreaterThanOrEqual(ESCAPE_M - 1e-9);
    expect(voidDistance(h, [front.at[0], 0, front.at[1] - (ESCAPE_M - ESCAPE_SLACK)])!).toBeGreaterThanOrEqual(ESCAPE_M - ESCAPE_SLACK - 1e-9);
    expect(voidDistance(h, h.spawn.pos)).toBeNull();
    for (const s of h.duck.spots) expect(voidDistance(h, s.pos), s.id).toBeNull();
  });
});

describe("presenceRoom", () => {
  const two = fixture("two-rooms");

  it("is locate's room with no previous room", () => {
    expect(presenceRoom(two, [1, 0, 1], null)).toBe("a");
    expect(presenceRoom(two, [6, 0, 1], null)).toBe("b");
    expect(presenceRoom(two, [20, 0, 1], null)).toBeNull();
  });

  it("keeps the previous room within the hysteresis past its wall, then lets go", () => {
    // From a through the door into b: a holds until 0.75 m past the wall.
    expect(presenceRoom(two, [4.5, 0, 1.5], "a")).toBe("a");
    expect(presenceRoom(two, [4 + PRESENCE_HYSTERESIS_M, 0, 1.5], "a")).toBe("a");
    expect(presenceRoom(two, [4 + PRESENCE_HYSTERESIS_M + 0.01, 0, 1.5], "a")).toBe("b");
    // … and back the same way.
    expect(presenceRoom(two, [3.3, 0, 1.5], "b")).toBe("b");
    expect(presenceRoom(two, [3.2, 0, 1.5], "b")).toBe("a");
  });

  it("holds outside the house too (the front door), then the void is no room", () => {
    expect(presenceRoom(two, [2, 0, -0.5], "a")).toBe("a");
    expect(presenceRoom(two, [2, 0, -0.8], "a")).toBeNull();
  });

  it("a shared wall: the previous room wins the tie", () => {
    expect(locate(two, [4, 0, 1.5]).room).toBe("a");
    expect(presenceRoom(two, [4, 0, 1.5], "b")).toBe("b");
  });

  it("holds only at the door, never through the shared wall", () => {
    // Beside the a|b wall, 0.3 m into b but well along it from the door gap
    // (z 1.0–2.0): the player is in b, not held in a through the wall.
    expect(presenceRoom(two, [4.3, 0, 0.2], "a")).toBe("b");
    expect(presenceRoom(two, [4.3, 0, 2.9], "a")).toBe("b");
    expect(presenceRoom(two, [3.7, 0, 0.2], "b")).toBe("a");
    // Just past the gap's end, within the hysteresis of it: held.
    expect(presenceRoom(two, [4.3, 0, 0.9], "a")).toBe("a");
    // Outside, 1 m along the front wall from the front door's gap (x 1.55–2.45): the void.
    expect(presenceRoom(two, [0.5, 0, -0.3], "a")).toBeNull();
  });

  it("holds on a stair until the player steps off it", () => {
    const stair = fixture("stair");
    // Over the ramp (rect x 1–4, z 1–2, up east), past half height going up: still the cellar.
    const high: [number, number, number] = [3.5, -0.5, 1.5];
    expect(locate(stair, high).room).toBe("hall");
    expect(presenceRoom(stair, high, "cellar")).toBe("cellar");
    // Going down, past half height: still the hall.
    const low: [number, number, number] = [1.5, -2.5, 1.5];
    expect(locate(stair, low).room).toBe("cellar");
    expect(presenceRoom(stair, low, "hall")).toBe("hall");
    // Off the head of the ramp: the hall.
    expect(presenceRoom(stair, [4.3, 0, 1.5], "cellar")).toBe("hall");
  });

  it("on the show map: every hold is at a door or a stair joining the two rooms", () => {
    for (const path of [SHOW_HOUSE, SHOW_SHED_HOUSE]) {
      const h = loadHouse(path);
      let held = 0;
      for (const room of h.rooms) {
        const y = h.floors.find((f) => f.id === room.floor)!.elevation;
        for (const other of h.rooms) {
          if (other.floor !== room.floor) continue;
          const xs = other.poly.map((q) => q[0]);
          const zs = other.poly.map((q) => q[1]);
          for (let x = Math.min(...xs) - 1; x <= Math.max(...xs) + 1; x += 0.25) {
            for (let z = Math.min(...zs) - 1; z <= Math.max(...zs) + 1; z += 0.25) {
              const p: [number, number, number] = [x, y, z];
              const here = locate(h, p).room;
              if (here === room.id || presenceRoom(h, p, room.id) !== room.id) continue;
              held++;
              // On the shared wall line itself (inside a wall), the tie goes to `prev`.
              if (distanceToBoundary(room.poly, [x, z]) < 1e-6) continue;
              const near = h.doors.some(
                (d) =>
                  ((d.a === room.id && d.b === here) || (d.b === room.id && d.a === here)) &&
                  Math.hypot(d.at[0] - x, d.at[1] - z) <= d.width / 2 + PRESENCE_HYSTERESIS_M + 1e-6,
              );
              expect(near, `${room.id} held at ${x.toFixed(2)},${z.toFixed(2)} in ${here}`).toBe(true);
            }
          }
        }
      }
      expect(held).toBeGreaterThan(0);
    }
  });

  it("never holds across floors, nor for an unknown room", () => {
    const stair = fixture("stair");
    const lower = stair.rooms.find((r) => stair.floors.find((f) => f.id === r.floor)!.elevation < 0)!;
    const upper = stair.rooms.find((r) => r.floor !== lower.floor)!;
    const [x, z] = upper.poly[0]!;
    const y = stair.floors.find((f) => f.id === upper.floor)!.elevation;
    const p = [x + 0.1, y, z + 0.1] as [number, number, number];
    const here = locate(stair, p).room;
    expect(presenceRoom(stair, p, lower.id)).toBe(here);
    expect(presenceRoom(two, [6, 0, 1], "nowhere")).toBe("b");
  });
});

describe("linkedSpots", () => {
  it("names the terminals in the occupied rooms, never the tent station", () => {
    const h = loadHouse(SHOW_HOUSE);
    expect(linkedSpots(h, [])).toEqual(new Set());
    expect(linkedSpots(h, [null])).toEqual(new Set());
    const tv = h.terminals.find((t) => t.id === "desktop-tv")!;
    expect(tv.room).toBe("desktop");
    expect(linkedSpots(h, ["desktop"]).has("desktop-tv")).toBe(true);
    const tent = h.terminals.filter((t) => t.view === "reinstall");
    expect(tent.length).toBeGreaterThan(0);
    for (const t of tent) expect(linkedSpots(h, [t.room]).has(t.id), t.id).toBe(false);
    const all = linkedSpots(h, h.rooms.map((r) => r.id));
    expect(all.size).toBe(h.terminals.length - tent.length);
    const two = linkedSpots(h, ["desktop", "server-room", "desktop"]);
    for (const id of two) expect(["desktop", "server-room"]).toContain(h.terminals.find((t) => t.id === id)!.room);
  });
});
