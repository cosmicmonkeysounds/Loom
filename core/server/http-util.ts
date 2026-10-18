//! Tiny request/response helpers shared by the top-level router and every
//! per-event `EventRuntime`. Kept dependency-free (just `node:http`) so the
//! same JSON / SSE / body-parsing conventions apply everywhere and neither
//! the router nor a runtime has to reimplement them.
//!
//! CORS + security headers are NOT set here — the top-level router stamps
//! them once per request (trusted-origin reflection, nosniff, …) before
//! dispatching, so every response inherits them via `setHeader`.

import type { IncomingMessage, ServerResponse } from "node:http";

/** Write a JSON body. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(json);
}

/** Thrown by `readBody` when a request exceeds the size cap → HTTP 413. */
export class PayloadTooLarge extends Error {
  constructor() {
    super("request body too large");
  }
}

/** Upper bound on any JSON request body. Generous for `.loom` sources
 *  (`/api/mod/load`, project file saves) while stopping unbounded buffering. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** The longest typed chat line a guest or a booth may post (a director's
 *  `/api/mod/say` is deliberate and keeps none).
 *  Longer is refused (413), not cut, so the composer keeps it to shorten:
 *  every line is journaled, fanned out live and replayed in each reconnect
 *  history, so one 4 MB line would otherwise ride every phone all night.
 *  An agent's reply is cut to the same length. */
export const CHAT_TEXT_MAX = 2000;

/** Answer 413 when a chat line is over `CHAT_TEXT_MAX`; true when refused. */
export function chatTooLong(res: ServerResponse, text: string): boolean {
  if (text.length <= CHAT_TEXT_MAX) return false;
  sendJson(res, 413, { error: `message too long (max ${CHAT_TEXT_MAX} characters)` });
  return true;
}

/** Read + JSON-parse a request body, tolerating an empty or malformed one.
 *  Throws `PayloadTooLarge` (→ 413 at the router) past `limit` bytes. */
export async function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      req.destroy();
      throw new PayloadTooLarge();
    }
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Read a string field from a parsed body (`""` when absent / non-string). */
export function str(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v : "";
}

/** The caller's session token, from the header or the body (`""` → undefined). */
export function tokenOf(req: IncomingMessage, body: Record<string, unknown>): string | undefined {
  return (req.headers["x-loom-token"] as string | undefined) || str(body, "token") || undefined;
}

/**
 * The caller's session token for GET routes: header first, then the `token`
 * query param — `EventSource` can't set headers, so SSE subscribers pass
 * their capability token in the URL.
 */
export function queryTokenOf(req: IncomingMessage, url: URL): string | undefined {
  return (req.headers["x-loom-token"] as string | undefined) || url.searchParams.get("token") || undefined;
}

/**
 * Best-effort client address for rate-limit keying. Behind a TLS-terminating
 * reverse proxy every socket is the proxy's, so set `LOOM_TRUST_PROXY=1`
 * (only when a proxy you control is the sole route in!) to key on the
 * leftmost `x-forwarded-for` hop instead.
 */
export function ipOf(req: IncomingMessage): string {
  if (process.env.LOOM_TRUST_PROXY === "1") {
    const fwd = req.headers["x-forwarded-for"];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress ?? "local";
}

/** How much an SSE stream may hold unsent before a stalled client is dropped
 *  (W8 T9-01): a guest / booth / agent / spatial / collab stream… */
export const SSE_QUEUE_CAP = 256 * 1024;
/** …and a full director console (every frame + ≈200 KB views). */
export const SSE_MOD_QUEUE_CAP = 2 * 1024 * 1024;
/** Over its cap, a stream is dropped only once its queue has made no
 *  progress for this long: a client still reading (a director over a slow
 *  link, however far behind) is kept; one that stopped reading never
 *  sends a byte out again. */
export const SSE_STALL_MS = 15_000;

interface SseQueue {
  cap: number;
  /** The queue's length just after the last write. */
  lastLen: number;
  /** When the queue last shrank (bytes left for the client), server ms. */
  progressAt: number;
}
const queues = new WeakMap<ServerResponse, SseQueue>();

function queueOf(res: ServerResponse): SseQueue {
  let q = queues.get(res);
  if (q === undefined) {
    const fresh: SseQueue = { cap: SSE_QUEUE_CAP, lastLen: 0, progressAt: Date.now() };
    q = fresh;
    queues.set(res, fresh);
    // `drain` fires once a backed-up queue has flushed.
    if (typeof res.on === "function")
      res.on("drain", () => {
        fresh.lastLen = 0;
        fresh.progressAt = Date.now();
      });
  }
  return q;
}

/** Give one SSE stream a different queue cap (a full mod console's). */
export function sseCap(res: ServerResponse, cap: number): void {
  queueOf(res).cap = cap;
}

/**
 * Write one chunk to an SSE stream — unless the client has stopped reading.
 * A suspended phone or a sleeping laptop keeps its socket up (a zero-window
 * peer still ACKs, so `close` never fires) while Node queues every frame in
 * userland: one stalled director console queued 139 MB in 3 min. Past its
 * cap, with nothing sent out for `SSE_STALL_MS` (the queue never shorter
 * than just after the previous write), the stream is destroyed: the
 * request's `close` handler drops the client, and its EventSource
 * reconnects to a fresh snapshot + history. A slow reader that is still
 * taking bytes is kept. False when nothing was written.
 */
export function sseWrite(res: ServerResponse, chunk: string): boolean {
  if (res.destroyed || res.writableEnded) return false;
  const q = queueOf(res);
  const queued = sseQueued(res);
  const now = Date.now();
  if (queued === 0 || queued < q.lastLen) q.progressAt = now;
  else if (queued > q.cap && now - q.progressAt > SSE_STALL_MS) {
    res.destroy();
    return false;
  }
  res.write(chunk);
  q.lastLen = sseQueued(res);
  return true;
}

/** Bytes an SSE stream holds unsent (what Node buffers for a slow peer). */
export function sseQueued(res: ServerResponse): number {
  return typeof res.writableLength === "number" ? res.writableLength : 0;
}

/** Emit one Server-Sent Event frame (two writes: the `event:` line, then
 *  its `data:` — never one without the other). */
export function sseSend(res: ServerResponse, event: string, data: unknown): void {
  sseFrame(res, `event: ${event}\n`, `data: ${JSON.stringify(data)}\n\n`);
}

/** One frame, already serialised (a mod snapshot built once for everyone). */
export function sseFrame(res: ServerResponse, head: string, data: string): void {
  if (sseWrite(res, head)) res.write(data);
}
