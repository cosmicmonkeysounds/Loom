//! (wave 39, C4) The real house lights in the game, the pure half.
import { describe, expect, it } from "vitest";
import { gameLightsOf, pulseFactor, type GameLight, type HouseMap } from "@loom/house";
import { ambientFactor, animated, animationClock, demoLights, easeToward, LAMP_DARK, lampFloors, lampLevel, LIT_AMBIENT, NIGHT_FLOOR, pickLamps, PULSE_PERIOD_S } from "../src/game/house-lights.ts";
import { decodeLights, applyFrame, LIGHTS_FRAME } from "../src/spatial.ts";

const light = (id: string, over: Partial<GameLight> = {}): GameLight => ({
  id,
  room: "living",
  pos: { x: 0, y: 2.1, z: 0 },
  kind: "zigbee",
  color: "#ffcc88",
  level: 1,
  effect: null,
  pulse: false,
  safety: false,
  ...over,
});

const HOUSE: HouseMap = {
  name: "test",
  floors: [
    { id: "ground", label: "Ground", elevation: 0, height: 2.6 },
    { id: "up", label: "Up", elevation: 3, height: 2.5 },
  ],
  rooms: [
    { id: "living", label: "Living", floor: "ground", poly: [[0, 0], [4, 0], [4, 4], [0, 4]] },
    { id: "kitchen", label: "Kitchen", floor: "ground", poly: [[4, 0], [8, 0], [8, 4], [4, 4]] },
    { id: "bed", label: "Bed", floor: "up", poly: [[0, 0], [4, 0], [4, 4], [0, 4]] },
    { id: "yard", label: "Yard", floor: "ground", outdoor: true, poly: [[0, 4], [8, 4], [8, 8], [0, 8]] },
  ],
  doors: [],
  stairs: [],
  props: [],
  terminals: [],
  ducks: [],
  spawn: { room: "living", pos: [1, 0, 1], yaw: 0 },
} as unknown as HouseMap;

describe("a fixture's brightness", () => {
  it("is its level, breathing with pulseFactor while pulsed", () => {
    expect(lampLevel(light("a", { level: 0.6 }), 3)).toBe(0.6);
    expect(lampLevel(light("a", { level: 0.6, pulse: true }), 0)).toBeCloseTo(0.6);
    expect(lampLevel(light("a", { level: 0.6, pulse: true }), PULSE_PERIOD_S / 2)).toBeCloseTo(0.6 * pulseFactor(1));
    expect(lampLevel(light("a", { level: 0.6, effect: "breathe" }), PULSE_PERIOD_S / 2)).toBeLessThan(0.6);
    expect(lampLevel(light("a", { level: 1, effect: "blink" }), 0.4)).toBeLessThan(0.5);
  });

  it("stays dark when the house's bulb is off, pulse or not (a dark scene stays dark)", () => {
    expect(lampLevel(light("a", { level: 0, pulse: true }), 1)).toBe(0);
  });

  it("keeps an animation's phase across frames, starts a new one now", () => {
    const a = [light("a", { pulse: true }), light("b"), light("c", { effect: "okay" })];
    expect(animated(a[1]!)).toBe(false);
    const c1 = animationClock(new Map(), a, 10);
    expect([...c1]).toEqual([
      ["a", 10],
      ["c", 10],
    ]);
    const c2 = animationClock(c1, [light("a", { pulse: true }), light("b", { pulse: true })], 12);
    expect([...c2]).toEqual([
      ["a", 10],
      ["b", 12],
    ]);
  });
});

describe("the point lights' pick", () => {
  const lights = [
    light("near-up", { room: "bed", pos: { x: 1, y: 5, z: 1 } }),
    light("far", { room: "kitchen", pos: { x: 7, y: 2.1, z: 3 } }),
    light("near", { room: "living", pos: { x: 1, y: 2.1, z: 1 } }),
    light("dark", { room: "living", pos: { x: 1, y: 2.1, z: 1.2 }, level: LAMP_DARK / 2 }),
    light("mid", { room: "kitchen", pos: { x: 4.5, y: 2.1, z: 1 } }),
  ];
  const floors = lampFloors(HOUSE, lights);

  it("knows each fixture's floor by its room", () => {
    expect(floors.get("near-up")).toBe("up");
    expect(floors.get("far")).toBe("ground");
    expect(lampFloors(HOUSE, [light("x", { room: "attic" })]).get("x")).toBeNull();
  });

  it("takes the nearest lit fixtures, the player's floor first", () => {
    expect(pickLamps(lights, [1, 0, 1], "ground", floors, 2)).toEqual(["near", "mid"]);
    expect(pickLamps(lights, [1, 0, 1], "ground", floors, 8)).toEqual(["near", "mid", "far", "near-up"]);
    expect(pickLamps(lights, [1, 3, 1], "up", floors, 1)).toEqual(["near-up"]);
    expect(pickLamps(lights, [1, 0, 1], "ground", floors, 0)).toEqual([]);
    expect(pickLamps([], [1, 0, 1], null, floors, 4)).toEqual([]);
  });
});

describe("the ambient", () => {
  it("is as it always was without a frame, dims toward the night floor with one", () => {
    expect(ambientFactor(null)).toBe(1);
    expect(ambientFactor({ lights: [] })).toBe(1);
    expect(ambientFactor({ lights: [light("a", { level: 0 })] })).toBe(NIGHT_FLOOR);
    expect(ambientFactor({ lights: [light("a", { level: 1 })] })).toBe(LIT_AMBIENT);
    expect(ambientFactor({ lights: [light("a", { level: 1 }), light("b", { level: 0 })] })).toBeCloseTo((NIGHT_FLOOR + LIT_AMBIENT) / 2);
    // Never so dark the duck hunt suffers.
    expect(NIGHT_FLOOR).toBeGreaterThanOrEqual(0.5);
  });

  it("eases, never overshoots", () => {
    expect(easeToward(1, 0.5, 0)).toBe(1);
    const a = easeToward(1, 0.5, 0.5);
    expect(a).toBeLessThan(1);
    expect(a).toBeGreaterThan(0.5);
    expect(easeToward(1, 0.5, 100)).toBeCloseTo(0.5);
  });
});

describe("the lights frame on the stream", () => {
  it("decodes with gameLightsOf, and a malformed one is nothing", () => {
    const frame = { at: 5, source: "house", pulse: "breathe", lights: [light("a", { pulse: true })] };
    expect(LIGHTS_FRAME).toBe("lights");
    expect(decodeLights(JSON.stringify(frame))).toEqual(gameLightsOf(frame));
    expect(decodeLights("{")).toBeNull();
    expect(decodeLights("{}")).toBeNull();
    expect(decodeLights("null")).toBeNull();
  });

  it("leaves the player table alone (an unknown frame is harmless)", () => {
    const players = new Map();
    expect(applyFrame(players, { event: "lights", data: {} } as never)).toBe(players);
  });
});

describe("the dev demo frame", () => {
  it("hangs a light in each indoor room and pulses the one a program stands under", () => {
    const f = demoLights(HOUSE, [2, 0, 2], 1000);
    expect(f.lights.map((l) => l.room)).toEqual(["living", "kitchen", "bed"]);
    expect(f.lights.find((l) => l.room === "living")?.pulse).toBe(true);
    expect(f.lights.find((l) => l.room === "kitchen")?.pulse).toBe(false);
    expect(f.lights.find((l) => l.room === "bed")!.pos.y).toBeGreaterThan(3);
    expect(gameLightsOf(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(demoLights(HOUSE, null, 0).lights.every((l) => !l.pulse)).toBe(true);
  });
});
