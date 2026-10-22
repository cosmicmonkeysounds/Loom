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

/** Read a request body as raw bytes (a binary upload: the voice link's
 *  μ-law). Throws `PayloadTooLarge` (→ 413 at the router) past `limit`. A
 *  small overrun (up to 4 × `limit`) is drained first, so the client reads
 *  the 413 instead of a reset socket; only a bigger one is cut off. */
export async function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit * 4) {
      req.destroy();
      throw new PayloadTooLarge();
    }
    if (size <= limit) chunks.push(chunk as Buffer);
  }
  if (size > limit) throw new PayloadTooLarge();
  return chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks);
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
  /** Writes held back behind a big frame, handed to the socket one at a
   *  time (`pump`): never more than one slice in flight. */
  backlog: string[];
  /** Their bytes (part of `sseQueued`). */
  backlogBytes: number;
  /** A backlog write is in flight; the next waits for its callback. */
  pumping: boolean;
  /** Which backlog write is the one in flight. */
  ticket: number;
}
const queues = new WeakMap<ServerResponse, SseQueue>();

function queueOf(res: ServerResponse): SseQueue {
  let q = queues.get(res);
  if (q === undefined) {
    const fresh: SseQueue = { cap: SSE_QUEUE_CAP, lastLen: 0, progressAt: Date.now(), backlog: [], backlogBytes: 0, pumping: false, ticket: 0 };
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
    q.backlog = [];
    q.backlogBytes = 0;
    res.destroy();
    return false;
  }
  put(res, q, chunk);
  q.lastLen = sseQueued(res);
  return true;
}

/** Bytes an SSE stream holds unsent: what Node buffers for a slow peer,
 *  plus what waits behind a big frame. */
export function sseQueued(res: ServerResponse): number {
  const node = typeof res.writableLength === "number" ? res.writableLength : 0;
  return node + (queues.get(res)?.backlogBytes ?? 0);
}

/** Emit one Server-Sent Event frame (two writes: the `event:` line, then
 *  its `data:` — never one without the other). */
export function sseSend(res: ServerResponse, event: string, data: unknown): void {
  sseFrame(res, `event: ${event}\n`, `data: ${JSON.stringify(data)}\n\n`);
}

/** A frame's `data:` longer than this goes out in slices of at most this
 *  many characters, one at a time (R1-diff-server-01). Node counts a write
 *  in `writableLength` in full until every byte has reached the kernel, and
 *  coalesces whatever is buffered behind an in-flight write into one
 *  `writev` — so a multi-MB director history, written whole or in slices
 *  back to back, never shows a slow reader making progress, and the stall
 *  check drops a console that is still reading. Paced, each slice that
 *  lands shrinks the queue and counts as progress. */
export const SSE_SLICE = 64 * 1024;

/** One frame, already serialised (a mod snapshot built once for everyone).
 *  A large `data:` is paced out in `SSE_SLICE` pieces (never splitting a
 *  surrogate pair); anything written meanwhile waits behind it, so frames
 *  stay whole and in order. */
export function sseFrame(res: ServerResponse, head: string, data: string): void {
  if (!sseWrite(res, head)) return;
  const q = queueOf(res);
  if (data.length <= SSE_SLICE) put(res, q, data);
  else {
    for (let at = 0; at < data.length; ) {
      let end = Math.min(data.length, at + SSE_SLICE);
      // Never end a slice on a high surrogate: each slice is encoded alone.
      if (end < data.length && isHighSurrogate(data.charCodeAt(end - 1))) end -= 1;
      hold(q, data.slice(at, end));
      at = end;
    }
    pump(res, q);
  }
  q.lastLen = sseQueued(res);
}

/** Write now, or behind a big frame still being paced out. */
function put(res: ServerResponse, q: SseQueue, chunk: string): void {
  if (q.backlog.length === 0 && !q.pumping) res.write(chunk);
  else {
    hold(q, chunk);
    pump(res, q);
  }
}

function hold(q: SseQueue, chunk: string): void {
  q.backlog.push(chunk);
  q.backlogBytes += Buffer.byteLength(chunk);
}

/** Hand the backlog to the socket: while a write returns true (the socket
 *  isn't backed up) the next follows at once; otherwise the next waits for
 *  that write's callback — the moment its bytes reached the kernel, which
 *  is the reader's progress. */
function pump(res: ServerResponse, q: SseQueue): void {
  while (!q.pumping && q.backlog.length > 0) {
    if (res.destroyed || res.writableEnded) {
      q.backlog = [];
      q.backlogBytes = 0;
      return;
    }
    const chunk = q.backlog.shift()!;
    q.backlogBytes -= Buffer.byteLength(chunk);
    const ticket = ++q.ticket;
    q.pumping = true;
    let sync = true;
    const ok = res.write(chunk, () => {
      q.progressAt = Date.now();
      if (q.ticket !== ticket || !q.pumping) return; // a later write took over
      q.pumping = false;
      if (!sync) pump(res, q);
    });
    sync = false;
    if (ok !== false) q.pumping = false; // not backed up: carry on now
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
