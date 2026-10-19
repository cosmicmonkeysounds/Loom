import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { ChallengerError, PENDING_KEY, PENDING_MAX_AGE_MS, RETRY_MS, chessLabel, fetchChallenger, flushPendingChess, postChess, readPending } from "../src/chess/post.ts";

const config = defaultConfig({ eventId: "evt", token: "MODTOK", name: "Server Door", view: "chess" });

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage;
}

type Call = { url: string; init?: RequestInit };
function fetcher(statuses: Array<number | "throw">, calls: Call[] = [], json: unknown = {}): typeof fetch {
  let i = 0;
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const st = statuses[Math.min(i++, statuses.length - 1)]!;
    if (st === "throw") throw new TypeError("network");
    return { status: st, ok: st >= 200 && st < 300, json: async () => json } as Response;
  }) as unknown as typeof fetch;
}

describe("postChess (C4)", () => {
  it("posts the result as the terminal, subject = the guest, with the mod token", async () => {
    const calls: Call[] = [];
    const storage = memory();
    const ok = await postChess(config, "won", "g-aaaaaa", { fetcher: fetcher([200], calls), storage, sleep: async () => {} });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/e/evt/api/mod/signal");
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ name: "chess won", subject: "g-aaaaaa", label: "Terminal · Server Door" });
    expect((calls[0]!.init!.headers as Record<string, string>)["x-loom-token"]).toBe("MODTOK");
    expect(storage.getItem(PENDING_KEY)).toBeNull();
    expect(chessLabel({ name: "x".repeat(80) })).toHaveLength(60);
  });

  it("retries a network failure or a 5xx on the backoff; a 4xx is final", async () => {
    const slept: number[] = [];
    const sleep = async (ms: number) => void slept.push(ms);
    expect(await postChess(config, "lost", "g-a", { fetcher: fetcher(["throw", 502, 200]), storage: null, sleep, now: () => 0 })).toBe(true);
    expect(slept).toEqual([RETRY_MS[0], RETRY_MS[1]]);
    const calls: Call[] = [];
    expect(await postChess(config, "drawn", "g-a", { fetcher: fetcher([409], calls), storage: null, sleep, now: () => 0 })).toBe(false);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]!.init!.body)).name).toBe("chess drawn");
  });

  it("keeps the result in storage while in flight, and never sends one older than 60 s", async () => {
    const storage = memory();
    let t = 1_000;
    let seenWhileSending: unknown = null;
    const f = (async () => {
      seenWhileSending = readPending(storage);
      t += PENDING_MAX_AGE_MS; // the uplink hung for a minute
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    expect(await postChess(config, "won", "g-b", { fetcher: f, storage, sleep: async () => {}, now: () => t })).toBe(false);
    expect(seenWhileSending).toMatchObject({ eventId: "evt", name: "chess won", subject: "g-b", label: "Terminal · Server Door", at: 1_000 });
    // Failed for good: forgotten (the board says to get a host instead).
    expect(storage.getItem(PENDING_KEY)).toBeNull();
  });
});

describe("flushPendingChess", () => {
  const stored = (over: object = {}) => JSON.stringify({ eventId: "evt", name: "chess won", subject: "g-c", label: "Terminal · Server Door", at: 10_000, ...over });

  it("posts a fresh result a previous page left, once", async () => {
    const storage = memory();
    storage.setItem(PENDING_KEY, stored());
    const calls: Call[] = [];
    expect(await flushPendingChess(config, { storage, fetcher: fetcher([200], calls), now: () => 10_000 + PENDING_MAX_AGE_MS - 1, sleep: async () => {} })).toBe("sent");
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ name: "chess won", subject: "g-c", label: "Terminal · Server Door" });
    expect(storage.getItem(PENDING_KEY)).toBeNull();
    expect(await flushPendingChess(config, { storage, fetcher: fetcher([200], calls) })).toBe("none");
    expect(calls).toHaveLength(1);
  });

  it("drops a stale one, another event's, or junk — unsent", async () => {
    const calls: Call[] = [];
    for (const [raw, now] of [
      [stored(), 10_000 + PENDING_MAX_AGE_MS],
      [stored({ eventId: "other" }), 10_001],
      [stored({ name: "king hit" }), 10_001],
      ["{nope", 10_001],
    ] as const) {
      const storage = memory();
      storage.setItem(PENDING_KEY, raw);
      const r = await flushPendingChess(config, { storage, fetcher: fetcher([200], calls), now: () => now });
      expect(["dropped", "none"]).toContain(r);
      expect(storage.getItem(PENDING_KEY)).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });

  it("a failure stays stored until it ages out", async () => {
    const storage = memory();
    storage.setItem(PENDING_KEY, stored());
    expect(await flushPendingChess(config, { storage, fetcher: fetcher(["throw"]), now: () => 10_001, sleep: async () => {}, attempts: 2 })).toBe("failed");
    expect(readPending(storage)).not.toBeNull();
  });
});

describe("fetchChallenger", () => {
  it("reads the guest's own view through the moderator lens", async () => {
    const calls: Call[] = [];
    const g = await fetchChallenger(config, "g-aaaaaa", { fetcher: fetcher([200], calls, { id: "g-aaaaaa", name: "Ada", restricted: true, channels: [] }) });
    expect(g).toEqual({ id: "g-aaaaaa", name: "Ada", restricted: true });
    expect(calls[0]!.url).toBe("/e/evt/api/state?role=guest&as=g-aaaaaa");
    expect((calls[0]!.init!.headers as Record<string, string>)["x-loom-token"]).toBe("MODTOK");
    expect(await fetchChallenger(config, "g-b", { fetcher: fetcher([200], [], { name: "Bea" }) })).toEqual({ id: "g-b", name: "Bea", restricted: false });
  });

  it("names why a pass can't play", async () => {
    const kind = async (st: number | "throw") => fetchChallenger(config, "g-x", { fetcher: fetcher([st]) }).then(
      () => null,
      (e: ChallengerError) => e.kind,
    );
    expect(await kind(404)).toBe("unknown");
    expect(await kind(403)).toBe("access");
    expect(await kind(409)).toBe("closed");
    expect(await kind(500)).toBe("other");
    expect(await kind("throw")).toBe("other");
  });
});
