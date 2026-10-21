//! The voice uplink (wave 19, §2.4): this terminal's gated μ-law chunks,
//! POSTed raw to `/api/spatial/voice?seq=&spot=` with its mod token —
//! modelled on the camera feed's loop (`camfeed.ts` `runFeed`): never two
//! uploads in flight, a failure backs off (1 s doubling to 30 s), and a 401 /
//! 403 / 404 / 410 (access revoked, `voice is off at this terminal`, `no
//! such spot`) stops it until ⚙ changes something.
//!
//! Speech that waited is stale: at most `UPLINK_QUEUE_MAX` chunks queue
//! behind an upload in flight (older ones are dropped), chunks queued behind
//! a slow upload go up together (≤ `VOICE_MAX_BYTES`), and nothing queues
//! during a backoff. `seq` starts at the wall clock, so a reloaded page never
//! sends a seq the server already kept (it drops an old one silently).
//!
//! The answer's `listening` says whether anyone can still hear this room;
//! false stops the sending until the voice stream says `listen {on: true}`.

import { VOICE_MAX_BYTES } from "@loom/house";

/** Chunks waiting behind an upload in flight (1 s of speech). */
export const UPLINK_QUEUE_MAX = 5;
export const UPLINK_BACKOFF_MS = 1000;
export const UPLINK_BACKOFF_MAX_MS = 30_000;

export interface UplinkAnswer {
  /** The HTTP status, or null when the server couldn't be reached. */
  status: number | null;
  listening?: boolean;
}

export type UplinkStatus = { kind: "idle" } | { kind: "sending"; at: number } | { kind: "retrying"; problem: string } | { kind: "stopped"; problem: string };

/** What one upload's status means: send on, stop for good, drop it and send on, or back off. */
export function uplinkOutcome(status: number | null): "ok" | "stop" | "skip" | "retry" {
  if (status !== null && status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403 || status === 404 || status === 410) return "stop";
  if (status === 400 || status === 413) return "skip";
  return "retry";
}

export function uplinkProblem(status: number | null): string {
  if (status === null) return "the server can't be reached";
  if (status === 404) return "no such spot in the event's house map — pick this terminal's spot in ⚙";
  if (status === 403) return "the voice link is off at this terminal (or its access was refused)";
  if (status === 401 || status === 410) return "this terminal's access was refused";
  return `HTTP ${status}`;
}

export interface UplinkDeps {
  post: (body: Uint8Array, seq: number) => Promise<UplinkAnswer>;
  /** The first seq (the wall clock, ms). */
  seq0: number;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  onStatus: (s: UplinkStatus) => void;
  /** The server said whether anyone hears this room now. */
  onListening: (on: boolean) => void;
}

/** One μ-law body out of the queued chunks, as many as fit. */
function take(queue: Uint8Array[]): Uint8Array {
  let n = 0;
  let k = 0;
  while (k < queue.length && n + queue[k]!.length <= VOICE_MAX_BYTES) n += queue[k++]!.length;
  if (k === 0) k = 1; // a chunk alone over the cap: sent (and refused) alone
  const parts = queue.splice(0, k);
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export class Uplink {
  private queue: Uint8Array[] = [];
  private inFlight = false;
  private dead = false;
  private backoff = 0;
  private waiting: unknown = null;
  private seq: number;
  private last: string | null = null;

  constructor(private readonly deps: UplinkDeps) {
    this.seq = Math.max(0, Math.floor(deps.seq0));
  }

  get stopped(): boolean {
    return this.dead;
  }

  /** Queue one chunk for the games. */
  send(chunk: Uint8Array): void {
    if (this.dead || this.waiting !== null || chunk.length === 0) return;
    this.queue.push(chunk);
    if (this.queue.length > UPLINK_QUEUE_MAX) this.queue.splice(0, this.queue.length - UPLINK_QUEUE_MAX);
    if (!this.inFlight) void this.flush();
  }

  /** Forget what is queued (nobody hears it any more). */
  drop(): void {
    this.queue = [];
  }

  stop(): void {
    this.dead = true;
    this.queue = [];
    if (this.waiting !== null) this.deps.clearTimer(this.waiting);
    this.waiting = null;
  }

  private status(s: UplinkStatus): void {
    const key = s.kind === "retrying" || s.kind === "stopped" ? `${s.kind}:${s.problem}` : s.kind;
    if (key === this.last && s.kind !== "sending") return;
    this.last = key;
    this.deps.onStatus(s);
  }

  private async flush(): Promise<void> {
    while (!this.dead && this.waiting === null && this.queue.length > 0) {
      this.inFlight = true;
      const body = take(this.queue);
      const answer = await this.deps.post(body, this.seq++).catch((): UplinkAnswer => ({ status: null }));
      this.inFlight = false;
      if (this.dead) return;
      const outcome = uplinkOutcome(answer.status);
      if (outcome === "ok") {
        this.backoff = 0;
        this.status({ kind: "sending", at: this.deps.now() });
        if (typeof answer.listening === "boolean") {
          if (!answer.listening) this.queue = [];
          this.deps.onListening(answer.listening);
        }
      } else if (outcome === "stop") {
        this.dead = true;
        this.queue = [];
        this.status({ kind: "stopped", problem: uplinkProblem(answer.status) });
      } else if (outcome === "retry") {
        this.queue = [];
        this.backoff = this.backoff === 0 ? UPLINK_BACKOFF_MS : Math.min(UPLINK_BACKOFF_MAX_MS, this.backoff * 2);
        this.status({ kind: "retrying", problem: uplinkProblem(answer.status) });
        this.waiting = this.deps.setTimer(() => {
          this.waiting = null;
        }, this.backoff);
      }
    }
  }
}
