//! The terminal's link to the games, counted (wave 59): camera frames sent,
//! simulation frames received and drawn, each per second over the last 10 s,
//! and the last thing that went wrong. ⚙ reads it (`linkReadout`) and the
//! heartbeat carries it to Run → Terminals (`heartbeat`), so a tablet on a wall
//! says what's wrong with nobody plugged into it. Pure over a passed clock; the
//! page's one is `linkStats`, in the base bundle so the lazy views can reach it.

import { LINK_ERRORS, LINK_RATE_MAX, type LinkError } from "../../core/src/link-health.ts";

/** Rates are over this long (ms). */
export const RATE_WINDOW_MS = 10_000;
/** The heartbeat carries an error this long after it last happened (ms). */
export const ERROR_SHOWN_MS = 60_000;

/** Hits per second over the last `RATE_WINDOW_MS`. */
export class RateMeter {
  private hits: number[] = [];

  hit(now: number): void {
    this.hits.push(now);
    this.trim(now);
  }

  perSecond(now: number): number {
    this.trim(now);
    return this.hits.length / (RATE_WINDOW_MS / 1000);
  }

  private trim(now: number): void {
    const from = now - RATE_WINDOW_MS;
    let i = 0;
    while (i < this.hits.length && this.hits[i]! < from) i++;
    if (i > 0) this.hits.splice(0, i);
  }
}

export interface LinkSnapshot {
  /** Camera frames the server took, per second. */
  sent: number;
  /** Simulation frames off the spatial stream, per second. */
  received: number;
  /** Simulation frames this page drew, per second. */
  drawn: number;
  error: { code: LinkError; agoMs: number } | null;
  /** The last frame sent. */
  frame: { w: number; h: number; bytes: number } | null;
  /** What a capture costs this page (ms); 0 before the first. */
  costMs: number;
  /** The feed is running here / the stream is open here. */
  feeding: boolean;
  watching: boolean;
}

export class LinkStats {
  private readonly sentRate = new RateMeter();
  private readonly receivedRate = new RateMeter();
  private readonly drawnRate = new RateMeter();
  private lastError: { code: LinkError; at: number } | null = null;
  private frame: LinkSnapshot["frame"] = null;
  private cost = 0;
  private feeding = false;
  private watching = 0;

  sent(now: number, frame: { w: number; h: number; bytes: number }): void {
    this.sentRate.hit(now);
    this.frame = frame;
  }

  received(now: number): void {
    this.receivedRate.hit(now);
  }

  drawn(now: number): void {
    this.drawnRate.hit(now);
  }

  error(now: number, code: LinkError): void {
    this.lastError = { code, at: now };
  }

  captureCost(ms: number): void {
    this.cost = ms;
  }

  /** The camera feed started or stopped here. */
  setFeeding(on: boolean): void {
    this.feeding = on;
  }

  /** A spatial stream opened (+1) or closed (-1) here. */
  watch(delta: number): void {
    this.watching = Math.max(0, this.watching + delta);
  }

  snapshot(now: number): LinkSnapshot {
    const e = this.lastError;
    return {
      sent: this.sentRate.perSecond(now),
      received: this.receivedRate.perSecond(now),
      drawn: this.drawnRate.perSecond(now),
      error: e === null ? null : { code: e.code, agoMs: Math.max(0, now - e.at) },
      frame: this.frame,
      costMs: this.cost,
      feeding: this.feeding,
      watching: this.watching > 0,
    };
  }
}

function rate(v: number): string {
  return Math.min(LINK_RATE_MAX, v).toFixed(1);
}

/** The heartbeat's keys: `cs` camera frames sent / s, `cr` received, `cd`
 *  drawn, `ce` the last error (for `ERROR_SHOWN_MS`). A half this page doesn't
 *  run stays out, so Run tells "none" from "doesn't apply". */
export function linkQuery(s: LinkSnapshot): Record<string, string> {
  const q: Record<string, string> = {};
  if (s.feeding) q["cs"] = rate(s.sent);
  if (s.watching) {
    q["cr"] = rate(s.received);
    q["cd"] = rate(s.drawn);
  }
  if (s.error !== null && s.error.agoMs <= ERROR_SHOWN_MS) q["ce"] = s.error.code;
  return q;
}

/** ⚙'s lines. `seen` is what the games' half read when ⚙ opened: the stream
 *  closes with the screen behind it. */
export function linkReadout(s: LinkSnapshot, seen: Pick<LinkSnapshot, "received" | "drawn" | "watching"> = s): string[] {
  const f = s.frame;
  const size = f === null ? "" : ` (${f.w} × ${f.h}, ${(f.bytes / 1024).toFixed(1)} KB${s.costMs > 0 ? `, ${Math.round(s.costMs)} ms each` : ""})`;
  const out = [s.feeding ? `camera to the games: ${rate(s.sent)} frames a second${size}` : "camera to the games: not sending from here"];
  out.push(seen.watching ? `the games to here: ${rate(seen.received)} frames a second, ${rate(seen.drawn)} drawn` : "the games to here: not watching");
  out.push(s.error === null ? "no errors" : `last error, ${Math.round(s.error.agoMs / 1000)} s ago: ${LINK_ERRORS[s.error.code]}`);
  return out;
}

/** The page's. */
export const linkStats = new LinkStats();
