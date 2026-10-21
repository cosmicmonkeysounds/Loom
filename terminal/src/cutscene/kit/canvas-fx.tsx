//! The canvas effects (wave 17): particles (≤ 400, closed-form paths off
//! `physics.ts`), confetti, the starfield. Each fills its parent and draws
//! the picture at `t` — the scene's clock paces the frames.

import type { CSSProperties } from "react";
import { useCanvas } from "./canvas.ts";
import { MAX_PARTICLES, confettiEmitters, particlesAt, starsAt, type Emitter, type Particle } from "./physics.ts";

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle, w: number, h: number): void {
  const x = p.x * w;
  const y = p.y * h;
  const s = p.size;
  ctx.globalAlpha = p.alpha;
  ctx.fillStyle = p.color;
  ctx.strokeStyle = p.color;
  switch (p.shape) {
    case "dot":
      ctx.beginPath();
      ctx.arc(x, y, s / 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "pixel":
      ctx.fillRect(Math.round(x), Math.round(y), s, s);
      break;
    case "square":
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot);
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
      break;
    case "confetti": {
      // A paper strip turning over: its width follows the turn.
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot * 0.5);
      ctx.scale(Math.cos(p.rot * 1.7), 1);
      ctx.fillRect(-s / 2, -s * 0.3, s, s * 0.6);
      ctx.restore();
      break;
    }
    case "star": {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? s / 2 : s / 5;
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case "spark": {
      // A streak along its flight.
      const len = Math.min(0.08, Math.hypot(p.vx, p.vy) * 0.05);
      const n = Math.hypot(p.vx, p.vy) || 1;
      ctx.lineWidth = Math.max(1, s / 3);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - (p.vx / n) * len * w, y - (p.vy / n) * len * h);
      ctx.stroke();
      break;
    }
    case "bean": {
      // A kidney bean: a brown oval with a pale seam.
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, s / 2, s / 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = p.alpha * 0.45;
      ctx.fillStyle = "#f3d9b0";
      ctx.beginPath();
      ctx.ellipse(-s * 0.12, -s * 0.06, s / 6, s / 14, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
  }
}

/**
 * Particles from `emitters`, at most `max` (≤ 400) alive. `blend: "add"`
 * lights them up against the dark (sparks, stars).
 */
export function Particles({ t, emitters, max = MAX_PARTICLES, blend = "normal", className, style }: { t: number; emitters: readonly Emitter[]; max?: number; blend?: "normal" | "add"; className?: string; style?: CSSProperties }) {
  const ref = useCanvas(
    (ctx, { w, h }) => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = blend === "add" ? "lighter" : "source-over";
      for (const p of particlesAt(emitters, t, w / Math.max(1, h), max)) drawParticle(ctx, p, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
    [t, emitters, max, blend],
  );
  return <canvas ref={ref} className={`kit-fill kit-particles${className ? ` ${className}` : ""}`} style={style} aria-hidden="true" />;
}

/** A confetti shower from `start`: cannons from the lower corners, then a fall for `dur` ms. */
export function Confetti({ t, start = 0, dur = 4000, density = 1, seed = 1, colors, className, style }: { t: number; start?: number; dur?: number; density?: number; seed?: number; colors?: readonly string[]; className?: string; style?: CSSProperties }) {
  const emitters = confettiEmitters(start, dur, density, seed, colors);
  return <Particles t={t} emitters={emitters} className={className} style={style} />;
}

/**
 * Flying through stars (the old screensaver): `speed` depths a second,
 * `warp` 0..1 stretches them into streaks. Draws its own `bg` (null: clear).
 */
export function Starfield({ t, speed = 0.25, count = 220, warp = 0, seed = 9, color = "#ffffff", bg = "#000", className, style }: { t: number; speed?: number; count?: number; warp?: number; seed?: number; color?: string; bg?: string | null; className?: string; style?: CSSProperties }) {
  const ref = useCanvas(
    (ctx, { w, h }) => {
      if (bg === null) ctx.clearRect(0, 0, w, h);
      else {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
      }
      const unit = Math.max(w, h);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineCap = "round";
      for (const s of starsAt(Math.min(count, 600), t, speed, seed)) {
        const x = (s.px - 0.5) * unit + w / 2;
        const y = (s.py - 0.5) * unit + h / 2;
        if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
        const near = 1 - s.z;
        ctx.globalAlpha = Math.min(1, 0.15 + near * 1.2);
        const size = 0.6 + near * 2.6;
        if (warp > 0.02) {
          const px = (s.ppx - 0.5) * unit + w / 2;
          const py = (s.ppy - 0.5) * unit + h / 2;
          ctx.lineWidth = size;
          ctx.beginPath();
          ctx.moveTo(x + (px - x) * warp * 6, y + (py - y) * warp * 6);
          ctx.lineTo(x, y);
          ctx.stroke();
        } else ctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    },
    [t, speed, count, warp, seed, color, bg],
  );
  return <canvas ref={ref} className={`kit-fill kit-starfield${className ? ` ${className}` : ""}`} style={style} aria-hidden="true" />;
}
