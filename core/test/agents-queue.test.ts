//! Trabolta's queue (wave 11, C6; `server/agents.ts`): the authored busy
//! line once per thread when a request waits behind a burst on a worker
//! still answering, and single-worker stall detection — a connected worker
//! whose head goes unanswered 60 s is stalled: one `# hosts` line, the hold
//! line once in every waiting thread, no new dispatch, cleared on its next
//! reply or a reconnect, and a story restart starts it clean.
//! `CastSummary.agentQueue` reads it out.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { AgentHub, type AgentRequest, type AgentThread, type AgentWorker } from "../server/agents.ts";
import type { ChatMessage } from "../server/chat.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { ModView } from "../server/views.ts";

// ---------------------------------------------------------------------------
// AgentHub (no sim, no sockets, an injected clock)
// ---------------------------------------------------------------------------

const th = (n: number): AgentThread => ({ character: "Trabolta", channel: "dm:Trabolta", audience: [`g-${n}`] });

function harness(opts: { replyTimeoutMs?: number; queueMaxAgeMs?: number } = {}) {
  let clock = 1000;
  const held: string[] = [];
  const busy: string[] = [];
  const stalls: Array<{ name: string; characters: string[]; waiting: number }> = [];
  let presence = 0;
  const hub = new AgentHub({
    build: (thread, id) => ({ id, character: thread.character, thread, text: "…", at: clock }) as unknown as AgentRequest,
    hold: (req) => {
      held.push(req.thread.audience[0]!);
      return true;
    },
    busy: (req) => {
      busy.push(req.thread.audience[0]!);
      return true;
    },
    stalled: (w, waiting) => stalls.push({ ...w, waiting }),
    presence: () => (presence += 1),
    now: () => clock,
    ...opts,
  });
  const worker = (id: string) => {
    const got: Array<[string, unknown]> = [];
    const w: AgentWorker = { id, name: id, characters: new Set(["Trabolta"]), send: (e, d) => got.push([e, d]) };
    return { w, got, requests: () => got.filter(([e]) => e === "request").map(([, d]) => d as AgentRequest) };
  };
  /** Advance the clock a second at a time, sweeping like the 1 s ticker. */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 1000) {
      clock += 1000;
      hub.sweep();
    }
  };
  /** Advance the clock with no sweep (the doors paused: the ticker is idle). */
  const skip = (ms: number) => (clock += ms);
  return { hub, worker, held, busy, stalls, run, skip, presence: () => presence, now: () => clock };
}

describe("AgentHub — the busy line", () => {
  it("is said once per thread when a request has waited > 40 s on a worker still answering", () => {
    const h = harness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    for (let n = 0; n < 3; n++) h.hub.line(th(n));
    // The laptop answers its head every 30 s: never stalled, but behind.
    const answerHead = () => {
      const open = new Set(h.hub.pending.map((p) => p.id));
      const head = a.requests().find((r) => open.has(r.id))!;
      return h.hub.settle(head.id, "laptop");
    };
    h.run(30_000);
    answerHead(); // g-0 after 30 s
    expect(h.busy).toEqual([]);
    h.run(11_000);
    expect(h.busy.sort()).toEqual(["g-1", "g-2"]); // both past 40 s
    h.run(19_000);
    answerHead(); // g-1 at 60 s
    h.hub.line(th(1)); // g-1 writes again: a new request on the same thread
    h.run(30_000);
    answerHead(); // g-2 at 90 s
    h.run(45_000);
    expect(h.busy.sort()).toEqual(["g-1", "g-2"]); // g-1's second wait: no second busy line
    expect(h.stalls).toEqual([]);
    expect(h.held).toEqual([]);
  });

  it("is never said for a lone request the worker went straight to: its silence is the stall's", () => {
    const h = harness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(th(0));
    h.run(59_000);
    expect(h.busy).toEqual([]);
    h.run(2000);
    expect(h.stalls).toHaveLength(1);
    expect(h.held).toEqual(["g-0"]);
    h.run(5 * 60_000);
    expect(h.busy).toEqual([]);
  });

  it("is never said while nobody is online — the hold line covers that, once", () => {
    const h = harness();
    h.hub.line(th(0));
    h.run(90_000);
    expect(h.busy).toEqual([]);
    expect(h.held).toEqual(["g-0"]);
    expect(h.hub.queue("Trabolta")).toEqual({ depth: 1, oldestMs: 90_000, stalled: false });
  });
});

describe("AgentHub — the public talk thread (wave 32, C4)", () => {
  const stage: AgentThread = { character: "Trabolta", channel: "loc:The Desktop", audience: ["@Clippy"], public: true };

  it("goes out ahead of every DM queued before it", () => {
    const h = harness();
    for (let n = 0; n < 3; n++) h.hub.line(th(n));
    h.hub.line(stage);
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    expect(a.requests().map((r) => r.thread.channel)).toEqual(["loc:The Desktop", "dm:Trabolta", "dm:Trabolta", "dm:Trabolta"]);
  });

  it("is first again when a stall clears", () => {
    const h = harness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(th(0));
    h.run(61_000); // stalled on g-0
    h.hub.line(th(1));
    h.hub.line(stage);
    expect(a.requests()).toHaveLength(1);
    h.hub.settle(a.requests()[0]!.id, "laptop");
    expect(a.requests().slice(1).map((r) => r.thread.channel)).toEqual(["loc:The Desktop", "dm:Trabolta"]);
  });

  it("never hears the busy line behind a burst; held once with nobody online", () => {
    const h = harness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(th(0));
    h.hub.line(stage);
    h.run(45_000);
    expect(h.busy).toEqual([]);
    const b = harness();
    b.hub.line(stage);
    b.run(90_000);
    expect(b.held).toEqual(["@Clippy"]);
  });

  it("openOn reads the owed request; answeredByHand closes it", () => {
    const h = harness();
    expect(h.hub.openOn(stage)).toBeNull();
    h.hub.line(stage);
    expect(h.hub.openOn(stage)).toMatchObject({ since: 1000 });
    expect(h.hub.answeredByHand(stage)).toBe(true);
    expect(h.hub.openOn(stage)).toBeNull();
  });
});

describe("AgentHub — a stalled worker", () => {
  it("stalls after 60 s unanswered: one # hosts line, the hold line once per waiting thread, no new dispatch, requests kept", () => {
    const h = harness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    for (let n = 0; n < 3; n++) h.hub.line(th(n));
    expect(a.requests()).toHaveLength(3);
    h.run(60_000);
    expect(h.hub.queue("Trabolta").stalled).toBe(false); // 60 s exactly: not yet
    expect(h.busy.sort()).toEqual(["g-1", "g-2"]); // behind g-0, before the stall (g-0's own wait is the stall's)
    const before = h.presence();
    h.run(1000);
    expect(h.hub.queue("Trabolta")).toEqual({ depth: 3, oldestMs: 61_000, stalled: true });
    expect(h.stalls).toEqual([{ name: "laptop", characters: ["Trabolta"], waiting: 3 }]);
    expect(h.held.sort()).toEqual(["g-0", "g-1", "g-2"]);
    expect(h.presence()).toBe(before + 1);
    // A new guest while stalled: queued, not sent; the hold line after 20 s, once.
    h.hub.line(th(3));
    expect(a.requests()).toHaveLength(3);
    h.run(25_000);
    expect(h.held.filter((g) => g === "g-3")).toEqual(["g-3"]);
    expect(h.busy).not.toContain("g-3");
    // The night goes on stalled: still one hosts line, still one hold each.
    h.run(5 * 60_000);
    expect(h.stalls).toHaveLength(1);
    expect(h.held.sort()).toEqual(["g-0", "g-1", "g-2", "g-3"]);
    // It got no new thread while stalled: only re-sends of what it already
    // had (the reply timeout's retry), never g-3.
    expect(new Set(a.requests().map((r) => r.thread.audience[0]))).toEqual(new Set(["g-0", "g-1", "g-2"]));
    expect(h.hub.pending.map((p) => p.thread.audience[0])).toContain("g-3");
  });

  it("clears on the next reply: the queue goes to it at once", () => {
    const h = harness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(th(0));
    h.hub.line(th(1));
    h.run(61_000);
    expect(h.hub.queue("Trabolta").stalled).toBe(true);
    h.hub.line(th(2)); // queued while stalled
    expect(a.requests().map((r) => r.thread.audience[0])).toEqual(["g-0", "g-1"]);
    const presence = h.presence();
    expect(h.hub.settle(a.requests()[0]!.id, "laptop")).not.toBeNull();
    expect(h.hub.queue("Trabolta").stalled).toBe(false);
    expect(h.presence()).toBe(presence + 1);
    expect(a.requests().map((r) => r.thread.audience[0])).toEqual(["g-0", "g-1", "g-2"]);
    expect(h.stalls).toHaveLength(1);
  });

  it("a late answer the hub refuses still shows the worker is answering", () => {
    const h = harness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(th(0));
    h.run(61_000);
    expect(h.hub.queue("Trabolta").stalled).toBe(true);
    expect(h.hub.settle("ar-gone", "laptop")).toBeNull();
    expect(h.hub.queue("Trabolta").stalled).toBe(false);
  });

  it("clears on a reconnect: the new stream is a fresh worker and takes the queue", () => {
    const h = harness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(th(0));
    h.run(61_000);
    h.hub.line(th(1));
    h.hub.detach("laptop");
    const b = h.worker("laptop-2");
    h.hub.attach(b.w);
    expect(h.hub.queue("Trabolta").stalled).toBe(false);
    expect(b.requests().map((r) => r.thread.audience[0]).sort()).toEqual(["g-0", "g-1"]);
    h.run(20_000);
    expect(h.held).toEqual(["g-0"]); // g-1 is in hand on a healthy worker: no hold line
  });

  it("a lone stalled worker holding nothing gets no new dispatch: the queue waits for an answer or a reconnect", () => {
    const h = harness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(th(0));
    h.run(61_000);
    h.hub.line(th(1));
    h.run(1000);
    h.hub.line(th(2));
    expect(h.hub.answeredByHand(th(0))).toBe(true); // a director answers the head
    h.run(5 * 60_000);
    expect(a.requests().map((r) => r.thread.audience[0])).toEqual(["g-0"]); // nothing new
    expect(h.hub.queue("Trabolta")).toMatchObject({ depth: 2, stalled: true });
    // A late answer to the cancelled copy ends the stall: the queue follows.
    expect(h.hub.settle(a.requests()[0]!.id, "laptop")).toBeNull();
    expect(a.requests().map((r) => r.thread.audience[0])).toEqual(["g-0", "g-1", "g-2"]);
    expect(h.hub.queue("Trabolta").stalled).toBe(false);
  });

  it("the reply timeout keeps working on a stalled worker, and nothing is held twice", () => {
    const h = harness({ replyTimeoutMs: 120_000 });
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(th(0));
    h.run(4 * 60_000 + 2000);
    // Sent, timed out, re-sent to the same worker, timed out again → given up.
    expect(a.got.filter(([e]) => e === "cancel")).toHaveLength(2);
    expect(h.hub.pending).toHaveLength(0);
    expect(h.held).toEqual(["g-0"]);
    // The guest writes again in the same stall, still unanswered: the thread
    // already heard the line, and the new request waits (no new dispatch).
    h.hub.line(th(0));
    h.run(3 * 60_000);
    expect(h.held).toEqual(["g-0"]);
    expect(a.requests()).toHaveLength(2);
  });

  it("the once-per-stall hold is forgotten when the stall ends: the worker goes, and offline the next request hears it again", () => {
    const h = harness({ replyTimeoutMs: 120_000 });
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(th(0));
    h.run(4 * 60_000 + 2000); // stalled, held, given up
    expect(h.held).toEqual(["g-0"]);
    h.hub.detach("laptop"); // the laptop goes: offline now
    h.hub.line(th(0));
    h.run(21_000);
    expect(h.held).toEqual(["g-0", "g-0"]); // the offline rule, as before wave 11
  });

  it("offline, a request after a given-up one hears the hold line again (the live behaviour before wave 11)", () => {
    const h = harness({ queueMaxAgeMs: 60_000 });
    h.hub.line(th(0));
    h.run(21_000);
    expect(h.held).toEqual(["g-0"]);
    h.run(70_000); // queued past its max age: given up (already held)
    expect(h.hub.pending).toHaveLength(0);
    h.hub.line(th(0));
    h.run(21_000);
    expect(h.held).toEqual(["g-0", "g-0"]);
  });

  it("a guest who writes again while stalled loses nothing: the late reply carries a follow-up, and the head's retry stays on the worker", () => {
    const h = harness({ replyTimeoutMs: 120_000 });
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(th(0));
    h.run(61_000);
    h.hub.line(th(0)); // more said while the stalled worker holds it
    h.run(60_000); // the head's reply timeout: cancelled and re-sent to the same worker
    expect(a.got.filter(([e]) => e === "cancel")).toHaveLength(1);
    expect(a.requests().map((r) => r.id)).toEqual([a.requests()[0]!.id, a.requests()[0]!.id]);
    expect(h.hub.pending).toHaveLength(1);
    // The old copy's late answer settles it, and says more was said meanwhile.
    expect(h.hub.settle(a.requests()[0]!.id, "laptop")).toMatchObject({ followUp: true });
    expect(h.hub.queue("Trabolta").stalled).toBe(false);
  });

  it("no double hold with the offline hold line: held while offline, then stalled after the worker comes back", () => {
    const h = harness();
    h.hub.line(th(0));
    h.run(21_000);
    expect(h.held).toEqual(["g-0"]);
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.run(61_000);
    expect(h.hub.queue("Trabolta").stalled).toBe(true);
    expect(h.held).toEqual(["g-0"]);
    expect(h.busy).toEqual([]); // a held request hears no busy line either
  });

  it("a story restart cancels cleanly: no stall, no queue, and the next line goes straight to the worker", () => {
    const h = harness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(th(0));
    h.hub.line(th(1));
    h.run(61_000);
    expect(h.hub.queue("Trabolta").stalled).toBe(true);
    h.hub.reset("Jo", "restart");
    expect(h.hub.queue("Trabolta")).toEqual({ depth: 0, oldestMs: null, stalled: false });
    expect(a.got.filter(([e]) => e === "cancel")).toHaveLength(2);
    h.run(10 * 60_000);
    expect(h.stalls).toHaveLength(1);
    expect(h.held.sort()).toEqual(["g-0", "g-1"]);
    h.hub.line(th(0)); // the restarted story: the thread may hear busy / hold anew
    expect(a.requests().at(-1)!.thread.audience[0]).toBe("g-0");
    h.run(61_000);
    expect(h.stalls).toHaveLength(2); // still wedged → stalls again, one more line
    expect(h.held.filter((g) => g === "g-0")).toHaveLength(2);
  });

  it("a pause doesn't count toward the stall", () => {
    const h = harness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(th(0));
    h.run(30_000);
    const pausedAt = h.now();
    h.skip(10 * 60_000);
    h.hub.shift(pausedAt, h.now());
    h.run(30_000);
    expect(h.hub.queue("Trabolta").stalled).toBe(false); // 60 s of open doors
    h.run(1000);
    expect(h.hub.queue("Trabolta").stalled).toBe(true);
    expect(h.stalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// EventRuntime wiring: busy:, the # hosts line, agentQueue, restore
// ---------------------------------------------------------------------------

const SOURCE = `# Queue

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

LOCATION Lobby

CHARACTER Trabolta
  listed: true
  mind: external
  hold: "Jean Trabolta is not responding."
  busy: "Trabolta is processing a high volume of requests. Please hold."
`;
const CODES = { event: "EVT333", prime: "PRM333", mod: "MOD333" };
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

function runtimeIn(d: string, now: () => number): EventRuntime {
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "queue", scenarioSource: SOURCE, joinBase: () => "http://localhost", now });
}

describe("EventRuntime — busy:, the stall's # hosts line and agentQueue", () => {
  it("busy: compiles onto the character", () => {
    const d = mkdtempSync(join(tmpdir(), "loom-agents-q-"));
    dirs.push(d);
    const rt = runtimeIn(d, () => 0);
    rt.openDoors();
    expect(rt.liveSim!.model.characters.get("Trabolta")?.busy).toBe("Trabolta is processing a high volume of requests. Please hold.");
    rt.dispose();
  });

  it("a burst says the busy line once, a stall posts one # hosts line and the hold line, the cast row reads the queue — and a restore says neither twice", async () => {
    let clock = 1_000_000;
    const d = mkdtempSync(join(tmpdir(), "loom-agents-q-"));
    dirs.push(d);
    const rt = runtimeIn(d, () => clock);
    rt.openDoors();
    const join2 = async (name: string) => {
      const g = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event });
      return { token: g.json["token"] as string, id: g.json["id"] as string };
    };
    const ada = await join2("Ada");
    const ben = await join2("Ben");
    const w = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hello?" }, { token: ada.token })).status).toBe(200);
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "me too?" }, { token: ben.token })).status).toBe(200);
    const tick = (ms: number) => {
      for (let t = 0; t < ms; t += 1000) {
        clock += 1000;
        rt.tickOnce(1000);
      }
    };
    const BUSY = "Trabolta is processing a high volume of requests. Please hold.";
    const HOLD = "Jean Trabolta is not responding.";
    const all = () => (rt as unknown as { chat: { all(): ChatMessage[] } }).chat.all();
    const dmOf = (msgs: ChatMessage[], id: string) => msgs.filter((m) => m.channel === "dm:Trabolta" && Array.isArray(m.audience) && m.audience.includes(id)).map((m) => m.text);
    const hosts = () => all().filter((m) => m.text.startsWith("⏳")).map((m) => [m.channel, m.text]).map(([c, t]) => { if (c !== "room:hosts") throw new Error(`hosts line in ${c}`); return t; });
    const queueRow = async () => ((await call(rt, "GET", "/api/state?role=mod", {}, { moderator: true })).json as unknown as ModView).cast.find((c) => c.id === "Trabolta")!.agentQueue;
    tick(41_000);
    // Ben waits in line behind Ada: the busy line; Ada's own wait is the stall's.
    expect(dmOf(all(), ada.id)).toEqual(["hello?"]);
    expect(dmOf(all(), ben.id)).toEqual(["me too?", BUSY]);
    expect(await queueRow()).toEqual({ depth: 2, oldestMs: 41_000, stalled: false });
    tick(20_000);
    expect(dmOf(all(), ada.id)).toEqual(["hello?", HOLD]);
    expect(dmOf(all(), ben.id)).toEqual(["me too?", BUSY, HOLD]);
    expect(hosts()).toHaveLength(1);
    expect(hosts()[0]).toMatch(/^⏳ Trabolta stopped answering \(worker laptop\): 2 threads are waiting and got the hold line\./u);
    expect(await queueRow()).toMatchObject({ depth: 2, stalled: true });
    tick(30_000);
    expect(hosts()).toHaveLength(1);
    // A restart of the process: both threads are re-asked as held, and the
    // busy line is never said a second time.
    w.close();
    rt.dispose();
    const again = runtimeIn(d, () => clock);
    expect(again.restore()).not.toBeNull();
    const hub = (again as unknown as { agents: AgentHub }).agents;
    expect(hub.pending.map((r) => r.thread.audience).sort()).toEqual([[ada.id], [ben.id]].sort());
    const w2 = await call(again, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    for (let t = 0; t < 61_000; t += 1000) {
      clock += 1000;
      again.tickOnce(1000);
    }
    const after = (again as unknown as { chat: { all(): ChatMessage[] } }).chat.all();
    expect(dmOf(after, ada.id)).toEqual(["hello?", HOLD]);
    expect(dmOf(after, ben.id)).toEqual(["me too?", BUSY, HOLD]);
    w2.close();
    again.dispose();
  });
});
