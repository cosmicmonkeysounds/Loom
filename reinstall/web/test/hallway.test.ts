import { describe, expect, it } from "vitest";
import { HALLWAY_DOOR_M, HALLWAY_FAR_M, HALLWAY_MAX_S, HALLWAY_RETREAT, HALLWAY_RETREAT_S, HALLWAY_WIDTH_M, buildWalls } from "@loom/house";
import { createDoor, HALL_FAR_LINE_S, HALL_LENGTH_M, HALL_Y, Hallway, hallwayMap, HallwayWalk } from "../src/game/hallway.ts";
import { buildPhysicsWorld, move, NO_INPUT, RUN_FACTOR, WALK_SPEED } from "../src/game/physics.ts";

const FORWARD = { move: [0, 1] as [number, number], turn: 0, look: 0, run: false };
const RUN = { ...FORWARD, run: true };

/** Walk the far door to a stop at `speed` m/s, `dt` frames; the seconds it took. */
function walkOut(speed: number, dt = 1 / 30): { s: number; end: string } {
  const w = new HallwayWalk();
  let z = 0;
  for (let i = 0; i < 100_000; i++) {
    z -= speed * dt;
    const r = w.step(dt, z);
    if (r.end !== null) return { s: w.s, end: r.end };
  }
  throw new Error("still walking");
}

describe("the far door", () => {
  it("backs away at HALLWAY_RETREAT × their pace for HALLWAY_RETREAT_S, then stays", () => {
    const w = new HallwayWalk();
    w.step(10, -10);
    expect(w.farZ).toBeCloseTo(-HALLWAY_FAR_M - 10 * HALLWAY_RETREAT);
    w.step(HALLWAY_RETREAT_S - 10 + 0.1, -10);
    const held = w.farZ;
    w.step(1, -20);
    expect(w.farZ).toBe(held);
  });

  it("gives no ground back when they retreat", () => {
    const w = new HallwayWalk();
    w.step(1, -5);
    const at = w.farZ;
    w.step(1, 0);
    expect(w.farZ).toBe(at);
  });

  it("is reached in about half a minute at a walk, and a run is no faster to the same place", () => {
    const walking = walkOut(WALK_SPEED);
    expect(walking.end).toBe("reached");
    expect(walking.s).toBeGreaterThan(HALLWAY_RETREAT_S);
    expect(walking.s).toBeLessThan(40);
    expect(walkOut(WALK_SPEED * RUN_FACTOR).end).toBe("reached");
  });

  it("the corridor is long enough for a runner to reach it", () => {
    const w = new HallwayWalk();
    w.step(HALLWAY_RETREAT_S, -WALK_SPEED * RUN_FACTOR * HALLWAY_RETREAT_S);
    expect(-w.farZ).toBeLessThan(HALL_LENGTH_M);
  });

  it("says its far line once, part way", () => {
    const w = new HallwayWalk();
    const said: number[] = [];
    for (let i = 0; i < 300; i++) if (w.step(0.1, 0).far) said.push(w.s);
    expect(said.length).toBe(1);
    expect(said[0]).toBeCloseTo(HALL_FAR_LINE_S, 0);
  });
});

describe("nobody is stuck", () => {
  it("HALLWAY_MAX_S lets a player go who never moves", () => {
    const w = new HallwayWalk();
    let end: string | null = null;
    for (let i = 0; i < 2000 && end === null; i++) end = w.step(0.05, 0).end;
    expect(end).toBe("timeout");
    expect(w.s).toBeCloseTo(HALLWAY_MAX_S, 0);
  });

  it("nor one who walks up and down", () => {
    const w = new HallwayWalk();
    let z = 0;
    let end: string | null = null;
    for (let i = 0; i < 2000 && end === null; i++) {
      z = -3 * Math.abs(Math.sin(i * 0.02));
      end = w.step(0.05, z).end;
    }
    expect(end).toBe("timeout");
  });

  it("a picture that comes up from black and goes down to it at the door", () => {
    const w = new HallwayWalk();
    expect(w.light).toBe(0);
    w.step(2, 0);
    expect(w.light).toBe(1);
    w.farZ = -HALLWAY_DOOR_M;
    w.step(0.01, 0);
    expect(w.light).toBe(0);
  });
});

describe("the pocket", () => {
  it("is a one-room map a body can walk the length of", () => {
    const map = hallwayMap();
    const world = buildPhysicsWorld(map, buildWalls(map));
    let b = { p: [0, HALL_Y, 0] as [number, number, number], yaw: 0, pitch: 0, vy: 0 };
    for (let i = 0; i < 600; i++) b = move(b, RUN, 0.05, world);
    expect(b.p[1]).toBe(HALL_Y);
    expect(b.p[2]).toBeLessThan(-70);
    expect(b.p[0]).toBeCloseTo(0);
  });

  it("the walls are the walls: sideways stops at the width", () => {
    const map = hallwayMap();
    const world = buildPhysicsWorld(map, buildWalls(map));
    let b = { p: [0, HALL_Y, -5] as [number, number, number], yaw: 90, pitch: 0, vy: 0 };
    for (let i = 0; i < 100; i++) b = move(b, FORWARD, 0.05, world);
    expect(Math.abs(b.p[0])).toBeLessThan(HALLWAY_WIDTH_M / 2);
  });

  it("nothing behind them: the way they came is a wall", () => {
    const map = hallwayMap();
    const world = buildPhysicsWorld(map, buildWalls(map));
    let b = { p: [0, HALL_Y, 0] as [number, number, number], yaw: 180, pitch: 0, vy: 0 };
    for (let i = 0; i < 100; i++) b = move(b, FORWARD, 0.05, world);
    expect(b.p[2]).toBeLessThan(0.6);
  });

  it("builds under node, walks, squeezes, and frees itself", () => {
    const h = new Hallway();
    expect(h.object.visible).toBe(false);
    h.enter(20, -5);
    expect(h.object.visible).toBe(true);
    expect(h.body.yaw).toBe(20);
    const step = h.update(0.05, NO_INPUT);
    expect(step.end).toBeNull();
    const l = h.light();
    expect(l.pos[1]).toBeGreaterThan(HALL_Y);
    expect(l.intensity).toBeGreaterThan(0);
    h.leave();
    expect(h.object.visible).toBe(false);
    h.dispose();
  });

  it("a door is the model's, with something red under it", () => {
    const d = createDoor();
    d.setOpacity(0.5);
    expect(d.object.children.length).toBeGreaterThanOrEqual(3);
    d.dispose();
  });
});
