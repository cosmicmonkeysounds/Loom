//! Wave 21 — performers play (contract C1–C8): `player: true` parts get a
//! lean booth (their own buttons, guest countdowns, no act, their team's
//! staff rooms, never a caller, a Mission, `stat:` tiles), a row on the
//! Trust Chart, `private:` slots no agent reads, and `them.<slot>` adjusts.
//! Played on `fixtures/w21-mini/` (never the show's text).

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";

import { Workspace } from "../src/lsp/index.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { badgesOf } from "../src/runtime/sim/badges.ts";
import { parseStatLine } from "../src/runtime/sim/stats.ts";
import type { AgentRequest } from "../server/agents.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { ScreenWatch } from "../server/routes/screen.ts";
import { Store } from "../server/store.ts";
import { boardFor, callsCue, isCaller, modView, primeView } from "../server/views.ts";

const SOURCE = readFileSync(new URL("./fixtures/w21-mini/main.loom", import.meta.url), "utf8");

function sim(src = SOURCE): Sim {
  const s = Sim.fromSources(src);
  s.fireBeat("Boot");
  s.createPerson("g1", "Winamp");
  return s;
}

function diagnostics(src: string): Array<{ code: string; severity: number; message: string }> {
  const ws = new Workspace();
  ws.open("file:///main.loom", src);
  return (ws.diagnosticsFor("file:///main.loom")?.diagnostics ?? []) as Array<{ code: string; severity: number; message: string }>;
}

describe("w21 — the language", () => {
  it("the fixture compiles clean, with player:, private: and stat:", () => {
    expect(diagnostics(SOURCE)).toEqual([]);
    const m = Sim.fromSources(SOURCE).model;
    expect(m.characters.get("Clippy")).toMatchObject({ player: true, privateSlots: ["covert"] });
    expect(m.characters.get("Task Manager")).toMatchObject({ player: false, admin: true, privateSlots: [] });
    expect(m.stats.map((s) => s.path)).toEqual(["score", "captures", "covert", "nickname"]);
  });

  it("parses a stat: line — for players by default, a for list, a while", () => {
    expect(parseStatLine("self.score as ⭐ Points")).toMatchObject({ path: "score", glyph: "⭐", label: "Points", for: null, while: null });
    expect(parseStatLine("self.captures as ⛓ Captures, for Norton, Antivirus, while Night.step >= 3")).toMatchObject({ for: ["Norton", "Antivirus"], while: "Night.step >= 3" });
    expect(parseStatLine("self.x as 🎯, for players")).toMatchObject({ label: "🎯", for: null });
    for (const bad of ["score as ⭐ Points", "self.score", "Clippy.score as ⭐ P", "self.score as ⭐ P, while ", "self.score as ⭐ P, for "]) expect(parseStatLine(bad)).toBeNull();
  });

  it("L1222: an admin cue's by: naming a player (or a GROUP of players)", () => {
    const src = `${SOURCE}\nINTERACTION call_it\n  label: 📣 Call it\n  who: admin\n  by: Clippy\n\nINTERACTION call_av\n  label: 📣 AV\n  who: admin\n  by: Antivirus\n`;
    const ds = diagnostics(src).filter((d) => d.code === "L1222");
    expect(ds).toHaveLength(2);
    expect(ds[0]!.message).toContain("a player never calls cues");
    // And at run time neither booth calls it.
    const m = Sim.fromSources(src).model;
    expect(isCaller(m, "Clippy")).toBe(false);
    expect(callsCue(m, "Norton", "call_av")).toBe(false);
    expect(isCaller(m, "Task Manager")).toBe(true);
  });

  it("L1223 / L1224 / L1225 / L1219: bad stat lines, a player nobody plays, private reads", () => {
    const src = SOURCE.replace("watch: Night.phase as Phase", "watch: Night.phase as Phase\nwatch: Norton.covert as Covert\nstat: oops\nstat: self.score as ⭐ P, for Nobody\nstat: self.score as ⭐ P, while Norton.covert > 0\nbadge: Clippy.covert as 🤫 Sneaky").replace("  mind: external\n", "  mind: external\n  player: true\n");
    const codes = diagnostics(src).map((d) => `${d.code}:${d.severity}`);
    expect(codes.filter((c) => c.startsWith("L1223"))).toHaveLength(2);
    expect(codes).toContain("L1224:2");
    expect(codes.filter((c) => c.startsWith("L1225"))).toHaveLength(2); // the watch item + the stat's while (for Clippy, McAfee)
    expect(codes).toContain("L1219:1"); // a badge on a private slot: every phone sees a badge
  });
});

describe("w21 — the booth views", () => {
  it("a player booth: its own buttons, guest countdowns, no act, no staff rooms but its team's, a mission, stats", () => {
    const s = sim();
    s.signal("start_bingo");
    const clippy = primeView(s, "Clippy");
    expect(clippy.player).toBe(true);
    expect(clippy.interactions.map((i) => i.id)).toEqual(["pick_a_winner", "anyone_wave"]);
    expect(clippy.countdowns?.map((c) => c.label)).toEqual(["Bingo ends"]);
    expect(clippy.night?.act).toBeNull();
    expect(clippy.staffRooms).toEqual([]);
    expect(clippy.channels.map((c) => c.id)).toEqual(["loc:The Desktop", "loc:The Cellar"]);
    expect(clippy.calls).toBeUndefined();
    expect(clippy.mission).toEqual({ objective: "Run Bingo", place: "The Desktop" });
    expect(clippy.stats).toEqual([
      { glyph: "⭐", label: "Points", value: "0" },
      { glyph: "🤫", label: "Covert", value: "0" }, // its own private slot, on its own booth
    ]);
    s.signal("pick_a_winner", undefined, undefined, "Clippy");
    s.setVar("Clippy.nickname", "Paperclip");
    expect(primeView(s, "Clippy").stats?.map((t) => t.value)).toEqual(["10", "0", "Paperclip"]);

    const norton = primeView(s, "Norton");
    expect(norton.interactions.map((i) => i.id)).toEqual(["capture", "look_the_other_way", "anyone_wave"]);
    expect(norton.staffRooms).toEqual(["room:antivirus"]);
    expect(norton.channels.map((c) => c.id)).toContain("room:antivirus");
    expect(norton.mission).toEqual({ objective: "Guard The Cellar", place: "The Cellar" });
    expect(norton.stats?.map((t) => t.label)).toEqual(["Points", "Captures", "Covert"]);
    expect(primeView(s, "McAfee").interactions.map((i) => i.id)).not.toContain("look_the_other_way");
  });

  it("a host and a plain performer keep today's booth (no stats, the whole board)", () => {
    const s = sim();
    s.signal("start_bingo");
    const tm = primeView(s, "Task Manager", undefined, { host: true });
    expect(tm.player).toBe(false);
    expect(tm.countdowns?.map((c) => c.label)).toEqual(["Bingo ends", "Staff break ends"]);
    expect(tm.staffRooms).toEqual(["room:hosts", "room:antivirus"]);
    expect(tm.calls?.rows.map((r) => r.id)).toEqual(["start_bingo"]);
    expect(tm.stats).toBeUndefined();
    const sh = primeView(s, "Stagehand");
    expect(sh.player).toBe(false);
    expect(sh.interactions.map((i) => i.id)).toContain("host_thing");
    expect(sh.channels.map((c) => c.id)).toContain("room:hosts");
  });

  it("the cast roster tags players (C8)", () => {
    const cast = modView(sim(), "open", null).cast;
    expect(cast.filter((c) => c.player).map((c) => c.id)).toEqual(["Clippy", "Norton", "McAfee"]);
    expect(cast.find((c) => c.id === "Task Manager")?.player).toBe(false);
  });

  it("a private slot is masked on the board and never worn as a badge", () => {
    const src = SOURCE.replace("watch: Night.phase as Phase", "watch: Night.phase as Phase, Norton.covert as Covert\nbadge: Norton.covert as 🤫 Sneaky");
    const s = sim(src);
    s.setVar("Norton.covert", "2");
    expect(boardFor(s).watch.find((w) => w.label === "Covert")).toMatchObject({ secret: true });
    expect(badgesOf(s, "Norton")).toEqual([]);
  });
});

describe("w21 — the Trust Chart (C6)", () => {
  it("players rank beside the cleared programs, flagged staff", () => {
    const s = sim();
    s.setVar("g1.cleared", "true");
    s.setVar("g1.trust", "20");
    s.setVar("Norton.trust", "50");
    s.setVar("Clippy.trust", "-10");
    s.setVar("Night.screen", "trust_chart");
    const w = new ScreenWatch({ now: () => 1_000 });
    const chart = w.poll(s, { name: "tv", spot: "", view: "tv", character: "" }, () => false).chart;
    expect(chart?.rows).toEqual([
      { name: "Norton", value: 50, staff: true },
      { name: "Winamp", value: 20 },
      { name: "McAfee", value: 0, staff: true },
      { name: "Clippy", value: -10, staff: true },
    ]);
  });
});

// ── on an event runtime ─────────────────────────────────────────────────

const CODES = { event: "EVTW21", prime: "PRMW21", mod: "MODW21" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
    destroy() {},
  } as unknown as IncomingMessage;
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
  const res = fakeRes();
  const url = new URL(`http://x${pathAndQuery}`);
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, o.moderator ? { moderator: true, moderatorName: "Ada" } : {});
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    /* a stream */
  }
  return { status: res.statusCode, json, res };
}

function runtime(src = SOURCE): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-w21-"));
  dirs.push(d);
  const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "w21-mini", scenarioSource: src, joinBase: () => "http://localhost" });
  rt.openDoors();
  return rt;
}

async function login(rt: EventRuntime, character: string): Promise<string> {
  const r = await call(rt, "POST", "/api/prime/login", { character, passcode: CODES.prime });
  expect(r.status).toBe(200);
  return r.json["token"] as string;
}

describe("w21 — the event runtime", () => {
  it("a player is never a caller, even named on an admin cue's by:", async () => {
    const rt = runtime(`${SOURCE}\nINTERACTION call_it\n  label: 📣 Call it\n  who: admin\n  by: Clippy, Task Manager\n`);
    const c = await call(rt, "POST", "/api/prime/login", { character: "Clippy", passcode: CODES.prime });
    expect(c.json["caller"]).toBe(false);
    expect((await call(rt, "POST", "/api/prime/cue", { name: "call_it", presses: 0 }, { token: c.json["token"] as string })).status).toBe(404);
    const t = await call(rt, "POST", "/api/prime/login", { character: "Task Manager", passcode: CODES.prime });
    expect(t.json["caller"]).toBe(true);
  });

  it("a player posts and reads only its team's staff room; its press never reads staff lines", async () => {
    const rt = runtime();
    const clippy = await login(rt, "Clippy");
    const norton = await login(rt, "Norton");
    const stage = await login(rt, "Stagehand");
    expect((await call(rt, "POST", "/api/prime/say", { channel: "room:hosts", text: "hi" }, { token: clippy })).status).toBe(404);
    expect((await call(rt, "POST", "/api/prime/say", { channel: "room:hosts", text: "hi" }, { token: norton })).status).toBe(404);
    expect((await call(rt, "POST", "/api/prime/say", { channel: "room:antivirus", text: "team" }, { token: norton })).status).toBe(200);
    expect((await call(rt, "POST", "/api/prime/say", { channel: "room:hosts", text: "hosts" }, { token: stage })).status).toBe(200);

    const wave = await call(rt, "POST", "/api/prime/act", { name: "anyone_wave" }, { token: clippy });
    expect(wave.status).toBe(200);
    expect(wave.json["staff"]).toBeUndefined();
    const plain = await call(rt, "POST", "/api/prime/act", { name: "anyone_wave" }, { token: stage });
    expect(plain.json["staff"]).toEqual(["👋 Somebody waved."]);

    // The booth's stream: Clippy's history holds no staff room; Norton's holds his team's only.
    const roomsIn = async (token: string) => {
      const s = await call(rt, "GET", `/events?role=prime&token=${token}`, {});
      const history = s.res.frames().find(([e]) => e === "history")?.[1] as Array<{ channel: string }> | undefined;
      return new Set((history ?? []).map((m) => m.channel));
    };
    const c = await roomsIn(clippy);
    expect(c.has("room:hosts") || c.has("room:antivirus")).toBe(false);
    const n = await roomsIn(norton);
    expect(n.has("room:antivirus")).toBe(true);
    expect(n.has("room:hosts")).toBe(false);
    expect((await roomsIn(stage)).has("room:hosts")).toBe(true);
  });

  it("agent requests from a player: speaker.player, no private slot, them.<slot> adjusts", async () => {
    const rt = runtime();
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Oracle&name=laptop", {}, { moderator: true });
    const requests = () => worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
    const clippy = await login(rt, "Clippy");
    rt.liveSim!.setVar("Clippy.covert", "4");
    expect((await call(rt, "POST", "/api/prime/say", { channel: "cast:Oracle", text: "Boss?" }, { token: clippy })).status).toBe(200);
    const [r] = requests();
    expect(r!.speaker).toMatchObject({ kind: "performer", id: "Clippy", player: true });
    expect(r!.them.vars).toHaveProperty("trust");
    expect(r!.them.vars).not.toHaveProperty("covert");
    expect(r!.them.ranges).toEqual({ score: [0, 9999], trust: [-100, 100] });

    const reply = await call(rt, "POST", "/api/agent/reply", { id: r!.id, say: "Ally.", adjust: { "them.trust": 150, "them.covert": 3, "them.nope": 1 } }, { moderator: true });
    expect(reply.json["applied"]).toEqual({ "them.trust": 100 });
    expect(rt.liveSim!.world.get("Clippy.trust")).toEqual({ kind: "number", value: 100 });
    expect(rt.liveSim!.world.get("Clippy.covert")).toEqual({ kind: "number", value: 4 });

    // A guest's `them.` keys move nothing.
    const g = await call(rt, "POST", "/api/guest/register", { name: "Winamp", passcode: CODES.event });
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Oracle", text: "hello" }, { token: g.json["token"] as string });
    const guestReq = requests().find((q) => q.speaker.kind === "guest")!;
    expect(guestReq.speaker).not.toHaveProperty("player");
    const greply = await call(rt, "POST", "/api/agent/reply", { id: guestReq.id, say: "Hi.", adjust: { "them.trust": 5 } }, { moderator: true });
    expect(greply.json["applied"]).toEqual({});

    // The facts document never carries a private slot either.
    const facts = await call(rt, "GET", "/api/agent/facts", {}, { moderator: true });
    const chars = facts.json["characters"] as Array<{ id: string; vars: Record<string, string> }>;
    expect(chars.find((c) => c.id === "Clippy")!.vars).not.toHaveProperty("covert");
    expect(chars.find((c) => c.id === "Clippy")!.vars).toHaveProperty("trust");
  });

  it("the booth's view over the wire carries player / mission / stats", async () => {
    const rt = runtime();
    const norton = await login(rt, "Norton");
    const v = await call(rt, "GET", "/api/state?role=prime", {}, { token: norton });
    expect(v.json).toMatchObject({ player: true, mission: { objective: "Guard The Cellar", place: "The Cellar" }, staffRooms: ["room:antivirus"] });
    expect((v.json["stats"] as unknown[]).length).toBe(3);
  });
});
