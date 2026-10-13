//! Pose interpolation for remote players — pure, no three. A terminal or a
//! game receives poses at ~10 Hz (`poses` stream frames) and renders a
//! little behind real time (`delay`, ~120 ms), so there is almost always a
//! sample on each side to interpolate between: linear position + pitch,
//! shortest-arc yaw. Past the newest sample it extrapolates along the last
//! velocity for at most `maxExtrapolate`, then eases back onto the newest
//! sample over another `maxExtrapolate` and settles there — a dropped frame
//! glides instead of freezing, and a player who stopped (the server sends
//! only poses that changed, so their last sample stays the last) is drawn
//! exactly where they stand. The velocity's span is floored at `minSpan`
//! (two frames delivered in one chunk get receipt stamps µs apart) and the
//! lead is capped at `maxLead` metres / `maxTurn` degrees, so a burst of
//! frames can never fling a ghost through a wall.
//!
//! Time units are the caller's (milliseconds by convention — the defaults
//! assume them); every `t` given to one buffer must use the same clock.

import { wrapYaw } from "../frames.ts";
import type { PlayerPose, Vec3 } from "../types.ts";

export interface PoseBufferOptions {
  /** How far behind `t` a sample renders (default 120). */
  delay?: number;
  /** The longest extrapolation past the newest sample (default 100); it then eases back over as long again. */
  maxExtrapolate?: number;
  /** Samples kept at most (default 64). */
  capacity?: number;
  /**
   * The shortest span the extrapolation velocity is measured over (default
   * 100, the nominal 10 Hz interval): clustered arrivals can't inflate it.
   */
  minSpan?: number;
  /** The furthest an extrapolated position leads the newest sample, in metres (default 0.3). */
  maxLead?: number;
  /** The most an extrapolated yaw / pitch turns past the newest sample, in degrees (default 30). */
  maxTurn?: number;
}

interface Sample {
  t: number;
  pose: PlayerPose;
}

/** Yaw (degrees) a fraction `f` of the shortest arc from `a` to `b`, wrapped. */
export function lerpYaw(a: number, b: number, f: number): number {
  return wrapYaw(a + wrapYaw(b - a) * f);
}

function lerp3(a: Vec3, b: Vec3, f: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function copyPose(pose: PlayerPose): PlayerPose {
  return { p: [pose.p[0], pose.p[1], pose.p[2]], yaw: wrapYaw(pose.yaw), pitch: pose.pitch };
}

/** A time-ordered buffer of one player's poses, sampled with a delay. */
export class PoseBuffer {
  readonly delay: number;
  readonly maxExtrapolate: number;
  readonly capacity: number;
  readonly minSpan: number;
  readonly maxLead: number;
  readonly maxTurn: number;
  private samples: Sample[] = [];

  constructor(opts: PoseBufferOptions = {}) {
    this.delay = opts.delay ?? 120;
    this.maxExtrapolate = opts.maxExtrapolate ?? 100;
    this.capacity = Math.max(2, opts.capacity ?? 64);
    this.minSpan = Math.max(0, opts.minSpan ?? 100);
    this.maxLead = Math.max(0, opts.maxLead ?? 0.3);
    this.maxTurn = Math.max(0, opts.maxTurn ?? 30);
  }

  get size(): number {
    return this.samples.length;
  }

  /** The newest sample, if any. */
  latest(): { t: number; pose: PlayerPose } | null {
    const s = this.samples[this.samples.length - 1];
    return s ? { t: s.t, pose: copyPose(s.pose) } : null;
  }

  clear(): void {
    this.samples = [];
  }

  /** Add a pose at time `t` (out of order is fine; the same `t` replaces). */
  push(t: number, pose: PlayerPose): void {
    if (!Number.isFinite(t)) return;
    const sample = { t, pose: copyPose(pose) };
    let i = this.samples.length;
    while (i > 0 && this.samples[i - 1]!.t > t) i--;
    if (i > 0 && this.samples[i - 1]!.t === t) this.samples[i - 1] = sample;
    else this.samples.splice(i, 0, sample);
    if (this.samples.length > this.capacity) this.samples.splice(0, this.samples.length - this.capacity);
  }

  /** The pose to render at time `t` (i.e. at `t − delay`); null when empty. */
  sample(t: number): PlayerPose | null {
    const s = this.samples;
    const first = s[0];
    if (!first) return null;
    const target = t - this.delay;
    if (target <= first.t) return copyPose(first.pose);
    const last = s[s.length - 1]!;
    if (target >= last.t) {
      const prev = s[s.length - 2];
      const m = this.maxExtrapolate;
      const dt = target - last.t;
      if (!prev || !(m > 0) || dt >= 2 * m) return copyPose(last.pose);
      const span = Math.max(last.t - prev.t, this.minSpan);
      // f ≥ 0 past `last`: the same line through prev → last, continued for
      // up to `m`, then eased back to `last` over another `m`.
      const f = dt <= m ? dt / span : (m / span) * Math.max(0, 1 - (dt - m) / m);
      const [lp, pp] = [last.pose.p, prev.pose.p];
      let d: Vec3 = [(lp[0] - pp[0]) * f, (lp[1] - pp[1]) * f, (lp[2] - pp[2]) * f];
      const len = Math.hypot(d[0], d[1], d[2]);
      if (len > this.maxLead) {
        const k = len > 0 ? this.maxLead / len : 0;
        d = [d[0] * k, d[1] * k, d[2] * k];
      }
      const turn = (v: number): number => Math.max(-this.maxTurn, Math.min(this.maxTurn, v));
      return {
        p: [lp[0] + d[0], lp[1] + d[1], lp[2] + d[2]],
        yaw: wrapYaw(last.pose.yaw + turn(wrapYaw(last.pose.yaw - prev.pose.yaw) * f)),
        pitch: last.pose.pitch + turn((last.pose.pitch - prev.pose.pitch) * f),
      };
    }
    let i = 1;
    while (s[i]!.t < target) i++;
    const a = s[i - 1]!;
    const b = s[i]!;
    // Samples before `a` are never needed again (time only moves forward).
    if (i > 1) s.splice(0, i - 1);
    const f = (target - a.t) / (b.t - a.t);
    return {
      p: lerp3(a.pose.p, b.pose.p, f),
      yaw: lerpYaw(a.pose.yaw, b.pose.yaw, f),
      pitch: a.pose.pitch + (b.pose.pitch - a.pose.pitch) * f,
    };
  }
}
