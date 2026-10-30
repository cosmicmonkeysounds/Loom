//! Wave 49 (docs/loom-w49-contract.md C3.2, C3.3): the descent on the server.
//! `descent.json`, read live (`DescentSource`, `GET /api/spatial/descent`);
//! the level a walk is dealt and what a program told a talker (`descent` and
//! `told` on the assignment, `POST /api/spatial/told`), and a director's
//! forced level (`/api/mod/spatial/descent`). None of it is journaled.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { DESCENT_FILE, DESCENT_MAX, validateHouse, type Assignment, type DescentScript, type HouseMap } from "@loom/house";

import { scenarioDescentFile } from "../examples/load.ts";
import { DESCENT_CACHE_MS, DescentSource, parseDescentText } from "../server/descent.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { isHostRoute } from "../server/routes/host.ts";
import { wantsModRead } from "../server/routing.ts";
import { SpatialHub, TOLD_CHARS, TOLD_TALKERS, parseTold } from "../server/spatial.ts";
import { Store } from "../server/store.ts";

const FIX = join(import.meta.dirname, "..", "..", "house", "test", "fixtures");
const HOUSE_FILE = join(FIX, "lights-house.json");
const HOUSE = ((): HouseMap => {
  const v = validateHouse(JSON.parse(readFileSync(HOUSE_FILE, "utf8")));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
})();
const CODES = { event: "EVTW49", prime: "PRMW49", mod: "MODW49" };
const STORY = `# T\n\nLOCATION The Desktop\n\nCHARACTER Task Manager\n  admin: true\n  when scanned by guest:\n    reply ok\n\n== Boot\n  setting: The Desktop\nHello.\n`;

const script = (note = "x"): string => JSON.stringify({ version: 1, note, talkers: [], whispers: {}, grin: [], whiteduck: [], self: [], small: [], big: [], hallway: { enter: [], far: [], out: [] }, found: {} });
const noteOf = (s: DescentScript | null | undefined) => s?.note;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-w49-"));
  dirs.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// DescentSource
// ---------------------------------------------------------------------------

describe("DescentSource (C3.2)", () => {
  it("prefers the project's file, then LOOM_DESCENT; the scenario's own only with no project", async () => {
    const d = freshDir();
    const env = join(d, "env.json");
    const own = join(d, "own.json");
    writeFileSync(env, script("env"));
    writeFileSync(own, script("scenario"));
    let project: string | null = script("project");
    const withProject = new DescentSource({ project: async () => project, envFile: env, scenarioFile: own, now: () => 0 });
    const a = await withProject.read();
    expect([noteOf(a.file), a.source]).toEqual(["project", "project"]);
    project = null;
    withProject.invalidate();
    const b = await withProject.read();
    expect([noteOf(b.file), b.source]).toEqual(["env", "env"]);
    // A project with no file of its own never plays the scenario's.
    const projectOnly = new DescentSource({ project: async () => null, envFile: null, scenarioFile: own });
    expect(await projectOnly.read()).toEqual({ file: null, source: null, problems: [] });
    const lan = new DescentSource({ project: null, envFile: null, scenarioFile: own });
    expect((await lan.read()).source).toBe("scenario");
    const nothing = new DescentSource({ project: null, envFile: null, scenarioFile: join(d, "absent.json") });
    expect((await nothing.read()).file).toBeNull();
  });

  it("caches a read for 5 s", async () => {
    let t = 1000;
    let reads = 0;
    let text = script("one");
    const src = new DescentSource({
      project: async () => {
        reads++;
        return text;
      },
      now: () => t,
    });
    expect(DESCENT_CACHE_MS).toBe(5000);
    expect(noteOf((await src.read()).file)).toBe("one");
    text = script("two");
    t += DESCENT_CACHE_MS - 1;
    expect(noteOf((await src.read()).file)).toBe("one");
    expect(reads).toBe(1);
    t += 1;
    expect(noteOf((await src.read()).file)).toBe("two");
    expect(reads).toBe(2);
  });

  it("an invalid file reads as none, logged once; it never falls through to the next source", async () => {
    const logs: string[] = [];
    let t = 0;
    const d = freshDir();
    const env = join(d, "env.json");
    writeFileSync(env, script("env"));
    const src = new DescentSource({ project: async () => '{"version":2}', envFile: env, now: () => t, log: (m) => logs.push(m) });
    const r = await src.read();
    expect(r.file).toBeNull();
    expect(r.source).toBe("project");
    expect(r.problems[0]).toBe("version must be 1");
    t += DESCENT_CACHE_MS;
    await src.read();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/descent \(project\): version must be 1/u);
    const junk = new DescentSource({ project: async () => "{ nope", log: (m) => logs.push(m) });
    expect((await junk.read()).file).toBeNull();
    expect(logs).toHaveLength(2);
    expect(logs[1]).toMatch(/not JSON/u);
    expect(parseDescentText("[]").file).toBeNull();
  });

  it("a failing project read is logged and treated as no file", async () => {
    const logs: string[] = [];
    const src = new DescentSource({
      project: async () => {
        throw new Error("db down");
      },
      log: (m) => logs.push(m),
    });
    expect((await src.read()).file).toBeNull();
    expect(logs[0]).toMatch(/descent: reading the project's descent\.json failed/u);
  });

  it("the show's own file is usable, and the sync reads it", () => {
    const f = scenarioDescentFile("trapped-in-the-internet");
    expect(f?.path).toBe(DESCENT_FILE);
    const { file, problems } = parseDescentText(f!.source);
    expect(problems).toEqual([]);
    expect(file?.talkers.length).toBeGreaterThan(0);
    expect(scenarioDescentFile("no-such-example")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The level and what was told, on the hub
// ---------------------------------------------------------------------------

function rig() {
  let t = 5_000_000;
  let ids = 0;
  const hub = new SpatialHub({ eventId: "evt", now: () => t, newSessionId: () => `s-${++ids}`, newToken: () => `tok-${ids}` });
  hub.setHouse(HOUSE, "show", false);
  const begin = (guest: string, station: string | null = null) => hub.begin({ guest, name: guest, world: "web", device: "Tent", station, captured: false })!;
  /** One whole visit: begun, walked to the duck, found. */
  const visit = (guest: string): Assignment => {
    const a = begin(guest);
    hub.pose(a.token, { p: a.duck.pos, yaw: 0, pitch: 0 });
    expect(hub.found(a.token, () => true)).toMatchObject({ kind: "found" });
    t += 1;
    return a;
  };
  return { hub, begin, visit, tick: (ms: number) => (t += ms) };
}

describe("the level (C3.3)", () => {
  it("the first walk is clean; each find deepens the next; it stops at the deepest", () => {
    const r = rig();
    const levels: number[] = [];
    for (let i = 0; i < DESCENT_MAX + 3; i++) levels.push(r.visit("ann").descent!);
    expect(levels).toEqual([0, 1, 2, 3, 4, 4, 4]);
    // Per guest: someone else's finds don't count.
    expect(r.begin("bob").descent).toBe(0);
    expect(r.hub.descentFor("ann")).toBe(DESCENT_MAX);
  });

  it("a forced level is every next deal's, and null is by visits again", () => {
    const r = rig();
    r.visit("ann");
    r.hub.forceDescent(3);
    expect(r.hub.forcedLevel).toBe(3);
    expect(r.begin("ann").descent).toBe(3);
    expect(r.begin("bob").descent).toBe(3);
    r.hub.forceDescent(0);
    expect(r.begin("ann").descent).toBe(0);
    r.hub.forceDescent(null);
    expect(r.begin("ann").descent).toBe(1);
  });

  it("a walk keeps the level it was dealt: a force, a resume, a station's poll or its own find never move it", () => {
    const r = rig();
    const a = r.begin("ann");
    r.hub.forceDescent(4);
    r.hub.suspend(a.token);
    const back = r.hub.resume(a.token);
    expect(back).toMatchObject({ kind: "ok", assignment: { descent: 0 } });
    // A parked headset's polls hand out the same deal.
    r.hub.forceDescent(null);
    const parked = r.begin("bob", "quest");
    r.hub.forceDescent(2);
    expect(parked.descent).toBe(0);
    expect(r.hub.station("quest", "Quest", "vr")!.descent).toBe(0);
    // A find behind a lingering session: the session still reads its own.
    r.hub.forceDescent(null);
    const c = r.begin("cat");
    r.hub.pose(c.token, { p: c.duck.pos, yaw: 0, pitch: 0 });
    r.hub.found(c.token, () => true);
    expect(r.hub.resume(c.token)).toMatchObject({ kind: "ok", assignment: { descent: 0, reinstalled: 1 } });
    // The next deal is the deeper one.
    expect(r.begin("cat").descent).toBe(1);
  });
});

describe("what was told (C3.3)", () => {
  it("parseTold: two strings of 1 to 64", () => {
    const max = "x".repeat(TOLD_CHARS);
    expect(parseTold({ talker: "stove", mark: "kind" })).toEqual({ talker: "stove", mark: "kind" });
    expect(parseTold({ talker: max, mark: max, token: "t" })).toEqual({ talker: max, mark: max });
    expect(parseTold({ talker: `${max}x`, mark: "kind" })).toBeNull();
    expect(parseTold({ talker: "stove", mark: `${max}x` })).toBeNull();
    expect(parseTold({ talker: "", mark: "kind" })).toBeNull();
    expect(parseTold({ talker: "stove", mark: "" })).toBeNull();
    expect(parseTold({ talker: 1, mark: "kind" })).toBeNull();
    expect(parseTold({ talker: "stove" })).toBeNull();
  });

  it("carried on the next deal and on a resume, per guest; the latest mark wins", () => {
    const r = rig();
    const a = r.begin("ann");
    expect(a.told).toEqual({});
    expect(r.hub.tell(a.token, "stove", "kind")).toBe("ok");
    expect(r.hub.tell(a.token, "fridge", "cold")).toBe("ok");
    expect(r.hub.tell(a.token, "stove", "rude")).toBe("ok");
    expect(r.hub.resume(a.token)).toMatchObject({ kind: "ok", assignment: { told: { stove: "rude", fridge: "cold" } } });
    r.hub.endByToken(a.token);
    expect(r.begin("ann").told).toEqual({ stove: "rude", fridge: "cold" });
    expect(r.begin("bob").told).toEqual({});
  });

  it("an assignment's `told` is a copy", () => {
    const r = rig();
    const a = r.begin("ann");
    r.hub.tell(a.token, "stove", "kind");
    const b = r.begin("ann");
    b.told!["stove"] = "tampered";
    expect(r.begin("ann").told).toEqual({ stove: "kind" });
  });

  it("a dead token is told so, and a guest's memory has a ceiling", () => {
    const r = rig();
    expect(r.hub.tell("nope", "stove", "kind")).toBe("unknown");
    const a = r.begin("ann");
    r.hub.endByToken(a.token);
    expect(r.hub.tell(a.token, "stove", "kind")).toBe("over");
    const b = r.begin("ann");
    for (let i = 0; i < TOLD_TALKERS + 5; i++) r.hub.tell(b.token, `t${i}`, "m");
    r.hub.tell(b.token, "t0", "again");
    const told = r.begin("ann").told!;
    expect(Object.keys(told)).toHaveLength(TOLD_TALKERS);
    expect(told["t0"]).toBe("again");
  });

  it("a story reset forgets what was told and the forced level", () => {
    const r = rig();
    const a = r.begin("ann");
    r.hub.tell(a.token, "stove", "kind");
    r.hub.forceDescent(3);
    r.hub.reset("reset");
    expect(r.hub.forcedLevel).toBeNull();
    const after = r.begin("ann");
    expect(after.told).toEqual({});
    expect(after.descent).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

function fakeReq(body: unknown, headers: Record<string, string> = {}) {
  const r = Readable.from([Buffer.from(JSON.stringify(body ?? {}))]) as unknown as IncomingMessage;
  r.headers = headers;
  return r;
}
function fakeRes() {
  const res = {
    statusCode: 0,
    body: "",
    setHeader() {},
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
async function call(rt: EventRuntime, method: string, p: string, body: unknown = {}, o: { moderator?: boolean; token?: string } = {}) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  const hit = await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, { moderator: o.moderator ?? false });
  return { hit, status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

function runtime(o: { dir?: string; project?: string | null; descentFile?: string | null; now?: () => number; store?: Store } = {}): EventRuntime {
  const dir = o.dir ?? freshDir();
  const houseFile = join(dir, "house.json");
  writeFileSync(houseFile, readFileSync(HOUSE_FILE));
  return new EventRuntime({
    eventId: "evt",
    store: o.store ?? new Store(freshDir()),
    codes: CODES,
    scenarioName: "t",
    scenarioSource: STORY,
    joinBase: () => "http://localhost",
    houseFile,
    audioFile: null,
    lightsFile: null,
    descentFile: o.descentFile ?? null,
    ...(o.project !== undefined
      ? {
          project: {
            projectId: "p",
            writeFile: async () => {},
            saveSnapshot: async () => {},
            saveVariant: async () => {},
            readFile: async (path: string) => (path === DESCENT_FILE ? o.project! : null),
            resyncFiles: async () => {},
          },
        }
      : {}),
    ...(o.now !== undefined ? { now: o.now } : {}),
  });
}

const begin = (rt: EventRuntime, guest = "ann") => {
  rt.spatial.setHouse(HOUSE, "show", false);
  return rt.spatial.begin({ guest, name: guest, world: "web", device: "Tent", station: null, captured: false })!;
};
const modToken = async (rt: EventRuntime) => (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
const hostToken = async (rt: EventRuntime) => (await call(rt, "POST", "/api/prime/login", { character: "Task Manager", passcode: CODES.prime })).json["token"] as string;

describe("GET /api/spatial/descent (C3.2)", () => {
  it("a session token or a moderator's; nobody else", async () => {
    const dir = freshDir();
    writeFileSync(join(dir, DESCENT_FILE), script("own"));
    const rt = runtime({ dir });
    const a = begin(rt);
    expect((await call(rt, "GET", "/api/spatial/descent")).status).toBe(401);
    expect((await call(rt, "GET", "/api/spatial/descent", {}, { token: "nope" })).status).toBe(401);
    const asSession = await call(rt, "GET", `/api/spatial/descent?token=${a.token}`);
    expect(asSession.status).toBe(200);
    expect(noteOf(asSession.json["script"] as DescentScript)).toBe("own");
    // The map editor's inspector reads the talkers with a mod token, in the
    // header or the query; the editor on its author session.
    const mod = await modToken(rt);
    expect((await call(rt, "GET", "/api/spatial/descent", {}, { token: mod })).status).toBe(200);
    expect((await call(rt, "GET", `/api/spatial/descent?token=${mod}`)).status).toBe(200);
    expect((await call(rt, "GET", "/api/spatial/descent", {}, { moderator: true })).status).toBe(200);
    expect(wantsModRead("/api/spatial/descent", new URLSearchParams())).toBe(true);
    // A finished session reads no more.
    rt.spatial.endByToken(a.token);
    expect((await call(rt, "GET", `/api/spatial/descent?token=${a.token}`)).status).toBe(401);
    rt.dispose();
  });

  it("a project's file wins, a project with none answers null, an invalid one too", async () => {
    let t = 1_000_000;
    const own = freshDir();
    writeFileSync(join(own, DESCENT_FILE), script("scenario"));
    const rt = runtime({ dir: own, project: script("project"), now: () => t });
    expect(noteOf((await call(rt, "GET", "/api/spatial/descent", {}, { moderator: true })).json["script"] as DescentScript)).toBe("project");
    rt.dispose();
    const none = runtime({ dir: own, project: null, now: () => t });
    expect((await call(none, "GET", "/api/spatial/descent", {}, { moderator: true })).json).toEqual({ script: null });
    none.dispose();
    const bad = runtime({ dir: own, project: "{}", now: () => t });
    expect((await call(bad, "GET", "/api/spatial/descent", {}, { moderator: true })).json).toEqual({ script: null });
    bad.dispose();
    t += 1;
  });

  it("LOOM_DESCENT stands in for a project's missing file", async () => {
    const d = freshDir();
    const env = join(d, "env.json");
    writeFileSync(env, script("env"));
    const rt = runtime({ project: null, descentFile: env });
    expect(noteOf((await call(rt, "GET", "/api/spatial/descent", {}, { moderator: true })).json["script"] as DescentScript)).toBe("env");
    rt.dispose();
  });
});

describe("POST /api/spatial/told (C3.3)", () => {
  it("a session token's; the refusals of the other game routes; bad bodies 400", async () => {
    const rt = runtime();
    const a = begin(rt);
    expect((await call(rt, "POST", "/api/spatial/told", { talker: "stove", mark: "kind" })).status).toBe(401);
    expect((await call(rt, "POST", "/api/spatial/told", { talker: "stove", mark: "kind" }, { token: "nope" })).status).toBe(401);
    expect((await call(rt, "POST", "/api/spatial/told", { talker: "stove" }, { token: a.token })).status).toBe(400);
    expect((await call(rt, "POST", "/api/spatial/told", { talker: "x".repeat(65), mark: "kind" }, { token: a.token })).status).toBe(400);
    expect(await call(rt, "POST", "/api/spatial/told", { talker: "stove", mark: "kind" }, { token: a.token })).toMatchObject({ status: 200, json: { ok: true } });
    expect(rt.spatial.begin({ guest: "ann", name: "ann", world: "web", device: "Tent", station: null, captured: false })!.told).toEqual({ stove: "kind" });
    // `begin` above replaced the session.
    expect((await call(rt, "POST", "/api/spatial/told", { talker: "stove", mark: "kind" }, { token: a.token })).status).toBe(410);
    rt.dispose();
  });

  it("the longest legal body, worst-case escaped, fits the game routes' 2 KB cap", async () => {
    const rt = runtime();
    const a = begin(rt);
    const worst = "\u{7fff}".repeat(TOLD_CHARS);
    const body = { talker: worst, mark: worst, token: a.token };
    expect(JSON.stringify(body).replace(/\u{7fff}/gu, "\\u7fff").length).toBeLessThan(2048);
    expect((await call(rt, "POST", "/api/spatial/told", body, { token: a.token })).status).toBe(200);
    rt.dispose();
  });

  it("is open while the doors are closed, and commits nothing", async () => {
    const store = new Store(freshDir());
    const rt = runtime({ store });
    const a = begin(rt);
    await call(rt, "POST", "/api/mod/spatial/descent", { level: 2 }, { moderator: true });
    const before = store.readJournal().length;
    expect((await call(rt, "POST", "/api/spatial/told", { talker: "stove", mark: "kind" }, { token: a.token })).status).toBe(200);
    expect(store.readJournal()).toHaveLength(before);
    rt.dispose();
  });
});

describe("/api/mod/spatial/descent (C3.3)", () => {
  it("reads and sets the forced level; a new deal takes it", async () => {
    const rt = runtime();
    const mod = { moderator: true };
    expect((await call(rt, "GET", "/api/mod/spatial/descent", {}, mod)).json).toEqual({ forced: null });
    expect((await call(rt, "POST", "/api/mod/spatial/descent", { level: 3 }, mod)).json).toEqual({ ok: true, forced: 3 });
    expect((await call(rt, "GET", "/api/mod/spatial/descent", {}, mod)).json).toEqual({ forced: 3 });
    expect(begin(rt).descent).toBe(3);
    expect((await call(rt, "POST", "/api/mod/spatial/descent", { level: 0 }, mod)).json).toEqual({ ok: true, forced: 0 });
    expect(begin(rt).descent).toBe(0);
    expect((await call(rt, "POST", "/api/mod/spatial/descent", { level: null }, mod)).json).toEqual({ ok: true, forced: null });
    rt.dispose();
  });

  it("refuses anything but a level or null, and leaves it alone", async () => {
    const rt = runtime();
    const mod = { moderator: true };
    await call(rt, "POST", "/api/mod/spatial/descent", { level: 2 }, mod);
    for (const body of [{}, { level: 5 }, { level: -1 }, { level: 1.5 }, { level: "2" }, { level: true }]) {
      expect((await call(rt, "POST", "/api/mod/spatial/descent", body, mod)).status).toBe(400);
    }
    expect((await call(rt, "GET", "/api/mod/spatial/descent", {}, mod)).json).toEqual({ forced: 2 });
    rt.dispose();
  });

  it("a director's alone: never on the host allowlist", async () => {
    const rt = runtime();
    expect((await call(rt, "GET", "/api/mod/spatial/descent")).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/spatial/descent", { level: 1 })).status).toBe(403);
    const a = begin(rt);
    expect((await call(rt, "GET", `/api/mod/spatial/descent?token=${a.token}`)).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/spatial/descent", { level: 1 }, { token: a.token })).status).toBe(403);
    const host = await hostToken(rt);
    expect(await call(rt, "GET", `/api/mod/spatial/descent?token=${host}`)).toMatchObject({ status: 403, json: { error: "not from a booth" } });
    expect(await call(rt, "POST", "/api/mod/spatial/descent", { level: 1 }, { token: host })).toMatchObject({ status: 403, json: { error: "not from a booth" } });
    const ctx = { alertsPath: "", isAgent: () => false };
    expect(isHostRoute("GET", "/api/mod/spatial/descent", {}, ctx)).toBe(false);
    expect(isHostRoute("POST", "/api/mod/spatial/descent", { level: 1 }, ctx)).toBe(false);
    const mod = await modToken(rt);
    expect((await call(rt, "POST", "/api/mod/spatial/descent", { level: 1 }, { token: mod })).status).toBe(200);
    expect((await call(rt, "GET", `/api/mod/spatial/descent?token=${mod}`)).json).toEqual({ forced: 1 });
    rt.dispose();
  });

  it("a story reset clears the level and what was told", async () => {
    const rt = runtime();
    const a = begin(rt);
    await call(rt, "POST", "/api/spatial/told", { talker: "stove", mark: "kind" }, { token: a.token });
    await call(rt, "POST", "/api/mod/spatial/descent", { level: 4 }, { moderator: true });
    rt.restart();
    expect((await call(rt, "GET", "/api/mod/spatial/descent", {}, { moderator: true })).json).toEqual({ forced: null });
    const after = begin(rt);
    expect(after.told).toEqual({});
    expect(after.descent).toBe(0);
    rt.dispose();
  });

  it("a restart of the server forgets both (memory only)", async () => {
    const dir = freshDir();
    const store = new Store(dir);
    const rt = runtime({ store });
    const a = begin(rt);
    await call(rt, "POST", "/api/spatial/told", { talker: "stove", mark: "kind" }, { token: a.token });
    await call(rt, "POST", "/api/mod/spatial/descent", { level: 4 }, { moderator: true });
    rt.dispose();
    const next = runtime({ store: new Store(dir) });
    next.restore();
    expect((await call(next, "GET", "/api/mod/spatial/descent", {}, { moderator: true })).json).toEqual({ forced: null });
    const after = begin(next);
    expect(after.told).toEqual({});
    expect(after.descent).toBe(0);
    next.dispose();
  });
});
