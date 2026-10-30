//! The data mosh (wave 49), pure: a datamosh is what a video does when its
//! keyframes are lost, its old pixels dragged along by the new picture's
//! motion in blocks. A browser can't read a page's pixels, so this one runs on
//! a small canvas over the screen: most of it is see-through, and the live
//! page shows crisp where it is. Each `MOSH_CYCLE_MS` is a keyframe and what
//! follows it: `MOSH_CLEAN` of the cycle the scene alone (it stays readable),
//! then macroblocks go bad in islands, each one dragging the pixels of a copy
//! of the scene (`stamp.ts`) a little further every tick, the dream's picture
//! bleeding in over them, some blocks only its colour. At most `MOSH_PEAK` of
//! the screen; then the next keyframe wipes it clean.
//!
//! It draws with plain 2D `drawImage` on a canvas a few hundred pixels wide
//! (scaled up pixelated: the blocks are the look), so the oldest tablet runs
//! it, and it unmounts when nothing is getting through. Nothing flashes: a
//! cycle is 6 s and a block's change is gradual (≤ 3 Hz, no red field).

import { hash32, mix, roll } from "../idle-show/rng.ts";

/** A keyframe and everything lost after it (ms). */
export const MOSH_CYCLE_MS = 6400;
/** The share of a cycle the scene stands clean. */
export const MOSH_CLEAN = 0.18;
/** The most of the screen that ever goes bad in a cycle. */
export const MOSH_PEAK = 0.55;
/** When the last of those blocks has gone (the rest of the cycle holds). */
const MOSH_LAST = 0.86;
/** How often the copy of the scene is taken again (ms): it moves. */
export const MOSH_STAMP_MS = 1500;

export interface MoshGrid {
  cols: number;
  rows: number;
  /** Pixels a block, on the small canvas. */
  block: number;
  /** Ticks a second. */
  fps: number;
}

/** The TV has the machine for finer blocks and a faster melt. */
export const MOSH_GRIDS: Readonly<Record<"tv" | "wall", MoshGrid>> = {
  tv: { cols: 64, rows: 36, block: 6, fps: 20 },
  wall: { cols: 32, rows: 18, block: 8, fps: 12 },
};

export interface MoshPlan {
  grid: MoshGrid;
  /** The phase (0–1) each block goes bad at; Infinity: not this cycle. */
  births: Float32Array;
  /** Its drag, small-canvas pixels a tick. */
  dx: Int8Array;
  dy: Int8Array;
  /** 1: it takes only the dream's colour. */
  chroma: Uint8Array;
}

/** Blocks move together: a drag and a fate are the island's, not the block's. */
const ISLAND_COLS = 6;
const ISLAND_ROWS = 4;

/**
 * A cycle's plan: which blocks go, when and which way. `share` of the screen,
 * first going at phase `from`, last at `to`. A pure function of (seed, cycle),
 * so no two terminals rot alike and a rerun rots the same.
 */
export function moshPlan(seed: number, cycle: number, grid: MoshGrid, share = MOSH_PEAK, from = MOSH_CLEAN, to = MOSH_LAST): MoshPlan {
  const { cols, rows } = grid;
  const n = cols * rows;
  const key = mix(seed, cycle);
  const score = new Float32Array(n);
  const dx = new Int8Array(n);
  const dy = new Int8Array(n);
  const chroma = new Uint8Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const ix = Math.floor(c / ISLAND_COLS);
      const iy = Math.floor(r / ISLAND_ROWS);
      score[i] = roll(key, ix, iy) * 0.72 + roll(key, c, r, 7) * 0.28;
      // Mostly down, like a picture melting; some islands slide sideways.
      const a = roll(key, ix, iy, 3);
      const b = roll(key, ix, iy, 4);
      dx[i] = Math.round((a - 0.5) * 5);
      dy[i] = b < 0.7 ? 1 + Math.floor(a * 2) : b < 0.85 ? 0 : -1;
      chroma[i] = roll(key, ix, iy, 5) < 0.3 ? 1 : 0;
    }
  }
  const ranked = Array.from(score).sort((p, q) => p - q);
  const lo = ranked[0] ?? 0;
  const cut = ranked[Math.min(n - 1, Math.max(0, Math.ceil(share * n) - 1))] ?? 1;
  const span = cut - lo > 0 ? cut - lo : 1;
  const births = new Float32Array(n);
  for (let i = 0; i < n; i++) births[i] = score[i]! > cut ? Number.POSITIVE_INFINITY : from + ((to - from) * (score[i]! - lo)) / span;
  return { grid, births, dx, dy, chroma };
}

/** The share of the screen gone at `phase` in `plan`. */
export function moshCoverage(plan: MoshPlan, phase: number): number {
  let bad = 0;
  for (const b of plan.births) if (b <= phase) bad += 1;
  return bad / plan.births.length;
}

/** Which cycle `elapsed` ms falls in, and how far through it. */
export function moshCycleAt(elapsed: number): { n: number; phase: number } {
  const t = Math.max(0, elapsed);
  return { n: Math.floor(t / MOSH_CYCLE_MS), phase: (t % MOSH_CYCLE_MS) / MOSH_CYCLE_MS };
}

/** How much of the dream shows on a block `age` of a cycle after it went. */
export type MoshBleed = (age: number) => number;
export const rotBleed: MoshBleed = (age) => Math.min(0.8, age * 2.4);
export const takeBleed: MoshBleed = (age) => Math.min(1, age * 6);

/** A terminal's mosh seed: its name's, so no two walls agree. */
export const moshSeed = (key: string): number => hash32(key);

/** What `drawMosh` needs of a 2D context (`test/dream-mosh.test.ts` records one). */
export interface MoshCtx {
  globalAlpha: number;
  globalCompositeOperation: string;
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(src: never, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
}

/**
 * One tick on `ctx`, the back buffer. A block that just went (`was` < its
 * birth ≤ `phase`) takes the scene's pixels; a block already gone drags its
 * own from the last tick (`prev`), which is the smear; then the dream bleeds
 * over it. Neighbouring blocks that move alike are one `drawImage`. Returns
 * how many it took.
 */
export function drawMosh<S>(ctx: MoshCtx, plan: MoshPlan, o: { phase: number; was: number; scene: S | null; prev: S; dream: S | null; bleed: MoshBleed }): number {
  const { cols, rows, block } = plan.grid;
  const c2 = ctx as unknown as { drawImage(s: S, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void };
  ctx.clearRect(0, 0, cols * block, rows * block);
  let runs = 0;
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      const i = r * cols + c;
      const born = plan.births[i]!;
      if (born > o.phase) {
        c += 1;
        continue;
      }
      const fresh = born > o.was;
      let end = c + 1;
      while (end < cols) {
        const j = r * cols + end;
        if (plan.births[j]! > o.phase || plan.dx[j] !== plan.dx[i] || plan.dy[j] !== plan.dy[i] || plan.chroma[j] !== plan.chroma[i] || plan.births[j]! > o.was !== fresh) break;
        end += 1;
      }
      const x = c * block;
      const y = r * block;
      const w = (end - c) * block;
      const mx = plan.dx[i]!;
      const my = plan.dy[i]!;
      const from = fresh ? o.scene : o.prev;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      if (from !== null) c2.drawImage(from, x - mx, y - my, w, block, x, y, w, block);
      const a = o.bleed(o.phase - born);
      if (o.dream !== null && a > 0) {
        ctx.globalAlpha = a;
        ctx.globalCompositeOperation = plan.chroma[i] === 1 ? "color" : "source-over";
        c2.drawImage(o.dream, x - mx * 3, y - my * 3, w, block, x, y, w, block);
      }
      runs += 1;
      c = end;
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return runs;
}
