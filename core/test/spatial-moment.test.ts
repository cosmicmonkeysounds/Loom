//! Wave 26 (C6): the game moment route, `POST /api/spatial/moment`. The hub
//! (`SpatialHub.moment`) judges an escape into the void, a visit to
//! Trabolta's heart and a pickup on the session's last pose with the
//! `@loom/house` rules (cooldown, re-seat to the spawn, `heartHeard`,
//! `picked`); the runtime commits the story signal `by` the game's device
//! and answers with the lines that one commit said to the program
//! (`momentLines`), game-only beats included. The runtime tests run a
//! fixture story with the exact C9 names, so this file stays green before
//! the show's story has its own INTERACTIONs.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import {
  ESCAPE_COOLDOWN_MS,
  ESCAPE_SIGNAL,
  HEART_SIGNAL,
  PICKUP_SIGNAL,
  validateHouse,
  type Assignment,
  type HouseMap,
  type Prop,
} from "@loom/house";
import { EventRuntime } from "../server/event-runtime.ts";
import { SpatialHub, parseMomentRequest, type MomentLine, type SessionRef } from "../server/spatial.ts";
import { Store } from "../server/store.ts";

const fixture = (name: string): HouseMap => {
  const v = validateHouse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../house/test/fixtures/${name}.json`, import.meta.url)), "utf8")));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
};

const HEART: Prop = { id: "trabolta-heart", room: "b", kind: "heart", pos: [5.5, 0, 1.5], size: [0.6, 1.2, 0.6] };
const DISK: Prop = { id: "virus-disk", room: "a", kind: "pickup", item: "virus", pos: [3, 0, 2.5], size: [0.1, 0.01, 0.1] };

/** two-rooms (room a [0..4]×[0..3] with the spawn and the exterior door
 *  `front` on its north wall, room b [4..7]×[0..3]) plus the heart in b, the
 *  disk in a and, optionally, a King guarding door `ab`. */
function momentHouse(opts: { king?: boolean } = {}): HouseMap {
  const base = fixture("two-rooms");
  const props: Prop[] = [HEART, DISK];
  if (opts.king === true) props.push({ id: "king", room: "a", kind: "king", pos: [3.6, 0, 1.5], size: [0.6, 1.9, 0.6], yaw: -90, hp: 1 });
  const house = { ...base, props: [...base.props, ...props] };
  const v = validateHouse(house);
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
}

type V3 = [number, number, number];
const pose = (p: V3, yaw = 0) => ({ p, yaw, pitch: 0 });
/** 5 m north of room a's wall: in the void, past `ESCAPE_M`. */
const VOID: V3 = [2, 0, -5];
/** 4.6 m out: within `ESCAPE_SLACK` of the trigger, accepted. */
const VOID_SLACK: V3 = [2, 0, -4.6];
/** 4 m out: not far enough. */
const VOID_NEAR: V3 = [2, 0, -4];
/** In room b, well inside (the heart's room). */
const IN_B: V3 = [5, 0, 1];
/** In room b, 0.1 m past the doorway: not "reached". */
const B_DOOR: V3 = [4.1, 0, 1.5];
/** 1 m from the disk: inside `PICKUP_REACH_M` + `PICKUP_SLACK_M`. */
const AT_DISK: V3 = [3, 0, 1.5];

// ---------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------

function hub(opts: { house?: HouseMap } = {}) {
  let ids = 0;
  let now = 1_000_000;
  const hub = new SpatialHub({
    eventId: "evt",
    now: () => now,
    newSessionId: () => `s-${String(++ids).padStart(6, "0")}`,
    newToken: () => `tok-${ids}`,
  });
  hub.setHouse(opts.house ?? momentHouse(), "show", false);
  const frames: Array<[string, Record<string, unknown>]> = [];
  hub.attach({ id: "term", name: "TV", send: (e, d) => frames.push([e, d as Record<string, unknown>]) });
  const of = (event: string) => frames.filter(([e]) => e === event).map(([, d]) => d);
  const begin = (guest: string, station: string | null = null): Assignment =>
    hub.begin({ guest, name: guest.toUpperCase(), world: station === null ? "web" : "vr", device: "Tent tablet", station, captured: false })!;
  const commits: Array<{ guest: string; signal: string; args: Record<string, string> }> = [];
  const say =
    (lines: MomentLine[] = [{ from: "Trabolta", text: "Back you go." }]) =>
    (s: SessionRef, signal: string, args: Record<string, string>): MomentLine[] => {
      commits.push({ guest: s.guest, signal, args });
      return lines;
    };
  return { hub, of, begin, commits, say, tick: (ms: number) => (now += ms) };
}

describe("parseMomentRequest", () => {
  it("escape needs no prop; heart and pickup name one; anything else is bad", () => {
    expect(parseMomentRequest({ kind: "escape", token: "x" })).toEqual({ kind: "escape" });
    expect(parseMomentRequest({ kind: "heart", prop: " trabolta-heart " })).toEqual({ kind: "heart", prop: "trabolta-heart" });
    expect(parseMomentRequest({ kind: "pickup", prop: "virus-disk" })).toEqual({ kind: "pickup", prop: "virus-disk" });
    expect(parseMomentRequest({ kind: "heart" })).toBeNull();
    expect(parseMomentRequest({ kind: "pickup", prop: "" })).toBeNull();
    expect(parseMomentRequest({ kind: "pickup", prop: 3 })).toBeNull();
    expect(parseMomentRequest({ kind: "king" })).toBeNull();
    expect(parseMomentRequest({})).toBeNull();
  });
});

describe("SpatialHub.moment — the void (escape)", () => {
  it("out past ESCAPE_M − ESCAPE_SLACK: re-seated at the spawn (room, floor, presence), the ghost jumps, the signal commits", () => {
    const h = hub();
    const a = h.begin("g-1");
    h.hub.pose(a.token, pose(VOID_SLACK, 30));
    h.hub.flush();
    const out = h.hub.moment(a.token, { kind: "escape" }, h.say());
    expect(out).toEqual({ kind: "ok", spawn: a.spawn, lines: [{ from: "Trabolta", text: "Back you go." }] });
    expect(h.commits).toEqual([{ guest: "g-1", signal: ESCAPE_SIGNAL, args: {} }]);
    const frame = h.hub.flush();
    expect(frame?.players).toEqual([{ session: a.session, p: a.spawn.pos, yaw: a.spawn.yaw, pitch: 0, room: "a", floor: "f" }]);
    expect(h.hub.voicePlayers()).toMatchObject([{ session: a.session, room: "a", p: a.spawn.pos }]);
  });

  it("not out (inside a room, or short of the trigger): `notOut` with the distance, nothing commits, nothing moves", () => {
    const h = hub();
    const a = h.begin("g-1");
    expect(h.hub.moment(a.token, { kind: "escape" }, h.say())).toEqual({ kind: "notOut", distance: 0 });
    h.hub.pose(a.token, pose(VOID_NEAR));
    const out = h.hub.moment(a.token, { kind: "escape" }, h.say());
    expect(out.kind).toBe("notOut");
    expect((out as { distance: number }).distance).toBeCloseTo(4, 6);
    expect(h.commits).toEqual([]);
    expect(h.hub.players()[0]!.p).toEqual(VOID_NEAR);
  });

  it("a 20 s cooldown per session: `cooldown` with retryMs, then accepted again", () => {
    const h = hub();
    const a = h.begin("g-1");
    h.hub.pose(a.token, pose(VOID));
    expect(h.hub.moment(a.token, { kind: "escape" }, h.say()).kind).toBe("ok");
    h.tick(5_000);
    h.hub.pose(a.token, pose(VOID));
    expect(h.hub.moment(a.token, { kind: "escape" }, h.say())).toEqual({ kind: "cooldown", retryMs: ESCAPE_COOLDOWN_MS - 5_000 });
    // Refused: the player stays where they are (the game teleports itself).
    expect(h.hub.players()[0]!.p).toEqual(VOID);
    h.tick(ESCAPE_COOLDOWN_MS - 5_000);
    expect(h.hub.moment(a.token, { kind: "escape" }, h.say()).kind).toBe("ok");
    expect(h.commits).toHaveLength(2);
    // Another session is not cooled down by this one.
    const b = h.begin("g-2");
    h.hub.pose(b.token, pose(VOID));
    expect(h.hub.moment(b.token, { kind: "escape" }, h.say()).kind).toBe("ok");
  });

  it("a dead token is unknown / over; a parked headset assignment is parked; a bad request is bad", () => {
    const h = hub();
    expect(h.hub.moment("nope", { kind: "escape" }, h.say())).toEqual({ kind: "unknown" });
    const a = h.begin("g-1");
    h.hub.endByToken(a.token);
    expect(h.hub.moment(a.token, { kind: "escape" }, h.say())).toEqual({ kind: "over" });
    const parked = h.begin("g-2", "quest-1");
    expect(h.hub.moment(parked.token, { kind: "escape" }, h.say())).toEqual({ kind: "parked" });
    const c = h.begin("g-3");
    expect(h.hub.moment(c.token, { kind: "heart" } as never, h.say())).toEqual({ kind: "bad" });
    expect(h.hub.moment(c.token, { kind: "dance" } as never, h.say())).toEqual({ kind: "bad" });
    expect(h.commits).toEqual([]);
  });
});

describe("SpatialHub.moment — Trabolta's heart", () => {
  it("reached in its room: commits its signal with the prop; heard once he spoke; then `already`", () => {
    const h = hub();
    const a = h.begin("g-1");
    expect(a.heartHeard).toBe(false);
    h.hub.pose(a.token, pose(IN_B));
    const out = h.hub.moment(a.token, { kind: "heart", prop: "trabolta-heart" }, h.say([{ from: "Trabolta", text: "A copy of you." }]));
    expect(out).toMatchObject({ kind: "ok", prop: { id: "trabolta-heart" }, lines: [{ from: "Trabolta", text: "A copy of you." }] });
    expect(h.commits).toEqual([{ guest: "g-1", signal: HEART_SIGNAL, args: { prop: "trabolta-heart" } }]);
    expect(h.hub.moment(a.token, { kind: "heart", prop: "trabolta-heart" }, h.say())).toEqual({ kind: "already" });
    // A re-scan knows (the Assignment's `heartHeard`).
    expect(h.begin("g-1").heartHeard).toBe(true);
    expect(h.commits).toHaveLength(1);
  });

  it("a commit that says nothing (he isn't awake) leaves the guest free to hear it on the next visit", () => {
    const h = hub();
    const a = h.begin("g-1");
    h.hub.pose(a.token, pose(IN_B));
    expect(h.hub.moment(a.token, { kind: "heart", prop: "trabolta-heart" }, h.say([]))).toMatchObject({ kind: "ok", lines: [] });
    expect(h.hub.moment(a.token, { kind: "heart", prop: "trabolta-heart" }, h.say()).kind).toBe("ok");
    expect(h.commits).toHaveLength(2);
  });

  it("in the doorway or another room: `not there`; a wrong or missing prop: `noProp`", () => {
    const h = hub();
    const a = h.begin("g-1");
    expect(h.hub.moment(a.token, { kind: "heart", prop: "trabolta-heart" }, h.say())).toEqual({ kind: "notThere" });
    h.hub.pose(a.token, pose(B_DOOR));
    expect(h.hub.moment(a.token, { kind: "heart", prop: "trabolta-heart" }, h.say())).toEqual({ kind: "notThere" });
    expect(h.hub.moment(a.token, { kind: "heart", prop: "virus-disk" }, h.say())).toEqual({ kind: "noProp" });
    expect(h.hub.moment(a.token, { kind: "heart", prop: "nowhere" }, h.say())).toEqual({ kind: "noProp" });
    expect(h.commits).toEqual([]);
  });

  it("sealed while the map's King stands; open once he has fallen", () => {
    const h = hub({ house: momentHouse({ king: true }) });
    const a = h.begin("g-1");
    h.hub.pose(a.token, pose(IN_B));
    expect(h.hub.moment(a.token, { kind: "heart", prop: "trabolta-heart" }, h.say())).toEqual({ kind: "sealed" });
    expect(h.hub.setKingHp(0, () => {})?.fallen).toBe(true);
    expect(h.hub.moment(a.token, { kind: "heart", prop: "trabolta-heart" }, h.say()).kind).toBe("ok");
  });
});

describe("SpatialHub.moment — the pickup", () => {
  it("in reach (with the server's slack): commits {item, prop}; `picked` on the next Assignment; then `already`", () => {
    const h = hub();
    const a = h.begin("g-1");
    expect(a.picked).toEqual([]);
    h.hub.pose(a.token, pose(AT_DISK));
    const out = h.hub.moment(a.token, { kind: "pickup", prop: "virus-disk" }, h.say([{ from: "Truther Download", text: "Something rides along." }]));
    expect(out).toMatchObject({ kind: "ok", prop: { id: "virus-disk", item: "virus" }, lines: [{ from: "Truther Download", text: "Something rides along." }] });
    expect(h.commits).toEqual([{ guest: "g-1", signal: PICKUP_SIGNAL, args: { item: "virus", prop: "virus-disk" } }]);
    expect(h.hub.moment(a.token, { kind: "pickup", prop: "virus-disk" }, h.say())).toEqual({ kind: "already" });
    expect(h.begin("g-1").picked).toEqual(["virus-disk"]);
    // Any other program may take it too.
    const b = h.begin("g-2");
    expect(b.picked).toEqual([]);
    h.hub.pose(b.token, pose(AT_DISK));
    expect(h.hub.moment(b.token, { kind: "pickup", prop: "virus-disk" }, h.say()).kind).toBe("ok");
  });

  it("out of reach: `far` with the plan distance; a heart named as a pickup: `noProp`", () => {
    const h = hub();
    const a = h.begin("g-1");
    const out = h.hub.moment(a.token, { kind: "pickup", prop: "virus-disk" }, h.say());
    expect(out.kind).toBe("far");
    expect((out as { distance: number }).distance).toBeCloseTo(Math.hypot(2, 0.5), 6);
    expect(h.hub.moment(a.token, { kind: "pickup", prop: "trabolta-heart" }, h.say())).toEqual({ kind: "noProp" });
    expect(h.commits).toEqual([]);
  });

  it("a story reset forgets who heard the heart and who took the disk", () => {
    const h = hub();
    const a = h.begin("g-1");
    h.hub.pose(a.token, pose(AT_DISK));
    h.hub.moment(a.token, { kind: "pickup", prop: "virus-disk" }, h.say());
    h.hub.pose(a.token, pose(IN_B));
    h.hub.moment(a.token, { kind: "heart", prop: "trabolta-heart" }, h.say());
    h.hub.reset("restart");
    const again = h.begin("g-1");
    expect(again).toMatchObject({ picked: [], heartHeard: false });
  });
});

describe("SpatialHub.moment — the show's map", () => {
  const show = (): HouseMap => {
    const v = validateHouse(JSON.parse(readFileSync(fileURLToPath(new URL("../examples/trapped-in-the-internet/house.json", import.meta.url)), "utf8")));
    if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
    return v.house;
  };

  it("out the mud room's front door, the heart behind the fallen King, the disk on the top floor; the tent is never here", () => {
    const world = new Map<string, unknown>([["Night.king_hp", 15]]);
    let ids = 0;
    const hub = new SpatialHub({ eventId: "evt", now: () => 1_000, newSessionId: () => `s-${++ids}`, newToken: () => `tok-${ids}`, kingHp: (path) => world.get(path) });
    hub.setHouse(show(), "show", false);
    const a = hub.begin({ guest: "g-1", name: "Bugdom", world: "web", device: "Tent tablet", station: null, captured: false })!;
    const said = (s: SessionRef, signal: string, args: Record<string, string>): MomentLine[] => [{ from: "Trabolta", text: `${signal} ${JSON.stringify(args)}` }];
    // Every walk starts in the tent, whose station is never linked (T3).
    expect(hub.spotHere("tent")).toBe(0);
    expect(hub.linked()).toEqual(new Set());
    // 4 m past the front door: not out; 5.2 m: out, back to the tent.
    hub.pose(a.token, pose([-0.45, 0, -4]));
    expect(hub.moment(a.token, { kind: "escape" }, said)).toEqual({ kind: "notOut", distance: 4 });
    hub.pose(a.token, pose([-0.45, 0, -5.2]));
    expect(hub.moment(a.token, { kind: "escape" }, said)).toMatchObject({ kind: "ok", spawn: { room: "tent" } });
    expect(hub.voicePlayers()[0]).toMatchObject({ room: "tent", p: [-4.5, 0, 26.3] });
    // The heart: sealed until the King falls.
    hub.pose(a.token, pose([4.0, -2.7, 24.5]));
    expect(hub.spotHere("server-room")).toBe(1);
    expect(hub.moment(a.token, { kind: "heart", prop: "trabolta-heart" }, said)).toEqual({ kind: "sealed" });
    world.set("Night.king_hp", 0);
    expect(hub.moment(a.token, { kind: "heart", prop: "trabolta-heart" }, said)).toMatchObject({ kind: "ok", lines: [{ text: 'simulation heart reached {"prop":"trabolta-heart"}' }] });
    // The disk in the hard drive (top floor).
    hub.pose(a.token, pose([6.3, 2.8, 27.0]));
    expect(hub.moment(a.token, { kind: "pickup", prop: "virus-disk" }, said)).toMatchObject({
      kind: "ok",
      lines: [{ text: 'simulation pickup taken {"item":"virus","prop":"virus-disk"}' }],
    });
  });
});

// ---------------------------------------------------------------------------
// The runtime: POST /api/spatial/moment
// ---------------------------------------------------------------------------

/** A fixture story with the C9 names: the three admin interactions, the
 *  escape / heart / pickup hooks and the two game-only beats. */
const STORY = `# Moments
directory: everyone

ROLE Program
  escapes: 0 to 99 = 0
  sim_heart: bool = false
  carries_virus: bool = false

CHARACTER Trabolta
  hidden: true

CHARACTER Truther Download

CODEX ILOVEYOU
  text: A love letter.

INTERACTION simulation escape attempt
  who: admin
  act: Anytime
  sequence: false

INTERACTION simulation heart reached
  who: admin
  act: Anytime
  sequence: false

INTERACTION simulation pickup taken
  who: admin
  act: Anytime
  sequence: false

when simulation escape attempt for program:
  set program.escapes += 1
  -> Escape Attempt

when simulation heart reached for program:
  if program.sim_heart != true:
    set program.sim_heart = true
    -> Heart In The Simulation

when simulation pickup taken for program:
  if item == "virus" and program.carries_virus != true:
    unlock ILOVEYOU for program

when program learns ILOVEYOU:
  set program.carries_virus = true
  -> Download

== Escape Attempt
Trabolta: There is no outside, {program.name}.
Trabolta: Back you go.

== Heart In The Simulation
Trabolta: A copy of you, in my heart.

== Download
Truther Download: Something rides along with you now.
`;

const CODES = { event: "EVT626", prime: "PRM626", mod: "MOD626" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function runtime(house: HouseMap = momentHouse()): { rt: EventRuntime; dir: string; make: () => EventRuntime } {
  const dir = mkdtempSync(join(tmpdir(), "loom-moment-"));
  dirs.push(dir);
  const houseFile = join(dir, "house.json");
  writeFileSync(houseFile, JSON.stringify(house));
  const make = () =>
    new EventRuntime({ eventId: "evt", store: new Store(join(dir, "state")), codes: CODES, scenarioName: "moments", scenarioSource: STORY, houseFile, joinBase: () => "http://localhost" });
  return { rt: make(), dir, make };
}

function fakeReq(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
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
    statusCode: 0,
    setHeader() {},
    writeHead(s: number) {
      status = s;
      return res;
    },
    write() {
      return true;
    },
    end(b?: string | Buffer) {
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

async function walker(rt: EventRuntime, name: string): Promise<{ id: string; a: Assignment }> {
  const g = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event });
  const id = g.json.id as string;
  const a = (await mod(rt, "/api/mod/spatial/begin", { guest: id, world: "web", device: "Tent tablet", force: true })).json as unknown as Assignment;
  expect(a.token).toEqual(expect.any(String));
  return { id, a };
}
const moment = (rt: EventRuntime, token: string, body: Record<string, unknown>) => call(rt, "POST", "/api/spatial/moment", body, { token });
const poseAt = (rt: EventRuntime, token: string, p: V3) => call(rt, "POST", "/api/spatial/pose", pose(p), { token });

describe("EventRuntime — POST /api/spatial/moment", () => {
  it("an escape: 200 with his lines, the spawn and the cooldown; journaled by the device; no phone hears him; trust goes on the story", async () => {
    const { rt, dir } = runtime();
    rt.openDoors();
    const { id, a } = await walker(rt, "Bugdom");
    expect((await poseAt(rt, a.token, VOID)).status).toBe(204);
    const out = await moment(rt, a.token, { kind: "escape" });
    expect(out.status).toBe(200);
    expect(out.json).toEqual({
      ok: true,
      kind: "escape",
      lines: [
        { from: "Trabolta", text: "There is no outside, Bugdom." },
        { from: "Trabolta", text: "Back you go." },
      ],
      spawn: a.spawn,
      cooldownMs: ESCAPE_COOLDOWN_MS,
    });
    const journal = new Store(join(dir, "state")).readJournal().filter((l) => l.by === "Tent tablet");
    expect(journal.slice(-1).map((l) => [l.m, l.a[0], l.a[1], l.a[2]])).toEqual([["signal", ESCAPE_SIGNAL, id, {}]]);
    expect(rt.liveSim!.world.get(`${id}.escapes`)).toMatchObject({ value: 1 });
    expect(JSON.stringify(rt.chatHistoryFor(id))).not.toMatch(/no outside|Back you go/u);
    // Right away again: the cooldown (the game teleports, no penalty).
    await poseAt(rt, a.token, VOID);
    const again = await moment(rt, a.token, { kind: "escape" });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ error: "cooldown", retryMs: expect.any(Number) });
    expect(rt.liveSim!.world.get(`${id}.escapes`)).toMatchObject({ value: 1 });
  });

  it("refusals: not out (with the distance), 400 bad moment, 404 no such prop, 401 / 410 a dead token", async () => {
    const { rt } = runtime();
    rt.openDoors();
    const { a } = await walker(rt, "Bugdom");
    await poseAt(rt, a.token, VOID_NEAR);
    expect(await moment(rt, a.token, { kind: "escape" })).toEqual({ status: 409, json: { error: "not out", distance: 4 } });
    expect(await moment(rt, a.token, { kind: "fly" })).toEqual({ status: 400, json: { error: "bad moment" } });
    expect(await moment(rt, a.token, { kind: "heart" })).toEqual({ status: 400, json: { error: "bad moment" } });
    expect(await moment(rt, a.token, { kind: "heart", prop: "virus-disk" })).toEqual({ status: 404, json: { error: "no such prop" } });
    expect(await moment(rt, a.token, { kind: "pickup", prop: "nowhere" })).toEqual({ status: 404, json: { error: "no such prop" } });
    expect(await moment(rt, "nope", { kind: "escape" })).toEqual({ status: 401, json: { error: "unknown session token" } });
    await call(rt, "POST", "/api/spatial/end", {}, { token: a.token });
    expect(await moment(rt, a.token, { kind: "escape" })).toEqual({ status: 410, json: { error: "this session is over" } });
    // The token may ride in the body too, like the other game calls.
    const { a: b } = await walker(rt, "Clippit");
    expect((await call(rt, "POST", "/api/spatial/moment", { kind: "escape", token: b.token })).json).toMatchObject({ error: "not out" });
  });

  it("doors closed: 409 and nothing commits; a parked headset: send a pose first", async () => {
    const { rt } = runtime();
    rt.openDoors();
    const { id, a } = await walker(rt, "Bugdom");
    await poseAt(rt, a.token, VOID);
    rt.pause();
    expect(await moment(rt, a.token, { kind: "escape" })).toEqual({ status: 409, json: { error: "doors are closed" } });
    expect(rt.liveSim!.world.get(`${id}.escapes`)).toMatchObject({ value: 0 });
    // A dead token still hears 401 while the doors are closed.
    expect(await moment(rt, "nope", { kind: "escape" })).toEqual({ status: 401, json: { error: "unknown session token" } });
    rt.openDoors();
    expect((await moment(rt, a.token, { kind: "escape" })).status).toBe(200);
    const g = await call(rt, "POST", "/api/guest/register", { name: "Clippit", passcode: CODES.event });
    const parked = (await mod(rt, "/api/mod/spatial/begin", { guest: g.json.id, world: "vr", device: "Quest", station: "quest-1", force: true })).json as unknown as Assignment;
    expect(await moment(rt, parked.token, { kind: "escape" })).toEqual({ status: 409, json: { error: "this session has not started — send a pose first" } });
  });

  it("the heart: 200 with the monologue once; `already` after; a re-scan carries heartHeard", async () => {
    const { rt } = runtime();
    rt.openDoors();
    const { id, a } = await walker(rt, "Bugdom");
    expect(await moment(rt, a.token, { kind: "heart", prop: "trabolta-heart" })).toEqual({ status: 409, json: { error: "not there" } });
    await poseAt(rt, a.token, IN_B);
    expect(await moment(rt, a.token, { kind: "heart", prop: "trabolta-heart" })).toEqual({
      status: 200,
      json: { ok: true, kind: "heart", lines: [{ from: "Trabolta", text: "A copy of you, in my heart." }] },
    });
    expect(rt.liveSim!.world.get(`${id}.sim_heart`)).toMatchObject({ value: true });
    expect(await moment(rt, a.token, { kind: "heart", prop: "trabolta-heart" })).toEqual({ status: 409, json: { error: "already" } });
    const again = (await mod(rt, "/api/mod/spatial/begin", { guest: id, world: "web", device: "Tent tablet", force: true })).json as unknown as Assignment;
    expect(again).toMatchObject({ heartHeard: true, picked: [] });
  });

  it("the heart after a restart: the hub forgot, the story's guard keeps him quiet (200, no lines)", async () => {
    const { rt, make } = runtime();
    rt.openDoors();
    const { id, a } = await walker(rt, "Bugdom");
    await poseAt(rt, a.token, IN_B);
    expect((await moment(rt, a.token, { kind: "heart", prop: "trabolta-heart" })).status).toBe(200);
    const back = make();
    expect(back.restore()).not.toBeNull();
    back.openDoors();
    expect(back.liveSim!.world.get(`${id}.sim_heart`)).toMatchObject({ value: true });
    const b = (await mod(back, "/api/mod/spatial/begin", { guest: id, world: "web", device: "Tent tablet", force: true })).json as unknown as Assignment;
    expect(b.heartHeard).toBe(false);
    await poseAt(back, b.token, IN_B);
    expect(await moment(back, b.token, { kind: "heart", prop: "trabolta-heart" })).toEqual({ status: 200, json: { ok: true, kind: "heart", lines: [] } });
  });

  it("sealed while the King stands", async () => {
    const { rt } = runtime(momentHouse({ king: true }));
    rt.openDoors();
    const { a } = await walker(rt, "Bugdom");
    await poseAt(rt, a.token, IN_B);
    expect(await moment(rt, a.token, { kind: "heart", prop: "trabolta-heart" })).toEqual({ status: 409, json: { error: "sealed" } });
  });

  it("the pickup: 200 with the codex line (which reaches the phone too), item and prop; far / already refusals", async () => {
    const { rt, dir } = runtime();
    rt.openDoors();
    const { id, a } = await walker(rt, "Bugdom");
    const far = await moment(rt, a.token, { kind: "pickup", prop: "virus-disk" });
    expect(far.status).toBe(409);
    expect(far.json).toMatchObject({ error: "far", distance: 2.06 });
    await poseAt(rt, a.token, AT_DISK);
    expect(await moment(rt, a.token, { kind: "pickup", prop: "virus-disk" })).toEqual({
      status: 200,
      json: { ok: true, kind: "pickup", lines: [{ from: "Truther Download", text: "Something rides along with you now." }], item: "virus", prop: "virus-disk" },
    });
    expect(rt.liveSim!.world.get(`${id}.carries_virus`)).toMatchObject({ value: true });
    expect(JSON.stringify(rt.chatHistoryFor(id))).toMatch(/Something rides along with you now/u);
    const journal = new Store(join(dir, "state")).readJournal().filter((l) => l.by === "Tent tablet");
    expect(journal.slice(-1).map((l) => [l.m, l.a[0], l.a[1], l.a[2]])).toEqual([["signal", PICKUP_SIGNAL, id, { item: "virus", prop: "virus-disk" }]]);
    expect(await moment(rt, a.token, { kind: "pickup", prop: "virus-disk" })).toEqual({ status: 409, json: { error: "already" } });
    const again = (await mod(rt, "/api/mod/spatial/begin", { guest: id, world: "web", device: "Tent tablet", force: true })).json as unknown as Assignment;
    expect(again.picked).toEqual(["virus-disk"]);
  });
});
