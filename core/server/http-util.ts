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

/** Emit one Server-Sent Event frame. */
export function sseSend(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
