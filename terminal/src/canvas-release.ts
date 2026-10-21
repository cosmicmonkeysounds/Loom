//! Canvas memory on old iPads (wave 17, OB-7). WebKit frees a canvas's
//! backing store only at GC and caps the total; the idle show mounts a new
//! saver canvas every segment (≈ 1000 a night) and every scene its own, so
//! each is shrunk to 0 × 0 when it goes, and a canvas the browser refuses
//! a context (the cap hit) is said once in the log instead of a silent black.

/** Hand a canvas's backing store back (0 × 0) as it unmounts. */
export function releaseCanvas(c: HTMLCanvasElement | null | undefined): void {
  if (c === null || c === undefined) return;
  c.width = 0;
  c.height = 0;
}

let warned = false;

/** A 2D context, or null with one warning a page (the canvas memory cap). */
export function context2d(c: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null {
  const ctx = c.getContext("2d", opts);
  if (ctx === null && !warned) {
    warned = true;
    console.warn("terminal: a canvas got no 2D context (out of canvas memory?)");
  }
  return ctx;
}
