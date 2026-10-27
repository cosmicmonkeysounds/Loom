//! Wave 32 — Trabolta talks back (contract C3–C5): `POST /api/mod/talk`
//! (a host speaks for Clippy in the Desktop, or fires a canned Trabolta
//! line), the public talk thread (`loc:The Desktop|@Clippy`, answered aloud
//! with audience "all"), the talk block on the host / booth / director
//! views, `NightView.glitch.light` and the glitch shot's own text. Played on
//! a small fixture story with a fixture talk catalog (never the show's text).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";

import type { AgentHub, AgentRequest } from "../server/agents.ts";
import type { ChatMessage } from "../server/chat.ts";
import { EventRuntime, TALK_HOLD_NOTE, TALK_LATE_NOTE } from "../server/event-runtime.ts";
import { ScreenWatch, glitchTextOf, voiceLinesOf } from "../server/routes/screen.ts";
import { NOT_FROM_A_BOOTH, isHostRoute } from "../server/routes/host.ts";
import { Store } from "../server/store.ts";
import { nightView, type ModView, type PrimeView } from "../server/views.ts";
import type { HostView } from "../src/host-board.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import type { TalkScene } from "../src/talk-back.ts";

const STORY = `# Talk Night
start: Opening

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

LOCATION The Desktop
LOCATION The Kitchen

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
  busy: "Trabolta is processing a high volume of requests. Please hold."
  awake: bool = false
  composure: 0 to 100 = 80

  when flicker for program:
    set Night.flickers += 1

INTERACTION flicker
  who: agent

== Opening
  setting: The Desktop

Clippy: Welcome to the Desktop, programs.

== Intro
  setting: The Desktop

Trabolta: HELLO, PROGRAMS. I am pleased to be here.
Clippy: Say hello to Trabolta, everyone!
`;

const SCENES: Record<string, TalkScene> = {
  intro: {
    id: "intro",
    title: "Meeting Trabolta",
    hint: "Relay what Clippy says.",
    clippy: [{ text: "Tell them about your research!", direction: "Brag, then hand back to Clippy." }],
    trabolta: [{ text: "My research is going very well. Thank you." }],
    glitch: "ad_burst",
  },
  ad: { id: "ad", title: "The ad attack", hint: "Keep him talking.", clippy: [], trabolta: [] },
};

const CODES = { event: "EVT320", prime: "PRM320", mod: "MOD320" };
const DESK = "loc:The Desktop";
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown, headers: Record<string, string> = {}) {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  const closers: Array<() => void> = [];
  const req = {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on(ev: string, fn: () => void) {
      if (ev === "close") closers.push(fn);
    },
  } as unknown as IncomingMessage;
  return { req, close: () => closers.forEach((f) => f()) };
}
function fakeRes() {
  let buf = "";
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    setHeader() {},
    write(chunk: string) {
      buf += chunk;
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
    frames(): Array<[string, unknown]> {
      return buf
        .split("\n\n")
        .map((block) => {
          const ev = /^event: (.*)$/mu.exec(block)?.[1];
          const data = /^data: (.*)$/mu.exec(block)?.[1];
          return ev !== undefined && data !== undefined ? ([ev, JSON.parse(data)] as [string, unknown]) : null;
        })
        .filter((f): f is [string, unknown] => f !== null);
    },
  };
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, method: string, pathAndQuery: string, body: unknown, o: { moderator?: boolean; token?: string } = {}) {
  const url = new URL(`http://x${pathAndQuery}`);
  const { req, close } = fakeReq(body, o.token ? { "x-loom-token": o.token } : {});
  const res = fakeRes();
  await rt.handle(req, res, method, url.pathname, url, { moderator: o.moderator ?? false });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    /* stream */
  }
  return { status: res.statusCode, json, res, close };
}

function runtime(o: { dir?: string; now?: () => number } = {}): EventRuntime {
  const d = o.dir ?? mkdtempSync(join(tmpdir(), "loom-w32-"));
  if (o.dir === undefined) dirs.push(d);
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "talk", scenarioSource: STORY, joinBase: () => "http://localhost", talkScenes: SCENES, hostViewMs: 0, ...(o.now !== undefined ? { now: o.now } : {}) });
}

const chat = (rt: EventRuntime): ChatMessage[] => (rt as unknown as { chat: { all(): ChatMessage[] } }).chat.all();
const desk = (rt: EventRuntime) => chat(rt).filter((m) => m.channel === DESK && m.kind === "line");
const hostsLines = (rt: EventRuntime) => chat(rt).filter((m) => m.channel === "room:hosts").map((m) => m.text);
const hub = (rt: EventRuntime) => (rt as unknown as { agents: AgentHub }).agents;
const setVar = (rt: EventRuntime, path: string, value: string) => call(rt, "POST", "/api/mod/var", { path, value }, { moderator: true });

async function hostToken(rt: EventRuntime): Promise<string> {
  const r = await call(rt, "POST", "/api/prime/login", { character: "Task Manager", passcode: CODES.prime });
  expect(r.json).toMatchObject({ character: "Task Manager", host: true });
  return r.json["token"] as string;
}

/** Doors open, Trabolta awake, the intro talk scene on, a host signed in. */
async function scene(o: { now?: () => number; dir?: string; worker?: boolean } = {}) {
  const rt = runtime(o);
  rt.openDoors();
  await setVar(rt, "Trabolta.awake", "true");
  await setVar(rt, "Night.talk", "intro");
  const host = await hostToken(rt);
  const worker = o.worker === false ? null : await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
  const requests = () => (worker === null ? [] : worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest));
  const talk = (body: Record<string, unknown>) => call(rt, "POST", "/api/mod/talk", { ...body, token: host }, {});
  return { rt, host, worker, requests, talk };
}

describe("w32 — POST /api/mod/talk: the errors", () => {
  it("400 on a bad body; 409 no_talk / asleep / closed", async () => {
    const { rt, talk } = await scene({ worker: false });
    expect((await talk({ as: "Norton", text: "hi" })).json).toEqual({ error: "as" });
    expect((await talk({ as: "Clippy", text: "   " })).status).toBe(400);
    expect((await talk({ as: "Clippy", text: "   " })).json).toEqual({ error: "empty" });
    expect((await talk({ as: "Clippy", text: "x".repeat(281) })).json).toEqual({ error: "too_long" });
    expect((await talk({ as: "Clippy", text: "hi", direction: 7 })).json).toEqual({ error: "direction" });
    await setVar(rt, "Night.talk", "none");
    expect(await talk({ as: "Clippy", text: "hi" })).toMatchObject({ status: 409, json: { error: "no_talk" } });
    await setVar(rt, "Night.talk", "nonsense");
    expect(await talk({ as: "Clippy", text: "hi" })).toMatchObject({ status: 409, json: { error: "no_talk" } });
    await setVar(rt, "Night.talk", "intro");
    await setVar(rt, "Trabolta.awake", "false");
    expect(await talk({ as: "Clippy", text: "hi" })).toMatchObject({ status: 409, json: { error: "asleep" } });
    await setVar(rt, "Trabolta.awake", "true");
    expect((await call(rt, "POST", "/api/mod/stop", {}, { moderator: true })).status).toBe(200);
    expect(await talk({ as: "Clippy", text: "hi" })).toMatchObject({ status: 409, json: { error: "closed" } });
    // Nothing landed in the room.
    expect(desk(rt).filter((m) => m.from === "Clippy" && m.text === "hi")).toEqual([]);
    rt.dispose();
  });

  it("a guest token and no token are refused", async () => {
    const { rt } = await scene({ worker: false });
    const g = await call(rt, "POST", "/api/guest/register", { name: "Winamp", passcode: CODES.event });
    expect((await call(rt, "POST", "/api/mod/talk", { as: "Clippy", text: "hi", token: g.json["token"] })).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/talk", { as: "Clippy", text: "hi" })).status).toBe(403);
    rt.dispose();
  });
});

describe("w32 — the host allowlist", () => {
  const ctx = { alertsPath: "Night.alerts", isAgent: (c: string) => c === "Trabolta" };
  it("lets a host post /api/mod/talk, as Clippy or Trabolta", async () => {
    expect(isHostRoute("POST", "/api/mod/talk", { as: "Clippy", text: "x" }, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/talk", { as: "Trabolta", text: "x" }, ctx)).toBe(true);
    const { rt, talk } = await scene({ worker: false });
    const r = await talk({ as: "Clippy", text: "Hello, Trabolta!" });
    expect(r.json["error"]).not.toBe(NOT_FROM_A_BOOTH);
    expect(r.status).toBe(200);
    rt.dispose();
  });
});

describe("w32 — Clippy's line and the public request", () => {
  it("commits Clippy's line to the whole Desktop by the host, then asks the worker with speaker.stage, stage and the room's history", async () => {
    const { rt, requests, talk } = await scene();
    expect((await call(rt, "POST", "/api/mod/beat", { name: "Intro" }, { moderator: true })).status).toBe(200);
    const r = await talk({ as: "Clippy", text: "Trabolta, tell them about your research!", direction: "Brag, then hand back to Clippy." });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, asked: true, online: true });
    const line = desk(rt).find((m) => m.seq === r.json["seq"])!;
    expect(line).toMatchObject({ from: "Clippy", text: "Trabolta, tell them about your research!", audience: "all" });
    // Journaled by the host (a director's name never reaches a host; the journal keeps the booth).
    const journal = (rt as unknown as { store: Store }).store.readJournal();
    expect(journal.find((j) => j.m === "say" && j.a[0] === "Clippy" && j.a[2] === "Trabolta, tell them about your research!")?.by).toMatch(/Task Manager/u);
    const [req] = requests();
    expect(req).toBeDefined();
    expect(req!.thread).toEqual({ character: "Trabolta", channel: DESK, audience: ["@Clippy"], public: true });
    expect(req!.speaker).toEqual({ kind: "performer", id: "Clippy", name: "Clippy", faction: "Hosts", player: true, stage: true });
    expect(req!.stage).toEqual({ room: "The Desktop", scene: "intro", direction: "Brag, then hand back to Clippy." });
    expect(req!.text).toBe("Trabolta, tell them about your research!");
    expect(req!.them.location).toBeNull();
    expect(req!.dossier).toBeUndefined();
    expect(req!.them.ranges).toEqual({ trust: [0, 100] });
    // The room's own lines, every speaker, scripted ones tagged story.
    const hist = req!.history.map((l) => [l.from, l.mine, l.story === true, l.text]);
    expect(hist).toEqual([
      ["Clippy", false, true, "Welcome to the Desktop, programs."],
      ["Trabolta", true, true, "HELLO, PROGRAMS. I am pleased to be here."],
      ["Clippy", false, true, "Say hello to Trabolta, everyone!"],
      ["Clippy", false, false, "Trabolta, tell them about your research!"],
    ]);
    rt.dispose();
  });

  it("a typed line with no direction drops the old steer; a burst rebuilds one queued request", async () => {
    const { rt, talk } = await scene({ worker: false });
    await talk({ as: "Clippy", text: "One.", direction: "Be brief." });
    await talk({ as: "Clippy", text: "Two." });
    const open = hub(rt).pending.filter((r) => r.thread.public === true);
    expect(open).toHaveLength(1);
    expect(open[0]!.stage).toEqual({ room: "The Desktop", scene: "intro" });
    expect(open[0]!.text).toBe("Two.");
    rt.dispose();
  });

  it("is dispatched ahead of a queued DM", async () => {
    const { rt, talk } = await scene({ worker: false });
    const g = await call(rt, "POST", "/api/guest/register", { name: "Winamp", passcode: CODES.event });
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hello?" }, { token: g.json["token"] as string })).status).toBe(200);
    await talk({ as: "Clippy", text: "Say hello, Trabolta!" });
    expect(hub(rt).pending).toHaveLength(2);
    const w = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    const sent = w.res.frames().filter(([e]) => e === "request").map(([, d]) => (d as AgentRequest).thread.channel);
    expect(sent).toEqual([DESK, "dm:Trabolta"]);
    rt.dispose();
  });

  it("the reply lands in the Desktop for everyone, the TV speaks it, a player adjust moves Clippy's trust, acts are ignored", async () => {
    const { rt, requests, talk } = await scene();
    const asked = await talk({ as: "Clippy", text: "Trabolta, say hello!" });
    const before = (asked.json["seq"] as number) - 1;
    const req = requests()[0]!;
    const reply = await call(rt, "POST", "/api/agent/reply", { id: req.id, say: "HELLO. I am— I am fine.", adjust: { "them.trust": 5, composure: -10 }, acts: [{ kind: "fire", name: "flicker" }] }, { moderator: true });
    expect(reply.status).toBe(200);
    expect(reply.json["applied"]).toEqual({ "them.trust": 55, composure: 70 });
    expect(reply.json["acted"]).toEqual([{ kind: "fire", ok: false, what: "flicker", error: "not from the stage" }]);
    const said = desk(rt).find((m) => m.from === "Trabolta" && m.text === "HELLO. I am— I am fine.")!;
    expect(said).toMatchObject({ audience: "all", answers: asked.json["seq"] });
    expect(rt.liveSim!.world.peek("Night.flickers")).toBeFalsy();
    // The TV's voice lines (screen.ts) carry his answer, not Clippy's line.
    const tv = voiceLinesOf(chat(rt), DESK, before, (from) => from === "Trabolta");
    expect(tv.lines.map((l) => [l.from, l.text, l.beat])).toEqual([["Trabolta", "HELLO. I am— I am fine.", null]]);
    // A guest anywhere in the house reads it (audience all, not occupants).
    const g = await call(rt, "POST", "/api/guest/register", { name: "Winamp", passcode: CODES.event });
    await setVar(rt, `${g.json["id"] as string}.location`, "The Kitchen");
    const history = await call(rt, "GET", "/api/history", {}, { token: g.json["token"] as string });
    expect((history.json["messages"] as ChatMessage[]).some((m) => m.text === "HELLO. I am— I am fine.")).toBe(true);
    rt.dispose();
  });

  it("typing reaches the host booths and the directors, never a guest or Clippy's booth", async () => {
    const { rt, host, talk } = await scene({ worker: false });
    const g = await call(rt, "POST", "/api/guest/register", { name: "Winamp", passcode: CODES.event });
    const guest = await call(rt, "GET", `/events?role=guest&token=${g.json["token"] as string}`, {});
    const hostStream = await call(rt, "GET", `/events?role=prime&token=${host}`, {});
    const clippyTok = (await call(rt, "POST", "/api/prime/login", { character: "Clippy", passcode: CODES.prime })).json["token"] as string;
    const clippy = await call(rt, "GET", `/events?role=prime&token=${clippyTok}`, {});
    const director = await call(rt, "GET", "/events?role=mod", {}, { moderator: true });
    await talk({ as: "Clippy", text: "Trabolta?" });
    await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    const typing = (s: { res: ReturnType<typeof fakeRes> }) => s.res.frames().filter(([e]) => e === "typing").map(([, d]) => d as { channel: string; on: boolean });
    expect(typing(hostStream).map((t) => [t.channel, t.on])).toEqual([[DESK, true]]);
    expect(typing(director).map((t) => [t.channel, t.on])).toEqual([[DESK, true]]);
    expect(typing(guest)).toEqual([]);
    expect(typing(clippy)).toEqual([]);
    rt.dispose();
  });
});

describe("w32 — never a hold or busy line in the room", () => {
  it("with no worker: one # hosts line, nothing in the Desktop; a worker that comes back still answers", async () => {
    let clock = 1_000_000;
    const { rt, talk } = await scene({ now: () => clock, worker: false });
    await talk({ as: "Clippy", text: "Trabolta? Are you there?" });
    for (let t = 0; t < 30_000; t += 1000) {
      clock += 1000;
      rt.tickOnce(1000);
    }
    expect(desk(rt).filter((m) => m.from === "Trabolta")).toEqual([]);
    expect(hostsLines(rt)).toEqual([TALK_HOLD_NOTE]);
    for (let t = 0; t < 30_000; t += 1000) {
      clock += 1000;
      rt.tickOnce(1000);
    }
    expect(hostsLines(rt)).toEqual([TALK_HOLD_NOTE]); // once
    const w = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    const req = w.res.frames().find(([e]) => e === "request")![1] as AgentRequest;
    expect(req.thread.public).toBe(true);
    rt.dispose();
  });

  it("behind a burst of DMs on a worker still answering: no busy line in the room", async () => {
    let clock = 1_000_000;
    const { rt, requests, talk } = await scene({ now: () => clock });
    for (const name of ["Ada", "Ben", "Cy"]) {
      const g = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event });
      await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hi" }, { token: g.json["token"] as string });
    }
    await talk({ as: "Clippy", text: "Trabolta, the room is waiting!" });
    // The worker answers a DM every 30 s; the public one waits behind them.
    for (let round = 0; round < 3; round++) {
      for (let t = 0; t < 30_000; t += 1000) {
        clock += 1000;
        rt.tickOnce(1000);
      }
      const open = new Set(hub(rt).pending.map((p) => p.id));
      const head = requests().find((r) => open.has(r.id) && r.thread.public !== true);
      if (head !== undefined) await call(rt, "POST", "/api/agent/reply", { id: head.id, say: "One moment." }, { moderator: true });
    }
    expect(desk(rt).filter((m) => m.from === "Trabolta")).toEqual([]);
    rt.dispose();
  });
});

describe("w32 — the scene closes, a canned line answers", () => {
  it("a reply after the scene closed is dropped: 410 and a # hosts note", async () => {
    const { rt, requests, talk } = await scene();
    await talk({ as: "Clippy", text: "Trabolta, anything to add?" });
    const req = requests()[0]!;
    await setVar(rt, "Night.talk", "none");
    const late = await call(rt, "POST", "/api/agent/reply", { id: req.id, say: "Yes! One more thing.", adjust: { composure: -50 } }, { moderator: true });
    expect(late.status).toBe(410);
    expect(desk(rt).filter((m) => m.from === "Trabolta")).toEqual([]);
    expect(hostsLines(rt)).toEqual([TALK_LATE_NOTE]);
    expect(String(rt.liveSim!.world.peek("Trabolta.composure")?.kind === "number" ? (rt.liveSim!.world.peek("Trabolta.composure") as { value: number }).value : "")).toBe("80");
    rt.dispose();
  });

  it("a reply asked in one scene is dropped once another scene is on", async () => {
    const { rt, requests, talk } = await scene();
    await talk({ as: "Clippy", text: "Trabolta?" });
    await setVar(rt, "Night.talk", "ad");
    expect((await call(rt, "POST", "/api/agent/reply", { id: requests()[0]!.id, say: "Hello." }, { moderator: true })).status).toBe(410);
    rt.dispose();
  });

  it("a request owed from an earlier scene is closed when Clippy speaks in the next one", async () => {
    const { rt, worker, requests, talk } = await scene();
    await talk({ as: "Clippy", text: "Trabolta?" });
    const old = requests()[0]!;
    await setVar(rt, "Night.talk", "ad");
    await talk({ as: "Clippy", text: "Trabolta, what was that?" });
    expect(worker!.res.frames().some(([e, d]) => e === "cancel" && (d as { id: string }).id === old.id)).toBe(true);
    const fresh = requests()[1]!;
    expect(fresh.stage).toEqual({ room: "The Desktop", scene: "ad" });
    expect(fresh.text).toBe("Trabolta, what was that?");
    expect((await call(rt, "POST", "/api/agent/reply", { id: fresh.id, say: "Nothing. A minor— nothing." }, { moderator: true })).status).toBe(200);
    rt.dispose();
  });

  it("a canned Trabolta line commits at once, cancels the owed request, and the worker's late reply gets 410", async () => {
    const { rt, worker, requests, talk } = await scene();
    const asked = await talk({ as: "Clippy", text: "Trabolta, how are you?" });
    const req = requests()[0]!;
    const canned = await talk({ as: "Trabolta", text: "My research is going very well. Thank you." });
    expect(canned.status).toBe(200);
    expect(canned.json).toMatchObject({ ok: true });
    const line = desk(rt).find((m) => m.seq === canned.json["seq"])!;
    expect(line).toMatchObject({ from: "Trabolta", audience: "all", answers: asked.json["seq"] });
    expect(worker!.res.frames().some(([e, d]) => e === "cancel" && (d as { id: string }).id === req.id)).toBe(true);
    expect(hub(rt).pending).toEqual([]);
    expect((await call(rt, "POST", "/api/agent/reply", { id: req.id, say: "Late." }, { moderator: true })).status).toBe(410);
    expect(desk(rt).filter((m) => m.text === "Late.")).toEqual([]);
    rt.dispose();
  });

  it("a director typing as Trabolta in the Desktop answers it by hand too", async () => {
    const { rt, talk } = await scene({ worker: false });
    await talk({ as: "Clippy", text: "Trabolta?" });
    expect(hub(rt).pending).toHaveLength(1);
    await call(rt, "POST", "/api/mod/say", { channel: DESK, as: "Trabolta", text: "Present." }, { moderator: true });
    expect(hub(rt).pending).toEqual([]);
    rt.dispose();
  });

  it("asleep: no public request is opened, even straight through the hub", async () => {
    const { rt } = await scene({ worker: false });
    await setVar(rt, "Trabolta.awake", "false");
    hub(rt).line({ character: "Trabolta", channel: DESK, audience: ["@Clippy"], public: true });
    expect(hub(rt).pending).toEqual([]);
    rt.dispose();
  });
});

describe("w32 — the views (C5)", () => {
  it("HostView.talk: the scene, thinking with since, online, awake; null with no scene", async () => {
    let clock = 5_000_000;
    const { rt, host, talk } = await scene({ now: () => clock });
    const hv = async () => (await call(rt, "GET", `/api/state?role=mod&host=1&token=${host}`, {})).json as unknown as HostView;
    expect((await hv()).talk).toMatchObject({ scene: "intro", title: "Meeting Trabolta", glitch: "ad_burst", thinking: false, since: null, online: true, awake: true });
    expect((await hv()).talk!.clippy[0]).toEqual(SCENES["intro"]!.clippy[0]);
    await talk({ as: "Clippy", text: "Trabolta?" });
    clock += 3000;
    expect((await hv()).talk).toMatchObject({ thinking: true, since: 5_000_000 });
    // The booth view of a host carries it; the director's mod view too; a player's booth never.
    const boothTok = host;
    const booth = (await call(rt, "GET", `/api/state?role=prime&token=${boothTok}`, {})).json as unknown as PrimeView;
    expect(booth.talk).toMatchObject({ scene: "intro", thinking: true });
    const clippyTok = (await call(rt, "POST", "/api/prime/login", { character: "Clippy", passcode: CODES.prime })).json["token"] as string;
    const clippy = (await call(rt, "GET", `/api/state?role=prime&token=${clippyTok}`, {})).json as unknown as PrimeView;
    expect(clippy.talk).toBeUndefined();
    const director = (await call(rt, "GET", "/api/state?role=mod", {}, { moderator: true })).json as unknown as ModView;
    expect(director.talk).toMatchObject({ scene: "intro", thinking: true });
    await setVar(rt, "Night.talk", "none");
    expect((await hv()).talk).toBeNull();
    rt.dispose();
  });

  it("offline and asleep read through", async () => {
    const { rt, host } = await scene({ worker: false });
    await setVar(rt, "Trabolta.awake", "false");
    const hv = (await call(rt, "GET", `/api/state?role=mod&host=1&token=${host}`, {})).json as unknown as HostView;
    expect(hv.talk).toMatchObject({ online: false, awake: false, thinking: false });
    rt.dispose();
  });

  it("NightView.glitch.light only for a burst; the glitch shot carries Night.glitch_text", () => {
    const s = Sim.fromSources(`# Glitch\nstart: Boot\n\n== Boot\n\nHello.\n`);
    s.fireBeat("Boot");
    s.setVar("Night.glitch_at", "12");
    s.setVar("Night.glitch_text", '"IT HURTS. BUY NOW."');
    s.setVar("Night.glitch_kind", '"full"');
    expect(nightView(s).glitch).toEqual({ at: 12000, text: "IT HURTS. BUY NOW." });
    const s2 = Sim.fromSources(`# Glitch\nstart: Boot\n\n== Boot\n\nHello.\n`);
    s2.fireBeat("Boot");
    s2.setVar("Night.glitch_at", "13");
    s2.setVar("Night.glitch_text", '"IT HURTS. BUY NOW."');
    s2.setVar("Night.glitch_kind", '"burst"');
    expect(nightView(s2).glitch).toEqual({ at: 13000, text: "IT HURTS. BUY NOW.", light: true });
    expect(glitchTextOf(s2)).toBe("IT HURTS. BUY NOW.");
    s2.setVar("Night.glitch_text", '"none"');
    expect(glitchTextOf(s2)).toBeNull();
  });

  it("the screen fold's glitch shot: text when the story set one, absent otherwise", () => {
    const src = `# Glitch\nstart: Boot\n\n== Boot\n\nHello.\n\nINTERACTION burst\n  who: admin\n\nINTERACTION plain\n  who: admin\n\nwhen burst:\n  cue screens_glitch\n  set Night.glitch_text = "SPECIAL OFFER. IT HURTS."\n\nwhen plain:\n  set Night.glitch_text = "none"\n  cue screens_glitch\n`;
    const s = Sim.fromSources(src);
    s.fireBeat("Boot");
    let now = 1000;
    const watch = new ScreenWatch({ now: () => now });
    const look = () => watch.poll(s, { name: "TV", spot: "", view: "tv", character: "" }, () => false).program;
    expect(look().glitch).toBeNull(); // history
    s.signal("burst");
    now += 5000;
    expect(look().glitch).toMatchObject({ cue: "screens_glitch", at: 6000, text: "SPECIAL OFFER. IT HURTS." });
    s.signal("plain");
    now += 5000;
    const g2 = look().glitch!;
    expect(g2.at).toBe(11000);
    expect(g2.text).toBeUndefined();
  });
});

describe("w32 — replay", () => {
  it("a restart replays the same Desktop lines; the public request is memory-only and not re-asked", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-w32-"));
    dirs.push(d);
    const { rt, requests, talk } = await scene({ dir: d });
    await talk({ as: "Clippy", text: "Trabolta, hello!" });
    await call(rt, "POST", "/api/agent/reply", { id: requests()[0]!.id, say: "Hello. Hello. HELLO.", adjust: { "them.trust": 3 } }, { moderator: true });
    await talk({ as: "Clippy", text: "And the hunt?" });
    await talk({ as: "Trabolta", text: "My research is going very well. Thank you." });
    await talk({ as: "Clippy", text: "One more?" }); // left owed at the restart
    const lines = (r: EventRuntime) => desk(r).map((m) => [m.from, m.text, m.audience]);
    const before = lines(rt);
    rt.dispose();
    const again = runtime({ dir: d });
    expect(again.restore()).not.toBeNull();
    expect(lines(again)).toEqual(before);
    expect(again.liveSim!.worldEntries().find((w) => w.path === "Clippy.trust")?.value).toBe("53");
    expect(hub(again).pending.filter((r) => r.thread.public === true)).toEqual([]);
    again.dispose();
  });
});
