//! Wave 25: the house desk on an event (`server/desk.ts` through
//! `EventRuntime`): the routes and their refusals, the host allowlist and
//! unseen directors, the audio plays + the router's report feeding a run,
//! light / look steps as lights tests, `desk.json` as a project file, and a
//! small story the desk drives — `cue heart_reveal` starts the desk cue, its
//! event and `done` are journaled signals labelled `House desk`, the speech
//! step waits on the server-room terminal's `talk=` / `said=`, and a restart's
//! replay re-derives the same story without running the desk again.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { snapshotDiffers } from "../server/events-api.ts";
import { DESK_BY, deskMindsOf, deskOf, type DeskTimers } from "../server/desk.ts";
import type { SimModel } from "../src/runtime/sim/model.ts";
import type { AudioView } from "../server/audio.ts";
import type { LightsView } from "../server/lights.ts";
import type { MapFiles, ProjectLink } from "../server/house-maps.ts";
import { Store } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";
import { DESK_SPEECH_GRACE_MS, type DeskView } from "../src/house-desk.ts";

const FIX = join(import.meta.dirname, "..", "..", "house", "test", "fixtures");
const HOUSE_FILE = join(FIX, "lights-house.json");
const LIGHTS_TEXT = readFileSync(join(FIX, "lights-basic.json"), "utf8");
const AUDIO_TEXT = readFileSync(join(FIX, "audio-basic.json"), "utf8");
const CODES = { event: "EVTDSK", prime: "PRMDSK", mod: "MODDSK" };

const STORY = `# Desk
start: Boot

LOCATION The Server Room

LOCATION The Desktop

CHARACTER Trabolta

CHARACTER Task Manager
  admin: true
  when scanned by guest:
    reply ok

when heart_speaks:
  -> Heart Speaks

when heart_reveal_done:
  -> Heart Quiet

== Boot
cue heart_reveal
Hello.

== Heart Speaks
  setting: The Server Room
  cast: Trabolta
sound modem_handshake
Trabolta: I am awake.
Trabolta: Close the door.

== Heart Quiet
  setting: The Server Room
  cast: Trabolta
Trabolta: Good.
`;

const DESK = {
  version: 1,
  cues: [
    { id: "heart_reveal", name: "The Heart wakes", section: "The Heart", done: "heart_reveal_done", steps: [{ kind: "look", look: "heart_wake" }, { kind: "event", event: "heart_speaks", start: "with" }, { kind: "speech", room: "The Server Room", max: 30_000, start: "with" }] },
    { id: "hum", number: "2", name: "Hum", steps: [{ kind: "sound", sound: "modem_handshake", to: ["The Desktop"], gain: -6 }, { kind: "light", to: ["heart"], set: { state: "ON", color: "#ff0000" }, start: "with" }] },
    { id: "pa", name: "PA", steps: [{ kind: "say", text: "Testing the house speakers." }] },
  ],
};
const DESK_TEXT = JSON.stringify(DESK);

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-desk-rt-"));
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
    once() {},
  };
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, method: string, p: string, body: unknown = {}, o: { moderator?: boolean; token?: string; name?: string } = { moderator: true }) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, { moderator: o.moderator ?? false, ...(o.name !== undefined ? { moderatorName: o.name } : {}) });
  await Promise.resolve(); // the desk's poke after a terminal poll
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
const deskView = async (rt: EventRuntime, o?: { token?: string }): Promise<DeskView> =>
  (await call(rt, "GET", `/api/mod/desk${o?.token !== undefined ? `?token=${o.token}` : ""}`, {}, o?.token !== undefined ? { token: o.token } : { moderator: true, name: "Ada Director" })).json as unknown as DeskView;

/** A clock + timers advanced by hand (the desk's only). */
function fakeTime(start = 5_000_000) {
  let now = start;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: DeskTimers = {
    set(fn, ms) {
      const id = next++;
      pending.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clear(h) {
      pending.delete(h as number);
    },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      let first: [number, { at: number; fn: () => void }] | null = null;
      for (const e of pending) if (e[1].at <= until && (first === null || e[1].at < first[1].at)) first = e;
      if (first === null) break;
      pending.delete(first[0]);
      now = Math.max(now, first[1].at);
      first[1].fn();
    }
    now = until;
  };
  return { now: () => now, timers, advance, pending };
}

function fakeProject() {
  const files = new Map<string, string>();
  const snapshots: MapFiles[] = [];
  const link: ProjectLink = {
    projectId: "proj-d",
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

function runtime(o: { dir?: string; t?: ReturnType<typeof fakeTime>; desk?: string | null; project?: ProjectLink | null; source?: string; isPreview?: () => boolean } = {}): EventRuntime {
  const t = o.t ?? fakeTime();
  return new EventRuntime({
    eventId: "evt",
    store: new Store(o.dir ?? freshDir()),
    codes: CODES,
    scenarioName: "desk",
    scenarioSource: o.source ?? STORY,
    joinBase: () => "http://localhost",
    houseFile: HOUSE_FILE,
    audio: AUDIO_TEXT,
    audioFile: null,
    lights: LIGHTS_TEXT,
    lightsFile: null,
    deskFile: null,
    ...(o.desk !== undefined ? { desk: o.desk } : { desk: DESK_TEXT }),
    ...(o.project !== undefined ? { project: o.project } : {}),
    now: t.now,
    deskTimers: t.timers,
    ...(o.isPreview !== undefined ? { isPreview: o.isPreview } : {}),
  });
}

async function hostToken(rt: EventRuntime): Promise<string> {
  const r = await call(rt, "POST", "/api/prime/login", { character: "Task Manager", passcode: CODES.prime }, {});
  expect(r.json).toMatchObject({ host: true });
  return r.json["token"] as string;
}

/** The server-room terminal's poll (`room=`), with its speech report. */
const poll = (rt: EventRuntime, q: string) => call(rt, "GET", `/api/screen/state?name=heart&spot=server-room&view=room&character=Trabolta&room=The%20Server%20Room&after=-1&${q}`);

describe("GET /api/mod/desk", () => {
  it("needs a mod or host capability; carries the desk, the playhead, the house and no problems", async () => {
    const rt = runtime();
    expect((await call(rt, "GET", "/api/mod/desk", {}, {})).status).toBe(403);
    const v = await deskView(rt);
    expect(v).toMatchObject({ source: "project", standby: "heart_reveal", problems: [], live: false, runs: [], marks: {} });
    expect(v.desk.cues.map((c) => c.id)).toEqual(["heart_reveal", "hum", "pa"]);
    expect(v.house.looks.map((l) => l.name)).toContain("heart_wake");
    expect(v.house.rooms).toEqual(["The Server Room", "The Desktop"]);
    expect(v.house.events).toEqual(["heart_reveal_done", "heart_speaks"]);
    expect(v.house.sounds.map((s) => s.name)).toEqual(["modem_handshake"]);
    expect(v.house.lightTargets).toContain("heart");
    rt.dispose();
  });

  it("long-polls on rev: at once when it moved, else after the first change", async () => {
    const rt = runtime();
    const v = await deskView(rt);
    expect((await call(rt, "GET", `/api/mod/desk?after=${v.rev - 1}&wait=5`)).json["rev"]).toBe(v.rev);
    const parked = call(rt, "GET", `/api/mod/desk?after=${v.rev}&wait=5`);
    await new Promise((r) => setTimeout(r, 5));
    await call(rt, "POST", "/api/mod/desk/standby", { cue: "pa" });
    const got = (await parked).json as unknown as DeskView;
    expect(got.standby).toBe("pa");
    expect(got.rev).toBeGreaterThan(v.rev);
    rt.dispose();
  });
});

describe("the outside minds (wave 30)", () => {
  it("lists every mind: external character with the workers voicing it", () => {
    const model = { characters: new Map([["Trabolta", { id: "Trabolta", mind: "external" }], ["Clippy", { id: "Clippy", mind: null }], ["Echo", { id: "Echo", mind: "external" }]]) } as unknown as SimModel;
    const workers = [
      { name: "macbook", characters: ["trabolta"] },
      { name: "spare", characters: ["Trabolta", "Clippy"] },
    ];
    expect(deskMindsOf(model, workers)).toEqual([
      { character: "Trabolta", name: "Trabolta", online: true, workers: ["macbook", "spare"] },
      { character: "Echo", name: "Echo", online: false, workers: [] },
    ]);
    expect(deskMindsOf(null, workers)).toEqual([]);
  });

  it("rides the desk view (none in a story with no outside mind)", async () => {
    const rt = runtime();
    expect((await deskView(rt)).house.minds).toEqual([]);
    rt.dispose();
  });
});

describe("POST /api/mod/desk and the project file", () => {
  it("saves (400 problems, 409 stale), Save to project writes desk.json and the row snapshot, a restart keeps the save", async () => {
    const dir = freshDir();
    const p = fakeProject();
    const rt = runtime({ dir, project: p.link });
    const v = await deskView(rt);
    const bad = await call(rt, "POST", "/api/mod/desk", { desk: { version: 1, cues: [{ id: "heart_wake", name: "Clash", steps: [{ kind: "look", look: "ghost" }] }] } });
    expect(bad.status).toBe(400);
    expect((bad.json["problems"] as string[]).join("\n")).toMatch(/a lights look has this name too[\s\S]*no look ghost/u);
    const next = { ...DESK, cues: [...DESK.cues, { id: "quiet", name: "Quiet", steps: [{ kind: "event", event: "Heart_Speaks" }] }] };
    const ok = await call(rt, "POST", "/api/mod/desk", { desk: next, base: v.version });
    expect(ok.json).toMatchObject({ ok: true, source: "director", warnings: [] }); // `Heart_Speaks` folds to a `when` the story has
    expect((await call(rt, "POST", "/api/mod/desk", { desk: next, base: v.version })).json).toMatchObject({ error: "stale" });
    rt.dispose();
    const again = runtime({ dir, project: p.link });
    expect((await deskView(again)).source).toBe("director");
    const saved = await call(again, "POST", "/api/mod/desk/project");
    expect(saved.json).toMatchObject({ ok: true });
    expect(JSON.parse(p.files.get("desk.json")!)).toEqual(next);
    expect(deskOf(p.snapshots.at(-1))).toBe(p.files.get("desk.json"));
    expect((await deskView(again)).source).toBe("project");
    expect(snapshotDiffers({ "desk.json": "a" }, { "desk.json": "b" })).toBe(true);
    expect(snapshotDiffers({ "desk.json": "a" }, { "desk.json": "a" })).toBe(false);
    again.dispose();
    const none = runtime({ project: null });
    expect((await call(none, "POST", "/api/mod/desk/project")).json).toEqual({ error: "no project" });
    none.dispose();
  });

  it("/api/mod/load {desk} replaces the snapshot; an invalid one is refused", async () => {
    const rt = runtime({ desk: null });
    expect((await deskView(rt)).source).toBe("default");
    expect((await call(rt, "POST", "/api/mod/load", { source: STORY, name: "desk", desk: "{" })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/load", { source: STORY, name: "desk", desk: DESK_TEXT })).status).toBe(200);
    expect((await deskView(rt)).source).toBe("project");
    rt.dispose();
  });
});

describe("GO, standby, stop", () => {
  it("GO plays the cue: sound + light in parallel through the hubs, the playhead moves, a stale console is 409 moved", async () => {
    const t = fakeTime();
    const rt = runtime({ t });
    const go = await call(rt, "POST", "/api/mod/desk/go", { cue: "hum", standby: "heart_reveal" }, { moderator: true, name: "Ada Director" });
    expect(go.json).toMatchObject({ ok: true, standby: "pa" });
    expect(typeof go.json["run"]).toBe("number");
    const audio = (await call(rt, "GET", "/api/mod/audio")).json as unknown as AudioView;
    expect(audio.plays).toEqual([{ seq: 1, at: t.now(), by: "Ada Director", sound: "modem_handshake", to: ["The Desktop"], gain: -6 }]);
    const lights = (await call(rt, "GET", "/api/mod/lights")).json as unknown as LightsView;
    expect(lights.tests.map((x) => ({ fixture: x.fixture, set: x.set }))).toEqual([{ fixture: "server-room-rgb", set: { state: "ON", color: "#ff0000" } }]);
    expect((await call(rt, "POST", "/api/mod/desk/go", { standby: "heart_reveal" })).json).toEqual({ error: "moved", standby: "pa" });
    expect((await call(rt, "POST", "/api/mod/desk/go", { cue: "ghost" })).status).toBe(404);
    // The router answers with the sound's length; the run ends then.
    expect((await call(rt, "POST", "/api/mod/audio/report", { acks: [{ seq: 1, kind: "play", result: "played", ms: 1200 }] })).json).toEqual({ ok: true });
    t.advance(1200);
    const v = await deskView(rt);
    expect(v.runs[0]).toMatchObject({ cue: "hum", state: "done", by: "Ada Director", source: "desk" });
    expect(v.runs[0]!.steps[0]!.result).toBe("played");
    expect(v.recent.find((a) => a.kind === "play")).toMatchObject({ result: "played", by: "Ada Director" });
    await call(rt, "POST", "/api/mod/desk/standby", { cue: null });
    expect((await call(rt, "POST", "/api/mod/desk/go", {})).json).toEqual({ error: "end", standby: null });
    rt.dispose();
  });

  it("stop one run; the panic stops every run and the house sounds", async () => {
    const t = fakeTime();
    const rt = runtime({ t });
    const r = (await call(rt, "POST", "/api/mod/desk/go", { cue: "pa" })).json["run"] as number;
    expect((await call(rt, "POST", "/api/mod/desk/stop", { run: r })).json).toEqual({ ok: true, stopped: 1 });
    await call(rt, "POST", "/api/mod/desk/go", { cue: "hum" });
    expect((await call(rt, "POST", "/api/mod/desk/stop", { all: true, announce: true })).json).toEqual({ ok: true, stopped: 1 });
    const audio = (await call(rt, "GET", "/api/mod/audio")).json as unknown as AudioView;
    expect(audio.stops.at(-1)).toMatchObject({ announce: true });
    expect((await call(rt, "POST", "/api/mod/desk/stop", {})).status).toBe(400);
    rt.dispose();
  });
});

describe("the router's plays and report", () => {
  it("POST /api/mod/audio/play validates; plays ride the GET with a plays= cursor; health feeds the desk's sounds", async () => {
    const t = fakeTime();
    const rt = runtime({ t });
    expect((await call(rt, "POST", "/api/mod/audio/play", {})).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/audio/play", { sound: "a b" })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/audio/play", { say: "x".repeat(281) })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/audio/play", { sound: "zip", gain: 13 })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/audio/play", { sound: "zip", to: [] })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/audio/play", { sound: "zip", say: "hi" })).status).toBe(400);
    const p = await call(rt, "POST", "/api/mod/audio/play", { say: "Testing the house speakers.", chime: false });
    expect(p.json).toMatchObject({ ok: true, seq: 1, router: { online: false } });
    const a = (await call(rt, "GET", "/api/mod/audio")).json as unknown as AudioView;
    expect(a.plays).toEqual([{ seq: 1, at: t.now(), by: "Director", say: "Testing the house speakers.", to: null, gain: null, chime: false }]);
    // A long poll past the newest play waits; one behind answers at once.
    expect((await call(rt, "GET", `/api/mod/audio?after=${a.version}&plays=0&wait=5`)).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/audio/report", { acks: [{ seq: 1, kind: "nope", result: "played" }] })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/audio/report", { health: { ok: "yes" } })).status).toBe(400);
    const health = { ok: true, device: "MOTU 828x", layout: "ok", voices: 2, xruns: 0, peakDb: -12, announce: "on", missing: [], placeholders: [], sounds: { modem_handshake: 4100, zip: 300 } };
    expect((await call(rt, "POST", "/api/mod/audio/report", { health })).json).toEqual({ ok: true });
    const v = await deskView(rt);
    expect(v.house.health).toMatchObject({ ok: true, device: "MOTU 828x", files: 2, at: t.now() });
    expect(v.house.sounds).toMatchObject([{ name: "modem_handshake", file: "ok", ms: 4100 }]);
    // A story sound the router has no file for reads missing (judged off `sounds`, not `missing`).
    await call(rt, "POST", "/api/mod/audio/report", { health: { ...health, sounds: { zip: 300 } } });
    expect((await deskView(rt)).house.sounds[0]).toMatchObject({ file: "missing", ms: null });
    expect(v.house.router.online).toBe(true); // a report is the router being there
    expect(v.recent[0]).toMatchObject({ kind: "say" });
    rt.dispose();
  });
});

describe("hosts and unseen directors", () => {
  it("a host's booth reads the desk, GOes, stops and marks; never saves, saves to project, resets marks or reports", async () => {
    const t = fakeTime();
    const rt = runtime({ t, project: fakeProject().link });
    // A director pressed GO and marked a check by name.
    await call(rt, "POST", "/api/mod/desk/go", { cue: "pa" }, { moderator: true, name: "Ada Director" });
    const director = await deskView(rt);
    const key = "fixture:server-room-rgb";
    expect((await call(rt, "POST", "/api/mod/desk/check", { key, mark: "ok" }, { moderator: true, name: "Ada Director" })).json).toEqual({ ok: true });
    expect((await call(rt, "POST", "/api/mod/desk/check", { key: "fixture:ghost", mark: "ok" })).status).toBe(404);
    expect(director.runs[0]!.by).toBe("Ada Director");

    const token = await hostToken(rt);
    const hv = await deskView(rt, { token });
    expect(hv.runs[0]!.by).toBe("Director");
    expect(hv.marks[key]!.by).toBe("Director");
    expect(hv.recent.every((a) => a.by === "Director" || a.by === "Task Manager" || a.by === DESK_BY || a.by === "the story")).toBe(true);
    expect(JSON.stringify(hv)).not.toContain("Ada Director");

    const as = { token };
    expect((await call(rt, "POST", "/api/mod/desk/go", { cue: "hum", token }, as)).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/desk/standby", { cue: "pa", token }, as)).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/desk/stop", { all: true, token }, as)).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/desk/check", { key, mark: "bad", token }, as)).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/audio/play", { sound: "zip", token }, as)).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/lights/test", { fixture: "server-room-rgb", token }, as)).status).toBe(200);
    for (const [path, body] of [
      ["/api/mod/desk", { desk: DESK }],
      ["/api/mod/desk/project", {}],
      ["/api/mod/desk/check/reset", {}],
      ["/api/mod/lights/pair", { seconds: 10 }],
      ["/api/mod/audio/report", { acks: [] }],
    ] as const) {
      expect((await call(rt, "POST", path, { ...body, token }, as)).json, path).toEqual({ error: "not from a booth" });
    }
    const after = await deskView(rt, { token });
    expect(after.marks[key]).toMatchObject({ mark: "bad", by: "Task Manager" });
    expect(after.runs.find((r) => r.cue === "hum")!.by).toBe("Task Manager");
    rt.dispose();
  });
});

describe("live: when a test asks first", () => {
  it("a live event once its doors open; never a shared rehearsal (setup days test freely), until it goes live in place", async () => {
    let preview = true;
    const rt = runtime({ isPreview: () => preview });
    expect((await deskView(rt)).live).toBe(false);
    rt.openDoors();
    expect((await deskView(rt)).live).toBe(false);
    preview = false;
    expect((await deskView(rt)).live).toBe(true);
  });
});

describe("the story and the desk", () => {
  it("cue heart_reveal starts the desk cue live; its events journal as House desk; the speech step waits on the terminal; a replay re-derives the story and runs nothing", async () => {
    const dir = freshDir();
    const t = fakeTime();
    const rt = runtime({ dir, t });
    // The server-room terminal is up (it reports talk= / said=).
    await poll(rt, "talk=0&said=-1");
    rt.openDoors();
    // The Boot beat's `cue heart_reveal` starts the run on the next turn.
    expect((await deskView(rt)).runs).toEqual([]);
    t.advance(0);
    let v = await deskView(rt);
    expect(v.live).toBe(true);
    expect(v.runs[0]).toMatchObject({ cue: "heart_reveal", by: "the story", source: "story", state: "running" });
    expect(v.runs[0]!.steps.map((s) => s.result)).toEqual(["lights away", "fired", undefined]);
    // The look went to the lights module as a test.
    const lights = (await call(rt, "GET", "/api/mod/lights")).json as unknown as LightsView;
    expect(lights.tests.map((x) => x.look)).toEqual(["heart_wake"]);
    const journal = new Store(dir).readJournal();
    const signals = journal.filter((e) => e.m === "signal");
    expect(signals.map((e) => [e.a[0], e.by])).toEqual([["heart_speaks", "House desk"]]);

    // His lines reach the terminal; it is speaking.
    const lines = ((await poll(rt, "talk=1&said=-1")).json["voice"] as { lines: Array<{ seq: number; text: string }> }).lines;
    expect(lines.map((l) => l.text)).toEqual(["I am awake.", "Close the door."]);
    t.advance(DESK_SPEECH_GRACE_MS);
    await poll(rt, `talk=1&said=${lines[0]!.seq}`);
    expect((await deskView(rt)).runs[0]!.state).toBe("running");
    // Quiet, but not past the last line: still waiting.
    await poll(rt, `talk=0&said=${lines[0]!.seq}`);
    expect((await deskView(rt)).runs[0]!.state).toBe("running");
    await poll(rt, `talk=0&said=${lines[1]!.seq}`);
    v = await deskView(rt);
    expect(v.runs[0]!.steps[2]).toMatchObject({ state: "ended", result: "said" });
    // The look (5.4 s, planned) still runs: the cue ends with it, then `done`.
    expect(v.runs[0]!.state).toBe("running");
    expect(new Store(dir).readJournal().filter((e) => e.m === "signal").length).toBe(1);
    t.advance(5400);
    v = await deskView(rt);
    expect(v.runs[0]).toMatchObject({ state: "done" });
    const after = new Store(dir).readJournal().filter((e) => e.m === "signal");
    expect(after.map((e) => [e.a[0], e.by])).toEqual([
      ["heart_speaks", "House desk"],
      ["heart_reveal_done", "House desk"],
    ]);
    const story = ((await poll(rt, "talk=0&said=-1")).json["voice"] as { lines: Array<{ seq: number; text: string }> }).lines;
    expect(story.map((l) => l.text)).toEqual(["I am awake.", "Close the door.", "Good."]);
    rt.dispose();

    // A restart replays the journal: the same story, and the desk plays nothing.
    const t2 = fakeTime(t.now() + 60_000);
    const again = runtime({ dir, t: t2 });
    expect(again.restore()).not.toBeNull();
    t2.advance(60_000);
    expect(t2.pending.size).toBe(0);
    const replayed = ((await poll(again, "talk=0&said=-1")).json["voice"] as { lines: Array<{ seq: number; text: string }> }).lines;
    expect(replayed).toEqual(story);
    expect((await deskView(again)).runs).toEqual([]);
    expect((await call(again, "GET", "/api/mod/lights")).json["tests"]).toEqual([]);
    expect(new Store(dir).readJournal().filter((e) => e.m === "signal").length).toBe(2);
    again.dispose();
  });

  it("with no terminal speaking the room the speech step ends at once", async () => {
    const t = fakeTime();
    const rt = runtime({ t });
    rt.openDoors();
    t.advance(0);
    const v = await deskView(rt);
    expect(v.runs[0]!.steps[2]).toMatchObject({ state: "ended", result: "no terminal" });
    rt.dispose();
  });

  it("a GO by hand fires the same events (a rehearsal), journaled as House desk", async () => {
    const dir = freshDir();
    const t = fakeTime();
    const rt = runtime({ dir, t, source: STORY.replace("cue heart_reveal\n", "") });
    rt.openDoors();
    await call(rt, "POST", "/api/mod/desk/go", { cue: "heart_reveal" });
    t.advance(5400);
    expect(new Store(dir).readJournal().filter((e) => e.m === "signal").map((e) => [e.a[0], e.by])).toEqual([
      ["heart_speaks", "House desk"],
      ["heart_reveal_done", "House desk"],
    ]);
    rt.dispose();
  });
});

describe("the show's starter desk.json", () => {
  it("validates against the show (no problems) and fires no story event", async () => {
    const SHOW = "trapped-in-the-internet";
    const dir = join(import.meta.dirname, "..", "examples", SHOW);
    const rt = new EventRuntime({
      eventId: "evt",
      store: new Store(freshDir()),
      codes: CODES,
      scenarioName: SHOW,
      scenarioSource: scenarioSource(SHOW),
      joinBase: () => "http://localhost",
      houseFile: join(dir, "house.json"),
      audio: readFileSync(join(dir, "audio.json"), "utf8"),
      lights: readFileSync(join(dir, "lights.json"), "utf8"),
      desk: readFileSync(join(dir, "desk.json"), "utf8"),
      audioFile: null,
      lightsFile: null,
      deskFile: null,
    });
    const v = await deskView(rt);
    expect(v.problems).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(v.desk.note).toMatch(/DRAFT wave 25/u);
    expect(v.desk.cues.every((c) => c.done === undefined && c.steps.every((s) => s.kind !== "event" && s.kind !== "speech"))).toBe(true);
    rt.dispose();
  });
});

describe("isHostRoute (wave 25)", () => {
  it("lists the desk's host routes and nothing else of it", async () => {
    const { isHostRoute } = await import("../server/routes/host.ts");
    const ctx = { alertsPath: "Night.alerts", isAgent: () => false };
    expect(isHostRoute("GET", "/api/mod/desk", {}, ctx)).toBe(true);
    for (const p of ["/api/mod/desk/go", "/api/mod/desk/standby", "/api/mod/desk/stop", "/api/mod/desk/check", "/api/mod/audio/play", "/api/mod/audio/test", "/api/mod/lights/test"]) expect(isHostRoute("POST", p, {}, ctx), p).toBe(true);
    for (const p of ["/api/mod/desk", "/api/mod/desk/project", "/api/mod/desk/check/reset", "/api/mod/lights/pair", "/api/mod/audio/report", "/api/mod/lights", "/api/mod/audio"]) expect(isHostRoute("POST", p, {}, ctx), p).toBe(false);
    expect(isHostRoute("GET", "/api/mod/lights", {}, ctx)).toBe(false);
  });
});

describe("the terminals' speech report (§5)", () => {
  it("parses talk= / said= (said=-1 valid, junk dropped)", async () => {
    const { screenDeviceOf } = await import("../server/routes/screen.ts");
    const q = (o: Record<string, string>) => (k: string) => o[k] ?? "";
    expect(screenDeviceOf(q({ talk: "1", said: "42" }))).toMatchObject({ talk: true, said: 42 });
    expect(screenDeviceOf(q({ talk: "0", said: "-1" }))).toMatchObject({ talk: false, said: -1 });
    const junk = screenDeviceOf(q({ talk: "yes", said: "-2" }));
    expect(junk.talk).toBeUndefined();
    expect(junk.said).toBeUndefined();
  });

  it("a poll with no said counts on talk=0 alone; a terminal that never reports talk= can't hold the step", async () => {
    const { ScreenWatch, speechWatchOf } = await import("../server/routes/screen.ts");
    const { Sim } = await import("../src/runtime/sim/index.ts");
    let now = 1_000;
    const watch = new ScreenWatch({ now: () => now });
    const model = Sim.fromSources("# T\n\nLOCATION The Server Room\n\nCHARACTER Trabolta\n\n== Boot\nHi.\n").model;
    const at = (name: string, device: Record<string, unknown>) => watch.poll(null, { name, spot: "", view: "room", character: "Trabolta", room: "The Server Room", after: null, device }, () => false, [], model);
    at("old", {}); // a build before wave 25
    expect(speechWatchOf(watch, model, "The Server Room", now, [], 1500)).toBeNull();
    at("new", { talk: true });
    const w = speechWatchOf(watch, model, "The Server Room", now, [], 1500)!;
    now += 1500;
    expect(w.done(now)).toBeNull();
    at("new", { talk: false });
    expect(w.done(now)).toBe("said");
    now += 7000; // it went away
    expect(w.done(now)).toBe("no terminal");
  });
});
