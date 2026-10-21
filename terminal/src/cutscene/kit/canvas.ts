//! A canvas that fills its box at a capped pixel ratio (≤ 1.5: an old
//! tablet in an enclosure runs hot) and redraws when its picture's inputs
//! change — the scene's clock already paces the frames (≤ 30 fps).

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { context2d, releaseCanvas } from "../../canvas-release.ts";

/** The pixel-ratio cap for every kit canvas. */
export const MAX_DPR = 1.5;

export interface CanvasSize {
  /** CSS pixels. */
  w: number;
  h: number;
  dpr: number;
}

/**
 * `draw(ctx, size)` on every change of `deps` (pass `t`), into a canvas
 * sized to its CSS box. `pixel` draws at `pixel` × the CSS size (a chunky
 * low-res look, scaled up with `image-rendering: pixelated`).
 */
export function useCanvas(draw: (ctx: CanvasRenderingContext2D, size: CanvasSize) => void, deps: readonly unknown[], pixel?: number): RefObject<HTMLCanvasElement> {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useRef<CanvasSize>({ w: 0, h: 0, dpr: 1 });
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const paint = () => {
    const c = ref.current;
    if (c === null) return;
    const s = size.current;
    if (s.w === 0 || s.h === 0) return;
    const ctx = context2d(c);
    if (ctx === null) return;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    drawRef.current(ctx, s);
  };
  // Follow the box (ResizeObserver where there is one — Safari 13.1+ / Chrome 64+ — else the window).
  useLayoutEffect(() => {
    const c = ref.current;
    if (c === null) return;
    const measure = () => {
      const w = c.clientWidth;
      const h = c.clientHeight;
      const dpr = pixel !== undefined ? pixel : Math.min(MAX_DPR, window.devicePixelRatio || 1);
      if (w === size.current.w && h === size.current.h && dpr === size.current.dpr) return;
      size.current = { w, h, dpr };
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      paint();
    };
    measure();
    const RO = (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (RO !== undefined) {
      const ro = new RO(measure);
      ro.observe(c);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [pixel]);
  useEffect(paint, deps);
  // Unmount only (a scene's canvases go with it): give their memory back.
  useEffect(
    () => () => {
      releaseCanvas(ref.current);
      size.current = { w: 0, h: 0, dpr: 1 }; // a remount (StrictMode) measures afresh
    },
    [],
  );
  return ref;
}
