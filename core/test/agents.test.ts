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

import { AGENT_QUEUE_MAX_AGE_MS, AgentHub, AgentTraceLog, agentControl, agentMindReport, agentThought, type AgentControl, type AgentFacts, type AgentRequest, type AgentThought, type AgentThread, type AgentWorker } from "../server/agents.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { guestView, primeView, type AgentMindSummary } from "../server/views.ts";
import { Sim } from "../src/runtime/sim/index.ts";

// ---------------------------------------------------------------------------
// AgentHub (no sim, no sockets)
// ---------------------------------------------------------------------------

const T: AgentThread = { character: "Trabolta", channel: "dm:Trabolta", audience: ["g-1"] };

function hubHarness(opts: { replyTimeoutMs?: number; queueMaxAgeMs?: number; maxAttempts?: number; holdAfterMs?: number; presence?: () => void } = {}) {
  let clock = 1000;
  let builds = 0;
  const typing: boolean[] = [];
  const held: AgentRequest[] = [];
  const hub = new AgentHub({
    hold: (req) => {
      held.push(req);
      return true;
    },
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
    /** The requests this worker holds right now: sent to it, not cancelled, still open. */
    const holds = (): AgentRequest[] => {
      const mine = new Map<string, AgentRequest>();
      for (const [e, d] of got) {
        if (e === "request") mine.set((d as AgentRequest).id, d as AgentRequest);
        else if (e === "cancel") mine.delete((d as { id: string }).id);
      }
      return [...mine.values()].filter((r) => hub.pending.some((p) => p.id === r.id));
    };
    return { w, got, holds, requests: () => got.filter(([e]) => e === "request").map(([, d]) => d as AgentRequest) };
  };
  return { hub, worker, typing, held, tick: (ms: number) => (clock += ms), builds: () => builds };
}

describe("AgentHub", () => {
  it("answeredByHand drops a queued request and cancels an in-flight one", () => {
    const h = hubHarness();
    h.hub.line(T);
    expect(h.hub.answeredByHand(T)).toBe(true);
    expect(h.hub.pending).toHaveLength(0);
    expect(h.hub.answeredByHand(T)).toBe(false);
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    expect(a.requests()).toHaveLength(0);
    h.hub.line(T);
    const id = a.requests()[0]!.id;
    expect(h.hub.answeredByHand({ ...T, audience: ["g-2"] })).toBe(false); // another thread
    expect(h.hub.answeredByHand(T)).toBe(true);
    expect(a.got.filter(([e]) => e === "cancel")).toEqual([["cancel", { id }]]);
    expect(h.typing).toEqual([true, false]);
    expect(h.hub.settle(id, "laptop")).toBeNull();
  });

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

  it("a burst on a busy, healthy worker times nothing out: only its head is on the clock (T9-timers-02)", () => {
    const h = hubHarness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    const threads = Array.from({ length: 60 }, (_, i): AgentThread => ({ character: "Trabolta", channel: "dm:Trabolta", audience: [`g-${i}`] }));
    let settled = 0;
    let busyUntil = 0; // the worker answers its oldest request every 6 s
    for (let t = 0; t < 11 * 60; t++) {
      if (t < 60) h.hub.line(threads[t]!);
      if (t >= busyUntil) {
        const head = a.requests().find((r) => h.hub.pending.some((p) => p.id === r.id));
        if (head !== undefined) {
          if (h.hub.settle(head.id, "laptop") !== null) settled += 1;
          busyUntil = t + 6;
        }
      }
      h.tick(1000);
      h.hub.sweep();
    }
    expect(settled).toBe(60);
    expect(a.got.filter(([e]) => e === "cancel")).toHaveLength(0);
    expect(h.held).toHaveLength(0);
  });

  it("a hung worker: only its head is cancelled, the next gets a fresh window, and a request given up says the hold line once", () => {
    const h = hubHarness({ replyTimeoutMs: 10_000 });
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    const t1: AgentThread = { ...T, audience: ["g-1"] };
    const t2: AgentThread = { ...T, audience: ["g-2"] };
    h.hub.line(t1);
    h.tick(1000);
    h.hub.line(t2);
    const cancels = () => a.got.filter(([e]) => e === "cancel").map(([, d]) => (d as { id: string }).id);
    const [r1, r2] = a.requests();
    h.tick(10_001);
    h.hub.sweep();
    expect(cancels()).toEqual([r1!.id]); // the head only, though both are > 10 s old
    h.tick(2000);
    h.hub.sweep();
    expect(cancels()).toEqual([r1!.id]); // r2's clock started at the cancel
    h.tick(9000);
    h.hub.sweep();
    expect(cancels()).toEqual([r1!.id, r2!.id]);
    // Both are re-dispatched once, time out again, and are given up — each
    // thread hears the hold line exactly once.
    for (let i = 0; i < 4; i++) {
      h.tick(10_001);
      h.hub.sweep();
    }
    expect(h.hub.pending).toHaveLength(0);
    expect(h.held.map((r) => r.thread.audience[0]).sort()).toEqual(["g-1", "g-2"]);
  });

  it("a director's hand answer to the head starts the next request's clock at the cancel, not at the worker's last answer", () => {
    const h = hubHarness({ replyTimeoutMs: 120_000 });
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    const th = (n: number): AgentThread => ({ ...T, audience: [`g-${n}`] });
    h.hub.line(th(0));
    h.hub.line(th(1));
    h.hub.line(th(2));
    const [r0, r1, r2] = a.requests();
    h.tick(5_000);
    h.hub.settle(r0!.id, "laptop"); // r1 starts at 5 s …
    h.tick(105_000);
    h.hub.sweep();
    expect(h.hub.answeredByHand(th(1))).toBe(true); // … and is answered by hand at 110 s
    const cancels = () => a.got.filter(([e]) => e === "cancel").map(([, d]) => (d as { id: string }).id);
    expect(cancels()).toEqual([r1!.id]);
    for (let i = 0; i < 30; i++) {
      h.tick(1000);
      h.hub.sweep();
    }
    expect(cancels()).toEqual([r1!.id]); // r2 has had 30 s of its own 120
    h.tick(91_000);
    h.hub.sweep();
    expect(cancels()).toEqual([r1!.id, r2!.id]);
  });

  it("a head stuck in one slot times out while the worker's other slot keeps answering", () => {
    const h = hubHarness({ replyTimeoutMs: 10_000 });
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line({ ...T, audience: ["g-stuck"] });
    const [stuck] = a.requests();
    const cancels = () => a.got.filter(([e]) => e === "cancel").map(([, d]) => (d as { id: string }).id);
    for (let i = 0; i < 12; i++) {
      // The second slot answers a fresh DM every second.
      h.hub.line({ ...T, audience: [`g-${i}`] });
      const fresh = a.requests().at(-1)!;
      h.tick(1000);
      h.hub.settle(fresh.id, "laptop");
      h.hub.sweep();
    }
    expect(cancels()).toEqual([stuck!.id]);
  });

  it("a worker that stays connected but stops answering: every guest waiting on it gets one hold line by ~141 s, a late answer still settles, and nothing waits past the queue's max age (T9 recheck)", () => {
    const h = hubHarness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    const threads = Array.from({ length: 30 }, (_, i): AgentThread => ({ ...T, audience: [`g-${i}`] }));
    const heldBy = (t: number) => {
      for (let s = 0; s < t; s++) {
        if (s < 20) for (let g = 0; g < 30; g++) if (Math.floor((g * 20) / 30) === s) h.hub.line(threads[g]!);
        h.tick(1000);
        h.hub.sweep();
      }
    };
    heldBy(119);
    expect(h.held).toHaveLength(0); // a slow worker is no reason for the hold line
    heldBy(21); // t = 140 s: the stall was found at 121 s (the head's timeout)
    expect(h.held).toHaveLength(0); // the hold counts from the stall, not the DM
    heldBy(1); // t = 141 s
    expect(new Set(h.held.map((r) => r.thread.audience[0])).size).toBe(30);
    expect(h.held).toHaveLength(30);
    expect(h.hub.pending).toHaveLength(30); // held, still waiting on the worker
    // The worker wakes up and answers one: it settles, and the worker counts as answering again.
    const [first] = a.requests().filter((r) => h.hub.pending.some((p) => p.id === r.id));
    expect(h.hub.settle(first!.id, "laptop")).not.toBeNull();
    h.hub.line({ ...T, audience: ["g-new"] });
    h.tick(30_000);
    h.hub.sweep();
    expect(h.held).toHaveLength(30); // no hold line for a worker that is answering
    // Nobody waits longer than the queue's max age after the worker stalls
    // again (a head times out at 242 s with the 141 s answer inside its
    // timeout; the next, at 363 s, stalls it), even with a worker; no
    // second hold line.
    for (let s = 0; s < AGENT_QUEUE_MAX_AGE_MS / 1000 + 200; s++) {
      h.tick(1000);
      h.hub.sweep();
    }
    expect(h.hub.pending).toHaveLength(0);
    expect(h.held).toHaveLength(31); // g-new's turn came too (once)
    expect(new Set(h.held.map((r) => r.thread.audience[0])).size).toBe(31);
  });

  it("a stalled worker's line moves to a worker still answering that character, as no extra attempt, and nobody hears the hold line (review 2)", () => {
    const h = hubHarness({ replyTimeoutMs: 10_000 });
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    const th = (n: number): AgentThread => ({ ...T, audience: [`g-${n}`] });
    for (let i = 0; i < 4; i++) h.hub.line(th(i));
    expect(a.requests()).toHaveLength(4);
    const b = h.worker("spare");
    h.hub.attach(b.w);
    expect(b.requests()).toHaveLength(0); // the laptop already holds them
    h.tick(10_001);
    h.hub.sweep(); // the laptop's head times out: it stalls
    const cancels = a.got.filter(([e]) => e === "cancel").map(([, d]) => (d as { id: string }).id);
    expect(cancels.sort()).toEqual(a.requests().map((r) => r.id).sort()); // its whole line
    expect(b.requests().map((r) => r.thread.audience[0]).sort()).toEqual(["g-0", "g-1", "g-2", "g-3"]);
    // New work goes to the worker still answering, not behind the stalled one.
    h.hub.line(th(9));
    expect(b.requests().at(-1)!.thread.audience[0]).toBe("g-9");
    for (const r of b.requests()) expect(h.hub.settle(r.id, "spare")).not.toBeNull();
    h.tick(60_000);
    h.hub.sweep();
    expect(h.hub.pending).toHaveLength(0);
    expect(h.held).toHaveLength(0);
  });

  it("a worker that attaches after another stalled takes the stalled line at once, its timed-out head included (review 3)", () => {
    const h = hubHarness({ replyTimeoutMs: 10_000 });
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    const th = (n: number): AgentThread => ({ ...T, audience: [`g-${n}`] });
    for (let i = 0; i < 4; i++) h.hub.line(th(i));
    h.tick(10_001);
    h.hub.sweep(); // the laptop stalls alone: g-0 goes back to it, attempt 2
    h.tick(5_000);
    h.hub.sweep();
    const b = h.worker("spare");
    h.hub.attach(b.w); // the director starts a backup
    expect(b.requests().map((r) => r.thread.audience[0]).sort()).toEqual(["g-0", "g-1", "g-2", "g-3"]);
    const live = new Set(h.hub.pending.map((r) => r.id));
    const cancelled = new Set(a.got.filter(([e]) => e === "cancel").map(([, d]) => (d as { id: string }).id));
    for (const id of live) expect(cancelled.has(id)).toBe(true); // nothing left on the laptop
    for (const r of b.requests()) expect(h.hub.settle(r.id, "spare")).not.toBeNull();
    h.tick(60_000);
    h.hub.sweep();
    expect(h.hub.pending).toHaveLength(0);
    expect(h.held).toHaveLength(0);
  });

  it("a stalled worker whose line moved away is put back on trial a reply timeout later: it takes work once the other is busy, and stalls again if still wedged (review 3)", () => {
    const h = hubHarness({ replyTimeoutMs: 10_000 });
    const a = h.worker("laptop");
    const b = h.worker("spare");
    h.hub.attach(a.w);
    h.hub.attach(b.w);
    const th = (n: number): AgentThread => ({ ...T, audience: [`g-${n}`] });
    h.hub.line(th(0)); // to the laptop (first of two idle workers)
    expect(a.requests()).toHaveLength(1);
    h.tick(10_001);
    h.hub.sweep(); // one slow reply: the laptop stalls, g-0 goes to the spare
    expect(h.hub.settle(b.requests()[0]!.id, "spare")).not.toBeNull();
    // Still inside a reply timeout of the stall: new work skips the laptop.
    h.hub.line(th(1));
    h.hub.line(th(2));
    expect(a.requests()).toHaveLength(1);
    for (const r of b.requests().slice(1)) expect(h.hub.settle(r.id, "spare")).not.toBeNull();
    h.tick(10_000);
    h.hub.sweep(); // a reply timeout since the stall, nothing in its line: on trial
    h.hub.line(th(3));
    expect(b.requests().at(-1)!.thread.audience[0]).toBe("g-3"); // an idle spare still wins the tie
    h.hub.line(th(4));
    expect(a.requests().at(-1)!.thread.audience[0]).toBe("g-4"); // the spare is busy: the laptop takes it
    expect(h.hub.settle(a.requests().at(-1)!.id, "laptop")).not.toBeNull(); // it answers: back in rotation
    expect(h.hub.settle(b.requests().at(-1)!.id, "spare")).not.toBeNull();
    h.hub.line(th(5));
    h.hub.line(th(6));
    expect([a, b].map((x) => x.requests().at(-1)!.thread.audience[0]).sort()).toEqual(["g-5", "g-6"]);
    // Wedged again: its next head stalls it, and its line moves on.
    const mine = a.requests().at(-1)!;
    expect(h.hub.settle(b.requests().at(-1)!.id, "spare")).not.toBeNull();
    h.tick(10_001);
    h.hub.sweep();
    expect(b.requests().at(-1)!.id).toBe(mine.id);
    expect(h.held).toHaveLength(0);
  });

  it("a request held on a stalled worker is re-sent with the hold line in its body, and keeps its age (review 3)", () => {
    const h = hubHarness({ replyTimeoutMs: 10_000 });
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line({ ...T, audience: ["g-1"] });
    h.hub.line({ ...T, audience: ["g-2"] });
    const sent = new Map(a.requests().map((r) => [r.thread.audience[0], r]));
    h.tick(10_001);
    h.hub.sweep(); // the laptop stalls
    for (let s = 0; s < 20; s++) {
      h.tick(1_000);
      h.hub.sweep();
    }
    expect(h.held.map((r) => r.thread.audience[0]).sort()).toEqual(["g-1", "g-2"]);
    h.hub.detach("laptop");
    const b = h.worker("spare");
    h.hub.attach(b.w);
    expect(b.requests()).toHaveLength(2);
    for (const r of b.requests()) {
      const first = sent.get(r.thread.audience[0])!;
      expect((r as unknown as { text: string }).text).not.toBe((first as unknown as { text: string }).text); // rebuilt after the hold line
      expect(r.at).toBe(first.at);
    }
  });

  it("a stalled worker counts as away until it answers, and presence is pushed at the stall and at the answer (review 3)", () => {
    let pushes = 0;
    const h = hubHarness({ replyTimeoutMs: 10_000, presence: () => (pushes += 1) });
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(T);
    expect(h.hub.onlineCharacters()).toEqual(["Trabolta"]);
    const before = pushes;
    h.tick(10_001);
    h.hub.sweep(); // the head timed out: the laptop stalls
    expect(pushes).toBe(before + 1);
    expect(h.hub.onlineCharacters()).toEqual([]);
    expect(h.hub.isOnline("Trabolta")).toBe(false);
    expect(h.hub.settle(a.requests().at(-1)!.id, "laptop")).not.toBeNull(); // it answers again
    expect(pushes).toBe(before + 2);
    expect(h.hub.isOnline("Trabolta")).toBe(true);
  });

  it("one slow reply that the worker follows with an answer inside the hold window holds nobody (review 2)", () => {
    const h = hubHarness({ replyTimeoutMs: 10_000 });
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line({ ...T, audience: ["g-1"] });
    h.hub.line({ ...T, audience: ["g-2"] });
    h.tick(10_001);
    h.hub.sweep(); // g-1 timed out: the laptop stalls; g-1 is re-dispatched to it
    for (let i = 0; i < 14; i++) {
      h.tick(1000); // past 20 s since the DMs, not since the stall
      h.hub.sweep();
    }
    expect(h.held).toHaveLength(0);
    const live = new Set(a.requests().filter((r) => h.hub.pending.some((p) => p.id === r.id)).map((r) => r.id));
    expect(live.size).toBe(2);
    for (const id of live) expect(h.hub.settle(id, "laptop")).not.toBeNull();
    h.tick(30_000);
    h.hub.sweep();
    expect(h.held).toHaveLength(0);
  });

  it("a request on a stalled worker is given up at the queue's max age with the hold line once, and its worker is told to cancel", () => {
    const h = hubHarness({ replyTimeoutMs: 10_000, queueMaxAgeMs: 60_000, maxAttempts: 100 });
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(T);
    for (let s = 0; s < 71; s++) {
      h.tick(1000);
      h.hub.sweep(); // stalls at 11 s, re-sent to it every reply timeout; the max age counts from the stall
    }
    expect(h.hub.pending).toHaveLength(1);
    h.tick(1000);
    h.hub.sweep();
    expect(h.hub.pending).toHaveLength(0);
    expect(h.held).toHaveLength(1);
    // The hold line rebuilt it (a new id when re-sent): the copy it holds is cancelled.
    expect(a.got.at(-1)).toEqual(["cancel", { id: a.requests().at(-1)!.id }]);
    expect(h.typing.at(-1)).toBe(false);
  });

  it("a healthy worker's long line is never cut at the queue's max age: 45 DMs at 15 s a reply are all answered (review 4)", () => {
    const h = hubHarness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    for (let i = 0; i < 45; i++) h.hub.line({ ...T, audience: [`g-${i}`] });
    let settled = 0;
    for (let t = 1; t <= 45 * 15 + 30; t++) {
      h.tick(1000);
      if (t % 15 === 0) {
        const head = a.holds()[0];
        if (head !== undefined && h.hub.settle(head.id, "laptop") !== null) settled += 1;
      }
      h.hub.sweep();
    }
    expect(settled).toBe(45);
    expect(h.held).toHaveLength(0);
    expect(a.got.filter(([e]) => e === "cancel")).toHaveLength(0);
  });

  it("two workers stall together: the first to answer again takes the other's whole line at once (review 4)", () => {
    const h = hubHarness();
    const a = h.worker("laptop");
    const b = h.worker("spare");
    h.hub.attach(a.w);
    h.hub.attach(b.w);
    for (let i = 0; i < 10; i++) h.hub.line({ ...T, audience: [`g-${i}`] });
    const answered: number[] = [];
    for (let t = 1; t <= 700; t++) {
      h.tick(1000);
      h.hub.sweep(); // both wedged: they stall in the same sweep at 121 s
      if (t < 125) continue;
      // The laptop wakes at 125 s and answers whatever it holds.
      for (let guard = 0; guard < 20; guard++) {
        const head = a.holds()[0];
        if (head === undefined) break;
        if (h.hub.settle(head.id, "laptop") !== null) answered.push(t);
      }
    }
    expect(answered).toHaveLength(10);
    expect(Math.max(...answered)).toBeLessThanOrEqual(126);
    expect(h.held).toHaveLength(0);
    expect(b.holds()).toHaveLength(0);
  });

  it("a body rebuilt with the hold line already carries the follow-up: whoever is sent it answers once, not twice (review 4)", () => {
    // A stalled laptop's request, rebuilt with the hold line, goes to a backup.
    const h = hubHarness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(T); // line 1
    h.hub.line(T); // line 2, while line 1 is with the laptop
    h.tick(120_001);
    h.hub.sweep(); // the laptop stalls; the request goes back to it
    for (let s = 0; s < 21; s++) {
      h.tick(1000);
      h.hub.sweep(); // the hold line, and the body rebuilt from the thread
    }
    expect(h.held).toHaveLength(1);
    const b = h.worker("spare");
    h.hub.attach(b.w);
    expect(b.requests()).toHaveLength(1);
    expect(h.hub.settle(b.requests()[0]!.id, "spare")?.followUp).toBe(false);
    // The laptop answers the copy it held before the rebuild: line 2 is still owed.
    const g = hubHarness();
    const c = g.worker("laptop");
    g.hub.attach(c.w);
    g.hub.line(T);
    g.hub.line(T);
    g.tick(120_001);
    g.hub.sweep();
    for (let s = 0; s < 21; s++) {
      g.tick(1000);
      g.hub.sweep();
    }
    expect(g.held).toHaveLength(1);
    expect(g.hub.settle(c.holds()[0]!.id, "laptop")?.followUp).toBe(true);
    // A request re-queued by a detach, then rebuilt by the queued hold line.
    const k = hubHarness();
    const d = k.worker("laptop");
    k.hub.attach(d.w);
    k.hub.line(T);
    k.hub.line(T);
    k.hub.detach("laptop");
    k.tick(20_000);
    k.hub.sweep();
    expect(k.held).toHaveLength(1);
    const e = k.worker("spare");
    k.hub.attach(e.w);
    expect(k.hub.settle(e.requests()[0]!.id, "spare")?.followUp).toBe(false);
  });

  it("shift: a pause doesn't count toward the timeout, the queue's age or the hold line (T9-timers-03)", () => {
    const h = hubHarness({ replyTimeoutMs: 120_000 });
    // Queued, nobody online: a DM 10 s before an 11-minute pause.
    h.hub.line(T);
    h.tick(10_000);
    const pausedAt = h.tick(0);
    h.tick(11 * 60_000);
    h.hub.shift(pausedAt, h.tick(0));
    h.tick(5_000);
    h.hub.sweep();
    expect(h.hub.pending).toHaveLength(1); // not expired
    expect(h.held).toHaveLength(0); // 15 s of open doors so far
    h.tick(5_000);
    h.hub.sweep();
    expect(h.held).toHaveLength(1);
    // In flight across a 3-minute pause: no cancel on the first tick back.
    const g = hubHarness({ replyTimeoutMs: 120_000 });
    const a = g.worker("laptop");
    g.hub.attach(a.w);
    g.hub.line(T);
    g.tick(30_000);
    const p = g.tick(0);
    g.tick(3 * 60_000);
    g.hub.shift(p, g.tick(0));
    g.tick(1000);
    g.hub.sweep();
    expect(a.got.filter(([e]) => e === "cancel")).toHaveLength(0);
  });

  it("shift: a pause right after a stall doesn't count toward the stalled line's hold line, nor toward a stall (review 3)", () => {
    const h = hubHarness({ replyTimeoutMs: 120_000 });
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line({ ...T, audience: ["g-1"] });
    h.hub.line({ ...T, audience: ["g-2"] });
    h.tick(120_001);
    h.hub.sweep(); // the head times out: the laptop stalls
    h.tick(1_000);
    h.hub.sweep();
    const p = h.tick(0);
    h.tick(10 * 60_000);
    h.hub.shift(p, h.tick(0));
    h.tick(1_000);
    h.hub.sweep();
    expect(h.held).toHaveLength(0); // ~2 s of open doors since the stall
    for (let s = 0; s < 18; s++) {
      h.tick(1_000);
      h.hub.sweep();
    }
    expect(h.held).toHaveLength(2); // 20 s of open doors since the stall
    // A multi-slot worker that answered its other slot just before a pause:
    // its head times out after the resume, but it answered 20 s of open
    // doors ago — not stalled, so a spare takes nothing from it.
    const g = hubHarness({ replyTimeoutMs: 120_000 });
    const b = g.worker("laptop");
    g.hub.attach(b.w);
    g.hub.line({ ...T, audience: ["g-1"] }); // the head
    g.hub.line({ ...T, audience: ["g-2"] }); // the other slot
    g.tick(100_000);
    expect(g.hub.settle(b.requests()[1]!.id, "laptop")).not.toBeNull();
    g.tick(10_000);
    const q = g.tick(0);
    g.tick(10 * 60_000);
    g.hub.shift(q, g.tick(0));
    g.tick(10_001);
    g.hub.sweep(); // g-1 sat at the head 120 s of open doors: re-dispatched
    expect(b.got.filter(([e]) => e === "cancel")).toHaveLength(1);
    const c = g.worker("spare");
    g.hub.attach(c.w);
    expect(c.requests()).toHaveLength(0);
  });

  it("drops queued requests nobody picked up", () => {
    const h = hubHarness({ queueMaxAgeMs: 60_000 });
    h.hub.line(T);
    h.tick(61_000);
    h.hub.sweep();
    expect(h.hub.pending).toHaveLength(0);
  });

  it("with nobody online, the hold line is offered once after 20 s and the request stays queued", () => {
    const h = hubHarness();
    h.hub.line(T);
    h.tick(10_000);
    h.hub.line(T); // a second message neither stacks nor moves the clock
    h.tick(9_000);
    h.hub.sweep();
    expect(h.held).toHaveLength(0);
    h.tick(1_000);
    h.hub.sweep();
    expect(h.held.map((r) => r.thread)).toEqual([T]);
    expect(h.builds()).toBe(3); // the hold line rebuilt the queued body
    h.tick(30_000);
    h.hub.line(T);
    h.hub.sweep();
    expect(h.held).toHaveLength(1);
    // The laptop comes back: it still gets the (refreshed) request.
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    expect(a.requests()).toHaveLength(1);
  });

  it("no hold line while a worker voicing the character is online, even a slow one", () => {
    const h = hubHarness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(T);
    h.tick(60_000);
    h.hub.sweep();
    expect(h.held).toHaveLength(0);
    // It dies mid-reply long after the request opened: the hold follows at once.
    h.hub.detach("laptop");
    h.hub.sweep();
    expect(h.held).toHaveLength(1);
  });

  it("a restart, or a late answer the hub refuses, puts a stalled lone worker back: shown online, and its next slow reply holds nobody (review 4)", () => {
    const h = hubHarness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line({ ...T, audience: ["g-1"] });
    for (let s = 0; s < 125; s++) {
      h.tick(1000);
      h.hub.sweep();
    }
    expect(h.hub.isOnline("Trabolta")).toBe(false); // stalled
    expect(h.hub.answeredByHand({ ...T, audience: ["g-1"] })).toBe(true);
    h.hub.reset();
    expect(h.hub.isOnline("Trabolta")).toBe(true);
    expect(h.hub.onlineCharacters()).toEqual(["Trabolta"]);
    h.hub.line({ ...T, audience: ["g-2"] });
    for (let s = 0; s < 25; s++) {
      h.tick(1000);
      h.hub.sweep();
    }
    expect(h.held).toHaveLength(0);
    expect(h.hub.settle(a.holds()[0]!.id, "laptop")).not.toBeNull();
    // A late answer: refused (the director answered by hand), but the worker is back.
    const g = hubHarness();
    const b = g.worker("laptop");
    g.hub.attach(b.w);
    g.hub.line({ ...T, audience: ["g-1"] });
    const id = b.requests()[0]!.id;
    for (let s = 0; s < 125; s++) {
      g.tick(1000);
      g.hub.sweep();
    }
    expect(g.hub.isOnline("Trabolta")).toBe(false);
    expect(g.hub.answeredByHand({ ...T, audience: ["g-1"] })).toBe(true);
    expect(g.hub.settle(id, "laptop")).toBeNull();
    expect(g.hub.isOnline("Trabolta")).toBe(true);
  });

  it("a lone stalled worker whose line drains with no answer (answered by hand, or given up) is shown online again a reply timeout after the stall (review 5)", () => {
    for (const drain of ["hand", "giveUp"] as const) {
      const h = hubHarness();
      const a = h.worker("laptop");
      h.hub.attach(a.w);
      h.hub.line({ ...T, audience: ["g-1"] });
      for (let s = 0; s < 125; s++) {
        h.tick(1000);
        h.hub.sweep();
      }
      expect(h.hub.isOnline("Trabolta")).toBe(false); // stalled at 121 s
      if (drain === "hand") expect(h.hub.answeredByHand({ ...T, audience: ["g-1"] })).toBe(true);
      for (let s = 0; s < 240; s++) {
        h.tick(1000);
        h.hub.sweep();
      }
      expect(h.hub.pending).toHaveLength(0);
      expect(h.hub.onlineCharacters()).toEqual(["Trabolta"]);
      // Its next DM goes to it and is answered like any other.
      h.hub.line({ ...T, audience: ["g-2"] });
      expect(h.hub.settle(a.holds()[0]!.id, "laptop")).not.toBeNull();
    }
  });

  it("a request rebuilt with the hold line while its stalled worker holds an older copy, re-sent to that same worker: a late answer from the old copy never settles it as complete, and the new copy is answered once (review 5)", () => {
    const h = hubHarness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    const g1: AgentThread = { ...T, audience: ["g-1"] };
    const g2: AgentThread = { ...T, audience: ["g-2"] };
    h.hub.line(g1); // R1: the laptop's head
    h.hub.line(g2); // R2: the laptop holds copy v1
    const v1 = a.requests()[1]!;
    expect(v1.thread.audience[0]).toBe("g-2");
    let s = 0;
    const run = (to: number) => {
      for (; s < to; s++) {
        if (s === 30) h.hub.line(g2); // g-2 says more while v1 is out
        h.tick(1000);
        h.hub.sweep();
      }
    };
    run(150); // R1 timed out at 121 s (the laptop stalls); both held by 141 s, R2 rebuilt
    expect(h.held.map((r) => r.thread.audience[0]).sort()).toEqual(["g-1", "g-2"]);
    run(250); // R2 times out as the head: cancelled on the laptop, re-sent to it (v2)
    const cancels = a.got.filter(([e]) => e === "cancel").map(([, d]) => (d as { id: string }).id);
    expect(cancels).toContain(v1.id);
    const v2 = a.holds().find((r) => r.thread.audience[0] === "g-2")!;
    expect((v2 as unknown as { text: string }).text).not.toBe((v1 as unknown as { text: string }).text);
    // The old copy's answer was already on its way: it answered only the first line.
    const late = h.hub.settle(v1.id, "laptop");
    expect(late === null || late.followUp).toBe(true);
    if (late === null) {
      // The new copy carries every line so far: answered once, no re-ask.
      expect(h.hub.settle(v2.id, "laptop")).toEqual({ req: v2, followUp: false });
    }
  });

  it("a rebuilt request that bounces through another stalled worker back to the one holding its older copy gets a new id: the old copy's late answer never settles it as complete (review 6)", () => {
    const h = hubHarness({ replyTimeoutMs: 100, holdAfterMs: 20 });
    const b = h.worker("B");
    const a = h.worker("A");
    h.hub.attach(b.w); // B first in map order: it wins ties
    h.hub.attach(a.w);
    const g = (id: string): AgentThread => ({ ...T, audience: [id] });
    h.hub.line(g("g-1")); // R1 → B
    h.hub.line(g("g-2")); // R2 → A
    h.tick(101);
    h.hub.sweep(); // both heads time out: both stall, R1 ⇄ R2
    h.hub.answeredByHand(g("g-1")); // A's line empties
    h.hub.line(g("g-3")); // R3 → A (covers g-3's first line)
    const v1 = a.requests().find((r) => r.thread.audience[0] === "g-3")!;
    h.hub.line(g("g-3")); // a second line while v1 is out
    h.tick(24);
    h.hub.sweep(); // hold lines; R3 rebuilt with both lines
    h.tick(77);
    h.hub.sweep(); // R2 given up; R3 times out → B (A, back on trial, is not handed B's line)
    const now = [...a.holds(), ...b.holds()].find((r) => r.thread.audience[0] === "g-3")!;
    expect(now).toBeDefined();
    expect(now.id).not.toBe(v1.id);
    // A's old copy answered only the first line; its reply was on the wire.
    const late = h.hub.settle(v1.id, "A");
    expect(late === null || late.followUp).toBe(true);
    // A answered: it takes B's line, R3 included, and the new copy is answered once.
    if (late === null) expect(h.hub.settle(now.id, "A")).toEqual({ req: now, followUp: false });
  });

  it("a head whose timeout stalls its worker goes to a worker that is answering, even with its attempts spent: never given up while one sits idle (review 7)", () => {
    // The laptop's stream drops mid-reply and comes back at once; the
    // request already went to the backup (attempt 2), whose model is wedged.
    const h = hubHarness();
    const laptop = h.worker("laptop");
    const backup = h.worker("backup");
    h.hub.attach(laptop.w);
    h.hub.attach(backup.w);
    h.hub.line(T);
    expect(laptop.requests()).toHaveLength(1);
    h.hub.detach("laptop");
    expect(backup.requests()).toHaveLength(1);
    const back = h.worker("laptop-2");
    h.hub.attach(back.w);
    for (let s = 0; s < 125; s++) {
      h.tick(1000);
      h.hub.sweep(); // the backup's head times out at 121 s: it stalls
    }
    expect(back.holds()).toHaveLength(1);
    expect(h.held).toHaveLength(0);
    expect(h.hub.settle(back.holds()[0]!.id, "laptop-2")).not.toBeNull();
    // Three workers, two wedged: the request passes the second wedged one
    // on to the third instead of being given up there.
    const g = hubHarness({ replyTimeoutMs: 10_000 });
    const [a, b, c] = ["a", "b", "c"].map((id) => g.worker(id));
    for (const x of [a, b, c]) g.hub.attach(x!.w);
    g.hub.line(T);
    expect(a!.requests()).toHaveLength(1);
    for (let s = 0; s < 25; s++) {
      g.tick(1000);
      g.hub.sweep(); // a stalls at 11 s (→ b), b at 21 s (→ c)
    }
    expect(c!.holds()).toHaveLength(1);
    expect(g.hub.settle(c!.holds()[0]!.id, "c")).not.toBeNull();
    expect(g.held).toHaveLength(0);
  });

  it("a line typed while the request is queued after a worker drop is answered after the dropped stream's late answer to the older copy (review 7)", () => {
    const h = hubHarness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    h.hub.line(T); // L1, sent as X
    const x = a.requests()[0]!;
    h.hub.detach("laptop"); // the stream drops: queued, nobody else attached
    h.hub.line(T); // L2, folded into the queued body
    // The dropped stream's task finishes and posts its answer to X (L1 only).
    expect(h.hub.settle(x.id, "laptop")?.followUp).toBe(true);
    // Re-sent first instead: the new copy carries L2, answered once; the old
    // copy's answer is refused.
    const k = hubHarness();
    const d = k.worker("laptop");
    k.hub.attach(d.w);
    k.hub.line(T);
    const y = d.requests()[0]!;
    k.hub.detach("laptop");
    k.hub.line(T);
    const e = k.worker("laptop-2");
    k.hub.attach(e.w);
    expect(k.hub.settle(y.id, "laptop")).toBeNull();
    expect(k.hub.settle(e.requests()[0]!.id, "laptop-2")?.followUp).toBe(false);
  });

  it("a lone laptop's backlog older than the queue's max age survives one slow reply: the max age on a stalled worker counts from the stall (review 6)", () => {
    const h = hubHarness();
    const a = h.worker("laptop");
    h.hub.attach(a.w);
    for (let i = 1; i <= 8; i++) h.hub.line({ ...T, audience: [`g-${i}`] }); // a burst at t = 0
    const first = a.requests();
    let t = 0;
    const until = (to: number) => {
      for (; t < to; t++) {
        h.tick(1000);
        h.hub.sweep();
      }
    };
    for (let i = 0; i < 6; i++) {
      until(100 * (i + 1));
      expect(h.hub.settle(first[i]!.id, "laptop")).not.toBeNull(); // one every 100 s
    }
    until(722); // g-7 takes 122 s: the laptop stalls, g-7 goes to the back of its line
    expect(h.held).toHaveLength(0);
    expect(h.hub.pending.map((r) => r.thread.audience[0]).sort()).toEqual(["g-7", "g-8"]);
    until(725);
    expect(h.hub.settle(first[7]!.id, "laptop")).not.toBeNull(); // g-8 answered: never dropped
    expect(h.held).toHaveLength(0);
  });

  it("reset cancels everything open and tells workers", () => {
    const h = hubHarness();
    const a = h.worker("a");
    h.hub.attach(a.w);
    h.hub.line(T);
    h.hub.reset("Jo", "reload");
    expect(h.hub.pending).toHaveLength(0);
    expect(a.got.map(([e]) => e)).toEqual(["request", "cancel", "control"]);
    // The restart is the same control frame the panel's reset button sends.
    expect(a.got[2]![1]).toEqual({ action: "reset", character: null, by: "Jo", reason: "reload" });
  });

  it("controls reach only the workers voicing the character", () => {
    const h = hubHarness();
    const a = h.worker("a", ["Trabolta"]);
    const b = h.worker("b", ["Clippy"]);
    h.hub.attach(a.w);
    h.hub.attach(b.w);
    const nudge: AgentControl = { action: "nudge", character: "Trabolta", by: "Jo", text: "be shaken" };
    expect(h.hub.control(nudge)).toBe(1);
    expect(a.got).toEqual([["control", nudge]]);
    expect(b.got).toEqual([]);
    expect(h.hub.control({ action: "pause", character: null, by: "Jo", on: true })).toBe(2);
    expect(h.hub.control({ action: "survey", character: "Nobody", by: "Jo" })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The debugger's data: mind reports, thoughts, the trace log, controls
// ---------------------------------------------------------------------------

describe("mind reports, thoughts, controls", () => {
  it("a mind report is sanitised field by field and bounded", () => {
    expect(agentMindReport({})).toBeNull();
    expect(agentMindReport({ character: " " })).toBeNull();
    const r = agentMindReport({
      character: "Trabolta",
      worker: "laptop",
      brief: "Be brisk.",
      stage: "appetite",
      stages: ["lonely grandeur", "appetite"],
      stageHistory: [{ stage: "appetite", at: 1, why: "fed", by: "reflect", rev: 3 }],
      drives: { hunger: 61.4, bogus: "x" },
      policy: { favours: "earned", credit: ["Ada"], note: 5 },
      questions: [{ q: "what is a body for", answers: ["itchy — Ada"] }, { answers: [] }],
      notes: ["n"],
      learned: [{ claim: "k", from: "Ada", verdict: "bluster" }, { from: "x" }],
      director: ["be shaken"],
      people: [{ id: "g1", name: "Ada", trust: 62.5, promises: ["lights"], turns: 3 }, { name: "no id" }],
      threads: [{ key: "dm:Trabolta|g1", summary: "s", upto: 4, lines: 4 }],
      revisions: [{ rev: 3, at: 1, by: "reflect", touched: ["brief", "stage"], thought: "th-1", brief: "Be brisk.", stage: "appetite", drives: { hunger: 61 }, policy_favours: "earned", notes: 1, people: 1, learned: 1 }],
      rev: 3,
      status: { mind: { paused: false } },
      extra: "dropped",
    })!;
    expect(r.stage).toBe("appetite");
    expect(r.drives).toEqual({ hunger: 61 });
    expect(r.policy).toEqual({ favours: "earned", credit: ["Ada"], wary: [], note: "" });
    expect(r.questions).toEqual([{ q: "what is a body for", answers: ["itchy — Ada"] }]);
    expect(r.learned).toEqual([{ claim: "k", from: "Ada", verdict: "bluster" }]);
    expect(r.people).toEqual([{ id: "g1", name: "Ada", kind: "guest", summary: "", trust: 63, promises: ["lights"], asks: [], claims: [], turns: 3, lastSeen: 0 }]);
    expect(r.revisions[0]).toMatchObject({ rev: 3, thought: "th-1", touched: ["brief", "stage"], policy_favours: "earned" });
    expect(r.status).toEqual({ mind: { paused: false } });
    expect("extra" in r).toBe(false);
  });

  it("a thought is sanitised, kinds are closed, and the trace log rings + pages", () => {
    expect(agentThought({ id: "x", character: "T", kind: "dream" }, "w")).toBeNull();
    expect(agentThought({ id: "", character: "T", kind: "voice" }, "w")).toBeNull();
    const t = agentThought(
      {
        id: "th-1",
        character: "Trabolta",
        at: 1000,
        kind: "reflect",
        trigger: "exchange",
        model: { name: "qwen", api: "ollama", endpoint: "http://l", temperature: 0.4, max_tokens: 1200, reasoning_effort: null, think: false },
        request_id: "ar-1",
        thread: { channel: "dm:Trabolta", audience: ["g1"] },
        speaker: { id: "g1", name: "Ada", kind: "guest" },
        messages: [{ role: "system", content: "sys" }, { role: "user", content: "usr" }],
        thinking: "she fed him",
        output: '{"mood": "hungry"}',
        finish: "stop",
        prompt_tokens: 900,
        completion_tokens: 30,
        ms: 1200.6,
        result: { mood: "hungry" },
        touched: ["mood"],
        diff: { mood: ["", "hungry"] },
        revision: 4,
        error: null,
        note: "",
      },
      "laptop",
    )!;
    expect(t).toMatchObject({ id: "th-1", worker: "laptop", kind: "reflect", model: { name: "qwen", think: false }, speaker: { name: "Ada" }, thinking: "she fed him", ms: 1201, revision: 4, diff: { mood: ["", "hungry"] } });
    const log = new AgentTraceLog(3);
    expect(log.add(t)!.seq).toBe(1);
    expect(log.add(t)).toBeNull(); // a replay is idempotent
    for (let i = 2; i <= 5; i++) log.add({ ...t, id: `th-${i}`, character: i === 5 ? "Clippy" : "Trabolta" });
    expect(log.list("Trabolta").map((x) => x.id)).toEqual(["th-2", "th-3", "th-4"]); // ring of 3 per character
    expect(log.list(null).map((x) => x.id)).toEqual(["th-2", "th-3", "th-4", "th-5"]);
    expect(log.list(null, 3).map((x) => x.id)).toEqual(["th-4", "th-5"]);
    expect(log.list(null, 0, 1).map((x) => x.id)).toEqual(["th-5"]);
    expect(log.characters()).toEqual(["Clippy", "Trabolta"]);
    expect(log.get("th-1")).toBeNull();
    expect(log.get("th-3")!.seq).toBe(3);
    expect(log.latestSeq).toBe(5);
    // A byte cap drops the oldest thought across characters.
    const small = new AgentTraceLog(100, 2000);
    for (let i = 0; i < 6; i++) small.add({ ...t, id: `big-${i}`, messages: [{ role: "user", content: "x".repeat(400) }] });
    expect(small.list(null).length).toBeLessThan(6);
    expect(small.list(null)[0]!.id).not.toBe("big-0");
  });

  it("controls are validated: known actions, required fields, bounded values", () => {
    expect(agentControl(null, "Jo")).toMatch(/object/);
    expect(agentControl({ action: "dance" }, "Jo")).toMatch(/unknown action/);
    expect(agentControl({ action: "nudge", character: "Trabolta" }, "Jo")).toBe("nudge needs text");
    expect(agentControl({ action: "nudge", character: "Trabolta", text: " be shaken " }, "Jo")).toEqual({ action: "nudge", character: "Trabolta", by: "Jo", text: "be shaken" });
    expect(agentControl({ action: "reset" }, "")).toEqual({ action: "reset", character: null, by: "server", reason: "reset" });
    expect(agentControl({ action: "set", field: "colour", value: "x" }, "Jo")).toMatch(/unknown field/);
    expect(agentControl({ action: "set", field: "drive", value: 9 }, "Jo")).toBe("set drive needs a name");
    expect(agentControl({ action: "set", field: "trust", value: 9 }, "Jo")).toBe("set trust needs a person");
    expect(agentControl({ action: "set", field: "note" }, "Jo")).toBe("set note needs add or drop");
    expect(agentControl({ action: "set", field: "brief" }, "Jo")).toBe("set brief needs a value");
    expect(agentControl({ action: "set", character: "Trabolta", field: "drive", name: "hunger", value: 90, junk: 1 }, "Jo")).toEqual({ action: "set", character: "Trabolta", by: "Jo", field: "drive", value: 90, name: "hunger" });
    expect(agentControl({ action: "set", field: "policy", value: { favours: "loose", credit: ["Ada"], bogus: 1 } }, "Jo")).toMatchObject({ value: { favours: "loose", credit: ["Ada"] } });
    expect(agentControl({ action: "set", field: "stage", value: "the turn", why: "we skipped" }, "Jo")).toMatchObject({ value: "the turn", why: "we skipped" });
    expect(agentControl({ action: "forget" }, "Jo")).toBe("forget needs a person");
    expect(agentControl({ action: "thinking", on: "yes" }, "Jo")).toMatchObject({ on: false });
    expect(agentControl({ action: "effort", level: "MAX" }, "Jo")).toMatch(/effort must be/);
    expect(agentControl({ action: "effort", level: "High" }, "Jo")).toMatchObject({ level: "high" });
    expect(agentControl({ action: "rerun" }, "Jo")).toBe("rerun needs a thought id");
    expect(agentControl({ action: "pause", on: true, character: "  " }, "Jo")).toEqual({ action: "pause", character: null, by: "Jo", on: true });
  });
});

// ---------------------------------------------------------------------------
// EventRuntime wiring
// ---------------------------------------------------------------------------

const SOURCE = `# Uploaded
directory: everyone

LOCATION The Cache
  label: The Cache (kitchen)

ROLE Program
  humanity: 0 to 100 = 20
  doubt: 0 to 100 = 0

CHARACTER Trabolta
  listed: true
  mind: external
  truth: 0 to 100 = 35
  stance: -100 to 100 = 0
  lights_cut: 0 to 10 = 0

  when cut the lights for program:
    set self.lights_cut += 1
    <cue: lights, room: {room}, state: off>

  when snoop for program:
    set target.doubt += 3

CHARACTER Clippy
  listed: true

CODEX The Sandy File
  about: Trabolta
  known to: Trabolta
  text: He wants to impress Sandy.

CODEX The Missing Constant
  about: World
  text: Pencilled into volume K.

INTERACTION cut the lights
  who: agent
  limit: 1
  description: args: room

INTERACTION snoop
  who: agent

INTERACTION accuse
  who: performer
`;
const CODES = { event: "EVT222", prime: "PRM222", mod: "MOD222" };

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function runtime(o: { source?: string; now?: () => number } = {}): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-agents-"));
  dirs.push(d);
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "uploaded",
    scenarioSource: o.source ?? SOURCE,
    joinBase: () => "http://localhost",
    ...(o.now !== undefined ? { now: o.now } : {}),
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
    rt.restart(undefined, undefined, { by: "Jo" });
    const frames = worker.res.frames();
    expect(frames.map(([e]) => e)).toEqual(expect.arrayContaining(["cancel", "control"]));
    expect(frames.find(([e]) => e === "control")![1]).toEqual({ action: "reset", character: null, by: "Jo", reason: "reset" });
    expect((await call(rt, "POST", "/api/agent/reply", { id, say: "late" }, { moderator: true })).status).toBe(410);
  });

  it("the trace route keeps every worker thought, fans it to directors, and pages for the Mind page", async () => {
    const { rt, worker } = await setup();
    const mod = await call(rt, "GET", "/events?role=mod&id=dir", {}, { moderator: true });
    expect((await call(rt, "POST", "/api/agent/trace", { thoughts: [] })).status).toBe(403);
    const thought = { id: "th-1", character: "Trabolta", at: 1, kind: "voice", trigger: "line", messages: [{ role: "user", content: "hi" }], output: '{"say": "HELLO."}', thinking: "a program", result: { say: "HELLO." } };
    const posted = await call(rt, "POST", "/api/agent/trace", { worker: "laptop", thoughts: [thought, { id: "th-2", character: "Trabolta", kind: "reflect", diff: { mood: ["", "wary"] }, revision: 1 }, { id: "bad" }] }, { moderator: true });
    expect(posted.json).toEqual({ ok: true, accepted: 2, seq: 2 });
    expect(mod.res.frames().filter(([e]) => e === "agentThought").map(([, d]) => (d as AgentThought).id)).toEqual(["th-1", "th-2"]);
    // Replaying the same ids (a worker reconnect) adds nothing.
    expect((await call(rt, "POST", "/api/agent/trace", { thoughts: [thought] }, { moderator: true })).json).toMatchObject({ accepted: 0, seq: 2 });
    expect((await call(rt, "GET", "/api/mod/agent/trace", {})).status).toBe(403);
    const page = (await call(rt, "GET", "/api/mod/agent/trace?character=Trabolta", {}, { moderator: true })).json as { thoughts: AgentThought[]; seq: number; characters: string[] };
    expect(page.thoughts.map((t) => [t.seq, t.id, t.worker])).toEqual([[1, "th-1", "laptop"], [2, "th-2", "laptop"]]);
    expect(page.thoughts[0]!.thinking).toBe("a program");
    expect(page.characters).toEqual(["Trabolta"]);
    const after = (await call(rt, "GET", "/api/mod/agent/trace?after=1", {}, { moderator: true })).json as { thoughts: AgentThought[] };
    expect(after.thoughts.map((t) => t.id)).toEqual(["th-2"]);
    expect(((await call(rt, "GET", "/api/mod/agent/trace?id=th-2", {}, { moderator: true })).json as { thought: AgentThought }).thought.diff).toEqual({ mood: ["", "wary"] });
    expect((await call(rt, "GET", "/api/mod/agent/trace?id=nope", {}, { moderator: true })).status).toBe(404);
    // The trace outlives a story restart (the worker marks the boundary itself).
    rt.restart();
    expect(((await call(rt, "GET", "/api/mod/agent/trace", {}, { moderator: true })).json as { thoughts: AgentThought[] }).thoughts).toHaveLength(2);
    expect(worker.res.frames().some(([e]) => e === "control")).toBe(true);
  });

  it("the control route validates, checks the character, and forwards to the worker as the director", async () => {
    const { rt, worker } = await setup();
    expect((await call(rt, "POST", "/api/mod/agent/control", { action: "nudge", character: "Trabolta", text: "x" })).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/agent/control", { action: "dance" }, { moderator: true })).status).toBe(400);
    expect((await call(rt, "POST", "/api/mod/agent/control", { action: "nudge", character: "Trabolta" }, { moderator: true })).json).toEqual({ error: "nudge needs text" });
    expect((await call(rt, "POST", "/api/mod/agent/control", { action: "survey", character: "Nobody" }, { moderator: true })).status).toBe(404);
    // Clippy is a real character but nobody voices it: 409, not a silent drop.
    expect((await call(rt, "POST", "/api/mod/agent/control", { action: "survey", character: "Clippy" }, { moderator: true })).status).toBe(409);
    const ok = await call(rt, "POST", "/api/mod/agent/control", { action: "set", character: "Trabolta", field: "drive", name: "hunger", value: 90 }, { moderator: true });
    expect(ok.json).toEqual({ ok: true, delivered: 1 });
    const control = worker.res.frames().filter(([e]) => e === "control").map(([, d]) => d as AgentControl);
    expect(control).toEqual([{ action: "set", character: "Trabolta", by: "Director", field: "drive", name: "hunger", value: 90 }]);
  });

  it("a guest message while no worker is online is answered once one connects", async () => {
    const rt = runtime();
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Bo", passcode: CODES.event });
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "anyone?" }, { token: g.json["token"] as string });
    const w = await call(rt, "GET", "/api/agent/stream?characters=Trabolta", {}, { moderator: true });
    expect(w.res.frames().filter(([e]) => e === "request")).toHaveLength(1);
  });

  it("with no worker online, the authored hold line lands in the guest's thread after 20 s", async () => {
    let clock = 1_000_000;
    const source = SOURCE.replace("  mind: external\n", '  mind: external\n  hold: "Jean Trabolta will make an appearance later tonight."\n');
    const rt = runtime({ source, now: () => clock });
    rt.openDoors();
    expect(rt.liveSim!.model.characters.get("Trabolta")?.hold).toBe("Jean Trabolta will make an appearance later tonight.");
    const g = await call(rt, "POST", "/api/guest/register", { name: "Cy", passcode: CODES.event });
    const token = g.json["token"] as string;
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hello?" }, { token });
    const hub = (rt as unknown as { agents: AgentHub }).agents;
    const dm = async () => {
      const history = await call(rt, "GET", "/api/history", {}, { token });
      return (history.json["messages"] as Array<{ from: string; text: string; channel: string }>).filter((m) => m.channel === "dm:Trabolta").map((m) => [m.from, m.text]);
    };
    clock += 19_000;
    hub.sweep();
    expect(await dm()).toEqual([["Cy", "hello?"]]);
    clock += 1_000;
    hub.sweep();
    hub.sweep();
    expect(await dm()).toEqual([
      ["Cy", "hello?"],
      ["Trabolta", "Jean Trabolta will make an appearance later tonight."],
    ]);
    // Still queued: a worker that connects now answers the guest.
    const w = await call(rt, "GET", "/api/agent/stream?characters=Trabolta", {}, { moderator: true });
    expect(w.res.frames().filter(([e]) => e === "request")).toHaveLength(1);
    // …and the queued body was rebuilt after the hold, so it knows it said it.
    const req = w.res.frames().find(([e]) => e === "request")![1] as AgentRequest;
    expect(req.history.map((h) => h.text)).toEqual(["hello?", "Jean Trabolta will make an appearance later tonight."]);
  });

  it("a director answering as the agent closes the queued request: the returning worker doesn't answer twice", async () => {
    let clock = 1_000_000;
    const source = SOURCE.replace("  mind: external\n", '  mind: external\n  hold: "Back soon."\n');
    const rt = runtime({ source, now: () => clock });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Ed", passcode: CODES.event });
    const id = g.json["id"] as string;
    const token = g.json["token"] as string;
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Who is Sandy?" }, { token });
    clock += 20_000;
    (rt as unknown as { agents: AgentHub }).agents.sweep();
    // The director answers from Run, as Trabolta.
    expect((await call(rt, "POST", "/api/mod/say", { as: "Trabolta", channel: `guest:${id}`, text: "Sandy is nobody. Forget her." }, { moderator: true })).status).toBe(200);
    expect((rt as unknown as { agents: AgentHub }).agents.pending).toHaveLength(0);
    const w = await call(rt, "GET", "/api/agent/stream?characters=Trabolta", {}, { moderator: true });
    expect(w.res.frames().filter(([e]) => e === "request")).toHaveLength(0);
    // The guest's next line opens a fresh request that knows the director's answer.
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Liar." }, { token });
    const reqs = w.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.history.map((h) => h.text)).toEqual(["Who is Sandy?", "Back soon.", "Sandy is nobody. Forget her.", "Liar."]);
  });

  it("a director's answer cancels the request on a slow worker, and its late reply is refused", async () => {
    const { rt, guest, worker, requests } = await setup();
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hello?" }, { token: guest.token });
    const rid = requests()[0]!.id;
    expect((await call(rt, "POST", "/api/mod/say", { as: "Trabolta", channel: `guest:${guest.id}`, text: "Hello, program." }, { moderator: true })).status).toBe(200);
    expect(worker.res.frames().filter(([e]) => e === "cancel").map(([, d]) => (d as { id: string }).id)).toEqual([rid]);
    expect((await call(rt, "POST", "/api/agent/reply", { id: rid, say: "HELLO." }, { moderator: true })).status).toBe(410);
    // A director's line as a performed character (or as the Operator) touches nothing.
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "again?" }, { token: guest.token });
    await call(rt, "POST", "/api/mod/say", { as: "Clippy", channel: `guest:${guest.id}`, text: "Hi!" }, { moderator: true });
    expect((rt as unknown as { agents: AgentHub }).agents.pending).toHaveLength(1);
  });

  it("a crafted DM to an agent still hidden from the guest is refused, not stored; after the reveal it goes through", async () => {
    const source = SOURCE.replace("  mind: external\n", "  mind: external\n  hidden: true\n");
    const rt = runtime({ source });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Fay", passcode: CODES.event });
    const token = g.json["token"] as string;
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "psst" }, { token })).status).toBe(403);
    const dm = async () =>
      ((await call(rt, "GET", "/api/history", {}, { token })).json["messages"] as Array<{ channel: string }>).filter((m) => m.channel === "dm:Trabolta");
    expect(await dm()).toEqual([]);
    rt.liveSim!.reveal("Trabolta");
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "psst" }, { token })).status).toBe(200);
    expect(await dm()).toHaveLength(1);
  });

  it("a guest's dm: thread is canonical: `dm:trabolta` is refused while hidden, stored as `dm:Trabolta` after; `dm:nobody` is 404 (W6 B19)", async () => {
    const source = SOURCE.replace("  mind: external\n", "  mind: external\n  hidden: true\n");
    const rt = runtime({ source });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Gil", passcode: CODES.event });
    const token = g.json["token"] as string;
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:trabolta", text: "psst" }, { token })).status).toBe(403);
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:nobody", text: "psst" }, { token })).status).toBe(404);
    rt.liveSim!.reveal("Trabolta");
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:trabolta", text: "lower case" }, { token })).status).toBe(200);
    const channels = ((await call(rt, "GET", "/api/history", {}, { token })).json["messages"] as Array<{ channel: string; text: string }>)
      .filter((m) => m.text === "lower case")
      .map((m) => m.channel);
    expect(channels).toEqual(["dm:Trabolta"]);
    // …and it reached the agent like any line in the real thread.
    expect((rt as unknown as { agents: AgentHub }).agents.pending.length).toBeGreaterThan(0);
  });

  it("a guest can reply in a director's dm:Operator / dm:Narrator thread and an undeclared speaker's DM; dm:nobody stays 404 (W6 B19 review)", async () => {
    const source = SOURCE + `
when knock for program:
  GUARD: Who goes there?
`;
    const rt = runtime({ source });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Hal", passcode: CODES.event });
    const id = g.json["id"] as string;
    const token = g.json["token"] as string;
    // The Run Inspector's "Message <guest>": a mod say to `guest:<id>` with no `as`.
    expect((await call(rt, "POST", "/api/mod/say", { channel: `guest:${id}`, text: "Head to the kitchen." }, { moderator: true })).status).toBe(200);
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Operator", text: "ok, where is it?" }, { token })).status).toBe(200);
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Narrator", text: "hello?" }, { token })).status).toBe(200);
    // Subject-bound dialogue from a speaker the story never declares.
    expect((await call(rt, "POST", "/api/mod/signal", { name: "knock", subject: id }, { moderator: true })).status).toBe(200);
    const seen = () => call(rt, "GET", "/api/history", {}, { token }).then((r) => r.json["messages"] as Array<{ channel: string; text: string }>);
    const guardThread = (await seen()).find((m) => m.text === "Who goes there?")!.channel;
    expect(guardThread).toBe("dm:GUARD");
    expect((await call(rt, "POST", "/api/guest/say", { channel: guardThread, text: "a friend" }, { token })).status).toBe(200);
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:nobody", text: "psst" }, { token })).status).toBe(404);
    const mine = (await seen()).filter((m) => ["ok, where is it?", "hello?", "a friend"].includes(m.text)).map((m) => m.channel);
    expect(mine).toEqual(["dm:Operator", "dm:Narrator", guardThread]);
  });

  it("no hold: authored → silence, as before", async () => {
    let clock = 1_000_000;
    const rt = runtime({ now: () => clock });
    rt.openDoors();
    expect(rt.liveSim!.model.characters.get("Trabolta")?.hold).toBeNull();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Di", passcode: CODES.event });
    const token = g.json["token"] as string;
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hello?" }, { token });
    clock += 30_000;
    (rt as unknown as { agents: AgentHub }).agents.sweep();
    const history = await call(rt, "GET", "/api/history", {}, { token });
    expect((history.json["messages"] as Array<{ from: string; channel: string }>).filter((m) => m.channel === "dm:Trabolta").map((m) => m.from)).toEqual(["Di"]);
  });

  it("a DM still owed an answer survives a server restart: the restored hub queues it again (W8 T3-02)", async () => {
    let clock = 1_000_000;
    const d = mkdtempSync(join(tmpdir(), "loom-agents-"));
    dirs.push(d);
    const source = SOURCE.replace("  mind: external\n", '  mind: external\n  hold: "Back soon."\n');
    const mk = () =>
      new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "uploaded", scenarioSource: source, joinBase: () => "http://localhost", now: () => clock });
    const rt = mk();
    rt.openDoors();
    const a = await call(rt, "POST", "/api/guest/register", { name: "Ada", passcode: CODES.event });
    const b = await call(rt, "POST", "/api/guest/register", { name: "Bo", passcode: CODES.event });
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "before the crash" }, { token: a.json["token"] as string });
    // Bo's thread was answered (a director spoke last, as Trabolta): nothing owed.
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hello?" }, { token: b.json["token"] as string });
    await call(rt, "POST", "/api/mod/say", { channel: `guest:${b.json["id"] as string}`, as: "Trabolta", text: "Later." }, { moderator: true });
    rt.dispose();

    const rt2 = mk();
    expect(rt2.restore()).not.toBeNull();
    const hub = (rt2 as unknown as { agents: AgentHub }).agents;
    expect(hub.pending.map((r) => [r.thread.channel, r.thread.audience])).toEqual([["dm:Trabolta", [a.json["id"]]]]);
    // Nobody online: the hold line follows after 20 s, as it does live.
    clock += 20_000;
    hub.sweep();
    const history = await call(rt2, "GET", "/api/history", {}, { token: a.json["token"] as string });
    const dm = (history.json["messages"] as Array<{ from: string; text: string; channel: string }>).filter((m) => m.channel === "dm:Trabolta").map((m) => [m.from, m.text]);
    expect(dm).toEqual([
      ["Ada", "before the crash"],
      ["Trabolta", "Back soon."],
    ]);
    // …and a worker that connects still answers the question.
    const w = await call(rt2, "GET", "/api/agent/stream?characters=Trabolta", {}, { moderator: true });
    const reqs = w.res.frames().filter(([e]) => e === "request").map(([, r]) => r as AgentRequest);
    expect(reqs.map((r) => r.thread.audience)).toEqual([[a.json["id"]]]);
    rt2.dispose();
  });

  it("a restore re-asks only recent lines, and a thread that already got the hold line is re-asked without a second one (W8 review)", async () => {
    let clock = 1_000_000;
    const thread = async (rt: EventRuntime, token: string) =>
      ((await call(rt, "GET", "/api/history", {}, { token })).json["messages"] as Array<{ from: string; text: string; channel: string }>)
        .filter((m) => m.channel === "dm:Trabolta")
        .map((m) => [m.from, m.text]);

    // No hold line: a question older than the hub's queue age is not re-asked.
    {
      const d = mkdtempSync(join(tmpdir(), "loom-agents-"));
      dirs.push(d);
      const mk = () => new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "uploaded", scenarioSource: SOURCE, joinBase: () => "http://localhost", now: () => clock });
      const rt = mk();
      rt.openDoors();
      const old = await call(rt, "POST", "/api/guest/register", { name: "Cy", passcode: CODES.event });
      await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "an old question" }, { token: old.json["token"] as string });
      rt.tickOnce(AGENT_QUEUE_MAX_AGE_MS + 60_000); // the story clock moves on
      const fresh = await call(rt, "POST", "/api/guest/register", { name: "Di", passcode: CODES.event });
      await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "a fresh one" }, { token: fresh.json["token"] as string });
      rt.dispose();
      const rt2 = mk();
      expect(rt2.restore()).not.toBeNull();
      const hub = (rt2 as unknown as { agents: AgentHub }).agents;
      expect(hub.pending.map((r) => r.thread.audience)).toEqual([[fresh.json["id"]]]);
      rt2.dispose();
    }

    // With a hold line: it was said live; after a restart the question is
    // still owed (a worker that comes back answers it) — but never held twice.
    {
      const d = mkdtempSync(join(tmpdir(), "loom-agents-"));
      dirs.push(d);
      const source = SOURCE.replace("  mind: external\n", '  mind: external\n  hold: "Back soon."\n');
      const mk = () => new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "uploaded", scenarioSource: source, joinBase: () => "http://localhost", now: () => clock });
      const rt = mk();
      rt.openDoors();
      const a = await call(rt, "POST", "/api/guest/register", { name: "Ada", passcode: CODES.event });
      const token = a.json["token"] as string;
      await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "anyone there?" }, { token });
      clock += 20_000;
      (rt as unknown as { agents: AgentHub }).agents.sweep();
      expect(await thread(rt, token)).toEqual([
        ["Ada", "anyone there?"],
        ["Trabolta", "Back soon."],
      ]);
      rt.dispose();
      const rt2 = mk();
      expect(rt2.restore()).not.toBeNull();
      const hub = (rt2 as unknown as { agents: AgentHub }).agents;
      expect(hub.pending.map((r) => r.thread.audience)).toEqual([[a.json["id"]]]);
      clock += 60_000;
      hub.sweep();
      expect(await thread(rt2, token)).toHaveLength(2); // no second "Back soon."
      const w = await call(rt2, "GET", "/api/agent/stream?characters=Trabolta", {}, { moderator: true });
      expect(w.res.frames().filter(([e]) => e === "request")).toHaveLength(1);
      rt2.dispose();
    }
  });

  it("the request lists the character's powers with this run's use counts", async () => {
    const { rt, guest, requests } = await setup();
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "turn off the lights" }, { token: guest.token });
    const [r] = requests();
    expect(r!.powers).toEqual([
      { id: "cut the lights", label: "cut the lights", description: "args: room", limit: 1, used: 0 },
      { id: "snoop", label: "snoop", description: null, limit: null, used: 0 },
    ]);
    // `who: agent` is a power, never a button: guests and booths don't see it.
    expect(guestView(rt.liveSim!, guest.id).interactions.map((i) => i.id)).toEqual([]);
    expect(primeView(rt.liveSim, "Clippy").interactions.map((i) => i.id)).toEqual(["accuse"]);
  });

  it("acts: a share hands the guest an entry the character holds; a power fires as the character", async () => {
    const { rt, guest, requests } = await setup();
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "kill the kitchen lights and tell me about Sandy" }, { token: guest.token });
    const id = requests()[0]!.id;
    const reply = await call(
      rt,
      "POST",
      "/api/agent/reply",
      {
        id,
        say: "Done. And read this.",
        acts: [
          { kind: "share", entry: "the sandy file" },
          { kind: "share", entry: "The Missing Constant" }, // not held
          { kind: "fire", name: "cut the lights", args: { room: "The Cache" } },
          { kind: "fire", name: "accuse" }, // a performer's button, not a power
          { kind: "fire", name: "snoop", args: { target: guest.id } },
          { kind: "bogus" },
        ],
      },
      { moderator: true },
    );
    expect(reply.status).toBe(200);
    expect(reply.json["acted"]).toEqual([
      { kind: "share", ok: true, what: "The Sandy File" },
      { kind: "share", ok: false, what: "The Missing Constant", error: "the character doesn't hold that entry" },
      { kind: "fire", ok: true, what: "cut the lights" },
      { kind: "fire", ok: false, what: "accuse", error: "no such power" },
      { kind: "fire", ok: true, what: "snoop" },
    ]);
    const sim = rt.liveSim!;
    expect(sim.holdsCodex(guest.id, "The Sandy File")).toBe(true);
    expect(sim.worldEntries().find((w) => w.path === "Trabolta.lights_cut")?.value).toBe("1");
    expect(sim.worldEntries().find((w) => w.path === `${guest.id}.doubt`)?.value).toBe("3");
    // The cue reached the mod feed as an ordinary directive event (stagehand's show module hears it).
    const cue = sim.log.since(0).find((e) => e.type === "directive" && (e as { verb: string }).verb === "cue") as { args: string } | undefined;
    expect(cue?.args).toBe("lights, room: The Cache, state: off");

    // The limit is per run: a second cut is refused, and the next request says so.
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "again" }, { token: guest.token });
    const second = requests()[1]!;
    expect(second.powers.find((p) => p.id === "cut the lights")?.used).toBe(1);
    const again = await call(rt, "POST", "/api/agent/reply", { id: second.id, say: "No.", acts: [{ kind: "fire", name: "cut the lights", args: { room: "The Cache" } }] }, { moderator: true });
    expect(again.json["acted"]).toEqual([{ kind: "fire", ok: false, what: "cut the lights", error: "power exhausted for this run" }]);
    // …and the journal replays the acts (share + signal are ordinary mutations).
    expect(sim.worldEntries().find((w) => w.path === "Trabolta.lights_cut")?.value).toBe("1");
  });

  it("a power's uses survive a server restart; a director's fire of it never counts (W8 T3-03 / T8-04)", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-agents-"));
    dirs.push(d);
    const source = SOURCE.replace("  limit: 1\n", "  limit: 2\n");
    const mk = () => new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "uploaded", scenarioSource: source, joinBase: () => "http://localhost" });
    const rt = mk();
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Ada", passcode: CODES.event });
    const token = g.json["token"] as string;
    const ask = async (on: EventRuntime) => {
      const worker = await call(on, "GET", "/api/agent/stream?characters=Trabolta", {}, { moderator: true });
      await call(on, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "lights" }, { token });
      const r = worker.res.frames().filter(([e]) => e === "request").map(([, x]) => x as AgentRequest).at(-1)!;
      const reply = await call(on, "POST", "/api/agent/reply", { id: r.id, say: "", acts: [{ kind: "fire", name: "cut the lights", args: { room: "The Cache" } }] }, { moderator: true });
      worker.close();
      return { used: r.powers.find((p) => p.id === "cut the lights")?.used, acted: reply.json["acted"] };
    };
    expect(await ask(rt)).toEqual({ used: 0, acted: [{ kind: "fire", ok: true, what: "cut the lights" }] });
    // A director firing the same interaction as Trabolta is not his use.
    expect((await call(rt, "POST", "/api/mod/signal", { name: "cut the lights", subject: g.json["id"], actor: "Trabolta", args: { room: "The Cache" } }, { moderator: true })).status).toBe(200);
    rt.pause();
    rt.dispose();

    const rt2 = mk();
    expect(rt2.restore()).not.toBeNull();
    rt2.openDoors();
    expect(await ask(rt2)).toEqual({ used: 1, acted: [{ kind: "fire", ok: true, what: "cut the lights" }] });
    expect(await ask(rt2)).toEqual({ used: 2, acted: [{ kind: "fire", ok: false, what: "cut the lights", error: "power exhausted for this run" }] });
    rt2.dispose();
  });

  it("a fire the story only answers with words (a refusal) doesn't spend the power's limit", async () => {
    const source = SOURCE.replace(
      "  when cut the lights for program:\n    set self.lights_cut += 1\n    <cue: lights, room: {room}, state: off>\n",
      '  when cut the lights for program:\n    if room != "The Cache":\n      Trabolta: That function is not available in that room.\n    else:\n      set self.lights_cut += 1\n      <cue: lights, room: {room}, state: off>\n',
    );
    expect(source).not.toBe(SOURCE);
    const rt = runtime({ source });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Gil", passcode: CODES.event });
    const token = g.json["token"] as string;
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta", {}, { moderator: true });
    const requests = () => worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
    const cut = async (room: string) => {
      await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: `the lights in ${room}` }, { token });
      const r = requests().at(-1)!;
      const reply = await call(rt, "POST", "/api/agent/reply", { id: r.id, say: "", acts: [{ kind: "fire", name: "cut the lights", args: { room } }] }, { moderator: true });
      return { used: r.powers.find((p) => p.id === "cut the lights")?.used, acted: reply.json["acted"] };
    };
    expect(await cut("the attic")).toEqual({ used: 0, acted: [{ kind: "fire", ok: true, what: "cut the lights", refused: true }] });
    expect(await cut("The Cloud")).toEqual({ used: 0, acted: [{ kind: "fire", ok: true, what: "cut the lights", refused: true }] });
    // Still one use left (limit: 1): the real cut lands — a `room` argument
    // folds onto the declared LOCATION (case, `_`, spaces), so the story's
    // exact compare and stagehand's cue rule both see "The Cache" — then
    // the limit holds.
    expect(await cut("the  CACHE")).toEqual({ used: 0, acted: [{ kind: "fire", ok: true, what: "cut the lights" }] });
    expect(rt.liveSim!.worldEntries().find((w) => w.path === "Trabolta.lights_cut")?.value).toBe("1");
    const cue = rt.liveSim!.log.since(0).find((e) => e.type === "directive" && (e as { verb: string }).verb === "cue") as { args: string } | undefined;
    expect(cue?.args).toBe("lights, room: The Cache, state: off");
    expect((await cut("The Cache")).acted).toEqual([{ kind: "fire", ok: false, what: "cut the lights", error: "power exhausted for this run" }]);
  });

  it("the facts document describes the whole session, mod-gated", async () => {
    const { rt, guest } = await setup();
    expect((await call(rt, "GET", "/api/agent/facts", {})).status).toBe(403);
    await call(rt, "POST", "/api/mod/set", { id: guest.id, field: "location", value: "The Cache" }, { moderator: true });
    const facts = (await call(rt, "GET", "/api/agent/facts", {}, { moderator: true })).json as unknown as AgentFacts;
    expect(facts.programs).toEqual([
      expect.objectContaining({ id: guest.id, name: "Ada", location: "The Cache", captured: false, vars: expect.objectContaining({ humanity: "20" }), codex: [] }),
    ]);
    expect(facts.characters.find((c) => c.id === "Trabolta")).toMatchObject({ mind: "external", online: true, codex: ["The Sandy File"], vars: { truth: "35" } });
    expect(facts.locations).toEqual([{ id: "The Cache", label: "The Cache (kitchen)", occupants: ["Ada"] }]);
    expect(facts.codex.find((e) => e.title === "The Sandy File")).toMatchObject({ holders: ["Trabolta"], hasCode: false });
    expect(facts.powers.map((p) => p.id)).toEqual(["cut the lights", "snoop"]);
  });

  it("no agent reads a secret character or an unrevealed hidden group's membership", async () => {
    const source = `${SOURCE}
GROUP Cabal
  hidden: true

CHARACTER Vault
  playable: false
  secret: true
  combo: text? = none
`;
    const rt = runtime({ source });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Ada", passcode: CODES.event });
    const id = g.json["id"] as string;
    const token = g.json["token"] as string;
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    const sim = rt.liveSim!;
    sim.setVar("Vault.combo", "1-2-3");
    sim.join(id, "Cabal");
    expect(sim.groupsOf(id)).toEqual(["Cabal"]);

    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hi" }, { token });
    const req = worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest)[0]!;
    const blob = JSON.stringify(req);
    for (const leak of ["Cabal", "1-2-3", "Vault"]) expect(blob, leak).not.toContain(leak);
    expect(req.them.vars["groups"]).toBe("[]");

    const facts = (await call(rt, "GET", "/api/agent/facts", {}, { moderator: true })).json as unknown as AgentFacts;
    for (const leak of ["Cabal", "1-2-3", "Vault"]) expect(JSON.stringify(facts), leak).not.toContain(leak);
    expect(facts.characters.map((c) => c.id).sort()).toEqual(["Clippy", "Trabolta"]);

    // Revealed, the group is public: membership reads like any other.
    expect((await call(rt, "POST", "/api/mod/reveal", { faction: "Cabal" }, { moderator: true })).status).toBe(200);
    const after = (await call(rt, "GET", "/api/agent/facts", {}, { moderator: true })).json as unknown as AgentFacts;
    const ada = after.programs.find((p) => p.id === id)!;
    expect(ada.groups).toEqual(["Cabal"]);
    expect(ada.faction).toBe("Cabal");
    expect(ada.vars).toMatchObject({ group: "Cabal", faction: "Cabal", groups: "[Cabal]" });
    expect(JSON.stringify(after)).not.toContain("1-2-3"); // the Vault stays secret
  });

  it("a worker's mind report shows up on the director's view, and a restart forgets it", async () => {
    const { rt } = await setup();
    expect((await call(rt, "POST", "/api/agent/mind", { character: "Trabolta" })).status).toBe(403);
    const posted = await call(
      rt,
      "POST",
      "/api/agent/mind",
      { character: "Trabolta", worker: "laptop", brief: "Court Ada. Ask about bodies.", mood: "wistful", notes: ["Ada says she is a nurse."], people: [{ id: "g1", name: "Ada", summary: "kind; asked about Sandy", trust: 62 }] },
      { moderator: true },
    );
    expect(posted.status).toBe(200);
    const view = (await call(rt, "GET", "/api/state?role=mod", {}, { moderator: true })).json as { minds?: AgentMindSummary[] };
    expect(view.minds).toHaveLength(1);
    expect(view.minds![0]).toMatchObject({ character: "Trabolta", worker: "laptop", brief: "Court Ada. Ask about bodies.", mood: "wistful", people: [{ id: "g1", trust: 62 }] });
    await call(rt, "POST", "/api/mod/reset", {}, { moderator: true });
    const after = (await call(rt, "GET", "/api/state?role=mod", {}, { moderator: true })).json as { minds?: AgentMindSummary[] };
    expect(after.minds).toBeUndefined();
  });

  it("mind: external compiles onto the character", () => {
    const sim = Sim.fromSources(SOURCE);
    expect(sim.model.characters.get("Trabolta")?.mind).toBe("external");
    expect(sim.model.characters.get("Clippy")?.mind).toBeNull();
  });
});

describe("the agent and the event's lifecycle (D10, T9-timers-03, R1-diff-server-02)", () => {
  const HOLD_SOURCE = SOURCE.replace("  mind: external\n", '  mind: external\n  hold: "Back soon."\n');
  const at = (source: string, clock: { t: number }) => {
    const d = mkdtempSync(join(tmpdir(), "loom-agents-"));
    dirs.push(d);
    return () => new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "uploaded", scenarioSource: source, joinBase: () => "http://localhost", now: () => clock.t });
  };
  const threadOf = async (rt: EventRuntime, token: string) =>
    ((await call(rt, "GET", "/api/history", {}, { token })).json["messages"] as Array<{ from: string; text: string; channel: string }>)
      .filter((m) => m.channel === "dm:Trabolta")
      .map((m) => [m.from, m.text]);
  const hubOf = (rt: EventRuntime) => (rt as unknown as { agents: AgentHub }).agents;

  it("a reply while the doors are paused lands its words but refuses its acts, and no power is spent", async () => {
    const { rt, guest, requests } = await setup();
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "lights out please" }, { token: guest.token });
    const id = requests()[0]!.id;
    rt.pause();
    const reply = await call(rt, "POST", "/api/agent/reply", { id, say: "Not now.", acts: [{ kind: "fire", name: "cut the lights", args: { room: "The Cache" } }, { kind: "share", entry: "The Sandy File" }] }, { moderator: true });
    expect(reply.status).toBe(200);
    expect(reply.json["said"]).toBe(true);
    expect(reply.json["acted"]).toEqual([
      { kind: "fire", ok: false, what: "cut the lights", error: "doors are closed" },
      { kind: "share", ok: false, what: "The Sandy File", error: "doors are closed" },
    ]);
    const sim = rt.liveSim!;
    expect(sim.log.since(0).some((e) => e.type === "directive" && (e as { verb: string }).verb === "cue")).toBe(false);
    expect(sim.worldEntries().find((w) => w.path === "Trabolta.lights_cut")?.value).toBe("0");
    expect(sim.holdsCodex(guest.id, "The Sandy File")).toBe(false);
    expect((await threadOf(rt, guest.token)).at(-1)).toEqual(["Trabolta", "Not now."]);
    // Back open: the power is still unspent.
    rt.openDoors();
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "now?" }, { token: guest.token });
    expect(requests().at(-1)!.powers.find((p) => p.id === "cut the lights")?.used).toBe(0);
    rt.dispose();
  });

  it("a request in flight across a 3-minute pause is not cancelled on the first tick back", async () => {
    const clock = { t: 1_000_000 };
    const rt = at(SOURCE, clock)();
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Ada", passcode: CODES.event });
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta", {}, { moderator: true });
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hello?" }, { token: g.json["token"] as string });
    clock.t += 30_000;
    rt.pause();
    clock.t += 3 * 60_000;
    rt.openDoors();
    clock.t += 1000;
    rt.tickOnce(1000);
    expect(worker.res.frames().map(([e]) => e).filter((e) => e === "request" || e === "cancel")).toEqual(["request"]);
    rt.dispose();
  });

  it("with no worker, a DM before an 11-minute pause still gets its hold line after the resume, and a worker that attaches then answers it", async () => {
    const clock = { t: 1_000_000 };
    const rt = at(HOLD_SOURCE, clock)();
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Ada", passcode: CODES.event });
    const token = g.json["token"] as string;
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hello?" }, { token });
    clock.t += 10_000;
    rt.tickOnce(1000);
    rt.pause();
    clock.t += 11 * 60_000;
    rt.openDoors();
    for (let i = 0; i < 20; i++) {
      clock.t += 1000;
      rt.tickOnce(1000);
    }
    expect(await threadOf(rt, token)).toEqual([
      ["Ada", "hello?"],
      ["Trabolta", "Back soon."],
    ]);
    expect(hubOf(rt).pending).toHaveLength(1);
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta", {}, { moderator: true });
    expect(worker.res.frames().filter(([e]) => e === "request")).toHaveLength(1);
    rt.dispose();
  });

  it("a guest who wrote again after the hold line gets no second one after a restore", async () => {
    const clock = { t: 1_000_000 };
    const mk = at(HOLD_SOURCE, clock);
    const rt = mk();
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Ada", passcode: CODES.event });
    const token = g.json["token"] as string;
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "anyone there?" }, { token });
    clock.t += 20_000;
    hubOf(rt).sweep();
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "still there?" }, { token });
    clock.t += 20_000;
    hubOf(rt).sweep();
    expect(await threadOf(rt, token)).toHaveLength(3);
    rt.dispose();
    const rt2 = mk();
    expect(rt2.restore()).not.toBeNull();
    expect(hubOf(rt2).pending.map((r) => r.thread.audience)).toEqual([[g.json["id"]]]);
    clock.t += 60_000;
    hubOf(rt2).sweep();
    expect((await threadOf(rt2, token)).filter(([, text]) => text === "Back soon.")).toHaveLength(1);
    const w = await call(rt2, "GET", "/api/agent/stream?characters=Trabolta", {}, { moderator: true });
    expect(w.res.frames().filter(([e]) => e === "request")).toHaveLength(1);
    rt2.dispose();
  });

  it("control: after a real reply and a new guest line, a restore with no worker posts one new hold line", async () => {
    const clock = { t: 1_000_000 };
    const mk = at(HOLD_SOURCE, clock);
    const rt = mk();
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Ada", passcode: CODES.event });
    const token = g.json["token"] as string;
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "anyone there?" }, { token });
    clock.t += 20_000;
    hubOf(rt).sweep();
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta", {}, { moderator: true });
    const r = worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest).at(-1)!;
    await call(rt, "POST", "/api/agent/reply", { id: r.id, say: "Here now." }, { moderator: true });
    worker.close();
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "great, a question" }, { token });
    rt.dispose();
    const rt2 = mk();
    expect(rt2.restore()).not.toBeNull();
    clock.t += 21_000;
    hubOf(rt2).sweep();
    expect((await threadOf(rt2, token)).map(([, text]) => text)).toEqual(["anyone there?", "Back soon.", "Here now.", "great, a question", "Back soon."]);
    rt2.dispose();
  });
});
