//! Wave 40 (contract docs/loom-w40-contract.md C2): the house mixer on the
//! event server (`server/audio.ts`). The mix kept in the state dir (its seq
//! too, across a restart), the soundtrack's one-shot commands, the router's
//! meters packet, a panel's watch lease, the long poll's `mix=` / `music=` /
//! `watch=` cursors, `GET /api/mod/audio/mixer` (no `by` in it), the bad
//! bodies, and the host allowlist (yes for the panel's three, never the
//! router's meters).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { validateAudio, type AudioConfig } from "@loom/house";

import { AUDIO_METER_OUTPUTS_MAX, AudioHub, audioHealthOf, mixerMetersOf, type AudioView } from "../server/audio.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { isHostRoute } from "../server/routes/host.ts";
import { Store } from "../server/store.ts";
import { MIX_CHANGES_MAX, MIX_LEVELS_MAX, MIX_METERS_STALE_MS, MIX_WATCH_MS, MUSIC_COMMAND_MS, MUSIC_COMMANDS, type MixerView } from "../src/house-mixer.ts";

const HOUSE_FILE = join(import.meta.dirname, "..", "..", "house", "test", "fixtures", "audio-house.json");
const BASIC = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "house", "test", "fixtures", "audio-basic.json"), "utf8")) as AudioConfig;
// The fixture with the show's two role inputs: Clippy's mic (no route: a
// meter only) and the TV (routed: a fader).
const AUDIO: AudioConfig = {
  ...BASIC,
  inputs: [
    { ch: 1, label: "Clippy's mic", kind: "mic", role: "clippy" },
    { ch: 2, label: "QLab 2", kind: "software" },
    { ch: 3, label: "The TV", kind: "line", role: "trabolta" },
  ],
} as AudioConfig;
const AUDIO_TEXT = JSON.stringify(AUDIO);
const CODES = { event: "EVTMIX", prime: "PRMMIX", mod: "MODMIX" };
const STORY = `# T\n\nLOCATION The Desktop\n\nCHARACTER Task Manager\n  admin: true\n  when scanned by guest:\n    reply ok\n\nCHARACTER Clippy\n  when scanned by guest:\n    reply hi\n\n== Boot\n  setting: The Desktop\nHello.\n`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-mixer-"));
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
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, { moderator: o.moderator ?? false, ...(o.moderator === true ? { moderatorName: "Jo Director" } : {}) });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
const view = async (rt: EventRuntime, q = ""): Promise<AudioView> => (await call(rt, "GET", `/api/mod/audio${q}`)).json as unknown as AudioView;
const mixer = async (rt: EventRuntime): Promise<MixerView> => (await call(rt, "GET", "/api/mod/audio/mixer")).json as unknown as MixerView;
const tick = () => new Promise((r) => setTimeout(r, 20));

function runtime(o: { dir?: string; now?: () => number } = {}): EventRuntime {
  return new EventRuntime({
    eventId: "evt",
    store: new Store(o.dir ?? freshDir()),
    codes: CODES,
    scenarioName: "t",
    scenarioSource: STORY,
    joinBase: () => "http://localhost",
    houseFile: HOUSE_FILE,
    audioFile: null,
    audio: AUDIO_TEXT,
    ...(o.now !== undefined ? { now: o.now } : {}),
  });
}

async function hostToken(rt: EventRuntime): Promise<string> {
  const r = await call(rt, "POST", "/api/prime/login", { character: "Task Manager", passcode: CODES.prime }, {});
  expect(r.json).toMatchObject({ host: true });
  return r.json["token"] as string;
}

describe("the fixture", () => {
  it("is a valid audio.json on its house", () => {
    expect(validateAudio(AUDIO, JSON.parse(readFileSync(HOUSE_FILE, "utf8"))).ok).toBe(true);
  });
});

describe("the mix (kept in the state dir, never journaled)", () => {
  it("POST /api/mod/audio/mix moves levels; the seq and levels survive a restart on the same state dir", async () => {
    const dir = freshDir();
    const rt = runtime({ dir });
    expect((await view(rt)).mix).toEqual({ seq: 0, levels: {} });
    const a = await call(rt, "POST", "/api/mod/audio/mix", { changes: [{ key: "src:music", db: -6.2 }, { key: "room:hall", mute: true }] });
    expect(a).toEqual({ status: 200, json: { ok: true, mix: { seq: 1, levels: { "src:music": { db: -6, mute: false }, "room:hall": { db: 0, mute: true } } } } });
    // Back at unity: the level is dropped.
    const b = await call(rt, "POST", "/api/mod/audio/mix", { changes: [{ key: "room:hall", mute: false }] });
    expect(b.json["mix"]).toEqual({ seq: 2, levels: { "src:music": { db: -6, mute: false } } });
    expect(JSON.parse(readFileSync(join(dir, "audio-mix.json"), "utf8"))).toMatchObject({ version: 1, seq: 2 });
    // The story's restart keeps it (it is not the story).
    expect((await call(rt, "POST", "/api/mod/reset", {})).status).toBe(200);
    expect((await view(rt)).mix.seq).toBe(2);
    rt.dispose();
    // A new server on the same state dir: the same mix, and the next seq is 3.
    const rt2 = runtime({ dir });
    expect((await view(rt2)).mix).toEqual({ seq: 2, levels: { "src:music": { db: -6, mute: false } } });
    expect((await call(rt2, "POST", "/api/mod/audio/mix", { changes: [{ key: "master", db: 3 }] })).json["mix"]).toMatchObject({ seq: 3 });
    rt2.dispose();
  });

  it("a resetAll clears every level first; a stored file is read through mixLevelsOf", async () => {
    const dir = freshDir();
    writeFileSync(join(dir, "audio-mix.json"), JSON.stringify({ version: 1, seq: 41, levels: { master: { db: -3 }, "bogus:key": { db: 1 }, "spk:sub": { db: 99, mute: true }, "src:sfx": "loud", "src:announce": { db: 0 } } }));
    const rt = runtime({ dir });
    const m = (await view(rt)).mix;
    expect(m).toEqual({ seq: 41, levels: { master: { db: -3, mute: false }, "spk:sub": { db: 10, mute: true } } });
    const r = await call(rt, "POST", "/api/mod/audio/mix", { changes: [{ key: "src:in:trabolta", db: -12 }], resetAll: true });
    expect(r.json["mix"]).toEqual({ seq: 42, levels: { "src:in:trabolta": { db: -12, mute: false } } });
    // A resetAll alone is the Reset all.
    expect((await call(rt, "POST", "/api/mod/audio/mix", { resetAll: true })).json["mix"]).toEqual({ seq: 43, levels: {} });
    rt.dispose();
  });

  it("refuses more than MIX_LEVELS_MAX levels (the mix is untouched)", async () => {
    const rt = runtime();
    const post = (from: number) => call(rt, "POST", "/api/mod/audio/mix", { changes: Array.from({ length: MIX_CHANGES_MAX }, (_, i) => ({ key: `room:r${from + i}`, db: -1 })) });
    for (let i = 0; i < MIX_LEVELS_MAX / MIX_CHANGES_MAX; i++) expect((await post(i * MIX_CHANGES_MAX)).status).toBe(200);
    const seq = (await view(rt)).mix.seq;
    const over = await post(MIX_LEVELS_MAX);
    expect(over.status).toBe(400);
    expect(over.json["error"]).toMatch(/at most 256 levels/u);
    const after = (await view(rt)).mix;
    expect(after.seq).toBe(seq);
    expect(Object.keys(after.levels)).toHaveLength(MIX_LEVELS_MAX);
    // Moving a level it holds is still fine.
    expect((await call(rt, "POST", "/api/mod/audio/mix", { changes: [{ key: "room:r0", db: -2 }] })).status).toBe(200);
    rt.dispose();
  });

  it("400s a bad body with the reason and the change's index", async () => {
    const rt = runtime();
    const bad = async (body: unknown) => {
      const r = await call(rt, "POST", "/api/mod/audio/mix", body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      return String(r.json["error"]);
    };
    expect(await bad({})).toMatch(/changes must be a list/u);
    expect(await bad({ changes: { key: "master", db: 1 } })).toMatch(/changes must be a list/u);
    expect(await bad({ changes: [] })).toBe("send changes or resetAll");
    expect(await bad({ changes: [{ key: "master", db: 1 }], resetAll: "yes" })).toBe("resetAll must be true or false");
    expect(await bad({ changes: Array.from({ length: MIX_CHANGES_MAX + 1 }, () => ({ key: "master", db: 1 })) })).toBe(`at most ${MIX_CHANGES_MAX} changes in one post`);
    expect(await bad({ changes: [{ key: "master", db: 1 }, { key: "zone:living", db: 1 }] })).toMatch(/^changes\[1\]: key must be/u);
    expect(await bad({ changes: [{ key: "master", db: "loud" }] })).toBe("changes[0]: db must be a number");
    expect(await bad({ changes: [{ key: "master" }] })).toBe("changes[0]: a change sets db, mute or reset");
    expect((await view(rt)).mix.seq).toBe(0);
    rt.dispose();
  });
});

describe("the soundtrack's commands (memory only)", () => {
  it("POST /api/mod/audio/music → {ok, seq, router}; 400 a bad command; the last 16, at most 60 s old, ride the GET", async () => {
    let t = 5_000_000;
    const rt = runtime({ now: () => t });
    for (const body of [{}, { action: "skip" }, { action: "scene" }, { action: "scene", scene: "act 1!" }, { action: "next", playlist: 7 }]) expect((await call(rt, "POST", "/api/mod/audio/music", body)).status, JSON.stringify(body)).toBe(400);
    const a = await call(rt, "POST", "/api/mod/audio/music", { action: "next", playlist: "act_1" });
    expect(a).toEqual({ status: 200, json: { ok: true, seq: 1, router: { online: false, lastSeen: null, name: null } } });
    t += 1000;
    await call(rt, "POST", "/api/mod/audio/music", { action: "scene", scene: "doors", junk: 1 });
    const v = await view(rt);
    expect(v.music).toEqual([
      { action: "next", playlist: "act_1", seq: 1, at: 5_000_000, by: "Jo Director" },
      { action: "scene", scene: "doors", seq: 2, at: 5_001_000, by: "Jo Director" },
    ]);
    t += MUSIC_COMMAND_MS;
    expect((await view(rt)).music.map((c) => c.seq)).toEqual([2]);
    for (let i = 0; i < MUSIC_COMMANDS + 3; i++) await call(rt, "POST", "/api/mod/audio/music", { action: i % 2 === 0 ? "stop" : "story" });
    const many = (await view(rt)).music;
    expect(many).toHaveLength(MUSIC_COMMANDS);
    expect(many.at(-1)!.seq).toBe(MUSIC_COMMANDS + 5);
    // Never a mix change, never a test or a play.
    expect(v.mix.seq).toBe(0);
    expect(v.plays).toEqual([]);
    rt.dispose();
  });
});

describe("the long poll's mixer cursors (the router)", () => {
  it("mix=<seq>: at once when it differs (a restart), else on the next change", async () => {
    const rt = runtime();
    const v = await view(rt);
    let t0 = Date.now();
    expect((await view(rt, `?after=${v.version}&mix=9&wait=5`)).mix.seq).toBe(0);
    expect(Date.now() - t0).toBeLessThan(1000);
    const parked = view(rt, `?after=${v.version}&mix=0&wait=5&router=1`);
    await tick();
    expect(rt.audio.waiting).toBe(1);
    await call(rt, "POST", "/api/mod/audio/mix", { changes: [{ key: "spk:kitchen", db: -4 }] });
    const woke = await parked;
    expect(woke.mix).toEqual({ seq: 1, levels: { "spk:kitchen": { db: -4, mute: false } } });
    expect(woke.mixWatch).toBe(false);
    t0 = Date.now();
    expect((await view(rt, `?after=${v.version}&mix=1&wait=0.05`)).mix.seq).toBe(1);
    expect(rt.audio.moved(v.version, null, null, null, { mix: 1 })).toBe(false);
    rt.dispose();
  });

  it("music=<seq> like plays: a newer one answers, a cursor past the counter is stale and answers at once", async () => {
    const rt = runtime();
    const v = await view(rt);
    const t0 = Date.now();
    expect((await view(rt, `?after=${v.version}&music=7&wait=5`)).music).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1000);
    const parked = view(rt, `?after=${v.version}&music=0&wait=5`);
    await tick();
    await call(rt, "POST", "/api/mod/audio/music", { action: "stop" });
    expect((await parked).music.map((c) => [c.seq, c.action])).toEqual([[1, "stop"]]);
    expect(rt.audio.moved(v.version, null, null, null, { music: 1 })).toBe(false);
    expect(rt.audio.moved(v.version, null, null, null, { music: 0 })).toBe(true);
    // A poll that keeps no music cursor never wakes for one (an older router).
    expect(rt.audio.moved(v.version, null)).toBe(false);
    rt.dispose();
  });

  it("watch=0|1: moved when a panel's watch differs; the first mixer GET after a quiet spell wakes the poll, later ones do not; the lease lapses", async () => {
    let t = 9_000_000;
    const rt = runtime({ now: () => t });
    const v = await view(rt);
    expect(v.mixWatch).toBe(false);
    expect(rt.audio.moved(v.version, null, null, null, { watch: false })).toBe(false);
    expect(rt.audio.moved(v.version, null, null, null, { watch: true })).toBe(true);
    const parked = view(rt, `?after=${v.version}&mix=0&music=0&watch=0&wait=5&router=1`);
    await tick();
    expect(rt.audio.waiting).toBe(1);
    await mixer(rt);
    const woke = await parked;
    expect(woke.mixWatch).toBe(true);
    // Watched now: a router that knows it waits; a second GET does not wake it.
    const holding = view(rt, `?after=${v.version}&mix=0&music=0&watch=1&wait=0.3&router=1`);
    await tick();
    expect(rt.audio.waiting).toBe(1);
    t += MIX_WATCH_MS - 1000;
    await mixer(rt);
    expect(rt.audio.waiting).toBe(1);
    await holding;
    // The lease runs MIX_WATCH_MS from the last GET.
    t += MIX_WATCH_MS - 1;
    expect(rt.audio.mixWatched()).toBe(true);
    t += 1;
    expect(rt.audio.mixWatched()).toBe(false);
    expect((await view(rt)).mixWatch).toBe(false);
    rt.dispose();
  });
});

describe("the router's meters (POST /api/mod/audio/meters)", () => {
  it("answers whether a panel watches; the view shows them until MIX_METERS_STALE_MS, clamped", async () => {
    let t = 1_000_000;
    const rt = runtime({ now: () => t });
    expect((await call(rt, "POST", "/api/mod/audio/meters", { outputs: { "1": -20 } })).json).toEqual({ ok: true, watch: false });
    expect((await mixer(rt)).meters).toMatchObject({ at: 1_000_000, outputs: { "1": -20 } });
    expect((await call(rt, "POST", "/api/mod/audio/meters", { outputs: { "1": 99, "2": null, "3": -500, x: 3, "0": 1 }, inputs: { "3": -14.66 }, sources: { trabolta: 2, Bad: 1 }, buses: { music: { "1": -30.04 }, "Not a bus": { "1": 0 }, sfx: "loud" } })).json).toEqual({ ok: true, watch: true });
    const m = (await mixer(rt)).meters!;
    expect(m).toEqual({ at: 1_000_000, outputs: { "1": 24, "2": -120, "3": -120 }, inputs: { "3": -14.7 }, sources: { trabolta: 1 }, buses: { music: { "1": -30 } } });
    t += MIX_METERS_STALE_MS;
    expect((await mixer(rt)).meters).not.toBeNull();
    t += 1;
    expect((await mixer(rt)).meters).toBeNull();
    // A packet is the router being there.
    expect((await mixer(rt)).router.online).toBe(true);
    rt.dispose();
  });

  it("cuts long lists and never refuses a malformed field", () => {
    const outputs = Object.fromEntries(Array.from({ length: 99 }, (_, i) => [String(i + 1), -10]));
    const p = mixerMetersOf({ outputs, inputs: [1, 2], sources: "x", buses: null, music: { scene: 3 } }, 7);
    expect(Object.keys(p.meters.outputs)).toHaveLength(AUDIO_METER_OUTPUTS_MAX);
    expect(p.meters.inputs).toEqual({});
    expect(p.meters.sources).toEqual({});
    expect(p.meters).not.toHaveProperty("buses");
    expect(p.music).toBeNull();
  });
});

describe("the soundtrack now (wave 40 music fields)", () => {
  const BASE = { ok: true, device: "828x", layout: "ok", voices: 3, xruns: 0, peakDb: -9, announce: "on", missing: [], placeholders: [], sounds: {} };
  const MUSIC = {
    scene: "act_1",
    hand: true,
    scenes: ["off", "doors", "act_1", "", 4],
    playlists: [{ name: "act_1", tracks: 12, loop: true }, { name: "doors", tracks: 3.4 }, { name: "", tracks: 1 }, { name: "bad", tracks: "x" }, "x"],
    beds: [
      { playlist: "act_1", speakers: ["living-l"], track: "song-03.mp3", pos_s: 61.27, dur_s: 200.04 },
      { playlist: "doors", speakers: [], track: null, posS: 0, durS: "long" },
    ],
    missing: [],
  };

  it("a health report keeps scenes, hand, playlists and each bed's durS when sound, drops each alone when not", () => {
    const h = audioHealthOf({ ...BASE, music: MUSIC }, 5)!;
    expect(h.music).toEqual({
      scene: "act_1",
      beds: [
        { playlist: "act_1", speakers: ["living-l"], track: "song-03.mp3", posS: 61.3, durS: 200 },
        { playlist: "doors", speakers: [], track: null, posS: 0 },
      ],
      missing: [],
      scenes: ["off", "doors", "act_1"],
      hand: true,
      playlists: [
        { name: "act_1", tracks: 12, loop: true },
        { name: "doors", tracks: 3, loop: false },
      ],
    });
    const junk = audioHealthOf({ ...BASE, music: { ...MUSIC, hand: "yes", scenes: "act_1", playlists: {} } }, 5)!;
    expect(junk.music).not.toHaveProperty("hand");
    expect(junk.music).not.toHaveProperty("scenes");
    expect(junk.music).not.toHaveProperty("playlists");
    expect(junk.music!.scene).toBe("act_1");
  });

  it("the mixer view shows the freshest of the meters' music and the last health's", async () => {
    let t = 2_000_000;
    const rt = runtime({ now: () => t });
    expect((await mixer(rt)).music).toBeNull();
    await call(rt, "POST", "/api/mod/audio/report", { health: { ...BASE, music: { scene: "doors", beds: [], missing: [] } } });
    expect((await mixer(rt)).music).toEqual({ scene: "doors", beds: [], missing: [] });
    t += 1000;
    // A packet with no sound music leaves the now-playing alone.
    await call(rt, "POST", "/api/mod/audio/meters", { outputs: {}, music: { beds: [] } });
    expect((await mixer(rt)).music!.scene).toBe("doors");
    await call(rt, "POST", "/api/mod/audio/meters", { outputs: {}, music: MUSIC });
    expect((await mixer(rt)).music).toMatchObject({ scene: "act_1", hand: true });
    // Long after the meters went stale, their music is still the freshest.
    t += 60_000;
    expect((await mixer(rt)).meters).toBeNull();
    expect((await mixer(rt)).music!.scene).toBe("act_1");
    t += 1000;
    await call(rt, "POST", "/api/mod/audio/report", { health: { ...BASE, music: { scene: "act_2", beds: [], missing: [] } } });
    expect((await mixer(rt)).music!.scene).toBe("act_2");
    rt.dispose();
  });
});

describe("GET /api/mod/audio/mixer", () => {
  it("the sources and the rooms of the config in force (named from the house map), the mix, the router, now; no by anywhere", async () => {
    const rt = runtime({ now: () => 3_000_000 });
    await call(rt, "POST", "/api/mod/audio/music", { action: "stop" });
    await call(rt, "POST", "/api/mod/audio/mix", { changes: [{ key: "src:music", db: -6 }] });
    const v = await mixer(rt);
    expect(v.sources.map((s) => [s.id, s.meterOnly])).toEqual([
      ["music", false],
      ["tracks", false],
      ["sfx", false],
      ["announce", false],
      ["in:clippy", true],
      ["in:trabolta", false],
    ]);
    expect(v.rooms.map((r) => [r.id, r.name, r.speakers.map((s) => s.id)])).toEqual([
      ["desktop", "Desktop (living room)", ["living-l", "living-r"]],
      ["start-bar", "Start Bar (kitchen)", ["kitchen"]],
      ["hall", "Hall", ["hall"]],
      ["basement-hall", "Basement hall", ["down-hall"]],
      ["ram", "RAM (studio)", ["studio"]],
    ]);
    expect(v.mix).toEqual({ seq: 1, levels: { "src:music": { db: -6, mute: false } } });
    expect(v).toMatchObject({ meters: null, music: null, router: { online: false }, now: 3_000_000 });
    const text = JSON.stringify(v);
    expect(text).not.toMatch(/"by"/u);
    expect(text).not.toMatch(/Jo Director/u);
    // It is never the router's read, and it keeps the meters coming.
    expect((await view(rt)).router.online).toBe(false);
    expect(rt.audio.mixWatched()).toBe(true);
    rt.dispose();
  });

  it("is a hub method too: the house map's labels, a room it does not know by its id", () => {
    const hub = new AudioHub({ store: new Store(freshDir()), projectText: AUDIO_TEXT, now: () => 1 });
    expect(hub.mix()).toEqual({ seq: 0, levels: {} });
    const set = hub.setMix([{ key: "master", db: -3 }]);
    expect(set).toEqual({ seq: 1, levels: { master: { db: -3, mute: false } } });
    // A copy: the caller cannot move the hub's levels.
    (set as { levels: Record<string, { db: number }> }).levels["master"]!.db = 5;
    expect(hub.mix().levels["master"]!.db).toBe(-3);
  });
});

describe("who may reach the mixer", () => {
  it("a host's booth: the mixer GET, mix and music; never the meters post or the router's GET; nobody else at all", async () => {
    const rt = runtime();
    const token = await hostToken(rt);
    expect((await call(rt, "GET", "/api/mod/audio/mixer", {}, { token })).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/audio/mix", { changes: [{ key: "room:hall", db: -3 }], token }, { token })).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/audio/music", { action: "next", token }, { token })).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/audio/meters", { outputs: {}, token }, { token })).json).toEqual({ error: "not from a booth" });
    expect((await call(rt, "GET", "/api/mod/audio", {}, { token })).status).toBe(403);
    // The booth's by is its part, for the router's own read only.
    expect((await view(rt)).music[0]!.by).toBe("Booth · Task Manager");
    // No token: refused everywhere.
    expect((await call(rt, "GET", "/api/mod/audio/mixer", {}, {})).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/audio/mix", { changes: [{ key: "master", db: 1 }] }, {})).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/audio/music", { action: "stop" }, {})).status).toBe(403);
    // A performer that is not a host.
    const perf = await call(rt, "POST", "/api/prime/login", { character: "Clippy", passcode: CODES.prime }, {});
    const ptoken = perf.json["token"] as string;
    expect(perf.json["host"]).not.toBe(true);
    expect((await call(rt, "GET", "/api/mod/audio/mixer", {}, { token: ptoken })).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/audio/mix", { changes: [{ key: "master", db: 1 }], token: ptoken }, { token: ptoken })).status).toBe(403);
    // A full mod token is a director.
    const mod = await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod }, {});
    const mtoken = mod.json["token"] as string;
    expect((await call(rt, "GET", "/api/mod/audio/mixer", {}, { token: mtoken })).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/audio/meters", { outputs: {}, token: mtoken }, { token: mtoken })).status).toBe(200);
    rt.dispose();
  });

  it("isHostRoute: the mixer GET, mix and music; never meters, report or the audio GET", () => {
    const ctx = { alertsPath: "Night.alerts", isAgent: () => false };
    expect(isHostRoute("GET", "/api/mod/audio/mixer", {}, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/audio/mix", {}, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/audio/music", {}, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/audio/meters", {}, ctx)).toBe(false);
    expect(isHostRoute("POST", "/api/mod/audio/mixer", {}, ctx)).toBe(false);
    expect(isHostRoute("GET", "/api/mod/audio/mix", {}, ctx)).toBe(false);
    expect(isHostRoute("GET", "/api/mod/audio/meters", {}, ctx)).toBe(false);
    expect(isHostRoute("GET", "/api/mod/audio", {}, ctx)).toBe(false);
  });
});
