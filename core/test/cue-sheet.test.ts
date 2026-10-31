//! The director's cue sheet off a mod token (W-26): the phone cue page signs
//! in with the mod passcode only, reads `cues` + the admin interactions off
//! `GET /api/state`, and fires with `/api/mod/signal {name, subject?, label}`
//! — the label is the journal's `by`. The rows are `src/cue-sheet.ts`, the
//! module the editor and the play app share.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { ModView } from "../server/views.ts";
import {
  ARM_DEAD_MS,
  ARM_MS,
  ARM_PICK_MS,
  armWindow,
  armFor,
  armStillValid,
  countdownLeft,
  cueActs,
  cueRows,
  cueSheetView,
  cueTitleTags,
  focusActIndex,
  onDeck,
  previousActIndex,
  tapCue,
  takesValue,
  type CueInteraction,
  type CueMarks,
} from "../src/cue-sheet.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { modView } from "../server/views.ts";
import { scenarioSource } from "../examples/load.ts";

const CODES = { event: "EVT262", prime: "PRM262", mod: "MOD262" };
const SOURCE = `# Cue Phone
theme: aol97

INTERACTION ring_the_bell
  label: C1 · 📣 Call everyone
  who: admin

INTERACTION hunt_time_up
  label: C2 · ⏰ Hunt over
  who: admin

INTERACTION accuse
  who: performer

when ring_the_bell:
  set Night.phase = "desktop"

when hunt_time_up:
  if Night.phase == "hunt":
    set Night.phase = "back"
`;

const DUCK_SOURCE = `# Cue Duck
INTERACTION ring_the_bell
  label: C1 · 📣 Call everyone
  who: admin

INTERACTION hunt_time_up
  label: C2 · ⏰ Hunt over
  who: admin

INTERACTION spin_the_bottle
  label: 🍾 Spin the bottle
  who: admin
  sequence: false

INTERACTION the golden duck
  label: 🦆 duck
  who: admin
  sequence: false

when ring_the_bell:
  set Night.phase = "desktop"

when hunt_time_up:
  set Night.phase = "back"

when spin_the_bottle:
  set Night.spins += 1

when the golden duck:
  set Night.ducks += 1
`;

const DOORS_SOURCE = `# Cue Doors
start: Power On

INTERACTION ring_the_bell
  label: C1 · 📣 Call everyone
  who: admin

== Power On
set Night.phase = "arrival"

when ring_the_bell:
  set Night.rang = true
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown, headers: Record<string, string>): IncomingMessage {
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
async function call(rt: EventRuntime, method: string, p: string, body: unknown, token?: string) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, token ? { "x-loom-token": token } : {}), res, method, url.pathname, url, { moderator: false });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

describe("the phone cue page's server surface (W-26)", () => {
  it("a device's signal that changes nothing (a door sensor edge) is never answered `refused`", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-cuephone-"));
    dirs.push(dir);
    const src = `${SOURCE}
when door_sensor_closed:
  if Night.phase == "never":
    set Night.phase = "shut"
`;
    const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: "cue-phone", scenarioSource: src, joinBase: () => "http://localhost" });
    rt.openDoors();
    const token = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
    const r = await call(rt, "POST", "/api/mod/signal", { name: "door_sensor_closed", args: { level: 3000 }, label: "Terminal · Server Room" }, token);
    expect(r.status).toBe(200);
    expect(r.json["refused"]).toBeUndefined();
    // A cue out of turn still says so.
    expect((await call(rt, "POST", "/api/mod/signal", { name: "hunt_time_up" }, token)).json["refused"]).toBe(true);
    rt.dispose();
  });

  it("a mod token reads the cue sheet and fires a cue under the phone's label", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-cuephone-"));
    dirs.push(dir);
    const store = new Store(dir);
    const rt = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "cue-phone", scenarioSource: SOURCE, joinBase: () => "http://localhost" });
    rt.openDoors();

    expect((await call(rt, "GET", "/api/state?role=mod", {})).status).toBe(403);
    const login = await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod });
    expect(login.status).toBe(200);
    const token = login.json["token"] as string;

    const before = (await call(rt, "GET", "/api/state?role=mod", {}, token)).json as unknown as ModView;
    expect(before.cues).toEqual({ last: null, lastBy: null, fired: [], presses: 0, pressed: null, caller: null }); // wave 18: nobody calls (key present)
    const rows = cueRows(before.interactions ?? [], before.cues!);
    expect(rows.map((r) => [r.code, r.next])).toEqual([
      ["C1", true],
      ["C2", false],
    ]);

    const fired = await call(rt, "POST", "/api/mod/signal", { name: "ring_the_bell", label: "Phone · Ana" }, token);
    expect(fired.status).toBe(200);
    const after = (await call(rt, "GET", "/api/state?role=mod", {}, token)).json as unknown as ModView;
    expect(after.cues?.last).toBe("ring_the_bell");
    expect(cueRows(after.interactions ?? [], after.cues!).find((r) => r.next)?.id).toBe("hunt_time_up");
    expect(after.world.find((w) => w.path === "Night.phase")?.value).toContain("desktop");
    const signal = store.readJournal().find((e) => e.m === "signal");
    expect(signal?.by).toBe("Phone · Ana");
    expect(fired.json).toEqual({ ok: true, presses: 1 });
    // Out of turn the story turns C2 down: taken, answered `refused`, not ticked.
    const early = await call(rt, "POST", "/api/mod/signal", { name: "hunt_time_up", label: "Phone · Ana" }, token);
    expect(early.json).toEqual({ ok: true, refused: true, presses: 1 });
    const still = (await call(rt, "GET", "/api/state?role=mod", {}, token)).json as unknown as ModView;
    expect(still.cues).toMatchObject({ last: "ring_the_bell", fired: ["ring_the_bell"] });
    rt.dispose();
  });

  it("a press armed against an older press count is refused (two directors, a repeat of LAST)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-cuephone-"));
    dirs.push(dir);
    const store = new Store(dir);
    const rt = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "cue-phone", scenarioSource: SOURCE, joinBase: () => "http://localhost" });
    rt.openDoors();
    const token = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
    const marks = async () => ((await call(rt, "GET", "/api/state?role=mod&cues=1", {}, token)).json as unknown as ReturnType<typeof cueSheetView>).cues;
    await call(rt, "POST", "/api/mod/signal", { name: "ring_the_bell" }, token);
    const m1 = await marks();
    expect(m1).toMatchObject({ last: "ring_the_bell", fired: ["ring_the_bell"], presses: 1, pressed: "ring_the_bell" });
    // The phone arms LAST again; the other director presses it first: only
    // the press count moves, and that is enough to drop the arm.
    const row = cueRows([{ id: "ring_the_bell", label: "C1 · 📣", who: "admin" }], m1)[0]!;
    const armed = tapCue(null, row, 0, m1);
    if (armed.kind !== "arm") throw new Error("unreachable");
    expect(armed.armed.presses).toBe(1);
    await call(rt, "POST", "/api/mod/signal", { name: "ring_the_bell", presses: 1 }, token);
    const m2 = await marks();
    expect(m2).toMatchObject({ last: "ring_the_bell", fired: ["ring_the_bell"], presses: 2 });
    expect(armStillValid(armed.armed, m2, 500)).toBe(false);
    // Before its poll the phone's second tap still fires on its old marks —
    // the server turns it down: nothing is journaled.
    const tap = tapCue(armed.armed, row, 500, m1);
    expect(tap).toMatchObject({ kind: "fire", presses: 1 });
    const signals = () => store.readJournal().filter((e) => e.m === "signal").length;
    const before = signals();
    const late = await call(rt, "POST", "/api/mod/signal", { name: "ring_the_bell", presses: 1 }, token);
    expect(late.status).toBe(409);
    expect(late.json["moved"]).toBe(true);
    expect(signals()).toBe(before);
    expect((await marks()).presses).toBe(2);
    // A refused press never counts.
    await call(rt, "POST", "/api/mod/signal", { name: "hunt_time_up", presses: 2 }, token);
    expect((await marks()).presses).toBe(2);
    rt.dispose();
  });

  it("a device's repeat of another cue never vetoes an armed press; the same cue again does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-cuephone-"));
    dirs.push(dir);
    const store = new Store(dir);
    const rt = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "cue-duck", scenarioSource: DUCK_SOURCE, joinBase: () => "http://localhost" });
    rt.openDoors();
    const token = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
    const marks = async () => ((await call(rt, "GET", "/api/state?role=mod&cues=1", {}, token)).json as unknown as ReturnType<typeof cueSheetView>).cues;
    const signals = () => store.readJournal().filter((e) => e.m === "signal").length;
    await call(rt, "POST", "/api/mod/signal", { name: "ring_the_bell" }, token);
    await call(rt, "POST", "/api/mod/signal", { name: "the golden duck" }, token); // the first find
    const m1 = await marks();
    expect(m1).toMatchObject({ last: "ring_the_bell", presses: 2, pressed: "the golden duck" });
    // The director arms C2; a guest finds the duck again (no count: never refused).
    const row = cueRows([{ id: "hunt_time_up", label: "C2 · ⏰", who: "admin" }], m1)[0]!;
    const armed = tapCue(null, row, 0, m1);
    if (armed.kind !== "arm") throw new Error("unreachable");
    expect((await call(rt, "POST", "/api/mod/signal", { name: "the golden duck" }, token)).status).toBe(200);
    const m2 = await marks();
    expect(m2).toMatchObject({ last: "ring_the_bell", presses: 3, pressed: "the golden duck" });
    // Neither screen nor server drops C2 over it: it fires.
    expect(armStillValid(armed.armed, m2, 500)).toBe(true);
    const c2 = await call(rt, "POST", "/api/mod/signal", { name: "hunt_time_up", presses: armed.armed.presses }, token);
    expect(c2.status).toBe(200);
    expect((await marks()).last).toBe("hunt_time_up");
    // Two directors arm 🍾 (an aside that already fired): the first press
    // lands, the second is turned down — the same cue again.
    await call(rt, "POST", "/api/mod/signal", { name: "spin_the_bottle" }, token);
    const m3 = await marks();
    const spin = cueRows([{ id: "spin_the_bottle", label: "🍾", who: "admin", sequence: false }], m3)[0]!;
    const a = tapCue(null, spin, 0, m3);
    if (a.kind !== "arm") throw new Error("unreachable");
    expect((await call(rt, "POST", "/api/mod/signal", { name: "spin_the_bottle", presses: a.armed.presses }, token)).status).toBe(200);
    const m4 = await marks();
    expect(armStillValid(a.armed, m4, 500)).toBe(false);
    const before = signals();
    const late = await call(rt, "POST", "/api/mod/signal", { name: "spin_the_bottle", presses: a.armed.presses }, token);
    expect(late.status).toBe(409);
    expect(late.json["moved"]).toBe(true);
    expect(signals()).toBe(before);
    // A device's duck find after the arm is fine, but a 🍾 hidden behind it
    // is still caught by the server (the screen only sees the newest press).
    const m5 = await marks();
    const b = tapCue(null, spin, 0, m5);
    if (b.kind !== "arm") throw new Error("unreachable");
    await call(rt, "POST", "/api/mod/signal", { name: "spin_the_bottle" }, token);
    await call(rt, "POST", "/api/mod/signal", { name: "the golden duck" }, token);
    const m6 = await marks();
    expect(m6.pressed).toBe("the golden duck");
    expect(armStillValid(b.armed, m6, 500)).toBe(true);
    expect((await call(rt, "POST", "/api/mod/signal", { name: "spin_the_bottle", presses: b.armed.presses }, token)).status).toBe(409);
    rt.dispose();
  });

  it("a restart with the doors shut keeps them closed: the strip says so and a counted press waits for the start beat", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-cuephone-"));
    dirs.push(dir);
    const store = new Store(dir);
    const rt = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "cue-doors", scenarioSource: DOORS_SOURCE, joinBase: () => "http://localhost" });
    const token = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
    const lean = async () => (await call(rt, "GET", "/api/state?role=mod&cues=1", {}, token)).json as unknown as ReturnType<typeof cueSheetView>;
    expect((await lean()).doorsClosed).toBe(true);
    // Push draft / reset before the doors: the run is paused, its start beat unplayed.
    expect((await call(rt, "POST", "/api/mod/reset", {}, token)).status).toBe(200);
    const after = await lean();
    expect(after.doorsClosed).toBe(true);
    expect(after.paused).toBe(true);
    const full = (await call(rt, "GET", "/api/state?role=mod", {}, token)).json as unknown as ModView;
    expect(full.phase).toBe("paused");
    expect(full.doorsClosed).toBe(true);
    // The cue sheet's press is refused like a press with no sim at all.
    const press = await call(rt, "POST", "/api/mod/signal", { name: "ring_the_bell", presses: 0 }, token);
    expect(press.status).toBe(409);
    expect(press.json["error"]).toBe("no scenario loaded");
    expect(store.readJournal().filter((e) => e.m === "signal")).toHaveLength(0);
    rt.openDoors();
    expect((await lean()).doorsClosed).toBeUndefined();
    expect((await call(rt, "POST", "/api/mod/signal", { name: "ring_the_bell", presses: 0 }, token)).status).toBe(200);
    expect(store.readJournal().map((e) => e.m).filter((m) => m === "fireBeat" || m === "signal")).toEqual(["fireBeat", "signal"]);
    // Paused after the doors opened is not "doors closed".
    rt.pause();
    expect((await lean()).doorsClosed).toBeUndefined();
    rt.dispose();
  });

  it("a restore of a story with no start: paused before its first tick keeps its doors open: a counted press is taken", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-cuephone-"));
    dirs.push(dir);
    const store = new Store(dir);
    const rt = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "cue-phone", scenarioSource: SOURCE, joinBase: () => "http://localhost" });
    const token = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
    rt.openDoors();
    expect((await call(rt, "POST", "/api/mod/signal", { name: "ring_the_bell", presses: 0 }, token)).status).toBe(200);
    rt.pause();
    expect((await call(rt, "POST", "/api/mod/signal", { name: "ring_the_bell", presses: 1 }, token)).status).toBe(200);
    // No tick and no entry fireBeat: nothing in the journal says the doors opened.
    expect(store.readJournal().map((e) => e.m)).toEqual(["signal", "signal"]);
    rt.dispose();
    const rt2 = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "cue-phone", scenarioSource: SOURCE, joinBase: () => "http://localhost" });
    expect(rt2.restore()).not.toBeNull();
    const token2 = (await call(rt2, "POST", "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
    const lean = (await call(rt2, "GET", "/api/state?role=mod&cues=1", {}, token2)).json as unknown as ReturnType<typeof cueSheetView>;
    expect(lean.doorsClosed).toBeUndefined();
    expect(lean.paused).toBe(true);
    expect(lean.cues.presses).toBe(2);
    expect((await call(rt2, "POST", "/api/mod/signal", { name: "ring_the_bell", presses: 2 }, token2)).status).toBe(200);
    // A restart with the doors shut is still a run whose doors never opened.
    expect((await call(rt2, "POST", "/api/mod/reset", {}, token2)).status).toBe(200);
    rt2.dispose();
    const rt3 = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "cue-phone", scenarioSource: SOURCE, joinBase: () => "http://localhost" });
    expect(rt3.restore()).not.toBeNull();
    const token3 = (await call(rt3, "POST", "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
    expect(((await call(rt3, "GET", "/api/state?role=mod&cues=1", {}, token3)).json as unknown as ReturnType<typeof cueSheetView>).doorsClosed).toBe(true);
    expect((await call(rt3, "POST", "/api/mod/signal", { name: "ring_the_bell", presses: 0 }, token3)).status).toBe(409);
    rt3.dispose();
  });

  it("before the doors the lean view lists the story's admin cues (not \"no director cues\")", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-cuephone-"));
    dirs.push(dir);
    const store = new Store(dir);
    const rt = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "cue-phone", scenarioSource: SOURCE, joinBase: () => "http://localhost" });
    const token = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
    const lean = (await call(rt, "GET", "/api/state?role=mod&cues=1", {}, token)).json as unknown as ReturnType<typeof cueSheetView>;
    expect(lean.interactions.map((i) => i.id)).toEqual(["ring_the_bell", "hunt_time_up"]);
    expect(lean.title).toBe("Cue Phone");
    // The skin is there before the doors, so the phone never switches at open.
    const full = (await call(rt, "GET", "/api/state?role=mod", {}, token)).json as unknown as ModView;
    expect(lean.theme).toBe("aol97");
    expect(full.theme).toBe("aol97");
    expect(full.title).toBe("Cue Phone");
    expect(lean.doorsClosed).toBe(true);
    expect(lean.paused).toBe(true);
    expect(lean.cues).toEqual({ last: null, lastBy: null, fired: [], presses: 0, pressed: null, caller: null }); // wave 18: nobody calls (key present)
    expect(cueRows(lean.interactions, lean.cues).find((r) => r.next)?.id).toBe("ring_the_bell");
    rt.openDoors();
    const open = (await call(rt, "GET", "/api/state?role=mod&cues=1", {}, token)).json as unknown as ReturnType<typeof cueSheetView>;
    expect(open).not.toHaveProperty("doorsClosed");
    expect(open.theme).toBe(lean.theme);
    expect(open.title).toBe(lean.title);
    expect(open.interactions.map((i) => i.id)).toEqual(["ring_the_bell", "hunt_time_up"]);
    rt.dispose();
  });

  it("?cues=1 answers just the cue sheet, a fraction of the full view", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-cuephone-"));
    dirs.push(dir);
    const store = new Store(dir);
    const rt = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "cue-phone", scenarioSource: SOURCE, joinBase: () => "http://localhost" });
    rt.openDoors();
    for (let i = 0; i < 20; i++) await call(rt, "POST", "/api/guest/register", { passcode: CODES.event, name: `Guest ${i}` });
    const token = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
    await call(rt, "POST", "/api/mod/signal", { name: "ring_the_bell", label: "Phone · Ana" }, token);
    expect((await call(rt, "GET", "/api/state?role=mod&cues=1", {})).status).toBe(403);

    const full = await call(rt, "GET", "/api/state?role=mod", {}, token);
    const lean = await call(rt, "GET", "/api/state?role=mod&cues=1", {}, token);
    expect(lean.status).toBe(200);
    expect(Object.keys(lean.json).sort()).toEqual(["clock", "cues", "interactions", "prompter", "rejoins", "roster", "theme", "title", "world"]);
    // Wave 23: plus the guests asking to get back in (none here); wave 59: and
    // the teleprompter's line (none on).
    expect(lean.json).toEqual({ ...cueSheetView(full.json as unknown as ModView), rejoins: [], prompter: null });
    const v = lean.json as unknown as ReturnType<typeof cueSheetView>;
    expect(v.interactions.map((i) => i.id)).toEqual(["ring_the_bell", "hunt_time_up"]);
    expect(v.world).toEqual([{ path: "Night.phase", value: expect.stringContaining("desktop") }]);
    expect(v.roster).toHaveLength(20);
    expect(Object.keys(v.roster[0]!).sort()).toEqual(["id", "location", "name", "owner"]);
    expect(v.cues.last).toBe("ring_the_bell");
    expect(JSON.stringify(lean.json).length * 3).toBeLessThan(JSON.stringify(full.json).length);
    rt.dispose();
  });

  it("?cues=1 says when the story clock is stopped, so the phone's countdowns freeze", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-cuephone-"));
    dirs.push(dir);
    const store = new Store(dir);
    const rt = new EventRuntime({ eventId: "evt", store, codes: CODES, scenarioName: "cue-phone", scenarioSource: SOURCE, joinBase: () => "http://localhost" });
    rt.openDoors();
    const token = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
    const lean = async () => (await call(rt, "GET", "/api/state?role=mod&cues=1", {}, token)).json as unknown as ReturnType<typeof cueSheetView>;
    rt.tickOnce(5000);
    const open = await lean();
    expect(open).not.toHaveProperty("paused");
    rt.pause();
    rt.tickOnce(5000); // a paused runtime's clock holds still
    const paused = await lean();
    expect(paused.paused).toBe(true);
    expect(paused.clock).toBe(open.clock);
    expect(cueSheetView({ phase: "idle" }).paused).toBe(true);
    expect(cueSheetView({ phase: "open" })).not.toHaveProperty("paused");
    expect(cueSheetView({})).not.toHaveProperty("paused"); // an older ModView: assume it runs
    rt.dispose();
  });
});

describe("NEXT skips what already ran (T7-01)", () => {
  const ix = (id: string, extra: { sequence?: false; repeat?: true } = {}) => ({ id, label: id, who: "admin", ...extra });
  const sheet = [ix("c1"), ix("v2"), ix("close"), ix("results", { repeat: true }), ix("spin", { sequence: false }), ix("telephone"), ix("zip", { repeat: true }), ix("overshare")];
  const next = (last: string | null, fired: string[]) => cueRows(sheet, { last, fired }).find((r) => r.next)?.id ?? null;

  it("is the first in-sequence row after LAST that hasn't fired", () => {
    expect(next(null, [])).toBe("c1");
    expect(next("c1", ["c1", "close"])).toBe("v2");
    expect(next("v2", ["c1", "v2", "close"])).toBe("results");
    expect(next("close", ["c1", "v2", "close", "telephone"])).toBe("results");
    expect(next("results", ["c1", "v2", "close", "results", "telephone"])).toBe("results");
    expect(next("telephone", ["c1", "v2", "close", "results", "telephone"])).toBe("zip");
  });

  it("a `repeat: true` LAST stays NEXT: 📋 per question, 🗜 per trip, until the director moves on (T7-01)", () => {
    const rows = cueRows(sheet, { last: "results", fired: ["c1", "v2", "close", "results"] });
    expect(rows.find((r) => r.id === "results")).toMatchObject({ last: true, next: true });
    expect(rows.filter((r) => r.next)).toHaveLength(1);
    expect(next("zip", ["zip"])).toBe("zip");
    expect(next("overshare", ["zip", "overshare"])).toBe(null);
  });

  it("a `repeat: true` cue stays eligible once fired; the lean view carries the flag", () => {
    expect(next("v2", ["c1", "v2", "close", "results"])).toBe("results");
    expect(next("telephone", ["telephone", "zip"])).toBe("zip");
    expect(cueSheetView({ interactions: sheet }).interactions.find((i) => i.id === "results")).toMatchObject({ repeat: true });
    expect(cueSheetView({ interactions: sheet }).interactions.find((i) => i.id === "c1")).not.toHaveProperty("repeat");
  });
});

describe("NEXT follows tonight's branch (an admin cue's `while:`)", () => {
  const ix = (id: string, extra: { live?: false } = {}) => ({ id, label: id, who: "admin", ...extra });

  it("skips a row whose `while:` is false, keeps it pressable, and the lean view carries the flag", () => {
    const sheet = [ix("y2k"), ix("recount", { live: false }), ix("summary", { live: false }), ix("reveal"), ix("ceremony", { live: false })];
    const rows = cueRows(sheet, { last: "y2k", fired: ["y2k"] });
    expect(rows.find((r) => r.next)?.id).toBe("reveal");
    expect(rows.find((r) => r.id === "recount")).toMatchObject({ live: false, sequence: true, next: false });
    expect(rows.find((r) => r.id === "reveal")).toMatchObject({ live: true });
    expect(cueRows(sheet, { last: "reveal", fired: ["y2k", "reveal"] }).find((r) => r.next)).toBeUndefined();
    // A `repeat: true` LAST stays NEXT only while it is live (📋 after Q3).
    const results = [ix("close"), { ...ix("results"), repeat: true as const, live: false as const }, ix("preview")];
    expect(cueRows(results, { last: "results", fired: ["close", "results"] }).find((r) => r.next)?.id).toBe("preview");
    const lean = cueSheetView({ interactions: sheet }).interactions;
    expect(lean.find((i) => i.id === "recount")).toMatchObject({ live: false });
    expect(lean.find((i) => i.id === "reveal")).not.toHaveProperty("live");
  });
});

describe("acts on the cue sheet (wave 10: display only)", () => {
  type Extra = Partial<Pick<CueInteraction, "act" | "sequence" | "repeat" | "live" | "subject" | "description">>;
  const ix = (id: string, extra: Extra = {}): CueInteraction => ({ id, label: id, who: "admin", ...extra });
  // B: b1 b2 (aside b3) · C: c1 c2 · Anytime: lights · D: d1 · Anytime again: duck
  const sheet = [
    ix("b1", { act: "B · Act I: the Desktop" }),
    ix("b2"),
    ix("b3", { sequence: false }),
    ix("c1", { act: "C · The hour" }),
    ix("c2", { sequence: false }),
    ix("c3"),
    ix("lights", { act: "Anytime", sequence: false }),
    ix("d1", { act: "D · Finale" }),
    ix("duck", { act: "anytime", sequence: false }),
  ];
  const acts = (last: string | null, fired: string[]) => cueActs(cueRows(sheet, { last, fired }));

  it("act carries forward to later admin cues", () => {
    const rows = cueRows([...sheet.slice(0, 3), { id: "perf", label: "x", who: "performer", act: "Z" }, ...sheet.slice(3)], { last: null, fired: [] });
    expect(rows.map((r) => [r.id, r.act])).toEqual([
      ["b1", "B · Act I: the Desktop"],
      ["b2", "B · Act I: the Desktop"],
      ["b3", "B · Act I: the Desktop"],
      ["c1", "C · The hour"],
      ["c2", "C · The hour"],
      ["c3", "C · The hour"],
      ["lights", "Anytime"],
      ["d1", "D · Finale"],
      ["duck", "Anytime"],
    ]);
    // A cue before the first `act:` belongs to no act; a blank `act:` carries on.
    const lead = cueRows([ix("pre"), ix("a", { act: "A" }), ix("b", { act: "  " })], { last: null, fired: [] });
    expect(lead.map((r) => r.act)).toEqual([null, "A", "A"]);
  });

  it("act rejoins by folded name", () => {
    const a = acts(null, []);
    expect(a.map((x) => [x.code, x.title, x.rows.map((r) => r.id)])).toEqual([
      ["B", "Act I: the Desktop", ["b1", "b2", "b3"]],
      ["C", "The hour", ["c1", "c2", "c3"]],
      [null, "Anytime", ["lights", "duck"]],
      ["D", "Finale", ["d1"]],
    ]);
    // The first spelling wins; `Act_one` / `act  ONE` fold to the same act.
    const rows = cueRows([ix("x", { act: "Act one" }), ix("y", { act: "B" }), ix("z", { act: "act_ONE" })], { last: null, fired: [] });
    expect(rows.map((r) => r.act)).toEqual(["Act one", "B", "Act one"]);
    expect(cueActs(rows).map((x) => [x.key, x.rows.length])).toEqual([["act one", 2], ["b", 1]]);
  });

  it("no act gives one unnamed act", () => {
    const rows = cueRows([ix("a"), ix("b", { sequence: false }), ix("c")], { last: null, fired: [] });
    const one = cueActs(rows);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ key: "", code: null, title: null, state: "focus", starting: true, firedSpine: 0 });
    expect(one[0]!.spine.map((r) => r.id)).toEqual(["a", "c"]);
    expect(one[0]!.asides.map((r) => r.id)).toEqual(["b"]);
    expect(cueActs([])).toEqual([]);
    expect(focusActIndex([])).toBe(-1);
  });

  it("all-aside act is anytime and never focus", () => {
    const a = acts(null, []);
    expect(a[2]).toMatchObject({ title: "Anytime", state: "anytime", spine: [], starting: false });
    // Even with only asides fired, the focus stays on a spine act.
    expect(focusActIndex(acts(null, ["lights", "duck"]))).toBe(0);
    const only = cueActs(cueRows([ix("x", { act: "Anytime", sequence: false })], { last: null, fired: [] }));
    expect(only.map((x) => x.state)).toEqual(["anytime"]);
    expect(focusActIndex(only)).toBe(-1);
  });

  it("focus follows NEXT, then LAST, then the first act", () => {
    expect(focusActIndex(acts(null, []))).toBe(0); // NEXT b1
    expect(focusActIndex(acts("b2", ["b1", "b2"]))).toBe(1); // NEXT c1
    expect(acts("b2", ["b1", "b2"]).map((x) => x.state)).toEqual(["past", "focus", "anytime", "future"]);
    // NEXT gone (everything after LAST fired): the act holding LAST.
    expect(focusActIndex(acts("c3", ["b1", "b2", "c1", "c3", "d1"]))).toBe(1);
    // No NEXT and no LAST: the first act that is not Anytime.
    const after = cueActs(cueRows([ix("l", { act: "Anytime", sequence: false }), ix("a", { act: "A", live: false })], { last: null, fired: [] }));
    expect(after.map((x) => x.state)).toEqual(["anytime", "focus"]);
    expect(after[1]!.starting).toBe(false);
    expect(focusActIndex(acts("d1", ["b1", "b2", "c1", "c3", "d1"]))).toBe(3);
  });

  it("starting when NEXT is the act's first unfired spine", () => {
    expect(acts(null, [])[0]!.starting).toBe(true);
    expect(acts("b1", ["b1"])[0]).toMatchObject({ state: "focus", starting: false }); // NEXT b2
    expect(acts("b2", ["b1", "b2"])[1]).toMatchObject({ state: "focus", starting: true }); // NEXT c1
    // c1 fired out of turn earlier: NEXT c3 is still the first unfired spine.
    expect(acts("b2", ["b1", "b2", "c1"])[1]).toMatchObject({ state: "focus", starting: true });
    // A `repeat: true` LAST that stays NEXT has fired: not starting.
    const rep = cueActs(cueRows([ix("r", { act: "A", repeat: true }), ix("s")], { last: "r", fired: ["r"] }));
    expect(rep[0]).toMatchObject({ state: "focus", starting: false });
  });

  it("skipped past act", () => {
    const a = acts("c1", ["c1"]); // the night jumped straight to C
    expect(a.map((x) => x.state)).toEqual(["skipped", "focus", "anytime", "future"]);
    expect(a[0]!.firedSpine).toBe(0);
    expect(acts("c1", ["b1", "c1"]).map((x) => [x.state, x.firedSpine])[0]).toEqual(["past", 1]);
  });

  it("previousActIndex skips anytime", () => {
    const a = acts("c3", ["b1", "b2", "c1", "c3"]); // NEXT d1 → focus D (index 3)
    expect(focusActIndex(a)).toBe(3);
    expect(previousActIndex(a, 3)).toBe(1);
    expect(previousActIndex(a, 1)).toBe(0);
    expect(previousActIndex(a, 0)).toBe(-1);
    expect(previousActIndex(a, -1)).toBe(-1);
  });

  it("onDeck", () => {
    expect(onDeck(cueRows(sheet, { last: null, fired: [] }))?.id).toBe("b2");
    // The asides between are skipped; an out-of-turn fired cue too.
    expect(onDeck(cueRows(sheet, { last: "b1", fired: ["b1", "c1"] }))?.id).toBe("c3");
    // A repeat LAST that stays NEXT: on deck is what "move on" means.
    const rep = cueRows([ix("close"), ix("results", { repeat: true }), ix("spin", { sequence: false }), ix("preview")], { last: "results", fired: ["close", "results"] });
    expect(onDeck(rep)?.id).toBe("preview");
    // An off-branch cue can be on deck (the sheet dims it); no NEXT → null.
    expect(onDeck(cueRows([ix("a"), ix("b"), ix("c", { live: false })], { last: "a", fired: ["a"] }))?.id).toBe("c");
    expect(onDeck(cueRows(sheet, { last: "d1", fired: ["b1", "b2", "c1", "c3", "d1"] }))).toBeNull();
  });

  it("cueTitleTags lifts leading and trailing parentheticals", () => {
    expect(cueTitleTags("(Optional) ☎️ Telephone: a mangled message sends someone to the Internet")).toEqual({ title: "☎️ Telephone: a mangled message sends someone to the Internet", tags: ["optional"] });
    expect(cueTitleTags("💌 (Alt, after a lie → Grok Prom) Trabolta begs for relationship advice")).toEqual({ title: "💌 Trabolta begs for relationship advice", tags: ["alt, after a lie → Grok Prom"] });
    expect(cueTitleTags("⏰ Hunt over: everyone back to the Desktop (auto at 15 min)")).toEqual({ title: "⏰ Hunt over: everyone back to the Desktop", tags: ["auto at 15 min"] });
    expect(cueTitleTags("🖨 Printer: START pressed (hardware fallback)")).toEqual({ title: "🖨 Printer: START pressed", tags: ["hardware fallback"] });
    expect(cueTitleTags("🗳 (Alt) Count the advice poll (round 2)")).toEqual({ title: "🗳 Count the advice poll", tags: ["alt", "round 2"] });
    expect(cueTitleTags("📊 Trust Chart")).toEqual({ title: "📊 Trust Chart", tags: [] });
    expect(cueTitleTags("(only this)")).toEqual({ title: "(only this)", tags: [] });
    expect(cueTitleTags("Say (it) loud")).toEqual({ title: "Say (it) loud", tags: [] });
    expect(cueTitleTags("Reinstallation: simulation completed (server)")).toEqual({ title: "Reinstallation: simulation completed", tags: ["server"] });
    expect(cueTitleTags("Wake the TV (TV mute)").tags).toEqual(["TV mute"]);
  });

  it("cueTitleTags keeps a tag's text unchanged unless it leads with Optional or Alt", () => {
    // The show's real labels: a name or a capitalised phrase is never mangled.
    expect(cueTitleTags("🍾 Spin the bottle (Truth or Dare, five per question)").tags).toEqual(["Truth or Dare, five per question"]);
    expect(cueTitleTags("🎙 The ceremony (Trabolta hosts)").tags).toEqual(["Trabolta hosts"]);
    expect(cueTitleTags("🦆 Duck found (Reinstallation — backyard)").tags).toEqual(["Reinstallation — backyard"]);
    // Only the whole lead word counts: `Alternative`, `Optionally` stay as written.
    expect(cueTitleTags("A cue (Alternative ending)").tags).toEqual(["Alternative ending"]);
    expect(cueTitleTags("A cue (Optionally later)").tags).toEqual(["Optionally later"]);
    expect(cueTitleTags("A cue (Optional: if time)").tags).toEqual(["optional: if time"]);
  });

  it("marks are identical with and without act lines", () => {
    // The show, with every `act:` stripped, against the same show tagged as
    // the Director spec splits it (§2.5): the same presses, in and out of
    // turn, must give the same cue state and the same row marks.
    const openers: Record<string, string> = {
      call_to_the_desktop: "B · Act I: the Desktop, Bingo and the first truth",
      second_hunt_preview: "C · The malware, the hour, the Truther Download",
      truth_pong: "D · Act II: Truth Pong, the Trust Chart, the beans",
      y2k_clock: "E · Act III: the Y2K hour and the server room",
      restore_the_lights: "Anytime",
      final_reveal: "F · The final reveal and the endings",
      own_award_lines: "G · The awards ceremony",
      "the simulation completed": "Anytime",
      // Wave 20: 🚪 closed / trust and 🕊 autoend, appended after 👑 / 🔧, rejoin E.
      server_door_closed: "E · Act III: the Y2K hour and the server room",
      // Wave 26: the games' three moments, appended after 🔌, rejoin Anytime.
      "simulation escape attempt": "Anytime",
      // Wave 44: 🎬 G12, appended last, rejoins G.
      roll_the_credits: "G · The awards ceremony",
      // Wave 50: 🌀, appended last, rejoins Anytime.
      dream_toggle: "Anytime",
    };
    const bare = scenarioSource("trapped-in-the-internet").replace(/^ {2}act:.*\n/gmu, "");
    let tagged = bare;
    for (const [id, act] of Object.entries(openers)) {
      const re = new RegExp(`(^INTERACTION ${id}\n(?: .*\n)*? {2}who: admin\n)`, "mu");
      expect(re.test(tagged), id).toBe(true);
      tagged = tagged.replace(re, `$1  act: ${act}\n`);
    }
    const plain = Sim.fromSources(bare);
    const acted = Sim.fromSources(tagged);
    const marks = (sim: Sim) => {
      const v = modView(sim, "open", "x");
      const rows = cueRows(v.interactions ?? [], v.cues!).map(({ id, n, fired, last, next, live, sequence }) => ({ id, n, fired, last, next, live, sequence }));
      return { cues: v.cues, rows };
    };
    const tagRows = cueRows(modView(acted, "open", "x").interactions ?? [], { last: null, fired: [] });
    expect(cueActs(tagRows).map((a) => `${a.code ?? a.title} ${a.rows.length}`)).toEqual(["B 12", "C 5", "D 8", "E 15", "Anytime 12", "F 11", "G 20"]); // wave 53: ⏭ in Anytime; wave 48: 🔑 G14 in G; wave 45: 🚻 G13 in G; wave 44: 🎬 G12 in G; wave 18b: −☎️ −🪅; wave 20: +3 in E; wave 21: +3 staff awards in G; wave 22: 🔌 Trust the patch bay in E; wave 26: +3 game moments in Anytime; wave 32: ⚡ ad_burst in Anytime
    expect(marks(acted)).toEqual(marks(plain));
    const admin = [...plain.model.interactions.values()].filter((i) => i.who === "admin").map((i) => i.id);
    for (const id of admin.slice(0, 30)) {
      for (const sim of [plain, acted]) {
        sim.signal(id);
        sim.signal("read_the_results"); // a repeat press, often out of turn
        sim.tick(61_000);
      }
      expect(marks(acted), id).toEqual(marks(plain));
    }
    expect(acted.log.len()).toBe(plain.log.len());
    expect(marks(plain).cues!.fired.length).toBeGreaterThan(5); // the walk really moved the sheet
  });
});

describe("the arm model (shared by the laptop and the phone)", () => {
  const row = (id: string, subject = false) => cueRows([{ id, label: id, who: "admin", ...(subject ? { subject: true } : {}) }], { last: null, fired: [] })[0]!;
  const bingo = row("start_the_bingo");
  const award = row("award_most_trusted", true);
  const marks: CueMarks = { last: "call_to_the_desktop", fired: ["call_to_the_desktop"] };

  it("tapCue ignores a second tap inside ARM_DEAD_MS", () => {
    const first = tapCue(null, bingo, 1000, marks);
    expect(first).toEqual({ kind: "arm", armed: { id: "start_the_bingo", subject: null, at: 1000, last: "call_to_the_desktop", firedCount: 1 } });
    if (first.kind !== "arm") throw new Error("unreachable");
    expect(tapCue(first.armed, bingo, 1000 + ARM_DEAD_MS - 1, marks)).toEqual({ kind: "ignore" });
    expect(tapCue(first.armed, bingo, 1000 + ARM_DEAD_MS, marks)).toEqual({ kind: "fire", id: "start_the_bingo", subject: null });
    expect(tapCue(first.armed, bingo, 1000 + ARM_MS - 1, marks).kind).toBe("fire");
    // Too late: it re-arms. Another row inside the dead time: that row arms.
    expect(tapCue(first.armed, bingo, 1000 + ARM_MS, marks).kind).toBe("arm");
    expect(tapCue(first.armed, row("other"), 1001, marks)).toMatchObject({ kind: "arm", armed: { id: "other" } });
    // A subject cue: pick, then the picked arm ignores a fast tap and fires a slow one.
    expect(tapCue(null, award, 0)).toEqual({ kind: "pick", id: "award_most_trusted" });
    const armed = armFor("award_most_trusted", "g1", 50, " 4 ", marks);
    expect(armed).toEqual({ id: "award_most_trusted", subject: "g1", at: 50, ms: ARM_PICK_MS, value: "4", last: "call_to_the_desktop", firedCount: 1 });
    expect(tapCue(armed, award, 100, marks)).toEqual({ kind: "ignore" });
    expect(tapCue(armed, award, 400, marks)).toEqual({ kind: "fire", id: "award_most_trusted", subject: "g1", value: "4" });
    expect(armFor("award_most_trusted", "g1", 50, "  ")).toEqual({ id: "award_most_trusted", subject: "g1", at: 50, ms: ARM_PICK_MS });
    // No marks given (an older caller): no binding, no stale check.
    expect(tapCue(null, bingo, 5)).toEqual({ kind: "arm", armed: { id: "start_the_bingo", subject: null, at: 5 } });
  });

  it("armStillValid drops an arm when last or fired count moved", () => {
    const a = armFor("start_the_bingo", "g1", 0, undefined, marks);
    expect(armStillValid(a, marks, 1000)).toBe(true);
    expect(armStillValid(a, marks, ARM_PICK_MS)).toBe(false);
    expect(armStillValid(a, { last: "start_the_bingo", fired: ["call_to_the_desktop", "start_the_bingo"] }, 1000)).toBe(false);
    expect(armStillValid(a, { last: "call_to_the_desktop", fired: ["call_to_the_desktop", "spin_the_bottle"] }, 1000)).toBe(false);
    // A stale arm never fires: the tap arms again, bound to the new marks.
    const moved: CueMarks = { last: "call_to_the_desktop", fired: ["call_to_the_desktop", "spin_the_bottle"] };
    const first = tapCue(null, bingo, 0, marks);
    if (first.kind !== "arm") throw new Error("unreachable");
    expect(tapCue(first.armed, bingo, 1000, moved)).toEqual({ kind: "arm", armed: { id: "start_the_bingo", subject: null, at: 1000, last: "call_to_the_desktop", firedCount: 2 } });
    expect(tapCue(first.armed, award.id === bingo.id ? bingo : award, 1000, moved).kind).toBe("pick");
    // An arm made with no marks is only timed.
    expect(armStillValid({ id: "x", subject: null, at: 0 }, moved, 10)).toBe(true);
  });

  it("a cue armed through the who? picker waits ARM_PICK_MS, a plain one still ARM_MS (wave 28)", () => {
    expect(ARM_PICK_MS).toBe(10_000);
    const a = armFor("award_most_trusted", "g1", 0);
    expect(armWindow(a)).toBe(ARM_PICK_MS);
    // Six seconds after the pick (the sheet closed, the row scrolled back): it still fires.
    expect(tapCue(a, award, 6000)).toEqual({ kind: "fire", id: "award_most_trusted", subject: "g1" });
    expect(tapCue(a, award, 9_999).kind).toBe("fire");
    // At ten it has lapsed: the tap opens the picker again.
    expect(tapCue(a, award, 10_000).kind).toBe("pick");
    const bound = armFor("award_most_trusted", "g1", 0, undefined, marks);
    expect(armStillValid(bound, marks, 9_999)).toBe(true);
    expect(armStillValid(bound, marks, 10_000)).toBe(false);
    // A plain row keeps 4 s: at 4000 the tap arms it again.
    const plain = tapCue(null, bingo, 0, marks);
    if (plain.kind !== "arm") throw new Error("unreachable");
    expect(armWindow(plain.armed)).toBe(ARM_MS);
    expect(tapCue(plain.armed, bingo, 3999, marks).kind).toBe("fire");
    expect(tapCue(plain.armed, bingo, 4000, marks).kind).toBe("arm");
  });

  it("only an award takes a value", () => {
    expect(takesValue("award_best_liar")).toBe(true);
    for (const id of ["chess_won", "the golden duck", "start_the_ceremony"]) expect(takesValue(id), id).toBe(false);
  });
});

describe("countdowns on the cue sheet", () => {
  it("countdownLeft", () => {
    expect(countdownLeft(3700, 100_000)).toBe(3600);
    expect(countdownLeft(110, 109_200)).toBe(1); // 0.8 s left reads 1
    expect(countdownLeft(110, 110_000)).toBeNull();
    expect(countdownLeft(110, 200_000)).toBeNull();
    expect(countdownLeft(110, null)).toBeNull();
    expect(countdownLeft(Number.NaN, 0)).toBeNull();
  });

  it("cueSheetView carries act, countdowns, ≤3 non-secret global watch values, never secret ones", () => {
    const v = cueSheetView({
      interactions: [
        { id: "a", label: "A", who: "admin", act: "B · Act I", description: "Press first." },
        { id: "b", label: "B", who: "admin", description: "Then this." },
        { id: "p", label: "P", who: "performer", act: "Z" },
      ],
      clock: 100_000,
      world: [
        { path: "Night.clock", value: "23:30" },
        { path: "Night.phase", value: '"y2k"' },
        { path: "Kernel.door_code", value: "4711" },
        { path: "Night.round", value: "3" },
        { path: "Floor.mood", value: "calm" },
      ],
      watch: [
        { label: "Door code", path: "Kernel.door_code", scope: "character", secret: true },
        { label: "Clock", path: "Night.clock", scope: "global" },
        { label: "Cleared", path: "Program.cleared", scope: "role" },
        { label: "Excel", path: null, scope: "person" },
        { label: "Judge", path: "Night.judge_mode", scope: "global" },
        { label: "Round", path: "Night.round", scope: "global" },
        { label: "Mood", path: "Floor.mood", scope: "global" },
      ],
      countdowns: [{ label: "Midnight", endsAt: 3700, path: "Night.y2k_end" } as { label: string; endsAt: number }],
    });
    expect(v.interactions).toEqual([
      { id: "a", label: "A", who: "admin", act: "B · Act I" },
      { id: "b", label: "B", who: "admin" },
    ]);
    expect(v.clock).toBe(100_000);
    expect(v.countdowns).toEqual([{ label: "Midnight", endsAt: 3700 }]);
    expect(v.watch).toEqual([
      { label: "Clock", value: "23:30" },
      { label: "Judge", value: "null" },
      { label: "Round", value: "3" },
    ]);
    expect(JSON.stringify(v)).not.toContain("4711");
    expect(JSON.stringify(v)).not.toContain("Press first");
    expect(v.world).toEqual([{ path: "Night.phase", value: '"y2k"' }]);
    // Rows off the lean view still carry their act (and no description).
    expect(cueRows(v.interactions, v.cues).map((r) => [r.act, r.description])).toEqual([["B · Act I", null], ["B · Act I", null]]);
    // A `while`-gated line's values come first: `Results read` during the
    // truth round beats the always-on first line.
    const gated = cueSheetView({
      world: [
        { path: "Night.clock", value: "23:30" },
        { path: "Night.results_q", value: "2" },
      ],
      watch: [
        { label: "Clock", path: "Night.clock", scope: "global" },
        { label: "Round", path: "Night.round", scope: "global" },
        { label: "Judge", path: "Night.judge_mode", scope: "global" },
        { label: "Results read", path: "Night.results_q", scope: "global", gated: true },
      ],
    });
    expect(gated.watch).toEqual([
      { label: "Results read", value: "2" },
      { label: "Clock", value: "23:30" },
      { label: "Round", value: "null" },
    ]);
    // Nothing to carry: no keys at all (an old server's view).
    const bare = cueSheetView({ interactions: [] });
    expect(Object.keys(bare).sort()).toEqual(["cues", "interactions", "roster", "world"]);
  });
});

describe("an `urgent: true` cue jumps the running order (w20b: 🕊 while a stand-down waits)", () => {
  type Ix = { id: string; label: string; who: string; live?: false; urgent?: true; sequence?: false };
  const ix = (id: string, extra: { live?: false; urgent?: true; sequence?: false } = {}): Ix => ({ id, label: id, who: "admin", ...extra });
  const next = (sheet: Ix[], last: string | null, fired: string[]) => cueRows(sheet, { last, fired }).find((r) => r.next)?.id ?? null;

  it("is NEXT while live and unfired, wherever LAST is; otherwise the sheet runs as before", () => {
    const sheet = [ix("bingo"), ix("hunt"), ix("y2k"), ix("urgent_cue", { urgent: true }), ix("reveal"), ix("bobbing")];
    expect(next(sheet, "bingo", ["bingo"])).toBe("urgent_cue"); // LAST before it
    expect(next(sheet, "reveal", ["bingo", "hunt", "y2k", "reveal"])).toBe("urgent_cue"); // LAST after it
    expect(cueRows(sheet, { last: "bingo", fired: ["bingo"] }).filter((r) => r.next)).toHaveLength(1);
    const idle = sheet.map((i) => (i.id === "urgent_cue" ? ix("urgent_cue", { urgent: true, live: false }) : i));
    expect(next(idle, "bingo", ["bingo"])).toBe("hunt");
    expect(next(sheet, "urgent_cue", ["bingo", "urgent_cue"])).toBe("reveal"); // fired: back to the order
    const aside = sheet.map((i) => (i.id === "urgent_cue" ? ix("urgent_cue", { urgent: true, sequence: false }) : i));
    expect(next(aside, "bingo", ["bingo"])).toBe("hunt"); // an aside is never NEXT
  });

  it("the lean view carries the flag", () => {
    const sheet = [ix("a"), ix("b", { urgent: true })];
    const lean = cueSheetView({ interactions: sheet }).interactions;
    expect(lean.find((i) => i.id === "b")).toMatchObject({ urgent: true });
    expect(lean.find((i) => i.id === "a")).not.toHaveProperty("urgent");
  });
});
