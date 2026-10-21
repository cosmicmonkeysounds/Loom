import { describe, expect, it, vi } from "vitest";
import { context2d, releaseCanvas } from "../src/canvas-release.ts";

describe("canvas memory (OB-7)", () => {
  it("a released canvas is 0 × 0; a refused context warns once, never throws", () => {
    const c = { width: 640, height: 480, getContext: () => null } as unknown as HTMLCanvasElement;
    releaseCanvas(c);
    expect([c.width, c.height]).toEqual([0, 0]);
    releaseCanvas(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(context2d(c)).toBeNull();
    expect(context2d(c)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
