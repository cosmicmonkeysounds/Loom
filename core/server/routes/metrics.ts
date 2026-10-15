/**
 * `GET /api/mod/metrics` — the server process's own load, for the K-32 load
 * test (`scripts/accept/k32-load.ts`) to record CPU while it drives ≈ 62
 * clients against the show VPS. Moderators only (it says nothing secret,
 * but nobody else needs it).
 *
 * `cpu` is the process's cumulative user + system time in microseconds and
 * `at` the wall clock in ms: a caller samples twice and divides, so the
 * figure covers exactly its own window. The server is one Node thread, so
 * the meaningful ceiling is **one core** (`cpu Δ / wall Δ`), not the box;
 * `loadavg` + `cpus` give the box view. `eventLoop` is the event-loop delay
 * since the previous read (p50/p99/max ms) — a full-snapshot fan-out that
 * blocks the loop shows up here before it shows up anywhere else.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { cpus, loadavg } from "node:os";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { sendJson } from "../http-util.ts";

export interface ServerMetrics {
  at: number;
  uptimeS: number;
  cpu: { userUs: number; systemUs: number };
  loadavg: [number, number, number];
  cpus: number;
  memory: { rssMb: number; heapUsedMb: number };
  eventLoop: { p50Ms: number; p99Ms: number; maxMs: number };
  clients: number;
}

// One process-wide histogram (every event runtime shares the one loop),
// started on the first read so an idle server pays nothing.
let loop: IntervalHistogram | null = null;

const mb = (n: number) => Math.round((n / 1048576) * 10) / 10;
const ms = (ns: number) => Math.round((Number.isFinite(ns) ? ns : 0) / 1e4) / 100;

/** A metrics sample; reading resets the event-loop window. */
export function sampleMetrics(clients: number): ServerMetrics {
  if (loop === null) {
    loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();
  }
  const cpu = process.cpuUsage();
  const mem = process.memoryUsage();
  const [a, b, c] = loadavg();
  const eventLoop = loop.count === 0
    ? { p50Ms: 0, p99Ms: 0, maxMs: 0 }
    : { p50Ms: ms(loop.percentile(50)), p99Ms: ms(loop.percentile(99)), maxMs: ms(loop.max) };
  loop.reset();
  return {
    at: Date.now(),
    uptimeS: Math.round(process.uptime()),
    cpu: { userUs: cpu.user, systemUs: cpu.system },
    loadavg: [a ?? 0, b ?? 0, c ?? 0],
    cpus: cpus().length,
    memory: { rssMb: mb(mem.rss), heapUsedMb: mb(mem.heapUsed) },
    eventLoop,
    clients,
  };
}

/**
 * Dispatch: true when this module answered. `isModerator` is evaluated only
 * for a matching path (it reads the caller's token).
 */
export function handleMetrics(
  _req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  isModerator: () => boolean,
  clients: () => number,
): boolean {
  if (method !== "GET" || path !== "/api/mod/metrics") return false;
  if (!isModerator()) {
    sendJson(res, 403, { error: "moderators only" });
    return true;
  }
  sendJson(res, 200, sampleMetrics(clients()));
  return true;
}
