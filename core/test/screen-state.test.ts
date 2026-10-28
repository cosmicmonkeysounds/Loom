//! The wall terminals' lean screen state (OCT31 K-16, `server/routes/screen.ts`):
//! `GET /api/screen/state` folds the story's screen cues, says whether the
//! terminal's character is hidden / asleep (→ attract), the running
//! countdown, and each terminal's last poll — and a guest's DM with a
//! character still hidden from them never reaches an agent worker.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it, vi } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { AgentRequest } from "../server/agents.ts";
import type { ChatMessage } from "../server/chat.ts";
import { ANNOUNCE_RING, IDENTIFY_MS, screenDeviceOf, MAX_ANNOUNCE_TEXT, SCREEN_CHARTS, storyMentions, MAX_SCREENS, MAX_VOICE_LINES, announceTextOf, ScreenWatch, TERMINAL_SILENT_MS, screenTerminals, type ScreenTerminals, foldProgram, voiceLinesOf, screenCueClass, screenCueOf, screenTargetOf, slidePersists, type ScreenProgram, type ScreenState } from "../server/routes/screen.ts";
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

/** The wave 20 heart vars (+ wave 22's patch override) as the show sets them
 *  (the story lane owns their values): the night block always carries the
 *  keys, typed. */
function heartNight(s: ScreenState): Pick<ScreenState["night"], "server_door" | "heart_stage" | "heart_look" | "alarm_on" | "lights" | "door_override" | "patch_override"> {
  const n = s.night;
  expect([null, "open", "closed"]).toContain(n.server_door);
  for (const k of ["heart_stage", "heart_look", "lights"] as const) expect(n[k] === null || typeof n[k] === "string").toBe(true);
  for (const k of ["alarm_on", "door_override", "patch_override"] as const) expect(n[k] === null || typeof n[k] === "boolean").toBe(true);
  return { server_door: n.server_door, heart_stage: n.heart_stage, heart_look: n.heart_look, alarm_on: n.alarm_on, lights: n.lights, door_override: n.door_override, patch_override: n.patch_override };
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
    expect(["trivia_1", "bingo_time", "call_desktop"].some(slidePersists)).toBe(false);
    // Wave 18b: a reading holds while Trabolta reads (it may outlast 90 s).
    expect(["hunt_results", "tally"].every(slidePersists)).toBe(true);
    // The finale's waits hold until the story's next screen cue (wave 17).
    expect(["bobbing", "advice", "grok_prom", "banish"].every(slidePersists)).toBe(true);
    expect(["final_reveal", "song", "rave", "dancing_baby", "bobbing_extra"].some(slidePersists)).toBe(false);
    expect(screenTargetOf("mirror")).toBe("tv");
    expect(screenTargetOf("tv")).toBe("tv");
    expect(screenTargetOf("auto")).toBe("terminals");
    expect(screenTargetOf("")).toBe("terminals");
  });

  it("a countdown keeps the slide; a blackout survives the overlay after it; a slide clears both", () => {
    const shot = (value: string, seq: number) => ({ value, cue: `screens_${value}`, seq, at: seq * 1000 });
    let p: ScreenProgram = { slide: null, overlay: null, blackout: null, flicker: null, glitch: null };
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

describe("ScreenWatch — review fixes", () => {
  it("a first look at an empty log seeds the fold: the next cues carry the clock, not history's 0", () => {
    // No entry beat: the log is empty, as after a restart while paused or before doors open.
    const sim = Sim.fromSources(`# T\n\nwhen hunt:\n  cue screens_trivia_1\n  cue screens_blackout\n\n== Later\nHi.\n`);
    expect(sim.log.all()).toHaveLength(0);
    let t = 70_000;
    const w = new ScreenWatch({ now: () => t });
    const poll = () => w.poll(sim, { name: "K", spot: "", view: "auto", character: "" }, () => false);
    expect(poll().program.slide).toBeNull();
    sim.signal("hunt");
    t = 71_000;
    const p = poll().program;
    expect(p.slide).toMatchObject({ value: "trivia_1", at: 71_000, persist: false });
    expect(p.blackout).toMatchObject({ value: "blackout", at: 71_000 });
  });

  it("the alarm overlay stands only while Night.alarm_on is true (the story clears it with no cue)", () => {
    const sim = Sim.fromSources(
      `# T\n\nwhen trip:\n  set Night.alarm_on = true\n  cue screens_alarm\n\nwhen calm:\n  set Night.alarm_on = false\n\nwhen drill:\n  cue screens_go_to_living_room\n\n== Boot\nset Night.alarm_on = false\n`,
    );
    sim.fireBeat("Boot");
    const w = new ScreenWatch();
    const poll = (view = "auto") => w.poll(sim, { name: view, spot: "", view, character: "" }, () => false);
    expect(poll().program.overlay).toBeNull();
    sim.signal("trip");
    expect(poll().program.overlay?.value).toBe("alarm");
    expect(poll("mirror").program.overlay?.value).toBe("alarm");
    sim.signal("calm");
    expect(poll().program.overlay).toBeNull();
    expect(poll("mirror").program.overlay).toBeNull();
    // Other overlays don't follow the alarm var.
    sim.signal("drill");
    expect(poll().program.overlay?.value).toBe("go_to_living_room");
  });

  it("the Trust Chart slide carries every cleared participant, ranked live; other screens carry none", () => {
    const sim = Sim.fromSources(
      `# T\n\nROLE Guest\n  cleared: bool = false\n  trust: -300 to 300 = 0\n\nwhen chart:\n  set Night.screen = "trust_chart"\n  set Night.terminals = "trust_chart"\n\n== Boot\nset Night.screen = "screensaver"\n`,
    );
    sim.fireBeat("Boot");
    for (const [id, name, trust] of [["a", "Calculator", 30], ["b", "Winamp", 10], ["c", "Napster", 10], ["d", "Ghost", 99]] as const) {
      sim.createPerson(id, name);
      sim.setVar(`${id}.trust`, String(trust));
      if (id !== "d") sim.setVar(`${id}.cleared`, "true"); // d never cleared: off the chart
    }
    let now = 1_000;
    const w = new ScreenWatch({ now: () => now });
    const poll = (view = "auto") => w.poll(sim, { name: view, spot: "", view, character: "" }, () => false);
    expect(poll().chart).toBeNull();
    sim.signal("chart");
    now = 5_000;
    // No Night.most_/least_trusted in this story: the call-outs are the ranked ends.
    expect(poll().chart).toEqual({ slide: "trust_chart", rows: [{ name: "Calculator", value: 30 }, { name: "Napster", value: 10 }, { name: "Winamp", value: 10 }], top: "Calculator", bottom: "Winamp", revealAt: 5_000 });
    sim.setVar("b.trust", "40"); // an assessment mid-chart moves a name at the next poll
    now = 6_000;
    const tv = poll("tv").chart;
    expect(tv?.rows[0]).toEqual({ name: "Winamp", value: 40 });
    expect(tv?.top).toBe("Winamp");
    expect(tv?.revealAt).toBe(6_000); // the TV's first look at the chart
    now = 9_000;
    expect(poll().chart?.revealAt).toBe(5_000); // a later poll (a reloaded tablet) never restarts the reveal
  });

  it("the chart's call-outs follow the story's Night.most_/least_trusted ('none' = nobody yet); a chart up in history never re-reveals", () => {
    const src = `# T\n\nROLE Guest\n  cleared: bool = false\n  trust: -300 to 300 = 0\n\nwhen chart:\n  set Night.screen = "trust_chart"\n  set Night.terminals = "trust_chart"\n\nwhen rank:\n  set Night.most_trusted = "none"\n  set Night.least_trusted = "none"\n\nwhen praise:\n  set Night.most_trusted = "Winamp"\n\nwhen shame:\n  set Night.least_trusted = "Napster"\n\nwhen away:\n  set Night.screen = "screensaver"\n  set Night.terminals = "screensaver"\n\n== Boot\nset Night.screen = "screensaver"\n`;
    const sim = Sim.fromSources(src);
    sim.fireBeat("Boot");
    for (const [id, name, trust] of [["a", "Calculator", 30], ["b", "Winamp", 10], ["c", "Napster", -10]] as const) {
      sim.createPerson(id, name);
      sim.setVar(`${id}.trust`, String(trust));
      sim.setVar(`${id}.cleared`, "true");
    }
    let now = 1_000;
    const w = new ScreenWatch({ now: () => now });
    const poll = (view = "auto") => w.poll(sim, { name: view, spot: "", view, character: "" }, () => false);
    expect(poll().chart).toBeNull();
    sim.signal("chart");
    now = 2_000;
    // The story has the vars but hasn't set them: nobody is called out.
    expect(poll().chart).toMatchObject({ top: null, bottom: null, revealAt: 2_000 });
    sim.signal("rank");
    expect(poll().chart).toMatchObject({ top: null, bottom: null });
    sim.signal("praise");
    expect(poll().chart).toMatchObject({ top: "Winamp", bottom: null }); // the story's name, not the ranked top
    sim.signal("shame");
    expect(poll("tv").chart).toMatchObject({ top: "Winamp", bottom: "Napster" });
    // The slide comes down and back up: a fresh reveal.
    sim.signal("away");
    now = 3_000;
    expect(poll().chart).toBeNull();
    sim.signal("chart");
    now = 4_000;
    expect(poll().chart?.revealAt).toBe(4_000);
    // A restart (a fresh watch over a sim whose chart is already up): history, revealAt 0 on both targets.
    const again = new ScreenWatch({ now: () => now });
    expect(again.poll(sim, { name: "t", spot: "", view: "auto", character: "" }, () => false).chart?.revealAt).toBe(0);
    now = 8_000;
    expect(again.poll(sim, { name: "tv", spot: "", view: "tv", character: "" }, () => false).chart?.revealAt).toBe(0);
  });

  it("the show's Trust Chart reads its own call-outs (it mentions both vars)", () => {
    const sim = Sim.fromSources(scenarioSource(SHOW));
    expect([...storyMentions(sim.model, SCREEN_CHARTS.flatMap((c) => [c.top, c.bottom]))].sort()).toEqual(["Night.least_trusted", "Night.most_trusted"]);
  });

  it("a story without the alarm var keeps the alarm overlay until the next slide", () => {
    const sim = Sim.fromSources(`# T\n\nwhen trip:\n  cue screens_alarm\n\n== Boot\nHi.\n`);
    sim.fireBeat("Boot");
    const w = new ScreenWatch();
    sim.signal("trip");
    expect(w.poll(sim, { name: "K", spot: "", view: "auto", character: "" }, () => false).program.overlay?.value).toBe("alarm");
  });

  it("the TV's voice block carries only its own character and the text-only lore speakers, never guests' typed chat", () => {
    const sim = Sim.fromSources(`# T\n\nCHARACTER Trabolta\n\nCHARACTER Calculator\n\nCHARACTER Sandy\n\nCHARACTER Clippy\n\nLOCATION The Desktop\n\n== Boot\nHi.\n`);
    const m = (seq: number, from: string, beat: string | null = null): ChatMessage => ({
      seq,
      channel: "loc:The Desktop",
      channelKind: "location",
      title: "The Desktop",
      from,
      kind: "line",
      text: `line ${seq}`,
      ts: 0,
      audience: "all",
      parentSeq: null,
      hidden: false,
      beat,
    });
    const ms = [m(0, "Trabolta", "Intro"), m(1, "Calculator"), m(2, "Sandy", "Song Ending"), m(3, "Clippy", "Bingo"), m(4, "Trabolta")];
    const w = new ScreenWatch();
    const s = w.poll(sim, { name: "TV", spot: "", view: "tv", character: "trabolta", voice: "The Desktop", after: -1 }, () => false, ms);
    expect(s.voice?.lines.map((l) => [l.seq, l.from])).toEqual([
      [0, "Trabolta"],
      [2, "Sandy"],
      [4, "Trabolta"],
    ]);
    expect(s.voice?.head).toBe(4);
  });
});

describe("ScreenWatch — polls", () => {
  it("remembers each named terminal's last poll, most recent first, bounded", () => {
    let t = 1000;
    const w = new ScreenWatch({ now: () => t });
    const who = (name: string) => ({ name, spot: "start-bar", view: "auto", character: "Trabolta" });
    w.poll(null, who("Kitchen"), () => false);
    t = 3000;
    const s = w.poll(null, who("Hall"), () => false);
    // Wave 17: the heartbeat list is the director's (`seen`), not on every answer.
    expect("terminals" in s).toBe(false);
    expect(w.seen().map((p) => [p.name, p.ago])).toEqual([
      ["Hall", 0],
      ["Kitchen", 2000],
    ]);
    // No story: no character; a terminal that names one fails closed
    // (attract: its face and name wait for the introduction), one that
    // names none (a chess or casino table) never is.
    expect(s.character).toBeNull();
    expect(s.attract).toBe(true);
    expect(w.poll(null, { ...who("Casino"), character: "" }, () => false).attract).toBe(false);
    w.poll(null, { ...who(""), name: "" }, () => false); // unnamed: not recorded
    for (let i = 0; i < MAX_SCREENS + 5; i++) w.poll(null, who(`T${i}`), () => false);
    expect(w.seen()).toHaveLength(MAX_SCREENS);
    expect(w.seen()[0]!.name).toBe(`T${MAX_SCREENS + 4}`);
  });

  it("a character with no `awake` var is awake; a hidden one is attract until revealed", () => {
    const sim = Sim.fromSources(`# T\n\nCHARACTER Ghost\n  hidden: true\n  mind: external\n\nCHARACTER Clippy\n\nwhen wake the ghost:\n  reveal Ghost\n\n== Boot\nHi.\n`);
    const w = new ScreenWatch();
    const at = (c: string) => w.poll(sim, { name: "K", spot: "", view: "auto", character: c }, (id) => id === "Ghost");
    expect(at("ghost").character).toEqual({ id: "Ghost", hidden: true, awake: true, online: true, hold: false });
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
  const r = await call(rt, "GET", `/api/screen/state?name=${name}&spot=start-bar&view=auto&character=Trabolta`, {}, { moderator: true });
  expect(r.status).toBe(200);
  return r.json as unknown as ScreenState;
};
const signal = (rt: EventRuntime, name: string) => call(rt, "POST", "/api/mod/signal", { name }, { moderator: true });

describe("GET /api/screen/state — Trapped in the Internet", () => {
  it("Power On is a live moment on a real door-open and on a restart with the doors open (livetv-1)", { timeout: SLOW }, async () => {
    const rt = new EventRuntime({ eventId: "evt", store: new Store(freshDir()), codes: CODES, scenarioName: SHOW, scenarioSource: scenarioSource(SHOW), joinBase: () => "http://localhost" });
    const before = await state(rt);
    expect(before.moments).toEqual([]); // no sim yet
    expect(before.character).toBeNull();
    expect(before.attract).toBe(true); // a named character fails closed before the doors (livetv-2)
    expect((await call(rt, "POST", "/api/mod/start", {}, { moderator: true })).status).toBe(200);
    const first = (await state(rt)).moments.filter((m) => m.kind === "beat" && m.name === "Power On");
    expect(first).toHaveLength(1);
    expect(first[0]!.at).toBeGreaterThan(0);
    expect((await call(rt, "POST", "/api/mod/reset", {}, { moderator: true })).status).toBe(200);
    const again = (await state(rt)).moments.filter((m) => m.kind === "beat" && m.name === "Power On");
    expect(again).toHaveLength(1);
    expect(again[0]!.at).toBeGreaterThan(0);
    rt.dispose();
  });

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
    expect(s.night).toEqual({ screen: "screensaver", terminals: "screensaver", phase: "arrivals", step: 0, bottle_pick: null, bottle_open: false, results_q: 0, award_winner: null, award_value: null, help_votes: 0, thwart_votes: 0, alerts: "sticky", ended: false, collection_complete: false, scenario: null, most_trusted: null, least_trusted: null, facts_accepted: null, first_reinstall: null, ...heartNight(s), music: "doors" });
    // The doors' entry beat is live (the sim is folded from its birth), so
    // the TV's Power On scene plays on a real door-open.
    expect(s.moments.find((m) => m.kind === "beat" && m.name === "Power On")).toMatchObject({ seq: 1 });
    expect(s.moments.every((m) => m.at > 0)).toBe(true);
    expect(s.cues.screens).toEqual({ value: "screensaver", seq: 1 });
    expect(s.countdown).toBeNull();
    expect(JSON.stringify(s).length).toBeLessThan(1500);

    expect(s.announce).toBeNull();

    await signal(rt, "call_to_the_desktop");
    s = await state(rt);
    expect(s.cues.screens).toEqual({ value: "call_desktop", seq: 2 });
    // N-09: the summons is the night's first house announcement.
    expect(s.announce).toMatchObject({ seq: 1, text: "All programs, report to the Desktop. A game is about to begin." });
    expect(s.announce!.at).toBeGreaterThan(0);
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
    const beats = (await call(rt, "GET", "/api/mod/screen/terminals", {}, { moderator: true })).json as unknown as ScreenTerminals;
    expect(beats.terminals.map((t) => t.name)).toEqual(["Hall", "Kitchen", "TV"]);
    expect(beats.terminals[0]).toMatchObject({ spot: "start-bar", view: "auto", character: "Trabolta" });

    // A rebooted server replays the journal: the same answer.
    rt.dispose();
    const again = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: scenarioSource(SHOW), joinBase: () => "http://localhost" });
    expect(again.restore()).not.toBeNull();
    const r = await state(again);
    expect(r.attract).toBe(false);
    expect(r.cues).toEqual(s.cues);
    expect(r.night).toEqual(s.night);
    // The same announcement, stamped as history: no terminal says it again.
    expect(r.announce).toEqual({ seq: s.announce!.seq, text: s.announce!.text, at: 0 });
    // The replayed journal (Power On included) is history: no moment replays.
    expect(r.moments).toEqual([]);
    again.dispose();
  });
});

// --- the house announcement (N-09) --------------------------------------------

describe("announceTextOf", () => {
  it("reads the words like stagehand's {target}: quoted or bare, named args skipped", () => {
    expect(announceTextOf(`"Go to the living room."`)).toBe("Go to the living room.");
    expect(announceTextOf(`"All programs, report to the Desktop."`)).toBe("All programs, report to the Desktop.");
    expect(announceTextOf(`Five minutes.`)).toBe("Five minutes.");
    expect(announceTextOf(`voice: af_sky, "Time is up."`)).toBe("Time is up.");
    expect(announceTextOf(`'Single quotes.', chime: false`)).toBe("Single quotes.");
    expect(announceTextOf(`  "  spaced\n  out  "  `)).toBe("spaced out");
    expect(announceTextOf(``)).toBeNull();
    expect(announceTextOf(`""`)).toBeNull();
    expect(announceTextOf(`{target}`)).toBeNull();
    const long = announceTextOf(`"${"word ".repeat(100)}"`)!;
    expect(long.length).toBeLessThanOrEqual(MAX_ANNOUNCE_TEXT);
    expect(long.endsWith("word")).toBe(true);
  });
});

describe("ScreenWatch — the announcement", () => {
  it("carries the latest one: history at 0, new ones on the clock, a fresh sim starts over", () => {
    const src = `# T\n\nwhen call:\n  do announce "Report to the Desktop."\n\nwhen later:\n  do announce "Go to the living room, {Night.n}."\n  do jingle "not an announcement"\n\n== Boot\nset Night.n = 3\ndo announce "Doors are open."\n`;
    const sim = Sim.fromSources(src);
    let t = 10_000;
    const w = new ScreenWatch({ now: () => t });
    const poll = (s: Sim = sim) => w.poll(s, { name: "K", spot: "", view: "auto", character: "" }, () => false).announce;
    expect(poll()).toBeNull();
    sim.fireBeat("Boot");
    t = 11_000;
    expect(poll()).toEqual({ seq: 1, text: "Doors are open.", at: 11_000 });
    sim.signal("call");
    sim.signal("later");
    t = 12_000;
    expect(poll()).toEqual({ seq: 3, text: "Go to the living room, 3.", at: 12_000 }); // the latest; interpolated
    expect(poll()).toEqual({ seq: 3, text: "Go to the living room, 3.", at: 12_000 }); // stable between polls
    // A rebooted server's first look is history.
    const replayed = Sim.fromSources(src);
    replayed.fireBeat("Boot");
    expect(new ScreenWatch({ now: () => 99_000 }).poll(replayed, { name: "K", spot: "", view: "auto", character: "" }, () => false).announce).toEqual({ seq: 1, text: "Doors are open.", at: 0 });
    // A story restart (a new sim with nothing announced yet) clears it.
    expect(poll(Sim.fromSources(src))).toBeNull();
  });

  it("carries the last ANNOUNCE_RING, oldest first, so two inside one poll are both there; a restart clears them", () => {
    const src = `# T\n\nwhen call:\n  do announce "One."\n  do announce "Two."\n\nwhen later:\n  do announce "Three."\n  do announce "Four."\n`;
    const sim = Sim.fromSources(src);
    let t = 10_000;
    const w = new ScreenWatch({ now: () => t });
    const who = { name: "K", spot: "", view: "auto", character: "" };
    expect(w.poll(sim, who, () => false).announces).toEqual([]);
    sim.signal("call");
    t = 11_000;
    const s = w.poll(sim, who, () => false);
    expect(s.announces).toEqual([
      { seq: 1, text: "One.", at: 11_000 },
      { seq: 2, text: "Two.", at: 11_000 },
    ]);
    expect(s.announce).toEqual(s.announces[1]);
    sim.signal("later");
    t = 12_000;
    expect(w.poll(sim, who, () => false).announces.map((a) => a.seq)).toEqual([2, 3, 4].slice(-ANNOUNCE_RING));
    // A restart (a fresh sim) starts the ring over; replayed history is at 0.
    const fresh = Sim.fromSources(src);
    fresh.signal("call");
    expect(w.poll(fresh, who, () => false).announces).toEqual([
      { seq: 1, text: "One.", at: 0 },
      { seq: 2, text: "Two.", at: 0 },
    ]);
    expect(w.poll(Sim.fromSources(src), who, () => false).announces).toEqual([]);
  });

  it("announceEpoch changes with the sim (a restart) and per watch (a boot), never between polls", () => {
    const src = `# T\n\nwhen call:\n  do announce "One."\n`;
    const sim = Sim.fromSources(src);
    const w = new ScreenWatch();
    const who = { name: "K", spot: "", view: "auto", character: "" };
    const e1 = w.poll(sim, who, () => false).announceEpoch;
    sim.signal("call");
    expect(w.poll(sim, who, () => false).announceEpoch).toBe(e1);
    const e2 = w.poll(Sim.fromSources(src), who, () => false).announceEpoch;
    expect(e2).not.toBe(e1);
    expect(new ScreenWatch().poll(sim, who, () => false).announceEpoch).not.toBe(e1);
  });
});

// --- the room voice (K-18 + N-04b) ------------------------------------------

describe("voiceLinesOf", () => {
  const msg = (seq: number, o: Partial<ChatMessage> = {}): ChatMessage => ({
    seq,
    channel: "loc:The Desktop",
    channelKind: "location",
    title: "The Desktop",
    from: "Trabolta",
    kind: "line",
    text: `line ${seq}`,
    ts: 0,
    audience: "all",
    parentSeq: null,
    hidden: false,
    ...o,
  });
  const isChar = (f: string) => f === "Trabolta" || f === "Sandy";

  it("keeps characters' lines in the room after the cursor; no backlog on boot", () => {
    const ms = [
      msg(0),
      msg(1, { from: "Narrator", kind: "narration" }),
      msg(2, { channel: "lobby" }),
      msg(3, { from: "Calculator" }), // typed guest chat
      msg(4, { hidden: true }),
      msg(5, { from: "Sandy", beat: "Song Ending" }),
      msg(6, { beat: "Trabolta Introduction" }),
    ];
    expect(voiceLinesOf(ms, "loc:The Desktop", null, isChar)).toEqual({ head: 6, lines: [] });
    expect(voiceLinesOf(ms, "loc:The Desktop", -1, isChar).lines.map((l) => [l.seq, l.from, l.beat])).toEqual([
      [0, "Trabolta", null],
      [5, "Sandy", "Song Ending"],
      [6, "Trabolta", "Trabolta Introduction"],
    ]);
    expect(voiceLinesOf(ms, "loc:The Desktop", 5, isChar).lines.map((l) => l.seq)).toEqual([6]);
    // A cursor past the head (the server restarted): nothing, resync to head.
    expect(voiceLinesOf(ms, "loc:The Desktop", 40, isChar)).toEqual({ head: 6, lines: [] });
    expect(voiceLinesOf([], "loc:The Desktop", 3, isChar)).toEqual({ head: -1, lines: [] });
  });

  it("an answer carries at most the newest MAX_VOICE_LINES; a whole beat fits", () => {
    expect(MAX_VOICE_LINES).toBeGreaterThanOrEqual(20);
    const n = MAX_VOICE_LINES + 20;
    const ms = Array.from({ length: n }, (_, i) => msg(i));
    expect(voiceLinesOf(ms, "loc:The Desktop", 0, isChar).lines.map((l) => l.seq)).toEqual(Array.from({ length: MAX_VOICE_LINES }, (_, i) => n - MAX_VOICE_LINES + i));
  });
});

describe("GET /api/screen/state?voice= — the TV room voice", () => {
  it("Trabolta's Desktop lines after a seq, a director's say as Trabolta, the mute", { timeout: SLOW }, async () => {
    const rt = await showRuntime(freshDir());
    const tv = async (after: number | null) => {
      const q = `/api/screen/state?name=TV&spot=desktop-tv&view=tv&character=Trabolta&voice=The%20Desktop${after === null ? "" : `&after=${after}`}`;
      const r = await call(rt, "GET", q, {}, { moderator: true });
      expect(r.status).toBe(200);
      return r.json as unknown as ScreenState;
    };
    // A terminal that names no voice room gets no voice block.
    expect((await state(rt)).voice).toBeUndefined();
    const boot = await tv(null);
    expect(boot.voice).toMatchObject({ room: "loc:The Desktop", muted: false, lines: [] });
    let cursor = boot.voice!.head;
    expect(cursor).toBeGreaterThanOrEqual(0);

    for (const name of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta"]) await signal(rt, name);
    let s = await tv(cursor);
    expect(s.attract).toBe(false);
    const hello = s.voice!.lines.find((l) => l.from === "Trabolta");
    expect(hello).toMatchObject({ beat: "Trabolta Introduction" });
    expect(hello!.text).toMatch(/^HELLO, PROGRAMS/u);
    expect(s.voice!.lines.every((l) => l.from !== "Narrator")).toBe(true);
    cursor = s.voice!.head;

    // A director speaks as Trabolta in the Desktop: a line with no beat.
    expect((await call(rt, "POST", "/api/mod/say", { as: "Trabolta", channel: "loc:The Desktop", text: "And the award goes to…" }, { moderator: true })).status).toBe(200);
    s = await tv(cursor);
    expect(s.voice!.lines).toEqual([{ seq: s.voice!.head, from: "Trabolta", text: "And the award goes to…", beat: null }]);
    expect((await tv(s.voice!.head)).voice!.lines).toEqual([]);

    // The mute: mod-gated, read back by every TV poll.
    expect((await call(rt, "POST", "/api/mod/screen/voice", { muted: true })).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/screen/voice", { muted: true }, { moderator: true })).json).toEqual({ muted: true });
    expect((await tv(s.voice!.head)).voice!.muted).toBe(true);
    expect((await call(rt, "POST", "/api/mod/screen/voice", {}, { moderator: true })).json).toEqual({ muted: true });
    expect((await call(rt, "POST", "/api/mod/screen/voice", { muted: false }, { moderator: true })).json).toEqual({ muted: false });

    // An unknown room answers an empty voice, never another room's lines.
    const r = await call(rt, "GET", `/api/screen/state?name=TV&view=tv&character=Trabolta&voice=Nowhere&after=0`, {}, { moderator: true });
    expect((r.json as unknown as ScreenState).voice).toMatchObject({ room: "", lines: [] });
    rt.dispose();
  });
});

// --- the room terminal (wave 7: the server-room terminal) --------------------

const ROOM_SOURCE = `# Vault

ROLE Program
  humanity: 0 to 100 = 20
  when vault_peek for program:
    reveal The Server Room for program

CHARACTER Trabolta
  listed: true

CHARACTER Clippy
  listed: true

LOCATION The Desktop

LOCATION The Server Room
  label: The Server Room (cold storage)
  hidden: true

when door_opened:
  -> The Heart

== The Heart
  setting: The Server Room
reveal The Server Room
Trabolta: You found my heart.
Clippy: It looks like you're in a server room.
Trabolta: Sit. Let us speak plainly.

== Boot
  setting: The Desktop
Trabolta: Hello, programs.
`;

describe("ScreenWatch — a room terminal (wave 7)", () => {
  it("sleeps until its LOCATION is open to everyone; a per-person reveal doesn't count; an unknown room never wakes", () => {
    const sim = Sim.fromSources(ROOM_SOURCE);
    const w = new ScreenWatch();
    const poll = (room: string) => w.poll(sim, { name: "Server Room", spot: "server-room", view: "face", character: "Trabolta", room, after: -1 }, () => true);
    let s = poll("the server room");
    expect(s.room).toEqual({ id: "The Server Room", open: false, cue: null });
    expect(s.character?.hidden).toBe(false);
    expect(s.attract).toBe(true);
    // A terminal with no room is unchanged: awake, no room block.
    const plain = w.poll(sim, { name: "Kitchen", spot: "start-bar", view: "auto", character: "Trabolta" }, () => true);
    expect(plain.room).toBeUndefined();
    expect(plain.attract).toBe(false);
    // By label too; an unknown name is closed with no id.
    expect(poll("The Server Room (cold storage)").room).toEqual({ id: "The Server Room", open: false, cue: null });
    expect(poll("The Vault").room).toEqual({ id: "", open: false, cue: null });
    expect(poll("The Vault").attract).toBe(true);
    // An open (never hidden) room is open at once.
    expect(poll("The Desktop")).toMatchObject({ room: { id: "The Desktop", open: true }, attract: false });

    sim.createPerson("p1", "Ada");
    sim.signal("vault_peek", "p1");
    expect(sim.isRevealedTo("The Server Room", "p1")).toBe(true);
    expect(poll("The Server Room").attract).toBe(true);
    sim.signal("door_opened");
    s = poll("The Server Room");
    expect(s.room).toEqual({ id: "The Server Room", open: true, cue: null });
    expect(s.attract).toBe(false);
    // The heartbeat names the room.
    expect(w.seen().find((p) => p.name === "Server Room")?.room).toBe("The Server Room");
    expect(w.seen().find((p) => p.name === "Kitchen")?.room).toBeUndefined();
  });

  it("no story: a room terminal is closed (attract), never open", () => {
    const s = new ScreenWatch().poll(null, { name: "Server Room", spot: "", view: "face", character: "Trabolta", room: "The Server Room" }, () => false);
    expect(s.room).toEqual({ id: "", open: false, cue: null });
    expect(s.attract).toBe(true);
  });

  it("before the doors the declared LOCATIONs name the room (asleep); a typo is still no room (S1-03)", () => {
    const model = Sim.fromSources(ROOM_SOURCE).model;
    const w = new ScreenWatch();
    const poll = (room: string) => w.poll(null, { name: "Server Room", spot: "", view: "face", character: "Trabolta", room }, () => false, [], model);
    expect(poll("The Server Room")).toMatchObject({ room: { id: "The Server Room", open: false }, attract: true });
    // Even a never-hidden room stays closed until a sim says so.
    expect(poll("The Desktop").room).toEqual({ id: "The Desktop", open: false, cue: null });
    expect(poll("The Vault").room).toEqual({ id: "", open: false, cue: null });
  });
});

describe("GET /api/screen/state?room= — the room terminal", () => {
  const roomRuntime = (dir: string) => {
    const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: "vault", scenarioSource: ROOM_SOURCE, joinBase: () => "http://localhost" });
    rt.openDoors();
    return rt;
  };

  it("before the doors a provisioned room terminal is named and asleep; a typo has no id (S1-03)", async () => {
    const rt = new EventRuntime({ eventId: "evt", store: new Store(freshDir()), codes: CODES, scenarioName: "vault", scenarioSource: ROOM_SOURCE, joinBase: () => "http://localhost" });
    expect(rt.liveSim).toBeNull();
    const room = async (name: string) => ((await call(rt, "GET", `/api/screen/state?name=Server%20Room&view=face&character=Trabolta&room=${encodeURIComponent(name)}`, {}, { moderator: true })).json as unknown as ScreenState).room;
    expect(await room("The Server Room")).toEqual({ id: "The Server Room", open: false, cue: null });
    expect(await room("The Servr Room")).toEqual({ id: "", open: false, cue: null });
  });

  it("answers the room and its voice; the cutscene's lines arrive with the wake; the TV mute never silences it", { timeout: SLOW }, async () => {
    const rt = roomRuntime(freshDir());
    const get = async (q: string) => {
      const r = await call(rt, "GET", `/api/screen/state?${q}`, {}, { moderator: true });
      expect(r.status).toBe(200);
      return r.json as unknown as ScreenState;
    };
    const room = (after: number | null) => get(`name=Server%20Room&spot=server-room&view=face&character=Trabolta&room=The%20Server%20Room${after === null ? "" : `&after=${after}`}`);
    const tv = (after: number) => get(`name=TV&spot=desktop-tv&view=tv&character=Trabolta&voice=The%20Desktop&after=${after}`);

    let s = await room(null);
    expect(s.room).toEqual({ id: "The Server Room", open: false, cue: null });
    expect(s.attract).toBe(true);
    expect(s.voice).toMatchObject({ room: "loc:The Server Room", muted: false, lines: [] });
    const asleep = s.voice!.head;

    // The door opens: the reveal and the lines land together.
    expect((await signal(rt, "door_opened")).status).toBe(200);
    s = await room(asleep);
    expect(s.room).toEqual({ id: "The Server Room", open: true, cue: null });
    expect(s.attract).toBe(false);
    expect(s.voice!.lines.map((l) => [l.from, l.text])).toEqual([
      ["Trabolta", "You found my heart."],
      ["Trabolta", "Sit. Let us speak plainly."],
    ]);

    // The TV's mute: the TV is muted, the room terminal is not.
    expect((await call(rt, "POST", "/api/mod/screen/voice", { muted: true }, { moderator: true })).json).toEqual({ muted: true });
    expect((await tv(0)).voice!.muted).toBe(true);
    expect((await room(s.voice!.head)).voice!.muted).toBe(false);
    // A room terminal that also names a voice room speaks that one.
    const both = await get(`name=X&view=face&character=Trabolta&room=The%20Server%20Room&voice=The%20Desktop&after=-1`);
    expect(both.voice!.room).toBe("loc:The Desktop");
    expect(both.room).toEqual({ id: "The Server Room", open: true, cue: null });
    rt.dispose();
  });

  it("the show: the Server Room is closed at the doors", { timeout: SLOW }, async () => {
    const rt = await showRuntime(freshDir());
    const r = await call(rt, "GET", `/api/screen/state?name=Server%20Room&spot=server-room&view=face&character=Trabolta&room=The%20Server%20Room`, {}, { moderator: true });
    const s = r.json as unknown as ScreenState;
    expect(s.room).toEqual({ id: "The Server Room", open: false, cue: null });
    expect(s.attract).toBe(true);
    rt.dispose();
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

// --- the director's heartbeat card (K-29) -------------------------------------

describe("GET /api/mod/screen/terminals — the heartbeat card", () => {
  it("lists each terminal's last poll with the server clock and the TV mute; reading never records a poll", () => {
    let t = 50_000;
    const w = new ScreenWatch({ now: () => t });
    w.poll(null, { name: "Kitchen", spot: "start-bar", view: "auto", character: "Trabolta" }, () => false);
    t += TERMINAL_SILENT_MS + 1;
    w.poll(null, { name: "TV", spot: "", view: "tv", character: "Trabolta" }, () => false);
    w.voiceMuted = true;
    const r = screenTerminals(w);
    expect(r).toMatchObject({ now: t, voiceMuted: true, silentMs: TERMINAL_SILENT_MS });
    expect(r.terminals.map((p) => [p.name, p.view, p.ago])).toEqual([
      ["TV", "tv", 0],
      ["Kitchen", "auto", TERMINAL_SILENT_MS + 1],
    ]);
    expect(screenTerminals(w).terminals).toHaveLength(2);
  });

  it("is mod-gated (author session or mod token) and doesn't count the editor as a terminal", async () => {
    const rt = new EventRuntime({ eventId: "evt", store: new Store(freshDir()), codes: CODES, scenarioName: "t", scenarioSource: AGENT_SOURCE, joinBase: () => "http://localhost" });
    expect((await call(rt, "GET", "/api/mod/screen/terminals", {})).status).toBe(403);
    await call(rt, "GET", "/api/screen/state?name=Hall&spot=hall&view=auto&character=Ghost", {}, { moderator: true });
    const r = await call(rt, "GET", "/api/mod/screen/terminals", {}, { moderator: true });
    expect(r.status).toBe(200);
    expect(r.res.headers["cache-control"]).toBe("no-store");
    const body = r.json as unknown as ScreenTerminals;
    expect(body.terminals.map((p) => p.name)).toEqual(["Hall"]);
    expect(body.voiceMuted).toBe(false);
    const login = await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod });
    const token = login.json["token"] as string;
    expect((await call(rt, "GET", `/api/mod/screen/terminals?token=${token}`, {})).status).toBe(200);
    rt.dispose();
  });

  it("the TV-voice mute survives a server restart (W8 T3-04)", async () => {
    const dir = freshDir();
    const mk = () => new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: "t", scenarioSource: AGENT_SOURCE, joinBase: () => "http://localhost" });
    const rt = mk();
    rt.openDoors();
    expect((await call(rt, "POST", "/api/mod/screen/voice", { muted: true }, { moderator: true })).json).toEqual({ muted: true });
    rt.dispose();
    // A mute kept from before the start is said on boot (a rehearsal's
    // mute would otherwise silence the show's TV unnoticed).
    const logged: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      logged.push(String(chunk));
      return true;
    });
    const again = mk();
    spy.mockRestore();
    expect(logged.some((l) => l.includes("the TV voice is muted"))).toBe(true);
    expect(again.restore()).not.toBeNull();
    expect(((await call(again, "GET", "/api/mod/screen/terminals", {}, { moderator: true })).json as unknown as ScreenTerminals).voiceMuted).toBe(true);
    // …and unmuting sticks too.
    await call(again, "POST", "/api/mod/screen/voice", { muted: false }, { moderator: true });
    again.dispose();
    const third = mk();
    third.restore();
    expect(((await call(third, "GET", "/api/mod/screen/terminals", {}, { moderator: true })).json as unknown as ScreenTerminals).voiceMuted).toBe(false);
    third.dispose();
  });
});

// --- device health + identify (SW-SCR-21, install day) ---------------------------

describe("the heartbeat's device health and the director's identify", () => {
  const q = (o: Record<string, string>) => (k: string) => o[k] ?? "";

  it("reads audio / visibility / battery / version off the query, dropping anything malformed", () => {
    expect(screenDeviceOf(q({ audio: "1", vis: "h", bat: "17", ver: "ab12cd3.10161432" }))).toEqual({ audio: true, visible: false, battery: 17, charging: false, version: "ab12cd3.10161432" });
    expect(screenDeviceOf(q({ audio: "0", vis: "v", bat: "100c" }))).toEqual({ audio: false, visible: true, battery: 100, charging: true });
    // An older terminal build sends none: nothing is recorded.
    expect(screenDeviceOf(q({}))).toEqual({});
    expect(screenDeviceOf(q({ audio: "yes", vis: "visible", bat: "101", ver: "<script>" }))).toEqual({ version: "script" });
    expect(screenDeviceOf(q({ bat: "-3" }))).toEqual({});
    expect(screenDeviceOf(q({ ver: "x".repeat(80) })).version).toHaveLength(24);
  });

  it("reads the full-screen flag (wave 17): fs=1|0, anything else or none left out", () => {
    expect(screenDeviceOf(q({ fs: "1" }))).toEqual({ fullscreen: true });
    expect(screenDeviceOf(q({ fs: "0", audio: "1" }))).toEqual({ fullscreen: false, audio: true });
    expect(screenDeviceOf(q({ fs: "yes" }))).toEqual({});
    // The voice link's mic (wave 19), `locked` included (open, sound waiting for a touch).
    for (const mic of ["live", "muted", "denied", "insecure", "locked", "off"]) expect(screenDeviceOf(q({ mic }))).toEqual({ mic });
    expect(screenDeviceOf(q({ mic: "loud" }))).toEqual({});
    expect(screenDeviceOf(q({ fs: "" }))).toEqual({});
  });

  it("reads the door sensor (wave 20): door / dlv / dft / dwn, anything malformed left out", () => {
    for (const door of ["open", "closed", "fault", "none"]) expect(screenDeviceOf(q({ door }))).toEqual({ door });
    expect(screenDeviceOf(q({ door: "closed", dlv: "3812" }))).toEqual({ door: "closed", doorLevel: 3812 });
    expect(screenDeviceOf(q({ door: "fault", dlv: "4095", dft: "ldr_saturated" }))).toEqual({ door: "fault", doorLevel: 4095, doorFault: "ldr_saturated" });
    expect(screenDeviceOf(q({ door: "open", dlv: "0", dwn: "ldr_open" }))).toEqual({ door: "open", doorLevel: 0, doorWarn: "ldr_open" });
    // Malformed: an unknown state, a level out of range / not an integer, a code with other characters.
    expect(screenDeviceOf(q({ door: "ajar", dlv: "4096", dft: "LED_DEAD", dwn: "x".repeat(25) }))).toEqual({});
    expect(screenDeviceOf(q({ dlv: "-1" }))).toEqual({});
    expect(screenDeviceOf(q({ dlv: "12.5" }))).toEqual({});
    expect(screenDeviceOf(q({ dft: "no port" }))).toEqual({});
    expect(screenDeviceOf(q({ dwn: "" }))).toEqual({});
  });

  it("reads the patch bay (wave 22): pb / pbc / pbx / pft, counts only, anything malformed left out", () => {
    expect(screenDeviceOf(q({ pb: "4", pbc: "1", pbx: "0" }))).toEqual({ patch: 4, patchComplete: true, patchBetween: 0 });
    expect(screenDeviceOf(q({ pb: "2", pbc: "0", pbx: "1" }))).toEqual({ patch: 2, patchComplete: false, patchBetween: 1 });
    expect(screenDeviceOf(q({ pb: "fault", pft: "no_port" }))).toEqual({ patch: "fault", patchFault: "no_port" });
    expect(screenDeviceOf(q({ pb: "fault", pbx: "0", pft: "dup" }))).toEqual({ patch: "fault", patchBetween: 0, patchFault: "dup" });
    // Malformed: a pair list, an out-of-range count, a flag that isn't 1/0, a code with other characters.
    expect(screenDeviceOf(q({ pb: "V1-D2", pbc: "yes", pbx: "17", pft: "No Port" }))).toEqual({});
    expect(screenDeviceOf(q({ pb: "-1" }))).toEqual({});
    expect(screenDeviceOf(q({ pb: "" }))).toEqual({});
  });

  it("carries the door keys on /api/mod/screen/terminals (wave 20)", () => {
    const w = new ScreenWatch({ now: () => 1_000 });
    w.poll(null, { name: "Server Room", spot: "server-room", view: "face", character: "Trabolta", device: screenDeviceOf(q({ door: "fault", dlv: "12", dft: "stale", ver: "w20" })) }, () => false);
    w.poll(null, { name: "Hall", spot: "hall", view: "auto", character: "", device: screenDeviceOf(q({})) }, () => false);
    const [room, hall] = [...screenTerminals(w).terminals].reverse();
    expect(room).toMatchObject({ name: "Server Room", door: "fault", doorLevel: 12, doorFault: "stale", version: "w20" });
    expect(hall).not.toHaveProperty("door");
    expect(hall).not.toHaveProperty("patch");
    // Wave 22: the bay's counts ride the same poll.
    w.poll(null, { name: "Server Room", spot: "server-room", view: "face", character: "Trabolta", device: screenDeviceOf(q({ door: "closed", dlv: "3800", pb: "3", pbc: "0", pbx: "1", ver: "w22" })) }, () => false);
    const again = screenTerminals(w).terminals.find((t) => t.name === "Server Room");
    expect(again).toMatchObject({ door: "closed", patch: 3, patchComplete: false, patchBetween: 1 });
    expect(again).not.toHaveProperty("patchFault");
    expect(hall).not.toHaveProperty("doorLevel");
  });

  it("reads the voice link's mic (wave 19): live / muted / denied / insecure / off, anything else left out", () => {
    for (const mic of ["live", "muted", "denied", "insecure", "off"]) expect(screenDeviceOf(q({ mic }))).toEqual({ mic });
    expect(screenDeviceOf(q({ mic: "on" }))).toEqual({});
    expect(screenDeviceOf(q({ mic: "LIVE" }))).toEqual({});
    expect(screenDeviceOf(q({ mic: "" }))).toEqual({});
  });

  it("the extras ride the heartbeat to the card; a poll without them clears them", async () => {
    const rt = new EventRuntime({ eventId: "evt", store: new Store(freshDir()), codes: CODES, scenarioName: "t", scenarioSource: AGENT_SOURCE, joinBase: () => "http://localhost" });
    await call(rt, "GET", "/api/screen/state?name=Hall&spot=hall&view=auto&character=Ghost&audio=0&vis=v&bat=12&fs=0&mic=denied&ver=abc", {}, { moderator: true });
    let body = (await call(rt, "GET", "/api/mod/screen/terminals", {}, { moderator: true })).json as unknown as ScreenTerminals;
    expect(body.terminals[0]).toMatchObject({ name: "Hall", audio: false, visible: true, battery: 12, charging: false, fullscreen: false, mic: "denied", version: "abc" });
    await call(rt, "GET", "/api/screen/state?name=Hall&spot=hall&view=auto&character=Ghost", {}, { moderator: true });
    body = (await call(rt, "GET", "/api/mod/screen/terminals", {}, { moderator: true })).json as unknown as ScreenTerminals;
    expect(body.terminals[0]).not.toHaveProperty("battery");
    expect(body.terminals[0]).not.toHaveProperty("fullscreen");
    expect(body.terminals[0]).not.toHaveProperty("mic");
    expect(body.terminals[0]).not.toHaveProperty("version");
    rt.dispose();
  });

  it("identify is per name and stops after IDENTIFY_MS", () => {
    let t = 1_000;
    const w = new ScreenWatch({ now: () => t });
    const who = (name: string) => ({ name, spot: "", view: "auto", character: "" });
    expect(w.poll(null, who("Kitchen"), () => false).identify).toBe(false);
    expect(w.identify("Kitchen")).toBe(1_000 + IDENTIFY_MS);
    expect(w.poll(null, who("Kitchen"), () => false).identify).toBe(true);
    expect(w.poll(null, who("Hall"), () => false).identify).toBe(false);
    t += IDENTIFY_MS - 1;
    expect(w.poll(null, who("Kitchen"), () => false).identify).toBe(true);
    t += 1;
    expect(w.poll(null, who("Kitchen"), () => false).identify).toBe(false);
    // A second click starts it again.
    w.identify("Kitchen", 500);
    expect(w.poll(null, who("Kitchen"), () => false).identify).toBe(true);
  });

  it("carries the identify's time left, so the device can uncover on its own", () => {
    let t = 1_000;
    const w = new ScreenWatch({ now: () => t });
    const who = { name: "Kitchen", spot: "", view: "auto", character: "" };
    expect(w.poll(null, who, () => false).identifyLeft).toBe(0);
    w.identify("Kitchen");
    t += 4_000;
    expect(w.poll(null, who, () => false)).toMatchObject({ identify: true, identifyLeft: IDENTIFY_MS - 4_000 });
    t += IDENTIFY_MS;
    expect(w.poll(null, who, () => false)).toMatchObject({ identify: false, identifyLeft: 0 });
  });

  it("POST /api/mod/screen/identify is mod-gated and needs a name; the terminal reads it off its next poll", async () => {
    const rt = new EventRuntime({ eventId: "evt", store: new Store(freshDir()), codes: CODES, scenarioName: "t", scenarioSource: AGENT_SOURCE, joinBase: () => "http://localhost" });
    expect((await call(rt, "POST", "/api/mod/screen/identify", { name: "Hall" })).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/screen/identify", { name: " " }, { moderator: true })).status).toBe(400);
    const r = await call(rt, "POST", "/api/mod/screen/identify", { name: "Hall" }, { moderator: true });
    expect(r.status).toBe(200);
    expect(r.json["name"]).toBe("Hall");
    expect(typeof r.json["until"]).toBe("number");
    const hall = await call(rt, "GET", "/api/screen/state?name=Hall&spot=hall&view=auto&character=Ghost", {}, { moderator: true });
    expect((hall.json as unknown as ScreenState).identify).toBe(true);
    const tv = await call(rt, "GET", "/api/screen/state?name=TV&spot=&view=tv&character=Ghost", {}, { moderator: true });
    expect((tv.json as unknown as ScreenState).identify).toBe(false);
    rt.dispose();
  });
});
