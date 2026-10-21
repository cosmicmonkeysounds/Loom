//! The grid savers: 2D pipes growing across the screen (drawn on top of
//! the last frame, cleared when the screen is full), and a maze that draws
//! itself and is walked from corner to corner.

import { Events, type Rand, type SaverDef, type SaverInstance } from "./types.ts";

// --- pipes ----------------------------------------------------------------------------

const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

export const PIPE_FILL = 0.5;

interface Pipe {
  c: number;
  r: number;
  dir: number;
  hue: number;
}

/** The pipes' pure state: a grid of taken cells and the pipes growing in it. */
export interface PipesState {
  cols: number;
  rows: number;
  taken: Uint8Array;
  pipes: Pipe[];
  /** Cells filled since the last clear. */
  filled: number;
  /** The segments grown since the last draw, waiting to be painted. */
  pending: Array<{ c0: number; r0: number; c1: number; r1: number; hue: number; joint: boolean }>;
  /** The screen must be cleared before the next segment is painted. */
  clear: boolean;
}

export function pipesInit(cols: number, rows: number, rand: Rand): PipesState {
  const s: PipesState = { cols, rows, taken: new Uint8Array(cols * rows), pipes: [], filled: 0, pending: [], clear: true };
  for (let i = 0; i < 2; i++) newPipe(s, rand, null);
  return s;
}

function newPipe(s: PipesState, rand: Rand, at: { c: number; r: number } | null): void {
  for (let tries = 0; tries < 40; tries++) {
    const c = at !== null && tries === 0 ? at.c : Math.floor(rand() * s.cols);
    const r = at !== null && tries === 0 ? at.r : Math.floor(rand() * s.rows);
    if (s.taken[r * s.cols + c] === 1 && !(at !== null && tries === 0)) continue;
    s.taken[r * s.cols + c] = 1;
    s.filled += 1;
    s.pipes.push({ c, r, dir: Math.floor(rand() * 4), hue: Math.floor(rand() * 360) });
    if (s.pipes.length > 3) s.pipes.shift();
    return;
  }
}

/** Grow every pipe one cell: straight on mostly, a turn now and then, a new pipe when one is boxed in. */
export function pipesStep(s: PipesState, rand: Rand): void {
  if (s.filled >= s.cols * s.rows * PIPE_FILL) {
    s.taken.fill(0);
    s.filled = 0;
    s.pipes = [];
    s.pending = [];
    s.clear = true;
    for (let i = 0; i < 2; i++) newPipe(s, rand, null);
    return;
  }
  for (const p of s.pipes.slice()) {
    const order = rand() < 0.22 ? [(p.dir + (rand() < 0.5 ? 1 : 3)) % 4, p.dir] : [p.dir, (p.dir + 1) % 4, (p.dir + 3) % 4];
    let moved = false;
    for (const d of order) {
      const c = p.c + DIRS[d]![0];
      const r = p.r + DIRS[d]![1];
      if (c < 0 || r < 0 || c >= s.cols || r >= s.rows || s.taken[r * s.cols + c] === 1) continue;
      s.pending.push({ c0: p.c, r0: p.r, c1: c, r1: r, hue: p.hue, joint: d !== p.dir });
      s.taken[r * s.cols + c] = 1;
      s.filled += 1;
      p.c = c;
      p.r = r;
      p.dir = d;
      moved = true;
      break;
    }
    if (!moved) {
      s.pipes = s.pipes.filter((q) => q !== p);
      newPipe(s, rand, null);
    }
  }
}

export const pipes: SaverDef = {
  id: "pipes",
  name: "Pipes",
  create(w: number, h: number, rand: Rand): SaverInstance {
    const cell = Math.max(18, Math.round(Math.min(w, h) / 18));
    const cols = Math.max(4, Math.floor(w / cell));
    const rows = Math.max(4, Math.floor(h / cell));
    const ox = (w - cols * cell) / 2;
    const oy = (h - rows * cell) / 2;
    const s = pipesInit(cols, rows, rand);
    const ev = new Events();
    let acc = 0;
    const at = (c: number, r: number) => [ox + (c + 0.5) * cell, oy + (r + 0.5) * cell] as const;
    return {
      step(dt) {
        acc += dt * 0.5; // 15 cells a second per pipe
        while (acc >= 1) {
          acc -= 1;
          pipesStep(s, rand);
        }
      },
      draw(ctx) {
        if (s.clear) {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, w, h);
          s.clear = false;
        }
        ctx.lineCap = "round";
        for (const seg of s.pending) {
          const [x0, y0] = at(seg.c0, seg.r0);
          const [x1, y1] = at(seg.c1, seg.r1);
          // A pipe in three passes: a dark rim, its colour, a highlight — round enough at a glance.
          for (const [lw, light, dx] of [
            [cell * 0.46, 22, 0],
            [cell * 0.36, 48, 0],
            [cell * 0.1, 80, -cell * 0.08],
          ] as const) {
            ctx.strokeStyle = `hsl(${seg.hue}, 85%, ${light}%)`;
            ctx.lineWidth = lw;
            ctx.beginPath();
            ctx.moveTo(x0 + dx, y0 + dx);
            ctx.lineTo(x1 + dx, y1 + dx);
            ctx.stroke();
          }
          if (seg.joint) {
            ctx.fillStyle = `hsl(${seg.hue}, 85%, 58%)`;
            ctx.beginPath();
            ctx.arc(x0, y0, cell * 0.3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        s.pending = [];
      },
      poke(x, y) {
        const c = Math.max(0, Math.min(cols - 1, Math.floor((x - ox) / cell)));
        const r = Math.max(0, Math.min(rows - 1, Math.floor((y - oy) / cell)));
        newPipe(s, rand, { c, r });
        ev.push("burst");
      },
      events: () => ev.drain(),
    };
  },
};

// --- the maze --------------------------------------------------------------------------

/** A maze's walls: `right[i]` / `down[i]` — is there a wall right of / below cell i? */
export interface Maze {
  cols: number;
  rows: number;
  right: Uint8Array;
  down: Uint8Array;
}

/** A perfect maze by depth-first carving (iterative: no recursion limit). */
export function mazeMake(cols: number, rows: number, rand: Rand): Maze {
  const n = cols * rows;
  const m: Maze = { cols, rows, right: new Uint8Array(n).fill(1), down: new Uint8Array(n).fill(1) };
  const seen = new Uint8Array(n);
  const stack = [0];
  seen[0] = 1;
  while (stack.length > 0) {
    const i = stack[stack.length - 1]!;
    const c = i % cols;
    const r = Math.floor(i / cols);
    const next: number[] = [];
    if (c > 0 && !seen[i - 1]) next.push(i - 1);
    if (c < cols - 1 && !seen[i + 1]) next.push(i + 1);
    if (r > 0 && !seen[i - cols]) next.push(i - cols);
    if (r < rows - 1 && !seen[i + cols]) next.push(i + cols);
    if (next.length === 0) {
      stack.pop();
      continue;
    }
    const j = next[Math.floor(rand() * next.length)]!;
    if (j === i + 1) m.right[i] = 0;
    else if (j === i - 1) m.right[j] = 0;
    else if (j === i + cols) m.down[i] = 0;
    else m.down[j] = 0;
    seen[j] = 1;
    stack.push(j);
  }
  return m;
}

/** The way from the top-left cell to the bottom-right one (breadth first), cell indices. */
export function mazeSolve(m: Maze): number[] {
  const n = m.cols * m.rows;
  const from = new Int32Array(n).fill(-1);
  from[0] = 0;
  const queue = [0];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const c = i % m.cols;
    const go = (j: number) => {
      if (from[j] !== -1) return;
      from[j] = i;
      queue.push(j);
    };
    if (c < m.cols - 1 && !m.right[i]) go(i + 1);
    if (c > 0 && !m.right[i - 1]) go(i - 1);
    if (i + m.cols < n && !m.down[i]) go(i + m.cols);
    if (i - m.cols >= 0 && !m.down[i - m.cols]) go(i - m.cols);
  }
  const path: number[] = [];
  for (let i = n - 1; i !== 0 && i !== -1; i = from[i]!) path.push(i);
  path.push(0);
  return path.reverse();
}

export const maze: SaverDef = {
  id: "maze",
  name: "Maze",
  create(w: number, h: number, rand: Rand): SaverInstance {
    const cell = Math.max(22, Math.round(Math.min(w, h) / 14));
    const cols = Math.max(4, Math.floor((w - 20) / cell));
    const rows = Math.max(4, Math.floor((h - 20) / cell));
    const ox = (w - cols * cell) / 2;
    const oy = (h - rows * cell) / 2;
    let m = mazeMake(cols, rows, rand);
    let path = mazeSolve(m);
    let walked = 0;
    let rest = 0;
    let hue = Math.floor(rand() * 360);
    const ev = new Events();
    const fresh = () => {
      m = mazeMake(cols, rows, rand);
      path = mazeSolve(m);
      walked = 0;
      rest = 0;
      hue = (hue + 70) % 360;
    };
    const centre = (i: number) => [ox + ((i % cols) + 0.5) * cell, oy + (Math.floor(i / cols) + 0.5) * cell] as const;
    return {
      step(dt) {
        if (walked >= path.length - 1) {
          rest += dt;
          if (rest === dt) ev.push("solved");
          if (rest > 45) fresh(); // 1.5 s at the exit, then a new maze
          return;
        }
        walked = Math.min(path.length - 1, walked + 0.28 * dt);
      },
      draw(ctx) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        // The walls (one path for the lot: cheap on an old tablet).
        ctx.strokeStyle = `hsl(${hue}, 70%, 55%)`;
        ctx.lineWidth = Math.max(2, cell * 0.12);
        ctx.lineCap = "square";
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + cols * cell, oy);
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox, oy + rows * cell);
        for (let i = 0; i < cols * rows; i++) {
          const x = ox + (i % cols) * cell;
          const y = oy + Math.floor(i / cols) * cell;
          if (m.right[i]) {
            ctx.moveTo(x + cell, y);
            ctx.lineTo(x + cell, y + cell);
          }
          if (m.down[i]) {
            ctx.moveTo(x, y + cell);
            ctx.lineTo(x + cell, y + cell);
          }
        }
        ctx.stroke();
        // The trail walked so far, and the walker at its head.
        const k = Math.floor(walked);
        ctx.strokeStyle = "#ffb000";
        ctx.lineWidth = Math.max(3, cell * 0.22);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (let i = 0; i <= k; i++) {
          const [x, y] = centre(path[i]!);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const [ax, ay] = centre(path[k]!);
        const [bx, by] = centre(path[Math.min(path.length - 1, k + 1)]!);
        const f = walked - k;
        const hx = ax + (bx - ax) * f;
        const hy = ay + (by - ay) * f;
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.fillStyle = "#fff36b";
        ctx.beginPath();
        ctx.arc(hx, hy, cell * 0.3, 0, Math.PI * 2);
        ctx.fill();
        // The exit, flagged.
        const [ex, ey] = centre(cols * rows - 1);
        ctx.fillStyle = "#ff4d4d";
        ctx.fillRect(ex - cell * 0.2, ey - cell * 0.2, cell * 0.4, cell * 0.4);
      },
      poke() {
        fresh();
        ev.push("burst");
      },
      events: () => ev.drain(),
    };
  },
};
