//! A screensaver (wave 17): made at a size with a seeded random, then
//! stepped and drawn once a frame (≤ 30 fps, `SaverCanvas.tsx`) on a
//! Canvas2D. `step` is pure state — the tests run thousands of frames and
//! check everything stays on screen; `draw` only paints. A tap pokes it.

export type Rand = () => number;

/** Something a saver did that the show may ring a sound for. */
export type SaverEvent = "corner" | "quack" | "solved" | "burst";

export interface SaverInstance {
  /** One frame; `dt` in frames of a nominal 30 fps (1 ≈ 33 ms; reduced motion steps less). */
  step(dt: number): void;
  /** Paint the frame (a saver that draws over its last frame clears on its own first draw). */
  draw(ctx: CanvasRenderingContext2D): void;
  /** A tap at (x, y), CSS px. */
  poke(x: number, y: number): void;
  /** What happened since the last call. */
  events(): SaverEvent[];
}

export interface SaverDef {
  id: string;
  name: string;
  create(w: number, h: number, rand: Rand): SaverInstance;
}

/** Clamp `v` into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A small event queue every saver uses. */
export class Events {
  private q: SaverEvent[] = [];
  push(e: SaverEvent): void {
    if (this.q.length < 8) this.q.push(e);
  }
  drain(): SaverEvent[] {
    const out = this.q;
    this.q = [];
    return out;
  }
}
