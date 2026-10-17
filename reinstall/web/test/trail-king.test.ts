// The trail behind the King's door (B17): `route()` keeps a guarded door
// shut, so once the King has fallen and the player has walked through it,
// the trail must route over `trailMap` (his doors open) or every route out
// of the Server Room is the straight no-path line through a wall.

import { describe, expect, it } from "vitest";
import { locate, roomById, roomElevation, route } from "@loom/house";
import type { HouseMap, Vec3 } from "@loom/house";
import { trail, trailMap } from "../src/game/trail.ts";
import { SHOW } from "./houses.ts";

function kingSetup(house: HouseMap) {
  const king = house.props.find((p) => p.kind === "king");
  if (king === undefined) throw new Error("the show map has no king");
  const door = house.doors.find((d) => d.guard === king.id);
  if (door === undefined || door.b === null) throw new Error("the king guards no inside door");
  const behind = door.a === king.room ? door.b : door.a;
  const room = roomById(house, behind)!;
  const xs = room.poly.map((v) => v[0]);
  const zs = room.poly.map((v) => v[1]);
  const feet: Vec3 = [(Math.min(...xs) + Math.max(...xs)) / 2, roomElevation(house, room), (Math.min(...zs) + Math.max(...zs)) / 2];
  expect(locate(house, feet).room).toBe(behind);
  return { king, door, behind, feet };
}

const near = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[2] - q[2]) < 0.05;

describe("trailMap", () => {
  it("is the map itself while the King stands, or with no King", () => {
    const house = SHOW();
    const { king } = kingSetup(house);
    expect(trailMap(house, king.id, false)).toBe(house);
    expect(trailMap(house, null, true)).toBe(house);
  });

  it("opens only the fallen King's doors and drops his prop, leaving the map untouched", () => {
    const house = SHOW();
    const { king, door } = kingSetup(house);
    const open = trailMap(house, king.id, true);
    expect(open.doors.find((d) => d.id === door.id)?.guard).toBeUndefined();
    expect(open.props.some((p) => p.id === king.id)).toBe(false);
    expect(open.doors).toHaveLength(house.doors.length);
    expect(house.doors.find((d) => d.id === door.id)?.guard).toBe(king.id);
  });

  it("leads a player in the Server Room back out through the server door to the fan-closet duck", () => {
    const house = SHOW();
    const { king, door, behind, feet } = kingSetup(house);
    const duck = house.duck.spots.find((s) => s.room === "fan-closet") ?? house.duck.spots.find((s) => s.room !== behind)!;
    // The bug: over the guarded map there is no path, only the straight line.
    expect(route(house, feet, duck.pos)).toHaveLength(2);
    const path = trail(trailMap(house, king.id, true), feet, duck.pos);
    expect(path.length).toBeGreaterThan(2);
    const doorPos: Vec3 = [door.at[0], feet[1], door.at[1]];
    expect(path.some((p) => near(p, doorPos))).toBe(true);
  });

  it("finds a real path from behind the fallen King to every duck outside his room", () => {
    const house = SHOW();
    const { king, behind, feet } = kingSetup(house);
    const open = trailMap(house, king.id, true);
    for (const spot of house.duck.spots) {
      if (spot.room === behind) continue;
      expect(trail(open, feet, spot.pos).length, spot.id).toBeGreaterThan(2);
    }
  });
});
