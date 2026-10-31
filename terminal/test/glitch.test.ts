import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLEAN_BEATS, FLAVOUR_FROM, HIS_PITCH, VOICE_FLAVOURS, WINDOW_WORDS, breakChance, breakChunk, flatText, isCleanBeat, paceRate, planMs, voiceShaper, type VoiceFlavour, type VoicePlan } from "../src/speech/glitch.ts";

const LINE = "I have been monitoring your performance and I am ready to make my assessment of trustworthiness.";
const LONG = Array.from({ length: 80 }, (_, i) => `word${"abcdefgh"[i % 8]}`).join(" ") + ".";
const force = (f: VoiceFlavour, seed: number, level = 1, text = LINE, voices = 3): VoicePlan => breakChunk(text, { level, flavours: [f], strength: 1, seed, voices })!;
const seeds = Array.from({ length: 200 }, (_, i) => i * 7919 + 1);

/** SAPI's speed step, as Chrome on Windows computes it (`tts_win.cc`). */
const sapiStep = (rate: number): number => Math.trunc(10 * Math.log10(rate)) + 0;
/** SAPI's pitch step (`tts_win.cc`). */
const sapiPitch = (pitch: number): number => Math.trunc(Math.min(10, Math.max(-10, pitch * 10 - 10)));

describe("the pace", () => {
  it("lands on every SAPI step it asks for", () => {
    for (let p = -4; p <= 5; p++) if (p !== 0) expect(sapiStep(paceRate(p, 0.92))).toBe(p);
  });
  it("0 is the terminal's own speed", () => {
    expect(paceRate(0, 0.92)).toBe(0.92);
  });
  it("(the reason it isn't a multiplier) the TV's 0.92 and 1.25 are one step on Windows", () => {
    expect(sapiStep(0.92)).toBe(sapiStep(1.25));
  });
  it("stays in the range speechSynthesis takes", () => {
    for (const f of VOICE_FLAVOURS) for (const s of seeds) for (const x of force(f, s).frags) {
      const rate = paceRate(x.pace, 1);
      expect(rate).toBeGreaterThanOrEqual(0.1);
      expect(rate).toBeLessThanOrEqual(10);
      expect(x.pitch).toBeGreaterThanOrEqual(0);
      expect(x.pitch).toBeLessThanOrEqual(2);
      expect(x.volume).toBeGreaterThan(0);
      expect(x.volume).toBeLessThanOrEqual(1);
    }
  });
});

describe("every flavour", () => {
  it.each(VOICE_FLAVOURS)("%s changes how the sentence is said", (f) => {
    for (const s of seeds) {
      const p = force(f, s);
      expect(p.flavours).toEqual([f, f]); // LINE is long enough to break twice at level 1
      expect(p.frags.length).toBeGreaterThan(1);
    }
  });
  it.each(VOICE_FLAVOURS)("%s says only his own words, or their letters", (f) => {
    const own = new Set(LINE.toLowerCase().replace(/[^a-z ]/g, "").split(" "));
    for (const s of seeds) {
      for (const x of force(f, s).frags) {
        for (const w of x.text.toLowerCase().replace(/[^a-z ]/g, "").split(" ")) {
          if (w === "") continue;
          expect(own.has(w) || (w.length === 1 && LINE.toLowerCase().includes(w))).toBe(true);
        }
      }
    }
  });
  it.each(VOICE_FLAVOURS)("%s never hands an engine a fragment with nothing to say", (f) => {
    for (const text of [LINE, "Stop.", "No, no, no!", "A — B", "You. Are. The one."]) {
      for (const s of seeds) {
        const p = breakChunk(text, { level: 1, flavours: [f], strength: 1, seed: s, voices: 2 })!;
        expect(p.frags.length).toBeGreaterThan(0);
        for (const x of p.frags) expect(/[\p{L}\p{N}]/u.test(x.text)).toBe(true);
      }
    }
  });
  it.each(VOICE_FLAVOURS)("%s keeps a long reading inside a bound", (f) => {
    for (const s of seeds) {
      const p = force(f, s, 1, LONG);
      expect(planMs(p.frags)).toBeLessThan((62 * LONG.length) / 0.8 + 24_000);
    }
  });
  it("has one for every flavour the server knows, each with its level", () => {
    for (const f of VOICE_FLAVOURS) expect(FLAVOUR_FROM[f].weight).toBeGreaterThan(0);
  });
});

describe("what each flavour does", () => {
  it("skip cuts a word off and says it again", () => {
    const frags = seeds.flatMap((s) => force("skip", s).frags);
    expect(frags.some((x) => x.cutMs !== undefined && x.cutMs >= 90 && x.cutMs <= 170)).toBe(true);
    const f = force("skip", 3).frags;
    const texts = f.map((x) => x.text);
    expect(texts.some((t, i) => i > 0 && t === texts[i - 1])).toBe(true);
  });
  it("stall sinks and stops dead", () => {
    const f = force("stall", 5, 1).frags;
    const slow = f.filter((x) => x.pace < 0);
    expect(slow.length).toBeGreaterThanOrEqual(2);
    expect(slow[slow.length - 1]!.pitch).toBeLessThan(slow[0]!.pitch);
    expect(Math.max(...f.map((x) => x.gapMs))).toBeGreaterThanOrEqual(300);
  });
  it("overclock only ever speeds up and climbs", () => {
    for (const s of seeds) {
      const f = breakChunk(LINE.slice(0, 40), { level: 1, flavours: ["overclock"], strength: 1, seed: s, voices: 0 })!.frags;
      const paces = f.filter((x) => x.pace !== 0).map((x) => x.pace);
      expect(paces).toEqual([...paces].sort((a, b) => a - b));
    }
  });
  it("driver hops the device's voices, or its own pitch on a device with none", () => {
    const withVoices = force("driver", 9, 1, LINE, 3).frags.map((x) => x.voice).filter((v) => v !== undefined);
    expect(new Set(withVoices).size).toBeGreaterThan(1);
    const alone = force("driver", 9, 1, LINE, 0).frags;
    expect(alone.every((x) => x.voice === undefined)).toBe(true);
    expect(alone.some((x) => x.pitch <= 0.2)).toBe(true);
    expect(alone.some((x) => x.pitch >= 1.7)).toBe(true);
  });
  it("packet never loses a number, a name, or the sentence's ends", () => {
    const text = "Most trusted of them all is Gerald with 42 true and 7 lies on the record tonight everybody.";
    for (const s of seeds) {
      const said = flatText(breakChunk(text, { level: 1, flavours: ["packet"], strength: 1, seed: s, voices: 0 })!);
      for (const keep of ["Most", "Gerald", "42", "7", "everybody"]) expect(said).toContain(keep);
    }
  });
  it("packet leaves a hole, cut or silent", () => {
    const f = seeds.flatMap((s) => force("packet", s).frags);
    expect(f.some((x) => x.gapMs > 0)).toBe(true);
    expect(f.some((x) => x.cutMs !== undefined)).toBe(true);
  });
  it("dump spells a word out, and a sentence with none to spell still breaks", () => {
    const f = seeds.flatMap((s) => force("dump", s).frags);
    expect(f.some((x) => /^[A-Z]( [A-Z]){3,}$/.test(x.text))).toBe(true);
    expect(breakChunk("No, it is 42.", { level: 1, flavours: ["dump"], strength: 1, seed: 1, voices: 0 })!.frags.length).toBeGreaterThan(1);
  });
  it("safe is flat, slow and even", () => {
    const short = "Nothing here is safe to read.";
    const f = breakChunk(short, { level: 1, flavours: ["safe"], strength: 1, seed: 2, voices: 0 })!.frags;
    expect(new Set(f.map((x) => x.pitch))).toEqual(new Set([0.5]));
    expect(f).toHaveLength(6);
    expect(f.every((x) => x.pace === -1 && x.gapMs >= 60)).toBe(true);
  });
  it("loop fades as it tightens", () => {
    const f = breakChunk("Every one of you is banished.", { level: 1, flavours: ["loop"], strength: 1, seed: 4, voices: 0 })!.frags;
    const v = f.map((x) => x.volume);
    expect(v).toEqual([...v].sort((a, b) => b - a));
    expect(v[v.length - 1]).toBeLessThan(0.5);
    expect(f[f.length - 1]!.text.split(" ").length).toBeLessThanOrEqual(3);
  });
  it("kernel is the bottom of the voice", () => {
    const f = breakChunk("You lied to me and I know it.", { level: 1, flavours: ["kernel"], strength: 1, seed: 6, voices: 0 })!.frags;
    expect(f.every((x) => x.pitch === 0 && x.pace === -2)).toBe(true);
    expect(sapiPitch(f[0]!.pitch)).toBe(-10);
  });
});

describe("the night", () => {
  const rate = (level: number): number => seeds.filter((s) => (breakChunk(LINE, { level, seed: s, voices: 2 })?.flavours.length ?? 0) > 0).length / seeds.length;
  it("level 0 is exactly his voice", () => {
    for (const s of seeds) expect(breakChunk(LINE, { level: 0, seed: s, voices: 2 })).toBeNull();
  });
  it("breaks more of his sentences the later it gets", () => {
    expect(rate(0.1)).toBeLessThan(0.35);
    expect(rate(0.5)).toBeGreaterThan(rate(0.1));
    expect(rate(1)).toBe(1);
    expect(breakChance(0)).toBeCloseTo(0.05);
  });
  it("opens the flavours in order: no kernel at the Trust Chart", () => {
    const seen = (level: number) => new Set(seeds.flatMap((s) => breakChunk(LINE, { level, seed: s, voices: 2 })?.flavours ?? []));
    expect(seen(0.15).has("kernel")).toBe(false);
    expect(seen(0.15).has("skip")).toBe(true);
    expect(seen(1).size).toBe(VOICE_FLAVOURS.length);
  });
  it("a sentence that doesn't break still wanders once he's frayed, in one fragment", () => {
    const quiet = seeds.map((s) => breakChunk(LINE, { level: 0.45, seed: s, voices: 2 })).filter((p) => p !== null && p.flavours.length === 0);
    expect(quiet.length).toBeGreaterThan(0);
    for (const p of quiet) {
      expect(p!.frags).toHaveLength(1);
      expect(p!.frags[0]!.text).toBe(LINE);
    }
    expect(quiet.some((p) => p!.frags[0]!.pace !== 0)).toBe(true);
    expect(quiet.some((p) => p!.frags[0]!.pitch !== HIS_PITCH)).toBe(true);
  });
  it("a wandering pace is a step SAPI can hear", () => {
    const paces = seeds.flatMap((s) => breakChunk(LINE, { level: 0.45, seed: s, voices: 2 })?.frags ?? []).map((f) => f.pace);
    for (const p of paces) expect(Number.isInteger(p)).toBe(true);
  });
  it("works a window of a long reading, the rest kept whole", () => {
    const p = force("safe", 11, 0.5, LONG);
    const words = LONG.split(" ").length;
    const said = p.frags.flatMap((f) => f.text.split(" ")).length;
    expect(said).toBe(words);
    // The window is broken into its words; the rest stays in long runs.
    expect(p.frags.length).toBeLessThan(words / 2);
    expect(p.frags.filter((f) => f.pitch === 0.5).length).toBeLessThanOrEqual(WINDOW_WORDS * 2);
  });
  it("is the same every time on one seed, different on another", () => {
    expect(breakChunk(LINE, { level: 1, seed: 42, voices: 2 })).toEqual(breakChunk(LINE, { level: 1, seed: 42, voices: 2 }));
    expect(new Set(seeds.map((s) => JSON.stringify(breakChunk(LINE, { level: 1, seed: s, voices: 2 })))).size).toBeGreaterThan(100);
  });
});

describe("a spike", () => {
  it("is certain, in its own flavours, even before the night has started", () => {
    for (const s of seeds) {
      const p = breakChunk("Do not call that number now.", { level: 0, flavours: ["packet", "skip"], strength: 0.8, seed: s, voices: 0 })!;
      expect(p.flavours.every((f) => f === "packet" || f === "skip")).toBe(true);
    }
  });
});

describe("flatText, for a voice that takes only words", () => {
  it("keeps the repeats and the holes", () => {
    const p = { flavours: [], frags: [{ text: "the the", pace: 3, pitch: 1, volume: 1, gapMs: 0 }, { text: "program", pace: 0, pitch: 1, volume: 1, gapMs: 40 }] } satisfies VoicePlan;
    expect(flatText(p)).toBe("the the program");
  });
});

describe("the clean beats", () => {
  it("name real beats of the story", () => {
    const dir = fileURLToPath(new URL("../../core/examples/trapped-in-the-internet/beats/", import.meta.url));
    const beats = readdirSync(dir).map((f) => readFileSync(`${dir}${f}`, "utf8")).join("\n");
    for (const b of CLEAN_BEATS) expect(beats).toContain(`== ${b}\n`);
  });
  it("match the way the story folds names, and nothing else", () => {
    expect(isCleanBeat("heart heard")).toBe(true);
    expect(isCleanBeat("Advice_Helped")).toBe(true);
    expect(isCleanBeat("Advice Thwarted")).toBe(false);
    expect(isCleanBeat(null)).toBe(false);
  });
});

describe("voiceShaper", () => {
  const spike = { key: "hijack:100", at: 100, ms: 1000, strength: 1, flavours: ["safe"] as VoiceFlavour[] };
  const shaper = (fx: Parameters<typeof voiceShaper>[0]["fx"], now: number) => voiceShaper({ fx, now: () => now, salt: 7, voices: () => 0 });
  it("says nothing without a server's word (an older server)", () => {
    expect(shaper(() => null, 0)(LINE, 1, 0)).toBeNull();
    expect(shaper(() => undefined, 0)(LINE, 1, 0)).toBeNull();
  });
  it("takes a live spike's flavours", () => {
    expect(shaper(() => ({ level: 0, spike }), 500)(LINE, 1, 0)?.flavours).toContain("safe");
  });
  it("ignores a spike that is over, or hasn't started on this clock", () => {
    expect(shaper(() => ({ level: 0, spike }), 1100)(LINE, 1, 0)).toBeNull();
    expect(shaper(() => ({ level: 0, spike }), 50)(LINE, 1, 0)).toBeNull();
  });
  it("seeds on the line and the sentence, so no two break alike", () => {
    const s = shaper(() => ({ level: 1, spike: null }), 0);
    expect(JSON.stringify(s(LINE, 1, 0))).not.toBe(JSON.stringify(s(LINE, 1, 1)));
    expect(JSON.stringify(s(LINE, 1, 0))).not.toBe(JSON.stringify(s(LINE, 2, 0)));
  });
});
