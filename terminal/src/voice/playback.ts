//! The players this terminal hears (wave 19): each `voice` frame's 200 ms
//! of μ-law decoded, resampled up to the context's own rate in JS (old
//! WebKit refuses a 16 kHz `createBuffer`; the context's rate always works),
//! and scheduled as an `AudioBufferSourceNode` on the voices bus
//! (`sound/bus.ts`), one gain per player.
//!
//! A jitter buffer per player (`@loom/house` `jitterPlan`): the first chunk
//! (or one after an underrun) starts `PLAY_TARGET_MS` from now with a short
//! fade-in, the next ones queue right after it, and once more than
//! `PLAY_MAX_MS` is queued (a stalled Wi-Fi delivering a burst) the queue
//! not yet playing is dropped and the chunk starts at the target again — so
//! latency never creeps up over a night. A `bye` fades the player out.
//!
//! `playingUntil()` tells the microphone when the last of it ends, so the
//! uplink never sends a player back to the games.

import { Resampler, VOICE_RATE, jitterPlan, mulawDecode } from "@loom/house";
import type { SoundContext } from "../sound/bus.ts";

/** The jitter buffer each player aims for (ms). */
export const PLAY_TARGET_MS = 250;
/** More queued than this and the queue is cut back to the target (ms). */
export const PLAY_MAX_MS = 600;
/** The fade-in on a fresh start (ms of samples). */
export const FADE_IN_MS = 8;
/** A `bye`'s fade-out (s). */
export const BYE_FADE_S = 0.06;
/** At most this many players at once on one terminal (the server sends ≤ 3). */
export const MAX_SOURCES = 4;
/** A player silent this long gives its slot up to a new one (s). */
const STALE_S = 5;

export interface VoiceOut {
  ctx: SoundContext;
  out: AudioNode;
}

interface Scheduled {
  node: AudioBufferSourceNode;
  start: number;
  end: number;
}

interface Source {
  gain: GainNode;
  level: number;
  resampler: Resampler;
  /** Context seconds when the queued audio ends. */
  nextAt: number;
  nodes: Scheduled[];
}

/** The slice of a voice frame playback needs. */
export interface Heard {
  from: string;
  gain: number;
  data: Uint8Array;
}

export class VoicePlayback {
  private readonly sources = new Map<string, Source>();
  /** Context seconds when the last faded-out player went quiet. */
  private fadedAt = 0;

  constructor(
    private readonly out: () => VoiceOut | null,
    private readonly setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  ) {}

  /** Players heard right now. */
  get count(): number {
    return this.sources.size;
  }

  /** Play one chunk; false when it was dropped (no sound here yet, too many players, nothing decoded). */
  push(f: Heard): boolean {
    const o = this.out();
    if (o === null || o.ctx.state !== "running") return false;
    const { ctx } = o;
    const now = ctx.currentTime;
    let src = this.sources.get(f.from);
    if (src === undefined) {
      if (this.sources.size >= MAX_SOURCES) this.dropStale(now);
      if (this.sources.size >= MAX_SOURCES) return false;
      const gain = ctx.createGain();
      gain.gain.value = f.gain;
      gain.connect(o.out);
      src = { gain, level: f.gain, resampler: new Resampler(VOICE_RATE, ctx.sampleRate), nextAt: 0, nodes: [] };
      this.sources.set(f.from, src);
    }
    src.nodes = src.nodes.filter((s) => s.end > now);
    const plan = jitterPlan(Math.max(0, (src.nextAt - now) * 1000), { targetMs: PLAY_TARGET_MS, maxMs: PLAY_MAX_MS });
    if (plan.action === "skip") {
      // Cut what hasn't started; whatever is playing finishes.
      for (const s of src.nodes) if (s.start > now) stopNode(s.node, now);
      src.nodes = src.nodes.filter((s) => s.start <= now);
    }
    if (plan.action !== "queue") src.resampler.reset();
    const samples = src.resampler.push(mulawDecode(f.data));
    if (samples.length === 0) return false;
    if (plan.fadeIn) fadeIn(samples, Math.round((ctx.sampleRate * FADE_IN_MS) / 1000));
    const t = plan.action === "queue" ? src.nextAt : now + plan.at / 1000;
    if (f.gain !== src.level) {
      src.gain.gain.setValueAtTime(f.gain, t);
      src.level = f.gain;
    }
    const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buf.getChannelData(0).set(samples);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(src.gain);
    node.start(t);
    const end = t + samples.length / ctx.sampleRate;
    const s: Scheduled = { node, start: t, end };
    const mine = src;
    node.onended = () => {
      mine.nodes = mine.nodes.filter((x) => x !== s);
    };
    src.nodes.push(s);
    src.nextAt = end;
    return true;
  }

  /** A player went out of earshot: fade them out and forget them. */
  bye(from: string): void {
    const src = this.sources.get(from);
    if (src === undefined) return;
    this.sources.delete(from);
    const o = this.out();
    const now = o?.ctx.currentTime ?? 0;
    const g = src.gain.gain;
    g.setValueAtTime(src.level, now);
    g.linearRampToValueAtTime(0, now + BYE_FADE_S);
    for (const s of src.nodes) stopNode(s.node, now + BYE_FADE_S);
    this.fadedAt = Math.max(this.fadedAt, Math.min(src.nextAt, now + BYE_FADE_S));
    this.setTimer(() => {
      try {
        src.gain.disconnect();
      } catch {
        /* gone */
      }
    }, BYE_FADE_S * 1000 + 100);
  }

  /** Everyone out (the stream dropped, the link stopped). */
  clear(): void {
    for (const from of [...this.sources.keys()]) this.bye(from);
  }

  /** Context seconds when the last player audio scheduled here ends (0: none). */
  playingUntil(): number {
    let until = this.fadedAt;
    for (const s of this.sources.values()) until = Math.max(until, s.nextAt);
    return until;
  }

  private dropStale(now: number): void {
    for (const [from, s] of this.sources) if (s.nextAt < now - STALE_S) this.bye(from);
  }
}

function stopNode(node: AudioBufferSourceNode, when: number): void {
  try {
    node.stop(when);
  } catch {
    /* never started / already stopped */
  }
}

/** A linear fade over the first `n` samples, in place. */
export function fadeIn(samples: Float32Array, n: number): void {
  const k = Math.min(n, samples.length);
  for (let i = 0; i < k; i++) samples[i] = samples[i]! * (i / k);
}
