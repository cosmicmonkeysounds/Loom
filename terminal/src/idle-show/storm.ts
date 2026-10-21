//! The popup storm's trail (wave 17), pure: where the stamped window is
//! `t` ms into the storm — a bounce off every edge (two triangle waves at
//! seeded speeds), a pure function of time so nothing accumulates.

import { mix, mulberry32 } from "./rng.ts";

/** px a second, each axis (the box's own size picks the bounce count). */
const SPEED: readonly [number, number] = [420, 300];

function tri(v: number, span: number): number {
  if (span <= 0) return 0;
  const p = ((v % (2 * span)) + 2 * span) % (2 * span);
  return p <= span ? p : 2 * span - p;
}

/** The trail's top-left at `t` ms in a `w` × `h` room to move (0..w, 0..h). */
export function stormPath(t: number, w: number, h: number, seed: number): { x: number; y: number } {
  const r = mulberry32(mix(seed, 0x57));
  const kx = 0.8 + r() * 0.5;
  const ky = 0.8 + r() * 0.5;
  const s = Math.max(0, t) / 1000;
  return { x: tri(r() * w + s * SPEED[0] * kx, Math.max(0, w)), y: tri(r() * h + s * SPEED[1] * ky, Math.max(0, h)) };
}
