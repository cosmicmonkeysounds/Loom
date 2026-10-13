//! The pose pump — pure (the clock and the transport are injected). The
//! game streams the player's pose to `POST /api/spatial/pose` at 10 Hz,
//! **latest-only**: while one POST is in flight newer poses overwrite each
//! other and the next send carries only the newest — a slow network drops
//! poses, never queues them (§2.1, §3).
//!
//! - A pose that hasn't moved isn't re-sent, except a **keepalive** every
//!   few seconds (the server times a session out after 60 s without one).
//! - Network errors and 5xx back off (exponential, capped) and retry with
//!   whatever is newest then; a 400 drops that pose.
//! - 401 / 410 (and a 404 — the event is gone) mean the session is over:
//!   the pump stops for good and says so once.

import type { PlayerPose, PoseBody } from "@loom/house";

export type PoseOutcome = "ok" | "drop" | "retry" | "over";

/** What an HTTP status means to the pump (`null` = the network failed). */
export function outcomeOf(status: number | null): PoseOutcome {
  if (status === null) return "retry";
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 404 || status === 410) return "over";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  return "drop";
}

export interface PumpOptions {
  /** POST one pose; resolve to the HTTP status, or `null` on a network error. */
  send: (body: PoseBody) => Promise<number | null>;
  /** Milliseconds (any monotonic clock). */
  now: () => number;
  /** Least time between sends, ms (default 100 → 10 Hz). */
  interval?: number;
  /** Re-send an unchanged pose after this long, ms (default 5000). */
  keepalive?: number;
  /** Backoff after a failure, ms: `min · 2^(n−1)` capped at `max` (defaults 250 / 5000). */
  backoffMin?: number;
  backoffMax?: number;
  /** The session is over (the status that said so). Called once. */
  onOver?: (status: number) => void;
}

/** Two poses differ enough to be worth sending (1 mm, 0.1°). */
export function poseMoved(a: PlayerPose | null, b: PlayerPose): boolean {
  if (a === null) return true;
  return (
    Math.abs(a.p[0] - b.p[0]) > 0.001 ||
    Math.abs(a.p[1] - b.p[1]) > 0.001 ||
    Math.abs(a.p[2] - b.p[2]) > 0.001 ||
    Math.abs(a.yaw - b.yaw) > 0.1 ||
    Math.abs(a.pitch - b.pitch) > 0.1
  );
}

export class PosePump {
  private readonly opts: Required<Omit<PumpOptions, "onOver">> & Pick<PumpOptions, "onOver">;
  private pose: PlayerPose | null = null;
  private sent: PlayerPose | null = null;
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private nextAt = Number.NEGATIVE_INFINITY;
  private failures = 0;
  private flight: Promise<void> | null = null;
  private over = false;
  /** Sends attempted (for tests and the debug readout). */
  sends = 0;

  constructor(opts: PumpOptions) {
    this.opts = { interval: 100, keepalive: 5000, backoffMin: 250, backoffMax: 5000, ...opts };
  }

  /** The newest pose (replaces any pose not yet sent). */
  set(pose: PlayerPose): void {
    this.pose = { p: [pose.p[0], pose.p[1], pose.p[2]], yaw: pose.yaw, pitch: pose.pitch };
  }

  get stopped(): boolean {
    return this.over;
  }

  get inFlight(): boolean {
    return this.flight !== null;
  }

  /** Consecutive failures (the backoff exponent). */
  get failing(): number {
    return this.failures;
  }

  /** Stop sending (the game ended). */
  stop(): void {
    this.over = true;
  }

  /**
   * Call often (every frame, or a 50 ms timer). Starts a send when one is
   * due; returns its promise (null when nothing was sent).
   */
  tick(): Promise<void> | null {
    if (this.over || this.flight !== null || this.pose === null) return null;
    const now = this.opts.now();
    if (now < this.nextAt) return null;
    if (!poseMoved(this.sent, this.pose) && now - this.lastSentAt < this.opts.keepalive) return null;
    return this.start(now);
  }

  /**
   * Make sure the server has the newest pose (before `found`): waits for a
   * send in flight, then sends the newest pose if it hasn't gone yet —
   * ignoring the 10 Hz spacing. Resolves false when the session is over.
   */
  async flush(): Promise<boolean> {
    if (this.flight !== null) await this.flight;
    if (this.over) return false;
    if (this.pose !== null && poseMoved(this.sent, this.pose)) await this.start(this.opts.now());
    return !this.over;
  }

  private start(now: number): Promise<void> {
    const pose = this.pose!;
    const body: PoseBody = { p: [pose.p[0], pose.p[1], pose.p[2]], yaw: pose.yaw, pitch: pose.pitch, t: Math.round(now) };
    this.sends += 1;
    this.nextAt = now + this.opts.interval;
    const run = async (): Promise<void> => {
      let status: number | null;
      try {
        status = await this.opts.send(body);
      } catch {
        status = null;
      }
      const outcome = outcomeOf(status);
      const at = this.opts.now();
      switch (outcome) {
        case "ok":
        case "drop":
          this.failures = 0;
          this.sent = pose;
          this.lastSentAt = at;
          break;
        case "retry":
          this.failures += 1;
          this.nextAt = at + Math.min(this.opts.backoffMax, this.opts.backoffMin * 2 ** (this.failures - 1));
          break;
        case "over":
          if (!this.over) {
            this.over = true;
            this.opts.onOver?.(status ?? 0);
          }
          break;
      }
    };
    const flight = run().finally(() => {
      if (this.flight === flight) this.flight = null;
    });
    this.flight = flight;
    return flight;
  }
}
