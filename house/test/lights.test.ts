//! `lights.json` (wave 20): `validateLights` problems + warnings, with and
//! without a house, the safety clamp, and the shared `resolveLightTargets` /
//! `planLook` / payload cases stagehand's `lights` module mirrors in Python
//! (`test/fixtures/lights-{resolve,plan}.json`).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  LIGHTS_FILE,
  LIGHT_LOOP_MIN_PERIOD_MS,
  LIGHT_SAFETY_MIN,
  clampForSafety,
  isLightLookName,
  lightStateProblems,
  defaultLights,
  lightTopic,
  lightsHash,
  planLook,
  resolveLightTargets,
  validateHouse,
  validateLights,
  safetyMin,
  wledPayload,
  z2mPayload,
} from "../src/index.ts";
import type { HouseMap, LightFixture, LightLook, LightPlan, LightState, LightsConfig } from "../src/index.ts";
import { FIXTURES } from "./golden.ts";

const load = <T>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
const HOUSE = load<HouseMap>("lights-house.json");
const LIGHTS = load<LightsConfig>("lights-basic.json");
const fresh = (): LightsConfig => JSON.parse(JSON.stringify(LIGHTS)) as LightsConfig;
const fixture = (id: string): LightFixture => LIGHTS.fixtures.find((f) => f.id === id)!;

/** Validate a copy of the basic config after `mutate`, on the fixture house. */
function check(mutate: (l: LightsConfig & Record<string, unknown>) => void, house: HouseMap | null = HOUSE) {
  const l = fresh() as LightsConfig & Record<string, unknown>;
  mutate(l);
  return validateLights(l, house);
}
/** A look added to the basic config (named `name`), validated. */
const withLook = (name: string, look: unknown, house: HouseMap | null = HOUSE) => check((l) => void ((l.looks as Record<string, unknown>)[name] = look), house);

describe("the lights fixtures", () => {
  it("the house is a valid map and the config validates clean on it", () => {
    expect(validateHouse(HOUSE).problems).toEqual([]);
    expect(validateLights(LIGHTS, HOUSE)).toEqual({ ok: true, problems: [], warnings: [] });
    // Without a house a LOCATION names nothing (advice, never a refusal).
    expect(validateLights(LIGHTS)).toEqual({ ok: true, problems: [], warnings: ['looks["server_alarm"].to: "The Server Room" reaches no fixture', 'looks["tube_dim"].to: "The Tube" reaches no fixture'] });
  });

  it("the file is lights.json; the default is empty and valid", () => {
    expect(LIGHTS_FILE).toBe("lights.json");
    expect(defaultLights()).toEqual({ version: 1, fixtures: [], zones: [], looks: {} });
    expect(validateLights(defaultLights(), HOUSE)).toEqual({ ok: true, problems: [], warnings: [] });
  });

  it("the hash is a stable 8-hex content hash", () => {
    expect(lightsHash(LIGHTS)).toMatch(/^[0-9a-f]{8}$/u);
    expect(lightsHash(fresh())).toBe(lightsHash(LIGHTS));
    const b = fresh();
    b.fixtures[0]!.min = 41;
    expect(lightsHash(b)).not.toBe(lightsHash(LIGHTS));
    expect(lightsHash(defaultLights())).toBe(lightsHash(defaultLights()));
  });

  it("round-trips through JSON unchanged", () => {
    const again = JSON.parse(JSON.stringify(LIGHTS)) as LightsConfig;
    expect(again).toEqual(LIGHTS);
    expect(validateLights(again, HOUSE).ok).toBe(true);
  });
});

describe("validateLights — the file and its fixtures", () => {
  it("refuses a non-object, a wrong version, lists that aren't", () => {
    expect(validateLights(null).problems).toEqual(["lights.json must be an object"]);
    expect(validateLights([]).problems).toEqual(["lights.json must be an object"]);
    expect(check((l) => void ((l as Record<string, unknown>)["version"] = 2)).problems).toEqual(["version must be 1"]);
    expect(check((l) => void ((l as Record<string, unknown>)["zones"] = {})).problems).toEqual(["zones must be a list"]);
    expect(check((l) => void ((l as Record<string, unknown>)["looks"] = [])).problems).toEqual(["looks must be an object {cue name: look}"]);
  });

  it("fixture ids: well formed, unique, never everywhere", () => {
    expect(check((l) => l.fixtures.push({ ...l.fixtures[0]! })).problems).toEqual(['fixtures[5] "server-room-rgb": the id is used twice']);
    expect(check((l) => void (l.fixtures[2]!.id = "Desk Lamp")).problems).toContain('fixtures[2].id must be lower-case letters, digits and "-" ("Desk Lamp")');
    expect(check((l) => void (l.fixtures[2]!.id = "-lamp")).problems[0]).toMatch(/^fixtures\[2\]\.id must be/u);
    expect(check((l) => void (l.fixtures[2]!.id = "everywhere")).problems).toContain('fixtures[2] "everywhere": "everywhere" is reserved');
  });

  it("a fixture needs a device, a known kind, a pos, caps; safety + min in range", () => {
    expect(check((l) => void (l.fixtures[2]!.device = " ")).problems).toEqual(['fixtures[2] "desk-lamp".device must name the Zigbee2MQTT device / group or the WLED topic']);
    expect(check((l) => void ((l.fixtures[2] as unknown as Record<string, unknown>)["kind"] = "hue")).problems).toEqual(['fixtures[2] "desk-lamp".kind must be "zigbee" | "zigbee-group" | "wled"']);
    expect(check((l) => void ((l.fixtures[2] as unknown as Record<string, unknown>)["pos"] = [1, 0, 1])).problems).toEqual(['fixtures[2] "desk-lamp".pos must be {x, y, z} in metres']);
    expect(check((l) => void ((l.fixtures[2] as unknown as Record<string, unknown>)["caps"] = { color: true })).problems).toEqual(['fixtures[2] "desk-lamp".caps must be {color, ct, dim} (true / false)']);
    expect(check((l) => void (l.fixtures[0]!.min = 0)).problems).toEqual(['fixtures[0] "server-room-rgb".min must be a whole number from 1 to 254']);
    expect(check((l) => void (l.fixtures[0]!.min = 255)).problems).toEqual(['fixtures[0] "server-room-rgb".min must be a whole number from 1 to 254']);
    expect(check((l) => void ((l.fixtures[0] as unknown as Record<string, unknown>)["safety"] = "yes")).problems).toEqual(['fixtures[0] "server-room-rgb".safety must be true or false']);
  });

  it("with a house: the room exists, the floor is the room's, the fixture stands inside it (± 0.05 m)", () => {
    expect(check((l) => void (l.fixtures[2]!.room = "kitchen")).problems).toEqual(['fixtures[2] "desk-lamp": unknown room "kitchen"']);
    expect(check((l) => void (l.fixtures[0]!.floor = "main")).problems).toEqual(['fixtures[0] "server-room-rgb": floor "main" is not room "server-room"\'s floor "basement"']);
    expect(check((l) => void (l.fixtures[0]!.pos.x = -0.04)).problems).toEqual([]);
    expect(check((l) => void (l.fixtures[0]!.pos.x = 4.2)).problems).toEqual(['fixtures[0] "server-room-rgb": [4.2, 1.5] is outside room "server-room" (± 0.05 m)']);
    // Without a house nothing is placed, so nothing is checked.
    expect(check((l) => void (l.fixtures[2]!.room = "kitchen"), null).problems).toEqual([]);
  });

  it("with a house: the height is on the room's floor — the frame is absolute (the basement is at −2.7)", () => {
    // Basement: from −2.75 to the main floor + 0.05.
    expect(check((l) => void (l.fixtures[0]!.pos.y = -2.74)).problems).toEqual([]);
    expect(check((l) => void (l.fixtures[0]!.pos.y = 0.05)).problems).toEqual([]);
    expect(check((l) => void (l.fixtures[0]!.pos.y = 2.1)).problems).toEqual(['fixtures[0] "server-room-rgb": y 2.1 is not on floor "basement" (-2.75 to 0.05: the house frame is absolute)']);
    expect(check((l) => void (l.fixtures[0]!.pos.y = -2.9)).problems).toHaveLength(1);
    // The top floor: up to its elevation + 4.
    expect(check((l) => void (l.fixtures[4]!.pos.y = 6.8)).problems).toEqual([]);
    expect(check((l) => void (l.fixtures[4]!.pos.y = 6.9)).problems).toEqual(['fixtures[4] "attic-bulb": y 6.9 is not on floor "top" (2.75 to 6.8: the house frame is absolute)']);
  });
});

describe("validateLights — zones and boot", () => {
  it("zones: well formed, unique, never everywhere, known fixtures", () => {
    expect(check((l) => l.zones.push({ id: "everywhere", name: "All", fixtures: [] })).problems).toEqual(['zones[2] "everywhere": "everywhere" is every fixture already and may not be redefined']);
    expect(check((l) => l.zones.push({ id: "heart", name: "Again", fixtures: [] })).problems).toEqual(['zones[2] "heart": the id is used twice']);
    expect(check((l) => l.zones.push({ id: "desk-lamp", name: "Clash", fixtures: [] })).problems).toEqual(['zones[2] "desk-lamp": the id is used twice']);
    expect(check((l) => l.zones.push({ id: "Bad Zone", name: "x", fixtures: [] })).problems).toEqual(['zones[2].id must be lower-case letters, digits and "-" ("Bad Zone")']);
    expect(check((l) => l.zones[0]!.fixtures.push("ghost")).problems).toEqual(['zones[0] "heart": unknown fixture "ghost"']);
  });

  it("boot names a look", () => {
    expect(check((l) => void (l.boot = "heart_dream")).problems).toEqual(['boot names no look ("heart_dream")']);
    expect(check((l) => void delete l.boot).problems).toEqual([]);
  });
});

describe("validateLights — looks", () => {
  const one = (set: LightState): LightLook => ({ to: ["desk-lamp"], set });

  it("a look name is the story's cue name, never a screens cue family", () => {
    expect(withLook("Heart Big", one({ brightness: 100 })).problems).toEqual(['looks["Heart Big"]: a look name is lower-case letters, digits and "_", starting with a letter (it is the story\'s cue name)']);
    expect(withLook("2heart", one({ brightness: 100 })).problems).toHaveLength(1);
    for (const p of ["screens_", "terminals_", "tv_", "tablet_", "room_"]) {
      expect(withLook(`${p}heart`, one({ brightness: 100 })).problems).toEqual([`looks["${p}heart"]: "${p}" cues are the screens', never a look`]);
    }
  });

  it("exactly one of set or steps, a target list", () => {
    expect(withLook("x", { to: ["desk-lamp"] }).problems).toEqual(['looks["x"] must have exactly one of set or steps']);
    expect(withLook("x", { to: ["desk-lamp"], set: { brightness: 9 }, steps: [{ at: 0, set: { brightness: 9 } }] }).problems).toEqual(['looks["x"] must have exactly one of set or steps']);
    expect(withLook("x", { to: "desk-lamp", set: { brightness: 9 } }).problems).toEqual(['looks["x"].to must be a list of fixtures, zones, rooms or LOCATIONs']);
    expect(withLook("x", { to: ["desk-lamp"], steps: [] }).problems).toEqual(['looks["x"].steps must be a non-empty list of {at, set, to?}']);
    expect(withLook("x", "bright").problems).toEqual(['looks["x"] must be an object {to, set | steps}']);
  });

  it("values in range", () => {
    expect(withLook("x", one({ brightness: 255 })).problems).toEqual(['looks["x"].set.brightness must be a whole number from 0 to 254']);
    expect(withLook("x", one({ brightness: 1.5 })).problems).toEqual(['looks["x"].set.brightness must be a whole number from 0 to 254']);
    expect(withLook("x", one({ color: "#FF00" })).problems).toEqual(['looks["x"].set.color must be "#rrggbb"']);
    expect(withLook("x", one({ color: "red" })).problems).toEqual(['looks["x"].set.color must be "#rrggbb"']);
    expect(withLook("x", one({ color_temp: 100 })).problems).toEqual(['looks["x"].set.color_temp must be mireds from 150 to 500']);
    expect(withLook("x", one({ color_temp: 501 })).problems).toEqual(['looks["x"].set.color_temp must be mireds from 150 to 500']);
    expect(withLook("x", one({ transition: 31 })).problems).toEqual(['looks["x"].set.transition must be seconds from 0 to 30']);
    expect(withLook("x", one({ transition: -1 })).problems).toEqual(['looks["x"].set.transition must be seconds from 0 to 30']);
    expect(withLook("x", one({ effect: "strobe" as never })).problems).toEqual(['looks["x"].set.effect must be "blink" | "breathe" | "okay" | "channel_change" | "finish_effect" | "stop_effect"']);
    expect(withLook("x", one({ state: "on" as never })).problems).toEqual(['looks["x"].set.state must be "ON" or "OFF"']);
    expect(withLook("x", one({ color: "#FF0000", color_temp: 300 })).problems).toEqual(['looks["x"].set sets both color and color_temp']);
    expect(withLook("x", one({ hue: 3 } as never)).problems).toEqual(['looks["x"].set: unknown field "hue"']);
  });

  it("steps: at ≥ 0, increasing per fixture, ≥ 150 ms apart (≥ 400 for a colour change)", () => {
    const steps = (...s: Array<[number, LightState, string[]?]>): LightLook => ({ to: ["heart"], steps: s.map(([at, set, to]) => ({ at, set, ...(to ? { to } : {}) })) });
    expect(withLook("x", steps([-1, { brightness: 99 }])).problems).toEqual(['looks["x"].steps[0].at must be ms from the look\'s start (≥ 0)']);
    expect(withLook("x", steps([0, { brightness: 99 }], [0, { brightness: 120 }])).problems).toEqual(['looks["x"].steps[1]: at 0 ms is not after "server-room-rgb"\'s previous step (0 ms)']);
    expect(withLook("x", steps([500, { brightness: 99 }], [200, { brightness: 120 }])).problems).toEqual(['looks["x"].steps[1]: at 200 ms is not after "server-room-rgb"\'s previous step (500 ms)']);
    expect(withLook("x", steps([0, { brightness: 99 }], [149, { brightness: 120 }])).problems).toEqual(['looks["x"].steps[1]: at 149 ms is 149 ms after "server-room-rgb"\'s previous step (at least 150 ms: Zigbee drops faster commands)']);
    expect(withLook("x", steps([0, { brightness: 99 }], [150, { brightness: 120 }])).problems).toEqual([]);
    expect(withLook("x", steps([0, { brightness: 99 }], [399, { color: "#FF0000" }])).problems).toEqual(['looks["x"].steps[1]: at 399 ms is 399 ms after "server-room-rgb"\'s previous step (at least 400 ms for a colour change: Zigbee drops faster commands)']);
    expect(withLook("x", steps([0, { brightness: 99 }], [399, { color_temp: 300 }])).problems).toHaveLength(1);
    expect(withLook("x", steps([0, { brightness: 99 }], [400, { color: "#FF0000" }])).problems).toEqual([]);
    // Per fixture: two steps at the same time on different fixtures are fine.
    expect(withLook("x", steps([0, { brightness: 99 }, ["server-room-rgb"]], [0, { brightness: 99 }, ["desk-lamp"]])).problems).toEqual([]);
  });

  it("too many steps, too long, repeat in range, then restore never loops, a period after the last step", () => {
    const many = { to: ["heart"], steps: Array.from({ length: 65 }, (_, i) => ({ at: i * 150, set: { brightness: 100 + (i % 2) } })) };
    expect(withLook("x", many).problems).toEqual(['looks["x"] has 65 steps (at most 64)']);
    expect(withLook("x", { to: ["heart"], steps: [{ at: 0, set: { brightness: 99 } }, { at: 120_001, set: { brightness: 100 } }] }).problems).toEqual(['looks["x"] runs past 120000 ms']);
    expect(withLook("x", { ...one({ brightness: 9 }), repeat: 0 }).problems).toEqual(['looks["x"].repeat must be a whole number from 1 to 100']);
    expect(withLook("x", { ...one({ brightness: 9 }), repeat: 101 }).problems).toEqual(['looks["x"].repeat must be a whole number from 1 to 100']);
    expect(withLook("x", { ...one({ brightness: 9 }), repeat: 2, period: 2000 }).problems).toEqual([]);
    expect(withLook("x", { ...one({ brightness: 9 }), then: "restore", loop: true }).problems).toEqual(['looks["x"]: then "restore" can\'t loop (a loop never ends to give the light back)']);
    expect(withLook("x", { ...one({ brightness: 9 }), then: "back" }).problems).toEqual(['looks["x"].then must be "restore"']);
    expect(withLook("x", { to: ["heart"], steps: [{ at: 0, set: { brightness: 99 } }, { at: 1000, set: { brightness: 100 } }], loop: true, period: 1000 }).problems).toEqual(['looks["x"].period 1000 ms ends before the last step (1000 ms)']);
    expect(withLook("x", { ...one({ brightness: 9 }), period: -5 }).problems).toEqual(['looks["x"].period must be ms (> 0)']);
  });

  it("a safety fixture is never written dark: OFF or under its floor is refused", () => {
    expect(withLook("x", { to: ["heart"], set: { state: "OFF" } }).problems).toEqual(['looks["x"].set turns safety fixture "server-room-rgb" OFF (it never goes dark)']);
    expect(withLook("x", { to: ["heart"], set: { brightness: 39 } }).problems).toEqual(['looks["x"].set dims safety fixture "server-room-rgb" to 39 (its floor is 40)']);
    expect(withLook("x", { to: ["heart"], set: { brightness: 40 } }).problems).toEqual([]);
    // The strip's own floor is 50; a room target reaches both.
    expect(withLook("x", { to: ["The Server Room"], set: { brightness: 45 } }).problems).toEqual(['looks["x"].set dims safety fixture "server-strip" to 45 (its floor is 50)']);
    // A step narrowing to another fixture is fine.
    expect(withLook("x", { to: ["The Server Room"], steps: [{ at: 0, set: { brightness: 254 } }, { at: 500, set: { state: "OFF" }, to: ["desk-lamp"] }] }).problems).toEqual([]);
    // The floor without `min` is LIGHT_SAFETY_MIN.
    expect(check((l) => {
      delete l.fixtures[0]!.min;
      (l.looks as Record<string, LightLook>)["x"] = { to: ["heart"], set: { brightness: LIGHT_SAFETY_MIN - 1 } };
    }).problems).toEqual([`looks["x"].set dims safety fixture "server-room-rgb" to ${LIGHT_SAFETY_MIN - 1} (its floor is ${LIGHT_SAFETY_MIN})`]);
  });

  it("a min under LIGHT_SAFETY_MIN never lowers a safety fixture's floor (a warning says so)", () => {
    const low = check((l) => {
      l.fixtures[0]!.min = 1;
      (l.looks as Record<string, LightLook>)["x"] = { to: ["heart"], set: { brightness: 10 } };
    });
    expect(low.problems).toEqual([`looks["x"].set dims safety fixture "server-room-rgb" to 10 (its floor is ${LIGHT_SAFETY_MIN})`]);
    expect(low.warnings).toEqual([`fixtures[0] "server-room-rgb".min 1 has no effect: a safety fixture never goes below ${LIGHT_SAFETY_MIN}`]);
    // Not a safety fixture: its min is just a number.
    expect(check((l) => void (l.fixtures[2]!.min = 1)).warnings).toEqual([]);
  });
});

describe("validateLights — warnings", () => {
  it("a fast loop on Zigbee, never on WLED alone", () => {
    const fast = { to: ["heart"], steps: [{ at: 0, set: { brightness: 254 } }, { at: 500, set: { brightness: 60 } }], loop: true, period: 1000 };
    const v = withLook("x", fast);
    expect(v.problems).toEqual([]);
    expect(v.warnings).toEqual([`looks["x"] repeats every 1000 ms on Zigbee (server-room-rgb): under ${LIGHT_LOOP_MIN_PERIOD_MS} ms it reads as flicker and drops commands`]);
    // The default period (last step + 150) counts too, and a repeat > 1 is a loop.
    expect(withLook("x", { ...fast, loop: undefined, period: undefined, repeat: 3 }).warnings).toEqual([`looks["x"] repeats every 650 ms on Zigbee (server-room-rgb): under ${LIGHT_LOOP_MIN_PERIOD_MS} ms it reads as flicker and drops commands`]);
    expect(withLook("x", { ...fast, to: ["server-strip"] }).warnings).toEqual([]);
    expect(withLook("x", { ...fast, period: LIGHT_LOOP_MIN_PERIOD_MS }).warnings).toEqual([]);
  });

  it("a target that reaches nothing, a look that does nothing on its fixtures, a WLED effect it lacks, an unused fixture", () => {
    expect(withLook("x", { to: ["The Cloud", "desk-lamp"], set: { brightness: 9 } }).warnings).toEqual(['looks["x"].to: "The Cloud" reaches no fixture']);
    expect(withLook("x", { to: [], set: { brightness: 9 } }).warnings).toEqual(['looks["x"].to names nothing']);
    expect(withLook("x", { to: ["desk-lamp"], steps: [{ at: 0, set: { brightness: 9 }, to: ["The Cloud"] }] }).warnings).toEqual(['looks["x"].steps[0].to: "The Cloud" reaches no fixture']);
    expect(withLook("x", { to: ["desk-lamp"], set: { color: "#FF0000", transition: 1 } }).warnings).toEqual(['looks["x"]: its fixtures can\'t do anything it sets (check their caps)']);
    expect(withLook("x", { to: ["server-strip"], set: { effect: "okay" } }).warnings).toEqual(['looks["x"].set: WLED "server-strip" has no "okay" effect (only blink and breathe); it is played solid']);
    const unused = check((l) => {
      l.looks = { only: { to: ["heart"], set: { brightness: 99 } } };
      l.boot = "only";
    });
    expect(unused.problems).toEqual([]);
    expect(unused.warnings).toEqual(['fixture "server-strip" is in no look', 'fixture "desk-lamp" is in no look', 'fixture "hall-group" is in no look', 'fixture "attic-bulb" is in no look']);
  });
});

describe("clampForSafety", () => {
  it("lifts a safety fixture: OFF → ON at its floor, a low brightness to the floor", () => {
    const rgb = fixture("server-room-rgb");
    expect(clampForSafety(rgb, { state: "OFF" })).toEqual({ state: "ON", brightness: 40 });
    expect(clampForSafety(rgb, { state: "OFF", brightness: 200 })).toEqual({ state: "ON", brightness: 40 });
    expect(clampForSafety(rgb, { brightness: 0, color: "#FF0000" })).toEqual({ brightness: 40, color: "#FF0000" });
    expect(clampForSafety(rgb, { brightness: 41 })).toEqual({ brightness: 41 });
    expect(clampForSafety({ ...rgb, min: undefined }, { brightness: 1 })).toEqual({ brightness: LIGHT_SAFETY_MIN });
    // A min under the hard floor never lowers it.
    expect(clampForSafety({ ...rgb, min: 1 }, { state: "OFF" })).toEqual({ state: "ON", brightness: LIGHT_SAFETY_MIN });
    expect(clampForSafety({ ...rgb, min: 39 }, { brightness: 5 })).toEqual({ brightness: LIGHT_SAFETY_MIN });
    expect(safetyMin({ ...rgb, min: 1 })).toBe(LIGHT_SAFETY_MIN);
    expect(safetyMin({ ...rgb, min: 90 })).toBe(90);
  });

  it("leaves everything else alone, and never mutates its input", () => {
    const lamp = fixture("desk-lamp");
    const s: LightState = { state: "OFF", brightness: 0 };
    expect(clampForSafety(lamp, s)).toEqual(s);
    expect(clampForSafety(lamp, s)).not.toBe(s);
    const rgb = fixture("server-room-rgb");
    const off: LightState = { state: "OFF" };
    clampForSafety(rgb, off);
    expect(off).toEqual({ state: "OFF" });
  });
});

describe("planLook", () => {
  it("an unknown look is null; a prototype key is not a look", () => {
    expect(planLook(LIGHTS, HOUSE, "heart_dream")).toBeNull();
    expect(planLook(LIGHTS, HOUSE, "toString")).toBeNull();
  });

  it("set is one step at 0; the default period is the last step + 150 (a restore look: + 1000)", () => {
    expect(planLook(LIGHTS, HOUSE, "heart_idle")).toEqual<LightPlan>({ commands: [{ at: 0, fixture: "server-room-rgb", set: { state: "ON", brightness: 60, color: "#00E5FF", transition: 3 } }], loop: false, period: 150, repeat: 1, restore: false });
    expect(planLook(LIGHTS, HOUSE, "heart_warn")).toMatchObject({ period: 2200, restore: true, repeat: 1, loop: false });
    expect(planLook(LIGHTS, HOUSE, "heart_nag")).toMatchObject({ period: 1500, restore: true });
    expect(planLook(LIGHTS, HOUSE, "heart_door_open")).toMatchObject({ period: 2000, loop: true, repeat: 0 });
    expect(planLook(LIGHTS, HOUSE, "tube_dim")).toMatchObject({ period: 2000, repeat: 3 });
  });

  it("drops what a fixture's caps can't do, and a command left doing nothing", () => {
    const l = fresh();
    l.looks["x"] = { to: ["upstairs"], set: { color: "#FF0000", transition: 1 } };
    // The lamp (dim only) and the attic bulb (ct + dim) can't take a colour.
    expect(planLook(l, HOUSE, "x")!.commands).toEqual([{ at: 0, fixture: "hall-group", set: { color: "#FF0000", transition: 1 } }]);
  });

  it("clamps a safety fixture even when the file was never validated", () => {
    const l = fresh();
    l.looks["x"] = { to: ["The Server Room"], set: { state: "OFF" } };
    expect(planLook(l, HOUSE, "x")!.commands.map((c) => [c.fixture, c.set])).toEqual([
      ["server-room-rgb", { state: "ON", brightness: 40 }],
      ["server-strip", { state: "ON", brightness: 50 }],
    ]);
  });

  it("clamps before the caps: OFF on a safety fixture that can't dim is just ON", () => {
    const l = fresh();
    l.fixtures[0]!.caps = { color: true, ct: true, dim: false };
    l.looks["x"] = { to: ["heart"], set: { state: "OFF", transition: 1 } };
    expect(planLook(l, HOUSE, "x")!.commands).toEqual([{ at: 0, fixture: "server-room-rgb", set: { state: "ON", transition: 1 } }]);
  });

  it("without a house a LOCATION target reaches nothing", () => {
    expect(planLook(LIGHTS, null, "server_alarm")!.commands.map((c) => c.fixture)).toEqual(["server-room-rgb"]);
  });
});

describe("payloads", () => {
  it("topics: zigbee2mqtt/<device>/set, a WLED's <device>/api", () => {
    expect(lightTopic(fixture("server-room-rgb"))).toBe("zigbee2mqtt/server_room_rgb/set");
    expect(lightTopic(fixture("hall-group"))).toBe("zigbee2mqtt/hall_lights/set");
    expect(lightTopic(fixture("hall-group"), "z2m")).toBe("z2m/hall_lights/set");
    expect(lightTopic(fixture("server-strip"))).toBe("wled/server/api");
  });

  it("Z2M: only the set fields, the colour as {hex}", () => {
    expect(z2mPayload(fixture("hall-group"), { state: "ON", brightness: 254, color: "#FF2A00", transition: 0 })).toEqual({ state: "ON", brightness: 254, color: { hex: "#FF2A00" }, transition: 0 });
    expect(z2mPayload(fixture("hall-group"), { effect: "okay" })).toEqual({ effect: "okay" });
    expect(JSON.stringify(z2mPayload(fixture("hall-group"), { transition: 2, color_temp: 370 }))).toBe('{"color_temp":370,"transition":2}');
  });

  it("WLED: on / bri / transition in tenths / one segment's colour + effect", () => {
    const strip = fixture("server-strip");
    expect(wledPayload(strip, { state: "ON", brightness: 200, color: "#FF2A00", transition: 0.8, effect: "breathe" })).toEqual({ on: true, bri: 200, transition: 8, seg: [{ col: [[255, 42, 0]], fx: 2 }] });
    expect(wledPayload(strip, { effect: "blink" })).toEqual({ seg: [{ fx: 1 }] });
    expect(wledPayload(strip, { effect: "stop_effect" })).toEqual({ seg: [{ fx: 0 }] });
    expect(wledPayload(strip, { color_temp: 300, brightness: 100 })).toEqual({ bri: 100 });
    expect(wledPayload({ ...strip, safety: false }, { state: "OFF" })).toEqual({ on: false });
    // Clamped: the strip is a safety fixture.
    expect(wledPayload(strip, { state: "OFF" })).toEqual({ on: true, bri: 50 });
  });
});

describe("the shared cases (stagehand mirrors these)", () => {
  const resolve = load<{ cases: Array<{ to: string[]; house?: false; fixtures: string[] }> }>("lights-resolve.json");
  for (const c of resolve.cases) {
    it(`resolve ${JSON.stringify(c.to)}${c.house === false ? " (no house)" : ""}`, () => {
      expect(resolveLightTargets(LIGHTS, c.house === false ? null : HOUSE, c.to)).toEqual({ fixtures: c.fixtures });
    });
  }

  type PlanCase = { look: string; loop: boolean; period: number; repeat: number; restore: boolean; commands: Array<{ at: number; fixture: string; set: LightState; topic: string; payload: Record<string, unknown> }> };
  const plan = load<{ lights: string; house: string; looks: PlanCase[]; clamp: Array<{ fixture: string; set: LightState; out: LightState; topic: string; payload: Record<string, unknown> }> }>("lights-plan.json");

  it("the plan fixture covers every look in lights-basic.json", () => {
    expect(plan.lights).toBe("lights-basic.json");
    expect(plan.house).toBe("lights-house.json");
    expect(plan.looks.map((c) => c.look)).toEqual(Object.keys(LIGHTS.looks));
  });

  for (const c of plan.looks) {
    it(`plan ${c.look}`, () => {
      const p = planLook(LIGHTS, HOUSE, c.look)!;
      expect({ loop: p.loop, period: p.period, repeat: p.repeat, restore: p.restore }).toEqual({ loop: c.loop, period: c.period, repeat: c.repeat, restore: c.restore });
      expect(p.commands).toEqual(c.commands.map(({ at, fixture, set }) => ({ at, fixture, set })));
      for (const cmd of c.commands) {
        const f = fixture(cmd.fixture);
        expect(lightTopic(f)).toBe(cmd.topic);
        expect(f.kind === "wled" ? wledPayload(f, cmd.set) : z2mPayload(f, cmd.set)).toEqual(cmd.payload);
      }
    });
  }

  for (const c of plan.clamp) {
    it(`clamp ${c.fixture} ${JSON.stringify(c.set)}`, () => {
      const f = fixture(c.fixture);
      expect(clampForSafety(f, c.set)).toEqual(c.out);
      expect(lightTopic(f)).toBe(c.topic);
      expect(f.kind === "wled" ? wledPayload(f, c.set) : z2mPayload(f, c.set)).toEqual(c.payload);
    });
  }
});

describe("isLightLookName / lightStateProblems", () => {
  it("a look name is a cue name that is not a screens family", () => {
    expect(isLightLookName("heart_wake")).toBe(true);
    expect(isLightLookName("h2")).toBe(true);
    expect(isLightLookName("Heart_wake")).toBe(false);
    expect(isLightLookName("2heart")).toBe(false);
    expect(isLightLookName("room_heart_wake")).toBe(false);
    expect(isLightLookName("screens_flicker")).toBe(false);
    expect(isLightLookName("")).toBe(false);
  });

  it("checks one state", () => {
    expect(lightStateProblems("set", { state: "ON", brightness: 254, color: "#FF0000", transition: 0 })).toEqual([]);
    expect(lightStateProblems("set", { brightness: 300 })).toEqual(["set.brightness must be a whole number from 0 to 254"]);
    expect(lightStateProblems("set", "red")).toEqual(["set must be an object {state?, brightness?, color?, color_temp?, effect?, transition?}"]);
  });
});
