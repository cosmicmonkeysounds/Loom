//! The reinstallation games' intro (the video + the tutorial): how many
//! reinstallations a program completed (`reinstalled`, on the assignment and
//! the candidates — ≥ 1 lets the intro be skipped), the run clock that
//! restarts once the intro is over (`POST /api/spatial/ready`), and the
//! settings a headset saves to the program (`POST /api/spatial/prefs`), kept
//! on disk across a restart and a story reset.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { validateHouse, type Assignment, type HouseMap } from "@loom/house";
import { SpatialHub, parsePrefs, parsePrefsBook } from "../server/spatial.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";

const fixture = (name: string): HouseMap => {
  const v = validateHouse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../house/test/fixtures/${name}.json`, import.meta.url)), "utf8")));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
};

function hubHarness() {
  let clock = 1_000;
  let ids = 0;
  const saved: Array<Record<string, unknown>> = [];
  const hub = new SpatialHub({
    eventId: "evt",
    now: () => clock,
    newSessionId: () => `s-${String(++ids).padStart(6, "0")}`,
    newToken: () => `tok-${ids}`,
    onPrefs: (all) => saved.push(all),
  });
  hub.setHouse(fixture("two-rooms"), "show", false);
  const begin = (guest: string) => hub.begin({ guest, name: guest.toUpperCase(), world: "web", device: "Tent tablet", station: null, captured: true })!;
  const find = (a: Assignment) => {
    const [x, y, z] = a.duck.pos;
    expect(hub.pose(a.token, { p: [x + 0.3, y, z], yaw: 0, pitch: 0 })).toBe("ok");
    return hub.found(a.token, () => true);
  };
  return { hub, begin, find, saved, tick: (ms: number) => (clock += ms) };
}

describe("SpatialHub — the intro", () => {
  it("counts a program's reinstallations off the run log: 0 at first, 1 after a find", () => {
    const h = hubHarness();
    const a = h.begin("g-1");
    expect(a.reinstalled).toBe(0);
    expect(a.prefs).toBeNull();
    expect(h.find(a)).toMatchObject({ kind: "found" });
    expect(h.hub.reinstalledBy("g-1")).toBe(1);
    expect(h.hub.reinstalledBy("g-2")).toBe(0);
    expect(h.begin("g-1").reinstalled).toBe(1);
    // A story reset starts the count again (the run log is the story's).
    h.hub.reset("restart");
    expect(h.begin("g-1").reinstalled).toBe(0);
  });

  it("ready restarts the run clock once, so the intro is not timed", () => {
    const h = hubHarness();
    const a = h.begin("g-1");
    h.tick(150_000); // the video and the tutorial
    expect(h.hub.pose(a.token, { p: [1, 0, 2], yaw: 0, pitch: 0 })).toBe("ok");
    expect(h.hub.ready(a.token)).toBe("ok");
    h.tick(20_000);
    expect(h.hub.ready(a.token)).toBe("ok"); // a second ready changes nothing
    h.tick(10_000);
    h.find(a);
    expect(h.hub.runs()[0]!.ms).toBe(30_000);
    expect(h.hub.ready("nope")).toBe("unknown");
  });

  it("saves a program's settings, merged, and deals them with every later assignment", () => {
    const h = hubHarness();
    const a = h.begin("g-1");
    expect(h.hub.setPrefs(a.token, { turn: "smooth" })).toEqual({ kind: "ok", prefs: { turn: "smooth" } });
    expect(h.saved.at(-1)).toEqual({ "g-1": { turn: "smooth" } });
    expect(h.begin("g-1").prefs).toEqual({ turn: "smooth" });
    // A story reset keeps them: they are the person's comfort, not the story's.
    h.hub.reset("restart");
    const b = h.begin("g-1");
    expect(b.prefs).toEqual({ turn: "smooth" });
    expect(h.hub.setPrefs(b.token, { turn: "snap" })).toEqual({ kind: "ok", prefs: { turn: "snap" } });
    expect(h.hub.setPrefs("nope", { turn: "snap" })).toEqual({ kind: "unknown" });
    h.hub.restorePrefs({ "g-9": { turn: "smooth" } });
    expect(h.hub.allPrefs()).toEqual({ "g-9": { turn: "smooth" } });
  });

  it("parses settings strictly", () => {
    expect(parsePrefs({ turn: "snap" })).toEqual({ turn: "snap" });
    expect(parsePrefs({ turn: "smooth", other: 1 })).toEqual({ turn: "smooth" });
    expect(parsePrefs({ turn: "fast" })).toBeNull();
    expect(parsePrefs({})).toBeNull();
    expect(parsePrefs(null)).toBeNull();
    expect(parsePrefsBook({ "g-1": { turn: "snap" }, "g-2": { turn: 3 }, "g-3": "x" })).toEqual({ "g-1": { turn: "snap" } });
    expect(parsePrefsBook([1])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// EventRuntime: the routes
// ---------------------------------------------------------------------------

const SCENARIO = scenarioSource("trapped-in-the-internet");
const CODES = { event: "EVT222", prime: "PRM222", mod: "MOD222" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-spatial-intro-"));
  dirs.push(d);
  return d;
}
function runtimeAt(d: string): EventRuntime {
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "trapped-in-the-internet", scenarioSource: SCENARIO, joinBase: () => "http://localhost" });
}
function fakeReq(body: unknown, headers: Record<string, string>): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
    destroy() {},
  } as unknown as IncomingMessage;
}
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: unknown = {}, auth: { moderator?: boolean; token?: string } = {}) {
  let status = 0;
  let text = "";
  const res = {
    writeHead(s: number) {
      status = s;
      return res;
    },
    write: () => true,
    end(b?: string) {
      if (typeof b === "string") text = b;
      return res;
    },
  } as unknown as ServerResponse;
  const url = new URL(`http://x${path}`);
  const headers: Record<string, string> = auth.token !== undefined ? { "x-loom-token": auth.token } : {};
  await rt.handle(fakeReq(body, headers), res, method, url.pathname, url, auth.moderator === true ? { moderator: true, moderatorName: "Ada" } : {});
  return { status, json: JSON.parse(text || "{}") as Record<string, unknown> };
}
const mod = (rt: EventRuntime, path: string, body: unknown = {}) => call(rt, "POST", path, body, { moderator: true });

async function capturedPersona(rt: EventRuntime, name: string): Promise<string> {
  const id = ((await mod(rt, "/api/mod/persona", { name })).json.guest as { id: string }).id;
  expect((await mod(rt, "/api/mod/signal", { name: "send to the internet", subject: id, actor: "Norton Anti-Virus" })).status).toBe(200);
  return id;
}

describe("EventRuntime — the intro routes", () => {
  it("prefs: saved by the session token, dealt again, and kept across a restart", async () => {
    const d = freshDir();
    const rt = runtimeAt(d);
    rt.openDoors();
    const gid = await capturedPersona(rt, "Pinball");
    const a = (await mod(rt, "/api/mod/spatial/begin", { guest: gid, world: "web", device: "Tent tablet" })).json as unknown as Assignment;
    expect(a.reinstalled).toBe(0);
    expect(a.prefs).toBeNull();

    expect((await call(rt, "POST", "/api/spatial/prefs", { turn: "sideways" }, { token: a.token })).status).toBe(400);
    expect((await call(rt, "POST", "/api/spatial/prefs", { turn: "smooth" }, { token: "nope" })).status).toBe(401);
    const saved = await call(rt, "POST", "/api/spatial/prefs", { turn: "smooth" }, { token: a.token });
    expect(saved).toEqual({ status: 200, json: { ok: true, prefs: { turn: "smooth" } } });
    expect(await call(rt, "POST", "/api/spatial/ready", {}, { token: a.token })).toEqual({ status: 200, json: { ok: true } });
    // Nothing of it reaches the journal.
    expect(new Store(d).readJournal().some((l) => JSON.stringify(l).includes("smooth"))).toBe(false);

    // The candidates say how many reinstallations each program completed.
    const cands = await call(rt, "GET", "/api/mod/spatial/candidates", {}, { moderator: true });
    expect((cands.json.players as Array<{ id: string; reinstalled: number }>).find((p) => p.id === gid)?.reinstalled).toBe(0);

    // Walk to Gerald: one completed reinstallation.
    const [x, y, z] = a.duck.pos;
    await call(rt, "POST", "/api/spatial/pose", { p: [x + 0.3, y, z], yaw: 0 }, { token: a.token });
    expect((await call(rt, "POST", "/api/spatial/found", {}, { token: a.token })).status).toBe(200);
    rt.dispose();

    // A restart: the run log and the settings come back from disk.
    const rt2 = runtimeAt(d);
    expect(rt2.restore()).not.toBeNull();
    rt2.openDoors();
    const cands2 = await call(rt2, "GET", "/api/mod/spatial/candidates", {}, { moderator: true });
    expect((cands2.json.players as Array<{ id: string; reinstalled: number }>).find((p) => p.id === gid)?.reinstalled).toBe(1);
    await mod(rt2, "/api/mod/signal", { name: "send to the internet", subject: gid, actor: "Norton Anti-Virus" });
    const b = (await mod(rt2, "/api/mod/spatial/begin", { guest: gid, world: "vr", device: "Quest" })).json as unknown as Assignment;
    expect(b).toMatchObject({ reinstalled: 1, prefs: { turn: "smooth" } });
    rt2.dispose();
  });
});
