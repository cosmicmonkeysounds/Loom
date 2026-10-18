//! Thin transport layer: a JSON `fetch` POST helper (errors carry the HTTP
//! status as `ApiError`) and the SSE reducer that turns the server's
//! `history` / `message` / `messageModerated` stream into a live, ordered,
//! de-duplicated message map — plus pass-through hooks for the role
//! snapshot, performer scan readouts, and the run's `lifecycle` notices.
//! The stream reopens itself after a refusal (`openChatFeed`) — a proxy's
//! 502 while the server restarts closes an `EventSource` for good.

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./types.ts";
import type { TypingNotice } from "./typing.ts";

/** A non-2xx reply — the server's `error` text plus the HTTP status, so a
 *  session can tell "you can't post here" (403) from "this session is dead"
 *  (401 / 404 after the run restarted). */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** A request the server never answered in time (`withTimeout`). It may
 *  still have landed — the caller's message says so. */
export class RequestTimeout extends Error {
  constructor(ms: number) {
    super(`no answer in ${Math.round(ms / 1000)}s`);
    this.name = "RequestTimeout";
  }
}

/** `p`, or a `RequestTimeout` rejection once `ms` pass first — so a POST
 *  stuck on a phone switching networks never holds a button down for
 *  minutes. The request itself is not cancelled; a late answer is dropped. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new RequestTimeout(ms)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** POST JSON to the server, attaching a capability token when present. */
export async function api<T = Record<string, unknown>>(path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-loom-token": token } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError((data["error"] as string) || `HTTP ${res.status}`, res.status);
  return data as T;
}

export interface ChatStream {
  /** Messages keyed by seq (stable + de-duplicating across reconnects). */
  messages: Map<number, ChatMessage>;
  connected: boolean;
}

/** What the server announces on a run transition (`lifecycle` SSE event):
 *  `reset` / `reload` (the story restarted), `golive` (a rehearsal was
 *  promoted to the live event), `ended`. `by` names the director, `at` is
 *  the server's clock. */
export interface LifecycleNotice {
  kind: string;
  by?: string;
  at?: number;
}

/** The probe's verdict on a closed stream: the run forgot the token
 *  (`"reset"`), the event is gone (`"ended"`), or `null` — alive, or no way
 *  to tell (a 502 from the proxy while the server restarts). */
export type StreamVerdict = "reset" | "ended" | null;

/** What `openChatFeed` needs of an `EventSource` (a fake in tests). */
export interface FeedSource {
  readonly readyState: number;
  onopen: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
  addEventListener(type: string, fn: (e: Event) => void): void;
  close(): void;
}

/** `EventSource.CLOSED`, spelled out so a test needs no DOM. */
const CLOSED = 2;

/** The frames the chat stream carries. */
export const CHAT_FRAMES = ["snapshot", "response", "lifecycle", "typing", "history", "message", "messageExpired", "messageModerated"] as const;
export type ChatFrame = (typeof CHAT_FRAMES)[number];

export const REOPEN_MS = 1000;
export const REOPEN_MAX_MS = 15_000;

/** The wait before reopening a refused stream: 1 s doubling per attempt up
 *  to 15 s, jittered down to half so a house of phones coming back from one
 *  restart don't all knock at once. */
export function reopenDelay(attempt: number, rand: () => number = Math.random): number {
  const capped = Math.min(REOPEN_MAX_MS, REOPEN_MS * 2 ** Math.max(0, attempt));
  return Math.round(capped * (0.5 + rand() / 2));
}

/** The page events a feed reacts to. `visible` = the tab came back into
 *  view; `pageshow` = restored from the back/forward cache. */
export type FeedPageEvent = "pagehide" | "beforeunload" | "pageshow" | "online" | "visible";

export interface ChatFeedEnv {
  source: (url: string) => FeedSource;
  /** Asked when the stream closes for good. Without one, a closed stream
   *  is reported dead at once (`onDead(null)`) and never reopened. */
  probe?: () => Promise<StreamVerdict>;
  delay: (attempt: number) => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  /** Subscribe to a page event; returns the unsubscribe. */
  listen: (event: FeedPageEvent, fn: () => void) => () => void;
}

export interface ChatFeedSink {
  onOpen: () => void;
  onError: () => void;
  onFrame: (frame: ChatFrame, data: string) => void;
  /** The stream is dead for good: the probe's verdict, or `null` with no probe. */
  onDead: (verdict: StreamVerdict) => void;
}

/** The browser's wiring for `openChatFeed`. */
export function browserFeedEnv(probe?: () => Promise<StreamVerdict>): ChatFeedEnv {
  return {
    source: (url) => new EventSource(url),
    probe,
    delay: (attempt) => reopenDelay(attempt),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    listen: (event, fn) => {
      if (event === "visible") {
        const onVis = () => {
          if (document.visibilityState === "visible") fn();
        };
        document.addEventListener("visibilitychange", onVis);
        return () => document.removeEventListener("visibilitychange", onVis);
      }
      window.addEventListener(event, fn);
      return () => window.removeEventListener(event, fn);
    },
  };
}

/**
 * Open an SSE stream and keep it open. The browser retries a dropped
 * connection by itself, but any non-200 answer — a 401 on a dead token, and
 * just as well the proxy's 502 while the server restarts — closes an
 * `EventSource` for good. So on a close the feed asks `probe`: a dead
 * session is reported (`onDead`), anything else reopens after a capped
 * backoff (reset by a successful open). Coming back online, back into view
 * or out of the back/forward cache reopens at once while not connected. The
 * page going away (a reload, a navigation) never counts as a close. Returns
 * the stop function.
 */
export function openChatFeed(url: string, sink: ChatFeedSink, env: ChatFeedEnv): () => void {
  let es: FeedSource | null = null;
  let gen = 0; // the current source; a late answer for an older one is ignored
  let attempt = 0;
  let retry: unknown = null;
  let connected = false;
  let unloading = false;
  let done = false; // stopped, or the session is dead
  const clearRetry = () => {
    if (retry !== null) env.clearTimer(retry);
    retry = null;
  };
  const open = () => {
    clearRetry();
    es?.close();
    const mine = ++gen;
    const src = env.source(url);
    es = src;
    src.onopen = () => {
      if (mine !== gen) return;
      attempt = 0;
      connected = true;
      sink.onOpen();
    };
    src.onerror = () => {
      if (mine !== gen) return;
      connected = false;
      sink.onError();
      if (src.readyState !== CLOSED || unloading || done) return;
      if (!env.probe) {
        done = true;
        sink.onDead(null);
        return;
      }
      src.close();
      void env.probe().then(
        (verdict) => {
          if (done || mine !== gen) return;
          if (verdict !== null) {
            done = true;
            sink.onDead(verdict);
            return;
          }
          retry = env.setTimer(open, env.delay(attempt++));
        },
        () => {
          if (done || mine !== gen) return;
          retry = env.setTimer(open, env.delay(attempt++));
        },
      );
    };
    for (const frame of CHAT_FRAMES) {
      src.addEventListener(frame, (e) => {
        if (mine === gen) sink.onFrame(frame, String((e as MessageEvent).data));
      });
    }
  };
  // Back online / in view / out of the bfcache: don't wait out a backoff.
  const wake = () => {
    unloading = false;
    if (done || connected || !env.probe) return;
    open();
  };
  const offs = [
    env.listen("pagehide", () => {
      unloading = true;
    }),
    env.listen("beforeunload", () => {
      unloading = true;
    }),
    env.listen("pageshow", wake),
    env.listen("online", wake),
    env.listen("visible", wake),
  ];
  open();
  return () => {
    done = true;
    clearRetry();
    for (const off of offs) off();
    es?.close();
  };
}

/**
 * Subscribe to an SSE endpoint and maintain the message map. `onSnapshot`
 * receives role-specific snapshots (`snapshot` event); `onResponse` receives
 * performer scan readouts (`response`); `onLifecycle` receives run
 * transitions (`lifecycle`). All are optional so guests and performers share
 * this one wiring. With a `probe`, a stream the server or a proxy refused is
 * reopened until the probe says the session is dead (`openChatFeed`).
 */
export function useChatStream(
  url: string | null,
  handlers: {
    onSnapshot?: (v: unknown) => void;
    onResponse?: (text: string) => void;
    onLifecycle?: (n: LifecycleNotice) => void;
    /** An agent-voiced character started / stopped composing a reply. */
    onTyping?: (n: TypingNotice) => void;
    /** The full thread history just (re)loaded — the baseline for "new". */
    onHistory?: (messages: ChatMessage[]) => void;
    /** Is the session still alive? Asked when the stream closes for good:
     *  `null` reopens it (with a backoff), a verdict ends it (`onDead`). */
    probe?: () => Promise<StreamVerdict>;
    /** The stream is over for good: the probe's verdict (a token the run no
     *  longer knows, the event gone), or `null` when there is no probe and
     *  the server refused the stream. */
    onDead?: (verdict: StreamVerdict) => void;
  },
): ChatStream {
  const [messages, setMessages] = useState<Map<number, ChatMessage>>(new Map());
  const [connected, setConnected] = useState(false);
  // Keep the latest handlers without re-opening the stream on every render.
  const h = useRef(handlers);
  h.current = handlers;
  // Whether there is a probe is fixed per stream (it decides reopening).
  const probing = handlers.probe !== undefined;

  useEffect(() => {
    if (!url) return;
    setMessages(new Map());
    const upsert = (m: ChatMessage) =>
      setMessages((prev) => {
        const next = new Map(prev);
        next.set(m.seq, m);
        return next;
      });
    const drop = (seq: number) =>
      setMessages((prev) => {
        if (!prev.has(seq)) return prev;
        const next = new Map(prev);
        next.delete(seq);
        return next;
      });
    const onFrame = (frame: ChatFrame, data: string) => {
      const d = JSON.parse(data) as unknown;
      switch (frame) {
        case "snapshot":
          h.current.onSnapshot?.(d);
          return;
        case "response":
          h.current.onResponse?.(String((d as Record<string, unknown>)["text"]));
          return;
        case "lifecycle":
          h.current.onLifecycle?.(d as LifecycleNotice);
          return;
        case "typing":
          h.current.onTyping?.(d as TypingNotice);
          return;
        case "history": {
          const list = d as ChatMessage[];
          h.current.onHistory?.(list);
          setMessages(() => {
            const m = new Map<number, ChatMessage>();
            for (const msg of list) m.set(msg.seq, msg);
            return m;
          });
          return;
        }
        case "message":
          upsert(d as ChatMessage);
          return;
        // An ephemeral message aged out — drop it from the view.
        case "messageExpired":
          drop((d as { seq: number }).seq);
          return;
        case "messageModerated": {
          const m = d as ChatMessage | { seq: number; hidden: boolean };
          if ("text" in m) upsert(m); // admin payload: full message + flag
          else if (m.hidden) drop(m.seq); // guest view of a hide
          return;
        }
      }
    };
    const env = browserFeedEnv(probing ? () => h.current.probe?.() ?? Promise.resolve(null) : undefined);
    return openChatFeed(
      url,
      {
        onOpen: () => setConnected(true),
        onError: () => setConnected(false),
        onFrame,
        onDead: (verdict) => h.current.onDead?.(verdict),
      },
      env,
    );
  }, [url, probing]);

  return { messages, connected };
}
