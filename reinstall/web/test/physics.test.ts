import { describe, expect, it } from "vitest";
import { locate, standable, withFallenKings } from "@loom/house";
import type { HouseMap, Prop, Vec3 } from "@loom/house";
import {
  blocksAt,
  bodyAfterRemap,
  buildPhysicsWorld,
  MAX_PITCH,
  move,
  NO_INPUT,
  planAxes,
  RADIUS,
  RUN_FACTOR,
  spawnBody,
  TURN_RATE,
  WALK_SPEED,
  type Body,
  type MoveInput,
  type PhysicsWorld,
} from "../src/game/physics.ts";
import { SHOW, SHOW_SHED, THREE_FLOOR, STAIR, TWO_ROOMS } from "./houses.ts";

const FORWARD: MoveInput = { ...NO_INPUT, move: [0, 1] };
const DT = 1 / 60;
// Yaw: 0 = north, 90 = west, −90 = east, 180 = south.
const EAST = -90;
const WEST = 90;
const SOUTH = 180;

const body = (p: Vec3, yaw: number): Body => ({ p, yaw, pitch: 0, vy: 0 });

/** Run `seconds` of 60 Hz frames; `each` sees every intermediate body. */
function walk(world: PhysicsWorld, b: Body, seconds: number, input: MoveInput = FORWARD, each?: (b: Body) => void): Body {
  let cur = b;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    cur = move(cur, input, DT, world);
    each?.(cur);
  }
  return cur;
}

describe("physics — the frame", () => {
  it("forward / right follow the house yaw (0 = north, + = left)", () => {
    const [f0, r0] = planAxes(0);
    expect(f0[0]).toBeCloseTo(0);
    expect(f0[1]).toBeCloseTo(-1);
    expect(r0[0]).toBeCloseTo(1);
    const [f90, r90] = planAxes(WEST);
    expect(f90[0]).toBeCloseTo(-1);
    expect(r90[1]).toBeCloseTo(-1); // facing west, right is north
  });

  it("walks at 1.8 m/s and runs ×1.6", () => {
    const world = buildPhysicsWorld(TWO_ROOMS());
    const a = walk(world, body([0.5, 0, 0.5], EAST), 1);
    expect(a.p[0] - 0.5).toBeCloseTo(WALK_SPEED, 5);
    const b = walk(world, body([0.5, 0, 0.5], EAST), 0.5, { ...FORWARD, run: true });
    expect(b.p[0] - 0.5).toBeCloseTo(WALK_SPEED * RUN_FACTOR * 0.5, 5);
  });

  it("turns right with + turn, looks up with + look, and clamps the pitch", () => {
    const world = buildPhysicsWorld(TWO_ROOMS());
    const b = walk(world, body([2, 0, 0.5], 0), 0.5, { ...NO_INPUT, turn: 1 });
    expect(b.yaw).toBeCloseTo(-TURN_RATE * 0.5, 5);
    const up = walk(world, body([2, 0, 0.5], 0), 5, { ...NO_INPUT, look: 1 });
    expect(up.pitch).toBe(MAX_PITCH);
    const dragged = move(body([2, 0, 0.5], 170), { ...NO_INPUT, dragYaw: -20 }, DT, world);
    expect(dragged.yaw).toBeCloseTo(-170, 5); // wrapped into [−180, 180)
  });

  it("stands a spawn on the floor under it", () => {
    const house = STAIR();
    const b = spawnBody(house, { pos: [4.5, 0.3, 3.5], yaw: 30 });
    expect(b.p).toEqual([4.5, 0, 3.5]);
    expect(b.yaw).toBe(30);
  });
});

describe("physics — walls", () => {
  it("a wall blocks at the body's radius", () => {
    const world = buildPhysicsWorld(TWO_ROOMS());
    // z 0.5 is clear of the a↔b door (z 1…2): the wall at x = 4 stops us.
    const b = walk(world, body([2, 0, 0.5], EAST), 3);
    expect(b.p[0]).toBeLessThanOrEqual(4 - RADIUS + 1e-6);
    expect(b.p[0]).toBeGreaterThan(4 - RADIUS - 0.01);
    expect(locate(world.house, b.p).room).toBe("a");
  });

  it("walking into a wall at an angle slides along it", () => {
    const world = buildPhysicsWorld(TWO_ROOMS());
    // South-east into the south wall (z = 3).
    const b = walk(world, body([0.5, 0, 2], -135), 1);
    expect(b.p[2]).toBeCloseTo(3 - RADIUS, 3);
    // Blocked dead it would stay near x 1.0; sliding keeps going east.
    expect(b.p[0]).toBeGreaterThan(1.5);
  });

  it("a doorway passes (under its lintel) into the next room", () => {
    const world = buildPhysicsWorld(TWO_ROOMS());
    expect(world.blockers.length).toBeGreaterThan(0);
    const b = walk(world, body([2, 0, 1.5], EAST), 2);
    expect(b.p[0]).toBeGreaterThan(5);
    expect(locate(world.house, b.p).room).toBe("b");
  });

  it("an open front door leads nowhere: the outside isn't walkable", () => {
    const world = buildPhysicsWorld(TWO_ROOMS());
    const b = walk(world, body([2, 0, 1], 0), 3); // north, through the gap at z = 0
    expect(b.p[2]).toBeGreaterThanOrEqual(0);
    expect(locate(world.house, b.p).room).toBe("a");
  });

  it("never tunnels: not at 60 Hz running, not through one huge frame", () => {
    const world = buildPhysicsWorld(TWO_ROOMS());
    walk(world, body([2, 0, 0.5], EAST), 4, { ...FORWARD, run: true }, (b) => expect(b.p[0]).toBeLessThanOrEqual(4 - RADIUS + 1e-6));
    let b = body([3.5, 0, 0.5], EAST);
    for (let i = 0; i < 20; i++) b = move(b, { ...FORWARD, run: true }, 5, world);
    expect(b.p[0]).toBeLessThanOrEqual(4 - RADIUS + 1e-6);
  });

  it("solid props block as boxes and discs; non-solid ones don't", () => {
    const base = TWO_ROOMS();
    const crate: Prop = { id: "crate", room: "a", kind: "box", pos: [2, 0, 1.5], size: [1, 1, 1] };
    const drum: Prop = { id: "drum", room: "a", kind: "cylinder", pos: [2, 0, 1.5], size: [1, 1, 1] };
    const sign: Prop = { id: "sign", room: "a", kind: "box", pos: [2, 0, 1.5], size: [1, 1, 1], solid: false };
    const at = (props: Prop[]): number => walk(buildPhysicsWorld({ ...base, props } as HouseMap), body([0.5, 0, 1.5], EAST), 2).p[0];
    expect(at([crate])).toBeCloseTo(1.5 - RADIUS, 3);
    expect(at([drum])).toBeCloseTo(1.5 - RADIUS, 3);
    expect(at([sign])).toBeGreaterThan(3);
  });

  it("a rotated box blocks along its own faces", () => {
    const base = TWO_ROOMS();
    // A 2 m × 0.2 m bench turned 90°: it runs north–south across our path.
    const bench: Prop = { id: "bench", room: "a", kind: "box", pos: [2, 0, 1.5], size: [2, 0.5, 0.2], yaw: 90 };
    const b = walk(buildPhysicsWorld({ ...base, props: [bench] } as HouseMap), body([0.5, 0, 1.5], EAST), 2);
    expect(b.p[0]).toBeCloseTo(2 - 0.1 - RADIUS, 3);
  });

  it("only blockers spanning the body count (a lintel overhead doesn't)", () => {
    expect(blocksAt(2.0, 2.5, 0)).toBe(false); // a lintel over a 1.7 m body
    expect(blocksAt(0, 1, 0)).toBe(true); // a rail
    expect(blocksAt(0, 0.04, 0)).toBe(false); // a lip the feet step over
    expect(blocksAt(0, 2.5, -3)).toBe(false); // a wall a whole floor up
  });
});

describe("physics — stairs", () => {
  it("climbs the ramp from the cellar into the hall", () => {
    const world = buildPhysicsWorld(STAIR());
    let peak = -Infinity;
    const b = walk(world, body([0.6, -3, 1.5], EAST), 3, FORWARD, (x) => (peak = Math.max(peak, x.p[1])));
    expect(b.p[1]).toBeCloseTo(0, 5);
    expect(peak).toBeLessThanOrEqual(1e-9);
    expect(locate(world.house, b.p)).toEqual({ floor: "upper", room: "hall" });
  });

  it("follows the ramp's height on the way (heightAt)", () => {
    const world = buildPhysicsWorld(STAIR());
    // Half-way up: x 2.5 on a ramp from x 1 (y −3) to x 4 (y 0).
    const b = walk(world, body([0.6, -3, 1.5], EAST), (2.5 - 0.6) / WALK_SPEED);
    expect(Math.abs(b.p[0] - 2.5)).toBeLessThan(0.05);
    expect(b.p[1]).toBeCloseTo(-3 + (b.p[0] - 1), 6); // on the slope, exactly
  });

  it("walks down it again", () => {
    const world = buildPhysicsWorld(STAIR());
    const b = walk(world, body([4.6, 0, 1.5], WEST), 3);
    expect(b.p[1]).toBeCloseTo(-3, 5);
    expect(b.p[0]).toBeCloseTo(RADIUS, 3); // stopped by the cellar's west wall
    expect(locate(world.house, b.p).room).toBe("cellar");
  });

  it("the rails guard the hole on the upper floor", () => {
    const world = buildPhysicsWorld(STAIR());
    // South from the hall's north side onto the hole's north rail (z = 1).
    const b = walk(world, body([2.5, 0, 0.5], SOUTH), 2);
    expect(b.p[2]).toBeLessThanOrEqual(1 - RADIUS + 1e-6);
    expect(b.p[1]).toBe(0);
  });

  it("stepping off a ramp's side mid-way is a fall to the floor below", () => {
    const world = buildPhysicsWorld(STAIR());
    // On the ramp low enough that the hall's rails are overhead, turn north.
    let b = walk(world, body([0.6, -3, 1.5], EAST), (1.6 - 0.6) / WALK_SPEED);
    expect(b.p[1]).toBeGreaterThan(-2.7);
    b = walk(world, { ...b, yaw: 0 }, 1.5);
    expect(b.p[2]).toBeLessThan(1);
    expect(b.p[1]).toBeCloseTo(-3, 5);
    expect(b.vy).toBe(0);
  });
});

describe("physics — the show's house", () => {
  it("the spawn stands on a floor and is clear of every wall", () => {
    const house = THREE_FLOOR();
    const world = buildPhysicsWorld(house);
    const b = spawnBody(house);
    const still = walk(world, b, 0.5, NO_INPUT);
    expect(still.p[0]).toBeCloseTo(b.p[0], 6);
    expect(still.p[2]).toBeCloseTo(b.p[2], 6);
    expect(locate(house, still.p).room).toBe(house.spawn.room);
  });

  it("a stair's side is a wall from the floor below: no walking into the solid under its ramp", () => {
    // basement-stairs: rect [−2.9, 6, −2, 10], ramp −2.7 (z 10) → 0 (z 6).
    const house = THREE_FLOOR();
    const world = buildPhysicsWorld(house);
    const ramp = (z: number) => -2.7 + (2.7 * (10 - z)) / 4;
    for (const z of [8.5, 8, 7.8]) {
      const b = walk(world, body([-1, -2.7, z], WEST), 3, FORWARD, (cur) => {
        // Never under a ramp lower than the top of the head.
        if (cur.p[0] < -2 + 1e-9) expect(ramp(cur.p[2])).toBeGreaterThanOrEqual(cur.p[1] + 1.7);
      });
      expect(b.p[0]).toBeGreaterThan(-2);
      expect(b.p[1]).toBeCloseTo(-2.7, 6);
    }
    // Walking on along the side never slips under it either.
    let b = walk(world, body([-1.4, -2.7, 8.5], WEST), 1);
    b = walk(world, { ...b, yaw: 0 }, 3, FORWARD, (cur) => {
      if (cur.p[0] < -2 + 1e-9) expect(ramp(cur.p[2])).toBeGreaterThanOrEqual(cur.p[1] + 1.7);
    });
  });

  it("the high end of the stair still has head room to walk under", () => {
    const house = THREE_FLOOR();
    const world = buildPhysicsWorld(house);
    const b = walk(world, body([-1, -2.7, 6.5], WEST), 1.5);
    expect(b.p[0]).toBeLessThan(-2);
    expect(b.p[1]).toBeCloseTo(-2.7, 6);
  });

  it("walking under the stair from its high end stops where the ramp comes down to the head", () => {
    // From the basement hall under the hall end (z 6.3, ramp ≈ −0.2),
    // heading south toward the foot: the ramp drops to head height (−1.0)
    // at z ≈ 7.48, and the body (its rim included) never goes past it.
    const house = THREE_FLOOR();
    const world = buildPhysicsWorld(house);
    const ramp = (z: number) => -2.7 + (2.7 * (10 - z)) / 4;
    const b = walk(world, body([-2.4, -2.7, 6.3], SOUTH), 3, FORWARD, (cur) => {
      expect(cur.p[1]).toBeCloseTo(-2.7, 6);
      expect(ramp(cur.p[2] + RADIUS * 0.9)).toBeGreaterThanOrEqual(cur.p[1] + 1.7 - 1e-9);
    });
    expect(b.p[2]).toBeGreaterThan(7);
    expect(b.p[2]).toBeLessThan(7.48);
    // And back out the way it came.
    const back = walk(world, { ...b, yaw: 0 }, 1.5);
    expect(back.p[2]).toBeLessThan(6);
  });

  it("descends the stair from the hall down to the basement hall", () => {
    const house = THREE_FLOOR();
    const world = buildPhysicsWorld(house);
    let lowest = 0;
    const b = walk(world, body([-2.4, 0, 5.5], SOUTH), 4, FORWARD, (cur) => (lowest = Math.min(lowest, cur.p[1])));
    expect(b.p[2]).toBeGreaterThan(10);
    expect(b.p[1]).toBeCloseTo(-2.7, 6);
    expect(lowest).toBeGreaterThanOrEqual(-2.7 - 1e-9);
    expect(locate(house, b.p).room).toBe("basement-hall");
  });

  it("the stair itself still climbs from the basement hall to the hall", () => {
    const house = THREE_FLOOR();
    const world = buildPhysicsWorld(house);
    const b = walk(world, body([-2.4, -2.7, 10.6], 0), 4);
    expect(b.p[2]).toBeLessThan(6);
    expect(b.p[1]).toBeCloseTo(0, 6);
  });

  it("climbs the upstairs from the hall to the top floor, and comes back down", () => {
    // upstairs: rect [0.05, 6, 0.95, 10], rising south, 0 (z 6) → 2.8 (z 10).
    const house = THREE_FLOOR();
    const world = buildPhysicsWorld(house);
    const up = walk(world, body([0.5, 0, 5.5], SOUTH), 4);
    expect(up.p[2]).toBeGreaterThan(10);
    expect(up.p[1]).toBeCloseTo(2.8, 6);
    expect(locate(house, up.p).room).toBe("upstairs-hall");
    const down = walk(world, { ...up, yaw: 0 }, 4);
    expect(down.p[2]).toBeLessThan(6);
    expect(down.p[1]).toBeCloseTo(0, 6);
    expect(locate(house, down.p).room).toBe("hall");
  });
});

describe("physics — a remap (the tent ↔ shed switch)", () => {
  /** Every 0.3 m point `locate` puts in `room` on `on`. */
  function pointsIn(on: HouseMap, room: string): Vec3[] {
    const out: Vec3[] = [];
    for (const r of on.rooms.filter((x) => x.id === room)) {
      const xs = r.poly.map((v) => v[0]);
      const zs = r.poly.map((v) => v[1]);
      for (let x = Math.min(...xs) + 0.15; x < Math.max(...xs); x += 0.3) {
        for (let z = Math.min(...zs) + 0.15; z < Math.max(...zs); z += 0.3) {
          const p: Vec3 = [x, on.floors.find((f) => f.id === r.floor)!.elevation, z];
          if (locate(on, p).room === room) out.push(p);
        }
      }
    }
    return out;
  }
  /** Can a body at `p` walk half a metre in some direction? */
  function canLeave(world: PhysicsWorld, p: Vec3): boolean {
    return [0, EAST, SOUTH, WEST].some((yaw) => {
      const b = walk(world, body(p, yaw), 2);
      return Math.hypot(b.p[0] - p[0], b.p[2] - p[2]) >= 0.5;
    });
  }

  it("a program standing in the shed is put back at the tent map's spawn, never left inside the shed prop", () => {
    const tent = SHOW();
    const shed = SHOW_SHED();
    const world = buildPhysicsWorld(tent);
    const inShed = pointsIn(shed, "shed");
    expect(inShed.length).toBeGreaterThan(40);
    let respawned = 0;
    for (const p of inShed) {
      const after = bodyAfterRemap(tent, body(p, 0));
      if (after.respawned) {
        respawned++;
        expect(after.body.p).toEqual(spawnBody(tent).p);
      }
      // Wherever they end up, they can walk away.
      expect(canLeave(world, after.body.p), `stuck at ${p.join(",")}`).toBe(true);
    }
    expect(respawned).toBeGreaterThan(0);
  });

  it("and the other way: every point of each variant's spawn room is playable on the other variant", () => {
    for (const [from, to] of [
      [SHOW_SHED(), SHOW()],
      [SHOW(), SHOW_SHED()],
    ] as const) {
      const world = buildPhysicsWorld(to);
      const room = from.spawn.room;
      for (const p of pointsIn(from, room)) {
        const after = bodyAfterRemap(to, body(p, 0));
        expect(canLeave(world, after.body.p), `${room} ${p.join(",")} on ${to.name}`).toBe(true);
      }
    }
  });

  it("a fallen King is out of the way: a program on his spot stays put, as the server re-seats (wave 11)", () => {
    for (const house of [SHOW(), SHOW_SHED()]) {
      const king = house.props.find((p) => p.kind === "king")!;
      const onHim = body([king.pos[0], king.pos[1], king.pos[2]], 0);
      // Standing, he is a solid prop: a remap puts them back at the start…
      expect(standable(house, onHim.p), house.name).toBe(false);
      expect(bodyAfterRemap(house, onHim).respawned, house.name).toBe(true);
      // …down, he is not, so the server keeps them there and so do we.
      const fallen = new Set([king.id]);
      expect(standable(withFallenKings(house, fallen), onHim.p), house.name).toBe(true);
      expect(bodyAfterRemap(house, onHim, fallen), house.name).toEqual({ body: onHim, respawned: false });
      // A set naming no king of this map changes nothing.
      expect(bodyAfterRemap(house, onHim, new Set(["no-such-king"])).respawned, house.name).toBe(true);
    }
  });

  it("a body that still stands somewhere stays put (pitch kept on a respawn)", () => {
    const house = SHOW();
    const b = { ...spawnBody(house), pitch: 12 };
    expect(bodyAfterRemap(house, b)).toEqual({ body: b, respawned: false });
    const lost = bodyAfterRemap(house, body([-100, 0, -100], 0));
    expect(lost.respawned).toBe(true);
    expect(lost.body.p).toEqual(spawnBody(house).p);
  });
});

describe("physics — the King in the doorway (the show's map)", () => {
  it("the King's box plugs the server doorway: no way round on either side", () => {
    const house = THREE_FLOOR();
    const door = house.doors.find((d) => d.id === "server-door")!;
    const king = house.props.find((p) => p.id === door.guard)!;
    expect(king.kind).toBe("king");
    // The door's gap on the x = −3 wall spans z 10.8..11.6; try every
    // approach line across it (and a little past the jambs) walking west.
    const world = buildPhysicsWorld(house);
    for (let z = 10.6; z <= 11.8 + 1e-9; z += 0.05) {
      const b = walk(world, body([-1.2, -2.7, z], WEST), 3);
      expect(b.p[0], `z ${z.toFixed(2)}`).toBeGreaterThanOrEqual(-3 + RADIUS - 1e-6);
      expect(locate(house, b.p).room, `z ${z.toFixed(2)}`).toBe("basement-hall");
    }
    // Without him (a fallen king is left out of the world) the same walk goes through.
    const open = buildPhysicsWorld(house, undefined, { omitProps: new Set([king.id]) });
    expect(locate(house, walk(open, body([-1.2, -2.7, 11.2], WEST), 3).p).room).toBe("server-room");
  });
});

describe("physics — the King in the doorway (the show's measured map, wave 14)", () => {
  it("the King's box plugs the server doorway on the basement hall's south wall: no way round on either side", () => {
    const house = SHOW();
    const door = house.doors.find((d) => d.id === "server-door")!;
    const king = house.props.find((p) => p.id === door.guard)!;
    expect(king.kind).toBe("king");
    // The door's gap on the z = 21 wall spans x 3.45..4.35; try every
    // approach line across it (and a little past the jambs) walking south.
    const world = buildPhysicsWorld(house);
    for (let x = 3.25; x <= 4.55 + 1e-9; x += 0.05) {
      const b = walk(world, body([x, -2.7, 19.4], SOUTH), 3);
      expect(b.p[2], `x ${x.toFixed(2)}`).toBeLessThanOrEqual(21 - RADIUS + 1e-6);
      expect(locate(house, b.p).room, `x ${x.toFixed(2)}`).toBe("basement-hall");
    }
    // Without him the same walk goes through.
    const open = buildPhysicsWorld(house, undefined, { omitProps: new Set([king.id]) });
    expect(locate(house, walk(open, body([3.9, -2.7, 19.4], SOUTH), 3).p).room).toBe("server-room");
  });
});
