//! Mystify (K-16, kept: the TV's first screensaver) and Beziers — the
//! two line savers: bouncing corners drawn with fading echoes.

import { mystifyInit, mystifyStep, type MystifyShape } from "../../attract.ts";
import { Events, clamp, type Rand, type SaverDef, type SaverInstance } from "./types.ts";

export const mystify: SaverDef = {
  id: "mystify",
  name: "Mystify",
  create(w: number, h: number, rand: Rand): SaverInstance {
    const shapes: MystifyShape[] = mystifyInit(w, h, rand);
    const ev = new Events();
    let boost = 0;
    let acc = 0;
    return {
      step(dt) {
        // A poke: a few frames at triple speed, the colours swung round.
        acc += dt * (boost > 0 ? 3 : 1);
        if (boost > 0) boost = Math.max(0, boost - dt);
        while (acc >= 1) {
          acc -= 1;
          mystifyStep(shapes, w, h);
        }
      },
      draw(ctx) {
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
      },
      poke(x, y) {
        boost = 24;
        for (const s of shapes) {
          s.hue = (s.hue + 120) % 360;
          // The nearest corner of each shape leaps to the finger.
          let best = s.points[0]!;
          for (const p of s.points) if (Math.hypot(p.x - x, p.y - y) < Math.hypot(best.x - x, best.y - y)) best = p;
          best.x = clamp(x, 0, w);
          best.y = clamp(y, 0, h);
        }
        ev.push("burst");
      },
      events: () => ev.drain(),
    };
  },
};

interface Ctl {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export const BEZIER_CURVES = 3;
export const BEZIER_TRAIL = 12;

export const beziers: SaverDef = {
  id: "beziers",
  name: "Beziers",
  create(w: number, h: number, rand: Rand): SaverInstance {
    const speed = () => (1.2 + rand() * 2.6) * (rand() < 0.5 ? -1 : 1);
    const curves = Array.from({ length: BEZIER_CURVES }, (_, i) => ({
      hue: (i * 120 + rand() * 40) % 360,
      pts: Array.from({ length: 4 }, (): Ctl => ({ x: rand() * w, y: rand() * h, dx: speed(), dy: speed() })),
      trail: [] as Array<Array<{ x: number; y: number }>>,
    }));
    const ev = new Events();
    let frame = 0;
    return {
      step(dt) {
        frame += dt;
        for (const c of curves) {
          for (const p of c.pts) {
            p.x += p.dx * dt;
            p.y += p.dy * dt;
            if (p.x < 0 || p.x > w) {
              p.dx = -p.dx;
              p.x = clamp(p.x, 0, w);
            }
            if (p.y < 0 || p.y > h) {
              p.dy = -p.dy;
              p.y = clamp(p.y, 0, h);
            }
          }
          if (Math.floor(frame) % 3 === 0) {
            c.trail.unshift(c.pts.map((p) => ({ x: p.x, y: p.y })));
            if (c.trail.length > BEZIER_TRAIL) c.trail.length = BEZIER_TRAIL;
          }
          c.hue = (c.hue + 0.6 * dt) % 360;
        }
      },
      draw(ctx) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        ctx.lineWidth = 2;
        for (const c of curves) {
          const all = [c.pts, ...c.trail];
          all.forEach((p, i) => {
            if (p.length < 4) return;
            ctx.strokeStyle = `hsla(${(c.hue + i * 6) % 360}, 100%, 62%, ${1 - i / (all.length + 1)})`;
            ctx.beginPath();
            ctx.moveTo(p[0]!.x, p[0]!.y);
            ctx.bezierCurveTo(p[1]!.x, p[1]!.y, p[2]!.x, p[2]!.y, p[3]!.x, p[3]!.y);
            ctx.stroke();
          });
        }
      },
      poke(x, y) {
        // Every curve's middle handles snap to the finger: the lines whip round it.
        for (const c of curves) {
          c.pts[1]!.x = clamp(x, 0, w);
          c.pts[1]!.y = clamp(y, 0, h);
          c.pts[2]!.x = clamp(w - x, 0, w);
          c.pts[2]!.y = clamp(h - y, 0, h);
          c.hue = (c.hue + 90) % 360;
        }
        ev.push("burst");
      },
      events: () => ev.drain(),
    };
  },
};
