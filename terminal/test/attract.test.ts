import { describe, expect, it } from "vitest";
import { ADS, AD_MS, MYSTIFY_TRAIL, SAVER_MS, attractSlide, mystifyInit, mystifyStep } from "../src/attract.ts";

describe("attract rotation", () => {
  it("alternates the screensaver with each ad in turn, wrapping", () => {
    expect(attractSlide(0)).toEqual({ kind: "saver" });
    expect(attractSlide(SAVER_MS - 1)).toEqual({ kind: "saver" });
    expect(attractSlide(SAVER_MS)).toEqual({ kind: "ad", index: 0 });
    expect(attractSlide(SAVER_MS + AD_MS)).toEqual({ kind: "saver" });
    expect(attractSlide(2 * SAVER_MS + AD_MS)).toEqual({ kind: "ad", index: 1 });
    const period = SAVER_MS + AD_MS;
    expect(attractSlide(ADS.length * period + SAVER_MS)).toEqual({ kind: "ad", index: 0 });
    expect(attractSlide(SAVER_MS, 0)).toEqual({ kind: "saver" });
    expect(attractSlide(-5)).toEqual({ kind: "saver" });
  });

  it("no ad names the character it keeps secret", () => {
    for (const ad of ADS) expect(`${ad.id} ${ad.title} ${ad.body} ${ad.button}`).not.toMatch(/trabolta/iu);
    expect(new Set(ADS.map((a) => a.id)).size).toBe(ADS.length);
  });
});

describe("mystify", () => {
  it("keeps every corner inside the screen and a bounded trail", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const shapes = mystifyInit(320, 200, rand);
    expect(shapes).toHaveLength(2);
    for (let i = 0; i < 2000; i++) mystifyStep(shapes, 320, 200);
    for (const s of shapes) {
      expect(s.trail).toHaveLength(MYSTIFY_TRAIL);
      for (const p of s.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(320);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(200);
      }
    }
  });
});
