import { describe, expect, it } from "vitest";
import {
  BOTTLE_SEATS,
  BOTTLE_SPIN_MS,
  EMPTY_RESULTS,
  INTRO_POST,
  bootLinesAt,
  bottleFree,
  bottleLanding,
  bottleSeat,
  bottleTicks,
  bounceAt,
  countdownLeft,
  endDue,
  marchersAt,
  memoryCount,
  momentAfter,
  momentNear,
  odometerWheel,
  periodicCues,
  rainColumn,
  resolveResults,
  seatAngle,
  seatUnder,
  windowLeft,
} from "../src/cutscene/kit/tv1-time.ts";
import type { ScreenMoment } from "../src/screen.ts";

const m = (seq: number, at: number, kind: ScreenMoment["kind"], name: string, who: string | null = null): ScreenMoment => ({ seq, at, kind, name, who, kept: false });

describe("tv1 time — the bottle", () => {
  it("lands every program on a seat of its own, never seat 0 (the empty table's)", () => {
    for (const n of ["Winamp", "Excel", "MS Paint", "winamp", "  Winamp "]) {
      const s = bottleSeat(n);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThan(BOTTLE_SEATS);
    }
    expect(bottleSeat("Winamp")).toBe(bottleSeat("winamp"));
    expect(bottleSeat(null)).toBe(0);
  });

  it("the landing spin ends exactly on the seat, fast first, a rock at the end", () => {
    const seat = bottleSeat("Excel");
    const end = bottleLanding(BOTTLE_SPIN_MS, seat);
    expect(seatUnder(end)).toBe(seat);
    expect(end % 360).toBeCloseTo(seatAngle(seat), 6);
    expect(bottleLanding(BOTTLE_SPIN_MS + 5000, seat)).toBe(end);
    expect(bottleLanding(0, seat)).toBe(0);
    // Faster in the first second than in the last.
    const early = bottleLanding(1000, seat) - bottleLanding(0, seat);
    const late = bottleLanding(BOTTLE_SPIN_MS * 0.86, seat) - bottleLanding(BOTTLE_SPIN_MS * 0.86 - 1000, seat);
    expect(early).toBeGreaterThan(late * 3);
    // The rock: past the seat, then back onto it.
    expect(bottleLanding(BOTTLE_SPIN_MS * 0.87, seat)).toBeGreaterThan(end);
  });

  it("ticks once per seat passed, never closer than the gap, never after it lands", () => {
    const ticks = bottleTicks(3);
    expect(ticks.length).toBeGreaterThan(20);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBeGreaterThanOrEqual(70);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(BOTTLE_SPIN_MS);
  });

  it("spins freely forever before a pick", () => {
    expect(bottleFree(1000)).toBeGreaterThan(bottleFree(0));
    expect(bottleFree(61_000) - bottleFree(60_000)).toBeGreaterThan(600);
  });
});

describe("tv1 time — reading the moments", () => {
  const moments = [m(10, 5000, "signal", "first_moment_of_truth"), m(12, 9000, "beat", "Filing Closed"), m(20, 50_000, "signal", "read_the_results"), m(30, 90_000, "signal", "bottle_landed", "Winamp"), m(40, 120_000, "signal", "read_the_results")];

  it("finds the moment a slide came with (folded names), none for history", () => {
    expect(momentNear(moments, "signal", ["Bottle Landed"], 90_400)?.who).toBe("Winamp");
    expect(momentNear(moments, "signal", ["bottle_landed"], 95_000)).toBeNull();
    expect(momentNear(moments, "signal", ["bottle_landed"], 0)).toBeNull();
    expect(momentAfter(moments, "beat", ["filing closed"], 5000)?.seq).toBe(12);
    expect(momentAfter(moments, "beat", ["filing closed"], 10_000)).toBeNull();
  });

  it("tells the filing window from a question's results and numbers the questions", () => {
    let r = resolveResults(EMPTY_RESULTS, "e1", moments.slice(0, 1), 5100);
    expect(r.kind).toEqual({ kind: "filing" });
    r = resolveResults(r.mem, "e1", moments.slice(0, 3), 50_050);
    expect(r.kind).toEqual({ kind: "question", n: 1 });
    r = resolveResults(r.mem, "e1", moments, 120_100);
    expect(r.kind).toEqual({ kind: "question", n: 2 });
    // A reload (the ring has moved on): the memory keeps the slide's answer.
    expect(resolveResults(r.mem, "e1", [], 50_050).kind).toEqual({ kind: "question", n: 1 });
    // History, or nothing to go on: unknown.
    expect(resolveResults(r.mem, "e1", [], 0).kind).toEqual({ kind: "unknown" });
    expect(resolveResults(r.mem, "e1", [], 777).kind).toEqual({ kind: "unknown" });
  });

  it("a story restart forgets the questions; past three it shows no number", () => {
    let r = resolveResults(EMPTY_RESULTS, "e1", moments, 120_100);
    r = resolveResults(r.mem, "e2", [m(3, 7000, "signal", "read_the_results")], 7000);
    expect(r.kind).toEqual({ kind: "question", n: 1 });
    const many = [1, 2, 3, 4].map((i) => m(i, i * 1000, "signal", "read_the_results"));
    expect(resolveResults(EMPTY_RESULTS, "e3", many, 4000).kind).toEqual({ kind: "question", n: null });
  });
});

describe("tv1 time — clocks, marches, loops", () => {
  it("reads the story's countdown at the scene's frame, only the one it wants", () => {
    const s = { countdown: "hunt", remaining: 600, now: 100_000 };
    expect(countdownLeft(s, ["hunt"], 100_000, 0)).toBe(600_000);
    expect(countdownLeft(s, ["hunt"], 100_000, 5000)).toBe(595_000);
    expect(countdownLeft(s, ["hunt_2"], 100_000, 0)).toBeNull();
    expect(countdownLeft({ ...s, remaining: null }, ["hunt"], 1, 0)).toBeNull();
    expect(countdownLeft(s, ["hunt"], 100_000, 9_999_999)).toBe(0);
    expect(windowLeft(1000, 30_000, 120_000)).toBe(90_000);
    expect(windowLeft(0, 30_000, 120_000)).toBeNull();
  });

  it("marchers stay on the stage, stream in a loop, and hold still under reduced motion", () => {
    for (const t of [0, 1234, 99_999]) for (const mm of marchersAt(t, 20, 5000)) {
      expect(mm.x).toBeGreaterThanOrEqual(-0.1);
      expect(mm.x).toBeLessThanOrEqual(1.1);
      expect(mm.alpha).toBeGreaterThanOrEqual(0);
    }
    expect(marchersAt(1000, 5, 5000)).toEqual(marchersAt(6000, 5, 5000));
    expect(marchersAt(1000, 5, 5000, 1, true)).toEqual(marchersAt(3000, 5, 5000, 1, true));
  });

  it("repeating accents: the last two due, never ahead of t", () => {
    expect(periodicCues(500, 1000, 1000)).toEqual([]);
    expect(periodicCues(1000, 1000, 1000)).toEqual([1000]);
    expect(periodicCues(5500, 1000, 1000)).toEqual([4000, 5000]);
    expect(periodicCues(5500, 1000, 1000, 4500)).toEqual([3000, 4000]);
  });

  it("the POST counts memory in 64K steps and shows its lines in order", () => {
    expect(memoryCount(0, 1000, 1000)).toBe(0);
    expect(memoryCount(1500, 1000, 1000) % 64).toBe(0);
    expect(memoryCount(9999, 1000, 1000)).toBe(65_536);
    expect(bootLinesAt(INTRO_POST, 0)).toEqual([]);
    expect(bootLinesAt(INTRO_POST, 99_999).length).toBe(INTRO_POST.length);
    for (let i = 1; i < INTRO_POST.length; i++) expect(INTRO_POST[i]!.at).toBeGreaterThan(INTRO_POST[i - 1]!.at);
  });

  it("the bounce stays inside the frame", () => {
    for (let t = 0; t < 120_000; t += 777) {
      const b = bounceAt(t, 0.16, 0.28);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeLessThanOrEqual(0.84 + 1e-9);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeLessThanOrEqual(0.72 + 1e-9);
    }
  });

  it("the odometer rolls and stops dead on 0", () => {
    let zeros = 0;
    for (let t = 0; t < 26_000; t += 100) {
      const v = odometerWheel(t, 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      if (v === 0) zeros++;
    }
    expect(zeros).toBeGreaterThan(40);
  });

  it("the rain is a seeded stream of 0 / 1", () => {
    const c = rainColumn(1000, 3, 5);
    expect(c.chars).toMatch(/^[01]{14}$/u);
    expect(rainColumn(1000, 3, 5)).toEqual(c);
  });
});

describe("tv1 time — a take that ends early", () => {
  it("ends once, on the frame that reaches the end (or at once past it)", () => {
    expect(endDue(null, 100, 8000)).toBe(false);
    expect(endDue(7900, 7990, 8000)).toBe(false);
    expect(endDue(7990, 8010, 8000)).toBe(true);
    expect(endDue(8010, 8040, 8000)).toBe(false);
    // A reload past the end: the first frame ends it.
    expect(endDue(null, 9500, 8000)).toBe(true);
  });
});
