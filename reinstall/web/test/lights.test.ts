import { describe, expect, it } from "vitest";
import { LIGHT_COLOR_STEP_MIN_MS, LIGHT_LOOP_MIN_PERIOD_MS, defaultLights, validateHouse, validateLights } from "@loom/house";
import type { HouseMap, LightsConfig } from "@loom/house";
import lightsHouseRaw from "../../../house/test/fixtures/lights-house.json";
import lightsBasic from "../../../house/test/fixtures/lights-basic.json";
import type { Z2mDevice } from "../src/map/lights-api.ts";
import {
  addLight,
  addLightZone,
  addLook,
  addLookStep,
  capsText,
  deviceChoices,
  deviceRows,
  duplicateLight,
  duplicateLook,
  emptiedLooks,
  effectivePeriod,
  followHouseLights,
  lastTint,
  LIGHT_HEIGHT,
  LIGHT_SWATCHES,
  lightById,
  lightFloor,
  lightIdError,
  lightProblemList,
  lightSavePlan,
  lightTargetChip,
  lightTargetOptions,
  lightsDropped,
  localPair,
  lookCoverage,
  lookMayReachZigbee,
  lookMode,
  lookNameError,
  lookNameOf,
  lookProblems,
  minPeriod,
  minStepAt,
  moveLight,
  moveLightToRoom,
  normalizeLights,
  pairConfirmText,
  pairSecondsLeft,
  patchLight,
  patchLookStep,
  patchState,
  placeLight,
  rebaseLightsHistory,
  removeLight,
  removeLightConfirm,
  removeLightZone,
  removeLook,
  removeLookStep,
  renameLight,
  renameLightZone,
  renameLook,
  safetyOffText,
  saveEverythingPlan,
  setBoot,
  setLightDevice,
  setLightHeight,
  setLightZoneMember,
  setLookMode,
  setLookPeriod,
  setLookTargets,
  stashedLightsView,
  stepsOfLook,
  swatchSet,
  testable,
  withLightsText,
} from "../src/map/lights.ts";
import { moveRoom } from "../src/map/edit.ts";
import { removeRoom, renameRoom } from "../src/map/structure.ts";
import { SHOW, TWO_ROOMS } from "./houses.ts";

function load(raw: unknown): HouseMap {
  const v = validateHouse(structuredClone(raw));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("; "));
  return v.house;
}
const HOUSE = (): HouseMap => load(lightsHouseRaw);
const BASIC = (): LightsConfig => structuredClone(lightsBasic) as LightsConfig;

/** A fixture placed and given a device: valid against the house. */
function bulbIn(house: HouseMap, room: string, device = "kitchen_bulb"): { lights: LightsConfig; id: string } {
  const r = addLight(defaultLights(), house, room);
  return { lights: patchLight(r.lights, r.id, { device }), id: r.id };
}

describe("placing a light", () => {
  it("hangs a new light 2.1 m above its room's floor — the basement's at −0.6 (the house frame is absolute)", () => {
    const house = HOUSE();
    const r = addLight(defaultLights(), house, "server-room");
    const f = r.lights.fixtures[0]!;
    expect(r.id).toBe("light-1");
    expect(f.pos.y).toBeCloseTo(-2.7 + LIGHT_HEIGHT, 6);
    expect(f.room).toBe("server-room");
    expect(f.floor).toBe("basement");
    expect(f.kind).toBe("zigbee");
    expect(f.device).toBe("");
    // No device yet: a problem saying what to do.
    const p = lightProblemList(r.lights, house);
    expect(p.errors.some((e) => /pick its device/.test(e.text) && e.sel?.kind === "light")).toBe(true);
    const named = patchLight(r.lights, r.id, { device: "server_room_rgb" });
    expect(validateLights(named, house).ok).toBe(true);
  });

  it("places on a click inside a room, null outside", () => {
    const house = HOUSE();
    const r = placeLight(defaultLights(), house, "main", [2, 2])!;
    expect(r.lights.fixtures[0]!.room).toBe("desktop");
    expect(r.lights.fixtures[0]!.pos).toEqual({ x: 2, y: 2.1, z: 2 });
    expect(placeLight(defaultLights(), house, "main", [50, 50])).toBeNull();
  });

  it("in the show's server room, a placed bulb validates on both tent and shed maps' geometry", () => {
    const show = SHOW();
    const r = placeLight(defaultLights(), show, "basement", [4.6, 25.2])!;
    const l = patchLight(r.lights, r.id, { device: "server_room_rgb", safety: true, min: 40 });
    expect(l.fixtures[0]!.pos.y).toBeCloseTo(-0.6, 6);
    expect(validateLights(l, show).ok).toBe(true);
  });

  it("moves, changing room with where it stands, and keeps its height", () => {
    const house = HOUSE();
    const { lights, id } = bulbIn(house, "desktop");
    const m = moveLight(lights, house, id, [3, 5]);
    expect(m.fixtures[0]!.room).toBe("hall");
    expect(m.fixtures[0]!.pos.y).toBe(2.1);
    expect(moveLight(m, house, id, [3, 5])).toBe(m);
    const h = setLightHeight(m, id, 2.4);
    expect(h.fixtures[0]!.pos.y).toBe(2.4);
    expect(lightFloor(house, h.fixtures[0]!)).toBe("main");
  });

  it("moves to another room from the picker: its height kept on the floor, re-hung on another", () => {
    const house = HOUSE();
    const { lights, id } = bulbIn(house, "desktop");
    const hall = moveLightToRoom(setLightHeight(lights, id, 2.5), house, id, "hall");
    expect(hall.fixtures[0]!.room).toBe("hall");
    expect(hall.fixtures[0]!.pos.y).toBe(2.5);
    const down = moveLightToRoom(lights, house, id, "server-room");
    expect(down.fixtures[0]!.floor).toBe("basement");
    expect(down.fixtures[0]!.pos.y).toBeCloseTo(-0.6, 6);
    expect(validateLights(down, house).ok).toBe(true);
  });

  it("is testable only once the server holds it with that device", () => {
    const house = HOUSE();
    const { lights, id } = bulbIn(house, "desktop");
    const f = lights.fixtures[0]!;
    expect(testable(null, f)).toBe(false);
    expect(testable(lights, f)).toBe(true);
    expect(testable(lights, patchLight(lights, id, { device: "other" }).fixtures[0]!)).toBe(false);
    expect(testable(patchLight(lights, id, { device: "" }), patchLight(lights, id, { device: "" }).fixtures[0]!)).toBe(false);
  });

  it("duplicates beside itself with a fresh id and no device (one bulb, one device)", () => {
    const house = HOUSE();
    const { lights, id } = bulbIn(house, "desktop");
    const d = duplicateLight(lights, house, id, 0.5)!;
    expect(d.id).toBe("light-2");
    const copy = d.lights.fixtures[1]!;
    expect(copy.device).toBe("");
    expect(copy.pos.x).toBe(lights.fixtures[0]!.pos.x + 0.5);
  });

  it("renames its id across zones and looks; refuses a bad, taken or reserved one", () => {
    let l = BASIC();
    l = renameLight(l, "server-room-rgb", "heart-bulb");
    expect(l.zones[0]!.fixtures).toEqual(["heart-bulb"]);
    expect(l.looks["server_alarm"]!.steps![1]!.to).toEqual(["heart-bulb"]);
    expect(renameLight(l, "heart-bulb", "Heart Bulb")).toBe(l);
    expect(renameLight(l, "heart-bulb", "desk-lamp")).toBe(l);
    expect(renameLight(l, "heart-bulb", "heart")).toBe(l); // a zone's id
    expect(renameLight(l, "heart-bulb", "everywhere")).toBe(l);
    expect(lightIdError(l, "Bad Id")).toMatch(/lower-case/);
    expect(validateLights(l, HOUSE()).ok).toBe(true);
  });

  it("never stores a safety light's floor under 40 (the server ignores one)", () => {
    const l = BASIC();
    expect(lightById(patchLight(l, "server-room-rgb", { min: 12 }), "server-room-rgb")!.min).toBe(40);
    expect(lightById(patchLight(l, "server-room-rgb", { min: 90 }), "server-room-rgb")!.min).toBe(90);
    expect(lightById(patchLight(l, "desk-lamp", { min: 12 }), "desk-lamp")!.min).toBe(12);
  });

  it("marks the server room's WLED strip a safety light when its topic is typed", () => {
    const { lights, id } = bulbIn(HOUSE(), "server-room", "");
    expect(lightById(setLightDevice(lights, id, "wled/server"), id)!.safety).toBe(true);
    expect(lightById(setLightDevice(lights, id, "wled/attic"), id)!.safety).toBeUndefined();
    expect(safetyOffText({ name: "Server room RGB bulb" })).toMatch(/Server room RGB bulb.*below 40/);
  });

  it("warns when a light saved as safety is no longer safe or is gone from the draft", () => {
    const house = HOUSE();
    const saved = BASIC();
    expect(lightProblemList(saved, house, { saved }).warnings.some((w) => /safety light/.test(w.text))).toBe(false);
    const off = patchLight(saved, "server-room-rgb", { safety: false });
    const w = lightProblemList(off, house, { saved }).warnings.find((x) => /no longer a safety light/.test(x.text))!;
    expect(w.sel).toEqual({ kind: "light", id: "server-room-rgb" });
    const gone = removeLight(saved, "server-room-rgb");
    expect(lightProblemList(gone, house, { saved }).warnings.some((x) => /"server-room-rgb".*deleted/.test(x.text))).toBe(true);
  });

  it("deletes from every zone and target list", () => {
    const l = removeLight(BASIC(), "server-room-rgb");
    expect(l.fixtures.some((f) => f.id === "server-room-rgb")).toBe(false);
    expect(l.zones[0]!.fixtures).toEqual([]);
    // A step left naming nothing falls back to the look's own targets.
    expect(l.looks["server_alarm"]!.steps![1]!.to).toBeUndefined();
  });

  it("asks before a delete leaves a look lighting nothing or takes a safety light", () => {
    const house = HOUSE();
    const l = BASIC();
    const ask = removeLightConfirm(l, house, "server-room-rgb")!;
    expect(ask).toMatch(/safety light/);
    expect(ask).toMatch(/heart_/);
    expect(emptiedLooks(l, removeLightZone(l, "heart"), house).length).toBeGreaterThan(0);
    expect(removeLightConfirm(l, house, "heart")).toMatch(/^Delete zone The Heart\?/);
    expect(removeLightConfirm(l, house, "nope")).toBeNull();
  });

  it("makes a story-cued look that lights nothing an error", () => {
    const house = HOUSE();
    const l = removeLightZone(BASIC(), "heart");
    const dark = emptiedLooks(BASIC(), l, house);
    const p = lightProblemList(l, house, { storyLooks: dark });
    for (const n of dark) expect(p.errors.some((e) => e.text.includes(`look "${n}" is cued by the story but lights nothing`) && e.tab === "lights")).toBe(true);
    expect(lightProblemList(BASIC(), house, { storyLooks: Object.keys(BASIC().looks) }).errors.some((e) => /lights nothing/.test(e.text))).toBe(false);
  });

  it("picks a device: a Zigbee2MQTT bulb brings its caps, a group its kind, a typed wled/ topic makes a strip", () => {
    const house = HOUSE();
    const { lights, id } = bulbIn(house, "desktop", "");
    const bulb: Z2mDevice = { friendly: "0x00158d0001", ieee: "0x00158d0001", type: "Router", model: "LED1624G9", vendor: "IKEA", description: "colour bulb", caps: { color: true, ct: false, dim: true } };
    const a = setLightDevice(lights, id, bulb);
    expect(a.fixtures[0]!.device).toBe("0x00158d0001");
    expect(a.fixtures[0]!.caps).toEqual({ color: true, ct: false, dim: true });
    const g = setLightDevice(a, id, { ...bulb, friendly: "hall_lights", type: "Group" });
    expect(g.fixtures[0]!.kind).toBe("zigbee-group");
    const w = setLightDevice(g, id, " wled/server ");
    expect(w.fixtures[0]!.kind).toBe("wled");
    expect(w.fixtures[0]!.device).toBe("wled/server");
    expect(setLightDevice(w, id, "attic_bulb").fixtures[0]!.kind).toBe("zigbee");
  });

  it("patches safety and its floor (min null drops it)", () => {
    const { lights, id } = bulbIn(HOUSE(), "desktop");
    const s = patchLight(lights, id, { safety: true, min: 60 });
    expect(s.fixtures[0]!.safety).toBe(true);
    expect(s.fixtures[0]!.min).toBe(60);
    const off = patchLight(s, id, { safety: false, min: null });
    expect(off.fixtures[0]!.safety).toBeUndefined();
    expect(off.fixtures[0]!.min).toBeUndefined();
  });
});

describe("the lights follow the map", () => {
  it("a moved room carries its lights", () => {
    const house = TWO_ROOMS();
    const { lights } = bulbIn(house, "a");
    const moved = moveRoom(house, "a", 1, 0);
    const f = followHouseLights(house, moved, lights);
    expect(f.fixtures[0]!.pos.x).toBeCloseTo(lights.fixtures[0]!.pos.x + 1, 6);
    expect(followHouseLights(house, house, lights)).toBe(lights);
  });

  it("a renamed room is followed; a deleted room takes its lights (counted in the confirm)", () => {
    const house = TWO_ROOMS();
    const { lights } = bulbIn(house, "b");
    const renamed = renameRoom(house, "b", "bee");
    expect(followHouseLights(house, renamed, lights).fixtures[0]!.room).toBe("bee");
    const gone = removeRoom(house, "b");
    if ("error" in gone) throw new Error(gone.error);
    expect(lightsDropped(house, gone.house, lights)).toEqual(["light-1"]);
    expect(followHouseLights(house, gone.house, lights).fixtures).toEqual([]);
    expect(withLightsText("Delete the room “B” with 1 door?", 1)).toBe("Delete the room “B” with 1 door and 1 light?");
    expect(withLightsText("Delete the room “B”?", 2)).toBe("Delete the room “B” with 2 lights?");
  });

  it("a raised floor lifts them", () => {
    const house = TWO_ROOMS();
    const { lights } = bulbIn(house, "a");
    const raised: HouseMap = { ...house, floors: house.floors.map((f) => ({ ...f, elevation: f.elevation + 1 })) };
    expect(followHouseLights(house, raised, lights).fixtures[0]!.pos.y).toBeCloseTo(3.1, 6);
  });
});

describe("light zones", () => {
  it("adds, renames (looks naming it by name keep reaching it), toggles members and removes", () => {
    let l = BASIC();
    const z = addLightZone(l, "Basement", ["server-room-rgb"]);
    expect(z.id).toBe("basement");
    l = z.lights;
    l = setLightZoneMember(l, "basement", "server-strip", true);
    expect(l.zones.find((x) => x.id === "basement")!.fixtures).toEqual(["server-room-rgb", "server-strip"]);
    // "Up Stairs" is named by its name in upstairs_off.
    l = renameLightZone(l, "upstairs", "Top");
    expect(l.looks["upstairs_off"]!.to).toEqual(["upstairs"]);
    l = removeLightZone(l, "upstairs");
    expect(l.looks["upstairs_off"]!.to).toEqual([]);
    expect(addLightZone(l, "everywhere").id).toBe("zone");
    expect(addLightZone(l, "Desk Lamp").id).toBe("desk-lamp-2");
  });
});

describe("look targets", () => {
  it("offers everywhere, zones, LOCATIONs, rooms and fixtures, and labels a chip", () => {
    const opts = lightTargetOptions(BASIC(), HOUSE(), null);
    expect(opts[0]!.kind).toBe("everywhere");
    expect(opts.some((o) => o.kind === "location" && o.value === "The Server Room")).toBe(true);
    expect(lightTargetChip(opts, "heart").text).toBe("◎ The Heart");
    expect(lightTargetChip(opts, "Up Stairs").kind).toBe("zone");
    expect(lightTargetChip(opts, "server-room-rgb").text).toBe("💡 Server room RGB bulb");
    expect(lightTargetChip(opts, "nowhere").kind).toBeNull();
  });
});

describe("the looks builder", () => {
  const base = () => {
    const house = HOUSE();
    const l = patchLight(addLight(defaultLights(), house, "server-room").lights, "light-1", { device: "server_room_rgb", safety: true, min: 40 });
    return { house, l: addLightZone(l, "The Heart", ["light-1"]).lights };
  };

  it("names a look as the story cues it, refusing a screens cue or a taken name", () => {
    const { l } = base();
    expect(lookNameOf(" Heart Wake! ")).toBe("heart_wake");
    expect(lookNameOf("2 fast")).toBe("fast");
    expect(lookNameError(l, "room_heart")).toMatch(/screens/);
    expect(lookNameError(l, "Heart")).toMatch(/lower-case/);
    const a = addLook(l, "heart_idle", ["heart"]);
    if ("error" in a) throw new Error(a.error);
    expect(lookNameError(a.lights, "heart_idle")).toMatch(/already/);
    expect("error" in addLook(a.lights, "heart_idle", [])).toBe(true);
  });

  it("builds §4's heart_wake step by step and validateLights accepts it", () => {
    const { house, l } = base();
    const a = addLook(l, "heart_wake", ["heart"]);
    if ("error" in a) throw new Error(a.error);
    let x = patchLookStep(a.lights, "heart_wake", 0, { set: { color: "#FF2A00", brightness: 254, transition: 0 } });
    for (let i = 0; i < 4; i++) x = addLookStep(x, "heart_wake");
    const steps = stepsOfLook(x.looks["heart_wake"]!);
    expect(steps).toHaveLength(5);
    // Each added step is far enough for a colour change, and swells the other way.
    expect(steps[1]!.at).toBeGreaterThanOrEqual(LIGHT_COLOR_STEP_MIN_MS);
    expect(steps[1]!.set.brightness).toBe(60);
    expect(steps[2]!.set.brightness).toBe(254);
    x = patchLookStep(x, "heart_wake", 4, { set: { color: "#00E5FF", brightness: 120, transition: 3 } });
    const v = validateLights(x, house);
    expect(v.problems).toEqual([]);
    expect(x.looks["heart_wake"]!.steps).toBeDefined();
  });

  it("a one-step look at 0 is written as `set`; a step's own targets keep it as steps", () => {
    const { l } = base();
    const a = addLook(l, "heart_idle", ["heart"]);
    if ("error" in a) throw new Error(a.error);
    expect(a.lights.looks["heart_idle"]!.set).toBeDefined();
    let x = addLookStep(a.lights, "heart_idle");
    expect(x.looks["heart_idle"]!.steps).toHaveLength(2);
    x = removeLookStep(x, "heart_idle", 1);
    expect(x.looks["heart_idle"]!.set).toBeDefined();
    expect(x.looks["heart_idle"]!.steps).toBeUndefined();
    // The last step can't go.
    expect(removeLookStep(x, "heart_idle", 0)).toBe(x);
    const t = patchLookStep(x, "heart_idle", 0, { to: ["light-1"] });
    expect(t.looks["heart_idle"]!.steps![0]!.to).toEqual(["light-1"]);
  });

  it("re-sorts steps by at, and says how early a step may come", () => {
    const { l } = base();
    const a = addLook(l, "x", ["heart"]);
    if ("error" in a) throw new Error(a.error);
    let x = addLookStep(addLookStep(a.lights, "x"), "x");
    x = patchLookStep(x, "x", 2, { at: 100 });
    const steps = stepsOfLook(x.looks["x"]!);
    expect(steps.map((s) => s.at)).toEqual([0, 100, 400]);
    expect(minStepAt(steps, 1)).toBe(150);
    expect(validateLights(x).problems.some((p) => /100 ms after/.test(p))).toBe(true);
    expect(lookProblems(validateLights(x).problems, "x")[0]).toMatch(/^step 2/);
  });

  it("colour and colour temperature replace each other", () => {
    expect(patchState({ color: "#FF0000" }, { color_temp: 300 })).toEqual({ color_temp: 300 });
    expect(patchState({ color_temp: 300, brightness: 9 }, { color: "#00FF00", brightness: null })).toEqual({ color: "#00FF00" });
  });

  it("a loop, a repeat or a give-back gets a period that keeps the Zigbee gap across the wrap (Stage A's wrap rule)", () => {
    const { house, l } = base();
    const a = addLook(l, "heart_door_open", ["heart"]);
    if ("error" in a) throw new Error(a.error);
    let x = patchLookStep(a.lights, "heart_door_open", 0, { set: { color: "#FF6A00", transition: 0.8 } });
    x = addLookStep(x, "heart_door_open");
    for (const mode of ["loop", "repeat", "restore"] as const) {
      const m = setLookMode(x, "heart_door_open", mode, 3);
      expect(lookMode(m.looks["heart_door_open"]!)).toBe(mode);
      const v = validateLights(m, house);
      expect(v.problems).toEqual([]);
      if (mode !== "restore") expect(m.looks["heart_door_open"]!.period!).toBeGreaterThanOrEqual(LIGHT_LOOP_MIN_PERIOD_MS);
    }
    const loop = setLookMode(x, "heart_door_open", "loop");
    expect(minPeriod(loop.looks["heart_door_open"]!)).toBe(1500);
    // A hand-set period too short for the wrap is a problem the builder shows.
    const short = setLookPeriod(loop, "heart_door_open", 500);
    expect(validateLights(short, house).problems.some((p) => /lengthen period|ends before/.test(p))).toBe(true);
    // Back to once drops the period and the repeat.
    const once = setLookMode(loop, "heart_door_open", "once");
    expect(once.looks["heart_door_open"]!.period).toBeUndefined();
    expect(once.looks["heart_door_open"]!.loop).toBeUndefined();
  });

  it("keeps a safe period after a step moves past it or the first step is dropped", () => {
    const { house, l } = base();
    const a = addLook(l, "heart_door_open", ["heart"]);
    if ("error" in a) throw new Error(a.error);
    let x = patchLookStep(a.lights, "heart_door_open", 0, { set: { color: "#FF6A00", transition: 0.8 } });
    x = addLookStep(x, "heart_door_open");
    for (const mode of ["loop", "repeat", "restore"] as const) {
      const m = setLookMode(x, "heart_door_open", mode, 3);
      // Move the last step past the period the mode set.
      const moved = patchLookStep(m, "heart_door_open", 1, { at: 2400 });
      expect(validateLights(moved, house).problems).toEqual([]);
      if (mode !== "restore") expect(moved.looks["heart_door_open"]!.period!).toBeGreaterThan(2400);
      // Drop the first step (the colour one the wrap lands on).
      const dropped = removeLookStep(moved, "heart_door_open", 0);
      expect(validateLights(dropped, house).problems).toEqual([]);
    }
  });

  it("takes the colour gap when any step at the first moment sets a colour", () => {
    const l = BASIC();
    l.looks["two"] = {
      to: ["server-room-rgb", "desk-lamp"],
      loop: true,
      steps: [
        { at: 0, set: { brightness: 200 }, to: ["desk-lamp"] },
        { at: 0, set: { color: "#FF0000" }, to: ["server-room-rgb"] },
        { at: 1200, set: { brightness: 90 }, to: ["server-room-rgb", "desk-lamp"] },
      ],
    };
    expect(minPeriod(l.looks["two"]!)).toBe(1200 + LIGHT_COLOR_STEP_MIN_MS);
    const fixed = setLookMode(l, "two", "loop");
    expect(validateLights(fixed, HOUSE()).problems.filter((p) => p.includes('"two"'))).toEqual([]);
  });

  it("holds only a look that can reach Zigbee to the 1.5 s repeat floor (a WLED double flash stays quick)", () => {
    const l = BASIC();
    const a = addLook(l, "strip_flash", ["server-strip"]);
    if ("error" in a) throw new Error(a.error);
    let x = patchLookStep(a.lights, "strip_flash", 0, { set: { state: "ON", brightness: 254 } });
    x = addLookStep(x, "strip_flash");
    x = patchLookStep(x, "strip_flash", 1, { at: 150 });
    const rep = setLookMode(x, "strip_flash", "repeat", 2);
    expect(effectivePeriod(rep.looks["strip_flash"]!)).toBeLessThan(LIGHT_LOOP_MIN_PERIOD_MS);
    expect(validateLights(rep, HOUSE()).problems.filter((p) => p.includes("strip_flash"))).toEqual([]);
    // The same look on the RGB bulb (Zigbee) keeps the floor.
    const zig = setLookMode(setLookTargets(x, "strip_flash", ["server-room-rgb"]), "strip_flash", "repeat", 2);
    expect(zig.looks["strip_flash"]!.period!).toBeGreaterThanOrEqual(LIGHT_LOOP_MIN_PERIOD_MS);
    // A name only the map resolves is taken to reach Zigbee.
    expect(lookMayReachZigbee(x, { to: ["The Desktop"], set: { brightness: 9 } })).toBe(true);
    expect(lookMayReachZigbee(x, { to: ["server-strip"], set: { brightness: 9 } })).toBe(false);
  });

  it("refuses a step that darkens a safety bulb (the builder shows the validator's line)", () => {
    const { house, l } = base();
    const a = addLook(l, "dark", ["heart"]);
    if ("error" in a) throw new Error(a.error);
    const x = patchLookStep(a.lights, "dark", 0, { set: { state: "OFF" } });
    expect(lookProblems(validateLights(x, house).problems, "dark").join(" ")).toMatch(/OFF/);
  });

  it("renames (the boot follows), duplicates, retargets, removes", () => {
    let l = BASIC();
    l = renameLook(l, "heart_idle", "heart_rest");
    expect(l.boot).toBe("heart_rest");
    expect(l.looks["heart_idle"]).toBeUndefined();
    expect(renameLook(l, "heart_rest", "heart_wake")).toBe(l);
    const d = duplicateLook(l, "heart_rest")!;
    expect(d.name).toBe("heart_rest_2");
    l = setLookTargets(d.lights, "heart_rest_2", ["heart", " heart ", ""]);
    expect(l.looks["heart_rest_2"]!.to).toEqual(["heart"]);
    l = removeLook(l, "heart_rest");
    expect(l.boot).toBeUndefined();
    l = setBoot(l, "heart_wake");
    expect(l.boot).toBe("heart_wake");
    expect(setBoot(l, "nope")).toBe(l);
  });

  it("says which story cues have no look and which looks no cue plays", () => {
    const c = lookCoverage(BASIC(), ["heart_idle", "heart_proof"]);
    expect(c.unwritten).toEqual(["heart_proof"]);
    expect(c.uncued).toContain("heart_wake");
    expect(c.uncued).not.toContain("heart_idle");
  });
});

describe("devices, swatches, pairing", () => {
  const dev = (friendly: string, type = "Router", caps: Z2mDevice["caps"] = { color: true, ct: true, dim: true }): Z2mDevice => ({ friendly, ieee: `0x${friendly}`, type, model: null, vendor: null, description: null, caps });

  it("lists unplaced lights first, then placed ones, groups, non-lights; never the coordinator", () => {
    const l = BASIC();
    const rows = deviceRows([dev("server_room_rgb"), dev("Coordinator", "Coordinator", null), dev("door_sensor", "EndDevice", null), dev("hall_lights", "Group"), dev("new_bulb"), dev("a_new_bulb")], l);
    expect(rows.map((r) => r.device.friendly)).toEqual(["a_new_bulb", "new_bulb", "server_room_rgb", "hall_lights", "door_sensor"]);
    expect(rows[2]!.placed).toEqual(["server-room-rgb"]);
    const choices = deviceChoices([dev("server_room_rgb"), dev("new_bulb"), dev("door_sensor", "EndDevice", null)], l, "server-room-rgb");
    expect(choices.map((c) => [c.device.friendly, c.note])).toEqual([
      ["new_bulb", "not placed yet"],
      ["server_room_rgb", "this light"],
    ]);
    expect(capsText({ color: true, ct: false, dim: true })).toBe("colour · dim");
    expect(capsText(null)).toBe("not a light");
  });

  it("a swatch sends what the bulb can do, and never nothing", () => {
    const rgb = BASIC().fixtures[0]!;
    const red = LIGHT_SWATCHES.find((s) => s.id === "red")!;
    const white = LIGHT_SWATCHES.find((s) => s.id === "white")!;
    expect(swatchSet(rgb, red)).toEqual({ state: "ON", brightness: 254, color: "#FF0000", transition: 0.3 });
    expect(swatchSet(rgb, white).color_temp).toBe(250);
    const lamp = BASIC().fixtures.find((f) => f.id === "desk-lamp")!;
    expect(swatchSet(lamp, red)).toEqual({ state: "ON", brightness: 254, transition: 0.3 });
    const strip = BASIC().fixtures.find((f) => f.id === "server-strip")!;
    expect(swatchSet(strip, white).color).toBe("#FFFFFF");
  });

  it("tints a bulb with its last tested colour", () => {
    const tests = [
      { seq: 1, at: 1, fixture: "a", look: null, set: { color: "#FF0000" }, by: "" },
      { seq: 2, at: 2, fixture: "b", look: null, set: { color: "#00FF00" }, by: "" },
      { seq: 3, at: 3, fixture: "a", look: null, set: null, by: "" },
    ];
    expect(lastTint(tests, "a")).toBe("#FF0000");
    expect(lastTint(tests, "c")).toBeNull();
  });

  it("runs a pairing's countdown on this browser's clock, whatever the server's says", () => {
    // The server's clock is 50 s ahead of the browser's.
    const server = { seq: 4, at: 1_050_000, seconds: 120, until: 1_170_000, by: "x" };
    const seen = localPair(null, server, 1_000_000)!;
    expect(pairSecondsLeft(seen, 1_000_000)).toBe(120);
    expect(pairSecondsLeft(seen, 1_060_000)).toBe(60);
    // The same pairing again (a later poll) keeps its first local times.
    expect(localPair(seen, server, 1_030_000)).toBe(seen);
    // A stop is a new entry; closed is null.
    expect(pairSecondsLeft(localPair(seen, { ...server, seq: 5, seconds: 0, until: server.at }, 1_040_000), 1_040_000)).toBe(0);
    expect(localPair(seen, null, 1_040_000)).toBeNull();
  });

  it("asks before opening a pairing window", () => {
    expect(pairConfirmText(120)).toMatch(/^Open pairing for 2 minutes\?.*doors are open/);
    expect(pairConfirmText(30)).toMatch(/30 s/);
  });

  it("counts a pairing window down off its until", () => {
    const p = { seq: 1, at: 0, seconds: 120, until: 120_000, by: "x" };
    expect(pairSecondsLeft(p, 0)).toBe(120);
    expect(pairSecondsLeft(p, 119_001)).toBe(1);
    expect(pairSecondsLeft(p, 130_000)).toBe(0);
    expect(pairSecondsLeft({ ...p, seconds: 0 }, 0)).toBe(0);
    expect(pairSecondsLeft(null, 0)).toBe(0);
  });
});

describe("problems, history, saving", () => {
  it("names a fixture's problem so a click selects it; the rest open the tab", () => {
    const house = HOUSE();
    const l = BASIC();
    l.fixtures[0]!.pos.y = 5; // not on the basement
    l.looks["broken"] = { to: ["heart"] } as never;
    const p = lightProblemList(l, house);
    expect(p.errors.find((e) => /y 5/.test(e.text))!.sel).toEqual({ kind: "light", id: "server-room-rgb" });
    expect(p.errors.find((e) => /broken/.test(e.text))!.tab).toBe("lights");
    expect(p.errors.every((e) => e.text.startsWith("💡 "))).toBe(true);
  });

  it("offers a remote save that landed during ours once ours settles, never our own echo", () => {
    const remote = { version: "r2" };
    expect(stashedLightsView(remote, "mine")).toBe(remote);
    expect(stashedLightsView({ version: "mine" }, "mine")).toBeNull();
    expect(stashedLightsView(null, "mine")).toBeNull();
  });

  it("normalizes whatever the server sends", () => {
    expect(normalizeLights(null)).toEqual(defaultLights());
    expect(normalizeLights({ version: 1, fixtures: [] })).toEqual({ version: 1, fixtures: [], zones: [], looks: {} });
  });

  it("rebases the undo history on another director's lights save: map and speaker steps stay, lights-only steps go", () => {
    const h0 = TWO_ROOMS();
    const h1 = moveRoom(h0, "a", 1, 0);
    const audio = { version: 1 } as never;
    const l0 = defaultLights();
    const l1 = addLight(l0, h1, "a").lights;
    const theirs = addLight(l0, h0, "b").lights;
    // past: [map h0], [lights-only step on h1]; present h1 + l1
    const hist = { past: [{ house: h0, audio, lights: l0 }, { house: h1, audio, lights: l0 }], future: [] };
    const r = rebaseLightsHistory(hist, { house: h1, audio, lights: l1 }, theirs);
    expect(r.past.map((d) => d.house)).toEqual([h0]);
    expect(r.past[0]!.lights).toBe(theirs);
  });

  it("saves the lights alone against the saved map, with the map when only the draft fits", () => {
    const base = { lightsDirty: true, status: "ok" as const, mapDirty: false, mapSaveable: true, validDraft: true, validSaved: true };
    expect(lightSavePlan({ ...base, lightsDirty: false })).toEqual({ alone: false, withMap: false, why: null });
    expect(lightSavePlan(base)).toEqual({ alone: true, withMap: false, why: null });
    expect(lightSavePlan({ ...base, mapDirty: true, validSaved: false })).toEqual({ alone: false, withMap: true, why: null });
    expect(lightSavePlan({ ...base, validDraft: false, validSaved: false }).why).toMatch(/light problems/);
    expect(lightSavePlan({ ...base, status: "missing" }).why).toMatch(/wave 20/);
    const none = { alone: false, withMap: false };
    expect(saveEverythingPlan({ mapDirty: true, mapSaveable: true, speakers: none, lights: { alone: true, withMap: true, why: null } })).toEqual({ map: true, speakers: false, lights: true });
    expect(saveEverythingPlan({ mapDirty: false, mapSaveable: true, speakers: { alone: true, withMap: false }, lights: { alone: true, withMap: false, why: null } })).toEqual({ map: false, speakers: true, lights: true });
  });
});
