import { describe, expect, it } from "vitest";
import {
  floorOf,
  heightAt,
  locate,
  pathLength,
  portals,
  rampHeight,
  roomAt,
  route,
  sampleTrail,
  yawToward,
} from "../src/index.ts";
import { fixture } from "./golden.ts";

describe("floorOf / roomAt / locate", () => {
  const stair = fixture("stair");

  it("picks the highest floor at or below y + 0.5, else the lowest", () => {
    expect(floorOf(stair, 0)).toBe("upper");
    expect(floorOf(stair, -0.5)).toBe("upper");
    expect(floorOf(stair, -0.51)).toBe("lower");
    expect(floorOf(stair, -3)).toBe("lower");
    expect(floorOf(stair, -50)).toBe("lower");
    expect(floorOf(stair, 50)).toBe("upper");
  });

  it("finds the room on a floor; the boundary counts, first in array order wins", () => {
    const two = fixture("two-rooms");
    expect(roomAt(two, [1, 1], "f")?.id).toBe("a");
    expect(roomAt(two, [6, 1], "f")?.id).toBe("b");
    expect(roomAt(two, [4, 1], "f")?.id).toBe("a");
    expect(roomAt(two, [8, 1], "f")).toBeNull();
    expect(roomAt(fixture("l-room"), [3, 3], "f")).toBeNull();
  });

  it("applies the stair rule over a stair rect", () => {
    expect(locate(stair, [2.5, -2.2, 1.5])).toEqual({ floor: "lower", room: "cellar" });
    expect(locate(stair, [2.5, -0.8, 1.5])).toEqual({ floor: "upper", room: "hall" });
    // Exactly halfway is not *nearer* the lower elevation.
    expect(locate(stair, [2.5, -1.5, 1.5])).toEqual({ floor: "upper", room: "hall" });
    // Off the rect the floor decides.
    expect(locate(stair, [0.5, -1.5, 3.5])).toEqual({ floor: "lower", room: "cellar" });
    expect(locate(stair, [0.5, 0, 3.5])).toEqual({ floor: "upper", room: "hall" });
    expect(locate(stair, [9, 0, 9])).toEqual({ floor: "upper", room: null });
  });
});

describe("heightAt", () => {
  const stair = fixture("stair");

  it("follows the ramp from its own height, keeps a floor under it", () => {
    expect(rampHeight(stair, stair.stairs[0]!, [2.5, 1.5])).toBe(-1.5);
    // Walking up the ramp: the hint is the current height.
    expect(heightAt(stair, [2.5, 1.5], -1.6)).toBe(-1.5);
    expect(heightAt(stair, [3.9, 1.5], -0.2)).toBeCloseTo(-0.1);
    // Standing in the cellar under the ramp: the ramp is out of reach.
    expect(heightAt(stair, [2.5, 1.5], -3)).toBe(-3);
    // From above: the hall floor is a hole there, so the ramp.
    expect(heightAt(stair, [2.5, 1.5], 0)).toBe(-1.5);
  });

  it("chooses the highest surface within a step, else the lowest", () => {
    expect(heightAt(stair, [0.5, 3.5], 0)).toBe(0);
    expect(heightAt(stair, [0.5, 3.5], -3)).toBe(-3);
    expect(heightAt(stair, [0.5, 3.5], -10)).toBe(-3);
    expect(heightAt(stair, [0.5, 3.5], 10)).toBe(0);
    expect(heightAt(stair, [10, 10], 0)).toBeNull();
  });

  it("keeps the upper floor on the hole's edge", () => {
    // On the north rail line, the hall floor is still there.
    expect(heightAt(stair, [2.5, 1], 0)).toBe(0);
    // The head edge meets the floor.
    expect(heightAt(stair, [4, 1.5], 0)).toBe(0);
  });
});

describe("route", () => {
  it("is a straight line within a room", () => {
    const two = fixture("two-rooms");
    expect(route(two, [1, 0, 1], [3, 0, 2])).toEqual([
      [1, 0, 1],
      [3, 0, 2],
    ]);
  });

  it("goes through a door", () => {
    const two = fixture("two-rooms");
    expect(route(two, [1, 0, 1], [6, 0, 2])).toEqual([
      [1, 0, 1],
      [4, 0, 1.5],
      [6, 0, 2],
    ]);
  });

  it("takes the stair: foot then head", () => {
    const stair = fixture("stair");
    expect(portals(stair).map((p) => [p.kind, p.pos, p.rooms])).toEqual([
      ["foot", [1, -3, 1.5], ["cellar"]],
      ["head", [4, 0, 1.5], ["hall"]],
    ]);
    expect(route(stair, [0.5, -3, 3.5], [4.5, 0, 3.5])).toEqual([
      [0.5, -3, 3.5],
      [1, -3, 1.5],
      [4, 0, 1.5],
      [4.5, 0, 3.5],
    ]);
    expect(route(stair, [4.5, 0, 3.5], [0.5, -3, 3.5])).toEqual([
      [4.5, 0, 3.5],
      [4, 0, 1.5],
      [1, -3, 1.5],
      [0.5, -3, 3.5],
    ]);
  });

  it("breaks ties toward the lower portal index", () => {
    const tie = fixture("tie");
    expect(route(tie, [1, 0, 2], [3, 0, 2])).toEqual([
      [1, 0, 2],
      [2, 0, 1],
      [3, 0, 2],
    ]);
    expect(route(tie, [3, 0, 2], [1, 0, 2])[1]).toEqual([2, 0, 1]);
    // Off the tie, the nearer door wins.
    expect(route(tie, [1, 0, 3.5], [3, 0, 3.5])[1]).toEqual([2, 0, 3]);
  });

  it("gives up gracefully on an unlocatable end or no path", () => {
    const two = fixture("two-rooms");
    expect(route(two, [1, 0, 1], [50, 0, 50])).toEqual([
      [1, 0, 1],
      [50, 0, 50],
    ]);
    two.doors = [];
    expect(route(two, [1, 0, 1], [6, 0, 2])).toEqual([
      [1, 0, 1],
      [6, 0, 2],
    ]);
  });

  it("samples a chevron trail", () => {
    const path = route(fixture("two-rooms"), [1, 0, 1.5], [6, 0, 1.5]);
    expect(pathLength(path)).toBe(5);
    const trail = sampleTrail(path, 1);
    expect(trail.map((t) => t.p[0])).toEqual([2, 3, 4, 5, 6]);
    expect(trail[0]!.yaw).toBe(-90); // east
    expect(yawToward([0, 0, 0], [0, 0, -1])).toBe(0);
    expect(yawToward([0, 0, 0], [-1, 0, 0])).toBe(90);
  });
});
