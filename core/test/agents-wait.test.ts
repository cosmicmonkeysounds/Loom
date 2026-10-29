//! The line, as a worker and a guest see it (wave 42b, B1/B2;
//! `server/agents.ts`, "Load and the line"). Every `request` frame carries
//! `queued` and `load {queued, inFlight, capacity}` as it goes out (on the
//! frame only, a legacy worker too). With a windowed worker each DM thread
//! is told where it stands — `queued` (1-based `position` in the rank
//! order, `etaS` from the mean service time), `answering`, `idle` — through
//! the hub's `wait` option, which the runtime sends as the `agentWait` SSE
//! frame to the thread's typing audience; a position change at most once
//! per 5 s per thread, a state change at once; never for a public talk
//! thread, never with only a legacy worker, never to a lean house tool;
//! a stall makes its threads idle until the worker answers again; a
//! reopened stream gets its threads' current waits after `history`.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { AGENT_SERVICE_DEFAULT_S, AgentHub, type AgentLineWait, type AgentRequest, type AgentThread, type AgentWorker } from "../server/agents.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";

// ---------------------------------------------------------------------------
// AgentHub (no sim, no sockets, an injected clock)
// ---------------------------------------------------------------------------

const th = (n: number): AgentThread => ({ character: "Trabolta", channel: "dm:Trabolta", audience: [`g-${n}`] });
const STAGE: AgentThread = { character: "Trabolta", channel: "loc:The Desktop", audience: ["@Clippy"], public: true };
const who = (r: AgentRequest): string => r.thread.audience[0]!;

function harness(opts: { queueMaxAgeMs?: number; replyTimeoutMs?: number; maxAttempts?: number; stallAfterMs?: number; stale?: (req: AgentRequest) => boolean; letterLoad?: (workerId: string) => number } = {}) {
  let clock = 1000;
  const heart = new Set<string>();
  /** Every wait told, in order: `[guest, wait]`. */
  const waits: Array<[string, AgentLineWait]> = [];
  const hub = new AgentHub({
    build: (thread, id) =>
      ({
        id,
        character: thread.character,
        thread,
        text: "hi",
        history: [{ seq: 1, mine: false, from: thread.audience[0]!, text: "hi" }],
        at: clock,
      }) as unknown as AgentRequest,
    rank: (req) => (req.thread.public === true ? 0 : heart.has(req.thread.audience[0]!) ? 1 : 2),
    wait: (thread, wait) => waits.push([thread.audience[0]!, wait]),
    hold: () => true,
    busy: () => true,
    now: () => clock,
    ...opts,
  });
  const worker = (id: string, capacity?: number) => {
    const got: Array<[string, unknown]> = [];
    const w: AgentWorker = { id, name: id, characters: new Set(["Trabolta"]), send: (e, d) => got.push([e, d]), ...(capacity !== undefined ? { capacity } : {}) };
    const requests = () => got.filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
    return { w, requests, sent: () => requests().map(who) };
  };
  const say = (n: number | AgentThread) => hub.line(typeof n === "number" ? th(n) : n);
  const answer = (n: number | AgentThread, workerId: string) => {
    const o = hub.openOn(typeof n === "number" ? th(n) : n);
    if (o === null) throw new Error(`no open request for ${String(n)}`);
    return hub.settle(o.id, workerId);
  };
  /** Advance the clock a second at a time, sweeping like the 1 s ticker. */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 1000) {
      clock += 1000;
      hub.sweep();
    }
  };
  /** The waits told since `from` (an index into `waits`). */
  const since = (from: number) => waits.slice(from);
  return { hub, worker, say, answer, run, waits, since, heart, tick: (ms: number) => (clock += ms) };
}

describe("B1: the line rides on every request frame", () => {
  it("a windowed worker's frames carry queued and load at send time; the hub's copy does not", () => {
    const h = harness();
    const a = h.worker("laptop", 2);
    h.hub.attach(a.w);
    for (let n = 0; n < 5; n++) h.say(n);
    const [r0, r1] = a.requests();
    expect(r0!.queued).toBe(0);
    expect(r0!.load).toEqual({ queued: 0, inFlight: 1, capacity: 2 });
    expect(r1!.load).toEqual({ queued: 0, inFlight: 2, capacity: 2 });
    h.answer(0, "laptop");
    const r2 = a.requests()[2]!;
    expect(who(r2)).toBe("g-2");
    // g-3 and g-4 still wait; g-1 and g-2 are in the slots.
    expect(r2.queued).toBe(2);
    expect(r2.load).toEqual({ queued: 2, inFlight: 2, capacity: 2 });
    for (const p of h.hub.pending) {
      expect("queued" in p).toBe(false);
      expect("load" in p).toBe(false);
    }
  });

  it("a legacy worker gets the same fields (its capacity reads one)", () => {
    const h = harness();
    const a = h.worker("old");
    h.hub.attach(a.w);
    for (let n = 0; n < 3; n++) h.say(n);
    expect(a.requests().map((r) => r.load)).toEqual([
      { queued: 0, inFlight: 1, capacity: 1 },
      { queued: 0, inFlight: 2, capacity: 1 },
      { queued: 0, inFlight: 3, capacity: 1 },
    ]);
    expect(a.requests().map((r) => r.queued)).toEqual([0, 0, 0]);
  });

  it("two windowed workers' slots are summed", () => {
    const h = harness();
    const a = h.worker("a", 2);
    const b = h.worker("b", 3);
    h.hub.attach(a.w);
    h.hub.attach(b.w);
    h.say(0);
    expect([...a.requests(), ...b.requests()][0]!.load).toEqual({ queued: 0, inFlight: 1, capacity: 5 });
    expect(h.hub.loadFor("Trabolta")).toEqual({ queued: 0, inFlight: 1, capacity: 5 });
  });
});

describe("B2: agentWait in the hub", () => {
  it("enqueue: the one a slot takes is answering, the rest queued in order with an eta", () => {
    const h = harness();
    h.hub.attach(h.worker("laptop", 1).w);
    for (let n = 0; n < 4; n++) h.say(n);
    expect(h.waits).toEqual([
      ["g-0", { state: "answering" }],
      ["g-1", { state: "queued", position: 1, etaS: AGENT_SERVICE_DEFAULT_S }],
      ["g-2", { state: "queued", position: 2, etaS: 2 * AGENT_SERVICE_DEFAULT_S }],
      ["g-3", { state: "queued", position: 3, etaS: 3 * AGENT_SERVICE_DEFAULT_S }],
    ]);
  });

  it("a settle: idle for the answered, answering for the next at once; positions move, at most once per 5 s per thread", () => {
    const h = harness();
    h.hub.attach(h.worker("laptop", 1).w);
    for (let n = 0; n < 4; n++) h.say(n);
    h.tick(10_000);
    let from = h.waits.length;
    h.answer(0, "laptop"); // took 10 s: mean 6 + 0.2 × (10 − 6) = 6.8
    expect(h.hub.serviceMeanS("Trabolta")).toBeCloseTo(6.8);
    expect(h.since(from)).toEqual([
      ["g-0", { state: "idle" }],
      ["g-1", { state: "answering" }],
      ["g-2", { state: "queued", position: 1, etaS: 7 }],
      ["g-3", { state: "queued", position: 2, etaS: 14 }],
    ]);
    // At once again (took 0 s: mean 6.8 − 0.2 × 6.8 = 5.44): g-2's state
    // changes (told), g-3's position moves 5 s too soon (held back).
    from = h.waits.length;
    h.answer(1, "laptop");
    expect(h.since(from)).toEqual([
      ["g-1", { state: "idle" }],
      ["g-2", { state: "answering" }],
    ]);
    h.run(4000);
    expect(h.since(from)).toHaveLength(2);
    h.run(1000);
    expect(h.since(from)).toEqual([
      ["g-1", { state: "idle" }],
      ["g-2", { state: "answering" }],
      ["g-3", { state: "queued", position: 1, etaS: 6 }],
    ]);
    // Nothing moves: nothing more is told.
    from = h.waits.length;
    h.run(10_000);
    expect(h.since(from)).toEqual([]);
  });

  it("eta = ceil(position × mean ÷ the windowed slots)", () => {
    const h = harness();
    h.hub.attach(h.worker("laptop", 2).w);
    for (let n = 0; n < 7; n++) h.say(n);
    // 2 answering, 5 queued at the default 6 s over 2 slots.
    expect(h.waits.filter(([, w]) => w.state === "queued").map(([g, w]) => [g, w.position, w.etaS])).toEqual([
      ["g-2", 1, 3],
      ["g-3", 2, 6],
      ["g-4", 3, 9],
      ["g-5", 4, 12],
      ["g-6", 5, 15],
    ]);
    h.tick(16_000);
    h.answer(0, "laptop"); // mean 6 + 0.2 × 10 = 8; g-2 takes the slot
    expect(h.hub.waitOf(th(3))).toEqual({ state: "queued", position: 1, etaS: 4 });
    expect(h.hub.waitOf(th(6))).toEqual({ state: "queued", position: 4, etaS: 16 });
    expect(h.hub.waitOf(th(2))).toEqual({ state: "answering" });
    expect(h.hub.waitOf(th(0))).toBeNull();
  });

  it("a guest who reaches his heart moves to the front: positions follow the rank order", () => {
    const h = harness();
    h.hub.attach(h.worker("laptop", 1).w);
    for (let n = 0; n < 4; n++) h.say(n);
    h.heart.add("g-3");
    h.run(5000);
    expect(h.hub.waitOf(th(3))).toEqual({ state: "queued", position: 1, etaS: 6 });
    expect(h.hub.waitOf(th(1))).toEqual({ state: "queued", position: 2, etaS: 12 });
    expect(h.waits.filter(([g]) => g === "g-3").at(-1)![1]).toMatchObject({ position: 1 });
  });

  it("idle on a hand answer (queued or in a slot), a give-up, and the last window going; queued again when one comes back", () => {
    const h = harness({ queueMaxAgeMs: 30_000 });
    const a = h.worker("laptop", 1);
    h.hub.attach(a.w);
    for (let n = 0; n < 4; n++) h.say(n);
    let from = h.waits.length;
    expect(h.hub.answeredByHand(th(2))).toBe(true); // queued
    expect(h.since(from)).toEqual([["g-2", { state: "idle" }]]);
    expect(h.hub.answeredByHand(th(0))).toBe(true); // in the slot
    expect(h.since(from).slice(1, 3)).toEqual([
      ["g-0", { state: "idle" }],
      ["g-1", { state: "answering" }],
    ]);
    // The worker goes: every wait told goes idle (no window — the hold line's case).
    from = h.waits.length;
    h.hub.detach("laptop");
    expect(h.since(from).map(([g, w]) => [g, w.state]).sort()).toEqual([
      ["g-1", "idle"],
      ["g-3", "idle"],
    ]);
    // It comes back: the queue goes out, and they are told again.
    from = h.waits.length;
    const b = h.worker("laptop-2", 1);
    h.hub.attach(b.w);
    expect(h.since(from)).toEqual([
      ["g-1", { state: "answering" }],
      ["g-3", { state: "queued", position: 1, etaS: 6 }],
    ]);
    // g-3 waits past the queue's max age: given up, idle.
    from = h.waits.length;
    h.run(31_000); // before the worker would stall (60 s)
    expect(h.since(from)).toContainEqual(["g-3", { state: "idle" }]);
    expect(h.hub.waitOf(th(3))).toBeNull();
  });

  it("a story restart: every wait goes idle", () => {
    const h = harness();
    h.hub.attach(h.worker("laptop", 1).w);
    for (let n = 0; n < 3; n++) h.say(n);
    const from = h.waits.length;
    h.hub.reset();
    expect(h.since(from).map(([g, w]) => [g, w.state])).toEqual([
      ["g-0", "idle"],
      ["g-1", "idle"],
      ["g-2", "idle"],
    ]);
  });

  it("a public talk thread is never told, but holds its place at the front", () => {
    const h = harness();
    const a = h.worker("laptop", 1);
    h.hub.attach(a.w);
    h.say(0);
    h.say(1);
    h.say(STAGE);
    expect(h.hub.waitOf(STAGE)).toBeNull();
    expect(h.hub.waitOf(th(1))).toEqual({ state: "queued", position: 2, etaS: 12 });
    h.answer(0, "laptop");
    expect(a.sent().at(-1)).toBe("@Clippy");
    expect(h.waits.some(([g]) => g === "@Clippy")).toBe(false);
    expect(h.hub.waitList().map(({ thread }) => thread.audience[0])).toEqual(["g-1"]);
  });

  it("a stall: every thread goes idle (the hold line is all it shows), and is told again once the worker answers", () => {
    const h = harness();
    const a = h.worker("laptop", 1);
    h.hub.attach(a.w);
    for (let n = 0; n < 3; n++) h.say(n);
    expect(h.hub.waitOf(th(2))).toEqual({ state: "queued", position: 2, etaS: 12 });
    // 70 s of silence: stalled at 60 s (the reply timeout is 120 s).
    let from = h.waits.length;
    h.run(70_000);
    expect(h.since(from).map(([g, w]) => [g, w.state]).sort()).toEqual([
      ["g-0", "idle"],
      ["g-1", "idle"],
      ["g-2", "idle"],
    ]);
    expect(h.hub.waitList()).toEqual([]);
    expect(h.hub.waitOf(th(0))).toBeNull(); // in its stalled slot
    expect(h.hub.waitOf(th(2))).toBeNull(); // no place, no eta
    // Nothing more while it stays stalled (no stale "position 1, eta 6 s").
    from = h.waits.length;
    h.run(20_000);
    expect(h.since(from)).toEqual([]);
    // It answers g-0: the line moves and every wait is told again at once.
    h.answer(0, "laptop");
    const mean = h.hub.serviceMeanS("Trabolta");
    expect(h.since(from)).toEqual([
      ["g-1", { state: "answering" }],
      ["g-2", { state: "queued", position: 1, etaS: Math.ceil(mean) }],
    ]);
  });

  it("a stalled worker's in-flight thread goes idle; a healthy one's slots still count", () => {
    const h = harness({ stallAfterMs: 30_000 });
    h.hub.attach(h.worker("a", 1).w);
    h.say(0); // a's slot
    h.run(10_000);
    h.hub.attach(h.worker("b", 1).w);
    h.say(1); // b's slot
    h.say(2);
    h.say(3);
    h.run(25_000); // a stalls (35 s without an answer); b at 25 s does not
    expect(h.hub.waitOf(th(0))).toBeNull();
    expect(h.hub.waitOf(th(1))).toEqual({ state: "answering" });
    // b alone takes the line: one live slot.
    expect(h.hub.waitOf(th(2))).toEqual({ state: "queued", position: 1, etaS: 6 });
    expect(h.hub.waitOf(th(3))).toEqual({ state: "queued", position: 2, etaS: 12 });
  });

  it("a reply timeout re-dispatches with no idle blip, and the re-sent frame carries the line", () => {
    const h = harness({ replyTimeoutMs: 30_000 });
    const a = h.worker("laptop", 1);
    h.hub.attach(a.w);
    for (let n = 0; n < 3; n++) h.say(n);
    const from = h.waits.length;
    h.run(31_000);
    expect(a.sent()).toEqual(["g-0", "g-0"]);
    const again = a.requests().at(-1)!;
    expect(again.queued).toBe(2);
    expect(again.load).toEqual({ queued: 2, inFlight: 1, capacity: 1 });
    expect(h.since(from)).toEqual([]); // still answering, still 1st and 2nd
    expect(h.hub.waitOf(th(0))).toEqual({ state: "answering" });
  });

  it("a stale request holds no place, and goes idle when the pump drops it", () => {
    const stale = new Set<string>();
    const h = harness({ stale: (req) => stale.has(who(req)) });
    h.hub.attach(h.worker("laptop", 1).w);
    for (let n = 0; n < 4; n++) h.say(n);
    stale.add("g-1");
    // At once, before any pump: g-2 is 1st.
    expect(h.hub.waitOf(th(2))).toEqual({ state: "queued", position: 1, etaS: 6 });
    let from = h.waits.length;
    h.run(1000);
    expect(h.since(from)).toEqual([["g-1", { state: "idle" }]]);
    expect(h.hub.openOn(th(1))).toBeNull();
    from = h.waits.length;
    h.run(4000); // the moved places, once the 5 s throttle allows
    expect(h.since(from)).toEqual([
      ["g-2", { state: "queued", position: 1, etaS: 6 }],
      ["g-3", { state: "queued", position: 2, etaS: 12 }],
    ]);
  });

  it("eta divides by the slots left after letters (and rulings) out", () => {
    const letters = new Map<string, number>([["laptop", 1]]);
    const h = harness({ letterLoad: (id) => letters.get(id) ?? 0 });
    h.hub.attach(h.worker("laptop", 2).w);
    for (let n = 0; n < 3; n++) h.say(n);
    // One slot writes a letter, one answers g-0: the line moves one at a time.
    expect(h.hub.waitOf(th(1))).toEqual({ state: "queued", position: 1, etaS: 6 });
    expect(h.hub.waitOf(th(2))).toEqual({ state: "queued", position: 2, etaS: 12 });
    letters.set("laptop", 2); // both slots busy elsewhere: at least 1
    expect(h.hub.waitOf(th(2))).toEqual({ state: "queued", position: 2, etaS: 12 });
    letters.clear();
    expect(h.hub.waitOf(th(2))).toEqual({ state: "queued", position: 2, etaS: 6 });
  });

  it("a mixed fleet (legacy + windowed): the legacy worker takes the overflow at once, so every thread reads answering; idle when the window goes", () => {
    const h = harness();
    const win = h.worker("laptop", 1);
    const old = h.worker("old");
    h.hub.attach(win.w);
    h.hub.attach(old.w);
    for (let n = 0; n < 4; n++) h.say(n);
    expect(win.sent()).toEqual(["g-0"]);
    expect(old.sent()).toEqual(["g-1", "g-2", "g-3"]);
    expect(h.hub.loadFor("Trabolta")).toEqual({ queued: 0, inFlight: 4, capacity: 2 });
    // Nothing waits in the hub's queue, so nobody is told a place: the
    // legacy line is "answering" (as its typing is), though its worker
    // answers it one at a time.
    expect(h.waits).toEqual([0, 1, 2, 3].map((n) => [`g-${n}`, { state: "answering" }]));
    // Only the legacy worker left: it holds the whole line, every wait idle.
    const from = h.waits.length;
    h.hub.detach("laptop");
    expect(h.since(from).map(([g, w]) => [g, w.state]).sort()).toEqual([0, 1, 2, 3].map((n) => [`g-${n}`, "idle"]));
    expect(h.hub.waitList()).toEqual([]);
  });

  it("a legacy worker (it holds the whole line) and nobody online: no wait is ever told", () => {
    const h = harness();
    for (let n = 0; n < 3; n++) h.say(n); // nobody online: queued in the hub
    h.run(5000);
    expect(h.waits).toEqual([]);
    const a = h.worker("old");
    h.hub.attach(a.w);
    h.say(3);
    h.answer(0, "old");
    h.run(10_000);
    expect(a.sent()).toEqual(["g-0", "g-1", "g-2", "g-3"]);
    expect(h.waits).toEqual([]);
    expect(h.hub.waitList()).toEqual([]);
    expect(h.hub.serviceMeanS("Trabolta")).toBe(AGENT_SERVICE_DEFAULT_S); // a legacy answer feeds no mean
  });
});

// ---------------------------------------------------------------------------
// EventRuntime: the agentWait frame, its audience, a reconnect
// ---------------------------------------------------------------------------

const SOURCE = `# Wait

LOCATION Lobby

CHARACTER Trabolta
  listed: true
  mind: external
  hold: "Jean Trabolta is not responding."
  busy: "Trabolta is processing a high volume of requests. Please hold."

CHARACTER Clippy
  listed: true

CHARACTER Norton
  listed: true

CHARACTER Task Manager
  listed: true
  admin: true
`;
const CODES = { event: "EVT555", prime: "PRM555", mod: "MOD555" };
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
    setHeader() {
      return res;
    },
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

type WaitFrame = { channel: string; audience: string[]; character: string; state: string; position?: number; etaS?: number };

async function room(guests: number, query: string) {
  let clock = 1_000_000;
  const d = mkdtempSync(join(tmpdir(), "loom-agents-wait-"));
  dirs.push(d);
  const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "wait", scenarioSource: SOURCE, joinBase: () => "http://localhost", now: () => clock });
  rt.openDoors();
  const people: Array<{ id: string; token: string }> = [];
  for (let i = 0; i < guests; i++) {
    const g = await call(rt, "POST", "/api/guest/register", { name: `Guest ${i}`, passcode: CODES.event });
    people.push({ id: g.json["id"] as string, token: g.json["token"] as string });
  }
  /** Each guest's own stream (the phone). */
  const phones = await Promise.all(people.map((p) => call(rt, "GET", "/events?role=guest", {}, { token: p.token })));
  const director = await call(rt, "GET", "/events?role=mod", {}, { moderator: true });
  /** A house tool on the mod feed (stagehand): never an agentWait. */
  const lean = await call(rt, "GET", "/events?role=mod&lean=1", {}, { moderator: true });
  const w = await call(rt, "GET", `/api/agent/stream?characters=Trabolta&name=laptop${query}`, {}, { moderator: true });
  const requests = () => w.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
  const say = (i: number, text: string) => call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text }, { token: people[i]!.token });
  const waitsOf = (s: { res: { frames(): Array<[string, unknown]> } }) => s.res.frames().filter(([e]) => e === "agentWait").map(([, d]) => d as WaitFrame);
  const tick = (ms: number) => {
    for (let t = 0; t < ms; t += 1000) {
      clock += 1000;
      rt.tickOnce(1000);
    }
  };
  const done = () => {
    w.close();
    for (const p of phones) p.close();
    director.close();
    lean.close();
    rt.dispose();
  };
  return { rt, people, phones, director, lean, w, requests, say, waitsOf, tick, done };
}

describe("EventRuntime — agentWait", () => {
  it("each phone hears only its own thread's wait; a director hears every one; the frame's shape", async () => {
    const r = await room(3, "&capacity=1");
    await r.say(0, "hello?");
    await r.say(1, "me too");
    await r.say(2, "and me");
    const [p0, p1, p2] = r.people;
    expect(r.waitsOf(r.phones[0]!)).toEqual([{ channel: "dm:Trabolta", audience: [p0!.id], character: "Trabolta", state: "answering" }]);
    expect(r.waitsOf(r.phones[1]!)).toEqual([{ channel: "dm:Trabolta", audience: [p1!.id], character: "Trabolta", state: "queued", position: 1, etaS: 6 }]);
    expect(r.waitsOf(r.phones[2]!)).toEqual([{ channel: "dm:Trabolta", audience: [p2!.id], character: "Trabolta", state: "queued", position: 2, etaS: 12 }]);
    // Another guest never receives my wait.
    for (let i = 0; i < 3; i++) for (const f of r.waitsOf(r.phones[i]!)) expect(f.audience).toEqual([r.people[i]!.id]);
    expect(r.waitsOf(r.director).map((f) => f.audience[0])).toEqual([p0!.id, p1!.id, p2!.id]);
    // A lean house tool on the mod feed: none (it never reads them).
    expect(r.waitsOf(r.lean)).toEqual([]);
    r.done();
  });

  it("the request frames carry queued and load; a reply moves the line and tells it", async () => {
    const r = await room(3, "&capacity=1");
    await r.say(0, "hello?");
    await r.say(1, "me too");
    await r.say(2, "and me");
    expect(r.requests()[0]!.load).toEqual({ queued: 0, inFlight: 1, capacity: 1 });
    r.tick(6000);
    expect((await call(r.rt, "POST", "/api/agent/reply", { id: r.requests()[0]!.id, say: "Welcome." }, { moderator: true })).status).toBe(200);
    const second = r.requests()[1]!;
    expect(second.speaker.id).toBe(r.people[1]!.id);
    expect(second.queued).toBe(1);
    expect(second.load).toEqual({ queued: 1, inFlight: 1, capacity: 1 });
    expect(r.waitsOf(r.phones[0]!).at(-1)!.state).toBe("idle");
    expect(r.waitsOf(r.phones[1]!).at(-1)!.state).toBe("answering");
    expect(r.waitsOf(r.phones[2]!).at(-1)).toMatchObject({ state: "queued", position: 1, etaS: 6 });
    r.done();
  });

  it("a reopened stream learns its place after history; typing is not replayed", async () => {
    const r = await room(3, "&capacity=1");
    await r.say(0, "hello?");
    await r.say(1, "me too");
    await r.say(2, "and me");
    r.phones[2]!.close();
    const again = await call(r.rt, "GET", "/events?role=guest", {}, { token: r.people[2]!.token });
    const events = again.res.frames().map(([e]) => e);
    expect(events.indexOf("agentWait")).toBeGreaterThan(events.indexOf("history"));
    expect(r.waitsOf(again)).toEqual([{ channel: "dm:Trabolta", audience: [r.people[2]!.id], character: "Trabolta", state: "queued", position: 2, etaS: 12 }]);
    // The one being answered learns `answering` (its typing stand-in).
    const first = await call(r.rt, "GET", "/events?role=guest", {}, { token: r.people[0]!.token });
    expect(r.waitsOf(first).map((f) => f.state)).toEqual(["answering"]);
    expect(first.res.frames().some(([e]) => e === "typing")).toBe(false);
    again.close();
    first.close();
    r.done();
  });

  it("the typing audience: a performer's booth hears its own cast thread, an admin booth every one, a host booth (not admin) none", async () => {
    const r = await room(1, "&capacity=1");
    const booth = async (character: string, mod = false) => {
      const token = (await call(r.rt, "POST", "/api/prime/login", { character, passcode: CODES.prime })).json["token"] as string;
      if (mod) expect((await call(r.rt, "POST", "/api/mod/login", { passcode: CODES.mod, token })).status).toBe(200);
      return { token, stream: await call(r.rt, "GET", `/events?role=prime&token=${encodeURIComponent(token)}`, {}) };
    };
    const clippy = await booth("Clippy");
    const admin = await booth("Norton", true);
    const host = await booth("Task Manager");
    await r.say(0, "hello?"); // in the slot
    expect((await call(r.rt, "POST", "/api/prime/say", { channel: "cast:Trabolta", text: "Boss?" }, { token: clippy.token })).status).toBe(200);
    const g = r.people[0]!.id;
    const seen = (s: typeof clippy) => r.waitsOf(s.stream).map((f) => [f.channel, f.audience[0], f.state, f.position ?? null]);
    const typed = (s: typeof clippy) => s.stream.res.frames().filter(([e]) => e === "typing").map(([, d]) => (d as { audience: string[] }).audience[0]);
    expect(seen(clippy)).toEqual([["dm:Trabolta", "@Clippy", "queued", 1]]);
    expect(seen(admin)).toEqual([
      ["dm:Trabolta", g, "answering", null],
      ["dm:Trabolta", "@Clippy", "queued", 1],
    ]);
    expect(seen(host)).toEqual([]);
    // The same people as its typing.
    expect(typed(admin)).toEqual([g]);
    expect(typed(host)).toEqual([]);
    expect(r.waitsOf(r.phones[0]!).map((f) => f.audience[0])).toEqual([g]);
    for (const b of [clippy, admin, host]) b.stream.close();
    r.done();
  });

  it("a stalled worker: 70 s of silence leaves every phone idle under the hold line; a reply tells them again", async () => {
    const r = await room(3, "&capacity=1");
    await r.say(0, "hello?");
    await r.say(1, "me too");
    await r.say(2, "and me");
    r.tick(70_000);
    for (const p of r.phones) {
      expect(r.waitsOf(p).at(-1)!.state).toBe("idle");
      const said = p.res.frames().filter(([e]) => e === "message").map(([, d]) => (d as { text: string }).text);
      expect(said).toContain("Jean Trabolta is not responding.");
    }
    expect((await call(r.rt, "POST", "/api/agent/reply", { id: r.requests()[0]!.id, say: "Sorry, I was away." }, { moderator: true })).status).toBe(200);
    expect(r.waitsOf(r.phones[0]!).at(-1)!.state).toBe("idle");
    expect(r.waitsOf(r.phones[1]!).at(-1)!.state).toBe("answering");
    expect(r.waitsOf(r.phones[2]!).at(-1)).toMatchObject({ state: "queued", position: 1 });
    r.done();
  });

  it("a legacy stream: no agentWait at all, the frames still carry the line", async () => {
    const r = await room(3, "");
    await r.say(0, "a");
    await r.say(1, "b");
    await r.say(2, "c");
    r.tick(10_000);
    expect(r.requests().map((q) => q.load)).toEqual([
      { queued: 0, inFlight: 1, capacity: 1 },
      { queued: 0, inFlight: 2, capacity: 1 },
      { queued: 0, inFlight: 3, capacity: 1 },
    ]);
    for (const p of r.phones) expect(r.waitsOf(p)).toEqual([]);
    expect(r.waitsOf(r.director)).toEqual([]);
    r.done();
  });
});
