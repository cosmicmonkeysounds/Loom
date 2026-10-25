//! Wave 20: the house lights' config on an event (`server/lights.ts`): what
//! is in force (a director's save > the project's snapshot > `LOOM_LIGHTS` >
//! the default), `GET /api/mod/lights` with the story's looks and LOCATIONs,
//! the director's save (400 problems, 409 stale), Save to project, tests,
//! the module's device list, pairing, its presence, and the long poll the
//! lights module holds.

import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import type { LightsConfig } from "@loom/house";

import { EventRuntime } from "../server/event-runtime.ts";
import { snapshotDiffers } from "../server/events-api.ts";
import { LIGHT_DEVICES_MAX, LIGHT_TEST_MS, LIGHT_TESTS, LIGHTS_MODULE_ONLINE_MS, lightsOf, type LightsView, type Z2mDevice } from "../server/lights.ts";
import type { MapFiles, ProjectLink } from "../server/house-maps.ts";
import { Store } from "../server/store.ts";

const FIX = join(import.meta.dirname, "..", "..", "house", "test", "fixtures");
const HOUSE_FILE = join(FIX, "lights-house.json");
const LIGHTS_TEXT = readFileSync(join(FIX, "lights-basic.json"), "utf8");
const LIGHTS = JSON.parse(LIGHTS_TEXT) as LightsConfig;
const CODES = { event: "EVTLIT", prime: "PRMLIT", mod: "MODLIT" };
const STORY = `# T\n\nLOCATION The Server Room\n\nLOCATION The Tube\n\nCHARACTER Task Manager\n  admin: true\n  when scanned by guest:\n    reply ok\n\nwhen print:\n  cue heart_wake\n\n== Boot\n  setting: The Server Room\ncue heart_idle\ncue room_heart_wake\ncue screens_flicker\n<cue: lights_y2k, fade: 2>\ncue heart_idle\nHello.\n`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-lights-"));
  dirs.push(d);
  return d;
}

function fakeReq(body: unknown, headers: Record<string, string> = {}) {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
}
function fakeRes() {
  const res = {
    statusCode: 0,
    body: "",
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write() {
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, method: string, p: string, body: unknown = {}, o: { moderator?: boolean; token?: string } = { moderator: true }) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, { moderator: o.moderator ?? false });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
const view = async (rt: EventRuntime, q = ""): Promise<LightsView> => (await call(rt, "GET", `/api/mod/lights${q}`)).json as unknown as LightsView;

function fakeProject() {
  const files = new Map<string, string>();
  const snapshots: MapFiles[] = [];
  const link: ProjectLink = {
    projectId: "proj-a",
    async writeFile(path, content) {
      files.set(path, content);
    },
    async saveSnapshot(maps) {
      snapshots.push(maps);
    },
    async saveVariant() {},
  };
  return { link, files, snapshots };
}

function runtime(o: { dir?: string; lights?: string | null; lightsFile?: string | null; project?: ProjectLink | null; now?: () => number } = {}): EventRuntime {
  return new EventRuntime({
    eventId: "evt",
    store: new Store(o.dir ?? freshDir()),
    codes: CODES,
    scenarioName: "t",
    scenarioSource: STORY,
    joinBase: () => "http://localhost",
    houseFile: HOUSE_FILE,
    audioFile: null,
    lightsFile: o.lightsFile ?? null,
    ...(o.lights !== undefined ? { lights: o.lights } : {}),
    ...(o.project !== undefined ? { project: o.project } : {}),
    ...(o.now !== undefined ? { now: o.now } : {}),
  });
}

const DEVICE: Z2mDevice = { friendly: "server_room_rgb", ieee: "0x0017880100000001", type: "Router", model: "LCT015", vendor: "Philips", description: "Hue colour bulb", caps: { color: true, ct: true, dim: true } };
const GROUP: Z2mDevice = { friendly: "hall_lights", ieee: "group:3", type: "Group", model: null, vendor: null, description: null, caps: null, members: ["hall_1", "hall_2"] };

describe("GET /api/mod/lights", () => {
  it("needs the mod capability; a fresh event plays the default; the story's looks + LOCATIONs ride it", async () => {
    const rt = runtime();
    expect((await call(rt, "GET", "/api/mod/lights", {}, {})).status).toBe(403);
    const v = await view(rt);
    expect(v.source).toBe("default");
    expect(v.version).toMatch(/^[0-9a-f]{8}$/u);
    expect(v.lights).toEqual({ version: 1, fixtures: [], zones: [], looks: {} });
    // `room_*` / `screens_*` are the screens' cue families, never a look.
    expect(v.looks).toEqual(["heart_idle", "heart_wake", "lights_y2k"]);
    expect(v.locations).toEqual(["The Server Room", "The Tube"]);
    expect(v).toMatchObject({ tests: [], pair: null, devices: [], devicesAt: null, module: null, problems: [], warnings: [] });
    rt.dispose();
  });

  it("the project's snapshot, then LOOM_LIGHTS (re-read on mtime, the last good kept); a broken project file falls through", async () => {
    const dir = freshDir();
    const env = join(dir, "env-lights.json");
    writeFileSync(env, JSON.stringify({ ...LIGHTS, note: "env" }));
    const withEnv = runtime({ lightsFile: env });
    const e1 = await view(withEnv);
    expect(e1.source).toBe("env");
    expect(e1.lights.note).toBe("env");
    // An edit is picked up; a broken edit keeps the last good file.
    writeFileSync(env, JSON.stringify({ ...LIGHTS, note: "env 2" }));
    utimesSync(env, new Date(), new Date(Date.now() + 5000));
    expect((await view(withEnv)).lights.note).toBe("env 2");
    writeFileSync(env, "{ half");
    utimesSync(env, new Date(), new Date(Date.now() + 10_000));
    expect((await view(withEnv)).lights.note).toBe("env 2");
    withEnv.dispose();
    const project = runtime({ lights: LIGHTS_TEXT, lightsFile: env });
    const v = await view(project);
    expect(v.source).toBe("project");
    expect(v.lights.fixtures.map((f) => f.id)).toContain("server-room-rgb");
    expect(v.problems).toEqual([]);
    project.dispose();
    writeFileSync(env, JSON.stringify(LIGHTS));
    expect((await view(runtime({ lights: "{ nope", lightsFile: env }))).source).toBe("env");
  });
});

describe("POST /api/mod/lights — the director's save", () => {
  it("validates against the house in force (400 problems), saves, wins over the project, survives a restart", async () => {
    const dir = freshDir();
    const rt = runtime({ dir, lights: LIGHTS_TEXT });
    const before = await view(rt);
    const bad = structuredClone(LIGHTS);
    bad.fixtures[2]!.room = "kitchen";
    const r400 = await call(rt, "POST", "/api/mod/lights", { lights: bad, base: before.version });
    expect(r400.status).toBe(400);
    expect(r400.json["problems"]).toEqual(['fixtures[2] "desk-lamp": unknown room "kitchen"']);
    const next = structuredClone(LIGHTS);
    next.fixtures[0]!.name = "The bulb";
    const ok = await call(rt, "POST", "/api/mod/lights", { lights: next, base: before.version });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ ok: true, source: "director", warnings: [] });
    const after = await view(rt);
    expect(after).toMatchObject({ source: "director", version: ok.json["version"] });
    expect(after.version).not.toBe(before.version);
    // A stale base is refused with the version in force.
    const stale = await call(rt, "POST", "/api/mod/lights", { lights: LIGHTS, base: before.version });
    expect(stale).toEqual({ status: 409, json: { error: "stale", version: after.version, source: "director" } });
    rt.dispose();
    const again = runtime({ dir, lights: LIGHTS_TEXT });
    expect(await view(again)).toMatchObject({ source: "director", version: after.version });
    again.dispose();
  });

  it("Save to project writes lights.json, records the snapshot, drops the save; no project → 409", async () => {
    const p = fakeProject();
    const rt = runtime({ project: p.link });
    expect((await call(rt, "POST", "/api/mod/lights", { lights: LIGHTS })).status).toBe(200);
    const saved = await view(rt);
    const r = await call(rt, "POST", "/api/mod/lights/project");
    expect(r).toEqual({ status: 200, json: { ok: true, version: saved.version } });
    expect(JSON.parse(p.files.get("lights.json")!)).toEqual(LIGHTS);
    expect(lightsOf(p.snapshots.at(-1))).toBe(p.files.get("lights.json"));
    expect(await view(rt)).toMatchObject({ source: "project", version: saved.version });
    rt.dispose();
    const lone = runtime({ project: null });
    expect(await call(lone, "POST", "/api/mod/lights/project")).toEqual({ status: 409, json: { error: "no project" } });
    lone.dispose();
  });

  it("a failed project write answers 502 and keeps the director's save", async () => {
    const link: ProjectLink = { projectId: "p", async writeFile() { throw new Error("db down"); }, async saveSnapshot() {}, async saveVariant() {} };
    const rt = runtime({ project: link });
    await call(rt, "POST", "/api/mod/lights", { lights: LIGHTS });
    expect((await call(rt, "POST", "/api/mod/lights/project")).status).toBe(502);
    expect((await view(rt)).source).toBe("director");
    rt.dispose();
  });

  it("/api/mod/load {lights} takes a fresh snapshot (400 on a broken one)", async () => {
    const rt = runtime();
    const bad = await call(rt, "POST", "/api/mod/load", { lights: JSON.stringify({ version: 2 }) });
    expect(bad.status).toBe(400);
    expect(bad.json["error"]).toBe("invalid lights.json");
    expect((await call(rt, "POST", "/api/mod/load", { lights: 7 })).json["error"]).toBe("bad lights");
    expect((await call(rt, "POST", "/api/mod/load", { lights: LIGHTS_TEXT })).status).toBe(200);
    expect((await view(rt)).source).toBe("project");
    // A load without `lights` leaves it alone; null drops it.
    expect((await call(rt, "POST", "/api/mod/load", {})).status).toBe(200);
    expect((await view(rt)).source).toBe("project");
    expect((await call(rt, "POST", "/api/mod/load", { lights: null })).status).toBe(200);
    expect((await view(rt)).source).toBe("default");
    rt.dispose();
  });

  it("a lights.json edit makes the event's snapshot stale; a reload's setProjectLights takes it", async () => {
    const maps = { "house.json": "{}" };
    expect(snapshotDiffers({ ...maps, "lights.json": LIGHTS_TEXT }, { ...maps, "lights.json": LIGHTS_TEXT })).toBe(false);
    expect(snapshotDiffers({ ...maps, "lights.json": LIGHTS_TEXT }, maps)).toBe(true);
    expect(snapshotDiffers(maps, { ...maps, "lights.json": LIGHTS_TEXT })).toBe(true);
    const rt = runtime();
    rt.setProjectLights(LIGHTS_TEXT);
    expect((await view(rt)).source).toBe("project");
    rt.dispose();
  });
});

describe("POST /api/mod/lights/test", () => {
  it("a fixture (identify), a look, or a fixture + a set; 404 / 400; recent tests ride the GET for 60 s", async () => {
    let t = 1_000_000;
    const rt = runtime({ lights: LIGHTS_TEXT, now: () => t });
    expect((await call(rt, "POST", "/api/mod/lights/test", {})).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/lights/test", { look: "heart_idle", fixture: "desk-lamp" })).status).toBe(400);
    expect(await call(rt, "POST", "/api/mod/lights/test", { look: "heart_dream" })).toEqual({ status: 404, json: { error: "no such look" } });
    expect(await call(rt, "POST", "/api/mod/lights/test", { fixture: "ghost" })).toEqual({ status: 404, json: { error: "no such fixture" } });
    expect(await call(rt, "POST", "/api/mod/lights/test", { fixture: "desk-lamp", set: { brightness: 999 } })).toEqual({ status: 400, json: { error: "set.brightness must be a whole number from 0 to 254" } });
    // A set that does nothing (empty, or only a transition) is no test.
    expect(await call(rt, "POST", "/api/mod/lights/test", { fixture: "desk-lamp", set: {} })).toEqual({ status: 400, json: { error: "set does nothing" } });
    expect(await call(rt, "POST", "/api/mod/lights/test", { fixture: "desk-lamp", set: { transition: 1 } })).toEqual({ status: 400, json: { error: "set does nothing" } });
    expect((await call(rt, "POST", "/api/mod/lights/test", { look: "heart_idle" }, {})).status).toBe(403);
    expect(await call(rt, "POST", "/api/mod/lights/test", { fixture: "server-room-rgb" })).toEqual({ status: 200, json: { ok: true, seq: 1, module: false } });
    t += 1000;
    expect((await call(rt, "POST", "/api/mod/lights/test", { look: "heart_wake" })).json).toMatchObject({ ok: true, seq: 2 });
    t += 1000;
    expect((await call(rt, "POST", "/api/mod/lights/test", { fixture: "hall-group", set: { color: "#FF0000" } })).json).toMatchObject({ ok: true, seq: 3 });
    expect((await view(rt)).tests).toEqual([
      { seq: 1, at: 1_000_000, fixture: "server-room-rgb", by: "Director" },
      { seq: 2, at: 1_001_000, look: "heart_wake", by: "Director" },
      { seq: 3, at: 1_002_000, fixture: "hall-group", set: { color: "#FF0000" }, by: "Director" },
    ]);
    t += LIGHT_TEST_MS - 1000;
    expect((await view(rt)).tests.map((x) => x.seq)).toEqual([2, 3]);
    rt.dispose();
  });

  it("only the last LIGHT_TESTS (32, wave 25: a desk cue's burst) ride the GET", async () => {
    const rt = runtime({ lights: LIGHTS_TEXT });
    for (let i = 0; i < LIGHT_TESTS + 2; i++) await call(rt, "POST", "/api/mod/lights/test", { fixture: "desk-lamp" });
    expect((await view(rt)).tests.map((x) => x.seq)).toEqual(Array.from({ length: LIGHT_TESTS }, (_, i) => i + 3));
    rt.dispose();
  });

  it("a host's booth may test the lights (wave 25, the Desk), never save, pair or read them", async () => {
    const rt = runtime({ lights: LIGHTS_TEXT });
    const r = await call(rt, "POST", "/api/prime/login", { character: "Task Manager", passcode: CODES.prime }, {});
    expect(r.json).toMatchObject({ host: true });
    const token = r.json["token"] as string;
    expect((await call(rt, "POST", "/api/mod/lights/test", { look: "heart_idle", token }, { token })).status).toBe(200);
    expect((await view(rt)).tests.at(-1)!.by).toBe("Booth · Task Manager");
    expect((await call(rt, "POST", "/api/mod/lights", { lights: LIGHTS, token }, { token })).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/lights/pair", { seconds: 60, token }, { token })).status).toBe(403);
    expect((await call(rt, "GET", `/api/mod/lights?token=${token}`, {}, {})).status).toBe(403);
    rt.dispose();
  });
});

describe("POST /api/mod/lights/devices and /pair", () => {
  it("the device list is replaced whole and rides the GET with devicesAt; bad entries / too many → 400", async () => {
    let t = 3_000_000;
    const rt = runtime({ now: () => t });
    expect(await call(rt, "POST", "/api/mod/lights/devices", { devices: [DEVICE, GROUP] })).toEqual({ status: 200, json: { ok: true, n: 2 } });
    expect(await view(rt)).toMatchObject({ devices: [DEVICE, GROUP], devicesAt: 3_000_000 });
    t += 5;
    expect((await call(rt, "POST", "/api/mod/lights/devices", { devices: [GROUP] })).json).toEqual({ ok: true, n: 1 });
    expect(await view(rt)).toMatchObject({ devices: [GROUP], devicesAt: 3_000_005 });
    expect((await call(rt, "POST", "/api/mod/lights/devices", {})).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/lights/devices", { devices: [{ friendly: "x" }] })).json["error"]).toMatch(/^devices\[0\] is not/u);
    expect((await call(rt, "POST", "/api/mod/lights/devices", { devices: [{ ...DEVICE, caps: { color: true } }] })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/lights/devices", { devices: [{ ...GROUP, members: [1] }] })).status).toBe(400);
    const many = Array.from({ length: LIGHT_DEVICES_MAX + 1 }, (_, i) => ({ ...DEVICE, friendly: `d${i}` }));
    expect((await call(rt, "POST", "/api/mod/lights/devices", { devices: many })).json).toEqual({ error: "at most 500 devices" });
    const big = Array.from({ length: 300 }, (_, i) => ({ ...DEVICE, friendly: `d${i}`, description: "x".repeat(1000) }));
    expect((await call(rt, "POST", "/api/mod/lights/devices", { devices: big })).json).toEqual({ error: "the device list is over 256 KB" });
    // A refused list changes nothing.
    expect((await view(rt)).devices).toEqual([GROUP]);
    rt.dispose();
  });

  it("pair opens joining for seconds (0 closes); the latest rides the GET while it is open", async () => {
    let t = 4_000_000;
    const rt = runtime({ now: () => t });
    for (const seconds of [-1, 255, 1.5, "60"]) expect((await call(rt, "POST", "/api/mod/lights/pair", { seconds })).status).toBe(400);
    expect(await call(rt, "POST", "/api/mod/lights/pair", { seconds: 120 })).toEqual({ status: 200, json: { ok: true, seq: 1, until: 4_120_000 } });
    expect((await view(rt)).pair).toEqual({ seq: 1, at: 4_000_000, seconds: 120, until: 4_120_000, by: "Director" });
    expect((await view(rt)).now).toBe(4_000_000); // the anchor a client counts the pairing down from
    t += 119_000;
    expect((await view(rt)).pair?.seq).toBe(1);
    t += 1000;
    expect((await view(rt)).pair).toBeNull();
    // A close rides the GET for a minute so the module can send it.
    expect((await call(rt, "POST", "/api/mod/lights/pair", { seconds: 60 })).json["seq"]).toBe(2);
    expect((await call(rt, "POST", "/api/mod/lights/pair", { seconds: 0 })).json).toEqual({ ok: true, seq: 3, until: t });
    expect((await view(rt)).pair).toMatchObject({ seq: 3, seconds: 0 });
    t += LIGHT_TEST_MS;
    expect((await view(rt)).pair).toBeNull();
    rt.dispose();
  });
});

describe("the lights module's presence", () => {
  it("a module=1 poll marks it online with its name; the editor's own poll never does; it lapses after the window", async () => {
    let t = 5_000_000;
    const rt = runtime({ lights: LIGHTS_TEXT, now: () => t });
    const v = await view(rt, "?after=nope&wait=0");
    expect(v.module).toBeNull();
    await view(rt, "?after=nope&wait=0&module=1&name=house-mac");
    expect((await view(rt)).module).toEqual({ name: "house-mac", at: t, online: true });
    expect((await call(rt, "POST", "/api/mod/lights/test", { look: "heart_idle" })).json["module"]).toBe(true);
    t += LIGHTS_MODULE_ONLINE_MS + 1;
    expect((await view(rt)).module).toMatchObject({ online: false, name: "house-mac" });
    // Parked on a long poll: online however long it waits.
    const parked = view(rt, `?after=${v.version}&tests=1&wait=5&module=1`);
    await new Promise((r) => setTimeout(r, 20));
    t += LIGHTS_MODULE_ONLINE_MS * 3;
    expect((await view(rt)).module?.online).toBe(true);
    await call(rt, "POST", "/api/mod/lights/test", { look: "heart_idle" });
    await parked;
    rt.dispose();
  });
});

describe("the long poll", () => {
  it("answers at once on a version it doesn't hold; else waits for a save, a test, a pair, devices, or the timeout", async () => {
    const rt = runtime({ lights: LIGHTS_TEXT });
    const v = await view(rt);
    const t0 = Date.now();
    expect((await view(rt, "?after=deadbeef&wait=5")).version).toBe(v.version);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect((await view(rt, `?after=${v.version}&wait=0.05`)).version).toBe(v.version);
    // A test wakes a parked poll.
    let parked = view(rt, `?after=${v.version}&tests=0&wait=5`);
    await new Promise((r) => setTimeout(r, 20));
    expect(rt.lights.waiting).toBe(1);
    await call(rt, "POST", "/api/mod/lights/test", { look: "heart_nag" });
    expect((await parked).tests.map((x) => x.look)).toEqual(["heart_nag"]);
    expect(rt.lights.waiting).toBe(0);
    // A pending test newer than `tests` answers at once.
    expect((await view(rt, `?after=${v.version}&tests=0&wait=5`)).tests).toHaveLength(1);
    // A pair wakes it; a pair newer than `pairs` answers at once, one seen waits.
    parked = view(rt, `?after=${v.version}&tests=1&pairs=0&wait=5`);
    await new Promise((r) => setTimeout(r, 20));
    await call(rt, "POST", "/api/mod/lights/pair", { seconds: 30 });
    expect((await parked).pair?.seq).toBe(1);
    let t1 = Date.now();
    expect((await view(rt, `?after=${v.version}&tests=1&pairs=0&wait=5`)).pair?.seq).toBe(1);
    expect(Date.now() - t1).toBeLessThan(1000);
    expect(rt.lights.moved(v.version, 1, 1)).toBe(false);
    // New devices wake it.
    parked = view(rt, `?after=${v.version}&tests=1&pairs=1&wait=5`);
    await new Promise((r) => setTimeout(r, 20));
    await call(rt, "POST", "/api/mod/lights/devices", { devices: [DEVICE] });
    expect((await parked).devices).toEqual([DEVICE]);
    // A list posted between two polls answers at once against the last view's devicesAt.
    const seen = (await view(rt)).devicesAt!;
    t1 = Date.now();
    expect((await view(rt, `?after=${v.version}&tests=1&pairs=1&devicesAt=${seen}&wait=0.2`)).devices).toEqual([DEVICE]);
    expect(Date.now() - t1).toBeGreaterThanOrEqual(150);
    expect(rt.lights.moved(v.version, 1, 1, seen)).toBe(false);
    expect(rt.lights.moved(v.version, 1, 1, seen - 1)).toBe(true);
    t1 = Date.now();
    expect((await view(rt, `?after=${v.version}&tests=1&pairs=1&devicesAt=${seen - 1}&wait=5`)).devices).toEqual([DEVICE]);
    expect(Date.now() - t1).toBeLessThan(1000);
    // A save wakes it with the new version.
    parked = view(rt, `?after=${v.version}&tests=1&pairs=1&wait=5`);
    await new Promise((r) => setTimeout(r, 20));
    const next = structuredClone(LIGHTS);
    next.zones.push({ id: "tube", name: "The Tube lights", fixtures: ["hall-group"] });
    expect((await call(rt, "POST", "/api/mod/lights", { lights: next, base: v.version })).status).toBe(200);
    const moved = await parked;
    expect(moved.version).not.toBe(v.version);
    expect(moved.source).toBe("director");
    // A cursor from before a restart (past this hub's counters) answers at once.
    t1 = Date.now();
    expect((await view(rt, `?after=${moved.version}&tests=9&wait=5`)).version).toBe(moved.version);
    expect((await view(rt, `?after=${moved.version}&pairs=9&wait=5`)).version).toBe(moved.version);
    expect(Date.now() - t1).toBeLessThan(1000);
    rt.dispose();
  });
});
