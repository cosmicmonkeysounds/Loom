import { describe, expect, it } from "vitest";
import { MOSH_CLEAN, MOSH_CYCLE_MS, MOSH_GRIDS, MOSH_PEAK, drawMosh, moshCoverage, moshCycleAt, moshPlan, moshSeed, rotBleed, takeBleed, type MoshCtx, type MoshGrid } from "../src/dream/mosh.ts";
import { lineSlices } from "../src/dream/stamp.ts";

const grid: MoshGrid = MOSH_GRIDS.wall;
const seed = moshSeed("hall");

function recorder() {
  const draws: Array<{ src: string; alpha: number; op: string; sx: number; sy: number; sw: number; dx: number; dy: number }> = [];
  let clears = 0;
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    clearRect() {
      clears += 1;
    },
    drawImage(src: string, sx: number, sy: number, sw: number, _sh: number, dx: number, dy: number) {
      draws.push({ src, alpha: ctx.globalAlpha, op: ctx.globalCompositeOperation, sx, sy, sw, dx, dy });
    },
  };
  return { ctx: ctx as unknown as MoshCtx, draws, clears: () => clears };
}

describe("a cycle of the mosh", () => {
  const plan = moshPlan(seed, 3, grid);
  it("starts clean: the scene stands whole for its keyframe", () => {
    expect(moshCoverage(plan, MOSH_CLEAN - 0.01)).toBe(0);
  });
  it("never takes more than its peak: what gets through stays readable", () => {
    expect(moshCoverage(plan, 1)).toBeGreaterThan(MOSH_PEAK - 0.03);
    expect(moshCoverage(plan, 1)).toBeLessThanOrEqual(MOSH_PEAK + 0.01);
  });
  it("grows, never shrinks, through the cycle", () => {
    let last = 0;
    for (let p = 0; p <= 1; p += 0.05) {
      const c = moshCoverage(plan, p);
      expect(c).toBeGreaterThanOrEqual(last);
      last = c;
    }
  });
  it("wipes on the next keyframe: nothing stays bad past a cycle", () => {
    expect(moshCycleAt(MOSH_CYCLE_MS * 2.5)).toEqual({ n: 2, phase: 0.5 });
    expect(moshCycleAt(-10)).toEqual({ n: 0, phase: 0 });
  });
  it("rots differently every cycle and on every terminal (a pure function of both)", () => {
    const same = (a: Float32Array, b: Float32Array) => a.every((v, i) => v === b[i]);
    expect(same(moshPlan(seed, 3, grid).births, plan.births)).toBe(true);
    expect(same(moshPlan(seed, 4, grid).births, plan.births)).toBe(false);
    expect(same(moshPlan(moshSeed("ram"), 3, grid).births, plan.births)).toBe(false);
  });
  it("takes the whole screen in the takeover", () => {
    const take = moshPlan(seed, 0, grid, 1, 0, 0.82);
    expect(moshCoverage(take, 0.83)).toBe(1);
  });
  it("is a cycle slower than 3 Hz, by a long way: nothing flashes", () => {
    expect(1000 / MOSH_CYCLE_MS).toBeLessThan(3);
  });
});

describe("drawing a tick", () => {
  const plan = moshPlan(seed, 3, grid);
  const opts = { scene: "scene", prev: "prev", dream: "dream", bleed: rotBleed };
  it("draws nothing while the keyframe stands", () => {
    const r = recorder();
    expect(drawMosh(r.ctx, plan, { ...opts, phase: 0.1, was: 0 })).toBe(0);
    expect(r.draws).toEqual([]);
    expect(r.clears()).toBe(1);
  });
  it("a block that just went takes the scene's own pixels: it drags what was there", () => {
    const r = recorder();
    drawMosh(r.ctx, plan, { ...opts, phase: 0.4, was: 0 });
    expect(r.draws.some((d) => d.src === "scene")).toBe(true);
    expect(r.draws.some((d) => d.src === "prev")).toBe(false);
  });
  it("a block already gone drags its own last tick: the smear", () => {
    const r = recorder();
    drawMosh(r.ctx, plan, { ...opts, phase: 0.6, was: 0.59 });
    expect(r.draws.filter((d) => d.src === "prev").length).toBeGreaterThan(0);
  });
  it("offsets every copy by the block's drag, and bleeds the dream in over it", () => {
    const r = recorder();
    drawMosh(r.ctx, plan, { ...opts, phase: 0.8, was: 0.79 });
    const dream = r.draws.filter((d) => d.src === "dream");
    expect(dream.length).toBeGreaterThan(0);
    expect(dream.every((d) => d.alpha > 0 && d.alpha <= 1)).toBe(true);
    expect(dream.some((d) => d.op === "source-over")).toBe(true);
  });
  it("takes only the dream's colour on some blocks, in most cycles", () => {
    const tinted = [0, 1, 2, 3, 4, 5, 6, 7].filter((n) => moshPlan(seed, n, grid).chroma.some((v) => v === 1));
    expect(tinted.length).toBeGreaterThanOrEqual(6);
  });
  it("merges neighbouring blocks that move alike into one draw", () => {
    const r = recorder();
    const runs = drawMosh(r.ctx, plan, { ...opts, phase: 1, was: 0.99 });
    expect(runs).toBeLessThan(moshCoverage(plan, 1) * grid.cols * grid.rows);
    expect(r.draws.some((d) => d.sw > grid.block)).toBe(true);
  });
  it("leaves the context as it found it", () => {
    const r = recorder();
    drawMosh(r.ctx, plan, { ...opts, phase: 0.9, was: 0.8 });
    expect(r.ctx.globalAlpha).toBe(1);
    expect(r.ctx.globalCompositeOperation).toBe("source-over");
  });
  it("runs with no picture of the dream yet", () => {
    const r = recorder();
    drawMosh(r.ctx, plan, { ...opts, dream: null, phase: 0.8, was: 0.79 });
    expect(r.draws.every((d) => d.src !== "dream")).toBe(true);
  });
  it("stays cheap on a wall: well under a thousand draws a tick", () => {
    const r = recorder();
    drawMosh(r.ctx, plan, { ...opts, phase: 1, was: 0.99 });
    expect(r.draws.length).toBeLessThan(1000);
    expect(grid.fps).toBeLessThanOrEqual(12);
  });
  it("bleeds fully only in the takeover", () => {
    expect(rotBleed(1)).toBeLessThan(1);
    expect(takeBleed(1)).toBe(1);
  });
});

describe("the scene's copy", () => {
  it("cuts a wrapped line by its boxes' widths", () => {
    expect(lineSlices("abcdefgh", [100, 100])).toEqual(["abcd", "efgh"]);
    expect(lineSlices("abcdef", [200, 100])).toEqual(["abcd", "ef"]);
  });
  it("leaves one line whole", () => {
    expect(lineSlices("abc", [10])).toEqual(["abc"]);
    expect(lineSlices("abc", [])).toEqual(["abc"]);
    expect(lineSlices("abc", [0, 0])).toEqual(["abc"]);
  });
});
