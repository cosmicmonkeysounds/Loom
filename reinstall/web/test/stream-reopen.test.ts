import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSpatialStream, reopenDelay, streamGone, type SpatialSource } from "../src/spatial.ts";
import { streamProbe } from "../src/api.ts";

// Behind Caddy a loom restart answers the stream's reconnect with a 502,
// and an EventSource that gets a non-200 is CLOSED for good. The tablet
// and the map page reopen it (wave 9, C8).
class FakeSource implements SpatialSource {
  readyState = 0;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  closed = false;
  listeners = new Map<string, (e: Event) => void>();
  constructor(readonly url: string) {}
  addEventListener(type: string, fn: (e: Event) => void): void {
    this.listeners.set(type, fn);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  /** A non-200 answer: the browser gives up on this source. */
  refuse(): void {
    this.readyState = 2;
    this.onerror?.(new Event("error"));
  }
  /** A dropped connection the browser retries itself. */
  drop(): void {
    this.readyState = 0;
    this.onerror?.(new Event("error"));
  }
}

function harness(probe?: () => Promise<number | null>) {
  const sources: FakeSource[] = [];
  const states: boolean[] = [];
  let deaths = 0;
  const handle = openSpatialStream(
    "/e/x/api/spatial/stream?token=t",
    { onFrame: () => {}, onState: (up) => states.push(up), onDead: () => (deaths += 1) },
    { ...(probe ? { probe } : {}), source: (url) => { const s = new FakeSource(url); sources.push(s); return s; } },
  );
  return { sources, states, deaths: () => deaths, handle };
}

describe("the spatial stream survives a proxy's 502", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("backs off 1 s, 2 s, 4 s … 15 s", () => {
    expect([0, 1, 2, 3, 4, 10].map(reopenDelay)).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000]);
    expect([401, 403, 404].every(streamGone)).toBe(true);
    expect([null, 200, 502, 503, 500].some(streamGone)).toBe(false);
  });

  it("a closed stream whose token still reads reopens after the backoff, and an open resets it", async () => {
    const h = harness(async () => 502);
    h.sources[0]!.open();
    h.sources[0]!.refuse();
    await vi.advanceTimersByTimeAsync(999);
    expect(h.sources).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sources).toHaveLength(2);
    expect(h.sources[0]!.closed).toBe(true);
    expect(h.sources[1]!.url).toBe(h.sources[0]!.url);
    // Still down: the next try waits longer.
    h.sources[1]!.refuse();
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.sources).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sources).toHaveLength(3);
    // Back up: the backoff starts over.
    h.sources[2]!.open();
    h.sources[2]!.refuse();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sources).toHaveLength(4);
    expect(h.states).toEqual([true, false, false, true, false]);
    expect(h.deaths()).toBe(0);
  });

  it("a refused token or an ended event stops for good and reports onDead", async () => {
    for (const status of [401, 404]) {
      const h = harness(async () => status);
      h.sources[0]!.refuse();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.sources).toHaveLength(1);
      expect(h.deaths()).toBe(1);
    }
  });

  it("an unreachable probe retries; a drop the browser retries itself makes no new source", async () => {
    const h = harness(async () => null);
    h.sources[0]!.drop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.sources).toHaveLength(1);
    h.sources[0]!.refuse();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sources).toHaveLength(2);
  });

  it("close() cancels a pending reopen", async () => {
    const h = harness(async () => 502);
    h.sources[0]!.refuse();
    await vi.advanceTimersByTimeAsync(10);
    h.handle.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sources).toHaveLength(1);
  });

  it("with no probe, a stream that never opened is refused at once; one that opened reopens", async () => {
    const never = harness();
    never.sources[0]!.refuse();
    expect(never.deaths()).toBe(1);
    const once = harness();
    once.sources[0]!.open();
    once.sources[0]!.refuse();
    await vi.advanceTimersByTimeAsync(1000);
    expect(once.sources).toHaveLength(2);
    expect(once.deaths()).toBe(0);
  });

  it("the probe reads the stream's own gate with the same token", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response("{}", { status: 401 });
    }) as unknown as typeof fetch;
    expect(await streamProbe("/e/x", "tok", fetcher)()).toBe(401);
    expect(calls[0]![0]).toBe("/e/x/api/spatial/house");
    expect((calls[0]![1]!.headers as Record<string, string>)["x-loom-token"]).toBe("tok");
    const down = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    expect(await streamProbe("/e/x", "tok", down)()).toBeNull();
  });
});
