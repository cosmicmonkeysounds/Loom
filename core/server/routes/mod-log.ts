/**
 * `GET /api/mod/log?after=<seq>&limit=<n>` — the run's whole ledger, paged
 * (T7-03). The mod SSE stream's `sim` frames only carry what happened while
 * a console was attached, so a director who reloads, or joins late, holds
 * a partial log; Run → Log's ⤓ Export pages through this instead.
 *
 * A seq is a ledger index (`sim.log`, 0-based — the same numbering
 * `ModView.ledgerLen` counts). The answer is `{entries, next, total}`:
 * `entries` are the ledger's own entries (exactly what a `sim` frame
 * carries), those with seq > `after` (all from 0 when `after` is absent or
 * -1), at most `limit` (default `MOD_LOG_LIMIT`, capped at `MOD_LOG_MAX`);
 * `next` is the seq to pass as `after` for the next page, or null once
 * the page reached the end; `total` is the ledger's length. No sim (doors
 * never opened, or the event ended) is an empty ledger. Moderators only.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SimEvent } from "../../src/runtime/sim/index.ts";
import { sendJson } from "../http-util.ts";

export const MOD_LOG_ROUTE = "/api/mod/log";
export const MOD_LOG_LIMIT = 1000;
export const MOD_LOG_MAX = 5000;

export interface ModLogPage {
  entries: SimEvent[];
  next: number | null;
  total: number;
}

/** One page of `log` after `after` (pure). */
export function modLogPage(log: readonly SimEvent[], after: number, limit: number): ModLogPage {
  const from = Math.max(0, after + 1);
  const entries = log.slice(from, from + limit);
  const end = from + entries.length;
  return { entries, next: end < log.length ? end - 1 : null, total: log.length };
}

/** `?after=` / `?limit=` → numbers: junk is the default, `limit` is clamped. */
export function modLogQuery(url: URL): { after: number; limit: number } {
  const int = (k: string): number | null => {
    const raw = url.searchParams.get(k);
    return raw !== null && /^-?\d+$/u.test(raw) ? Number(raw) : null;
  };
  const limit = int("limit");
  return { after: Math.max(-1, int("after") ?? -1), limit: limit === null ? MOD_LOG_LIMIT : Math.min(MOD_LOG_MAX, Math.max(1, limit)) };
}

/** Dispatch: true when this module answered. `isModerator` is evaluated
 *  only for a matching path (it reads the caller's token). */
export function handleModLog(
  _req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  url: URL,
  isModerator: () => boolean,
  log: () => readonly SimEvent[],
): boolean {
  if (method !== "GET" || path !== MOD_LOG_ROUTE) return false;
  if (!isModerator()) {
    sendJson(res, 403, { error: "moderators only" });
    return true;
  }
  const { after, limit } = modLogQuery(url);
  res.setHeader?.("cache-control", "no-store");
  sendJson(res, 200, modLogPage(log(), after, limit));
  return true;
}
