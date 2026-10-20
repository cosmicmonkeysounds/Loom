//! The host booth's client (wave 13): polls the host view
//! (`GET /e/<id>/api/state?role=mod&host=1`) every 3 s while the page is
//! visible — the director phone's poll (`startPoll`: parked while hidden,
//! backing off on failures, at once when the network comes back) — and
//! posts to the host allowlist (`host/api.ts`) with the booth's token.
//! `api()` is POST-only, so the reads use their own `fetch` with the
//! `x-loom-token` header, as `director.tsx` does.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../client.ts";
import { eventGone } from "../lifecycle.ts";
import type { HostView } from "../types.ts";
import type { RecapWire } from "../../../core/src/host-board.ts";
import { startPoll, viewLatch, type PollDeps } from "../director.tsx";
import { HOST_ROUTES, hostCalls, type HostCalls, type HostPost, type HostRoute } from "./api.ts";

export interface HostAuth {
  token: string;
  eventId: string;
}

/** What one host-view poll's answer means. */
export type HostPoll = { kind: "view"; view: HostView } | { kind: "error"; message: string; gone?: true };

export function hostPollOutcome(status: number, body: Record<string, unknown>): HostPoll {
  if (status >= 200 && status < 300) return { kind: "view", view: body as unknown as HostView };
  const message = typeof body["error"] === "string" ? body["error"] : `HTTP ${status}`;
  if (eventGone(status, message)) return { kind: "error", message: "That event has ended.", gone: true };
  if (status === 403) return { kind: "error", message: "This booth isn't a host any more." };
  return { kind: "error", message };
}

export function browserPollDeps(load: () => Promise<void>): PollDeps {
  return {
    load,
    hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    onVisibility: (fn) => {
      document.addEventListener("visibilitychange", fn);
      return () => document.removeEventListener("visibilitychange", fn);
    },
    onOnline: (fn) => {
      window.addEventListener("online", fn);
      return () => window.removeEventListener("online", fn);
    },
  };
}

/** The base path of one event's API. */
export function eventBase(eventId: string): string {
  return `/e/${encodeURIComponent(eventId)}`;
}

/** A `HostPost` over `fetch` that refuses any route off the allowlist
 *  before it leaves the phone. A 409 `moved` resolves (`{moved: true}`),
 *  like the director phone, so the NEXT bar can re-arm. */
export function fetchHostPost(auth: HostAuth, doFetch: typeof fetch = (...a) => fetch(...a)): HostPost {
  return async (route: HostRoute, body: Record<string, unknown>, signal?: AbortSignal) => {
    if (!(HOST_ROUTES as readonly string[]).includes(route)) throw new ApiError(`not a host route: ${route}`, 0);
    const res = await doFetch(`${eventBase(auth.eventId)}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-loom-token": auth.token },
      body: JSON.stringify(body),
      ...(signal !== undefined ? { signal } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return data;
    if (res.status === 409 && data["moved"] === true) return { moved: true };
    throw new ApiError((data["error"] as string) || `HTTP ${res.status}`, res.status);
  };
}

/** The poll's error when the server didn't answer at all. */
export const UNREACHABLE = "Can't reach the server";

export interface HostClient {
  view: HostView | null;
  /** When the last view landed (wall ms): the countdowns tick on from it. */
  receivedAt: number;
  error: string | null;
  /** False once a poll has failed, until the next one lands: the view is
   *  the last good one, and the bar says how old it is. */
  connected: boolean;
  /** Poll now (after a write), or straight after a poll already in flight. */
  refresh: () => void;
  /** Resolves once a poll started after this call has landed (or `ms`). */
  fresh: (ms: number) => Promise<void>;
  calls: HostCalls | null;
}

export function useHostView(auth: HostAuth | null): HostClient {
  const [view, setView] = useState<HostView | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const poll = useRef<{ stop(): void; now(): void } | null>(null);
  const [latch] = useState(viewLatch);
  const token = auth?.token ?? null;
  const eventId = auth?.eventId ?? null;
  useEffect(() => {
    if (token === null || eventId === null) {
      setView(null);
      return;
    }
    const load = async () => {
      const seq = latch.begin();
      let res: Response;
      try {
        res = await fetch(`${eventBase(eventId)}/api/state?role=mod&host=1`, { headers: { "x-loom-token": token }, cache: "no-store" });
      } catch (e) {
        // No answer at all (Wi-Fi gone, the server restarting): say so,
        // so the NEXT bar stops passing the last poll off as the night.
        setConnected(false);
        setError(UNREACHABLE);
        throw e;
      }
      const out = hostPollOutcome(res.status, (await res.json().catch(() => ({}))) as Record<string, unknown>);
      if (out.kind === "view") {
        setView(out.view);
        setReceivedAt(Date.now());
        setConnected(true);
        setError(null);
        latch.landed(seq);
        return;
      }
      setConnected(false);
      setError(out.message);
      throw new Error(out.message);
    };
    const p = startPoll(browserPollDeps(() => load().catch((e: unknown) => {
      setConnected(false);
      throw e;
    })));
    poll.current = p;
    return () => {
      p.stop();
      poll.current = null;
    };
  }, [token, eventId, latch]);
  const refresh = useCallback(() => poll.current?.now(), []);
  const fresh = useCallback(
    (ms: number) => {
      const p = latch.after(latch.started, ms);
      poll.current?.now();
      return p;
    },
    [latch],
  );
  const alertsPath = useRef("Night.alerts");
  alertsPath.current = view?.alerts.path ?? "Night.alerts";
  const calls = useMemo(() => (token !== null && eventId !== null ? hostCalls(fetchHostPost({ token, eventId }), () => alertsPath.current) : null), [token, eventId]);
  return { view, receivedAt, error, connected, refresh, fresh, calls };
}

/** How often the recap is read while award cues are near (it is a heavy read). */
export const RECAP_MS = 15_000;

/** The recap (`GET /api/mod/recap`) every `RECAP_MS` while `on` — the
 *  award cues' suggested winners. Null until the first answer. */
export function useRecap(auth: HostAuth | null, on: boolean): RecapWire | null {
  const [recap, setRecap] = useState<RecapWire | null>(null);
  const token = auth?.token ?? null;
  const eventId = auth?.eventId ?? null;
  useEffect(() => {
    if (!on || token === null || eventId === null) return;
    let stopped = false;
    const load = async () => {
      const res = await fetch(`${eventBase(eventId)}/api/mod/recap`, { headers: { "x-loom-token": token }, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as RecapWire;
      if (!stopped) setRecap(body);
    };
    const p = startPoll(browserPollDeps(load), RECAP_MS);
    return () => {
      stopped = true;
      p.stop();
    };
  }, [on, token, eventId]);
  return recap;
}
