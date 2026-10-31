import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  VOICE_ALARM_FLOOR,
  VOICE_FLAVOURS,
  VOICE_HEART_FLOOR,
  VOICE_PHASE_LEVEL,
  VOICE_READING_CAP,
  VOICE_SHOT_MS,
  VOICE_SPIKES,
  isVoiceFlavour,
  isVoiceFxMode,
  voiceFxOf,
  voiceLevel,
  voiceSpikeOf,
  type VoiceNight,
} from "../src/voice-fx.ts";

const night = (o: Partial<VoiceNight> = {}): VoiceNight => ({ phase: null, composure: null, remaining: null, alarmOn: null, heartStage: null, reading: false, ...o });
const read = (p: string): string => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("the night's arc", () => {
  it("is clean until the Trust Chart, whatever the phase before it", () => {
    for (const phase of ["arrivals", "desktop", "bingo", "bingo_results", "introduced", "hunt_1", "truth_1", "malware", "hunt_2", "summons", "truth_pong"]) {
      expect(voiceLevel(night({ phase }))).toBe(0);
    }
    expect(voiceLevel(night({ phase: null }))).toBe(0);
  });
  it("climbs from the Trust Chart to the verdict", () => {
    const order = ["trust_chart", "beans", "overshare", "y2k", "majority", "final_reveal", "grok_prom"];
    const levels = order.map((phase) => voiceLevel(night({ phase })));
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(new Set(levels).size).toBe(order.length);
    expect(levels[0]).toBeGreaterThan(0);
  });
  it("climbs through the Y2K hour with the clock", () => {
    const start = voiceLevel(night({ phase: "y2k", remaining: 3600 }));
    const half = voiceLevel(night({ phase: "y2k", remaining: 1800 }));
    const end = voiceLevel(night({ phase: "y2k", remaining: 0 }));
    expect(start).toBeCloseTo(0.5);
    expect(half).toBeCloseTo(0.65);
    expect(end).toBeCloseTo(0.8);
  });
  it("composure moves it, up on a rough night and down on a calm one", () => {
    const calm = voiceLevel(night({ phase: "overshare", composure: 85 }));
    const rough = voiceLevel(night({ phase: "overshare", composure: 0 }));
    expect(calm).toBeCloseTo(0.3 * 0.75);
    expect(rough).toBeCloseTo(0.3 * 1.25);
  });
  it("composure never makes a clean phase break", () => {
    expect(voiceLevel(night({ phase: "hunt_1", composure: 0 }))).toBe(0);
  });
  it("heals: the helped ending is clean", () => {
    expect(voiceLevel(night({ phase: "finale_help", composure: 0 }))).toBe(0);
  });
  it("banishment is everything", () => {
    expect(voiceLevel(night({ phase: "finale_banish", composure: 0 }))).toBe(1);
  });
  it("the alarm and his heart hold a floor, a reading a cap", () => {
    expect(voiceLevel(night({ phase: "hunt_2", alarmOn: true }))).toBe(VOICE_ALARM_FLOOR);
    expect(voiceLevel(night({ phase: "hunt_2", heartStage: "talk" }))).toBe(VOICE_HEART_FLOOR);
    expect(voiceLevel(night({ phase: "finale_banish", reading: true }))).toBe(VOICE_READING_CAP);
  });
  it("names only phases the story sets", () => {
    const show = "../examples/trapped-in-the-internet";
    const story = [read(`${show}/main.loom`), read(`${show}/beats/finale.loom`)].join("\n");
    for (const phase of Object.keys(VOICE_PHASE_LEVEL)) expect(story).toContain(`set Night.phase = "${phase}"`);
  });
  it("reads a composure the story declares, knocked down by the night", () => {
    expect(read("../examples/trapped-in-the-internet/cast/trabolta.loom")).toContain("composure: 0 to 100 = 85");
  });
});

describe("the major glitches", () => {
  const now = 1_000_000;
  it("nothing stands with no shot", () => {
    expect(voiceSpikeOf({ now })).toBeNull();
    expect(voiceSpikeOf({ now, glitch: null, flicker: null, dreamAt: null, shot: null })).toBeNull();
  });
  it("the hijack stands for its 8 s, and is never history", () => {
    const at = now - 7999;
    expect(voiceSpikeOf({ now, glitch: { at } })?.kind).toBe("hijack");
    expect(voiceSpikeOf({ now: at + 8000, glitch: { at } })).toBeNull();
    expect(voiceSpikeOf({ now, glitch: { at: 0 } })).toBeNull();
  });
  it("an ad burst is its own, shorter", () => {
    const s = voiceSpikeOf({ now, glitch: { at: now - 100, light: true } });
    expect(s?.kind).toBe("burst");
    expect(s?.ms).toBe(VOICE_SPIKES.burst.ms);
    expect(voiceSpikeOf({ now, glitch: { at: now - VOICE_SPIKES.burst.ms, light: true } })).toBeNull();
  });
  it("the dream's first seconds are the Y2K spike; a dream still ahead is nothing", () => {
    expect(voiceSpikeOf({ now, dreamAt: now - 1000 })?.kind).toBe("y2k");
    expect(voiceSpikeOf({ now, dreamAt: now + 1000 })).toBeNull();
    expect(voiceSpikeOf({ now, dreamAt: now - VOICE_SPIKES.y2k.ms })).toBeNull();
  });
  it("the biggest wins, and a director's shot beats them all", () => {
    expect(voiceSpikeOf({ now, flicker: { at: now - 10 }, glitch: { at: now - 10 } })?.kind).toBe("hijack");
    expect(voiceSpikeOf({ now, flicker: { at: now - 10 }, glitch: { at: now - 10, light: true } })?.kind).toBe("burst");
    const s = voiceSpikeOf({ now, glitch: { at: now - 10 }, shot: { flavour: "kernel", at: now - 10 } });
    expect(s).toMatchObject({ kind: "shot", flavours: ["kernel"], strength: 1, ms: VOICE_SHOT_MS });
  });
  it("gives every spike a key of its own, and real flavours", () => {
    expect(voiceSpikeOf({ now, flicker: { at: now - 5 } })?.key).not.toBe(voiceSpikeOf({ now, flicker: { at: now - 6 } })?.key);
    for (const s of Object.values(VOICE_SPIKES)) for (const f of s.flavours) expect(isVoiceFlavour(f)).toBe(true);
  });
});

describe("the director's mode", () => {
  const now = 1_000_000;
  const late = night({ phase: "grok_prom" });
  it("auto is the night", () => {
    expect(voiceFxOf("auto", late, { now }).level).toBe(0.9);
  });
  it("clean is the kill switch: no level, no spike", () => {
    expect(voiceFxOf("clean", late, { now, glitch: { at: now - 10 } })).toEqual({ mode: "clean", level: 0, spike: null });
  });
  it("clean still plays a director's own shot, or nobody could audition", () => {
    expect(voiceFxOf("clean", late, { now, shot: { flavour: "skip", at: now - 10 } }).spike?.kind).toBe("shot");
  });
  it("broken is full, in any phase", () => {
    expect(voiceFxOf("broken", night({ phase: "hunt_1" }), { now }).level).toBe(1);
  });
  it("keeps the wire short", () => {
    expect(voiceFxOf("auto", night({ phase: "overshare", composure: 40 }), { now }).level.toString().length).toBeLessThanOrEqual(4);
  });
  it("knows its modes and flavours", () => {
    expect(isVoiceFxMode("auto")).toBe(true);
    expect(isVoiceFxMode("off")).toBe(false);
    expect(isVoiceFlavour(VOICE_FLAVOURS[0])).toBe(true);
    expect(isVoiceFlavour("nope")).toBe(false);
  });
});
