//! The data mosh on screen (wave 50): the small canvas over everything
//! (`mosh.ts` plans and draws it, `stamp.ts` copies the scene). Mounted only
//! while something is getting through the dream; it takes no taps. It keeps
//! its own double buffer: a canvas drawing from itself makes the browser copy
//! the whole canvas for every block.

import { useEffect, useRef } from "react";
import { DREAM_TAKE_MS, type MoshMode } from "./dream.ts";
import { MOSH_CYCLE_MS, MOSH_GRIDS, MOSH_STAMP_MS, drawMosh, moshCycleAt, moshPlan, moshSeed, rotBleed, takeBleed, type MoshCtx, type MoshPlan } from "./mosh.ts";
import { dreamPlayer } from "./player.ts";
import { stampScene } from "./stamp.ts";

function small(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  return ctx === null ? null : { canvas, ctx };
}

export function Mosh({ mode, target, seedKey, reduced }: { mode: MoshMode; target: "tv" | "wall"; seedKey: string; reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const out = ref.current;
    const view = out?.getContext("2d") ?? null;
    if (out === null || view === null) return;
    const grid = MOSH_GRIDS[target];
    const w = grid.cols * grid.block;
    const h = grid.rows * grid.block;
    const scene = small(w, h);
    const dream = small(w, h);
    let front = small(w, h);
    let back = small(w, h);
    if (scene === null || dream === null || front === null || back === null) return;
    out.width = w;
    out.height = h;
    const release = dreamPlayer.keep();
    const take = mode === "take";
    const seed = moshSeed(seedKey);
    const t0 = performance.now();
    let cycle = -1;
    let plan: MoshPlan | null = null;
    let was = 0;
    let stamped = -MOSH_STAMP_MS;
    let timer = 0;
    let alive = true;

    const stamp = (now: number): void => {
      stamped = now;
      try {
        stampScene(scene.ctx, w, h, take);
      } catch {
        // A scene mid-teardown: the last copy stands.
      }
    };

    const step = (): void => {
      if (!alive) return;
      const every = reduced ? MOSH_CYCLE_MS : 1000 / grid.fps;
      if (!document.hidden) {
        const now = performance.now();
        const elapsed = now - t0;
        const at = take ? { n: 0, phase: Math.min(1, elapsed / (DREAM_TAKE_MS * 0.92)) } : moshCycleAt(elapsed);
        if (at.n !== cycle) {
          // A keyframe: the small canvases wipe, and the screen is clean.
          cycle = at.n;
          was = 0;
          plan = take ? moshPlan(seed, 0, grid, 1, 0, 0.82) : moshPlan(seed, cycle, grid);
          front!.ctx.clearRect(0, 0, w, h);
          back!.ctx.clearRect(0, 0, w, h);
          stamp(now);
        } else if (now - stamped >= MOSH_STAMP_MS) stamp(now);
        const source = dreamPlayer.source();
        if (source !== null) {
          try {
            dream.ctx.drawImage(source, 0, 0, w, h);
          } catch {
            // A frame not decoded yet: last tick's picture stands.
          }
        }
        // Reduced motion: one still, mid-cycle; nothing moves.
        const phase = reduced ? 0.6 : at.phase;
        const swap = front;
        front = back;
        back = swap;
        drawMosh(front!.ctx as unknown as MoshCtx, plan!, { phase, was: reduced ? 0 : was, scene: scene.canvas, prev: back!.canvas, dream: source === null ? null : dream.canvas, bleed: take ? takeBleed : rotBleed });
        was = phase;
        view.clearRect(0, 0, w, h);
        view.drawImage(front!.canvas, 0, 0);
      }
      timer = window.setTimeout(step, every);
    };
    step();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      release();
    };
  }, [mode, target, seedKey, reduced]);
  return <canvas ref={ref} className="dream-mosh" data-mode={mode} aria-hidden="true" />;
}
