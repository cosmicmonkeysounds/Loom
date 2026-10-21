import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/idle-show/rng.ts";
import { SAVERS } from "../src/idle-show/savers/index.ts";
import { LOGO_TEXT, bounceInit, bounceStep } from "../src/idle-show/savers/fun.ts";
import { PIPE_FILL, mazeMake, mazeSolve, pipesInit, pipesStep } from "../src/idle-show/savers/grid.ts";

/** A Canvas2D that takes every call and every property: the savers' paint must never throw. */
function fakeCtx(): CanvasRenderingContext2D & { calls: number } {
  const target = { calls: 0 } as Record<string, unknown>;
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k as string];
      return () => {
        (t["calls"] as number)++;
      };
    },
    set(t, k, v) {
      t[k as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D & { calls: number };
}

describe("every screensaver", () => {
  for (const def of SAVERS) {
    it(`${def.id} runs, paints and takes pokes at any size`, () => {
      for (const [w, h] of [[320, 200], [1280, 800], [800, 1280], [1, 1]] as const) {
        const s = def.create(w, h, mulberry32(9));
        const ctx = fakeCtx();
        for (let f = 0; f < 900; f++) {
          s.step(f % 3 === 0 ? 2 : 1);
          if (f % 30 === 0) s.draw(ctx);
          if (f % 97 === 0) s.poke((f * 37) % w, (f * 53) % h);
        }
        s.draw(ctx);
        expect(ctx.calls).toBeGreaterThan(0);
        expect(Array.isArray(s.events())).toBe(true);
        expect(s.events()).toEqual([]);
      }
    });
  }
});

describe("the bouncing logo", () => {
  it("stays on screen and never quite hits the corner (the story's screensaver, F7)", () => {
    const s = bounceInit(640, 400, mulberry32(4));
    let misses = 0;
    for (let i = 0; i < 60_000; i++) {
      if (bounceStep(s, 640, 400, 1)) misses++;
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x + s.bw).toBeLessThanOrEqual(640 + 1e-6);
      expect(s.y + s.bh).toBeLessThanOrEqual(400 + 1e-6);
      // Never on two edges at once.
      const onX = s.x <= 0.5 || s.x + s.bw >= 639.5;
      const onY = s.y <= 0.5 || s.y + s.bh >= 399.5;
      expect(onX && onY).toBe(false);
    }
    expect(misses).toBeGreaterThan(0);
    expect(LOGO_TEXT).toBe("Maps and Ducks");
  });
});

describe("the pipes", () => {
  it("grow without crossing and clear once the screen is half full", () => {
    const rand = mulberry32(2);
    const s = pipesInit(20, 12, rand);
    let clears = 0;
    for (let i = 0; i < 3000; i++) {
      const before = s.filled;
      pipesStep(s, rand);
      if (s.filled < before) clears++;
      expect(s.filled).toBeLessThanOrEqual(20 * 12 * PIPE_FILL + 4);
      expect(s.pipes.length).toBeLessThanOrEqual(3);
    }
    expect(clears).toBeGreaterThan(0);
  });
});

describe("the maze", () => {
  it("is solvable corner to corner in steps of one open cell", () => {
    for (const seed of [1, 2, 3]) {
      const m = mazeMake(16, 10, mulberry32(seed));
      const path = mazeSolve(m);
      expect(path[0]).toBe(0);
      expect(path[path.length - 1]).toBe(16 * 10 - 1);
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!;
        const b = path[i]!;
        const open = b === a + 1 ? !m.right[a] : b === a - 1 ? !m.right[b] : b === a + 16 ? !m.down[a] : b === a - 16 ? !m.down[b] : false;
        expect(open).toBe(true);
      }
    }
  });
});
