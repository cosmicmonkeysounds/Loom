//! The kit's particles and stars, pure (wave 17): each particle is born at
//! a fixed time off its emitter's rate and flies a closed-form path, so the
//! state at `t` is computed, never stepped — no pool to warm, nothing lost
//! on a reload. `particlesAt` is what `Particles` / `Confetti` draw.

import { clamp01, noise1 } from "./time.ts";

export type ParticleShape = "dot" | "square" | "confetti" | "star" | "spark" | "bean" | "pixel";

/** A stream (or a burst: a short `start`→`end` with a high `rate`) of particles. Space is 0..1 of the canvas. */
export interface Emitter {
  /** Where they are born (0..1 of the canvas), with a scatter (`w` × `h`) round it. */
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** When it emits, ms into the scene. */
  start: number;
  end: number;
  /** Births per second. */
  rate: number;
  /** How long each lives (ms). */
  life: number;
  /** Launch speed (canvas heights / s) and its scatter (0..1). */
  speed: number;
  speedJitter?: number;
  /** Launch direction, degrees (0 = right, -90 = up), and the spread round it. */
  angle: number;
  spread: number;
  /** Downward pull (canvas heights / s²). */
  gravity?: number;
  /** Air: speed lost per second (0..1). */
  drag?: number;
  /** A side-to-side flutter (canvas widths), confetti's. */
  sway?: number;
  /** Size in px (at DPR 1) and its scatter. */
  size: number;
  sizeJitter?: number;
  colors: readonly string[];
  shape: ParticleShape;
  seed?: number;
  /** Fade over the last share of life (0..1; default 0.3). */
  fade?: number;
}

export interface Particle {
  x: number;
  y: number;
  size: number;
  color: string;
  alpha: number;
  /** Turn, radians. */
  rot: number;
  shape: ParticleShape;
  /** 0 → 1 over its life. */
  age: number;
  /** Velocity now (canvas units / s), for streaks. */
  vx: number;
  vy: number;
}

/** The ceiling: an old tablet draws at most this many at once. */
export const MAX_PARTICLES = 400;

/** Every particle alive at `t` (newest first when over `max`), aspect = canvas width / height. */
export function particlesAt(emitters: readonly Emitter[], t: number, aspect = 16 / 9, max = MAX_PARTICLES): Particle[] {
  const out: Particle[] = [];
  const cap = Math.min(MAX_PARTICLES, max);
  for (let e = emitters.length - 1; e >= 0 && out.length < cap; e--) {
    const em = emitters[e]!;
    if (em.rate <= 0 || t < em.start) continue;
    const every = 1000 / em.rate;
    const last = Math.floor((Math.min(t, em.end) - em.start) / every);
    const first = Math.max(0, Math.ceil((t - em.life - em.start) / every));
    const seed = (em.seed ?? e * 101 + 7) >>> 0;
    for (let k = last; k >= first && out.length < cap; k--) {
      const born = em.start + k * every;
      const dt = (t - born) / 1000;
      if (dt < 0 || dt * 1000 > em.life) continue;
      const r = (j: number) => noise1(seed, k * 8 + j);
      const ang = ((em.angle + (r(0) - 0.5) * em.spread) * Math.PI) / 180;
      const sp = em.speed * (1 + ((r(1) - 0.5) * 2 * (em.speedJitter ?? 0.3)));
      const drag = clamp01(em.drag ?? 0);
      // Distance under linear drag: v0 (1 - e^(-c t)) / c, c = -ln(1 - drag).
      const c = drag > 0 ? -Math.log(1 - drag * 0.999) : 0;
      const travel = c > 0 ? (1 - Math.exp(-c * dt)) / c : dt;
      const vNow = c > 0 ? Math.exp(-c * dt) : 1;
      const g = em.gravity ?? 0;
      const vx0 = (Math.cos(ang) * sp) / aspect;
      const vy0 = Math.sin(ang) * sp;
      const sway = (em.sway ?? 0) * Math.sin(dt * (3 + r(2) * 3) + r(3) * 6.28);
      const x = em.x + (r(4) - 0.5) * (em.w ?? 0) + vx0 * travel + sway / aspect;
      const y = em.y + (r(5) - 0.5) * (em.h ?? 0) + vy0 * travel + 0.5 * g * dt * dt;
      const age = (dt * 1000) / em.life;
      const fade = em.fade ?? 0.3;
      const alpha = fade <= 0 ? 1 : clamp01((1 - age) / fade);
      out.push({
        x,
        y,
        size: em.size * (1 + (r(6) - 0.5) * 2 * (em.sizeJitter ?? 0.3)),
        color: em.colors[Math.floor(r(7) * em.colors.length)] ?? "#fff",
        alpha,
        rot: (r(2) - 0.5) * 12 * dt + r(3) * 6.28,
        shape: em.shape,
        age,
        vx: vx0 * vNow,
        vy: vy0 * vNow + g * dt,
      });
    }
  }
  return out;
}

/** A confetti shower: cannons from both lower corners, then a fall across the top. */
export function confettiEmitters(start: number, dur: number, density = 1, seed = 1, colors: readonly string[] = CONFETTI_COLORS): Emitter[] {
  const rate = 60 * density;
  return [
    { x: 0.02, y: 1.02, start, end: start + 500, rate: rate * 2, life: 3200, speed: 1.65, speedJitter: 0.35, angle: -62, spread: 26, gravity: 0.9, drag: 0.55, sway: 0.02, size: 9, colors, shape: "confetti", seed: seed + 1 },
    { x: 0.98, y: 1.02, start, end: start + 500, rate: rate * 2, life: 3200, speed: 1.65, speedJitter: 0.35, angle: -118, spread: 26, gravity: 0.9, drag: 0.55, sway: 0.02, size: 9, colors, shape: "confetti", seed: seed + 2 },
    { x: 0.5, y: -0.04, w: 1.1, start: start + 300, end: start + dur, rate, life: 4200, speed: 0.12, angle: 90, spread: 30, gravity: 0.05, sway: 0.03, size: 8, colors, shape: "confetti", seed: seed + 3 },
  ];
}

export const CONFETTI_COLORS: readonly string[] = ["#ff5050", "#ffd23f", "#3ddc84", "#3fa7ff", "#c86bff", "#ffffff", "#ff9f1c"];

/** A star of a field: where it is (0..1 × 0..1, z 0 far … 1 near). */
export interface Star {
  x: number;
  y: number;
  z: number;
}

/**
 * The starfield at `t`: `count` stars flying toward the screen at `speed`
 * (depths / s), each wrapping back to the far plane. Projected to 0..1 of
 * the canvas, `scale` the near size.
 */
export function starsAt(count: number, t: number, speed: number, seed = 9): Array<{ x: number; y: number; z: number; px: number; py: number; ppx: number; ppy: number }> {
  const out: Array<{ x: number; y: number; z: number; px: number; py: number; ppx: number; ppy: number }> = [];
  const s = t / 1000;
  for (let i = 0; i < count; i++) {
    const x = noise1(seed, i * 3) * 2 - 1;
    const y = noise1(seed, i * 3 + 1) * 2 - 1;
    const z0 = noise1(seed, i * 3 + 2);
    const depth = (z: number) => ((z % 1) + 1) % 1;
    // z: 1 far → 0 at the glass.
    const z = 1 - depth(z0 + s * speed);
    const zPrev = Math.min(1, z + speed * 0.06);
    const proj = (zz: number) => 0.09 / Math.max(0.02, zz);
    out.push({ x, y, z, px: 0.5 + x * proj(z), py: 0.5 + y * proj(z), ppx: 0.5 + x * proj(zPrev), ppy: 0.5 + y * proj(zPrev) });
  }
  return out;
}
