//! His voice on the CRT (wave 52b), in place of the face: thick bars rolling
//! across the top of the screen while he talks, a flat line while he doesn't.
//! It takes the face's handle, so the speech queue feeds it the same levels.

import { useEffect, useRef, type MutableRefObject } from "react";
import type { FaceHandle } from "../face/Face.tsx";

const BARS = 20;
/** One new bar this often (ms). */
const STEP_MS = 70;
/** The level that fills the bar's height. */
const FULL = 0.3;

export function Wave({ handle }: { handle: MutableRefObject<FaceHandle | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let level = 0;
    handle.current = { level: (v) => void (level = v), flash: () => {} };
    const bars = new Array<number>(BARS).fill(0);
    const el = canvas.current;
    const g = el?.getContext("2d") ?? null;
    let raf = 0;
    let last = 0;
    let flat = false;
    const draw = () => {
      if (el === null || g === null) return;
      const w = el.width;
      const h = el.height;
      const step = w / BARS;
      g.clearRect(0, 0, w, h);
      g.fillStyle = "#fff";
      // The line it all stands on, thick enough for an interlaced tube.
      g.fillRect(0, h / 2 - 2, w, 4);
      bars.forEach((b, i) => {
        const bar = b * h;
        g.fillRect(i * step, (h - bar) / 2, step * 0.7, bar);
      });
    };
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      if (ts - last < STEP_MS) return;
      last = ts;
      bars.push(Math.min(1, level / FULL));
      bars.shift();
      const quiet = bars.every((b) => b === 0);
      if (quiet && flat) return;
      flat = quiet;
      draw();
    };
    draw();
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      handle.current = null;
    };
  }, [handle]);
  return <canvas ref={canvas} className="crt-wave" width={300} height={40} aria-hidden="true" />;
}
