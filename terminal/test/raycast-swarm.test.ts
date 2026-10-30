import { describe, expect, it } from "vitest";
import type { Projected } from "../src/raycast/raycast.ts";
import { BODY_PIECES, drawSwarm, FACE_GRID, NEAR_M, swarmPieces } from "../src/raycast/swarm.ts";

/** A calm moment for this seed (no storm, so a near face holds). */
function calmAt(seed: number): number {
  for (let t = 0; t < 60_000; t += 45) {
    const { face } = swarmPieces(seed, t, 1);
    if (face.every((p, i) => Math.abs(p.y - Math.floor(i / FACE_GRID) / FACE_GRID) < 1e-9)) return t;
  }
  throw new Error("never calm");
}

describe("the raycaster's swarm", () => {
  it("cuts the whole picture into the face and a handful of slivers", () => {
    const { face, body } = swarmPieces(3, 1000, 2);
    expect(face).toHaveLength(FACE_GRID * FACE_GRID);
    expect(body).toHaveLength(BODY_PIECES);
    const covered = face.reduce((a, p) => a + p.sw * p.sh, 0);
    expect(covered).toBeCloseTo(1);
    for (const p of [...face, ...body]) {
      expect(p.sx).toBeGreaterThanOrEqual(0);
      expect(p.sy).toBeGreaterThanOrEqual(0);
      expect(p.sx + p.sw).toBeLessThanOrEqual(1 + 1e-9);
      expect(p.sy + p.sh).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("moves in steps: the same tick draws the same pieces, the next one doesn't", () => {
    const tick = 1000 / 11;
    const a = Math.ceil(5000 / tick) * tick;
    expect(swarmPieces(3, a + 1, 2)).toEqual(swarmPieces(3, a + tick / 2, 2));
    expect(swarmPieces(3, a + 1, 2).body).not.toEqual(swarmPieces(3, a + tick + 1, 2).body);
  });

  it("near the camera and out of a storm the face holds together", () => {
    const t = calmAt(7);
    const { face } = swarmPieces(7, t, NEAR_M - 1);
    face.forEach((p, i) => expect(p.y).toBeCloseTo(Math.floor(i / FACE_GRID) / FACE_GRID));
  });

  it("two ghosts never move as one", () => {
    expect(swarmPieces(1, 4000, 2).body).not.toEqual(swarmPieces(2, 4000, 2).body);
  });

  describe("drawSwarm", () => {
    const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 }) as Projected;
    const head = box(100, 20, 160, 80);
    const body = box(110, 80, 150, 170);
    const ctx = () => {
      const c = { draws: [] as number[][], fills: 0, imageSmoothingEnabled: true, globalAlpha: 1, fillStyle: "", drawImage: (_i: unknown, ...a: number[]) => c.draws.push(a), fillRect: () => c.fills++ };
      return c;
    };
    const run = (c: ReturnType<typeof ctx>, img: unknown) => drawSwarm(c as unknown as CanvasRenderingContext2D, head, body, img as HTMLImageElement | null, "#0f0", swarmPieces(3, 1000, 2));

    it("crops a wide picture to its middle square, every piece inside it", () => {
      const c = ctx();
      run(c, { complete: true, naturalWidth: 400, naturalHeight: 200 });
      expect(c.draws).toHaveLength(FACE_GRID * FACE_GRID + BODY_PIECES);
      for (const [sx, sy, sw, sh] of c.draws) {
        expect(sx!).toBeGreaterThanOrEqual(100);
        expect(sx! + sw!).toBeLessThanOrEqual(300 + 1e-6);
        expect(sy!).toBeGreaterThanOrEqual(0);
        expect(sy! + sh!).toBeLessThanOrEqual(200 + 1e-6);
      }
      expect(c.imageSmoothingEnabled).toBe(true); // handed back
    });

    it("no picture, or one still loading, is static in the ghost's colour", () => {
      for (const img of [null, { complete: false, naturalWidth: 0, naturalHeight: 0 }]) {
        const c = ctx();
        run(c, img);
        expect(c.draws).toHaveLength(0);
        expect(c.fills).toBe(FACE_GRID * FACE_GRID + BODY_PIECES);
        expect(c.globalAlpha).toBe(1);
      }
    });
  });
});
