//! The wall terminals' lean screen state (OCT31 K-16, `server/routes/screen.ts`):
//! `GET /api/screen/state` folds the story's screen cues, says whether the
//! terminal's character is hidden / asleep (→ attract), the running
//! countdown, and each terminal's last poll — and a guest's DM with a
//! character still hidden from them never reaches an agent worker.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { AgentRequest } from "../server/agents.ts";
import { MAX_SCREENS, ScreenWatch, foldProgram, screenCueClass, screenCueOf, screenTargetOf, slidePersists, type ScreenProgram, type ScreenState } from "../server/routes/screen.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";

const SHOW = "trapped-in-the-internet";
const CODES = { event: "EVT161", prime: "PRM161", mod: "MOD161" };
const SLOW = 120_000;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-screen-"));
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
  let buf = "";
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
    write(c: string) {
      buf += c;
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
    frames(): Array<[string, unknown]> {
      return buf
        .split("\n\n")
        .map((bl) => {
          const ev = /^event: (.*)$/mu.exec(bl)?.[1];
          const d = /^data: (.*)$/mu.exec(bl)?.[1];
          return ev !== undefined && d !== undefined ? ([ev, JSON.parse(d)] as [string, unknown]) : null;
        })
        .filter((f): f is [string, unknown] => f !== null);
    },
  };
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, method: string, p: string, body: unknown, o: { moderator?: boolean; token?: string } = {}) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, { moderator: o.moderator ?? false });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    /* a stream */
  }
  return { status: res.statusCode, json, res };
}

describe("screenCueOf", () => {
  it("splits a screen cue family off its value, ignores the rest", () => {
    expect(screenCueOf("screens_call_desktop")).toEqual({ family: "screens", value: "call_desktop" });
    expect(screenCueOf("terminals_trabolta_online")).toEqual({ family: "terminals", value: "trabolta_online" });
    expect(screenCueOf("tv_bingo, fade: 2")).toEqual({ family: "tv", value: "bingo" });
    expect(screenCueOf(" tablet_webmd")).toEqual({ family: "tablet", value: "webmd" });
    expect(screenCueOf("lights_game")).toBeNull();
    expect(screenCueOf("screens_")).toBeNull();
    expect(screenCueOf("screensaver")).toBeNull();
  });
});

describe("the screen program (K-17 + N-03)", () => {
  it("classifies a cue value: overlays, the flicker, countdown corners, bases, slides", () => {
    expect(["blackout", "go_to_living_room", "alarm"].map(screenCueClass)).toEqual(["overlay", "overlay", "overlay"]);
    expect(screenCueClass("flicker")).toBe("flicker");
    expect(screenCueClass("countdown_hunt")).toBe("countdown");
    expect(["screensaver", "attract", "trabolta_online", "mirror"].map(screenCueClass)).toEqual(["base", "base", "base", "base"]);
    expect(["trivia_1", "five_minutes", "bingo", "y2k", "award_best_liar"].map(screenCueClass)).toEqual(["slide", "slide", "slide", "slide", "slide"]);
    expect(["bingo", "y2k", "trust_chart", "truth_txt", "award_most_honest", "ceremony_host"].every(slidePersists)).toBe(true);
    expect(["trivia_1", "bingo_time", "call_desktop", "hunt_results"].some(slidePersists)).toBe(false);
    expect(screenTargetOf("mirror")).toBe("tv");
    expect(screenTargetOf("tv")).toBe("tv");
    expect(screenTargetOf("auto")).toBe("terminals");
    expect(screenTargetOf("")).toBe("terminals");
  });

  it("a countdown keeps the slide; a blackout survives the overlay after it; a slide clears both", () => {
    const shot = (value: string, seq: number) => ({ value, cue: `screens_${value}`, seq, at: seq * 1000 });
    let p: ScreenProgram = { slide: null, overlay: null, blackout: null, flicker: null };
    p = foldProgram(p, shot("trivia_1", 1));
    p = foldProgram(p, shot("countdown_hunt", 2));
    expect(p.slide).toMatchObject({ value: "trivia_1", cue: "screens_trivia_1", kind: "slide", persist: false });
    p = foldProgram(p, shot("flicker", 3));
    expect(p.flicker?.seq).toBe(3);
    expect(p.slide?.value).toBe("trivia_1");
    p = foldProgram(p, shot("blackout", 4));
    p = foldProgram(p, shot("go_to_living_room", 5));
    expect(p.overlay?.value).toBe("go_to_living_room");
    expect(p.blackout?.seq).toBe(4);
    expect(p.slide?.value).toBe("trivia_1"); // under the overlay
    p = foldProgram(p, shot("y2k", 6));
    expect(p).toMatchObject({ overlay: null, blackout: null, slide: { value: "y2k", persist: true } });
    p = foldProgram(p, shot("screensaver", 7));
    expect(p.slide).toMatchObject({ value: "screensaver", kind: "base", persist: false });
  });

  it("splits by target, stamps history 0 and new cues with the clock", () => {
    const sim = Sim.fromSources(
      `# T\n\nwhen v2:\n  cue tv_bingo\n  cue terminals_attract\n\nwhen hunt:\n  cue screens_trivia_1\n  cue screens_countdown_hunt\n\nwhen tent:\n  cue tablet_webmd\n\n== Boot\ncue screens_screensaver\nHi.\n`,
    );
    let t = 50_000;
    const w = new ScreenWatch({ now: () => t });
    const poll = (view: string) => w.poll(sim, { name: view, spot: "", view, character: "" }, () => false);
    sim.fireBeat("Boot");
    expect(poll("mirror")).toMatchObject({ target: "tv", program: { slide: { value: "screensaver", kind: "base", at: 0 } } });
    sim.signal("v2");
    t = 60_000;
    expect(poll("mirror").program.slide).toMatchObject({ value: "bingo", cue: "tv_bingo", persist: true, at: 60_000 });
    expect(poll("auto")).toMatchObject({ target: "terminals", program: { slide: { value: "attract", kind: "base", at: 60_000 } } });
    sim.signal("hunt");
    t = 61_000;
    for (const view of ["mirror", "auto"]) expect(poll(view).program.slide).toMatchObject({ value: "trivia_1", cue: "screens_trivia_1", at: 61_000 });
    sim.signal("tent");
    expect(poll("auto").program.slide?.value).toBe("trivia_1");
    expect(JSON.stringify(poll("auto")).length).toBeLessThan(1500);
  });
});

describe("ScreenWatch — polls", () => {
  it("remembers each named terminal's last poll, most recent first, bounded", () => {
    let t = 1000;
    const w = new ScreenWatch({ now: () => t });
    const who = (name: string) => ({ name, spot: "kitchen", view: "auto", character: "Trabolta" });
    w.poll(null, who("Kitchen"), () => false);
    t = 3000;
    const s = w.poll(null, who("Hall"), () => false);
    expect(s.terminals.map((p) => [p.name, p.ago])).toEqual([
      ["Hall", 0],
      ["Kitchen", 2000],
    ]);
    // No story: no character, never attract (nothing to keep secret yet).
    expect(s.character).toBeNull();
    expect(s.attract).toBe(false);
    w.poll(null, { ...who(""), name: "" }, () => false); // unnamed: not recorded
    for (let i = 0; i < MAX_SCREENS + 5; i++) w.poll(null, who(`T${i}`), () => false);
    expect(w.seen()).toHaveLength(MAX_SCREENS);
    expect(w.seen()[0]!.name).toBe(`T${MAX_SCREENS + 4}`);
  });

  it("a character with no `awake` var is awake; a hidden one is attract until revealed", () => {
    const sim = Sim.fromSources(`# T\n\nCHARACTER Ghost\n  hidden: true\n  mind: external\n\nCHARACTER Clippy\n\nwhen wake the ghost:\n  reveal Ghost\n\n== Boot\nHi.\n`);
    const w = new ScreenWatch();
    const at = (c: string) => w.poll(sim, { name: "K", spot: "", view: "auto", character: c }, (id) => id === "Ghost");
    expect(at("ghost").character).toEqual({ id: "Ghost", hidden: true, awake: true, online: true });
    expect(at("Ghost").attract).toBe(true);
    expect(at("Clippy").attract).toBe(false);
    expect(at("Nobody").character).toBeNull();
    sim.signal("wake the ghost");
    expect(at("Ghost").attract).toBe(false);
  });
});

/** The show up to just before Trabolta's introduction, on a runtime. */
async function showRuntime(dir: string): Promise<EventRuntime> {
  const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: scenarioSource(SHOW), joinBase: () => "http://localhost" });
  rt.openDoors();
  return rt;
}
const state = async (rt: EventRuntime, name = "Kitchen"): Promise<ScreenState> => {
  const r = await call(rt, "GET", `/api/screen/state?name=${name}&spot=kitchen&view=auto&character=Trabolta`, {}, { moderator: true });
  expect(r.status).toBe(200);
  return r.json as unknown as ScreenState;
};
const signal = (rt: EventRuntime, name: string) => call(rt, "POST", "/api/mod/signal", { name }, { moderator: true });

describe("GET /api/screen/state — Trapped in the Internet", () => {
  it("needs the mod capability; a mod token works", { timeout: SLOW }, async () => {
    const rt = await showRuntime(freshDir());
    expect((await call(rt, "GET", "/api/screen/state?name=K", {})).status).toBe(403);
    expect((await call(rt, "GET", "/api/screen/state?name=K", {}, { token: "nope" })).status).toBe(403);
    const login = await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod });
    const token = login.json["token"] as string;
    expect((await call(rt, "GET", "/api/screen/state?name=K", {}, { token })).status).toBe(200);
    rt.dispose();
  });

  it("attract while Trabolta is hidden; the cues, the countdown and the flip at the introduction", { timeout: SLOW }, async () => {
    const dir = freshDir();
    const rt = await showRuntime(dir);
    let s = await state(rt);
    expect(s.character).toMatchObject({ id: "Trabolta", hidden: true, awake: false, online: false });
    expect(s.attract).toBe(true);
    expect(s.night).toEqual({ screen: "screensaver", terminals: "screensaver" });
    expect(s.cues.screens).toEqual({ value: "screensaver", seq: 1 });
    expect(s.countdown).toBeNull();
    expect(JSON.stringify(s).length).toBeLessThan(1500);

    await signal(rt, "call_to_the_desktop");
    s = await state(rt);
    expect(s.cues.screens).toEqual({ value: "call_desktop", seq: 2 });
    expect(s.night.terminals).toBe("call_desktop");
    expect(s.attract).toBe(true);

    await signal(rt, "start_the_bingo");
    s = await state(rt);
    expect(s.cues.tv?.value).toBe("bingo");
    expect(s.cues.terminals?.value).toBe("attract");
    expect(s.countdown).toBe("bingo");
    expect(s.remaining).toBeGreaterThan(1100);
    expect(s.remaining).toBeLessThanOrEqual(1200);
    expect(s.attract).toBe(true);

    const tv = (await call(rt, "GET", `/api/screen/state?name=TV&spot=&view=mirror&character=Trabolta`, {}, { moderator: true })).json as unknown as ScreenState;
    expect(tv).toMatchObject({ target: "tv", attract: true, program: { slide: { cue: "tv_bingo", persist: true } } });
    expect(s).toMatchObject({ target: "terminals", program: { slide: { cue: "terminals_attract", kind: "base" } } });

    await signal(rt, "bingo_time");
    s = await state(rt);
    expect(s.countdown).toBeNull();
    expect(s.cues.terminals).toEqual({ value: "attract", seq: 2 });
    expect(s.attract).toBe(true);

    await signal(rt, "introduce_trabolta");
    s = await state(rt, "Hall");
    expect(s.character).toMatchObject({ hidden: false, awake: true });
    expect(s.attract).toBe(false);
    expect(s.cues.terminals?.value).toBe("trabolta_online");
    expect(s.night.terminals).toBe("trabolta");
    expect(s.terminals.map((t) => t.name)).toEqual(["Hall", "Kitchen", "TV"]);
    expect(s.terminals[0]).toMatchObject({ spot: "kitchen", view: "auto", character: "Trabolta" });

    // A rebooted server replays the journal: the same answer.
    rt.dispose();
    const again = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: scenarioSource(SHOW), joinBase: () => "http://localhost" });
    expect(again.restore()).not.toBeNull();
    const r = await state(again);
    expect(r.attract).toBe(false);
    expect(r.cues).toEqual(s.cues);
    expect(r.night).toEqual(s.night);
    again.dispose();
  });
});

// --- the agent belt: no dispatch for a hidden character ----------------------

const AGENT_SOURCE = `# Uploaded

ROLE Program
  humanity: 0 to 100 = 20

CHARACTER Ghost
  listed: true
  hidden: true
  mind: external

CHARACTER Clippy
  listed: true

when wake the ghost:
  reveal Ghost

== Boot
The house.
`;

describe("agent dispatch for a hidden character", () => {
  it("a guest's DM is refused until the character is revealed; a performer's cast thread always passes", async () => {
    const rt = new EventRuntime({ eventId: "evt", store: new Store(freshDir()), codes: CODES, scenarioName: "t", scenarioSource: AGENT_SOURCE, joinBase: () => "http://localhost" });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Calculator", passcode: CODES.event });
    const token = g.json["token"] as string;
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Ghost&name=laptop", {}, { moderator: true });
    const requests = () => worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);

    await call(rt, "POST", "/api/guest/say", { channel: "dm:Ghost", text: "hello?" }, { token });
    expect(requests()).toHaveLength(0);

    const login = await call(rt, "POST", "/api/prime/login", { character: "Clippy", passcode: CODES.prime });
    const ptoken = login.json["token"] as string;
    expect((await call(rt, "POST", "/api/prime/say", { channel: "cast:Ghost", text: "Boss?" }, { token: ptoken })).status).toBe(200);
    expect(requests().map((r) => r.thread.audience)).toEqual([["@Clippy"]]);

    await signal(rt, "wake the ghost");
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Ghost", text: "now?" }, { token });
    expect(requests().map((r) => r.thread.audience[0])).toEqual(["@Clippy", g.json["id"]]);
    rt.dispose();
  });
});
