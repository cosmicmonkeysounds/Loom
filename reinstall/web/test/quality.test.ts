//! (wave 39, C4) The graphics quality: the tiers, the cap, the remembered
//! setting and `auto`'s frame-time rule.
import { describe, expect, it } from "vitest";
import { AUTO, AutoQuality, capOf, choiceAllowed, loadQuality, parseQuality, PRESSURE_PIXEL_RATIO, QUALITY_KEY, saveQuality, settingsAt, startLevel, TIERS, tierOf, type QualityLevel } from "../src/game/quality.ts";

/** Feed `ms`-long frames for `forMs`, from `t`; returns [the end time, every change]. */
function run(q: AutoQuality, t: number, ms: number, forMs: number): [number, QualityLevel[]] {
  const changes: QualityLevel[] = [];
  const end = t + forMs;
  while (t < end) {
    t += ms;
    const c = q.sample(t, ms);
    if (c !== null) changes.push(c);
  }
  return [t, changes];
}

describe("the tiers", () => {
  it("grow from low to high as the contract's table says", () => {
    expect(TIERS.low).toMatchObject({ pointLights: 2, bloom: "off", post: false, msaa: 0, pixelRatio: 1, haze: 0 });
    expect(TIERS.medium).toMatchObject({ pointLights: 4, bloom: "half", post: true, film: true, chroma: false, msaa: 0, pixelRatio: 1, haze: 1 });
    expect(TIERS.high).toMatchObject({ pointLights: 8, bloom: "full", post: true, film: true, chroma: true, msaa: 4, pixelRatio: 1.5, haze: 2 });
  });

  it("caps the pixel ratio by the device's, and drops low's under pressure", () => {
    expect(settingsAt(3, 2).pixelRatio).toBe(1.5);
    expect(settingsAt(3, 1).pixelRatio).toBe(1);
    expect(settingsAt(2, 2).pixelRatio).toBe(1);
    expect(settingsAt(1, 2).pixelRatio).toBe(1);
    expect(settingsAt(0, 2).pixelRatio).toBe(PRESSURE_PIXEL_RATIO);
    expect(settingsAt(0, 2).tier).toBe("low");
    expect(settingsAt(2, Number.NaN).pixelRatio).toBe(1);
    expect([0, 1, 2, 3].map((l) => tierOf(l as QualityLevel))).toEqual(["low", "low", "medium", "high"]);
  });
});

describe("the setting and the cap", () => {
  it("reads a choice off a URL or storage", () => {
    expect(parseQuality("High")).toBe("high");
    expect(parseQuality(" auto ")).toBe("auto");
    expect(parseQuality("ultra")).toBeNull();
    expect(parseQuality(3)).toBeNull();
    expect(capOf(null)).toBe("high");
    expect(capOf("auto")).toBe("high");
    expect(capOf("medium")).toBe("medium");
  });

  it("starts auto at medium on a desktop, low on a touch screen, never over the cap", () => {
    expect(startLevel("auto", "high", false)).toBe(2);
    expect(startLevel("auto", "high", true)).toBe(1);
    expect(startLevel("auto", "low", false)).toBe(1);
    expect(startLevel("high", "high", true)).toBe(3);
    expect(startLevel("high", "medium", false)).toBe(2);
    expect(choiceAllowed("high", "medium")).toBe(false);
    expect(choiceAllowed("auto", "low")).toBe(true);
    expect(choiceAllowed("low", "low")).toBe(true);
  });

  it("remembers the setting, and survives storage that throws", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadQuality(s)).toBe("auto");
    saveQuality("low", s);
    expect(m.get(QUALITY_KEY)).toBe("low");
    expect(loadQuality(s)).toBe("low");
    m.set(QUALITY_KEY, "garbage");
    expect(loadQuality(s)).toBe("auto");
    const bad = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadQuality(bad)).toBe("auto");
    expect(() => saveQuality("high", bad)).not.toThrow();
    expect(loadQuality(null)).toBe("auto");
  });
});

describe("auto", () => {
  it("steps down when the 2 s median is over 24 ms, at most once per 5 s", () => {
    const q = new AutoQuality({ start: 2, max: 3, adaptive: true, now: 0 });
    // Slow from the start: no change before 5 s after the start.
    const [t1, c1] = run(q, 0, 40, 4900);
    expect(c1).toEqual([]);
    const [t2, c2] = run(q, t1, 40, 1000);
    expect(c2).toEqual([1]);
    // Still slow: the next step waits another 5 s (and a fresh 2 s window).
    const [t3, c3] = run(q, t2, 40, 3800);
    expect(c3).toEqual([]);
    const [, c4] = run(q, t3, 40, 2000);
    expect(c4).toEqual([0]);
    expect(settingsAt(q.level, 2).pixelRatio).toBe(PRESSURE_PIXEL_RATIO);
    // Never below level 0.
    expect(run(q, 20_000, 60, 20_000)[1]).toEqual([]);
  });

  it("a few slow frames don't move it — the median does", () => {
    const q = new AutoQuality({ start: 2, max: 3, adaptive: true, now: 0 });
    let t = 0;
    const changes: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const ms = i % 4 === 0 ? 60 : 16.7;
      t += ms;
      const c = q.sample(t, ms);
      if (c !== null) changes.push(c);
    }
    expect(changes.every((c) => c > 2)).toBe(true);
  });

  it("steps up after 10 s holding the display's rate, never over its max", () => {
    const q = new AutoQuality({ start: 1, max: 2, adaptive: true, now: 0 });
    const [t1, c1] = run(q, 0, 16.7, 11_000);
    expect(c1).toEqual([]); // the first window needs 2 s before it counts
    const [t2, c2] = run(q, t1, 16.7, 2000);
    expect(c2).toEqual([2]);
    expect(run(q, t2, 16.7, 60_000)[1]).toEqual([]); // max 2
  });

  it("goes back up to a level it left only after a longer wait each time", () => {
    const q = new AutoQuality({ start: 3, max: 3, adaptive: true, now: 0 });
    let [t, c] = run(q, 0, 40, 7000);
    expect(c).toEqual([2]);
    // Fast again: 10 s × 3 before trying high once more.
    [t, c] = run(q, t, 16.7, AUTO.upHoldMs * 2);
    expect(c).toEqual([]);
    [t, c] = run(q, t, 16.7, AUTO.upHoldMs * 2);
    expect(c).toEqual([3]);
  });

  it("ignores pauses, and a fixed choice never moves", () => {
    const q = new AutoQuality({ start: 2, max: 3, adaptive: true, now: 0 });
    expect(run(q, 0, 1000, 30_000)[1]).toEqual([]);
    const fixed = new AutoQuality({ start: 3, max: 3, adaptive: false, now: 0 });
    expect(run(fixed, 0, 60, 30_000)[1]).toEqual([]);
    expect(fixed.level).toBe(3);
  });

  it("a reset after a hidden tab starts a fresh window and waits", () => {
    const q = new AutoQuality({ start: 2, max: 3, adaptive: true, now: 0 });
    const [t1] = run(q, 0, 16.7, 6000);
    q.reset(t1);
    expect(q.median()).toBeNull();
    const [t2, c] = run(q, t1, 40, 4900);
    expect(c).toEqual([]);
    expect(run(q, t2, 40, 500)[1]).toEqual([1]);
  });
});
