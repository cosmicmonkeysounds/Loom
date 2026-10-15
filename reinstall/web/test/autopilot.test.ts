//! The walker reaches Gerald everywhere: an autopilot steers the real
//! `move()` physics along `trail()` — exactly the chevrons a player follows —
//! from the spawn to every duck spot, with nothing but the inputs a player
//! has (turn + walk forward). It catches a map the trail can be drawn on
//! but a body can't walk (a door too narrow at its radius, a stair it can't
//! climb, a rail across the way), two flights in a row on a three-floor
//! house, and a player who has wandered under a stair's high end.

import { describe, expect, it } from "vitest";
import { floorOf, locate, route } from "@loom/house";
import type { DuckSpot, HouseMap, Vec3 } from "@loom/house";
import { withinReach } from "../src/game/hud.ts";
import { stairAbove, stairUnder, trail } from "../src/game/trail.ts";
import { buildPhysicsWorld, move, spawnBody, type Body, type MoveInput } from "../src/game/physics.ts";
import { SHOW, THREE_FLOORS, TWO_FLOOR } from "./houses.ts";

const DT = 1 / 30;
const LIMIT_S = 240;

const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

/** Steer at the route's next waypoint; returns the seconds it took (or null). */
function autopilot(house: HouseMap, from: Body, duck: DuckSpot): { seconds: number | null; at: Vec3; floors: Set<string> } {
  const world = buildPhysicsWorld(house);
  let body = from;
  const floors = new Set<string>();
  for (let t = 0; t < LIMIT_S; t += DT) {
    floors.add(floorOf(house, body.p[1]));
    if (withinReach(house, body.p, duck)) return { seconds: t, at: body.p, floors };
    const path = trail(house, body.p, duck.pos);
    // A waypoint the body stands on is behind it.
    let next = path[1]!;
    if (path.length > 2 && Math.hypot(next[0] - body.p[0], next[2] - body.p[2]) < 0.15) next = path[2]!;
    const want = (Math.atan2(-(next[0] - body.p[0]), -(next[2] - body.p[2])) * 180) / Math.PI;
    const delta = wrap(want - body.yaw);
    const input: MoveInput = { move: [0, Math.abs(delta) < 25 ? 1 : 0], turn: Math.max(-1, Math.min(1, -delta / 15)), look: 0, run: false };
    body = move(body, input, DT, world);
  }
  return { seconds: null, at: body.p, floors };
}

function everySpot(name: string, load: () => HouseMap) {
  describe(`autopilot — ${name}`, () => {
    const house = load();
    for (const spot of house.duck.spots) {
      it(`walks from the spawn to ${spot.id}`, () => {
        const r = autopilot(house, spawnBody(house), spot);
        expect(r.seconds, `stuck at ${r.at.map((v) => v.toFixed(2)).join(", ")} (${locate(house, r.at).room})`).not.toBeNull();
      });
    }
  });
}

everySpot("the show's house", SHOW);
everySpot("three floors", THREE_FLOORS);

describe("autopilot — three floors, both flights", () => {
  it("the basement → top trip climbs both flights and passes the main floor", () => {
    const house = THREE_FLOORS();
    const start: Body = { p: [0.6, -2.7, 0.6], yaw: 0, pitch: 0, vy: 0 };
    const r = autopilot(house, start, house.duck.spots.find((s) => s.id === "crawl-box")!);
    expect(r.seconds).not.toBeNull();
    expect([...r.floors].sort()).toEqual(["basement", "main", "top"]);
  });

  it("and back down from the top floor to the basement", () => {
    const house = THREE_FLOORS();
    const start: Body = { p: [11, 2.8, 7], yaw: 0, pitch: 0, vy: 0 };
    const r = autopilot(house, start, house.duck.spots.find((s) => s.id === "server-rack")!);
    expect(r.seconds).not.toBeNull();
    expect(r.at[1]).toBeCloseTo(-2.7, 6);
  });
});

describe("trail — on a stair", () => {
  // The wave-2 show map's basement stair (frozen as TWO_FLOOR): rect
  // [−3.9, 7, −2.9, 11], foot (−3.4, −2.7, 11) in the landing, head
  // (−3.4, 0, 7) in the hall.
  const house = TWO_FLOOR();
  const hallEnd = house.duck.spots.find((s) => s.id === "hall-end")!.pos;
  const landingFoot = house.duck.spots.find((s) => s.id === "landing-foot")!.pos;

  it("just past the foot on the way up, it points up the flight, never back at the foot", () => {
    const feet: Vec3 = [-3.4, -2.57, 10.8];
    const path = trail(house, feet, hallEnd);
    expect(path[0]).toEqual(feet);
    expect(path[1]).toEqual([-3.4, 0, 7]);
  });

  it("just past the head on the way down, it points down the flight", () => {
    const feet: Vec3 = [-3.4, -0.13, 7.2];
    const path = trail(house, feet, landingFoot);
    expect(path[1]).toEqual([-3.4, -2.7, 11]);
  });

  it("off the stairs it is the plain route", () => {
    const feet: Vec3 = [-2, 0, 4];
    expect(trail(house, feet, hallEnd)).toEqual(route(house, feet, hallEnd));
  });
});

/** Walk straight at `yaw` for `seconds` from `p` (how a player ends up somewhere). */
function walkIn(house: HouseMap, p: Vec3, yaw: number, seconds: number): Body {
  const world = buildPhysicsWorld(house);
  let body: Body = { p, yaw, pitch: 0, vy: 0 };
  for (let t = 0; t < seconds; t += DT) body = move(body, { move: [0, 1], turn: 0, look: 0, run: false }, DT, world);
  return body;
}

describe("autopilot — from under a stair's high end", () => {
  // The physics lets a body walk under a stair's high end; the trail must
  // step it back out sideways, not run it along the underside into the solid.
  const cases: Array<[string, () => HouseMap, Vec3, number]> = [
    // The show's basement stair [−3.9, 7, −2.9, 11] up n, from the landing's east side.
    ["the two-floor house, under the head", TWO_FLOOR, [-2.3, -2.7, 7.2], 90],
    ["the two-floor house, further down", TWO_FLOOR, [-2.3, -2.7, 7.8], 90],
    // `three-floors`' basement stair [4.4, 2.5, 5.4, 6.5] up n, from either side.
    ["three floors, from the west", THREE_FLOORS, [4, -2.7, 2.7], -90],
    ["three floors, from the east", THREE_FLOORS, [5.8, -2.7, 2.7], 90],
    ["three floors, in past the head", THREE_FLOORS, [5, -2.7, 2.1], 180],
  ];
  for (const [name, load, p, yaw] of cases) {
    it(`${name}: reaches every duck`, () => {
      const house = load();
      const start = walkIn(house, p, yaw, 0.6);
      expect(stairAbove(house, start.p), `walked to ${start.p.join(", ")}`).not.toBeNull();
      expect(stairUnder(house, start.p)).toBeNull();
      for (const spot of house.duck.spots) {
        const r = autopilot(house, start, spot);
        expect(r.seconds, `${spot.id}: stuck at ${r.at.map((v) => v.toFixed(2)).join(", ")} (${locate(house, r.at).room})`).not.toBeNull();
      }
    });
  }
});

describe("stairUnder — on the ramp, not merely over its rect", () => {
  const house = THREE_FLOORS();
  const flight = house.stairs.find((s) => s.id === "basement-stairs")!;

  it("on the ramp, within a step of its surface", () => {
    expect(stairUnder(house, [4.9, -2.7, 6.4])).toBe(flight); // at the foot
    expect(stairUnder(house, [4.9, -1.35, 4.5])).toBe(flight); // half way up
    expect(stairUnder(house, [4.9, 0, 2.6])).toBe(flight); // at the head
  });

  it("under the high end it is the stair above, not the one underfoot", () => {
    const under: Vec3 = [4.9, -2.7, 3];
    expect(stairUnder(house, under)).toBeNull();
    expect(stairAbove(house, under)).toBe(flight);
    // So the trail steps out of the nearer side first (x 4.4 − 0.35), not along the underside to the foot.
    const out = trail(house, under, house.duck.spots.find((s) => s.id === "bath1-tub")!.pos)[1]!;
    expect(out[0]).toBeCloseTo(4.05, 9);
    expect([out[1], out[2]]).toEqual([-2.7, 3]);
  });

  it("two flights over one plan point: the one whose surface is at the feet", () => {
    // `validateHouse` refuses a stacked stairwell, but the trail shouldn't
    // depend on it: put the upper flight over the lower one by hand.
    const stacked = THREE_FLOORS();
    const upper = stacked.stairs.find((s) => s.id === "upstairs")!;
    upper.rect = [4.4, 2.5, 5.4, 6.5];
    upper.up = "n";
    // On the upper flight's foot (main floor, y 0) and half way up it (y 1.4).
    expect(stairUnder(stacked, [4.9, 0, 6.4])?.id).toBe("upstairs");
    expect(stairUnder(stacked, [4.9, 1.4, 4.5])?.id).toBe("upstairs");
    // On the lower flight beneath it.
    expect(stairUnder(stacked, [4.9, -1.35, 4.5])?.id).toBe("basement-stairs");
  });
});
