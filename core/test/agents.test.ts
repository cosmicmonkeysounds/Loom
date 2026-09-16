//! Agent-voiced characters (`mind: external`) — the server half of the
//! stagehand agents protocol: the transport-free `AgentHub` (queue,
//! dispatch, one-open-request-per-thread, follow-ups, timeouts, worker
//! loss) and its wiring in `EventRuntime` (guest DMs + performer `cast:`
//! threads raise requests, the worker stream, `/api/agent/reply` commits
//! a journaled say + clamped variable writes, restart cancels).

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { AgentHub, type AgentRequest, type AgentThread, type AgentWorker } from "../server/agents.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { guestView, primeView } from "../server/views.ts";
import { Sim } from "../src/runtime/sim/index.ts";

// ---------------------------------------------------------------------------
// AgentHub (no sim, no sockets)
// ---------------------------------------------------------------------------

const T: AgentThread = { character: "Trabolta", channel: "dm:Trabolta", audience: ["g-1"] };

function hubHarness(opts: { replyTimeoutMs?: number; queueMaxAgeMs?: number } = {}) {
  let clock = 1000;
  let builds = 0;
  const typing: boolean[] = [];
  const hub = new AgentHub({
    build: (thread, id) => {
      builds += 1;
      return { id, character: thread.character, thread, text: `line ${builds}`, at: clock } as unknown as AgentRequest;
    },
    typing: (_t, on) => typing.push(on),
    now: () => clock,
    ...opts,
  });
  const worker = (id: string, characters = ["Trabolta"]) => {
    const got: Array<[string, unknown]> = [];
    const w: AgentWorker = { id, name: id, characters: new Set(characters), send: (e, d) => got.push([e, d]) };
    return { w, got, requests: () => got.filter(([e]) => e === "request").map(([, d]) => d as AgentRequest) };
  };
  return { hub, worker, typing, tick: (ms: number) => (clock += ms), builds: () => builds };
}

describe("AgentHub", () => {
  it("queues while no worker is online and hands the queue over on attach", () => {
    const h = hubHarness();
    h.hub.line(T);
    expect(h.hub.pending).toHaveLength(1);
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    expect(a.requests()).toHaveLength(1);
    expect(h.typing).toEqual([true]);
    expect(h.hub.isOnline("Trabolta")).toBe(true);
  });

  it("coalesces a burst into one request, then one follow-up", () => {
    const h = hubHarness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(T);
    h.hub.line(T);
    h.hub.line(T);
    expect(a.requests()).toHaveLength(1);
    const first = a.requests()[0]!;
    const settled = h.hub.settle(first.id);
    expect(settled?.followUp).toBe(true);
    h.hub.line(settled!.req.thread); // the runtime does this after committing
    expect(a.requests()).toHaveLength(2);
    expect(h.hub.settle(a.requests()[1]!.id)?.followUp).toBe(false);
    expect(h.hub.pending).toHaveLength(0);
  });

  it("a queued request refreshes its body instead of stacking", () => {
    const h = hubHarness();
    h.hub.line(T);
    h.hub.line(T);
    expect(h.hub.pending).toHaveLength(1);
    expect(h.hub.pending[0]!.text).toBe("line 2");
  });

  it("separate threads are separate requests, routed only to workers voicing the character", () => {
    const h = hubHarness();
    const laptop = h.worker("laptop", ["Trabolta"]);
    const desktop = h.worker("desktop", ["Sandy"]);
    h.hub.attach(laptop.w);
    h.hub.attach(desktop.w);
    h.hub.line(T);
    h.hub.line({ ...T, audience: ["@Clippy"] });
    h.hub.line({ character: "Sandy", channel: "dm:Sandy", audience: ["g-1"] });
    expect(laptop.requests().map((r) => r.character)).toEqual(["Trabolta", "Trabolta"]);
    expect(desktop.requests().map((r) => r.character)).toEqual(["Sandy"]);
  });

  it("rejects a late answer and an answer from the wrong worker", () => {
    const h = hubHarness();
    const a = h.worker("a");
    h.hub.attach(a.w);
    h.hub.line(T);
    const id = a.requests()[0]!.id;
    expect(h.hub.settle(id, "someone-else")).toBeNull();
    expect(h.hub.settle(id, "a")).not.toBeNull();
    expect(h.hub.settle(id, "a")).toBeNull();
  });

  it("re-dispatches work held by a worker that disconnects", () => {
    const h = hubHarness();
    const a = h.worker("a");
    const b = h.worker("b");
    h.hub.attach(a.w);
    h.hub.line(T);
    h.hub.attach(b.w);
    h.hub.detach("a");
    expect(b.requests()).toHaveLength(1);
    expect(h.typing).toEqual([true, false, true]);
  });

  it("times out a stuck request, retries once, then gives up", () => {
    const h = hubHarness({ replyTimeoutMs: 10_000 });
    const a = h.worker("a");
    h.hub.attach(a.w);
    h.hub.line(T);
    h.tick(11_000);
    h.hub.sweep();
    expect(a.got.filter(([e]) => e === "cancel")).toHaveLength(1);
    expect(a.requests()).toHaveLength(2);
    h.tick(11_000);
    h.hub.sweep();
    expect(h.hub.pending).toHaveLength(0);
  });

  it("drops queued requests nobody picked up", () => {
    const h = hubHarness({ queueMaxAgeMs: 60_000 });
    h.hub.line(T);
    h.tick(61_000);
    h.hub.sweep();
    expect(h.hub.pending).toHaveLength(0);
  });

  it("reset cancels everything open and tells workers", () => {
    const h = hubHarness();
    const a = h.worker("a");
    h.hub.attach(a.w);
    h.hub.line(T);
    h.hub.reset();
    expect(h.hub.pending).toHaveLength(0);
    expect(a.got.map(([e]) => e)).toEqual(["request", "cancel", "reset"]);
  });
});

// ---------------------------------------------------------------------------
// EventRuntime wiring
// ---------------------------------------------------------------------------

const SOURCE = `# Uploaded
directory: everyone

ROLE Program
  humanity: 0 to 100 = 20

CHARACTER Trabolta
  listed: true
  mind: external
  truth: 0 to 100 = 35
  stance: -100 to 100 = 0

CHARACTER Clippy
  listed: true

CODEX The Sandy File
  about: Trabolta
  known to: Trabolta
  text: He wants to impress Sandy.
`;
const CODES = { event: "EVT222", prime: "PRM222", mod: "MOD222" };

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function runtime(): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-agents-"));
  dirs.push(d);
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "uploaded",
    scenarioSource: SOURCE,
    joinBase: () => "http://localhost",
  });
}

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

/** A response that records SSE frames as `[event, data]`. */
function fakeRes() {
  let buf = "";
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
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

async function setup() {
  const rt = runtime();
  rt.openDoors();
  const g = await call(rt, "POST", "/api/guest/register", { name: "Ada", passcode: CODES.event });
  const guest = { id: g.json["id"] as string, token: g.json["token"] as string };
  const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
  const requests = () => worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
  return { rt, guest, worker, requests };
}

describe("EventRuntime agents", () => {
  it("the worker stream is moderator-gated and says hello", async () => {
    const rt = runtime();
    rt.openDoors();
    expect((await call(rt, "GET", "/api/agent/stream", {})).status).toBe(403);
    const w = await call(rt, "GET", "/api/agent/stream?characters=Trabolta,Nobody", {}, { moderator: true });
    const hello = w.res.frames().find(([e]) => e === "hello")![1] as Record<string, unknown>;
    expect(hello["agents"]).toEqual(["Trabolta"]);
    expect(hello["unknown"]).toEqual(["Nobody"]);
  });

  it("a guest's DM to an agent becomes a request carrying the thread + state", async () => {
    const { rt, guest, requests } = await setup();
    const said = await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Who is Sandy?" }, { token: guest.token });
    expect(said.status).toBe(200);
    const [r] = requests();
    expect(r).toBeDefined();
    expect(r!.character).toBe("Trabolta");
    expect(r!.thread).toEqual({ character: "Trabolta", channel: "dm:Trabolta", audience: [guest.id] });
    expect(r!.speaker).toMatchObject({ kind: "guest", id: guest.id, name: "Ada" });
    expect(r!.text).toBe("Who is Sandy?");
    expect(r!.history.map((l) => [l.mine, l.text])).toEqual([[false, "Who is Sandy?"]]);
    expect(r!.self.vars["truth"]).toBe("35");
    expect(r!.self.ranges["stance"]).toEqual([-100, 100]);
    expect(r!.self.codex.map((e) => e.title)).toEqual(["The Sandy File"]);
    expect(r!.them.vars["humanity"]).toBe("20");
    // Presence: the directory marks him online now.
    expect(guestView(rt.liveSim!, guest.id, null, new Set(["Trabolta"])).people.find((p) => p.id === "Trabolta")?.agent).toEqual({ online: true });
  });

  it("DMs to a performed character raise nothing", async () => {
    const { rt, guest, requests } = await setup();
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Clippy", text: "hi" }, { token: guest.token });
    expect(requests()).toHaveLength(0);
  });

  it("a reply lands in the guest's thread, and adjustments are declared-only + clamped", async () => {
    const { rt, guest, requests } = await setup();
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Sandy loves you." }, { token: guest.token });
    const id = requests()[0]!.id;
    const reply = await call(rt, "POST", "/api/agent/reply", { id, say: "SANDY. Say it again.", adjust: { truth: 500, stance: -5, humanity: 9, bogus: 3 } }, { moderator: true });
    expect(reply.status).toBe(200);
    expect(reply.json["applied"]).toEqual({ truth: 100, stance: -5 });
    const history = await call(rt, "GET", `/api/history`, {}, { token: guest.token });
    const lines = (history.json["messages"] as Array<{ from: string; text: string; channel: string }>).filter((m) => m.channel === "dm:Trabolta");
    expect(lines.map((m) => [m.from, m.text])).toEqual([
      ["Ada", "Sandy loves you."],
      ["Trabolta", "SANDY. Say it again."],
    ]);
    const world = rt.liveSim!.worldEntries();
    expect(world.find((w) => w.path === "Trabolta.truth")?.value).toBe("100");
    expect(world.find((w) => w.path === `${guest.id}.humanity`)?.value).toBe("20");
    // Settled: a second answer is refused.
    expect((await call(rt, "POST", "/api/agent/reply", { id, say: "again" }, { moderator: true })).status).toBe(410);
    // And the reply route is moderator-gated.
    expect((await call(rt, "POST", "/api/agent/reply", { id, say: "x" })).status).toBe(403);
  });

  it("the guest sees typing on dispatch and off on reply", async () => {
    const { rt, guest, requests } = await setup();
    const stream = await call(rt, "GET", `/events?role=guest&token=${guest.token}`, {});
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hello?" }, { token: guest.token });
    await call(rt, "POST", "/api/agent/reply", { id: requests()[0]!.id, say: "Hello, program." }, { moderator: true });
    const typing = stream.res.frames().filter(([e]) => e === "typing").map(([, d]) => (d as { on: boolean }).on);
    expect(typing).toEqual([true, false]);
  });

  it("a message sent mid-reply earns one follow-up request with the whole thread", async () => {
    const { rt, guest, requests } = await setup();
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "one" }, { token: guest.token });
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "two" }, { token: guest.token });
    expect(requests()).toHaveLength(1);
    await call(rt, "POST", "/api/agent/reply", { id: requests()[0]!.id, say: "ONE." }, { moderator: true });
    expect(requests()).toHaveLength(2);
    expect(requests()[1]!.history.map((l) => l.text)).toEqual(["one", "two", "ONE."]);
    expect(requests()[1]!.text).toBe("two");
  });

  it("a performer talks to the agent in a private cast: thread", async () => {
    const { rt, guest, requests } = await setup();
    const login = await call(rt, "POST", "/api/prime/login", { character: "Clippy", passcode: CODES.prime });
    const token = login.json["token"] as string;
    expect(primeView(rt.liveSim, "Clippy").agents).toEqual([{ id: "Trabolta", online: false }]);
    const booth = await call(rt, "GET", `/events?role=prime&token=${token}`, {});

    expect((await call(rt, "POST", "/api/prime/say", { channel: "cast:Clippy", text: "me?" }, { token })).status).toBe(404);
    expect((await call(rt, "POST", "/api/prime/say", { channel: "cast:Trabolta", text: "Boss, Bingo is ready." }, { token })).status).toBe(200);
    const r = requests()[0]!;
    expect(r.thread.audience).toEqual(["@Clippy"]);
    expect(r.speaker).toMatchObject({ kind: "performer", id: "Clippy" });
    await call(rt, "POST", "/api/agent/reply", { id: r.id, say: "Proceed, ambassador." }, { moderator: true });

    const seen = booth.res.frames().filter(([e]) => e === "message").map(([, d]) => (d as { text: string }).text);
    expect(seen).toContain("Proceed, ambassador.");
    // The guest never sees the cast thread.
    const history = await call(rt, "GET", `/api/history`, {}, { token: guest.token });
    expect((history.json["messages"] as Array<{ text: string }>).map((m) => m.text)).not.toContain("Proceed, ambassador.");
  });

  it("a director's persona messaging the agent gets an answer too", async () => {
    const { rt, requests } = await setup();
    const p = await call(rt, "POST", "/api/mod/persona", { name: "Rehearsal" }, { moderator: true });
    const pid = (p.json["guest"] as { id: string }).id;
    await call(rt, "POST", "/api/mod/say", { as: pid, channel: "dm:Trabolta", text: "testing" }, { moderator: true });
    expect(requests().map((r) => r.speaker.id)).toEqual([pid]);
  });

  it("a restart cancels open requests and answers to them are refused", async () => {
    const { rt, guest, worker, requests } = await setup();
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hi" }, { token: guest.token });
    const id = requests()[0]!.id;
    rt.restart();
    expect(worker.res.frames().map(([e]) => e)).toEqual(expect.arrayContaining(["cancel", "reset"]));
    expect((await call(rt, "POST", "/api/agent/reply", { id, say: "late" }, { moderator: true })).status).toBe(410);
  });

  it("a guest message while no worker is online is answered once one connects", async () => {
    const rt = runtime();
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Bo", passcode: CODES.event });
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "anyone?" }, { token: g.json["token"] as string });
    const w = await call(rt, "GET", "/api/agent/stream?characters=Trabolta", {}, { moderator: true });
    expect(w.res.frames().filter(([e]) => e === "request")).toHaveLength(1);
  });

  it("mind: external compiles onto the character", () => {
    const sim = Sim.fromSources(SOURCE);
    expect(sim.model.characters.get("Trabolta")?.mind).toBe("external");
    expect(sim.model.characters.get("Clippy")?.mind).toBeNull();
  });
});
