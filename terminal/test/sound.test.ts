import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIN_GAP_MS, OVER_GAIN, VIEW_VOLUME, playChime, playNotes, setSoundContext, setSoundMuted, setSoundView, sfx, sfxGate, type SoundContext } from "../src/sound/bus.ts";
import { CHIME_PARTS, SFX_NAMES, hz, isSfxName, recipe, sfxLength } from "../src/sound/library.ts";
import { voiceFloor } from "../src/speech/engine.ts";
import { FakeAudioContext, type FakeGain, type FakeOsc } from "./fake-audio.ts";

let ctx: FakeAudioContext;
beforeEach(() => {
  ctx = new FakeAudioContext();
  setSoundContext(ctx as unknown as SoundContext);
  setSoundMuted(false);
  setSoundView("auto");
});
afterEach(() => {
  setSoundContext(undefined);
  setSoundMuted(false);
});

/** The peak the first part's envelope ramps to. */
function firstPeak(c: FakeAudioContext): number {
  const env = c.sources[0]!.out[0]!.kind === "filter" ? c.sources[0]!.out[0]!.out[0]! : c.sources[0]!.out[0]!;
  return (env as FakeGain).gain.events.find((e) => e[0] === "exp")![1];
}

describe("the sound library", () => {
  it("has every named effect, each a short finite sound", () => {
    expect(SFX_NAMES.length).toBe(30);
    expect(new Set(SFX_NAMES).size).toBe(SFX_NAMES.length);
    for (const n of SFX_NAMES) {
      const parts = recipe(n);
      expect(parts.length, n).toBeGreaterThan(0);
      for (const p of parts) {
        expect(Number.isFinite(p.at) && p.at >= 0 && p.dur > 0 && p.gain > 0 && p.gain <= 0.5, `${n} part`).toBe(true);
        if (p.kind === "tone") expect(p.f).toBeGreaterThan(20);
      }
      expect(sfxLength(n), n).toBeGreaterThan(5);
      expect(sfxLength(n), n).toBeLessThanOrEqual(3200);
    }
    expect(isSfxName("ding")).toBe(true);
    expect(isSfxName("printer_grind")).toBe(false);
  });

  it("notes are equal-tempered", () => {
    expect(hz("A4")).toBe(440);
    expect(hz("A5")).toBeCloseTo(880);
    expect(hz("C4")).toBeCloseTo(261.63, 1);
    expect(hz("C#5")).toBeCloseTo(554.37, 1);
  });

  it("keeps the announcement chime note for note", () => {
    expect(CHIME_PARTS.map((p) => (p.kind === "tone" ? [p.f, p.at, p.dur, p.gain] : null))).toEqual([
      [660, 0, 0.16, 0.3],
      [1320, 0, 0.16, 0.075],
      [990, 0.16, 0.38, 0.3],
      [1980, 0.16, 0.38, 0.075],
    ]);
    expect(recipe("chime")).toEqual(CHIME_PARTS);
  });

  it("schedules every effect without a throw (each ramp stays positive)", () => {
    for (const n of SFX_NAMES) {
      ctx.currentTime += 1;
      expect(sfx(n), n).toBe(true);
    }
    expect(ctx.sources.length).toBeGreaterThan(SFX_NAMES.length);
    for (const s of ctx.sources) expect(s.stopped).toBeGreaterThan(s.started!);
  });
});

describe("the gate — effects drop, never queue", () => {
  it("decides off the lock, the mute and the voice floor", () => {
    expect(sfxGate({ running: false, muted: false, floorBusy: false, over: false }).play).toBe(false);
    expect(sfxGate({ running: true, muted: true, floorBusy: false, over: true }).play).toBe(false);
    expect(sfxGate({ running: true, muted: false, floorBusy: true, over: false }).play).toBe(false);
    expect(sfxGate({ running: true, muted: false, floorBusy: true, over: true })).toEqual({ play: true, gain: OVER_GAIN });
    expect(sfxGate({ running: true, muted: false, floorBusy: false, over: false })).toEqual({ play: true, gain: 1 });
  });

  it("is silent while sound is locked (no gesture yet)", () => {
    ctx.state = "suspended";
    expect(sfx("ding")).toBe(false);
    expect(ctx.sources).toEqual([]);
    ctx.state = "running";
    expect(sfx("ding")).toBe(true);
  });

  it("is silent while the page is muted", () => {
    setSoundMuted(true);
    expect(sfx("popup")).toBe(false);
    setSoundMuted(false);
    expect(sfx("popup")).toBe(true);
  });

  it("drops under a speaking voice; `over` plays it quieter", async () => {
    const release = await voiceFloor.acquire();
    try {
      expect(voiceFloor.busy).toBe(true);
      expect(sfx("ding")).toBe(false);
      expect(ctx.sources).toEqual([]);
      expect(sfx("ding", { over: true })).toBe(true);
      const quiet = firstPeak(ctx);
      const loud = new FakeAudioContext();
      setSoundContext(loud as unknown as SoundContext);
      release();
      expect(sfx("ding")).toBe(true);
      expect(quiet).toBeCloseTo(firstPeak(loud) * OVER_GAIN);
    } finally {
      release();
    }
  });

  it("plays the same effect once inside the gap", () => {
    expect(sfx("type")).toBe(true);
    expect(sfx("type")).toBe(false);
    expect(sfx("click")).toBe(true); // another effect is fine
    ctx.currentTime += (MIN_GAP_MS + 5) / 1000;
    expect(sfx("type")).toBe(true);
  });
});

describe("the bus", () => {
  it("routes effects through the effects bus at the view's level, the chime and the casino straight to the master", async () => {
    setSoundView("tv");
    sfx("blip");
    const fx = ctx.sources.length;
    expect(ctx.path(ctx.sources[0]!)).toEqual(["osc", "gain", "gain", "compressor", "gain", "destination"]);
    expect(ctx.gains[1]!.gain.value).toBe(VIEW_VOLUME.tv);
    setSoundView("auto");
    expect(ctx.gains[1]!.gain.value).toBe(VIEW_VOLUME.other);
    void playChime();
    const chime = ctx.sources.slice(fx);
    expect(chime.map((s) => (s as FakeOsc).frequency.value)).toEqual([660, 1320, 990, 1980]);
    expect(ctx.path(chime[0]!)).toEqual(["osc", "gain", "gain", "destination"]);
    playNotes([[523, 0.08], [659, 0.08]], { wave: "square", peak: 0.06, attack: 0.01 });
    const notes = ctx.sources.slice(fx + 4);
    expect(notes.map((s) => [s.type, (s as FakeOsc).frequency.value])).toEqual([["square", 523], ["square", 659]]);
    expect(firstPeakOf(notes[0]!)).toBeCloseTo(0.06);
  });

  it("the chime and the casino stay silent while locked; the chime resolves at once", async () => {
    ctx.state = "suspended";
    await playChime();
    playNotes([[440, 0.1]], { wave: "square", peak: 0.06, attack: 0.01 });
    expect(ctx.sources).toEqual([]);
  });

  it("a mute silences effects, not the chime", () => {
    setSoundMuted(true);
    void playChime();
    expect(ctx.sources.length).toBe(4);
  });
});

function firstPeakOf(s: FakeOsc): number {
  return (s.out[0] as FakeGain).gain.events.find((e) => e[0] === "exp")![1];
}
