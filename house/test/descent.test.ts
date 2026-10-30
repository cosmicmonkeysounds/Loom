import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DESCENT_FIRST_S,
  DESCENT_LATE_S,
  DESCENT_MAX,
  DESCENT_PLAN_S,
  PROP_MODELS,
  TALKERS_AWAKE,
  TALK_NONE,
  VISION_FROM,
  VISION_KINDS,
  buildWalls,
  descentLevel,
  descentLook,
  descentOf,
  descentPlan,
  doorSpot,
  dueBeat,
  faceAnchor,
  fillLine,
  ordinal,
  openNode,
  parseDescent,
  pickLine,
  pickOption,
  propSolid,
  route,
  talkReach,
  talkerFor,
  validateDescent,
  validateHouse,
  visitOf,
  wakeTalkers,
} from "../src/index.ts";
import type { DescentScript, HouseMap, Prop, Talker } from "../src/index.ts";
import { SHOW_DESCENT, SHOW_HOUSE, SHOW_SHED_HOUSE, fixture, loadHouse } from "./golden.ts";

const script = (): DescentScript => JSON.parse(readFileSync(SHOW_DESCENT, "utf8")) as DescentScript;

const talker = (over: Partial<Talker> = {}): Talker => ({ id: "t", from: 1, nodes: { start: { say: ["Hello."] } }, ...over });
const empty = (over: Partial<DescentScript> = {}): DescentScript => ({ version: 1, talkers: [], whispers: {}, grin: [], whiteduck: [], self: [], small: [], big: [], hallway: { enter: [], far: [], out: [] }, found: {}, ...over });

describe("the level", () => {
  it("runs from the walks behind a program, clean first, capped at the bottom", () => {
    expect([undefined, null, -1, Number.NaN, 0, 1, 2, 3, 4, 5, 40].map(descentLevel)).toEqual([0, 0, 0, 0, 0, 1, 2, 3, 4, 4, 4]);
  });

  it("takes the server's word first, else reads reinstalled (an old server)", () => {
    expect(descentOf({ descent: 3, reinstalled: 0 })).toBe(3);
    expect(descentOf({ descent: 0, reinstalled: 4 })).toBe(0);
    expect(descentOf({ reinstalled: 2 })).toBe(2);
    expect(descentOf({})).toBe(0);
  });

  it("gets steadily worse", () => {
    for (let l = 1; l <= DESCENT_MAX; l++) {
      expect(descentLook(l).fog).toBeGreaterThan(descentLook(l - 1).fog);
      expect(descentLook(l).ambient).toBeLessThan(descentLook(l - 1).ambient);
    }
    expect(descentLook(0)).toEqual({ fog: 1, ambient: 1, flicker: 1, tint: "#ffffff", tintBy: 0 });
  });
});

describe("the visit", () => {
  it("is the walks so far plus this one, never fewer than the level says", () => {
    expect(visitOf(0, 0)).toBe(1);
    expect(visitOf(3, 3)).toBe(4);
    expect(visitOf(7, 4)).toBe(8);
    expect(visitOf(0, 4)).toBe(5);
    expect(visitOf(undefined, 2)).toBe(3);
    expect(visitOf(-3, 0)).toBe(1);
  });
});

describe("the plan", () => {
  it("is empty on a clean walk, and deterministic per seed", () => {
    expect(descentPlan("s-1", 0)).toEqual([]);
    expect(descentPlan("s-1", 3)).toEqual(descentPlan("s-1", 3));
    expect(descentPlan("s-1", 3)).not.toEqual(descentPlan("s-2", 3));
  });

  it("only uses what the level allows, each kind before any repeats", () => {
    for (let l = 1; l <= DESCENT_MAX; l++) {
      const pool = VISION_KINDS.filter((k) => VISION_FROM[k] <= l);
      for (const seed of ["a", "b", "c", "d"]) {
        const plan = descentPlan(seed, l);
        expect(plan[0]!.at).toBe(DESCENT_FIRST_S[l]);
        expect(plan.every((b) => pool.includes(b.vision))).toBe(true);
        expect(new Set(plan.slice(0, pool.length).map((b) => b.vision)).size).toBe(pool.length);
      }
    }
  });

  it("gets denser with each level", () => {
    const n = [1, 2, 3, 4].map((l) => descentPlan("seed", l).length);
    expect(n[0]!).toBeLessThan(n[1]!);
    expect(n[1]!).toBeLessThan(n[2]!);
    expect(n[2]!).toBeLessThan(n[3]!);
  });

  it("stays in order and inside the plan's reach", () => {
    const plan = descentPlan("seed", 4);
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.at).toBeGreaterThan(plan[i - 1]!.at);
    expect(plan.at(-1)!.at).toBeLessThan(DESCENT_PLAN_S);
  });

  it("brings the door third from level 3, and only once", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      for (const l of [3, 4]) {
        const plan = descentPlan(seed, l);
        expect(plan[2]!.vision).toBe("door");
        expect(plan.filter((b) => b.vision === "door")).toHaveLength(1);
      }
      expect(descentPlan(seed, 2).some((b) => b.vision === "door")).toBe(false);
    }
  });

  it("dueBeat waits for a beat, then drops one held off too long", () => {
    const plan = [{ at: 10, vision: "flicker" as const, n: 0 }, { at: 12, vision: "grin" as const, n: 0 }, { at: 100, vision: "tint" as const, n: 0 }];
    expect(dueBeat(plan, 0, 5)).toBe(-1);
    expect(dueBeat(plan, 0, 10)).toBe(0);
    expect(dueBeat(plan, 1, 11)).toBe(-1);
    expect(dueBeat(plan, 0, 10 + DESCENT_LATE_S + 1)).toBe(1);
    expect(dueBeat(plan, 0, 12 + DESCENT_LATE_S + 1)).toBe(-1);
    expect(dueBeat(plan, 3, 500)).toBe(-1);
  });
});

describe("the script", () => {
  it("the show's validates, with nothing unreachable and every model real", () => {
    const v = validateDescent(script());
    expect(v.problems).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(parseDescent(script())).not.toBeNull();
  });

  it("every level has words, and something awake to say them", () => {
    const s = script();
    const house = loadHouse(SHOW_HOUSE);
    for (let l = 1; l <= DESCENT_MAX; l++) {
      expect(s.whispers[String(l)]!.length).toBeGreaterThan(2);
      expect(wakeTalkers(house, s, l, "seed")).toHaveLength(TALKERS_AWAKE[l]!);
    }
  });

  it("every talker in the show has a prop to speak through on both maps", () => {
    const s = script();
    for (const path of [SHOW_HOUSE, SHOW_SHED_HOUSE]) {
      const house = loadHouse(path);
      const spoken = new Set(house.props.map((p) => talkerFor(s, p)?.id).filter((id) => id !== undefined));
      expect(s.talkers.map((t) => t.id).filter((id) => !spoken.has(id))).toEqual([]);
    }
  });

  it("every node offers at most four ways on, and level 1 can always talk back", () => {
    const s = script();
    const first = s.talkers.filter((t) => t.from === 1);
    expect(first.length).toBeGreaterThan(4);
    for (const t of first) expect(t.nodes["start"]!.options!.length).toBeGreaterThanOrEqual(2);
  });

  it("never hints at the void, the heart, the disk or the patch bay, and names no crew", () => {
    const text = JSON.stringify({ ...script(), note: "" }).toLowerCase();
    for (const word of ["void", "heart", "disk", "floppy", "virus", "patch", "server room", "cold storage", "trabolta", "john", "steph", "jesse", "halifax", "the show", "loom"]) {
      expect(text.includes(word), word).toBe(false);
    }
  });

  it("refuses what would break a game", () => {
    const bad = (s: unknown): string[] => validateDescent(s).problems;
    expect(bad(null)).toEqual(["descent.json must be an object"]);
    expect(bad({ ...empty(), version: 2 }).join()).toContain("version");
    expect(bad(empty({ talkers: [talker({ id: "none" })] })).join()).toContain("talker id");
    expect(bad(empty({ talkers: [talker(), talker()] })).join()).toContain("used twice");
    expect(bad(empty({ talkers: [talker({ from: 0 })] })).join()).toContain("from");
    expect(bad(empty({ talkers: [talker({ nodes: { other: { say: ["x"] } } })] })).join()).toContain('no "start"');
    expect(bad(empty({ talkers: [talker({ nodes: { start: { say: ["x"], options: [{ text: "a", to: "nowhere" }] } } })] })).join()).toContain("no node");
    expect(bad(empty({ talkers: [talker({ nodes: { start: { say: ["x"], options: [{ text: "a", do: "explode" as never }] } } })] })).join()).toContain("not a vision");
    expect(bad(empty({ talkers: [talker({ nodes: { start: { say: ["x"], options: Array.from({ length: 5 }, () => ({ text: "a" })) } } })] })).join()).toContain("more than 4");
    expect(bad(empty({ talkers: [talker({ nodes: { start: { say: ["x"], options: [{ text: "y".repeat(49) }] } } })] })).join()).toContain("over 48");
    expect(bad(empty({ talkers: [talker({ nodes: { start: { say: ["y".repeat(161)] } } })] })).join()).toContain("over 160");
    expect(bad(empty({ whispers: { "7": ["x"] } })).join()).toContain("a level is");
    expect(parseDescent({ version: 1 })).toBeNull();
  });
});

describe("who wakes", () => {
  const prop = (over: Partial<Prop>): Prop => ({ id: "p", room: "a", kind: "box", pos: [0, 0, 0], size: [1, 1, 1], ...over });
  const house = (props: Prop[]): HouseMap => ({ ...fixture("two-rooms"), props });
  const s = empty({ talkers: [talker({ id: "stove", models: ["stove"] }), talker({ id: "tea", models: ["teatable"], from: 3, first: true }), talker({ id: "fridge", models: ["fridge"] })] });

  it("finds a talker by the prop's own word first, then its model", () => {
    expect(talkerFor(s, prop({ model: "stove" }))?.id).toBe("stove");
    expect(talkerFor(s, prop({ model: "stove", talk: "fridge" }))?.id).toBe("fridge");
    expect(talkerFor(s, prop({ model: "stove", talk: TALK_NONE }))).toBeNull();
    expect(talkerFor(s, prop({ talk: "ghost" }))).toBeNull();
    expect(talkerFor(s, prop({}))).toBeNull();
  });

  it("nobody on a clean walk or with no script", () => {
    const h = house([prop({ id: "s", model: "stove" })]);
    expect(wakeTalkers(h, s, 0, "x")).toEqual([]);
    expect(wakeTalkers(h, null, 3, "x")).toEqual([]);
  });

  it("no prop that isn't there yet, and no talker before its level", () => {
    const h = house([prop({ id: "s", model: "stove", from: 3 }), prop({ id: "t", model: "teatable" })]);
    expect(wakeTalkers(h, s, 2, "x")).toEqual([]);
    expect(wakeTalkers(h, s, 3, "x").map((w) => w.prop).sort()).toEqual(["s", "t"]);
  });

  it("one prop per talker, a first talker ahead, rooms spread before doubling up", () => {
    const h = house([prop({ id: "s1", model: "stove" }), prop({ id: "s2", model: "stove" }), prop({ id: "f", model: "fridge", room: "b" }), prop({ id: "t", model: "teatable", room: "b" })]);
    const awake = wakeTalkers(h, s, 3, "x");
    expect(awake[0]).toEqual({ prop: "t", talker: "tea" });
    expect(new Set(awake.map((w) => w.talker)).size).toBe(awake.length);
    expect(awake.filter((w) => w.talker === "stove")).toHaveLength(1);
    expect(awake).toHaveLength(3);
  });

  it("is seeded: the same session agrees, another differs somewhere", () => {
    const h = loadHouse(SHOW_HOUSE);
    expect(wakeTalkers(h, script(), 4, "s-1")).toEqual(wakeTalkers(h, script(), 4, "s-1"));
    const sets = new Set(["a", "b", "c", "d", "e", "f"].map((seed) => JSON.stringify(wakeTalkers(h, script(), 2, seed))));
    expect(sets.size).toBeGreaterThan(1);
  });
});

describe("reach, faces and the door", () => {
  const h = loadHouse(SHOW_HOUSE);
  const stove = h.props.find((p) => p.id === "stove")!;

  it("reaches from the prop's edge, on its floor only", () => {
    expect(talkReach(h, [stove.pos[0], 0, stove.pos[2] - 2], stove)).toBe(true);
    expect(talkReach(h, [stove.pos[0], 0, stove.pos[2] - 2.3], stove)).toBe(false);
    expect(talkReach(h, [stove.pos[0], 2.8, stove.pos[2] - 1], stove)).toBe(false);
  });

  it("puts a face on the prop's front", () => {
    const a = faceAnchor({ ...stove, yaw: 0 });
    expect(a.pos[2]).toBeCloseTo(stove.pos[2] - stove.size[2] / 2 - 0.02);
    const b = faceAnchor({ ...stove, yaw: 90 });
    expect(b.pos[0]).toBeCloseTo(stove.pos[0] - stove.size[2] / 2 - 0.02);
    expect(b.pos[1]).toBeCloseTo(stove.size[1] * 0.68);
  });

  it("stands the door ahead, in the same room, facing the program", () => {
    const d = doorSpot(h, [-4, 0, 7], 0)!;
    expect(d.pos[2]).toBeCloseTo(4);
    expect(d.yaw).toBe(-180);
  });

  it("turns aside when a wall is ahead, and gives up outside every room", () => {
    const d = doorSpot(h, [-3.5, 0, 7], -90)!;
    expect(d).not.toBeNull();
    expect(d.pos[0]).toBeLessThan(-3);
    expect(doorSpot(h, [100, 0, 100], 0)).toBeNull();
  });
});

describe("talks", () => {
  const t = talker({
    id: "stove",
    opens: [{ told: { stove: "denied" }, node: "again" }, { told: { stove: "sorry", other: "yes" }, node: "both" }],
    nodes: { start: { say: ["a"], options: [{ text: "x", to: "again", tell: "denied", do: "tint" }, { text: "y" }] }, again: { say: ["b"] }, both: { say: ["c"] } },
  });

  it("opens by what was told, else at start", () => {
    expect(openNode(t, null)).toBe("start");
    expect(openNode(t, { stove: "other" })).toBe("start");
    expect(openNode(t, { stove: "denied" })).toBe("again");
    expect(openNode(t, { stove: "sorry" })).toBe("start");
    expect(openNode(t, { stove: "sorry", other: "yes" })).toBe("both");
  });

  it("says what a pick does", () => {
    expect(pickOption(t, "start", 0)).toEqual({ to: "again", tell: "denied", vision: "tint" });
    expect(pickOption(t, "start", 1)).toEqual({ to: null, tell: null, vision: null });
    expect(pickOption(t, "start", 2)).toBeNull();
    expect(pickOption(t, "again", 0)).toBeNull();
    expect(pickOption(t, "nope", 0)).toBeNull();
  });

  it("fills a line for this program", () => {
    expect(fillLine("{name}, {name}: {visit} is your {nth} time.", { name: "Excel", visit: 4 })).toBe("Excel, Excel: 4 is your fourth time.");
    expect(ordinal(13)).toBe("13th");
  });

  it("picks a line by wrapping", () => {
    expect(pickLine(["a", "b"], 5)).toBe("b");
    expect(pickLine(["a", "b"], -4)).toBe("a");
    expect(pickLine([], 1)).toBeNull();
    expect(pickLine(undefined, 1)).toBeNull();
  });
});

describe("a prop only some programs see", () => {
  it("is never solid, never in a wall or a route, and refused if it says otherwise", () => {
    const base = fixture("two-rooms");
    const p: Prop = { id: "tea", room: base.rooms[0]!.id, kind: "box", model: "teatable", from: 3, pos: [1, 0, 1], size: [2, 0.75, 1] };
    expect(propSolid(p)).toBe(false);
    const with_ = { ...base, props: [...base.props, p] };
    expect(buildWalls(with_)).toEqual(buildWalls(base));
    const a = base.spawn.pos;
    const b = base.duck.spots[0]!.pos;
    expect(route(with_, a, b)).toEqual(route(base, a, b));
    expect(validateHouse(with_).ok).toBe(true);
    expect(validateHouse({ ...base, props: [{ ...p, solid: true }] }).problems.join()).toContain("never solid");
    expect(validateHouse({ ...base, props: [{ ...p, from: 9 }] }).ok).toBe(false);
    expect(validateHouse({ ...base, props: [{ ...p, kind: "screen", model: undefined }] }).problems.join()).toContain('"from" is only');
    expect(validateHouse({ ...base, props: [{ ...p, talk: "Not An Id" }] }).ok).toBe(false);
  });

  it("the show's strange props all carry a from, and everything placed is a real model", () => {
    for (const path of [SHOW_HOUSE, SHOW_SHED_HOUSE]) {
      const house = loadHouse(path);
      const models = new Set(PROP_MODELS.map((m) => m.id));
      const strange = new Set(PROP_MODELS.filter((m) => m.group === "strange" && m.id !== "chair").map((m) => m.id));
      for (const p of house.props) {
        if (p.model !== undefined) expect(models.has(p.model), p.id).toBe(true);
        if (p.model !== undefined && strange.has(p.model)) expect(p.from, p.id).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("the catalogue", () => {
  it("has the things asked for", () => {
    const ids = PROP_MODELS.map((m) => m.id);
    for (const id of ["bbq", "stove", "microwave", "modular"]) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(58);
  });
});
