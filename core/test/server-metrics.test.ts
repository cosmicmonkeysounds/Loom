// K-32: `GET /api/mod/metrics` — the process load the load test records.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { sampleMetrics, type ServerMetrics } from "../server/routes/metrics.ts";
import { scenarioSource } from "../examples/load.ts";

const SCENARIO = scenarioSource("escape-the-internet");
const CODES = { event: "EVT111", prime: "PRM111", mod: "MOD111" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function runtime(): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-metrics-"));
  dirs.push(d);
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "escape-the-internet", scenarioSource: SCENARIO, joinBase: () => "http://localhost" });
}
function fakeReq(body: unknown, token?: string): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: token ? { "x-loom-token": token } : {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
}
function fakeRes(): ServerResponse & { statusCode: number; body: string } {
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write() {
      return true;
    },
    end(b?: string) {
      if (b !== undefined) res.body = String(b);
      return res;
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string };
}
async function call(rt: EventRuntime, method: string, path: string, body: unknown, opts: { token?: string; moderator?: boolean } = {}) {
  const res = fakeRes();
  await rt.handle(fakeReq(body, opts.token), res, method, path, new URL(`http://x${path}`), { moderator: opts.moderator });
  return res;
}

describe("/api/mod/metrics", () => {
  it("is moderator-gated (mod token or author session)", async () => {
    const rt = runtime();
    expect((await call(rt, "GET", "/api/mod/metrics", {})).statusCode).toBe(403);
    const login = await call(rt, "POST", "/api/mod/login", { passcode: "MOD111" });
    const token = (JSON.parse(login.body) as { token: string }).token;
    const viaToken = await call(rt, "GET", "/api/mod/metrics", {}, { token });
    expect(viaToken.statusCode).toBe(200);
    expect((await call(rt, "GET", "/api/mod/metrics", {}, { moderator: true })).statusCode).toBe(200);
    // Only GET: a POST to the same path is not this route.
    expect((await call(rt, "POST", "/api/mod/metrics", {}, { moderator: true })).statusCode).not.toBe(200);
  });

  it("reports cumulative CPU, memory, load and an event-loop window", async () => {
    const rt = runtime();
    const a = JSON.parse((await call(rt, "GET", "/api/mod/metrics", {}, { moderator: true })).body) as ServerMetrics;
    let x = 0;
    for (let i = 0; i < 2e6; i++) x += i % 7; // burn a little CPU
    expect(x).toBeGreaterThan(0);
    const b = JSON.parse((await call(rt, "GET", "/api/mod/metrics", {}, { moderator: true })).body) as ServerMetrics;
    expect(b.cpu.userUs + b.cpu.systemUs).toBeGreaterThan(a.cpu.userUs + a.cpu.systemUs);
    expect(b.at).toBeGreaterThanOrEqual(a.at);
    expect(b.cpus).toBeGreaterThan(0);
    expect(b.loadavg).toHaveLength(3);
    expect(b.memory.rssMb).toBeGreaterThan(0);
    expect(b.clients).toBe(0);
    for (const k of ["p50Ms", "p99Ms", "maxMs"] as const) expect(b.eventLoop[k]).toBeGreaterThanOrEqual(0);
  });

  it("counts connected stream clients", () => {
    expect(sampleMetrics(7).clients).toBe(7);
  });
});
