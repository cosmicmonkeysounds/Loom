//! The kit's timing, pure (wave 17). Every building block draws a function
//! of `t` (ms into its scene) — never a timer, never `Math.random` — so a
//! scene drawn twice at the same `t` is the same picture, a reload resumes
//! mid-animation, and the TV and every wall terminal stay in step.

// --- numbers -------------------------------------------------------------------------

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x: number): number => clamp(x, 0, 1);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** 0 → 1 over `[start, start + dur]` (ms), clamped. A zero `dur` is a step. */
export function progress(t: number, start: number, dur: number): number {
  if (dur <= 0) return t >= start ? 1 : 0;
  return clamp01((t - start) / dur);
}

/** Inside `[a, b)`? */
export const between = (t: number, a: number, b: number): boolean => t >= a && t < b;

/** 0 → 1 once every `period` ms. */
export function loop(t: number, period: number): number {
  if (period <= 0) return 0;
  const x = (t % period) / period;
  return x < 0 ? x + 1 : x;
}

/** On / off in steps: on for the first `duty` of every `period` (a caret, a 1 Hz blink). */
export function blink(t: number, period: number, duty = 0.5): boolean {
  return loop(t, period) < duty;
}

/** A smooth 0 → 1 → 0 pulse every `period` ms. */
export function pulse(t: number, period: number): number {
  return 0.5 - 0.5 * Math.cos(loop(t, period) * Math.PI * 2);
}

// --- easing ---------------------------------------------------------------------------

export type Ease = (k: number) => number;

export const ease = {
  linear: (k: number) => k,
  inQuad: (k: number) => k * k,
  outQuad: (k: number) => k * (2 - k),
  inOutQuad: (k: number) => (k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k),
  inCubic: (k: number) => k * k * k,
  outCubic: (k: number) => 1 - (1 - k) ** 3,
  inOutCubic: (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  /** Overshoots a little, then settles: a window popping open. */
  outBack: (k: number) => {
    const c = 1.70158;
    return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
  },
  outElastic: (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : 2 ** (-10 * k) * Math.sin((k * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (k: number) => {
    const n = 7.5625;
    const d = 2.75;
    if (k < 1 / d) return n * k * k;
    if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
    if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
    return n * (k -= 2.625 / d) * k + 0.984375;
  },
} satisfies Record<string, Ease>;

/** An eased 0 → 1 over a window. */
export function eased(t: number, start: number, dur: number, fn: Ease = ease.outCubic): number {
  return fn(progress(t, start, dur));
}

/**
 * Keyframes: `frames` sorted by `t`, each a set of numbers; the values at
 * `t` are interpolated between the frames around it (eased per segment),
 * held at either end.
 */
export function keyframes<K extends string>(t: number, frames: ReadonlyArray<{ t: number } & Record<K, number>>, fn: Ease = ease.inOutQuad): Record<K, number> {
  if (frames.length === 0) throw new Error("keyframes: no frames");
  const first = frames[0]!;
  const pick = (f: { t: number } & Record<K, number>): Record<K, number> => {
    const out = {} as Record<K, number>;
    for (const k of Object.keys(f) as Array<K | "t">) if (k !== "t") out[k] = f[k];
    return out;
  };
  if (t <= first.t) return pick(first);
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!;
    const b = frames[i]!;
    if (t <= b.t) {
      const k = fn(progress(t, a.t, b.t - a.t));
      const out = {} as Record<K, number>;
      for (const key of Object.keys(b) as Array<K | "t">) if (key !== "t") out[key] = lerp(a[key] ?? b[key], b[key], k);
      return out;
    }
  }
  return pick(frames[frames.length - 1]!);
}

// --- deterministic randomness ---------------------------------------------------------------

/** A seeded generator (mulberry32): the same seed, the same sequence, everywhere. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed off a string (FNV-1a 32): a scene seeds off its name or the program's. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** One random number for `(seed, i)`, without walking a sequence. */
export function noise1(seed: number, i: number): number {
  return rng((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0)();
}

// --- text ------------------------------------------------------------------------------------

export interface TypeOpts {
  /** When typing starts (ms into the scene). */
  start?: number;
  /** Characters per second. */
  cps?: number;
  /** Hesitate after punctuation (a sentence end ×6 chars, a comma ×3, a line break ×4). */
  pauses?: boolean;
}

/** The extra hesitation after a character, in characters' worth. */
function pauseAfter(ch: string): number {
  if (ch === "." || ch === "!" || ch === "?" || ch === "…") return 6;
  if (ch === "," || ch === ";" || ch === ":" || ch === "—") return 3;
  if (ch === "\n") return 4;
  return 0;
}

/** How many characters of `text` are typed at `t`. */
export function typedCount(text: string, t: number, o: TypeOpts = {}): number {
  const cps = o.cps ?? 30;
  const per = 1000 / Math.max(1, cps);
  let clock = t - (o.start ?? 0);
  if (clock <= 0) return 0;
  if (o.pauses === false) return Math.min(text.length, Math.floor(clock / per));
  for (let i = 0; i < text.length; i++) {
    clock -= per;
    if (clock < 0) return i;
    clock -= pauseAfter(text[i]!) * per;
    if (clock < 0) return i + 1;
  }
  return text.length;
}

/** How long `text` takes to type, start included (ms). */
export function typedDuration(text: string, o: TypeOpts = {}): number {
  const per = 1000 / Math.max(1, o.cps ?? 30);
  let ms = 0;
  for (const ch of text) ms += per + (o.pauses === false ? 0 : pauseAfter(ch) * per);
  return (o.start ?? 0) + ms;
}

// --- numbers that move -----------------------------------------------------------------------

/** A count-up from `from` to `to` over `[start, start + dur]`, eased (rounded by the caller). */
export function countUp(t: number, from: number, to: number, start: number, dur: number, fn: Ease = ease.outCubic): number {
  return lerp(from, to, fn(progress(t, start, dur)));
}

/**
 * A Windows-style progress bar over `dur` ms: it lurches — fast stretches,
 * `stalls` dead stops (one near the end, always), never backwards — and
 * reaches 1 exactly at `dur`.
 */
export function fakeProgress(t: number, dur: number, seed = 1, stalls = 3): number {
  if (t <= 0) return 0;
  if (t >= dur) return 1;
  const r = rng(seed);
  // Segment ends (time share → value share), the last stall parked at 97 %.
  const n = Math.max(2, stalls * 2 + 1);
  const times: number[] = [];
  const values: number[] = [];
  let tt = 0;
  let vv = 0;
  for (let i = 0; i < n; i++) {
    const stall = i % 2 === 1;
    tt += 0.4 + r() * (stall ? 1.2 : 1);
    vv += stall ? 0 : 0.3 + r();
    times.push(tt);
    values.push(vv);
  }
  const tScale = 1 / tt;
  const vScale = 0.97 / vv;
  let prevT = 0;
  let prevV = 0;
  const k = t / dur;
  for (let i = 0; i < n; i++) {
    const segT = times[i]! * tScale;
    const segV = values[i]! * vScale;
    if (k <= segT) return lerp(prevV, segV, progress(k, prevT, segT - prevT));
    prevT = segT;
    prevV = segV;
  }
  return lerp(0.97, 1, progress(k, prevT, 1 - prevT));
}

/** A scrolling strip's offset (px) at `t`: `speed` px/s, wrapping every `span` px. */
export function marqueeX(t: number, speed: number, span: number): number {
  if (span <= 0) return 0;
  const x = ((t / 1000) * speed) % span;
  return x < 0 ? x + span : x;
}

/** A countdown's readout: `m:ss` (`h:mm:ss` past an hour), and its tenths. */
export function countdownParts(ms: number): { h: number; m: number; s: number; tenths: number; text: string } {
  const left = Math.max(0, ms);
  const total = Math.floor(left / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const tenths = Math.floor((left % 1000) / 100);
  const ss = String(s).padStart(2, "0");
  return { h, m, s, tenths, text: h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}` };
}

// --- schedules -------------------------------------------------------------------------------

/** One window of a popup storm. Positions are 0..1 of the area (the window's top-left). */
export interface StormPop {
  i: number;
  at: number;
  x: number;
  y: number;
  /** Which of the caller's messages / kinds (0..n-1, by seed). */
  pick: number;
}

/**
 * When and where each of `count` popups lands: slow at first, then faster
 * and faster (a pile-up), cascading down-right like a stuck error and
 * scattered by the seed. Pure: the same storm on every screen.
 */
export function stormSchedule(seed: number, count: number, start: number, span: number): StormPop[] {
  const r = rng(seed);
  const out: StormPop[] = [];
  let cx = 0.08 + r() * 0.2;
  let cy = 0.06 + r() * 0.15;
  for (let i = 0; i < count; i++) {
    const k = count <= 1 ? 0 : i / (count - 1);
    const at = start + span * Math.sqrt(k);
    // Mostly the cascade; every so often a jump somewhere else.
    if (r() < 0.22) {
      cx = 0.04 + r() * 0.6;
      cy = 0.04 + r() * 0.5;
    } else {
      cx += 0.025 + r() * 0.02;
      cy += 0.03 + r() * 0.025;
      if (cx > 0.66) cx = 0.04 + r() * 0.1;
      if (cy > 0.6) cy = 0.03 + r() * 0.1;
    }
    out.push({ i, at, x: cx, y: cy, pick: Math.floor(r() * 1e6) });
  }
  return out;
}

/** The cue times crossed going from `prev` to `t` (ms), only those within `slack` of `t` (a reload never fires old ones). */
export function cuesDue(prev: number, t: number, times: readonly number[], slack = 500): number[] {
  if (t <= prev) return [];
  return times.filter((c) => c > prev && c <= t && t - c <= slack);
}

/** The hourglass: sand left on top (1 → 0) and the turn (0 → 180°) at the end of each period. */
export function hourglass(t: number, period = 2400, turn = 400): { sand: number; angle: number } {
  const p = Math.max(turn + 1, period);
  const local = ((t % p) + p) % p;
  const flowing = p - turn;
  if (local < flowing) return { sand: 1 - local / flowing, angle: 0 };
  return { sand: 0, angle: 180 * ease.inOutQuad((local - flowing) / turn) };
}
