//! Access-control regression tests for the event plane.
//!
//! These lock in the production-hardening pass: the mod/prime read feeds
//! are capability-gated, guests are bound to an opaque token (no acting as
//! another guest, no reading another guest's threads), and login endpoints
//! throttle online guessing. They drive `EventRuntime.handle` with fake
//! req/res, matching `server-mod.test.ts`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";
import { DEFAULT_RATE_LIMITS, RateLimiter, rateLimitsFromEnv } from "../server/rate-limit.ts";
import { makePass } from "../server/auth.ts";

const SCENARIO = scenarioSource("escape-the-internet");
const CODES = { event: "EVT111", prime: "PRM111", mod: "MOD111" };

const dirs: string[] = [];
function freshRuntime(): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-sec-"));
  dirs.push(d);
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "escape-the-internet",
    scenarioSource: SCENARIO,
    joinBase: () => "http://localhost",
  });
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface FakeRes {
  statusCode: number;
  body: string;
}
function fakeReq(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    socket: { remoteAddress: headers["x-test-ip"] ?? "1.2.3.4" },
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
    destroy() {},
  } as unknown as IncomingMessage;
}
function fakeRes(): ServerResponse & FakeRes {
  const res = {
    statusCode: 0,
    body: "",
    headersSent: false,
    setHeader() {},
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write() {
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res as unknown as ServerResponse & FakeRes;
}

async function post(rt: EventRuntime, path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body, headers), res, "POST", path, url, {});
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
async function get(rt: EventRuntime, path: string, opts: { moderator?: boolean } = {}) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq({}), res, "GET", url.pathname, url, opts);
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}

/** Open doors and register a guest; returns {id, token}. */
async function guest(rt: EventRuntime, name = "Alice") {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  return { id: r.json.id as string, token: r.json.token as string };
}

describe("mod/prime read feeds are capability-gated", () => {
  it("rejects an unauthenticated role=mod state read (no god view for anons)", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const r = await get(rt, "/api/state?role=mod");
    expect(r.status).toBe(403);
  });

  it("rejects an unauthenticated role=mod SSE subscription", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const r = await get(rt, "/events?role=mod");
    expect(r.status).toBe(403);
  });

  it("allows role=mod reads for the owning author (opts.moderator)", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const r = await get(rt, "/api/state?role=mod", { moderator: true });
    expect(r.status).toBe(200);
    expect(r.json.roster).toBeDefined();
  });

  it("allows role=mod reads with a real mod token", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const login = await post(rt, "/api/mod/login", { passcode: CODES.mod });
    const token = login.json.token as string;
    const r = await get(rt, `/api/state?role=mod&token=${token}`);
    expect(r.status).toBe(200);
  });

  it("rejects a role=prime read without a performer token", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    expect((await get(rt, "/api/state?role=prime")).status).toBe(403);
  });
});

describe("guests are bound to their token, not their public id", () => {
  it("register mints a token distinct from the public id", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    expect(g.token).toBeTruthy();
    expect(g.token).not.toBe(g.id);
  });

  it("a guest action with no token is rejected", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const g = await guest(rt);
    // Old-style call passing the id in the body, no token → 401.
    const r = await post(rt, "/api/guest/choose", { id: g.id, index: 0 });
    expect(r.status).toBe(401);
  });

  it("one guest cannot act as another by supplying their id", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const alice = await guest(rt, "Alice");
    const bob = await guest(rt, "Bob");
    // Bob's token, but Alice's id in the body: the server must act as Bob.
    const r = await post(rt, "/api/guest/say", { id: alice.id, channel: "lobby", text: "as alice?" }, { "x-loom-token": bob.token });
    expect(r.status).toBe(200);
    // The message is attributed to Bob (the token owner), never Alice.
    const hist = await get(rt, `/api/history?id=${bob.id}`, { moderator: true });
    const spoofed = (hist.json.messages as Array<{ from: string; text: string }>).find((m) => m.text === "as alice?");
    expect(spoofed).toBeDefined();
    expect(spoofed!.from).toBe("Bob");
  });

  it("a guest cannot read another guest's threads via ?id= (the IDOR)", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    const alice = await guest(rt, "Alice");
    const bob = await guest(rt, "Bob");
    // Bob asks for Alice's history with his own token → scoped to Bob.
    const res = fakeRes();
    const url = new URL(`http://x/api/history?id=${alice.id}&token=${bob.token}`);
    await rt.handle(fakeReq({}), res, "GET", url.pathname, url, {});
    expect(res.statusCode).toBe(200);
    // Every returned message is in Bob's audience, not Alice's private ones.
    // (Both share the lobby, so we assert no message is Alice-only.)
    const body = JSON.parse(res.body) as { messages: Array<{ audience: string | string[] }> };
    for (const m of body.messages) {
      if (Array.isArray(m.audience)) expect(m.audience).toContain(bob.id);
    }
  });

  it("an unauthenticated guest state read is rejected", async () => {
    const rt = freshRuntime();
    rt.openDoors();
    await guest(rt);
    expect((await get(rt, "/api/state?role=guest")).status).toBe(401);
  });

  it("a guest token survives a restart (recovery re-loads it)", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-sec-"));
    dirs.push(d);
    const mk = () =>
      new EventRuntime({
        eventId: "evt",
        store: new Store(d),
        codes: CODES,
        scenarioName: "escape-the-internet",
        scenarioSource: SCENARIO,
        joinBase: () => "http://localhost",
      });
    const rt1 = mk();
    rt1.openDoors();
    const g = await guest(rt1);
    rt1.pause();

    const rt2 = mk();
    expect(rt2.restore()).not.toBeNull();
    // The same token still authorizes a guest read after the restart.
    const res = fakeRes();
    const url = new URL(`http://x/api/state?role=guest&token=${g.token}`);
    await rt2.handle(fakeReq({}), res, "GET", url.pathname, url, {});
    expect(res.statusCode).toBe(200);
  });
});

describe("login endpoints throttle guessing", () => {
  it("locks out an IP after repeated wrong mod passcodes", async () => {
    const rt = freshRuntime();
    const ip = { "x-test-ip": "9.9.9.9" };
    let sawThrottle = false;
    for (let i = 0; i < 15; i++) {
      const r = await post(rt, "/api/mod/login", { passcode: "WRONG" + i }, ip);
      if (r.status === 429) {
        sawThrottle = true;
        break;
      }
      expect(r.status).toBe(403);
    }
    expect(sawThrottle).toBe(true);
    // Even the correct passcode is refused while throttled.
    expect((await post(rt, "/api/mod/login", { passcode: CODES.mod }, ip)).status).toBe(429);
  });

  it("a wrong guess on one IP does not throttle another", async () => {
    const rt = freshRuntime();
    for (let i = 0; i < 12; i++) await post(rt, "/api/mod/login", { passcode: "X" + i }, { "x-test-ip": "10.0.0.1" });
    // A different IP with the right code still succeeds.
    const r = await post(rt, "/api/mod/login", { passcode: CODES.mod }, { "x-test-ip": "10.0.0.2" });
    expect(r.status).toBe(200);
  });
});

describe("door-rush limits (LOOM_RL_*)", () => {
  it("parses <max> and <max>/<seconds>, keeping defaults for missing or malformed values", () => {
    expect(rateLimitsFromEnv({})).toEqual(DEFAULT_RATE_LIMITS);
    const l = rateLimitsFromEnv({
      LOOM_RL_REGISTER: "400",
      LOOM_RL_LOGIN_FAILURES: "60/300",
      LOOM_RL_RESOLVE: "nope",
      LOOM_RL_REDEEM_MISSES: "0",
    });
    expect(l.register).toEqual({ max: 400, windowMs: 60_000 });
    expect(l.loginFailures).toEqual({ max: 60, windowMs: 300_000 });
    expect(l.resolve).toEqual(DEFAULT_RATE_LIMITS.resolve);
    expect(l.redeemMisses).toEqual(DEFAULT_RATE_LIMITS.redeemMisses);
  });

  it("LOOM_RL_QR tunes the pass QR ceiling (default 60 a minute)", () => {
    expect(DEFAULT_RATE_LIMITS.qr).toEqual({ max: 60, windowMs: 60_000 });
    expect(rateLimitsFromEnv({ LOOM_RL_QR: "400" }).qr).toEqual({ max: 400, windowMs: 60_000 });
    expect(rateLimitsFromEnv({ LOOM_RL_QR: "600/120" }).qr).toEqual({ max: 600, windowMs: 120_000 });
  });

  async function registerMany(rt: EventRuntime, n: number): Promise<number[]> {
    rt.openDoors();
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      out.push((await post(rt, "/api/guest/register", { name: `Phone ${i}`, passcode: CODES.event }, { "x-test-ip": "203.0.113.7" })).status);
    }
    return out;
  }

  it("by default the 21st registration from one IP in a minute is refused", async () => {
    const statuses = await registerMany(freshRuntime(), 21);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("with the night's env, 40 registrations from one shared IP in a minute all pass", async () => {
    const prev = process.env.LOOM_RL_REGISTER;
    process.env.LOOM_RL_REGISTER = "400";
    try {
      const statuses = await registerMany(freshRuntime(), 40);
      expect(statuses.every((s) => s === 200)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.LOOM_RL_REGISTER;
      else process.env.LOOM_RL_REGISTER = prev;
    }
  });
});

describe("RateLimiter", () => {
  it("allows up to max within the window, then blocks", () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.take("k", 0)).toBe(true);
    expect(rl.take("k", 100)).toBe(true);
    expect(rl.take("k", 200)).toBe(true);
    expect(rl.take("k", 300)).toBe(false);
  });
  it("forgets hits older than the window", () => {
    const rl = new RateLimiter(2, 1000);
    rl.take("k", 0);
    rl.take("k", 500);
    expect(rl.take("k", 600)).toBe(false);
    expect(rl.take("k", 1600)).toBe(true); // the first two aged out
  });
  it("keys are independent", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.take("a", 0)).toBe(true);
    expect(rl.take("b", 0)).toBe(true);
    expect(rl.take("a", 0)).toBe(false);
  });
});

describe("makePass", () => {
  it("produces 6 chars from the unambiguous alphabet, well-distributed", () => {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const p = makePass();
      expect(p).toHaveLength(6);
      for (const ch of p) expect(alphabet).toContain(ch);
      seen.add(p);
    }
    // 500 draws from ~10^8 space: collisions would signal a broken generator.
    expect(seen.size).toBe(500);
  });
});
