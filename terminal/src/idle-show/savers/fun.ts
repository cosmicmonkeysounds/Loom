//! The playful savers: a bouncing Maps and Ducks logo (it never quite hits
//! the corner — the story's own screensaver joke), code rain in phosphor green, and a pond of rubber
//! ducks that quack when poked. All original art, drawn with plain paths.

import { Events, clamp, type Rand, type SaverDef, type SaverInstance } from "./types.ts";

// --- the bouncing logo ------------------------------------------------------------------

export interface BounceState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  bw: number;
  bh: number;
  hue: number;
  corners: number;
}

export function bounceInit(w: number, h: number, rand: Rand): BounceState {
  const bw = Math.max(120, Math.min(w, h) * 0.42);
  const bh = bw * 0.42;
  const v = Math.max(1.6, Math.min(w, h) / 260);
  return { x: rand() * Math.max(1, w - bw), y: rand() * Math.max(1, h - bh), dx: v, dy: v * 0.8, bw, bh, hue: Math.floor(rand() * 360), corners: 0 };
}

/** The gap a near miss leaves (px): the logo is nudged this far off the
 *  other edge, so it never lands in the corner. */
export const NEAR_MISS_PX = 10;

/** One frame; returns true on a near miss (one edge hit with the other
 *  within a few px — the logo is nudged clear, so it never quite hits the corner). */
export function bounceStep(s: BounceState, w: number, h: number, dt: number): boolean {
  s.x += s.dx * dt;
  s.y += s.dy * dt;
  let hitX = false;
  let hitY = false;
  if (s.x <= 0 || s.x + s.bw >= w) {
    s.dx = s.x <= 0 ? Math.abs(s.dx) : -Math.abs(s.dx);
    s.x = clamp(s.x, 0, Math.max(0, w - s.bw));
    hitX = true;
  }
  if (s.y <= 0 || s.y + s.bh >= h) {
    s.dy = s.y <= 0 ? Math.abs(s.dy) : -Math.abs(s.dy);
    s.y = clamp(s.y, 0, Math.max(0, h - s.bh));
    hitY = true;
  }
  if (hitX || hitY) s.hue = (s.hue + 67) % 360;
  // Within a few px of the corner: nudge it clear on the other axis.
  const near = (v: number, edge: number) => Math.abs(v - edge) < 6;
  const off = (v: number, size: number, span: number) => (v < span / 2 ? Math.min(Math.max(0, span - size), NEAR_MISS_PX) : Math.max(0, span - size - NEAR_MISS_PX));
  let miss = false;
  if (hitX && (near(s.y, 0) || near(s.y + s.bh, h))) {
    s.y = off(s.y, s.bh, h);
    miss = true;
  } else if (hitY && (near(s.x, 0) || near(s.x + s.bw, w))) {
    s.x = off(s.x, s.bw, w);
    miss = true;
  }
  if (miss) s.corners += 1;
  return miss;
}

/** The logo's words. A machine's name, never the character's. */
export const LOGO_TEXT = "Maps and Ducks";
export const LOGO_SUB = "98";

export const bounce: SaverDef = {
  id: "bounce",
  name: "Bouncing Logo",
  create(w: number, h: number, rand: Rand): SaverInstance {
    const s = bounceInit(w, h, rand);
    const ev = new Events();
    let cheer = 0;
    return {
      step(dt) {
        if (bounceStep(s, w, h, dt)) {
          ev.push("corner");
          cheer = 40;
        }
        if (cheer > 0) cheer = Math.max(0, cheer - dt);
      },
      draw(ctx) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        const { x, y, bw, bh, hue } = s;
        const col = `hsl(${hue}, 100%, 60%)`;
        // The emblem: a teal disc, the duck and its bill.
        const fs = bh * 0.78;
        const cx = x + fs / 2;
        const cy = y + bh / 2;
        ctx.fillStyle = `hsl(${(hue + 180) % 360}, 70%, 40%)`;
        ctx.beginPath();
        ctx.arc(cx, cy, fs / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffd23f";
        ctx.beginPath();
        ctx.arc(cx - fs * 0.05, cy + fs * 0.12, fs * 0.24, 0, Math.PI * 2);
        ctx.arc(cx + fs * 0.1, cy - fs * 0.14, fs * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ff8a1f";
        ctx.beginPath();
        ctx.moveTo(cx + fs * 0.22, cy - fs * 0.16);
        ctx.lineTo(cx + fs * 0.4, cy - fs * 0.1);
        ctx.lineTo(cx + fs * 0.22, cy - fs * 0.06);
        ctx.fill();
        ctx.fillStyle = col;
        ctx.textBaseline = "alphabetic";
        ctx.font = `bold ${Math.round(bh * 0.34)}px Tahoma, "Segoe UI", sans-serif`;
        ctx.fillText(LOGO_TEXT, x + fs * 1.15, y + bh * 0.55);
        ctx.font = `bold ${Math.round(bh * 0.26)}px Tahoma, "Segoe UI", sans-serif`;
        ctx.fillText(LOGO_SUB, x + fs * 1.18, y + bh * 0.88);
        if (cheer > 0) {
          ctx.fillStyle = `rgba(255, 255, 255, ${cheer / 40})`;
          ctx.font = `bold ${Math.round(Math.min(w, h) * 0.07)}px Tahoma, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText("SO CLOSE…", w / 2, h / 2);
          ctx.textAlign = "start";
        }
      },
      poke(x, y) {
        // The logo jumps to the finger and flies away from it.
        s.x = clamp(x - s.bw / 2, 0, Math.max(0, w - s.bw));
        s.y = clamp(y - s.bh / 2, 0, Math.max(0, h - s.bh));
        s.dx = -s.dx * 1.15;
        s.dy = -s.dy * 1.15;
        const cap = Math.max(3, Math.min(w, h) / 120);
        s.dx = clamp(s.dx, -cap, cap);
        s.dy = clamp(s.dy, -cap, cap);
        s.hue = (s.hue + 140) % 360;
        ev.push("burst");
      },
      events: () => ev.drain(),
    };
  },
};

// --- the rain --------------------------------------------------------------------------

const GLYPHS = "0123456789ABCDEF<>/\\*+=#$%&@:;{}[]";

export const rain: SaverDef = {
  id: "rain",
  name: "Code Rain",
  create(w: number, h: number, rand: Rand): SaverInstance {
    const size = Math.max(14, Math.round(h / 34));
    const cols = Math.ceil(w / size);
    const drops = Array.from({ length: cols }, () => ({ y: -rand() * h, v: 0.35 + rand() * 0.7 }));
    const ev = new Events();
    let first = true;
    return {
      step(dt) {
        for (const d of drops) {
          d.y += d.v * size * 0.5 * dt;
          if (d.y > h + size * 4) {
            d.y = -rand() * h * 0.5;
            d.v = 0.35 + rand() * 0.7;
          }
        }
      },
      draw(ctx) {
        ctx.fillStyle = first ? "#000" : "rgba(0, 0, 0, 0.12)";
        first = false;
        ctx.fillRect(0, 0, w, h);
        ctx.font = `${size}px VT323, monospace`;
        ctx.textBaseline = "top";
        drops.forEach((d, i) => {
          if (d.y < -size) return;
          const g = GLYPHS[Math.floor(rand() * GLYPHS.length)]!;
          ctx.fillStyle = "#d8ffe4";
          ctx.fillText(g, i * size, d.y);
          ctx.fillStyle = "#33ff77";
          ctx.fillText(GLYPHS[Math.floor(rand() * GLYPHS.length)]!, i * size, d.y - size);
        });
      },
      poke(x, y) {
        // A splash: the columns near the finger all start falling from it, fast.
        const c = Math.floor(x / size);
        for (let i = Math.max(0, c - 4); i < Math.min(cols, c + 5); i++) {
          drops[i]!.y = y - Math.abs(i - c) * size;
          drops[i]!.v = 1.4;
        }
        ev.push("burst");
      },
      events: () => ev.drain(),
    };
  },
};

// --- the duck pond ----------------------------------------------------------------------

export const DUCKS = 7;

interface Duck {
  x: number;
  lane: number;
  v: number;
  phase: number;
  /** A poke's hop: height above the water (px) and its speed. */
  hop: number;
  vh: number;
  size: number;
}

export const ducks: SaverDef = {
  id: "ducks",
  name: "Duck Pond",
  create(w: number, h: number, rand: Rand): SaverInstance {
    const lanes = 4;
    const all: Duck[] = Array.from({ length: DUCKS }, (_, i) => {
      const lane = i % lanes;
      const size = Math.min(w, h) * (0.06 + lane * 0.02);
      return { x: rand() * w, lane, v: (0.6 + rand() * 0.8) * (lane % 2 === 0 ? 1 : -1) * (size / 40), phase: rand() * 6.28, hop: 0, vh: 0, size };
    });
    const ev = new Events();
    let t = 0;
    const laneY = (lane: number) => h * (0.4 + lane * 0.16);
    return {
      step(dt) {
        t += dt;
        for (const d of all) {
          d.x += d.v * dt;
          if (d.x > w + d.size * 2) d.x = -d.size * 2;
          if (d.x < -d.size * 2) d.x = w + d.size * 2;
          if (d.hop > 0 || d.vh > 0) {
            d.hop += d.vh * dt;
            d.vh -= 0.9 * dt;
            if (d.hop <= 0) {
              d.hop = 0;
              d.vh = 0;
            }
          }
        }
      },
      draw(ctx) {
        // Night sky over a pond.
        ctx.fillStyle = "#020a1a";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#06244a";
        ctx.fillRect(0, h * 0.34, w, h * 0.66);
        for (let lane = 0; lane < lanes; lane++) {
          const y = laneY(lane);
          ctx.strokeStyle = `rgba(120, 190, 255, ${0.25 + lane * 0.12})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let x = 0; x <= w; x += 16) {
            const yy = y + Math.sin(x / 40 + t * 0.12 + lane) * 4;
            if (x === 0) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
          }
          ctx.stroke();
          for (const d of all) if (d.lane === lane) drawDuck(ctx, d, y + Math.sin(t * 0.15 + d.phase) * 3 - d.hop);
        }
      },
      poke(x, y) {
        let best: Duck | null = null;
        let dist = Infinity;
        for (const d of all) {
          const dd = Math.hypot(d.x - x, laneY(d.lane) - y);
          if (dd < dist) {
            best = d;
            dist = dd;
          }
        }
        if (best !== null) {
          best.vh = best.size * 0.35;
          best.hop = 0.01;
          ev.push("quack");
        }
      },
      events: () => ev.drain(),
    };
  },
};

function drawDuck(ctx: CanvasRenderingContext2D, d: Duck, y: number): void {
  const s = d.size;
  const dir = d.v >= 0 ? 1 : -1;
  ctx.save();
  ctx.translate(d.x, y);
  ctx.scale(dir, 1);
  ctx.fillStyle = "#ffd21f";
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.35, s * 0.62, s * 0.38, 0, 0, Math.PI * 2); // the body
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s * 0.42, -s * 0.85, s * 0.28, 0, Math.PI * 2); // the head
  ctx.fill();
  ctx.fillStyle = "#ff8a00";
  ctx.beginPath();
  ctx.moveTo(s * 0.66, -s * 0.86);
  ctx.lineTo(s * 0.98, -s * 0.78);
  ctx.lineTo(s * 0.66, -s * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(s * 0.5, -s * 0.92, s * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
