import { describe, expect, it } from "vitest";
import {
  CHIME_FLASH_MS,
  CUPS,
  THROW_MS,
  Y2K_CHIME_TEXT,
  beanHeap,
  chartLayout,
  chartRowAt,
  chimeFlash,
  danceBeat,
  driftLandings,
  driftPops,
  equaliser,
  glitchYear,
  kingBar,
  kingHeard,
  kingHpAt,
  kingLine,
  latestMoment,
  liveNow,
  liveRemaining,
  onGrid,
  recountRideAt,
  scenarioFor,
  scenarioOf,
  sinceAnswer,
  latch,
  tallyNumber,
  tallyOf,
  throwAt,
  y2kLevel,
} from "../src/cutscene/kit/tv2-time.ts";
import type { ScreenMoment } from "../src/screen.ts";

const m = (seq: number, at: number, kind: ScreenMoment["kind"], name: string): ScreenMoment => ({ seq, at, kind, name, who: null, kept: false });

describe("act 2 timelines — the live clock", () => {
  it("counts from the answer like the poll does, and ignores an answer over a minute old", () => {
    expect(sinceAnswer({ receivedAt: 1000 }, 3500)).toBe(2500);
    expect(sinceAnswer({ receivedAt: 1000 }, 500)).toBe(0);
    expect(sinceAnswer({ receivedAt: 1000 }, 1000 + 61_000)).toBe(0);
    expect(liveNow({ now: 50_000, receivedAt: 1000 }, 3000)).toBe(52_000);
  });

  it("reads only the named countdown, counted down since the answer", () => {
    expect(liveRemaining({ countdown: "y2k", remaining: 100, receivedAt: 0 }, "y2k", 4500)).toBe(96);
    expect(liveRemaining({ countdown: "summons", remaining: 100, receivedAt: 0 }, "y2k", 0)).toBeNull();
    expect(liveRemaining({ countdown: "y2k", remaining: 2, receivedAt: 0 }, "y2k", 9000)).toBe(0);
  });
});

describe("act 2 timelines — a hold's heartbeat", () => {
  it("is windowed off t: the grid points around it, however long the hold", () => {
    expect(onGrid(0, 4900, 4000, "buzz").map((c) => c[0])).toEqual([4900, 8900]);
    expect(onGrid(10_000, 4900, 4000, "buzz").map((c) => c[0])).toEqual([8900, 12_900]);
    // An hour in, still beating (the old fixed lists stopped at ~92 s).
    const late = onGrid(3_600_000, 4900, 4000, "buzz");
    expect(late[0]![0]).toBeLessThanOrEqual(3_600_000);
    expect(late[1]![0]).toBeGreaterThan(3_600_000);
    expect(late[1]![0] - late[0]![0]).toBe(4000);
    // A bounded window stops at `to`.
    expect(onGrid(5100, 700, 260, "type", undefined, 5200).map((c) => c[0])).toEqual([4860, 5120]);
    expect(onGrid(5150, 700, 260, "type", undefined, 5200).map((c) => c[0])).toEqual([5120]);
    expect(onGrid(6000, 700, 260, "type", undefined, 5200)).toEqual([]);
    expect(onGrid(0, 0, 100, "tick", { gain: 0.5 })[0]).toEqual([0, "tick", { gain: 0.5 }]);
  });
});

describe("act 2 timelines — the recount's ride", () => {
  it("rides ten seconds before the slide lets go, on either screen", () => {
    expect(recountRideAt("tv")).toBe(80_000);
    expect(recountRideAt("wall")).toBe(35_000);
  });
});

describe("act 2 timelines — moments a scene reads", () => {
  it("finds the newest matching moment, folded, from a time on", () => {
    const list = [m(1, 100, "beat", "Overshare Two"), m(2, 200, "sfx", "y2k_chime"), m(3, 300, "sfx", "Y2K Chime")];
    expect(latestMoment(list, "sfx", "y2k chime")?.seq).toBe(3);
    expect(latestMoment(list, "sfx", "y2k_chime", 301)).toBeNull();
    expect(latestMoment(list, "beat", "y2k_chime")).toBeNull();
  });

  it("says which overshare played", () => {
    expect(scenarioOf([m(1, 10, "beat", "Overshare Open"), m(2, 10, "beat", "overshare three")])).toEqual({ scenario: 3, at: 10 });
    expect(scenarioOf([m(1, 10, "beat", "Overshare Open")])).toBeNull();
    expect(scenarioOf([m(1, 10, "beat", "Overshare One")], 11)).toBeNull();
  });

  it("finds the scenario off its beat, else the night's scenario at the slide's own at", () => {
    expect(scenarioFor([m(4, 5000, "beat", "Overshare Three")], { scenario: null }, 4000)).toEqual({ scenario: 3, at: 5000 });
    // The ring rolled past the beat (a reload late in the slide): the night still says.
    expect(scenarioFor([], { scenario: 1 }, 4000)).toEqual({ scenario: 1, at: 4000 });
    expect(scenarioFor([], { scenario: null }, 4000)).toBeNull();
    expect(scenarioFor([], { scenario: 7 }, 4000)).toBeNull();
  });

  it("reads the round-two number off the TV's voice lines for that beat only", () => {
    const line = (text: string, beat: string | null = "Round Two Tally") => ({ seq: 1, from: "Trabolta", text, beat });
    expect(tallyNumber({ lines: [line("My confidence that we will defeat the malware is sixty-one percent.")] })).toBe(61);
    expect(tallyNumber({ lines: [line("My confidence that we will defeat the malware is twelve percent.")] })).toBe(12);
    expect(tallyNumber({ lines: [line("Twelve.", "Trust Chart")] })).toBeNull();
    expect(tallyNumber({ lines: [] })).toBeNull();
    expect(tallyNumber(null)).toBeNull();
  });

  it("never reads a guest's filing as the number: only the scripted sentence counts", () => {
    const line = (seq: number, text: string) => ({ seq, from: "Trabolta", text, beat: "Round Two Tally" });
    const said61 = { lines: [line(1, "The second collection is closed."), line(2, "Question four. 12"), line(3, "Question five. twelve years"), line(4, "My confidence that we will defeat the malware is sixty-one percent.")] };
    const said12 = { lines: [line(1, "Question four. 61"), line(2, "Question six. sixty-one"), line(3, "My confidence that we will defeat the malware is twelve percent."), line(4, "Twelve. I would like everyone to sit with that number.")] };
    expect(tallyNumber(said61)).toBe(61);
    expect(tallyNumber(said12)).toBe(12);
    expect(tallyNumber({ lines: [line(1, "Question four. 12"), line(2, "Question five. sixty-one")] })).toBeNull();
    // The night's own var wins over any line.
    expect(tallyOf(said12, { collection_complete: true })).toBe(61);
    expect(tallyOf(said61, { collection_complete: false })).toBe(12);
    expect(tallyOf(said61, { collection_complete: null })).toBe(61);
    expect(tallyOf(said12, { collection_complete: null })).toBe(12);
  });

  it("falls back on the night's collection_complete, and the scene latches what it read once", () => {
    const said = { lines: [{ seq: 1, from: "Trabolta", text: "My confidence that we will defeat the malware is sixty-one percent.", beat: "Round Two Tally" }] };
    const none = { collection_complete: null };
    expect(tallyOf(said, none)).toBe(61);
    expect(tallyOf(null, { collection_complete: false })).toBe(12);
    expect(tallyOf({ lines: [] }, { collection_complete: true })).toBe(61);
    expect(tallyOf(null, none)).toBeNull();
    // The voice block empties on the next poll (its cursor moved): the latch keeps 61.
    let held = latch<number>(null, 7, tallyOf(said, none));
    held = latch(held, 7, tallyOf({ lines: [] }, none));
    held = latch(held, 7, tallyOf(null, none));
    expect(held?.value).toBe(61);
    // A first frame with nothing yet, then the number: latched from then on.
    expect(latch<number>(null, 7, null)).toBeNull();
    // A new scene (seq) starts over.
    expect(latch(held, 8, null)).toBeNull();
    expect(latch(held, 8, 12)?.value).toBe(12);
  });
});

describe("act 2 timelines — the Y2K hour", () => {
  it("escalates at 11:30, 11:45, 11:55 and the last minute, and reads no clock as midnight", () => {
    expect(y2kLevel(3600)).toBe(0);
    expect(y2kLevel(1801)).toBe(0);
    expect(y2kLevel(1800)).toBe(1);
    expect(y2kLevel(900)).toBe(2);
    expect(y2kLevel(300)).toBe(3);
    expect(y2kLevel(60)).toBe(4);
    expect(y2kLevel(1)).toBe(4);
    expect(y2kLevel(0)).toBe(5);
    expect(y2kLevel(null)).toBe(5);
    expect(Y2K_CHIME_TEXT[2]).toContain("11:45 PM");
  });

  it("flashes a chime after the hour's own, for a few seconds only", () => {
    const slideAt = 10_000;
    const list = [m(1, slideAt, "sfx", "y2k_chime"), m(2, 60_000, "sfx", "y2k_chime")];
    expect(chimeFlash(list.slice(0, 1), slideAt, slideAt + 1000)).toBeNull(); // the opening chime is the slide's
    expect(chimeFlash(list, slideAt, 61_000)).toEqual({ at: 60_000, age: 1000 });
    expect(chimeFlash(list, slideAt, 60_000 + CHIME_FLASH_MS)).toBeNull();
    expect(chimeFlash(list, slideAt, 59_000)).toBeNull();
  });

  it("stutters the year only from 11:45, the same on every screen", () => {
    for (let t = 0; t < 20_000; t += 180) expect(glitchYear(t, 1)).toBe("1999");
    const years = new Set<string>();
    for (let t = 0; t < 20_000; t += 180) years.add(glitchYear(t, 4));
    expect(years.size).toBeGreaterThan(1);
    expect(glitchYear(5000, 4)).toBe(glitchYear(5000, 4));
  });
});

describe("act 2 timelines — the King", () => {
  it("chips the lost point white, then drains it, and flashes on the hit", () => {
    const before = kingBar(9, 15, 100, 400);
    expect(before.share).toBeCloseTo(9 / 15);
    expect(before.chip).toBe(0);
    const hit = kingBar(9, 15, 410, 400);
    expect(hit.chip).toBeCloseTo(1 / 15);
    expect(hit.flash).toBeGreaterThan(0.9);
    const later = kingBar(9, 15, 3000, 400);
    expect(later.chip).toBe(0);
    expect(later.flash).toBe(0);
    expect(kingBar(15, 15, 410, 400).chip).toBe(0); // nothing to chip past a full bar
  });

  it("says the house's lines at 10 and 5", () => {
    expect(kingLine(10, 15)).toContain("staggers");
    expect(kingLine(5, 15)).toContain("bleeding pixels");
    expect(kingLine(0, 15)).toContain("fallen");
    expect(kingLine(15, 15)).toContain("full strength");
  });
});

describe("act 2 timelines — the King's count", () => {
  it("counts back the hits since, forgets on a restore, and is heard until an ending", () => {
    const k = { hp: 8, max: 15 };
    const hit = (seq: number) => m(seq, 1, "signal", "king hit");
    expect(kingHpAt(k, [hit(1)], 1)).toBe(8);
    expect(kingHpAt(k, [hit(1), hit(2), hit(3)], 1)).toBe(10);
    expect(kingHpAt(k, [hit(1), m(2, 1, "signal", "restore_the_king"), hit(3)], 1)).toBeNull();
    expect(kingHpAt(k, [hit(1), m(2, 1, "beat", "king hit")], 1)).toBe(8); // only signals
    expect(kingHpAt({ hp: 15, max: 15 }, [hit(1), hit(2)], 1)).toBe(15); // never over the max
    expect(kingHpAt(null, [hit(1)], 1)).toBeNull();
    expect(kingHeard({ ended: null })).toBe(true);
    expect(kingHeard({ ended: false })).toBe(true);
    expect(kingHeard({ ended: true })).toBe(false);
  });
});

describe("act 2 timelines — Truth Pong", () => {
  it("racks ten cups 4-3-2-1", () => {
    expect(CUPS).toHaveLength(10);
    expect(CUPS.filter((c) => c.row === 0)).toHaveLength(4);
    expect(CUPS.filter((c) => c.row === 3)).toHaveLength(1);
  });

  it("throws on a fixed beat, deterministic, landing in time", () => {
    const a = throwAt(5 * THROW_MS + 600, 7);
    expect(a).toEqual(throwAt(5 * THROW_MS + 600, 7));
    expect(a.n).toBe(5);
    expect(throwAt(5 * THROW_MS + 100).landed).toBe(false);
    expect(throwAt(5 * THROW_MS + 1400).landed).toBe(true);
    const sinks = Array.from({ length: 200 }, (_, n) => throwAt(n * THROW_MS + 1).sink).filter(Boolean).length;
    expect(sinks).toBeGreaterThan(40);
    expect(sinks).toBeLessThan(140);
  });
});

describe("act 2 timelines — drifting popups", () => {
  it("are pure, stay open between 0 and 1, and keep coming back", () => {
    const at = (t: number) => driftPops(t, 3, { seed: 9, life: 4000, gap: 2000 });
    expect(at(12_345)).toEqual(at(12_345));
    for (let t = 0; t < 60_000; t += 250) for (const p of at(t)) expect(p.open >= 0 && p.open <= 1).toBe(true);
    const lives = new Set<number>();
    for (let t = 0; t < 60_000; t += 500) for (const p of at(t)) lives.add(p.life);
    expect(lives.size).toBeGreaterThan(5);
    expect(at(-1)).toEqual([]);
  });

  it("know when each lands (the sound cues), in order", () => {
    const o = { seed: 9, life: 4000, gap: 2000, start: 1000 };
    const land = driftLandings(2, 0, 30_000, o);
    expect(land.length).toBeGreaterThan(5);
    expect([...land].sort((a, b) => a - b)).toEqual(land);
    // A popup is just opening at its landing.
    for (const x of land.slice(0, 4)) expect(driftPops(x + 10, 2, o).some((p) => p.open > 0 && p.open < 0.2)).toBe(true);
  });
});

describe("act 2 timelines — the chart, the beans, the dance", () => {
  it("brings the chart's rows up bottom first, all at once from history", () => {
    expect(chartRowAt(11, 12, 5000, 1500)).toBe(5000);
    expect(chartRowAt(0, 12, 5000, 1500)).toBe(5000 + 11 * 1500);
    expect(chartRowAt(3, 12, 0, 1500)).toBe(0);
  });

  it("lays the rows in columns, capped on a portrait wall", () => {
    expect(chartLayout(8)).toEqual({ cols: 1, perCol: 8 });
    expect(chartLayout(12)).toEqual({ cols: 2, perCol: 6 });
    expect(chartLayout(40)).toEqual({ cols: 3, perCol: 14 });
    expect(chartLayout(12, 1)).toEqual({ cols: 1, perCol: 12 });
  });

  it("piles the beans up and never lets them go down", () => {
    expect(beanHeap(100, 900)).toBe(0);
    let last = 0;
    for (let t = 900; t < 200_000; t += 997) {
      const h = beanHeap(t, 900);
      expect(h).toBeGreaterThanOrEqual(last);
      expect(h).toBeLessThanOrEqual(1);
      last = h;
    }
    expect(last).toBeGreaterThan(0.8);
  });

  it("keeps the dance on a 120 BPM beat", () => {
    expect(danceBeat(10_000, 10_000)).toEqual({ n: 0, k: 0 });
    expect(danceBeat(11_250, 10_000)).toEqual({ n: 2, k: 0.5 });
    for (const h of equaliser(12_345, 18, 10_000)) expect(h >= 0 && h <= 1).toBe(true);
  });
});
