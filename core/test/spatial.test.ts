//! The reinstallation games' server half (`docs/loom-reinstall.md` §2):
//! the transport-free `SpatialHub` (sessions, stations, latest-only poses,
//! the duck's distance gate, timeouts, reset) and its wiring in
//! `EventRuntime` (the `/api/spatial/*` + `/api/mod/spatial/*` routes, the
//! stream, the journaled outcome, restart, the house map's sources).

import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it, vi } from "vitest";

import { validateHouse, type Assignment, type HouseMap } from "@loom/house";
import {
  FOUND_LINGER_MS,
  PARK_TIMEOUT_MS,
  POSE_TIMEOUT_MS,
  SpatialHub,
  houseWarnings,
  nearDuck,
  parsePose,
  sortCandidates,
  type SessionRef,
} from "../server/spatial.ts";
import { EventRuntime, defaultHouseFile } from "../server/event-runtime.ts";
import { PayloadTooLarge } from "../server/http-util.ts";
import { Store } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";

const fixture = (name: string): HouseMap => {
  const v = validateHouse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../house/test/fixtures/${name}.json`, import.meta.url)), "utf8")));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
};
const SHOW_HOUSE_FILE = fileURLToPath(new URL("../examples/trapped-in-the-internet/house.json", import.meta.url));

// ---------------------------------------------------------------------------
// SpatialHub (no sim, no sockets)
// ---------------------------------------------------------------------------

function hubHarness() {
  let clock = 1_000;
  let ids = 0;
  const hub = new SpatialHub({
    eventId: "evt",
    now: () => clock,
    newSessionId: () => `s-${String(++ids).padStart(6, "0")}`,
    newToken: () => `tok-${ids}`,
  });
  hub.setHouse(fixture("two-rooms"), "show", false);
  const frames: Array<[string, unknown]> = [];
  hub.attach({ id: "term", name: "Kitchen", send: (e, d) => frames.push([e, d]) });
  const of = (event: string) => frames.filter(([e]) => e === event).map(([, d]) => d as Record<string, unknown>);
  const begin = (guest: string, station: string | null = null, captured = true) =>
    hub.begin({ guest, name: guest.toUpperCase(), world: station === null ? "web" : "vr", device: "Tent tablet", station, captured })!;
  return { hub, frames, of, begin, tick: (ms: number) => (clock += ms), now: () => clock };
}

describe("SpatialHub", () => {
  it("says hello with the house version and the players already inside", () => {
    const h = hubHarness();
    expect(h.of("hello")).toEqual([{ eventId: "evt", houseVersion: h.hub.version, players: [] }]);
    h.begin("g-1");
    const late: Array<[string, unknown]> = [];
    h.hub.attach({ id: "late", name: "TV", send: (e, d) => late.push([e, d]) });
    const hello = late[0]![1] as { players: Array<{ guest: string; room: string; p: number[] }> };
    expect(hello.players).toHaveLength(1);
    expect(hello.players[0]).toMatchObject({ guest: "g-1", room: "a", p: [1, 0, 2] }); // standing at the spawn
  });

  it("begin deals an assignment: a duck outside the spawn room, the spawn, the version", () => {
    const h = hubHarness();
    const a = h.begin("g-1");
    expect(a).toMatchObject({ session: "s-000001", token: "tok-1", guest: "g-1", world: "web", device: "Tent tablet", station: null, captured: true });
    expect(a.duck.room).not.toBe("a");
    expect(a.spawn).toEqual({ room: "a", pos: [1, 0, 2], yaw: 0 });
    expect(a.houseVersion).toBe(h.hub.version);
    expect(h.of("join")).toHaveLength(1); // not parked → in the simulation at once
  });

  it("flush sends only the players that moved since the last flush", () => {
    const h = hubHarness();
    const a = h.begin("g-1");
    const b = h.begin("g-2");
    expect(h.hub.flush()).toBeNull(); // nobody moved yet
    expect(h.hub.pose(a.token, { p: [2, 0, 1], yaw: 10, pitch: 0 })).toBe("ok");
    expect(h.hub.pose(a.token, { p: [2.5, 0, 1], yaw: 20, pitch: -5 })).toBe("ok"); // latest only
    const frame = h.hub.flush()!;
    expect(frame.players).toEqual([{ session: a.session, p: [2.5, 0, 1], yaw: 20, pitch: -5, room: "a", floor: "f" }]);
    expect(h.hub.flush()).toBeNull();
    h.hub.pose(a.token, { p: [2.5, 0, 1], yaw: 20, pitch: -5 }); // the same pose again is no change
    h.hub.pose(b.token, { p: [5, 0, 1], yaw: 0, pitch: 0 });
    expect(h.hub.flush()!.players.map((p) => [p.session, p.room])).toEqual([[b.session, "b"]]);
    expect(h.of("poses")).toHaveLength(2);
  });

  it("an unknown token is unknown, a finished one is over", () => {
    const h = hubHarness();
    expect(h.hub.pose("nope", { p: [0, 0, 0], yaw: 0, pitch: 0 })).toBe("unknown");
    const a = h.begin("g-1");
    expect(h.hub.endByToken(a.token)).toBe("ok");
    expect(h.of("leave")).toEqual([{ session: a.session, reason: "ended" }]);
    expect(h.hub.pose(a.token, { p: [0, 0, 0], yaw: 0, pitch: 0 })).toBe("over");
    expect(h.hub.found(a.token, () => true)).toEqual({ kind: "over" });
  });

  it("a silent session times out after 60 s; a pose keeps it alive", () => {
    const h = hubHarness();
    const a = h.begin("g-1");
    h.tick(POSE_TIMEOUT_MS - 1);
    h.hub.pose(a.token, { p: [1, 0, 1], yaw: 0, pitch: 0 });
    h.tick(POSE_TIMEOUT_MS - 1);
    h.hub.sweep();
    expect(h.hub.sessionCount).toBe(1);
    h.tick(1);
    h.hub.sweep();
    expect(h.hub.sessionCount).toBe(0);
    expect(h.of("leave")).toEqual([{ session: a.session, reason: "timeout" }]);
  });

  it("found is refused far from the duck, commits once near it, then lingers 8 s", () => {
    const h = hubHarness();
    const a = h.begin("g-1");
    const commits: SessionRef[] = [];
    const release = (s: SessionRef) => (commits.push(s), true);
    const far = h.hub.found(a.token, release);
    expect(far.kind).toBe("far");
    expect(commits).toEqual([]);
    const [x, y, z] = a.duck.pos;
    // Just over 2 m away in plan: refused.
    h.hub.pose(a.token, { p: [x - 2.1, y, z], yaw: 0, pitch: 0 });
    expect(h.hub.found(a.token, release).kind).toBe("far");
    h.hub.pose(a.token, { p: [x + 1.5, y, z - 1], yaw: 0, pitch: 0 }); // 1.8 m in plan
    expect(h.hub.found(a.token, release)).toEqual({ kind: "found", released: true, already: false });
    expect(commits).toEqual([{ id: a.session, guest: "g-1", device: "Tent tablet", captured: true }]);
    expect(h.of("found")).toEqual([{ session: a.session, guest: "g-1", name: "G-1", duck: a.duck, released: true }]);
    // A repeat answers `already`, commits nothing.
    expect(h.hub.found(a.token, release)).toEqual({ kind: "found", released: true, already: true });
    expect(commits).toHaveLength(1);
    expect(h.hub.players()[0]?.found).toBe(true);
    h.tick(FOUND_LINGER_MS - 1);
    h.hub.sweep();
    expect(h.hub.sessionCount).toBe(1);
    h.tick(1);
    h.hub.sweep();
    expect(h.of("leave")).toEqual([{ session: a.session, reason: "found" }]);
    // The next duck avoids the spot they just found.
    const again = h.begin("g-1");
    expect(again.duck.id).not.toBe(a.duck.id);
  });

  it("a second begin for the guest replaces the first", () => {
    const h = hubHarness();
    const a = h.begin("g-1");
    const b = h.begin("g-1");
    expect(h.of("leave")).toEqual([{ session: a.session, reason: "replaced" }]);
    expect(h.hub.pose(a.token, { p: [1, 0, 1], yaw: 0, pitch: 0 })).toBe("over");
    expect(h.hub.pose(b.token, { p: [1, 0, 1], yaw: 0, pitch: 0 })).toBe("ok");
    expect(h.hub.sessionCount).toBe(1);
  });

  it("a station's assignment is parked until its first pose claims it", () => {
    const h = hubHarness();
    expect(h.hub.station("vr-1", "Headset 1", "vr")).toBeNull();
    const a = h.begin("g-1", "vr-1");
    expect(h.of("join")).toEqual([]); // parked: not a player yet
    expect(h.hub.players()).toEqual([]);
    expect(h.hub.station("vr-1", "Headset 1", "vr")).toEqual(a);
    expect(h.hub.stationList()).toEqual([
      { id: "vr-1", name: "Headset 1", world: "vr", online: true, busy: { session: a.session, guest: "g-1", name: "G-1" } },
    ]);
    // A newer assignment for the same station replaces an unclaimed one.
    const b = h.begin("g-2", "vr-1");
    expect(h.hub.station("vr-1", "Headset 1", "vr")?.session).toBe(b.session);
    expect(h.hub.pose(a.token, { p: [1, 0, 1], yaw: 0, pitch: 0 })).toBe("over");
    h.hub.pose(b.token, { p: [1.5, 0, 1], yaw: 45, pitch: 0 });
    expect(h.of("join").map((j) => (j.player as { session: string; p: number[] }).p)).toEqual([[1.5, 0, 1]]);
    expect(h.hub.station("vr-1", "Headset 1", "vr")).toBeNull(); // claimed
    expect(h.hub.flush()).toBeNull(); // the claiming pose rode the join
    h.tick(5_000);
    expect(h.hub.stationList()[0]?.online).toBe(false);
  });

  it("an unclaimed parked assignment is dropped after a while, silently", () => {
    const h = hubHarness();
    h.begin("g-1", "vr-1");
    h.tick(POSE_TIMEOUT_MS * 2);
    h.hub.sweep();
    expect(h.hub.sessionCount).toBe(1); // a headset may sit on the desk a while
    h.tick(PARK_TIMEOUT_MS);
    h.hub.sweep();
    expect(h.hub.sessionCount).toBe(0);
    expect(h.of("leave")).toEqual([]); // it never joined
  });

  it("reset ends every session and tells the stream", () => {
    const h = hubHarness();
    const a = h.begin("g-1");
    h.begin("g-2", "vr-1");
    h.hub.reset("reload");
    expect(h.of("leave")).toEqual([{ session: a.session, reason: "reset" }]);
    expect(h.of("reset")).toEqual([{ kind: "reload" }]);
    expect(h.hub.sessionCount).toBe(0);
    expect(h.hub.pose(a.token, { p: [1, 0, 1], yaw: 0, pitch: 0 })).toBe("over");
    expect(h.hub.active).toBe(true); // the terminal is still watching
  });

  it("a duck raised above the height bound (a shelf) is still found from its floor", () => {
    const h = hubHarness();
    const shelf = fixture("two-rooms");
    shelf.duck.spots = shelf.duck.spots.map((s) => ({ ...s, pos: [s.pos[0], 1.3, s.pos[2]] }));
    h.hub.setHouse(shelf, "event", false);
    const a = h.begin("g-1");
    expect(a.duck.pos[1]).toBe(1.3);
    // The games' reach rule (plan + same floor) says reached; so must the server.
    h.hub.pose(a.token, { p: [a.duck.pos[0], 0, a.duck.pos[2]], yaw: 0, pitch: 0 });
    expect(h.hub.found(a.token, () => true)).toEqual({ kind: "found", released: true, already: false });
  });

  it("three floors: poses are labelled per floor, and Gerald upstairs is never found from the floor below", () => {
    // `three-floors`: basement −2.7 / main 0 / top 2.8, two flights end to end in
    // the hall — the real house's shape (2026-10-15).
    const h = hubHarness();
    const house = fixture("three-floors");
    h.hub.setHouse(house, "event", false);
    const a = h.begin("g-1");
    const rooms: string[] = [];
    for (const p of [[1, -2.7, 1], [1, 0, 5], [1, 2.8, 7]] as const) {
      h.hub.pose(a.token, { p: [...p], yaw: 0, pitch: 0 });
      h.hub.flush();
      const last = h.of("poses").at(-1)!["players"] as Array<{ room: string; floor: string }>;
      rooms.push(`${last[0]!.floor}/${last[0]!.room}`);
    }
    expect(rooms).toEqual(["basement/server", "main/office", "top/crawl"]);
    // The crawl-space duck straight overhead of someone in the office.
    const crawl = house.duck.spots.find((s) => s.id === "crawl-box")!;
    expect(nearDuck([crawl.pos[0], 0, crawl.pos[2]], crawl.pos, house).near).toBe(false);
    expect(nearDuck([crawl.pos[0], 2.8, crawl.pos[2]], crawl.pos, house).near).toBe(true);
  });

  it("found on a parked assignment nobody has played is refused; it stays parked", () => {
    const h = hubHarness();
    const a = h.begin("g-1", "vr-1");
    const commits: SessionRef[] = [];
    expect(h.hub.found(a.token, (s) => (commits.push(s), true))).toEqual({ kind: "parked" });
    expect(commits).toEqual([]);
    expect(h.of("join")).toEqual([]);
    expect(h.hub.station("vr-1", "Headset 1", "vr")?.session).toBe(a.session);
  });

  it("a station claiming a new assignment ends the one it left behind (replaced)", () => {
    const h = hubHarness();
    h.hub.station("vr-1", "Headset 1", "vr");
    const a = h.begin("g-1", "vr-1");
    h.hub.pose(a.token, { p: [1, 0, 1], yaw: 0, pitch: 0 });
    // The headset crashes mid-game: A is never ended. It comes back with B.
    const b = h.begin("g-2", "vr-1");
    expect(h.hub.sessionCount).toBe(2); // a parked assignment never cuts off a live player
    h.hub.pose(b.token, { p: [1.5, 0, 1], yaw: 0, pitch: 0 });
    expect(h.hub.sessionCount).toBe(1);
    expect(h.hub.pose(a.token, { p: [1, 0, 1], yaw: 0, pitch: 0 })).toBe("over");
    expect(h.of("leave")).toEqual([{ session: a.session, reason: "replaced" }]);
    expect(h.hub.stationList()[0]?.busy?.session).toBe(b.session);
    expect(h.hub.players().map((p) => p.session)).toEqual([b.session]);
  });

  it("a map save moves a live session's duck with its spot, re-deals a vanished one, relabels rooms", () => {
    const h = hubHarness();
    const a = h.begin("g-1");
    const b = h.begin("g-2");
    h.hub.pose(a.token, { p: [5, 0, 1], yaw: 0, pitch: 0 }); // in room b
    h.hub.flush();
    // Room b moves 10 m east, carrying its spots; A's spot keeps its id.
    const moved = fixture("two-rooms");
    const shift = (p: [number, number]): [number, number] => [p[0] + 10, p[1]];
    moved.rooms[1]!.poly = moved.rooms[1]!.poly.map(shift);
    moved.duck.spots = moved.duck.spots.map((s) => (s.room === "b" ? { ...s, pos: [s.pos[0] + 10, s.pos[1], s.pos[2]] } : s));
    // …and B's spot is deleted outright.
    moved.duck.spots = moved.duck.spots.filter((s) => s.id !== b.duck.id || s.id === a.duck.id);
    const v = h.hub.setHouse(moved, "event");
    const aDuck = h.hub.duckFor(a.token)!;
    expect(aDuck.id).toBe(a.duck.id);
    expect(aDuck.pos[0]).toBe(a.duck.pos[0] + 10);
    if (b.duck.id !== a.duck.id) {
      const bDuck = h.hub.duckFor(b.token)!;
      expect(moved.duck.spots.map((s) => s.id)).toContain(bDuck.id);
      expect(bDuck.id).not.toBe(b.duck.id);
    }
    // A's room is recomputed: x = 5 is no longer room b.
    const frame = h.hub.flush()!;
    expect(frame.players.find((p) => p.session === a.session)?.room).toBeNull();
    expect(h.hub.players().every((p) => p.duck.pos !== undefined)).toBe(true);
    expect(h.of("house")).toEqual([{ version: v }]);
    // Each player whose duck moved hears it, after the `house` frame.
    const ducks = h.of("duck");
    expect(ducks[0]).toEqual({ session: a.session, duck: aDuck });
    if (b.duck.id !== a.duck.id) expect(ducks[1]).toEqual({ session: b.session, duck: h.hub.duckFor(b.token) });
    expect(ducks).toHaveLength(b.duck.id !== a.duck.id ? 2 : 1);
    const names = h.frames.map(([e]) => e);
    expect(names.indexOf("house")).toBeLessThan(names.indexOf("duck"));
    // Walking to the moved spot finds it.
    h.hub.pose(a.token, { p: aDuck.pos, yaw: 0, pitch: 0 });
    expect(h.hub.found(a.token, () => true).kind).toBe("found");
    expect(h.hub.duckFor("nope")).toBeNull();
  });

  it("a new map is announced; sessions keep their duck", () => {
    const h = hubHarness();
    const a = h.begin("g-1");
    const before = h.hub.version;
    const v = h.hub.setHouse({ ...fixture("two-rooms"), name: "Edited" }, "event");
    expect(v).not.toBe(before);
    expect(h.of("house")).toEqual([{ version: v }]);
    expect(h.hub.source).toBe("event");
    expect(h.hub.players()[0]?.duck).toEqual(a.duck);
    expect(h.of("duck")).toEqual([]); // nobody's duck moved
  });

  it("a map save sends no duck frame for a parked assignment or a found session", () => {
    const h = hubHarness();
    const parked = h.begin("g-1", "vr-1");
    const done = h.begin("g-2");
    h.hub.pose(done.token, { p: done.duck.pos, yaw: 0, pitch: 0 });
    expect(h.hub.found(done.token, () => false).kind).toBe("found");
    // Every spot moves 1 cm east.
    const moved = fixture("two-rooms");
    moved.duck.spots = moved.duck.spots.map((s) => ({ ...s, pos: [s.pos[0] + 0.01, s.pos[1], s.pos[2]] }));
    h.hub.setHouse(moved, "event");
    expect(h.of("duck")).toEqual([]);
    // The parked one still follows its spot (it learns it from the map GET).
    expect(h.hub.duckFor(parked.token)!.pos[0]).toBeCloseTo(parked.duck.pos[0] + 0.01);
    expect(h.hub.duckFor(done.token)).toEqual(done.duck); // a found duck stays put
  });
});

describe("spatial helpers", () => {
  it("parsePose validates, clamps and normalises", () => {
    expect(parsePose({ p: [1, 2, 3], yaw: 190 })).toEqual({ p: [1, 2, 3], yaw: -170, pitch: 0 });
    expect(parsePose({ p: [5000, -2, -9999], yaw: -180, pitch: 120 })).toEqual({ p: [1000, -2, -1000], yaw: -180, pitch: 90 });
    expect(parsePose({ p: [1, 2], yaw: 0 })).toBeNull();
    expect(parsePose({ p: [1, 2, Number.NaN], yaw: 0 })).toBeNull();
    expect(parsePose({ p: [1, 2, "3"], yaw: 0 })).toBeNull();
    expect(parsePose({ p: [1, 2, 3] })).toBeNull();
    expect(parsePose({ p: [1, 2, 3], yaw: 0, pitch: "up" })).toBeNull();
  });

  it("nearDuck: within 2 m in plan and 1.2 m in height", () => {
    expect(nearDuck([2, 0, 0], [0, 0, 0]).near).toBe(true);
    expect(nearDuck([2.01, 0, 0], [0, 0, 0]).near).toBe(false);
    expect(nearDuck([0, 0, 0], [0, 0.9, 0]).near).toBe(true); // a duck on the counter
    expect(nearDuck([0, 2.7, 0], [0, 0, 0]).near).toBe(false); // the floor above
    // With the map: the same floor (`floorOf`, the games' rule) also counts.
    const stair = fixture("stair");
    expect(nearDuck([0.5, -3, 3.5], [0.5, -1.7, 3.5]).near).toBe(false); // 1.3 m up a shelf
    expect(nearDuck([0.5, -3, 3.5], [0.5, -1.7, 3.5], stair).near).toBe(true);
    expect(nearDuck([0.5, 0, 3.5], [0.5, -1.7, 3.5], stair).near).toBe(false); // the floor above it
    expect(nearDuck([2.6, -3, 3.5], [0.5, -1.7, 3.5], stair).near).toBe(false); // too far in plan
  });

  it("sortCandidates: captured first, then by name", () => {
    const rows = [
      { id: "g-2", name: "Winamp", captured: false, location: null },
      { id: "g-1", name: "Pinball", captured: true, location: "The Internet" },
      { id: "g-3", name: "Clippy Jr", captured: false, location: "The Desktop" },
    ];
    expect(sortCandidates(rows).map((r) => r.id)).toEqual(["g-1", "g-3", "g-2"]);
  });

  it("houseWarnings names rooms whose location the story lacks", () => {
    const house = fixture("two-rooms");
    house.rooms[0]!.location = "The Desktop";
    house.rooms[1]!.location = "Narnia";
    expect(houseWarnings(house, (n) => n === "The Desktop")).toEqual(['room "b": location "Narnia" is not a LOCATION in the story']);
  });
});

// ---------------------------------------------------------------------------
// EventRuntime wiring (fake req/res, the real show)
// ---------------------------------------------------------------------------

const SCENARIO = scenarioSource("trapped-in-the-internet");
const CODES = { event: "EVT222", prime: "PRM222", mod: "MOD222" };

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-spatial-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function runtimeAt(d: string, clock?: { t: number }, houseFile?: string): EventRuntime {
  return new EventRuntime({
    ...(houseFile !== undefined ? { houseFile } : {}),
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "trapped-in-the-internet",
    scenarioSource: SCENARIO,
    joinBase: () => "http://localhost",
    ...(clock !== undefined ? { now: () => clock.t } : {}),
  });
}

function fakeReq(body: unknown, headers: Record<string, string> = {}, onClose?: (fn: () => void) => void): IncomingMessage {
  const buf = Buffer.from(typeof body === "string" ? body : JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on(ev: string, fn: () => void) {
      if (ev === "close") onClose?.(fn);
    },
    destroy() {},
  } as unknown as IncomingMessage;
}
function fakeRes(): ServerResponse & { statusCode: number; body: string } {
  const res = {
    statusCode: 0,
    body: "",
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
  return res as unknown as ServerResponse & { statusCode: number; body: string };
}

type Auth = { moderator?: boolean; token?: string };
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: unknown = {}, auth: Auth = {}) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  const headers: Record<string, string> = auth.token !== undefined ? { "x-loom-token": auth.token } : {};
  const handled = await rt.handle(fakeReq(body, headers), res, method, url.pathname, url, auth.moderator === true ? { moderator: true, moderatorName: "Ada" } : {});
  return { handled, status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
const mod = (rt: EventRuntime, path: string, body: unknown = {}) => call(rt, "POST", path, body, { moderator: true });
const modGet = (rt: EventRuntime, path: string) => call(rt, "GET", path, {}, { moderator: true });

/** Open the spatial stream; every frame lands in `frames`. */
function spatialStream(rt: EventRuntime, query: string, auth: Auth = {}) {
  let closer: (() => void) | undefined;
  let buf = "";
  let status = 0;
  let ended = false;
  const res = {
    writeHead(s: number) {
      status = s;
      return res;
    },
    write(chunk: string) {
      buf += chunk;
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") buf += b;
      ended = true;
      return res;
    },
  } as unknown as ServerResponse;
  const url = new URL(`http://x/api/spatial/stream?${query}`);
  const headers: Record<string, string> = auth.token !== undefined ? { "x-loom-token": auth.token } : {};
  const open = rt.handle(fakeReq(null, headers, (fn) => (closer = fn)), res, "GET", url.pathname, url, auth.moderator === true ? { moderator: true } : {});
  const frames = (): Array<{ event: string; data: Record<string, unknown> }> => {
    const out: Array<{ event: string; data: Record<string, unknown> }> = [];
    for (const m of buf.matchAll(/event: (\w+)\ndata: (.*)\n\n/gu)) out.push({ event: m[1]!, data: JSON.parse(m[2]!) });
    return out;
  };
  return { open, status: () => status, frames, of: (e: string) => frames().filter((f) => f.event === e).map((f) => f.data), close: () => closer?.(), isEnded: () => ended, raw: () => buf };
}

/** A program sent to the Internet by Norton (the show's own capture). */
async function capturedPersona(rt: EventRuntime, name: string): Promise<string> {
  const id = (await mod(rt, "/api/mod/persona", { name })).json.guest as { id: string };
  expect((await mod(rt, "/api/mod/signal", { name: "send to the internet", subject: id.id, actor: "Norton Anti-Virus" })).status).toBe(200);
  expect(rt.liveSim!.isCaptured(id.id)).toBe(true);
  return id.id;
}

describe("EventRuntime — the spatial plane", () => {
  it("the show's map by default (LOOM_HOUSE, else the example's house.json)", () => {
    if (process.env.LOOM_HOUSE === undefined) expect(defaultHouseFile()).toBe(SHOW_HOUSE_FILE);
  });

  it("a game plays: begin → stream → pose → found far (409) → found near (released, journaled by the device)", async () => {
    const d = freshDir();
    const rt = runtimeAt(d);
    rt.openDoors();
    const gid = await capturedPersona(rt, "Pinball");

    const house = await modGet(rt, "/api/spatial/house");
    expect(house.status).toBe(200);
    expect(house.json).toMatchObject({ source: "show", version: rt.spatial.version });
    expect((house.json.house as HouseMap).spawn.room).toBe("tent");

    const term = spatialStream(rt, "name=Kitchen", { moderator: true });
    await term.open;
    expect(term.status()).toBe(200);
    expect(term.raw().startsWith(":ok\n\n")).toBe(true);
    expect(term.of("hello")).toEqual([{ eventId: "evt", houseVersion: rt.spatial.version, players: [] }]);

    const begun = await mod(rt, "/api/mod/spatial/begin", { guest: gid, world: "web", device: "Tent tablet" });
    expect(begun.status).toBe(200);
    const a = begun.json as unknown as Assignment;
    expect(a).toMatchObject({ guest: gid, name: "Pinball", world: "web", device: "Tent tablet", station: null, captured: true });
    expect(a.duck.room).not.toBe("tent");
    expect(term.of("join").map((j) => (j.player as { session: string }).session)).toEqual([a.session]);

    // The game's own token reads the map + the stream (and its duck), and nothing else.
    const own = await call(rt, "GET", "/api/spatial/house", {}, { token: a.token });
    expect(own.status).toBe(200);
    expect(own.json.duck).toEqual(a.duck);
    expect(house.json.duck).toBeUndefined(); // a director has no duck
    expect((await call(rt, "GET", "/api/mod/spatial/stations", {}, { token: a.token })).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/spatial/begin", { guest: gid, world: "web" }, { token: a.token })).status).toBe(403);

    // Poses: 204, malformed 400; the terminal sees them on the next flush.
    expect((await call(rt, "POST", "/api/spatial/pose", { p: [4, -2.7, 5.5], yaw: 30 }, { token: a.token })).status).toBe(204);
    expect((await call(rt, "POST", "/api/spatial/pose", { p: [4, "x", 5.5], yaw: 30 }, { token: a.token })).status).toBe(400);
    rt.spatial.flush();
    const moved = term.of("poses").flatMap((f) => f.players as Array<{ session: string; room: string; floor: string }>);
    expect(moved).toContainEqual(expect.objectContaining({ session: a.session, room: "tent", floor: "basement" }));
    // Poses never touch the journal.
    expect(new Store(d).readJournal().some((l) => JSON.stringify(l.a).includes("pose"))).toBe(false);

    // Far from the duck: refused.
    const far = await call(rt, "POST", "/api/spatial/found", {}, { token: a.token });
    expect(far.status).toBe(409);
    expect(far.json.error).toBe("not near the duck");
    expect(far.json.distance).toBeGreaterThan(2);
    expect(rt.liveSim!.isCaptured(gid)).toBe(true);

    // Walk up to it.
    const [x, y, z] = a.duck.pos;
    expect((await call(rt, "POST", "/api/spatial/pose", { p: [x + 0.5, y, z + 0.5], yaw: 0 }, { token: a.token })).status).toBe(204);
    const near = await call(rt, "POST", "/api/spatial/found", {}, { token: a.token });
    expect(near.status).toBe(200);
    expect(near.json).toEqual({ ok: true, released: true, already: false });
    const sim = rt.liveSim!;
    expect(sim.isCaptured(gid)).toBe(false);
    expect(sim.holdsCodex(gid, "The Golden Duck")).toBe(true);
    expect(term.of("found")).toEqual([{ session: a.session, guest: gid, name: "Pinball", duck: a.duck, released: true }]);
    const signals = new Store(d).readJournal().filter((l) => l.m === "signal" && l.a[1] === gid && l.by === "Tent tablet");
    expect(signals.map((l) => l.a[0])).toEqual(["the simulation completed", "the golden duck"]);

    // Again: already, nothing new committed.
    const again = await call(rt, "POST", "/api/spatial/found", {}, { token: a.token });
    expect(again.json).toEqual({ ok: true, released: true, already: true });
    expect(new Store(d).readJournal().filter((l) => l.by === "Tent tablet")).toHaveLength(2);

    // The game ends; its token is over.
    expect((await call(rt, "POST", "/api/spatial/end", {}, { token: a.token })).json).toEqual({ ok: true });
    expect(term.of("leave")).toEqual([{ session: a.session, reason: "found" }]);
    expect((await call(rt, "POST", "/api/spatial/pose", { p: [0, 0, 0], yaw: 0 }, { token: a.token })).status).toBe(410);
    term.close();
    rt.dispose();
  });

  it("a free program finds Gerald: not released, still learns the duck", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const pid = ((await mod(rt, "/api/mod/persona", { name: "Winamp" })).json.guest as { id: string }).id;
    const a = (await mod(rt, "/api/mod/spatial/begin", { guest: pid, world: "web", device: "Tent tablet" })).json as unknown as Assignment;
    expect(a.captured).toBe(false);
    await call(rt, "POST", "/api/spatial/pose", { p: a.duck.pos, yaw: 0 }, { token: a.token });
    const found = await call(rt, "POST", "/api/spatial/found", {}, { token: a.token });
    expect(found.json).toEqual({ ok: true, released: false, already: false });
    expect(rt.liveSim!.holdsCodex(pid, "The Golden Duck")).toBe(true);
    rt.dispose();
  });

  it("begin: 409 without a scenario, 404 unknown guest, 400 bad world; the device defaults to the director", async () => {
    const rt = runtimeAt(freshDir());
    expect((await mod(rt, "/api/mod/spatial/begin", { guest: "g-1", world: "web" })).status).toBe(409);
    rt.openDoors();
    expect((await mod(rt, "/api/mod/spatial/begin", { guest: "g-nope", world: "web" })).status).toBe(404);
    const pid = ((await mod(rt, "/api/mod/persona", { name: "Paint" })).json.guest as { id: string }).id;
    expect((await mod(rt, "/api/mod/spatial/begin", { guest: pid, world: "ps1" })).status).toBe(400);
    const ok = await mod(rt, "/api/mod/spatial/begin", { guest: pid, world: "vr" });
    expect(ok.json).toMatchObject({ device: "Ada", world: "vr" });
    rt.dispose();
  });

  it("a headset station: park, poll, claim by the first pose; stations + candidates", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const captured = await capturedPersona(rt, "Pinball");
    await mod(rt, "/api/mod/persona", { name: "Arkanoid" });
    const cands = await modGet(rt, "/api/mod/spatial/candidates");
    expect((cands.json.players as Array<{ name: string; captured: boolean; location: string | null }>)[0]).toMatchObject({
      id: captured,
      name: "Pinball",
      captured: true,
      location: "The Internet",
    });

    const term = spatialStream(rt, "name=TV", { moderator: true });
    await term.open;
    expect((await modGet(rt, "/api/mod/spatial/station?id=vr-1&name=Headset%201&world=vr")).json).toEqual({ assignment: null });
    expect((await modGet(rt, "/api/mod/spatial/station?name=Headset")).status).toBe(400);
    const a = (await mod(rt, "/api/mod/spatial/begin", { guest: captured, world: "vr", device: "Headset 1", station: "vr-1" })).json as unknown as Assignment;
    expect(a.station).toBe("vr-1");
    expect(term.of("join")).toEqual([]);
    const polled = await modGet(rt, "/api/mod/spatial/station?id=vr-1&name=Headset%201&world=vr");
    expect(polled.json.assignment).toEqual(a);
    // Nobody has played it yet: found is refused and nothing is committed.
    const early = await call(rt, "POST", "/api/spatial/found", {}, { token: a.token });
    expect(early.status).toBe(409);
    expect(early.json.error).toBe("this session has not started — send a pose first");
    expect(rt.liveSim!.isCaptured(captured)).toBe(true);
    const stations = await modGet(rt, "/api/mod/spatial/stations");
    expect(stations.json.stations).toEqual([
      { id: "vr-1", name: "Headset 1", world: "vr", online: true, busy: { session: a.session, guest: captured, name: "Pinball" } },
    ]);
    expect((await call(rt, "POST", "/api/spatial/pose", { p: a.spawn.pos, yaw: a.spawn.yaw }, { token: a.token })).status).toBe(204);
    expect(term.of("join").map((j) => (j.player as { session: string }).session)).toEqual([a.session]);
    expect((await modGet(rt, "/api/mod/spatial/station?id=vr-1&world=vr")).json).toEqual({ assignment: null });

    // A director ends it.
    expect((await mod(rt, "/api/mod/spatial/end", { session: a.session })).json).toEqual({ ok: true });
    expect(term.of("leave")).toEqual([{ session: a.session, reason: "ended" }]);
    rt.dispose();
    expect(term.isEnded()).toBe(true);
  });

  it("a restart ends every session: reset frame, 410 on the next pose", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const pid = await capturedPersona(rt, "Pinball");
    const term = spatialStream(rt, "", { moderator: true });
    await term.open;
    const a = (await mod(rt, "/api/mod/spatial/begin", { guest: pid, world: "web", device: "Tent tablet" })).json as unknown as Assignment;
    await mod(rt, "/api/mod/reset");
    expect(term.of("leave")).toEqual([{ session: a.session, reason: "reset" }]);
    expect(term.of("reset")).toEqual([{ kind: "reset" }]);
    expect((await call(rt, "POST", "/api/spatial/pose", { p: [0, 0, 0], yaw: 0 }, { token: a.token })).status).toBe(410);
    expect((await call(rt, "POST", "/api/spatial/found", {}, { token: a.token })).status).toBe(410);
    expect(term.isEnded()).toBe(false); // the stream itself stays
    rt.dispose();
  });

  it("the map: a bad one is refused with its problems; a good one is saved, announced, warned about", async () => {
    const d = freshDir();
    const rt = runtimeAt(d);
    rt.openDoors();
    const term = spatialStream(rt, "", { moderator: true });
    await term.open;
    const show = (await modGet(rt, "/api/spatial/house")).json.house as HouseMap;

    const bad = await mod(rt, "/api/mod/spatial/house", { house: { ...show, rooms: [] } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("invalid house map");
    expect((bad.json.problems as string[]).length).toBeGreaterThan(0);
    expect(existsSync(join(d, "spatial-house.json"))).toBe(false);

    const edited: HouseMap = structuredClone(show);
    edited.name = "The house, measured";
    edited.rooms[0]!.location = "Narnia";
    const good = await mod(rt, "/api/mod/spatial/house", { house: edited });
    expect(good.status).toBe(200);
    expect(good.json.ok).toBe(true);
    expect(good.json.version).not.toBe(term.of("hello")[0]!.houseVersion);
    expect(good.json.warnings).toEqual([`room "${edited.rooms[0]!.id}": location "Narnia" is not a LOCATION in the story`]);
    expect(term.of("house")).toEqual([{ version: good.json.version }]);
    expect(existsSync(join(d, "spatial-house.json"))).toBe(true);
    expect(existsSync(join(d, "house.json"))).toBe(false); // never LOOM_HOUSE's name
    const now = await modGet(rt, "/api/spatial/house");
    expect(now.json).toMatchObject({ source: "event", version: good.json.version });
    expect((now.json.house as HouseMap).name).toBe("The house, measured");
    rt.dispose();

    // A fresh process over the same state reads the event's own map.
    const again = runtimeAt(d);
    again.restore();
    expect((await modGet(again, "/api/spatial/house")).json).toMatchObject({ source: "event", version: good.json.version });
  });

  it("a map save that moves a player's duck streams `duck {session, duck}`; the game's map GET agrees", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const pid = ((await mod(rt, "/api/mod/persona", { name: "Paint" })).json.guest as { id: string }).id;
    const term = spatialStream(rt, "", { moderator: true });
    await term.open;
    const a = (await mod(rt, "/api/mod/spatial/begin", { guest: pid, world: "web", device: "Tent tablet" })).json as unknown as Assignment;
    const show = (await modGet(rt, "/api/spatial/house")).json.house as HouseMap;

    // Nudge only this player's spot 20 cm east.
    const edited: HouseMap = structuredClone(show);
    edited.duck.spots = edited.duck.spots.map((s) => (s.id === a.duck.id ? { ...s, pos: [s.pos[0] + 0.2, s.pos[1], s.pos[2]] } : s));
    const saved = await mod(rt, "/api/mod/spatial/house", { house: edited });
    expect(saved.status).toBe(200);
    const duck = { ...a.duck, pos: [a.duck.pos[0] + 0.2, a.duck.pos[1], a.duck.pos[2]] };
    expect(term.of("duck")).toEqual([{ session: a.session, duck }]);
    expect((await call(rt, "GET", "/api/spatial/house", {}, { token: a.token })).json.duck).toEqual(duck);

    // A save that leaves the spot alone: no duck frame.
    expect((await mod(rt, "/api/mod/spatial/house", { house: { ...edited, name: "Renamed" } })).status).toBe(200);
    expect(term.of("duck")).toHaveLength(1);
    term.close();
    rt.dispose();
  });

  it("a map save with `base`: refused (409) when someone saved since; no `base`, no check", async () => {
    const d = freshDir();
    const rt = runtimeAt(d);
    const loaded = (await modGet(rt, "/api/spatial/house")).json;
    const show = loaded.house as HouseMap;
    const v0 = loaded.version as string;
    // A runtime that never loaded its map yet still checks `base` against the show's.
    const fresh = runtimeAt(freshDir());
    expect((await mod(fresh, "/api/mod/spatial/house", { house: { ...show, name: "First" }, base: "deadbeef" })).status).toBe(409);
    expect((await mod(fresh, "/api/mod/spatial/house", { house: { ...show, name: "First" }, base: v0 })).status).toBe(200);

    // Two directors loaded v0; Ada saves first.
    const ada = await mod(rt, "/api/mod/spatial/house", { house: { ...show, name: "Ada's" }, base: v0 });
    expect(ada.status).toBe(200);
    const v1 = ada.json.version as string;
    // Bo's save on the stale v0 is refused with the current version — nothing changes.
    const bo = await mod(rt, "/api/mod/spatial/house", { house: { ...show, name: "Bo's" }, base: v0 });
    expect(bo.status).toBe(409);
    expect(bo.json).toEqual({ error: "the map changed — reload", version: v1 });
    expect(rt.spatial.version).toBe(v1);
    expect((JSON.parse(readFileSync(join(d, "spatial-house.json"), "utf8")) as HouseMap).name).toBe("Ada's");
    // On the fresh version it goes through; a bad map still answers 400 first.
    expect((await mod(rt, "/api/mod/spatial/house", { house: { ...show, rooms: [] }, base: v0 })).status).toBe(400);
    const bo2 = await mod(rt, "/api/mod/spatial/house", { house: { ...show, name: "Bo's" }, base: v1 });
    expect(bo2.status).toBe(200);
    // No base: last write wins, as before.
    expect((await mod(rt, "/api/mod/spatial/house", { house: { ...show, name: "Cy's" } })).status).toBe(200);
    expect(rt.spatial.house!.name).toBe("Cy's");
    rt.dispose();
    fresh.dispose();
  });

  it("an invalid saved map falls back to the show's", async () => {
    const d = freshDir();
    new Store(d).saveHouse({ version: 1, rooms: "nope" });
    const rt = runtimeAt(d);
    expect((await modGet(rt, "/api/spatial/house")).json.source).toBe("show");
  });

  it("every route refuses a caller without the right token", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const pid = ((await mod(rt, "/api/mod/persona", { name: "Paint" })).json.guest as { id: string }).id;
    // Mod routes: 403 without a mod token / author session.
    for (const path of ["/api/mod/spatial/station?id=vr-1&world=vr", "/api/mod/spatial/stations", "/api/mod/spatial/candidates"]) {
      expect((await call(rt, "GET", path)).status, path).toBe(403);
      expect((await call(rt, "GET", path, {}, { token: "forged" })).status, path).toBe(403);
    }
    for (const path of ["/api/mod/spatial/house", "/api/mod/spatial/begin", "/api/mod/spatial/end"]) {
      expect((await call(rt, "POST", path, { guest: pid, world: "web", session: "s-x" })).status, path).toBe(403);
    }
    // The map + the stream: a moderator or a session token.
    expect((await call(rt, "GET", "/api/spatial/house")).status).toBe(401);
    expect((await call(rt, "GET", "/api/spatial/house", {}, { token: "forged" })).status).toBe(401);
    const stream = spatialStream(rt, "token=forged");
    await stream.open;
    expect(stream.status()).toBe(401);
    // The game's calls: 401 for a token that never was.
    for (const path of ["/api/spatial/pose", "/api/spatial/found", "/api/spatial/end"]) {
      expect((await call(rt, "POST", path, { p: [0, 0, 0], yaw: 0 })).status, path).toBe(401);
      expect((await call(rt, "POST", path, { p: [0, 0, 0], yaw: 0 }, { token: "forged" })).status, path).toBe(401);
    }
    // A mod token is not a session token.
    const login = await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod });
    const modToken = login.json.token as string;
    expect((await call(rt, "GET", "/api/mod/spatial/stations", {}, { token: modToken })).status).toBe(200);
    expect((await call(rt, "GET", `/api/spatial/house?token=${modToken}`)).status).toBe(200);
    expect((await call(rt, "POST", "/api/spatial/pose", { p: [0, 0, 0], yaw: 0 }, { token: modToken })).status).toBe(401);
    rt.dispose();
  });

  it("a pose body over 2 KB is refused before the generic parse", async () => {
    const rt = runtimeAt(freshDir());
    const res = fakeRes();
    const url = new URL("http://x/api/spatial/pose");
    const big = JSON.stringify({ p: [0, 0, 0], yaw: 0, pad: "x".repeat(3000) });
    await expect(rt.handle(fakeReq(big, { "x-loom-token": "t" }), res, "POST", url.pathname, url, {})).rejects.toBeInstanceOf(PayloadTooLarge);
  });

  it("a silent session times out on the runtime's clock", async () => {
    const clock = { t: 0 };
    const rt = runtimeAt(freshDir(), clock);
    rt.openDoors();
    const pid = ((await mod(rt, "/api/mod/persona", { name: "Paint" })).json.guest as { id: string }).id;
    const a = (await mod(rt, "/api/mod/spatial/begin", { guest: pid, world: "web", device: "Tent tablet" })).json as unknown as Assignment;
    clock.t += POSE_TIMEOUT_MS;
    rt.spatial.sweep();
    expect((await call(rt, "POST", "/api/spatial/pose", { p: [0, 0, 0], yaw: 0 }, { token: a.token })).status).toBe(410);
    rt.dispose();
  });

  it("found while the doors are closed: 409, the session stays un-found, the retry after resume commits", async () => {
    const d = freshDir();
    const rt = runtimeAt(d);
    rt.openDoors();
    const gid = await capturedPersona(rt, "Pinball");
    const a = (await mod(rt, "/api/mod/spatial/begin", { guest: gid, world: "vr", device: "Headset 1" })).json as unknown as Assignment;
    expect((await mod(rt, "/api/mod/stop")).json.phase).toBe("paused");
    // Poses keep flowing while paused (the terminals stay live).
    expect((await call(rt, "POST", "/api/spatial/pose", { p: a.duck.pos, yaw: 0 }, { token: a.token })).status).toBe(204);
    const journal = new Store(d).readJournal().length;
    const paused = await call(rt, "POST", "/api/spatial/found", {}, { token: a.token });
    expect(paused.status).toBe(409);
    expect(paused.json.error).toBe("doors are closed");
    expect(rt.spatial.players()[0]?.found).toBe(false);
    expect(rt.liveSim!.isCaptured(gid)).toBe(true);
    expect(new Store(d).readJournal()).toHaveLength(journal);
    // A dead token still learns it is dead.
    expect((await call(rt, "POST", "/api/spatial/found", {}, { token: "forged" })).status).toBe(401);
    // Resume: the same claim goes through.
    expect((await mod(rt, "/api/mod/start")).json.phase).toBe("open");
    const after = await call(rt, "POST", "/api/spatial/found", {}, { token: a.token });
    expect(after.json).toEqual({ ok: true, released: true, already: false });
    expect(rt.liveSim!.isCaptured(gid)).toBe(false);
    expect(new Store(d).readJournal().filter((l) => l.by === "Headset 1").map((l) => l.a[0])).toEqual(["the simulation completed", "the golden duck"]);
    rt.dispose();
  });

  it("the show's map file: a missing one is not cached, a hand edit is picked up + announced, a bad save keeps the last good", async () => {
    const d = freshDir();
    const file = join(d, "show-house.json");
    const rt = runtimeAt(d, undefined, file);
    rt.openDoors();
    expect((await modGet(rt, "/api/spatial/house")).status).toBe(503); // not mounted yet
    const show = JSON.parse(readFileSync(SHOW_HOUSE_FILE, "utf8")) as HouseMap;
    writeFileSync(file, JSON.stringify(show));
    const first = await modGet(rt, "/api/spatial/house");
    expect(first.status).toBe(200);
    expect(first.json.source).toBe("show");
    const term = spatialStream(rt, "", { moderator: true });
    await term.open;
    // A hand edit (a newer mtime) reaches the running event and every stream.
    writeFileSync(file, JSON.stringify({ ...show, name: "Hand-edited" }));
    const later = new Date(Date.now() + 5_000);
    utimesSync(file, later, later);
    const edited = await modGet(rt, "/api/spatial/house");
    expect((edited.json.house as HouseMap).name).toBe("Hand-edited");
    expect(edited.json.version).not.toBe(first.json.version);
    expect(term.of("house")).toEqual([{ version: edited.json.version }]);
    // A half-saved file: the last good map keeps serving, nothing announced.
    writeFileSync(file, "{ half");
    const evenLater = new Date(Date.now() + 10_000);
    utimesSync(file, evenLater, evenLater);
    const half = await modGet(rt, "/api/spatial/house");
    expect(half.status).toBe(200);
    expect(half.json.version).toBe(edited.json.version);
    expect(term.of("house")).toHaveLength(1);
    // A director's save is never replaced by the file.
    expect((await mod(rt, "/api/mod/spatial/house", { house: { ...show, name: "Measured" } })).status).toBe(200);
    writeFileSync(file, JSON.stringify({ ...show, name: "Hand-edited again" }));
    const latest = new Date(Date.now() + 15_000);
    utimesSync(file, latest, latest);
    expect(((await modGet(rt, "/api/spatial/house")).json.house as HouseMap).name).toBe("Measured");
    term.close();
    rt.dispose();
  });

  it("the flush loop: runs while anything is live, stops itself when idle, restarts on begin, sweeps every tenth tick", async () => {
    vi.useFakeTimers();
    try {
      const clock = { t: 0 };
      const rt = runtimeAt(freshDir(), clock);
      rt.openDoors();
      const pid = ((await mod(rt, "/api/mod/persona", { name: "Paint" })).json.guest as { id: string }).id;
      const baseline = vi.getTimerCount();

      const term = spatialStream(rt, "", { moderator: true });
      await term.open;
      const a = (await mod(rt, "/api/mod/spatial/begin", { guest: pid, world: "web", device: "Tent tablet" })).json as unknown as Assignment;
      await call(rt, "POST", "/api/spatial/pose", { p: [a.spawn.pos[0] + 0.5, a.spawn.pos[1], a.spawn.pos[2]], yaw: 0 }, { token: a.token });
      vi.advanceTimersByTime(100);
      expect(term.of("poses")).toHaveLength(1); // no hand-called flush

      // Idle: the session ends, the stream closes → the loop stops itself.
      await call(rt, "POST", "/api/spatial/end", {}, { token: a.token });
      term.close();
      vi.advanceTimersByTime(100);
      expect(vi.getTimerCount()).toBe(baseline);

      // A begin restarts it (no stream needed: a watcher attached to the hub).
      const seen: Array<[string, unknown]> = [];
      rt.spatial.attach({ id: "probe", name: "probe", send: (e, data) => seen.push([e, data]) });
      const b = (await mod(rt, "/api/mod/spatial/begin", { guest: pid, world: "web", device: "Tent tablet" })).json as unknown as Assignment;
      expect(vi.getTimerCount()).toBe(baseline + 1);
      await call(rt, "POST", "/api/spatial/pose", { p: [b.spawn.pos[0] + 0.25, b.spawn.pos[1], b.spawn.pos[2]], yaw: 0 }, { token: b.token });
      vi.advanceTimersByTime(100);
      expect(seen.filter(([e]) => e === "poses")).toHaveLength(1);

      // The sweep rides every tenth tick: a silent session times out on its own.
      clock.t += POSE_TIMEOUT_MS;
      vi.advanceTimersByTime(1_000);
      expect(seen.filter(([e]) => e === "leave").map(([, data]) => data)).toEqual([{ session: b.session, reason: "timeout" }]);

      // dispose clears it (the probe keeps the hub active until then).
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      const before = vi.getTimerCount();
      rt.dispose();
      expect(vi.getTimerCount()).toBeLessThan(before);
      const frames = seen.length;
      vi.advanceTimersByTime(1_000);
      expect(seen).toHaveLength(frames);
    } finally {
      vi.useRealTimers();
    }
  });
});
