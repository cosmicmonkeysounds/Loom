// Lane tv3's timelines (wave 17), pure (`kit/tv3-time.ts`): the awards,
// truth.txt, the song's chat, the poll, the hand jive, the year that will
// not render, the weather — each a picture of t, checked against the show's
// own words where it carries them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HISTORY_T } from "../src/cutscene/clock.ts";
import { confettiEmitters } from "../src/cutscene/kit/physics.ts";
import {
  AWARDS,
  AWARD_CONFETTI,
  STAFF_AWARD_IDS,
  CONFETTI_LIFE,
  HAND_JIVE,
  SONG_CHAT,
  TRUTH_TXT,
  ASSESSMENT_MS,
  awardConfettiAt,
  bobStateOf,
  awardOf,
  awardValue,
  binaryRainAt,
  brokenYear,
  chatAt,
  eqBars,
  floatersAt,
  handJivePhase,
  karaokeAt,
  notepadAt,
  rainAt,
  sinceMoment,
  spinAngle,
  tallyOf,
  vortexAt,
  wrapLines,
  bathTime,
} from "../src/cutscene/kit/tv3-time.ts";

const SHOW = join(__dirname, "../../core/examples/trapped-in-the-internet");
const FINALE = readFileSync(join(SHOW, "beats/finale.loom"), "utf8");
const CEREMONY = readFileSync(join(SHOW, "beats/ceremony.loom"), "utf8");

// --- the pure timelines -----------------------------------------------------------------

describe("tv3 timelines — the awards", () => {
  it("knows all ten of the programs' awards, the Bathroom Report (wave 45) and the Language Report (wave 48), each with a slide in the story", () => {
    const programs = AWARDS.filter((a) => a.kind !== "Staff award");
    expect(programs.map((a) => a.id)).toEqual(["most_trusted", "least_trusted", "frequent_flyer", "lore_hoarder", "truthcoin_tycoon", "best_liar", "duck_speedrun", "quest_completionist", "most_correct", "the_painting", "bathroom", "language"]);
    for (const a of programs) {
      const cue = `cue screens_award_${a.id}`;
      expect(CEREMONY, a.id).toContain(cue);
    }
  });

  it("knows the three staff awards (wave 21), and every award slide the story cues", () => {
    expect(STAFF_AWARD_IDS).toEqual(["staff_trusted", "staff_points", "staff_mole"]);
    expect(awardOf("award_staff_trusted")).toMatchObject({ title: "Trabolta's Favourite Staff", kind: "Staff award", emblem: "lanyard", label: "Trust score" });
    expect(awardOf("award_staff_points")).toMatchObject({ title: "Staff Player Of The Night", kind: "Staff award", emblem: "star", label: "Points" });
    expect(awardOf("award_staff_mole")).toMatchObject({ title: "The Mole", kind: "Staff award", emblem: "mole" });
    // The story lane cues them (`screens_award_staff_*`); whatever it cues, the table knows by name.
    const cued = [...CEREMONY.matchAll(/cue screens_award_([a-z0-9_]+)/gu)].map((m) => m[1]!);
    for (const id of cued) expect(AWARDS.map((a) => a.id), id).toContain(id);
    // The ceremony's ticker still promises only the main awards.
    for (const a of AWARDS.filter((x) => x.kind === "Staff award")) expect(a.line).not.toMatch(/performer|crew|John|Steph|Jesse/iu);
  });

  it("the Bathroom Report's times (wave 45): whole minutes, rounded, hours past the hour", () => {
    expect(bathTime(0)).toBe("none");
    expect(bathTime(Number.NaN)).toBe("none");
    expect(bathTime(20)).toBe("under a minute");
    expect(bathTime(30)).toBe("1 min");
    expect(bathTime(375)).toBe("6 min");
    expect(bathTime(3599)).toBe("1 h 00 min");
    expect(bathTime(24_300)).toBe("6 h 45 min");
    expect(awardOf("award_bathroom")).toMatchObject({ title: "The Bathroom Report", kind: "Bonus award", emblem: "roll" });
  });

  it("names the Language Report (wave 48; its breach is `lang-breach.test.ts`)", () => {
    expect(awardOf("award_language")).toMatchObject({ title: "The Language Report", kind: "Bonus award", emblem: "key" });
  });

  it("names the special prize (wave 58, G9a): an award of its own, never the secrets prize", () => {
    expect(awardOf("award_most_correct")).toMatchObject({ title: "Most Questions Correct", kind: "Award", emblem: "trophy", label: "Questions correct" });
    expect(awardOf("award_lore_hoarder")).toMatchObject({ title: "Lore Hoarder", label: "Codex entries held" });
  });

  it("reads an award off its slide value, and makes one up for a value it doesn't know", () => {
    expect(awardOf("award_best_liar")).toMatchObject({ title: "Best Liar", kind: "Bonus award", emblem: "mask" });
    expect(awardOf("award_truthcoin_tycoon").unit).toBe("Truthcoin");
    expect(awardOf("award_kindest_program")).toMatchObject({ title: "Kindest Program", emblem: "trophy" });
  });

  it("an award's value: none is null, a number counts up, anything else shows as it is", () => {
    expect(awardValue(null)).toBeNull();
    expect(awardValue("none")).toBeNull();
    expect(awardValue(" ")).toBeNull();
    expect(awardValue(Number.NaN)).toBeNull();
    expect(awardValue(38)).toBe(38);
    expect(awardValue("17")).toBe(17);
    expect(awardValue("2:31")).toBe("2:31");
  });

  it("the name's confetti falls its whole length; each later burst takes over only once the last piece has landed", () => {
    expect(Math.max(...confettiEmitters(0, AWARD_CONFETTI.dur).map((e) => e.life))).toBeLessThanOrEqual(CONFETTI_LIFE);
    expect(awardConfettiAt(0)).toEqual({ start: AWARD_CONFETTI.first, n: 0 });
    // The review's frames: the burst under the name is still falling either side of 5600.
    expect(awardConfettiAt(5550)).toEqual(awardConfettiAt(5650));
    expect(awardConfettiAt(AWARD_CONFETTI.first + AWARD_CONFETTI.dur - 1).start).toBe(AWARD_CONFETTI.first);
    let last = awardConfettiAt(0);
    const starts = new Set<number>([last.start]);
    for (let t = 0; t <= HISTORY_T + 60_000; t += 50) {
      const now = awardConfettiAt(t);
      if (now.start !== last.start) {
        expect(t, `switched at ${t}`).toBeGreaterThanOrEqual(last.start + AWARD_CONFETTI.dur + CONFETTI_LIFE);
        expect(now.n).toBe(last.n + 1);
        expect(now.start).toBeLessThanOrEqual(t);
      }
      starts.add(now.start);
      last = now;
    }
    // Every 12 s, all slide long.
    expect(starts.size).toBeGreaterThan(50);
  });
});

describe("tv3 timelines — the bob", () => {
  const m = (name: string, at: number, kind: "beat" | "signal" = "beat") => ({ kind, name, at });
  it("the bag is up once its beat plays after the slide went up; the assessment only after the bag", () => {
    expect(FINALE).toContain("== The Bag Of Truth");
    expect(FINALE).toContain("== Final Assessment");
    expect(bobStateOf([], 1000)).toEqual({ up: null, assessed: null });
    expect(bobStateOf([m("The Bag Of Truth", 500)], 1000)).toEqual({ up: null, assessed: null });
    expect(bobStateOf([m("The Bag Of Truth", 500)], 0)).toEqual({ up: 500, assessed: null });
    expect(bobStateOf([m("the_bag_of_truth", 5000), m("Final Assessment", 9000)], 1000)).toEqual({ up: 5000, assessed: 9000 });
    expect(bobStateOf([m("Final Assessment", 3000), m("The Bag Of Truth", 5000)], 1000)).toEqual({ up: 5000, assessed: null });
    expect(bobStateOf([m("The Bag Of Truth", 5000, "signal")], 1000).up).toBeNull();
    // Latched: the ring may forget the bag; the hold doesn't.
    expect(bobStateOf([], 1000, { up: 5000, assessed: null })).toEqual({ up: 5000, assessed: null });
    expect(bobStateOf([m("Final Assessment", 9000)], 1000, { up: 5000, assessed: null })).toEqual({ up: 5000, assessed: 9000 });
    expect(ASSESSMENT_MS).toBeGreaterThan(10_000);
  });

  it("time since a moment, off the scene's own clock (a history slide reads it as long ago)", () => {
    expect(sinceMoment(null, 1000, 5000, HISTORY_T)).toBeNull();
    expect(sinceMoment(4000, 1000, 5000, HISTORY_T)).toBe(2000);
    expect(sinceMoment(9000, 1000, 5000, HISTORY_T)).toBe(0);
    expect(sinceMoment(4000, 0, HISTORY_T + 10, HISTORY_T)).toBe(HISTORY_T);
  });
});

describe("tv3 timelines — truth.txt", () => {
  it("types only what Truth Txt narrates, a short teaser (wave 58)", () => {
    // Wave 18b §4.3: the first line is the contract's fixed text.
    expect(TRUTH_TXT[0]).toBe("This file is the truth. It was written by Jean Trabolta, Sole Owner and Founder of Maps and Ducks (he says), and it is the only version.");
    for (const line of TRUTH_TXT) expect(FINALE, line).toContain(`Narrator: ${line}`);
    expect(TRUTH_TXT.join(" ").split(/\s+/u).length).toBeLessThan(90);
    expect(TRUTH_TXT[TRUTH_TXT.length - 1]).toBe("End of file.");
    expect(TRUTH_TXT.some((l) => /Microsoft Excel|DraftKings|OpenOffice/u.test(l))).toBe(false);
  });

  it("wraps to the width, words whole, a blank line between paragraphs", () => {
    const lines = wrapLines(["one two three four five", "six"], 10);
    expect(lines).toEqual(["one two", "three four", "five", "", "six"]);
    for (const l of wrapLines(TRUTH_TXT, 40)) expect(l.length).toBeLessThanOrEqual(40);
    expect(wrapLines(["abcdefghijklmnop"], 8)).toEqual(["abcdefgh", "ijklmnop"]);
  });

  it("Notepad types from the start, follows the caret, then reads the file again forever", () => {
    const lines = wrapLines(TRUTH_TXT, 40);
    expect(notepadAt(lines, 0, { rows: 10, start: 500 }).rows.join("")).toBe("");
    const mid = notepadAt(lines, 12_000, { rows: 10, start: 500 });
    expect(mid.done).toBe(false);
    expect(mid.line - mid.top).toBeLessThan(10);
    expect(mid.rows.length).toBeLessThanOrEqual(10);
    const late = notepadAt(lines, HISTORY_T, { rows: 10, start: 500 });
    expect(late.done).toBe(true);
    expect(late.rows.length).toBe(10);
    // The read-through moves: two moments a minute apart show different rows.
    const tops = new Set([0, 15_000, 30_000, 45_000, 60_000].map((d) => notepadAt(lines, HISTORY_T + d, { rows: 10, start: 500 }).top));
    expect(tops.size).toBeGreaterThan(1);
    // Pure: the same t, the same page.
    expect(notepadAt(lines, 123_456, { rows: 10 })).toEqual(notepadAt(lines, 123_456, { rows: 10 }));
  });
});

describe("tv3 timelines — the song, the poll, the moments", () => {
  it("the song's chat, his typed, her dots before every answer", () => {
    expect(SONG_CHAT.length).toBeGreaterThan(0);
    expect(chatAt(0, { start: 1000 }).bubbles).toEqual([]);
    const typing = chatAt(1000 + 500, { start: 1000, every: 4000 });
    expect(typing.typing).toBe("him");
    expect(typing.bubbles[0]!.typed).toBeGreaterThan(0);
    const dots = chatAt(1000 + 4000 + 500, { start: 1000, every: 4000 });
    expect(dots.typing).toBe("her");
    const answered = chatAt(1000 + 4000 + 3000, { start: 1000, every: 4000 });
    expect(answered.typing).toBeNull();
    expect(answered.bubbles[answered.bubbles.length - 1]!.line.from).toBe("her");
    // It loops, keeping the last few.
    expect(chatAt(HISTORY_T, { keep: 4 }).bubbles.length).toBeLessThanOrEqual(4);
  });

  it("the karaoke ball walks the words on the beat", () => {
    expect(karaokeAt(0, 6).word).toBe(0);
    expect(karaokeAt(469 * 7 + 10, 6).word).toBe(1);
    expect(karaokeAt(469 / 2, 6).hop).toBeCloseTo(1, 1);
  });

  it("the advice tally: shares off the night's counts, even with no votes", () => {
    expect(tallyOf(null, null)).toMatchObject({ total: 0, helpShare: 0.5, leader: "tie", live: false });
    expect(tallyOf(7, 3)).toMatchObject({ help: 7, thwart: 3, total: 10, leader: "help", live: true });
    expect(tallyOf(7, 3).helpShare).toBeCloseTo(0.7);
    expect(tallyOf(-2, 4)).toMatchObject({ help: 0, leader: "thwart" });
  });

  it("the hand jive follows the narration: hourglass, then black, then the startup", () => {
    expect(handJivePhase(0)).toBe("overflow");
    expect(handJivePhase(HAND_JIVE.hourglass)).toBe("hourglass");
    expect(handJivePhase(HAND_JIVE.black)).toBe("black");
    expect(handJivePhase(HAND_JIVE.startup)).toBe("startup");
    expect(handJivePhase(HAND_JIVE.reboot)).toBe("reboot");
    expect(handJivePhase(HAND_JIVE.end)).toBe("out");
    expect(FINALE).toContain("Every screen in the house shows a spinning hourglass. Then a black screen. Then the Windows startup sound, slowed down.");
    expect(spinAngle(HAND_JIVE.hourglass, HAND_JIVE.hourglass, 1000)).toBe(0);
    expect(spinAngle(5000, 0, 1000, 2)).toBe(720);
  });

  it("the year never renders: always 19 and two glyphs that are not a year", () => {
    for (let t = 0; t < 20_000; t += 90) {
      const y = brokenYear(t);
      expect(y.startsWith("19")).toBe(true);
      expect(y.length).toBe(4);
      expect(["1900", "1999"]).not.toContain(y);
    }
    expect(brokenYear(1234)).toBe(brokenYear(1234));
  });

  it("weather and particles are closed form: bounded, seeded, the same at the same t", () => {
    expect(rainAt(5000, 120)).toHaveLength(120);
    expect(rainAt(5000, 50, 3)).toEqual(rainAt(5000, 50, 3));
    for (const d of rainAt(7777, 80)) expect(d.y).toBeGreaterThanOrEqual(-0.1);
    for (const g of binaryRainAt(4000, 20)) {
      expect(["0", "1"]).toContain(g.ch);
      expect(g.bright).toBeGreaterThan(0);
    }
    for (const v of eqBars(12_345, 32)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    const f = floatersAt(60_000, { every: 100, life: 5000, count: 24 });
    expect(f.length).toBeLessThanOrEqual(24);
    for (const x of f) {
      expect(x.alpha).toBeGreaterThanOrEqual(0);
      expect(x.alpha).toBeLessThanOrEqual(1);
    }
    expect(floatersAt(100, { start: 500 })).toEqual([]);
    for (let i = 0; i < 12; i++) {
      const v = vortexAt(3333, i, 12);
      expect(v.scale).toBeGreaterThan(0);
      expect(v.alpha).toBeGreaterThanOrEqual(0);
    }
  });

});

