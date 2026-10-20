//! The show clock (wave 13 K1–K4): the pure helper (`src/show-clock.ts`),
//! the views' `showClock`, `POST /api/mod/clock` (the host allowlist, 400 /
//! 403 / 409), journaling across a restart, and the show's Power On (7:00 PM)
//! and 🕚 y2k_clock (11:00 PM) are in `trapped-w13-clock.test.ts`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { EventRuntime, type EventRuntimeInit } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { vNumber } from "../src/runtime/expr.ts";
import { cueSheetView } from "../src/cue-sheet.ts";
import { clockChange, formatShowTime, parseShowTime, showClock, showMinutes, CLOCK_SET_AT, CLOCK_SET_TO } from "../src/show-clock.ts";
import { isHostRoute } from "../server/routes/host.ts";

/** A minimal clock source: a world map + a story clock in ms. */
function source(world: Record<string, number | null>, elapsedMs: number) {
  return {
    world: { get: (p: string) => (p in world ? (world[p] === null ? { kind: "null" } : vNumber(world[p] as number)) : undefined) },
    elapsed: () => elapsedMs,
  };
}

describe("the show clock helper", () => {
  it("parses typed times; the small hours count past midnight", () => {
    expect(parseShowTime("7:00 PM")).toBe(1140);
    expect(parseShowTime("11:55pm")).toBe(1435);
    expect(parseShowTime("7 pm")).toBe(1140);
    expect(parseShowTime("12:30 PM")).toBe(750);
    expect(parseShowTime("23:00")).toBe(1380);
    expect(parseShowTime("0:05")).toBe(1445);
    expect(parseShowTime("12:05 AM")).toBe(1445);
    expect(parseShowTime("13:00 PM")).toBeNull();
    expect(parseShowTime("24:00")).toBeNull();
    expect(parseShowTime("7:60 PM")).toBeNull();
    expect(parseShowTime("soon")).toBeNull();
    expect(parseShowTime("")).toBeNull();
  });

  it("formats a 12-hour tray time, past midnight too", () => {
    expect(formatShowTime(1140)).toBe("7:00 PM");
    expect(formatShowTime(1183.9)).toBe("7:43 PM");
    expect(formatShowTime(1439.99)).toBe("11:59 PM");
    expect(formatShowTime(1445)).toBe("12:05 AM");
    expect(formatShowTime(720)).toBe("12:00 PM");
  });

  it("is absent with no clock, runs on story time, holds the running flag it is given", () => {
    expect(showClock(source({}, 0), true)).toBeUndefined();
    expect(showClock(null, true)).toBeUndefined();
    expect(showMinutes(source({ [CLOCK_SET_TO]: 1140, [CLOCK_SET_AT]: 60 }, 60_000))).toBe(1140);
    expect(showClock(source({ [CLOCK_SET_TO]: 1140, [CLOCK_SET_AT]: 60 }, 60_000 + 90_000), true)).toEqual({ minutes: 1141.5, running: true });
    expect(showClock(source({ [CLOCK_SET_TO]: 1140, [CLOCK_SET_AT]: 60 }, 60_000 + 90_000), false)).toEqual({ minutes: 1141.5, running: false });
    // Past midnight the minutes keep counting up.
    expect(showClock(source({ [CLOCK_SET_TO]: 1435, [CLOCK_SET_AT]: 0 }, 10 * 60_000), true)?.minutes).toBe(1445);
    // A null set_at (written before the first tick) is elapsed 0.
    expect(showMinutes(source({ [CLOCK_SET_TO]: 1140, [CLOCK_SET_AT]: null }, 120_000))).toBe(1142);
  });

  it("turns a host's body into the two writes, or a plain refusal", () => {
    const none = source({}, 30_500);
    expect(clockChange(none, { time: "7:00 PM" })).toEqual({ setTo: 1140, setAt: 30 });
    expect(clockChange(none, { nudge: 5 })).toEqual({ status: 409, error: "no clock yet" });
    expect(clockChange(none, {})).toMatchObject({ status: 400 });
    expect(clockChange(none, { time: "7:00 PM", nudge: 5 })).toMatchObject({ status: 400 });
    expect(clockChange(none, { time: "late" })).toMatchObject({ status: 400 });
    expect(clockChange(none, { time: 1140 })).toMatchObject({ status: 400 });
    const set = source({ [CLOCK_SET_TO]: 1140, [CLOCK_SET_AT]: 0 }, 120_000);
    expect(clockChange(set, { nudge: 5 })).toEqual({ setTo: 1147, setAt: 120 });
    expect(clockChange(set, { nudge: "-1" })).toEqual({ setTo: 1141, setAt: 120 });
    expect(clockChange(set, { nudge: 241 })).toMatchObject({ status: 400 });
    expect(clockChange(set, { nudge: 0 })).toMatchObject({ status: 400 });
    expect(clockChange(set, { nudge: "x" })).toMatchObject({ status: 400 });
  });

  it("the cue sheet (and so the host view) carries it", () => {
    expect(cueSheetView({ showClock: { minutes: 1200, running: true } }).showClock).toEqual({ minutes: 1200, running: true });
    expect(cueSheetView({}).showClock).toBeUndefined();
  });

  it("is on the host allowlist", () => {
    expect(isHostRoute("POST", "/api/mod/clock", { nudge: 1 }, { alertsPath: "Night.alerts", isAgent: () => false })).toBe(true);
  });
});

// --- the event server ---

const CODES = { event: "EVTCLK", prime: "PRMCLK", mod: "MODCLK" };

const STORY = `# Clock Night
start: Opening

ROLE Program
  cleared: bool = false

LOCATION Hall

CHARACTER Task Manager
  admin: true
  when greet for program:
    reply Hello.

CHARACTER Norton
  when scanned by program:
    reply Clean.

INTERACTION greet
  who: performer

== Opening
  setting: Hall
Hello.
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshRuntime(extra: Partial<EventRuntimeInit> = {}, dir?: string): EventRuntime {
  const d = dir ?? mkdtempSync(join(tmpdir(), "loom-clock-"));
  if (dir === undefined) dirs.push(d);
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "clock", scenarioSource: STORY, joinBase: () => "http://localhost", ...extra });
}

function fakeReq(body: unknown): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
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
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
    write() {
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res;
}
type Reply = { status: number; json: Record<string, unknown> };
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: Record<string, unknown> = {}, moderator = false): Promise<Reply> {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body), res as unknown as ServerResponse, method, url.pathname, url, { moderator });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}");
  } catch {
    json = { raw: res.body };
  }
  return { status: res.statusCode, json };
}
const post = (rt: EventRuntime, path: string, body: Record<string, unknown> = {}, moderator = false) => call(rt, "POST", path, body, moderator);
const get = (rt: EventRuntime, path: string, moderator = false) => call(rt, "GET", path, {}, moderator);
const clockOf = (r: Reply) => r.json.showClock as { minutes: number; running: boolean } | undefined;

async function register(rt: EventRuntime, name: string): Promise<{ id: string; token: string }> {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  expect(r.status).toBe(200);
  return { id: r.json.id as string, token: r.json.token as string };
}
async function booth(rt: EventRuntime, character: string): Promise<string> {
  const r = await post(rt, "/api/prime/login", { character, passcode: CODES.prime });
  expect(r.status).toBe(200);
  return r.json.token as string;
}

describe("POST /api/mod/clock and the views", () => {
  it("no clock until one is set; then every view carries it and it runs on story time", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await register(rt, "Winamp");
    expect(clockOf(await get(rt, `/api/state?role=guest&token=${g.token}`))).toBeUndefined();
    expect((await post(rt, "/api/mod/clock", { nudge: 5 }, true))).toMatchObject({ status: 409, json: { error: "no clock yet" } });
    expect((await post(rt, "/api/mod/clock", { time: "nope" }, true)).status).toBe(400);
    expect((await post(rt, "/api/mod/clock", {}, true)).status).toBe(400);

    const set = await post(rt, "/api/mod/clock", { time: "7:00 PM" }, true);
    expect(set).toMatchObject({ status: 200, json: { ok: true, clock: { minutes: 1140, running: true } } });
    expect(clockOf(await get(rt, `/api/state?role=guest&token=${g.token}`))).toEqual({ minutes: 1140, running: true });
    const tm = await booth(rt, "Task Manager");
    expect(clockOf(await get(rt, `/api/state?role=prime&token=${tm}`))).toEqual({ minutes: 1140, running: true });
    expect(clockOf(await get(rt, `/api/state?role=mod&host=1&token=${tm}`))).toEqual({ minutes: 1140, running: true });
    expect(clockOf(await get(rt, "/api/state?role=mod", true))).toEqual({ minutes: 1140, running: true });
    expect(clockOf(await get(rt, "/api/state?role=mod&cues=1", true))).toEqual({ minutes: 1140, running: true });
    expect(clockOf(await get(rt, "/api/screen/state?name=TV&view=tv", true))).toEqual({ minutes: 1140, running: true });

    for (let i = 0; i < 90; i++) rt.tickOnce(1000);
    expect(clockOf(await get(rt, `/api/state?role=guest&token=${g.token}`))).toEqual({ minutes: 1141.5, running: true });
    expect((await post(rt, "/api/mod/clock", { nudge: 5 }, true)).json.clock).toEqual({ minutes: 1146.5, running: true });
    expect((await post(rt, "/api/mod/clock", { nudge: -241 }, true)).status).toBe(400);
    // The host view's cache never holds a host's change back.
    expect((await post(rt, "/api/mod/clock", { nudge: -1, token: tm })).status).toBe(200);
    expect(clockOf(await get(rt, `/api/state?role=mod&host=1&token=${tm}`))).toEqual({ minutes: 1145.5, running: true });
  });

  it("a host booth may set it; a guest and a plain booth may not", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await register(rt, "Winamp");
    const norton = await booth(rt, "Norton");
    const tm = await booth(rt, "Task Manager");
    expect((await post(rt, "/api/mod/clock", { time: "11:00 PM", token: g.token })).status).toBe(403);
    expect((await post(rt, "/api/mod/clock", { time: "11:00 PM", token: norton })).status).toBe(403);
    expect((await post(rt, "/api/mod/clock", { time: "11:00 PM" })).status).toBe(403);
    const r = await post(rt, "/api/mod/clock", { time: "11:00 PM", token: tm });
    expect(r).toMatchObject({ status: 200, json: { clock: { minutes: 1380 } } });
  });

  it("holds still while paused, and a restart replays the same clock", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-clock-"));
    dirs.push(d);
    const rt = freshRuntime({}, d);
    rt.openDoors();
    for (let i = 0; i < 30; i++) rt.tickOnce(1000);
    await post(rt, "/api/mod/clock", { time: "23:55" }, true);
    for (let i = 0; i < 60; i++) rt.tickOnce(1000);
    expect(clockOf(await get(rt, "/api/state?role=mod", true))).toEqual({ minutes: 1436, running: true });
    rt.pause();
    for (let i = 0; i < 60; i++) rt.tickOnce(1000);
    expect(clockOf(await get(rt, "/api/state?role=mod", true))).toEqual({ minutes: 1436, running: false });
    // The journal carries both writes.
    const writes = new Store(d).readJournal().filter((e) => e.m === "setVar").map((e) => e.a[0]);
    expect(writes).toEqual([CLOCK_SET_TO, CLOCK_SET_AT]);

    const rt2 = freshRuntime({}, d);
    rt2.restore();
    expect(clockOf(await get(rt2, "/api/state?role=mod", true))?.minutes).toBe(1436);
  });
});
