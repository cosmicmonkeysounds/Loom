//! Wave 20: `server/lights.ts`'s pure helpers and `LightsHub` on its own —
//! the project-file readers, `storyLooks`, the module's device records, and
//! what is in force (a director's save > the project's snapshot >
//! `LOOM_LIGHTS` > the default) with the Store round trip.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { defaultLights, lightsHash, type LightsConfig } from "@loom/house";

import { LIGHTS_FILE, LightsHub, isLightsFile, lightsFileOf, lightsFileText, lightsOf, lightsProblems, parseZ2mDevice, storyLooks } from "../server/lights.ts";
import { Store } from "../server/store.ts";
import { exampleLights, planLightsSync, syncOptions } from "../scripts/sync-example.ts";
import { Sim } from "../src/runtime/sim/index.ts";

const LIGHTS_TEXT = readFileSync(join(import.meta.dirname, "..", "..", "house", "test", "fixtures", "lights-basic.json"), "utf8");
const LIGHTS = JSON.parse(LIGHTS_TEXT) as LightsConfig;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-lights-hub-"));
  dirs.push(d);
  return d;
}

describe("the project file", () => {
  it("is lights.json at the project's root; an empty one is none", () => {
    expect(LIGHTS_FILE).toBe("lights.json");
    expect(isLightsFile("lights.json")).toBe(true);
    expect(isLightsFile("maps/lights.json")).toBe(false);
    expect(lightsFileOf([{ path: "main.loom", content: "x" }, { path: "lights.json", content: LIGHTS_TEXT }])).toBe(LIGHTS_TEXT);
    expect(lightsFileOf([{ path: "lights.json", content: " \n" }])).toBeNull();
    expect(lightsFileOf([{ path: "audio.json", content: "{}" }])).toBeNull();
  });

  it("lightsOf reads an untrusted record; lightsProblems checks the shape (no house)", () => {
    expect(lightsOf({ "lights.json": "x", "house.json": "{}" })).toBe("x");
    expect(lightsOf({ "lights.json": 3 })).toBeNull();
    expect(lightsOf(null)).toBeNull();
    expect(lightsOf(["lights.json"])).toBeNull();
    expect(lightsProblems(LIGHTS_TEXT)).toEqual([]);
    expect(lightsProblems("{")[0]).toMatch(/^not JSON/u);
    expect(lightsProblems(JSON.stringify({ ...LIGHTS, boot: "nope" }))).toEqual(['boot names no look ("nope")']);
    expect(lightsFileText(LIGHTS)).toBe(`${JSON.stringify(LIGHTS, null, 2)}\n`);
  });
});

describe("storyLooks", () => {
  it("lists every cue that can be a look, sorted and deduped; screens families, soundtrack scenes and odd names left out", () => {
    const story = `# T\n\nLOCATION The Server Room\n\nwhen heart opens:\n  cue heart_wake\n\n== Boot\n  setting: The Server Room\ncue heart_idle\ncue room_heart_wake\ncue tv_static\ncue music_off\ncue Heart_Loud\n<cue: lights_y2k, fade: 2>\ncue heart_idle\nHello.\n`;
    expect(storyLooks(Sim.fromSources(story).model)).toEqual(["heart_idle", "heart_wake", "lights_y2k"]);
    expect(storyLooks(null)).toEqual([]);
  });
});

describe("parseZ2mDevice", () => {
  const ok = { friendly: "server_room_rgb", ieee: "0x01", type: "Router", model: "LCT015", vendor: "Philips", description: "bulb", caps: { color: true, ct: false, dim: true } };
  it("takes a device or a group, null fields and caps allowed", () => {
    expect(parseZ2mDevice(ok)).toEqual(ok);
    expect(parseZ2mDevice({ friendly: "g", ieee: "group:1", type: "Group", model: null, vendor: null, description: null, caps: null, members: ["a"] })).toEqual({ friendly: "g", ieee: "group:1", type: "Group", model: null, vendor: null, description: null, caps: null, members: ["a"] });
    // Absent optional fields read as null.
    expect(parseZ2mDevice({ friendly: "c", ieee: "0x00", type: "Coordinator" })).toEqual({ friendly: "c", ieee: "0x00", type: "Coordinator", model: null, vendor: null, description: null, caps: null });
  });

  it("refuses a malformed one and cuts long strings", () => {
    expect(parseZ2mDevice(null)).toBeNull();
    expect(parseZ2mDevice({ ...ok, friendly: " " })).toBeNull();
    expect(parseZ2mDevice({ ...ok, ieee: 1 })).toBeNull();
    expect(parseZ2mDevice({ ...ok, model: 5 })).toBeNull();
    expect(parseZ2mDevice({ ...ok, caps: { color: "yes", ct: false, dim: true } })).toBeNull();
    expect(parseZ2mDevice({ ...ok, members: "a" })).toBeNull();
    expect(parseZ2mDevice({ ...ok, description: "x".repeat(1000) })!.description).toHaveLength(256);
  });
});

describe("LightsHub", () => {
  it("director > project > env > default; the store keeps the snapshot and the save", () => {
    const dir = freshDir();
    const env = join(dir, "env.json");
    writeFileSync(env, JSON.stringify({ ...LIGHTS, note: "env" }));
    const store = new Store(join(dir, "evt"));
    const bare = new LightsHub({ store: new Store(join(dir, "bare")) });
    expect(bare.current()).toEqual({ lights: defaultLights(), version: lightsHash(defaultLights()), source: "default" });
    const hub = new LightsHub({ store, projectText: LIGHTS_TEXT, envFile: env });
    expect(hub.current().source).toBe("project");
    expect(store.loadLights()).toBe(LIGHTS_TEXT);
    hub.setProjectText(null);
    expect(hub.current().source).toBe("env");
    hub.setProjectText(LIGHTS_TEXT);
    const saved = { ...LIGHTS, note: "director" };
    expect(hub.save(saved, "", null)).toMatchObject({ status: 200 });
    expect(hub.current()).toMatchObject({ source: "director", lights: saved });
    // A fresh hub on the same store reads both back (no row snapshot given).
    const again = new LightsHub({ store });
    expect(again.project).toBe(LIGHTS_TEXT);
    expect(again.current().source).toBe("director");
    // Save to project drops the director's save from the store too.
    again.savedToProject(lightsFileText(saved));
    expect(store.loadLightsSave()).toBeNull();
    expect(new LightsHub({ store }).current()).toMatchObject({ source: "project", lights: saved });
  });

  it("an invalid director save on disk is ignored", () => {
    const dir = freshDir();
    const store = new Store(dir);
    store.saveLightsSave({ version: 9 });
    expect(new LightsHub({ store, projectText: LIGHTS_TEXT }).current().source).toBe("project");
  });

  it("a stale base is refused before validation; a bad save keeps the old one", () => {
    const hub = new LightsHub({ store: new Store(freshDir()), projectText: LIGHTS_TEXT });
    const v = hub.current().version;
    expect(hub.save(LIGHTS, "00000000", null)).toEqual({ status: 409, body: { error: "stale", version: v, source: "project" } });
    expect(hub.save({ version: 2 }, v, null)).toMatchObject({ status: 400, body: { problems: ["version must be 1", "fixtures must be a list", "zones must be a list", "looks must be an object {cue name: look}"] } });
    expect(hub.current().version).toBe(v);
  });
});

describe("sync-example: lights.json goes like a map, on its own switch", () => {
  it("--replace-maps / --replace-audio never touch lights.json; --replace-lights / --keep-lights do", () => {
    expect(syncOptions(["Trapped", "--replace-maps", "--replace-audio"], {})).toMatchObject({ mapMode: "replace", audioMode: "replace", lightsMode: "merge" });
    expect(syncOptions(["Trapped", "--replace-lights"], {})).toMatchObject({ mapMode: "merge", audioMode: "merge", lightsMode: "replace" });
    expect(syncOptions(["Trapped", "--keep-lights", "--keep-audio"], {})).toMatchObject({ audioMode: "keep", lightsMode: "keep" });
  });

  it("merge adds it when the project has none and keeps a differing copy; replace and keep; a broken kept copy stops the sync", () => {
    const ex = { "lights.json": LIGHTS_TEXT };
    const mine = JSON.stringify({ ...LIGHTS, note: "placed in the house" });
    expect(planLightsSync({}, ex, "merge")).toEqual({ text: LIGHTS_TEXT, put: true, kept: false, replaced: null });
    expect(planLightsSync({ "lights.json": mine }, ex, "merge")).toEqual({ text: mine, put: false, kept: true, replaced: null });
    expect(planLightsSync({ "lights.json": mine }, ex, "replace")).toEqual({ text: LIGHTS_TEXT, put: true, kept: false, replaced: mine });
    expect(planLightsSync({ "lights.json": mine }, ex, "keep")).toEqual({ text: mine, put: false, kept: false, replaced: null });
    expect(planLightsSync({ "lights.json": mine }, {}, "replace")).toEqual({ text: null, put: false, kept: false, replaced: mine });
    expect(planLightsSync({}, {}, "merge")).toEqual({ text: null, put: false, kept: false, replaced: null });
    expect(() => planLightsSync({ "lights.json": '{"version":2}' }, ex, "merge")).toThrow(/project's lights\.json does not validate/u);
    expect(exampleLights("glass-orchard")).toEqual({});
  });
});
