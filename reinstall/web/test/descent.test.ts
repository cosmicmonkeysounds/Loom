import { describe, expect, it, vi } from "vitest";
import { ALICE_BIG, ALICE_EASE_S, ALICE_SMALL, DESCENT_LATE_S, HALLWAY_DOOR_M, TALK_LEAVE_M, VISION_S, descentLook, descentPlan, parseDescent, validateHouse } from "@loom/house";
import type { DescentScript, HouseMap, Prop, Vec3, VisionKind } from "@loom/house";
import { aliceAt, atDoor, Director, envelope, faceSides, flickerAt, FollowerSteps, foundLine, gradeOf, KING_HOLD_M, nearestSide, talkKey, TALK_AGAIN_S, TALK_LINGER_S, TALK_PATIENCE_S, visionLine, wayAhead, WRONG_TINTS, type DirectorHost, type WalkNow } from "../src/game/descent.ts";
import { buildPhysicsWorld } from "../src/game/physics.ts";
import { TWO_ROOMS, SHOW } from "./houses.ts";
import showScript from "../../../core/examples/trapped-in-the-internet/descent.json";

const script = parseDescent(showScript)!;

/** Room a of `TWO_ROOMS` with a stove in it, 2 m from the spawn at (1, 2). */
function house(extra: Partial<Prop>[] = []): HouseMap {
  const h = TWO_ROOMS();
  const props = [{ id: "stove", room: "a", kind: "box", model: "stove", pos: [3, 0, 2], size: [0.6, 0.9, 0.6] }, ...extra];
  const v = validateHouse({ ...h, props });
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("; "));
  return v.house;
}

const at = (x: number, z: number): Vec3 => [x, 0, z];
const now = (feet: Vec3, o: Partial<WalkNow> = {}): WalkNow => ({ feet, yaw: 0, escaping: false, held: false, kingNear: false, ...o });

function setup(level: number, map: HouseMap = house(), told?: Record<string, string>, canDraw: (k: VisionKind) => boolean = () => true) {
  const log: string[] = [];
  const said: string[][] = [];
  const told2: [string, string][] = [];
  let release: (() => void)[] = [];
  const host: DirectorHost = {
    start(kind) {
      if (!canDraw(kind)) return false;
      log.push(`start ${kind}`);
      return true;
    },
    stop: (kind) => void log.push(`stop ${kind}`),
    say(lines) {
      said.push([...lines]);
      return new Promise<void>((r) => release.push(r));
    },
    hush: () => void log.push("hush"),
    tell: (t, m) => void told2.push([t, m]),
    talkChanged: () => {},
    enterHallway: () => void log.push("hallway"),
    mumble: (p) => void log.push(`mumble ${p.id}`),
  };
  const d = new Director({ host, level, seed: "s1", house: map, who: { name: "Excel", visit: level + 1 }, told });
  const flush = async (): Promise<void> => {
    const r = release;
    release = [];
    for (const f of r) f();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { d, log, said, told: told2, flush };
}

/** Run the clock to `until` in 0.1 s frames. */
function run(d: Director, until: number, w: WalkNow): void {
  while (d.time < until - 1e-9) d.tick(0.1, w);
}

const far = at(0.5, 0.5);

describe("the plan runs on the walk's clock", () => {
  it("a level 0 walk has no plan, and nothing ever happens", () => {
    const { d, log } = setup(0);
    d.setScript(script);
    run(d, 300, now(far));
    expect(log).toEqual([]);
    expect(d.run).toBeNull();
    expect(d.awake).toEqual([]);
  });

  it("starts the first beat at its time, one at a time, in the plan's order", () => {
    const plan = descentPlan("s1", 3);
    const { d, log } = setup(3);
    run(d, plan[0]!.at - 0.2, now(far));
    expect(log).toEqual([]);
    run(d, plan[0]!.at + 0.2, now(far));
    expect(log).toEqual([`start ${plan[0]!.vision}`]);
    run(d, plan[0]!.at + VISION_S[plan[0]!.vision] + 0.2, now(far));
    expect(log[1]).toBe(`stop ${plan[0]!.vision}`);
  });

  it("skips a vision that can't be drawn and keeps the rest on time", () => {
    const plan = descentPlan("s1", 2);
    const refused = plan[0]!.vision;
    const { d, log } = setup(2, house(), undefined, (k) => k !== refused);
    run(d, plan[1]!.at + 0.2, now(far));
    expect(log[0]).toBe(`start ${plan[1]!.vision === refused ? plan[2]!.vision : plan[1]!.vision}`);
    expect(d.time).toBeLessThan(plan[1]!.at + 1);
  });
});

describe("the holds", () => {
  const plan = descentPlan("s1", 4);
  const first = plan[0]!;

  for (const [name, hold] of [
    ["an escape", { escaping: true }],
    ["a held walk", { held: true }],
    ["the King within 3 m", { kingNear: true }],
  ] as const) {
    it(`${name} holds a beat, and it plays when it lets go`, () => {
      const { d, log } = setup(4);
      run(d, first.at + 2, now(far, hold));
      expect(log).toEqual([]);
      d.tick(0.1, now(far));
      expect(log).toEqual([`start ${first.vision}`]);
    });
  }

  it("a beat held past DESCENT_LATE_S is dropped, not saved up", () => {
    const { d, log } = setup(4);
    run(d, first.at + DESCENT_LATE_S + 1, now(far, { held: true }));
    d.tick(0.1, now(far));
    expect(log.some((l) => l === `start ${first.vision}`) && plan[1]!.at > first.at + DESCENT_LATE_S + 1).toBe(false);
  });

  it("one vision at a time: the next waits for this one to end", () => {
    const { d, log } = setup(4);
    run(d, first.at + 0.1, now(far));
    const started = (): number => log.filter((l) => l.startsWith("start")).length;
    expect(started()).toBe(1);
    const until = first.at + Math.min(VISION_S[first.vision] - 0.5, plan[1]!.at - first.at);
    run(d, until, now(far));
    expect(started()).toBe(1);
  });

  it("the King is 3 m", () => {
    expect(KING_HOLD_M).toBe(3);
  });
});

describe("a talk", () => {
  const near = at(1.9, 2);

  it("wakes the stove, opens within reach, says its lines, then offers its options", async () => {
    const { d, said, flush } = setup(1);
    d.setScript(script);
    expect(d.awake.map((a) => a.prop.id)).toEqual(["stove"]);
    d.tick(0.1, now(far));
    expect(d.talk).toBeNull();
    d.tick(0.1, now(near));
    expect(d.talk?.stage).toBe("saying");
    expect(said[0]).toEqual(["Psst. Excel.", "You left me on. Last time. You left me on and you walked off."]);
    expect(d.options).toBeNull();
    await flush();
    expect(d.talk?.stage).toBe("choosing");
    expect(d.options).toEqual(["I've never been here.", "What's cooking?", "Sorry."]);
  });

  it("picks an option: tells, moves on, and ends after a node with none", async () => {
    const { d, said, told, flush } = setup(1);
    d.setScript(script);
    d.tick(0.1, now(near));
    await flush();
    expect(d.pick(0)).toBe(true);
    expect(told).toEqual([["stove", "denied"]]);
    expect(d.talk?.node).toBe("deny");
    expect(said[1]).toEqual(["That's what the last Excel said.", "Same shoes."]);
    await flush();
    expect(d.talk?.stage).toBe("closing");
    d.tick(TALK_LINGER_S + 0.1, now(near));
    expect(d.talk).toBeNull();
    d.tick(5, now(near));
    expect(d.talk).toBeNull(); // done for this walk
  });

  it("opens where the told marks say", () => {
    const { d, said } = setup(1, house(), { stove: "sorry" });
    d.setScript(script);
    d.tick(0.1, now(near));
    expect(said[0]![0]).toBe("You. The polite one.");
  });

  it("walking away ends it, says nothing more, and leaves it alone for a while", async () => {
    const { d, log, flush } = setup(1);
    d.setScript(script);
    d.tick(0.1, now(near));
    await flush();
    expect(d.options).not.toBeNull();
    d.tick(0.1, now(at(3 - TALK_LEAVE_M - 1, 2)));
    expect(d.talk).toBeNull();
    expect(log).toContain("hush");
    d.tick(0.1, now(near));
    expect(d.talk).toBeNull();
    d.tick(TALK_AGAIN_S, now(far));
    d.tick(0.1, now(near));
    expect(d.talk).not.toBeNull();
  });

  it("no answer in TALK_PATIENCE_S ends it: a talk can't hold the visions for ever", async () => {
    const { d, flush } = setup(1);
    d.setScript(script);
    d.tick(0.1, now(near));
    await flush();
    d.tick(TALK_PATIENCE_S + 1, now(near));
    expect(d.talk).toBeNull();
  });

  it("holds beats while it is open, and a walk goes on (nothing here blocks anything)", async () => {
    const plan = descentPlan("s1", 1);
    const { d, log, flush } = setup(1);
    d.setScript(script);
    d.tick(0.1, now(near));
    await flush();
    run(d, plan[0]!.at + 1, now(near));
    expect(log.filter((l) => l.startsWith("start"))).toEqual([]);
  });

  it("an option's `do` sets a vision off, and a talk's own words stand for its line", async () => {
    const map = house([{ id: "bottle", room: "a", kind: "cylinder", model: "bottle", pos: [3, 0, 1], size: [0.12, 0.3, 0.12] }]);
    const { d, log, said, flush } = setup(2, map);
    d.setScript(script);
    d.awake = d.awake.filter((a) => a.talker.id === "bottle");
    d.tick(0.1, now(at(2.4, 1)));
    await flush();
    expect(d.options![0]).toBe("Drink it.");
    d.pick(0);
    d.tick(0.1, now(at(2.4, 1)));
    expect(log).toContain("start small");
    const lines = said.length;
    run(d, d.time + 3, now(at(2.4, 1)));
    expect(said.length).toBe(lines); // no "What a curious feeling." twice
  });

  it("the story's lines come first: hush ends a talk and cuts the voice", async () => {
    const { d, log, flush } = setup(1);
    d.setScript(script);
    d.tick(0.1, now(near));
    await flush();
    d.hush();
    expect(d.talk).toBeNull();
    expect(log).toContain("hush");
  });

  it("an escape ends a talk at once", () => {
    const { d } = setup(1);
    d.setScript(script);
    d.tick(0.1, now(near));
    expect(d.talk).not.toBeNull();
    d.tick(0.1, now(near, { escaping: true }));
    expect(d.talk).toBeNull();
  });

  it("no script: visions without words, nobody awake", () => {
    const plan = descentPlan("s1", 3);
    const { d, log, said } = setup(3);
    d.setScript(null);
    expect(d.awake).toEqual([]);
    run(d, plan[0]!.at + 8, now(far));
    expect(log[0]).toBe(`start ${plan[0]!.vision}`);
    expect(said).toEqual([]);
  });

  it("an awake prop is heard before it is seen", () => {
    const { d, log } = setup(1);
    d.setScript(script);
    d.tick(0.1, now(at(0.5, 2)));
    expect(log).toContain("mumble stove");
  });

  it("keys 1–4, top row or keypad, and nothing else", () => {
    expect(["Digit1", "Digit4", "Numpad2"].map(talkKey)).toEqual([0, 3, 1]);
    for (const k of ["Digit5", "Digit0", "KeyW", "ArrowUp", "Space"]) expect(talkKey(k)).toBeNull();
  });
});

describe("the door", () => {
  const seed = (level: number) => {
    const s = setup(level, house(), undefined);
    return s;
  };

  it("needs a place to stand: no spot, no door, and the walk goes on", () => {
    const h = setup(3);
    h.d.setHouse(house());
    (h.d as unknown as { pending: unknown }).pending = { kind: "door", at: 0 };
    h.d.tick(0.1, now(at(100, 100)));
    expect(h.d.run).toBeNull();
    expect(h.log).not.toContain("start door");
  });

  it("walking within HALLWAY_DOOR_M goes through: beats hold, the enter lines play, and out says out", async () => {
    const h = seed(3);
    h.d.setScript(script);
    (h.d as unknown as { pending: unknown }).pending = { kind: "door", at: 0 };
    h.d.tick(0.1, now(at(1, 2)));
    expect(h.d.run?.kind).toBe("door");
    const door = h.d.run!.door!;
    expect(atDoor(house(), door.pos, door)).toBe(true);
    h.d.tick(0.1, now([door.pos[0], 0, door.pos[2] + HALLWAY_DOOR_M - 0.05]));
    expect(h.log).toContain("hallway");
    expect(h.d.hallway).toBe(true);
    expect(h.said.at(-1)).toEqual(["This wasn't here.", "It's longer than the house is wide."]);
    const started = h.log.filter((l) => l.startsWith("start")).length;
    run(h.d, h.d.time + 200, now(at(1, 2)));
    expect(h.log.filter((l) => l.startsWith("start")).length).toBe(started);
    h.d.hallwayFar();
    expect(["It keeps going.", "You've been walking for longer than the house is long.", "Something else is walking too. Further back."]).toContain(h.said.at(-1)![0]);
    h.d.leftHallway(false);
    expect(h.d.hallway).toBe(false);
    expect(h.said.at(-1)).toEqual(["We measured it. Everything's back to normal.", "It's a quarter inch wider."]);
  });

  it("left quietly (a session end, a remap) says nothing", () => {
    const h = seed(3);
    h.d.setScript(script);
    h.d.hallway = true;
    const n = h.said.length;
    h.d.leftHallway(true);
    expect(h.d.hallway).toBe(false);
    expect(h.said.length).toBe(n);
  });

  it("a door the player never walks to fades and the plan goes on", () => {
    const h = seed(3);
    (h.d as unknown as { pending: unknown }).pending = { kind: "door", at: 0 };
    h.d.tick(0.1, now(at(1, 2)));
    run(h.d, h.d.time + VISION_S.door + 0.2, now(far));
    expect(h.log).toContain("stop door");
    expect(h.d.hallway).toBe(false);
  });

  it("stop ends everything, and interrupt only gets out of the way", () => {
    const h = seed(3);
    const plan = descentPlan("s1", 3);
    run(h.d, plan[0]!.at + 0.1, now(far));
    h.d.interrupt();
    expect(h.d.run).toBeNull();
    run(h.d, plan[1]!.at + 0.1, now(far));
    expect(h.d.run).not.toBeNull();
    h.d.stop();
    for (let i = 0; i < 9000; i++) h.d.tick(0.1, now(far));
    expect(h.d.run).toBeNull();
  });
});

describe("the words", () => {
  const who = { name: "Excel", visit: 4 };

  it("a whisper is the level's; a vision's its own; nobody's without a script", () => {
    expect(script.whispers["3"]).toContain(visionLine(script, "whisper", 1, 3, who));
    expect(script.grin).toContain(visionLine(script, "grin", 7, 3, who));
    expect(visionLine(script, "small", 2, 3, who)).toBe("You're shrinking. That's normal, after 4 reinstalls.");
    expect(visionLine(script, "flicker", 1, 3, who)).toBeNull();
    expect(visionLine(null, "whisper", 1, 3, who)).toBeNull();
  });

  it("Gerald says nothing on an early find, and more the deeper it goes", () => {
    expect(foundLine(script, 1, 0, who)).toBeNull();
    expect(foundLine(script, 2, 0, who)).toBe("You again.");
    expect(foundLine(script, 4, 0, who)).toBe("See you next time, Excel. There's always a next time.");
    expect(foundLine(null, 4, 0, who)).toBeNull();
  });
});

describe("how a vision looks, in numbers", () => {
  it("level 0's look changes nothing", () => {
    expect(gradeOf(descentLook(0), null)).toEqual({ fog: 1, ambient: 1, exposure: 1, neon: 1, tint: "#ffffff", tintBy: 0, dark: 0 });
  });

  it("`flicker` never stutters faster than 3 Hz, for any n", () => {
    for (let n = 0; n < 9; n++) {
      const dips: number[] = [];
      let was = flickerAt(0, n);
      for (let s = 0; s < VISION_S.flicker; s += 0.005) {
        const v = flickerAt(s, n);
        if (v < was) dips.push(s);
        was = v;
      }
      for (let i = 1; i < dips.length; i++) expect(dips[i]! - dips[i - 1]!, `n ${n}`).toBeGreaterThanOrEqual(1 / 3 - 0.01);
      expect(flickerAt(VISION_S.flicker + 0.1, n)).toBe(1);
    }
  });

  it("`small` and `big` ease ALICE_EASE_S each way and hold in between", () => {
    const length = VISION_S.small;
    expect(aliceAt("small", 0, length)).toBe(1);
    expect(aliceAt("small", ALICE_EASE_S, length)).toBeCloseTo(ALICE_SMALL);
    expect(aliceAt("small", length / 2, length)).toBeCloseTo(ALICE_SMALL);
    expect(aliceAt("small", length, length)).toBe(1);
    expect(aliceAt("big", VISION_S.big / 2, VISION_S.big)).toBeCloseTo(ALICE_BIG);
    expect(aliceAt("dark", 3, 11)).toBe(1);
    // No lurch: the steepest step in a 60 Hz frame is a sliver of the way.
    let last = 1;
    for (let s = 0; s < ALICE_EASE_S; s += 1 / 60) {
      const k = aliceAt("big", s, VISION_S.big);
      expect(Math.abs(k - last)).toBeLessThan(0.006);
      last = k;
    }
  });

  it("`tint` goes a wrong colour by n and comes back", () => {
    const look = descentLook(2);
    const mid = gradeOf(look, { kind: "tint", n: 5, s: 4.5, length: VISION_S.tint });
    expect(WRONG_TINTS).toContain(mid.tint);
    expect(mid.tintBy).toBeGreaterThan(0.8);
    expect(gradeOf(look, { kind: "tint", n: 5, s: VISION_S.tint, length: VISION_S.tint }).tintBy).toBeCloseTo(look.tintBy);
  });

  it("`dark` closes the sight to about 3 m and lets it go", () => {
    const look = descentLook(3);
    const mid = gradeOf(look, { kind: "dark", n: 0, s: 5, length: VISION_S.dark });
    expect(mid.dark).toBe(1);
    const density = mid.fog * 0.07;
    expect(Math.exp(-((density * 3) ** 2))).toBeGreaterThan(0.15);
    expect(Math.exp(-((density * 6) ** 2))).toBeLessThan(0.05);
    expect(gradeOf(look, { kind: "dark", n: 0, s: VISION_S.dark, length: VISION_S.dark }).dark).toBe(0);
  });

  it("an envelope is 0 at both ends", () => {
    expect(envelope(0, 5, 1, 1)).toBe(0);
    expect(envelope(2.5, 5, 1, 1)).toBe(1);
    expect(envelope(5, 5, 1, 1)).toBe(0);
  });
});

describe("the steps behind you", () => {
  it("walk when the player walks, stop one step after they stop, and take one more at the end", () => {
    const f = new FollowerSteps(7);
    const steps: number[] = [];
    for (let s = 0; s < 7; s += 0.05) {
      const speed = s < 3 ? 1.8 : 0;
      if (f.tick(0.05, speed, s) !== null) steps.push(Math.round(s * 100) / 100);
    }
    const whileWalking = steps.filter((s) => s < 3);
    expect(whileWalking.length).toBeGreaterThanOrEqual(5);
    const after = steps.filter((s) => s >= 3);
    expect(after.length).toBe(2); // the late one, and the last
    expect(after[0]).toBeLessThan(3.4);
    expect(after[1]).toBeGreaterThan(6.4);
  });

  it("a player who never moves still hears the one at the end, loudest of all", () => {
    const f = new FollowerSteps(7);
    const steps: number[] = [];
    for (let s = 0; s < 7; s += 0.05) {
      const v = f.tick(0.05, 0, s);
      if (v !== null) steps.push(v);
    }
    expect(steps).toEqual([0.9]);
  });
});

describe("where a vision stands", () => {
  const world = (h: HouseMap) => buildPhysicsWorld(h);

  it("walks what is there: a wall stops the way ahead", () => {
    const h = TWO_ROOMS();
    // Spawn (1, 2) facing north: 2 m to the wall.
    const way = wayAhead(world(h), { p: [1, 0, 2], yaw: 0, pitch: 0, vy: 0 }, 6, 1)!;
    expect(way.walked).toBeLessThan(2);
    expect(way.end[2]).toBeGreaterThan(0.2);
    expect(wayAhead(world(h), { p: [1, 0, 2], yaw: 0, pitch: 0, vy: 0 }, 6, 5, [0])).toBeNull();
  });

  it("looks to the side when straight ahead is a wall", () => {
    const h = TWO_ROOMS();
    const way = wayAhead(world(h), { p: [0.5, 0, 1.5], yaw: 90, pitch: 0, vy: 0 }, 2.5, 2);
    expect(way?.yaw).not.toBe(90);
  });

  it("a face goes on a side a program can stand at", () => {
    const h = SHOW();
    const plant = h.props.find((p) => p.id === "plant")!;
    const sides = faceSides(h, plant);
    expect(sides[0]!.pos[1]).toBeCloseTo(plant.pos[1] + plant.size[1] * 0.68);
    expect(sides.map((s) => s.yaw)).not.toContain(plant.yaw ?? 0); // its front is against the wall
    const stove = h.props.find((p) => p.id === "stove")!;
    expect(faceSides(h, stove)[0]!.yaw).toBe(0);
  });

  it("it turns up on the side the player has walked round to", () => {
    const h = house();
    const stove = h.props[0]!;
    const sides = faceSides(h, stove);
    expect(sides.length).toBeGreaterThanOrEqual(3);
    expect(sides[nearestSide(sides, [3, 1.6, 0.5])]!.yaw).toBe(0); // north of it: its front
    expect(Math.abs(sides[nearestSide(sides, [3, 1.6, 2.9])]!.yaw)).toBe(180); // south of it: behind it
  });

  it("the show's awake props all get a face, whatever the seed", () => {
    const h = SHOW();
    const d = setup(4, h).d;
    d.setScript(script as DescentScript);
    expect(d.awake.length).toBe(5);
    for (const a of d.awake) expect(faceSides(h, a.prop).length).toBeGreaterThan(0);
  });
});

describe("what a walk is not", () => {
  it("never touches the network or the clock of its own", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const { d } = setup(4);
    d.setScript(script);
    run(d, 120, now(far));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("a bug in the descent", () => {
  it("drops it and leaves the walk alone", async () => {
    const { Game } = await import("../src/game/engine.ts");
    const h = TWO_ROOMS();
    const calls: string[] = [];
    const g = Object.create(Game.prototype) as Record<string, unknown> & { descentSafely(step: () => void): void };
    Object.assign(g, {
      pocket: { leave: () => calls.push("left") },
      pocketDoor: { pos: [0, 0, 0], yaw: 0 },
      house: { floors: new Map() },
      trail: { object: { visible: false } },
      lamps: { borrow: (l: unknown) => calls.push(`borrow ${String(l)}`) },
      o: { sfx: { drone: (on: boolean) => calls.push(`drone ${on}`) } },
      descentLines: { stop: () => calls.push("lines") },
      descentSpeaker: { stop: () => calls.push("voice") },
      director: {},
      hallway: {},
      visions: { calm: () => calls.push("calm") },
      map: h,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    g.descentSafely(() => {
      throw new Error("a bug");
    });
    warn.mockRestore();
    expect(g["director"]).toBeNull();
    expect(g["visions"]).toBeNull();
    expect(g["pocket"]).toBeNull();
    expect((g["trail"] as { object: { visible: boolean } }).object.visible).toBe(true);
    expect(calls).toEqual(expect.arrayContaining(["left", "borrow null", "drone false", "lines", "voice", "calm"]));
  });
});
