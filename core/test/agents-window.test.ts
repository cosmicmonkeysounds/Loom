//! Trabolta under load (wave 42, C1–C6; `server/agents.ts`): a worker that
//! opens its stream with `capacity=N` is **windowed** — it never holds more
//! than N open voice requests, rulings and letters; the rest wait in the
//! hub's queue by rank (public talk, a guest at his heart, the rest), FIFO
//! within a rank, and every settle / cancel / timeout / detach / attach /
//! stall clear pumps the queue into free slots. A queued body is built at
//! dispatch, typing turns on only then, each request runs its own reply
//! clock, the stall clock runs from the worker's last answer, the busy line
//! reaches a request still queued at 40 s, and a ruling takes a slot once
//! it has waited `judgeAgeMs`. No `capacity` keeps the legacy hub exactly
//! (`agents.test.ts`, `agents-queue.test.ts` pin that).

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { AGENT_CAPACITY_MAX, AGENT_JUDGE_AGE_MS, AgentHub, agentCapacityOf, type AgentJudgeRequest, type AgentRequest, type AgentThread, type AgentWorker } from "../server/agents.ts";
import type { ChatMessage } from "../server/chat.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { ModView } from "../server/views.ts";

// ---------------------------------------------------------------------------
// AgentHub (no sim, no sockets, an injected clock)
// ---------------------------------------------------------------------------

const th = (n: number): AgentThread => ({ character: "Trabolta", channel: "dm:Trabolta", audience: [`g-${n}`] });
const STAGE: AgentThread = { character: "Trabolta", channel: "loc:The Desktop", audience: ["@Clippy"], public: true };
const who = (r: AgentRequest): string => r.thread.audience[0]!;

interface HarnessOpts {
  replyTimeoutMs?: number;
  stallAfterMs?: number;
  judgeAgeMs?: number;
  maxAttempts?: number;
  letterLoad?: (workerId: string) => number;
}

/**
 * A hub whose `build` reads the thread's lines as the runtime would: the
 * body's `text` is the newest line the guest said, `history` every line.
 * `say(n, text)` is a guest line (recorded, then `hub.line`), so a test can
 * see which lines a body carried when it went out.
 */
function harness(opts: HarnessOpts = {}) {
  let clock = 1000;
  let builds = 0;
  const lines = new Map<string, string[]>();
  const heart = new Set<string>();
  const typing: Array<[string, boolean]> = [];
  const held: string[] = [];
  const busy: string[] = [];
  const stalls: Array<{ name: string; waiting: number }> = [];
  const hub = new AgentHub({
    build: (thread, id) => {
      builds += 1;
      const said = lines.get(thread.audience[0]!) ?? [];
      return {
        id,
        character: thread.character,
        thread,
        text: said[said.length - 1] ?? "",
        history: said.map((text, i) => ({ seq: i + 1, mine: false, from: thread.audience[0]!, text })),
        them: { vars: heart.has(thread.audience[0]!) ? { at_the_heart: "true" } : {} },
        at: clock,
      } as unknown as AgentRequest;
    },
    // The runtime's rank (wave 32): the stage, a guest at his heart, the rest.
    rank: (req) => (req.thread.public === true ? 0 : req.them?.vars?.["at_the_heart"] === "true" ? 1 : 2),
    typing: (thread, on) => typing.push([thread.audience[0]!, on]),
    hold: (req) => {
      held.push(who(req));
      return true;
    },
    busy: (req) => {
      busy.push(who(req));
      return true;
    },
    stalled: (w, waiting) => stalls.push({ name: w.name, waiting }),
    now: () => clock,
    ...opts,
  });
  const worker = (id: string, capacity?: number, characters = ["Trabolta"]) => {
    const got: Array<[string, unknown]> = [];
    const w: AgentWorker = { id, name: id, characters: new Set(characters), send: (e, d) => got.push([e, d]), ...(capacity !== undefined ? { capacity } : {}) };
    const requests = () => got.filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
    return {
      w,
      got,
      requests,
      /** Who it was sent, in order. */
      sent: () => requests().map(who),
      cancels: () => got.filter(([e]) => e === "cancel").map(([, d]) => (d as { id: string }).id),
      judges: () => got.filter(([e]) => e === "judge").map(([, d]) => d as AgentJudgeRequest),
    };
  };
  const say = (n: number | AgentThread, text = `hi from ${typeof n === "number" ? n : "the stage"}`) => {
    const t = typeof n === "number" ? th(n) : n;
    const key = t.audience[0]!;
    lines.set(key, [...(lines.get(key) ?? []), text]);
    hub.line(t);
  };
  /** The open request on guest `n`'s thread (its id), or undefined. */
  const openOf = (n: number | AgentThread) => hub.openOn(typeof n === "number" ? th(n) : n);
  /** Settle guest `n`'s open request as `worker` answering it. */
  const answer = (n: number | AgentThread, workerId: string) => {
    const o = openOf(n);
    if (o === null) throw new Error(`no open request for ${String(n)}`);
    return hub.settle(o.id, workerId);
  };
  /** Workers' in-flight count for Trabolta (`queue().inFlight`). */
  const q = () => hub.queue("Trabolta");
  /** Advance the clock a second at a time, sweeping like the 1 s ticker. */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 1000) {
      clock += 1000;
      hub.sweep();
    }
  };
  return { hub, worker, say, openOf, answer, q, run, typing, held, busy, stalls, heart, builds: () => builds, now: () => clock };
}

const RULING = { character: "Trabolta", filing: { id: "g-9:Q1", person: "g-9", name: "Ada", question: "Q1" }, question: { id: "Q1", text: "Who?" }, key: { answer: "Mister Pickles", aliases: [] }, answer: "Mr Pickels", confidence: 100, near: "Mister Pickles" };

describe("capacity= (C1)", () => {
  it("parses a whole number 1..16; anything else is null (legacy)", () => {
    expect(agentCapacityOf("1")).toBe(1);
    expect(agentCapacityOf("4")).toBe(4);
    expect(agentCapacityOf(String(AGENT_CAPACITY_MAX))).toBe(16);
    expect(agentCapacityOf(" 3 ")).toBe(3);
    for (const bad of [null, undefined, "", "0", "17", "100", "-1", "2.5", "1e1", "abc", "4x", "0x4", "  "]) expect(agentCapacityOf(bad)).toBeNull();
  });

  it("a worker without capacity is legacy: every request goes to it at once, the summary carries no window", () => {
    const h = harness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    for (let n = 0; n < 5; n++) h.say(n);
    expect(a.sent()).toEqual(["g-0", "g-1", "g-2", "g-3", "g-4"]);
    expect(h.typing.filter(([, on]) => on)).toHaveLength(5);
    expect(h.q()).toEqual({ depth: 5, oldestMs: 0, stalled: false });
    expect("inFlight" in h.q()).toBe(false);
  });
});

describe("windowed dispatch (C2)", () => {
  it("never holds more than capacity; each settle hands the next its slot", () => {
    const h = harness();
    const a = h.worker("laptop", 2);
    h.hub.attach(a.w);
    for (let n = 0; n < 6; n++) h.say(n);
    expect(a.sent()).toEqual(["g-0", "g-1"]);
    expect(h.q()).toEqual({ depth: 6, oldestMs: 0, stalled: false, inFlight: 2, capacity: 2 });
    const order: string[] = [];
    for (let i = 0; i < 6; i++) {
      // Answer the oldest in flight; the window never passes 2.
      const open = new Set(h.hub.pending.map((p) => p.id));
      const head = a.requests().find((r) => open.has(r.id))!;
      order.push(who(head));
      expect(h.hub.settle(head.id, "laptop")).not.toBeNull();
      expect(h.q().inFlight).toBeLessThanOrEqual(2);
    }
    expect(order).toEqual(["g-0", "g-1", "g-2", "g-3", "g-4", "g-5"]);
    expect(a.sent()).toEqual(["g-0", "g-1", "g-2", "g-3", "g-4", "g-5"]);
    expect(h.q()).toMatchObject({ depth: 0, inFlight: 0, capacity: 2 });
  });

  it("a queued body is built at dispatch, carrying every line said while it waited (no rebuild per line)", () => {
    const h = harness();
    const a = h.worker("laptop", 1);
    h.hub.attach(a.w);
    h.say(0);
    h.say(1, "first");
    const built = h.builds();
    h.say(1, "second");
    h.say(1, "third");
    expect(h.builds()).toBe(built); // queued: a line only marks it stale
    expect(h.hub.pending.filter((r) => who(r) === "g-1")).toHaveLength(1); // still one request
    h.answer(0, "laptop");
    const [, sent] = a.requests();
    expect(who(sent!)).toBe("g-1");
    expect(sent!.text).toBe("third");
    expect(sent!.history.map((l) => l.text)).toEqual(["first", "second", "third"]);
    expect(h.builds()).toBe(built + 1);
    // Answered with the whole burst in it: no follow-up request after.
    expect(h.answer(1, "laptop")).toMatchObject({ followUp: false });
  });

  it("a line while in a slot is a follow-up, as ever", () => {
    const h = harness();
    const a = h.worker("laptop", 2);
    h.hub.attach(a.w);
    h.say(0, "one");
    h.say(0, "two");
    expect(a.sent()).toEqual(["g-0"]);
    expect(h.answer(0, "laptop")).toMatchObject({ followUp: true });
  });

  it("goes out by rank — the stage, a guest at his heart, the rest — FIFO within a rank", () => {
    const h = harness();
    const a = h.worker("laptop", 1);
    h.hub.attach(a.w);
    h.say(0); // takes the slot
    h.say(1);
    h.heart.add("g-2");
    h.say(2);
    h.say(3);
    h.say(STAGE);
    h.heart.add("g-4");
    h.say(4);
    h.say(5);
    const order: string[] = [];
    while (h.hub.pending.length > 0) {
      const open = new Set(h.hub.pending.map((p) => p.id));
      const inSlot = a.requests().filter((r) => open.has(r.id));
      expect(inSlot).toHaveLength(1);
      order.push(who(inSlot[0]!));
      h.hub.settle(inSlot[0]!.id, "laptop");
    }
    expect(order).toEqual(["g-0", "@Clippy", "g-2", "g-4", "g-1", "g-3", "g-5"]);
  });

  it("a new line never jumps the queue, even when a slot looks free before the pump", () => {
    let letters = 1; // a letter holds the only slot
    const h = harness({ letterLoad: () => letters });
    const a = h.worker("laptop", 1);
    h.hub.attach(a.w);
    h.say(0);
    expect(a.sent()).toEqual([]);
    letters = 0; // the letter came back; nothing pumped yet
    h.say(1);
    expect(a.sent()).toEqual(["g-0"]); // the queue's oldest, not the newcomer
  });

  it("a cancel by hand frees the slot for the next", () => {
    const h = harness();
    const a = h.worker("laptop", 1);
    h.hub.attach(a.w);
    h.say(0);
    h.say(1);
    const first = h.openOf(0)!.id;
    expect(h.hub.answeredByHand(th(0))).toBe(true);
    expect(a.cancels()).toEqual([first]);
    expect(a.sent()).toEqual(["g-0", "g-1"]);
  });

  it("a worker leaving puts its requests back in the queue, in their order, for the slots free elsewhere", () => {
    const h = harness();
    const a = h.worker("a", 2);
    const b = h.worker("b", 4);
    h.hub.attach(a.w);
    for (let n = 0; n < 4; n++) h.say(n);
    expect(a.sent()).toEqual(["g-0", "g-1"]);
    h.hub.attach(b.w); // attach pumps the queue
    expect(b.sent()).toEqual(["g-2", "g-3"]);
    h.hub.detach("a");
    expect(b.sent()).toEqual(["g-2", "g-3", "g-0", "g-1"]);
    // Typing went off as they left, and on as b took them.
    expect(h.typing.filter(([g]) => g === "g-0")).toEqual([
      ["g-0", true],
      ["g-0", false],
      ["g-0", true],
    ]);
    expect(h.q()).toMatchObject({ depth: 4, inFlight: 4, capacity: 4 });
    // The last worker leaving: everything waits, nothing is lost.
    h.hub.detach("b");
    expect(h.q()).toEqual({ depth: 4, oldestMs: 0, stalled: false });
    const c = h.worker("c", 3);
    h.hub.attach(c.w);
    expect(c.sent()).toEqual(["g-0", "g-1", "g-2"]);
  });

  it("two workers of different capacities share one queue, pull-based: the faster takes more", () => {
    const h = harness();
    const slow = h.worker("slow", 1);
    const fast = h.worker("fast", 3);
    h.hub.attach(slow.w);
    h.hub.attach(fast.w);
    for (let n = 0; n < 12; n++) h.say(n);
    expect(slow.sent()).toHaveLength(1);
    expect(fast.sent()).toHaveLength(3);
    expect(h.q()).toMatchObject({ depth: 12, inFlight: 4, capacity: 4 });
    // The fast one answers everything it holds, round after round; the slow
    // one sits on its first.
    for (let round = 0; round < 3; round++) {
      const open = new Set(h.hub.pending.map((p) => p.id));
      for (const r of fast.requests().filter((x) => open.has(x.id))) h.hub.settle(r.id, "fast");
    }
    expect(slow.sent()).toHaveLength(1);
    expect(fast.sent()).toHaveLength(11); // 3 + 3 + 3, then the last 2
    expect(h.q()).toMatchObject({ depth: 3, inFlight: 3 });
    h.say(12); // fast's free slot
    h.say(13); // waits
    expect(fast.sent()).toHaveLength(12);
    // When the slow one answers, it pulls the queue's next too.
    h.hub.settle(h.openOf(Number(slow.sent()[0]!.slice(2)))!.id, "slow");
    expect(slow.sent()).toEqual([slow.sent()[0], "g-13"]);
  });
});

describe("windowed clocks (C3)", () => {
  it("the queue's max age runs from the newest line folded into a queued body, as the legacy rebuild's did", () => {
    const h = harness();
    const a = h.worker("laptop", 1);
    h.hub.attach(a.w);
    h.say(0); // wedges the only slot: the worker stalls and takes nothing new
    h.say(1);
    h.run(9 * 60_000);
    h.say(1, "still waiting");
    h.run(90_000); // 10.5 min since g-1 opened, 1.5 since its last line
    expect(h.openOf(1)).not.toBeNull();
    h.run(9 * 60_000);
    expect(h.openOf(1)).toBeNull();
    expect(a.sent().filter((g) => g === "g-1")).toEqual([]);
  });

  it("each request in a slot times out from its own dispatch: re-sent, then given up, and the slot goes to the queue", () => {
    const h = harness({ stallAfterMs: 60 * 60_000 });
    const a = h.worker("laptop", 2);
    h.hub.attach(a.w);
    h.say(0); // sent at t0
    h.run(50_000);
    h.say(1); // sent at t0 + 50 s
    h.say(2); // queued
    const id0 = h.openOf(0)!.id;
    const id1 = h.openOf(1)!.id;
    h.run(71_000); // t0 + 121 s: g-0 is past 120 s, g-1 is not
    expect(a.cancels()).toEqual([id0]);
    expect(a.sent()).toEqual(["g-0", "g-1", "g-0"]); // re-sent at once into its own slot
    h.run(50_000); // t0 + 171 s: g-1's own 120 s
    expect(a.cancels()).toEqual([id0, id1]);
    expect(a.sent()).toEqual(["g-0", "g-1", "g-0", "g-1"]);
    expect(h.held).toEqual([]);
    h.run(71_000); // g-0's second attempt spent: given up, its slot to g-2
    expect(h.held).toEqual(["g-0"]);
    expect(h.openOf(0)).toBeNull();
    expect(a.sent()).toEqual(["g-0", "g-1", "g-0", "g-1", "g-2"]);
    h.run(50_000);
    expect(h.held).toEqual(["g-0", "g-1"]);
    expect(h.q()).toMatchObject({ depth: 1, inFlight: 1 });
  });

  it("capacity 2: one request stuck while the other slot answers is not a stall", () => {
    const h = harness();
    const a = h.worker("laptop", 2);
    h.hub.attach(a.w);
    h.say(0); // stuck for good
    h.say(1);
    for (let n = 2; n < 6; n++) {
      h.run(25_000);
      h.answer(n - 1, "laptop"); // the other slot answers every 25 s
      h.say(n);
    }
    h.run(15_000); // t0 + 115 s: g-0 has waited 115 s, the worker answered 15 s ago
    expect(h.stalls).toEqual([]);
    expect(h.held).toEqual([]);
    expect(h.q()).toMatchObject({ stalled: false, inFlight: 2 });
  });

  it("nothing back for 60 s is a stall: one hosts line, the hold line in every waiting thread, no new dispatch; an answer clears it and pumps", () => {
    const h = harness();
    const a = h.worker("laptop", 2);
    h.hub.attach(a.w);
    h.say(0);
    h.say(1);
    h.run(30_000);
    h.answer(1, "laptop"); // back at t0 + 30 s
    h.say(2); // takes the freed slot at t0 + 30 s
    h.say(3); // queued
    h.run(59_000); // t0 + 89 s: 59 s since the last answer
    expect(h.stalls).toEqual([]);
    h.run(2000); // t0 + 91 s
    expect(h.stalls).toEqual([{ name: "laptop", waiting: 3 }]);
    expect(h.held.sort()).toEqual(["g-0", "g-2", "g-3"]);
    expect(h.q()).toMatchObject({ stalled: true, depth: 3, inFlight: 2 });
    // A new thread waits in the hub; the stalled worker takes nothing new.
    h.say(4);
    h.answer(2, "laptop"); // its answer clears the stall and the queue goes to it
    expect(h.q().stalled).toBe(false);
    expect(a.sent()).toEqual(["g-0", "g-1", "g-2", "g-3"]);
    h.answer(0, "laptop");
    expect(a.sent()).toEqual(["g-0", "g-1", "g-2", "g-3", "g-4"]);
    expect(h.stalls).toHaveLength(1);
  });
});

describe("what the guest sees (C4)", () => {
  it("typing turns on only when a slot takes the request", () => {
    const h = harness();
    const a = h.worker("laptop", 1);
    h.hub.attach(a.w);
    h.say(0);
    h.say(1);
    h.say(2);
    expect(h.typing).toEqual([["g-0", true]]);
    h.answer(0, "laptop");
    expect(h.typing).toEqual([
      ["g-0", true],
      ["g-0", false],
      ["g-1", true],
    ]);
  });

  it("the busy line reaches a request still queued at 40 s on a worker answering — once per thread — never the one in the slot", () => {
    const h = harness();
    const a = h.worker("laptop", 1);
    h.hub.attach(a.w);
    h.say(0);
    h.say(1);
    h.say(2);
    h.run(30_000);
    h.answer(0, "laptop"); // g-1 into the slot at 30 s: not owed the busy line
    h.run(11_000); // 41 s
    expect(h.busy).toEqual(["g-2"]);
    h.run(10_000);
    expect(h.busy).toEqual(["g-2"]);
    expect(a.sent()).toEqual(["g-0", "g-1"]);
    // The same thread waiting again later hears nothing new.
    h.answer(1, "laptop");
    h.answer(2, "laptop");
    h.say(0);
    h.say(2);
    h.run(45_000);
    expect(h.busy).toEqual(["g-2"]);
  });

  it("no busy line while nobody can answer: the hold line covers it", () => {
    const h = harness();
    h.hub.attach(h.worker("other", 2, ["Someone"]).w); // a windowed worker, not his
    h.say(0);
    h.run(45_000);
    expect(h.busy).toEqual([]);
    expect(h.held).toEqual(["g-0"]);
  });

  it("a public talk request never hears the busy line", () => {
    const h = harness();
    const a = h.worker("laptop", 1);
    h.hub.attach(a.w);
    h.say(0);
    h.say(STAGE);
    h.run(45_000);
    expect(h.busy).toEqual([]);
  });
});

describe("rulings and letters in windowed mode (C5)", () => {
  it("a ruling waits behind queued voice until it has waited judgeAgeMs, then takes the next free slot first", () => {
    const h = harness();
    const a = h.worker("laptop", 1);
    h.hub.attach(a.w);
    h.say(0);
    h.say(1);
    const rid = h.hub.judge(RULING)!;
    expect(rid).not.toBeNull();
    expect(a.judges()).toEqual([]);
    h.run(5000);
    h.answer(0, "laptop"); // 5 s: the ruling is young, voice goes first
    expect(a.sent()).toEqual(["g-0", "g-1"]);
    expect(a.judges()).toEqual([]);
    h.say(2);
    h.run(AGENT_JUDGE_AGE_MS); // aged now, but the slot is full
    expect(a.judges()).toEqual([]);
    h.answer(1, "laptop"); // the aged ruling takes the freed slot ahead of g-2
    expect(a.judges().map((j) => j.id)).toEqual([rid]);
    expect(a.sent()).toEqual(["g-0", "g-1"]);
    expect(h.q()).toMatchObject({ depth: 1, inFlight: 0 });
    // The ruling holds the slot until it is given.
    h.say(3);
    expect(a.sent()).toEqual(["g-0", "g-1"]);
    expect(h.hub.judgeSettle(rid, "laptop")).not.toBeNull();
    expect(a.sent()).toEqual(["g-0", "g-1", "g-2"]);
  });

  it("with no voice waiting, a ruling goes beside an answer in flight (no 'voice first'); still one per worker", () => {
    const h = harness();
    const a = h.worker("laptop", 3);
    h.hub.attach(a.w);
    h.say(0);
    const r1 = h.hub.judge(RULING)!;
    const r2 = h.hub.judge({ ...RULING, filing: { ...RULING.filing, id: "g-8:Q1", person: "g-8" } })!;
    expect(a.judges().map((j) => j.id)).toEqual([r1]);
    h.hub.judgeSettle(r1, "laptop");
    expect(a.judges().map((j) => j.id)).toEqual([r1, r2]);
  });

  it("judgeAgeMs is the option's: a slot freed by hand goes to voice while the ruling is young, the next one to it once aged", () => {
    const h = harness({ judgeAgeMs: 10_000 });
    const a = h.worker("laptop", 2);
    h.hub.attach(a.w);
    h.say(0);
    h.say(1);
    h.say(2); // waits
    const rid = h.hub.judge(RULING)!;
    expect(rid).not.toBeNull();
    expect(a.sent()).toEqual(["g-0", "g-1"]);
    h.hub.answeredByHand(th(0));
    expect(a.sent()).toEqual(["g-0", "g-1", "g-2"]);
    expect(a.judges()).toEqual([]);
    h.run(11_000);
    expect(a.judges()).toEqual([]); // aged, but no slot
    h.answer(1, "laptop");
    expect(a.judges().map((j) => j.id)).toEqual([rid]);
  });

  it("a legacy worker keeps voice first", () => {
    const h = harness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.say(0);
    h.hub.judge(RULING);
    h.run(AGENT_JUDGE_AGE_MS + 5000);
    expect(a.judges()).toEqual([]);
    h.answer(0, "laptop");
    expect(a.judges()).toHaveLength(1);
  });

  it("a letter goes to a windowed worker with a slot free and no voice waiting; a letter out takes a slot", () => {
    const out = new Map<string, number>();
    const h = harness({ letterLoad: (w) => out.get(w) ?? 0 });
    const a = h.worker("laptop", 2);
    h.hub.attach(a.w);
    expect(h.hub.letterWorkers("Trabolta").map((w) => w.id)).toEqual(["laptop"]);
    h.say(0); // one answering, a slot free, nothing waiting
    expect(h.hub.letterWorkers("Trabolta").map((w) => w.id)).toEqual(["laptop"]);
    out.set("laptop", 1); // the letter goes out: the window is full
    h.say(1);
    expect(a.sent()).toEqual(["g-0"]);
    expect(h.hub.letterWorkers("Trabolta")).toEqual([]); // full, and voice waits
    out.set("laptop", 0); // the draft came back (the runtime pumps)
    h.hub.pump();
    expect(a.sent()).toEqual(["g-0", "g-1"]);
    expect(h.hub.letterWorkers("Trabolta")).toEqual([]); // full again
    h.answer(0, "laptop");
    h.say(2);
    h.say(3); // one waits
    expect(h.hub.letterWorkers("Trabolta")).toEqual([]);
    expect(h.hub.letterWorkers("Trabolta", true).map((w) => w.id)).toEqual(["laptop"]);
  });

  it("a legacy worker takes a letter only with nothing open", () => {
    const h = harness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.say(0);
    expect(h.hub.letterWorkers("Trabolta")).toEqual([]);
    h.answer(0, "laptop");
    expect(h.hub.letterWorkers("Trabolta").map((w) => w.id)).toEqual(["laptop"]);
  });

  it("a ruling in flight counts against the window", () => {
    const h = harness();
    const a = h.worker("laptop", 1);
    h.hub.attach(a.w);
    const rid = h.hub.judge(RULING)!;
    expect(a.judges()).toHaveLength(1);
    h.say(0);
    expect(a.sent()).toEqual([]);
    expect(h.typing).toEqual([]);
    h.hub.judgeSettle(rid, "laptop");
    expect(a.sent()).toEqual(["g-0"]);
  });
});

// ---------------------------------------------------------------------------
// EventRuntime: the stream's capacity=, the queue readout
// ---------------------------------------------------------------------------

const SOURCE = `# Window

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
const CODES = { event: "EVT444", prime: "PRM444", mod: "MOD444" };
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

async function room(guests: number, query: string) {
  let clock = 1_000_000;
  const d = mkdtempSync(join(tmpdir(), "loom-agents-w-"));
  dirs.push(d);
  const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "window", scenarioSource: SOURCE, joinBase: () => "http://localhost", now: () => clock });
  rt.openDoors();
  const people: Array<{ id: string; token: string }> = [];
  for (let i = 0; i < guests; i++) {
    const g = await call(rt, "POST", "/api/guest/register", { name: `Guest ${i}`, passcode: CODES.event });
    people.push({ id: g.json["id"] as string, token: g.json["token"] as string });
  }
  const w = await call(rt, "GET", `/api/agent/stream?characters=Trabolta&name=laptop${query}`, {}, { moderator: true });
  const hello = w.res.frames().find(([e]) => e === "hello")![1] as Record<string, unknown>;
  const requests = () => w.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
  const say = (i: number, text: string) => call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text }, { token: people[i]!.token });
  const queueRow = async () => ((await call(rt, "GET", "/api/state?role=mod", {}, { moderator: true })).json as unknown as ModView).cast.find((c) => c.id === "Trabolta")!.agentQueue;
  const tick = (ms: number) => {
    for (let t = 0; t < ms; t += 1000) {
      clock += 1000;
      rt.tickOnce(1000);
    }
  };
  const all = () => (rt as unknown as { chat: { all(): ChatMessage[] } }).chat.all();
  const dmOf = (id: string) => all().filter((m) => m.channel === "dm:Trabolta" && Array.isArray(m.audience) && m.audience.includes(id)).map((m) => m.text);
  return { rt, people, w, hello, requests, say, queueRow, tick, dmOf };
}

describe("EventRuntime — the stream's capacity= and the window", () => {
  it("capacity=2: two answering, the rest wait; a waiting guest's later lines ride in its body; the cast row reads the window", async () => {
    const r = await room(3, "&capacity=2");
    expect(r.hello["capacity"]).toBe(2);
    await r.say(0, "hello?");
    await r.say(1, "me too");
    await r.say(2, "and me");
    expect(r.requests().map((q) => q.speaker.id)).toEqual([r.people[0]!.id, r.people[1]!.id]);
    await r.say(2, "still here");
    expect(await r.queueRow()).toMatchObject({ depth: 3, inFlight: 2, capacity: 2, stalled: false });
    const first = r.requests()[0]!;
    expect((await call(r.rt, "POST", "/api/agent/reply", { id: first.id, say: "Welcome, program." }, { moderator: true })).status).toBe(200);
    const third = r.requests()[2]!;
    expect(third.speaker.id).toBe(r.people[2]!.id);
    expect(third.text).toBe("still here");
    expect(third.history.map((l) => l.text)).toEqual(["and me", "still here"]);
    expect(await r.queueRow()).toMatchObject({ depth: 2, inFlight: 2, capacity: 2 });
    r.w.close();
    expect(await r.queueRow()).toEqual({ depth: 2, oldestMs: 0, stalled: false });
    r.rt.dispose();
  });

  it("capacity=1: the guest still waiting at 40 s hears the busy line; the one being answered does not", async () => {
    const r = await room(2, "&capacity=1");
    await r.say(0, "hello?");
    await r.say(1, "me too?");
    r.tick(41_000);
    expect(r.dmOf(r.people[0]!.id)).toEqual(["hello?"]);
    expect(r.dmOf(r.people[1]!.id)).toEqual(["me too?", "Trabolta is processing a high volume of requests. Please hold."]);
    r.w.close();
    r.rt.dispose();
  });

  it("no capacity (or a bad one) is the legacy stream: hello says null and every request goes at once", async () => {
    for (const query of ["", "&capacity=0", "&capacity=lots", "&capacity=17"]) {
      const r = await room(3, query);
      expect(r.hello["capacity"]).toBeNull();
      await r.say(0, "a");
      await r.say(1, "b");
      await r.say(2, "c");
      expect(r.requests()).toHaveLength(3);
      const row = await r.queueRow();
      expect(row).toEqual({ depth: 3, oldestMs: 0, stalled: false });
      r.w.close();
      r.rt.dispose();
    }
  });
});
