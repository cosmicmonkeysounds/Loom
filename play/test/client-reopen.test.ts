//! T4-01 / T7-01: behind Caddy, the reconnect a phone makes while the
//! server restarts gets a 502 — and any non-200 closes an `EventSource` for
//! good. `openChatFeed` asks the probe and reopens unless the session is
//! really dead; a fake source + clock drive it here.

import { describe, expect, it } from "vitest";


import { REOPEN_MAX_MS, openChatFeed, reopenDelay, type ChatFeedEnv, type FeedPageEvent, type FeedSource, type StreamVerdict } from "../src/client.ts";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

class FakeSource implements FeedSource {
  readyState = CONNECTING;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  readonly listeners = new Map<string, (e: Event) => void>();
  constructor(readonly url: string) {}
  addEventListener(type: string, fn: (e: Event) => void): void {
    this.listeners.set(type, fn);
  }
  close(): void {
    this.closed = true;
    this.readyState = CLOSED;
  }
  open(): void {
    this.readyState = OPEN;
    this.onopen?.(new Event("open"));
  }
  /** A dropped connection the browser retries by itself. */
  drop(): void {
    this.readyState = CONNECTING;
    this.onerror?.(new Event("error"));
  }
  /** A non-200 answer (the proxy's 502, a 401): closed for good. */
  refuse(): void {
    this.readyState = CLOSED;
    this.onerror?.(new Event("error"));
  }
  frame(type: string, data: unknown): void {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent as Event);
  }
}

/** `probe: null` = a feed with no probe. */
function harness(probe: (() => Promise<StreamVerdict>) | null = () => Promise.resolve(null)) {
  const sources: FakeSource[] = [];
  let now = 0;
  let nextId = 1;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  const page = new Map<FeedPageEvent, () => void>();
  const log: string[] = [];
  const dead: StreamVerdict[] = [];
  let probes = 0;
  const env: ChatFeedEnv = {
    source: (url) => {
      const s = new FakeSource(url);
      sources.push(s);
      return s;
    },
    probe:
      probe === null
        ? undefined
        : () => {
            probes++;
            return probe();
          },
    delay: (attempt) => reopenDelay(attempt, () => 1),
    setTimer: (fn, ms) => {
      const t = { at: now + ms, fn, id: nextId++ };
      timers.push(t);
      return t.id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    listen: (event, fn) => {
      page.set(event, fn);
      return () => page.delete(event);
    },
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const stop = openChatFeed(
    "/e/default/events?role=guest&token=t",
    {
      onOpen: () => log.push("open"),
      onError: () => log.push("error"),
      onFrame: (frame, data) => log.push(`${frame}:${data}`),
      onDead: (v) => dead.push(v),
    },
    env,
  );
  return {
    sources,
    log,
    dead,
    stop,
    flush,
    get probes() {
      return probes;
    },
    get last() {
      return sources[sources.length - 1]!;
    },
    nextDelay: () => (timers.length === 0 ? null : Math.min(...timers.map((t) => t.at)) - now),
    async advance(ms: number) {
      now += ms;
      for (const t of [...timers].filter((t) => t.at <= now)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
      await flush();
    },
    async page(event: FeedPageEvent) {
      page.get(event)?.();
      await flush();
    },
  };
}

describe("reopenDelay", () => {
  it("doubles from 1 s to a 15 s cap, jittered down to half", () => {
    expect(reopenDelay(0, () => 1)).toBe(1000);
    expect(reopenDelay(1, () => 1)).toBe(2000);
    expect(reopenDelay(3, () => 1)).toBe(8000);
    expect(reopenDelay(10, () => 1)).toBe(REOPEN_MAX_MS);
    expect(reopenDelay(0, () => 0)).toBe(500);
  });
});

describe("openChatFeed", () => {
  it("reopens a stream the proxy refused once the probe says the session is alive", async () => {
    const h = harness();
    expect(h.sources).toHaveLength(1);
    h.last.open();
    h.last.refuse(); // the reconnect hit Caddy's 502 mid-restart
    await h.flush();
    expect(h.probes).toBe(1);
    expect(h.sources[0]!.closed).toBe(true);
    expect(h.nextDelay()).toBe(1000);
    await h.advance(1000);
    expect(h.sources).toHaveLength(2);
    expect(h.last.url).toBe("/e/default/events?role=guest&token=t");
    // Still down: the backoff grows.
    h.last.refuse();
    await h.flush();
    expect(h.nextDelay()).toBe(2000);
    await h.advance(2000);
    expect(h.sources).toHaveLength(3);
    // Back: the history frame flows and the backoff resets.
    h.last.open();
    h.last.frame("history", []);
    expect(h.log.slice(-2)).toEqual(["open", "history:[]"]);
    h.last.refuse();
    await h.flush();
    expect(h.nextDelay()).toBe(1000);
    expect(h.dead).toEqual([]);
    h.stop();
  });

  it("never reopens a dead session: the probe's verdict goes to onDead", async () => {
    for (const verdict of ["reset", "ended"] as const) {
      const h = harness(() => Promise.resolve(verdict));
      h.last.refuse();
      await h.flush();
      expect(h.dead).toEqual([verdict]);
      expect(h.nextDelay()).toBeNull();
      await h.page("online");
      await h.advance(60_000);
      expect(h.sources).toHaveLength(1);
    }
  });

  it("a probe that fails (no network) reopens too", async () => {
    const h = harness(() => Promise.reject(new Error("offline")));
    h.last.refuse();
    await h.flush();
    expect(h.nextDelay()).toBe(1000);
    await h.advance(1000);
    expect(h.sources).toHaveLength(2);
    h.stop();
  });

  it("leaves a plain drop to the browser's own retry", async () => {
    const h = harness();
    h.last.open();
    h.last.drop();
    await h.flush();
    expect(h.probes).toBe(0);
    expect(h.sources).toHaveLength(1);
    expect(h.log).toEqual(["open", "error"]);
    h.stop();
  });

  it("the page going away is never a close: no probe, no reopen", async () => {
    const h = harness();
    h.last.open();
    await h.page("pagehide");
    h.last.refuse();
    await h.flush();
    expect(h.probes).toBe(0);
    expect(h.nextDelay()).toBeNull();
    // Restored from the back/forward cache: open again.
    await h.page("pageshow");
    expect(h.sources).toHaveLength(2);
    h.stop();
  });

  it("back online or back in view reopens at once instead of waiting out the backoff", async () => {
    const h = harness();
    h.last.refuse();
    await h.flush();
    await h.advance(1000);
    h.last.refuse();
    await h.flush();
    expect(h.nextDelay()).toBe(2000);
    await h.page("online");
    expect(h.sources).toHaveLength(3);
    expect(h.nextDelay()).toBeNull(); // the pending retry was dropped
    h.last.open();
    // Connected: waking again opens nothing new.
    await h.page("visible");
    expect(h.sources).toHaveLength(3);
    h.stop();
  });

  it("a late probe answer for a source already replaced is ignored", async () => {
    let answer: (v: StreamVerdict) => void = () => {};
    const h = harness(() => new Promise<StreamVerdict>((r) => (answer = r)));
    h.last.refuse();
    await h.page("visible"); // reopened while the probe is out
    expect(h.sources).toHaveLength(2);
    answer(null);
    await h.flush();
    expect(h.nextDelay()).toBeNull();
    expect(h.sources).toHaveLength(2);
    h.stop();
  });

  it("without a probe, a refused stream is reported dead at once (the terminal's pilot)", async () => {
    const h = harness(null);
    h.last.refuse();
    await h.flush();
    expect(h.dead).toEqual([null]);
    await h.page("online");
    expect(h.sources).toHaveLength(1);
  });

  it("stop closes the source and cancels a pending reopen", async () => {
    const h = harness();
    h.last.refuse();
    await h.flush();
    expect(h.nextDelay()).toBe(1000);
    h.stop();
    await h.advance(5000);
    expect(h.sources).toHaveLength(1);
  });
});

