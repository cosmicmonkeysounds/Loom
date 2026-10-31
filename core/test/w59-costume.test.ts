//! Wave 59: the Task Manager costume, through a real `EventRuntime`. The token
//! opens the menu and a fire and nothing else, the crew's switch stops it, the
//! server refuses every press that would wreck something, a press goes through
//! the path the house already has, and a fire lands on the mod log, not in
//! `# hosts`. Played on a small fixture story; the show's own menu is checked
//! against the show's `lights.json`, `audio.json` and persona at the end.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";

import { scenarioSource } from "../examples/load.ts";
import { audioHealthOf, type AudioHub } from "../server/audio.ts";
import type { ChatMessage } from "../server/chat.ts";
import { costumeFixtures, costumeHouseProblems, costumeRoomOutRestore } from "../server/costume.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { secretCode } from "../server/identity.ts";
import type { LightsHub } from "../server/lights.ts";
import { Store } from "../server/store.ts";
import type { ScreenWatch } from "../server/routes/screen.ts";
import { COSTUME_BY, COSTUME_COOLDOWN_S, COSTUME_FILE, COSTUME_ITEMS_MAX, COSTUME_LABEL_MAX, COSTUME_SIGNAL, DEFAULT_COSTUME, costumeLeaves, costumeMenu, parseCostume, saidBy } from "../src/costume.ts";
import type { LightsConfig } from "@loom/house";

const STORY = `# Costume Night
start: Opening

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

LOCATION The Desktop

CHARACTER Task Manager
  listed: true
  faction: Hosts
  admin: true

CHARACTER Clippy
  faction: Hosts
  player: true
  trust: 0 to 100 = 50

CHARACTER Trabolta
  listed: true
  mind: external
  hold: "Jean Trabolta is not responding."
  awake: bool = false

INTERACTION ad_burst
  who: admin
  sequence: false
  repeat: true

INTERACTION costume_flicker
  who: admin
  sequence: false
  repeat: true

when costume_flicker:
  cue screens_flicker

when ad_burst:
  if Night.talk == "none" or Night.talk == "intro":
    broadcast "⚡ Nothing glitches." to channel(hosts)
  else:
    set Night.burst_last = Time.elapsed
    set Night.bursts += 1
    cue screens_flicker

== Opening
  setting: The Desktop

Clippy: Hi.

== A Long Beat
  setting: The Desktop

Trabolta: ${"This line is a long one and it takes him a good while to say all of it, so nothing should cut across it. ".repeat(3)}

== A Reading
  setting: The Desktop
  aloud: Clippy

Clippy: ${"This is a long read for Clippy off her prompter, and she takes her time over every single word of it. ".repeat(3)}
`;

const CODES = { event: "EVT590", prime: "PRM590", mod: "MOD590" };
const DESK = "loc:The Desktop";
const LIGHTS: LightsConfig = {
  version: 1,
  fixtures: [
    { id: "living-1", name: "Living 1", room: "desktop", floor: "main", pos: { x: 0, y: 2, z: 0 }, kind: "zigbee", device: "living_1", caps: { color: true, ct: true, dim: true } },
    { id: "hall", name: "Hall", room: "hall", floor: "main", pos: { x: 3, y: 2, z: 0 }, kind: "zigbee", device: "hall", safety: true, caps: { color: true, ct: true, dim: true } },
  ],
  zones: [
    { id: "living", name: "Living", fixtures: ["living-1"] },
    { id: "house", name: "House", fixtures: ["living-1", "hall"] },
  ],
  looks: {
    lights_game: { to: ["living"], set: { state: "ON", brightness: 200 } },
    lights_restore: { to: ["house"], set: { state: "ON", brightness: 230 } },
    lights_chase: { to: ["house"], then: "restore", steps: [{ at: 0, set: { state: "ON", brightness: 100 } }] },
  },
} as unknown as LightsConfig;

const MENU = {
  title: "Close Program",
  cooldownS: 8,
  restoreS: 6,
  poke: ["Ow.", "Stop that."],
  items: [
    { id: "lights", label: "LIGHTS", items: [{ id: "red", label: "RED", light: { to: ["house"], set: { state: "ON", color: "#ff0000", brightness: 254, transition: 0 } } }, { id: "spot", label: "SPOT", look: "lights_game" }, { id: "whole", label: "WHOLE", look: "lights_restore" }] },
    { id: "sounds", label: "SOUNDS", items: [{ id: "zip", label: "ZIP", sound: "zip", to: ["living"] }] },
    { id: "music", label: "MUSIC", items: [{ id: "next", label: "NEXT", music: { action: "next" } }, { id: "party", label: "PARTY", music: { action: "scene", scene: "afterparty" }, holdS: 30 }] },
    { id: "storm", label: "AD STORM", cue: "ad_burst", times: 3, everyS: 4, cooldownS: 60 },
    { id: "glitch", label: "GLITCH", cue: "ad_burst", cooldownS: 20 },
    { id: "poke", label: "POKE", poke: true },
  ],
};

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
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
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    setHeader() {},
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
async function call(rt: EventRuntime, method: string, pathAndQuery: string, body: unknown, o: { moderator?: boolean } = {}) {
  const url = new URL(`http://x${pathAndQuery}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body), res, method, url.pathname, url, { moderator: o.moderator ?? false });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  return { status: res.statusCode, json };
}

/** A hand-cranked clock + timers: a test decides when a restore comes due. */
function rig(o: { menu?: string | null; dir?: string; open?: boolean; story?: string } = {}) {
  const dir = o.dir ?? mkdtempSync(join(tmpdir(), "loom-w59-costume-"));
  if (o.dir === undefined) dirs.push(dir);
  let now = 1_000_000;
  let timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let next = 1;
  const project = {
    readFile: async (name: string) => (name === COSTUME_FILE ? (o.menu === undefined ? JSON.stringify(MENU) : o.menu) : null),
    writeFile: async () => {},
    saveSnapshot: async () => {},
  };
  const rt = new EventRuntime({
    eventId: "evt",
    store: new Store(dir),
    codes: CODES,
    scenarioName: "costume",
    scenarioSource: o.story ?? STORY,
    joinBase: () => "https://party.example",
    hostViewMs: 0,
    now: () => now,
    project: project as never,
    lights: JSON.stringify(LIGHTS),
    costumeTimers: {
      set: (fn: () => void, ms: number) => {
        const id = next++;
        timers.push({ at: now + ms, fn, id });
        return id;
      },
      clear: (h: unknown) => {
        timers = timers.filter((t) => t.id !== h);
      },
    },
  } as never);
  if (o.open !== false) {
    rt.openDoors();
    rt.tickOnce(5000); // the opening line is said
  }
  const rtAny = rt as unknown as { claimSecret: string; lights: LightsHub; audio: AudioHub; screens: ScreenWatch; sim: { elapsed(): number; log: { all(): Array<Record<string, unknown>> } }; chat: { all(): ChatMessage[] }; agents: { line(t: unknown): unknown } };
  const k = secretCode(rtAny.claimSecret, "costume");
  const fire = (id: string, token: string = k) => call(rt, "POST", "/api/costume/fire", { k: token, id });
  const setVar = (path: string, value: string) => call(rt, "POST", "/api/mod/var", { path, value }, { moderator: true });
  const advance = (s: number) => {
    now += s * 1000;
    rt.tickOnce(s * 1000);
    for (;;) {
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      timers = timers.filter((t) => t !== due);
      due.fn();
    }
  };
  return { rt, k, fire, setVar, advance, hub: rtAny, dir, pending: () => timers.length };
}

/** Doors open, the module and router there, cooled down. */
async function live(o: Parameters<typeof rig>[0] = {}) {
  const r = rig(o);
  await call(r.rt, "GET", "/api/mod/lights?module=1&name=test", {}, { moderator: true });
  await call(r.rt, "GET", "/api/mod/audio?router=1&name=test", {}, { moderator: true });
  return r;
}

const hostsLines = (r: ReturnType<typeof rig>) => r.hub.chat.all().filter((m) => m.channel.includes("hosts")).map((m) => m.text);
const presses = (r: ReturnType<typeof rig>) => r.hub.sim.log.all().filter((e) => e["type"] === "signal" && e["name"] === COSTUME_SIGNAL);

describe("w59 costume: the token", () => {
  it("opens the menu and a fire, and the menu says nothing about what a button does", async () => {
    const { rt, k } = await live();
    const menu = await call(rt, "POST", "/api/costume/menu", { k });
    expect(menu.status).toBe(200);
    expect(menu.json).toMatchObject({ on: true, title: "Close Program" });
    const text = JSON.stringify(menu.json);
    expect(text).toContain("AD STORM");
    for (const hidden of ["ad_burst", "#ff0000", "cooldown", "lights_game", "afterparty"]) expect(text).not.toContain(hidden);
    rt.dispose();
  });

  it("no token or a wrong one is refused, and it is not the mod code", async () => {
    const { rt, fire, k } = await live();
    expect((await call(rt, "POST", "/api/costume/menu", {})).status).toBe(401);
    expect((await fire("poke", "nope")).status).toBe(401);
    expect((await fire("poke", CODES.mod)).status).toBe(401);
    expect(k).not.toBe(CODES.mod.toLowerCase());
    rt.dispose();
  });

  it("nothing else accepts it", async () => {
    const { rt, k } = await live();
    const asToken = (path: string, body: Record<string, unknown> = {}) => call(rt, "POST", `${path}`, { ...body, token: k, passcode: k });
    for (const [path, body] of [
      ["/api/mod/signal", { name: "ad_burst" }],
      ["/api/mod/talk", { as: "Trabolta", text: "hi" }],
      ["/api/mod/lights/test", { look: "lights_game" }],
      ["/api/mod/audio/music", { action: "next" }],
      ["/api/mod/costume", { on: false }],
      ["/api/mod/broadcast", { text: "hi" }],
      ["/api/mod/login", {}],
      ["/api/prime/login", { character: "Task Manager" }],
      ["/api/guest/register", { name: "Winamp" }],
    ] as const) {
      expect((await asToken(path, body)).status, path).toBeGreaterThanOrEqual(400);
    }
    const url = `/api/mod/costume?token=${k}`;
    expect((await call(rt, "GET", url, {})).status).toBe(403);
    expect((await call(rt, "GET", `/api/screen/state?token=${k}&role=mod`, {})).status).not.toBe(500);
    expect((await call(rt, "GET", `/api/mod/log?token=${k}`, {})).status).toBe(403);
    rt.dispose();
  });

  it("the link is a director's: a host's booth reads neither it nor the switch", async () => {
    const { rt, k } = await live();
    const director = await call(rt, "GET", "/api/mod/costume", {}, { moderator: true });
    expect(director.json).toEqual({ on: true, url: `https://party.example/costume?e=evt&k=${k}` });
    const host = await call(rt, "POST", "/api/prime/login", { character: "Task Manager", passcode: CODES.prime });
    const token = host.json["token"] as string;
    expect((await call(rt, "GET", `/api/mod/costume?token=${token}`, {})).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/costume", { on: false, token })).status).toBe(403);
    rt.dispose();
  });
});

describe("w59 costume: the kill switch", () => {
  it("is on by default, stops every fire, empties the menu, and survives a restart", async () => {
    const { rt, k, fire, dir, setVar } = await live();
    await setVar("Trabolta.awake", "true");
    expect((await call(rt, "POST", "/api/mod/costume", { on: false }, { moderator: true })).json).toEqual({ ok: true, on: false });
    expect((await fire("poke")).status).toBe(403);
    expect((await call(rt, "POST", "/api/costume/menu", { k })).json).toMatchObject({ on: false, items: [] });
    rt.dispose();
    expect(new Store(dir).loadCostumeOff()).toBe(true);
  });

  it("stops a storm where it stands, and still gives the lights back", async () => {
    const r = await live();
    await r.setVar("Night.lights", "game");
    await r.setVar("Night.talk", "ad");
    await r.fire("red");
    r.advance(COSTUME_COOLDOWN_S - 3);
    r.advance(3);
    expect(r.hub.lights.tests().at(-1)).toMatchObject({ look: "lights_game" });
    await r.fire("red");
    r.advance(COSTUME_COOLDOWN_S);
    await r.fire("storm");
    await r.fire("red"); // cooling: nothing new
    await call(r.rt, "POST", "/api/mod/costume", { on: false }, { moderator: true });
    r.advance(4);
    expect(r.hub.sim.log.all().filter((e) => e["name"] === "ad_burst").length).toBe(1);
    expect(r.pending()).toBe(0);
    await call(r.rt, "POST", "/api/mod/costume", { on: true }, { moderator: true });
    expect((await r.fire("spot")).json).toMatchObject({ why: "cooldown" });
    r.rt.dispose();
  });

  it("flipped off in a hold, the story's look still comes back", async () => {
    const r = await live();
    await r.setVar("Night.lights", "game");
    await r.fire("red");
    await call(r.rt, "POST", "/api/mod/costume", { on: false }, { moderator: true });
    r.advance(6);
    expect(r.hub.lights.tests().at(-1)).toMatchObject({ look: "lights_game" });
    r.rt.dispose();
  });

  it("can come back on", async () => {
    const { rt, fire, setVar } = await live();
    await setVar("Trabolta.awake", "true");
    await call(rt, "POST", "/api/mod/costume", { on: false }, { moderator: true });
    await call(rt, "POST", "/api/mod/costume", { on: true }, { moderator: true });
    expect((await fire("poke")).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/costume", {}, { moderator: true })).status).toBe(400);
    rt.dispose();
  });
});

describe("w59 costume: refused while it would wreck something", () => {
  it("before the doors", async () => {
    const r = rig({ open: false });
    expect(await r.fire("poke")).toMatchObject({ status: 409, json: { ok: false, why: "doors" } });
    r.rt.dispose();
  });

  it("a list's id and an unknown id fire nothing", async () => {
    const { rt, fire } = await live();
    expect((await fire("lights")).json).toMatchObject({ why: "no_item" });
    expect((await fire("nothing")).json).toMatchObject({ why: "no_item" });
    rt.dispose();
  });

  it("while a beat's lines are playing, by their length with no TV at all", async () => {
    const r = await live();
    await r.setVar("Trabolta.awake", "true");
    await call(r.rt, "POST", "/api/mod/beat", { name: "A Long Beat" }, { moderator: true });
    expect(r.hub.chat.all().some((m) => m.beat === "A Long Beat")).toBe(true);
    expect((await r.fire("poke")).json).toMatchObject({ why: "speaking" });
    r.rt.dispose();
  });

  it("while the TV says it is talking", async () => {
    const r = await live();
    await r.setVar("Trabolta.awake", "true");
    const tv = (talk: number) => call(r.rt, "GET", `/api/screen/state?name=tv&view=tv&voice=The%20Desktop&talk=${talk}`, {}, { moderator: true });
    await tv(1);
    expect((await r.fire("poke")).json).toMatchObject({ why: "speaking" });
    await tv(0);
    expect((await r.fire("poke")).status).toBe(200);
    r.rt.dispose();
  });

  /** A real Clippy booth with her pop-up or prompter on a visible page. */
  async function reader(r: Awaited<ReturnType<typeof live>>) {
    const token = (await call(r.rt, "POST", "/api/prime/login", { character: "Clippy", passcode: CODES.prime })).json["token"] as string;
    await call(r.rt, "POST", "/api/mod/beat", { name: "A Reading" }, { moderator: true });
    const scene = (r.rt as unknown as { prompters: { status(): { id: number } | null } }).prompters.status()!.id;
    return () => call(r.rt, "POST", "/api/aloud", { token, scene, op: "here", open: true });
  }

  it("while a reader's phone is on the teleprompter, however slowly it is read, and not after ✓ Done", async () => {
    const r = await live();
    await r.setVar("Trabolta.awake", "true");
    const here = await reader(r);
    await here();
    expect((await r.fire("poke")).json).toMatchObject({ why: "prompter" });
    for (let i = 0; i < 60; i++) {
      r.advance(10); // far past what the words take to say
      await here();
    }
    expect((await r.fire("poke")).json).toMatchObject({ why: "prompter" });
    await call(r.rt, "POST", "/api/mod/aloud", { action: "done" }, { moderator: true });
    expect((await r.fire("poke")).status).toBe(200);
    r.rt.dispose();
  });

  it("not for a scene nobody opened, once its lines are said: no ✓ Done is coming", async () => {
    const r = await live();
    await r.setVar("Trabolta.awake", "true");
    await call(r.rt, "POST", "/api/mod/beat", { name: "A Reading" }, { moderator: true });
    expect((await r.fire("poke")).json).toMatchObject({ why: "speaking" });
    r.advance(600);
    expect((r.rt as unknown as { prompters: { status(): unknown } }).prompters.status()).not.toBeNull();
    expect((await r.fire("poke")).status).toBe(200);
    r.rt.dispose();
  });

  it("not once the reader's phone has gone, without anyone pressing ✓ Done", async () => {
    const r = await live();
    await r.setVar("Trabolta.awake", "true");
    const here = await reader(r);
    for (let i = 0; i < 60; i++) {
      await here();
      r.advance(10);
    }
    await here();
    expect((await r.fire("poke")).json).toMatchObject({ why: "prompter" });
    r.advance(13); // `HERE_TTL_MS`: her phone died with the script open
    expect((r.rt as unknown as { prompters: { status(): unknown } }).prompters.status()).not.toBeNull();
    expect((await r.fire("poke")).status).toBe(200);
    r.rt.dispose();
  });

  it("not once a ✓ Done closes a read before its words would have run out", async () => {
    const r = await live({ story: STORY.replace("setting: The Desktop\n  aloud: Clippy", "setting: The Hall\n  aloud: Clippy") });
    await r.setVar("Trabolta.awake", "true");
    const here = await reader(r);
    await here();
    expect((await r.fire("poke")).json).toMatchObject({ why: "prompter" });
    await call(r.rt, "POST", "/api/mod/aloud", { action: "done" }, { moderator: true });
    expect((await r.fire("poke")).status).toBe(200);
    r.rt.dispose();
  });

  it("from the final reveal on, the awards and after", async () => {
    for (const [path, value] of [
      ["Night.step", "16"], // the final reveal
      ["Night.step", "17"], // the bobbing
      ["Night.step", "18"], // Grok Prom, the advice poll
      ["Night.step", "19"], // every ending
      ["Night.ended", "true"],
      ["Night.ceremony", "true"],
    ] as const) {
      const r = await live();
      await r.setVar("Trabolta.awake", "true");
      await r.setVar(path, value);
      expect((await r.fire("poke")).json, `${path} = ${value}`).toMatchObject({ why: "ending" });
      r.rt.dispose();
    }
  });

  it("not before it: the last step of the Y2K hour still lands", async () => {
    const r = await live();
    await r.setVar("Trabolta.awake", "true");
    await r.setVar("Night.step", "15");
    expect((await r.fire("poke")).status).toBe(200);
    r.rt.dispose();
  });

  it("offline hubs: lights, sound and music say so", async () => {
    const r = rig();
    expect((await r.fire("spot")).json).toMatchObject({ why: "offline" });
    expect((await r.fire("zip")).json).toMatchObject({ why: "offline" });
    expect((await r.fire("next")).json).toMatchObject({ why: "offline" });
    r.rt.dispose();
  });

  it("lights hold for the alarm, a blackout or a room Trabolta put out", async () => {
    for (const [path, value] of [
      ["Night.alarm_on", "true"],
      ["Night.lights", "blackout"],
      ["Night.lights_back_at", "500"],
    ] as const) {
      const r = await live();
      await r.setVar(path, value);
      expect((await r.fire("red")).json, path).toMatchObject({ why: "lights_held" });
      r.rt.dispose();
    }
  });

  it("a director's hand on the soundtrack is theirs to let go of", async () => {
    const music = (r: ReturnType<typeof rig>, body: unknown) => call(r.rt, "POST", "/api/mod/audio/music", body, { moderator: true });
    for (const hand of [{ action: "stop" }, { action: "scene", scene: "act_2" }]) {
      const r = await live();
      await music(r, hand);
      for (const id of ["next", "party"]) expect((await r.fire(id)).json, id).toMatchObject({ why: "hand" });
      await music(r, { action: "story" });
      expect((await r.fire("next")).status).toBe(200);
      r.rt.dispose();
    }
  });

  it("a hand only the router knows of holds too, and the router's word that it let go counts", async () => {
    const r = await live();
    const report = (hand: boolean) => r.hub.audio.report({ health: audioHealthOf({ ok: true, music: { scene: "act_2", beds: [], missing: [], hand } }, r.hub.audio.clock()) });
    report(true); // this server restarted, or it came over MQTT
    expect((await r.fire("next")).json).toMatchObject({ why: "hand" });
    report(false);
    expect((await r.fire("next")).status).toBe(200);
    r.advance(COSTUME_COOLDOWN_S);
    await call(r.rt, "POST", "/api/mod/audio/music", { action: "stop" }, { moderator: true });
    report(false); // sent before the router saw the stop: it says nothing of it
    expect((await r.fire("next")).json).toMatchObject({ why: "hand" });
    r.advance(3);
    report(false); // a story restart: the router let go by itself
    expect((await r.fire("next")).status).toBe(200);
    r.rt.dispose();
  });

  it("a playlist picked in 🎵 Music is a hand, and a track forward or back isn't", async () => {
    const music = (r: ReturnType<typeof rig>, body: unknown) => call(r.rt, "POST", "/api/mod/audio/music", body, { moderator: true });
    for (const hand of [{ action: "playlist", playlist: "act_2" }, { action: "tidal", id: "0b5f3a1e-9c44-4a3e-8f4b-1d2e3f4a5b6c" }]) {
      const r = await live();
      expect((await music(r, hand)).status).toBe(200);
      expect((await r.fire("next")).json).toMatchObject({ why: "hand" });
      r.rt.dispose();
    }
    const r = await live();
    for (const track of [{ action: "next" }, { action: "previous" }]) await music(r, track);
    expect(r.hub.audio.musicHand()).toBe(null);
    expect((await r.fire("next")).status).toBe(200);
    r.rt.dispose();
  });

  it("a host's ⏸ holds until ⏵, whatever the router's hand says", async () => {
    const r = await live();
    const music = (body: unknown) => call(r.rt, "POST", "/api/mod/audio/music", body, { moderator: true });
    const report = (paused: boolean) => r.hub.audio.report({ health: audioHealthOf({ ok: true, music: { scene: "act_2", beds: [], missing: [], hand: false, tidal: { online: true, playing: !paused, paused } } }, r.hub.audio.clock()) });
    await music({ action: "pause" });
    expect((await r.fire("next")).json).toMatchObject({ why: "hand" });
    r.advance(3);
    report(true);
    expect((await r.fire("next")).json).toMatchObject({ why: "hand" });
    await music({ action: "resume" });
    r.advance(3);
    report(false);
    expect((await r.fire("next")).status).toBe(200);
    r.rt.dispose();
  });

  it("Trabolta's loan is no hand: a press takes the music back from him", async () => {
    const r = await live();
    r.hub.audio.report({ health: audioHealthOf({ ok: true, music: { scene: "act_2", beds: [], missing: [], hand: true, loan: true, tidal: { online: true, playing: false, paused: true } } }, r.hub.audio.clock()) });
    expect(r.hub.audio.musicHand()).toBe(null);
    expect((await r.fire("next")).status).toBe(200);
    r.rt.dispose();
  });

  it("the poke needs him awake, with no reply owed", async () => {
    const r = await live();
    expect((await r.fire("poke")).json).toMatchObject({ why: "asleep" });
    r.rt.dispose();
  });
});

describe("w59 costume: the cooldowns", () => {
  it("a global one, and a longer one per heavy item, so mashing does nothing", async () => {
    const r = await live();
    await r.setVar("Trabolta.awake", "true");
    await r.setVar("Night.talk", "ad");
    expect((await r.fire("glitch")).status).toBe(200);
    r.advance(1);
    expect((await r.fire("poke")).json).toMatchObject({ why: "cooldown" });
    r.advance(COSTUME_COOLDOWN_S);
    expect((await r.fire("glitch")).json).toMatchObject({ why: "cooldown" });
    expect((await r.fire("poke")).status).toBe(200);
    r.advance(COSTUME_COOLDOWN_S);
    r.advance(4);
    expect((await r.fire("glitch")).status).toBe(200);
    r.rt.dispose();
  });

  it("a refused press starts no cooldown", async () => {
    const r = await live();
    expect((await r.fire("poke")).json).toMatchObject({ why: "asleep" });
    await r.setVar("Trabolta.awake", "true");
    expect((await r.fire("poke")).status).toBe(200);
    r.rt.dispose();
  });
});

describe("w59 costume: what a press does", () => {
  it("a light item reaches no safety fixture, and the story's look comes back", async () => {
    const r = await live();
    await r.setVar("Night.lights", "game");
    expect((await r.fire("red")).status).toBe(200);
    const tests = r.hub.lights.tests();
    expect(tests.map((t) => t.fixture)).toEqual(["living-1"]);
    expect(tests[0]).toMatchObject({ by: "🎭 Costume", set: { color: "#ff0000" } });
    r.advance(5);
    expect(r.hub.lights.tests().filter((t) => t.look !== undefined)).toEqual([]);
    r.advance(1);
    expect(r.hub.lights.tests().at(-1)).toMatchObject({ look: "lights_game", by: "🎭 Costume" });
    r.rt.dispose();
  });

  it("a story cue that lands in the hold wins: the restore reads the story then", async () => {
    const r = await live();
    await r.setVar("Night.lights", "game");
    await r.fire("red");
    await r.setVar("Night.lights", "restore");
    r.advance(6);
    expect(r.hub.lights.tests().at(-1)).toMatchObject({ look: "lights_restore" });
    r.rt.dispose();
  });

  it("a room he puts out in the hold stays out: only what the press moved goes back", async () => {
    const r = await live();
    await r.setVar("Night.lights", "game");
    await r.fire("red");
    const before = r.hub.lights.tests().length;
    await r.setVar("Night.dark_room", "The Start Bar");
    await r.setVar("Night.lights_back_at", "5000");
    r.advance(6);
    expect(r.hub.lights.tests().slice(before).map(({ fixture, look, set }) => ({ fixture, look, set }))).toEqual([{ fixture: "living-1", look: undefined, set: { state: "ON", brightness: 200 } }]);
    r.rt.dispose();
  });

  it("a Desktop cut in the hold leaves the Desktop dark, whatever the story's look", async () => {
    const r = await live();
    await r.setVar("Night.lights", "game");
    await r.fire("spot");
    const before = r.hub.lights.tests().length;
    await r.setVar("Night.dark_room", "The Desktop");
    await r.setVar("Night.lights_back_at", "5000");
    r.advance(6);
    expect(r.hub.lights.tests().slice(before)).toEqual([]);
    r.rt.dispose();
  });

  it("the room-out restore takes a look's last word on each fixture it reaches", () => {
    const stepped = { ...LIGHTS, looks: { lights_two: { to: ["living"], steps: [{ at: 0, set: { state: "ON", brightness: 10 } }, { at: 500, set: { brightness: 90 } }] } } } as unknown as LightsConfig;
    expect(costumeRoomOutRestore(stepped, null, "lights_two", ["living-1", "hall"], null)).toEqual([{ fixture: "living-1", set: { state: "ON", brightness: 90 } }]);
    expect(costumeRoomOutRestore(stepped, null, "lights_two", ["living-1"], "desktop")).toEqual([]);
    expect(costumeRoomOutRestore(stepped, null, "lights_gone", ["living-1"], null)).toEqual([]);
  });

  it("no story look, or one that only gives a light back, is the plain house", async () => {
    for (const value of ["none", "chase", "gone"]) {
      const r = await live();
      await r.setVar("Night.lights", value);
      await r.fire("red");
      r.advance(6);
      expect(r.hub.lights.tests().at(-1), value).toMatchObject({ look: "lights_restore" });
      r.rt.dispose();
    }
  });

  it("a look that reaches a safety fixture is never played, whatever the file says", async () => {
    const r = await live();
    expect((await r.fire("spot")).status).toBe(200);
    expect(r.hub.lights.tests().at(-1)).toMatchObject({ look: "lights_game" });
    r.advance(COSTUME_COOLDOWN_S);
    expect((await r.fire("whole")).json).toMatchObject({ why: "refused" });
    r.rt.dispose();
  });

  it("a sound goes through the router's plays, a track skip through the transport", async () => {
    const r = await live();
    await r.fire("zip");
    expect(r.hub.audio.plays().at(-1)).toMatchObject({ sound: "zip", to: ["living"], by: "🎭 Costume" });
    r.advance(COSTUME_COOLDOWN_S);
    await r.fire("next");
    expect(r.hub.audio.musicCommands().at(-1)).toMatchObject({ action: "next", by: "🎭 Costume" });
    r.rt.dispose();
  });

  it("a hand scene goes back to the story by itself", async () => {
    const r = await live();
    await r.fire("party");
    expect(r.hub.audio.musicCommands().at(-1)).toMatchObject({ action: "scene", scene: "afterparty" });
    r.advance(30);
    expect(r.hub.audio.musicCommands().at(-1)).toMatchObject({ action: "story" });
    r.rt.dispose();
  });

  it("another hand taken in the hold stays: the return stands down", async () => {
    const r = await live();
    await r.fire("party");
    r.advance(10);
    await call(r.rt, "POST", "/api/mod/audio/music", { action: "scene", scene: "act_2" }, { moderator: true });
    r.advance(20);
    expect(r.hub.audio.musicCommands().map((c) => c.action)).toEqual(["scene", "scene"]);
    expect(r.hub.audio.musicHand()).not.toBe(COSTUME_BY);
    r.rt.dispose();
  });

  describe("the hand against ■ Stop and ⏸", () => {
    const hostMusic = (r: Awaited<ReturnType<typeof live>>, action: string) => call(r.rt, "POST", "/api/mod/audio/music", { action }, { moderator: true });
    const stopHouse = (r: Awaited<ReturnType<typeof live>>) => call(r.rt, "POST", "/api/mod/audio/stop", { announce: true }, { moderator: true });
    const actions = (r: Awaited<ReturnType<typeof live>>) => r.hub.audio.musicCommands().map((c) => c.action);
    const reports = (r: Awaited<ReturnType<typeof live>>, scene: string | null, hand: boolean) =>
      r.hub.audio.report({ health: audioHealthOf({ ok: true, music: { scene, beds: [], missing: [], hand } }, r.hub.audio.clock()) });

    it("ALL STOP inside AFTER PARTY: the timed return stands down and no press lands", async () => {
      const r = await live();
      await r.fire("party");
      r.advance(10);
      expect((await stopHouse(r)).status).toBe(200);
      expect((await call(r.rt, "POST", "/api/mod/costume", { on: false }, { moderator: true })).status).toBe(200);
      reports(r, null, true);
      r.advance(25);
      reports(r, null, true);
      expect(actions(r)).toEqual(["scene"]);
      expect((await call(r.rt, "POST", "/api/mod/costume", { on: true }, { moderator: true })).status).toBe(200);
      expect((await r.fire("party")).json).toMatchObject({ why: "hand" });
      expect(r.pending()).toBe(0);
      r.rt.dispose();
    });

    it("a Stop holds for a router that reports no hand, until it reports a scene", async () => {
      const r = await live();
      await stopHouse(r);
      r.advance(3);
      reports(r, null, false);
      expect(r.hub.audio.musicHand()).not.toBe(null);
      expect((await r.fire("next")).json).toMatchObject({ why: "hand" });
      r.advance(3);
      reports(r, "act_2", false); // the story's next live music cue
      expect(r.hub.audio.musicHand()).toBe(null);
      expect((await r.fire("next")).status).toBe(200);
      r.rt.dispose();
    });

    it("Follow the story lets go of a Stop", async () => {
      const r = await live();
      await stopHouse(r);
      r.advance(3);
      reports(r, null, true);
      await hostMusic(r, "story");
      r.advance(3);
      reports(r, "act_2", false);
      expect(r.hub.audio.musicHand()).toBe(null);
      r.rt.dispose();
    });

    it("⏸ then ⏵ inside the hold: the return still comes", async () => {
      const r = await live();
      await r.fire("party");
      r.advance(10);
      await hostMusic(r, "pause");
      r.advance(1);
      await hostMusic(r, "resume");
      expect(r.hub.audio.musicHand()).toBe(COSTUME_BY);
      r.advance(19);
      expect(r.hub.audio.musicCommands().at(-1)).toMatchObject({ action: "story", by: COSTUME_BY });
      r.rt.dispose();
    });

    it("a ⏸ that outlasts the hold: the return waits for its ⏵, then comes", async () => {
      const r = await live();
      await r.fire("party");
      r.advance(10);
      await hostMusic(r, "pause");
      reports(r, "afterparty", true);
      r.advance(40);
      reports(r, "afterparty", true);
      expect(actions(r)).toEqual(["scene", "pause"]);
      await hostMusic(r, "resume");
      r.advance(6);
      expect(r.hub.audio.musicCommands().at(-1)).toMatchObject({ action: "story", by: COSTUME_BY });
      expect(r.pending()).toBe(0);
      r.rt.dispose();
    });

    it("a ⏸ the story's next live cue ended owes the hold nothing", async () => {
      const r = await live();
      await r.fire("party");
      r.advance(10);
      await hostMusic(r, "pause");
      r.advance(25);
      reports(r, "act_2", false); // a live cue resumes and lets go
      r.advance(6);
      expect(actions(r)).toEqual(["scene", "pause"]);
      expect(r.pending()).toBe(0);
      r.rt.dispose();
    });

    it("a Stop over a held ⏸ ends the hold's return", async () => {
      const r = await live();
      await r.fire("party");
      r.advance(10);
      await hostMusic(r, "pause");
      await stopHouse(r);
      r.advance(40);
      expect(actions(r)).toEqual(["scene", "pause"]);
      expect(r.pending()).toBe(0);
      r.rt.dispose();
    });
  });

  it("a hold let go of early owes the house no second return", async () => {
    const r = await live();
    await r.fire("party");
    r.advance(10);
    await call(r.rt, "POST", "/api/mod/audio/music", { action: "story" }, { moderator: true });
    r.advance(20);
    expect(r.hub.audio.musicCommands().map((c) => c.action)).toEqual(["scene", "story"]);
    r.rt.dispose();
  });

  it("glitch is the story's ad_burst in a talk scene, the flicker anywhere else, and never reaches # hosts", async () => {
    const r = await live();
    const before = hostsLines(r).length;
    const fired = (name: string) => r.hub.sim.log.all().filter((e) => e["name"] === name).length;
    expect((await r.fire("glitch")).status).toBe(200);
    expect(fired("costume_flicker")).toBe(1);
    expect(fired("ad_burst")).toBe(0);
    r.advance(30);
    await r.setVar("Night.talk", "intro");
    expect((await r.fire("glitch")).status).toBe(200);
    expect(fired("costume_flicker")).toBe(2);
    r.advance(30);
    await r.setVar("Night.talk", "bottle");
    expect((await r.fire("glitch")).status).toBe(200);
    expect(fired("costume_flicker")).toBe(2);
    expect(fired("ad_burst")).toBe(1);
    expect(hostsLines(r).length).toBe(before);
    r.rt.dispose();
  });

  it("the flicker blinks the bulbs, so it waits out the alarm, a blackout and a room he put out", async () => {
    const r = await live();
    await r.setVar("Night.lights", "blackout");
    expect((await r.fire("glitch")).json).toMatchObject({ why: "lights_held" });
    await r.setVar("Night.lights", "none");
    await r.setVar("Night.alarm_on", "true");
    expect((await r.fire("glitch")).json).toMatchObject({ why: "lights_held" });
    r.rt.dispose();
  });

  it("the ad hijack's takeover is left alone", async () => {
    const r = await live();
    await r.setVar("Night.talk", "ad");
    await r.setVar("Night.glitch_kind", "full");
    await r.setVar("Night.glitch_at", String(r.hub.sim.elapsed() / 1000));
    expect((await r.fire("glitch")).json).toMatchObject({ why: "hijack" });
    r.rt.dispose();
  });

  it("an ad storm is three of them, and a closing scene ends it", async () => {
    const r = await live();
    await r.setVar("Night.talk", "ad");
    const count = () => r.hub.sim.log.all().filter((e) => e["name"] === "ad_burst").length;
    expect((await r.fire("storm")).status).toBe(200);
    expect(count()).toBe(1);
    r.advance(4);
    expect(count()).toBe(2);
    await r.setVar("Night.talk", "none");
    r.advance(4);
    expect(count()).toBe(2);
    expect(r.pending()).toBe(0);
    r.rt.dispose();
  });

  it("outside a talk scene an ad storm is three flickers, and a scene opening ends it", async () => {
    const r = await live();
    const count = () => r.hub.sim.log.all().filter((e) => e["name"] === "costume_flicker").length;
    expect((await r.fire("storm")).status).toBe(200);
    r.advance(4);
    expect(count()).toBe(2);
    await r.setVar("Night.talk", "ad");
    r.advance(4);
    expect(count()).toBe(2);
    expect(r.hub.sim.log.all().some((e) => e["name"] === "ad_burst")).toBe(false);
    r.rt.dispose();
  });

  it("a poke is his line in the Desktop for everyone, in turn, by the costume", async () => {
    const r = await live();
    await r.setVar("Trabolta.awake", "true");
    await r.fire("poke");
    r.advance(COSTUME_COOLDOWN_S);
    await r.fire("poke");
    const said = r.hub.chat.all().filter((m) => m.channel === DESK && m.from === "Trabolta").map((m) => m.text);
    expect(said).toEqual(["Ow.", "Stop that."]);
    expect(r.hub.chat.all().filter((m) => m.channel === DESK && m.from === "Trabolta").every((m) => m.audience === "all")).toBe(true);
    r.rt.dispose();
  });

  it("every fire is on the mod log, by the costume, and none is in # hosts", async () => {
    const r = await live();
    await r.setVar("Trabolta.awake", "true");
    const before = hostsLines(r).length;
    await r.fire("poke");
    r.advance(COSTUME_COOLDOWN_S);
    await r.fire("zip");
    await r.fire("zip"); // cooling: no line
    expect(presses(r).map((e) => e["subject"])).toEqual(["POKE", "ZIP"]);
    expect(hostsLines(r).length).toBe(before);
    const page = await call(r.rt, "GET", "/api/mod/log?limit=5000", {}, { moderator: true });
    expect(JSON.stringify(page.json)).toContain(COSTUME_SIGNAL);
    expect(new Store(r.dir).readJournal().filter((l) => l.a[0] === COSTUME_SIGNAL).map((l) => l.by)).toEqual(["🎭 Costume", "🎭 Costume"]);
    r.rt.dispose();
  });

  it("the journal replays a fire to the same story", async () => {
    const r = await live();
    await r.setVar("Trabolta.awake", "true");
    await r.setVar("Night.talk", "ad");
    await r.fire("glitch");
    r.advance(COSTUME_COOLDOWN_S);
    await r.fire("poke");
    r.rt.dispose();
    const again = new EventRuntime({ eventId: "evt", store: new Store(r.dir), codes: CODES, scenarioName: "costume", scenarioSource: STORY, joinBase: () => "https://party.example", hostViewMs: 0 } as never);
    expect(again.restore()).not.toBeNull();
    const sim = (again as unknown as { sim: { world: { peek(p: string): { value?: unknown } | null } } }).sim;
    expect(sim.world.peek("Night.bursts")?.value).toBe(1);
    again.dispose();
  });

  it("a story reset owes the house nothing", async () => {
    const r = await live();
    await r.fire("red");
    expect(r.pending()).toBe(1);
    await call(r.rt, "POST", "/api/mod/reset", {}, { moderator: true });
    expect(r.pending()).toBe(0);
    r.rt.dispose();
  });
});

describe("w59 costume: the file", () => {
  it("a missing or broken project file is the default menu, live", async () => {
    for (const menu of [null, "not json", '{"items": []}']) {
      const { rt, k } = await live({ menu });
      const json = (await call(rt, "POST", "/api/costume/menu", { k })).json as { items: Array<{ label: string }> };
      expect(json.items.map((i) => i.label)).toEqual(DEFAULT_COSTUME.items.map((i) => i.label));
      rt.dispose();
    }
  });

  it("names what it drops", () => {
    const { file, problems } = parseCostume(
      JSON.stringify({
        items: [
          { id: "a", label: "A", sound: "zip" },
          { id: "a", label: "AGAIN", sound: "zip" },
          { id: "b", label: "B", cue: "the_ending" },
          { id: "c", label: "C", music: { action: "stop" } },
          { id: "d", label: "D", music: { action: "scene", scene: "x" } },
          { id: "e", label: "E", items: [{ id: "f", label: "F", items: [{ id: "g", label: "G", sound: "zip" }] }, { id: "h", label: "H" }, { id: "i", label: "I", sound: "zip", poke: true }] },
        ],
      }),
    );
    expect(file?.items.map((i) => i.id)).toEqual(["a"]);
    expect(problems.length).toBeGreaterThanOrEqual(7);
    expect(parseCostume(JSON.stringify({ items: Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, label: "S", sound: "zip" })) })).file?.items.length).toBe(COSTUME_ITEMS_MAX);
    expect(parseCostume("[]").file).toBeNull();
    expect(parseCostume('{"items": [{"id": "a"}]}').file).toBeNull();
  });

  it("a costume item's cue can only be ad_burst or the flicker", () => {
    expect(parseCostume(JSON.stringify({ items: [{ id: "a", label: "A", cue: "tell_the_truth" }] })).file).toBeNull();
  });

  it("the menu read drops everything but ids and labels", () => {
    expect(costumeMenu(DEFAULT_COSTUME, false).items).toEqual([]);
    expect(JSON.stringify(costumeMenu(DEFAULT_COSTUME, true))).not.toContain("action");
  });

  it("saidBy: lines queue behind each other", () => {
    expect(saidBy([{ ts: 1000, text: "x".repeat(10) }, { ts: 1000, text: "x".repeat(10) }], 10)).toBe(3000);
    expect(saidBy([{ ts: 1000, text: "x".repeat(10) }, { ts: 9000, text: "x".repeat(10) }], 10)).toBe(10000);
    expect(saidBy([], 10)).toBe(0);
  });
});

describe("w59 costume: the show's own ending", () => {
  it("every press is refused through the reveal, the bob, the verdict, Grok Prom and the advice poll", async () => {
    const r = await live({ story: scenarioSource("trapped-in-the-internet") });
    const signal = (name: string) => call(r.rt, "POST", "/api/mod/signal", { name }, { moderator: true });
    const peek = (path: string) => (r.hub.sim as unknown as { world: { peek(p: string): { value?: unknown } | null } }).world.peek(path)?.value;
    const refused = async (stage: string) => {
      expect(peek("Night.ended"), stage).not.toBe(true);
      for (const id of ["spot", "zip", "next", "poke"]) expect((await r.fire(id)).json, `${stage}: ${id}`).toMatchObject({ why: "ending" });
    };
    await r.setVar("Trabolta.awake", "true");
    await signal("final_reveal");
    expect(peek("Night.phase")).toBe("final_reveal");
    await refused("the final reveal");
    await signal("bobbing_for_truth");
    expect(peek("Night.phase")).toBe("bobbing");
    await refused("the bobbing");
    await r.setVar("Night.bag_up", "true");
    await r.setVar("Kernel.q1", "lie");
    await signal("read_truth_txt");
    await refused("truth.txt");
    await signal("the_verdict");
    await refused("the verdict's lines");
    for (let i = 0; i < 24 && peek("Night.phase") !== "grok_prom"; i++) r.advance(5);
    expect(peek("Night.phase")).toBe("grok_prom");
    await refused("Grok Prom");
    await signal("ask_for_advice");
    expect(peek("Night.phase")).toBe("advice");
    await refused("the advice poll");
    r.rt.dispose();
  });

  it("the story's step is what a press reads: the reveal is 16, nothing before it reaches that", () => {
    const steps = new Map<string, number>();
    for (const m of readdirStory().matchAll(/set Night\.phase = "([a-z_0-9]+)"\n\s*set Night\.step = (\d+)/gu)) steps.set(m[1]!, Number(m[2]));
    expect(steps.get("final_reveal")).toBe(16);
    expect(steps.get("bobbing")).toBe(17);
    expect(steps.get("grok_prom")).toBe(18);
    expect(steps.get("advice")).toBe(18);
    for (const [phase, step] of steps) expect(step >= 16, phase).toBe(phase === "final_reveal" || phase === "bobbing" || phase === "grok_prom" || phase === "advice" || phase.startsWith("finale"));
  });
});

describe("w59 costume: the show's own menu", () => {
  const dir = new URL("../examples/trapped-in-the-internet/", import.meta.url);
  const read = (name: string) => readFileSync(new URL(name, dir), "utf8");
  const { file, problems } = parseCostume(read(COSTUME_FILE));
  const lights = JSON.parse(read("lights.json")) as LightsConfig;
  const audio = JSON.parse(read("audio.json")) as { cues: Record<string, unknown> };

  it("is clean, and the code's default is the same menu", () => {
    expect(problems).toEqual([]);
    expect(file).toEqual(DEFAULT_COSTUME);
  });

  it("carries the six things the user asked for, in big buttons", () => {
    expect(file?.items.map((i) => i.label)).toEqual(["LIGHTS", "SOUNDS", "MUSIC", "AD STORM", "GLITCH", "POKE TRABOLTA"]);
    expect(file?.items.length).toBeLessThanOrEqual(COSTUME_ITEMS_MAX);
    for (const i of costumeLeaves(file!)) expect(i.label.length, i.label).toBeLessThanOrEqual(COSTUME_LABEL_MAX);
    expect(file?.items.find((i) => i.id === "adstorm")?.cooldownS).toBeGreaterThanOrEqual(60);
  });

  it("no item touches a safety fixture, and every look and sound is the house's", () => {
    expect(costumeHouseProblems(file!, lights, null, Object.keys(audio.cues))).toEqual([]);
    for (const item of costumeLeaves(file!)) {
      if (item.action?.kind !== "light") continue;
      const safety = new Set(lights.fixtures.filter((f) => f.safety === true).map((f) => f.id));
      for (const id of costumeFixtures(lights, null, item.action.to)) expect(safety.has(id), id).toBe(false);
    }
  });

  it("every story look covers what a light item moves, so the restore gives it all back", () => {
    const zones = new Map((lights.zones ?? []).map((z) => [z.id, z.fixtures]));
    const reachOf = (to: readonly string[]) => to.flatMap((t) => zones.get(t) ?? [t]);
    const story = readdirStory();
    const values = [...story.matchAll(/set Night\.lights = "([a-z_0-9]+)"/gu)].map((m) => m[1]!);
    expect(values.length).toBeGreaterThan(10);
    const moved = new Set(costumeLeaves(file!).flatMap((i) => (i.action?.kind === "light" ? reachOf(i.action.to) : [])));
    for (const value of new Set(values)) {
      const name = value === "server_open" ? "lights_y2k" : `lights_${value}`;
      const look = lights.looks[name] as { to?: string[]; steps?: Array<{ to?: string[] }> } | undefined;
      expect(look, name).toBeDefined();
      const covered = new Set((look?.steps ?? [{ to: look?.to }]).flatMap((s) => reachOf(s.to ?? look?.to ?? [])));
      for (const id of moved) expect(covered.has(id), `${name} leaves ${id}`).toBe(true);
    }
  });

  it("his poke lines stay in his world", () => {
    const persona = read("trabolta.persona.md");
    const outside = /^outside:.*\n((?: {2}- .*\n)+)/mu.exec(persona)?.[1] ?? "";
    const words = [...outside.matchAll(/^ {2}- (.+?)(?:\s+#.*| \(not followed by .*)?$/gmu)].map((m) => m[1]!.trim().toLowerCase());
    expect(words.length).toBeGreaterThan(10);
    expect(file?.poke.length).toBeGreaterThanOrEqual(6);
    for (const line of file!.poke) {
      expect(line, line).not.toMatch(/\d/u);
      const said = line.toLowerCase();
      for (const word of [...words, "costume", "ipad", "button", "ctrl", "party", "john", "steph", "jesse", "loom"]) expect(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u").test(said), `${line}: ${word}`).toBe(false);
    }
  });
});

function readdirStory(): string {
  const root = new URL("../examples/trapped-in-the-internet/", import.meta.url);
  const read = (name: string) => readFileSync(new URL(name, root), "utf8");
  return [read("main.loom"), read("beats/finale.loom"), read("beats/desktop.loom")].join("\n");
}
