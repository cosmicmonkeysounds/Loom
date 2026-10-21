//! The flying savers: a starfield at warp, and windows flying out of the
//! dark (little four-pane window flags, original art) — both a cloud of
//! points in depth, projected onto the screen.

import { Events, type Rand, type SaverDef, type SaverInstance } from "./types.ts";

export const STARS = 260;
/** Depth units a frame, cruising and at full warp. */
export const WARP_CRUISE = 0.012;
export const WARP_MAX = 0.07;

interface Star {
  x: number;
  y: number;
  z: number;
  /** The last frame's depth (the streak runs from there). */
  pz: number;
}

export const starfield: SaverDef = {
  id: "starfield",
  name: "Starfield",
  create(w: number, h: number, rand: Rand): SaverInstance {
    const fresh = (s: Star, far: boolean) => {
      s.x = rand() * 2 - 1;
      s.y = rand() * 2 - 1;
      s.z = far ? 1 : 0.05 + rand() * 0.95;
      s.pz = s.z;
    };
    const stars: Star[] = Array.from({ length: STARS }, () => {
      const s = { x: 0, y: 0, z: 1, pz: 1 };
      fresh(s, false);
      return s;
    });
    let speed = WARP_CRUISE;
    let cx = w / 2;
    let cy = h / 2;
    const f = Math.min(w, h) * 0.6;
    const ev = new Events();
    return {
      step(dt) {
        speed = Math.max(WARP_CRUISE, speed - 0.0016 * dt);
        // The centre drifts back to the middle after a poke moved it.
        cx += (w / 2 - cx) * 0.02 * dt;
        cy += (h / 2 - cy) * 0.02 * dt;
        for (const s of stars) {
          s.pz = s.z;
          s.z -= speed * dt;
          if (s.z <= 0.02) fresh(s, true);
        }
      },
      draw(ctx) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        ctx.fillRect(0, 0, w, h);
        ctx.lineCap = "round";
        for (const s of stars) {
          const x = cx + (s.x / s.z) * f;
          const y = cy + (s.y / s.z) * f;
          const px = cx + (s.x / s.pz) * f;
          const py = cy + (s.y / s.pz) * f;
          if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
          const b = 1 - s.z;
          ctx.strokeStyle = `rgba(${200 + Math.round(55 * b)}, ${220 + Math.round(35 * b)}, 255, ${0.25 + 0.75 * b})`;
          ctx.lineWidth = 0.6 + 2.4 * b;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
      },
      poke(x, y) {
        speed = WARP_MAX; // full warp, easing back
        cx = x;
        cy = y;
        ev.push("burst");
      },
      events: () => ev.drain(),
    };
  },
};

export const WINDOWS = 34;
const PANES = ["#ff3b30", "#34c759", "#0a84ff", "#ffcc00"] as const;

interface Flag {
  x: number;
  y: number;
  z: number;
  phase: number;
  /** A burst's flags fly out from where the finger was (screen px offset at z = 1). */
  ox: number;
  oy: number;
}

export const windows: SaverDef = {
  id: "windows",
  name: "Flying Windows",
  create(w: number, h: number, rand: Rand): SaverInstance {
    const fresh = (fl: Flag, far: boolean) => {
      fl.x = (rand() * 2 - 1) * 1.2;
      fl.y = (rand() * 2 - 1) * 1.2;
      fl.z = far ? 1 : 0.15 + rand() * 0.85;
      fl.phase = rand() * Math.PI * 2;
      fl.ox = 0;
      fl.oy = 0;
    };
    const flags: Flag[] = Array.from({ length: WINDOWS }, () => {
      const fl = { x: 0, y: 0, z: 1, phase: 0, ox: 0, oy: 0 };
      fresh(fl, false);
      return fl;
    });
    const f = Math.min(w, h) * 0.5;
    const ev = new Events();
    let t = 0;
    return {
      step(dt) {
        t += dt;
        for (const fl of flags) {
          fl.z -= 0.006 * dt;
          if (fl.z <= 0.06) fresh(fl, true);
        }
        flags.sort((a, b) => b.z - a.z); // far first
      },
      draw(ctx) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        for (const fl of flags) {
          const sx = w / 2 + fl.ox + (fl.x / fl.z) * f;
          const sy = h / 2 + fl.oy + (fl.y / fl.z) * f;
          const size = (0.05 / fl.z) * f;
          if (sx < -size * 2 || sx > w + size * 2 || sy < -size * 2 || sy > h + size * 2) continue;
          const a = Math.min(1, (1 - fl.z) * 1.6);
          ctx.globalAlpha = a;
          const pane = size / 2.2;
          const gap = size * 0.08;
          for (let i = 0; i < 4; i++) {
            const col = i % 2;
            const row = Math.floor(i / 2);
            // The flag waves: each column rides its own sine.
            const wave = Math.sin(t * 0.18 + fl.phase + col * 1.1) * size * 0.08;
            ctx.fillStyle = PANES[i]!;
            ctx.fillRect(sx - size / 2 + col * (pane + gap), sy - size / 2 + row * (pane + gap) + wave, pane, pane);
          }
        }
        ctx.globalAlpha = 1;
      },
      poke(x, y) {
        // A burst: the nearest dozen flags restart from the finger.
        for (let i = 0; i < 12; i++) {
          const fl = flags[flags.length - 1 - i];
          if (fl === undefined) break;
          fresh(fl, true);
          fl.x *= 0.15;
          fl.y *= 0.15;
          fl.ox = x - w / 2;
          fl.oy = y - h / 2;
        }
        ev.push("burst");
      },
      events: () => ev.drain(),
    };
  },
};
