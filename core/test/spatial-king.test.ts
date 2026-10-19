//! The shared King (C2) and the ghosts' profile pictures (C3) on the
//! spatial plane: `SpatialHub`'s King (one bar for every guest, one hit per
//! reinstallation visit, a `king` frame only on a change), its avatar keys
//! (`PlayerState.avatar`, `avatar` frames), and their wiring in
//! `EventRuntime` — `POST /api/spatial/king/hit`, `POST
//! /api/mod/spatial/king`, the journaled world set + signals, the screen
//! state's `king` block and the avatar frames on a picture change.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { validateHouse, type Assignment, type HouseMap, type Prop } from "@loom/house";
import { SpatialHub } from "../server/spatial.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { screenKingOf } from "../server/routes/screen.ts";
import { Store } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";

const fixture = (name: string): HouseMap => {
  const v = validateHouse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../house/test/fixtures/${name}.json`, import.meta.url)), "utf8")));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
};

/** two-rooms with a king in door `ab`'s gap (at [4, 1.5], room a). */
function kingHouse(over: Partial<Prop> = {}): HouseMap {
  const base = fixture("two-rooms");
  const king: Prop = { id: "king", room: "a", kind: "king", pos: [3.6, 0, 1.5], size: [0.6, 1.9, 0.6], yaw: -90, hp: 3, ...over };
  return { ...base, doors: base.doors.map((d) => (d.id === "ab" ? { ...d, guard: "king" } : d)), props: [...base.props, king] };
}

/** In reach and facing him (west of him, facing east). */
const NEAR = { p: [2.8, 0, 1.5] as [number, number, number], yaw: -90, pitch: 0 };

// ---------------------------------------------------------------------------
// SpatialHub
// ---------------------------------------------------------------------------

function hub(opts: { house?: HouseMap; world?: Map<string, unknown>; avatars?: Map<string, string> } = {}) {
  let ids = 0;
  const world = opts.world;
  const avatars = opts.avatars ?? new Map<string, string>();
  const hub = new SpatialHub({
    eventId: "evt",
    now: () => 1_000,
    newSessionId: () => `s-${String(++ids).padStart(6, "0")}`,
    newToken: () => `tok-${ids}`,
    ...(world !== undefined ? { kingHp: (path: string) => world.get(path) } : {}),
    avatarOf: (_guest, name) => avatars.get(name) ?? null,
  });
  hub.setHouse(opts.house ?? kingHouse(), "show", false);
  const frames: Array<[string, Record<string, unknown>]> = [];
  hub.attach({ id: "term", name: "TV", send: (e, d) => frames.push([e, d as Record<string, unknown>]) });
  const of = (event: string) => frames.filter(([e]) => e === event).map(([, d]) => d);
  const begin = (guest: string, station: string | null = null) =>
    hub.begin({ guest, name: guest.toUpperCase(), world: station === null ? "web" : "vr", device: "Tent tablet", station, captured: false })!;
  return { hub, of, begin, avatars };
}

describe("SpatialHub — the shared King", () => {
  it("hello carries him (null with no king); the hub counts his hp with no health path", () => {
    const h = hub();
    expect(h.of("hello")[0]!.king).toEqual({ id: "king", hp: 3, max: 3, fallen: false });
    expect(hub({ house: fixture("two-rooms") }).of("hello")[0]!.king).toBeNull();
    const a = h.begin("g-1");
    h.hub.pose(a.token, NEAR);
    const commits: unknown[] = [];
    const out = h.hub.hit(a.token, (s, next, ref) => commits.push([s.guest, next, ref.path]));
    expect(out).toEqual({ kind: "hit", king: { id: "king", hp: 2, max: 3, fallen: false } });
    expect(commits).toEqual([["g-1", { id: "king", hp: 2, max: 3, fallen: false }, null]]);
    expect(h.of("king")).toEqual([{ id: "king", hp: 2, max: 3, fallen: false, by: "G-1" }]);
  });

  it("one hit per visit: a repeat is `already`; a replaced session of the same guest keeps it spent; a new visit may hit again", () => {
    const h = hub();
    const a = h.begin("g-1");
    h.hub.pose(a.token, NEAR);
    expect(h.hub.hit(a.token, () => {}).kind).toBe("hit");
    expect(h.hub.hit(a.token, () => {})).toEqual({ kind: "already", king: { id: "king", hp: 2, max: 3, fallen: false } });
    // A re-scan mid-walk replaces the live session: the same visit (D2).
    const b = h.begin("g-1");
    h.hub.pose(b.token, NEAR);
    expect(h.hub.hit(b.token, () => {}).kind).toBe("already");
    // Another guest's visit is its own.
    const c = h.begin("g-2");
    h.hub.pose(c.token, NEAR);
    expect(h.hub.hit(c.token, () => {}).kind).toBe("hit");
    // The visit ended (found / quit): the next begin is a new visit.
    h.hub.endByToken(b.token);
    const d = h.begin("g-1");
    h.hub.pose(d.token, NEAR);
    expect(h.hub.hit(d.token, () => {})).toEqual({ kind: "hit", king: { id: "king", hp: 0, max: 3, fallen: true } });
  });

  it("a find ends the visit: a re-scan while the found session lingers starts a fresh visit that may hit", () => {
    const h = hub();
    const a = h.begin("g-1");
    h.hub.pose(a.token, NEAR);
    expect(h.hub.hit(a.token, () => {}).kind).toBe("hit");
    const duck = h.hub.players().find((p) => p.session === a.session)!.duck;
    h.hub.pose(a.token, { p: [...duck.pos], yaw: 0, pitch: 0 });
    expect(h.hub.found(a.token, () => true).kind).toBe("found");
    // The clock never moves here, so the found session is still lingering (FOUND_LINGER_MS).
    const b = h.begin("g-1");
    h.hub.pose(b.token, NEAR);
    expect(h.hub.hit(b.token, () => {}).kind).toBe("hit");
  });

  it("refuses far / facing / another floor with the server's slack, a parked session, a fallen King, an unknown or ended token", () => {
    const h = hub();
    const a = h.begin("g-1");
    h.hub.pose(a.token, { p: [3.6 - 1.25 - 0.3, 0, 1.5], yaw: -90, pitch: 0 }); // inside the 0.35 m slack
    expect(h.hub.hit(a.token, () => {}).kind).toBe("hit");
    const b = h.begin("g-2");
    h.hub.pose(b.token, { p: [3.6 - 1.25 - 0.5, 0, 1.5], yaw: -90, pitch: 0 });
    expect(h.hub.hit(b.token, () => {})).toEqual({ kind: "far", reach: "far" });
    h.hub.pose(b.token, { p: NEAR.p, yaw: 90, pitch: 0 }); // back to him
    expect(h.hub.hit(b.token, () => {})).toEqual({ kind: "far", reach: "facing" });
    h.hub.pose(b.token, { p: NEAR.p, yaw: -90 + 55 + 20, pitch: 0 }); // inside the +25° slack
    expect(h.hub.hit(b.token, () => {}).kind).toBe("hit");
    const parked = h.begin("g-3", "quest-1");
    expect(h.hub.hit(parked.token, () => {})).toEqual({ kind: "parked" });
    expect(h.hub.hit("nope", () => {})).toEqual({ kind: "unknown" });
    const c = h.begin("g-4");
    h.hub.pose(c.token, NEAR);
    expect(h.hub.hit(c.token, () => {})).toMatchObject({ kind: "hit", king: { hp: 0, fallen: true } });
    const d = h.begin("g-5");
    h.hub.pose(d.token, NEAR);
    expect(h.hub.hit(d.token, () => {})).toEqual({ kind: "fallen", king: { id: "king", hp: 0, max: 3, fallen: true } });
    h.hub.endByToken(d.token);
    expect(h.hub.hit(d.token, () => {})).toEqual({ kind: "over" });
    // No king on the map.
    const none = hub({ house: fixture("two-rooms") });
    const e = none.begin("g-1");
    none.hub.pose(e.token, NEAR);
    expect(none.hub.hit(e.token, () => {})).toEqual({ kind: "none" });
  });

  it("reads his hp off the world path; syncKing sends a frame only on a change; a director's edit has no `by`", () => {
    const world = new Map<string, unknown>();
    const h = hub({ house: kingHouse({ hp: 15, health: "Night.king_hp" }), world });
    expect(h.hub.king()).toEqual({ id: "king", hp: 15, max: 15, fallen: false }); // unset = full
    h.hub.syncKing();
    expect(h.of("king")).toEqual([]);
    world.set("Night.king_hp", 15);
    h.hub.syncKing();
    expect(h.of("king")).toEqual([]); // the same state
    // A hit: the commit writes the world (as the runtime does), the frame names the hitter.
    const a = h.begin("g-1");
    h.hub.pose(a.token, NEAR);
    const out = h.hub.hit(a.token, (_s, next, ref) => {
      expect(ref.path).toBe("Night.king_hp");
      world.set(ref.path!, next.hp);
      h.hub.syncKing(); // the runtime's choke point, mid-commit
    });
    expect(out).toEqual({ kind: "hit", king: { id: "king", hp: 14, max: 15, fallen: false } });
    expect(h.of("king")).toEqual([{ id: "king", hp: 14, max: 15, fallen: false, by: "G-1" }]);
    // Something else moved it (a director's restore through the World editor).
    world.set("Night.king_hp", 15);
    h.hub.syncKing();
    expect(h.of("king").at(-1)).toEqual({ id: "king", hp: 15, max: 15, fallen: false, by: null });
    // setKingHp: through the commit with a path, clamped.
    const king = h.hub.setKingHp(40, (ref, n) => world.set(ref.path!, n));
    expect(king).toEqual({ id: "king", hp: 15, max: 15, fallen: false });
    expect(h.hub.setKingHp(0, (ref, n) => world.set(ref.path!, n))).toEqual({ id: "king", hp: 0, max: 15, fallen: true });
    expect(h.of("king")).toHaveLength(3);
  });

  it("a hub-held King: a director sets him, a reset stands him up, a map swap that changes him is announced", () => {
    const h = hub();
    expect(h.hub.setKingHp(1, () => {
      throw new Error("no world path: the hub keeps it");
    })).toEqual({ id: "king", hp: 1, max: 3, fallen: false });
    h.hub.reset("reset");
    expect(h.hub.king()).toEqual({ id: "king", hp: 3, max: 3, fallen: false });
    expect(h.of("king").map((k) => k.hp)).toEqual([1, 3]);
    h.hub.setHouse(kingHouse({ hp: 9 }), "event");
    expect(h.of("king").at(-1)).toEqual({ id: "king", hp: 9, max: 9, fallen: false, by: null });
    const n = h.of("king").length;
    h.hub.setHouse(kingHouse({ hp: 9, color: "#ffffff" }), "event"); // a change that leaves him as he was
    expect(h.of("king")).toHaveLength(n);
    h.hub.setHouse(fixture("two-rooms"), "event"); // no king any more: no frame (hello / house say so)
    expect(h.hub.king()).toBeNull();
    expect(h.of("king")).toHaveLength(n);
  });
});

describe("SpatialHub — a map swap with the King down", () => {
  /** Standing in his footprint, in the doorway. */
  const IN_KING = { p: [3.6, 0, 1.5] as [number, number, number], yaw: -90, pitch: 0 };

  it("a standing King is solid: a player in his footprint goes back to the spawn", () => {
    const h = hub();
    const a = h.begin("g-1");
    h.hub.pose(a.token, IN_KING);
    h.hub.setHouse(kingHouse({ color: "#ffffff" }), "event");
    expect(h.hub.players().find((p) => p.session === a.session)!.p).toEqual([1, 0, 2]);
  });

  it("a fallen King is no obstacle: a player walking through his doorway keeps their place", () => {
    const h = hub();
    h.hub.setKingHp(0, () => {});
    expect(h.hub.king()?.fallen).toBe(true);
    const a = h.begin("g-1");
    h.hub.pose(a.token, IN_KING);
    h.hub.setHouse(kingHouse({ color: "#ffffff" }), "event");
    expect(h.hub.players().find((p) => p.session === a.session)!.p).toEqual(IN_KING.p);
  });

  it("reads him off the world path too (the show's Night.king_hp at 0)", () => {
    const world = new Map<string, unknown>([["Night.king_hp", 0]]);
    const h = hub({ house: kingHouse({ health: "Night.king_hp" }), world });
    const a = h.begin("g-1");
    h.hub.pose(a.token, IN_KING);
    h.hub.setHouse(kingHouse({ health: "Night.king_hp", color: "#ffffff" }), "event");
    expect(h.hub.players().find((p) => p.session === a.session)!.p).toEqual(IN_KING.p);
  });
});

describe("SpatialHub — profile pictures on ghosts", () => {
  it("the assignment, hello and join carry the avatar key; a change sends an avatar frame per live session", () => {
    const h = hub({ avatars: new Map([["G-1", "aaaaaaaaaaaaaaaa"]]) });
    const a = h.begin("g-1");
    expect(a.avatar).toBe("aaaaaaaaaaaaaaaa");
    expect((h.of("join")[0]!.player as { avatar: string | null }).avatar).toBe("aaaaaaaaaaaaaaaa");
    const b = h.begin("g-2");
    expect(b.avatar).toBeNull();
    const late: Array<[string, Record<string, unknown>]> = [];
    h.hub.attach({ id: "late", name: "TV", send: (e, d) => late.push([e, d as Record<string, unknown>]) });
    const players = late[0]![1].players as Array<{ guest: string; avatar: string | null }>;
    expect(players.map((p) => [p.guest, p.avatar])).toEqual([
      ["g-1", "aaaaaaaaaaaaaaaa"],
      ["g-2", null],
    ]);
    // Nothing changed: no frame.
    expect(h.hub.refreshAvatar("g-1")).toBe(0);
    h.avatars.set("G-2", "bbbbbbbbbbbbbbbb");
    expect(h.hub.refreshAvatar("g-2")).toBe(1);
    expect(h.of("avatar")).toEqual([{ session: b.session, avatar: "bbbbbbbbbbbbbbbb" }]);
    // A parked headset assignment isn't on the stream yet: it takes the new key silently.
    const parked = h.begin("g-3", "quest-1");
    h.avatars.set("G-3", "cccccccccccccccc");
    expect(h.hub.refreshAvatar("g-3")).toBe(0);
    expect(h.hub.station("quest-1", "Quest", "vr")!.avatar).toBe("cccccccccccccccc");
    expect(parked.avatar).toBeNull();
  });
});

describe("screenKingOf", () => {
  it("null with no King; armed off the prop's rule, null with none or no story", () => {
    const king = { id: "king", hp: 7, max: 15, fallen: false };
    expect(screenKingOf(null, undefined, null)).toBeNull();
    expect(screenKingOf(king, undefined, null)).toEqual({ hp: 7, max: 15, fallen: false, armed: null });
    expect(screenKingOf(king, { path: "Night.king_armed", min: 1 }, null)).toEqual({ hp: 7, max: 15, fallen: false, armed: null });
  });
});

// ---------------------------------------------------------------------------
// EventRuntime
// ---------------------------------------------------------------------------

const SCENARIO = scenarioSource("trapped-in-the-internet");
const CODES = { event: "EVT333", prime: "PRM333", mod: "MOD333" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function runtime(): { rt: EventRuntime; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "loom-king-"));
  dirs.push(dir);
  const rt = new EventRuntime({
    eventId: "evt",
    store: new Store(dir),
    codes: CODES,
    scenarioName: "trapped-in-the-internet",
    scenarioSource: SCENARIO,
    joinBase: () => "http://localhost",
  });
  return { rt, dir };
}

function fakeReq(body: unknown, headers: Record<string, string> = {}, onClose?: (fn: () => void) => void): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
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

function stream(rt: EventRuntime) {
  let buf = "";
  let closer: (() => void) | undefined;
  const res = {
    writeHead() {
      return res;
    },
    write(chunk: string) {
      buf += chunk;
      return true;
    },
    end() {
      return res;
    },
  } as unknown as ServerResponse;
  const url = new URL("http://x/api/spatial/stream?name=TV");
  const open = rt.handle(fakeReq(null, {}, (fn) => (closer = fn)), res, "GET", url.pathname, url, { moderator: true });
  const of = (e: string) => [...buf.matchAll(/event: (\w+)\ndata: (.*)\n\n/gu)].filter((m) => m[1] === e).map((m) => JSON.parse(m[2]!) as Record<string, unknown>);
  return { open, of, close: () => closer?.() };
}

/** The show's King stands at [-2.55, -2.7, 11.2] in the basement hall; this is in reach, facing him (east of him, facing west). */
const AT_KING = { p: [-1.6, -2.7, 11.2], yaw: 90 };

async function visitor(rt: EventRuntime, name: string): Promise<{ id: string; a: Assignment }> {
  const id = ((await mod(rt, "/api/mod/persona", { name })).json.guest as { id: string }).id;
  const a = (await mod(rt, "/api/mod/spatial/begin", { guest: id, world: "web", device: "Tent tablet" })).json as unknown as Assignment;
  return { id, a };
}

describe("EventRuntime — the King on the spatial plane", () => {
  it("a hit: 200 + the king; journaled world set then the hit signal, by the device; the frame names the guest; the screen state follows", async () => {
    const { rt, dir } = runtime();
    rt.openDoors();
    const term = stream(rt);
    await term.open;
    expect(term.of("hello")[0]!.king).toEqual({ id: "cold-lock-king", hp: 15, max: 15, fallen: false });
    const { id, a } = await visitor(rt, "Pinball");
    expect((await call(rt, "GET", "/api/spatial/house", {}, { token: a.token })).json.king).toEqual({ id: "cold-lock-king", hp: 15, max: 15, fallen: false });

    // Far (at the spawn in the tent): refused, nothing journaled.
    const far = await call(rt, "POST", "/api/spatial/king/hit", {}, { token: a.token });
    expect(far.status).toBe(409);
    expect(far.json).toMatchObject({ error: "not near" });

    expect((await call(rt, "POST", "/api/spatial/pose", AT_KING, { token: a.token })).status).toBe(204);
    const hit = await call(rt, "POST", "/api/spatial/king/hit", {}, { token: a.token });
    expect(hit.status).toBe(200);
    expect(hit.json).toEqual({ ok: true, king: { id: "cold-lock-king", hp: 14, max: 15, fallen: false } });
    const lines = new Store(dir).readJournal().filter((l) => l.by === "Tent tablet");
    const tail = lines.slice(-2).map((l) => [l.m, l.a[0], l.a[1], l.a[2]]);
    expect(tail).toEqual([
      ["setVar", "Night.king_hp", "14", undefined],
      ["signal", "king hit", id, { hp: 14, max: 15 }],
    ]);
    expect(term.of("king")).toEqual([{ id: "cold-lock-king", hp: 14, max: 15, fallen: false, by: "Pinball" }]);

    // Already hit this visit.
    const again = await call(rt, "POST", "/api/spatial/king/hit", {}, { token: a.token });
    expect(again.status).toBe(409);
    expect(again.json).toEqual({ error: "already hit", king: { id: "cold-lock-king", hp: 14, max: 15, fallen: false } });

    // The screen state reads him (armed off Night.king_armed; unset = not armed).
    const screen = await call(rt, "GET", "/api/screen/state?name=Server%20Door&spot=server-room-door&view=chess", {}, { moderator: true });
    expect(screen.json.king).toEqual({ hp: 14, max: 15, fallen: false, armed: false });
    expect((await mod(rt, "/api/mod/var", { path: "Night.king_armed", value: "1" })).status).toBe(200);
    expect((await call(rt, "GET", "/api/screen/state?name=Server%20Door", {}, { moderator: true })).json.king).toMatchObject({ armed: true });
    expect(term.of("king")).toHaveLength(1); // that set didn't move him
    term.close();
    rt.dispose();
  });

  it("the last hit fells him: the fallen signal follows; then 409 fallen; a director restores him (no `by`)", async () => {
    const { rt, dir } = runtime();
    rt.openDoors();
    const term = stream(rt);
    await term.open;
    expect((await mod(rt, "/api/mod/spatial/king", { hp: 1 })).json).toEqual({ ok: true, king: { id: "cold-lock-king", hp: 1, max: 15, fallen: false } });
    expect(term.of("king")).toEqual([{ id: "cold-lock-king", hp: 1, max: 15, fallen: false, by: null }]);
    const set = new Store(dir).readJournal().filter((l) => l.m === "setVar" && l.a[0] === "Night.king_hp");
    expect(set.map((l) => [l.a[1], l.by])).toEqual([["1", "Ada"]]);

    const { id, a } = await visitor(rt, "Winamp");
    await call(rt, "POST", "/api/spatial/pose", AT_KING, { token: a.token });
    const hit = await call(rt, "POST", "/api/spatial/king/hit", {}, { token: a.token });
    expect(hit.json).toEqual({ ok: true, king: { id: "cold-lock-king", hp: 0, max: 15, fallen: true } });
    const signals = new Store(dir).readJournal().filter((l) => l.m === "signal" && l.by === "Tent tablet" && l.a[1] === id);
    expect(signals.map((l) => l.a[0]).slice(-2)).toEqual(["king hit", "king fallen"]);

    const { a: b } = await visitor(rt, "Napster");
    await call(rt, "POST", "/api/spatial/pose", AT_KING, { token: b.token });
    const down = await call(rt, "POST", "/api/spatial/king/hit", {}, { token: b.token });
    expect(down.status).toBe(409);
    expect(down.json).toEqual({ error: "fallen", king: { id: "cold-lock-king", hp: 0, max: 15, fallen: true } });

    // Restore: integer 0..max only.
    expect((await mod(rt, "/api/mod/spatial/king", { hp: 16 })).status).toBe(400);
    expect((await mod(rt, "/api/mod/spatial/king", { hp: 2.5 })).status).toBe(400);
    expect((await mod(rt, "/api/mod/spatial/king", {})).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/spatial/king", { hp: 15 }, { token: b.token })).status).toBe(403);
    expect((await mod(rt, "/api/mod/spatial/king", { hp: 15 })).json).toEqual({ ok: true, king: { id: "cold-lock-king", hp: 15, max: 15, fallen: false } });
    expect(term.of("king").at(-1)).toEqual({ id: "cold-lock-king", hp: 15, max: 15, fallen: false, by: null });
    // Standing again, the visitor who found him down may hit.
    expect((await call(rt, "POST", "/api/spatial/king/hit", {}, { token: b.token })).status).toBe(200);
    term.close();
    rt.dispose();
  });

  it("a re-scan keeps the visit's hit; paused → doors are closed; parked → 409; a dead token → 410; restart-safe hp", async () => {
    const { rt, dir } = runtime();
    rt.openDoors();
    const { id, a } = await visitor(rt, "Pinball");
    await call(rt, "POST", "/api/spatial/pose", AT_KING, { token: a.token });
    expect((await call(rt, "POST", "/api/spatial/king/hit", {}, { token: a.token })).status).toBe(200);
    const b = (await mod(rt, "/api/mod/spatial/begin", { guest: id, world: "web", device: "Tent tablet" })).json as unknown as Assignment;
    await call(rt, "POST", "/api/spatial/pose", AT_KING, { token: b.token });
    expect((await call(rt, "POST", "/api/spatial/king/hit", {}, { token: b.token })).json.error).toBe("already hit");
    expect((await call(rt, "POST", "/api/spatial/king/hit", {}, { token: a.token })).status).toBe(410);
    expect((await call(rt, "POST", "/api/spatial/king/hit", {}, { token: "nope" })).status).toBe(401);

    const other = ((await mod(rt, "/api/mod/persona", { name: "Encarta" })).json.guest as { id: string }).id;
    const parked = (await mod(rt, "/api/mod/spatial/begin", { guest: other, world: "vr", station: "quest-1", device: "Quest" })).json as unknown as Assignment;
    const p = await call(rt, "POST", "/api/spatial/king/hit", {}, { token: parked.token });
    expect(p.status).toBe(409);
    expect(p.json.error).toMatch(/not started/);

    const { a: c } = await visitor(rt, "Napster");
    await call(rt, "POST", "/api/spatial/pose", AT_KING, { token: c.token });
    expect((await mod(rt, "/api/mod/stop")).json.phase).toBe("paused");
    const paused = await call(rt, "POST", "/api/spatial/king/hit", {}, { token: c.token });
    expect(paused.status).toBe(409);
    expect(paused.json).toEqual({ error: "doors are closed" });
    rt.dispose();

    // A restart replays the journal: his hp is the story's, still 14.
    const back = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: "trapped-in-the-internet", scenarioSource: SCENARIO, joinBase: () => "http://localhost" });
    back.restore();
    const screen = await call(back, "GET", "/api/screen/state?name=Server%20Door", {}, { moderator: true });
    expect(screen.json.king).toMatchObject({ hp: 14, max: 15, fallen: false });
    back.dispose();
  });

  it("candidates and assignments carry the avatar key; a guest's new picture sends an avatar frame for their live session", async () => {
    const { rt } = runtime();
    rt.openDoors();
    const term = stream(rt);
    await term.open;
    const { id, a } = await visitor(rt, "Winamp");
    expect(a.avatar).toMatch(/^[0-9a-f]{16}$/);
    const candidates = (await call(rt, "GET", "/api/mod/spatial/candidates", {}, { moderator: true })).json.players as Array<{ id: string; avatar: string | null }>;
    expect(candidates.find((c) => c.id === id)!.avatar).toBe(a.avatar);
    expect((term.of("join")[0]!.player as { avatar: string }).avatar).toBe(a.avatar);

    // The guest picks Winamp's other picture.
    const token = (await mod(rt, "/api/mod/impersonate", { role: "guest", id })).json.token as string;
    const options = (await call(rt, "POST", "/api/guest/picture", {}, { token })).json.options as Array<{ key: string }>;
    const other = options.find((o) => o.key !== a.avatar)!;
    expect(other).toBeDefined();
    const picked = await call(rt, "POST", "/api/guest/picture", { picture: other.key }, { token });
    expect(picked.json.avatar).toBe(other.key);
    expect(term.of("avatar")).toEqual([{ session: a.session, avatar: other.key }]);
    term.close();
    rt.dispose();
  });
});
