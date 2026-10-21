//! The screensavers' canvas (wave 17): one Canvas2D the size of its box at
//! ≤ 1.5× device pixels, stepping and drawing the current saver at ≤ 30 fps
//! (≤ 12 with reduced motion, and slower). The loop stops — not throttles —
//! while the show is inactive (a pass connecting, a line open) or the page is
//! hidden. Also the storm's trail: one error window stamped along a bouncing
//! path and never cleared, the old "windows everywhere" glitch, on a canvas.

import { useEffect, useRef, type MutableRefObject } from "react";
import { frameDue } from "../cutscene/clock.ts";
import { mix, mulberry32 } from "./rng.ts";
import { saverOf, type SaverEvent, type SaverInstance } from "./savers/index.ts";
import { stormPath } from "./storm.ts";

/** ≤ 1.5× device pixels: an old tablet in an enclosure runs hot. */
export const MAX_DPR = 1.5;
export const SAVER_FPS = 30;
export const REDUCED_FPS = 12;

export interface SaverHandle {
  poke(x: number, y: number): void;
}

interface Box {
  w: number;
  h: number;
}

/** Size a canvas to its CSS box; returns the CSS size. */
function fit(el: HTMLCanvasElement, ctx: CanvasRenderingContext2D): Box {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const w = Math.max(1, el.clientWidth);
  const h = Math.max(1, el.clientHeight);
  el.width = Math.round(w * dpr);
  el.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}

/** Run `frame(dt)` at ≤ `fps` while `on()` and the page is visible; returns a stop. */
function loop(fps: number, on: () => boolean, frame: (dt: number) => void): () => void {
  let raf = 0;
  let last = 0;
  const tick = (ts: number) => {
    raf = window.requestAnimationFrame(tick);
    if (!frameDue(last, ts, fps)) return;
    // dt in frames of 30 fps, capped: a long stall never teleports a saver.
    const dt = last === 0 ? 1 : Math.min(3, ((ts - last) / 1000) * 30);
    last = ts;
    frame(dt);
  };
  const start = () => {
    window.cancelAnimationFrame(raf);
    last = 0;
    if (document.hidden || !on()) return;
    raf = window.requestAnimationFrame(tick);
  };
  const onVis = () => (document.hidden ? window.cancelAnimationFrame(raf) : start());
  start();
  document.addEventListener("visibilitychange", onVis);
  return () => {
    window.cancelAnimationFrame(raf);
    document.removeEventListener("visibilitychange", onVis);
  };
}

function useResize(cb: () => void, el: MutableRefObject<HTMLCanvasElement | null>): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const c = el.current;
    if (c === null) return;
    let last = `${c.clientWidth}x${c.clientHeight}`;
    const on = () => {
      const now = `${c.clientWidth}x${c.clientHeight}`;
      if (now === last) return;
      last = now;
      ref.current();
    };
    const RO = (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (RO !== undefined) {
      const ro = new RO(on);
      ro.observe(c);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [el]);
}

export function SaverCanvas({ saver, seed, active, reduced, handle, onEvent }: { saver: string; seed: number; active: boolean; reduced: boolean; handle: MutableRefObject<SaverHandle | null>; onEvent?: (e: SaverEvent) => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const inst = useRef<{ s: SaverInstance; box: Box; ctx: CanvasRenderingContext2D } | null>(null);
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;
  const make = () => {
    const el = canvas.current;
    const ctx = el?.getContext("2d") ?? null;
    if (el === null || ctx === null) return;
    const box = fit(el, ctx);
    inst.current = { s: saverOf(saver).create(box.w, box.h, mulberry32(mix(seed, box.w, box.h))), box, ctx };
    inst.current.s.draw(ctx); // a first frame, even before the loop (or with none: inactive)
  };
  useEffect(() => {
    make();
    return () => {
      inst.current = null;
    };
  }, [saver, seed]);
  useResize(make, canvas);
  useEffect(() => {
    handle.current = {
      poke: (x, y) => {
        const i = inst.current;
        if (i === null) return;
        i.s.poke(x, y);
        if (!active) i.s.draw(i.ctx);
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle, active]);
  useEffect(
    () =>
      loop(
        reduced ? REDUCED_FPS : SAVER_FPS,
        () => active,
        (dt) => {
          const i = inst.current;
          if (i === null) return;
          i.s.step(reduced ? dt * 0.4 : dt);
          i.s.draw(i.ctx);
          for (const e of i.s.events()) eventRef.current?.(e);
        },
      ),
    [active, reduced, saver, seed],
  );
  return <canvas ref={canvas} className={`idle-saver saver-${saver}`} aria-hidden="true" />;
}

// --- the storm's trail --------------------------------------------------------------------

/** One small error window, drawn once onto its own canvas. */
function errorSprite(scale: number): HTMLCanvasElement {
  const w = Math.round(150 * scale);
  const h = Math.round(64 * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g === null) return c;
  const s = scale;
  g.fillStyle = "#c0c0c0";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, 2 * s);
  g.fillRect(0, 0, 2 * s, h);
  g.fillStyle = "#404040";
  g.fillRect(0, h - 2 * s, w, 2 * s);
  g.fillRect(w - 2 * s, 0, 2 * s, h);
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#000080");
  grad.addColorStop(1, "#1084d0");
  g.fillStyle = grad;
  g.fillRect(3 * s, 3 * s, w - 6 * s, 14 * s);
  g.fillStyle = "#fff";
  g.font = `bold ${Math.round(10 * s)}px Tahoma, sans-serif`;
  g.textBaseline = "middle";
  g.fillText("Error", 7 * s, 10 * s);
  g.fillStyle = "#ff0000";
  g.beginPath();
  g.arc(18 * s, 39 * s, 10 * s, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#fff";
  g.lineWidth = 3 * s;
  g.beginPath();
  g.moveTo(13 * s, 34 * s);
  g.lineTo(23 * s, 44 * s);
  g.moveTo(23 * s, 34 * s);
  g.lineTo(13 * s, 44 * s);
  g.stroke();
  g.fillStyle = "#000";
  g.font = `${Math.round(10 * s)}px Tahoma, sans-serif`;
  g.fillText("A fatal exception", 34 * s, 34 * s);
  g.fillText("has occurred.", 34 * s, 46 * s);
  return c;
}

export function StormTrail({ seed, active, reduced }: { seed: number; active: boolean; reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d") ?? null;
    if (el === null || ctx === null || reduced) return;
    const box = fit(el, ctx);
    const sprite = errorSprite(Math.max(1, Math.min(box.w, box.h) / 420));
    const t0 = Date.now();
    return loop(
      SAVER_FPS,
      () => active,
      () => {
        const p = stormPath(Date.now() - t0, box.w - sprite.width, box.h - sprite.height, seed);
        ctx.drawImage(sprite, p.x, p.y);
      },
    );
  }, [seed, active, reduced]);
  return <canvas ref={canvas} className="idle-storm-trail" aria-hidden="true" />;
}
