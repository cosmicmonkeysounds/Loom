//! A ghost's swarm for the raycaster: the same idea as `@loom/house/three`'s
//! shader (a picture cut up, stepping at 11 Hz, a storm at most once per
//! 0.9 s, a face that tears together when the camera is near), small enough
//! to draw with `drawImage` at the raycaster's ~320 × 180. `swarmPieces` is
//! pure; `drawSwarm` lays them on any 2D context. Three-free, node-tested.

import type { Projected } from "./raycast.ts";

/** A piece of the picture (`s*`, 0…1, y down) and where it lands (0…1 of its sprite's box). */
export interface SwarmPiece {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SwarmPieces {
  /** In the head's box. */
  face: SwarmPiece[];
  /** In the body's box. */
  body: SwarmPiece[];
}

/** The face: this many cells a side. */
export const FACE_GRID = 5;
export const BODY_PIECES = 14;
const STEP_HZ = 11;
const STORM_S = 0.9;
/** Nearer than this (metres), the face holds together. */
export const NEAR_M = 4.5;

function hash(n: number): number {
  const x = Math.sin(n) * 43758.5453;
  return x - Math.floor(x);
}

/** The pieces at time `t` (ms) for a ghost's `seed`, `depth` metres from the camera. */
export function swarmPieces(seed: number, t: number, depth: number): SwarmPieces {
  const s = t / 1000;
  const tick = Math.floor(s * STEP_HZ);
  const stormy = hash(Math.floor(s / STORM_S + seed) * 1.37 + seed) >= 0.7;
  const mood = Math.sin(s * 0.7 + seed * 3) > 0.3;
  const gathered = (depth < NEAR_M || mood) && !stormy;

  const face: SwarmPiece[] = [];
  const cell = 1 / FACE_GRID;
  for (let row = 0; row < FACE_GRID; row++) {
    const tear = hash(row * 3.1 + tick * 0.17 + seed) >= (stormy ? 0.55 : 0.9) ? (hash(row + tick * 0.31) - 0.5) * 0.7 : 0;
    for (let col = 0; col < FACE_GRID; col++) {
      const k = row * FACE_GRID + col;
      const scatter = gathered ? 0 : 0.5;
      face.push({
        sx: col * cell,
        sy: row * cell,
        sw: cell,
        sh: cell,
        x: col * cell + tear + (hash(k + tick * 0.23 + seed) - 0.5) * scatter,
        y: row * cell + (hash(k * 1.7 + tick * 0.41) - 0.5) * scatter,
        w: cell,
        h: cell,
      });
    }
  }

  const body: SwarmPiece[] = [];
  for (let i = 0; i < BODY_PIECES; i++) {
    const r = (n: number) => hash(i * 7.3 + n + seed);
    const w = 0.35 + 0.5 * r(1);
    const h = 0.03 + 0.05 * r(2);
    body.push({
      sx: r(3) * 0.7,
      sy: r(4) * 0.9,
      sw: 0.3,
      sh: 0.1,
      x: (hash(i + tick * (0.11 + 0.02 * i)) - 0.5) * (stormy ? 1.1 : 0.6) + 0.5 - w / 2,
      y: r(5) * (1 - h),
      w,
      h,
    });
  }
  return { face, body };
}

/** A ghost's swarm: its picture cut up, static in its colour with none yet. */
export function drawSwarm(ctx: CanvasRenderingContext2D, head: Projected, body: Projected, img: HTMLImageElement | null, colour: string, pieces: SwarmPieces): void {
  // A square crop of the picture, the same as the three.js swarm's cover-fit.
  const ready = img !== null && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
  const side = ready ? Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const left = ready ? (img.naturalWidth - side) / 2 : 0;
  const top = ready ? (img.naturalHeight - side) / 2 : 0;
  const lay = (box: Projected, list: readonly SwarmPiece[]) => {
    const w = Math.max(1, box.x1 - box.x0);
    const h = Math.max(1, box.y1 - box.y0);
    for (const p of list) {
      const dx = box.x0 + p.x * w;
      const dy = box.y0 + p.y * h;
      const dw = Math.max(1, p.w * w);
      const dh = Math.max(1, p.h * h);
      if (ready) {
        try {
          ctx.drawImage(img, left + p.sx * side, top + p.sy * side, p.sw * side, p.sh * side, dx, dy, dw, dh);
        } catch {
          /* a broken image: this piece is gone */
        }
      } else {
        ctx.fillStyle = colour;
        ctx.globalAlpha = 0.35 + 0.65 * ((p.sx * 97 + p.sy * 41) % 1);
        ctx.fillRect(dx, dy, dw, dh);
      }
    }
  };
  ctx.imageSmoothingEnabled = false;
  lay(body, pieces.body);
  lay(head, pieces.face);
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 1;
}
