// A fake event server for showctl's tests: a route table answered through
// the `FetchLike` the client takes, recording every request (method, path,
// headers, body) so a test can assert what was — and was never — asked.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchLike } from "../lib/client.ts";

export interface Seen {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

export type Handler = (req: Seen) => { status: number; body: unknown } | undefined;

export const MOD = "MODCODE1";
export const SERVER = "https://show.example";

/** A fake fetch over `routes` (`"GET /api/health"` → handler or a fixed answer). */
export function fakeServer(routes: Record<string, Handler | { status: number; body: unknown }>): { fetch: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const req: Seen = { method: init?.method ?? "GET", path: u.pathname + u.search, headers: init?.headers ?? {}, body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null };
    seen.push(req);
    const exact = routes[`${req.method} ${req.path}`] ?? routes[`${req.method} ${u.pathname}`];
    const answer = typeof exact === "function" ? exact(req) : exact;
    const a = answer ?? { status: 404, body: { error: "not found" } };
    const text = typeof a.body === "string" ? a.body : JSON.stringify(a.body);
    return { status: a.status, headers: { get: () => null }, text: async () => text };
  };
  return { fetch, seen };
}

/** The resolve + login pair every authenticated test needs. */
export function authRoutes(eventId = "ev1"): Record<string, Handler> {
  let n = 0;
  return {
    "POST /api/resolve-code": (r) => (r.body?.["code"] === MOD ? { status: 200, body: { eventId, role: "mod", title: "Test Show", theme: "plain" } } : { status: 404, body: { error: "no event with that code" } }),
    [`POST /e/${eventId}/api/mod/login`]: (r) => (r.body?.["passcode"] === MOD ? { status: 200, body: { token: r.headers["x-loom-token"] ?? `tok-${++n}`, character: null } } : { status: 403, body: { error: "bad passcode" } }),
  };
}

/** A fresh cache file path in a temp dir. */
export function tempCache(): string {
  return join(mkdtempSync(join(tmpdir(), "showctl-")), "sessions.json");
}
