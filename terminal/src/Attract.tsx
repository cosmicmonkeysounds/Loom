//! Attract mode (OCT31 K-16): the full-screen rotation a terminal shows
//! while its character is hidden or asleep — the Mystify screensaver, and
//! every `SAVER_MS` one fake-1999 ad. No camera, no scanner, no line, no
//! character name: only the ⚙ (2 s hold) and the terminal's own name.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ADS, attractSlide, mystifyInit, mystifyStep, type Ad } from "./attract.ts";

/** ≤ 30 fps, ≤ 1.5× device pixels: an old tablet in an enclosure runs hot. */
const FRAME_MS = 1000 / 30;
const MAX_DPR = 1.5;

/** The Mystify screensaver on a Canvas2D. Pauses itself while the page is hidden. */
export function Mystify() {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d") ?? null;
    if (el === null || ctx === null) return;
    let w = 0;
    let h = 0;
    let shapes = mystifyInit(1, 1);
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      w = Math.max(1, el.clientWidth);
      h = Math.max(1, el.clientHeight);
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      shapes = mystifyInit(w, h);
    };
    resize();
    window.addEventListener("resize", resize);
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < FRAME_MS) return;
      last = t;
      mystifyStep(shapes, w, h);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 1.5;
      for (const s of shapes) {
        const outlines = [s.points, ...s.trail];
        outlines.forEach((pts, i) => {
          ctx.strokeStyle = `hsla(${s.hue}, 100%, 60%, ${1 - i / (outlines.length + 1)})`;
          ctx.beginPath();
          pts.forEach((p, j) => (j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.closePath();
          ctx.stroke();
        });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={canvas} className="mystify" aria-hidden="true" />;
}

/** Ads whose PNG failed to load this page-load: render their text card straight away. */
const missing = new Set<string>();

/** One ad: its PNG when present, else (or on error) a Win98 window with its copy. */
export function AdCard({ ad }: { ad: Ad }) {
  const [failed, setFailed] = useState(() => missing.has(ad.id));
  useEffect(() => setFailed(missing.has(ad.id)), [ad.id]);
  if (!failed) {
    return (
      <img
        className="ad-image"
        src={`${import.meta.env.BASE_URL}ads/${ad.id}.png`}
        alt={ad.title}
        onError={() => {
          missing.add(ad.id);
          setFailed(true);
        }}
      />
    );
  }
  return (
    <div className="ad-window" role="img" aria-label={ad.title}>
      <div className="ad-titlebar">
        <span>{ad.title}</span>
        <span className="ad-x">×</span>
      </div>
      <div className="ad-body">
        <p>{ad.body}</p>
        <span className="ad-button">{ad.button}</span>
      </div>
    </div>
  );
}

/** The full attract screen. `corner` is the terminal's name + its ⚙. */
export function Attract({ corner }: { corner: ReactNode }) {
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const slide = attractSlide(now - t0);
  return (
    <div className="terminal mirror attract-screen" data-attract={slide.kind}>
      {/* The saver keeps running under an ad, so it never restarts from scratch. */}
      <Mystify />
      {slide.kind === "ad" && (
        <div className="ad-stage">
          <AdCard ad={ADS[slide.index]!} />
        </div>
      )}
      {corner}
    </div>
  );
}
