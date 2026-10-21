import { describe, expect, it } from "vitest";
import { MAX_PARTICLES, confettiEmitters, particlesAt, starsAt, type Emitter } from "../src/cutscene/kit/physics.ts";
import { blink, clamp01, countdownParts, countUp, cuesDue, ease, eased, fakeProgress, hashSeed, hourglass, keyframes, loop, marqueeX, noise1, progress, pulse, rng, stormSchedule, typedCount, typedDuration } from "../src/cutscene/kit/time.ts";
import { openStyle } from "../src/cutscene/kit/win98.tsx";

describe("kit time — the basics", () => {
  it("progress, loop, blink and pulse are pure functions of t", () => {
    expect(progress(500, 0, 1000)).toBe(0.5);
    expect(progress(-5, 0, 1000)).toBe(0);
    expect(progress(5000, 0, 1000)).toBe(1);
    expect(progress(10, 10, 0)).toBe(1);
    expect(loop(2500, 1000)).toBeCloseTo(0.5);
    expect(loop(-250, 1000)).toBeCloseTo(0.75);
    expect(blink(100, 1000)).toBe(true);
    expect(blink(600, 1000)).toBe(false);
    expect(pulse(0, 1000)).toBeCloseTo(0);
    expect(pulse(500, 1000)).toBeCloseTo(1);
    expect(clamp01(3)).toBe(1);
  });

  it("every ease starts at 0 and ends at 1", () => {
    for (const [name, fn] of Object.entries(ease)) {
      expect(fn(0), name).toBeCloseTo(0, 6);
      expect(fn(1), name).toBeCloseTo(1, 6);
    }
    expect(ease.outBack(0.7)).toBeGreaterThan(1); // the overshoot
    expect(eased(500, 0, 1000, ease.linear)).toBe(0.5);
  });

  it("keyframes interpolate between frames and hold at the ends", () => {
    const f = [
      { t: 0, x: 0, y: 10 },
      { t: 1000, x: 100, y: 10 },
      { t: 2000, x: 100, y: 30 },
    ];
    expect(keyframes(-100, f)).toEqual({ x: 0, y: 10 });
    expect(keyframes(500, f, ease.linear)).toEqual({ x: 50, y: 10 });
    expect(keyframes(1500, f, ease.linear)).toEqual({ x: 100, y: 20 });
    expect(keyframes(9000, f)).toEqual({ x: 100, y: 30 });
  });

  it("seeded randomness is the same everywhere", () => {
    const a = rng(42);
    const b = rng(42);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
    expect(rng(43)()).not.toBe(xs[0]);
    expect(hashSeed("Winamp")).toBe(hashSeed("Winamp"));
    expect(hashSeed("Winamp")).not.toBe(hashSeed("Excel"));
    expect(noise1(7, 3)).toBe(noise1(7, 3));
  });
});

describe("kit time — text and numbers", () => {
  it("types at cps, hesitating after punctuation", () => {
    expect(typedCount("Hello", 0, { cps: 10 })).toBe(0);
    expect(typedCount("Hello", 250, { cps: 10 })).toBe(2);
    expect(typedCount("Hello", 99_999, { cps: 10 })).toBe(5);
    expect(typedCount("Hello", 1250, { cps: 10, start: 1000 })).toBe(2);
    // "Hi. There": the full stop holds 6 characters' worth.
    expect(typedCount("Hi. There", 300, { cps: 10 })).toBe(3);
    expect(typedCount("Hi. There", 800, { cps: 10 })).toBe(3);
    expect(typedCount("Hi. There", 1000, { cps: 10 })).toBe(4);
    expect(typedCount("Hi. There", 1000, { cps: 10, pauses: false })).toBe(9);
    expect(typedDuration("Hi.", { cps: 10 })).toBe(900);
    expect(typedCount("Hi.", typedDuration("Hi.", { cps: 10 }), { cps: 10 })).toBe(3);
  });

  it("counts up, eased, and lands exactly", () => {
    expect(countUp(0, 0, 100, 0, 1000)).toBe(0);
    expect(countUp(1000, 0, 100, 0, 1000)).toBe(100);
    expect(countUp(500, 0, 100, 0, 1000, ease.linear)).toBe(50);
    expect(countUp(500, 0, 100, 0, 1000)).toBeGreaterThan(50); // out-cubic is ahead
  });

  it("a fake progress bar lurches but never goes back, and finishes on time", () => {
    let last = 0;
    let flat = 0;
    for (let t = 0; t <= 10_000; t += 50) {
      const v = fakeProgress(t, 10_000, 3);
      expect(v).toBeGreaterThanOrEqual(last - 1e-12);
      if (v === last && t > 0) flat++;
      last = v;
    }
    expect(fakeProgress(10_000, 10_000, 3)).toBe(1);
    expect(fakeProgress(0, 10_000, 3)).toBe(0);
    expect(flat).toBeGreaterThan(10); // it stalls
    expect(fakeProgress(9_500, 10_000, 3)).toBeLessThan(1);
  });

  it("a marquee wraps; a countdown reads m:ss and h:mm:ss", () => {
    expect(marqueeX(1000, 100, 300)).toBe(100);
    expect(marqueeX(4000, 100, 300)).toBe(100);
    expect(marqueeX(1000, 100, 0)).toBe(0);
    expect(countdownParts(65_400)).toMatchObject({ m: 1, s: 5, tenths: 4, text: "1:05" });
    expect(countdownParts(3_725_000).text).toBe("1:02:05");
    expect(countdownParts(-5).text).toBe("0:00");
  });
});

describe("kit time — schedules", () => {
  it("a popup storm is seeded, in order, slow then fast, inside the area", () => {
    const s = stormSchedule(5, 20, 1000, 6000);
    expect(s).toEqual(stormSchedule(5, 20, 1000, 6000));
    expect(s.length).toBe(20);
    expect(s[0]!.at).toBe(1000);
    expect(s[19]!.at).toBe(7000);
    for (let i = 1; i < s.length; i++) expect(s[i]!.at).toBeGreaterThan(s[i - 1]!.at);
    // The gaps shrink: a pile-up.
    expect(s[1]!.at - s[0]!.at).toBeGreaterThan(s[19]!.at - s[18]!.at);
    for (const p of s) expect(p.x >= 0 && p.x <= 0.75 && p.y >= 0 && p.y <= 0.7).toBe(true);
    expect(stormSchedule(6, 20, 1000, 6000)).not.toEqual(s);
  });

  it("cues fire once as t crosses them, never late after a jump", () => {
    expect(cuesDue(0, 100, [50, 100, 150])).toEqual([50, 100]);
    expect(cuesDue(100, 200, [50, 100, 150])).toEqual([150]);
    expect(cuesDue(200, 200, [200])).toEqual([]);
    expect(cuesDue(0, 5000, [100, 4800], 500)).toEqual([4800]); // a reload: the old one is skipped
    expect(cuesDue(Number.NEGATIVE_INFINITY, 0, [0])).toEqual([0]); // the first frame
    expect(cuesDue(300, 100, [200])).toEqual([]); // back in time
  });

  it("the hourglass drains then turns over", () => {
    expect(hourglass(0)).toEqual({ sand: 1, angle: 0 });
    expect(hourglass(1000, 2400, 400).sand).toBeCloseTo(0.5);
    expect(hourglass(2200, 2400, 400)).toMatchObject({ sand: 0 });
    expect(hourglass(2200, 2400, 400).angle).toBeCloseTo(90);
    expect(hourglass(2400, 2400, 400)).toEqual({ sand: 1, angle: 0 });
  });
});

describe("kit physics", () => {
  const burst: Emitter = { x: 0.5, y: 0.5, start: 0, end: 1000, rate: 100, life: 2000, speed: 0.5, angle: -90, spread: 60, gravity: 1, size: 6, colors: ["#fff", "#f00"], shape: "dot", seed: 3 };

  it("particles are born on the rate, live their life, and are the same at the same t", () => {
    expect(particlesAt([burst], -1)).toEqual([]);
    expect(particlesAt([burst], 500).length).toBe(51);
    expect(particlesAt([burst], 1500).length).toBe(101);
    expect(particlesAt([burst], 2500).length).toBe(51); // the first half are dead (born 500…1000 live on)
    expect(particlesAt([burst], 3001).length).toBe(0);
    expect(particlesAt([burst], 1234)).toEqual(particlesAt([burst], 1234));
  });

  it("they fly up then fall (gravity), and fade at the end", () => {
    const at = (t: number) => particlesAt([{ ...burst, rate: 1, end: 1, spread: 0, speedJitter: 0 }], t)[0]!;
    expect(at(200).y).toBeLessThan(0.5);
    expect(at(1999).y).toBeGreaterThan(at(500).y);
    expect(at(100).alpha).toBe(1);
    expect(at(1900).alpha).toBeLessThan(0.3);
  });

  it("never more than the cap", () => {
    const flood: Emitter = { ...burst, rate: 5000, end: 5000, life: 5000 };
    expect(particlesAt([flood], 2000).length).toBe(MAX_PARTICLES);
    expect(particlesAt([flood], 2000, 16 / 9, 50).length).toBe(50);
    expect(particlesAt([flood], 2000, 16 / 9, 9999).length).toBe(MAX_PARTICLES);
  });

  it("confetti covers the screen; stars fly toward the glass and wrap", () => {
    const c = confettiEmitters(0, 3000);
    expect(particlesAt(c, 400).length).toBeGreaterThan(50);
    const a = starsAt(50, 0, 0.3);
    const b = starsAt(50, 500, 0.3);
    expect(a.length).toBe(50);
    expect(b[0]!.z).not.toBe(a[0]!.z);
    for (const s of starsAt(50, 123_456, 0.3)) expect(s.z >= 0 && s.z <= 1).toBe(true);
  });
});

describe("kit windows", () => {
  it("pop open with an overshoot, or only fade under reduced motion", () => {
    expect(openStyle(0, false, false).opacity).toBe(0);
    expect(openStyle(1, false, false)).toEqual({ transform: "scale(1.0000)", opacity: 1 });
    expect(openStyle(0.5, true, true)).toEqual({ transform: "translate(-50%, -50%) ", opacity: 0.5 });
    expect(openStyle(1, true, false).transform).toBe("none");
  });
});

describe("the noise grain (OB-8)", () => {
  it("fills grey levels off its seed, the same each time, leaving alpha alone", async () => {
    const { fillGrain } = await import("../src/cutscene/kit/effects.tsx");
    const a = new Uint8ClampedArray(16).fill(7);
    const b = new Uint8ClampedArray(16).fill(7);
    fillGrain(a, 3);
    fillGrain(b, 3);
    expect([...a]).toEqual([...b]);
    for (let i = 0; i < a.length; i += 4) {
      expect(a[i]).toBe(a[i + 1]);
      expect(a[i + 3]).toBe(7);
    }
  });
});
