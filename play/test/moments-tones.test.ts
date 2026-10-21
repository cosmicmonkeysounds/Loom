//! Wave 18, the moments lane (BOOTH-SPEC §2.4): a pop-out's tone — the
//! notes and the buzz each one plays, through the shared AudioContext.

import { afterEach, describe, expect, it, vi } from "vitest";
import { TONES, playTone, vibrate } from "../src/alerts.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the tone table", () => {
  it("alarm E3 → C3 at 120 ms, info one A4 at 90 ms, win C5 E5 G5 C6 at 70 ms", () => {
    expect(TONES.alarm).toEqual({ notes: [164.81, 130.81], ms: 120, vibrate: [200, 80, 200] });
    expect(TONES.info).toEqual({ notes: [440], ms: 90, vibrate: [120] });
    expect(TONES.win).toEqual({ notes: [523.25, 659.25, 783.99, 1046.5], ms: 70, vibrate: [60, 40, 60, 40, 220] });
  });

  it("nothing flashes or beeps faster than three a second's worth of notes in a row (≥ 70 ms each)", () => {
    for (const t of Object.values(TONES)) expect(t.ms).toBeGreaterThanOrEqual(70);
  });
});

describe("playTone", () => {
  it("buzzes the tone's pattern, and plays nothing without an AudioContext (a test, an old browser)", () => {
    const buzz = vi.fn();
    vi.stubGlobal("navigator", { vibrate: buzz });
    playTone("win");
    expect(buzz).toHaveBeenCalledWith([60, 40, 60, 40, 220]);
    playTone("alarm", false);
    expect(buzz).toHaveBeenLastCalledWith([200, 80, 200]);
  });

  it("vibrate keeps its old default pattern for the chime", () => {
    const buzz = vi.fn();
    vi.stubGlobal("navigator", { vibrate: buzz });
    vibrate();
    expect(buzz).toHaveBeenCalledWith([180, 80, 180]);
  });
});
