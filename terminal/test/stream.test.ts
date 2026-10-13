import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRACE_MS, RETRY_MAX_MS, RETRY_MS, WorldStore, goneOf, openSpatialFeed, retryDelay, type FeedSource } from "../src/world/stream.ts";
import { playerState } from "./world-fixture.ts";

/** A hand-driven EventSource. */
class FakeSource implements FeedSource {
  readyState = 0;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(e: Event) => void>>();
  constructor(readonly url: string) {}
  addEventListener(type: string, fn: (e: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
  emit(type: string, data: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) } as unknown as Event);
  }
  /** A drop the browser retries by itself (CONNECTING), or a refusal (CLOSED). */
  fail(closed: boolean): void {
    this.readyState = closed ? 2 : 0;
    this.onerror?.({} as Event);
  }
}

function harness(probe: () => Promise<number | null>) {
  const store = new WorldStore();
  const sources: FakeSource[] = [];
  const close = openSpatialFeed(store, {
    url: "/e/x/api/spatial/stream",
    probe,
    source: (url) => {
      const s = new FakeSource(url);
      sources.push(s);
      return s;
    },
    now: () => 0,
  });
  const hello = (s: FakeSource) => s.emit("hello", { eventId: "x", houseVersion: "v1", players: [playerState("s1", [1, 0, 1])] });
  return { store, sources, close, hello };
}

describe("spatial feed", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("maps refusals and backs off", () => {
    expect(goneOf(401)).toBe("revoked");
    expect(goneOf(403)).toBe("revoked");
    expect(goneOf(404)).toBe("ended");
    expect(goneOf(503)).toBeNull();
    expect(goneOf(500)).toBeNull();
    expect(retryDelay(0)).toBe(RETRY_MS);
    expect(retryDelay(1)).toBe(RETRY_MS * 2);
    expect(retryDelay(10)).toBe(RETRY_MAX_MS);
  });

  it("listens for the duck frame: a map save moves that player's duck in the store", () => {
    const { store, sources, hello } = harness(async () => 503);
    sources[0]!.open();
    hello(sources[0]!);
    sources[0]!.emit("duck", { session: "s1", duck: { id: "sofa", room: "a", pos: [2, 0.4, 3] } });
    expect(store.snapshot.world.players.get("s1")!.duck).toEqual({ id: "sofa", room: "a", pos: [2, 0.4, 3] });
  });

  it("drops the last players after a grace period without the stream (no frozen ghosts)", async () => {
    const { store, sources, hello } = harness(async () => 503);
    sources[0]!.open();
    hello(sources[0]!);
    expect(store.snapshot.world.players.size).toBe(1);
    sources[0]!.fail(false); // the browser reconnects by itself
    expect(store.snapshot.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(GRACE_MS - 1);
    expect(store.snapshot.world.players.size).toBe(1); // a blip keeps the ghosts
    await vi.advanceTimersByTimeAsync(1);
    expect(store.snapshot.world.players.size).toBe(0);
    expect(store.snapshot.world.houseVersion).toBe("v1"); // still knows which map it had
  });

  it("a reconnect inside the grace keeps the players", async () => {
    const { store, sources, hello } = harness(async () => 503);
    sources[0]!.open();
    hello(sources[0]!);
    sources[0]!.fail(false);
    await vi.advanceTimersByTimeAsync(GRACE_MS / 2);
    sources[0]!.open();
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    expect(store.snapshot.world.players.size).toBe(1);
    expect(store.snapshot.connected).toBe(true);
  });

  it("an ended event (404) or a revoked token (401) is gone for good: cleared, reported, no more retries", async () => {
    for (const [status, gone] of [
      [404, "ended"],
      [401, "revoked"],
    ] as const) {
      const { store, sources, hello } = harness(async () => status);
      sources[0]!.open();
      hello(sources[0]!);
      sources[0]!.fail(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(sources[0]!.closed).toBe(true);
      expect(store.snapshot.gone).toBe(gone);
      expect(store.snapshot.world.players.size).toBe(0);
      await vi.advanceTimersByTimeAsync(RETRY_MAX_MS * 2);
      expect(sources).toHaveLength(1);
    }
  });

  it("any other refusal retries with backoff, reset by a successful open", async () => {
    const { store, sources, close } = harness(async () => null); // the server is unreachable
    sources[0]!.fail(true);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(sources).toHaveLength(2);
    sources[1]!.fail(true);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(sources).toHaveLength(2); // the second wait is doubled
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(sources).toHaveLength(3);
    sources[2]!.open();
    sources[2]!.fail(true);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(sources).toHaveLength(4); // back to the first delay
    expect(store.snapshot.gone).toBeNull();
    close();
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS * 2);
    expect(sources).toHaveLength(4);
    expect(sources[3]!.closed).toBe(true);
  });
});
