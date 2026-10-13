//! The visibility-graph route (`docs/loom-reinstall.md` §1.2 "Route"):
//! hand-checked cases on the fixtures, plus the show's map walked leg by
//! leg against its own walls.

import { describe, expect, it } from "vitest";
import {
  PROP_MARGIN,
  buildWalls,
  inPropFootprint,
  locate,
  propObstacle,
  propSolid,
  properlyCross,
  reflexWaypoints,
  roomObstacles,
  route,
  routeNodes,
  segmentHitsRect,
  visibleIn,
} from "../src/index.ts";
import type { HouseMap, Prop, Vec2, Vec3 } from "../src/index.ts";
import { labelPoint } from "../src/three/layout.ts";
import { SHOW_HOUSE, fixture, loadHouse } from "./golden.ts";

const mm3 = (p: Vec3): Vec3 => p.map((v) => Math.round(v * 1000) / 1000 + 0) as Vec3;
const path = (house: HouseMap, from: Vec3, to: Vec3): Vec3[] => route(house, from, to).map(mm3);

describe("route geometry helpers", () => {
  it("finds reflex corners, 0.35 m into the room along each axis, either winding", () => {
    const l: Vec2[] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4], [0, 2]];
    expect(reflexWaypoints(l).map(([x, z]) => [mm3([x, 0, z])[0], mm3([x, 0, z])[2]])).toEqual([[1.65, 1.65]]);
    expect(reflexWaypoints([...l].reverse()).map(([x, z]) => [mm3([x, 0, z])[0], mm3([x, 0, z])[2]])).toEqual([
      [1.65, 1.65],
    ]);
    // A rectangle (and its straight vertex) has none.
    expect(reflexWaypoints([[0, 0], [2, 0], [4, 0], [4, 1], [0, 1]])).toEqual([]);
    // A reflex corner too tight for the clearance is skipped.
    expect(reflexWaypoints([[0, 0], [4, 0], [4, 0.2], [2, 0.2], [2, 4], [0, 4]])).toEqual([]);
  });

  it("counts only proper crossings", () => {
    expect(properlyCross([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true);
    expect(properlyCross([0, 0], [1, 1], [1, 1], [2, 0])).toBe(false); // touching at an end
    expect(properlyCross([0, 0], [2, 0], [1, 0], [3, 0])).toBe(false); // collinear
    expect(properlyCross([0, 1], [2, 1], [1, 0], [1, 1])).toBe(false); // T on an end
  });

  it("clips a segment against an open rect", () => {
    const r: [number, number, number, number] = [1, 1, 2, 2];
    expect(segmentHitsRect([0, 1.5], [3, 1.5], r)).toBe(true);
    expect(segmentHitsRect([0, 1], [3, 1], r)).toBe(false); // along an edge line
    expect(segmentHitsRect([0, 0], [1, 1], r)).toBe(false); // touching a corner
    expect(segmentHitsRect([0, 0], [3, 0.9], r)).toBe(false);
    expect(segmentHitsRect([1.5, 0], [1.5, 1.2], r)).toBe(true);
  });
});

describe("route — the visibility graph", () => {
  it("stays a straight line when the two points see each other", () => {
    const l = fixture("l-room");
    expect(path(l, [0.5, 0, 0.5], [1, 0, 3.5])).toEqual([
      [0.5, 0, 0.5],
      [1, 0, 3.5],
    ]);
    expect(path(l, [3.5, 0, 0.5], [0.5, 0, 1.5])).toEqual([
      [3.5, 0, 0.5],
      [0.5, 0, 1.5],
    ]);
  });

  it("turns an L-shaped room's inner corner through its waypoint", () => {
    const l = fixture("l-room");
    // The straight line would leave the room (at x = 2 it is at z = 2.3).
    expect(visibleIn(l, l.rooms[0]!, [3.5, 0, 0.5], [1, 0, 3.5])).toBe(false);
    expect(path(l, [3.5, 0, 0.5], [1, 0, 3.5])).toEqual([
      [3.5, 0, 0.5],
      [1.65, 0, 1.65],
      [1, 0, 3.5],
    ]);
  });

  it("lists portals, then reflex waypoints, then stair corners (upper room, lower room)", () => {
    const hole = fixture("hole");
    expect(routeNodes(hole).map((n) => [n.kind, n.id, mm3(n.pos)])).toEqual([
      ["foot", "s", [1, -3, 1.5]],
      ["head", "s", [4, 0, 1.5]],
      ["corner", "hall", [2.65, 0, 3.65]],
      ["corner", "hall", [0.65, 0, 0.65]],
      ["corner", "hall", [4.35, 0, 0.65]],
      ["corner", "hall", [4.35, 0, 2.35]],
      ["corner", "hall", [0.65, 0, 2.35]],
      ["corner", "cellar", [0.65, -3, 0.65]],
      ["corner", "cellar", [4.35, -3, 0.65]],
      ["corner", "cellar", [4.35, -3, 2.35]],
      ["corner", "cellar", [0.65, -3, 2.35]],
    ]);
    // A corner outside its room is skipped (the show's stair is 0.1 m off the west wall).
    const show = loadHouse(SHOW_HOUSE);
    const corners = routeNodes(show).filter((n) => n.kind === "corner").map((n) => [n.id, mm3(n.pos)]);
    expect(corners.slice(0, 6)).toEqual([
      ["hall", [-1.15, 0, 6.35]],
      ["registry", [1.15, -2.7, 6.85]],
      ["hall", [-2.55, 0, 6.65]],
      ["hall", [-2.55, 0, 11.35]],
      ["landing", [-2.55, -2.7, 6.65]],
      ["landing", [-2.55, -2.7, 11.35]],
    ]);
    // Then the solid props' corners, prop by prop: the coat rack keeps only
    // the one inside the hall; the ping-pong table all four.
    expect(corners.slice(6, 8)).toEqual([
      ["mudroom", [-0.9, 0, 1.4]], // the bench's south-east (the boot rack has none inside the room)
      ["hall", [-0.4, 0, 3.7]], // the coat rack's south-east
    ]);
    const pingPong = propObstacle(show.props.find((p) => p.id === "ping-pong")!);
    expect(pingPong).toEqual([0.63, 8.2375, 3.87, 10.2625]);
    expect(corners.filter(([id]) => id === "registry").slice(2, 6)).toEqual([
      ["registry", [0.28, -2.7, 7.888]],
      ["registry", [4.22, -2.7, 7.888]],
      ["registry", [4.22, -2.7, 10.612]],
      ["registry", [0.28, -2.7, 10.612]],
    ]);
  });

  it("skirts the stair hole, then the ramp below it", () => {
    const hole = fixture("hole");
    // Across the hole: round its east corners (shorter than the west).
    expect(path(hole, [3, 0, 0.5], [3, 0, 3.5])).toEqual([
      [3, 0, 0.5],
      [4.35, 0, 0.65],
      [4.35, 0, 2.35],
      [3, 0, 3.5],
    ]);
    // Round the hole, then the L's inner corner.
    expect(path(hole, [3, 0, 0.5], [2.5, 0, 5.5])).toEqual([
      [3, 0, 0.5],
      [4.35, 0, 0.65],
      [4.35, 0, 2.35],
      [2.65, 0, 3.65],
      [2.5, 0, 5.5],
    ]);
    // Down: to the head round the hole's corner, foot, then round the ramp.
    expect(path(hole, [3, 0, 0.5], [4.5, -3, 3.5])).toEqual([
      [3, 0, 0.5],
      [4.35, 0, 0.65],
      [4, 0, 1.5],
      [1, -3, 1.5],
      [0.65, -3, 2.35],
      [4.5, -3, 3.5],
    ]);
  });

  it("ignores the obstacle someone is standing on", () => {
    const hole = fixture("hole");
    expect(locate(hole, [2.5, -0.8, 1.5]).room).toBe("hall");
    expect(path(hole, [2.5, -0.8, 1.5], [3, 0, 3.5])).toEqual([
      [2.5, -0.8, 1.5],
      [3, 0, 3.5],
    ]);
  });
});

describe("route — solid props are obstacles", () => {
  const house = fixture("props");

  it("bounds a prop's yawed footprint, grown by the body radius, never shrunk", () => {
    const byId = (id: string) => house.props.find((p) => p.id === id)!;
    // A 2 × 1 table yawed 30°: half extents 1·cos 30 + 0.5·sin 30, 1·sin 30 + 0.5·cos 30.
    expect(propObstacle(byId("table"))).toEqual([1.633975, 1.816987, 4.366025, 4.183013]);
    // A cylinder: its radius box.
    expect(propObstacle(byId("pillar"))).toEqual([5.45, 0.65, 6.55, 1.75]);
    expect(PROP_MARGIN).toBe(0.25);
    // Stairs first (none here), then the room's solid props in array order —
    // the rug (solid: false) and the lamp (a screen) are not obstacles, the
    // nook's stool belongs to the nook.
    expect(roomObstacles(house, "parlour")).toEqual(
      ["table", "pillar", "crate-a", "crate-b"].map((id) => propObstacle(byId(id))),
    );
    expect(roomObstacles(house, "nook")).toEqual([propObstacle(byId("stool"))]);
  });

  it("adds each solid prop's outer corners, inside the room and clear of every other obstacle", () => {
    const corners = routeNodes(house)
      .filter((n) => n.kind === "corner")
      .map((n) => [n.id, mm3(n.pos)]);
    expect(corners).toEqual([
      // table (yawed — its bounds' corners, 0.35 m further out along each axis)
      ["parlour", [1.284, 0, 1.467]],
      ["parlour", [4.716, 0, 1.467]],
      ["parlour", [4.716, 0, 4.533]],
      ["parlour", [1.284, 0, 4.533]],
      // pillar
      ["parlour", [5.1, 0, 0.3]],
      ["parlour", [6.9, 0, 0.3]],
      ["parlour", [6.9, 0, 2.1]],
      ["parlour", [5.1, 0, 2.1]],
      // crate-a: its south-east corner falls inside crate-b's obstacle
      ["parlour", [5.1, 0, 3.4]],
      ["parlour", [7.3, 0, 3.4]],
      ["parlour", [5.1, 0, 5.6]],
      // crate-b: north-west inside crate-a's, the southern pair outside the room
      ["parlour", [7.8, 0, 4.4]],
      // stool
      ["nook", [8.1, 0, 2.2]],
      ["nook", [9.7, 0, 2.2]],
      ["nook", [9.7, 0, 3.8]],
      ["nook", [8.1, 0, 3.8]],
    ]);
  });

  it("walks round a prop instead of through it", () => {
    expect(visibleIn(house, house.rooms[0]!, house.spawn.pos, [3, 0, 5.2])).toBe(false);
    expect(path(house, house.spawn.pos, [3, 0, 5.2])).toEqual([
      [0.5, 0, 1.5],
      [1.284, 0, 4.533],
      [3, 0, 5.2],
    ]);
    // Past the door, round the stool.
    expect(path(house, [7.5, 0, 3], [10.5, 0, 3])).toEqual([
      [7.5, 0, 3],
      [8, 0, 3],
      [8.1, 0, 2.2],
      [9.7, 0, 2.2],
      [10.5, 0, 3],
    ]);
  });

  it("ignores the prop an end stands on (the duck on the table)", () => {
    expect(path(house, house.spawn.pos, [3, 0.75, 3])).toEqual([
      [0.5, 0, 1.5],
      [3, 0.75, 3],
    ]);
  });
});

describe("route — the show's map never walks through a wall", () => {
  const house = loadHouse(SHOW_HOUSE);
  const walls = buildWalls(house).filter((w) => w.kind === "wall" || w.kind === "rail" || w.kind === "fence");
  const HEAD = 1.8;

  /** Strictly inside a prop's footprint (by more than 1 mm). */
  function inPropInterior(prop: Prop, q: Vec2): boolean {
    const [w, , d] = prop.size;
    const rx = q[0] - prop.pos[0];
    const rz = q[1] - prop.pos[2];
    if (prop.kind === "cylinder") return Math.hypot(rx, rz) < Math.max(w, d) / 2 - 1e-3;
    const r = ((prop.yaw ?? 0) * Math.PI) / 180;
    const lx = rx * Math.cos(r) - rz * Math.sin(r);
    const lz = rx * Math.sin(r) + rz * Math.cos(r);
    return Math.abs(lx) < w / 2 - 1e-3 && Math.abs(lz) < d / 2 - 1e-3;
  }

  /**
   * Every leg of `p` on one floor that crosses a wall / rail / fence below
   * head height, a stair hole, or the interior of a solid prop's footprint
   * (other than a prop whose footprint holds one of the leg's ends).
   */
  function badLegs(p: Vec3[]): string[] {
    const out: string[] = [];
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1]!;
      const b = p[i]!;
      const fa = locate(house, a).floor;
      if (fa !== locate(house, b).floor) continue; // the stair leg
      const elevation = house.floors.find((f) => f.id === fa)!.elevation;
      const pa: Vec2 = [a[0], a[2]];
      const pb: Vec2 = [b[0], b[2]];
      for (const w of walls) {
        if (w.floor !== fa || w.bottom >= elevation + HEAD) continue;
        const s: Vec2 = w.axis === "x" ? [w.lo, w.c] : [w.c, w.lo];
        const e: Vec2 = w.axis === "x" ? [w.hi, w.c] : [w.c, w.hi];
        if (properlyCross(pa, pb, s, e)) out.push(`${JSON.stringify(mm3(a))}→${JSON.stringify(mm3(b))} × ${w.kind} ${w.axis}=${w.c}`);
      }
      const floorOfRoom = (id: string) => house.rooms.find((r) => r.id === id)?.floor;
      for (const s of house.stairs) {
        if (floorOfRoom(s.to) !== fa && floorOfRoom(s.from) !== fa) continue;
        const [x0, z0, x1, z1] = s.rect;
        if (segmentHitsRect(pa, pb, [x0 + 0.01, z0 + 0.01, x1 - 0.01, z1 - 0.01])) {
          out.push(`${JSON.stringify(mm3(a))}→${JSON.stringify(mm3(b))} × stair`);
        }
      }
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      const steps = Math.max(1, Math.ceil(len / 0.01));
      for (const prop of house.props) {
        if (!propSolid(prop) || floorOfRoom(prop.room) !== fa) continue;
        if (inPropFootprint(prop, pa) || inPropFootprint(prop, pb)) continue;
        for (let k = 1; k < steps; k++) {
          const f = k / steps;
          if (inPropInterior(prop, [pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f])) {
            out.push(`${JSON.stringify(mm3(a))}→${JSON.stringify(mm3(b))} × prop ${prop.id}`);
            break;
          }
        }
      }
    }
    return out;
  }

  it("catches the straight legs the portal chain used to draw", () => {
    // Tent flap → furnace through the tent's south wall.
    expect(badLegs([[1.5, -2.7, 4.5], [4.6, -2.7, 11.5]]).some((l) => l.includes("wall"))).toBe(true);
    // Stair head → hall end across the hole's east rail.
    expect(badLegs([[-3.4, 0, 7], [-0.6, 0, 11.6]]).some((l) => l.includes("rail"))).toBe(true);
    // Tent flap → furnace straight over the ping-pong table (the round-the-tent leg).
    expect(badLegs([[1.15, -2.7, 6.85], [4.6, -2.7, 11.5]])).toEqual(["[1.15,-2.7,6.85]→[4.6,-2.7,11.5] × prop ping-pong"]);
  });

  it("from the spawn to every duck spot", () => {
    for (const s of house.duck.spots) {
      const p = route(house, house.spawn.pos, s.pos);
      expect(p.length, s.id).toBeGreaterThan(2);
      expect(badLegs(p), s.id).toEqual([]);
    }
  });

  it("from every room's label point to every duck spot", () => {
    for (const room of house.rooms) {
      const [x, z] = labelPoint(room.poly);
      const from: Vec3 = [x, house.floors.find((f) => f.id === room.floor)!.elevation, z];
      expect(locate(house, from).room, room.id).toBe(room.id);
      for (const s of house.duck.spots) expect(badLegs(route(house, from, s.pos)), `${room.id} → ${s.id}`).toEqual([]);
    }
  });

  it("walks round the tent, then round the ping-pong table, to the furnace", () => {
    expect(path(house, [1.5, -2.7, 4.5], [4.6, -2.7, 11.5])).toEqual([
      [1.5, -2.7, 4.5],
      [1.15, -2.7, 6.85],
      [4.22, -2.7, 7.888], // the table's north-east corner waypoint
      [4.6, -2.7, 11.5],
    ]);
  });
});
