//! Keeping a 2D canvas off the GPU, for the old tablets (wave 59).
//!
//! `willReadFrequently` says so on a current Chrome, but Chrome 95 never reads
//! the option: it sits behind `NewCanvas2DAPI`, off by default. There the way
//! is the read itself: `getImageData` on a canvas with a GPU buffer moves it to
//! software. That lasts until the next size change, which drops the buffer, and
//! the next buffer is on the GPU again. So every size change goes through
//! `sizeCanvas`. A small canvas is no exception: Chrome has no size floor for
//! the GPU (`AcceleratedSmallCanvases` is stable; the floor is WebView's).

export type ReadableContext = Pick<CanvasRenderingContext2D, "fillRect" | "clearRect" | "getImageData">;

/** Take this canvas off the GPU. The pixel is drawn first, because a canvas with
 *  no buffer yet has nothing to move, and cleared after, so it leaves no mark. */
export function softwareCanvas(ctx: ReadableContext): void {
  ctx.fillRect(0, 0, 1, 1);
  ctx.getImageData(0, 0, 1, 1);
  ctx.clearRect(0, 0, 1, 1);
}

/** Give a canvas its size, and keep it off the GPU. */
export function sizeCanvas(el: Pick<HTMLCanvasElement, "width" | "height">, ctx: ReadableContext, w: number, h: number): void {
  el.width = w;
  el.height = h;
  softwareCanvas(ctx);
}
