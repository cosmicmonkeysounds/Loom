import { describe, expect, it } from "vitest";
import { doorGap, locate } from "@loom/house";
import type { Vec3 } from "@loom/house";
import { buildPhysicsWorld, move, NO_INPUT, RADIUS, type Body, type MoveInput, type PhysicsWorld } from "../src/game/physics.ts";
import { THREE_FLOOR, TWO_ROOMS } from "./houses.ts";

const FORWARD: MoveInput = { ...NO_INPUT, move: [0, 1] };
const WEST = 90;
const body = (p: Vec3, yaw: number): Body => ({ p, yaw, pitch: 0, vy: 0 });
const walk = (world: PhysicsWorld, b: Body, seconds: number): Body => {
  let cur = b;
  for (let i = 0; i < Math.round(seconds * 60); i++) cur = move(cur, FORWARD, 1 / 60, world);
  return cur;
};

describe("a guarded door as a wall", () => {
  const house = THREE_FLOOR();
  const door = house.doors.find((d) => d.id === "server-door")!;
  const king = house.props.find((p) => p.id === door.guard)!;
  // Start in the basement hall, just east of the King, facing west through the door at x = −3.
  const start = (): Body => body([-1.4, -2.7, 11.2], WEST);

  it("a closed guarded door is a wall: walking west through server-door stops at the gap (king omitted, door shut)", () => {
    const world = buildPhysicsWorld(house, undefined, { omitProps: new Set([king.id]), closedDoors: new Set([door.id]) });
    const b = walk(world, start(), 3);
    const gap = doorGap(house, door)!;
    expect(gap.axis).toBe("z");
    expect(b.p[0]).toBeCloseTo(gap.c + RADIUS, 2);
    expect(locate(house, b.p).room).toBe("basement-hall");
  });

  it("with the king standing (the default world) the body stops east of him, never in the doorway", () => {
    const world = buildPhysicsWorld(house, undefined, { closedDoors: new Set([door.id]) });
    const b = walk(world, start(), 3);
    expect(b.p[0]).toBeGreaterThan(king.pos[0] + king.size[0] / 2 + RADIUS - 0.01);
    expect(locate(house, b.p).room).toBe("basement-hall");
  });

  it("with the king omitted and the door open the body passes into the Server Room", () => {
    const world = buildPhysicsWorld(house, undefined, { omitProps: new Set([king.id]) });
    const b = walk(world, start(), 3);
    expect(b.p[0]).toBeLessThan(-3 - RADIUS);
    expect(locate(house, b.p).room).toBe("server-room");
  });

  it("a map without guards builds the same blockers as before", () => {
    const plain = TWO_ROOMS();
    expect(buildPhysicsWorld(plain, undefined, {})).toEqual(buildPhysicsWorld(plain));
    expect(buildPhysicsWorld(plain, undefined, { closedDoors: new Set(), omitProps: new Set() })).toEqual(buildPhysicsWorld(plain));
    // Shutting a door that is not on the map changes nothing either.
    expect(buildPhysicsWorld(plain, undefined, { closedDoors: new Set(["nope"]) })).toEqual(buildPhysicsWorld(plain));
    // Shutting the front door adds exactly one blocker: its gap.
    const shut = buildPhysicsWorld(plain, undefined, { closedDoors: new Set(["front"]) });
    expect(shut.blockers.length).toBe(buildPhysicsWorld(plain).blockers.length + 1);
    const gap = doorGap(plain, plain.doors.find((d) => d.id === "front")!)!;
    expect(shut.blockers[shut.blockers.length - 1 - plain.props.length]).toEqual({ kind: "segment", a: [gap.lo, gap.c], b: [gap.hi, gap.c], bottom: gap.bottom, top: gap.top });
  });
});
