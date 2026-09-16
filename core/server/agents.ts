//! Agent-voiced characters — the server half of the stagehand **agents**
//! protocol.
//!
//! A `CHARACTER` marked `mind: external` has no performer. When someone
//! messages it (a guest in its `dm:` thread, a performer in their `cast:`
//! thread with it, a director's persona), the event runtime asks this hub
//! for a reply. The hub turns the thread into an **agent request** and
//! pushes it to a connected worker (a stagehand process with the agents
//! module — "Trabolta on the laptop"), which answers with
//! `POST /api/agent/reply`. The runtime commits the reply as an ordinary
//! journaled `say` (+ clamped variable writes), so a replay reproduces
//! the night exactly and the worker is never trusted with anything a mod
//! token couldn't already do.
//!
//!   participant says ──▶ AgentHub.line(thread)
//!                          │ open request on the thread? → mark follow-up
//!                          │ else build request → dispatch to a worker
//!                          ▼                         (queued if none online)
//!   worker SSE  ◀── request {id, character, speaker, text, history, state}
//!   worker      ──▶ POST /api/agent/reply {id, say, adjust}
//!                          │ commit say + vars; typing off
//!                          └ follow-up pending? → a fresh request
//!
//! One open request per thread keeps a burst of three messages from
//! producing three replies: the model answers once, then once more with
//! everything said meanwhile. The hub is transport-agnostic — workers are
//! `send` callbacks, the request body comes from the runtime's `build` —
//! so it tests without sockets or a sim.

import { randomUUID } from "node:crypto";

/** Who is talking to the character. */
export interface AgentSpeaker {
  kind: "guest" | "performer";
  /** Guest id, or the performer's character name. */
  id: string;
  name: string;
  faction: string | null;
}

/** Where a conversation lives: the character's `dm:` channel, narrowed to
 *  one counterpart by `audience` (`[guestId]` or `["@Character"]`). */
export interface AgentThread {
  character: string;
  channel: string;
  audience: string[];
}

/** One line of the thread as the worker sees it, oldest first. */
export interface AgentLine {
  seq: number;
  /** True when the agent character said it. */
  mine: boolean;
  from: string;
  text: string;
}

/** What a worker receives: everything needed to answer, no follow-up reads. */
export interface AgentRequest {
  id: string;
  character: string;
  thread: AgentThread;
  speaker: AgentSpeaker;
  /** The line that prompted the request (the newest from the speaker). */
  text: string;
  history: AgentLine[];
  /** The character's own state: `<Character>.*` world values + its codex. */
  self: { vars: Record<string, string>; ranges: Record<string, [number, number]>; codex: AgentCodexEntry[] };
  /** The speaker's state: `<id>.*` world values + their codex (guests). */
  them: { vars: Record<string, string>; codex: AgentCodexEntry[]; location: string | null };
  /** Global world facts (paths whose head is neither a guest nor a character). */
  world: Record<string, string>;
  /** Server wall clock when the request was built. */
  at: number;
}

export interface AgentCodexEntry {
  id: string;
  title: string;
  about: string | null;
  text: string;
}

/** A connected worker (one agents SSE stream). */
export interface AgentWorker {
  id: string;
  /** Display label (`laptop`), for presence. */
  name: string;
  /** The characters this worker voices. */
  characters: Set<string>;
  send: (event: string, data: unknown) => void;
}

interface OpenRequest {
  req: AgentRequest;
  key: string;
  /** The worker it's with, or null while queued. */
  worker: string | null;
  dispatchedAt: number | null;
  attempts: number;
  /** A newer line arrived while this one was open. */
  followUp: boolean;
}

export interface AgentHubOptions {
  /** Build the request body for a thread right now (null → nothing to answer). */
  build: (thread: AgentThread, id: string) => AgentRequest | null;
  /** Show / hide the "… is typing" indicator in the thread. */
  typing?: (thread: AgentThread, on: boolean) => void;
  /** Presence changed (a worker came or went). */
  presence?: () => void;
  /** A dispatched request with no answer after this long is re-dispatched. */
  replyTimeoutMs?: number;
  /** A queued request no worker picked up within this long is dropped. */
  queueMaxAgeMs?: number;
  /** Dispatch attempts before a request is given up. */
  maxAttempts?: number;
  now?: () => number;
}

export const threadKey = (t: AgentThread): string => `${t.channel}|${t.audience.join(",")}`;

export class AgentHub {
  private readonly workers = new Map<string, AgentWorker>();
  private readonly open = new Map<string, OpenRequest>(); // request id →
  private readonly byThread = new Map<string, string>(); // thread key → request id

  constructor(private readonly o: AgentHubOptions) {}

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** Characters with at least one worker connected. */
  onlineCharacters(): string[] {
    const out = new Set<string>();
    for (const w of this.workers.values()) for (const c of w.characters) out.add(c);
    return [...out].sort();
  }

  /** Connected workers, for presence (`{name, characters}`). */
  workerList(): Array<{ name: string; characters: string[] }> {
    return [...this.workers.values()].map((w) => ({ name: w.name, characters: [...w.characters].sort() }));
  }

  isOnline(character: string): boolean {
    for (const w of this.workers.values()) if (w.characters.has(character)) return true;
    return false;
  }

  /** Open requests (queued or in flight). */
  get pending(): AgentRequest[] {
    return [...this.open.values()].map((r) => r.req);
  }

  // -- workers --------------------------------------------------------------

  /** A worker connected: register it and hand it every queued request it can answer. */
  attach(worker: AgentWorker): void {
    this.workers.set(worker.id, worker);
    this.o.presence?.();
    for (const r of this.open.values()) if (r.worker === null) this.dispatch(r);
  }

  /** A worker went away: its in-flight requests go back in the queue. */
  detach(workerId: string): void {
    if (!this.workers.delete(workerId)) return;
    for (const r of this.open.values()) {
      if (r.worker !== workerId) continue;
      r.worker = null;
      r.dispatchedAt = null;
      this.o.typing?.(r.req.thread, false);
      this.dispatch(r);
    }
    this.o.presence?.();
  }

  // -- conversation ---------------------------------------------------------

  /** Someone said something in an agent thread. */
  line(thread: AgentThread): void {
    const key = threadKey(thread);
    const openId = this.byThread.get(key);
    if (openId !== undefined) {
      const r = this.open.get(openId);
      if (r !== undefined) {
        if (r.worker === null) {
          // Still queued: refresh the body so the eventual answer sees the
          // whole burst (one request, not one per line).
          const fresh = this.o.build(thread, r.req.id);
          if (fresh !== null) r.req = fresh;
        } else {
          r.followUp = true;
        }
        return;
      }
    }
    this.create(thread);
  }

  private create(thread: AgentThread): void {
    const id = `ar-${randomUUID().slice(0, 8)}`;
    const req = this.o.build(thread, id);
    if (req === null) return;
    const r: OpenRequest = { req, key: threadKey(thread), worker: null, dispatchedAt: null, attempts: 0, followUp: false };
    this.open.set(id, r);
    this.byThread.set(r.key, id);
    this.dispatch(r);
  }

  /** Send `r` to the least-busy worker voicing its character (no-op if none). */
  private dispatch(r: OpenRequest): void {
    let best: AgentWorker | null = null;
    let bestLoad = Infinity;
    for (const w of this.workers.values()) {
      if (!w.characters.has(r.req.character)) continue;
      let load = 0;
      for (const o of this.open.values()) if (o.worker === w.id) load += 1;
      if (load < bestLoad) {
        best = w;
        bestLoad = load;
      }
    }
    if (best === null) return;
    r.worker = best.id;
    r.dispatchedAt = this.now();
    r.attempts += 1;
    best.send("request", r.req);
    this.o.typing?.(r.req.thread, true);
  }

  /**
   * A worker answered. Returns the request (so the runtime commits the reply
   * into its thread) and whether more was said meanwhile — if so the runtime
   * calls `line` again after committing, so the model answers the rest. Null
   * when the request is unknown / already settled (a late answer after a
   * timeout re-dispatch, or after a restart) or held by another worker.
   */
  settle(requestId: string, workerId?: string): { req: AgentRequest; followUp: boolean } | null {
    const r = this.open.get(requestId);
    if (r === undefined) return null;
    if (workerId !== undefined && r.worker !== null && r.worker !== workerId) return null;
    this.open.delete(requestId);
    if (this.byThread.get(r.key) === requestId) this.byThread.delete(r.key);
    this.o.typing?.(r.req.thread, false);
    return { req: r.req, followUp: r.followUp };
  }

  /** Expire stuck work. Call periodically (the runtime's 1 s ticker). */
  sweep(): void {
    const now = this.now();
    const timeout = this.o.replyTimeoutMs ?? 120_000;
    const maxAge = this.o.queueMaxAgeMs ?? 10 * 60_000;
    const maxAttempts = this.o.maxAttempts ?? 2;
    for (const [id, r] of [...this.open]) {
      if (r.worker !== null && r.dispatchedAt !== null && now - r.dispatchedAt > timeout) {
        this.workers.get(r.worker)?.send("cancel", { id });
        this.o.typing?.(r.req.thread, false);
        r.worker = null;
        r.dispatchedAt = null;
        if (r.attempts >= maxAttempts) {
          this.drop(id, r);
          continue;
        }
        this.dispatch(r);
      } else if (r.worker === null && now - r.req.at > maxAge) {
        this.drop(id, r);
      }
    }
  }

  private drop(id: string, r: OpenRequest): void {
    this.open.delete(id);
    if (this.byThread.get(r.key) === id) this.byThread.delete(r.key);
  }

  /** The story restarted: every open request is moot. Workers stay attached. */
  reset(): void {
    for (const [id, r] of this.open) {
      if (r.worker !== null) {
        this.workers.get(r.worker)?.send("cancel", { id });
        this.o.typing?.(r.req.thread, false);
      }
    }
    this.open.clear();
    this.byThread.clear();
    for (const w of this.workers.values()) w.send("reset", {});
  }
}
