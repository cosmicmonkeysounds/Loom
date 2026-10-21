import { describe, expect, it } from "vitest";
import {
  BOTTLE_SEATS,
  BOTTLE_EMPTY_SPIN_MS,
  BOTTLE_SPIN_MS,
  INTRO_POST,
  bootLinesAt,
  bottleFree,
  bottleLanding,
  bottleSeat,
  bottleTicks,
  bounceAt,
  captionAt,
  introCaptions,
  sentencesOf,
  countdownLeft,
  endDue,
  marchersAt,
  memoryCount,
  momentAfter,
  momentNear,
  ODOMETER_ROLL,
  odometerWheel,
  periodicCues,
  phoneDare,
  verdictOf,
  rainColumn,
  resultsKind,
  seatAngle,
  seatUnder,
  windowClock,
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
    for (const spin of [BOTTLE_SPIN_MS, BOTTLE_EMPTY_SPIN_MS]) {
      const seat = bottleSeat("Excel");
      const end = bottleLanding(spin, seat, BOTTLE_SEATS, spin);
      expect(seatUnder(end)).toBe(seat);
      expect(end % 360).toBeCloseTo(seatAngle(seat), 6);
      expect(bottleLanding(spin + 5000, seat, BOTTLE_SEATS, spin)).toBe(end);
      expect(bottleLanding(0, seat, BOTTLE_SEATS, spin)).toBe(0);
      // Faster at the start than near the end.
      const w = spin / 6;
      const early = bottleLanding(w, seat, BOTTLE_SEATS, spin);
      const late = bottleLanding(spin * 0.86, seat, BOTTLE_SEATS, spin) - bottleLanding(spin * 0.86 - w, seat, BOTTLE_SEATS, spin);
      expect(early).toBeGreaterThan(late * 3);
      // The rock: past the seat, then back onto it.
      expect(bottleLanding(spin * 0.87, seat, BOTTLE_SEATS, spin)).toBeGreaterThan(end);
    }
  });

  it("lands before the TV's voice names the pick (the same poll brings both)", () => {
    expect(BOTTLE_SPIN_MS).toBeLessThanOrEqual(2000);
    expect(BOTTLE_EMPTY_SPIN_MS).toBeGreaterThan(BOTTLE_SPIN_MS);
  });

  it("ticks once per seat passed, never closer than the gap, never after it lands", () => {
    for (const spin of [BOTTLE_SPIN_MS, BOTTLE_EMPTY_SPIN_MS]) {
      const ticks = bottleTicks(3, BOTTLE_SEATS, spin);
      expect(ticks.length).toBeGreaterThan(10);
      for (let i = 1; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBeGreaterThanOrEqual(70);
      expect(Math.max(...ticks)).toBeLessThanOrEqual(spin);
    }
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

  it("tells the filing window from a question's results; the number is the story's own (results_q)", () => {
    const night = (q: number | null) => ({ results_q: q });
    expect(resultsKind(moments, night(0), 5100)).toEqual({ kind: "filing" });
    expect(resultsKind(moments, night(1), 50_050)).toEqual({ kind: "question", n: 1 });
    // A TV that missed the first press still numbers the second right: the count is the server's.
    expect(resultsKind(moments.slice(3), night(2), 120_100)).toEqual({ kind: "question", n: 2 });
    // History (at 0) or a ring that moved on: the story's count says which.
    expect(resultsKind([], night(3), 0)).toEqual({ kind: "question", n: 3 });
    expect(resultsKind([], night(0), 0)).toEqual({ kind: "filing" });
    // An older server (no results_q): a question with no number; nothing to go on: unknown.
    expect(resultsKind(moments, night(null), 50_050)).toEqual({ kind: "question", n: null });
    expect(resultsKind([], night(null), 777)).toEqual({ kind: "unknown" });
    expect(resultsKind([], night(7), 777)).toEqual({ kind: "unknown" });
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
    expect(windowClock(1000, 30_000, 60_000, 90_000)).toBe(30_000);
    expect(windowClock(0, 30_000, 60_000, 90_000)).toBeNull();
    // A window longer than its slide's hold: no clock at all (it would vanish mid-count).
    expect(windowClock(1000, 30_000, 120_000, 90_000)).toBeNull();
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
    // The POST is a flash: done before he speaks (≈ 1.5 s).
    expect(INTRO_POST[INTRO_POST.length - 1]!.at).toBeLessThan(1500);
  });

  it("captions a line a sentence at a time, back to back at the voice's pace", () => {
    expect(sentencesOf("I am X. I keep it running. Hi, you!")).toEqual(["I am X.", "I keep it running.", "Hi, you!"]);
    const c = introCaptions(["HELLO.", "I am X."], { start: 1000, cps: 10, gap: 200 });
    expect(c).toEqual([
      { text: "HELLO.", start: 1000, end: 1600 },
      { text: "I am X.", start: 1800, end: 2500 },
    ]);
    expect(captionAt(c, 999)).toBeNull();
    expect(captionAt(c, 1700)!.text).toBe("HELLO."); // held between sentences
    expect(captionAt(c, 9000)!.text).toBe("I am X.");
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

  it("the odometer rests on 000 and its rolls always land on 0", () => {
    for (let w = 0; w < 9; w++) {
      let zeros = 0;
      let n = 0;
      for (let t = 0; t < 26_000; t += 20) {
        const v = odometerWheel(t, w);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(10);
        if (v === 0) zeros++;
        n++;
      }
      // Most frames read 0 (the price is just 000.), and it does roll.
      expect(zeros / n, `wheel ${w}`).toBeGreaterThan(0.75);
      expect(zeros).toBeLessThan(n);
      // Just before a roll ends it is nearly back on 0 (it lands, never jumps).
      const end = 2600 * 3 - w * 37 + 2600 * ODOMETER_ROLL - 5;
      const v = odometerWheel(end, w);
      expect(Math.min(v, 10 - v), `wheel ${w} lands`).toBeLessThan(0.1);
    }
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

describe("tv1 time — the bottle's verdict", () => {
  const L = m(60, 50_000, "signal", "bottle_landed", "Winamp");
  const night = (open: boolean | null, pick: string | null = "Winamp") => ({ bottle_open: open, bottle_pick: pick });
  it("names the booth's three verdicts, folded", () => {
    expect(verdictOf("truth_answered")).toBe("answered");
    expect(verdictOf("Truth Refused")).toBe("refused");
    expect(verdictOf("chose-dare")).toBe("dare");
    expect(verdictOf("scan_ok")).toBeNull();
  });
  it("a phone's Dare: closed on the same pick, no Truth chosen, no verdict, no new draw — never history", () => {
    expect(phoneDare([L], night(false), "Winamp", 50_000)).toBe(true);
    expect(phoneDare([L], night(false), "winamp", 50_000)).toBe(true);
    expect(phoneDare([L], night(true), "Winamp", 50_000)).toBe(false);
    expect(phoneDare([L], night(null), "Winamp", 50_000)).toBe(false); // an older server
    expect(phoneDare([L], night(false, "Excel"), "Winamp", 50_000)).toBe(false);
    expect(phoneDare([L, m(61, 52_000, "beat", "Truth Question")], night(false), "Winamp", 50_000)).toBe(false);
    expect(phoneDare([L, m(62, 58_000, "signal", "truth_refused", "Winamp")], night(false), "Winamp", 50_000)).toBe(false);
    expect(phoneDare([L, m(63, 70_000, "signal", "bottle_empty")], night(false), "Winamp", 50_000)).toBe(false);
    expect(phoneDare([L], night(false), "Winamp", 0)).toBe(false);
  });
});
