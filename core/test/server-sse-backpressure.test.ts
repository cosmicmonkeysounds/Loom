//! W8 T9-01: an SSE client that stops reading (a suspended phone, a laptop
//! asleep on the Run page) must not make the server buffer without limit.
//! `sseWrite` drops a stream whose queue passed its cap and has sent nothing
//! for `SSE_STALL_MS`; the request's `close` handler then removes the client
//! and its EventSource reconnects to a fresh snapshot + history.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { SSE_MOD_QUEUE_CAP, SSE_QUEUE_CAP, SSE_STALL_MS, sseCap, sseSend, sseWrite } from "../server/http-util.ts";
import { Store } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";

const CODES = { event: "EVT333", prime: "PRM333", mod: "MOD333" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A response whose peer never reads: every write stays queued. */
function stalledRes(onDestroy: () => void = () => {}) {
  const res = {
    statusCode: 0,
    body: "",
    writableLength: 0,
    writableEnded: false,
    destroyed: false,
    writes: 0,
    listeners: new Map<string, Array<() => void>>(),
    on(ev: string, fn: () => void) {
      res.listeners.set(ev, [...(res.listeners.get(ev) ?? []), fn]);
      return res;
    },
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write(chunk: string) {
      res.writableLength += Buffer.byteLength(chunk);
      res.writes += 1;
      return false;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      res.writableEnded = true;
      return res;
    },
    destroy() {
      res.destroyed = true;
      onDestroy();
      return res;
    },
    /** The peer read `n` bytes — the queue shrinks, but no `drain` (it isn't empty). */
    read(n: number) {
      res.writableLength = Math.max(0, res.writableLength - n);
    },
    /** The peer read everything. */
    drain() {
      res.writableLength = 0;
      for (const fn of res.listeners.get("drain") ?? []) fn();
    },
  };
  return res;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("sseWrite", () => {
  it("writes while the client keeps up, however much it is sent", () => {
    const res = stalledRes();
    const r = res as unknown as ServerResponse;
    for (let i = 0; i < 100; i++) {
      sseSend(r, "message", { text: "x".repeat(10_000) });
      res.drain();
      vi.setSystemTime(Date.now() + 1000);
    }
    expect(res.destroyed).toBe(false);
    expect(res.writes).toBe(200); // an `event:` line + its `data:` each
  });

  it("over the cap, a stream is dropped only once nothing left it for SSE_STALL_MS", () => {
    const res = stalledRes();
    const r = res as unknown as ServerResponse;
    // One big frame (a director's history) is always written.
    expect(sseWrite(r, "x".repeat(SSE_QUEUE_CAP * 4))).toBe(true);
    // Still inside the grace: a slow reader catching up is kept.
    vi.setSystemTime(Date.now() + SSE_STALL_MS - 1);
    expect(sseWrite(r, ":ping\n\n")).toBe(true);
    expect(res.destroyed).toBe(false);
    // Past it with the queue still over the cap: dropped, nothing written.
    vi.setSystemTime(Date.now() + 2);
    const writes = res.writes;
    expect(sseWrite(r, ":ping\n\n")).toBe(false);
    expect(res.destroyed).toBe(true);
    expect(res.writes).toBe(writes);
    // A destroyed stream is never written again.
    expect(sseWrite(r, ":ping\n\n")).toBe(false);
  });

  it("a drain restarts the grace, and under the cap a stall is never dropped", () => {
    const res = stalledRes();
    const r = res as unknown as ServerResponse;
    sseWrite(r, "x".repeat(SSE_QUEUE_CAP + 1));
    vi.setSystemTime(Date.now() + SSE_STALL_MS * 2);
    res.drain();
    sseWrite(r, "x".repeat(SSE_QUEUE_CAP + 1));
    vi.setSystemTime(Date.now() + SSE_STALL_MS - 1);
    expect(sseWrite(r, ":ping\n\n")).toBe(true);
    // A small queue, however old, is fine.
    const small = stalledRes();
    sseWrite(small as unknown as ServerResponse, "x".repeat(1000));
    vi.setSystemTime(Date.now() + SSE_STALL_MS * 100);
    expect(sseWrite(small as unknown as ServerResponse, ":ping\n\n")).toBe(true);
  });

  it("a slow reader that never empties its queue is kept while it takes bytes; one that stops is dropped", () => {
    const res = stalledRes();
    const r = res as unknown as ServerResponse;
    // A director over a slow link: a big history, then frames arriving a
    // little faster than it reads — never empty, always progressing.
    sseWrite(r, "x".repeat(SSE_QUEUE_CAP * 4));
    for (let i = 0; i < 60; i++) {
      vi.setSystemTime(Date.now() + 1000);
      res.read(20_000);
      expect(sseWrite(r, "y".repeat(25_000))).toBe(true);
    }
    expect(res.destroyed).toBe(false);
    expect(res.writableLength).toBeGreaterThan(SSE_QUEUE_CAP);
    // It stops reading: still over the cap, and nothing leaves for the grace.
    vi.setSystemTime(Date.now() + SSE_STALL_MS - 1);
    expect(sseWrite(r, ":ping\n\n")).toBe(true);
    vi.setSystemTime(Date.now() + 2);
    expect(sseWrite(r, ":ping\n\n")).toBe(false);
    expect(res.destroyed).toBe(true);
  });

  it("a director's console has the bigger cap", () => {
    const res = stalledRes();
    const r = res as unknown as ServerResponse;
    sseCap(r, SSE_MOD_QUEUE_CAP);
    sseWrite(r, "x".repeat(SSE_QUEUE_CAP * 2));
    vi.setSystemTime(Date.now() + SSE_STALL_MS * 2);
    expect(sseWrite(r, ":ping\n\n")).toBe(true);
    sseWrite(r, "x".repeat(SSE_MOD_QUEUE_CAP));
    expect(sseWrite(r, ":ping\n\n")).toBe(false);
    expect(res.destroyed).toBe(true);
  });
});

describe("a stalled stream on the event runtime", () => {
  function fakeReq(body: unknown) {
    const buf = Buffer.from(JSON.stringify(body ?? {}));
    const closers: Array<() => void> = [];
    const req = {
      headers: {},
      [Symbol.asyncIterator]: async function* () {
        yield buf;
      },
      on(ev: string, fn: () => void) {
        if (ev === "close") closers.push(fn);
      },
    } as unknown as IncomingMessage;
    return { req, close: () => closers.forEach((f) => f()) };
  }
  async function call(rt: EventRuntime, method: string, pathAndQuery: string, body: unknown, res = stalledRes(), moderator = true) {
    const url = new URL(`http://x${pathAndQuery}`);
    const { req, close } = fakeReq(body);
    const r = res as typeof res & { close?: () => void };
    await rt.handle(req, r as unknown as ServerResponse, method, url.pathname, url, { moderator });
    return { res, close };
  }
  const clientCount = async (rt: EventRuntime) => {
    const res = stalledRes();
    await call(rt, "GET", "/api/mod/metrics", {}, res);
    return (JSON.parse(res.body) as { clients: number }).clients;
  };

  it("a director console that stops reading is dropped once its queue passes the cap; a reading one stays", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-sse-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "escape-the-internet", scenarioSource: scenarioSource("escape-the-internet"), joinBase: () => "http://localhost", snapshotMs: 0 });
    rt.openDoors();
    // The stalled console: destroying its response closes the request, as Node does.
    let closeStalled = () => {};
    const stalled = stalledRes(() => closeStalled());
    const opened = await call(rt, "GET", "/events?role=mod", {}, stalled);
    closeStalled = opened.close;
    const reading = stalledRes();
    await call(rt, "GET", "/events?role=mod", {}, reading);
    expect(await clientCount(rt)).toBe(2);

    // A director typing into the lobby, once a second: every console gets each line.
    let lines = 0;
    while (!stalled.destroyed && lines < 1000) {
      await call(rt, "POST", "/api/mod/say", { channel: "lobby", text: `${lines} ${"x".repeat(8000)}` });
      lines += 1;
      reading.drain();
      vi.setSystemTime(Date.now() + 1000);
    }
    expect(stalled.destroyed).toBe(true);
    expect(stalled.writableLength).toBeGreaterThan(SSE_MOD_QUEUE_CAP);
    expect(stalled.writableLength).toBeLessThan(SSE_MOD_QUEUE_CAP * 4);
    expect(reading.destroyed).toBe(false);
    expect(await clientCount(rt)).toBe(1);
    rt.dispose();
  });
});
