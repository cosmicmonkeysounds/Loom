//! Wave 17: the house speakers' config on an event (`server/audio.ts`): what
//! is in force (a director's save > the project's snapshot > `LOOM_AUDIO` >
//! the default), `GET /api/mod/audio` with the story's sounds and LOCATIONs,
//! the director's save (400 problems, 409 on a stale base), Save to project,
//! speaker / output tests, and the long poll stagehand's router holds.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { AUDIO_CHIME_SOUND, resolveTargets, validateAudio, type AudioConfig } from "@loom/house";

import { EventRuntime } from "../server/event-runtime.ts";
import { snapshotDiffers } from "../server/events-api.ts";
import { AUDIO_ROUTER_ONLINE_MS, AUDIO_STOP_MS, AUDIO_TEST_MS, audioFileOf, audioOf, storySounds, type AudioView } from "../server/audio.ts";
import type { MapFiles, ProjectLink } from "../server/house-maps.ts";
import { Store } from "../server/store.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";

const HOUSE_FILE = join(import.meta.dirname, "..", "..", "house", "test", "fixtures", "audio-house.json");
const AUDIO_TEXT = readFileSync(join(import.meta.dirname, "..", "..", "house", "test", "fixtures", "audio-basic.json"), "utf8");
const AUDIO = JSON.parse(AUDIO_TEXT) as AudioConfig;
const SHOW_AUDIO = join(import.meta.dirname, "..", "examples", "trapped-in-the-internet", "audio.json");
const CODES = { event: "EVTAUD", prime: "PRMAUD", mod: "MODAUD" };
const STORY = `# T\n\nLOCATION The Desktop\n\nLOCATION The Tube\n\nCHARACTER Task Manager\n  admin: true\n  when scanned by guest:\n    reply ok\n\nwhen print:\n  sound printer_grind in The Desktop\n\n== Boot\n  setting: The Desktop\nsound modem_handshake\n<sfx: zip, rooms: hall>\nHello.\n`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-audio-"));
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
  };
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, method: string, p: string, body: unknown = {}, o: { moderator?: boolean; token?: string } = { moderator: true }) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, { moderator: o.moderator ?? false });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
const view = async (rt: EventRuntime, q = ""): Promise<AudioView> => (await call(rt, "GET", `/api/mod/audio${q}`)).json as unknown as AudioView;

function fakeProject() {
  const files = new Map<string, string>();
  const snapshots: MapFiles[] = [];
  const link: ProjectLink = {
    projectId: "proj-a",
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

function runtime(o: { dir?: string; audio?: string | null; audioFile?: string | null; project?: ProjectLink | null; now?: () => number } = {}): EventRuntime {
  return new EventRuntime({
    eventId: "evt",
    store: new Store(o.dir ?? freshDir()),
    codes: CODES,
    scenarioName: "t",
    scenarioSource: STORY,
    joinBase: () => "http://localhost",
    houseFile: HOUSE_FILE,
    audioFile: o.audioFile ?? null,
    ...(o.audio !== undefined ? { audio: o.audio } : {}),
    ...(o.project !== undefined ? { project: o.project } : {}),
    ...(o.now !== undefined ? { now: o.now } : {}),
  });
}

describe("the starter audio.json (Trapped in the Internet)", () => {
  it("validates on both map variants and names every sound the show plays", () => {
    const text = readFileSync(SHOW_AUDIO, "utf8");
    const audio = JSON.parse(text) as AudioConfig;
    expect(audio.note).toMatch(/DRAFT/u);
    const dir = join(import.meta.dirname, "..", "examples", "trapped-in-the-internet");
    for (const map of ["house.json", "house.shed.json"]) {
      const house = JSON.parse(readFileSync(join(dir, map), "utf8"));
      expect(validateAudio(audio, house).problems).toEqual([]);
    }
    expect(audio.device).toMatchObject({ name: "MOTU", inputs: 16, outputs: 16 });
    expect(audio.outputs).toHaveLength(16);
    expect(audio.inputs).toHaveLength(16);
    expect(audio.zones.map((z) => z.id)).toEqual(["living"]);
    // Every `sound X` in the show has a cue (but the chime, rung with the
    // announcements: LA-2), and every cue is a show sound.
    const sounds = storySounds(Sim.fromSources(scenarioSource("trapped-in-the-internet")).model);
    expect(sounds.length).toBeGreaterThanOrEqual(20);
    expect(Object.keys(audio.cues).sort()).toEqual(sounds.filter((s) => s !== AUDIO_CHIME_SOUND));
    // Every cue reaches a wired speaker on both maps: the router skips one
    // that reaches none (no fall back to the setting), so the arrival's
    // modem must have its own (LA-1).
    for (const map of ["house.json", "house.shed.json"]) {
      const house = JSON.parse(readFileSync(join(dir, map), "utf8"));
      for (const [name, cue] of Object.entries(audio.cues)) expect(resolveTargets(audio, house, cue.to).outputs.length, `${map} ${name}`).toBeGreaterThan(0);
      expect(validateAudio(audio, house).warnings.filter((w) => w.includes("reaches no speaker"))).toEqual([]);
    }
  });

  it("a cue keyed on the announcement chime is warned about: the router rings it with the announcements", () => {
    const audio = JSON.parse(readFileSync(SHOW_AUDIO, "utf8")) as AudioConfig;
    const keyed = { ...audio, cues: { ...audio.cues, [AUDIO_CHIME_SOUND]: { to: ["living"] } } };
    expect(validateAudio(keyed).warnings.some((w) => w.includes(AUDIO_CHIME_SOUND) && w.includes("announce.to"))).toBe(true);
    expect(validateAudio(audio).warnings.some((w) => w.includes(AUDIO_CHIME_SOUND))).toBe(false);
  });
});

describe("storySounds", () => {
  it("lists every sfx name the compiled story uses, sorted", () => {
    expect(storySounds(Sim.fromSources(STORY).model)).toEqual(["modem_handshake", "printer_grind", "zip"]);
    expect(storySounds(null)).toEqual([]);
  });
});

describe("GET /api/mod/audio", () => {
  it("needs the mod capability; a fresh event plays the default", async () => {
    const rt = runtime();
    expect((await call(rt, "GET", "/api/mod/audio", {}, {})).status).toBe(403);
    const v = await view(rt);
    expect(v.source).toBe("default");
    expect(v.version).toMatch(/^[0-9a-f]{8}$/u);
    expect(v.audio.device).toMatchObject({ inputs: 16, outputs: 16 });
    expect(v.sounds).toEqual(["modem_handshake", "printer_grind", "zip"]);
    expect(v.locations).toEqual(["The Desktop", "The Tube"]);
    expect(v.tests).toEqual([]);
    rt.dispose();
  });

  it("the project's snapshot, then LOOM_AUDIO; a broken project file falls through", async () => {
    const dir = freshDir();
    const env = join(dir, "env-audio.json");
    writeFileSync(env, JSON.stringify({ ...AUDIO, note: "env" }));
    const withEnv = runtime({ audioFile: env });
    expect((await view(withEnv)).source).toBe("env");
    withEnv.dispose();
    const project = runtime({ audio: AUDIO_TEXT, audioFile: env });
    const v = await view(project);
    expect(v.source).toBe("project");
    expect(v.audio.speakers.map((s) => s.id)).toContain("studio");
    expect(v.warnings).toEqual(["output 5 feeds 2 speakers (down-hall, studio)"]);
    project.dispose();
    expect((await view(runtime({ audio: "{ nope", audioFile: env }))).source).toBe("env");
  });
});

describe("POST /api/mod/audio — the director's save", () => {
  it("validates against the house in force (400 problems), saves, and wins over the project", async () => {
    const dir = freshDir();
    const rt = runtime({ dir, audio: AUDIO_TEXT });
    const before = await view(rt);
    const bad = structuredClone(AUDIO);
    bad.speakers[0]!.room = "attic";
    const r400 = await call(rt, "POST", "/api/mod/audio", { audio: bad, base: before.version });
    expect(r400.status).toBe(400);
    expect(r400.json["problems"]).toEqual(['speakers[0] "living-l": unknown room "attic"']);
    const next = structuredClone(AUDIO);
    next.speakers[0]!.gain = -6;
    const ok = await call(rt, "POST", "/api/mod/audio", { audio: next, base: before.version });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ ok: true, source: "director" });
    const after = await view(rt);
    expect(after).toMatchObject({ source: "director", version: ok.json["version"] });
    expect(after.version).not.toBe(before.version);
    // A stale base is refused with the version in force.
    const stale = await call(rt, "POST", "/api/mod/audio", { audio: AUDIO, base: before.version });
    expect(stale.status).toBe(409);
    expect(stale.json["version"]).toBe(after.version);
    rt.dispose();
    // A restart keeps the director's save over the project's snapshot.
    const again = runtime({ dir, audio: AUDIO_TEXT });
    expect(await view(again)).toMatchObject({ source: "director", version: after.version });
    again.dispose();
  });

  it("Save to project writes audio.json, records the snapshot, drops the save; no project → 409", async () => {
    const p = fakeProject();
    const rt = runtime({ project: p.link });
    expect((await call(rt, "POST", "/api/mod/audio", { audio: AUDIO })).status).toBe(200);
    const saved = await view(rt);
    const r = await call(rt, "POST", "/api/mod/audio/project");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, file: "audio.json", source: "project", version: saved.version });
    expect(JSON.parse(p.files.get("audio.json")!)).toEqual(AUDIO);
    expect(audioOf(p.snapshots.at(-1))).toBe(p.files.get("audio.json"));
    expect(await view(rt)).toMatchObject({ source: "project", version: saved.version });
    rt.dispose();
    const lone = runtime({ project: null });
    expect((await call(lone, "POST", "/api/mod/audio/project")).status).toBe(409);
    lone.dispose();
  });

  it("/api/mod/load {audio} takes a fresh snapshot (400 on a broken one)", async () => {
    const rt = runtime();
    const bad = await call(rt, "POST", "/api/mod/load", { audio: JSON.stringify({ version: 2 }) });
    expect(bad.status).toBe(400);
    expect(bad.json["error"]).toBe("invalid audio.json");
    expect((await call(rt, "POST", "/api/mod/load", { audio: AUDIO_TEXT })).status).toBe(200);
    expect((await view(rt)).source).toBe("project");
    expect((await call(rt, "POST", "/api/mod/load", { audio: null })).status).toBe(200);
    expect((await view(rt)).source).toBe("default");
    rt.dispose();
  });

  it("an audio.json edit makes the event's snapshot stale (Push draft picks it up)", () => {
    const maps = { "house.json": "{}" };
    expect(snapshotDiffers({ ...maps, "audio.json": AUDIO_TEXT }, { ...maps, "audio.json": AUDIO_TEXT })).toBe(false);
    expect(snapshotDiffers({ ...maps, "audio.json": AUDIO_TEXT }, maps)).toBe(true);
    expect(snapshotDiffers(maps, { ...maps, "audio.json": AUDIO_TEXT })).toBe(true);
  });

  it("audioFileOf reads a project's file list (an empty file is none)", () => {
    expect(audioFileOf([{ path: "main.loom", content: "x" }, { path: "audio.json", content: AUDIO_TEXT }])).toBe(AUDIO_TEXT);
    expect(audioFileOf([{ path: "audio.json", content: "  " }])).toBeNull();
    expect(audioFileOf([{ path: "house.audio.json", content: AUDIO_TEXT }])).toBeNull();
  });
});

describe("POST /api/mod/audio/test", () => {
  it("exactly one of speaker / out; an unknown speaker 404s; recent tests ride the GET for 60 s", async () => {
    let t = 1_000_000;
    const rt = runtime({ audio: AUDIO_TEXT, now: () => t });
    expect((await call(rt, "POST", "/api/mod/audio/test", {})).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/audio/test", { speaker: "hall", out: 4 })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/audio/test", { input: 3 })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/audio/test", { speaker: "ghost" })).status).toBe(404);
    expect((await call(rt, "POST", "/api/mod/audio/test", { out: 17 })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/audio/test", { out: 2.5 })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/audio/test", { speaker: "hall" }, {})).status).toBe(403);
    const a = await call(rt, "POST", "/api/mod/audio/test", { speaker: "hall" });
    expect(a.json).toMatchObject({ ok: true, seq: 1, router: { online: false, lastSeen: null } });
    t += 1000;
    const b = await call(rt, "POST", "/api/mod/audio/test", { out: 16 });
    expect(b.json).toMatchObject({ ok: true, seq: 2 });
    expect((await view(rt)).tests).toEqual([
      { seq: 1, at: 1_000_000, speaker: "hall", out: null },
      { seq: 2, at: 1_001_000, speaker: null, out: 16 },
    ]);
    t += AUDIO_TEST_MS;
    expect((await view(rt)).tests.map((x) => x.seq)).toEqual([2]);
    rt.dispose();
  });
});

describe("is the router listening? (LA-4)", () => {
  it("a router=1 poll marks it online; the editor's own long poll never does; it lapses after the window", async () => {
    let t = 5_000_000;
    const rt = runtime({ audio: AUDIO_TEXT, now: () => t });
    const v = await view(rt, `?after=nope&wait=0`); // the map editor's poll
    expect(v.router).toEqual({ online: false, lastSeen: null, name: null });
    await view(rt, `?after=nope&wait=0&router=1&name=house-mac`);
    expect((await view(rt)).router).toEqual({ online: true, lastSeen: t, name: "house-mac" });
    expect((await call(rt, "POST", "/api/mod/audio/test", { speaker: "hall" })).json["router"]).toMatchObject({ online: true });
    t += AUDIO_ROUTER_ONLINE_MS + 1;
    expect((await view(rt)).router.online).toBe(false);
    // Parked on a long poll: online however long it waits.
    const parked = view(rt, `?after=${v.version}&tests=99&wait=5&router=1`);
    await new Promise((r) => setTimeout(r, 20));
    t += AUDIO_ROUTER_ONLINE_MS * 3;
    expect((await view(rt)).router.online).toBe(true);
    await call(rt, "POST", "/api/mod/audio/test", { speaker: "hall" });
    await parked;
    rt.dispose();
  });
});

describe("the long poll (stagehand's router)", () => {
  it("answers at once on a version it doesn't hold; else waits for a save, a test, or the timeout", async () => {
    const rt = runtime({ audio: AUDIO_TEXT });
    const v = await view(rt);
    // An old version: at once.
    const t0 = Date.now();
    expect((await view(rt, "?after=deadbeef&wait=5")).version).toBe(v.version);
    expect(Date.now() - t0).toBeLessThan(1000);
    // Nothing new: the timeout answers the same config.
    const quiet = await view(rt, `?after=${v.version}&wait=0.05`);
    expect(quiet.version).toBe(v.version);
    // A test wakes a parked poll that asked for tests after 0.
    const parked = view(rt, `?after=${v.version}&tests=0&wait=5`);
    await new Promise((r) => setTimeout(r, 20));
    expect(rt.audio.waiting).toBe(1);
    await call(rt, "POST", "/api/mod/audio/test", { speaker: "studio" });
    const woke = await parked;
    expect(woke.tests.map((x) => x.speaker)).toEqual(["studio"]);
    expect(rt.audio.waiting).toBe(0);
    // A pending test newer than `tests` answers at once; one already seen waits.
    const t1 = Date.now();
    expect((await view(rt, `?after=${v.version}&tests=0&wait=5`)).tests).toHaveLength(1);
    expect(Date.now() - t1).toBeLessThan(1000);
    // A save wakes a poll that only watches the version.
    const watching = view(rt, `?after=${v.version}&tests=1&wait=5`);
    await new Promise((r) => setTimeout(r, 20));
    const next = structuredClone(AUDIO);
    next.zones.push({ id: "upstairs", name: "Upstairs", speakers: [] });
    expect((await call(rt, "POST", "/api/mod/audio", { audio: next, base: v.version })).status).toBe(200);
    const moved = await watching;
    expect(moved.version).not.toBe(v.version);
    expect(moved.source).toBe("director");
    rt.dispose();
  });
});

describe("stop all house sounds (wave 18b, Q7)", () => {
  it("POST /api/mod/audio/stop → its own seq + the router; 400 on a bad body; recent stops ride the GET with now", async () => {
    let t = 2_000_000;
    const rt = runtime({ audio: AUDIO_TEXT, now: () => t });
    expect((await call(rt, "POST", "/api/mod/audio/stop", { announce: "yes" })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/audio/stop", {}, {})).status).toBe(403);
    const a = await call(rt, "POST", "/api/mod/audio/stop", {});
    expect(a).toMatchObject({ status: 200, json: { ok: true, seq: 1, router: { online: false } } });
    t += 1000;
    expect((await call(rt, "POST", "/api/mod/audio/stop", { announce: true })).json["seq"]).toBe(2);
    const v = await view(rt);
    expect(v.stops.map((x) => [x.seq, x.at, x.announce])).toEqual([
      [1, 2_000_000, false],
      [2, 2_001_000, true],
    ]);
    expect(v.now).toBe(2_001_000);
    expect(v.tests).toEqual([]); // a stop is never a test
    t += AUDIO_STOP_MS;
    expect((await view(rt)).stops.map((x) => x.seq)).toEqual([2]);
    rt.dispose();
  });

  it("a long poll given stops= wakes on a newer stop; one watching only tests= does not", async () => {
    const rt = runtime({ audio: AUDIO_TEXT });
    const v = await view(rt);
    const testsOnly = view(rt, `?after=${v.version}&tests=0&wait=0.3`);
    const parked = view(rt, `?after=${v.version}&tests=0&stops=0&wait=5`);
    await new Promise((r) => setTimeout(r, 20));
    expect(rt.audio.waiting).toBe(2);
    await call(rt, "POST", "/api/mod/audio/stop", {});
    // The wake answers every parked poll; the tests-only one answers the same config.
    const woke = await parked;
    expect(woke.stops.map((x) => x.seq)).toEqual([1]);
    await testsOnly;
    // A stop already seen waits; a newer one answers at once.
    const t0 = Date.now();
    expect((await view(rt, `?after=${v.version}&stops=0&wait=5`)).stops).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(1000);
    const seen = view(rt, `?after=${v.version}&stops=1&wait=0.05`);
    expect((await seen).stops).toHaveLength(1);
    rt.dispose();
  });

  it("a host's booth may stop them, never save the speakers", async () => {
    const rt = runtime({ audio: AUDIO_TEXT });
    const r = await call(rt, "POST", "/api/prime/login", { character: "Task Manager", passcode: CODES.prime }, {});
    expect(r.json).toMatchObject({ host: true });
    const token = r.json["token"] as string;
    expect((await call(rt, "POST", "/api/mod/audio/stop", { token }, { token })).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/audio", { audio: AUDIO, token }, { token })).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/audio/test", { speaker: "hall", token }, { token })).status).toBe(403);
    expect((await view(rt)).stops[0]!.by).toBe("Booth · Task Manager");
    rt.dispose();
  });

  it("Q8: the screen state answers a spot's house setting; the heartbeat records the tablet's own", async () => {
    const rt = runtime({ audio: JSON.stringify({ ...AUDIO, announce: { to: ["everywhere"], terminals: ["hall-tablet"] } }) });
    const poll = async (q: string) => (await call(rt, "GET", `/api/screen/state?${q}`)).json as { spot?: { announce: boolean } };
    expect((await poll("name=Hall&spot=hall-tablet&view=auto&ann=1")).spot).toEqual({ announce: true });
    expect((await poll("name=Den&spot=den&view=auto&ann=0")).spot).toEqual({ announce: false });
    expect((await poll("name=Loose&view=auto")).spot).toBeUndefined();
    const list = (await call(rt, "GET", "/api/mod/screen/terminals")).json as { terminals: Array<{ name: string; announce?: boolean }> };
    expect(Object.fromEntries(list.terminals.map((x) => [x.name, x.announce]))).toEqual({ Hall: true, Den: false, Loose: undefined });
    rt.dispose();
  });
});
