//! (wave 59) The run reset: a player stuck on geometry goes back to the spawn
//! and Gerald goes somewhere new, never the spot he was in. No clock, level,
//! hit or score moves, and nothing is journaled.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { validateHouse, type Assignment, type HouseMap } from "@loom/house";
import { EventRuntime } from "../server/event-runtime.ts";
import { SpatialHub } from "../server/spatial.ts";
import { Store } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";

const map = (path: string): HouseMap => {
  const v = validateHouse(JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
};
const show = (name: string): HouseMap => map(`../examples/trapped-in-the-internet/${name}.json`);
const fixture = (name: string): HouseMap => map(`../../house/test/fixtures/${name}.json`);

function harness(house: HouseMap) {
  let clock = 1_000;
  let ids = 0;
  const hub = new SpatialHub({
    eventId: "evt",
    now: () => clock,
    newSessionId: () => `s-${String(++ids).padStart(6, "0")}`,
    newToken: () => `tok-${ids}`,
  });
  hub.setHouse(house, "show", false);
  const frames: Array<[string, Record<string, unknown>]> = [];
  hub.attach({ id: "term", name: "Tent", send: (e, d) => frames.push([e, d as Record<string, unknown>]) });
  const begin = (guest: string): Assignment => hub.begin({ guest, name: guest.toUpperCase(), world: "web", device: "Tent laptop", station: null, captured: true })!;
  return { hub, begin, frames, tick: (ms: number) => (clock += ms) };
}

describe("SpatialHub.runReset", () => {
  for (const name of ["house", "house.shed"]) {
    it(`${name}: goes back to that map's spawn and deals a new spot, every time, never the one he was in`, () => {
      const house = show(name);
      const h = harness(house);
      const a = h.begin("g-1");
      expect(h.hub.pose(a.token, { p: [3.65, 0, 8.5], yaw: 10, pitch: 5 })).toBe("ok");
      let was = a.duck.id;
      const seen = new Set<string>([was]);
      for (let i = 0; i < 40; i++) {
        const out = h.hub.runReset(a.token);
        expect(out.kind).toBe("ok");
        if (out.kind !== "ok") return;
        expect(out.duck.id).not.toBe(was);
        expect(out.spawn).toEqual(house.spawn);
        was = out.duck.id;
        seen.add(was);
      }
      // A map has more than two places to hide him in.
      expect(seen.size).toBeGreaterThan(2);
      expect(h.hub.duckFor(a.token)?.id).toBe(was);
    });
  }

  it("on a map of two spots it still moves him, with the last find ruled out too", () => {
    const house = fixture("two-rooms");
    const spots = [house.duck.spots[0]!, { ...house.duck.spots[0]!, id: "second" }];
    const h = harness({ ...house, duck: { ...house.duck, spots } });
    const first = h.begin("g-1");
    h.hub.pose(first.token, { p: [...first.duck.pos], yaw: 0, pitch: 0 });
    expect(h.hub.found(first.token, () => true)).toMatchObject({ kind: "found" });
    const a = h.begin("g-1");
    const out = h.hub.runReset(a.token);
    expect(out.kind === "ok" && out.duck.id !== a.duck.id).toBe(true);
  });

  it("tells every watcher: the new duck at once, the jump to the spawn on the next flush", () => {
    const house = show("house");
    const h = harness(house);
    const a = h.begin("g-1");
    h.hub.pose(a.token, { p: [3.65, 0, 8.5], yaw: 0, pitch: 0 });
    h.hub.flush();
    h.frames.length = 0;
    const out = h.hub.runReset(a.token);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(h.frames.filter(([e]) => e === "duck")).toEqual([["duck", { session: a.session, duck: out.duck }]]);
    h.hub.flush();
    const poses = h.frames.find(([e]) => e === "poses")?.[1] as { players: Array<{ session: string; p: number[]; room: string }> };
    expect(poses.players.find((p) => p.session === a.session)).toMatchObject({ p: house.spawn.pos, room: house.spawn.room });
  });

  it("moves nothing else: the run's clock, the level, the visit's hit", () => {
    const h = harness(show("house"));
    const a = h.begin("g-1");
    h.hub.ready(a.token);
    h.tick(30_000);
    const before = h.hub.players().find((p) => p.session === a.session);
    expect(h.hub.runReset(a.token).kind).toBe("ok");
    const after = h.hub.players().find((p) => p.session === a.session);
    expect(after?.startedAt).toBe(before?.startedAt);
    expect(after?.found).toBe(false);
    h.tick(1_000);
    h.hub.pose(a.token, { p: [...(h.hub.duckFor(a.token)!.pos)], yaw: 0, pitch: 0 });
    const found = h.hub.found(a.token, () => true);
    expect(found).toMatchObject({ kind: "found" });
    // The run is timed from the end of the intro, reset or no reset.
    expect(h.hub.runs()[0]?.ms).toBe(31_000);
    expect(h.hub.reinstalledBy("g-1")).toBe(1);
  });

  it("a find stands: nothing moves after it", () => {
    const h = harness(show("house"));
    const a = h.begin("g-1");
    h.hub.pose(a.token, { p: [...a.duck.pos], yaw: 0, pitch: 0 });
    h.hub.found(a.token, () => true);
    expect(h.hub.runReset(a.token)).toEqual({ kind: "found" });
  });

  it("a dead token hears unknown or over", () => {
    const h = harness(show("house"));
    expect(h.hub.runReset("nope")).toEqual({ kind: "unknown" });
    const a = h.begin("g-1");
    h.hub.end(a.session);
    expect(h.hub.runReset(a.token)).toEqual({ kind: "over" });
  });
});

// ---------------------------------------------------------------------------
// EventRuntime: the route
// ---------------------------------------------------------------------------

const SCENARIO = scenarioSource("trapped-in-the-internet");
const CODES = { event: "EVT223", prime: "PRM223", mod: "MOD223" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function fakeReq(body: unknown, headers: Record<string, string>): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body));
  return {
    headers: { "content-type": "application/json", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
    destroy() {},
  } as unknown as IncomingMessage;
}
async function call(rt: EventRuntime, path: string, body: unknown = {}, auth: { moderator?: boolean; token?: string } = {}) {
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
  await rt.handle(fakeReq(body, headers), res, "POST", url.pathname, url, auth.moderator === true ? { moderator: true, moderatorName: "Ada" } : {});
  return { status, json: JSON.parse(text || "{}") as Record<string, unknown> };
}

describe("POST /api/spatial/reset", () => {
  it("answers the spawn and the new duck, journals nothing, and dead tokens hear 401 / 410", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-spatial-reset-"));
    dirs.push(d);
    const store = new Store(d);
    const rt = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "trapped-in-the-internet", scenarioSource: SCENARIO, joinBase: () => "http://localhost" });
    rt.openDoors();
    const mod = (path: string, body: unknown) => call(rt, path, body, { moderator: true });
    const id = ((await mod("/api/mod/persona", { name: "Pinball" })).json.guest as { id: string }).id;
    expect((await mod("/api/mod/signal", { name: "send to the internet", subject: id, actor: "Norton Anti-Virus" })).status).toBe(200);
    const a = (await mod("/api/mod/spatial/begin", { guest: id, world: "web", device: "Tent laptop" })).json as unknown as Assignment;
    const journal = store.readJournal().length;

    const reset = await call(rt, "/api/spatial/reset", {}, { token: a.token });
    expect(reset.status).toBe(200);
    expect(reset.json.spawn).toEqual(a.spawn);
    expect((reset.json.duck as { id: string }).id).not.toBe(a.duck.id);
    expect(store.readJournal().length).toBe(journal);

    expect((await call(rt, "/api/spatial/reset", {}, { token: "nope" })).status).toBe(401);
    await call(rt, "/api/spatial/end", {}, { token: a.token });
    expect((await call(rt, "/api/spatial/reset", {}, { token: a.token })).status).toBe(410);
    rt.dispose();
  });
});
