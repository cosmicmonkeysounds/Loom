//! Thin transport layer: a JSON `fetch` POST helper (errors carry the HTTP
//! status as `ApiError`) and the SSE reducer that turns the server's
//! `history` / `message` / `messageModerated` stream into a live, ordered,
//! de-duplicated message map — plus pass-through hooks for the role
//! snapshot, performer scan readouts, and the run's `lifecycle` notices.

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./types.ts";

/** A non-2xx reply — the server's `error` text plus the HTTP status, so a
 *  session can tell "you can't post here" (403) from "this session is dead"
 *  (401 / 404 after the run restarted). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
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

const json = (e: Event): unknown => JSON.parse((e as MessageEvent).data);

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

/**
 * Subscribe to an SSE endpoint and maintain the message map. `onSnapshot`
 * receives role-specific snapshots (`snapshot` event); `onResponse` receives
 * performer scan readouts (`response`); `onLifecycle` receives run
 * transitions (`lifecycle`). All are optional so guests and performers share
 * this one wiring.
 */
export function useChatStream(
  url: string | null,
  handlers: {
    onSnapshot?: (v: unknown) => void;
    onResponse?: (text: string) => void;
    onLifecycle?: (n: LifecycleNotice) => void;
    /** The full thread history just (re)loaded — the baseline for "new". */
    onHistory?: (messages: ChatMessage[]) => void;
    /** The server refused the stream for good (a token the run no longer
     *  knows — e.g. the phone slept through a restart): the session is dead. */
    onDead?: () => void;
  },
): ChatStream {
  const [messages, setMessages] = useState<Map<number, ChatMessage>>(new Map());
  const [connected, setConnected] = useState(false);
  // Keep the latest handlers without re-opening the stream on every render.
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    if (!url) return;
    setMessages(new Map());
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
      // A non-200 answer (401 / 403 on a dead token) closes the source for
      // good — no retry will ever succeed, so say so rather than sit dark.
      if (es.readyState === EventSource.CLOSED) h.current.onDead?.();
    };

    const upsert = (m: ChatMessage) =>
      setMessages((prev) => {
        const next = new Map(prev);
        next.set(m.seq, m);
        return next;
      });

    es.addEventListener("snapshot", (e) => h.current.onSnapshot?.(json(e)));
    es.addEventListener("response", (e) => h.current.onResponse?.(String((json(e) as Record<string, unknown>)["text"])));
    es.addEventListener("lifecycle", (e) => h.current.onLifecycle?.(json(e) as LifecycleNotice));
    es.addEventListener("history", (e) => {
      const list = json(e) as ChatMessage[];
      h.current.onHistory?.(list);
      setMessages(() => {
        const m = new Map<number, ChatMessage>();
        for (const msg of list) m.set(msg.seq, msg);
        return m;
      });
    });
    es.addEventListener("message", (e) => upsert(json(e) as ChatMessage));
    // An ephemeral message aged out — drop it from the view.
    es.addEventListener("messageExpired", (e) => {
      const { seq } = json(e) as { seq: number };
      setMessages((prev) => {
        if (!prev.has(seq)) return prev;
        const next = new Map(prev);
        next.delete(seq);
        return next;
      });
    });
    es.addEventListener("messageModerated", (e) => {
      const d = json(e) as ChatMessage | { seq: number; hidden: boolean };
      if ("text" in d) {
        upsert(d); // admin payload: full message + flag
      } else if (d.hidden) {
        // Guest view of a hide: drop the message we can no longer see.
        setMessages((prev) => {
          if (!prev.has(d.seq)) return prev;
          const next = new Map(prev);
          next.delete(d.seq);
          return next;
        });
      }
    });
    return () => es.close();
  }, [url]);

  return { messages, connected };
}
