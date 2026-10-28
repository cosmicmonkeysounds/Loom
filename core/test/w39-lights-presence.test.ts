//! Wave 39 (C2): the house lights meet the reinstallation games on the
//! server. `SpatialHub` judges which fixtures have a program under them
//! (`presenceStep` on every flush, leave, reset and map swap); `LightsHub`
//! keeps the pulsed set (`presence {seq, fixtures}` on the GET, the
//! `presence=<seq>` cursor) and the module's `shown` report (`POST
//! /api/mod/lights/shown`, source `house` vs `estimate`); `lights-shown.ts`
//! replays the last look per fixture and decides when the spatial stream's
//! `lights` frame goes out.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { LIGHT_PRESENCE_HOLD_MS, LAMP_SETTLED, gameLightsOf, validateHouse, type GameLights, type HouseMap, type LightsConfig, type PresenceEntry } from "@loom/house";

import { EventRuntime } from "../server/event-runtime.ts";
import { LIGHTS_MODULE_ONLINE_MS, LIGHTS_SHOWN_FRESH_MS, LightsHub, parseShown, type LightsView } from "../server/lights.ts";
import { GAME_LIGHTS_MIN_MS, GameLightsFeed, LightsEstimate, buildGameLights, gameLightsKey, type FeedTimers } from "../server/lights-shown.ts";
import { isHostRoute } from "../server/routes/host.ts";
import { SpatialHub } from "../server/spatial.ts";
import { Store } from "../server/store.ts";

const FIX = join(import.meta.dirname, "..", "..", "house", "test", "fixtures");
const HOUSE_FILE = join(FIX, "lights-house.json");
const HOUSE = ((): HouseMap => {
  const v = validateHouse(JSON.parse(readFileSync(HOUSE_FILE, "utf8")));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
})();
const LIGHTS_TEXT = readFileSync(join(FIX, "lights-basic.json"), "utf8");
const LIGHTS = JSON.parse(LIGHTS_TEXT) as LightsConfig;
const CODES = { event: "EVTW39", prime: "PRMW39", mod: "MODW39" };
const STORY = `# T\nstart: Boot\n\nLOCATION The Server Room\n\nCHARACTER Task Manager\n  admin: true\n\n== Boot\n  setting: The Server Room\ncue heart_idle\nHello.\n`;

type V3 = [number, number, number];
/** The spawn ([2, 0, 2], the desktop): 1.41 m in plan from the desk lamp. */
const SPAWN: V3 = [2, 0, 2];
/** The desktop, well away from the desk lamp. */
const FAR: V3 = [7, 0, 2.5];
/** Under the hall bulbs (4.5, 5). */
const HALL: V3 = [4.5, 0, 5];
const pose = (p: V3) => ({ p, yaw: 0, pitch: 0 });

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-w39-"));
  dirs.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// SpatialHub: presence
// ---------------------------------------------------------------------------

function presenceHub(o: { lights?: LightsConfig | null } = {}) {
  let t = 1_000_000;
  let ids = 0;
  const calls: Array<string[]> = [];
  const frames: Array<{ event: string; data: unknown }> = [];
  const lights = o.lights === undefined ? LIGHTS : o.lights;
  const hub = new SpatialHub({
    eventId: "evt",
    now: () => t,
    newSessionId: () => `s-${++ids}`,
    newToken: () => `tok-${ids}`,
    ...(lights !== null ? { lights: () => lights } : {}),
    onPresence: (e) => calls.push([...e.keys()].sort()),
    lightsHello: () => ({ at: t, source: "estimate", pulse: "breathe", lights: [] }),
  });
  hub.setHouse(HOUSE, "show", false);
  hub.attach({ id: "sub", name: "t", send: (event, data) => frames.push({ event, data }) });
  const begin = (guest: string) => hub.begin({ guest, name: guest, world: "web", device: "Tent", station: null, captured: false })!;
  return { hub, calls, frames, begin, tick: (ms: number) => (t += ms), now: () => t };
}

describe("SpatialHub presence (C2.1)", () => {
  it("a joined program under a non-safety fixture pulses it on the next flush; held after it walks off, then let go", () => {
    const h = presenceHub();
    const a = h.begin("ann");
    expect(h.calls).toEqual([]);
    h.hub.flush();
    expect(h.calls).toEqual([["desk-lamp"]]);
    expect(h.hub.presence().get("desk-lamp")).toMatchObject({ sessions: [a.session] });
    // The same set: nobody is told again.
    h.tick(100);
    h.hub.flush();
    expect(h.calls).toHaveLength(1);
    // Walks off: held for LIGHT_PRESENCE_HOLD_MS, the flush loop kept alive.
    expect(h.hub.pose(a.token, pose(FAR))).toBe("ok");
    h.tick(100);
    h.hub.flush();
    expect(h.hub.presence().get("desk-lamp")).toMatchObject({ sessions: [] });
    expect(h.calls).toHaveLength(1);
    h.tick(LIGHT_PRESENCE_HOLD_MS);
    h.hub.flush();
    expect(h.calls.at(-1)).toEqual([]);
    expect(h.hub.presence().size).toBe(0);
  });

  it("walks into the hall: the hall bulbs pulse; a safety fixture never does", () => {
    const h = presenceHub();
    const a = h.begin("ann");
    h.hub.pose(a.token, pose([2, 0, 3.5]));
    h.hub.pose(a.token, pose(HALL));
    h.tick(LIGHT_PRESENCE_HOLD_MS + 1);
    h.hub.flush();
    expect(h.calls.at(-1)).toEqual(["hall-group"]);
    // The server room's RGB bulb is `safety`: never in the set, however close.
    const lights = structuredClone(LIGHTS);
    lights.presence = { to: ["everywhere"], radius: 5 };
    const s = presenceHub({ lights });
    const b = s.begin("bob");
    s.hub.pose(b.token, pose([2, -2.7, 1.5]));
    s.tick(LIGHT_PRESENCE_HOLD_MS + 1);
    s.hub.flush();
    expect([...s.hub.presence().keys()]).not.toContain("server-room-rgb");
    expect([...s.hub.presence().keys()]).not.toContain("server-strip");
  });

  it("presence off, or no lights getter: nothing ever pulses", () => {
    const off = structuredClone(LIGHTS);
    off.presence = { enabled: false };
    const h = presenceHub({ lights: off });
    h.begin("ann");
    h.hub.flush();
    expect(h.hub.presence().size).toBe(0);
    expect(h.calls).toEqual([]);
    const none = presenceHub({ lights: null });
    none.begin("ann");
    none.hub.flush();
    expect(none.hub.presence().size).toBe(0);
  });

  it("a leave steps at once (the hold applies); a reset forgets every pulse; a map swap re-judges", () => {
    const h = presenceHub();
    const a = h.begin("ann");
    h.hub.flush();
    expect(h.hub.active).toBe(true);
    h.hub.endByToken(a.token);
    expect(h.hub.presence().get("desk-lamp")).toMatchObject({ sessions: [] });
    // Held with nobody left: still active, so the runtime's loop lets it go.
    expect(h.hub.sessionCount).toBe(0);
    h.hub.detach("sub");
    expect(h.hub.active).toBe(true);
    h.tick(LIGHT_PRESENCE_HOLD_MS);
    h.hub.flush();
    expect(h.hub.active).toBe(false);

    const r = presenceHub();
    r.begin("bob");
    r.hub.flush();
    expect(r.hub.presence().size).toBe(1);
    r.hub.reset("reset");
    expect(r.hub.presence().size).toBe(0);
    expect(r.calls.at(-1)).toEqual([]);

    const m = presenceHub();
    m.begin("cat");
    m.hub.flush();
    expect(m.calls.at(-1)).toEqual(["desk-lamp"]);
    // The desktop gone from the map: the program stands nowhere, so it is
    // put back at the new spawn (the hall), and the hall bulbs pulse at once
    // (the desk lamp is only held, then let go).
    const moved = structuredClone(HOUSE);
    moved.rooms = moved.rooms.filter((r) => r.id !== "desktop");
    moved.doors = moved.doors.filter((d) => d.a !== "desktop" && d.b !== "desktop");
    moved.stairs = moved.stairs.filter((st) => st.from !== "desktop" && st.to !== "desktop");
    moved.terminals = moved.terminals.filter((x) => x.room !== "desktop");
    moved.duck.spots = [{ id: "hall-duck", room: "hall", pos: [8, 0, 5] }];
    moved.props = moved.props.filter((p) => p.room !== "desktop");
    moved.spawn = { room: "hall", pos: [4.5, 0, 5], yaw: 0 };
    m.hub.setHouse(moved, "event");
    expect(m.calls.at(-1)).toEqual(["desk-lamp", "hall-group"]);
    expect(m.hub.presence().get("desk-lamp")!.sessions).toEqual([]);
    m.tick(LIGHT_PRESENCE_HOLD_MS);
    m.hub.flush();
    expect(m.calls.at(-1)).toEqual(["hall-group"]);
  });

  it("a new subscriber gets its lights frame right after hello", () => {
    const h = presenceHub();
    expect(h.frames.map((f) => f.event)).toEqual(["hello", "lights"]);
    h.hub.sendLights({ at: 1, source: "house", pulse: null, lights: [] });
    expect(h.frames.at(-1)).toEqual({ event: "lights", data: { at: 1, source: "house", pulse: null, lights: [] } });
  });
});

// ---------------------------------------------------------------------------
// LightsHub: presence, shown, source
// ---------------------------------------------------------------------------

function lightsHub() {
  let t = 2_000_000;
  const hub = new LightsHub({ store: new Store(freshDir()), projectText: LIGHTS_TEXT, envFile: null, now: () => t });
  return { hub, tick: (ms: number) => (t += ms), now: () => t };
}
const entry = (since: number, sessions = ["s-1"]): PresenceEntry => ({ sessions, since, last: since });

describe("LightsHub presence + shown (C2.1, C2.2)", () => {
  it("setPresence moves the seq only when the set changes; the view is in file order", () => {
    const { hub } = lightsHub();
    const changes: string[] = [];
    hub.onChange((c) => changes.push(c.kind));
    expect(hub.presenceView()).toEqual({ seq: 0, fixtures: [] });
    hub.setPresence(new Map([["hall-group", entry(5)], ["desk-lamp", entry(7)]]));
    expect(hub.presenceView()).toEqual({ seq: 1, fixtures: [{ fixture: "desk-lamp", since: 7 }, { fixture: "hall-group", since: 5 }] });
    hub.setPresence(new Map([["hall-group", entry(5, [])], ["desk-lamp", entry(7)]]));
    expect(hub.presenceSeq).toBe(1);
    hub.setPresence(new Map([["desk-lamp", entry(7)]]));
    expect(hub.presenceSeq).toBe(2);
    expect(changes).toEqual(["presence", "presence"]);
    // The cursor: a different seq (an earlier process's too) answers at once.
    const v = hub.current().version;
    expect(hub.moved(v, null, null, null, 2)).toBe(false);
    expect(hub.moved(v, null, null, null, 1)).toBe(true);
    expect(hub.moved(v, null, null, null, 9)).toBe(true);
    expect(hub.moved(v, null)).toBe(false);
  });

  it("parseShown drops unknown fixtures and bad states, never the post", () => {
    expect(parseShown({ "desk-lamp": { state: "ON", brightness: 100 }, ghost: { state: "ON" }, "hall-group": { brightness: 999 }, "attic-bulb": "on" }, LIGHTS)).toEqual({ "desk-lamp": { state: "ON", brightness: 100 } });
    // An upper-case colour (the module's) is kept lower-case.
    expect(parseShown({ "hall-group": { color: "#FF00AA", effect: "breathe" } }, LIGHTS)).toEqual({ "hall-group": { color: "#ff00aa", effect: "breathe" } });
  });

  it("the source is house while the module is online and its report fresh; sourceFlipAt says when it lapses", () => {
    const h = lightsHub();
    expect(h.hub.gameSource()).toBe("estimate");
    h.hub.setShown({ "desk-lamp": { state: "ON" } });
    // A report without the module polling: still an estimate.
    expect(h.hub.gameSource()).toBe("estimate");
    expect(h.hub.sourceFlipAt()).toBeNull();
    h.hub.noteModule("house-pc");
    expect(h.hub.gameSource()).toBe("house");
    expect(h.hub.sourceFlipAt()).toBe(h.now() + LIGHTS_SHOWN_FRESH_MS + 1);
    h.tick(LIGHTS_SHOWN_FRESH_MS);
    expect(h.hub.gameSource()).toBe("house");
    h.tick(1);
    expect(h.hub.gameSource()).toBe("estimate");
    // A fresh report, but the module's window lapsed.
    h.hub.setShown({});
    expect(h.hub.gameSource()).toBe("house");
    h.tick(LIGHTS_MODULE_ONLINE_MS - LIGHTS_SHOWN_FRESH_MS + 5);
    h.hub.setShown({});
    expect(h.hub.gameSource()).toBe("estimate");
    // Parked on a long poll: only the report's age counts.
    h.hub.moduleWaiting(1);
    expect(h.hub.gameSource()).toBe("house");
    expect(h.hub.sourceFlipAt()).toBe(h.now() + LIGHTS_SHOWN_FRESH_MS + 1);
    h.hub.moduleWaiting(-1);
  });
});

// ---------------------------------------------------------------------------
// The estimate and the frame
// ---------------------------------------------------------------------------

describe("LightsEstimate (C2.2)", () => {
  it("replays a look from where each fixture was, fades, settles; a restore look gives it back", () => {
    const e = new LightsEstimate();
    expect(e.lampAt("server-room-rgb", 0)).toEqual(LAMP_SETTLED);
    expect(e.boot(LIGHTS, HOUSE, 1000)).toBe(true);
    expect(e.animating(2000)).toBe(true);
    // heart_idle: #00E5FF at 60 over 3 s, from the settled warm white.
    const mid = e.lampAt("server-room-rgb", 2500);
    expect(mid.brightness).toBe(Math.round(90 + (60 - 90) * 0.5));
    expect(e.lampAt("server-room-rgb", 5000)).toEqual({ brightness: 60, color: "#00e5ff", effect: null });
    expect(e.animating(5000)).toBe(false);
    // heart_nag (then: restore, 1.5 s): orange, then back to the idle cyan.
    expect(e.playLook(LIGHTS, HOUSE, "heart_nag", 10_000)).toBe(true);
    expect(e.lampAt("server-room-rgb", 10_600)).toMatchObject({ color: "#ff6a00", brightness: 254 });
    expect(e.lampAt("server-room-rgb", 13_000)).toEqual({ brightness: 60, color: "#00e5ff", effect: null });
    expect(e.playLook(LIGHTS, HOUSE, "no_such_look", 1)).toBe(false);
  });

  it("a {fixture, set} is safety-clamped and cut to the caps; a loop keeps it animating", () => {
    const e = new LightsEstimate();
    expect(e.set(LIGHTS, "server-room-rgb", { state: "OFF" }, 0)).toBe(true);
    // The RGB bulb is safety, min 40: an OFF is its floor.
    expect(e.lampAt("server-room-rgb", 10).brightness).toBe(40);
    // The desk lamp can't colour: the colour is dropped, the level kept.
    e.set(LIGHTS, "desk-lamp", { color: "#ff0000", brightness: 200 }, 0);
    expect(e.lampAt("desk-lamp", 10)).toEqual({ brightness: 200, color: LAMP_SETTLED.color, effect: null });
    expect(e.set(LIGHTS, "ghost", { state: "ON" }, 0)).toBe(false);
    expect(e.animating(10_000)).toBe(false);
    e.playLook(LIGHTS, HOUSE, "heart_door_open", 20_000);
    expect(e.animating(1e9)).toBe(true);
  });
});

describe("buildGameLights (C2.3)", () => {
  const base = { lights: LIGHTS, house: HOUSE, reported: null, estimate: new LightsEstimate(), pulsed: new Set<string>(), now: 42 };

  it("every placed fixture in file order, colour + level, pulse flags, the presence effect", () => {
    const f = buildGameLights({ ...base, source: "estimate", pulsed: new Set(["desk-lamp"]) });
    expect(f.at).toBe(42);
    expect(f.source).toBe("estimate");
    expect(f.pulse).toBe("breathe");
    expect(f.lights.map((l) => l.id)).toEqual(LIGHTS.fixtures.map((x) => x.id));
    const lamp = f.lights.find((l) => l.id === "desk-lamp")!;
    expect(lamp).toMatchObject({ room: "desktop", pos: { x: 1, y: 0.8, z: 1 }, kind: "zigbee", color: LAMP_SETTLED.color, level: Math.round((90 / 254) * 1000) / 1000, pulse: true, safety: false });
    expect(f.lights.find((l) => l.id === "server-room-rgb")).toMatchObject({ safety: true, pulse: false });
    // The clients' decoder reads it back whole.
    expect(gameLightsOf(JSON.parse(JSON.stringify(f)))).toEqual(f);
  });

  it("a fixture whose room the map lacks is left out; no map, no lights; presence off → pulse null", () => {
    const house = structuredClone(HOUSE);
    house.rooms = house.rooms.filter((r) => r.id !== "attic");
    expect(buildGameLights({ ...base, house, source: "estimate" }).lights.map((l) => l.id)).not.toContain("attic-bulb");
    expect(buildGameLights({ ...base, house: null, source: "estimate" }).lights).toEqual([]);
    const off = structuredClone(LIGHTS);
    off.presence = { enabled: false };
    expect(buildGameLights({ ...base, lights: off, source: "estimate" }).pulse).toBeNull();
  });

  it("house: the module's report (OFF is dark); a fixture it lacks is estimated", () => {
    const f = buildGameLights({ ...base, source: "house", reported: { "desk-lamp": { state: "OFF", brightness: 200 }, "hall-group": { color: "#FF0000", brightness: 254, effect: "breathe" } } });
    expect(f.lights.find((l) => l.id === "desk-lamp")).toMatchObject({ level: 0 });
    expect(f.lights.find((l) => l.id === "hall-group")).toMatchObject({ color: "#ff0000", level: 1, effect: "breathe" });
    expect(f.lights.find((l) => l.id === "attic-bulb")).toMatchObject({ color: LAMP_SETTLED.color });
    // Under `estimate` the report is ignored.
    expect(buildGameLights({ ...base, source: "estimate", reported: { "desk-lamp": { state: "OFF" } } }).lights.find((l) => l.id === "desk-lamp")!.level).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The feed's timing
// ---------------------------------------------------------------------------

function feedRig(o: { listeners?: number; animating?: boolean; flipAt?: number | null; lights?: number } = {}) {
  let t = 10_000;
  let n = o.listeners ?? 1;
  let anim = o.animating ?? false;
  let flip = o.flipAt ?? null;
  let level = 0;
  const sent: GameLights[] = [];
  const timers: Array<{ fn: () => void; at: number; id: number }> = [];
  let ids = 0;
  const fake: FeedTimers = {
    set: (fn, ms) => {
      const id = ++ids;
      timers.push({ fn, at: t + ms, id });
      return id;
    },
    clear: (h) => {
      const i = timers.findIndex((x) => x.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const frame = (): GameLights => ({ at: t, source: "estimate", pulse: "breathe", lights: Array.from({ length: o.lights ?? 1 }, (_, i) => ({ id: `f${i}`, room: "r", pos: { x: 0, y: 0, z: 0 }, kind: "zigbee", color: "#ffffff", level, effect: null, pulse: false, safety: false })) });
  const feed = new GameLightsFeed({ now: () => t, build: frame, send: (f) => sent.push(f), listeners: () => n, animating: () => anim, flipAt: () => flip, timers: fake });
  /** Advance the clock to `ms` later, firing every timer due on the way. */
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (next === undefined || next.at > end) break;
      timers.shift();
      t = next.at;
      next.fn();
    }
    t = end;
  };
  return {
    feed,
    sent,
    timers,
    advance,
    set: (v: { listeners?: number; animating?: boolean; flipAt?: number | null; level?: number }) => {
      if (v.listeners !== undefined) n = v.listeners;
      if (v.animating !== undefined) anim = v.animating;
      if (v.flipAt !== undefined) flip = v.flipAt;
      if (v.level !== undefined) level = v.level;
    },
    now: () => t,
  };
}

describe("GameLightsFeed (C2.3)", () => {
  it("hello gives the frame (null with no lights); a change sends at once, a burst at most every 250 ms (the trailing edge kept)", () => {
    const r = feedRig();
    expect(r.feed.hello()?.lights).toHaveLength(1);
    // Nothing changed since the hello: nothing sent.
    r.feed.changed();
    expect(r.sent).toHaveLength(0);
    r.set({ level: 0.5 });
    r.feed.changed();
    expect(r.sent.map((f) => f.lights[0]!.level)).toEqual([0.5]);
    r.set({ level: 0.6 });
    r.feed.changed();
    r.advance(100);
    r.set({ level: 0.7 });
    r.feed.changed();
    expect(r.sent).toHaveLength(1);
    r.advance(GAME_LIGHTS_MIN_MS);
    expect(r.sent.map((f) => f.lights[0]!.level)).toEqual([0.5, 0.7]);
    expect(r.sent[1]!.at - r.sent[0]!.at).toBe(GAME_LIGHTS_MIN_MS);
    expect(r.timers).toHaveLength(0);
    expect(feedRig({ lights: 0 }).feed.hello()).toBeNull();
  });

  it("while the estimate animates it re-computes every 250 ms and sends only a change; a settled house sends nothing", () => {
    const r = feedRig({ animating: true });
    r.feed.hello();
    expect(r.timers).toHaveLength(1);
    r.advance(GAME_LIGHTS_MIN_MS * 4);
    expect(r.sent).toHaveLength(0);
    r.set({ level: 0.3 });
    r.advance(GAME_LIGHTS_MIN_MS);
    expect(r.sent).toHaveLength(1);
    r.set({ animating: false });
    r.advance(GAME_LIGHTS_MIN_MS);
    expect(r.timers).toHaveLength(0);
  });

  it("a house report going stale fires one re-check at its flip time", () => {
    const r = feedRig();
    r.set({ flipAt: r.now() + 30_000 });
    r.feed.hello();
    expect(r.timers.map((x) => x.at)).toEqual([r.now() + 30_000]);
    r.set({ flipAt: null, level: 0.9 });
    r.advance(30_000);
    expect(r.sent).toHaveLength(1);
    expect(r.timers).toHaveLength(0);
  });

  it("no timer without listeners; the last one leaving and dispose clear them; never an empty frame to games that had none", () => {
    const r = feedRig({ listeners: 0, animating: true });
    r.feed.changed();
    expect(r.timers).toHaveLength(0);
    r.set({ listeners: 1 });
    r.feed.hello();
    expect(r.timers).toHaveLength(1);
    r.set({ listeners: 0 });
    r.feed.changed();
    expect(r.timers).toHaveLength(0);
    r.set({ listeners: 1 });
    r.feed.hello();
    r.feed.dispose();
    expect(r.timers).toHaveLength(0);
    expect(r.feed.pending).toBe(false);
    r.feed.changed();
    expect(r.timers).toHaveLength(0);

    const e = feedRig({ lights: 0 });
    e.set({ level: 1 });
    e.feed.changed();
    expect(e.sent).toHaveLength(0);
    expect(gameLightsKey({ at: 1, source: "house", pulse: null, lights: [] })).toBe(gameLightsKey({ at: 2, source: "house", pulse: null, lights: [] }));
  });
});

// ---------------------------------------------------------------------------
// The event runtime: routes and the stream
// ---------------------------------------------------------------------------

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
async function call(rt: EventRuntime, method: string, p: string, body: unknown = {}, o: { moderator?: boolean; token?: string } = { moderator: true }) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, { moderator: o.moderator ?? false });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
const view = async (rt: EventRuntime, q = ""): Promise<LightsView> => (await call(rt, "GET", `/api/mod/lights${q}`)).json as unknown as LightsView;

function runtime(o: { lights?: string; now?: () => number } = {}): EventRuntime {
  return new EventRuntime({
    eventId: "evt",
    store: new Store(freshDir()),
    codes: CODES,
    scenarioName: "t",
    scenarioSource: STORY,
    joinBase: () => "http://localhost",
    houseFile: HOUSE_FILE,
    audioFile: null,
    lightsFile: null,
    lights: o.lights ?? LIGHTS_TEXT,
    ...(o.now !== undefined ? { now: o.now } : {}),
  });
}

/** A config whose boot look is a warm white everywhere, so the story's
 *  `cue heart_idle` (cyan on the heart) is visible against it. */
function warmBoot(): string {
  const l = structuredClone(LIGHTS);
  l.boot = "house_warm";
  return JSON.stringify(l);
}

describe("the runtime (C2)", () => {
  it("presence rides GET /api/mod/lights; the presence cursor wakes a parked long poll", async () => {
    let t = 50_000_000;
    const rt = runtime({ now: () => t });
    const v = await view(rt);
    expect(v.presence).toEqual({ seq: 0, fixtures: [] });
    rt.spatial.setHouse(HOUSE, "show", false);
    const parked = view(rt, `?after=${v.version}&presence=0&wait=5`);
    await new Promise((r) => setTimeout(r, 20));
    expect(rt.lights.waiting).toBe(1);
    rt.spatial.begin({ guest: "ann", name: "Ann", world: "web", device: "Tent", station: null, captured: false });
    rt.spatial.flush();
    const woke = await parked;
    expect(woke.presence).toEqual({ seq: 1, fixtures: [{ fixture: "desk-lamp", since: t }] });
    // A cursor at the current seq waits; an older one answers at once.
    const t1 = Date.now();
    expect((await view(rt, `?after=${v.version}&presence=1&wait=0.1`)).presence.seq).toBe(1);
    expect(Date.now() - t1).toBeGreaterThanOrEqual(80);
    expect((await view(rt, `?after=${v.version}&presence=0&wait=5`)).presence.seq).toBe(1);
    // A cursor past the hub's seq is an earlier process's (a restart): at once.
    const t2 = Date.now();
    expect((await view(rt, `?after=${v.version}&presence=9&wait=5`)).presence.seq).toBe(1);
    expect(Date.now() - t2).toBeLessThan(1000);
    t += 1;
    rt.dispose();
  });

  it("POST /api/mod/lights/shown: a mod's, 400 only for a non-object; never on the host allowlist", async () => {
    const rt = runtime();
    expect((await call(rt, "POST", "/api/mod/lights/shown", { fixtures: [] })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/lights/shown", {})).status).toBe(400);
    const ok = await call(rt, "POST", "/api/mod/lights/shown", { fixtures: { "desk-lamp": { state: "ON", brightness: 10 }, ghost: { state: "ON" } } });
    expect(ok).toEqual({ status: 200, json: { ok: true } });
    expect(rt.lights.shown()?.fixtures).toEqual({ "desk-lamp": { state: "ON", brightness: 10 } });
    expect((await call(rt, "POST", "/api/mod/lights/shown", { fixtures: {} }, {})).status).toBe(403);
    expect(isHostRoute("POST", "/api/mod/lights/shown", { fixtures: {} }, { alertsPath: "", isAgent: () => false })).toBe(false);
    rt.dispose();
  });

  it("the stream: a lights frame after hello; a test, a story cue, a shown report and presence each send one", async () => {
    let t = 60_000_000;
    const rt = runtime({ lights: warmBoot(), now: () => t });
    rt.spatial.setHouse(HOUSE, "show", false);
    const frames: Array<{ event: string; data: unknown }> = [];
    rt.spatial.attach({ id: "term", name: "Kitchen", send: (event, data) => frames.push({ event, data }) });
    const lightsFrames = () => frames.filter((f) => f.event === "lights").map((f) => gameLightsOf(f.data)!);
    const rgb = (f: GameLights) => f.lights.find((l) => l.id === "server-room-rgb")!;
    expect(frames.map((f) => f.event)).toEqual(["hello", "lights"]);
    expect(lightsFrames()[0]!.source).toBe("estimate");
    // The boot look (house_warm), long settled: a warm white on the heart.
    expect(rgb(lightsFrames()[0]!).level).toBe(Math.round((120 / 254) * 1000) / 1000);
    // A test look: the heart turns orange.
    t += 1000;
    expect((await call(rt, "POST", "/api/mod/lights/test", { look: "heart_nag" })).status).toBe(200);
    t += 600;
    rt.gameLights.changed();
    expect(rgb(lightsFrames().at(-1)!).color).toBe("#ff6a00");
    // An identify sends nothing new (the estimate ignores it).
    t += 5000;
    rt.gameLights.changed();
    const settled = lightsFrames().length;
    t += 1000;
    await call(rt, "POST", "/api/mod/lights/test", { fixture: "desk-lamp" });
    expect(lightsFrames()).toHaveLength(settled);
    // The story's `cue heart_idle` (the entry beat, live) plays into the estimate.
    rt.openDoors();
    t += 5000;
    rt.gameLights.changed();
    expect(rgb(lightsFrames().at(-1)!)).toMatchObject({ color: "#00e5ff", level: Math.round((60 / 254) * 1000) / 1000 });
    // The module online with a fresh report: the source turns house.
    t += 1000;
    await view(rt, "?after=x&wait=0&module=1&name=house-pc");
    t += 1000;
    await call(rt, "POST", "/api/mod/lights/shown", { fixtures: { "server-room-rgb": { state: "ON", color: "#123456", brightness: 254 } } });
    expect(lightsFrames().at(-1)!.source).toBe("house");
    expect(rgb(lightsFrames().at(-1)!)).toMatchObject({ color: "#123456", level: 1 });
    // A fixture the module never commanded is estimated (the boot's warm white).
    expect(lightsFrames().at(-1)!.lights.find((l) => l.id === "attic-bulb")!.level).toBe(Math.round((120 / 254) * 1000) / 1000);
    // A program under the desk lamp: pulse true.
    t += 1000;
    rt.spatial.begin({ guest: "ann", name: "Ann", world: "web", device: "Tent", station: null, captured: false });
    rt.spatial.flush();
    expect(lightsFrames().at(-1)!.lights.find((l) => l.id === "desk-lamp")!.pulse).toBe(true);
    rt.dispose();
    expect(rt.gameLights.pending).toBe(false);
  });

  it("a story reset plays the boot look into the estimate again", async () => {
    let t = 70_000_000;
    const rt = runtime({ now: () => t });
    rt.spatial.setHouse(HOUSE, "show", false);
    const frames: GameLights[] = [];
    rt.spatial.attach({ id: "term", name: "T", send: (event, data) => event === "lights" && frames.push(data as GameLights) });
    await call(rt, "POST", "/api/mod/lights/test", { fixture: "server-room-rgb", set: { color: "#ff0000", brightness: 254 } });
    t += 1000;
    rt.gameLights.changed();
    expect(frames.at(-1)!.lights.find((l) => l.id === "server-room-rgb")!.color).toBe("#ff0000");
    rt.restart();
    t += 5000;
    rt.gameLights.changed();
    expect(frames.at(-1)!.lights.find((l) => l.id === "server-room-rgb")).toMatchObject({ color: "#00e5ff" });
    rt.dispose();
  });
});
