import { describe, expect, it } from "vitest";
import { fetchArmed, flushPendingSignal, PENDING_SIGNAL_KEY, PENDING_SIGNAL_MAX_AGE_MS, postSignal, readPendingSignal, SIGNAL_ATTEMPT_TIMEOUT_MS, SIGNAL_RETRY_MS, type SignalStorage } from "../src/api.ts";
import { WIN_CODE, WIN_NOT_SENT, WIN_PRACTICE, stakesLine, winNotice } from "../src/game/fight.ts";
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

/** An in-memory localStorage. */
function memory(): SignalStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe("the pending signal (a reload doesn't lose a win)", () => {
  const nop = async () => {};

  it("is stored before the first try, then forgotten once every attempt has failed (a host is told)", async () => {
    const st = memory();
    let seen: string | undefined;
    const f = (async () => {
      seen = st.map.get(PENDING_SIGNAL_KEY);
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await postSignal(config, "chess won", "g-1", { fetcher: f, sleep: nop, storage: st, now: () => 1000 })).toBe(false);
    expect(JSON.parse(seen!)).toEqual({ eventId: "ev1", name: "chess won", subject: "g-1", label: "Tent tablet", at: 1000 });
    expect(readPendingSignal(st)).toBeNull();
  });

  it("a win that failed for good is never posted by the next load (B20)", async () => {
    const st = memory();
    expect(await postSignal(config, "chess won", "g-1", { fetcher: fetcher(["net", "net", 503]).fetch, attempts: 3, sleep: nop, storage: st, now: () => 1000 })).toBe(false);
    const later = fetcher([200]);
    expect(await flushPendingSignal(config, { fetcher: later.fetch, storage: st, now: () => 21_000 })).toBe("none");
    expect(later.calls).toHaveLength(0);
  });

  it("a send still in flight survives a reload (the page died mid-retry)", async () => {
    const st = memory();
    let flushed: Promise<string> | null = null;
    const dying = (async () => {
      // The page reloads while the first attempt hangs: the new page flushes.
      flushed ??= flushPendingSignal(config, { fetcher: fetcher([200]).fetch, storage: st, now: () => 2000 });
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    void postSignal(config, "chess won", "g-1", { fetcher: dying, attempts: 1, sleep: nop, storage: st, now: () => 1000 });
    expect(await flushed).toBe("sent");
  });

  it("is cleared on a 200 and on a 4xx", async () => {
    const ok = memory();
    expect(await postSignal(config, "chess won", "g-1", { fetcher: fetcher(["net", 200]).fetch, sleep: nop, storage: ok })).toBe(true);
    expect(ok.map.size).toBe(0);
    const refused = memory();
    expect(await postSignal(config, "chess won", "g-1", { fetcher: fetcher([409]).fetch, sleep: nop, storage: refused })).toBe(false);
    expect(refused.map.size).toBe(0);
  });

  it("keeps the latest only: an older post landing late leaves a newer pending one alone", async () => {
    const st = memory();
    st.setItem(PENDING_SIGNAL_KEY, JSON.stringify({ eventId: "ev1", name: "chess won", subject: "g-2", label: "Tent tablet", at: 5000 }));
    // An older attempt (at 1000) whose 200 arrives after the newer one was stored.
    const late = (async () => {
      st.setItem(PENDING_SIGNAL_KEY, JSON.stringify({ eventId: "ev1", name: "chess won", subject: "g-2", label: "Tent tablet", at: 5000 }));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await postSignal(config, "chess lost", "g-1", { fetcher: late, storage: st, now: () => 1000 })).toBe(true);
    expect(readPendingSignal(st)?.subject).toBe("g-2");
  });

  it("a fresh one is flushed once on load, with its original label, then forgotten", async () => {
    const st = memory();
    st.setItem(PENDING_SIGNAL_KEY, JSON.stringify({ eventId: "ev1", name: "chess won", subject: "g-1", label: "Tent tablet", at: 10_000 }));
    const f = fetcher([200]);
    expect(await flushPendingSignal(config, { fetcher: f.fetch, sleep: nop, storage: st, now: () => 10_000 + 59_000 })).toBe("sent");
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe("/e/ev1/api/mod/signal");
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({ name: "chess won", subject: "g-1", label: "Tent tablet" });
    expect(st.map.size).toBe(0);
    const again = fetcher([200]);
    expect(await flushPendingSignal(config, { fetcher: again.fetch, storage: st })).toBe("none");
    expect(again.calls).toHaveLength(0);
  });

  it("a stale one (≥ 60 s), one from another event, or one from the future is dropped unsent", async () => {
    for (const [entry, now] of [
      [{ eventId: "ev1", at: 0 }, PENDING_SIGNAL_MAX_AGE_MS],
      [{ eventId: "ev1", at: 0 }, 10 * 60_000],
      [{ eventId: "other", at: 0 }, 1000],
      [{ eventId: "ev1", at: 5000 }, 1000],
    ] as const) {
      const st = memory();
      st.setItem(PENDING_SIGNAL_KEY, JSON.stringify({ name: "chess won", subject: "g-1", label: "Tent tablet", ...entry }));
      const f = fetcher([200]);
      expect(await flushPendingSignal(config, { fetcher: f.fetch, storage: st, now: () => now })).toBe("dropped");
      expect(f.calls).toHaveLength(0);
      expect(st.map.size).toBe(0);
    }
  });

  it("never posts past the 60 s cap, even mid-retry", async () => {
    const st = memory();
    st.setItem(PENDING_SIGNAL_KEY, JSON.stringify({ eventId: "ev1", name: "chess won", subject: "g-1", label: "Tent tablet", at: 0 }));
    let t = 58_000;
    const f = fetcher(["net", "net", 200]);
    const r = await flushPendingSignal(config, { fetcher: f.fetch, storage: st, now: () => t, sleep: async (ms) => void (t += ms * 2) });
    expect(r).toBe("failed");
    expect(f.calls).toHaveLength(2); // 58 s, 59 s; the third try would be at 61 s
    // Kept (unsent) — the next load drops it as stale.
    expect(await flushPendingSignal(config, { fetcher: fetcher([200]).fetch, storage: st, now: () => 61_000 })).toBe("dropped");
  });

  it("a stalled attempt is aborted (never hangs past the cap) and counts as a network failure", async () => {
    const calls: Array<number> = [];
    // A black-holed uplink: the request never answers until it is aborted.
    const stall = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        calls.push(Date.now());
        init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const started = Date.now();
    const ok = await postSignal(config, "chess won", "g-1", { fetcher: stall, storage: null, attempts: 3, timeoutMs: 20, sleep: async () => {} });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(3);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(SIGNAL_ATTEMPT_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
    // …and an attempt never outlives the 60 s cap: 59.99 s old → aborted at the cap, not 5 s later.
    let aborted = false;
    const late = ((_u: string, init?: RequestInit) =>
      new Promise<Response>((_r, rej) => init?.signal?.addEventListener("abort", () => ((aborted = true), rej(new Error("abort")))))) as unknown as typeof fetch;
    const st = memory();
    st.setItem(PENDING_SIGNAL_KEY, JSON.stringify({ eventId: "ev1", name: "chess won", subject: "g-1", label: "Tent tablet", at: 0 }));
    const t0 = Date.now();
    const now = () => Date.now() - t0 + PENDING_SIGNAL_MAX_AGE_MS - 30;
    expect(await flushPendingSignal(config, { fetcher: late, storage: st, attempts: 1, now })).toBe("failed");
    expect(aborted).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("a win that never landed puts WIN_NOT_SENT on the HUD; a landed one (or no signal hook) says nothing", async () => {
    expect(await winNotice(postSignal(config, "chess won", "g-1", { fetcher: fetcher(["net", "net"]).fetch, storage: null, attempts: 2, sleep: async () => {} }))).toBe(WIN_NOT_SENT);
    expect(await winNotice(postSignal(config, "chess won", "g-1", { fetcher: fetcher([200]).fetch, storage: null }))).toBeNull();
    expect(await winNotice(undefined)).toBeNull();
  });

  it("from the Y2K hour a landed win says the door code is in the Codex; before, it is practice — never a real door opening (wave 7)", async () => {
    const lost = () => postSignal(config, "chess won", "g-1", { fetcher: fetcher(["net"]).fetch, storage: null, attempts: 1, sleep: async () => {} });
    const landed = () => postSignal(config, "chess won", "g-1", { fetcher: fetcher([200]).fetch, storage: null });
    expect(await winNotice(landed(), true)).toBe(WIN_CODE);
    expect(await winNotice(landed(), false)).toBe(WIN_PRACTICE);
    expect(await winNotice(landed(), null)).toBeNull(); // unknown whether it counted: claim nothing
    // A counted (or maybe-counted) win that never landed sends the guest to a host…
    expect(await winNotice(lost(), true)).toBe(WIN_NOT_SENT);
    expect(await winNotice(lost(), null)).toBe(WIN_NOT_SENT);
    // …but a practice one wins nothing a host could hand over.
    expect(await winNotice(lost(), false)).toBeNull();
    expect(await winNotice(undefined, true)).toBeNull(); // no signal hook: nothing landed, nothing to claim
    expect(WIN_CODE).toContain("Codex");
    expect(stakesLine(true)).toContain("door code");
    expect(stakesLine(false)).toMatch(/^Practice/u);
    expect(stakesLine(null)).toBeNull();
    for (const line of [WIN_CODE, WIN_PRACTICE, WIN_NOT_SENT, stakesLine(true)!, stakesLine(false)!]) {
      expect(line).not.toMatch(/door (opens|is open)|disarm|unlock/iu);
    }
  });

  it("a refused flush is forgotten; a failed one stays for the next load", async () => {
    const st = memory();
    const entry = JSON.stringify({ eventId: "ev1", name: "chess won", subject: "g-1", label: "Tent tablet", at: 0 });
    st.setItem(PENDING_SIGNAL_KEY, entry);
    expect(await flushPendingSignal(config, { fetcher: fetcher([403]).fetch, storage: st, now: () => 1000 })).toBe("refused");
    expect(st.map.size).toBe(0);
    st.setItem(PENDING_SIGNAL_KEY, entry);
    expect(await flushPendingSignal(config, { attempts: 1, fetcher: fetcher([503]).fetch, storage: st, now: () => 1000 })).toBe("failed");
    expect(st.map.size).toBe(1);
  });

  it("works with no storage, a throwing one, or junk stored", async () => {
    expect(await postSignal(config, "chess won", "g-1", { fetcher: fetcher([200]).fetch, storage: null })).toBe(true);
    expect(await flushPendingSignal(config, { storage: null })).toBe("none");
    const boom: SignalStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(await postSignal(config, "chess won", "g-1", { fetcher: fetcher([200]).fetch, storage: boom })).toBe(true);
    expect(await postSignal(config, "chess won", "g-1", { attempts: 1, fetcher: fetcher(["net"]).fetch, storage: boom })).toBe(false);
    expect(await flushPendingSignal(config, { storage: boom })).toBe("none");
    const junk = memory();
    junk.setItem(PENDING_SIGNAL_KEY, "{not json");
    expect(await flushPendingSignal(config, { storage: junk })).toBe("none");
    expect(junk.map.size).toBe(0);
    junk.setItem(PENDING_SIGNAL_KEY, JSON.stringify({ name: "chess won" }));
    expect(readPendingSignal(junk)).toBeNull();
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
