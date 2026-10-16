import { describe, expect, it } from "vitest";
import { fetchArmed, postSignal, SIGNAL_RETRY_MS } from "../src/api.ts";
import { defaultConfig } from "../src/config.ts";

const config = defaultConfig({ eventId: "ev1", token: "mod-token", name: "Tent tablet" });

type Call = { url: string; init: RequestInit };

/** A fetch that answers from a script: a status, or "net" for a network failure. */
function fetcher(script: Array<number | "net" | { status: number; body: unknown }>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const step = script.shift() ?? 200;
    if (step === "net") throw new TypeError("Failed to fetch");
    const status = typeof step === "number" ? step : step.status;
    const body = typeof step === "number" ? {} : step.body;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

describe("postSignal", () => {
  it("retries a network failure and a 503 with backoff, then succeeds", async () => {
    const f = fetcher(["net", 503, 200]);
    const slept: number[] = [];
    const ok = await postSignal(config, "chess won", "g-1", { fetcher: f.fetch, sleep: async (ms) => void slept.push(ms) });
    expect(ok).toBe(true);
    expect(f.calls).toHaveLength(3);
    expect(slept).toEqual([SIGNAL_RETRY_MS[0], SIGNAL_RETRY_MS[1]]);
  });

  it("a 4xx is final (no retry); gives up after the attempts", async () => {
    const f = fetcher([401]);
    const slept: number[] = [];
    expect(await postSignal(config, "chess won", "g-1", { fetcher: f.fetch, sleep: async (ms) => void slept.push(ms) })).toBe(false);
    expect(f.calls).toHaveLength(1);
    expect(slept).toEqual([]);
    const down = fetcher(["net", "net", "net", "net", "net", "net", "net"]);
    const waits: number[] = [];
    expect(await postSignal(config, "chess won", "g-1", { fetcher: down.fetch, sleep: async (ms) => void waits.push(ms) })).toBe(false);
    expect(down.calls).toHaveLength(1 + SIGNAL_RETRY_MS.length);
    expect(waits).toEqual([...SIGNAL_RETRY_MS]);
    const two = fetcher(["net", "net", 200]);
    expect(await postSignal(config, "chess won", "g-1", { attempts: 2, fetcher: two.fetch, sleep: async () => {} })).toBe(false);
  });

  it("the body carries name, subject and the device label, to the event's mod signal route with the mod token", async () => {
    const f = fetcher([200]);
    await postSignal(config, "chess lost", "g-9", { fetcher: f.fetch });
    const call = f.calls[0]!;
    expect(call.url).toBe("/e/ev1/api/mod/signal");
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>)["x-loom-token"]).toBe("mod-token");
    expect(JSON.parse(call.init.body as string)).toEqual({ name: "chess lost", subject: "g-9", label: "Tent tablet" });
  });
});

describe("fetchArmed", () => {
  const world = (value: unknown) => ({ status: 200, body: { world: [{ path: "Night.phase", value: "hour" }, { path: "Night.step", value }] } });

  it("reads a world value ≥ min as armed, below as practice", async () => {
    expect(await fetchArmed(config, "Night.step", 14, fetcher([world(14)]).fetch)).toBe(true);
    expect(await fetchArmed(config, "Night.step", 14, fetcher([world(20)]).fetch)).toBe(true);
    expect(await fetchArmed(config, "Night.step", 14, fetcher([world(9)]).fetch)).toBe(false);
    expect(await fetchArmed(config, "Night.step", 14, fetcher([world("15")]).fetch)).toBe(true);
    const f = fetcher([world(1)]);
    await fetchArmed(config, "Night.step", 14, f.fetch);
    expect(f.calls[0]!.url).toBe("/e/ev1/api/state?role=mod");
    expect((f.calls[0]!.init.headers as Record<string, string>)["x-loom-token"]).toBe("mod-token");
  });

  it("is null when the var is absent, not a number, or the server is away", async () => {
    expect(await fetchArmed(config, "Night.nope", 1, fetcher([world(3)]).fetch)).toBeNull();
    expect(await fetchArmed(config, "Night.step", 1, fetcher([world("soon")]).fetch)).toBeNull();
    expect(await fetchArmed(config, "Night.step", 1, fetcher([{ status: 200, body: {} }]).fetch)).toBeNull();
    expect(await fetchArmed(config, "Night.step", 1, fetcher([409]).fetch)).toBeNull();
    expect(await fetchArmed(config, "Night.step", 1, fetcher(["net"]).fetch)).toBeNull();
  });
});
