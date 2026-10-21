// Lane tv3's timelines (wave 17), pure (`kit/tv3-time.ts`): the awards,
// truth.txt, the song's chat, the poll, the hand jive, the year that will
// not render, the weather — each a picture of t, checked against the show's
// own words where it carries them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HISTORY_T } from "../src/cutscene/clock.ts";
import {
  AWARDS,
  HAND_JIVE,
  SONG_CHAT,
  TRUTH_TXT,
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
  spinAngle,
  tallyOf,
  vortexAt,
  wrapLines,
} from "../src/cutscene/kit/tv3-time.ts";

const SHOW = join(__dirname, "../../core/examples/trapped-in-the-internet");
const FINALE = readFileSync(join(SHOW, "beats/finale.loom"), "utf8");
const CEREMONY = readFileSync(join(SHOW, "beats/ceremony.loom"), "utf8");

// --- the pure timelines -----------------------------------------------------------------

describe("tv3 timelines — the awards", () => {
  it("knows all nine of the ceremony's awards, each with a slide in the story", () => {
    expect(AWARDS.map((a) => a.id)).toEqual(["most_trusted", "least_trusted", "frequent_flyer", "lore_hoarder", "truthcoin_tycoon", "best_liar", "duck_speedrun", "quest_completionist", "the_painting"]);
    for (const a of AWARDS) expect(CEREMONY, a.id).toContain(`cue screens_award_${a.id}`);
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
    expect(awardValue(412)).toBe(412);
    expect(awardValue("17")).toBe(17);
    expect(awardValue("2:31")).toBe("2:31");
  });
});

describe("tv3 timelines — truth.txt", () => {
  it("types only what Truth Txt narrates, every night's lines (the featured ones need who came)", () => {
    for (const line of TRUTH_TXT) expect(FINALE, line).toContain(`Narrator: ${line}`);
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
    const mid = notepadAt(lines, 30_000, { rows: 10, start: 500 });
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
  it("the song's chat is the beat's own lines, his typed, her dots before every answer", () => {
    for (const l of SONG_CHAT) expect(FINALE).toContain(l.text);
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

