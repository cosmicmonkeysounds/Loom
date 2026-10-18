//! Reopening a dead Server-Sent-Events stream (wave 9, contract C8).
//!
//! An `EventSource` retries a dropped connection on its own — but a
//! non-200 answer (Caddy's 502 while the event server restarts, a 503
//! while it boots) closes it for good (`readyState` CLOSED) and it never
//! fires again. The operate store's mod stream and the collab stream both
//! watch for that, probe that the session is still alive, and reopen on a
//! capped backoff. The rules are pure, so they test without a browser.

/** `EventSource.CLOSED` — spelled out so the rule works where the global
 *  is missing (headless tests). */
const CLOSED = 2

/** The first wait before reopening a closed stream. */
export const STREAM_RETRY_BASE_MS = 1_000
/** The longest wait between attempts. */
export const STREAM_RETRY_MAX_MS = 15_000

/** True when there is no stream or it closed for good — the browser will
 *  not retry it, so someone must open a new one. A stream that is merely
 *  reconnecting (`CONNECTING`) is the browser's to retry. */
export function streamClosed(es: { readyState: number } | null): boolean {
  return es === null || es.readyState === CLOSED
}

/** The wait before attempt `attempt` (0-based): doubling from the base,
 *  capped. */
export function reconnectDelay(attempt: number): number {
  const n = Math.max(0, Math.min(Math.floor(attempt), 30))
  return Math.min(STREAM_RETRY_MAX_MS, STREAM_RETRY_BASE_MS * 2 ** n)
}

/** What a liveness probe's answer means for a closed stream: `reopen` (the
 *  server answered and the session is good), `stop` (signed out, or the
 *  project is gone or no longer yours — reopening would only fail again),
 *  else `retry` later (the server is down, restarting or still booting; a
 *  network error is `null`). */
export function probeVerdict(status: number | null): 'reopen' | 'retry' | 'stop' {
  if (status === null) return 'retry'
  if (status >= 200 && status < 300) return 'reopen'
  if (status === 401 || status === 403 || status === 404) return 'stop'
  return 'retry'
}
