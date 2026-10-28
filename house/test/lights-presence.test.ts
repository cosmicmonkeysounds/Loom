//! (wave 39) `lights.json` `presence`: its validation, which fixtures may
//! pulse (never a safety one), `presenceStep`'s reach, hysteresis and hold,
//! and the games' `lights` frame (`lampOf`, `gameLight`, `gameLightsOf`).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  LIGHT_PRESENCE_HOLD_MS,
  LIGHT_PRESENCE_LEAVE_M,
  LIGHT_PRESENCE_RADIUS_M,
  gameLight,
  gameLightsOf,
  lampOf,
  mergeLightState,
  presenceFixtures,
  presenceSettings,
  presenceStep,
  pulseFactor,
  samePulsed,
  validateLights,
} from "../src/index.ts";
import type { HouseMap, LightsConfig, PresenceEntry, PresencePlayer, Vec3 } from "../src/index.ts";
import { FIXTURES } from "./golden.ts";

const load = <T>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
const HOUSE = load<HouseMap>("lights-house.json");
const LIGHTS = load<LightsConfig>("lights-basic.json");
const fresh = (presence?: unknown): LightsConfig => {
  const l = JSON.parse(JSON.stringify(LIGHTS)) as Record<string, unknown>;
  if (presence !== undefined) l["presence"] = presence;
  return l as unknown as LightsConfig;
};
const lamp = LIGHTS.fixtures.find((f) => f.id === "desk-lamp")!;
const at = (dx: number): Vec3 => [lamp.pos.x + dx, 0, lamp.pos.z];
const player = (session: string, dx: number, room: string | null = "desktop"): PresencePlayer => ({ session, room, p: at(dx) });

describe("presence settings + validation", () => {
  it("defaults to on, everywhere, breathe, 1.6 m", () => {
    expect(presenceSettings(fresh())).toEqual({ enabled: true, to: ["everywhere"], radius: LIGHT_PRESENCE_RADIUS_M, effect: "breathe" });
    expect(validateLights(fresh(), HOUSE).ok).toBe(true);
  });
  it("never lets a safety fixture pulse", () => {
    const ids = presenceFixtures(fresh(), HOUSE).map((f) => f.id);
    expect(ids).toEqual(["desk-lamp", "hall-group", "attic-bulb"]);
    expect(presenceFixtures(fresh({ to: ["heart"] }), HOUSE)).toEqual([]);
  });
  it("is off with enabled: false", () => {
    expect(presenceFixtures(fresh({ enabled: false }), HOUSE)).toEqual([]);
  });
  it("refuses a malformed block, warns on safety and empty targets", () => {
    expect(validateLights(fresh({ radius: 9 }), HOUSE).problems).toContain("presence.radius must be metres from 0.5 to 5");
    expect(validateLights(fresh({ effect: "rave" }), HOUSE).problems[0]).toMatch(/^presence\.effect must be/u);
    expect(validateLights(fresh({ colour: "red" }), HOUSE).problems).toContain('presence: unknown field "colour"');
    expect(validateLights(fresh("on"), HOUSE).ok).toBe(false);
    expect(validateLights(fresh({ to: "heart" }), HOUSE).ok).toBe(false);
    const w = validateLights(fresh({ to: ["heart", "nowhere"] }), HOUSE);
    expect(w.ok).toBe(true);
    expect(w.warnings).toContain('presence.to: "nowhere" reaches no fixture');
    expect(w.warnings.some((x) => x.startsWith("presence.to reaches safety fixture"))).toBe(true);
  });
});

describe("presenceStep", () => {
  const L = fresh();
  it("pulses a fixture a program stands under, in its room only", () => {
    const s = presenceStep(L, HOUSE, [player("a", 0.5)], new Map(), 1000);
    expect([...s.keys()]).toEqual(["desk-lamp"]);
    expect(s.get("desk-lamp")).toEqual({ sessions: ["a"], since: 1000, last: 1000 });
    expect(presenceStep(L, HOUSE, [player("a", 0.5, "hall")], new Map(), 1000).size).toBe(0);
    expect(presenceStep(L, HOUSE, [player("a", 0.5, null)], new Map(), 1000).size).toBe(0);
  });
  it("holds a program already under it a little further out (hysteresis)", () => {
    const edge = LIGHT_PRESENCE_RADIUS_M + LIGHT_PRESENCE_LEAVE_M / 2;
    expect(presenceStep(L, HOUSE, [player("a", edge)], new Map(), 0).size).toBe(0);
    const s0 = presenceStep(L, HOUSE, [player("a", 1)], new Map(), 0);
    const s1 = presenceStep(L, HOUSE, [player("a", edge)], s0, 100);
    expect(s1.get("desk-lamp")!.sessions).toEqual(["a"]);
  });
  it("keeps pulsing for the hold after the last program left, then stops", () => {
    const s0 = presenceStep(L, HOUSE, [player("a", 0)], new Map(), 0);
    const s1 = presenceStep(L, HOUSE, [], s0, 1000);
    expect(s1.get("desk-lamp")).toEqual({ sessions: [], since: 0, last: 0 });
    expect(samePulsed(s0, s1)).toBe(true);
    const s2 = presenceStep(L, HOUSE, [], s1, LIGHT_PRESENCE_HOLD_MS);
    expect(s2.size).toBe(0);
    expect(samePulsed(s1, s2)).toBe(false);
  });
  it("keeps `since` while programs come and go", () => {
    const s0 = presenceStep(L, HOUSE, [player("b", 0)], new Map(), 0);
    const s1 = presenceStep(L, HOUSE, [player("a", 0.2), player("b", 0)], s0, 500);
    expect(s1.get("desk-lamp")).toEqual({ sessions: ["a", "b"], since: 0, last: 500 });
  });
  it("pulses nothing with presence off", () => {
    expect(presenceStep(fresh({ enabled: false }), HOUSE, [player("a", 0)], new Map<string, PresenceEntry>(), 0).size).toBe(0);
  });
});

describe("the games' frame", () => {
  it("merges states the way a bulb keeps them", () => {
    const s = mergeLightState({ state: "ON", color: "#ff0000", brightness: 200 }, { color_temp: 300, effect: "breathe", transition: 2 });
    expect(s).toEqual({ state: "ON", brightness: 200, color_temp: 300, effect: "breathe" });
    expect(mergeLightState(s, { effect: "finish_effect" })).toEqual({ state: "ON", brightness: 200, color_temp: 300 });
  });
  it("draws OFF dark and fills missing fields from the settled lamp", () => {
    expect(lampOf({ state: "OFF", color: "#00ff00" }).brightness).toBe(0);
    expect(lampOf({ color: "#00ff00", brightness: 127 })).toEqual({ brightness: 127, color: "#00ff00", effect: null });
    expect(lampOf({}).color).toBe("#ffd9a8");
  });
  it("round-trips a light and drops a malformed one", () => {
    const g = gameLight(lamp, { brightness: 254, color: "#FF00AA", effect: null }, true);
    expect(g).toMatchObject({ id: "desk-lamp", color: "#ff00aa", level: 1, pulse: true, safety: false });
    const frame = gameLightsOf({ at: 5, source: "house", pulse: "breathe", lights: [g, { id: "x" }, { id: "y", pos: { x: 0, y: 0, z: "1" } }] });
    expect(frame).toEqual({ at: 5, source: "house", pulse: "breathe", lights: [g] });
    expect(gameLightsOf({ lights: "no" })).toBeNull();
    expect(gameLightsOf({ lights: [] })).toEqual({ at: 0, source: "estimate", pulse: null, lights: [] });
  });
  it("breathes between 0.35 and 1", () => {
    expect(pulseFactor(0)).toBeCloseTo(1);
    expect(pulseFactor(1)).toBeCloseTo(0.35);
    expect(pulseFactor(2)).toBeCloseTo(1);
  });
});
